'use client';
import Link from 'next/link';
import { memo, useState, type FormEvent } from 'react';
import { formatDateTime, rupees, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { Button } from '@/components/Button';
import { CsvDownload } from '@/components/CsvDownload';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { FeaturedPlan, FeaturedPurchase } from '@/lib/admin-types';
import { describeError, isStaleError } from '@/lib/errors';
import { ON_OFF, pageFrom } from '@/lib/labels';
import { paiseToRupeesInput, rupeesToPaise } from '@/lib/money';
import { planFormErrors, type PlanForm } from '@/lib/places';
import { can, canView } from '@/lib/roles';

const EMPTY_PLAN: PlanForm = { nameEn: '', nameHi: '', days: '', price: '' };

const planCols = (edit: boolean): Col[] => [
  { label: 'Plan (English · Hindi)' },
  { label: 'Days', num: true },
  { label: 'Price', num: true },
  { label: 'On sale' },
  ...(edit ? [{ label: 'Action' }] : []),
];

const SALE_COLS: Col[] = [
  { label: 'Date' },
  { label: 'Type' },
  { label: 'Vendor' },
  { label: 'Plan' },
  { label: 'Days', num: true },
  { label: 'Amount', num: true },
  { label: 'Featured' },
  { label: 'Payment id' },
];

const focusPlanForm = () =>
  requestAnimationFrame(() => {
    const form = document.getElementById('plan-form');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form?.querySelector<HTMLElement>('input:not([disabled])')?.focus({ preventScroll: true });
  });

export function FeaturedView() {
  return (
    <div className="page">
      <PageHead title="Featured" subtitle="Vendors pay to show at the top of search. Plans, and every sale or free grant.">
        <CsvDownload kind="featured" hint="Sales and grants by date. Dates are optional and inclusive." />
      </PageHead>
      <Plans />
      <Sales />
    </div>
  );
}

function Plans() {
  const { session, toast } = useShell();
  const edit = can(session.admin.role, 'featured.plans');
  const state = useApiQuery<{ items: FeaturedPlan[] }>('/v1/admin/featured-plans');
  const [editing, setEditing] = useState<FeaturedPlan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_PLAN);
  const { setTried, onBlur, show, reset: resetErrors } = useFormErrors();
  const [saving, run] = useBusy();
  const [toggle, setToggle] = useState<FeaturedPlan | null>(null);
  const errors = planFormErrors(form, editing === null);
  const set = (patch: Partial<PlanForm>) => setForm((f) => ({ ...f, ...patch }));

  function startEdit(p: FeaturedPlan) {
    setEditing(p);
    setForm({ nameEn: p.nameEn, nameHi: p.nameHi, days: String(p.days), price: paiseToRupeesInput(p.pricePaise) });
    resetErrors();
    focusPlanForm();
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY_PLAN);
    resetErrors();
  }

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      focusFirstError(e.currentTarget);
      return;
    }
    void run(async () => {
      try {
        const common = { nameEn: form.nameEn.trim(), nameHi: form.nameHi.trim(), pricePaise: rupeesToPaise(form.price)! };
        if (editing) await api.patch(`/v1/admin/featured-plans/${editing.id}`, common);
        else await api.post('/v1/admin/featured-plans', { ...common, days: Number(form.days) });
        toast.success(editing ? 'Plan updated. New purchases use the new price.' : 'Plan added. Vendors can buy it in the Partner app.');
        reset();
        state.reload();
      } catch (err) {
        toast.error(describeError(err));
        if (isStaleError(err)) state.reload();
      }
    });
  }

  return (
    <section className="stack" aria-labelledby="plans-title">
      <div className="section-head">
        <h2 id="plans-title">Plans</h2>
        <RefreshingHint show={state.refreshing} />
      </div>
      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={planCols(edit)} rows={3} label="Loading plans…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title="No plans yet"
            action={
              edit ? (
                <button type="button" className="btn btn-outline-royal btn-small" onClick={focusPlanForm}>
                  Add the first plan ↓
                </button>
              ) : null
            }
          >
            {edit ? null : 'A super admin adds the plans vendors can buy.'}
          </EmptyState>
        }
      >
        {(data) => (
          <div className="table-wrap static">
            <table className="tbl">
              <TableHead cols={planCols(edit)} />
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'row-off'} aria-current={p.id === editing?.id ? 'true' : undefined}>
                    <td>
                      <span className="cell-main">{p.nameEn}</span>
                      <span className="cell-sub" lang="hi">
                        {p.nameHi}
                      </span>
                    </td>
                    <td className="num">{p.days}</td>
                    <td className="num">{rupees(p.pricePaise)}</td>
                    <td>
                      <StatusPill map={ON_OFF} status={p.isActive ? 'onSale' : 'hidden'} />
                    </td>
                    {edit ? (
                      <td>
                        <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn-small btn-outline-royal" aria-pressed={p.id === editing?.id} aria-label={`Edit ${p.nameEn}`} onClick={() => startEdit(p)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`btn btn-small ${p.isActive ? 'btn-danger-outline' : 'btn-primary'}`}
                            aria-label={`${p.isActive ? 'Stop selling' : 'Sell again'} ${p.nameEn}`}
                            onClick={() => setToggle(p)}
                          >
                            {p.isActive ? 'Stop selling' : 'Sell again'}
                          </button>
                        </span>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      {edit ? (
        <form id="plan-form" className="box stack" onSubmit={save} onBlur={onBlur} noValidate aria-labelledby="plan-form-title" style={{ scrollMarginTop: '5rem' }}>
          <h3 id="plan-form-title">{editing ? `Edit “${editing.nameEn}”` : 'Add a plan'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1rem' }}>
            <FormField id="plan-en" label="Name in English" error={show('plan-en') ? errors.nameEn : undefined}>
              <input className="input" maxLength={60} value={form.nameEn} placeholder="7 days on top" onChange={(e) => set({ nameEn: e.target.value })} />
            </FormField>
            <FormField id="plan-hi" label="Name in Hindi" error={show('plan-hi') ? errors.nameHi : undefined}>
              <input className="input" lang="hi" maxLength={60} value={form.nameHi} placeholder="7 दिन सबसे ऊपर" onChange={(e) => set({ nameHi: e.target.value })} />
            </FormField>
            <FormField
              id="plan-days"
              label="Days"
              error={show('plan-days') ? errors.days : undefined}
              hint={editing ? 'Days cannot change once created; add a new plan instead.' : undefined}
            >
              <input className="input" inputMode="numeric" value={form.days} disabled={editing !== null} onChange={(e) => set({ days: e.target.value })} />
            </FormField>
            <FormField id="plan-price" label="Price (₹)" error={show('plan-price') ? errors.price : undefined}>
              <input className="input" inputMode="decimal" value={form.price} placeholder="499" onChange={(e) => set({ price: e.target.value })} />
            </FormField>
          </div>
          <div className="btn-row">
            <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
              {editing ? 'Save changes' : 'Add plan'}
            </Button>
            {editing ? (
              <button type="button" className="btn" onClick={reset} disabled={saving}>
                Cancel editing
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="small muted">Only super admins can change plans and prices.</p>
      )}

      {toggle ? (
        <ActionDialog
          title={toggle.isActive ? `Stop selling “${toggle.nameEn}”?` : `Sell “${toggle.nameEn}” again?`}
          description={
            <p>
              {toggle.isActive
                ? 'Vendors can no longer buy it. Vendors already featured with it stay featured until their end date.'
                : 'Vendors can buy it again in the Partner app.'}
            </p>
          }
          confirmLabel={toggle.isActive ? 'Stop selling plan' : 'Sell plan again'}
          busyLabel="Saving…"
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/featured-plans/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? `${toggle.nameEn} is hidden from vendors.` : `${toggle.nameEn} is on sale again.`}
          undo={{
            run: () => api.patch(`/v1/admin/featured-plans/${toggle.id}`, { isActive: toggle.isActive }),
            message: toggle.isActive ? `${toggle.nameEn} is on sale again.` : `${toggle.nameEn} is hidden again.`,
          }}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </section>
  );
}

function Sales() {
  const { session } = useShell();
  const vendorLinks = canView(session.admin.role, 'vendors');
  const { params, hrefWith } = useUrlState();
  const page = pageFrom(params.get('page'));
  const state = useApiQuery<Paged<FeaturedPurchase>>('/v1/admin/featured-purchases', { page });

  return (
    <section className="stack" aria-labelledby="sales-title">
      <div className="section-head">
        <h2 id="sales-title">Sales and free grants</h2>
        <RefreshingHint show={state.refreshing} />
      </div>
      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={SALE_COLS} rows={5} label="Loading sales…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState title={page === 1 ? 'No featured sales yet' : 'No more sales'}>
            {page === 1 ? 'Sales appear here when a vendor buys a plan in the Partner app, and free grants when a super admin gives days.' : null}
          </EmptyState>
        }
      >
        {(data) => (
          <>
            <SalesTable items={data.items} vendorLinks={vendorLinks} />
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </section>
  );
}

const SalesTable = memo(function SalesTable({ items, vendorLinks }: { items: FeaturedPurchase[]; vendorLinks: boolean }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={SALE_COLS} />
        <tbody>
          {items.map((f) => (
            <tr key={f.id}>
              <td className="nowrap">{formatDateTime(f.paidAt ?? f.createdAt)}</td>
              <td>
                {f.status === 'paid' ? (
                  <span className="pill tone-success">Paid</span>
                ) : f.status === 'granted' ? (
                  <span className="pill tone-info">Free</span>
                ) : (
                  <span className="pill tone-neutral">{f.status}</span>
                )}
                {f.grantedBy ? <span className="cell-sub">by {f.grantedBy}</span> : null}
                {f.reason ? <span className="cell-sub">“{f.reason}”</span> : null}
              </td>
              <td>{vendorLinks ? <Link href={`/vendors/${f.vendorId}`}>{f.vendorName}</Link> : f.vendorName}</td>
              <td>{f.planName ?? '—'}</td>
              <td className="num">{f.days}</td>
              <td className="num">{f.amountPaise ? rupees(f.amountPaise) : '—'}</td>
              <td className="nowrap">
                {f.startsAt ? <span className="cell-sub">From {formatDateTime(f.startsAt)}</span> : null}
                {f.endsAt ? <span className="cell-sub">Until {formatDateTime(f.endsAt)}</span> : '—'}
              </td>
              <td className="mono">{f.paymentId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
