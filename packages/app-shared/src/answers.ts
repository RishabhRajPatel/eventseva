// The customer's answers to a booking's questions, as lines both apps show on the booking. Questions
// come from the booking (as they were when answered), so later edits by the vendor do not change them.
import type { Bilingual, Booking, Language } from './types';

export interface AnswerLine {
  key: string;
  label: string;
  value: string;
  /** A photo or PDF the customer attached: open it through …/answer-files/:key (a 10-minute link). */
  file?: boolean;
}

/** Answers kept with the booking that are not questions (worked out by the server). */
const INTERNAL = new Set(['mode', 'estKm', 'avgSpeedKmph']);

const pick = (b: Bilingual, lang: Language) => (lang === 'hi' ? b.hi : b.en);

/** One readable line per answered question, in the order the questions were asked. */
export function answerLines(b: Pick<Booking, 'questions' | 'answers'>, lang: Language, yesNo: { yes: string; no: string }): AnswerLine[] {
  const answers = b.answers ?? {};
  const out: AnswerLine[] = [];
  for (const q of b.questions ?? []) {
    const v = answers[q.key];
    if (v === undefined || v === null || v === '' || INTERNAL.has(q.key)) continue;
    if (typeof v === 'object' && !Array.isArray(v) && 'publicId' in (v as object)) {
      out.push({ key: q.key, label: pick(q.label, lang), value: String((v as { format?: string }).format ?? '').toUpperCase(), file: true });
      continue;
    }
    const one = (x: unknown) => {
      if (typeof x === 'boolean') return x ? yesNo.yes : yesNo.no;
      const o = q.options?.find((opt) => opt.value === x);
      return o ? pick(o.label, lang) : String(x);
    };
    const value = Array.isArray(v) ? v.map(one).join(', ') : one(v);
    if (value) out.push({ key: q.key, label: pick(q.label, lang), value });
  }
  return out;
}
