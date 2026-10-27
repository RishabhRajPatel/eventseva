# EventSeva UX standard

Every screen in the customer app, the Partner app and the admin panel follows these rules, so the three feel like
one product. Colours come from `packages/app-shared/src/theme.ts` and the boards in `design/`.

## 1. Colour and type

- **Palette roles:**

  | Role | Colour |
  |---|---|
  | Primary actions and links | royal `#263baa` |
  | Text | ink `#23262f` |
  | Page | cream `#fff4d6` |
  | Cards | white |
  | Chips and selected backgrounds | lavender `#e8deff` / lilac `#d9b8ff` |
  | Partner app header | indigo `#312e81` |

- **Status colours**, always the same meaning in every app:

  | Meaning | Fill | Text |
  |---|---|---|
  | Success / confirmed | mint `#b7f7d4` | `#0b5c36` |
  | Waiting / warning | peach `#ffd6a5` | `#7a3e00` |
  | Error / destructive | `#fde8e7` | `#b42318` (buttons: `#b42318` on white text) |
  | Info | lavender | royal |

- **Contrast:** at least 4.5:1 for text and 3:1 for icons and borders (WCAG AA). Never put muted grey text on lavender.
- **Type:** one display face (Playfair, Noto Serif Devanagari in Hindi) for titles only, and Lato / Noto Sans for everything else.
  - Sizes are taken only from `text` in the theme; no one-off sizes.
  - Text scales with the phone's font setting; layouts must not clip at 1.3×.

## 2. Selecting things (chips, options, slots, dates, plans, photos)

- **Selected:** lilac fill, a 2dp royal border and a ✓ icon. The state must never be shown by colour alone (the ✓ is for colour-blind users).
- **Unselected:** white fill with a 1.5dp outline border `#8a78cf` (3.7:1 on white; lavender is too faint for a control edge). **Disabled:** 40% opacity, plus the reason as a hint ("Booked", "Past date").
- **Feel:** a light haptic tap (`Haptics.selectionAsync()`) on every select or unselect, and a ripple / pressed opacity of 0.85.
- **Accessibility:** `accessibilityRole="radio"` (single choice) or `"checkbox"` (multiple), plus `accessibilityState={{ selected }}`.

## 3. Buttons and submitting

- **Size:** at least 48dp tall, with the label always visible. **Kinds:** primary (royal), secondary (outline), danger (red), ghost (link).
- **On press:**
  - Show the button's own spinner and make it **busy and disabled until the request finishes**. Double taps must never send twice; guard inside the handler too, not only with `disabled`.
  - Keep the screen usable; don't freeze it under a full-screen spinner for a single action.
- **Success:**
  - A short **toast / snackbar** at the bottom ("Saved", "Booking request sent"), shown for 3 s.
  - A success haptic (`notificationAsync(Success)`).
  - Then navigate, or update the list in place.
- **Error:**
  - Show the translated message **next to the thing that failed**: under the field, or a toast for screen-level errors. Use an error haptic.
  - Keep what the user typed.
- **Forms:**
  - Validate as the user leaves a field, and again on submit.
  - On a failed submit, scroll to and focus the first wrong field.
  - The submit button stays enabled, so pressing it shows the errors.

## 4. Confirming

Ask before anything that cannot be undone or costs money: delete, cancel a booking, reject a request, log out, delete the account, refund, block.

- **Title:** a question naming the thing: "Delete this photo?" / "Cancel your booking with Raj DJ?"
- **Body:** **what will happen**, with numbers: "You get ₹2,925 back (90%). The vendor's date becomes free."
- **Buttons:** the destructive one is red and **names the action** ("Delete photo", "Yes, cancel booking"); never "OK". The other one says "Keep" or "Go back".
- **Typing to confirm:** only for account deletion ("DELETE").
- **Small deletes** (a photo, a package item, a chip): delete at once and show a toast with **Undo** for 5 s, instead of a dialog.

## 5. Messages

- Never show raw codes, stack traces or "Error 500". Every API error code has a translated sentence that says **what happened and what to do next**: "The vendor is not free on 12 Feb. Pick another date or slot."
- **Empty states:** an illustration or icon, one sentence, and one action ("No bookings yet. Explore vendors →").
- **Offline:**
  - A slim banner at the top: "No internet. Showing saved data."
  - Retry automatically when back online, plus a manual Retry button.
- **Loading:** **skeletons** shaped like the content for lists and cards; spinners only inside buttons.
- **Time-sensitive states** ("Reply within 4h 12m", "Pay by 8 pm") update live.

## 6. Photos and videos

- **Before upload:**
  - Photos are resized on the phone to at most 2000 px on the long side, JPEG quality 0.8, with `expo-image-manipulator` (5–10× smaller, much faster on 4G).
  - Check type, size and video length **before** uploading, with a clear message ("Videos can be up to 2 minutes").
- **While uploading:**
  - Show a thumbnail immediately, with a **progress bar in %**. Use `XMLHttpRequest` `upload.onprogress`; `fetch` has no upload progress.
  - Each file can be cancelled.
  - Several files upload one or two at a time, each with its own state: waiting, uploading 45%, done ✓, failed ⟳ retry.
- **After:**
  - Status badge (Waiting for review / Live / Not approved + reason).
  - Tap to view full screen; long-press or a ⋯ menu for Make cover / Move / Delete.
- **Delete:** a confirm dialog for the cover photo and for videos; Undo toast for other photos.

## 7. Speed

- **Lists:** `FlashList` (installed in both apps) for anything that can grow: vendors, bookings, chats, messages, notifications, reviews, payouts. Use stable `keyExtractor`, memoised rows (`React.memo`) and no inline object styles in rows.
- **Images:**
  - `expo-image` with `cachePolicy="memory-disk"`, a blurhash or colour placeholder, and `recyclingKey` in lists.
  - The URL comes from the Cloudinary helpers sized to the slot (never full size).
- **Data:**
  - React Query with sensible `staleTime` (catalogue 1 h, lists 30 s).
  - Prefetch the next screen's data on press-in where cheap (vendor page from a vendor card).
  - Optimistic updates for saves and deletes, rolled back on error.
- **Rendering:** no heavy work in render; memoise derived lists; split big screens into memoised sections.
- **Startup:** load only the 6 font files used; keep the splash until fonts and session are ready; no blocking network calls before the first screen.

## 8. Admin panel (web)

The same rules, adapted for the web:

- **Feedback:** toasts for results. Confirm dialogs follow §4.
- **Loading:** skeleton rows in tables.
- **Buttons:** busy state on every button. Keyboard: Enter submits, Esc closes dialogs, visible focus rings.
- **Tables:** sticky headers and right-aligned money columns.
- **Destructive buttons:** red, and placed apart from primary buttons.
