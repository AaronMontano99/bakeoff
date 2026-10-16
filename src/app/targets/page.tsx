'use client';

import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page';
import { Badge, Button, Card, cx, Dot, Skeleton, Swatch } from '@/components/ui';
import { fmt } from '@/lib/format';
import { seriesColor } from '@/lib/palette';
import type { TargetWithStatus } from '@/lib/types-client';
import { useJson } from '@/lib/use-json';

const GROUPS = [
  { key: 'local', title: 'On this laptop', body: 'Free at the margin, capped by the hardware.' },
  { key: 'subscription', title: 'On your Claude plan', body: 'Claude Code CLI, no API key. Cost shown is the API-equivalent the CLI reports.' },
  { key: 'serverless', title: 'Serverless APIs', body: 'Pay per token. Add the key to .env.local and restart the dev server.' },
  { key: 'dedicated', title: 'Dedicated GPUs', body: 'Pay per GPU-hour. Add the hourly price to see the crossover in the business case.' },
] as const;

export default function TargetsPage() {
  const { data: targets, loading, refresh } = useJson<TargetWithStatus[]>('/api/targets');
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    await fetch('/api/targets?fresh=1', { cache: 'no-store' });
    await refresh();
    setChecking(false);
    toast('Status refreshed');
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <PageHeader
        eyebrow="Targets"
        title="Who competes"
        description="Every model and provider the bake-off can run. Prices you enter here are written to config/targets.json so they’re versioned with the results."
        actions={<Button icon={<RefreshCw className={cx('size-3.5', checking && 'animate-spin')} />} onClick={recheck}>Re-check</Button>}
      />
      {loading && !targets ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = (targets ?? []).filter((t) => t.deployment === g.key);
            if (!items.length) return null;
            return (
              <section key={g.key}>
                <h2 className="text-[15px] font-semibold">{g.title}</h2>
                <p className="mb-3 text-[13px] text-ink-3">{g.body}</p>
                <div className="space-y-3">
                  {items.map((t) => <TargetRow key={t.id} t={t} color={seriesColor(targets!.indexOf(t))} onSaved={refresh} />)}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TargetRow({ t, color, onSaved }: { t: TargetWithStatus; color: string; onSaved: () => void }) {
  const [inPrice, setIn] = useState(t.pricing.inputPerMTok?.toString() ?? '');
  const [outPrice, setOut] = useState(t.pricing.outputPerMTok?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = inPrice !== (t.pricing.inputPerMTok?.toString() ?? '') || outPrice !== (t.pricing.outputPerMTok?.toString() ?? '');
  const editable = t.deployment === 'serverless' || t.deployment === 'dedicated';
  const ready = t.status.state === 'ready';

  const save = async () => {
    setSaving(true);
    const res = await fetch(`/api/targets/${t.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pricing: { inputPerMTok: inPrice === '' ? null : Number(inPrice), outputPerMTok: outPrice === '' ? null : Number(outPrice), verifiedOn: new Date().toISOString().slice(0, 10) } }),
    });
    setSaving(false);
    if (res.ok) {
      toast.success('Price saved', { description: `${t.label}: $${inPrice || '—'} in / $${outPrice || '—'} out per 1M tokens` });
      onSaved();
    } else toast.error('Couldn’t save the price');
  };

  return (
    <Card id={t.id} className={cx('scroll-mt-6 p-5 target:ring-2 target:ring-forest-500/40', !t.enabled && 'opacity-60')}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Swatch color={color} />
            <h3 className="text-[15px] font-semibold">{t.label}</h3>
            <Badge>{t.vendor}</Badge>
            {t.promptCaching && <Badge tone="info">prompt caching</Badge>}
            {t.effort && <Badge>effort: {t.effort}</Badge>}
          </div>
          <div className="mt-1 font-mono text-[12px] text-ink-3">{t.model}</div>
          <div className="mt-2.5 flex items-center gap-2 text-[13px]">
            <Dot tone={ready ? 'green' : t.status.state === 'disabled' ? 'muted' : 'warn'} />
            <span className={ready ? 'text-forest-700' : 'text-ink-3'}>{t.status.detail ?? t.status.state}</span>
            {t.status.state === 'missing-key' && t.apiKeyEnv && (
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(`${t.apiKeyEnv}=`);
                  toast('Copied', { description: `Paste into .env.local, add your key, restart the dev server.` });
                }}
                className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 hover:bg-mist"
              >
                <Copy className="size-3" /> {t.apiKeyEnv}=
              </button>
            )}
          </div>
          {t.notes && <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-ink-3">{t.notes}</p>}
          {t.history.medianMs != null && (
            <p className="tabular mt-2 text-[12.5px] text-ink-4">
              Recent runs: median {fmt.sec(t.history.medianMs)} per request{t.history.medianCost != null ? `, ${fmt.usd(t.history.medianCost)} each` : ''}.
            </p>
          )}
        </div>

        <div className="w-full shrink-0 rounded-xl border border-line bg-mist/50 p-3.5 md:w-72">
          <div className="text-[12px] font-medium text-ink-3">Price per 1M tokens</div>
          {editable ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <PriceInput label="Input" value={inPrice} onChange={setIn} />
                <PriceInput label="Output" value={outPrice} onChange={setOut} />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="truncate text-[11.5px] text-ink-4" title={t.pricing.source}>
                  {t.pricing.verifiedOn ? `Checked ${t.pricing.verifiedOn}` : t.pricing.inputPerMTok == null ? 'Not entered yet' : ''}
                  {t.pricing.source && !t.pricing.source.includes(' ') ? (
                    <a href={`https://${t.pricing.source}`} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-forest-700 hover:underline">
                      {t.pricing.source} <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </span>
                <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving} onClick={save} icon={!dirty ? <Check className="size-3.5" /> : undefined}>
                  {dirty ? 'Save' : 'Saved'}
                </Button>
              </div>
              {t.pricing.cacheReadPerMTok != null && <div className="tabular mt-1.5 text-[11.5px] text-ink-4">Cache read ${t.pricing.cacheReadPerMTok} · write ${t.pricing.cacheWritePerMTok}</div>}
            </>
          ) : (
            <p className="mt-1.5 text-[13px] leading-snug text-ink-2">{t.pricing.source}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[11.5px] text-ink-4">{label}</span>
      <div className="relative mt-0.5">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-ink-4">$</span>
        <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="—" className="tabular h-8 w-full rounded-lg border border-line-strong bg-paper pr-2 pl-5 text-[13px] outline-none focus:border-forest-500 focus:shadow-[var(--ring)]" />
      </div>
    </label>
  );
}

