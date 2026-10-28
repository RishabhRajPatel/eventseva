'use client';
import { useState } from 'react';
import { formatDateTime, formatDay, isSafeExternalUrl, todayIst } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { useShell } from '@/components/ShellContext';
import { EmptyState, PageHead, QueryView, RefreshingHint, TabLinks } from '@/components/ui';
import { useApiQuery } from '@/hooks/useApiQuery';
import { useUrlState } from '@/hooks/useUrlState';
import { api } from '@/lib/api';
import {
  ageOn,
  docLabel,
  LICENCE_REJECT_PRESETS,
  missingRequired,
  RESOURCE_REJECT_PRESETS,
  type PendingLicence,
  type PendingResource,
  type ResourceDocument,
} from '@/lib/checks';
import { describeError } from '@/lib/errors';
import { can } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';

type ResourceDialog = { kind: 'approve' | 'reject'; resource: PendingResource };
type LicenceDialog = { kind: 'verify' | 'reject'; licence: PendingLicence };

/** Vehicles and drivers (RC, insurance, licence) and customers' driving licences waiting for a check. */
export function ChecksView() {
  const { params } = useUrlState();
  const tab = params.get('tab') === 'licences' ? 'licences' : 'vehicles';
  return (
    <div className="page">
      <PageHead title="Car checks" subtitle="Cars and drivers can be booked, and customers can drive themselves, only after this check." />
      <TabLinks
        label="What to check"
        current={tab}
        tabs={[
          { key: 'vehicles', label: 'Cars & drivers', href: '/checks' },
          { key: 'licences', label: 'Customer licences', href: '/checks?tab=licences' },
        ]}
      />
      {tab === 'vehicles' ? <Resources /> : <Licences />}
    </div>
  );
}

