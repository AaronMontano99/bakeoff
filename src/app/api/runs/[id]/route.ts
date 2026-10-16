import { deleteRun, getRun, listResults } from '@/core/db';
import { cancelRun } from '@/core/runner';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params;
  const run = getRun(id);
  if (!run) return Response.json({ error: 'Run not found' }, { status: 404 });
  return Response.json({ run, results: listResults(id) });
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params;
  cancelRun(id);
  deleteRun(id);
  return Response.json({ ok: true });
}
