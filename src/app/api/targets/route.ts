import { targetsWithStatus } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return Response.json(await targetsWithStatus(new URL(req.url).searchParams.has('fresh')));
}
