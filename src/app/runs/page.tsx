'use client';

import { ArrowRight, History, Play, Trophy } from 'lucide-react';
import Link from 'next/link';
import { PageHeader, StatusBadge } from '@/components/page';
import { ButtonLink, Card, EmptyState, Progress, Skeleton, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import { seriesColor } from '@/lib/palette';
import type { RunListItem, TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';

export default function RunsPage() {
  const { data: runs, loading } = useJson<RunListItem[]>('/api/runs', { refreshMs: 4_000 });
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets');
  const t = (id: string) => targets?.find((x) => x.id === id);
  const color = (id: string) => seriesColor(targets?.findIndex((x) => x.id === id) ?? -1);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
      <PageHeader eyebrow="History" title="Runs" description="Every bake-off, from the dashboard or the terminal." actions={<ButtonLink href="/runs/new" variant="primary" icon={<Play className="size-4" />} kbd="N">New run</ButtonLink>} />
      {loading && !runs ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !runs?.length ? (
        <Card>
          <EmptyState icon={<History className="size-5" />} title="No runs yet" body="Your first bake-off takes a couple of minutes with the quick-check preset." action={<ButtonLink href="/runs/new?preset=quick" variant="primary">Run a quick check</ButtonLink>} />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {runs.map((r) => {
            const active = ['running', 'judging', 'queued'].includes(r.status);
            return (
              <Link key={r.id} href={`/runs/${r.id}`} className="group flex flex-col gap-3 px-5 py-4 transition hover:bg-mist/50 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate text-[14.5px] font-medium">{r.name}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
                    <span>{fmt.ago(r.createdAt)}</span>
                    <span>{r.completed}{active ? ` / ${r.totalPlanned}` : ''} requests</span>
                    <span className="flex items-center gap-1">
                      {r.config.targetIds.map((id) => <Swatch key={id} color={color(id)} />)}
                      <span className="ml-1">{r.config.targetIds.length} targets</span>
                    </span>
                  </div>
                  {r.headline && <p className="mt-2 line-clamp-1 text-[13px] text-ink-2">{r.headline}</p>}
                  {active && <div className="mt-2.5 max-w-sm"><Progress value={r.totalPlanned ? r.completed / r.totalPlanned : 0} running /></div>}
                </div>
                {r.best && (
                  <div className="flex shrink-0 items-center gap-1.5 text-[12.5px] text-ink-3">
                    <Trophy className="size-3.5 text-forest-600" />
                    {t(r.best.targetId)?.label ?? r.best.targetId}
                    <span className="tabular font-semibold text-ink">{fmt.score(r.best.quality)}</span>
                  </div>
                )}
                <ArrowRight className="hidden size-4 shrink-0 text-ink-4 transition group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
