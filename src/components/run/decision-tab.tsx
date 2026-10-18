'use client';

import { FlaskConical, Lock, Scale } from 'lucide-react';
import { useMemo } from 'react';
import type { CaseInputs } from '@/core/analysis';
import { decide, defaultPolicy, type Candidate, type Verdict } from '@/core/decide';
import type { ResultRow, Target } from '@/core/types';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { Badge, Card, CardHeader, EmptyState, Stat, Swatch } from '@/components/ui';
import type { RunModel } from '@/lib/run-model';
import type { TargetWithStatus } from '@/lib/types-client';
import { useWorkload } from '@/lib/use-workload';

const VERDICT: Record<Verdict, { tone: 'green' | 'bad' | 'neutral' | 'warn'; label: string; body: string }> = {
  pass: { tone: 'green', label: 'Pass', body: 'Routing is cheaper, and a quality loss bigger than the margin is ruled out on tasks the picks were not chosen on.' },
  fail: { tone: 'bad', label: 'Fail', body: 'The routing policy did not prove itself on unseen tasks. Keep the baseline, or change the constraints and collect new holdout tasks.' },
  'no-change': { tone: 'neutral', label: 'No change', body: 'The best single model is also the right pick for every job that has one.' },
  'not-enough-data': { tone: 'warn', label: 'Not enough data', body: 'This run can’t make or check a decision yet.' },
};

const pts = (v: number | null) => (v == null ? '—' : String(Math.round(v * 100)));
const signed = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
const sec = (v: number | null) => (v == null ? '—' : `${(v / 1000).toFixed(1)}s`);

export function DecisionTab({ results, model, inputs, targets }: { results: ResultRow[]; model: RunModel; inputs: CaseInputs; targets: TargetWithStatus[] }) {
  const { workload } = useWorkload();
  const d = useMemo(() => {
    if (!workload) return null;
    const policy = defaultPolicy();
    policy.qualityBar = inputs.qualityBar;
    policy.sloMs = inputs.sloMs;
    for (const t of TASK_TYPE_ORDER) policy.monthlyVolume[t] = inputs.reps * inputs.workdays * inputs.perRepPerDay[t];
    return decide(results, workload.tasks, targets as Target[], policy);
  }, [results, workload, targets, inputs]);

  if (!d) return null;
  if (!d.holdoutTasks && !d.devTasks) return <EmptyState icon={<FlaskConical className="size-5" />} title="No quality results yet" body="The decision needs finished quality requests." />;
  const v = VERDICT[d.verdict];
  const { meta } = model;

  return (
    <div className="grid gap-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Scale className="size-4 text-ink-3" />
          <h3 className="text-[15px] font-semibold">Does the routing pick survive unseen tasks?</h3>
          <Badge tone={v.tone}>{v.label}</Badge>
          <span className="tabular ml-auto flex items-center gap-1 text-[12.5px] text-ink-3">
            <Lock className="size-3" /> decision {d.fingerprint}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-ink-2">{v.body}</p>
        <ul className="mt-3 grid gap-1 text-[13px] text-ink-2">
          {d.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tasks" value={`${d.devTasks} + ${d.holdoutTasks}`} sub="dev (picks made here) + holdout (only checks them)" />
        <Stat label="Quality vs baseline" value={d.qualityDelta ? signed(d.qualityDelta.estimate) : '—'} sub={d.qualityDelta ? `interval ${signed(d.qualityDelta.low)} to ${signed(d.qualityDelta.high)}; floor ${signed(-d.policy.margin)}` : 'needs holdout answers from both'} />
        <Stat label="Checks only" value={d.checksDelta ? signed(d.checksDelta.estimate) : '—'} sub="no model graded this part" />
        <Stat
          accent
          label="Monthly cost"
          value={d.routedMonthly != null ? `$${d.routedMonthly.toFixed(2)}` : '—'}
          sub={d.baselineMonthly != null ? `vs $${d.baselineMonthly.toFixed(2)} on ${d.baselineTargetId ? meta(d.baselineTargetId).label : 'baseline'}` : 'over the routed jobs'}
        />
      </div>

      <Card>
        <CardHeader title="Step 1 · Picks made on dev tasks only" subtitle={`Confident = the low end of the ${Math.round(d.policy.confidence * 100)}% interval clears the ${pts(d.policy.qualityBar)} bar. Cheapest confident pick wins; tentative ones only if nothing is confident.`} />
        <div className="overflow-x-auto px-5 pb-5">
          <table className="tabular w-full text-[13px]">
            <thead className="text-left text-[12px] text-ink-3">
              <tr>
                <th className="py-2 pr-3 font-medium">Job</th>
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 font-medium">Quality (interval)</th>
                <th className="py-2 pr-3 font-medium">Checks</th>
                <th className="py-2 pr-3 font-medium">p95</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.jobs.map((j) =>
                j.candidates.map((c, i) => (
                  <tr key={j.taskType + c.targetId} className={i === 0 ? 'border-t border-line' : ''}>
                    <td className="py-2 pr-3 font-medium">{i === 0 ? TASK_TYPES[j.taskType].label : ''}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Swatch color={meta(c.targetId).color} />
                        {meta(c.targetId).label}
                        {j.pick?.targetId === c.targetId && <Badge tone="dark">pick</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {pts(c.quality)} <span className="text-ink-3">({pts(c.qualityLow)}–{pts(c.qualityHigh)})</span>
                    </td>
                    <td className="py-2 pr-3">{pts(c.checksOnly)}</td>
                    <td className="py-2 pr-3">{sec(c.p95)}</td>
                    <td className="py-2 pr-3">
                      <Status c={c} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {d.holdout.length > 0 && (
        <Card>
          <CardHeader title="Step 2 · The frozen picks on holdout tasks" subtitle={`Baseline: ${d.baselineTargetId ? meta(d.baselineTargetId).label : '—'} for everything. Quality / checks / p95.`} />
          <div className="overflow-x-auto px-5 pb-5">
            <table className="tabular w-full text-[13px]">
              <thead className="text-left text-[12px] text-ink-3">
                <tr>
                  <th className="py-2 pr-3 font-medium">Job</th>
                  <th className="py-2 pr-3 font-medium">Pick</th>
                  <th className="py-2 pr-3 font-medium">Baseline</th>
                  <th className="py-2 pr-3 font-medium">Held?</th>
                </tr>
              </thead>
              <tbody>
                {d.holdout.map((h) => (
                  <tr key={h.taskType} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{TASK_TYPES[h.taskType].label}</td>
                    <td className="py-2 pr-3">
                      {meta(h.pick.targetId).label}: {pts(h.pick.quality)} / {pts(h.pick.checksOnly)} / {sec(h.pick.p95)}
                    </td>
                    <td className="py-2 pr-3">
                      {meta(h.baseline.targetId).label}: {pts(h.baseline.quality)} / {pts(h.baseline.checksOnly)} / {sec(h.baseline.p95)}
                    </td>
                    <td className="py-2 pr-3">{h.held ? <Badge tone="green">held</Badge> : <Badge tone="bad">{h.why.join(', ')}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Status({ c }: { c: Candidate }) {
  const tone = c.eligible ? (c.confidence === 'confident' ? 'green' : 'warn') : 'neutral';
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>{c.eligible ? c.confidence : 'not eligible'}</Badge>
      {c.why.length > 0 && <span className="text-[12px] text-ink-3">{c.why.join('; ')}</span>}
    </span>
  );
}
