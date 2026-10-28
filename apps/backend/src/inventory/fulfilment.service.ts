// A rental booking after confirmation: the vendor prepares and loads the items, dispatches them,
// marks them delivered, counts what comes back (damaged / missing), and verifies the return. Only the
// verification puts stock back: returned units become free, damaged ones go to repair, missing ones
// leave the stock. Charges for damage or loss are proposed item by item; the customer accepts or
// disputes them (silence for 48 h counts as accepted, an admin settles disputes), and the agreed
// amount comes out of the security deposit before the rest is refunded.
import { HandoverCodes } from '../engine/handover-code';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { postBookingEvent } from '../chat/booking-events';
import { RefundsService } from '../payments/refunds.service';
import { CloudinaryService, type SignedUpload } from '../media/cloudinary.service';

/** Bookings whose extra charges the customer answers here (rentals: damage; cars: km, hours, fuel …). */
export const CHARGEABLE = ['rental', 'transport'];

/** Proposed charges the customer has not answered count as accepted after this long. */
export const CHARGE_REPLY_HOURS = 48;
const MAX_PHOTOS = 10;

export interface LineQty {
  lineId: string;
  qty: number;
}
export interface ReturnLine {
  lineId: string;
  returned: number;
  damaged: number;
  missing: number;
  note?: string;
  /** Lower than the listed charge, to go easy on the customer; never higher. */
  chargePaise?: number;
}
/** Charges that keep money for damage or loss: an admin may uphold them only with photo evidence. */
const EVIDENCE_KINDS = ['damage', 'missing', 'cleaning'];

export interface StepBody {
  note?: string;
  photos?: SignedUpload[];
  /** The customer's handover code: the customer was there and agrees with this record. */
  customerCode?: string;
}

interface RentalBooking {
  id: string;
  customer_id: string;
  vendor_id: string;
  vendor_user_id: string;
  status: string;
  fulfilment: string;
  booking_type: string;
  starts_at: Date;
  ends_at: Date;
  day: string;
}

interface Line {
  id: string;
  inventory_item_id: string;
  qty: number;
  loaded_qty: number;
  dispatched_qty: number;
  delivered_qty: number;
  returned_qty: number;
  damaged_qty: number;
  missing_qty: number;
  damage_paise: number;
  missing_paise: number;
  verified_at: Date | null;
  item_snapshot: { name: string; unit: string };
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const bad = (code: string, message: string, details?: Record<string, unknown>) => new AppError(code, message, HttpStatus.CONFLICT, details);

@Injectable()
export class FulfilmentService {
  constructor(
    private readonly db: Db,
    private readonly refunds: RefundsService,
    private readonly cloudinary: CloudinaryService,
    private readonly codes: HandoverCodes,
  ) {}

  private async lock(q: Queryable, bookingId: string, who: { vendorUserId?: string; customerId?: string }, types = ['rental']): Promise<RentalBooking> {
    const b = await this.db.one<RentalBooking>(
      q,
      `SELECT b.id, b.customer_id, b.vendor_id, v.user_id AS vendor_user_id, b.status, b.fulfilment, b.booking_type, b.starts_at, b.ends_at, b.day
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR v.user_id = $2) AND ($3::uuid IS NULL OR b.customer_id = $3)
        FOR UPDATE OF b`,
      [bookingId, who.vendorUserId ?? null, who.customerId ?? null],
    );
    if (!b || !types.includes(b.booking_type)) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }

  private async lines(q: Queryable, bookingId: string): Promise<Line[]> {
    return (await q.query<Line>(`SELECT * FROM booking_lines WHERE booking_id = $1 ORDER BY item_snapshot->>'name' FOR UPDATE`, [bookingId])).rows;
  }

  private expect(b: RentalBooking, steps: string[], action: string) {
    if (b.status !== 'confirmed') throw bad('BOOKING_BAD_STATUS', 'Only confirmed bookings can be delivered.', { status: b.status });
    if (!steps.includes(b.fulfilment)) throw bad('FULFILMENT_BAD_STEP', `You cannot ${action} at this step.`, { fulfilment: b.fulfilment });
  }

  /** Inspection photos must be the vendor's own signed uploads. */
  private checkPhotos(vendorId: string, photos: SignedUpload[] = []) {
    return this.cloudinary.evidencePhotoIds(vendorId, photos, MAX_PHOTOS);
  }

