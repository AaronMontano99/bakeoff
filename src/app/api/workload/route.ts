import { buildPrompt, loadWorkload } from '@/core/workload';

export const dynamic = 'force-dynamic';

export async function GET() {
  const w = loadWorkload();
  return Response.json({ ...w, tasks: w.tasks.map((t) => ({ ...t, prompt: buildPrompt(t, w) })) });
}
