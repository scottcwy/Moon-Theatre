import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['postgres'],
  webpack(config, { nextRuntime }) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };

    // instrumentation.ts is also compiled into the edge bundle, and
    // serverExternalPackages does not exempt it in webpack mode. Keep the
    // node-only postgres driver out of that graph; the edge branch never
    // executes the scheduler import (register() guards NEXT_RUNTIME).
    if (nextRuntime === 'edge' && Array.isArray(config.externals)) {
      config.externals.push('postgres');
    }

    return config;
  },
};

export default nextConfig;
