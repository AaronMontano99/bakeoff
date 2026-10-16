import { getRun, setRunStatus } from '@/core/db';
import { cancelRun } from '@/core/runner';

export async function POST(_req: Request, ctx: RouteContext<'/api/runs/[id]/cancel'>) {
  const { id } = await ctx.params;
  // A run started from the CLI lives in another process; mark it cancelled so the UI stops waiting.
  if (!cancelRun(id) && getRun(id)) setRunStatus(id, 'cancelled', 'Cancelled from the dashboard');
  return Response.json({ ok: true });
}
