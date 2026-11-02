'use client';

import { motion } from 'motion/react';
import { ArrowRight, Check, Cpu, Gauge, History, ListChecks, Play, Sparkles, Timer, Trophy, Wallet, Zap } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { defaultCaseInputs } from '@/core/analysis';
import type { TaskType } from '@/core/types';
import { jobsOf, TASK_TYPE_ORDER, jobInfo, TASK_TYPES, workloadMeta } from '@/core/workload/meta';
import { FrontierChart, Meter, ScoreRing, shortLabel, SpeedBars } from '@/components/charts';
import { PageHeader, StatusBadge } from '@/components/page';
import { Badge, ButtonLink, Card, CardHeader, cx, Dot, Progress, Skeleton, Stat, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import { useRunModel, type RunModel } from '@/lib/run-model';
import type { RunDetail, RunListItem, TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';
import { jobsOf as jobsOfWorkload, WORKLOADS, WORKLOAD_ORDER } from '@/core/workload/meta';

export default function Overview() {
  const { data: runs, loading } = useJson<RunListItem[]>('/api/runs', { refreshMs: 5_000 });
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets');
  const latestDone = runs?.find((r) => r.status === 'done');
  const running = runs?.find((r) => r.status === 'running' || r.status === 'judging' || r.status === 'queued');

  if (loading && !runs) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!latestDone) return <Onboarding targets={targets} running={running} />;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader
        title="What the latest bake-off says"
        description={<>From <Link className="font-medium text-ink underline decoration-tint-line underline-offset-2 hover:decoration-accent" href={`/runs/${latestDone.id}`}>{latestDone.name}</Link>, {fmt.ago(latestDone.createdAt)}.</>}
        actions={<ButtonLink href="/runs/new" variant="primary" icon={<Play className="size-4" />} kbd="N">New run</ButtonLink>}
      />
      {running && <RunningBanner run={running} />}
      <LatestRun id={latestDone.id} targets={targets} />
      <RecentRuns runs={runs ?? []} targets={targets} />
    </div>
  );
}

