// GST invoices for confirmed bookings. The customer's invoice is issued in the vendor's name (EventSeva
// is the marketplace): a tax invoice when the vendor has a GSTIN and charged GST, else a bill of supply.
// EventSeva's own invoice to the vendor covers the commission (18% GST when PLATFORM_GSTIN is set).
// Until the booking is completed (changes, extra hours and charges can still move the amount) the apps get
// a proforma: same lines, current amounts, no number. On completion each invoice is numbered once, from a
// gap-free series per seller and financial year, and stored as issued.
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config';
import { AppError } from '../common/errors';
import { Db, Queryable } from '../db/db.service';

export const COMMISSION_GST_PERCENT = 18;
const INVOICEABLE = ['confirmed', 'completed'];
/** The "number" of an invoice that is not final yet. */
export const PROFORMA = 'PROFORMA';

interface InvoiceLine {
  description: string;
  qty: number;
  amountPaise: number;
}

export interface InvoiceData {
  title: 'Tax invoice' | 'Bill of supply' | 'Proforma invoice';
  number: string;
  issuedAt: string;
  seller: { name: string; address: string | null; gstin: string | null };
  buyer: { name: string; address: string | null; gstin: string | null };
  booking: { id: string; service: string; from: string | null; until: string | null; day: string };
  lines: InvoiceLine[];
  taxablePaise: number;
  /** Same-state supply assumed: half CGST, half SGST. */
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  /** Customer invoices: what was paid through EventSeva so far. */
  paidPaise?: number;
  refundedPaise?: number;
  note: string;
}