function Resources() {
  const { session } = useShell();
  const state = useApiQuery<{ items: PendingResource[] }>('/v1/admin/resources/pending');
  const [dialog, setDialog] = useState<ResourceDialog | null>(null);
  const decide = can(session.admin.role, 'resource.verify');
  return (
    <>
      <RefreshingHint show={state.refreshing} />
      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="Nothing to check">New cars and drivers show up here once the vendor adds them.</EmptyState>}
      >
        {(data) => (
          <ul className="stack">
            {data.items.map((r) => (
              <ResourceCard key={r.id} resource={r} decide={decide} onDecide={setDialog} />
            ))}
          </ul>
        )}
      </QueryView>
      {dialog ? (
        <ActionDialog
          title={dialog.kind === 'approve' ? `Approve ${dialog.resource.name}?` : `Reject ${dialog.resource.name}?`}
          description={
            <p>
              {dialog.kind === 'approve'
                ? 'Customers can book it straight away. Check the papers first: the RC and insurance must match the registration, and be valid.'
                : 'The vendor sees the reason and can upload the papers again.'}
            </p>
          }
          confirmLabel={dialog.kind === 'approve' ? 'Approve' : 'Reject'}
          busyLabel="Saving…"
          tone={dialog.kind === 'approve' ? 'primary' : 'danger'}
          input={dialog.kind === 'approve' ? undefined : { label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.standard, presets: RESOURCE_REJECT_PRESETS }}
          onConfirm={(reason) => api.post(`/v1/admin/resources/${dialog.resource.id}/verify`, dialog.kind === 'approve' ? { decision: 'approve' } : { decision: 'reject', reason })}
          successMessage={dialog.kind === 'approve' ? 'Approved. The vendor is told.' : 'Saved. The vendor is told.'}
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
    </>
  );
}

function ResourceCard({ resource: r, decide, onDecide }: { resource: PendingResource; decide: boolean; onDecide: (d: ResourceDialog) => void }) {
  const { toast } = useShell();
  const [docs, setDocs] = useState<ResourceDocument[] | null>(null);
  const missing = missingRequired(r);
  const facts = Object.entries(r.attributes).filter(([, v]) => v !== null && v !== '' && v !== false);

  async function loadDocs() {
    try {
      setDocs((await api.get<{ items: ResourceDocument[] }>(`/v1/admin/resources/${r.id}/documents`)).items);
    } catch (e) {
      toast.error(describeError(e));
    }
  }
  function open(d: ResourceDocument) {
    // Only a signed Cloudinary link is ever opened, whatever the API returned.
    if (isSafeExternalUrl(d.viewUrl)) window.open(d.viewUrl, '_blank', 'noopener,noreferrer');
    else toast.error('This file has no view link. Ask the vendor to upload it again.');
  }

  return (
    <li className="box stack">
      <div className="section-head">
        <div>
          <p>
            <b>{r.name}</b> · {r.kind === 'vehicle' ? 'Car' : 'Driver'} · {r.businessName}
          </p>
          <p className="small muted">Added {formatDateTime(r.createdAt)}</p>
        </div>
        {decide ? (
          <div className="btn-row">
            <button type="button" className="btn btn-small btn-danger-outline" onClick={() => onDecide({ kind: 'reject', resource: r })}>
              Reject
            </button>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={missing.length > 0}
              title={missing.length ? `Needed first: ${missing.map(docLabel).join(', ')}` : undefined}
              onClick={() => onDecide({ kind: 'approve', resource: r })}
            >
              Approve
            </button>
          </div>
        ) : null}
      </div>
      {facts.length ? (
        <dl className="facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k.replace(/_/g, ' ')}</dt>
              <dd className={k === 'registration' ? 'mono' : undefined}>{v === true ? 'Yes' : String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {missing.length ? <p className="small field-error">Papers missing: {missing.map(docLabel).join(', ')}</p> : null}
      <div>
        {docs === null ? (
          <button type="button" className="btn btn-small" onClick={() => void loadDocs()}>
            Show papers ({r.documents.length})
          </button>
        ) : docs.length ? (
          <ul className="btn-row">
            {docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="btn btn-small btn-outline-royal" onClick={() => open(d)}>
                  Open {docLabel(d.docType)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">No papers uploaded.</p>
        )}
      </div>
    </li>
  );
}

function Licences() {
  const { session } = useShell();
  const state = useApiQuery<{ items: PendingLicence[] }>('/v1/admin/licences/pending');
  const [dialog, setDialog] = useState<LicenceDialog | null>(null);
  const decide = can(session.admin.role, 'resource.verify');
  const today = todayIst();
  return (
    <>
      <RefreshingHint show={state.refreshing} />
      <div className="note">
        <span>
          Check the number on the government record (Parivahan / DigiLocker) before verifying. The full number is shown only here and is
          never sent to vendors.
        </span>
      </div>
      <QueryView
        state={state}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title="No licences waiting">Customers add a licence before their first self-drive car.</EmptyState>}
      >
        {(data) => (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Licence number</th>
                  <th scope="col">Photo</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Valid till</th>
                  <th scope="col">Added</th>
                  {decide ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((l) => {
                  const expired = l.expiresOn.slice(0, 10) < today;
                  return (
                    <tr key={l.userId}>
                      <td>{l.name ?? '—'}</td>
                      <td className="mono">{l.number}</td>
                      <td>
                        {isSafeExternalUrl(l.photoUrl) ? (
                          <a href={l.photoUrl!} target="_blank" rel="noopener noreferrer">
                            Open photo
                          </a>
                        ) : (
                          <span className="muted">No photo</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {formatDay(l.dateOfBirth.slice(0, 10))} · {ageOn(l.dateOfBirth, today)} yrs
                      </td>
                      <td className={expired ? 'nowrap field-error' : 'nowrap'}>{formatDay(l.expiresOn.slice(0, 10))}{expired ? ' (expired)' : ''}</td>
                      <td className="nowrap">{formatDateTime(l.createdAt)}</td>
                      {decide ? (
                        <td>
                          <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
                            <button type="button" className="btn btn-small btn-danger-outline" onClick={() => setDialog({ kind: 'reject', licence: l })}>
                              Reject
                            </button>
                            <button type="button" className="btn btn-small btn-primary" disabled={expired} onClick={() => setDialog({ kind: 'verify', licence: l })}>
                              Verify
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryView>
      {dialog ? (
        <ActionDialog
          title={dialog.kind === 'verify' ? `Verify ${dialog.licence.name ?? 'this customer'}'s licence?` : 'Reject this licence?'}
          description={<p>{dialog.kind === 'verify' ? 'They can then take self-drive cars.' : 'The customer sees the reason and can add the licence again.'}</p>}
          confirmLabel={dialog.kind === 'verify' ? 'Verify' : 'Reject'}
          busyLabel="Saving…"
          tone={dialog.kind === 'verify' ? 'primary' : 'danger'}
          input={dialog.kind === 'verify' ? undefined : { label: 'Reason (shown to the customer)', limits: REASON_LIMITS.standard, presets: LICENCE_REJECT_PRESETS }}
          onConfirm={(reason) => api.post(`/v1/admin/licences/${dialog.licence.userId}/verify`, dialog.kind === 'verify' ? { decision: 'verify' } : { decision: 'reject', reason })}
          successMessage="Saved. The customer is told."
          onClose={() => setDialog(null)}
          onDone={state.reload}
        />
      ) : null}
    </>
  );
}
