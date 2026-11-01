'use client';

/**
 * Charts following the dataviz method: thin marks, one axis, recessive
 * hairline grid, surface rings on dots, direct labels used sparingly, a
 * legend for 2+ series, a hover tooltip on every mark, and text in ink
 * tokens (never the series color).
 *
 * Standard forms use Recharts (MIT). The frontier and the strip plot stay as
 * plain SVG because a log axis with a $0 lane, collision-aware labels and one
 * jittered dot per request aren't things a chart library gives you.
 */
import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { fmt } from '@/lib/format';
import { cx, Swatch } from './ui';

const INK = 'var(--ink)';
const INK2 = 'var(--ink-2)';
const INK3 = 'var(--ink-3)';
const GRID = 'var(--chart-grid)';
const SURFACE = 'var(--chart-ring)';
const TIP = 'solid pointer-events-none rounded-xl border border-line-strong px-3 py-2 text-[12.5px] shadow-lift';

/** "Claude Sonnet · Claude Code" -> "Claude Sonnet", for places a target's full name won't fit. */
export const shortLabel = (label: string) => label.split(' · ')[0]!;

/** Callback ref + observed width, so charts fill their container and reflow on resize. */
function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = useState(640);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width) || 640);
    observer.current = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setW(Math.round(width));
    });
    observer.current.observe(el);
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

export interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x, 90), width - 90);
  return (
    <div className={cx(TIP, 'absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)]')} style={{ left, top: tip.y }}>
      {tip.content}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: 'dot' | 'line' }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <Swatch color={i.color} shape={i.shape} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Frontier scatter

export interface FrontierPoint {
  id: string;
  label: string;
  color: string;
  cost: number | null;
  quality: number | null;
  p95: number | null;
  frontier: boolean;
  costNote?: string;
}

