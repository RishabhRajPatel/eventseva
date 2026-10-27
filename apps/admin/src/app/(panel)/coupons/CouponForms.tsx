'use client';
import { useState, type FormEvent } from 'react';
import { rupees } from '@eventseva/app-shared';
import { Button } from '@/components/Button';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { useShell } from '@/components/ShellContext';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import type { AdminCoupon, PublicCategory } from '@/lib/admin-types';
import {
  cleanCode,
  couponBody,
  couponEditBody,
  couponEditErrors,
  couponFormErrors,
  couponSummary,
  EMPTY_COUPON,
  istDay,
  type CouponEditForm,
  type CouponForm,
} from '@/lib/coupons';
import { describeError } from '@/lib/errors';

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' } as const;

export function CreateCoupon({ categories, categoriesFailed, onSaved }: { categories: PublicCategory[]; categoriesFailed: boolean; onSaved: () => void }) {
  const { toast } = useShell();
  const [form, setForm] = useState<CouponForm>(EMPTY_COUPON);
  const { setTried, onBlur, show, reset } = useFormErrors();
  const [saving, run] = useBusy();
  const errors = couponFormErrors(form);
  // Field ids match the error keys' inputs below.
  const err = (k: keyof CouponForm, id: string) => (show(id) ? errors[k] : undefined);
  const set = (patch: Partial<CouponForm>) => setForm((f) => ({ ...f, ...patch }));
  const percent = form.discountType === 'percent';

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      focusFirstError(e.currentTarget);
      return;
    }
    void run(async () => {
      try {
        const created = await api.post<AdminCoupon>('/v1/admin/coupons', couponBody(form));
        toast.success(`Coupon ${created.code} created.${form.isPublic ? ' It shows in the app offers.' : ''}`);
        setForm(EMPTY_COUPON);
        reset();
        onSaved();
      } catch (error) {
        toast.error(describeError(error));
      }
    });
  }

  return (
    <form id="coupon-form" className="box stack" onSubmit={save} onBlur={onBlur} noValidate aria-labelledby="coupon-form-title" style={{ scrollMarginTop: '5rem' }}>
      <h2 id="coupon-form-title">Create a coupon</h2>
      <div style={grid}>
        <FormField id="c-code" label="Code" error={err('code', 'c-code')} hint="3–20 capital letters or digits.">
          <input className="input mono" value={form.code} placeholder="SHAADI10" onChange={(e) => set({ code: cleanCode(e.target.value) })} autoComplete="off" />
        </FormField>
        <FormField id="c-en" label="Title in English" error={err('titleEn', 'c-en')}>
          <input className="input" maxLength={80} value={form.titleEn} placeholder="10% off your wedding booking" onChange={(e) => set({ titleEn: e.target.value })} />
        </FormField>
        <FormField id="c-hi" label="Title in Hindi" error={err('titleHi', 'c-hi')}>
          <input className="input" lang="hi" maxLength={80} value={form.titleHi} placeholder="शादी की बुकिंग पर 10% छूट" onChange={(e) => set({ titleHi: e.target.value })} />
        </FormField>
      </div>
      <div style={grid}>
        <FormField id="c-type" label="Discount type">
          <select className="select" value={form.discountType} onChange={(e) => set({ discountType: e.target.value as CouponForm['discountType'] })}>
            <option value="percent">Percent off</option>
            <option value="flat">Flat amount off</option>
          </select>
        </FormField>
        <FormField id="c-value" label={percent ? 'Percent (1–100)' : 'Amount off (₹)'} error={err('value', 'c-value')}>
          <input className="input" inputMode={percent ? 'numeric' : 'decimal'} value={form.value} placeholder={percent ? '10' : '300'} onChange={(e) => set({ value: e.target.value })} />
        </FormField>
        {percent ? (
          <FormField id="c-max" label="Max discount (₹, optional)" error={err('maxDiscount', 'c-max')} hint="Empty = no cap.">
            <input className="input" inputMode="decimal" value={form.maxDiscount} placeholder="500" onChange={(e) => set({ maxDiscount: e.target.value })} />
          </FormField>
        ) : null}
        <FormField id="c-min" label="Min. booking amount (₹, optional)" error={err('minAmount', 'c-min')}>
          <input className="input" inputMode="decimal" value={form.minAmount} placeholder="2000" onChange={(e) => set({ minAmount: e.target.value })} />
        </FormField>
        <FormField id="c-cat" label="Category" hint={categoriesFailed ? 'Could not load categories; the coupon will work for all.' : undefined}>
          <select className="select" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div style={grid}>
        <FormField id="c-uses" label="Max uses in total (optional)" error={err('maxUses', 'c-uses')} hint="Empty = unlimited.">
          <input className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />
        </FormField>
        <FormField id="c-per" label="Uses per customer" error={err('perCustomerLimit', 'c-per')}>
          <input className="input" inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set({ perCustomerLimit: e.target.value })} />
        </FormField>
        <FormField id="c-from" label="Valid from (optional)" hint="Empty = from now.">
          <input type="date" className="input" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
        </FormField>
        <FormField id="c-until" label="Valid until (optional)" error={err('validUntil', 'c-until')} hint="Includes that whole day. Empty = no end.">
          <input type="date" className="input" value={form.validUntil} min={form.validFrom || undefined} onChange={(e) => set({ validUntil: e.target.value })} />
        </FormField>
      </div>
      <div className="btn-row">
        <label className="checkbox toggle">
          <input type="checkbox" checked={form.firstBookingOnly} onChange={(e) => set({ firstBookingOnly: e.target.checked })} />
          First booking only
        </label>
        <label className="checkbox toggle">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set({ isPublic: e.target.checked })} />
          Show in app (offers list)
        </label>
      </div>
      <div className="btn-row">
        <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Creating…">
          Create coupon
        </Button>
        <span className="small muted">EventSeva pays the discount; vendor payouts don’t change.</span>
      </div>
    </form>
  );
}

