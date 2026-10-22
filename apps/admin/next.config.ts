import type { NextConfig } from 'next';

// The backend has no CORS, so the browser talks to it through this same-origin rewrite.
// Rewrites are written into the build output: set API_URL when running `next build`.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const nextConfig: NextConfig = {
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
