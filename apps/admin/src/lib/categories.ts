// Category form rules (same limits as the API) and list reordering.

export interface CategoryForm {
  nameEn: string;
  nameHi: string;
  icon: string;
  defaultUnit: string;
}

export function categoryFormErrors(f: CategoryForm): Partial<Record<keyof CategoryForm, string>> {
  const e: Partial<Record<keyof CategoryForm, string>> = {};
  const en = f.nameEn.trim();
  const hi = f.nameHi.trim();
  if (en.length < 2 || en.length > 60) e.nameEn = 'Enter the English name (2–60 characters).';
  if (hi.length < 2 || hi.length > 60) e.nameHi = 'Enter the Hindi name (2–60 characters).';
  else if (!/[ऀ-ॿ]/.test(hi)) e.nameHi = 'Write the Hindi name in Devanagari, e.g. मेहंदी आर्टिस्ट.';
  return e;
}

/** Moves `id` one place up (-1) or down (+1); returns a new array. */
export function moveId(ids: number[], id: number, dir: -1 | 1): number[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