export function EditCoupon({ coupon: c, onClose, onSaved }: { coupon: AdminCoupon; onClose: () => void; onSaved: () => void }) {
  const { toast } = useShell();
  const [form, setForm] = useState<CouponEditForm>({
    titleEn: c.titleEn,
    titleHi: c.titleHi,
    isActive: c.isActive,
    isPublic: c.isPublic,
    maxUses: c.maxUses ? String(c.maxUses) : '',
    validUntil: c.validUntil ? istDay(c.validUntil) : '',
  });
  const { setTried, onBlur, show } = useFormErrors();
  const [saving, run] = useBusy();
  const errors = couponEditErrors(form);
  const set = (patch: Partial<CouponEditForm>) => setForm((f) => ({ ...f, ...patch }));

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      focusFirstError(e.currentTarget);
      return;
    }
    void run(async () => {
      try {
        await api.patch(`/v1/admin/coupons/${c.id}`, couponEditBody(form));
        toast.success(`Coupon ${c.code} updated.`);
        onClose();
        onSaved();
      } catch (error) {
        toast.error(describeError(error));
      }
    });
  }

  return (
    <form id="coupon-form" className="box stack" onSubmit={save} onBlur={onBlur} noValidate aria-labelledby="coupon-form-title" style={{ scrollMarginTop: '5rem' }}>
      <h2 id="coupon-form-title">
        Edit <span className="mono">{c.code}</span> · {couponSummary(c, rupees)}
      </h2>
      <div style={grid}>
        <FormField id="e-en" label="Title in English" error={show('e-en') ? errors.titleEn : undefined}>
          <input className="input" maxLength={80} value={form.titleEn} onChange={(e) => set({ titleEn: e.target.value })} />
        </FormField>
        <FormField id="e-hi" label="Title in Hindi" error={show('e-hi') ? errors.titleHi : undefined}>
          <input className="input" lang="hi" maxLength={80} value={form.titleHi} onChange={(e) => set({ titleHi: e.target.value })} />
        </FormField>
        <FormField
          id="e-uses"
          label="Max uses in total"
          error={show('e-uses') ? errors.maxUses : undefined}
          hint={c.maxUses ? 'Can be raised or lowered, not removed.' : 'Empty = unlimited.'}
        >
          <input className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />
        </FormField>
        <FormField id="e-until" label="Valid until" hint="Includes that whole day.">
          <input type="date" className="input" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
        </FormField>
      </div>
      <div className="btn-row">
        <label className="checkbox toggle">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
        <label className="checkbox toggle">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set({ isPublic: e.target.checked })} />
          Show in app (offers list)
        </label>
      </div>
      <div className="btn-row">
        <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
          Save changes
        </Button>
        <button type="button" className="btn" onClick={onClose} disabled={saving}>
          Cancel editing
        </button>
      </div>
    </form>
  );
}