/** Financial year of an instant, India time: April to March, e.g. "2026-27". */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private async nextNumber(q: Queryable, series: string, prefix: string): Promise<string> {
    const r = await this.db.one<{ last: number }>(
      q,
      `INSERT INTO invoice_counters (series, last) VALUES ($1, 1) ON CONFLICT (series) DO UPDATE SET last = invoice_counters.last + 1 RETURNING last`,
      [series],
    );
    return `${prefix}/${String(r!.last).padStart(6, '0')}`;
  }

  /**
   * The invoice for a booking, issued the first time it is asked for. `who` limits it to the
   * booking's customer or vendor (admins pass neither).
   */
  async get(bookingId: string, kind: 'customer' | 'commission', who: { customerId?: string; vendorUserId?: string }): Promise<InvoiceData> {
    return this.db.tx(async (client) => {
      const b = await this.db.one<{
        id: string; status: string; vendor_id: string; booking_type: string; day: string; starts_at: Date | null; ends_at: Date | null;
        amount_paise: number; tax_paise: number; commission_paise: number; refund_paise: number; snapshot: { quote?: { lines: { label: string; qty: number; amountPaise: number; kind: string }[] } } | null;
        business_name: string; vendor_address: string | null; gstin: string | null; customer_name: string | null; venue_address: string | null; title: string | null;
      }>(
        client,
        `SELECT b.id, b.status, b.vendor_id, b.booking_type, b.day, b.starts_at, b.ends_at, b.amount_paise, b.tax_paise, b.commission_paise, b.refund_paise, b.snapshot,
                v.business_name, v.address AS vendor_address, v.gstin, u.name AS customer_name, e.venue_address, COALESCE(s.title, p.title) AS title
           FROM bookings b JOIN vendors v ON v.id = b.vendor_id JOIN users u ON u.id = b.customer_id JOIN events e ON e.id = b.event_id
           LEFT JOIN services s ON s.id = b.service_id LEFT JOIN packages p ON p.id = b.package_id
          WHERE b.id = $1 AND ($2::uuid IS NULL OR b.customer_id = $2) AND ($3::uuid IS NULL OR v.user_id = $3)
          FOR UPDATE OF b`,
        [bookingId, who.customerId ?? null, who.vendorUserId ?? null],
      );
      if (!b) throw new AppError('BOOKING_NOT_FOUND', 'Booking not found.', HttpStatus.NOT_FOUND);
      const issued = await this.db.one<{ data: InvoiceData }>(client, 'SELECT data FROM invoices WHERE booking_id = $1 AND kind = $2', [b.id, kind]);
      if (issued) return issued.data;
      if (!INVOICEABLE.includes(b.status)) throw new AppError('INVOICE_NOT_READY', 'The invoice is ready once the booking is confirmed.', HttpStatus.CONFLICT, { status: b.status });

      const now = new Date();
      const fy = financialYear(now);
      // Not final yet: nothing is numbered or stored.
      const final = b.status === 'completed';
      const numbered = (series: string, prefix: string) => (final ? this.nextNumber(client, series, prefix) : Promise.resolve(PROFORMA));
      const booking = { id: b.id, service: b.title ?? 'Service', from: b.starts_at?.toISOString() ?? null, until: b.ends_at?.toISOString() ?? null, day: b.day };
      let data: InvoiceData;
      if (kind === 'customer') {
        const taxable = b.amount_paise - b.tax_paise;
        const taxInvoice = !!b.gstin && b.tax_paise > 0;
        const lines: InvoiceLine[] = b.snapshot?.quote?.lines
          ? b.snapshot.quote.lines.filter((l) => l.kind !== 'tax' && l.kind !== 'deposit').map((l) => ({ description: l.label, qty: l.qty, amountPaise: l.amountPaise }))
          : [{ description: b.title ?? 'Service', qty: 1, amountPaise: taxable }];
        // Changes after booking (approved extras, extensions) are in the booking amount: show the difference as its own line.
        const listed = lines.reduce((s, l) => s + l.amountPaise, 0);
        if (listed !== taxable) lines.push({ description: 'Changes agreed after booking', qty: 1, amountPaise: taxable - listed });
        const paid = (await this.db.one<{ s: number }>(client, `SELECT COALESCE(sum(amount_paise), 0)::int AS s FROM payments WHERE booking_id = $1 AND type IN ('advance', 'final') AND status IN ('paid', 'refunded')`, [b.id]))!.s;
        data = {
          title: !final ? 'Proforma invoice' : taxInvoice ? 'Tax invoice' : 'Bill of supply',
          number: await numbered(`vendor:${b.vendor_id}:${fy}`, `V${b.vendor_id.slice(0, 6).toUpperCase()}/${fy}`),
          issuedAt: now.toISOString(),
          seller: { name: b.business_name, address: b.vendor_address, gstin: b.gstin },
          buyer: { name: b.customer_name ?? 'Customer', address: b.venue_address, gstin: null },
          booking,
          lines,
          taxablePaise: taxable,
          cgstPaise: taxInvoice ? Math.floor(b.tax_paise / 2) : 0,
          sgstPaise: taxInvoice ? b.tax_paise - Math.floor(b.tax_paise / 2) : 0,
          totalPaise: b.amount_paise,
          paidPaise: paid,
          refundedPaise: b.refund_paise,
          note: `Issued by ${b.business_name} through EventSeva.${taxInvoice ? '' : ' The supplier is not charging GST on this booking.'} Refundable deposits are not part of this invoice.`,
        };
      } else {
        const gstin = this.config.platform.gstin;
        const tax = gstin ? Math.round((b.commission_paise * COMMISSION_GST_PERCENT) / 100) : 0;
        data = {
          title: !final ? 'Proforma invoice' : gstin ? 'Tax invoice' : 'Bill of supply',
          number: await numbered(`platform:${fy}`, `ES/${fy}`),
          issuedAt: now.toISOString(),
          seller: { name: this.config.platform.name, address: this.config.platform.address, gstin },
          buyer: { name: b.business_name, address: b.vendor_address, gstin: b.gstin },
          booking,
          lines: [{ description: `Marketplace commission on booking ${b.id.slice(0, 8)}`, qty: 1, amountPaise: b.commission_paise }],
          taxablePaise: b.commission_paise,
          cgstPaise: Math.floor(tax / 2),
          sgstPaise: tax - Math.floor(tax / 2),
          totalPaise: b.commission_paise + tax,
          note: 'Deducted from your payout for this booking.',
        };
      }
      if (!final) return { ...data, note: `${data.note} Proforma: the final invoice is issued when the booking is completed.` };
      await client.query('INSERT INTO invoices (booking_id, kind, number, issued_at, data) VALUES ($1, $2, $3, $4, $5)', [b.id, kind, data.number, data.issuedAt, data]);
      return data;
    });
  }

  /** A printable page (the apps open it in the browser; "Save as PDF" from there). */
  html(i: InvoiceData): string {
    const row = (l: InvoiceLine) => `<tr><td>${esc(l.description)}</td><td class="n">${l.qty}</td><td class="n">${money(l.amountPaise)}</td></tr>`;
    const party = (label: string, p: InvoiceData['seller']) =>
      `<div><b>${label}</b><br>${esc(p.name)}${p.address ? `<br>${esc(p.address)}` : ''}${p.gstin ? `<br>GSTIN: ${esc(p.gstin)}` : ''}</div>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(i.title)} ${esc(i.number)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#23262f}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin:16px 0}
td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.n{text-align:right}.parties{display:flex;gap:24px;justify-content:space-between;flex-wrap:wrap}small{color:#4a4e5c}</style></head>
<body><h1>${esc(i.title)}</h1><p>No. <b>${esc(i.number)}</b> · ${esc(new Date(i.issuedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }))}</p>
<div class="parties">${party('From', i.seller)}${party('To', i.buyer)}</div>
<p>${esc(i.booking.service)} · ${esc(i.booking.day)}</p>
<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Amount</th></tr></thead><tbody>${i.lines.map(row).join('')}</tbody>
<tfoot><tr><td colspan="2">Taxable value</td><td class="n">${money(i.taxablePaise)}</td></tr>
${i.cgstPaise ? `<tr><td colspan="2">CGST</td><td class="n">${money(i.cgstPaise)}</td></tr><tr><td colspan="2">SGST</td><td class="n">${money(i.sgstPaise)}</td></tr>` : ''}
<tr><td colspan="2"><b>Total</b></td><td class="n"><b>${money(i.totalPaise)}</b></td></tr>
${i.paidPaise !== undefined ? `<tr><td colspan="2">Paid through EventSeva</td><td class="n">${money(i.paidPaise)}</td></tr>` : ''}
${i.refundedPaise ? `<tr><td colspan="2">Refunded</td><td class="n">${money(i.refundedPaise)}</td></tr>` : ''}</tfoot></table>
<small>${esc(i.note)}</small></body></html>`;
  }
}
