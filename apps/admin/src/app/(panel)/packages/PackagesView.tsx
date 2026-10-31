'use client';
import { useState, type FormEvent } from 'react';
import { EVENT_TYPES, rupees, type EventType } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { Button } from '@/components/Button';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { SearchBox } from '@/components/SearchBox';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import type { AdminPackage } from '@/lib/admin-types';
import { describeError, isApiError } from '@/lib/errors';

interface PickableService {
  id: string;
  title: string;
  pricePaise: number;
  bookingType: string;
  vendorId: string;
  vendorName: string;
  category: string;
}

interface Form {
  name: string;
  nameHi: string;
  eventType: EventType;
  description: string;
  descriptionHi: string;
  discountPercent: string;
  sortOrder: string;
  items: { serviceId: string; mandatory: boolean; label: string }[];
}

const EMPTY: Form = { name: '', nameHi: '', eventType: 'wedding', description: '', descriptionHi: '', discountPercent: '0', sortOrder: '0', items: [] };

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const whole = (v: string) => /^\d+$/.test(v.trim());

function formErrors(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = 'The English name customers see.';
  if (f.nameHi.trim().length < 2) e.nameHi = 'The Hindi name. Both apps are bilingual.';
  if (!whole(f.discountPercent) || Number(f.discountPercent) > 50) e.discountPercent = 'A whole number from 0 to 50.';
  if (!whole(f.sortOrder) || Number(f.sortOrder) > 1000) e.sortOrder = 'A whole number from 0 to 1000.';
  if (f.items.length < 2) e.items = 'A package needs at least two services — otherwise it is just the service.';
  else if (f.items.length > 10) e.items = 'Up to ten services.';
  else if (!f.items.some((i) => i.mandatory)) e.items = 'Mark at least one service as part of every booking.';
  return e;
}

/**
 * EventSeva's own packages: services from several vendors sold together. A customer booking one
 * gets every vendor in a single checkout — all of them or none.
 */
