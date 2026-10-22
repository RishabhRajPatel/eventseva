'use client';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { errorMessage, formatDateTime, rupees, type Paged } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { CsvDownload } from '@/components/CsvDownload';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, Pager, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import type { FeaturedPlan, FeaturedPurchase } from '@/lib/admin-types';
import { pageFrom } from '@/lib/labels';
import { paiseToRupeesInput, rupeesToPaise } from '@/lib/money';
import { planFormErrors, type PlanForm } from '@/lib/places';
import { can, canView } from '@/lib/roles';

const EMPTY_PLAN: PlanForm = { nameEn: '', nameHi: '', days: '', price: '' };

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
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggle, setToggle] = useState<FeaturedPlan | null>(null);
  const errors = planFormErrors(form, editing === null);
  const set = (patch: Partial<PlanForm>) => setForm((f) => ({ ...f, ...patch }));

  function startEdit(p: FeaturedPlan) {
    setEditing(p);
    setForm({ nameEn: p.nameEn, nameHi: p.nameHi, days: String(p.days), price: paiseToRupeesInput(p.pricePaise) });
    setTried(false);
    document.getElementById('plan-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY_PLAN);
    setTried(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      const common = { nameEn: form.nameEn.trim(), nameHi: form.nameHi.trim(), pricePaise: rupeesToPaise(form.price)! };
      if (editing) await api.patch(`/v1/admin/featured-plans/${editing.id}`, common);
      else await api.post('/v1/admin/featured-plans', { ...common, days: Number(form.days) });
      toast.success(editing ? 'Plan updated. New purchases use the new price.' : 'Plan added. Vendors can buy it in the Partner app.');
      reset();
      state.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack" aria-labelledby="plans-title">
      <div className="section-head">
        <h2 id="plans-title">Plans</h2>
        <RefreshingHint show={state.refreshing} />
      </div>
      <QueryView state={state} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No plans yet">{edit ? 'Add the first plan below.' : null}</EmptyState>} loadingLabel="Loading plans…">
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Plan (English · Hindi)</th>
                  <th scope="col" className="num">
                    Days
                  </th>
                  <th scope="col" className="num">
                    Price
                  </th>
                  <th scope="col">On sale</th>
                  {edit ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className={p.isActive ? undefined : 'muted'}>
                    <td>
                      <span className="cell-main">{p.nameEn}</span>
                      <span className="cell-sub" lang="hi">
                        {p.nameHi}
                      </span>
                    </td>
                    <td className="num">{p.days}</td>
                    <td className="num">{rupees(p.pricePaise)}</td>
                    <td>{p.isActive ? 'Yes' : 'Hidden'}</td>
                    {edit ? (
                      <td>
                        <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn-small btn-outline-royal" onClick={() => startEdit(p)}>
                            Edit
                          </button>
                          <button type="button" className={`btn btn-small${p.isActive ? '' : ' btn-primary'}`} onClick={() => setToggle(p)}>
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
        <form id="plan-form" className="box stack" onSubmit={save} noValidate aria-labelledby="plan-form-title">
          <h3 id="plan-form-title">{editing ? `Edit “${editing.nameEn}”` : 'Add a plan'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '1rem' }}>
            <div className="field">
              <label htmlFor="plan-en">Name in English</label>
              <input id="plan-en" className="input" maxLength={60} value={form.nameEn} placeholder="7 days on top" onChange={(e) => set({ nameEn: e.target.value })} />
              {tried && errors.nameEn ? <span className="inline-error">{errors.nameEn}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="plan-hi">Name in Hindi</label>
              <input id="plan-hi" className="input" lang="hi" maxLength={60} value={form.nameHi} placeholder="7 दिन सबसे ऊपर" onChange={(e) => set({ nameHi: e.target.value })} />
              {tried && errors.nameHi ? <span className="inline-error">{errors.nameHi}</span> : null}
            </div>
            <div className="field">
              <label htmlFor="plan-days">Days</label>
              <input id="plan-days" className="input" inputMode="numeric" value={form.days} disabled={editing !== null} onChange={(e) => set({ days: e.target.value })} />
              {tried && errors.days ? (
                <span className="inline-error">{errors.days}</span>
              ) : editing ? (
                <span className="hint">Days cannot change once created; add a new plan instead.</span>
              ) : null}
            </div>
            <div className="field">
              <label htmlFor="plan-price">Price (₹)</label>
              <input id="plan-price" className="input" inputMode="decimal" value={form.price} placeholder="499" onChange={(e) => set({ price: e.target.value })} />
              {tried && errors.price ? <span className="inline-error">{errors.price}</span> : null}
            </div>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add plan'}
            </button>
            {editing ? (
              <button type="button" className="btn" onClick={reset}>
                Cancel
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
          confirmLabel={toggle.isActive ? 'Stop selling' : 'Sell again'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/featured-plans/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? 'Plan hidden from vendors.' : 'Plan on sale again.'}
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
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={page === 1 ? 'No featured sales yet' : 'No more sales'} />}
        loadingLabel="Loading sales…"
      >
        {(data) => (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Type</th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Plan</th>
                    <th scope="col" className="num">
                      Days
                    </th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col">Featured</th>
                    <th scope="col">Payment id</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => (
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
            <Pager page={data.page} hasMore={data.hasMore} count={data.items.length} hrefFor={(p) => hrefWith({ page: p })} />
          </>
        )}
      </QueryView>
    </section>
  );
}
