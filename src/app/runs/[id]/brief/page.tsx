'use client';

import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { defaultCaseInputs, type CaseInputs } from '@/core/analysis';
import { TASK_TYPES } from '@/core/workload/meta';
import { Button, Skeleton } from '@/components/ui';
import { fmt } from '@/lib/format';
import { useRunModel } from '@/lib/run-model';
import type { RunDetail, TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';

/** One printable page: the recommendation, the evidence, and the caveats. */
export default function BriefPage() {
  const { id } = useParams<{ id: string }>();
  const { data } = useJson<RunDetail>(`/api/runs/${id}`);
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets');
  const [inputs, setInputs] = useState<CaseInputs>(defaultCaseInputs);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('bakeoff:case');
      if (raw) setInputs((d) => ({ ...d, ...JSON.parse(raw) }));
    } catch {}
  }, []);
  const model = useRunModel(data?.run, data?.results ?? [], targets, inputs);

  if (!data || !model) return <div className="mx-auto max-w-[820px] p-10"><Skeleton className="h-[900px]" /></div>;
  const { run } = data;
  const { summaries, meta, bc } = model;
  const sorted = [...summaries].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
  const totalVolume = bc.routes.reduce((a, r) => a + r.monthlyVolume, 0);

  return (
    <div className="min-h-dvh bg-mist py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-[820px] items-center justify-between px-4">
        <Link href={`/runs/${id}?tab=case`} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="size-3.5" /> Back to the run
        </Link>
        <Button variant="primary" size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="mx-auto max-w-[820px] bg-paper px-12 py-11 shadow-lift print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="flex items-start justify-between border-b-2 border-forest-800 pb-4">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] text-forest-600 uppercase">Inference bake-off · Scout SDR workload</div>
            <h1 className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.02em]">{run.name}</h1>
          </div>
          <div className="tabular text-right text-[11.5px] leading-relaxed text-ink-3">
            {new Date(run.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            <br />
            {summaries.reduce((a, s) => a + s.n, 0)} graded requests · {run.config.targetIds.length} targets
          </div>
        </header>

        <section className="mt-5 rounded-xl bg-forest-800 px-5 py-4 text-white print:[-webkit-print-color-adjust:exact]">
          <div className="text-[10.5px] font-semibold tracking-[0.1em] text-forest-300 uppercase">Recommendation</div>
          <p className="mt-1 text-[16px] leading-snug font-medium">{bc.headline}</p>
        </section>

        <section className="mt-5 grid grid-cols-3 gap-3">
          <Kpi label="Routed monthly cost" value={fmt.usdShort(bc.routedMonthly)} />
          <Kpi label={bc.baselineTargetId ? `All on ${meta(bc.baselineTargetId).label}` : 'Single-model baseline'} value={fmt.usdShort(bc.baselineMonthly)} />
          <Kpi label="Monthly volume" value={fmt.compact(totalVolume)} sub={`${inputs.reps} reps × ${inputs.workdays} days`} />
        </section>

        <H>Routing by job</H>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-1.5 font-medium">Job</th>
              <th className="font-medium">Route to</th>
              <th className="text-right font-medium">Quality</th>
              <th className="text-right font-medium">p95</th>
              <th className="text-right font-medium">Volume/mo</th>
              <th className="text-right font-medium">Cost/mo</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {bc.routes.map((r) => (
              <tr key={r.taskType} className="border-b border-line">
                <td className="py-1.5 font-medium">{TASK_TYPES[r.taskType].label}</td>
                <td>{r.pick ? meta(r.pick.targetId).label : <span className="text-warn">No target clears the bar</span>}</td>
                <td className="text-right">{fmt.score(r.pick?.quality)}</td>
                <td className="text-right">{fmt.sec(r.pick?.p95)}</td>
                <td className="text-right">{fmt.int(r.monthlyVolume)}</td>
                <td className="text-right font-medium">{fmt.usd(r.pick?.monthlyCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-ink-4">
          Rule: cheapest target with quality ≥ {Math.round(inputs.qualityBar * 100)}, p95 under the job’s budget ({bc.routes.map((r) => `${TASK_TYPES[r.taskType].label.toLowerCase()} ${fmt.sec(inputs.sloMs[r.taskType], 0)}`).join(', ')}) and ≥95% success.
        </p>

        <H>Every target</H>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="py-1.5 font-medium">Target</th>
              <th className="text-right font-medium">Quality</th>
              <th className="text-right font-medium">Accuracy</th>
              <th className="text-right font-medium">TTFT p50</th>
              <th className="text-right font-medium">p95</th>
              <th className="text-right font-medium">$/request</th>
              <th className="text-right font-medium">Cold start</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {sorted.map((s) => (
              <tr key={s.targetId} className="border-b border-line">
                <td className="py-1.5">{meta(s.targetId).label}</td>
                <td className="text-right font-semibold">{fmt.score(s.quality)}</td>
                <td className="text-right">{fmt.pct(s.accuracy)}</td>
                <td className="text-right">{fmt.sec(s.ttftP50)}</td>
                <td className="text-right">{fmt.sec(s.totalP95)}</td>
                <td className="text-right">{fmt.usd(s.costPerRequest)}</td>
                <td className="text-right">{fmt.sec(s.coldStartMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 grid grid-cols-2 gap-6 text-[11.5px] leading-relaxed text-ink-2">
          <div>
            <H small>Method</H>
            <p>
              Four jobs from Scout, a field sales tool, on 24 fictional accounts with one shared playbook. Latency is timed client-side from the stream, after one warm-up request per target. Quality is half
              deterministic checks (format, ground-truth labels, playbook rules) and half an LLM judge (1-5), times success rate. Costs use each provider’s reported token usage and the list prices in the repo’s config.
            </p>
          </div>
          <div>
            <H small>Caveats</H>
            <p>
              One machine, one network, one moment; hosted latency varies by region and load. 24 tasks surfaces large gaps, not small ones. A Claude judge may favor Claude outputs
              {model.cal.n > 0 ? ` (human agreement within one point: ${fmt.pct(model.cal.withinOne)} on ${model.cal.n} grades)` : ''}. Claude Code timings include CLI startup.
            </p>
          </div>
        </div>

        <footer className="mt-7 flex items-center justify-between border-t border-line pt-3 text-[10.5px] text-ink-4">
          <span>Generated by Bakeoff · run {run.id}</span>
          <span>github.com/AaronMontano99/bakeoff</span>
        </footer>
      </article>
    </div>
  );
}

function H({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h2 className={small ? 'mb-1 text-[11px] font-semibold tracking-[0.08em] text-forest-700 uppercase' : 'mt-6 mb-2 text-[12px] font-semibold tracking-[0.08em] text-forest-700 uppercase'}>{children}</h2>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line px-4 py-3">
      <div className="truncate text-[11px] text-ink-3">{label}</div>
      <div className="tabular mt-0.5 text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
      {sub && <div className="text-[11px] text-ink-4">{sub}</div>}
    </div>
  );
}
