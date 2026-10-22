import i18n, { setLanguage } from './index';
import en from './en.json';
import hi from './hi.json';

// Node built-ins, typed here because the app does not ship @types/node.
const fs: {
  readdirSync(p: string, o: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  readFileSync(p: string, encoding: 'utf8'): string;
} = jest.requireActual('fs');
const path: { join(...parts: string[]): string } = jest.requireActual('path');
const SRC = path.join(process.cwd(), 'src');

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const enKeys = flatten(en);
const hiKeys = flatten(hi);
const placeholders = (s: string) => (s.match(/{{\s*\w+\s*}}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

describe('translations', () => {
  test('every English key exists in Hindi', () => {
    expect(Object.keys(enKeys).filter((k) => !(k in hiKeys))).toEqual([]);
  });

  test('every Hindi key exists in English', () => {
    expect(Object.keys(hiKeys).filter((k) => !(k in enKeys))).toEqual([]);
  });

  test('no empty strings', () => {
    expect(Object.entries({ ...enKeys }).filter(([, v]) => !v.trim())).toEqual([]);
    expect(Object.entries({ ...hiKeys }).filter(([, v]) => !v.trim())).toEqual([]);
  });

  test('both languages use the same {{placeholders}}', () => {
    const mismatched = Object.keys(enKeys).filter((k) => placeholders(enKeys[k]).join() !== placeholders(hiKeys[k] ?? '').join());
    expect(mismatched).toEqual([]);
  });

  test('Hindi text is written in Devanagari', () => {
    // Brand names, numbers and the "English" option may stay in Latin script.
    const allowedLatin = new Set(['search.rating4', 'language.english', 'language.subtitle', 'language.noteOther', 'book.priceTimes', 'slots.day.hours', 'slots.night.hours', 'payment.methods.upi']);
    const latinOnly = Object.entries(hiKeys).filter(([k, v]) => !allowedLatin.has(k) && !/[ऀ-ॿ]/.test(v));
    expect(latinOnly).toEqual([]);
  });

  test('every literal t() key in the source exists in en.json', () => {
    const files: string[] = [];
    const walk = (dir: string) =>
      fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(d.name) && !/\.test\./.test(d.name)) files.push(p);
      });
    walk(SRC);
    const used = new Set<string>();
    for (const f of files) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
    }
    const exists = (k: string) => k in enKeys || `${k}_one` in enKeys;
    expect([...used].filter((k) => !exists(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(200);
  });

  test('switching language changes text, plurals work in both', async () => {
    await setLanguage('en');
    expect(i18n.t('tabs.home')).toBe('Home');
    expect(i18n.t('events.daysToGo', { count: 1 })).toBe('1 day to go');
    expect(i18n.t('events.daysToGo', { count: 5 })).toBe('5 days to go');
    await setLanguage('hi');
    expect(i18n.t('tabs.home')).toBe('होम');
    expect(i18n.t('chat.unread', { count: 3 })).toBe('3 नए मैसेज');
    await setLanguage('en');
  });
});
