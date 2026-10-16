'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BookText, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TASK_TYPE_ORDER, TASK_TYPES } from '@/core/workload/meta';
import { PageHeader } from '@/components/page';
import { Badge, Card, Skeleton } from '@/components/ui';
import { fmt } from '@/lib/format';
import { useWorkload, type WorkloadData } from '@/lib/use-workload';

type T = WorkloadData['tasks'][number];

export default function WorkloadPage() {
  const { workload } = useWorkload();
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
        eyebrow="Workload"
        title="What every model runs"
        description={workload?.description ?? 'Loading…'}
        actions={
          <button onClick={() => setShowPlaybook(true)} className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-paper px-3.5 text-sm font-medium shadow-card hover:bg-mist">
            <BookText className="size-4" /> Read the shared playbook
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {TASK_TYPE_ORDER.map((t) => (
          <Card key={t} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">{TASK_TYPES[t].label}</h3>
              <Badge tone="green">p95 budget {fmt.sec(TASK_TYPES[t].defaultSloMs, 0)}</Badge>
            </div>
            <p className="mt-1.5 text-[13.5px] text-ink-2">{TASK_TYPES[t].blurb}</p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-3">{TASK_TYPES[t].profile}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 space-y-6">
        {!workload ? (
          <Skeleton className="h-96" />
        ) : (
          TASK_TYPE_ORDER.map((type) => (
            <section key={type}>
              <h2 className="mb-2 text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{TASK_TYPES[type].label}</h2>
              <Card className="divide-y divide-line overflow-hidden">
                {workload.tasks.filter((t) => t.type === type).map((t) => (
                  <button key={t.id} onClick={() => setOpen(t)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-mist/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{t.title}</div>
                      <div className="truncate text-[12.5px] text-ink-3">{t.account.industry} · {t.account.city}</div>
                    </div>
                    {t.gold?.signalStatus && <Badge tone="green">{t.gold.signalStatus}</Badge>}
                    {t.gold?.outcome && <Badge tone="green">{t.gold.outcome.replace(/_/g, ' ')}</Badge>}
                    <ChevronRight className="size-4 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </button>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>

      <Drawer open={!!open || showPlaybook} onClose={() => (setOpen(null), setShowPlaybook(false))} title={showPlaybook ? 'Shared rep playbook' : open?.title ?? ''}>
        {showPlaybook ? (
          <>
            <p className="mb-3 text-[13px] text-ink-3">Sent first on every request, byte-for-byte identical. That makes it the prompt-caching candidate: targets with caching on read it from cache after the first call.</p>
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{workload?.tasks[0]?.prompt.playbook}</pre>
          </>
        ) : open ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="dark">{TASK_TYPES[open.type].label}</Badge>
              {open.gold?.signalStatus && <Badge tone="green">Expected: {open.gold.signalStatus}</Badge>}
              {open.gold?.outcome && <Badge tone="green">Expected: {open.gold.outcome.replace(/_/g, ' ')}</Badge>}
              {open.gold?.meetingAsked != null && <Badge>asked {String(open.gold.meetingAsked)} · booked {String(open.gold.meetingBooked)}</Badge>}
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-ink-4 uppercase">User message (after the playbook)</div>
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
          <motion.div className="fixed inset-0 z-40 bg-forest-950/30 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-paper shadow-pop"
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
