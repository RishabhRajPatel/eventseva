import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { AppConfig, CONFIG } from '../config';

// Postgres `date` stays a plain 'YYYY-MM-DD' string. Turning it into a JS Date would shift it
// by the server's time zone, and an event day must never move.
types.setTypeParser(types.builtins.DATE, (v) => v);

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
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
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
