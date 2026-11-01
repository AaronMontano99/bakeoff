'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';
import { defaultCaseInputs } from '@/core/analysis';
import { ScoreRing, shortLabel, SpeedBars } from '@/components/charts';
import { PageHeader } from '@/components/page';
import { Button, cx, Skeleton, Swatch } from '@/components/ui';
import { DIRECTIONS, useLook, type DirectionId } from '@/lib/appearance';
import { fmt } from '@/lib/format';
import { useRunModel, type RunModel } from '@/lib/run-model';
import type { RunDetail, RunListItem, TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';

/**
 * Every direction on one screen, showing the latest real run. A direction is
 * only a [data-theme] block, so each column is just the real components
 * inside a different attribute.
 */
export default function LabPage() {
  const { data: runs } = useJson<RunListItem[]>('/api/runs');
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets');
  const latest = runs?.find((r) => r.status === 'done');
  const { data } = useJson<RunDetail>(latest ? `/api/runs/${latest.id}` : null);
  const [inputs] = useState(defaultCaseInputs);
  const model = useRunModel(data?.run, data?.results ?? [], targets, inputs);

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8">
      <PageHeader title="Pick a look" description={latest ? `Same real data in all three: ${latest.name}. Using one re-skins the whole app, and Tweaks fine-tunes from there.` : 'Finish a run and the real numbers show up here.'} />
      <div className="grid gap-5 lg:grid-cols-3">
        {DIRECTIONS.map((d) => (
          <Preview key={d.id} id={d.id} name={d.name} blurb={d.blurb} model={model} />
        ))}
      </div>
    </div>
  );
}

function Preview({ id, name, blurb, model }: { id: DirectionId; name: string; blurb: string; model: RunModel | null }) {
  const { look, update } = useLook();
  const on = look.direction === id;
  const ranked = model ? [...model.summaries].sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1)) : [];
  const top = ranked.slice(0, 3);
  const speed = top.filter((s) => s.ttftP50 != null && s.totalP50 != null).map((s) => ({ id: s.targetId, label: model!.meta(s.targetId).label, firstToken: s.ttftP50!, total: s.totalP50! }));
  return (
    <article data-theme={id} className={cx('relative isolate overflow-hidden rounded-2xl border text-ink', on ? 'border-tint-line' : 'border-line')} style={{ background: 'var(--page)' }}>
      <div className="absolute inset-0 -z-10 bg-cover bg-bottom" style={{ backgroundImage: 'var(--sky)' }} />
      <div className="absolute inset-0 -z-10" style={{ background: 'var(--wash)' }} />
      <div className="space-y-4 p-5">
        <div>
          <h2 className="font-head text-[30px] leading-tight">{name}</h2>
          <p className="mt-1 text-[14px] text-ink-2">{blurb}</p>
        </div>
        {!model ? (
          <Skeleton className="h-96" />
        ) : (
          <>
            <div className="rounded-xl bg-hero p-4 text-on-hero">
              <p className="font-head text-[17px] leading-snug line-clamp-3">{model.bc.headline}</p>
            </div>
            <div className="glass rounded-2xl border border-line p-3 shadow-card">
              <div className="space-y-1">
                {top.map((s, i) => (
                  <div key={s.targetId} className={cx('flex items-center gap-3 rounded-xl p-2.5', i === 0 && 'bg-tint-2')}>
                    <ScoreRing value={s.quality} size={46} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
                        <Swatch color={model.meta(s.targetId).color} />
                        <span className="truncate">{shortLabel(model.meta(s.targetId).label)}</span>
                      </div>
                      <div className="tabular mt-0.5 text-[12.5px] text-ink-3">
                        {fmt.sec(s.totalP95)} p95 · {fmt.usd(s.costPerRequest)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl border border-line p-3 shadow-card">
              <SpeedBars rows={speed} />
            </div>
          </>
        )}
        <Button variant={on ? 'secondary' : 'primary'} className="w-full" icon={on ? <Check className="size-4" /> : undefined} onClick={() => update({ direction: id })}>
          {on ? 'Using this look' : `Use ${name}`}
        </Button>
      </div>
    </article>
  );
}
