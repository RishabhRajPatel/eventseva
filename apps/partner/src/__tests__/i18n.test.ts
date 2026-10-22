import en from '../i18n/en.json';
import hi from '../i18n/hi.json';

type Tree = { [k: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((out, [k, v]) => {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
    return out;
  }, {});
}

const EN = flatten(en as Tree);
const HI = flatten(hi as Tree);
const vars = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('every English key exists in Hindi', () => {
    expect(Object.keys(EN).filter((k) => !(k in HI))).toEqual([]);
  });

  it('every Hindi key exists in English', () => {
    expect(Object.keys(HI).filter((k) => !(k in EN))).toEqual([]);
  });

  it('uses the same {{placeholders}} in both languages', () => {
    const mismatched = Object.keys(EN).filter((k) => vars(EN[k]).join() !== vars(HI[k] ?? '').join());
    expect(mismatched).toEqual([]);
  });

  it('has no empty strings', () => {
    expect(Object.entries({ ...EN, ...HI }).filter(([, v]) => !v.trim())).toEqual([]);
  });

  it('Hindi copy is actually written in Devanagari', () => {
    const devanagari = Object.values(HI).filter((v) => /[ऀ-ॿ]/.test(v)).length;
    expect(devanagari / Object.keys(HI).length).toBeGreaterThan(0.9);
  });
});