/** Cost per request (log x, with $0 pinned to its own lane at the left) vs composite quality. */
export function FrontierChart({ points, height = 340 }: { points: FrontierPoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const plotted = points.filter((p) => p.quality != null && p.cost != null);
  const unpriced = points.filter((p) => p.quality != null && p.cost == null);
  const m = { top: 18, right: 24, bottom: 42, left: 44 };
  const freeLane = plotted.some((p) => p.cost === 0) ? 56 : 0;
  const iw = Math.max(100, width - m.left - m.right - freeLane);
  const ih = height - m.top - m.bottom;

  const positive = plotted.filter((p) => (p.cost ?? 0) > 0).map((p) => p.cost!);
  const lo = positive.length ? Math.min(...positive) / 2.2 : 0.0001;
  const hi = positive.length ? Math.max(...positive) * 2.2 : 0.01;
  const lx = (v: number) => m.left + freeLane + ((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * iw;
  const x = (v: number) => (v === 0 ? m.left + freeLane / 2 : lx(v));
  const qMin = Math.max(0, Math.floor((Math.min(...plotted.map((p) => p.quality!), 1) * 100 - 10) / 10) * 10);
  const y = (q: number) => m.top + ih - ((q * 100 - qMin) / (100 - qMin)) * ih;
  const yTicks = niceTicks(qMin, 100, 5);
  const xTicks: number[] = [];
  for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) xTicks.push(10 ** e);

  const front = plotted.filter((p) => p.frontier).sort((a, b) => a.cost! - b.cost!);

  // Direct labels: right of the dot when there's room, nudged apart vertically when they'd collide.
  const placed: { id: string; x: number; y: number; anchor: 'start' | 'end'; w: number; dotY: number }[] = [];
  for (const p of [...plotted].sort((a, b) => y(a.quality!) - y(b.quality!))) {
    const px = x(p.cost!);
    const py = y(p.quality!);
    const w = shortLabel(p.label).length * 6.4 + 4;
    // Prefer the right of the dot; fall back left only if the label would still clear the y axis.
    const right = px + 12 + w < width - 4 || px - 12 - w < m.left;
    const box = (ly: number) => (right ? { l: px + 12, r: px + 12 + w, y: ly } : { l: px - 12 - w, r: px - 12, y: ly });
    let ly = py;
    for (let guard = 0; guard < 12; guard++) {
      const b = box(ly);
      const hit = placed.find((q) => {
        const qb = q.anchor === 'start' ? { l: q.x, r: q.x + q.w } : { l: q.x - q.w, r: q.x };
        return Math.abs(q.y - ly) < 15 && b.l < qb.r && b.r > qb.l;
      });
      if (!hit) break;
      ly = hit.y + 15;
    }
    placed.push({ id: p.id, x: right ? px + 12 : px - 12, y: ly, anchor: right ? 'start' : 'end', w, dotY: py });
  }
  const labelAt = (id: string) => placed.find((l) => l.id === id)!;

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label="Cost per request versus quality for each target" onMouseLeave={() => setTip(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t / 100)} y2={y(t / 100)} stroke={GRID} />
            <text x={m.left - 10} y={y(t / 100)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK3} className="tabular">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={lx(t)} y={height - m.bottom + 18} textAnchor="middle" fontSize={11} fill={INK3} className="tabular">
            {fmt.usdShort(t)}
          </text>
        ))}
        {freeLane > 0 && (
          <g>
            <rect x={m.left} y={m.top} width={freeLane - 8} height={ih} fill="var(--mist)" rx={6} />
            <text x={m.left + freeLane / 2 - 4} y={height - m.bottom + 18} textAnchor="middle" fontSize={11} fill={INK3}>
              $0
            </text>
          </g>
        )}
        <text x={m.left + freeLane + iw / 2} y={height - 6} textAnchor="middle" fontSize={12} fill={INK2}>
          Cost per request (log scale) →
        </text>
        <text transform={`translate(12 ${m.top + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill={INK2}>
          Quality →
        </text>

        {front.length > 1 && (
          <polyline points={front.map((p) => `${x(p.cost!)},${y(p.quality!)}`).join(' ')} fill="none" stroke="var(--accent-ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}

        {plotted.map((p) => {
          const cx0 = x(p.cost!);
          const cy0 = y(p.quality!);
          const lab = labelAt(p.id);
          return (
            <g
              key={p.id}
              onMouseEnter={() =>
                setTip({
                  x: cx0,
                  y: cy0,
                  content: (
                    <div className="min-w-44">
                      <div className="flex items-center gap-1.5 font-medium text-ink">
                        <Swatch color={p.color} />
                        {p.label}
                      </div>
                      <div className="tabular mt-1 grid grid-cols-2 gap-x-3 text-ink-3">
                        <span>Quality</span>
                        <span className="text-right text-ink">{fmt.score(p.quality)}</span>
                        <span>Cost / req</span>
                        <span className="text-right text-ink">{fmt.usd(p.cost)}</span>
                        <span>p95 latency</span>
                        <span className="text-right text-ink">{fmt.sec(p.p95)}</span>
                      </div>
                      {p.frontier && <div className="mt-1 text-accent-ink">On the cost/quality frontier</div>}
                      {p.costNote && <div className="mt-1 max-w-52 text-ink-4">{p.costNote}</div>}
                    </div>
                  ),
                })
              }
              className="cursor-default"
            >
              <circle cx={cx0} cy={cy0} r={16} fill="transparent" />
              <circle cx={cx0} cy={cy0} r={p.frontier ? 7 : 5.5} fill={p.color} stroke={SURFACE} strokeWidth={2} />
              {Math.abs(lab.y - cy0) > 2 && <line x1={cx0} y1={cy0} x2={lab.anchor === 'start' ? lab.x - 3 : lab.x + 3} y2={lab.y} stroke="var(--line-strong)" />}
              <text x={lab.x} y={lab.y} dy="0.32em" textAnchor={lab.anchor} fontSize={12} fill={INK2} fontWeight={p.frontier ? 600 : 400} stroke={SURFACE} strokeWidth={3} strokeOpacity={0.85} style={{ paintOrder: 'stroke' }}>
                {shortLabel(p.label)}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
      {unpriced.length > 0 && (
        <p className="mt-1 text-[12.5px] text-ink-3">
          Not plotted (no price entered): {unpriced.map((p) => p.label).join(', ')}. Add prices on the Targets page.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Latency strip plot

export interface StripRow {
  id: string;
  label: string;
  color: string;
  values: { ms: number; label: string }[];
  p50: number | null;
  p95: number | null;
  note?: string;
}

/** One row per target: every request as a dot, with p50 and p95 ticks. Log time axis. */
export function StripPlot({ rows, metric }: { rows: StripRow[]; metric: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const rowH = 44;
  const m = { top: 8, right: 20, bottom: 34, left: Math.min(200, Math.max(120, width * 0.26)) };
  const height = m.top + rows.length * rowH + m.bottom;
  const all = rows.flatMap((r) => r.values.map((v) => v.ms)).filter((v) => v > 0);
  const lo = all.length ? Math.max(50, Math.min(...all) / 1.5) : 100;
  const hi = all.length ? Math.max(...all) * 1.3 : 10_000;
  const iw = Math.max(80, width - m.left - m.right);
  const x = (v: number) => m.left + ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * iw;
  const ticks = [100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000].filter((t) => t >= lo && t <= hi);

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={`${metric} for every request, by target`} onMouseLeave={() => setTip(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.top} y2={height - m.bottom} stroke={GRID} />
            <text x={x(t)} y={height - m.bottom + 18} textAnchor="middle" fontSize={11} fill={INK3} className="tabular">
              {fmt.sec(t, t < 10_000 ? 1 : 0)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cy = m.top + i * rowH + rowH / 2;
          return (
            <g key={r.id}>
              <text x={m.left - 14} y={cy} dy="0.32em" textAnchor="end" fontSize={12.5} fill={INK2}>
                {r.label.length > 28 ? r.label.slice(0, 27) + '…' : r.label}
              </text>
              <line x1={m.left} x2={width - m.right} y1={cy} y2={cy} stroke={GRID} />
              {r.values.map((v, j) => {
                const jitter = ((j * 7919) % 13) - 6;
                return (
                  <circle
                    key={j}
                    cx={x(v.ms)}
                    cy={cy + jitter}
                    r={4}
                    fill={r.color}
                    fillOpacity={0.55}
                    stroke={SURFACE}
                    strokeWidth={1.5}
                    onMouseEnter={() => setTip({ x: x(v.ms), y: cy + jitter, content: <span><span className="font-medium text-ink">{fmt.sec(v.ms, 2)}</span> <span className="text-ink-3">· {v.label}</span></span> })}
                  />
                );
              })}
              {r.p50 != null && <rect x={x(r.p50) - 1.5} y={cy - 12} width={3} height={24} rx={1.5} fill={INK} />}
              {r.p95 != null && (
                <g>
                  <rect x={x(r.p95) - 1} y={cy - 10} width={2} height={20} rx={1} fill={INK3} />
                  <text x={x(r.p95) + 6} y={cy - 9} fontSize={10.5} fill={INK3} className="tabular">
                    p95 {fmt.sec(r.p95)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
      <div className="mt-1 flex flex-wrap items-center gap-4 text-[12px] text-ink-3">
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-[3px] rounded bg-ink" /> median</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-[2px] rounded bg-ink-3" /> p95</span>
        <span>Each dot is one request. Log scale.</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Line chart (load curves, crossover)

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
  step?: boolean;
}

interface ChartTipProps {
  active?: boolean;
  title: ReactNode;
  rows: { key: string; label: string; color: string; value: string; shape?: 'dot' | 'line' }[];
}

function ChartTip({ active, title, rows }: ChartTipProps) {
  if (!active || !rows.length) return null;
  return (
    <div className={TIP}>
      <div className="font-medium text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.key} className="tabular mt-0.5 flex items-center gap-2 text-ink-3">
          <Swatch color={r.color} shape={r.shape} />
          <span className="truncate">{r.label}</span>
          <span className="ml-auto pl-3 text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function LineChart({
  series,
  height = 260,
  xLabel,
  yLabel,
  xFormat = (v) => String(v),
  yFormat = (v) => String(v),
  xLog,
  marker,
}: {
  series: LineSeries[];
  height?: number;
  xLabel: string;
  yLabel: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xLog?: boolean;
  marker?: { x: number; label: string };
}) {
  const gradient = useId();
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  if (!xs.length) return null;
  const rows = xs.map((x) => {
    const row: Record<string, number> = { x };
    for (const s of series) {
      const p = s.step ? [...s.points].reverse().find((q) => q.x <= x) : s.points.find((q) => q.x === x);
      if (p) row[s.id] = p.y;
    }
    return row;
  });
  const single = series.length === 1 ? series[0]! : null;
  // Doubling concurrency levels sit evenly apart, which is what a log2 axis would do anyway.
  const axisType = xLog ? 'category' : 'number';

  return (
    <div className="w-full">
      <div style={{ height }} role="img" aria-label={`${yLabel} by ${xLabel}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 14, right: 20, bottom: 18, left: 8 }}>
            {single && (
              <defs>
                <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={single.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={single.color} stopOpacity={0} />
                </linearGradient>
              </defs>
            )}
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="x"
              type={axisType}
              domain={axisType === 'number' ? ['dataMin', 'dataMax'] : undefined}
              tickFormatter={xFormat}
              tick={{ fontSize: 11, fill: INK3 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickMargin={8}
              label={{ value: xLabel, position: 'insideBottom', offset: -12, fontSize: 12, fill: INK2 }}
            />
            <YAxis tickFormatter={yFormat} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} width={58} label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fontSize: 12, fill: INK2 }} />
            {marker && <ReferenceLine x={marker.x} stroke="var(--line-strong)" strokeDasharray="4 4" label={{ value: marker.label, position: 'insideTopRight', fontSize: 11, fill: INK2 }} />}
            <RechartsTooltip
              cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '4 4' }}
              isAnimationActive={false}
              content={({ active, label, payload }) => (
                <ChartTip
                  active={active}
                  title={`${xLabel.replace(' →', '')}: ${xFormat(Number(label))}`}
                  rows={series.flatMap((s) => {
                    const hit = payload?.find((p) => p.dataKey === s.id && p.type !== 'none');
                    return hit ? [{ key: s.id, label: s.label, color: s.color, value: yFormat(Number(hit.value)), shape: 'line' as const }] : [];
                  })}
                />
              )}
            />
            {single && <Area dataKey={single.id} type={single.step ? 'stepAfter' : 'monotone'} stroke="none" fill={`url(#${gradient})`} tooltipType="none" isAnimationActive={false} />}
            {series.map((s, i) => (
              <Line
                key={s.id}
                dataKey={s.id}
                name={s.label}
                type={s.step ? 'stepAfter' : 'monotone'}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                // With exactly two lines, dashing the second keeps them apart without relying on color.
                strokeDasharray={series.length === 2 && i === 1 ? '6 5' : undefined}
                dot={s.step ? false : { r: 4, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                activeDot={{ r: 5, fill: s.color, stroke: SURFACE, strokeWidth: 2 }}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="mt-2">
          <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: 'line' as const }))} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Speed bars

export interface SpeedRow {
  id: string;
  label: string;
  firstToken: number;
  total: number;
}

/** Where a request's time goes: waiting for the first word, then the rest of the answer. */
export function SpeedBars({ rows }: { rows: SpeedRow[] }) {
  const data = rows.map((r) => ({ ...r, rest: Math.max(0, r.total - r.firstToken) }));
  const height = data.length * 44 + 34;
  return (
    <div className="w-full">
      <div style={{ height }} role="img" aria-label="Median time to first token and to the full answer, by target">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 18, bottom: 0, left: 4 }} barCategoryGap={12}>
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tickFormatter={(v) => (Number(v) === 0 ? '0' : fmt.sec(Number(v), 0))} tick={{ fontSize: 11, fill: INK3 }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="label" width={104} tick={{ fontSize: 12, fill: INK2 }} tickLine={false} axisLine={false} tickFormatter={(v) => shortLabel(String(v))} />
            <RechartsTooltip
              cursor={{ fill: 'var(--mist)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const r = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return r ? (
                  <ChartTip
                    active={active}
                    title={r.label}
                    rows={[
                      { key: 'first', label: 'First word', color: 'var(--accent)', value: fmt.sec(r.firstToken, 2) },
                      { key: 'total', label: 'Full answer', color: 'var(--line-strong)', value: fmt.sec(r.total, 2) },
                    ]}
                  />
                ) : null;
              }}
            />
            <Bar dataKey="firstToken" stackId="t" fill="var(--accent)" stroke={SURFACE} strokeWidth={1} isAnimationActive={false} />
            <Bar dataKey="rest" stackId="t" fill="var(--line-strong)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2">
        <Legend items={[{ label: 'Waiting for the first word', color: 'var(--accent)' }, { label: 'Rest of the answer', color: 'var(--line-strong)' }]} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Score ring

/** A quality score out of 100, as a number with its own arc. */
export function ScoreRing({ value, size = 52 }: { value: number | null; size?: number }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  const stroke = 4.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mist)" strokeWidth={stroke} />
        {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-ink)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />}
      </svg>
      <span className="tabular absolute text-[14px] font-semibold text-ink">{fmt.score(value)}</span>
    </span>
  );
}

// ---------------------------------------------------------------- Sparkline

export function Sparkline({ values, color, width = 96, height = 24 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`);
  const last = pts[pts.length - 1]!.split(',');
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke="var(--line-strong)" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------- Meter

export function Meter({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-mist', className)}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}
