import { setHumanGrade } from '@/core/db';

export async function POST(req: Request, ctx: RouteContext<'/api/results/[id]/grade'>) {
  const { id } = await ctx.params;
  const { score } = (await req.json()) as { score: number | null };
  if (score != null && (!Number.isInteger(score) || score < 1 || score > 5)) return Response.json({ error: 'Score must be 1-5' }, { status: 400 });
  setHumanGrade(Number(id), score);
  return Response.json({ ok: true });
}
