'use client';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage, formatDateTime, rupees, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { CsvDownload } from '@/components/CsvDownload';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
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
import { pageFrom } from '@/lib/labels';
import { can } from '@/lib/roles';

export function CouponsView() {
  const { session } = useShell();
  const manage = can(session.admin.role, 'coupon.manage');
  const { params, hrefWith } = useUrlState();
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<AdminCoupon>>('/v1/admin/coupons', { page });
  const categories = useApiQuery<{ items: PublicCategory[] }>('/v1/categories', {}, false);
  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [toggle, setToggle] = useState<AdminCoupon | null>(null);

  return (
    <div className="page">
      <PageHead title="Coupons" subtitle="Discount codes customers add before paying the advance. Active first, newest first.">
        <RefreshingHint show={state.refreshing} />
        <CsvDownload kind="coupons" hint="By the date the coupon was created. Dates are optional and inclusive." />
      </PageHead>

      <p className="note">
        <span>
          <b>EventSeva pays the discount; vendor payouts don’t change.</b> The code and the discount are fixed once created, because customers may
          already hold the code. To change them, deactivate the coupon and make a new one.
        </span>
      </p>

      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={page === 1 ? 'No coupons yet' : 'No more coupons'}>{page === 1 ? 'Create the first one below.' : null}</EmptyState>}
        loadingLabel="Loading coupons…"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Discount</th>
                    <th scope="col" className="num">
                      Min. booking
                    </th>
                    <th scope="col">Category</th>
                    <th scope="col">Rules</th>
                    <th scope="col">Valid</th>
                    <th scope="col" className="num">
                      Uses
                    </th>
                    <th scope="col" className="num">
                      Discount given
                    </th>
                    <th scope="col">Active</th>
                    {manage ? <th scope="col">Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} className={c.isActive ? undefined : 'muted'}>
                      <td>
                        <span className="cell-main mono">{c.code}</span>
                        <span className="cell-sub">{c.titleEn}</span>
                        <span className="cell-sub" lang="hi">
                          {c.titleHi}
                        </span>
                      </td>
                      <td className="nowrap">{couponSummary(c, rupees)}</td>
                      <td className="num">{c.minAmountPaise ? rupees(c.minAmountPaise) : '—'}</td>
                      <td>{c.categoryName ?? 'All'}</td>
                      <td>
                        <span className="cell-sub">{c.firstBookingOnly ? 'First booking only' : 'Any booking'}</span>
                        <span className="cell-sub">{c.isPublic ? 'Shown in the app' : 'Hidden (code only)'}</span>
                        <span className="cell-sub">{c.perCustomerLimit === 1 ? 'Once per customer' : `${c.perCustomerLimit}× per customer`}</span>
                      </td>
                      <td className="nowrap">
                        <span className="cell-sub">From {formatDateTime(c.validFrom)}</span>
                        <span className="cell-sub">{c.validUntil ? `Until ${formatDateTime(c.validUntil)}` : 'No end date'}</span>
                      </td>
                      <td className="num nowrap">
                        {c.usedCount}
                        {c.maxUses ? ` / ${c.maxUses}` : ''}
                        {c.heldCount ? <span className="cell-sub">{c.heldCount} held</span> : null}
                      </td>
                      <td className="num">{rupees(c.discountGivenPaise)}</td>
                      <td>{c.isActive ? <span className="pill tone-success">Active</span> : <span className="pill tone-outline">Inactive</span>}</td>
                      {manage ? (
                        <td>
                          <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                            <button
                              type="button"
                              className="btn btn-small btn-outline-royal"
                              onClick={() => {
                                setEditing(c);
                                document.getElementById('coupon-form')?.scrollIntoView({ behavior: 'smooth' });
                              }}
                            >
                              Edit
                            </button>
                            <button type="button" className={`btn btn-small${c.isActive ? '' : ' btn-primary'}`} onClick={() => setToggle(c)}>
                              {c.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>

      {manage ? (
        editing ? (
          <EditCoupon key={editing.id} coupon={editing} onClose={() => setEditing(null)} onSaved={state.reload} />
        ) : (
          <CreateCoupon categories={categories.data?.items ?? []} categoriesFailed={Boolean(categories.error)} onSaved={state.reload} />
        )
      ) : null}

      {toggle ? (
        <ActionDialog
          title={toggle.isActive ? `Deactivate ${toggle.code}?` : `Activate ${toggle.code}?`}
          description={
            toggle.isActive ? (
              <p>Customers can no longer add this code. Bookings that already used it keep their discount.</p>
            ) : (
              <p>Customers can add this code again while it is within its dates and uses.</p>
            )
          }
          confirmLabel={toggle.isActive ? 'Deactivate' : 'Activate'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/coupons/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? `${toggle.code} deactivated.` : `${toggle.code} is active.`}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <span className="inline-error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' } as const;

function CreateCoupon({ categories, categoriesFailed, onSaved }: { categories: PublicCategory[]; categoriesFailed: boolean; onSaved: () => void }) {
  const { toast } = useShell();
  const [form, setForm] = useState<CouponForm>(EMPTY_COUPON);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = couponFormErrors(form);
  const err = (k: keyof CouponForm) => (tried ? errors[k] : undefined);
  const set = (patch: Partial<CouponForm>) => setForm((f) => ({ ...f, ...patch }));
  const percent = form.discountType === 'percent';

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      const created = await api.post<AdminCoupon>('/v1/admin/coupons', couponBody(form));
      toast.success(`Coupon ${created.code} created.${form.isPublic ? ' It shows in the app offers.' : ''}`);
      setForm(EMPTY_COUPON);
      setTried(false);
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="coupon-form" className="box stack" onSubmit={save} noValidate aria-labelledby="coupon-form-title">
      <h2 id="coupon-form-title">Create a coupon</h2>
      <div style={grid}>
        <Field id="c-code" label="Code" error={err('code')} hint="3–20 capital letters or digits.">
          <input id="c-code" className="input mono" value={form.code} placeholder="SHAADI10" onChange={(e) => set({ code: cleanCode(e.target.value) })} autoComplete="off" />
        </Field>
        <Field id="c-en" label="Title in English" error={err('titleEn')}>
          <input id="c-en" className="input" maxLength={80} value={form.titleEn} placeholder="10% off your wedding booking" onChange={(e) => set({ titleEn: e.target.value })} />
        </Field>
        <Field id="c-hi" label="Title in Hindi" error={err('titleHi')}>
          <input id="c-hi" className="input" lang="hi" maxLength={80} value={form.titleHi} placeholder="शादी की बुकिंग पर 10% छूट" onChange={(e) => set({ titleHi: e.target.value })} />
        </Field>
      </div>
      <div style={grid}>
        <Field id="c-type" label="Discount type">
          <select id="c-type" className="select" value={form.discountType} onChange={(e) => set({ discountType: e.target.value as CouponForm['discountType'] })}>
            <option value="percent">Percent off</option>
            <option value="flat">Flat amount off</option>
          </select>
        </Field>
        <Field id="c-value" label={percent ? 'Percent (1–100)' : 'Amount off (₹)'} error={err('value')}>
          <input id="c-value" className="input" inputMode={percent ? 'numeric' : 'decimal'} value={form.value} placeholder={percent ? '10' : '300'} onChange={(e) => set({ value: e.target.value })} />
        </Field>
        {percent ? (
          <Field id="c-max" label="Max discount (₹, optional)" error={err('maxDiscount')} hint="Empty = no cap.">
            <input id="c-max" className="input" inputMode="decimal" value={form.maxDiscount} placeholder="500" onChange={(e) => set({ maxDiscount: e.target.value })} />
          </Field>
        ) : null}
        <Field id="c-min" label="Min. booking amount (₹, optional)" error={err('minAmount')}>
          <input id="c-min" className="input" inputMode="decimal" value={form.minAmount} placeholder="2000" onChange={(e) => set({ minAmount: e.target.value })} />
        </Field>
        <Field id="c-cat" label="Category" hint={categoriesFailed ? 'Could not load categories; the coupon will work for all.' : undefined}>
          <select id="c-cat" className="select" value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={grid}>
        <Field id="c-uses" label="Max uses in total (optional)" error={err('maxUses')} hint="Empty = unlimited.">
          <input id="c-uses" className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />
        </Field>
        <Field id="c-per" label="Uses per customer" error={err('perCustomerLimit')}>
          <input id="c-per" className="input" inputMode="numeric" value={form.perCustomerLimit} onChange={(e) => set({ perCustomerLimit: e.target.value })} />
        </Field>
        <Field id="c-from" label="Valid from (optional)" hint="Empty = from now.">
          <input id="c-from" type="date" className="input" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
        </Field>
        <Field id="c-until" label="Valid until (optional)" error={err('validUntil')} hint="Includes that whole day. Empty = no end.">
          <input id="c-until" type="date" className="input" value={form.validUntil} min={form.validFrom || undefined} onChange={(e) => set({ validUntil: e.target.value })} />
        </Field>
      </div>
      <div className="btn-row">
        <label className="checkbox">
          <input type="checkbox" checked={form.firstBookingOnly} onChange={(e) => set({ firstBookingOnly: e.target.checked })} />
          First booking only
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set({ isPublic: e.target.checked })} />
          Show in app (offers list)
        </label>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Creating…' : 'Create coupon'}
        </button>
        <span className="small muted">EventSeva pays the discount; vendor payouts don’t change.</span>
      </div>
    </form>
  );
}

function EditCoupon({ coupon: c, onClose, onSaved }: { coupon: AdminCoupon; onClose: () => void; onSaved: () => void }) {
  const { toast } = useShell();
  const [form, setForm] = useState<CouponEditForm>({
    titleEn: c.titleEn,
    titleHi: c.titleHi,
    isActive: c.isActive,
    isPublic: c.isPublic,
    maxUses: c.maxUses ? String(c.maxUses) : '',
    validUntil: c.validUntil ? istDay(c.validUntil) : '',
  });
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = couponEditErrors(form);
  const set = (patch: Partial<CouponEditForm>) => setForm((f) => ({ ...f, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      await api.patch(`/v1/admin/coupons/${c.id}`, couponEditBody(form));
      toast.success(`Coupon ${c.code} updated.`);
      onClose();
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  }

  return (
    <form id="coupon-form" className="box stack" onSubmit={save} noValidate aria-labelledby="coupon-form-title">
      <h2 id="coupon-form-title">
        Edit <span className="mono">{c.code}</span> · {couponSummary(c, rupees)}
      </h2>
      <div style={grid}>
        <Field id="e-en" label="Title in English" error={tried ? errors.titleEn : undefined}>
          <input id="e-en" className="input" maxLength={80} value={form.titleEn} onChange={(e) => set({ titleEn: e.target.value })} />
        </Field>
        <Field id="e-hi" label="Title in Hindi" error={tried ? errors.titleHi : undefined}>
          <input id="e-hi" className="input" lang="hi" maxLength={80} value={form.titleHi} onChange={(e) => set({ titleHi: e.target.value })} />
        </Field>
        <Field id="e-uses" label="Max uses in total" error={tried ? errors.maxUses : undefined} hint={c.maxUses ? 'Can be raised or lowered, not removed.' : 'Empty = unlimited.'}>
          <input id="e-uses" className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => set({ maxUses: e.target.value })} />
        </Field>
        <Field id="e-until" label="Valid until" hint="Includes that whole day.">
          <input id="e-until" type="date" className="input" value={form.validUntil} onChange={(e) => set({ validUntil: e.target.value })} />
        </Field>
      </div>
      <div className="btn-row">
        <label className="checkbox">
          <input type="checkbox" checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          Active
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => set({ isPublic: e.target.checked })} />
          Show in app (offers list)
        </label>
      </div>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
