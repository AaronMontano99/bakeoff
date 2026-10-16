import 'server-only';
import { listResults } from '@/core/db';
import { checkTarget } from '@/core/providers';
import { loadTargets } from '@/core/targets';
import { listRuns } from '@/core/db';
import { median } from './median';
import type { Target, TargetStatus } from '@/core/types';

const g = globalThis as unknown as { __statusCache?: { at: number; key: string; statuses: TargetStatus[] } };

/** Status checks spawn `claude auth status` and ping Ollama; cache them briefly so pages stay snappy. */
async function statuses(targets: Target[], fresh: boolean): Promise<TargetStatus[]> {
  const key = targets.map((t) => `${t.id}:${t.enabled}:${t.model}`).join('|') + Object.keys(process.env).filter((k) => k.endsWith('_API_KEY') && process.env[k]).join(',');
  const c = g.__statusCache;
  if (!fresh && c && c.key === key && Date.now() - c.at < 20_000) return c.statuses;
  const s = await Promise.all(targets.map(checkTarget));
  g.__statusCache = { at: Date.now(), key, statuses: s };
  return s;
}

/** Targets with a live status and what history says about their speed and price (for the run builder's estimate). */
export async function targetsWithStatus(fresh = false) {
  const targets = loadTargets();
  const statusList = await statuses(targets, fresh);
  const history: Record<string, { medianMs: number | null; medianCost: number | null }> = {};
  const recent = listRuns().slice(0, 10);
  const rows = recent.flatMap((r) => listResults(r.id)).filter((r) => r.ok && r.phase === 'quality');
  for (const t of targets) {
    const mine = rows.filter((r) => r.targetId === t.id);
    history[t.id] = {
      medianMs: median(mine.map((r) => r.totalMs)),
      medianCost: mine.every((r) => r.costUsd != null) ? median(mine.map((r) => r.costUsd as number)) : null,
    };
  }
  return targets.map((t, i) => ({ ...t, status: statusList[i]!, history: history[t.id]! }));
}
