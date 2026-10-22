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

const categoryName = (lang: Language) => (lang === 'hi' ? 'c.name_hi' : 'c.name_en');

interface VendorRow {
  id: string;
  user_id: string;
  business_name: string;
  category_id: number;
  category_slug: string;
  category_name: string;
  category_icon: string;
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
    `SELECT v.*, c.slug AS category_slug, c.icon AS category_icon, ${categoryName(lang)} AS category_name, ci.name AS city_name
       FROM vendors v JOIN categories c ON c.id = v.category_id JOIN cities ci ON ci.id = v.city_id
      WHERE v.id = $1 ${audience === 'public' ? "AND v.status = 'approved'" : ''}`,
    [vendorId],
  );
  const v = rows[0];
  if (!v) return undefined;

  const services = await q.query(
    `SELECT id, title, description, price_paise AS "pricePaise", unit, min_guests AS "minGuests",
            max_guests AS "maxGuests", is_active AS "isActive"
       FROM services WHERE vendor_id = $1 AND is_active ORDER BY created_at`,
    [vendorId],
  );
  const packages = await q.query(
    `SELECT id, title, items, price_paise AS "pricePaise", is_active AS "isActive"
       FROM packages WHERE vendor_id = $1 AND is_active ORDER BY price_paise, created_at`,
    [vendorId],
  );

  // Photos and videos: Cloudinary public ids; the apps build the URL with their cloud name.
  // The public sees approved media only; the owner and admins also see what is waiting for review.
  const media = await q.query(
    `SELECT id, type, public_id AS "publicId", width, height, duration_sec AS "durationSec", blurhash,
            is_cover AS "isCover", cover_crop AS "coverCrop", sort_order AS "sortOrder"
            ${audience === 'public' ? '' : ', status, reject_reason AS "rejectReason"'}
       FROM media WHERE vendor_id = $1 AND ${audience === 'public' ? "status = 'approved'" : "status <> 'uploading'"}
      ORDER BY is_cover DESC, sort_order, created_at`,
    [vendorId],
  );

  return {
    id: v.id,
    businessName: v.business_name,
    category: { id: v.category_id, slug: v.category_slug, name: v.category_name, icon: v.category_icon },
    city: { id: v.city_id, name: v.city_name },
    area: v.area,
    address: audience === 'public' ? null : v.address,
    location: v.lat === null || v.lng === null ? null : { lat: num(v.lat), lng: num(v.lng) },
    about: v.about,
    rating: { avg: Number(v.rating_avg), count: v.rating_count },
    services: services.rows,
    packages: packages.rows,
    media: media.rows,
    // Review state is private to the owner and admins.
    ...(audience === 'public'
      ? {}
      : { status: v.status, rejectReason: v.reject_reason, approvedAt: v.approved_at, createdAt: v.created_at }),
  };
}

export type VendorDetail = NonNullable<Awaited<ReturnType<typeof loadVendor>>>;

/** What still has to be filled in before a vendor can be sent for approval. */
export function missingForReview(v: VendorDetail): string[] {
  const missing: string[] = [];
  if (!v.area) missing.push('area');
  if (!v.about || v.about.trim().length < 20) missing.push('about');
  if (v.services.length + v.packages.length === 0) missing.push('services_or_packages');
  if (!v.media.some((m) => m.type === 'photo' && m.status !== 'rejected')) missing.push('photos');
  return missing;
}
