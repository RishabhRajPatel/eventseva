'use client';
import { useState, type FormEvent } from 'react';
import { ActionDialog } from '@/components/dialogs';
import { Button } from '@/components/Button';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import type { AdminCity } from '@/lib/admin-types';
import { describeError, isApiError, isStaleError } from '@/lib/errors';
import { ON_OFF } from '@/lib/labels';
import { cityFormErrors, type CityForm } from '@/lib/places';

const EMPTY: CityForm = { name: '', nameHi: '', state: 'Uttar Pradesh' };

const COLS: Col[] = [{ label: 'City (English · Hindi)' }, { label: 'State' }, { label: 'Live vendors', num: true }, { label: 'Shown' }, { label: 'Action' }];

const focusForm = () =>
  requestAnimationFrame(() => {
    const form = document.getElementById('city-form');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  });

/** Cities customers can pick. New ones start hidden, so vendors can sign up there first. */
export function CitiesView() {
  const { toast } = useShell();
  const state = useApiQuery<{ items: AdminCity[] }>('/v1/admin/cities');
  const [form, setForm] = useState<CityForm>(EMPTY);
  const [editing, setEditing] = useState<AdminCity | null>(null);
  const { setTried, onBlur, show, reset: resetErrors } = useFormErrors();
  const [saving, run] = useBusy();
  const [toggle, setToggle] = useState<AdminCity | null>(null);
  const errors = cityFormErrors(form);
  const set = (patch: Partial<CityForm>) => setForm((f) => ({ ...f, ...patch }));

  function startEdit(city: AdminCity) {
    setEditing(city);
    setForm({ name: city.name, nameHi: city.nameHi, state: city.state });
    resetErrors();
    focusForm();
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
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
      const body = { name: form.name.trim(), nameHi: form.nameHi.trim(), state: form.state.trim() };
      try {
        if (editing) await api.patch(`/v1/admin/cities/${editing.id}`, body);
        else await api.post('/v1/admin/cities', body);
        toast.success(editing ? `${body.name} updated.` : `${body.name} added. It stays hidden from customers until you press “Show”.`);
        reset();
        state.reload();
      } catch (err) {
        toast.error(isApiError(err) && err.code === 'CITY_EXISTS' ? `${body.name} is already in the list. Edit it or show it instead.` : describeError(err));
        if (isStaleError(err)) state.reload();
      }
    });
  }

  return (
    <div className="page">
      <PageHead title="Cities" subtitle="Where EventSeva works. Hidden cities are not offered to customers; their vendors keep their profiles.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} rows={3} label="Loading cities…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title="No cities yet"
            action={
              <button type="button" className="btn btn-outline-royal btn-small" onClick={focusForm}>
                Add the first city ↓
              </button>
            }
          />
        }
      >
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <TableHead cols={COLS} />
              <tbody>
                {data.items.map((city) => (
                  <tr key={city.id} className={city.isActive ? undefined : 'row-off'} aria-current={city.id === editing?.id ? 'true' : undefined}>
                    <td>
                      <span className="cell-main">{city.name}</span>
                      <span className="cell-sub" lang="hi">
                        {city.nameHi}
                      </span>
                    </td>
                    <td>{city.state}</td>
                    <td className="num">{city.liveVendors}</td>
                    <td>
                      <StatusPill map={ON_OFF} status={city.isActive ? 'shown' : 'hidden'} />
                    </td>
                    <td>
                      <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="btn btn-small btn-outline-royal"
                          aria-pressed={city.id === editing?.id}
                          aria-label={`Edit ${city.name}`}
                          onClick={() => startEdit(city)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={`btn btn-small ${city.isActive ? 'btn-danger-outline' : 'btn-primary'}`}
                          aria-label={`${city.isActive ? 'Hide' : 'Show'} ${city.name}`}
                          onClick={() => setToggle(city)}
                        >
                          {city.isActive ? 'Hide' : 'Show'}
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      <form id="city-form" className="box stack" onSubmit={save} onBlur={onBlur} noValidate aria-labelledby="city-form-title" style={{ scrollMarginTop: '5rem' }}>
        <h2 id="city-form-title">{editing ? `Edit “${editing.name}”` : 'Add a city'}</h2>
        <FormField id="city-name" label="Name in English" error={show('city-name') ? errors.name : undefined}>
          <input className="input" maxLength={60} value={form.name} placeholder="e.g. Varanasi" onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField id="city-hi" label="Name in Hindi" error={show('city-hi') ? errors.nameHi : undefined}>
          <input className="input" lang="hi" maxLength={60} value={form.nameHi} placeholder="जैसे वाराणसी" onChange={(e) => set({ nameHi: e.target.value })} />
        </FormField>
        <FormField id="city-state" label="State" error={show('city-state') ? errors.state : undefined}>
          <input className="input" maxLength={60} value={form.state} onChange={(e) => set({ state: e.target.value })} />
        </FormField>
        <div className="btn-row">
          <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
            {editing ? 'Save changes' : 'Add city'}
          </Button>
          {editing ? (
            <button type="button" className="btn" onClick={reset} disabled={saving}>
              Cancel editing
            </button>
          ) : null}
        </div>
        {!editing ? <p className="small muted">New cities start hidden. Sign up vendors there first, then press “Show”.</p> : null}
      </form>

      {toggle ? (
        <ActionDialog
          title={toggle.isActive ? `Hide ${toggle.name}?` : `Show ${toggle.name} to customers?`}
          description={
            toggle.isActive ? (
              <p>
                Customers can no longer pick {toggle.name}.
                {toggle.liveVendors ? ` Its ${toggle.liveVendors} live vendor(s) keep their profiles and bookings.` : ''} At least one city must stay shown.
              </p>
            ) : (
              <p>Customers can pick {toggle.name} in both apps.{toggle.liveVendors ? '' : ' It has no live vendors yet.'}</p>
            )
          }
          confirmLabel={toggle.isActive ? 'Hide city' : 'Show city'}
          busyLabel={toggle.isActive ? 'Hiding…' : 'Showing…'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          // LAST_CITY becomes "At least one city must stay shown … Show another city first" (lib/errors.ts).
          onConfirm={() => api.patch(`/v1/admin/cities/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? `${toggle.name} hidden.` : `${toggle.name} is now shown to customers.`}
          undo={{
            run: () => api.patch(`/v1/admin/cities/${toggle.id}`, { isActive: toggle.isActive }),
            message: toggle.isActive ? `${toggle.name} is shown again.` : `${toggle.name} is hidden again.`,
          }}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
