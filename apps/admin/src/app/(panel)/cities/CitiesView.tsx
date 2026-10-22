'use client';
import { useState, type FormEvent } from 'react';
import { ApiError, errorMessage } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { AdminCity } from '@/lib/admin-types';
import { cityFormErrors, type CityForm } from '@/lib/places';

const EMPTY: CityForm = { name: '', nameHi: '', state: 'Uttar Pradesh' };

/** Cities customers can pick. New ones start hidden, so vendors can sign up there first. */
export function CitiesView() {
  const { toast } = useShell();
  const state = useApiQuery<{ items: AdminCity[] }>('/v1/admin/cities');
  const [form, setForm] = useState<CityForm>(EMPTY);
  const [editing, setEditing] = useState<AdminCity | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggle, setToggle] = useState<AdminCity | null>(null);
  const errors = cityFormErrors(form);
  const set = (patch: Partial<CityForm>) => setForm((f) => ({ ...f, ...patch }));

  function startEdit(city: AdminCity) {
    setEditing(city);
    setForm({ name: city.name, nameHi: city.nameHi, state: city.state });
    setTried(false);
    document.getElementById('city-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setTried(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length || saving) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), nameHi: form.nameHi.trim(), state: form.state.trim() };
      if (editing) await api.patch(`/v1/admin/cities/${editing.id}`, body);
      else await api.post('/v1/admin/cities', body);
      toast.success(editing ? 'City updated.' : `${body.name} added. It stays hidden from customers until you press “Show”.`);
      reset();
      state.reload();
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === 'CITY_EXISTS' ? `${form.name.trim()} is already in the list.` : errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHead title="Cities" subtitle="Where EventSeva works. Hidden cities are not offered to customers; their vendors keep their profiles.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <QueryView state={state} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No cities yet" />} loadingLabel="Loading cities…">
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">City (English · Hindi)</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">
                    Live vendors
                  </th>
                  <th scope="col">Shown</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((city) => (
                  <tr key={city.id} className={city.isActive ? undefined : 'muted'}>
                    <td>
                      <span className="cell-main">{city.name}</span>
                      <span className="cell-sub" lang="hi">
                        {city.nameHi}
                      </span>
                    </td>
                    <td>{city.state}</td>
                    <td className="num">{city.liveVendors}</td>
                    <td>{city.isActive ? <span className="pill tone-success">Shown</span> : <span className="pill tone-outline">Hidden</span>}</td>
                    <td>
                      <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                        <button type="button" className="btn btn-small btn-outline-royal" onClick={() => startEdit(city)}>
                          Edit
                        </button>
                        <button type="button" className={`btn btn-small${city.isActive ? '' : ' btn-primary'}`} onClick={() => setToggle(city)}>
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

      <form id="city-form" className="box stack" onSubmit={save} noValidate aria-labelledby="city-form-title">
        <h2 id="city-form-title">{editing ? `Edit “${editing.name}”` : 'Add a city'}</h2>
        <div className="field">
          <label htmlFor="city-name">Name in English</label>
          <input id="city-name" className="input" maxLength={60} value={form.name} placeholder="e.g. Varanasi" onChange={(e) => set({ name: e.target.value })} />
          {tried && errors.name ? <span className="inline-error">{errors.name}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="city-hi">Name in Hindi</label>
          <input id="city-hi" className="input" lang="hi" maxLength={60} value={form.nameHi} placeholder="जैसे वाराणसी" onChange={(e) => set({ nameHi: e.target.value })} />
          {tried && errors.nameHi ? <span className="inline-error">{errors.nameHi}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="city-state">State</label>
          <input id="city-state" className="input" maxLength={60} value={form.state} onChange={(e) => set({ state: e.target.value })} />
          {tried && errors.state ? <span className="inline-error">{errors.state}</span> : null}
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add city'}
          </button>
          {editing ? (
            <button type="button" className="btn" onClick={reset}>
              Cancel
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
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={async () => {
            try {
              await api.patch(`/v1/admin/cities/${toggle.id}`, { isActive: !toggle.isActive });
            } catch (e) {
              if (e instanceof ApiError && e.code === 'LAST_CITY') {
                throw new ApiError(e.status, e.code, `${toggle.name} is the only city shown. Show another city first.`);
              }
              throw e;
            }
          }}
          successMessage={toggle.isActive ? `${toggle.name} hidden.` : `${toggle.name} is now shown to customers.`}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
