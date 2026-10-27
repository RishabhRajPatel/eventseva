import type { Language, VendorStatus } from '@eventseva/core';
import { Queryable } from '../db/db.service';

export const PRICING_UNITS = [
  'per_event',
  'per_day',
  'per_shift',
  'per_plate',
  'per_hour',
  'per_km',
  'per_room_night',
  'per_person',
  'package',
] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

/** Vendor gallery only: not photos of rental items, vehicles or extras. */
export const GALLERY = 'inventory_item_id IS NULL AND resource_id IS NULL AND addon_id IS NULL';

const categoryName = (lang: Language) => (lang === 'hi' ? 'c.name_hi' : 'c.name_en');

interface VendorRow {
  id: string;
  user_id: string;
  business_name: string;
  category_id: number;
  category_slug: string;
  category_name: string;
  category_icon: string;
  category_booking_type: string;
  city_id: number;
  city_name: string;
  area: string | null;
  address: string | null;
  lat: string | null;
  lng: string | null;
  about: string | null;
  status: VendorStatus;
  reject_reason: string | null;
  rating_avg: string;
  rating_count: number;
  approved_at: Date | null;
  featured_until: Date | null;
  service_radius_km: number | null;
  gstin: string | null;
  created_at: Date;
}

const num = (v: string | null) => (v === null ? null : Number(v));

/**
 * One vendor with its services and packages. `audience` decides what is shown:
 * the public sees only approved vendors and active items; the owner and admins see everything.
 */
export async function loadVendor(
  q: Queryable,
  vendorId: string,
  lang: Language,
  audience: 'public' | 'owner' | 'admin',
) {
  const { rows } = await q.query<VendorRow>(
    `SELECT v.*, c.slug AS category_slug, c.icon AS category_icon, c.booking_type AS category_booking_type, ${categoryName(lang)} AS category_name, ci.name AS city_name
       FROM vendors v JOIN categories c ON c.id = v.category_id JOIN cities ci ON ci.id = v.city_id
      WHERE v.id = $1 ${audience === 'public' ? "AND v.status = 'approved'" : ''}`,
    [vendorId],
  );
  const v = rows[0];
  if (!v) return undefined;

  const services = await q.query(
    `SELECT id, title, description, price_paise AS "pricePaise", unit, min_guests AS "minGuests",
            max_guests AS "maxGuests", is_active AS "isActive"
       FROM services WHERE vendor_id = $1 AND is_active AND booking_type = 'slot' ORDER BY created_at`,
    [vendorId],
  );
  const packages = await q.query(
    `SELECT id, title, items, price_paise AS "pricePaise", is_active AS "isActive"
       FROM packages WHERE vendor_id = $1 AND is_active ORDER BY price_paise, created_at`,
    [vendorId],
  );

  const rentals = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM inventory_items WHERE vendor_id = $1 AND is_active AND deleted_at IS NULL`,
    [vendorId],
  );
  const engine = await q.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM services WHERE vendor_id = $1 AND is_active AND booking_type NOT IN ('slot', 'rental')`,
    [vendorId],
  );

  // Photos and videos: Cloudinary public ids; the apps build the URL with their cloud name.
  // The public sees approved media only; the owner and admins also see what is waiting for review.
  const media = await q.query(
    `SELECT id, type, public_id AS "publicId", width, height, duration_sec AS "durationSec", blurhash,
            is_cover AS "isCover", cover_crop AS "coverCrop", sort_order AS "sortOrder"
            ${audience === 'public' ? '' : ', status, reject_reason AS "rejectReason"'}
       FROM media WHERE vendor_id = $1 AND ${GALLERY} AND ${audience === 'public' ? "status = 'approved'" : "status <> 'uploading'"}
      ORDER BY is_cover DESC, sort_order, created_at`,
    [vendorId],
  );

  return {
    id: v.id,
    businessName: v.business_name,
    category: { id: v.category_id, slug: v.category_slug, name: v.category_name, icon: v.category_icon, bookingType: v.category_booking_type },
    city: { id: v.city_id, name: v.city_name },
    area: v.area,
    address: audience === 'public' ? null : v.address,
    // Like the address, the exact pin is private: customers only ever see a distance.
    location: audience === 'public' || v.lat === null || v.lng === null ? null : { lat: num(v.lat), lng: num(v.lng) },
    /** How far the vendor usually travels (km), or null. */
    serviceRadiusKm: v.service_radius_km ?? null,
    about: v.about,
    rating: { avg: Number(v.rating_avg), count: v.rating_count },
    services: services.rows,
    packages: packages.rows,
    /** Items on rent (tent, furniture, utensils …); the app opens GET /v1/vendors/:id/rentals when > 0. */
    rentalItemCount: rentals.rows[0].n,
    /** Services booked by time / quantity (cars, staff, catering …); the app opens GET /v1/vendors/:id/engine-services when > 0. */
    engineServiceCount: engine.rows[0].n,
    media: media.rows,
    // Review state is private to the owner and admins.
    ...(audience === 'public'
      ? {}
      : {
          status: v.status,
          rejectReason: v.reject_reason,
          approvedAt: v.approved_at,
          createdAt: v.created_at,
          featuredUntil: v.featured_until && v.featured_until > new Date() ? v.featured_until : null,
          gstin: v.gstin,
        }),
  };
}

export type VendorDetail = NonNullable<Awaited<ReturnType<typeof loadVendor>>>;

/** What still has to be filled in before a vendor can be sent for approval. */
export function missingForReview(v: VendorDetail): string[] {
  const missing: string[] = [];
  if (!v.area) missing.push('area');
  if (!v.about || v.about.trim().length < 20) missing.push('about');
  if (v.services.length + v.packages.length + v.rentalItemCount + v.engineServiceCount === 0) missing.push('services_or_packages');
  if (!v.media.some((m) => m.type === 'photo' && m.status !== 'rejected')) missing.push('photos');
  return missing;
}
