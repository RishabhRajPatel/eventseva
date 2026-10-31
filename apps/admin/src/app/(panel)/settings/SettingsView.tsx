'use client';
import { useState, type FormEvent } from 'react';
import { formatDateTime, rupees } from '@eventseva/app-shared';
import { Button } from '@/components/Button';
import { FormField, focusFirstError, useFormErrors } from '@/components/FormField';
import { useShell } from '@/components/ShellContext';
import { PageHead, QueryView, RefreshingHint } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import type { PlatformSettings, SettingsResponse } from '@/lib/admin-types';
import { describeError, isApiError } from '@/lib/errors';

interface Form {
  advancePercent: string;
  commissionPercent: string;
  cashDuesLimitRupees: string;
  vendorPercent: string;
  tiers: { minDays: string; percent: string }[];
  platformName: string;
  platformAddress: string;
  platformGstin: string;
}

const toForm = (s: PlatformSettings): Form => ({
  advancePercent: String(s.advancePercent),
  commissionPercent: String(s.commissionPercent),
  cashDuesLimitRupees: String(Math.round(s.cashDuesLimitPaise / 100)),
  vendorPercent: String(s.cancellation.vendorPercent),
  tiers: s.cancellation.customer.map((t) => ({ minDays: String(t.minDays), percent: String(t.percent) })),
  platformName: s.platform.name,
  platformAddress: s.platform.address ?? '',
  platformGstin: s.platform.gstin ?? '',
});

const whole = (v: string) => /^\d+$/.test(v.trim()) && Number(v) <= 1_000_000_000;

/** Mirrors the checks in the API; the server is still the one that decides (checkPolicy + the table). */
function formErrors(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  const adv = Number(f.advancePercent);
  const com = Number(f.commissionPercent);
  if (!whole(f.advancePercent) || adv < 1 || adv > 100) e.advancePercent = 'A whole number from 1 to 100.';
  if (!whole(f.commissionPercent) || com > 100) e.commissionPercent = 'A whole number from 0 to 100.';
  else if (whole(f.advancePercent) && com > adv) e.commissionPercent = 'The commission comes out of the advance, so it cannot be larger.';
  if (!whole(f.cashDuesLimitRupees)) e.cashDuesLimitRupees = 'Rupees, whole numbers only.';
  if (!whole(f.vendorPercent) || Number(f.vendorPercent) > 100) e.vendorPercent = 'A whole number from 0 to 100.';
  if (!f.platformName.trim() || f.platformName.trim().length < 2) e.platformName = 'The name that goes on invoices.';
  if (f.platformGstin.trim() && !/^[0-9A-Z]{15}$/.test(f.platformGstin.trim())) e.platformGstin = '15 characters: digits and capitals.';

  // Tiers: whole days and percentages, the last one starting at 0 days, and refunds never growing
  // as the event gets closer. Same rules as checkPolicy on the server.
  const tiers = f.tiers.map((t) => ({ minDays: Number(t.minDays), percent: Number(t.percent) }));
  if (f.tiers.some((t) => !whole(t.minDays) || !whole(t.percent) || Number(t.minDays) > 365 || Number(t.percent) > 100)) {
    e.tiers = 'Each row needs whole days (0–365) and a refund of 0–100 %.';
  } else if (!tiers.length) {
    e.tiers = 'At least one row is needed.';
  } else {
    const sorted = [...tiers].sort((a, b) => b.minDays - a.minDays);
    if (sorted.at(-1)!.minDays !== 0) e.tiers = 'The last row must start at 0 days, so every cancellation is covered.';
    else if (new Set(tiers.map((t) => t.minDays)).size !== tiers.length) e.tiers = 'Two rows start on the same day.';
    else if (sorted.some((t, i) => i > 0 && t.percent > sorted[i - 1].percent)) e.tiers = 'A refund cannot grow as the event gets closer.';
  }
  return e;
}

/**
 * The money rules that used to need a deploy. Saving asks for a fresh 2FA code (the API client
 * opens that dialog), and writes a before-and-after line to the audit log.
 */
export function SettingsView() {
  const state = useApiQuery<SettingsResponse>('/v1/admin/settings');

  return (
    <div className="page">
      <PageHead
        title="Settings"
        subtitle="The money rules for new bookings. Every booking stores its own price, commission and cancellation policy when it is made, so changing these never moves money on a booking that already exists."
      >
        <RefreshingHint show={state.refreshing} />
      </PageHead>

      <QueryView state={state} skeleton={<div className="box">Loading settings…</div>}>
        {/* Keyed on the last save, so a reload starts the form from what the server now holds
            instead of an effect copying it into state after every render. */}
        {(data) => <SettingsForm key={data.updatedAt ?? 'initial'} data={data} onSaved={state.reload} />}
      </QueryView>
    </div>
  );
}

