import { updateTarget } from '@/core/targets';

export async function PATCH(req: Request, ctx: RouteContext<'/api/targets/[id]'>) {
  const { id } = await ctx.params;
  try {
    return Response.json(updateTarget(id, await req.json()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
