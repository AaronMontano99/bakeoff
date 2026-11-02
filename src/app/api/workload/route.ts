import { buildPrompt, DEFAULT_WORKLOAD, loadWorkload, WORKLOAD_ORDER } from '@/core/workload';
import type { WorkloadId } from '@/core/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const id = (new URL(req.url).searchParams.get('id') ?? DEFAULT_WORKLOAD) as WorkloadId;
  if (!WORKLOAD_ORDER.includes(id)) return Response.json({ error: `Unknown workload ${id}` }, { status: 404 });
  const w = loadWorkload(id);
  return Response.json({ ...w, tasks: w.tasks.map((t) => ({ ...t, prompt: buildPrompt(t, w) })) });
}
