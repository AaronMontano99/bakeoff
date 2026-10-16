import { getRun, listResults } from '@/core/db';
import { bus, laneSnapshot } from '@/core/runner';
import type { RunEvent } from '@/core/types';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events for one run. Live tokens come from the in-process bus
 * (runs started in this server). Finished results are also polled from
 * SQLite, so runs started from the CLI show up live too.
 */
export async function GET(req: Request, ctx: RouteContext<'/api/runs/[id]/events'>) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let lastId = Number(new URL(req.url).searchParams.get('after') ?? 0);
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: RunEvent | { kind: 'ping' }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const onEvent = (e: RunEvent) => {
        if (e.kind === 'done') lastId = Math.max(lastId, e.result.id);
        send(e);
      };
      bus.on(`run:${id}`, onEvent);
      for (const e of laneSnapshot(id)) send(e);

      const poll = setInterval(() => {
        const fresh = listResults(id, lastId);
        for (const r of fresh) {
          lastId = Math.max(lastId, r.id);
          send({ kind: 'done', runId: id, key: `db-${r.id}`, result: r });
        }
        const run = getRun(id);
        if (run) send({ kind: 'status', runId: id, status: run.status });
      }, 1_500);

      const cleanup = () => {
        closed = true;
        clearInterval(poll);
        bus.off(`run:${id}`, onEvent);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
