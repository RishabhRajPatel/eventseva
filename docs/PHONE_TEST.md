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
- [ ] Handover code: the customer's booking shows a 6-digit code. The vendor types it in at the
      handover (or rental delivery): the record shows as agreed without the customer tapping anything.
      A wrong code shows a clear error; saving without a code still works.
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
