'use client';

import { Check, ChevronDown, Code2, Gavel, Scale, UserCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { extractJson } from '@/core/json';
import type { ResultRow, RunRow, TaskType } from '@/core/types';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { Badge, Card, cx, Kbd, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import type { RunModel } from '@/lib/run-model';
import { useWorkload } from '@/lib/use-workload';

export function OutputsTab({ run, results, setResults, model }: { run: RunRow; results: ResultRow[]; setResults: Dispatch<SetStateAction<ResultRow[]>>; model: RunModel }) {
  const { task } = useWorkload();
  const quality = useMemo(() => results.filter((r) => r.phase === 'quality'), [results]);
  const taskIds = useMemo(() => {
    const ids = [...new Set(quality.map((r) => r.taskId))];
    return ids.sort((a, b) => TASK_TYPE_ORDER.indexOf(quality.find((r) => r.taskId === a)!.taskType) - TASK_TYPE_ORDER.indexOf(quality.find((r) => r.taskId === b)!.taskType));
  }, [quality]);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const current = selected ?? taskIds[0] ?? null;
  const rows = quality.filter((r) => r.taskId === current).sort((a, b) => model.ids.indexOf(a.targetId) - model.ids.indexOf(b.targetId) || a.repeat - b.repeat);
  const t = current ? task(current) : undefined;

  const grade = useCallback(
    async (resultId: number, score: number | null) => {
      setResults((rs) => rs.map((r) => (r.id === resultId ? { ...r, humanScore: score } : r)));
      const res = await fetch(`/api/results/${resultId}/grade`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ score }) });
      if (!res.ok) toast.error('Couldn’t save that grade');
    },
    [setResults]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const idx = current ? taskIds.indexOf(current) : -1;
      if (e.key === 'j' && idx < taskIds.length - 1) (setSelected(taskIds[idx + 1]!), setFocus(0));
      else if (e.key === 'k' && idx > 0) (setSelected(taskIds[idx - 1]!), setFocus(0));
      else if (e.key === 'ArrowRight' || e.key === 'l') setFocus((f) => Math.min(rows.length - 1, f + 1));
      else if (e.key === 'ArrowLeft' || e.key === 'h') setFocus((f) => Math.max(0, f - 1));
      else if (/^[1-5]$/.test(e.key) && rows[focus]?.ok) {
        void grade(rows[focus]!.id, Number(e.key));
        if (focus < rows.length - 1) setFocus(focus + 1);
      } else if (e.key === '0' && rows[focus]) void grade(rows[focus]!.id, null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, taskIds, rows, focus, grade]);

  const graded = quality.filter((r) => r.humanScore != null).length;
  const cal = model.cal;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-line bg-mist/50 px-4 py-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 text-[13.5px] font-medium text-ink-2">
          <Scale className="size-4 text-forest-600" /> Judge calibration
        </div>
        {cal.n === 0 ? (
          <p className="text-[13px] text-ink-3">
            Grade a few outputs yourself (press <Kbd>1</Kbd>–<Kbd>5</Kbd>) to see how far to trust the judge.
          </p>
        ) : (
          <div className="tabular flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-3">
            <span><b className="text-ink">{graded}</b> graded</span>
            <span>Exact agreement <b className="text-ink">{fmt.pct(cal.exact)}</b></span>
            <span>Within one point <b className="text-ink">{fmt.pct(cal.withinOne)}</b></span>
            {cal.spearman != null && <span>Rank correlation <b className="text-ink">{cal.spearman.toFixed(2)}</b></span>}
            {cal.bias != null && <span>Judge is <b className="text-ink">{Math.abs(cal.bias) < 0.25 ? 'unbiased' : cal.bias > 0 ? `${cal.bias.toFixed(1)} pts generous` : `${(-cal.bias).toFixed(1)} pts harsh`}</b></span>}
          </div>
        )}
        <div className="flex items-center gap-1 text-[12px] text-ink-4 sm:ml-auto">
          <Kbd>J</Kbd>/<Kbd>K</Kbd> task · <Kbd>←</Kbd>/<Kbd>→</Kbd> output · <Kbd>1</Kbd>–<Kbd>5</Kbd> grade
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card className="h-fit overflow-hidden lg:sticky lg:top-4">
          <div className="max-h-[70vh] overflow-y-auto p-2 scrollbar-thin">
            {TASK_TYPE_ORDER.filter((tt) => run.config.taskTypes.includes(tt)).map((tt) => (
              <div key={tt} className="mb-1">
                <div className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{TASK_TYPES[tt].label}</div>
                {taskIds
                  .filter((id) => quality.find((r) => r.taskId === id)?.taskType === tt)
                  .map((id) => {
                    const mine = quality.filter((r) => r.taskId === id);
                    return (
                      <button
                        key={id}
                        onClick={() => (setSelected(id), setFocus(0))}
                        className={cx('w-full rounded-[10px] px-2.5 py-2 text-left transition', id === current ? 'bg-sage-100 text-forest-900' : 'hover:bg-mist')}
                      >
                        <div className="truncate text-[13px] font-medium">{task(id)?.title ?? id}</div>
                        <div className="mt-1 flex gap-1">
                          {mine.map((r) => (
                            <span
                              key={r.id}
                              title={`${model.meta(r.targetId).label}: checks ${fmt.score(r.checkScore)}`}
                              className="h-1.5 flex-1 rounded-full"
                              style={{ background: !r.ok ? '#b4321f' : (r.checkScore ?? 0) >= 0.99 ? '#237a55' : (r.checkScore ?? 0) >= 0.7 ? '#a9cbb5' : '#e3b9a8' }}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {t && (
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="dark">{TASK_TYPES[t.type].label}</Badge>
                {t.gold?.signalStatus && <Badge tone="green">Answer: {t.gold.signalStatus}</Badge>}
                {t.gold?.outcome && <Badge tone="green">Answer: {t.gold.outcome.replace(/_/g, ' ')}</Badge>}
                {t.gold?.meetingAsked != null && <Badge>meeting asked: {String(t.gold.meetingAsked)}</Badge>}
              </div>
              <h2 className="mt-2.5 text-[18px] font-semibold tracking-[-0.01em]">{t.title}</h2>
              <p className="mt-1 text-[13.5px] text-ink-3">
                {t.account.company} · {t.account.industry} · {t.account.contact.name}, {t.account.contact.title}
              </p>
              <details className="group mt-3">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[13px] font-medium text-forest-700 hover:text-forest-900">
                  <ChevronDown className="size-3.5 transition group-open:rotate-180" /> What the model was given
                </summary>
                <pre className="mt-2 max-h-80 overflow-y-auto rounded-xl bg-mist p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin">{t.prompt.user}</pre>
              </details>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            {rows.map((r, i) => (
              <OutputCard key={r.id} r={r} model={model} type={r.taskType} focused={i === focus} onFocus={() => setFocus(i)} onGrade={(s) => grade(r.id, s)} repeatLabel={run.config.repeats > 1 ? `run ${r.repeat + 1}` : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutputCard({ r, model, type, focused, onFocus, onGrade, repeatLabel }: { r: ResultRow; model: RunModel; type: TaskType; focused: boolean; onFocus: () => void; onGrade: (s: number | null) => void; repeatLabel?: string }) {
  const [raw, setRaw] = useState(false);
  const m = model.meta(r.targetId);
  const parsed = r.output ? (extractJson(r.output) as Record<string, unknown> | null) : null;
  return (
    <div onClick={onFocus} className={cx('flex flex-col rounded-2xl border bg-paper shadow-card transition', focused ? 'border-forest-500 ring-2 ring-forest-500/20' : 'border-line')}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Swatch color={m.color} />
        <span className="truncate text-[13.5px] font-semibold">{m.label}</span>
        {repeatLabel && <Badge>{repeatLabel}</Badge>}
        <span className="tabular ml-auto flex shrink-0 items-center gap-2.5 text-[12px] text-ink-3">
          <span title="Time to first token">{fmt.sec(r.ttftMs)}</span>
          <span title="Total time">{fmt.sec(r.totalMs)}</span>
          <span title="Cost">{fmt.usd(r.costUsd)}</span>
        </span>
      </div>

      <div className="flex-1 px-4 py-3.5">
        {!r.ok ? (
          <div className="rounded-xl bg-[#fdf1ef] p-3 text-[13px] text-bad">{r.error}</div>
        ) : raw || !parsed ? (
          <pre className="max-h-80 overflow-y-auto font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin">{r.output}</pre>
        ) : (
          <Pretty type={type} o={parsed} />
        )}
      </div>

      {r.ok && (
        <div className="space-y-3 border-t border-line px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {r.checks.map((c) => (
              <span
                key={c.id}
                title={c.detail}
                className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px]', c.pass ? 'bg-sage-50 text-forest-700' : 'bg-[#fdf1ef] text-bad')}
              >
                {c.pass ? <Check className="size-3" /> : <X className="size-3" />}
                {c.label}
              </span>
            ))}
          </div>
          {r.judgeRationale && (
            <div className="flex gap-2 text-[12.5px] leading-snug text-ink-3">
              <Gavel className="mt-0.5 size-3.5 shrink-0 text-ink-4" />
              <span>
                {r.judgeScore != null && <b className="mr-1 text-ink">{r.judgeScore}/5</b>}
                {r.judgeRationale}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <UserCheck className="size-3.5 text-ink-4" />
            <span className="text-[12px] text-ink-3">Your grade</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={(e) => {
                    e.stopPropagation();
                    onGrade(r.humanScore === s ? null : s);
                  }}
                  className={cx(
                    'tabular size-7 rounded-lg border text-[12.5px] font-medium transition',
                    r.humanScore === s ? 'border-forest-600 bg-forest-700 text-white' : 'border-line text-ink-3 hover:border-line-strong hover:text-ink'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <button onClick={(e) => (e.stopPropagation(), setRaw((v) => !v))} className="ml-auto flex items-center gap-1 text-[12px] text-ink-4 hover:text-ink" title="Show raw output">
              <Code2 className="size-3.5" /> {raw ? 'Formatted' : 'Raw'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide text-ink-4 uppercase">{label}</div>
      <div className="mt-0.5 text-[13.5px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

function Pretty({ type, o }: { type: TaskType; o: Record<string, unknown> }) {
  switch (type) {
    case 'signal':
      return (
        <div className="space-y-3">
          <Badge tone={s(o.signalStatus).startsWith('HARD') ? 'green' : s(o.signalStatus).startsWith('SOFT') ? 'warn' : 'neutral'}>{s(o.signalStatus) || 'No label'}</Badge>
          <Field label="Why now">{s(o.whyNow)}</Field>
          <Field label="Evidence">{s(o.evidence)}</Field>
        </div>
      );
    case 'debrief':
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="dark">{s(o.outcome).replace(/_/g, ' ') || 'no outcome'}</Badge>
            <Badge>asked: {String(o.meetingAsked)}</Badge>
            <Badge>booked: {String(o.meetingBooked)}</Badge>
          </div>
          <Field label="Summary">{s(o.summary)}</Field>
          <Field label="Next step">{s(o.nextStep)}</Field>
          {Array.isArray(o.crmNotes) && (
            <Field label="CRM notes">
              <ul className="list-disc space-y-0.5 pl-4">{o.crmNotes.map((n, i) => <li key={i}>{s(n)}</li>)}</ul>
            </Field>
          )}
        </div>
      );
    case 'email':
      return (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="border-b border-line bg-mist/60 px-3 py-2 text-[12.5px]">
            <span className="text-ink-4">Subject </span>
            <span className="font-medium">{s(o.subject)}</span>
            <Badge className="ml-2">{s(o.ctaType) || 'cta?'}</Badge>
          </div>
          <div className="px-3 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">{s(o.body)}</div>
        </div>
      );
    case 'callcard':
      return (
        <div className="space-y-3">
          <Field label="Opening">“{s(o.opening)}”</Field>
          <Field label="Primary question">{s(o.primaryQuestion)}</Field>
          <Field label="Angle">{s(o.angle)}</Field>
          <Field label="Meeting ask">{s(o.meetingAsk)}</Field>
          <Field label="Voicemail">{s(o.voicemail)}</Field>
          <Field label="If no answer">{s(o.ifNoAnswer)}</Field>
        </div>
      );
  }
}
