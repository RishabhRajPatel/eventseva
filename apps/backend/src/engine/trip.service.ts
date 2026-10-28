// A car booking after confirmation: the vendor assigns a driver (with-driver trips), hands the car
// over with an inspection (odometer, fuel, photos), takes it back with another, and the extra km,
// extra hours, fuel, tolls or damage are proposed as charges from what was agreed in the booking.
// The customer can agree to or dispute each inspection and charge; the deposit is then settled by the
// same steps as rentals (FulfilmentService.settle).
import { depositHeldSql } from '../bookings/cash.service';
import { HandoverCodes } from './handover-code';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';
import { notify } from '../notifications/notify';
import { CloudinaryService, type SignedUpload } from '../media/cloudinary.service';
import { FulfilmentService } from '../inventory/fulfilment.service';
import { holdResource, Unavailable } from './reservations';
import type { Pricing } from './types';

const MAX_PHOTOS = 12;
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export interface InspectionInput {
  odometerKm: number;
  /** Fuel in eighths of a tank (0 empty … 8 full). */
  fuelEighths: number;
  notes?: string;
  photos?: SignedUpload[];
  /** The customer's handover code: the customer was there and agrees with this record. */
  customerCode?: string;
}

export interface ReturnInput extends InspectionInput {
  /** Fuel top-up charge when the policy is full-to-full and the tank came back lower. */
  fuelPaise?: number;
  tollsPaise?: number;
  parkingPaise?: number;
  damage?: { description: string; amountPaise: number }[];
}

interface TripBooking {
  id: string;
  customer_id: string;
  vendor_id: string;
  vendor_user_id: string;
  status: string;
  fulfilment: string;
  booking_type: string;
  starts_at: Date;
  ends_at: Date;
  occupy_from: Date;
  occupy_until: Date;
  day: string;
  snapshot: { mode?: 'with_driver' | 'self_drive'; service?: { pricing?: Pricing }; resource?: { id: string; name: string } | null; answers?: { mode?: string } };
}

const bad = (code: string, message: string, details?: Record<string, unknown>, status = HttpStatus.CONFLICT) => new AppError(code, message, status, details);

@Injectable()
export class TripService {
  constructor(
    private readonly db: Db,
    private readonly cloudinary: CloudinaryService,
    private readonly fulfilment: FulfilmentService,
    private readonly codes: HandoverCodes,
  ) {}

  private async lock(q: Queryable, bookingId: string, who: { vendorUserId?: string; customerId?: string }): Promise<TripBooking> {
    const b = await this.db.one<TripBooking>(
      q,
      `SELECT b.id, b.customer_id, b.vendor_id, v.user_id AS vendor_user_id, b.status, b.fulfilment, b.booking_type, b.starts_at, b.ends_at,
              b.occupy_from, b.occupy_until, b.day, b.snapshot
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.id = $1 AND ($2::uuid IS NULL OR v.user_id = $2) AND ($3::uuid IS NULL OR b.customer_id = $3)
        FOR UPDATE OF b`,
      [bookingId, who.vendorUserId ?? null, who.customerId ?? null],
    );
    if (!b || b.booking_type !== 'transport') throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    return b;
  }

  private mode(b: TripBooking) {
    return b.snapshot.mode ?? (b.snapshot.answers?.mode as 'with_driver' | 'self_drive' | undefined) ?? 'with_driver';
  }

  private confirmed(b: TripBooking) {
    if (b.status !== 'confirmed') throw bad('BOOKING_BAD_STATUS', 'Only confirmed bookings.', { status: b.status });
  }

  /** Inspection photos must be the vendor's own signed uploads. */
  private checkPhotos(vendorId: string, photos: SignedUpload[] = []) {
    return this.cloudinary.evidencePhotoIds(vendorId, photos, MAX_PHOTOS);
  }

  private event(q: Queryable, bookingId: string, event: string, actorId: string | null, data: Record<string, unknown> = {}) {
    return q.query(`INSERT INTO booking_events (booking_id, event, actor_id, data) VALUES ($1, $2, $3, $4)`, [bookingId, event, actorId, data]);
  }

