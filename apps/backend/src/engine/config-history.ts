// Every change to what customers book on a service (price, rules, questions, plans, event types) is
// kept with a version number, whoever made it: the vendor in the Partner app, or an admin.
import type { Queryable } from '../db/db.service';

/** JSON with object keys sorted, so a value read back from jsonb compares equal to the one saved. */
export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Settings kept in service_config_history (column → name in the API). */
export const TRACKED = { pricing: 'pricing', rules: 'rules', questions: 'questions', plans: 'plans', event_types: 'eventTypes', is_active: 'active' } as const;
export type Tracked = keyof typeof TRACKED;

/**
 * Compares the new settings with the row as it is (locked by the caller) and, if anything changed, raises
 * the version and keeps the before / after of the settings that changed. `next` holds only what is saved.
 */
export async function recordConfigChange(
  q: Queryable,
  serviceId: string,
  changedBy: string | null,
  current: Partial<Record<Tracked, unknown>> & { config_version: number },
  next: Partial<Record<Tracked, unknown>>,
  note?: string,
): Promise<number> {
  const changes: Record<string, unknown> = {};
  for (const [col, name] of Object.entries(TRACKED) as [Tracked, string][]) {
    const after = next[col];
    if (after !== undefined && canonical(after) !== canonical(current[col])) changes[name] = { before: current[col], after };
  }
  if (!Object.keys(changes).length) return current.config_version;
  if (note) changes.note = note;
  const version = current.config_version + 1;
  await q.query(`UPDATE services SET config_version = $2 WHERE id = $1`, [serviceId, version]);
  await q.query(`INSERT INTO service_config_history (service_id, version, changed_by, changes) VALUES ($1, $2, $3, $4)`, [serviceId, version, changedBy, changes]);
  return version;
}
