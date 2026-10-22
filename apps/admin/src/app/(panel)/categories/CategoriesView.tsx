'use client';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { api } from '@/lib/api';
import type { AdminCategory, AdminCategoryList } from '@/lib/admin-types';
import { CATEGORY_ICON_LABELS, PRICING_UNIT_LABELS } from '@/lib/labels';
import { categoryFormErrors, moveId, type CategoryForm } from '@/lib/categories';

const EMPTY: CategoryForm = { nameEn: '', nameHi: '', icon: 'other', defaultUnit: 'per_event' };

/** The service types both apps show. New ones go to the end; hidden ones stay for old vendors and bookings. */
export function CategoriesView() {
  const { toast } = useShell();
  const state = useApiQuery<AdminCategoryList>('/v1/admin/categories');
  const [form, setForm] = useState<CategoryForm>(EMPTY);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggle, setToggle] = useState<AdminCategory | null>(null);
  const errors = categoryFormErrors(form);

  function startEdit(cat: AdminCategory) {
    setEditing(cat);
    setForm({ nameEn: cat.nameEn, nameHi: cat.nameHi, icon: cat.icon, defaultUnit: cat.defaultUnit });
    setTried(false);
    document.getElementById('category-form')?.scrollIntoView({ behavior: 'smooth' });
  }

  function reset() {
    setEditing(null);
    setForm(EMPTY);
    setTried(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) return;
    setSaving(true);
    try {
      const body = { nameEn: form.nameEn.trim(), nameHi: form.nameHi.trim(), icon: form.icon, defaultUnit: form.defaultUnit };
      if (editing) await api.patch(`/v1/admin/categories/${editing.id}`, body);
      else await api.post('/v1/admin/categories', body);
      toast.success(editing ? 'Category updated. Both apps show it within the hour (or on restart).' : 'Category added. It now shows in both apps.');
      reset();
      state.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function move(list: AdminCategory[], id: number, dir: -1 | 1) {
    const active = list.filter((c) => c.isActive).map((c) => c.id);
    try {
      await api.put('/v1/admin/categories/order', { ids: moveId(active, id, dir) });
      state.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="page">
      <PageHead title="Categories" subtitle="The service types customers browse and vendors register under, in the order the apps show them.">
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <QueryView state={state} isEmpty={(d) => d.items.length === 0} empty={<EmptyState title="No categories yet" />}>
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Name (English · Hindi)</th>
                  <th scope="col">Icon</th>
                  <th scope="col">Default price</th>
                  <th scope="col" className="num">
                    Live vendors
                  </th>
                  <th scope="col">Shown</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((cat, i) => {
                  const activeCount = data.items.filter((c) => c.isActive).length;
                  return (
                    <tr key={cat.id} className={cat.isActive ? undefined : 'muted'}>
                      <td className="nowrap">
                        {cat.isActive ? (
                          <span className="btn-row" style={{ gap: '0.25rem', flexWrap: 'nowrap' }}>
                            <button type="button" className="btn btn-small" disabled={i === 0} onClick={() => move(data.items, cat.id, -1)} aria-label={`Move ${cat.nameEn} up`}>
                              ↑
                            </button>
                            <button type="button" className="btn btn-small" disabled={i >= activeCount - 1} onClick={() => move(data.items, cat.id, 1)} aria-label={`Move ${cat.nameEn} down`}>
                              ↓
                            </button>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="cell-main">{cat.nameEn}</span>
                        <span className="cell-sub" lang="hi">
                          {cat.nameHi}
                        </span>
                        <span className="cell-sub mono">{cat.slug}</span>
                      </td>
                      <td>{CATEGORY_ICON_LABELS[cat.icon] ?? cat.icon}</td>
                      <td>{PRICING_UNIT_LABELS[cat.defaultUnit] ?? cat.defaultUnit}</td>
                      <td className="num">
                        {cat.liveVendors}
                        {cat.allVendors > cat.liveVendors ? <span className="cell-sub">{cat.allVendors} in total</span> : null}
                      </td>
                      <td>{cat.isActive ? 'Yes' : 'Hidden'}</td>
                      <td>
                        <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn-small btn-outline-royal" onClick={() => startEdit(cat)}>
                            Edit
                          </button>
                          <button type="button" className={`btn btn-small${cat.isActive ? '' : ' btn-primary'}`} onClick={() => setToggle(cat)}>
                            {cat.isActive ? 'Hide' : 'Show'}
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>

      <form id="category-form" className="box stack" onSubmit={save} noValidate aria-labelledby="category-form-title">
        <h2 id="category-form-title">{editing ? `Edit “${editing.nameEn}”` : 'Add a category'}</h2>
        <div className="field">
          <label htmlFor="cat-en">Name in English</label>
          <input id="cat-en" className="input" value={form.nameEn} maxLength={60} placeholder="e.g. Mehendi Artist" onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
          {tried && errors.nameEn ? <span className="inline-error">{errors.nameEn}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="cat-hi">Name in Hindi</label>
          <input id="cat-hi" className="input" lang="hi" value={form.nameHi} maxLength={60} placeholder="जैसे मेहंदी आर्टिस्ट" onChange={(e) => setForm({ ...form, nameHi: e.target.value })} />
          {tried && errors.nameHi ? <span className="inline-error">{errors.nameHi}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="cat-icon">Icon</label>
          <select id="cat-icon" className="select" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
            {Object.entries(CATEGORY_ICON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cat-unit">Default price unit (vendors can change it per service)</label>
          <select id="cat-unit" className="select" value={form.defaultUnit} onChange={(e) => setForm({ ...form, defaultUnit: e.target.value })}>
            {Object.entries(PRICING_UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add category'}
          </button>
          {editing ? (
            <button type="button" className="btn" onClick={reset}>
              Cancel
            </button>
          ) : null}
        </div>
        <p className="small muted">Both names are shown in the apps: English by default, Hindi when the user picks Hindi.</p>
      </form>

      {toggle ? (
        <ActionDialog
          title={toggle.isActive ? `Hide “${toggle.nameEn}”?` : `Show “${toggle.nameEn}” again?`}
          description={
            toggle.isActive ? (
              <p>
                Customers stop seeing it as a service type and new vendors cannot pick it.
                {toggle.liveVendors ? ` Its ${toggle.liveVendors} live vendor(s) stay live and keep their bookings.` : ''}
              </p>
            ) : (
              <p>It appears in both apps again, at the end of the list.</p>
            )
          }
          confirmLabel={toggle.isActive ? 'Hide category' : 'Show category'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/categories/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? 'Category hidden.' : 'Category shown again.'}
          onClose={() => setToggle(null)}
          onDone={state.reload}
        />
      ) : null}
    </div>
  );
}
