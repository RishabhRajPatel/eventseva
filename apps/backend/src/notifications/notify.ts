import type { Language } from '@eventseva/core';
import { Queryable } from '../db/db.service';

export type Notice = Record<Language, { title: string; body: string }>;

/**
 * Saves an in-app notification in the user's own language. Push (FCM) will read from this
 * same table later, so every notice goes through here.
 */
export async function notify(q: Queryable, userId: string, kind: string, notice: Notice, data: Record<string, unknown> = {}) {
  await q.query(
    `INSERT INTO notifications (user_id, kind, title, body, data)
     SELECT id, $2, CASE WHEN language = 'hi' THEN $3 ELSE $4 END, CASE WHEN language = 'hi' THEN $5 ELSE $6 END, $7
       FROM users WHERE id = $1`,
    [userId, kind, notice.hi.title, notice.en.title, notice.hi.body, notice.en.body, data],
  );
}
