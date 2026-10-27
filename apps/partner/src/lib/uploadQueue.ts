// Several picked files upload two at a time, each with its own state (UX.md §6):
// waiting → uploading 45% → done ✓, or failed ⟳ retry. Each can be cancelled while waiting or uploading.
import type { Media } from '@eventseva/app-shared';
import { errorCode } from './errors';
import { createStore } from './store';
import { uploadMedia, type PickedFile, type UploadError, type UploadOptions, type UploadStage } from './upload';

export type UploadState = 'waiting' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  id: string;
  file: PickedFile;
  state: UploadState;
  stage: UploadStage | null;
  /** 0…1 */
  progress: number;
  error: unknown;
  /** False for problems a retry can't fix (too long, too big, duplicate, limit). */
  retryable: boolean;
  media: Media | null;
}

export type Runner = (file: PickedFile, opts: UploadOptions) => Promise<Media>;

export interface QueueEvents {
  /** One file finished: refresh the media list. */
  onDone?: (item: UploadItem) => void;
  /** Nothing waiting or uploading any more; counts since the last time it was idle. */
  onIdle?: (summary: { done: number; failed: number }) => void;
}

/** Errors a retry cannot fix: the tile shows the message and "Remove" instead of ⟳. */
const FINAL = new Set(['FILE_TOO_BIG', 'VIDEO_TOO_LONG', 'UNSUPPORTED_FILE', 'MEDIA_DUPLICATE', 'LIMIT_REACHED', 'UPLOAD_NOT_CONFIGURED']);
export const isRetryable = (e: unknown) => !FINAL.has(errorCode(e) ?? '');

let seq = 0;

export class UploadQueue {
  readonly store = createStore<UploadItem[]>([]);
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<QueueEvents>();
  private batch = { done: 0, failed: 0 };

  constructor(
    private readonly run: Runner,
    private readonly concurrency = 2,
    /** Finished tiles stay this long with their ✓, then make way for the real photo. */
    private readonly doneTtlMs = 4000,
  ) {}

  get items() {
    return this.store.get();
  }

  get active() {
    return this.items.filter((i) => i.state === 'waiting' || i.state === 'uploading');
  }

  on(events: QueueEvents) {
    this.listeners.add(events);
    return () => {
      this.listeners.delete(events);
    };
  }

  /** Adds files; a file that fails the phone checks (`problems`) shows as failed at once. */
  add(files: PickedFile[], problems: Array<UploadError | null> = []): string[] {
    const added = files.map<UploadItem>((file, i) => {
      const problem = problems[i] ?? null;
      return {
        id: `up-${++seq}`,
        file,
        state: problem ? 'failed' : 'waiting',
        stage: null,
        progress: 0,
        error: problem,
        retryable: problem ? false : true,
        media: null,
      };
    });
    this.store.set((list) => [...list, ...added]);
    this.pump();
    return added.map((i) => i.id);
  }

  /** Stops a waiting or uploading file and removes its tile. */
  cancel(id: string) {
    this.controllers.get(id)?.abort();
    this.controllers.delete(id);
    this.remove(id);
    this.pump();
  }

  retry(id: string) {
    this.patch(id, (i) => (i.state === 'failed' && i.retryable ? { ...i, state: 'waiting', error: null, progress: 0, stage: null } : i));
    this.pump();
  }

  /** Removes a failed or finished tile. */
  dismiss(id: string) {
    if (this.controllers.has(id)) return;
    this.remove(id);
  }

  /** Cancels everything (log out). */
  clear() {
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    this.store.set([]);
  }

  private remove(id: string) {
    this.store.set((list) => list.filter((i) => i.id !== id));
    this.maybeIdle();
  }

  private patch(id: string, fn: (i: UploadItem) => UploadItem) {
    this.store.set((list) => list.map((i) => (i.id === id ? fn(i) : i)));
  }

  private pump() {
    const uploading = this.items.filter((i) => i.state === 'uploading').length;
    const free = this.concurrency - uploading;
    if (free <= 0) return;
    this.items
      .filter((i) => i.state === 'waiting')
      .slice(0, free)
      .forEach((i) => this.start(i));
  }

  private start(item: UploadItem) {
    const controller = new AbortController();
    this.controllers.set(item.id, controller);
    this.patch(item.id, (i) => ({ ...i, state: 'uploading', progress: 0, stage: 'preparing' }));
    let shown = 0;
    this.run(item.file, {
      signal: controller.signal,
      onStage: (stage) => this.patch(item.id, (i) => ({ ...i, stage })),
      onProgress: (p) => {
        // Re-render only on whole percents.
        if (Math.floor(p * 100) === Math.floor(shown * 100)) return;
        shown = p;
        this.patch(item.id, (i) => ({ ...i, progress: p }));
      },
    })
      .then((media) => {
        if (controller.signal.aborted) return;
        this.batch.done++;
        this.patch(item.id, (i) => ({ ...i, state: 'done', progress: 1, media, stage: null }));
        const done = this.items.find((i) => i.id === item.id);
        if (done) this.listeners.forEach((l) => l.onDone?.(done));
        setTimeout(() => this.dismiss(item.id), this.doneTtlMs);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted || errorCode(e) === 'CANCELLED') return;
        this.batch.failed++;
        this.patch(item.id, (i) => ({ ...i, state: 'failed', error: e, retryable: isRetryable(e), stage: null }));
      })
      .finally(() => {
        this.controllers.delete(item.id);
        this.pump();
        this.maybeIdle();
      });
  }

  private maybeIdle() {
    if (this.active.length || (!this.batch.done && !this.batch.failed)) return;
    const summary = this.batch;
    this.batch = { done: 0, failed: 0 };
    this.listeners.forEach((l) => l.onIdle?.(summary));
  }
}

/** The app's one queue for photos and videos, shared by Profile, Photos and onboarding. */
export const mediaUploads = new UploadQueue((file, opts) => uploadMedia(file, opts));

const itemQueues = new Map<string, UploadQueue>();
/** One queue per rental item, so its photos register against that item. */
export function itemUploads(itemId: string): UploadQueue {
  let q = itemQueues.get(itemId);
  if (!q) {
    q = new UploadQueue((file, opts) => uploadMedia(file, opts, itemId));
    itemQueues.set(itemId, q);
  }
  return q;
}

export function clearItemUploads() {
  itemQueues.forEach((q) => q.clear());
  itemQueues.clear();
}
