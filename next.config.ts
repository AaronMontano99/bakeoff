import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite is a Node builtin; keep the bundler's hands off it.
  serverExternalPackages: ['@anthropic-ai/sdk'],
  devIndicators: false,
  // Read from disk at runtime, so the hosted demo has to ship them.
  outputFileTracingIncludes: { '/**': ['./demo/snapshot.json', './config/targets.json', './workloads/**/*'] },
};

export default nextConfig;
