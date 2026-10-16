import fs from 'node:fs';
import path from 'node:path';
import type { Pricing, Target, DedicatedPricing } from './types';

const FILE = () => path.join(process.cwd(), 'config', 'targets.json');

interface TargetsFile {
  _readme?: string;
  targets: Target[];
}

function read(): TargetsFile {
  return JSON.parse(fs.readFileSync(FILE(), 'utf8')) as TargetsFile;
}

export function loadTargets(): Target[] {
  return read().targets;
}

export function getTarget(id: string): Target | undefined {
  return loadTargets().find((t) => t.id === id);
}

/** Price edits from the UI land back in config/targets.json, so they're versioned with the repo. */
export function updateTarget(id: string, patch: { pricing?: Partial<Pricing>; dedicated?: Partial<DedicatedPricing>; enabled?: boolean; model?: string }): Target {
  const file = read();
  const idx = file.targets.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`Unknown target ${id}`);
  const t = file.targets[idx]!;
  const next: Target = {
    ...t,
    ...(patch.model != null ? { model: patch.model } : {}),
    ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
    pricing: { ...t.pricing, ...(patch.pricing ?? {}) },
    ...(patch.dedicated || t.dedicated ? { dedicated: { hourlyUsd: null, ...t.dedicated, ...(patch.dedicated ?? {}) } } : {}),
  };
  file.targets[idx] = next;
  fs.writeFileSync(FILE(), JSON.stringify(file, null, 2) + '\n');
  return next;
}
