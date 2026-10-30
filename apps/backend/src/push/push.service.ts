import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { Db } from '../db/db.service';
import { PUSH_SENDER, PushSender } from './push-sender';

/** Pushes older than this are not sent any more (a "booking confirmed" from yesterday is noise). */
const MAX_AGE = '1 hour';
const POLL_MS = 30_000;
const BATCH = 100;

interface Pending {
  id: string;
  user_id: string;
  app: 'customer' | 'partner' | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/**
 * Sends a phone push for every new notification. Wakes on pg_notify('push') right after the
 * transaction that created it commits, and also polls every 30 s in case a wake-up was missed
 * (restart, lost connection). Rows are claimed with SKIP LOCKED, so several API servers can run
 * this without sending anything twice.
 */
@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PushDispatcher');
  private listener?: Client;
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;
  private again = false;

  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
  ) {}

  async onModuleInit() {
    if (!this.config.pushDispatch) return;
    await this.listen();
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.kick();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    await this.running;
  }

  /** Starts listening for new notifications (public so tests can switch it on). */
  async listen() {
    const client = new Client({ connectionString: this.config.databaseUrl });
    client.on('notification', () => this.kick());
    client.on('error', (err) => {
      this.logger.warn(`listener lost: ${err.message}; polling until it reconnects`);
      this.listener = undefined;
      setTimeout(() => void this.listen().catch(() => undefined), 5_000);
    });
    await client.connect();
    await client.query('LISTEN push');
    this.listener = client;
  }

  /** Runs one dispatch, or queues one more if a dispatch is already running. */
  kick() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.dispatchPending()
      .catch((err) => {
        this.logger.error(`dispatch failed: ${err.stack ?? err}`);
        return 0;
      })
      .finally(() => {
        this.running = undefined;
        if (this.again) {
          this.again = false;
          this.kick();
        }
      });
  }

  /** Waits for the current dispatch (tests). */
  async idle() {
    while (this.running) await this.running;
  }

  /** Sends every unpushed notification; returns how many pushes went out. */
  async dispatchPending(): Promise<number> {
    let sent = 0;
    for (;;) {
      const batch = await this.db.tx(async (client) => {
        const { rows } = await client.query<Pending>(
          // notifications.id, not id: `id::text` is an output column also called "id", and a bare
          // ORDER BY binds to that — sorting the backlog as text ('10' before '9') and throwing away
          // the index order, so every batch read and sorted every unpushed row to take the first 100.
          `SELECT id::text, user_id, app, kind, title, body, data FROM notifications
            WHERE pushed_at IS NULL AND created_at > now() - interval '${MAX_AGE}'
            ORDER BY notifications.id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
        );
        if (rows.length) await client.query('UPDATE notifications SET pushed_at = now() WHERE id = ANY($1::bigint[])', [rows.map((r) => r.id)]);
        return rows;
      });
      for (const n of batch) sent += await this.deliver(n);
      if (batch.length < BATCH) return sent;
    }
  }

  private async deliver(n: Pending): Promise<number> {
    const { rows: devices } = await this.db.query<{ fcm_token: string }>(
      `SELECT fcm_token FROM device_tokens WHERE user_id = $1 AND ($2::text IS NULL OR app = $2)`,
      [n.user_id, n.app],
    );
    let sent = 0;
    for (const d of devices) {
      const result = await this.sender.send(d.fcm_token, {
        title: n.title,
        body: n.body,
        channel: n.kind === 'chat_message' ? 'chat' : 'bookings',
        data: stringData({ ...n.data, kind: n.kind, notificationId: n.id }),
      });
      if (result === 'ok') sent++;
      if (result === 'invalid_token') await this.db.query('DELETE FROM device_tokens WHERE fcm_token = $1', [d.fcm_token]);
    }
    return sent;
  }
}

/** FCM data payloads are string → string. */
function stringData(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  );
}
