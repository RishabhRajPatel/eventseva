import { ApiError, type Media } from '@eventseva/app-shared';
import { UploadQueue, type Runner } from '../lib/uploadQueue';
import { UploadError, type PickedFile, type UploadOptions } from '../lib/upload';

jest.mock('../lib/api', () => ({ api: { post: jest.fn() } }));

const file = (n: number, type: 'photo' | 'video' = 'photo'): PickedFile => ({ uri: `file:///${n}.jpg`, type, width: 100, height: 100, fileName: `${n}.jpg` });
const media = (id: string) => ({ id }) as Media;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** A runner whose uploads finish only when the test says so. */
function controllable() {
  const running = new Map<string, { resolve: (m: Media) => void; reject: (e: unknown) => void; opts: UploadOptions }>();
  let peak = 0;
  const run: Runner = (f, opts) =>
    new Promise<Media>((resolve, reject) => {
      running.set(f.uri, { resolve, reject, opts });
      peak = Math.max(peak, running.size);
      opts.signal?.addEventListener('abort', () => reject(new UploadError('CANCELLED', 'cancelled')));
    }).finally(() => running.delete(f.uri));
  return { run: jest.fn(run), running, peak: () => peak };
}

describe('upload queue', () => {
  it('uploads two at a time and starts the next one as soon as one finishes', async () => {
    const r = controllable();
    const q = new UploadQueue(r.run, 2, 10);
    q.add([1, 2, 3, 4, 5].map((n) => file(n)));
    expect(q.items.map((i) => i.state)).toEqual(['uploading', 'uploading', 'waiting', 'waiting', 'waiting']);
    expect(r.run).toHaveBeenCalledTimes(2);

    r.running.get('file:///1.jpg')!.opts.onProgress?.(0.45);
    expect(q.items[0].progress).toBe(0.45);

    r.running.get('file:///1.jpg')!.resolve(media('m1'));
    await flush();
    expect(q.items[0].state).toBe('done');
    expect(q.items[2].state).toBe('uploading');
    expect(r.run).toHaveBeenCalledTimes(3);

    for (const n of [2, 3, 4, 5]) {
      await flush();
      r.running.get(`file:///${n}.jpg`)?.resolve(media(`m${n}`));
    }
    await flush();
    await flush();
    expect(r.peak()).toBe(2);
    expect(q.items.every((i) => i.state === 'done')).toBe(true);
  });

  it('a failed upload can be retried', async () => {
    const run = jest
      .fn<Promise<Media>, [PickedFile, UploadOptions]>()
      .mockRejectedValueOnce(new UploadError('NETWORK', 'No internet'))
      .mockResolvedValueOnce(media('m1'));
    const q = new UploadQueue(run, 2, 10);
    const [id] = q.add([file(1)]);
    await flush();
    expect(q.items[0]).toMatchObject({ state: 'failed', retryable: true });
    q.retry(id);
    expect(q.items[0].state).toBe('uploading');
    await flush();
    expect(q.items[0]).toMatchObject({ state: 'done', media: { id: 'm1' } });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('problems a retry cannot fix are final', async () => {
    const run = jest.fn().mockRejectedValue(new ApiError(409, 'MEDIA_DUPLICATE', 'dup'));
    const q = new UploadQueue(run, 2, 10);
    const [id, tooLong] = q.add([file(1), file(2, 'video')], [null, new UploadError('VIDEO_TOO_LONG', 'too long')]);
    await flush();
    expect(q.items.find((i) => i.id === id)).toMatchObject({ state: 'failed', retryable: false });
    expect(q.items.find((i) => i.id === tooLong)).toMatchObject({ state: 'failed', retryable: false });
    // Never sent at all.
    expect(run).toHaveBeenCalledTimes(1);
    q.retry(id);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels a waiting or an uploading file', async () => {
    const r = controllable();
    const q = new UploadQueue(r.run, 2, 10);
    const [a, , c] = q.add([file(1), file(2), file(3)]);
    q.cancel(c); // waiting: just removed, never run
    expect(q.items).toHaveLength(2);
    const signal = r.running.get('file:///1.jpg')!.opts.signal!;
    q.cancel(a); // uploading: aborted
    expect(signal.aborted).toBe(true);
    expect(q.items.map((i) => i.file.uri)).toEqual(['file:///2.jpg']);
    await flush();
    expect(r.run).toHaveBeenCalledTimes(2);
  });

  it('tells listeners about each file and sums up the batch', async () => {
    const run = jest.fn().mockResolvedValueOnce(media('m1')).mockRejectedValueOnce(new UploadError('UPLOAD_FAILED', 'x'));
    const q = new UploadQueue(run, 2, 10);
    const onDone = jest.fn();
    const onIdle = jest.fn();
    q.on({ onDone, onIdle });
    q.add([file(1), file(2)]);
    await flush();
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith({ done: 1, failed: 1 });
  });
});
