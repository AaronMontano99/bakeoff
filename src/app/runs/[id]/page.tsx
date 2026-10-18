'use client';

import { Activity, ArrowLeft, BarChart3, FileText, MessageSquareText, Radio, Square, Timer, Trash2, Scale, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { defaultCaseInputs, type CaseInputs } from '@/core/analysis';
import { StatusBadge } from '@/components/page';
import { CaseTab } from '@/components/run/case-tab';
import { DecisionTab } from '@/components/run/decision-tab';
import { LatencyTab } from '@/components/run/latency-tab';
import { LiveTab } from '@/components/run/live-tab';
import { OutputsTab } from '@/components/run/outputs-tab';
import { OverviewTab } from '@/components/run/overview-tab';
import { Button, ButtonLink, EmptyState, Progress, Skeleton, Tabs } from '@/components/ui';
import { fmt } from '@/lib/format';
import { useRunModel } from '@/lib/run-model';
import type { TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';
import { useRunLive } from '@/lib/use-run-live';

type Tab = 'live' | 'overview' | 'latency' | 'outputs' | 'case' | 'decision';
const ACTIVE = ['queued', 'running', 'judging'];

export default function RunPage() {
  return (
    <Suspense>
      <RunView />
    </Suspense>
  );
}

function RunView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const { run, results, setResults, lanes, detail, error } = useRunLive(id);
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets');
  const [inputs, setInputs] = useState<CaseInputs>(() => loadInputs());
  const model = useRunModel(run ?? undefined, results, targets, inputs);
  const active = !!run && ACTIVE.includes(run.status);

  const [tab, setTabState] = useState<Tab>((params.get('tab') as Tab) ?? 'overview');
  const setTab = (t: Tab) => {
    setTabState(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url);
  };
  // Land on the live view while a run is in flight; move to the overview when it finishes.
  const [autoSwitched, setAutoSwitched] = useState(false);
  useEffect(() => {
    if (!run || params.get('tab')) return;
    if (active && !autoSwitched) {
      setTabState('live');
      setAutoSwitched(true);
    }
  }, [run, active, autoSwitched, params]);
  const [wasActive, setWasActive] = useState(false);
  useEffect(() => {
    if (active) setWasActive(true);
    else if (wasActive && run?.status === 'done') {
      setWasActive(false);
      toast.success('Run finished', { description: 'Results are ready.', action: { label: 'See results', onClick: () => setTab('overview') } });
      setTab('overview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    try {
      localStorage.setItem('bakeoff:case', JSON.stringify(inputs));
    } catch {}
  }, [inputs]);

  // Elapsed clock while running.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-16">
        <EmptyState icon={<FileText className="size-5" />} title="Run not found" body={error} action={<ButtonLink href="/runs">Back to runs</ButtonLink>} />
      </div>
    );
  }
  if (!run || !model) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-5 py-8 sm:px-8">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[420px]" />
      </div>
    );
  }

  const elapsed = (run.finishedAt ?? Date.now()) - run.createdAt;
  const quality = results.filter((r) => r.phase === 'quality');

  const cancel = async () => {
    await fetch(`/api/runs/${id}/cancel`, { method: 'POST' });
    toast('Cancelling…', { description: 'In-flight requests are being stopped.' });
  };
  const remove = async () => {
    if (!confirm('Delete this run and all its results? This can’t be undone.')) return;
    await fetch(`/api/runs/${id}`, { method: 'DELETE' });
    toast.success('Run deleted');
    router.push('/runs');
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8 sm:py-8">
      <Link href="/runs" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> Runs
      </Link>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em]">{run.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="tabular mt-1 text-[13.5px] text-ink-3">
            {new Date(run.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {plural(run.config.targetIds.length, 'target')} · {plural(run.config.taskTypes.length, 'job type')} · {fmt.duration(elapsed)}
            {run.error && <span className="text-bad"> · {run.error}</span>}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {active ? (
            <Button variant="danger" size="sm" icon={<Square className="size-3.5" />} onClick={cancel}>
              Stop
            </Button>
          ) : (
            <>
              <ButtonLink href={`/runs/${id}/brief`} size="sm" icon={<FileText className="size-3.5" />}>
                One-page brief
              </ButtonLink>
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={remove} aria-label="Delete run" />
            </>
          )}
        </div>
      </div>

      {active && (
        <div className="mt-5 rounded-2xl border border-line bg-mist/60 px-4 py-3">
          <div className="mb-2 flex items-center justify-between text-[13px]">
            <span className="font-medium text-ink-2">{run.status === 'judging' ? 'Judging the last outputs…' : detail ?? 'Running the quality phase'}</span>
            <span className="tabular text-ink-3">
              {run.completed} / {run.totalPlanned} requests
            </span>
          </div>
          <Progress value={run.totalPlanned ? run.completed / run.totalPlanned : 0} running />
        </div>
      )}

      <div className="mt-6">
        <Tabs
          id="run"
          value={tab}
          onChange={setTab}
          items={[
            ...(active || tab === 'live' ? [{ value: 'live' as const, label: 'Live', icon: <Radio className="size-3.5" /> }] : []),
            { value: 'overview', label: 'Overview', icon: <BarChart3 className="size-3.5" /> },
            { value: 'latency', label: 'Latency', icon: <Timer className="size-3.5" /> },
            { value: 'outputs', label: 'Outputs', icon: <MessageSquareText className="size-3.5" />, count: quality.length || undefined },
            { value: 'case', label: 'Business case', icon: <Wallet className="size-3.5" /> },
            { value: 'decision', label: 'Decision', icon: <Scale className="size-3.5" /> },
          ]}
        />
      </div>

      <div className="mt-6">
        {results.length === 0 && !active ? (
          <EmptyState icon={<Activity className="size-5" />} title="No results" body="This run finished without recording any requests." />
        ) : tab === 'live' ? (
          <LiveTab run={run} results={results} lanes={lanes} model={model} />
        ) : tab === 'overview' ? (
          <OverviewTab run={run} results={results} model={model} inputs={inputs} />
        ) : tab === 'latency' ? (
          <LatencyTab results={results} model={model} />
        ) : tab === 'outputs' ? (
          <OutputsTab run={run} results={results} setResults={setResults} model={model} />
        ) : tab === 'decision' ? (
          <DecisionTab results={results} model={model} inputs={inputs} targets={targets ?? []} />
        ) : (
          <CaseTab runId={run.id} model={model} inputs={inputs} setInputs={setInputs} targets={targets ?? []} />
        )}
      </div>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function loadInputs(): CaseInputs {
  const d = defaultCaseInputs();
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('bakeoff:case') : null;
    if (raw) {
      const saved = JSON.parse(raw) as Partial<CaseInputs>;
      return { ...d, ...saved, perRepPerDay: { ...d.perRepPerDay, ...saved.perRepPerDay }, sloMs: { ...d.sloMs, ...saved.sloMs } };
    }
  } catch {}
  return d;
}
