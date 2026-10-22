import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The shared package ships TypeScript source.
  transpilePackages: ['@eventseva/app-shared', '@eventseva/core'],
};

export default nextConfig;