function SettingsForm({ data, onSaved }: { data: SettingsResponse; onSaved: () => void }) {
  const { toast } = useShell();
  const [form, setForm] = useState<Form>(() => toForm(data.settings));
  const { tried, setTried, onBlur, show, reset: resetErrors } = useFormErrors();
  const [saving, run] = useBusy();

  const errors = formErrors(form);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setTier = (i: number, patch: Partial<{ minDays: string; percent: string }>) =>
    setForm((f) => ({ ...f, tiers: f.tiers.map((t, n) => (n === i ? { ...t, ...patch } : t)) }));

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (Object.keys(errors).length) {
      focusFirstError(e.currentTarget);
      return;
    }
    void run(async () => {
      try {
        await api.patch('/v1/admin/settings', {
          advancePercent: Number(form.advancePercent),
          commissionPercent: Number(form.commissionPercent),
          cashDuesLimitPaise: Number(form.cashDuesLimitRupees) * 100,
          cancellation: {
            customer: form.tiers
              .map((t) => ({ minDays: Number(t.minDays), percent: Number(t.percent) }))
              .sort((a, b) => b.minDays - a.minDays),
            vendorPercent: Number(form.vendorPercent),
          },
          platformName: form.platformName.trim(),
          platformAddress: form.platformAddress.trim(),
          platformGstin: form.platformGstin.trim(),
        });
        toast.success('Saved. New bookings use these rules; bookings already made keep theirs.');
        resetErrors();
        onSaved();
      } catch (err) {
        toast.error(
          isApiError(err) && err.code === 'COMMISSION_OVER_ADVANCE'
            ? 'The commission comes out of the advance, so it cannot be larger than it.'
            : describeError(err),
        );
      }
    });
  }

  return (
    <form id="settings-form" className="box stack" onBlur={onBlur} onSubmit={save} noValidate>
      <h2 className="section-head">Money</h2>
      <div className="stack-sm">
        <FormField
          id="advance"
          label="Advance (% of the booking)"
          error={show('advance') ? errors.advancePercent : undefined}
          hint="What the customer pays to confirm. The rest is paid at the event."
        >
          <input className="input" inputMode="numeric" value={form.advancePercent} onChange={(e) => set({ advancePercent: e.target.value })} />
        </FormField>
        <FormField
          id="commission"
          label="EventSeva commission (% of the booking)"
          error={show('commission') ? errors.commissionPercent : undefined}
          hint="Taken out of the advance before the vendor payout, so it cannot be more than the advance."
        >
          <input className="input" inputMode="numeric" value={form.commissionPercent} onChange={(e) => set({ commissionPercent: e.target.value })} />
        </FormField>
      </div>
      <FormField
        id="cash-limit"
        label="Cash commission limit (₹)"
        error={show('cash-limit') ? errors.cashDuesLimitRupees : undefined}
        hint={`A vendor owing more than this on cash bookings cannot take new ones. Now: ${rupees(Number(form.cashDuesLimitRupees || 0) * 100)}.`}
      >
        <input className="input" inputMode="numeric" value={form.cashDuesLimitRupees} onChange={(e) => set({ cashDuesLimitRupees: e.target.value })} />
      </FormField>

      <h2 className="section-head">Default cancellation policy</h2>
      <p className="small muted">
        Used by categories that do not set their own. Each row says: cancelling this many whole days before the event refunds this much of what was
        paid. The last row must start at 0 days, and a refund can never grow as the event gets closer.
      </p>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Days before the event</th>
              <th scope="col">Refund to the customer</th>
              <th scope="col">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {form.tiers.map((t, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Row ${i + 1}: days before the event`}
                    value={t.minDays}
                    onChange={(e) => setTier(i, { minDays: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label={`Row ${i + 1}: refund percent`}
                    value={t.percent}
                    onChange={(e) => setTier(i, { percent: e.target.value })}
                  />
                </td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="btn btn-small"
                    disabled={form.tiers.length <= 1}
                    onClick={() => set({ tiers: form.tiers.filter((_, n) => n !== i) })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tried && errors.tiers ? (
        <p className="field-error" role="alert">
          {errors.tiers}
        </p>
      ) : null}
      <p>
        <button type="button" className="btn btn-small" onClick={() => set({ tiers: [...form.tiers, { minDays: '0', percent: '0' }] })}>
          Add a row
        </button>
      </p>
      <FormField
        id="vendor-percent"
        label="Refund when the vendor cancels (%)"
        error={show('vendor-percent') ? errors.vendorPercent : undefined}
        hint="The customer did nothing wrong, so this is normally 100."
      >
        <input className="input" inputMode="numeric" value={form.vendorPercent} onChange={(e) => set({ vendorPercent: e.target.value })} />
      </FormField>

      <h2 className="section-head">On invoices</h2>
      <FormField id="platform-name" label="Legal name" error={show('platform-name') ? errors.platformName : undefined}>
        <input className="input" value={form.platformName} onChange={(e) => set({ platformName: e.target.value })} />
      </FormField>
      <FormField id="platform-address" label="Address" hint="Leave empty to keep it off invoices.">
        <input className="input" value={form.platformAddress} onChange={(e) => set({ platformAddress: e.target.value })} />
      </FormField>
      <FormField
        id="platform-gstin"
        label="GSTIN"
        error={show('platform-gstin') ? errors.platformGstin : undefined}
        hint="With a GSTIN, 18 % GST is added to the commission on vendor invoices. Leave empty if EventSeva is not registered yet."
      >
        <input className="input mono" value={form.platformGstin} onChange={(e) => set({ platformGstin: e.target.value.toUpperCase() })} />
      </FormField>

      <div className="btn-row">
        <Button type="submit" className="btn btn-primary" busy={saving} busyLabel="Saving…">
          Save settings
        </Button>
        <button type="button" className="btn" onClick={() => setForm(toForm(data.settings))} disabled={saving}>
          Undo changes
        </button>
      </div>
      <p className="small muted">
        Saving asks for a fresh 2FA code.{' '}
        {data.updatedAt ? (
          <>
            Last changed {formatDateTime(data.updatedAt)}
            {data.updatedBy ? ` by ${data.updatedBy}` : ''}.
          </>
        ) : (
          'Never changed since the defaults were set.'
        )}
      </p>
    </form>
  );
}
