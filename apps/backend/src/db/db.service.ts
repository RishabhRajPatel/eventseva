import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { AppConfig, CONFIG } from '../config';
import { currentActor, currentRequestId } from './actor';

// Postgres `date` stays a plain 'YYYY-MM-DD' string. Turning it into a JS Date would shift it
// by the server's time zone, and an event day must never move.
types.setTypeParser(types.builtins.DATE, (v) => v);

// `bigint` comes back as a JS number instead of a string, so message and notification ids stay the
// numbers the apps expect. pg hands int8 over as a string because it can out-range a double; these
// are sequence ids, exact well past 2^53 (nine quadrillion) — the ids that were cast to int4 to get
// a number would have failed with "integer out of range" at 2,147,483,647, which is reachable.
// Every sum() and count() in this codebase is already cast, so nothing else changes shape.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Plain SQL access. Values always go through $1, $2 placeholders — never build SQL by
 * joining strings.
 */
@Injectable()
export class Db implements OnModuleDestroy, Queryable {
  private readonly pool: Pool;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      // A runaway query or a transaction left open must not hold connections and locks forever.
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  query<T extends QueryResultRow = any>(text: string, params?: unknown[]) {
    return this.pool.query<T>(text, params);
  }

  async one<T extends QueryResultRow = any>(q: Queryable, text: string, params?: unknown[]): Promise<T | undefined> {
    return (await q.query<T>(text, params)).rows[0];
  }

  /** Runs fn inside BEGIN … COMMIT; rolls back if it throws. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // The booking state history records who made each change (see booking_state_log()).
      const actor = currentActor();
      const requestId = currentRequestId();
      if (actor || requestId) {
        await client.query(
          `SELECT set_config('eventseva.actor_kind', $1, true), set_config('eventseva.actor_id', $2, true), set_config('eventseva.request_id', $3, true)`,
          [actor?.kind ?? '', actor?.id ?? '', requestId ?? ''],
        );
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
