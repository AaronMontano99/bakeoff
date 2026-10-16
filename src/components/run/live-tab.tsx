'use client';

import { AnimatePresence, motion } from 'motion/react';
import { Check, CircleAlert, Flame, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ResultRow, RunRow } from '@/core/types';
import { TASK_TYPES } from '@/core/workload/meta';
import { Sparkline } from '@/components/charts';
import { Badge, cx, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import type { RunModel } from '@/lib/run-model';
import type { Lane } from '@/lib/use-run-live';
import { useWorkload } from '@/lib/use-workload';
import { median } from '@/lib/median';

/** The race view: one lane per target, responses streaming in as they're generated. */
export function LiveTab({ run, results, lanes, model }: { run: RunRow; results: ResultRow[]; lanes: Record<string, Lane>; model: RunModel }) {
  const { task } = useWorkload();
  const perTarget = run.config.taskTypes.length * run.config.tasksPerType * run.config.repeats;
  const recent = [...results].reverse().slice(0, 8);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {model.ids.map((id) => {
          const m = model.meta(id);
          const mine = results.filter((r) => r.targetId === id);
          const q = mine.filter((r) => r.phase === 'quality');
          const warm = mine.find((r) => r.phase === 'warmup');
          const lane = lanes[id];
          const last = q[q.length - 1];
          const done = q.length >= perTarget && !lane;
          const failures = mine.filter((r) => !r.ok).length;
          return (
            <motion.div layout key={id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
              <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                <Swatch color={m.color} />
                <span className="truncate text-[14px] font-semibold">{m.label}</span>
                <span className="ml-auto flex items-center gap-2">
                  {failures > 0 && <Badge tone="bad" icon={<CircleAlert className="size-3" />}>{failures} failed</Badge>}
                  {done ? (
                    <Badge tone="green" icon={<Check className="size-3" />}>Done</Badge>
                  ) : lane ? (
                    <Badge tone="info" icon={<Loader2 className="size-3 animate-spin" />}>{lane.phase === 'warmup' ? 'Warming up' : 'Generating'}</Badge>
                  ) : (
                    <Badge>Waiting</Badge>
                  )}
                </span>
              </div>

              <div className="grid grid-cols-4 divide-x divide-line border-b border-line text-center">
                <Metric label="Done" value={`${q.length}/${perTarget}`} />
                <Metric label="Last TTFT" value={fmt.sec(last?.ttftMs)} />
                <Metric label="Median" value={fmt.sec(median(q.filter((r) => r.ok).map((r) => r.totalMs)))} />
                <Metric label="Checks" value={q.length ? fmt.score(q.reduce((a, r) => a + (r.checkScore ?? 0), 0) / q.length) : '—'} />
              </div>

              <div className="relative h-44 bg-[#fbfcfb]">
                {lane ? (
                  <StreamBox lane={lane} title={task(lane.taskId ?? '')?.title ?? lane.taskId ?? ''} />
                ) : (
                  <div className="grid h-full place-items-center px-6 text-center text-[13px] text-ink-4">
                    {done ? (
                      <div>
                        <div className="text-ink-3">Finished {q.length} requests</div>
                        <div className="mt-2 flex justify-center">
                          <Sparkline values={q.filter((r) => r.ok).map((r) => r.totalMs)} color={m.color} width={140} height={28} />
                        </div>
                      </div>
                    ) : run.status === 'running' ? (
                      'Waiting for its turn…'
                    ) : (
                      'Idle'
                    )}
                  </div>
                )}
              </div>

              {warm && (
                <div className="flex items-center gap-1.5 border-t border-line px-4 py-2 text-[12px] text-ink-3">
                  <Flame className="size-3.5 text-warn" /> Cold start {fmt.sec(warm.totalMs)}
                  {warm.ok ? '' : ` (failed: ${warm.error})`}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold tracking-wide text-ink-2 uppercase">Latest requests</h3>
        <div className="overflow-hidden rounded-2xl border border-line">
          <AnimatePresence initial={false}>
            {recent.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, backgroundColor: '#e4efe8' }}
                animate={{ opacity: 1, backgroundColor: '#ffffff' }}
                transition={{ duration: 0.8 }}
                className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[13px] last:border-b-0"
              >
                {r.ok ? <Check className="size-3.5 shrink-0 text-forest-600" /> : <CircleAlert className="size-3.5 shrink-0 text-bad" />}
                <Swatch color={model.meta(r.targetId).color} />
                <span className="w-40 shrink-0 truncate text-ink-2 sm:w-56">{model.meta(r.targetId).label}</span>
                <span className="min-w-0 flex-1 truncate text-ink-3">
                  {r.phase !== 'quality' && <Badge className="mr-1.5">{r.phase === 'load' ? `load ×${r.concurrency}` : 'warm-up'}</Badge>}
                  {task(r.taskId)?.title ?? r.taskId}
                </span>
                <span className="tabular hidden w-20 text-right text-ink-3 sm:block">{TASK_TYPES[r.taskType].label}</span>
                <span className="tabular w-16 text-right font-medium">{r.ok ? fmt.sec(r.totalMs) : 'failed'}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {!recent.length && <div className="px-4 py-6 text-center text-[13px] text-ink-4">The first results appear here as they finish.</div>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-2">
      <div className="text-[11px] text-ink-4">{label}</div>
      <div className="tabular text-[13.5px] font-semibold">{value}</div>
    </div>
  );
}

function StreamBox({ lane, title }: { lane: Lane; title: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lane.text]);
  const waiting = !lane.text;
  const since = lane.startedAt ? Date.now() - lane.startedAt : 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-2.5 text-[11.5px] text-ink-4">
        <span className="truncate">{title}</span>
        <span className="tabular shrink-0 pl-2">{lane.firstTokenAt && lane.startedAt ? `first token ${fmt.sec(lane.firstTokenAt - lane.startedAt)}` : `${fmt.sec(since)}…`}</span>
      </div>
      <pre ref={ref} className={cx('flex-1 overflow-y-auto px-4 pt-1.5 pb-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin', waiting && 'grid place-items-center')}>
        {waiting ? (
          <span className="flex items-center gap-2 font-sans text-[13px] text-ink-4">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for the first token…
          </span>
        ) : (
          <>
            {lane.text}
            <span className="ml-px inline-block h-3.5 w-[7px] translate-y-0.5 animate-caret bg-forest-500" />
          </>
        )}
      </pre>
    </div>
  );
}