  /**
   * Assigns one of the vendor's approved drivers. The driver is held exclusively for the trip's
   * times, so the same driver can never be on two overlapping trips (`DRIVER_BUSY`).
   */
  async assignDriver(vendorUserId: string, bookingId: string, driverId: string) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.confirmed(b);
      if (this.mode(b) !== 'with_driver') throw bad('SELF_DRIVE', 'This is a self-drive booking; no driver is assigned.');
      if (!['scheduled', 'assigned'].includes(b.fulfilment)) throw bad('FULFILMENT_BAD_STEP', 'The trip has already started.', { fulfilment: b.fulfilment });
      const d = await this.db.one<{ name: string }>(
        client,
        `SELECT name FROM resources WHERE id = $1 AND vendor_id = $2 AND kind = 'driver' AND status = 'active' AND verification = 'approved'`,
        [driverId, b.vendor_id],
      );
      if (!d) throw new AppError('DRIVER_NOT_FOUND', 'Choose one of your approved drivers.', HttpStatus.BAD_REQUEST);
      // A new choice replaces the old one.
      await client.query(
        `UPDATE reservations r SET status = 'released' FROM resources x
          WHERE x.id = r.resource_id AND x.kind = 'driver' AND r.booking_id = $1 AND r.status IN ('hold', 'active')`,
        [b.id],
      );
      try {
        await holdResource(client, driverId, d.name, { bookingId: b.id, vendorId: b.vendor_id, from: b.occupy_from, until: b.occupy_until, status: 'active', expiresAt: null });
      } catch (err) {
        if (err instanceof Unavailable) throw bad('DRIVER_BUSY', `${d.name} is on another trip at that time.`, { driverId });
        throw err;
      }
      await client.query(`UPDATE bookings SET fulfilment = 'assigned', snapshot = jsonb_set(snapshot, '{driver}', $2::jsonb), updated_at = now() WHERE id = $1`, [
        b.id, { id: driverId, name: d.name },
      ]);
      await this.event(client, b.id, 'driver_assigned', vendorUserId, { driverId, name: d.name });
      await notify(client, b.customer_id, 'driver_assigned', {
        en: { title: 'Driver assigned', body: `${d.name} will drive your car.` },
        hi: { title: 'ड्राइवर तय', body: `${d.name} आपकी गाड़ी चलाएँगे।` },
      }, { bookingId: b.id }, 'customer');
    });
  }

  /**
   * The car leaves with the customer (or the driver): odometer, fuel and photos are recorded. Self-
   * drive needs a verified licence and the deposit paid; with-driver trips need a driver assigned.
   */
  async handover(vendorUserId: string, bookingId: string, body: InspectionInput) {
    const byCode = await this.codes.check(vendorUserId, bookingId, body.customerCode);
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.confirmed(b);
      const mode = this.mode(b);
      if (mode === 'with_driver' && b.fulfilment !== 'assigned') throw bad('DRIVER_REQUIRED', 'Assign a driver first.');
      if (!['scheduled', 'assigned'].includes(b.fulfilment)) throw bad('FULFILMENT_BAD_STEP', 'The car is already out.', { fulfilment: b.fulfilment });
      if (b.starts_at.getTime() - Date.now() > 24 * 3600_000) throw bad('TOO_EARLY', 'The handover can be recorded from 24 hours before the start.');
      if (mode === 'self_drive') {
        const lic = await this.db.one<{ status: string; expires_on: string }>(client, 'SELECT status, expires_on FROM customer_licences WHERE user_id = $1', [b.customer_id]);
        if (!lic || lic.status !== 'verified') throw bad('LICENCE_NOT_VERIFIED', "The customer's driving licence is not verified yet.");
        const deposit = await this.db.one<{ due: number }>(
          client,
          `SELECT (b.deposit_paise - ${depositHeldSql('b.id')})::int AS due FROM bookings b WHERE b.id = $1`,
          [b.id],
        );
        if (deposit!.due > 0) throw bad('DEPOSIT_REQUIRED', `The customer must pay the ${rupees(deposit!.due)} deposit before taking the car.`, { duePaise: deposit!.due });
      }
      await client.query(
        `INSERT INTO booking_inspections (booking_id, phase, readings, notes, photo_ids, recorded_by) VALUES ($1, 'handover', $2, $3, $4, $5)`,
        [b.id, { odometerKm: body.odometerKm, fuelEighths: body.fuelEighths }, body.notes?.trim() || null, this.checkPhotos(b.vendor_id, body.photos), vendorUserId],
      );
      if (byCode) await this.codes.confirm(client, b.id, 'handover');
      await client.query(`UPDATE bookings SET fulfilment = 'in_progress', actual_start_at = now(), updated_at = now() WHERE id = $1`, [b.id]);
      await this.event(client, b.id, 'handover', vendorUserId, { odometerKm: body.odometerKm, fuelEighths: body.fuelEighths });
      await notify(client, b.customer_id, 'trip_started', {
        en: { title: 'Car handed over', body: `Odometer ${body.odometerKm} km, fuel ${body.fuelEighths}/8. Check the photos and tell us within 2 hours if anything is wrong.` },
        hi: { title: 'गाड़ी सौंप दी गई', body: `मीटर ${body.odometerKm} किमी, ईंधन ${body.fuelEighths}/8। फ़ोटो देखें और कुछ गलत हो तो 2 घंटे में बताएँ।` },
      }, { bookingId: b.id }, 'customer');
    });
  }

  /**
   * The car is back. Extra km and late hours come from the prices agreed in the booking; fuel,
   * tolls, parking and damage are entered by the vendor with photos. All become proposed charges.
   */
  async returnCar(vendorUserId: string, bookingId: string, body: ReturnInput) {
    const byCode = await this.codes.check(vendorUserId, bookingId, body.customerCode);
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { vendorUserId });
      this.confirmed(b);
      if (b.fulfilment !== 'in_progress') throw bad('FULFILMENT_BAD_STEP', 'Record the handover first.', { fulfilment: b.fulfilment });
      const out = await this.db.one<{ readings: { odometerKm: number; fuelEighths: number } }>(
        client,
        `SELECT readings FROM booking_inspections WHERE booking_id = $1 AND phase = 'handover'`,
        [b.id],
      );
      if (body.odometerKm < out!.readings.odometerKm) {
        throw new AppError('ODOMETER_BELOW_START', `The odometer cannot be below ${out!.readings.odometerKm} km.`, HttpStatus.BAD_REQUEST, { minKm: out!.readings.odometerKm });
      }
      const photos = this.checkPhotos(b.vendor_id, body.photos);
      const p = b.snapshot.service?.pricing ?? ({} as Pricing);
      const now = new Date();
      const bookedHours = (b.ends_at.getTime() - b.starts_at.getTime()) / 3600_000;
      const days = Math.max(1, Math.ceil(bookedHours / 24));
      const km = body.odometerKm - out!.readings.odometerKm;
      const includedKm = p.includedKm !== undefined ? p.includedKm * (p.model === 'daily' || days > 1 ? days : 1) : null;
      const deposit = (await this.db.one<{ paid: number }>(
        client,
        `SELECT ${depositHeldSql('$1')} AS paid`,
        [b.id],
      ))!.paid;
      const charges: { kind: string; description: string; qty: number; amount: number }[] = [];
      if (includedKm !== null && p.extraKmPaise && km > includedKm) {
        // The quote already charged the estimated extra km; only km beyond the estimate are new.
        const quoted = (b.snapshot as { quote?: { lines?: { code: string; qty: number }[] } }).quote?.lines?.find((l) => l.code === 'extra_km')?.qty ?? 0;
        const extra = km - includedKm - quoted;
        if (extra > 0) charges.push({ kind: 'extra_km', description: `${extra} km beyond the ${includedKm} km included (${km} km driven)`, qty: extra, amount: extra * p.extraKmPaise });
      }
      const lateHours = Math.ceil((now.getTime() - b.ends_at.getTime()) / 3600_000);
      if (lateHours > 0 && p.overtimeHourPaise) {
        charges.push({ kind: 'late_return', description: `${lateHours} h after the booked end`, qty: lateHours, amount: lateHours * p.overtimeHourPaise });
      }
      if (body.fuelPaise) charges.push({ kind: 'fuel', description: `Fuel: out ${out!.readings.fuelEighths}/8, back ${body.fuelEighths}/8`, qty: 1, amount: body.fuelPaise });
      if (body.tollsPaise) charges.push({ kind: 'toll', description: 'Tolls', qty: 1, amount: body.tollsPaise });
      if (body.parkingPaise) charges.push({ kind: 'parking', description: 'Parking', qty: 1, amount: body.parkingPaise });
      for (const d of body.damage ?? []) charges.push({ kind: 'damage', description: d.description.trim(), qty: 1, amount: d.amountPaise });
      for (const c of charges) {
        await client.query(
          `INSERT INTO booking_charges (booking_id, kind, description, qty, amount_paise, from_deposit, evidence_ids, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [b.id, c.kind, c.description, c.qty, c.amount, deposit > 0, photos, vendorUserId],
        );
      }
      await client.query(
        `INSERT INTO booking_inspections (booking_id, phase, readings, notes, photo_ids, recorded_by) VALUES ($1, 'return', $2, $3, $4, $5)`,
        [b.id, { odometerKm: body.odometerKm, fuelEighths: body.fuelEighths, km }, body.notes?.trim() || null, photos, vendorUserId],
      );
      if (byCode) await this.codes.confirm(client, b.id, 'return');
      // The car and driver are back: free for other bookings from now.
      await client.query(`UPDATE reservations SET status = 'released' WHERE booking_id = $1 AND status IN ('hold', 'active')`, [b.id]);
      await client.query(`UPDATE capacity_holds SET status = 'released' WHERE booking_id = $1 AND status IN ('hold', 'active')`, [b.id]);
      await client.query(`UPDATE bookings SET fulfilment = 'closed', actual_end_at = now(), updated_at = now() WHERE id = $1`, [b.id]);
      const total = charges.reduce((s, c) => s + c.amount, 0);
      await this.event(client, b.id, 'returned', vendorUserId, { km, chargesPaise: total });
      await notify(client, b.customer_id, 'trip_returned', {
        en: { title: 'Car returned', body: total ? `${km} km driven. Extra charges of ${rupees(total)}: open the booking to accept or dispute them within 48 hours.` : `${km} km driven. No extra charges. Thank you!` },
        hi: { title: 'गाड़ी वापस', body: total ? `${km} किमी चली। ${rupees(total)} के अतिरिक्त चार्ज: 48 घंटे में बुकिंग खोलकर मानें या आपत्ति करें।` : `${km} किमी चली। कोई अतिरिक्त चार्ज नहीं। धन्यवाद!` },
      }, { bookingId: b.id }, 'customer');
    });
    await this.fulfilment.settle(bookingId);
  }

  /** The customer agrees with or disputes the handover or return record. */
  async acknowledge(customerId: string, bookingId: string, phase: 'handover' | 'return', decision: 'agreed' | 'disputed', note?: string) {
    await this.db.tx(async (client) => {
      const b = await this.lock(client, bookingId, { customerId });
      if (decision === 'disputed' && !note?.trim()) throw new AppError('VALIDATION', 'Say what is wrong.', HttpStatus.BAD_REQUEST);
      const r = await client.query(
        `UPDATE booking_inspections SET customer_ack = $3, customer_note = $4, acked_at = now() WHERE booking_id = $1 AND phase = $2 AND customer_ack IS NULL`,
        [b.id, phase, decision, note?.trim() || null],
      );
      if (!r.rowCount) throw bad('ALREADY_ANSWERED', 'Already answered, or not recorded yet.');
      if (decision === 'disputed') {
        await notify(client, b.vendor_user_id, 'inspection_disputed', {
          en: { title: 'Customer disputes the inspection', body: `${note!.trim()}` },
          hi: { title: 'ग्राहक को जाँच पर आपत्ति', body: `${note!.trim()}` },
        }, { bookingId: b.id }, 'partner');
      }
    });
  }

  /** Driver, car, inspections and charges, for the customer, the vendor or an admin. */
  async view(bookingId: string, who: { vendorUserId?: string; customerId?: string }) {
    const b = await this.db.one<TripBooking & { deposit_paise: number; charges_paise: number; deposit_settled_at: Date | null; registration: string | null; amount_paise: number; advance_paise: number; pay_mode: string; deposit_held: number }>(
      this.db,
      `SELECT b.id, b.status, b.fulfilment, b.booking_type, b.starts_at, b.ends_at, b.snapshot, b.deposit_paise, b.charges_paise, b.deposit_settled_at,
              b.amount_paise, b.advance_paise, b.pay_mode, ${depositHeldSql('b.id')} AS deposit_held,
              r.attributes->>'registration' AS registration
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
         LEFT JOIN resources r ON r.id = (b.snapshot->'resource'->>'id')::uuid
        WHERE b.id = $1 AND ($2::uuid IS NULL OR v.user_id = $2) AND ($3::uuid IS NULL OR b.customer_id = $3)`,
      [bookingId, who.vendorUserId ?? null, who.customerId ?? null],
    );
    if (!b || b.booking_type !== 'transport') throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
    const inspections = (await this.db.query(
      `SELECT phase, readings, notes, photo_ids AS "photoIds", recorded_at AS "recordedAt", customer_ack AS "customerAck", customer_note AS "customerNote",
              confirmed_by AS "confirmedBy"
         FROM booking_inspections WHERE booking_id = $1 ORDER BY recorded_at`,
      [bookingId],
    )).rows;
    const charges = (await this.db.query(
      `SELECT id, kind, description, amount_paise AS "amountPaise", status, from_deposit AS "fromDeposit", decision_note AS "decisionNote", created_at AS "createdAt",
              created_at + interval '48 hours' AS "replyBy" FROM booking_charges WHERE booking_id = $1 ORDER BY created_at`,
      [bookingId],
    )).rows;
    const paid = (await this.db.query<{ type: string; paid: number }>(
      `SELECT type, COALESCE(sum(amount_paise), 0)::int AS paid FROM payments WHERE booking_id = $1 AND status IN ('paid', 'refunded') GROUP BY type`,
      [bookingId],
    )).rows;
    // Cash bookings: the customer pays the vendor in person, so nothing is due in the app.
    const cash = b.pay_mode === 'cash';
    const depositPaid = cash ? b.deposit_held : (paid.find((x) => x.type === 'deposit')?.paid ?? 0);
    const finalPaid = paid.find((x) => x.type === 'final')?.paid ?? 0;
    const agreed = charges.filter((c: { status: string }) => ['accepted', 'resolved'].includes(c.status)).reduce((s: number, c: { amountPaise: number }) => s + c.amountPaise, 0);
    const snap = b.snapshot as TripBooking['snapshot'] & { driver?: { id: string; name: string }; route?: unknown };
    // The full registration only once the booking is confirmed.
    const showReg = who.vendorUserId || ['confirmed', 'completed'].includes(b.status);
    return {
      payMode: b.pay_mode,
      fulfilment: b.fulfilment,
      mode: this.mode(b),
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      vehicle: snap.resource ? { name: snap.resource.name, registration: showReg ? b.registration : null } : null,
      driver: snap.driver ?? null,
      route: snap.route ?? null,
      inspections,
      charges,
      deposit: { requiredPaise: b.deposit_paise, paidPaise: depositPaid, keptPaise: b.charges_paise, settledAt: b.deposit_settled_at },
      balancePaidPaise: finalPaid,
      /** What "Pay balance" charges now: the rest of the price plus agreed extras the deposit does not cover. */
      balanceDuePaise: !cash && ['confirmed', 'completed'].includes(b.status) ? Math.max(0, b.amount_paise - b.advance_paise + Math.max(0, agreed - depositPaid) - finalPaid) : 0,
    };
  }

  /**
   * Two hours before a with-driver trip with no driver assigned, the vendor gets one reminder.
   * Returns how many were sent.
   */
  async remindUnassigned(): Promise<number> {
    const { rows } = await this.db.query<{ id: string; vendor_user_id: string; starts_at: Date }>(
      `SELECT b.id, v.user_id AS vendor_user_id, b.starts_at FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.booking_type = 'transport' AND b.status = 'confirmed' AND b.fulfilment = 'scheduled'
          AND COALESCE(b.snapshot->>'mode', 'with_driver') = 'with_driver'
          AND b.starts_at BETWEEN now() AND now() + interval '2 hours'
          AND NOT EXISTS (SELECT 1 FROM booking_events e WHERE e.booking_id = b.id AND e.event = 'assign_reminder')`,
    );
    for (const r of rows) {
      await this.event(this.db, r.id, 'assign_reminder', null);
      await notify(this.db, r.vendor_user_id, 'assign_driver', {
        en: { title: 'Assign a driver', body: 'A car trip starts within 2 hours and has no driver yet.' },
        hi: { title: 'ड्राइवर तय करें', body: '2 घंटे में गाड़ी की बुकिंग शुरू है और अभी ड्राइवर तय नहीं है।' },
      }, { bookingId: r.id }, 'partner');
    }
    return rows.length;
  }
}
