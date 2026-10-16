'use client';

import { ArrowRight, Check, FileText, RotateCcw, Server, TriangleAlert, X } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { crossover, defaultCaseInputs, type CaseInputs } from '@/core/analysis';
import { TASK_TYPES } from '@/core/workload/meta';
import { LineChart } from '@/components/charts';
import { Button, ButtonLink, Card, CardHeader, cx, Stat, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import type { RunModel } from '@/lib/run-model';
import type { TargetWithStatus } from '@/lib/types-client';

export function CaseTab({ runId, model, inputs, setInputs, targets }: { runId: string; model: RunModel; inputs: CaseInputs; setInputs: Dispatch<SetStateAction<CaseInputs>>; targets: TargetWithStatus[] }) {
  const { bc, meta } = model;
  const totalVolume = bc.routes.reduce((a, r) => a + r.monthlyVolume, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Assumptions */}
      <Card className="h-fit p-5 lg:sticky lg:top-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold">Assumptions</h3>
          <button onClick={() => setInputs(defaultCaseInputs())} className="flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">
            <RotateCcw className="size-3" /> Reset
          </button>
        </div>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">Everything recalculates as you type. Saved in this browser.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Num label="Reps" value={inputs.reps} onChange={(v) => setInputs((i) => ({ ...i, reps: v }))} min={1} />
          <Num label="Workdays / mo" value={inputs.workdays} onChange={(v) => setInputs((i) => ({ ...i, workdays: v }))} min={1} max={31} />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between text-[12.5px] font-medium text-ink-2">
            Quality bar <span className="tabular text-forest-700">{Math.round(inputs.qualityBar * 100)}</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={0.98}
            step={0.01}
            value={inputs.qualityBar}
            onChange={(e) => setInputs((i) => ({ ...i, qualityBar: Number(e.target.value) }))}
            className="mt-2 w-full accent-[#1c6446]"
            aria-label="Quality bar"
          />
          <p className="text-[12px] text-ink-4">A job only routes to a model that scores at least this.</p>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <div className="grid grid-cols-[1fr_64px_64px] gap-x-2 gap-y-2 text-[12px]">
            <span className="font-medium text-ink-3">Job</span>
            <span className="text-right font-medium text-ink-3" title="Requests per rep per workday">Per rep/day</span>
            <span className="text-right font-medium text-ink-3" title="p95 latency budget in seconds">p95 budget</span>
            {bc.routes.map((r) => (
              <Row key={r.taskType} label={TASK_TYPES[r.taskType].label}>
                <SmallNum value={inputs.perRepPerDay[r.taskType]} onChange={(v) => setInputs((i) => ({ ...i, perRepPerDay: { ...i.perRepPerDay, [r.taskType]: v } }))} />
                <SmallNum value={inputs.sloMs[r.taskType] / 1000} suffix="s" onChange={(v) => setInputs((i) => ({ ...i, sloMs: { ...i.sloMs, [r.taskType]: Math.max(1, v) * 1000 } }))} />
              </Row>
            ))}
          </div>
          <p className="tabular mt-3 text-[12px] text-ink-4">{fmt.int(totalVolume)} requests a month in total.</p>
        </div>
      </Card>

      <div className="min-w-0 space-y-6">
        <Card className="overflow-hidden">
          <div className="bg-forest-800 px-6 py-5 text-white">
            <div className="text-[12px] font-semibold tracking-wide text-forest-300 uppercase">Recommendation</div>
            <p className="mt-1.5 text-[19px] leading-snug font-medium tracking-[-0.01em] text-balance">{bc.headline}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <Stat label="Routed, per month" value={fmt.usdShort(bc.routedMonthly)} sub={bc.routedCount < bc.routes.length ? `${bc.routedCount} of ${bc.routes.length} jobs routed` : 'Cheapest model that clears the bar, per job'} />
            <Stat label={bc.baselineTargetId ? `All on ${meta(bc.baselineTargetId).label}` : 'One model for everything'} value={fmt.usdShort(bc.baselineMonthly)} sub={bc.routedCount < bc.routes.length ? `Same ${bc.routedCount} jobs, best-scoring model` : 'The best-scoring priced model, everywhere'} />
            <Stat label="Difference" value={bc.savingsPct == null ? '—' : `${Math.round(bc.savingsPct * 100)}%`} sub={bc.routedMonthly != null && bc.baselineMonthly != null ? `${fmt.usdShort(bc.baselineMonthly - bc.routedMonthly)} a month` : 'Needs prices on both sides'} />
          </div>
          {bc.gaps.length > 0 && (
            <div className="mx-4 mb-4 space-y-1.5 rounded-xl border border-[#f1dcb2] bg-[#fdf6e9] p-3">
              {bc.gaps.map((g) => (
                <div key={g.taskType} className="flex flex-wrap items-start gap-2 text-[13px] text-warn sm:flex-nowrap">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span className="flex-1">{g.message}</span>
                  {g.fix && (
                    <button
                      onClick={() =>
                        setInputs((i) => ({
                          ...i,
                          ...(g.fix!.qualityBar != null ? { qualityBar: g.fix!.qualityBar } : {}),
                          ...(g.fix!.sloMs != null ? { sloMs: { ...i.sloMs, [g.taskType]: g.fix!.sloMs } } : {}),
                        }))
                      }
                      className="shrink-0 rounded-lg border border-[#e7c98d] bg-paper px-2.5 py-1 text-[12.5px] font-medium text-[#7a4d0c] hover:bg-[#fffaf0]"
                    >
                      {g.fix.label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {bc.routes.map((r) => (
          <Card key={r.taskType}>
            <CardHeader
              title={TASK_TYPES[r.taskType].label}
              subtitle={`${fmt.int(r.monthlyVolume)} requests/mo · p95 budget ${fmt.sec(inputs.sloMs[r.taskType], 0)} · ${TASK_TYPES[r.taskType].profile}`}
              action={r.pick && <span className="flex items-center gap-1.5 rounded-full bg-sage-50 px-2.5 py-1 text-[12.5px] font-medium text-forest-800 ring-1 ring-sage-200"><Check className="size-3.5" /> {meta(r.pick.targetId).label}</span>}
            />
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[620px] text-[13px]">
                <thead>
                  <tr className="border-y border-line bg-mist/60 text-left text-[12px] text-ink-3">
                    <th className="py-2 pl-5 font-medium">Target</th>
                    <th className="px-3 text-right font-medium">Quality</th>
                    <th className="px-3 text-right font-medium">p95</th>
                    <th className="px-3 text-right font-medium">$/req</th>
                    <th className="px-3 text-right font-medium">Per month</th>
                    <th className="pr-5 pl-3 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.options].sort((a, b) => Number(b.eligible) - Number(a.eligible) || (a.costPerRequest ?? 1e9) - (b.costPerRequest ?? 1e9)).map((o) => {
                    const picked = r.pick?.targetId === o.targetId;
                    return (
                      <tr key={o.targetId} className={cx('border-b border-line last:border-b-0', picked && 'bg-sage-50/70')}>
                        <td className="py-2.5 pl-5">
                          <span className="flex items-center gap-2 font-medium whitespace-nowrap">
                            <Swatch color={meta(o.targetId).color} />
                            {meta(o.targetId).label}
                          </span>
                        </td>
                        <td className={cx('tabular px-3 text-right', o.quality != null && o.quality < inputs.qualityBar && 'text-bad')}>{fmt.score(o.quality)}</td>
                        <td className={cx('tabular px-3 text-right', o.p95 != null && o.p95 > inputs.sloMs[r.taskType] && 'text-bad')}>{fmt.sec(o.p95)}</td>
                        <td className="tabular px-3 text-right">{fmt.usd(o.costPerRequest)}</td>
                        <td className="tabular px-3 text-right font-medium">{fmt.usd(o.monthlyCost)}</td>
                        <td className="pr-5 pl-3">
                          {picked ? (
                            <span className="inline-flex items-center gap-1 text-forest-700"><Check className="size-3.5" /> Route here</span>
                          ) : o.eligible ? (
                            <span className="text-ink-3">Clears the bar, costs more</span>
                          ) : (
                            <span className="inline-flex items-start gap-1 text-ink-3"><X className="mt-0.5 size-3.5 shrink-0 text-bad" /> {o.why.join('; ')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}

        <Crossovers model={model} targets={targets} totalVolume={totalVolume} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-mist/50 px-5 py-4">
          <div>
            <div className="text-[14px] font-medium">Send it to someone</div>
            <div className="text-[13px] text-ink-3">A one-page brief with these assumptions, the routing table and the method.</div>
          </div>
          <ButtonLink href={`/runs/${runId}/brief`} variant="primary" icon={<FileText className="size-4" />}>
            Open the brief <ArrowRight className="size-3.5" />
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

function Crossovers({ model, targets, totalVolume }: { model: RunModel; targets: TargetWithStatus[]; totalVolume: number }) {
  const candidates = model.ids.map((id) => targets.find((t) => t.id === id)).filter((t): t is TargetWithStatus => !!t && !!t.dedicated);
  if (!candidates.length) return null;
  return (
    <Card>
      <CardHeader title="Serverless vs dedicated" subtitle="Per-token pricing wins at low volume; a reserved GPU wins once it stays busy. Where’s the line for this workload?" />
      <div className="space-y-6 px-5 pb-5">
        {candidates.map((t) => (
          <CrossoverRow key={t.id} t={t} model={model} totalVolume={totalVolume} />
        ))}
      </div>
    </Card>
  );
}

function CrossoverRow({ t, model, totalVolume }: { t: TargetWithStatus; model: RunModel; totalVolume: number }) {
  const [hourly, setHourly] = useState<string>(t.dedicated?.hourlyUsd?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const summary = model.summaries.find((s) => s.targetId === t.id);
  const target = { ...t, dedicated: { ...t.dedicated, hourlyUsd: hourly ? Number(hourly) : null } };
  const x = crossover(target, summary?.costPerRequest ?? null, model.load, totalVolume);
  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/targets/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dedicated: { hourlyUsd: hourly ? Number(hourly) : null } }) });
    setSaving(false);
    if (res.ok) toast.success('Saved to config/targets.json');
    else toast.error('Couldn’t save the price');
  };
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Server className="size-4 text-ink-3" />
        <span className="text-[14px] font-medium">{t.label}</span>
        <span className="text-[12.5px] text-ink-4">{t.dedicated?.gpu}</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-[12.5px] text-ink-3" htmlFor={`h-${t.id}`}>GPU $/hour</label>
          <input id={`h-${t.id}`} value={hourly} onChange={(e) => setHourly(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="e.g. from pricing page" className="tabular h-8 w-36 rounded-lg border border-line-strong px-2.5 text-[13px] outline-none focus:border-forest-500 focus:shadow-[var(--ring)]" />
          <Button size="sm" onClick={save} loading={saving} disabled={hourly === (t.dedicated?.hourlyUsd?.toString() ?? '')}>Save</Button>
        </div>
      </div>
      {x ? (
        <div className="mt-4">
          <p className="mb-3 text-[13.5px] text-ink-2">
            One replica handled <b>{x.replicaRps.toFixed(2)} req/s</b> in the load test. At {fmt.usd(x.costPerRequest)} per request serverless, a dedicated replica pays for itself above{' '}
            <b>{fmt.compact(x.breakEvenMonthly)} requests/month</b>. This workload is {fmt.compact(totalVolume)}/month: {totalVolume >= x.breakEvenMonthly ? 'dedicated is cheaper.' : 'stay serverless for now.'}
          </p>
          <LineChart
            series={[
              { id: 'serverless', label: 'Serverless (per token)', color: '#2a78d6', points: x.curve.map((p) => ({ x: p.volume, y: p.serverless })) },
              { id: 'dedicated', label: 'Dedicated (per GPU-hour, 60% utilization)', color: '#eb6834', points: x.curve.map((p) => ({ x: p.volume, y: p.dedicated })), step: true },
            ]}
            xLabel="Requests per month →"
            yLabel="$ per month"
            xFormat={fmt.compact}
            yFormat={fmt.usdShort}
            marker={{ x: totalVolume, label: 'This workload' }}
          />
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">
          {summary?.costPerRequest == null ? 'Needs a per-token price for this target (Targets page). ' : ''}
          {!model.load.some((l) => l.targetId === t.id) ? 'Needs a load test on this target to measure how much one replica can serve. ' : ''}
          {!hourly ? 'Enter the GPU hourly price.' : ''}
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="self-center truncate text-[13px] text-ink-2">{label}</span>
      {children}
    </>
  );
}

function Num({ label, value, onChange, min = 0, max = 100_000 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="text-[12.5px] font-medium text-ink-2">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="tabular mt-1 h-9 w-full rounded-[10px] border border-line-strong px-3 text-sm outline-none focus:border-forest-500 focus:shadow-[var(--ring)]"
      />
    </label>
  );
}

function SmallNum({ value, onChange, suffix }: { value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={cx('tabular h-8 w-full rounded-lg border border-line-strong pl-2 text-right text-[13px] outline-none focus:border-forest-500 focus:shadow-[var(--ring)]', suffix ? 'pr-5' : 'pr-2')}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[12px] text-ink-4">{suffix}</span>}
    </div>
  );
}
