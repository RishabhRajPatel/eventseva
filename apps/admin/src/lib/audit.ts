// Audit log display: what changed between `before` and `after`, and where the target lives.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface DiffRow {
  key: string;
  before: string | undefined;
  after: string | undefined;
  changed: boolean;
}

const show = (v: unknown) => (v === undefined ? undefined : JSON.stringify(v, null, 2));

/**
 * One row per top-level key of either side, in first-seen order; `changed` when the values
 * differ (deep, by JSON). A side that is not an object is shown as a single "value" row.
 */
export function auditDiff(before: unknown, after: unknown): DiffRow[] {
  if (!isObject(before) && !isObject(after)) {
    if (before === null && after === null) return [];
    const b = show(before ?? undefined);
    const a = show(after ?? undefined);
    return [{ key: 'value', before: b, after: a, changed: b !== a }];
  }
  const b = isObject(before) ? before : {};
  const a = isObject(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.map((key) => {
    const before = show(b[key]);
    const after = show(a[key]);
    return { key, before, after, changed: before !== after };
  });
}

export const changedKeys = (before: unknown, after: unknown) => auditDiff(before, after).filter((r) => r.changed).map((r) => r.key);

/** Admin page for a target, or null when there is none. */
export function auditTargetHref(targetType: string, targetId: string | null): string | null {
  if (!targetId) return null;
  if (targetType === 'vendor') return `/vendors/${encodeURIComponent(targetId)}`;
  if (targetType === 'booking') return `/bookings/${encodeURIComponent(targetId)}`;
  return null;
}
