'use client';
import type { ReactNode } from 'react';
import { Badge, Dot } from './ui';

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-head text-[34px] leading-[1.08] text-balance sm:text-[44px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: 'green' | 'warn' | 'bad' | 'neutral' | 'info'; label: string }> = {
    done: { tone: 'green', label: 'Done' },
    running: { tone: 'info', label: 'Running' },
    judging: { tone: 'info', label: 'Judging' },
    queued: { tone: 'neutral', label: 'Queued' },
    failed: { tone: 'bad', label: 'Failed' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
  };
  const s = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={s.tone} icon={s.tone === 'info' ? <Dot pulse /> : undefined}>{s.label}</Badge>;
}
