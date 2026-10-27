// Holding what a booking needs, safely under concurrent requests:
// - exclusive resources (a car, a driver, a hall, an artist): a reservations row; the database's
//   exclusion constraint refuses an overlapping live one, so two transactions can never both win;
// - quantities (plates, chairs, workers, daily guests): capacity_holds under a transaction advisory lock
//   on the pool, after counting every live hold that overlaps in time.
// A hold expires on its own (expires_at); it is never trusted past that, even before the sweep marks it.
import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors';
import type { Queryable } from '../db/db.service';
import type { Need } from './types';

const range = (from: Date, until: Date) => `[${from.toISOString()},${until.toISOString()})`;

/** A live hold or reservation: active, or a hold whose time has not run out. */
const LIVE = `(status = 'active' OR (status = 'hold' AND expires_at > now()))`;

export interface Holding {
  bookingId: string;
  vendorId: string;
  from: Date;
  until: Date;
  status: 'hold' | 'active';
  expiresAt: Date | null;
}

export class Unavailable extends AppError {
  constructor(label: string, details: Record<string, unknown> = {}) {
    super('NOT_AVAILABLE', `Not available for these times: ${label}.`, HttpStatus.CONFLICT, { what: label, ...details });
  }
}

export async function holdResource(q: Queryable, resourceId: string, label: string, h: Holding) {
  // Holds that ran out stop blocking at once (the constraint only looks at the status column).
  await q.query(`UPDATE reservations SET status = 'expired' WHERE resource_id = $1 AND status = 'hold' AND expires_at <= now()`, [resourceId]);
  try {
    await q.query('SAVEPOINT hold_resource');
    await q.query(
      `INSERT INTO reservations (resource_id, booking_id, period, status, expires_at) VALUES ($1, $2, $3::tstzrange, $4, $5)`,
      [resourceId, h.bookingId, range(h.from, h.until), h.status, h.expiresAt],
    );
    await q.query('RELEASE SAVEPOINT hold_resource');
  } catch (err) {
    await q.query('ROLLBACK TO SAVEPOINT hold_resource');
    if ((err as { code?: string }).code === '23P01') throw new Unavailable(label);
    throw err;
  }
}

/** Overlaps the range, or is stock still out (dispatched, not yet checked back in) since before its end. */
const OVERLAPS = `(period && $2::tstzrange OR (until_returned AND lower(period) < upper($2::tstzrange)))`;

/**
 * How much of a pool is taken in a time range: live holds, active bookings, the vendor's own blocks and
 * stock not yet returned. Holds overlapping the range are added up even if they do not overlap each
 * other, so the answer can be cautious, never too generous.
 */
export async function poolUsed(q: Queryable, poolKey: string, from: Date, until: Date, exceptBooking?: string): Promise<number> {
  const r = await q.query<{ used: number }>(
    `SELECT COALESCE(sum(qty), 0)::int AS used FROM capacity_holds
      WHERE pool_key = $1 AND ${OVERLAPS} AND ${LIVE} AND ($3::uuid IS NULL OR booking_id IS DISTINCT FROM $3)`,
    [poolKey, range(from, until), exceptBooking ?? null],
  );
  return r.rows[0].used;
}

/** The most of a pool taken at any one moment from `from` on (a peak always starts where some hold starts). */
export async function peakUsed(q: Queryable, poolKey: string, from: Date): Promise<number> {
  const r = await q.query<{ peak: number }>(
    `WITH h AS (SELECT qty, period, until_returned FROM capacity_holds WHERE pool_key = $1 AND ${LIVE} AND (upper(period) > $2 OR until_returned))
     SELECT COALESCE(max((SELECT sum(h2.qty) FROM h h2 WHERE h2.period @> p.t OR (h2.until_returned AND lower(h2.period) <= p.t))), 0)::int AS peak
       FROM (SELECT greatest(lower(period), $2) AS t FROM h) p`,
    [poolKey, from],
  );
  return r.rows[0].peak;
}

export const lockPool = (q: Queryable, poolKey: string) => q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [poolKey]);

