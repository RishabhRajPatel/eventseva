import type { AppName, Language } from '@eventseva/core';
import { Queryable } from '../db/db.service';

export type Notice = Record<Language, { title: string; body: string }>;

/**
 * Saves an in-app notification in the user's own language. `app` says which app should get the
 * push (a vendor may also use the customer app); leave it out for "whichever app they use".
 * pg_notify wakes the push dispatcher, and Postgres delivers it only when the transaction
 * commits, so a rolled-back action never sends a push.
 */
export async function notify(
  q: Queryable,
  userId: string,
  kind: string,
  notice: Notice,
  data: Record<string, unknown> = {},
  app?: AppName,
) {
  await q.query(
    `WITH n AS (
       INSERT INTO notifications (user_id, kind, title, body, data, app)
       SELECT id, $2, CASE WHEN language = 'hi' THEN $3 ELSE $4 END, CASE WHEN language = 'hi' THEN $5 ELSE $6 END, $7, $8
         FROM users WHERE id = $1
       RETURNING id
     )
     SELECT pg_notify('push', id::text) FROM n`,
    [userId, kind, notice.hi.title, notice.en.title, notice.hi.body, notice.en.body, data, app ?? null],
  );
}
