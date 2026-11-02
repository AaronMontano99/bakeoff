'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BookText, ChevronRight, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { WorkloadId } from '@/core/types';
import { DEFAULT_WORKLOAD, jobInfo, jobsOf, WORKLOAD_ORDER, WORKLOADS } from '@/core/workload/meta';
import { PageHeader } from '@/components/page';
import { Badge, Card, Segmented, Skeleton } from '@/components/ui';
import { fmt } from '@/lib/format';
import { taskSubtitle, useWorkload, type WorkloadData } from '@/lib/use-workload';

type T = WorkloadData['tasks'][number];

export default function WorkloadPage() {
  return (
    <Suspense>
      <Workload />
    </Suspense>
  );
}

function Workload() {
  const params = useSearchParams();
  const router = useRouter();
  const id: WorkloadId = WORKLOAD_ORDER.includes(params.get('w') as WorkloadId) ? (params.get('w') as WorkloadId) : DEFAULT_WORKLOAD;
  const { workload } = useWorkload(id);
  const JOBS = jobsOf(id);
  const meta = WORKLOADS[id]!;
  const sharedPrompt = workload?.tasks.find((t) => t.prompt.playbook)?.prompt.playbook;
  const [open, setOpen] = useState<T | null>(null);
  const [showPlaybook, setShowPlaybook] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <PageHeader
        title="What every model runs"
        description={workload?.description ?? 'Loading…'}
        actions={
          <button onClick={() => setShowPlaybook(true)} className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-mist px-3.5 text-sm font-medium shadow-card hover:bg-mist">
            <BookText className="size-4" /> {meta.sharedPrompt.button}
          </button>
        }
      />

      <div className="mb-4">
        <Segmented value={id} onChange={(w) => (setOpen(null), router.replace(`/workload?w=${w}`))} options={WORKLOAD_ORDER.map((w) => ({ value: w, label: WORKLOADS[w]!.name }))} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {JOBS.map((t) => (
          <Card key={t} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">{jobInfo(t).label}</h3>
              <Badge tone="green">{jobInfo(t).sloMetric === 'ttft' ? 'first word' : 'p95'} budget {fmt.sec(jobInfo(t).defaultSloMs, 0)}</Badge>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-2">{jobInfo(t).blurb}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{jobInfo(t).profile}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {!workload ? (
          <Skeleton className="h-96" />
        ) : (
          JOBS.map((type) => (
            <section key={type}>
              <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{jobInfo(type).label}</h2>
              <Card className="divide-y divide-line overflow-hidden">
                {workload.tasks.filter((t) => t.type === type).map((t) => (
                  <button key={t.id} onClick={() => setOpen(t)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-mist/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{t.title}</div>
                      <div className="truncate text-[12.5px] text-ink-3">{taskSubtitle(t)}</div>
                    </div>
                    {t.split === 'holdout' && <Badge>holdout</Badge>}
                    {t.gold?.expectProposal === true && <Badge tone="green">proposal</Badge>}
                    {t.gold?.decline === true && <Badge tone="warn">off-topic</Badge>}
                    {meta.expected?.(t).slice(0, 2).map((e) => (
                      <Badge key={e} tone="green">{e}</Badge>
                    ))}
                    <ChevronRight className="size-4 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </button>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>

      <Drawer open={!!open || showPlaybook} onClose={() => (setOpen(null), setShowPlaybook(false))} title={showPlaybook ? meta.sharedPrompt.title : open?.title ?? ''}>
        {showPlaybook ? (
          <>
            <p className="mb-3 text-[13px] text-ink-3">
              {meta.sharedPrompt.note}
            </p>
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{sharedPrompt}</pre>
          </>
        ) : open ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="dark">{jobInfo(open.type).label}</Badge>
              {meta.expected?.(open).map((e) => (
                <Badge key={e} tone="green">{e}</Badge>
              ))}
            </div>
            {meta.showGold && open.gold && Object.keys(open.gold).length > 0 && (
              <div>
                <div className="mb-1 text-[12px] font-semibold tracking-wide text-ink-4 uppercase">What the checks look for</div>
                <pre className="rounded-xl bg-mist p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{JSON.stringify(open.gold, null, 2)}</pre>
              </div>
            )}
            <div>
              <div className="mb-1 text-[12px] font-semibold tracking-wide text-ink-4 uppercase">{open.prompt.playbook ? 'User message (after the shared prompt)' : 'The whole prompt (the app sends no system prompt)'}</div>
              <pre className="rounded-xl bg-mist p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{open.prompt.user}</pre>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-scrim/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="fixed inset-y-0 right-0 z-50 solid flex w-full max-w-xl flex-col shadow-pop"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 40 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <h2 className="truncate text-[15px] font-semibold">{title}</h2>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-mist" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