  private byId<T extends { lineId: string }>(lines: Line[], input: T[]) {
    if (new Set(input.map((l) => l.lineId)).size !== input.length) throw new AppError('VALIDATION', 'Each item once, please.');
    return input.map((i) => {
      const line = lines.find((l) => l.id === i.lineId);
      if (!line) throw new AppError('VALIDATION', 'One of the items is not part of this booking.', HttpStatus.BAD_REQUEST, { lineId: i.lineId });
      return { line, input: i };
    });
  }

  private async record(q: Queryable, b: RentalBooking, phase: 'dispatch' | 'delivery' | 'return', actorId: string, body: StepBody, readings: unknown) {
    await q.query(
      `INSERT INTO booking_inspections (booking_id, phase, readings, notes, photo_ids, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (booking_id, phase) DO UPDATE SET readings = $3, notes = $4, photo_ids = $5, recorded_by = $6, recorded_at = now()`,
      [b.id, phase, readings, body.note?.trim() || null, this.checkPhotos(b.vendor_id, body.photos), actorId],
    );
  }

  private async event(q: Queryable, b: RentalBooking, event: string, actorId: string | null, data: Record<string, unknown> = {}) {
    await q.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, $2, $3, $4)`, [b.id, event, actorId, data]);
  }

  // ---------- vendor steps ----------

  /** "Preparing": the vendor has started getting the order ready. */
  async prepare(vendorUserId: string, bookingId: string) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['scheduled'], 'start preparing');
      await client.query(`UPDATE bookings SET fulfilment = 'preparing', updated_at = now() WHERE id = $1`, [b.id]);
      await this.event(client, b, 'preparing', vendorUserId);
    });
  }

  /** Loaded on the vehicle, item by item (can be updated until dispatch). */
  async load(vendorUserId: string, bookingId: string, input: LineQty[]) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['scheduled', 'preparing'], 'load items');
      for (const { line, input: i } of this.byId(await this.lines(client, b.id), input)) {
        if (i.qty > line.qty) throw new AppError('QUANTITY_OUT_OF_RANGE', `${line.item_snapshot.name}: only ${line.qty} were booked.`, HttpStatus.BAD_REQUEST, { lineId: line.id, max: line.qty });
        await client.query('UPDATE booking_lines SET loaded_qty = $2 WHERE id = $1', [line.id, i.qty]);
      }
      await client.query(`UPDATE bookings SET fulfilment = 'preparing', updated_at = now() WHERE id = $1`, [b.id]);
    });
  }

  /**
   * Leaves for the venue. From now the stock counts as out until the return is verified, even past
   * the booking's end, so a late return can never be double-booked.
   */
  async dispatch(vendorUserId: string, bookingId: string, input: LineQty[], body: StepBody) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['scheduled', 'preparing'], 'dispatch');
      if (b.ends_at.getTime() < Date.now()) throw bad('FULFILMENT_BAD_STEP', 'This booking has already ended.');
      const lines = await this.lines(client, b.id);
      const chosen = this.byId(lines, input);
      if (!chosen.some((c) => c.input.qty > 0)) throw new AppError('VALIDATION', 'Dispatch at least one item.');
      for (const { line, input: i } of chosen) {
        if (i.qty > line.qty) throw new AppError('QUANTITY_OUT_OF_RANGE', `${line.item_snapshot.name}: only ${line.qty} were booked.`, HttpStatus.BAD_REQUEST, { lineId: line.id, max: line.qty });
        await client.query('UPDATE booking_lines SET loaded_qty = GREATEST(loaded_qty, $2), dispatched_qty = $2 WHERE id = $1', [line.id, i.qty]);
        if (i.qty) {
          await client.query(`INSERT INTO inventory_movements (inventory_item_id, booking_id, kind, qty, actor_id) VALUES ($1, $2, 'dispatch', $3, $4)`, [
            line.inventory_item_id, b.id, i.qty, vendorUserId,
          ]);
        }
      }
      await client.query(`UPDATE capacity_holds SET until_returned = true WHERE booking_id = $1 AND status = 'active'`, [b.id]);
      await client.query(`UPDATE bookings SET fulfilment = 'dispatched', updated_at = now() WHERE id = $1`, [b.id]);
      await this.record(client, b, 'dispatch', vendorUserId, body, { lines: input });
      await this.event(client, b, 'dispatched', vendorUserId, { lines: input });
      await notify(client, b.customer_id, 'rental_dispatched', {
        en: { title: 'Items on the way', body: 'Your rental items have left the vendor. Please keep someone at the venue to receive them.' },
        hi: { title: 'सामान रास्ते में है', body: 'आपका किराये का सामान निकल चुका है। वेन्यू पर किसी को लेने के लिए रखें।' },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'dispatched', vendorUserId);
    });
  }

  async deliver(vendorUserId: string, bookingId: string, input: LineQty[], body: StepBody) {
    const byCode = await this.codes.check(vendorUserId, bookingId, body.customerCode);
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['dispatched'], 'mark delivery');
      const lines = await this.lines(client, b.id);
      const short: string[] = [];
      for (const { line, input: i } of this.byId(lines, input)) {
        if (i.qty > line.dispatched_qty) {
          throw new AppError('QUANTITY_OUT_OF_RANGE', `${line.item_snapshot.name}: only ${line.dispatched_qty} were dispatched.`, HttpStatus.BAD_REQUEST, { lineId: line.id, max: line.dispatched_qty });
        }
        await client.query('UPDATE booking_lines SET delivered_qty = $2 WHERE id = $1', [line.id, i.qty]);
      }
      for (const l of await this.lines(client, b.id)) if (l.delivered_qty < l.qty) short.push(`${l.item_snapshot.name} ${l.delivered_qty}/${l.qty}`);
      await client.query(`UPDATE bookings SET fulfilment = 'delivered', updated_at = now() WHERE id = $1`, [b.id]);
      await this.record(client, b, 'delivery', vendorUserId, body, { lines: input });
      if (byCode) await this.codes.confirm(client, b.id, 'delivery');
      await this.event(client, b, 'delivered', vendorUserId, { lines: input, short });
      await notify(client, b.customer_id, 'rental_delivered', {
        en: { title: 'Items delivered', body: short.length ? `Delivered, but fewer than booked: ${short.join(', ')}. Check and tell the vendor if anything is wrong.` : 'All items are at your venue. Please check them now and tell the vendor if anything is wrong.' },
        hi: { title: 'सामान पहुँच गया', body: short.length ? `सामान पहुँचा, पर बुक से कम: ${short.join(', ')}। जाँच लें और गड़बड़ी हो तो वेंडर को बताएँ।` : 'सारा सामान वेन्यू पर पहुँच गया। अभी जाँच लें और गड़बड़ी हो तो वेंडर को बताएँ।' },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'delivered', vendorUserId, { short });
    });
  }

  /**
   * Counts after pickup. Charges are worked out from the prices agreed in the booking (damage or
   * missing charge per unit); the vendor may only lower them. Nothing goes back to stock yet.
   */
  async recordReturn(vendorUserId: string, bookingId: string, input: ReturnLine[], body: StepBody) {
    const byCode = await this.codes.check(vendorUserId, bookingId, body.customerCode);
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['delivered', 'return_pending'], 'record the return');
      const lines = await this.lines(client, b.id);
      const chosen = this.byId(lines, input);
      if (chosen.length !== lines.filter((l) => l.dispatched_qty > 0).length) {
        throw new AppError('VALIDATION', 'Count every item that was dispatched.', HttpStatus.BAD_REQUEST);
      }
      // Answered charges from an earlier count of this return are replaced.
      await client.query(`DELETE FROM booking_charges WHERE booking_id = $1 AND kind IN ('damage', 'missing') AND status IN ('proposed', 'disputed')`, [b.id]);
      const deposit = await this.depositPaid(client, b.id);
      let charges = 0;
      for (const { line, input: i } of chosen) {
        if (i.returned + i.damaged + i.missing !== line.dispatched_qty) {
          throw new AppError('RETURN_COUNT_MISMATCH', `${line.item_snapshot.name}: returned, damaged and missing must add up to the ${line.dispatched_qty} dispatched.`,
            HttpStatus.BAD_REQUEST, { lineId: line.id, dispatched: line.dispatched_qty });
        }
        await client.query('UPDATE booking_lines SET returned_qty = $2, damaged_qty = $3, missing_qty = $4, note = $5 WHERE id = $1', [
          line.id, i.returned, i.damaged, i.missing, i.note?.trim() || null,
        ]);
        const listed = i.damaged * line.damage_paise + i.missing * (line.missing_paise || line.damage_paise);
        if (i.chargePaise !== undefined && i.chargePaise > listed) {
          throw new AppError('CHARGE_TOO_HIGH', `${line.item_snapshot.name}: at most ${rupees(listed)} by the agreed rates.`, HttpStatus.BAD_REQUEST, { lineId: line.id, maxPaise: listed });
        }
        const amount = i.chargePaise ?? listed;
        if (amount <= 0) continue;
        const parts = [i.damaged ? `${i.damaged} damaged × ${rupees(line.damage_paise)}` : '', i.missing ? `${i.missing} missing × ${rupees(line.missing_paise || line.damage_paise)}` : '']
          .filter(Boolean).join(', ');
        await client.query(
          `INSERT INTO booking_charges (booking_id, kind, description, qty, amount_paise, from_deposit, evidence_ids, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [b.id, i.missing ? 'missing' : 'damage', `${line.item_snapshot.name}: ${parts}${amount < listed ? ` (reduced to ${rupees(amount)})` : ''}`,
            i.damaged + i.missing, amount, deposit > 0, this.checkPhotos(b.vendor_id, body.photos), vendorUserId],
        );
        charges += amount;
      }
      await client.query(`UPDATE bookings SET fulfilment = 'return_pending', updated_at = now() WHERE id = $1`, [b.id]);
      await this.record(client, b, 'return', vendorUserId, body, { lines: input });
      if (byCode) await this.codes.confirm(client, b.id, 'return');
      await this.event(client, b, 'returned', vendorUserId, { chargesPaise: charges });
      await notify(client, b.customer_id, 'rental_returned', {
        en: { title: 'Return counted', body: charges ? `The vendor reported damaged or missing items: ${rupees(charges)}. Open the booking to accept or dispute within ${CHARGE_REPLY_HOURS} hours.` : 'Everything came back fine. Thank you!' },
        hi: { title: 'वापसी की गिनती हुई', body: charges ? `वेंडर ने टूटा या गुम सामान बताया: ${rupees(charges)}। ${CHARGE_REPLY_HOURS} घंटे में बुकिंग खोलकर मानें या आपत्ति करें।` : 'सारा सामान ठीक वापस आ गया। धन्यवाद!' },
      }, { bookingId: b.id }, 'customer');
      await postBookingEvent(client, b, 'returned', vendorUserId, { chargesPaise: charges });
    });
  }

  /**
   * The vendor has checked the returned items: returned units are free again, damaged ones go to
   * repair and missing ones leave the stock (each change on record). The booking's hold ends.
   */
  async verifyReturn(vendorUserId: string, bookingId: string) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.expect(b, ['return_pending'], 'verify the return');
      const lines = await this.lines(client, b.id);
      const counted = await this.db.one(client, `SELECT 1 FROM booking_inspections WHERE booking_id = $1 AND phase = 'return'`, [b.id]);
      if (!counted) throw bad('RETURN_NOT_COUNTED', 'Count the returned items first.');
      for (const l of lines) {
        if (l.verified_at) continue;
        const items = await this.db.one<{ total_qty: number; repair_qty: number }>(client, 'SELECT total_qty, repair_qty FROM inventory_items WHERE id = $1 FOR UPDATE', [l.inventory_item_id]);
        const moves: [string, number][] = [['return', l.returned_qty], ['damaged', l.damaged_qty], ['missing', l.missing_qty]];
        for (const [kind, qty] of moves) {
          if (qty > 0) {
            await client.query(`INSERT INTO inventory_movements (inventory_item_id, booking_id, kind, qty, actor_id) VALUES ($1, $2, $3, $4, $5)`, [
              l.inventory_item_id, b.id, kind, qty, vendorUserId,
            ]);
          }
        }
        // Damaged units wait in repair; missing ones are gone (and come out of repair first if stock is short).
        const total = Math.max(0, items!.total_qty - l.missing_qty);
        const repair = Math.min(total, items!.repair_qty + l.damaged_qty);
        await client.query('UPDATE inventory_items SET total_qty = $2, repair_qty = $3, updated_at = now() WHERE id = $1', [l.inventory_item_id, total, repair]);
        await client.query('UPDATE booking_lines SET verified_at = now() WHERE id = $1', [l.id]);
      }
      await client.query(`UPDATE capacity_holds SET status = 'released', until_returned = false WHERE booking_id = $1 AND status IN ('hold', 'active')`, [b.id]);
      await client.query(`UPDATE reservations SET status = 'released' WHERE booking_id = $1 AND status IN ('hold', 'active')`, [b.id]);
      await client.query(`UPDATE bookings SET fulfilment = 'closed', actual_end_at = now(), updated_at = now() WHERE id = $1`, [b.id]);
      await this.event(client, b, 'return_verified', vendorUserId);
      await postBookingEvent(client, b, 'return_verified', vendorUserId);
    });
    await this.settle(bookingId);
  }

  // ---------- customer and admin answers to charges ----------

  /** Returns the booking type, so the caller can show the right view. */
  async answerCharge(customerId: string, bookingId: string, chargeId: string, decision: 'accept' | 'dispute', note?: string): Promise<string> {
    const type = await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { customerId }, CHARGEABLE);
      const c = await this.db.one<{ status: string; amount_paise: number }>(
        client,
        'SELECT status, amount_paise FROM booking_charges WHERE id = $1 AND booking_id = $2 FOR UPDATE',
        [chargeId, b.id],
      );
      if (!c) throw new AppError('NOT_FOUND', 'Charge not found.', HttpStatus.NOT_FOUND);
      if (c.status !== 'proposed') throw bad('CHARGE_ALREADY_ANSWERED', 'This charge has already been answered.', { status: c.status });
      if (decision === 'dispute' && !note?.trim()) throw new AppError('VALIDATION', 'Tell us what is wrong with this charge.');
      await client.query(`UPDATE booking_charges SET status = $2, decided_by = $3, decision_note = $4 WHERE id = $1`, [
        chargeId, decision === 'accept' ? 'accepted' : 'disputed', customerId, note?.trim() || null,
      ]);
      await notify(client, b.vendor_user_id, 'charge_answered', {
        en: { title: decision === 'accept' ? 'Charge accepted' : 'Charge disputed', body: decision === 'accept' ? `The customer accepted ${rupees(c.amount_paise)}.` : `The customer disputed ${rupees(c.amount_paise)}. EventSeva will look into it.` },
        hi: { title: decision === 'accept' ? 'चार्ज मंज़ूर' : 'चार्ज पर आपत्ति', body: decision === 'accept' ? `ग्राहक ने ${rupees(c.amount_paise)} मान लिया।` : `ग्राहक ने ${rupees(c.amount_paise)} पर आपत्ति की। EventSeva जाँच करेगा।` },
      }, { bookingId: b.id }, 'partner');
      return b.booking_type;
    });
    await this.settle(bookingId);
    return type;
  }

  /** Admin decision on a disputed charge: the amount that stands (0 waives it). */
  async resolveCharge(adminId: string, bookingId: string, chargeId: string, amountPaise: number, note: string) {
    await this.db.tx(async (client) => {
      const c = await this.db.one<{ status: string; amount_paise: number; kind: string; evidence: boolean }>(
        client,
        `SELECT c.status, c.amount_paise, c.kind,
                (cardinality(c.evidence_ids) > 0 OR EXISTS (
                  SELECT 1 FROM booking_inspections i WHERE i.booking_id = c.booking_id AND i.phase = 'return' AND cardinality(i.photo_ids) > 0)) AS evidence
           FROM booking_charges c WHERE c.id = $1 AND c.booking_id = $2 FOR UPDATE OF c`,
        [chargeId, bookingId],
      );
      if (!c) throw new AppError('NOT_FOUND', 'Charge not found.', HttpStatus.NOT_FOUND);
      if (!['disputed', 'proposed'].includes(c.status)) throw bad('CHARGE_ALREADY_ANSWERED', 'This charge is already settled.', { status: c.status });
      if (amountPaise > c.amount_paise) throw new AppError('CHARGE_TOO_HIGH', 'A decision cannot raise the charge.', HttpStatus.BAD_REQUEST, { maxPaise: c.amount_paise });
      // Keeping money for damage or loss needs the vendor's photos; without them it can only be waived.
      if (amountPaise > 0 && EVIDENCE_KINDS.includes(c.kind) && !c.evidence) {
        throw bad('EVIDENCE_REQUIRED', 'No photos back this charge, so it can only be waived.', { kind: c.kind });
      }
      await client.query(
        `UPDATE booking_charges SET status = $2, amount_paise = CASE WHEN $3 > 0 THEN $3 ELSE amount_paise END, decided_by = $4, decision_note = $5 WHERE id = $1`,
        [chargeId, amountPaise > 0 ? 'resolved' : 'waived', amountPaise, adminId, note],
      );
      await client.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, before, after) VALUES ($1, 'booking.charge_resolve', 'booking', $2, $3, $4)`,
        [adminId, bookingId, { chargeId, amountPaise: c.amount_paise, status: c.status }, { amountPaise, note }],
      );
    });
    await this.settle(bookingId);
  }

  private async depositPaid(q: Queryable, bookingId: string): Promise<number> {
    return (await this.db.one<{ paid: number }>(
      q,
      `SELECT COALESCE(sum(amount_paise), 0)::int AS paid FROM payments WHERE booking_id = $1 AND type = 'deposit' AND status = 'paid'`,
      [bookingId],
    ))!.paid;
  }

  /**
   * Settles the deposit of returned rentals whose charges are all answered (or unanswered for 48 h):
   * agreed charges are kept for the vendor (paid with the booking's payout), the rest is refunded.
   * Runs after each answer and from the booking sweep. Returns how many bookings were settled.
   */
  async settle(onlyBookingId?: string): Promise<number> {
    await this.db.query(
      `UPDATE booking_charges c SET status = 'accepted', decision_note = 'No reply within ${CHARGE_REPLY_HOURS} hours'
         FROM bookings b
        WHERE c.booking_id = b.id AND b.booking_type IN ('rental', 'transport') AND c.status = 'proposed'
          AND c.created_at < now() - interval '${CHARGE_REPLY_HOURS} hours' AND ($1::uuid IS NULL OR b.id = $1)`,
      [onlyBookingId ?? null],
    );
    const due = await this.db.query<{ id: string }>(
      `SELECT b.id FROM bookings b
        WHERE b.booking_type IN ('rental', 'transport') AND b.status = 'confirmed' AND b.fulfilment = 'closed' AND b.deposit_settled_at IS NULL
          AND ($1::uuid IS NULL OR b.id = $1)
          AND NOT EXISTS (SELECT 1 FROM booking_charges c WHERE c.booking_id = b.id AND c.status IN ('proposed', 'disputed'))`,
      [onlyBookingId ?? null],
    );
    let settled = 0;
    for (const { id } of due.rows) {
      const done = await this.db.tx(async (client) => {
        const b = await this.db.one<RentalBooking & { deposit_settled_at: Date | null }>(
          client,
          `SELECT b.*, v.user_id AS vendor_user_id FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = $1 FOR UPDATE OF b`,
          [id],
        );
        if (!b || b.deposit_settled_at || b.fulfilment !== 'closed') return false;
        const deposit = await this.db.one<{ id: string; razorpay_payment_id: string; amount_paise: number }>(
          client,
          `SELECT id, razorpay_payment_id, amount_paise FROM payments WHERE booking_id = $1 AND type = 'deposit' AND status = 'paid' FOR UPDATE`,
          [id],
        );
        const agreed = (await this.db.one<{ sum: number }>(
          client,
          `SELECT COALESCE(sum(amount_paise), 0)::int AS sum FROM booking_charges WHERE booking_id = $1 AND status IN ('accepted', 'resolved') AND from_deposit`,
          [id],
        ))!.sum;
        const kept = deposit ? Math.min(agreed, deposit.amount_paise) : 0;
        const back = deposit ? deposit.amount_paise - kept : 0;
        if (back > 0) {
          await this.refunds.queue(client, id, deposit!.razorpay_payment_id, back, 'deposit_return');
          if (kept === 0) await client.query(`UPDATE payments SET status = 'refunded' WHERE id = $1`, [deposit!.id]);
        }
        await client.query('UPDATE bookings SET charges_paise = $2, deposit_settled_at = now(), updated_at = now() WHERE id = $1', [id, kept]);
        await this.event(client, b, 'deposit_settled', null, { keptPaise: kept, refundPaise: back });
        if (deposit) {
          await notify(client, b.customer_id, 'deposit_settled', {
            en: { title: 'Deposit settled', body: kept ? `${rupees(kept)} was kept for damaged or missing items; ${rupees(back)} is being refunded.` : `Your deposit of ${rupees(back)} is being refunded in full.` },
            hi: { title: 'डिपॉज़िट का हिसाब', body: kept ? `टूटे या गुम सामान के लिए ${rupees(kept)} रखे गए; ${rupees(back)} वापस किए जा रहे हैं।` : `आपका ${rupees(back)} डिपॉज़िट पूरा वापस किया जा रहा है।` },
          }, { bookingId: id }, 'customer');
        }
        return true;
      });
      if (done) settled++;
    }
    if (settled) await this.refunds.flush();
    return settled;
  }

  // ---------- reading ----------

  /** Items, counts, photos and charges of one rental booking, for its customer or its vendor. */
  async view(bookingId: string, who: { vendorUserId?: string; customerId?: string }) {
    const b = await this.db.one<RentalBooking & { deposit_paise: number; charges_paise: number; deposit_settled_at: Date | null; return_due_at: Date | null; amount_paise: number; advance_paise: number }>(
      this.db,
      `SELECT b.id, b.status, b.fulfilment, b.booking_type, b.starts_at, b.ends_at, b.return_due_at, b.deposit_paise, b.charges_paise, b.deposit_settled_at,
              b.amount_paise, b.advance_paise
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR v.user_id = $2) AND ($3::uuid IS NULL OR b.customer_id = $3)`,
      [bookingId, who.vendorUserId ?? null, who.customerId ?? null],
    );
    if (!b || b.booking_type !== 'rental') throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const lines = await this.db.query(
      `SELECT l.id, l.inventory_item_id AS "itemId", l.item_snapshot AS item, l.qty, l.unit_paise AS "unitPaise", l.qty * l.unit_paise AS "amountPaise",
              l.deposit_paise AS "depositPaise", l.damage_paise AS "damagePaise", COALESCE(NULLIF(l.missing_paise, 0), l.damage_paise) AS "missingPaise",
              l.loaded_qty AS "loadedQty", l.dispatched_qty AS "dispatchedQty", l.delivered_qty AS "deliveredQty", l.returned_qty AS "returnedQty",
              l.damaged_qty AS "damagedQty", l.missing_qty AS "missingQty", l.note, l.verified_at AS "verifiedAt"
         FROM booking_lines l WHERE l.booking_id = $1 ORDER BY l.item_snapshot->>'name'`,
      [bookingId],
    );
    const steps = await this.db.query(
      `SELECT phase, notes, photo_ids AS "photoIds", recorded_at AS "recordedAt", confirmed_by AS "confirmedBy" FROM booking_inspections WHERE booking_id = $1 ORDER BY recorded_at`,
      [bookingId],
    );
    const charges = await this.db.query(
      `SELECT id, kind, description, amount_paise AS "amountPaise", status, from_deposit AS "fromDeposit", decision_note AS "decisionNote",
              created_at AS "createdAt", created_at + interval '${CHARGE_REPLY_HOURS} hours' AS "replyBy"
         FROM booking_charges WHERE booking_id = $1 ORDER BY created_at`,
      [bookingId],
    );
    const paid = await this.db.query<{ type: string; paid: number }>(
      `SELECT type, COALESCE(sum(amount_paise), 0)::int AS paid FROM payments WHERE booking_id = $1 AND status IN ('paid', 'refunded') GROUP BY type`,
      [bookingId],
    );
    const paidOf = (t: string) => paid.rows.find((r) => r.type === t)?.paid ?? 0;
    const agreed = charges.rows
      .filter((c: { status: string }) => ['accepted', 'resolved'].includes(c.status))
      .reduce((s: number, c: { amountPaise: number }) => s + c.amountPaise, 0);
    return {
      fulfilment: b.fulfilment,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      returnDueAt: b.return_due_at,
      lines: lines.rows,
      steps: steps.rows,
      charges: charges.rows,
      deposit: {
        requiredPaise: b.deposit_paise,
        paidPaise: paidOf('deposit'),
        keptPaise: b.charges_paise,
        settledAt: b.deposit_settled_at,
      },
      balancePaidPaise: paidOf('final'),
      /** Agreed charges the deposit does not cover; they are added to the balance. */
      dueToVendorPaise: Math.max(0, agreed - paidOf('deposit')),
      /** What "Pay balance" charges now: the rest of the price plus charges beyond the deposit. */
      balanceDuePaise: ['confirmed', 'completed'].includes(b.status) ? Math.max(0, b.amount_paise - b.advance_paise + Math.max(0, agreed - paidOf('deposit')) - paidOf('final')) : 0,
    };
  }
}
