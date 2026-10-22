import type { Metadata } from 'next';
import { SUPPORT_EMAIL } from '@/lib/support';

export const metadata: Metadata = { title: { absolute: 'Delete your EventSeva account' } };

// The account-deletion URL that Google Play asks for in the Data safety form.
export default function AccountDeletionPage() {
  return (
    <>
      <h1>Delete your EventSeva account</h1>
      <p>This applies to both the EventSeva app (customers) and the EventSeva Partner app (vendors).</p>

      <h2>In the app (fastest)</h2>
      <ol>
        <li>Open the app and go to <b>Profile</b>.</li>
        <li>
          Tap <b>Delete account</b>.
        </li>
        <li>
          Type <b>DELETE</b> and confirm. Your account is deleted at once and you are logged out.
        </li>
      </ol>
      <p>
        Open bookings must be finished or cancelled first. Vendors must also wait until their pending payouts have reached their bank, so
        that we can still pay them.
      </p>

      <h2>If you cannot open the app</h2>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`}>{SUPPORT_EMAIL}</a> from any address with the subject
        “Delete my account” and your registered mobile number. We will confirm it is your number with a one-time code and delete the
        account within 7 days.
      </p>

      <h2>What is deleted</h2>
      <ul>
        <li>Your name and mobile number</li>
        <li>Saved vendors, notification settings and devices</li>
        <li>For vendors: the business profile, photos, videos, ID documents and bank details</li>
      </ul>

      <h2>What we keep, and for how long</h2>
      <p>
        Records of past bookings, payments and refunds are kept for 8 years because Indian tax and payment rules require it. They no
        longer carry your name or mobile number. Chat messages stay visible to the other person in that chat.
      </p>
    </>
  );
}
