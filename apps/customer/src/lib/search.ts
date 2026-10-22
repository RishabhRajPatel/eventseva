// Matching typed words to a category. The API only filters by category, so text that names a
// service ("cook", "हलवाई", "photographer") picks that category; other text filters by name.
import type { Category, VendorCard } from '@eventseva/app-shared';

const ALIASES: Record<string, string[]> = {
  hall: ['hall', 'banquet', 'venue', 'lawn', 'marriage hall', 'हॉल', 'मैरिज हॉल', 'बैंक्वेट'],
  dj: ['dj', 'sound', 'music', 'डीजे', 'साउंड'],
  camera: ['camera', 'photo', 'photographer', 'video', 'videographer', 'कैमरा', 'फ़ोटो', 'फोटो', 'वीडियो'],
  halwai: ['cook', 'halwai', 'chef', 'हलवाई', 'रसोइया'],
  catering: ['catering', 'caterer', 'food', 'कैटरिंग', 'खाना'],
  band: ['band', 'dhol', 'baja', 'बैंड', 'ढोल', 'बाजा'],
  car: ['car', 'travel', 'taxi', 'bus', 'कार', 'गाड़ी', 'ट्रैवल'],
  decor: ['decor', 'decoration', 'tent', 'flower', 'lights', 'सजावट', 'टेंट', 'फूल'],
  hotel: ['hotel', 'room', 'rooms', 'stay', 'होटल', 'कमरा'],
  bartender: ['bartender', 'bar', 'drinks', 'बारटेंडर', 'ड्रिंक्स'],
  makeup: ['makeup', 'make up', 'mehendi', 'mehndi', 'beautician', 'मेकअप', 'मेहंदी', 'ब्यूटीशियन'],
  other: ['pandit', 'priest', 'anchor', 'पंडित', 'एंकर'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The category slug that the text names, or null. */
export function matchCategory(text: string, categories: Pick<Category, 'slug' | 'name'>[]): string | null {
  const q = norm(text);
  if (q.length < 2) return null;
  for (const cat of categories) {
    if (norm(cat.name) === q || norm(cat.name).startsWith(q)) return cat.slug;
  }
  for (const [slug, words] of Object.entries(ALIASES)) {
    if (words.some((w) => w === q || (q.length >= 3 && w.startsWith(q)))) return slug;
  }
  return null;
}

export const BUDGETS = [500_000, 2_500_000, 10_000_000] as const; // ₹5,000 · ₹25,000 · ₹1,00,000 (paise)
export type SortOrder = 'popular' | 'priceLow' | 'rating';

export interface Filters {
  text: string;
  minRating: boolean;
  maxPricePaise: number | null;
  sort: SortOrder;
}

/** Filters the server cannot do yet (name, rating, budget, sort) applied to the loaded vendors. */
export function applyFilters(items: VendorCard[], f: Filters, textIsCategory: boolean): VendorCard[] {
  const q = norm(f.text);
  let out = items.filter((v) => {
    if (q && !textIsCategory && !`${v.businessName} ${v.area ?? ''} ${v.category.name}`.toLowerCase().includes(q)) return false;
    if (f.minRating && !(v.ratingCount > 0 && v.ratingAvg >= 4)) return false;
    if (f.maxPricePaise != null && (v.startingPricePaise == null || v.startingPricePaise > f.maxPricePaise)) return false;
    return true;
  });
  if (f.sort === 'priceLow') out = [...out].sort((a, b) => (a.startingPricePaise ?? Infinity) - (b.startingPricePaise ?? Infinity));
  if (f.sort === 'rating') out = [...out].sort((a, b) => b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount);
  return out;
}
