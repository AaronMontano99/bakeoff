import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { generateRegistry } from './scripts/gen-workloads.mjs';

generateRegistry();

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: { include: ['tests/**/*.test.ts', 'workloads/**/*.test.ts'] },
});
