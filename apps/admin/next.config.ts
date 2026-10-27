import type { NextConfig } from 'next';

// The backend has no CORS, so the browser talks to it through this same-origin rewrite.
// Rewrites are written into the build output: set API_URL when running `next build`.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// Security headers on every page.
// - The CSP lets the panel load only its own code, fonts (self-hosted by next/font) and Cloudinary images.
// - It may talk only to its own /api.
// - No other site can frame it (clickjacking).
// - Admin URLs (booking and vendor ids) are never sent to other sites as a referrer.
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  // Next inlines its bootstrap script; dev mode also needs eval for fast refresh.
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://res.cloudinary.com",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // Every page is a static shell; data is fetched in the browser with the admin token,
  // which lives in sessionStorage and never reaches the Next server.
  cacheComponents: true,
  partialPrefetching: true,
  // The shared package ships TypeScript source.
  transpilePackages: ['@eventseva/app-shared', '@eventseva/core'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
