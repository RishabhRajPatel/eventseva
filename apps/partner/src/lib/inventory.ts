// Rental items (tent, furniture, utensils …): server reads as React Query hooks, the keys mutations
// invalidate, and the small pure helpers the screens share.
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { InventoryItem, ItemCategory, ItemCondition, ItemQuality, Language, RentalSettings, RentalView, StockMovement } from '@eventseva/app-shared';
import { api } from './api';
import { STALE } from './queries';

export const UNITS = ['piece', 'set', 'pair', 'dozen'] as const;
export const QUALITIES: ItemQuality[] = ['basic', 'standard', 'premium', 'custom'];
export const CONDITIONS: ItemCondition[] = ['new', 'good', 'used', 'needs_repair'];

export const inventoryKeys = {
  all: ['inventory'] as const,
  list: (q: string, categoryId: string | null) => ['inventory', 'list', q, categoryId] as const,
  item: (id: string) => ['inventory', 'item', id] as const,
  movements: (id: string) => ['inventory', 'movements', id] as const,
  categories: ['inventory', 'categories'] as const,
  settings: ['inventory', 'settings'] as const,
  rental: (bookingId: string) => ['rental', bookingId] as const,
};

export function useInventory(q: string, categoryId: string | null) {
  return useQuery({
    queryKey: inventoryKeys.list(q, categoryId),
    queryFn: async () =>
      (await api.get<{ items: InventoryItem[] }>('/v1/partner/inventory', { ...(q.trim() ? { q: q.trim() } : {}), ...(categoryId ? { categoryId } : {}) })).items,
    staleTime: STALE.list,
    placeholderData: (prev) => prev,
  });
}

export function useInventoryItem(id: string | null) {
  return useQuery({
    queryKey: inventoryKeys.item(id ?? 'new'),
    queryFn: () => api.get<InventoryItem>(`/v1/partner/inventory/${id}`),
    enabled: !!id,
    staleTime: STALE.list,
  });
}

export function useMovements(id: string | null) {
  return useQuery({
    queryKey: inventoryKeys.movements(id ?? 'new'),
    queryFn: async () => (await api.get<{ items: StockMovement[] }>(`/v1/partner/inventory/${id}/movements`)).items,
    enabled: !!id,
    staleTime: STALE.list,
  });
}

export function useItemCategories() {
  return useQuery({
    queryKey: inventoryKeys.categories,
    queryFn: async () => (await api.get<{ items: ItemCategory[] }>('/v1/partner/item-categories')).items,
    staleTime: STALE.profile,
  });
}

export function useRentalSettings() {
  return useQuery({ queryKey: inventoryKeys.settings, queryFn: () => api.get<RentalSettings>('/v1/partner/rental-settings'), staleTime: STALE.profile });
}

export function useRental(bookingId: string, enabled = true) {
  return useQuery({
    queryKey: inventoryKeys.rental(bookingId),
    queryFn: () => api.get<RentalView>(`/v1/partner/bookings/${bookingId}/rental`),
    enabled,
    staleTime: STALE.list,
  });
}

export function invalidateInventory(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: inventoryKeys.all });
  void qc.invalidateQueries({ queryKey: ['vendor'] });
}

// ---------- labels ----------

export const categoryName = (c: Pick<ItemCategory, 'nameEn' | 'nameHi'>, lang: Language) => (lang === 'hi' ? c.nameHi : c.nameEn);

/** Known units are translated; the vendor's own word is shown as typed. */
export const itemUnit = (t: TFunction, unit: string) => ((UNITS as readonly string[]).includes(unit) ? t(`inventory.units.${unit}`) : unit);

export const qualityLabel = (t: TFunction, item: { quality: ItemQuality; qualityLabel: string | null }) =>
  item.quality === 'custom' && item.qualityLabel ? item.qualityLabel : t(`inventory.quality.${item.quality}`);

/** "₹10 / piece" or "₹400 / piece / day". */
export const priceLabel = (t: TFunction, rupeesText: string, item: { unit: string; rentPer: 'booking' | 'day' }) =>
  item.rentPer === 'day' ? t('inventory.pricePerDay', { price: rupeesText, unit: itemUnit(t, item.unit) }) : t('inventory.pricePer', { price: rupeesText, unit: itemUnit(t, item.unit) });

/** Whole-number text box → number, or null when empty / not a number. */
export function intOrNull(text: string): number | null {
  const v = text.replace(/\D/g, '');
  return v ? Number(v) : null;
}

/** What the form checks before sending (the server checks again). */
export function checkStock(total: number | null, repair: number | null, min: number | null, max: number | null, minDays: number | null, maxDays: number | null) {
  return {
    total: total === null ? 'required' : null,
    repair: repair !== null && total !== null && repair > total ? 'repairTooMany' : null,
    qty: min !== null && max !== null && max < min ? 'maxBelowMin' : null,
    days: minDays !== null && maxDays !== null && maxDays < minDays ? 'maxBelowMin' : minDays !== null && (minDays < 1 || minDays > 60) ? 'daysRange' : null,
  };
}

/** Where a rental booking is, in the vendor's next step. */
export type RentalStep = 'prepare' | 'dispatch' | 'deliver' | 'return' | 'verify' | 'done';
export function nextStep(fulfilment: RentalView['fulfilment'], counted: boolean): RentalStep {
  switch (fulfilment) {
    case 'scheduled':
      return 'prepare';
    case 'preparing':
      return 'dispatch';
    case 'dispatched':
      return 'deliver';
    case 'delivered':
      return 'return';
    case 'return_pending':
      return counted ? 'verify' : 'return';
    default:
      return 'done';
  }
}