function RunningBanner({ run }: { run: RunListItem }) {
  return (
    <Link href={`/runs/${run.id}`} className="group mb-6 flex items-center gap-4 glass rounded-2xl border border-tint-line px-4 py-3 transition hover:border-tint-line">
      <Dot pulse />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-accent-ink">
          {run.name} <span className="font-normal text-accent-ink">is {run.status === 'judging' ? 'being judged' : 'running'}</span>
        </div>
        <div className="mt-2 max-w-md">
          <Progress value={run.totalPlanned ? run.completed / run.totalPlanned : 0} running />
        </div>
      </div>
      <span className="tabular text-[13px] text-accent-ink">
        {run.completed}/{run.totalPlanned}
      </span>
      <ArrowRight className="size-4 text-accent-ink transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function LatestRun({ id, targets }: { id: string; targets: TargetWithStatus[] | null }) {
  const { data } = useJson<RunDetail>(`/api/runs/${id}`);
  const inputs = useMemo(() => defaultCaseInputs(data?.run.config.workload), [data?.run.config.workload]);
  const model = useRunModel(data?.run, data?.results ?? [], targets, inputs);
  if (!model || !data) return <Skeleton className="h-[480px]" />;
  const { summaries, meta, frontierIds, bc } = model;
  const withQ = summaries.filter((s) => s.quality != null);
  const best = [...withQ].sort((a, b) => b.quality! - a.quality!)[0];
  const fastest = [...summaries].filter((s) => s.ttftP50 != null).sort((a, b) => a.ttftP50! - b.ttftP50!)[0];
  const cheapest = [...withQ].filter((s) => (s.costPerRequest ?? 0) > 0 && (s.quality ?? 0) >= inputs.qualityBar).sort((a, b) => a.costPerRequest! - b.costPerRequest!)[0];
  const ranked = [...summaries].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1));
  const speed = summaries.filter((s) => s.ttftP50 != null && s.totalP50 != null).sort((a, b) => a.totalP50! - b.totalP50!);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Stat icon={<Trophy className="size-3.5" />} label="Best quality" value={best ? fmt.score(best.quality) : '—'} sub={best ? meta(best.targetId).label : 'No scores yet'} />
        <Stat icon={<Zap className="size-3.5" />} label="Fastest first word" value={fastest ? fmt.sec(fastest.ttftP50) : '—'} sub={fastest ? `${meta(fastest.targetId).label} · median` : '—'} />
        <Stat icon={<Wallet className="size-3.5" />} label="Cheapest above the bar" value={cheapest ? fmt.usd(cheapest.costPerRequest) : '—'} sub={cheapest ? `${meta(cheapest.targetId).label} · per request` : `Nothing priced clears ${Math.round(inputs.qualityBar * 100)}`} />
        <Stat
          accent
          icon={<Gauge className="size-3.5" />}
          label="Monthly, routed"
          value={bc.routedMonthly != null ? fmt.usdShort(bc.routedMonthly) : '—'}
          sub={bc.savingsPct != null && bc.savingsPct > 0.01 ? `${Math.round(bc.savingsPct * 100)}% under one-model-for-all` : `${fmt.int(inputs.reps)} ${workloadMeta(data.run.config.workload).unit}s · ${inputs.workdays} days`}
        />
      </div>

      <motion.section initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-hero p-6 text-on-hero sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h2 className="font-head text-[23px] leading-snug text-balance sm:text-[27px]">{bc.headline}</h2>
            {bc.lines.length > 0 && (
              <ul className="mt-3 space-y-1 text-[14px] text-on-hero-2">
                {bc.lines.map((l) => (
                  <li key={l} className="flex gap-2">
                    <Check className="mt-0.5 size-3.5 shrink-0" />
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href={`/runs/${id}?tab=case`} className="inline-flex h-10 shrink-0 items-center gap-2 self-start rounded-control bg-on-hero px-4 text-sm font-semibold text-hero transition hover:opacity-90 lg:self-auto">
            <Wallet className="size-4" /> Tune the assumptions
          </Link>
        </div>
      </motion.section>

      <JobBoard model={model} types={TASK_TYPE_ORDER.filter((t) => data.run.config.taskTypes.includes(t))} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Card className="min-w-0">
          <CardHeader title="Cost vs quality" subtitle="Up and to the left wins. The line joins targets nothing else beats on both." />
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
                costNote: meta(s.targetId).target?.deployment === 'subscription' ? 'API-equivalent cost reported by Claude Code' : meta(s.targetId).target?.deployment === 'local' ? 'Marginal cost on this laptop' : undefined,
              }))}
            />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Leaderboard" subtitle="Quality: half deterministic checks, half LLM judge" action={<ButtonLink size="sm" variant="ghost" href={`/runs/${id}`}>Details <ArrowRight className="size-3.5" /></ButtonLink>} />
          <ol className="divide-y divide-line px-5 pb-2">
            {ranked.map((s) => (
              <li key={s.targetId} className="py-3">
                <div className="flex items-baseline gap-3">
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-medium">
                    <Swatch color={meta(s.targetId).color} />
                    <span className="truncate">{meta(s.targetId).label}</span>
                  </span>
                  <span className="tabular text-[15px] font-semibold">{fmt.score(s.quality)}</span>
                </div>
                <Meter value={s.quality} className="mt-2" />
                <div className="tabular mt-1.5 text-[12.5px] text-ink-3">
                  {fmt.sec(s.totalP95)} p95 · {fmt.usd(s.costPerRequest)} per request
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {speed.length > 0 && (
        <Card>
          <CardHeader title="Where the time goes" subtitle="Median request: how long until the first word, and how long for the rest." />
          <div className="px-4 pb-4">
            <SpeedBars rows={speed.map((s) => ({ id: s.targetId, label: meta(s.targetId).label, firstToken: s.ttftP50!, total: s.totalP50! }))} />
          </div>
        </Card>
      )}
    </div>
  );
}

/** One column per job, best model on top. The routing decision, as a board. */
function JobBoard({ model, types }: { model: RunModel; types: TaskType[] }) {
  const { summaries, meta } = model;
  const cols = types.map((t) => ({ t, rows: summaries.filter((s) => s.byType[t]).sort((a, b) => (b.byType[t]!.quality ?? -1) - (a.byType[t]!.quality ?? -1)) })).filter((c) => c.rows.length);
  if (!cols.length) return null;
  return (
    <section aria-label="Best model for each job">
      <h2 className="font-head mb-3 text-[24px]">Who wins each job</h2>
      <div className="scrollbar-none -mx-5 grid snap-x auto-cols-[minmax(272px,1fr)] grid-flow-col gap-3 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8">
        {cols.map(({ t, rows }) => (
          <div key={t} className="glass snap-start rounded-2xl border border-line p-3 shadow-card">
            <div className="flex items-baseline justify-between gap-2 px-1.5 pb-2.5">
              <h3 className="truncate text-[14.5px] font-semibold">{jobInfo(t).label}</h3>
              <span className="tabular shrink-0 text-[12.5px] text-ink-3">{rows.length}</span>
            </div>
            <div className="space-y-1">
              {rows.slice(0, 3).map((s, i) => {
                const st = s.byType[t]!;
                return (
                  <div key={s.targetId} className={cx('flex items-center gap-3 rounded-xl p-2.5', i === 0 && 'bg-tint-2')}>
                    <ScoreRing value={st.quality} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                        <Swatch color={meta(s.targetId).color} />
                        <span className="truncate">{shortLabel(meta(s.targetId).label)}</span>
                      </div>
                      <div className="tabular mt-1 text-[12.5px] text-ink-3">
                        {fmt.sec(st.totalP95)} p95 · {fmt.usd(st.costPerRequest)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentRuns({ runs, targets }: { runs: RunListItem[]; targets: TargetWithStatus[] | null }) {
  if (runs.length < 2) return null;
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-head text-[24px]">Recent runs</h2>
        <ButtonLink href="/runs" size="sm" variant="ghost">All runs <ArrowRight className="size-3.5" /></ButtonLink>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {runs.slice(0, 6).map((r) => (
          <Link key={r.id} href={`/runs/${r.id}`} className="group glass rounded-2xl border border-line p-4 shadow-card transition hover:border-line-strong hover:shadow-lift">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[14px] font-medium">{r.name}</span>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-1 text-[12.5px] text-ink-3">
              {fmt.ago(r.createdAt)} · {r.config.targetIds.length} targets · {r.completed} requests
            </div>
            {r.best && (
              <div className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Trophy className="size-3.5 text-accent-ink" /> {targets?.find((t) => t.id === r.best!.targetId)?.label ?? r.best.targetId} · {fmt.score(r.best.quality)}
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Onboarding({ targets, running }: { targets: TargetWithStatus[] | null; running?: RunListItem }) {
  const ready = targets?.filter((t) => t.status.state === 'ready') ?? [];
  const steps = [
    {
      icon: Cpu,
      title: 'Targets',
      done: ready.length > 0,
      body: targets == null ? 'Checking what can run on this machine…' : ready.length ? `${ready.length} ready: ${ready.map((t) => t.label).join(', ')}.` : 'Start Ollama or log in to Claude Code, or add an API key.',
      href: '/targets',
    },
    { icon: ListChecks, title: 'Workload', done: true, body: `${WORKLOAD_ORDER.map((w) => `${WORKLOADS[w]!.short} (${jobsOfWorkload(w).length} jobs)`).join(', ')}, with tasks that keep each job's real traffic shape.`, href: '/workload' },
    { icon: Timer, title: 'Run', done: false, body: 'Every task on every target, measured for speed, quality and cost, then judged.', href: '/runs/new' },
  ];
  return (
    <div className="relative">
      <div className="relative mx-auto max-w-4xl px-5 pt-16 pb-12 sm:px-8 sm:pt-24">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Badge tone="green" icon={<Sparkles className="size-3" />}>Inference bake-off</Badge>
          <h1 className="font-head mt-5 text-[40px] leading-[1.06] text-balance sm:text-[58px]">
            How fast, how good, and how expensive is AI <span className="text-accent-ink">on your real workload?</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[16.5px] leading-relaxed text-ink-2">
            Bakeoff takes the AI jobs from a real app and runs them against local, subscription and hosted models. It measures time to first token,
            latency under load, cost per request and graded quality, then turns the numbers into a routing recommendation and a monthly business case.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/runs/new?preset=quick" variant="primary" size="lg" icon={<Zap className="size-4" />}>
              Run a quick check
            </ButtonLink>
            <ButtonLink href="/runs/new" size="lg" icon={<Play className="size-4" />} kbd="N">
              Configure a run
            </ButtonLink>
          </div>
        </motion.div>

        {running && (
          <div className="mt-10">
            <RunningBanner run={running} />
          </div>
        )}

        <div className="mt-14 grid gap-3 sm:grid-cols-3">
          {steps.map((s, i) => (
            <motion.div key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }}>
              <Link href={s.href} className="group block h-full glass rounded-2xl border border-line p-5 shadow-card transition hover:border-line-strong hover:shadow-lift">
                <div className="flex items-center justify-between">
                  <span className="grid size-9 place-items-center rounded-xl bg-tint text-accent-ink ring-1 ring-tint-line">
                    <s.icon className="size-[18px]" />
                  </span>
                  {s.done ? <Badge tone="green" icon={<Check className="size-3" />}>Ready</Badge> : <span className="text-[12px] font-medium text-ink-4">Step {i + 1}</span>}
                </div>
                <h3 className="font-head mt-4 text-[18px]">{s.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">{s.body}</p>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 flex items-center gap-2 text-[13px] text-ink-3">
          <History className="size-4" /> Runs started from the terminal (<code className="rounded bg-mist px-1.5 py-0.5 font-mono text-[12px]">npm run bakeoff -- run</code>) show up here live too.
        </div>
      </div>
    </div>
  );
}
