import { z } from 'zod';
import { businessCase, defaultCaseInputs, summarize } from '@/core/analysis';
import { listResults, listRuns } from '@/core/db';
import { startRun } from '@/core/runner';
import { loadTargets } from '@/core/targets';

export const dynamic = 'force-dynamic';

export async function GET() {
  const targets = loadTargets();
  const runs = listRuns().map((run) => {
    if (run.status !== 'done') return { ...run, headline: null, best: null };
    const sums = summarize(listResults(run.id), run.config.targetIds);
    const best = [...sums].sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))[0];
    return { ...run, headline: businessCase(sums, targets, defaultCaseInputs()).headline, best: best ? { targetId: best.targetId, quality: best.quality } : null };
  });
  return Response.json(runs);
}

const RunConfigSchema = z.object({
  name: z.string().min(1).max(120),
  targetIds: z.array(z.string()).min(1),
  taskTypes: z.array(z.enum(['signal', 'debrief', 'email', 'callcard'])).min(1),
  tasksPerType: z.number().int().min(1).max(50),
  repeats: z.number().int().min(1).max(10),
  concurrency: z.array(z.number().int().min(1).max(64)).max(6),
  loadRequests: z.number().int().min(1).max(200),
  parallelTargets: z.boolean(),
  judge: z.object({ enabled: z.boolean(), targetId: z.string() }),
});

export async function POST(req: Request) {
  const parsed = RunConfigSchema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid run config' }, { status: 400 });
  return Response.json({ id: startRun(parsed.data) });
}
