'use client';

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Check, Clock, Copy, Cpu, Gauge, Info, Layers, Play, Scale, Wallet, Zap } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { RunConfig, TaskType } from '@/core/types';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { PageHeader } from '@/components/page';
import { Badge, Button, Card, cx, Dot, Kbd, Segmented, Skeleton, Stepper, Swatch, Switch } from '@/components/ui';
import { fmt } from '@/lib/format';
import { seriesColor } from '@/lib/palette';
import type { TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';

type Preset = 'quick' | 'quality' | 'load' | 'custom';
const TASKS_PER_TYPE = 6;

/** Rough per-request time when there's no history yet, by how the target is deployed. */
const FALLBACK_MS: Record<string, number> = { local: 35_000, subscription: 9_000, serverless: 3_500, dedicated: 3_000 };

export default function NewRunPage() {
  return (
    <Suspense>
      <NewRun />
    </Suspense>
  );
}

function NewRun() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: targets, loading } = useJson<TargetWithStatus[]>('/api/targets');
  const ready = useMemo(() => targets?.filter((t) => t.status.state === 'ready') ?? [], [targets]);
  const visible = useMemo(() => targets?.filter((t) => t.enabled) ?? [], [targets]);

  const [preset, setPreset] = useState<Preset>((params.get('preset') as Preset) ?? 'quick');
  const [selected, setSelected] = useState<string[]>([]);
  const [types, setTypes] = useState<TaskType[]>(TASK_TYPE_ORDER);
  const [perType, setPerType] = useState(1);
  const [repeats, setRepeats] = useState(1);
  const [loadOn, setLoadOn] = useState(false);
  const [levels, setLevels] = useState<number[]>([1, 4]);
  const [loadRequests, setLoadRequests] = useState(8);
  const [parallel, setParallel] = useState(true);
  const [judgeOn, setJudgeOn] = useState(true);
  const [judgeId, setJudgeId] = useState('claude-cli-haiku');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Default selection: every ready target, once targets load.
  useEffect(() => {
    if (targets && selected.length === 0) setSelected(ready.map((t) => t.id));
    if (targets && !ready.some((t) => t.id === judgeId)) {
      const fallback = ready.find((t) => t.provider !== 'openai-compatible') ?? ready[0];
      if (fallback) setJudgeId(fallback.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  const applyPreset = useCallback((p: Preset) => {
    setPreset(p);
    if (p === 'quick') {
      setTypes(TASK_TYPE_ORDER);
      setPerType(1);
      setRepeats(1);
      setLoadOn(false);
    } else if (p === 'quality') {
      setTypes(TASK_TYPE_ORDER);
      setPerType(TASKS_PER_TYPE);
      setRepeats(1);
      setLoadOn(false);
    } else if (p === 'load') {
      setTypes(['signal']);
      setPerType(2);
      setRepeats(1);
      setLoadOn(true);
      setLevels([1, 4, 8]);
      setLoadRequests(8);
    }
  }, []);

  useEffect(() => {
    const p = params.get('preset') as Preset | null;
    if (p) applyPreset(p);
  }, [params, applyPreset]);

  const chosen = visible.filter((t) => selected.includes(t.id));
  const judgeTarget = targets?.find((t) => t.id === judgeId);
  const qualityPerTarget = types.length * perType * repeats;
  const loadPerTarget = loadOn ? levels.reduce((a, c) => a + Math.max(c, loadRequests), 0) : 0;
  const totalRequests = chosen.length * (1 + qualityPerTarget + loadPerTarget);
  const judgeCalls = judgeOn ? chosen.length * qualityPerTarget : 0;

  const estimate = useMemo(() => {
    const perTarget = chosen.map((t) => {
      const ms = t.history.medianMs ?? FALLBACK_MS[t.deployment] ?? 5_000;
      const loadMs = loadOn ? levels.reduce((a, c) => a + (Math.max(c, loadRequests) / c) * ms * (t.deployment === 'local' ? Math.max(1, c * 0.7) : 1.15), 0) : 0;
      return ms * (1 + qualityPerTarget) + loadMs;
    });
    const durationMs = parallel ? Math.max(0, ...perTarget) : perTarget.reduce((a, b) => a + b, 0);
    let cost: number | null = 0;
    let unknown = 0;
    for (const t of chosen) {
      const c = t.history.medianCost ?? (t.deployment === 'local' ? 0 : null);
      if (c == null) unknown++;
      else cost += c * (1 + qualityPerTarget + loadPerTarget);
    }
    if (unknown === chosen.length && chosen.length) cost = null;
    return { durationMs, cost, unknown };
  }, [chosen, qualityPerTarget, loadPerTarget, loadOn, levels, loadRequests, parallel]);

  const warnings: { tone: 'warn' | 'info'; text: string }[] = [];
  if (judgeOn && judgeTarget && chosen.some((t) => t.vendor.startsWith('Anthropic')) && judgeTarget.vendor.startsWith('Anthropic'))
    warnings.push({ tone: 'info', text: 'The judge is a Claude model grading Claude outputs. Self-preference bias is possible; grade a few outputs yourself to check it.' });
  if (parallel && chosen.some((t) => t.deployment === 'local') && chosen.length > 1)
    warnings.push({ tone: 'info', text: 'Running side by side shares this laptop’s CPU with the local model. Turn off “side by side” for the cleanest local timing.' });
  if (loadOn && chosen.some((t) => t.deployment === 'subscription') && Math.max(...levels) > 2)
    warnings.push({ tone: 'warn', text: 'High concurrency on Claude Code spends your plan’s usage quickly and spawns a CLI process per request.' });
  if (chosen.some((t) => t.deployment === 'local') && types.includes('callcard') && perType > 2)
    warnings.push({ tone: 'info', text: 'Call cards are the longest outputs. On a laptop CPU each one can take a minute or more.' });

  const canStart = chosen.length > 0 && types.length > 0 && !submitting && (!judgeOn || judgeTarget?.status.state === 'ready');

  const start = useCallback(async () => {
    if (!canStart) return;
    setSubmitting(true);
    const config: RunConfig = {
      name: name.trim() || defaultName(preset, chosen.length),
      targetIds: chosen.map((t) => t.id),
      taskTypes: types,
      tasksPerType: perType,
      repeats,
      concurrency: loadOn ? [...levels].sort((a, b) => a - b) : [],
      loadRequests,
      parallelTargets: parallel,
      judge: { enabled: judgeOn, targetId: judgeId },
    };
    try {
      const res = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success('Run started', { description: `${totalRequests} requests across ${chosen.length} targets` });
      router.push(`/runs/${body.id}`);
    } catch (e) {
      toast.error('Couldn’t start the run', { description: (e as Error).message });
      setSubmitting(false);
    }
  }, [canStart, name, preset, chosen, types, perType, repeats, loadOn, levels, loadRequests, parallel, judgeOn, judgeId, totalRequests, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  const markCustom = () => setPreset('custom');

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader eyebrow="New run" title="Set up a bake-off" description="Pick who competes and what they run. Every choice updates the estimate on the right." />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                { id: 'quick', icon: Zap, title: 'Quick check', body: 'One task per job type' },
                { id: 'quality', icon: Scale, title: 'Full quality', body: 'All 24 tasks, judged' },
                { id: 'load', icon: Gauge, title: 'Load test', body: 'Latency at 1, 4, 8 in flight' },
                { id: 'custom', icon: Layers, title: 'Custom', body: 'Your own mix' },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => (p.id === 'custom' ? setPreset('custom') : applyPreset(p.id))}
                className={cx(
                  'rounded-2xl border p-3.5 text-left transition',
                  preset === p.id ? 'border-forest-600 bg-sage-50 ring-1 ring-forest-600' : 'border-line bg-paper shadow-card hover:border-line-strong'
                )}
              >
                <p.icon className={cx('size-4', preset === p.id ? 'text-forest-600' : 'text-ink-3')} />
                <div className="mt-2 text-[13.5px] font-semibold">{p.title}</div>
                <div className="text-[12.5px] text-ink-3">{p.body}</div>
              </button>
            ))}
          </div>

          <Section n={1} title="Targets" hint={targets ? `${chosen.length} selected · ${ready.length} ready` : undefined}
            action={ready.length > 0 && <button className="text-[13px] font-medium text-forest-700 hover:text-forest-900" onClick={() => setSelected(selected.length === ready.length ? [] : ready.map((t) => t.id))}>{selected.length === ready.length ? 'Clear' : 'Select all ready'}</button>}>
            {loading && !targets ? (
              <div className="grid gap-2.5 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}</div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {visible.map((t) => (
                  <TargetCard
                    key={t.id}
                    t={t}
                    color={seriesColor(targets!.indexOf(t))}
                    selected={selected.includes(t.id)}
                    onToggle={() => setSelected((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}
                  />
                ))}
              </div>
            )}
          </Section>

          <Section n={2} title="Workload" hint="Scout’s four AI jobs, on fictional accounts">
            <div className="grid gap-2.5 sm:grid-cols-2">
              {TASK_TYPE_ORDER.map((t) => {
                const on = types.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() => {
                      markCustom();
                      setTypes((s) => (s.includes(t) ? s.filter((x) => x !== t) : TASK_TYPE_ORDER.filter((x) => x === t || s.includes(x))));
                    }}
                    className={cx('flex gap-3 rounded-xl border p-3.5 text-left transition', on ? 'border-forest-600 bg-sage-50/60' : 'border-line hover:border-line-strong')}
                  >
                    <Checkbox on={on} />
                    <div>
                      <div className="text-[14px] font-medium">{TASK_TYPES[t].label}</div>
                      <div className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{TASK_TYPES[t].blurb}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
              <Field label="Tasks per job type" hint={`of ${TASKS_PER_TYPE}`}>
                <Stepper value={perType} onChange={(v) => (markCustom(), setPerType(v))} min={1} max={TASKS_PER_TYPE} />
              </Field>
              <Field label="Repeats" hint="for variance">
                <Stepper value={repeats} onChange={(v) => (markCustom(), setRepeats(v))} min={1} max={5} />
              </Field>
            </div>
          </Section>

          <Section n={3} title="Load test" hint="How latency holds up with requests in flight">
            <Switch checked={loadOn} onChange={(v) => (markCustom(), setLoadOn(v))} label="Run a load phase after the quality phase" description="Fires a batch at each concurrency level, one target at a time." />
            <AnimatePresence initial={false}>
              {loadOn && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                    <Field label="Concurrency levels">
                      <div className="flex gap-1.5">
                        {[1, 2, 4, 8, 16].map((c) => (
                          <button
                            key={c}
                            onClick={() => setLevels((l) => (l.includes(c) ? (l.length > 1 ? l.filter((x) => x !== c) : l) : [...l, c]))}
                            className={cx('tabular h-9 w-11 rounded-[10px] border text-sm font-medium transition', levels.includes(c) ? 'border-forest-600 bg-forest-700 text-white' : 'border-line-strong bg-paper text-ink-2 hover:bg-mist')}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Requests per level">
                      <Stepper value={loadRequests} onChange={setLoadRequests} min={2} max={64} />
                    </Field>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          <Section n={4} title="Grading" hint="Deterministic checks always run">
            <Switch checked={judgeOn} onChange={setJudgeOn} label="LLM judge" description="Grades every output 1-5 against the playbook rubric. You can audit it in the Outputs tab." />
            {judgeOn && (
              <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                <span className="text-[13px] text-ink-3">Judge:</span>
                <Segmented
                  size="sm"
                  value={judgeId}
                  onChange={setJudgeId}
                  options={(targets ?? []).filter((t) => t.status.state === 'ready' && t.provider !== 'openai-compatible').map((t) => ({ value: t.id, label: t.label.replace(' · Claude Code', ' (CLI)') }))}
                />
                {!(targets ?? []).some((t) => t.status.state === 'ready' && t.provider !== 'openai-compatible') && <span className="text-[13px] text-warn">No Claude target is ready to judge. Log in to Claude Code or add an API key.</span>}
              </div>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <Switch checked={parallel} onChange={setParallel} label="Run targets side by side" description="Faster, and you get the race view. Off runs one target at a time for the cleanest timing." />
            </div>
          </Section>
        </div>

        {/* Summary */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="overflow-hidden">
            <div className="border-b border-line bg-mist/60 px-5 py-4">
              <label className="text-[12px] font-medium text-ink-3" htmlFor="run-name">Run name</label>
              <input
                id="run-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName(preset, chosen.length)}
                className="mt-1 h-9 w-full rounded-[10px] border border-line-strong bg-paper px-3 text-sm outline-none placeholder:text-ink-4 focus:border-forest-500 focus:shadow-[var(--ring)]"
              />
            </div>
            <div className="space-y-3.5 px-5 py-4">
              <Row icon={<Cpu />} label="Targets" value={chosen.length ? String(chosen.length) : 'None'} />
              <div className="-mt-1 flex flex-wrap gap-1.5 pl-6">
                {chosen.map((t) => (
                  <span key={t.id} className="flex items-center gap-1 rounded-full bg-mist px-2 py-0.5 text-[11.5px] text-ink-2">
                    <Swatch color={seriesColor(targets!.indexOf(t))} />
                    {t.label}
                  </span>
                ))}
              </div>
              <Row icon={<Layers />} label="Requests" value={fmt.int(totalRequests)} sub={`${chosen.length} warm-up · ${chosen.length * qualityPerTarget} quality${loadPerTarget ? ` · ${chosen.length * loadPerTarget} load` : ''}${judgeCalls ? ` · +${judgeCalls} judge` : ''}`} />
              <Row icon={<Clock />} label="Estimated time" value={chosen.length ? `~${fmt.duration(estimate.durationMs)}` : '—'} sub={chosen.some((t) => t.history.medianMs == null) ? 'Rough until a target has history' : 'From recent runs'} />
              <Row
                icon={<Wallet />}
                label="Estimated spend"
                value={estimate.cost == null ? 'Unknown' : estimate.cost < 0.01 ? '< $0.01' : fmt.usd(estimate.cost)}
                sub={estimate.unknown ? `${estimate.unknown} target${estimate.unknown > 1 ? 's' : ''} without price history` : 'Local runs are $0; Claude Code uses your plan'}
              />
            </div>
            {warnings.length > 0 && (
              <div className="space-y-2 border-t border-line px-5 py-4">
                {warnings.map((w) => (
                  <div key={w.text} className={cx('flex gap-2 text-[12.5px] leading-snug', w.tone === 'warn' ? 'text-warn' : 'text-ink-3')}>
                    {w.tone === 'warn' ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
                    {w.text}
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-line p-4">
              <Button variant="primary" size="lg" className="w-full" onClick={start} loading={submitting} disabled={!canStart} icon={<Play className="size-4" />}>
                Start run
                <span className="ml-1 flex gap-0.5">
                  <Kbd tone="dark">⌘</Kbd>
                  <Kbd tone="dark">↵</Kbd>
                </span>
              </Button>
              {!chosen.length && targets && <p className="mt-2 text-center text-[12.5px] text-ink-3">Select at least one ready target.</p>}
            </div>
          </Card>
          <p className="mt-3 px-1 text-[12.5px] leading-relaxed text-ink-4">
            Same run from the terminal:<br /><code className="font-mono text-[11.5px] break-all text-ink-3">npm run bakeoff -- run --per-type {perType}{loadOn ? ` --concurrency ${levels.join(',')}` : ''}</code>
          </p>
        </div>
      </div>
    </div>
  );
}

function defaultName(preset: Preset, n: number) {
  const label = { quick: 'Quick check', quality: 'Full quality', load: 'Load test', custom: 'Custom run' }[preset];
  return `${label} · ${n} target${n === 1 ? '' : 's'}`;
}

function Section({ n, title, hint, action, children }: { n: number; title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="tabular grid size-6 place-items-center rounded-full bg-forest-800 text-[12px] font-semibold text-white">{n}</span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <span className="text-[13px] text-ink-3">{hint}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12.5px] font-medium text-ink-2">
        {label} {hint && <span className="font-normal text-ink-4">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Row({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="flex gap-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-4">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-ink-3">{label}</span>
          <span className="tabular text-[15px] font-semibold">{value}</span>
        </div>
        {sub && <div className="mt-0.5 text-[12px] text-ink-4">{sub}</div>}
      </div>
    </div>
  );
}

function Checkbox({ on }: { on: boolean }) {
  return (
    <span className={cx('mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[6px] border transition', on ? 'border-forest-600 bg-forest-600 text-white' : 'border-line-strong bg-paper')}>
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function TargetCard({ t, color, selected, onToggle }: { t: TargetWithStatus; color: string; selected: boolean; onToggle: () => void }) {
  const isReady = t.status.state === 'ready';
  const fix = t.status.state === 'missing-key' ? t.apiKeyEnv : null;
  return (
    <div
      role="checkbox"
      aria-checked={selected}
      aria-disabled={!isReady}
      tabIndex={isReady ? 0 : -1}
      onClick={() => isReady && onToggle()}
      onKeyDown={(e) => isReady && (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onToggle())}
      className={cx(
        'group relative rounded-xl border p-3.5 transition',
        !isReady && 'cursor-not-allowed bg-mist/50',
        isReady && 'cursor-pointer',
        selected ? 'border-forest-600 bg-sage-50/60 ring-1 ring-forest-600' : isReady ? 'border-line hover:border-line-strong' : 'border-line'
      )}
    >
      <div className="flex items-start gap-3">
        {isReady ? <Checkbox on={selected} /> : <span className="mt-0.5 size-[18px] shrink-0 rounded-[6px] border border-dashed border-line-strong" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Swatch color={color} />
            <span className={cx('truncate text-[14px] font-medium', !isReady && 'text-ink-3')}>{t.label}</span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-ink-4">
            {t.vendor} · <span className="font-mono text-[11.5px]">{t.model}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={t.deployment === 'local' ? 'green' : t.deployment === 'subscription' ? 'info' : 'neutral'}>{t.deployment}</Badge>
            {isReady ? (
              <span className="flex items-center gap-1 text-[12px] text-forest-700">
                <Dot /> {t.status.detail ?? 'Ready'}
              </span>
            ) : fix ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void navigator.clipboard.writeText(`${fix}=`);
                  toast('Copied', { description: `Paste ${fix}=… into .env.local, then restart the dev server.` });
                }}
                className="flex items-center gap-1 rounded-md px-1 text-[12px] text-ink-3 hover:bg-paper hover:text-ink"
              >
                <Copy className="size-3" /> Needs {fix}
              </button>
            ) : (
              <span className="text-[12px] text-ink-3">{t.status.detail}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
