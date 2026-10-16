'use client';

import { Gauge } from 'lucide-react';
import { useState } from 'react';
import type { ResultRow } from '@/core/types';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { LineChart, StripPlot } from '@/components/charts';
import { ButtonLink, Card, CardHeader, EmptyState, Segmented } from '@/components/ui';
import { fmt } from '@/lib/format';
import type { RunModel } from '@/lib/run-model';
import { percentile } from '@/core/stats';

export function LatencyTab({ results, model }: { results: ResultRow[]; model: RunModel }) {
  const [metric, setMetric] = useState<'ttft' | 'total'>('ttft');
  const [type, setType] = useState<'all' | (typeof TASK_TYPE_ORDER)[number]>('all');
  const quality = results.filter((r) => r.phase === 'quality' && r.ok && (type === 'all' || r.taskType === type));
  const presentTypes = TASK_TYPE_ORDER.filter((t) => results.some((r) => r.taskType === t));

  const rows = model.ids.map((id) => {
    const m = model.meta(id);
    const mine = quality.filter((r) => r.targetId === id);
    const vals = mine.map((r) => ({ ms: (metric === 'ttft' ? r.ttftMs : r.totalMs) ?? NaN, label: TASK_TYPES[r.taskType].label })).filter((v) => Number.isFinite(v.ms));
    return { id, label: m.label, color: m.color, values: vals, p50: percentile(vals.map((v) => v.ms), 50), p95: percentile(vals.map((v) => v.ms), 95) };
  });

  const load = model.load;
  const loadIds = [...new Set(load.map((l) => l.targetId))];
  const series = (pick: (l: (typeof load)[number]) => number | null) =>
    loadIds.map((id) => ({
      id,
      label: model.meta(id).label,
      color: model.meta(id).color,
      points: load.filter((l) => l.targetId === id && pick(l) != null).map((l) => ({ x: l.concurrency, y: pick(l)! })),
    }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={metric === 'ttft' ? 'Time to first token' : 'Total request time'}
          subtitle={metric === 'ttft' ? 'How long until the rep sees anything. Thinking models spend part of this reasoning.' : 'Start to last token. What a background job waits on.'}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Segmented size="sm" value={type} onChange={setType} options={[{ value: 'all' as const, label: 'All jobs' }, ...presentTypes.map((t) => ({ value: t, label: TASK_TYPES[t].short }))]} />
              <Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'ttft', label: 'First token' }, { value: 'total', label: 'Total' }]} />
            </div>
          }
        />
        <div className="px-5 pb-5">
          <StripPlot rows={rows} metric={metric === 'ttft' ? 'Time to first token' : 'Total time'} />
          {model.ids.some((id) => model.meta(id).target?.provider === 'claude-cli') && (
            <p className="mt-3 text-[12.5px] text-ink-4">Claude Code timings include starting the CLI process for each request, so they overstate raw API latency.</p>
          )}
        </div>
      </Card>

      {load.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Gauge className="size-5" />}
            title="No load test in this run"
            body="Latency at one request in flight says little about production. Run a load test to see how p95 and throughput hold up with 4, 8 or 16 concurrent requests."
            action={<ButtonLink href="/runs/new?preset=load" variant="primary">Set up a load test</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="p95 latency under load" subtitle="Flat is good. A steep climb means requests are queueing." />
            <div className="px-4 pb-4">
              <LineChart series={series((l) => l.totalP95)} xLabel="Requests in flight →" yLabel="p95 seconds" xLog xFormat={(v) => String(v)} yFormat={(v) => `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}s`} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Throughput" subtitle="Output tokens per second across all in-flight requests." />
            <div className="px-4 pb-4">
              <LineChart series={series((l) => l.outputTokensPerSec)} xLabel="Requests in flight →" yLabel="Output tok/s" xLog xFormat={(v) => String(v)} yFormat={(v) => fmt.compact(v)} />
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Load test detail" />
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-mist/60 text-left text-[12px] text-ink-3">
                    <th className="py-2 pl-5 font-medium">Target</th>
                    <th className="px-3 text-right font-medium">In flight</th>
                    <th className="px-3 text-right font-medium">Requests</th>
                    <th className="px-3 text-right font-medium">p50</th>
                    <th className="px-3 text-right font-medium">p95</th>
                    <th className="px-3 text-right font-medium">Req/s</th>
                    <th className="px-3 text-right font-medium">Out tok/s</th>
                    <th className="pr-5 pl-3 text-right font-medium">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {load.map((l) => (
                    <tr key={`${l.targetId}-${l.concurrency}`} className="tabular border-b border-line last:border-b-0">
                      <td className="py-2.5 pl-5 text-ink-2">{model.meta(l.targetId).label}</td>
                      <td className="px-3 text-right">{l.concurrency}</td>
                      <td className="px-3 text-right">{l.n}</td>
                      <td className="px-3 text-right">{fmt.sec(l.totalP50)}</td>
                      <td className="px-3 text-right font-medium">{fmt.sec(l.totalP95)}</td>
                      <td className="px-3 text-right">{l.requestsPerSec?.toFixed(2) ?? '—'}</td>
                      <td className="px-3 text-right">{fmt.compact(l.outputTokensPerSec)}</td>
                      <td className={`pr-5 pl-3 text-right ${l.errorRate > 0 ? 'text-bad' : ''}`}>{fmt.pct(l.errorRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