export async function holdPool(q: Queryable, need: Extract<Need, { kind: 'pool' }>, h: Holding) {
  const [from, until] = need.period ?? [h.from, h.until];
  // One transaction at a time per pool: count, then insert, with nobody slipping in between.
  await lockPool(q, need.poolKey);
  const used = await poolUsed(q, need.poolKey, from, until, h.bookingId);
  if (used + need.qty > need.total) throw new Unavailable(need.label, { available: Math.max(0, need.total - used), requested: need.qty });
  await q.query(
    `INSERT INTO capacity_holds (pool_key, vendor_id, booking_id, qty, period, status, expires_at) VALUES ($1, $2, $3, $4, $5::tstzrange, $6, $7)`,
    [need.poolKey, h.vendorId, h.bookingId, need.qty, range(from, until), h.status, h.expiresAt],
  );
}

/** Read-only check for quotes: would everything be free right now? (The request enforces it for real.) */
export async function checkAll(q: Queryable, needs: Need[], from: Date, until: Date) {
  for (const n of needs) {
    if (n.kind === 'resource') {
      const taken = await q.query(
        `SELECT 1 FROM reservations WHERE resource_id = $1 AND period && $2::tstzrange AND ${LIVE} LIMIT 1`,
        [n.resourceId, range(from, until)],
      );
      if (taken.rowCount) throw new Unavailable(n.label);
    } else {
      const [f, u] = n.period ?? [from, until];
      const used = await poolUsed(q, n.poolKey, f, u);
      if (used + n.qty > n.total) throw new Unavailable(n.label, { available: Math.max(0, n.total - used), requested: n.qty });
    }
  }
}

/** Takes everything a booking needs, or nothing (the caller's transaction rolls back on Unavailable). */
export async function holdAll(q: Queryable, needs: Need[], h: Holding) {
  // A stable order avoids two bookings locking the same two pools in opposite order.
  const sorted = [...needs].sort((a, b) => (a.kind === b.kind ? key(a).localeCompare(key(b)) : a.kind === 'resource' ? -1 : 1));
  for (const n of sorted) {
    if (n.kind === 'resource') await holdResource(q, n.resourceId, n.label, h);
    else await holdPool(q, n, h);
  }
}
const key = (n: Need) => (n.kind === 'resource' ? n.resourceId : n.poolKey);

/**
 * Accept: keep the holds until the new deadline. Payment: make them active. If a hold ran out in
 * between (the customer paid late), everything is taken again; if someone else got it, Unavailable.
 */
export async function renewAll(q: Queryable, needs: Need[], h: Holding) {
  const live = await q.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM reservations WHERE booking_id = $1 AND ${LIVE})::int
          + (SELECT count(*) FROM capacity_holds WHERE booking_id = $1 AND ${LIVE})::int AS n`,
    [h.bookingId],
  );
  if (live.rows[0].n === needs.length) {
    await q.query(`UPDATE reservations SET status = $2, expires_at = $3 WHERE booking_id = $1 AND ${LIVE}`, [h.bookingId, h.status, h.expiresAt]);
    await q.query(`UPDATE capacity_holds SET status = $2, expires_at = $3 WHERE booking_id = $1 AND ${LIVE}`, [h.bookingId, h.status, h.expiresAt]);
    return;
  }
  await releaseAll(q, h.bookingId);
  await holdAll(q, needs, h);
}

export async function releaseAll(q: Queryable, bookingId: string) {
  await q.query(`UPDATE reservations SET status = 'released' WHERE booking_id = $1 AND status IN ('hold', 'active')`, [bookingId]);
  await q.query(`UPDATE capacity_holds SET status = 'released' WHERE booking_id = $1 AND status IN ('hold', 'active')`, [bookingId]);
}

/** Moves a booking's live holds to a new time range (extension / reschedule) or fails without changing anything. */
export async function moveAll(q: Queryable, needs: Need[], h: Holding) {
  await q.query('SAVEPOINT move_holds');
  try {
    await releaseAll(q, h.bookingId);
    await holdAll(q, needs, h);
    await q.query('RELEASE SAVEPOINT move_holds');
  } catch (err) {
    await q.query('ROLLBACK TO SAVEPOINT move_holds');
    throw err;
  }
}
