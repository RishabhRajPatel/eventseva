'use client';
import { memo, useState, type FormEvent } from 'react';
import { ActionDialog } from '@/components/dialogs';
import { runUndo } from '@/components/undo';
import { Button } from '@/components/Button';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint, StatusPill, TableHead, TableSkeleton, type Col } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import type { AdminCategory, AdminCategoryList } from '@/lib/admin-types';
import { categoryFormErrors, moveId, type CategoryForm } from '@/lib/categories';
import { describeError, isStaleError } from '@/lib/errors';
import { CATEGORY_ICON_LABELS, ON_OFF, PRICING_UNIT_LABELS } from '@/lib/labels';

const EMPTY: CategoryForm = { nameEn: '', nameHi: '', icon: 'other', defaultUnit: 'per_event' };

const COLS: Col[] = [
  { label: 'Order' },
  { label: 'Name (English · Hindi)' },
  { label: 'Icon' },
  { label: 'Default price' },
  { label: 'Live vendors', num: true },
  { label: 'Shown' },
  { label: 'Action' },
];

const focusForm = () =>
  requestAnimationFrame(() => {
    const form = document.getElementById('category-form');
    form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  });

/** The service types both apps show. New ones go to the end; hidden ones stay for old vendors and bookings. */
export function CategoriesView() {
  const { toast, refreshCounts } = useShell();
  const state = useApiQuery<AdminCategoryList>('/v1/admin/categories');
  const [form, setForm] = useState<CategoryForm>(EMPTY);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const { setTried, onBlur, show, reset: resetErrors } = useFormErrors();
  const [saving, runSave] = useBusy();
  const [moving, runMove] = useBusy();
  const [toggle, setToggle] = useState<AdminCategory | null>(null);
  const errors = categoryFormErrors(form);
  const { reload } = state;

  function startEdit(cat: AdminCategory) {
    setEditing(cat);
    setForm({ nameEn: cat.nameEn, nameHi: cat.nameHi, icon: cat.icon, defaultUnit: cat.defaultUnit });
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
    void runSave(async () => {
      try {
        const body = { nameEn: form.nameEn.trim(), nameHi: form.nameHi.trim(), icon: form.icon, defaultUnit: form.defaultUnit };
        if (editing) await api.patch(`/v1/admin/categories/${editing.id}`, body);
        else await api.post('/v1/admin/categories', body);
        toast.success(editing ? 'Category updated. Both apps show it within the hour (or on restart).' : 'Category added. It now shows in both apps.');
        reset();
        reload();
      } catch (err) {
        toast.error(describeError(err));
        if (isStaleError(err)) reload();
      }
    });
  }

  /** Moves at once (no dialog: it is easy to put back), with Undo in the toast. */
  function move(list: AdminCategory[], cat: AdminCategory, dir: -1 | 1) {
    const before = list.filter((c) => c.isActive).map((c) => c.id);
    const after = moveId(before, cat.id, dir);
    void runMove(async () => {
      try {
        await api.put('/v1/admin/categories/order', { ids: after });
        toast.success(`${cat.nameEn} moved ${dir < 0 ? 'up' : 'down'}.`, {
          action: {
            label: 'Undo',
            onAction: () =>
              void runUndo(
                { run: () => api.put('/v1/admin/categories/order', { ids: before }), message: 'Order put back.' },
                { toast, refreshCounts, onDone: reload },
              ),
          },
        });
      } catch (err) {
        toast.error(describeError(err));
      }
      reload();
    });
  }

  return (
    <div className="page">
      <PageHead title="Categories" subtitle="The service types customers browse and vendors register under, in the order the apps show them.">
        <RefreshingHint show={state.refreshing || moving} />
      </PageHead>

      <QueryView
        state={state}
        skeleton={<TableSkeleton cols={COLS} rows={7} label="Loading categories…" />}
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            title="No categories yet"
            action={
              <button type="button" className="btn btn-outline-royal btn-small" onClick={focusForm}>
                Add the first category ↓
              </button>
            }
          />
        }
      >
        {(data) => (
          <CategoryTable items={data.items} moving={moving} editingId={editing?.id ?? null} onMove={(cat, dir) => move(data.items, cat, dir)} onEdit={startEdit} onToggle={setToggle} />
        )}
      </QueryView>

      <form id="category-form" className="box stack" onSubmit={save} onBlur={onBlur} noValidate aria-labelledby="category-form-title" style={{ scrollMarginTop: '5rem' }}>
        <h2 id="category-form-title">{editing ? `Edit “${editing.nameEn}”` : 'Add a category'}</h2>
        <FormField id="cat-en" label="Name in English" error={show('cat-en') ? errors.nameEn : undefined}>
          <input className="input" value={form.nameEn} maxLength={60} placeholder="e.g. Mehendi Artist" onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
        </FormField>
        <FormField id="cat-hi" label="Name in Hindi" error={show('cat-hi') ? errors.nameHi : undefined}>
          <input className="input" lang="hi" value={form.nameHi} maxLength={60} placeholder="जैसे मेहंदी आर्टिस्ट" onChange={(e) => setForm({ ...form, nameHi: e.target.value })} />
        </FormField>
        <FormField id="cat-icon" label="Icon">
          <select className="select" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
            {Object.entries(CATEGORY_ICON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="cat-unit" label="Default price unit" hint="Vendors can change it per service.">
          <select className="select" value={form.defaultUnit} onChange={(e) => setForm({ ...form, defaultUnit: e.target.value })}>
            {Object.entries(PRICING_UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </FormField>
        <div className="btn-row">
          <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
            {editing ? 'Save changes' : 'Add category'}
          </Button>
          {editing ? (
            <button type="button" className="btn" onClick={reset} disabled={saving}>
              Cancel editing
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
          busyLabel={toggle.isActive ? 'Hiding…' : 'Showing…'}
          tone={toggle.isActive ? 'danger' : 'primary'}
          onConfirm={() => api.patch(`/v1/admin/categories/${toggle.id}`, { isActive: !toggle.isActive })}
          successMessage={toggle.isActive ? `${toggle.nameEn} hidden.` : `${toggle.nameEn} shown again.`}
          undo={{
            run: () => api.patch(`/v1/admin/categories/${toggle.id}`, { isActive: toggle.isActive }),
            message: toggle.isActive ? `${toggle.nameEn} is shown again.` : `${toggle.nameEn} is hidden again.`,
          }}
          onClose={() => setToggle(null)}
          onDone={reload}
        />
      ) : null}
    </div>
  );
}

const CategoryTable = memo(function CategoryTable({
  items,
  moving,
  editingId,
  onMove,
  onEdit,
  onToggle,
}: {
  items: AdminCategory[];
  moving: boolean;
  editingId: number | null;
  onMove: (cat: AdminCategory, dir: -1 | 1) => void;
  onEdit: (cat: AdminCategory) => void;
  onToggle: (cat: AdminCategory) => void;
}) {
  const activeCount = items.filter((c) => c.isActive).length;
  return (
    <div className="table-wrap">
      <table className="tbl">
        <TableHead cols={COLS} />
        <tbody aria-busy={moving || undefined}>
          {items.map((cat, i) => (
            <tr key={cat.id} className={cat.isActive ? undefined : 'row-off'} aria-current={cat.id === editingId ? 'true' : undefined}>
              <td className="nowrap">
                {cat.isActive ? (
                  <span className="btn-row" style={{ gap: '0.25rem', flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn-small" disabled={i === 0 || moving} onClick={() => onMove(cat, -1)} aria-label={`Move ${cat.nameEn} up`}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-small" disabled={i >= activeCount - 1 || moving} onClick={() => onMove(cat, 1)} aria-label={`Move ${cat.nameEn} down`}>
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
              <td>
                <StatusPill map={ON_OFF} status={cat.isActive ? 'shown' : 'hidden'} />
              </td>
              <td>
                <span className="btn-row" style={{ gap: '0.5rem', flexWrap: 'nowrap' }}>
                  <button type="button" className="btn btn-small btn-outline-royal" aria-pressed={cat.id === editingId} aria-label={`Edit ${cat.nameEn}`} onClick={() => onEdit(cat)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`btn btn-small ${cat.isActive ? 'btn-danger-outline' : 'btn-primary'}`}
                    aria-label={`${cat.isActive ? 'Hide' : 'Show'} ${cat.nameEn}`}
                    onClick={() => onToggle(cat)}
                  >
                    {cat.isActive ? 'Hide' : 'Show'}
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