export function PackagesView() {
  const { toast } = useShell();
  const state = useApiQuery<{ items: AdminPackage[] }>('/v1/admin/packages');
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<AdminPackage | null>(null);
  const [search, setSearch] = useState('');
  const picker = useApiQuery<{ items: PickableService[] }>('/v1/admin/packages/services', { q: search });
  const { tried, setTried, onBlur, show, reset: resetErrors } = useFormErrors();
  const [saving, run] = useBusy();
  const [hiding, setHiding] = useState<AdminPackage | null>(null);

  const errors = form ? formErrors(form) : {};
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  function startNew() {
    setEditing(null);
    setForm(EMPTY);
    resetErrors();
  }

  function startEdit(p: AdminPackage) {
    setEditing(p);
    setForm({
      name: p.name,
      nameHi: p.nameHi,
      eventType: p.eventType as EventType,
      description: p.description ?? '',
      descriptionHi: p.descriptionHi ?? '',
      discountPercent: String(p.discountPercent),
      sortOrder: String(p.sortOrder),
      items: p.items.map((i) => {
        const s = p.services?.find((v) => v.serviceId === i.serviceId);
        return { serviceId: i.serviceId, mandatory: i.mandatory, label: s ? `${s.title} — ${s.vendorName}` : i.serviceId };
      }),
    });
    resetErrors();
  }

  const addService = (s: PickableService) => {
    if (!form || form.items.some((i) => i.serviceId === s.id)) return;
    set({ items: [...form.items, { serviceId: s.id, mandatory: true, label: `${s.title} — ${s.vendorName}` }] });
  };

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;
    setTried(true);
    if (Object.keys(errors).length) {
      focusFirstError(e.currentTarget);
      return;
    }
    void run(async () => {
      const body = {
        name: form.name.trim(),
        nameHi: form.nameHi.trim(),
        eventType: form.eventType,
        description: form.description.trim() || null,
        descriptionHi: form.descriptionHi.trim() || null,
        discountPercent: Number(form.discountPercent),
        sortOrder: Number(form.sortOrder),
        items: form.items.map((i) => ({ serviceId: i.serviceId, mandatory: i.mandatory })),
      };
      try {
        if (editing) await api.patch(`/v1/admin/packages/${editing.id}`, body);
        else await api.post('/v1/admin/packages', body);
        toast.success(editing ? `${body.name} updated.` : `${body.name} is live for ${titleCase(body.eventType)} events.`);
        setForm(null);
        setEditing(null);
        state.reload();
      } catch (err) {
        toast.error(
          isApiError(err) && err.code === 'PACKAGE_UNAVAILABLE'
            ? 'One of these services is switched off, or its vendor is not approved. Take it out and try again.'
            : describeError(err),
        );
      }
    });
  }

  return (
    <div className="page">
      <PageHead
        title="Packages"
        subtitle="EventSeva’s own packages: services from several vendors sold together. Booking one makes every vendor’s booking in a single checkout — all of them or none."
      >
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      {form ? (
        <form id="package-form" className="box stack" onBlur={onBlur} onSubmit={save} noValidate>
          <h2 className="section-head">{editing ? `Edit “${editing.name}”` : 'New package'}</h2>

          <FormField id="pkg-name" label="Name (English)" error={show('pkg-name') ? errors.name : undefined}>
            <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </FormField>
          <FormField id="pkg-name-hi" label="Name (Hindi)" error={show('pkg-name-hi') ? errors.nameHi : undefined}>
            <input className="input" value={form.nameHi} onChange={(e) => set({ nameHi: e.target.value })} />
          </FormField>
          <FormField id="pkg-event" label="Shown for" hint="Customers see it on events of this kind.">
            <select className="select" value={form.eventType} onChange={(e) => set({ eventType: e.target.value as EventType })}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField id="pkg-desc" label="Description (English)">
            <textarea className="textarea" rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </FormField>
          <FormField id="pkg-desc-hi" label="Description (Hindi)">
            <textarea className="textarea" rows={2} value={form.descriptionHi} onChange={(e) => set({ descriptionHi: e.target.value })} />
          </FormField>
          <FormField
            id="pkg-discount"
            label="Discount (%)"
            error={show('pkg-discount') ? errors.discountPercent : undefined}
            hint="Taken off every service in the package."
          >
            <input className="input" inputMode="numeric" value={form.discountPercent} onChange={(e) => set({ discountPercent: e.target.value })} />
          </FormField>
          <FormField id="pkg-order" label="Order in the list" error={show('pkg-order') ? errors.sortOrder : undefined} hint="Lower numbers come first.">
            <input className="input" inputMode="numeric" value={form.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} />
          </FormField>

          <h2 className="section-head">What is in it</h2>
          <p className="small muted">
            “Always included” services must all be booked together — leaving one out is refused. The others are optional extras the customer can drop.
          </p>
          {form.items.length ? (
            <ul className="stack-sm">
              {form.items.map((i, n) => (
                <li key={i.serviceId} className="btn-row">
                  <span>{i.label}</span>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={i.mandatory}
                      onChange={(e) => set({ items: form.items.map((it, m) => (m === n ? { ...it, mandatory: e.target.checked } : it)) })}
                    />{' '}
                    Always included
                  </label>
                  <button type="button" className="btn btn-small" onClick={() => set({ items: form.items.filter((_, m) => m !== n) })}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Nothing added yet.</p>
          )}
          {tried && errors.items ? (
            <p className="field-error" role="alert">
              {errors.items}
            </p>
          ) : null}

          <div className="field">
            <label className="label" htmlFor="pkg-search">
              Add a service
            </label>
            {/* Debounced: the picker searches every service of every approved vendor, so a query
                per keystroke is wasted work on a table that only grows. */}
            <SearchBox
              initial={search}
              onSearch={(v) => setSearch(v)}
              label="Search services"
              maxLength={60}
              placeholder="e.g. mandap, or a vendor’s name"
            />
            <p className="hint">Search by service or vendor name. Only live services from approved vendors can go in.</p>
          </div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Service</th>
                  <th scope="col">Vendor</th>
                  <th scope="col" className="num">
                    From
                  </th>
                  <th scope="col">
                    <span className="sr-only">Add</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(picker.data?.items ?? []).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="cell-main">{s.title}</span>
                      <span className="cell-sub">{s.category}</span>
                    </td>
                    <td>{s.vendorName}</td>
                    <td className="num">{rupees(s.pricePaise)}</td>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="btn btn-small btn-outline-royal"
                        disabled={form.items.some((i) => i.serviceId === s.id)}
                        onClick={() => addService(s)}
                      >
                        {form.items.some((i) => i.serviceId === s.id) ? 'Added' : 'Add'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="btn-row">
            <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
              {editing ? 'Save changes' : 'Create package'}
            </Button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => {
                setForm(null);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p>
          <button type="button" className="btn btn-primary" onClick={startNew}>
            New package
          </button>
        </p>
      )}

      <QueryView
        state={state}
        skeleton={<div className="box">Loading packages…</div>}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title="No packages yet"
            action={
              <button type="button" className="btn btn-outline-royal btn-small" onClick={startNew}>
                Create the first one
              </button>
            }
          >
            A package sells several vendors’ services together, like a tent, a DJ and catering for a wedding.
          </EmptyState>
        }
      >
        {(data) => (
          <div className="stack">
            {data.items.map((p) => {
              const dead = (p.services ?? []).filter((s) => !s.live);
              return (
                <div key={p.id} className="box stack-sm">
                  <div className="btn-row">
                    <h3 className="section-head">
                      {p.name} <span className="muted">· {p.nameHi}</span>
                    </h3>
                    <span className={`pill tone-${p.isActive ? 'success' : 'neutral'}`}>{p.isActive ? 'Live' : 'Hidden'}</span>
                    <span className="pill tone-info">{titleCase(p.eventType)}</span>
                    {p.discountPercent ? <span className="pill tone-outline">{p.discountPercent}% off</span> : null}
                  </div>
                  {p.description ? <p className="small muted">{p.description}</p> : null}

                  {dead.length ? (
                    <p className="note note-warning">
                      Customers cannot book this right now: {dead.map((s) => `${s.title} (${s.vendorName})`).join(', ')}{' '}
                      {dead.length === 1 ? 'is' : 'are'} switched off or the vendor is not approved.
                    </p>
                  ) : null}

                  <ul className="stack-sm">
                    {(p.services ?? []).map((s) => {
                      const required = p.items.find((i) => i.serviceId === s.serviceId)?.mandatory;
                      return (
                        <li key={s.serviceId}>
                          <div>{s.title}</div>
                          <div className="small muted">
                            {s.vendorName} · {rupees(s.pricePaise)} · {required ? 'always included' : 'optional'}
                            {s.live ? '' : ' · not bookable'}
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="btn-row">
                    <button type="button" className="btn btn-small btn-outline-royal" onClick={() => startEdit(p)}>
                      Edit
                    </button>
                    {p.isActive ? (
                      <button type="button" className="btn btn-small" onClick={() => setHiding(p)}>
                        Hide
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-small"
                        onClick={() => void run(async () => {
                          await api.patch(`/v1/admin/packages/${p.id}`, { isActive: true });
                          toast.success(`${p.name} is live again.`);
                          state.reload();
                        })}
                      >
                        Show
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </QueryView>

      {hiding ? (
        <ActionDialog
          title={`Hide “${hiding.name}”?`}
          description={<p>Customers stop seeing it. Bookings already made from it are not touched, and you can show it again later.</p>}
          confirmLabel="Hide it"
          busyLabel="Hiding…"
          onConfirm={() => api.delete(`/v1/admin/packages/${hiding.id}`)}
          successMessage="Hidden."
          onClose={() => setHiding(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
