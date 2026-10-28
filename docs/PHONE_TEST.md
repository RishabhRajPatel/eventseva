# Phone test checklist

Run this on a real Android phone before each Play Store release. The automated tests cover the API and
screen logic, but a phone is the only place to check the camera, location, push, payments sheet and how
the screens actually look and feel.

## Setup

1. Start the API and database (see `docs/DEPLOY.md`, "Run locally"). Use the fake payment provider and
   console OTP: codes are printed in the API log (`docker compose logs -f api`).
2. Create an admin and open the admin panel (`http://<laptop-ip>:3001`).
3. Install both apps on the phone, pointing at the laptop:
   - With an Expo account: `eas build --profile development -p android` in `apps/customer` and `apps/partner`,
     after setting `EXPO_PUBLIC_API_URL` in `eas.json` to `http://<laptop-ip>:3000`.
   - Without one: `EXPO_PUBLIC_API_URL=http://<laptop-ip>:3000 npx expo run:android` with the phone on USB.
4. Phone and laptop on the same Wi-Fi. Use two phone numbers: one customer, one vendor.

Tick each line. If something fails, note the phone model, Android version, screen and what you saw.

## Partner app (vendor)

- [ ] Login with OTP; wrong OTP shows an error; resend works after the timer.
- [ ] Language switch Hindi ↔ English changes every screen; Hindi text is not cut off.
- [ ] Onboarding: business details, services, documents (camera and gallery both work), submit.
- [ ] Admin panel: approve the vendor; the vendor gets a push and the app moves past "pending".
- [ ] Bank details save; only the last 4 digits are shown afterwards.
- [ ] Photos: upload, reorder, delete.
- [ ] Engine services: add a car (resource) with RC and insurance photos, a driver, and a self-drive car
      service. Add a rental item with stock. Add an add-on and a package (bundle).
- [ ] Calendar: block a day; it shows as unavailable in the customer app.
- [ ] "Use my current location" asks for permission once, then pins the starting point.

## Customer app

- [ ] Welcome, language, login; set your name in Profile.
- [ ] Home shows 8 categories including Cars & Travel; search and filters work; distance shows.
- [ ] Vendor page: photos zoom, reviews, save to Saved.
- [ ] Create an event; "I’m at the venue" pins the location.
- [ ] Book a normal service, pay the advance (fake payment), see it in Bookings.
- [ ] Self-drive car: licence screen asks for number, date of birth, expiry and photo; the admin
      approves it under Checks; the customer gets a push that opens the licence screen.
- [ ] Add a car trip and a rental to the cart; close the app fully and reopen: the cart is still there.
- [ ] Package with a missing service: the cart asks to add it; checkout stays off until it is added.
- [ ] Cart checkout pays all items together.
- [ ] Logout clears the cart.

## Both apps, one booking

- [ ] Chat both ways, including a photo; push arrives with the app in the background and when closed.
- [ ] Vendor accepts; mobile number appears for both after the advance.
- [ ] Car handover: vendor records odometer, fuel and photos; customer sees photos (tap to zoom) and
      accepts or disputes.
- [ ] Handover code: the customer's booking shows a 6-digit code for the current step (handover /
      delivery / return) with "valid until". The vendor types it in: the record shows as agreed without the
      customer tapping anything. "New code" makes the old one stop working; the return needs its own code.
      A wrong or old code shows a clear error; saving without a code still works.
- [ ] Price change: with an item in the cart, the vendor raises its price; "Send" shows the new total and
      the difference, and sends only on the second press.
- [ ] Cart of two vendors, both accept: the payment screen offers "Pay all together"; one payment confirms both.
- [ ] Cancel a paid booking: the refund shown before confirming matches the refund afterwards.
- [ ] Partner: a service with two ways to book, a weekend price rule, a 13:00–14:00 break, "2 at the same
      time", and questions: a yes/no, then a text asked only after "yes", a date, a time and a photo.
- [ ] Customer: picking a way to book changes the price and durations; start times in the break or when the
      vendor is busy are greyed out; the follow-up question appears only after "yes"; the date opens a
      calendar, the time shows half-hour chips; the photo uploads from the gallery and can be removed.
- [ ] After booking: both apps show the way booked and the answers; the photo opens in the browser for the
      customer and the vendor, and the link stops working after 10 minutes.
- [ ] Partner → service → "Change history" lists each change; Admin → vendor → "Booking settings" shows the
      same and can take the service off (the vendor sees the reason).
- [ ] Return with extra km: the charge appears; customer disputes; admin decides under Disputes.
- [ ] Damage with no photos, disputed: admin cannot keep the money ("No photos back this charge"),
      only waive it. With photos, admin can keep part of it.
- [ ] Admin → Payment events lists each payment webhook once; "Check unpaid orders now" answers.
- [ ] Cash: vendor turns on "Cash also accepted" for a service; the customer picks "Cash to the vendor";
      the vendor's accept confirms it with no payment screen. The vendor records cash; the customer gets a
      notification and sees it on the booking. After the event: no payout for it, and the commission
      shows under Earnings and Admin → Commission dues; it comes off the next online payout.
- [ ] Admin → booking page shows "State history" with who made each change.
- [ ] Reschedule or extend; the price difference is charged or refunded.
- [ ] Before completion, invoice says "Proforma"; after the event is marked completed, it has a number.
- [ ] Share invoice opens the Android share sheet.
- [ ] Cancel a booking: refund shows in the customer app and in admin Refunds.
- [ ] Review after completion; vendor sees it.

## Phone behaviour

- [ ] Airplane mode: friendly "no internet" message, no crash; works again when back online.
- [ ] Rotate, back button, and app switching keep the screen state.
- [ ] Deny location and camera permissions: the app explains and still works without them.
- [ ] Small screen (5.5") and large font size (Settings → Display) still readable.
- [ ] Delete account from Profile; logging in again starts a new account.
