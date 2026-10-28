import type { Metadata } from 'next';
import { SUPPORT_EMAIL } from '@/lib/support';

export const metadata: Metadata = { title: { absolute: 'EventSeva privacy policy' } };

// Plain-language policy for the Play Store listing. Have it reviewed before launch.
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="muted">Last updated: 22 October 2026</p>
      <p>
        EventSeva connects people planning events in Prayagraj with local vendors. This policy covers the EventSeva app, the EventSeva
        Partner app and eventseva.in.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account:</b> mobile number (for login by OTP), name and preferred language.
        </li>
        <li>
          <b>Bookings:</b> your events (date, type, guest count, venue), bookings, messages with vendors, reviews and complaints.
        </li>
        <li>
          <b>Payments:</b> handled by Razorpay. We receive payment status and ids, never your card or UPI PIN.
        </li>
        <li>
          <b>Vendors also give:</b> business details, photos and videos, ID documents (only the last 4 digits of Aadhaar are stored) and
          bank details for payouts (stored encrypted).
        </li>
        <li>
          <b>Location:</b> only when you tap “I’m at the venue”, “Use my location” or “Use my current location”, to pin a venue, a car pickup or a
          vendor’s starting point. It is not tracked in the background. Customers see only distances to vendors, never their exact location.
        </li>
        <li>
          <b>Self-drive cars:</b> your driving licence number (stored encrypted), date of birth, expiry date and, if you add one, a photo of
          the licence. Only EventSeva’s checking team sees the full number and the photo.
        </li>
        <li>
          <b>Device:</b> a notification token so we can send booking updates.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To log you in, run bookings and payments, and send booking updates.</li>
        <li>To verify vendors and keep fake listings and fraud out.</li>
        <li>To answer support requests and resolve complaints.</li>
      </ul>
      <p>We do not sell your data and we do not show third-party ads.</p>

      <h2>Who sees it</h2>
      <ul>
        <li>The vendor you book sees your name, event details and, once the advance is paid, your mobile number. You see theirs too.</li>
        <li>
          Service providers that run EventSeva for us: Razorpay (payments), Cloudinary (photos and documents), an SMS provider (OTP),
          Google Firebase (notifications) and our cloud hosting in India.
        </li>
        <li>Authorities, when the law requires it.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data travels over HTTPS. ID documents are private files that only our verification team can open, through links that expire in
        10 minutes. Bank account numbers are encrypted. Every staff action on vendor data is logged.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Change your name and language in Profile.</li>
        <li>
          Delete your account in Profile → Delete account, or see <a href="/account-deletion">how to delete your account</a>.
        </li>
        <li>
          Ask for a copy of your data or correct it by writing to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </li>
      </ul>

      <h2>Children</h2>
      <p>EventSeva is for adults. You must be 18 or older to book or to list a business.</p>

      <h2>Contact</h2>
      <p>
        Questions or complaints about privacy: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </>
  );
}
