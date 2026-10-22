'use client';
import { useState } from 'react';
import { errorMessage, formatDateTime, type VendorDocument } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/ActionDialog';
import { useShell } from '@/components/ShellContext';
import { StatusPill } from '@/components/ui';
import { api } from '@/lib/api';
import type { AdminVendor } from '@/lib/admin-types';
import { DOC_LABELS, docNumber, humanize, isLinkStale, MEDIA_STATUS } from '@/lib/labels';
import { can } from '@/lib/roles';
import { REASON_LIMITS } from '@/lib/validate';
import styles from './vendor.module.css';

const DOC_REJECT_PRESETS = [
  'Photo is blurry or cut off',
  'Name does not match the profile',
  'Wrong document type',
  'Document is expired or invalid',
];

type Dialog = { kind: 'approve' | 'reject'; doc: VendorDocument };

/** Aadhaar / PAN / GST / shop photo: view the private file and approve or reject each one. */
export function VendorDocuments({
  vendor,
  receivedAt,
  onDone,
}: {
  vendor: AdminVendor;
  /** When `vendor` was fetched: view links expire 10 minutes after that. */
  receivedAt: number | undefined;
  onDone: () => void;
}) {
  const { session, toast } = useShell();
  const canReview = can(session.admin.role, 'vendor.decide');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const docs = vendor.documents ?? [];

  async function view(doc: VendorDocument) {
    if (receivedAt !== undefined && !isLinkStale(receivedAt) && doc.viewUrl) {
      window.open(doc.viewUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    // The link may have expired: open the tab now (popup blockers allow it only during the
    // click), then send it to a fresh link.
    const tab = window.open('about:blank', '_blank');
    try {
      const fresh = await api.get<AdminVendor>(`/v1/admin/vendors/${vendor.id}`);
      const url = fresh.documents?.find((d) => d.id === doc.id)?.viewUrl;
      if (!url) throw new Error('No link');
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      onDone(); // show the fresh links on the page too
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error && e.message === 'No link' ? 'This document has no view link.' : errorMessage(e));
    }
  }

  return (
    <section className="box stack" aria-labelledby="docs-title">
      <h2 id="docs-title">Documents</h2>
      {docs.length === 0 ? (
        <p className="muted">No documents uploaded yet.</p>
      ) : (
        <ul className={styles.docs}>
          {docs.map((doc) => {
            const label = DOC_LABELS[doc.docType] ?? humanize(doc.docType);
            const number = docNumber(doc.docType, doc.last4);
            return (
              <li key={doc.id} className={styles.doc}>
                <div className={styles.docInfo}>
                  <span>
                    <b>{label}</b>
                    {number ? <span className="nowrap"> · {number}</span> : null}
                  </span>
                  <span className="small muted">Uploaded {formatDateTime(doc.createdAt)}</span>
                  <StatusPill map={MEDIA_STATUS} status={doc.status} />
                  {doc.rejectReason && doc.status === 'rejected' ? <span className="small">Reason: {doc.rejectReason}</span> : null}
                </div>
                <div className={styles.docActions}>
                  {doc.viewUrl ? (
                    <button type="button" className="btn btn-small btn-outline-royal" onClick={() => view(doc)} aria-label={`View ${label} (opens in a new tab)`}>
                      View ↗
                    </button>
                  ) : (
                    <span className="small muted">{canReview ? 'No view link (file storage not configured)' : 'Only verifiers can open documents'}</span>
                  )}
                  {canReview && doc.status !== 'rejected' ? (
                    <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: 'reject', doc })} aria-label={`Reject ${label}`}>
                      Reject
                    </button>
                  ) : null}
                  {canReview && doc.status !== 'approved' ? (
                    <button type="button" className="btn btn-small btn-primary" onClick={() => setDialog({ kind: 'approve', doc })} aria-label={`Approve ${label}`}>
                      Approve
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="small muted">Documents are private. View links work for 10 minutes and are never shown to customers.</p>

      {dialog?.kind === 'approve' ? (
        <ActionDialog
          title={`Approve ${DOC_LABELS[dialog.doc.docType] ?? 'document'}?`}
          description={<p>Approve only after checking that the name and number match {vendor.businessName}’s owner.</p>}
          confirmLabel="Approve document"
          onConfirm={() => api.post(`/v1/admin/documents/${dialog.doc.id}/approve`)}
          successMessage="Document approved."
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
      {dialog?.kind === 'reject' ? (
        <ActionDialog
          title={`Reject ${DOC_LABELS[dialog.doc.docType] ?? 'document'}?`}
          description={<p>The vendor sees the reason in the Partner app and can upload it again.</p>}
          confirmLabel="Reject document"
          tone="danger"
          input={{ label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.vendor, presets: DOC_REJECT_PRESETS }}
          onConfirm={(reason) => api.post(`/v1/admin/documents/${dialog.doc.id}/reject`, { reason })}
          successMessage="Document rejected."
          onClose={() => setDialog(null)}
          onDone={onDone}
        />
      ) : null}
    </section>
  );
}
