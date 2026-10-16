import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite is a Node builtin; keep the bundler's hands off it.
  serverExternalPackages: ['@anthropic-ai/sdk'],
  devIndicators: false,
};

export default nextConfig;
