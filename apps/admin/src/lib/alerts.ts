// System alerts (GET /v1/admin/alerts) and the daily OTP SMS budget card on the dashboard.
// The budget protects against SMS-pumping fraud (apps/backend/src/auth/otp.service.ts):
// 80% warns, 100% pauses new sign-ups, 150% stops every login code.
import { humanize, waitingFor } from './labels.ts';

export interface SystemAlert {
  id: number;
  kind: string;
  message: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  /** Email of the admin who resolved it. */
  resolvedBy: string | null;
}

export const SMS_WARN_PERCENT = 80;
export const SMS_FULL_PERCENT = 100;
export const SMS_STOP_PERCENT = 150;

export type BudgetLevel = 'ok' | 'warning' | 'full' | 'stopped';
/** Bar colour: royal while normal, peach from 80%, red from 100%. */
export type BudgetColour = 'royal' | 'peach' | 'red';

export interface SmsBudget {
  used: number;
  perDay: number;
  /** Rounded down, so "100%" only shows once the budget is really used up. */
  percent: number;
  /** Bar width, 0–100. */
  fill: number;
  level: BudgetLevel;
  colour: BudgetColour;
  /** "1,240 / 2,000" */
  text: string;
  /** One sentence for the state, so it is never told by colour alone. */
  status: string;
}

const count = (n: number) => n.toLocaleString('en-IN');

export function smsBudget(used: number, perDay: number): SmsBudget {
  const safeUsed = Math.max(0, Math.floor(used || 0));
  const safePerDay = Math.max(0, Math.floor(perDay || 0));
  const exact = safePerDay > 0 ? (safeUsed * 100) / safePerDay : 0;
  const level: BudgetLevel =
    safePerDay === 0 ? 'ok' : exact >= SMS_STOP_PERCENT ? 'stopped' : exact >= SMS_FULL_PERCENT ? 'full' : exact >= SMS_WARN_PERCENT ? 'warning' : 'ok';
  const colour: BudgetColour = level === 'ok' ? 'royal' : level === 'warning' ? 'peach' : 'red';
  const status: Record<BudgetLevel, string> = {
    ok: 'Normal.',
    warning: `Over ${SMS_WARN_PERCENT}% used. Watch for a burst of new numbers.`,
    full: 'Budget used up. New sign-ups are paused; existing users can still log in.',
    stopped: 'Hard stop. No login codes are being sent to anyone.',
  };
  return {
    used: safeUsed,
    perDay: safePerDay,
    percent: Math.floor(exact),
    fill: Math.min(100, exact),
    level,
    colour,
    text: `${count(safeUsed)} / ${count(safePerDay)}`,
    status: status[level],
  };
}

export type AlertSeverity = 'warning' | 'danger';

export interface AlertGuide {
  title: string;
  severity: AlertSeverity;
  /** What the admin should do, in one or two short sentences. */
  whatToDo: string;
}

const CHECK_USERS = 'Check Admin → Users for many new numbers in the last few hours (SMS-pumping fraud).';
const RAISE_BUDGET = 'If the growth is real, raise OTP_DAILY_SMS_BUDGET in the server .env and restart the API.';

export const ALERT_GUIDES: Record<string, AlertGuide> = {
  sms_budget_warning: {
    title: 'SMS budget at 80%',
    severity: 'warning',
    whatToDo: `${CHECK_USERS} ${RAISE_BUDGET}`,
  },
  sms_budget_reached: {
    title: 'SMS budget used up: new sign-ups paused',
    severity: 'danger',
    whatToDo: `Existing users can still log in. ${CHECK_USERS} ${RAISE_BUDGET}`,
  },
  sms_budget_hard_stop: {
    title: 'All login codes stopped',
    severity: 'danger',
    whatToDo: `Nobody can log in to the apps until the 24-hour count drops. ${CHECK_USERS} ${RAISE_BUDGET}`,
  },
};

/** The guide for an alert kind; a kind added on the backend later still gets a sensible line. */
export function alertGuide(kind: string): AlertGuide {
  return (
    ALERT_GUIDES[kind] ?? {
      title: humanize(kind),
      severity: 'warning',
      whatToDo: 'Read the message, check the API logs, then mark it resolved once it is handled.',
    }
  );
}

/** "5 min ago", "just now", "2 hours ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const text = waitingFor(iso, now);
  return text === 'just now' ? text : `${text} ago`;
}

/** Open alerts, the most serious first, then newest first. */
export function openAlerts(items: SystemAlert[]): SystemAlert[] {
  const rank = (a: SystemAlert) => (alertGuide(a.kind).severity === 'danger' ? 0 : 1);
  return items
    .filter((a) => !a.resolvedAt)
    .sort((a, b) => rank(a) - rank(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
