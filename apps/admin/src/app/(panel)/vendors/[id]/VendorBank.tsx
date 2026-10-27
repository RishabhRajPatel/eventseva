'use client';
import { useState } from 'react';
import { formatDateTime, type BankAccount } from '@eventseva/app-shared';
import { ActionDialog } from '@/components/dialogs';
import { Button } from '@/components/Button';
import { useShell } from '@/components/ShellContext';
import { StatusPill } from '@/components/ui';
import { useBusy } from '@/hooks/useBusy';
import { api } from '@/lib/api';
import { describeError, isApiError } from '@/lib/errors';
import { BANK_STATUS } from '@/lib/labels';
import { REASON_LIMITS } from '@/lib/validate';

type FullBankAccount = BankAccount & { accountNumber: string };

const BANK_REJECT_PRESETS = ['Name does not match the business owner', 'IFSC code is wrong', 'Account number could not be verified'];

/**
 * Finance only. The full account number is fetched on an explicit click, and each view is
 * written to the audit log by the API.
 */
export function VendorBank({ vendorId, businessName }: { vendorId: string; businessName: string }) {
  const { toast } = useShell();
  const [account, setAccount] = useState<FullBankAccount | null | 'none'>(null);
  const [loading, run] = useBusy();
  const [dialog, setDialog] = useState<'verify' | 'reject' | null>(null);

  const load = () =>
    run(async () => {
      try {
        setAccount(await api.get<FullBankAccount>(`/v1/admin/vendors/${vendorId}/bank-account`));
      } catch (e) {
        if (isApiError(e) && e.status === 404) setAccount('none');
        else toast.error(describeError(e));
      }
    });

  return (
    <section className="box stack" aria-labelledby="bank-title">
      <h2 id="bank-title">Payout bank account</h2>
      {account === null ? (
        <div>
          <Button className="btn btn-small btn-outline-royal" onClick={() => void load()} busy={loading} busyLabel="Loading…">
            Show bank details
          </Button>
          <p className="small muted">Opening the details is recorded in the audit log.</p>
        </div>
      ) : account === 'none' ? (
        <p className="muted">This vendor has not added a bank account yet. Payouts cannot be sent until they do.</p>
      ) : (
        <>
          <dl className="stack">
            <div>
              <dt className="small muted">Account holder</dt>
              <dd>{account.holderName}</dd>
            </div>
            <div>
              <dt className="small muted">Account number</dt>
              <dd className="mono">{account.accountNumber}</dd>
            </div>
            <div>
              <dt className="small muted">IFSC</dt>
              <dd className="mono">{account.ifsc}</dd>
            </div>
            {account.upiId ? (
              <div>
                <dt className="small muted">UPI ID</dt>
                <dd className="mono">{account.upiId}</dd>
              </div>
            ) : null}
            <div>
              <dt className="small muted">Status</dt>
              <dd>
                <StatusPill map={BANK_STATUS} status={account.status} /> <span className="small muted">updated {formatDateTime(account.updatedAt)}</span>
              </dd>
            </div>
            {account.status === 'rejected' && account.rejectReason ? <p className="small">Reason: {account.rejectReason}</p> : null}
          </dl>
          <div className="btn-row" style={{ justifyContent: 'space-between' }}>
            {account.status !== 'rejected' ? (
              <button type="button" className="btn btn-small btn-danger-outline" onClick={() => setDialog('reject')}>
                Ask vendor to fix
              </button>
            ) : null}
            {account.status !== 'verified' ? (
              <button type="button" className="btn btn-small btn-primary" onClick={() => setDialog('verify')}>
                Mark verified
              </button>
            ) : null}
          </div>
          <p className="small muted">Verify by sending ₹1 (penny drop) or matching a cancelled cheque before the first payout.</p>
        </>
      )}

      {dialog === 'verify' ? (
        <ActionDialog
          title="Mark bank account verified?"
          description={<p>Payouts for {businessName} will be sent to this account.</p>}
          confirmLabel="Mark account verified"
          busyLabel="Verifying…"
          onConfirm={() => api.post(`/v1/admin/vendors/${vendorId}/bank-account/verify`)}
          successMessage="Bank account verified."
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      ) : null}
      {dialog === 'reject' ? (
        <ActionDialog
          title="Ask the vendor to fix the bank details?"
          description={<p>The vendor sees the reason in the Partner app.</p>}
          confirmLabel="Send back to vendor"
          busyLabel="Sending…"
          tone="danger"
          input={{ label: 'Reason (shown to the vendor)', limits: REASON_LIMITS.vendor, presets: BANK_REJECT_PRESETS }}
          onConfirm={(reason) => api.post(`/v1/admin/vendors/${vendorId}/bank-account/reject`, { reason })}
          successMessage="Sent back to the vendor."
          onClose={() => setDialog(null)}
          onDone={() => void load()}
        />
      ) : null}
    </section>
  );
}
