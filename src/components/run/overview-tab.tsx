'use client';

import { ArrowDown, ArrowUp, Lightbulb } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CaseInputs, TargetSummary } from '@/core/analysis';
import type { ResultRow, RunRow } from '@/core/types';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { FrontierChart } from '@/components/charts';
import { Card, CardHeader, cx, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import { rampColor } from '@/lib/palette';
import type { RunModel } from '@/lib/run-model';

type SortKey = 'quality' | 'accuracy' | 'judgeScore' | 'checkScore' | 'ttftP50' | 'totalP95' | 'tokensPerSec' | 'costPerRequest' | 'coldStartMs';
const COLUMNS: { key: SortKey; label: string; hint: string; fmt: (s: TargetSummary) => string; lowerIsBetter?: boolean }[] = [
  { key: 'quality', label: 'Quality', hint: 'Half deterministic checks, half judge (rescaled 0-100), times success rate', fmt: (s) => fmt.score(s.quality) },
  { key: 'accuracy', label: 'Accuracy', hint: 'Ground-truth checks only: signal labels, debrief outcomes, meeting flags', fmt: (s) => fmt.pct(s.accuracy) },
  { key: 'judgeScore', label: 'Judge', hint: 'Mean LLM-judge grade, 1-5', fmt: (s) => (s.judgeScore == null ? '—' : s.judgeScore.toFixed(1)) },
  { key: 'ttftP50', label: 'TTFT p50', hint: 'Median time to the first visible token', fmt: (s) => fmt.sec(s.ttftP50), lowerIsBetter: true },
  { key: 'totalP95', label: 'p95', hint: '95th percentile total request time', fmt: (s) => fmt.sec(s.totalP95), lowerIsBetter: true },
  { key: 'tokensPerSec', label: 'Tok/s', hint: 'Median output tokens per second after the first token', fmt: (s) => (s.tokensPerSec == null ? '—' : Math.round(s.tokensPerSec).toString()) },
  { key: 'costPerRequest', label: '$/req', hint: 'Mean cost per successful request', fmt: (s) => fmt.usd(s.costPerRequest), lowerIsBetter: true },
  { key: 'coldStartMs', label: 'Cold start', hint: 'The warm-up request: model load, connection, process start', fmt: (s) => fmt.sec(s.coldStartMs), lowerIsBetter: true },
];

export function OverviewTab({ run, results, model, inputs }: { run: RunRow; results: ResultRow[]; model: RunModel; inputs: CaseInputs }) {
  const { summaries, meta, frontierIds } = model;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'quality', desc: true });
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key)!;
    return [...summaries].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      // `desc` means best first; for latency and cost, best is lowest.
      const bestFirst = col.lowerIsBetter ? av - bv : bv - av;
      return sort.desc ? bestFirst : -bestFirst;
    });
  }, [summaries, sort]);
  const findings = useMemo(() => buildFindings(model, results, inputs), [model, results, inputs]);
  const types = TASK_TYPE_ORDER.filter((t) => run.config.taskTypes.includes(t));

  return (
    <div className="space-y-6">
      {findings.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-forest-700 uppercase">
            <Lightbulb className="size-4" /> What stands out
          </div>
          <ul className="mt-3 grid gap-x-8 gap-y-2.5 md:grid-cols-2">
            {findings.map((f, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-snug text-ink-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-forest-500" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Leaderboard" subtitle="Click a column to sort. Hover a header for how it’s measured." />
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[820px] text-[13.5px]">
            <thead>
              <tr className="border-y border-line bg-mist/60 text-left text-[12px] text-ink-3">
                <th className="py-2.5 pr-3 pl-5 font-medium">Target</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 text-right font-medium" title={c.hint}>
                    <button
                      className={cx('inline-flex items-center gap-1 hover:text-ink', sort.key === c.key && 'text-ink')}
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : true }))}
                    >
                      {c.label}
                      {sort.key === c.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const m = meta(s.targetId);
                return (
                  <tr key={s.targetId} className="border-b border-line last:border-b-0 hover:bg-mist/40">
                    <td className="py-3 pr-3 pl-5">
                      <div className="flex items-center gap-2 font-medium">
                        <Swatch color={m.color} />
                        {m.label}
                        {frontierIds.has(s.targetId) && <span className="rounded-full bg-sage-100 px-1.5 text-[10.5px] font-semibold text-forest-700" title="On the cost/quality frontier">FRONTIER</span>}
                      </div>
                      <div className="mt-0.5 pl-[18px] text-[12px] text-ink-4">
                        {s.n} requests{s.okRate < 1 ? ` · ${Math.round((1 - s.okRate) * 100)}% failed` : ''}
                        {s.cacheHitRate ? ` · ${fmt.pct(s.cacheHitRate)} input from cache` : ''}
                      </div>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={cx('tabular px-3 py-3 text-right', c.key === 'quality' ? 'text-[15px] font-semibold' : 'text-ink-2')}>
                        {c.fmt(s)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <Card className="min-w-0">
          <CardHeader title="Cost vs quality" subtitle="Up and to the left wins. The green line is the frontier." />
          <div className="px-4 pb-4">
            <FrontierChart
              points={summaries.map((s) => ({
                id: s.targetId,
                label: meta(s.targetId).label,
                color: meta(s.targetId).color,
                cost: s.costPerRequest,
                quality: s.quality,
                p95: s.totalP95,
                frontier: frontierIds.has(s.targetId),
                costNote: meta(s.targetId).target?.deployment === 'subscription' ? 'API-equivalent cost reported by Claude Code' : undefined,
              }))}
            />
          </div>
        </Card>

        <Card className="min-w-0">
          <CardHeader title="Quality by job" subtitle="The right model depends on the job. Darker is better." />
          <div className="overflow-x-auto px-5 pb-5 scrollbar-thin">
            <table className="w-full border-separate border-spacing-[3px] text-[12.5px]">
              <thead>
                <tr>
                  <th />
                  {types.map((t) => (
                    <th key={t} className="px-1 pb-1 text-center font-medium text-ink-3">
                      {TASK_TYPES[t].short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.targetId}>
                    <td className="max-w-36 truncate pr-2 text-ink-2">{meta(s.targetId).label}</td>
                    {types.map((t) => {
                      const q = s.byType[t]?.quality;
                      const c = q == null ? null : rampColor(q);
                      return (
                        <td
                          key={t}
                          className="tabular h-9 min-w-14 rounded-md text-center font-semibold"
                          style={c ? { background: c.bg, color: c.fg } : { background: '#f6f8f6', color: '#9aa8a0' }}
                          title={`${meta(s.targetId).label} · ${TASK_TYPES[t].label}: ${fmt.score(q)} quality, p95 ${fmt.sec(s.byType[t]?.totalP95)}`}
                        >
                          {fmt.score(q)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function buildFindings(model: RunModel, results: ResultRow[], inputs: CaseInputs): string[] {
  const { summaries, meta } = model;
  const out: string[] = [];
  const name = (id: string) => meta(id).label;
  const withQ = summaries.filter((s) => s.quality != null);
  if (withQ.length >= 2) {
    const best = [...withQ].sort((a, b) => b.quality! - a.quality!)[0]!;
    const worst = [...withQ].sort((a, b) => a.quality! - b.quality!)[0]!;
    out.push(`${name(best.targetId)} scored highest at ${fmt.score(best.quality)}; ${name(worst.targetId)} trailed at ${fmt.score(worst.quality)}.`);
  }
  const fast = summaries.filter((s) => s.ttftP50 != null).sort((a, b) => a.ttftP50! - b.ttftP50!);
  if (fast.length >= 2) {
    const ratio = fast[fast.length - 1]!.ttftP50! / fast[0]!.ttftP50!;
    if (ratio > 1.5) out.push(`First token: ${name(fast[0]!.targetId)} at ${fmt.sec(fast[0]!.ttftP50)} median, ${ratio.toFixed(ratio > 10 ? 0 : 1)}× faster than ${name(fast[fast.length - 1]!.targetId)}.`);
  }
  for (const s of summaries) {
    const q = results.filter((r) => r.targetId === s.targetId && r.phase === 'quality' && r.ok);
    const badJson = q.filter((r) => r.checks.find((c) => c.id === 'json' && !c.pass)).length;
    if (q.length && badJson / q.length >= 0.15) out.push(`${name(s.targetId)} returned unparseable JSON on ${badJson} of ${q.length} requests: structured output is a real gap for this model.`);
  }
  const cold = summaries.filter((s) => s.coldStartMs != null && s.totalP50 != null && s.coldStartMs > s.totalP50 * 2.5);
  for (const s of cold) out.push(`${name(s.targetId)} took ${fmt.sec(s.coldStartMs)} on its first request vs ${fmt.sec(s.totalP50)} warm: cold starts matter for bursty traffic.`);
  const cached = summaries.filter((s) => (s.cacheHitRate ?? 0) > 0.3);
  for (const s of cached) out.push(`${name(s.targetId)} served ${fmt.pct(s.cacheHitRate)} of input tokens from the prompt cache; the shared playbook is the cacheable prefix.`);
  const sig = summaries.map((s) => ({ s, st: s.byType.signal })).filter((x) => x.st && x.st.totalP95 != null && x.st.totalP95 > inputs.sloMs.signal);
  if (sig.length) out.push(`${sig.map((x) => name(x.s.targetId)).join(', ')} missed the ${fmt.sec(inputs.sloMs.signal, 0)} p95 budget for signal checks, the job a rep runs on every account.`);
  return out.slice(0, 6);
}
