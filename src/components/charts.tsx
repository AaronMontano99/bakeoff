'use client';

/**
 * Hand-rolled SVG charts following the dataviz method: thin marks, one
 * axis, recessive hairline grid, surface rings on dots, direct labels
 * used sparingly, a legend for 2+ series, a hover tooltip on every mark,
 * and text in ink tokens (never the series color).
 */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { fmt } from '@/lib/format';
import { cx, Swatch } from './ui';

const INK2 = '#3f5147';
const INK3 = '#6f8077';
const GRID = '#e8ede9';
const SURFACE = '#ffffff';

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
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-xl border border-line bg-paper px-3 py-2 text-[12.5px] shadow-lift" style={{ left, top: tip.y }}>
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
    const w = p.label.length * 6.4 + 4;
    const right = px + 12 + w < width - 4;
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
            <rect x={m.left} y={m.top} width={freeLane - 8} height={ih} fill="#f6f8f6" rx={6} />
            <text x={m.left + freeLane / 2 - 4} y={height - m.bottom + 18} textAnchor="middle" fontSize={11} fill={INK3}>
              $0
            </text>
          </g>
        )}
        <text x={m.left + freeLane + iw / 2} y={height - 6} textAnchor="middle" fontSize={11.5} fill={INK2}>
          Cost per request (log scale) →
        </text>
        <text transform={`translate(12 ${m.top + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} fill={INK2}>
          Quality →
        </text>

        {front.length > 1 && (
          <polyline points={front.map((p) => `${x(p.cost!)},${y(p.quality!)}`).join(' ')} fill="none" stroke="#a9cbb5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
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
                      {p.frontier && <div className="mt-1 text-forest-600">On the cost/quality frontier</div>}
                      {p.costNote && <div className="mt-1 max-w-52 text-ink-4">{p.costNote}</div>}
                    </div>
                  ),
                })
              }
              className="cursor-default"
            >
              <circle cx={cx0} cy={cy0} r={16} fill="transparent" />
              <circle cx={cx0} cy={cy0} r={p.frontier ? 7 : 5.5} fill={p.color} stroke={SURFACE} strokeWidth={2} />
              {Math.abs(lab.y - cy0) > 2 && <line x1={cx0} y1={cy0} x2={lab.anchor === 'start' ? lab.x - 3 : lab.x + 3} y2={lab.y} stroke="#cbd6ce" />}
              <text x={lab.x} y={lab.y} dy="0.32em" textAnchor={lab.anchor} fontSize={12} fill={INK2} fontWeight={p.frontier ? 600 : 400}>
                {p.label}
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
              {r.p50 != null && <rect x={x(r.p50) - 1.5} y={cy - 12} width={3} height={24} rx={1.5} fill="#0e1c15" />}
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
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 14, right: 24, bottom: 42, left: 58 };
  const iw = Math.max(100, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (!xs.length) return null;
  const xMin = xs[0]!;
  const xMax = xs[xs.length - 1]!;
  const yMax = Math.max(...ys, 0) * 1.12 || 1;
  const x = (v: number) =>
    xLog ? m.left + (xMax === xMin ? iw / 2 : ((Math.log2(v) - Math.log2(xMin)) / (Math.log2(xMax) - Math.log2(xMin))) * iw) : m.left + (xMax === xMin ? iw / 2 : ((v - xMin) / (xMax - xMin)) * iw);
  const y = (v: number) => m.top + ih - (v / yMax) * ih;
  const yTicks = niceTicks(0, yMax, 4);
  const xTicks = xLog ? xs : niceTicks(xMin, xMax, 5);
  const path = (s: LineSeries) =>
    s.points
      .map((p, i) => {
        if (i === 0 || !s.step) return `${i ? 'L' : 'M'}${x(p.x)},${y(p.y)}`;
        return `L${x(p.x)},${y(s.points[i - 1]!.y)} L${x(p.x)},${y(p.y)}`;
      })
      .join(' ');

  const nearest = hover == null ? null : xs.reduce((a, b) => (Math.abs(x(b) - hover) < Math.abs(x(a) - hover) ? b : a), xs[0]!);

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${yLabel} by ${xLabel}`}
        onMouseMove={(e) => setHover(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={m.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={INK3} className="tabular">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={height - m.bottom + 18} textAnchor="middle" fontSize={11} fill={INK3} className="tabular">
            {xFormat(t)}
          </text>
        ))}
        <text x={m.left + iw / 2} y={height - 6} textAnchor="middle" fontSize={11.5} fill={INK2}>
          {xLabel}
        </text>
        <text transform={`translate(12 ${m.top + ih / 2}) rotate(-90)`} textAnchor="middle" fontSize={11.5} fill={INK2}>
          {yLabel}
        </text>
        {marker && (
          <g>
            <line x1={x(marker.x)} x2={x(marker.x)} y1={m.top} y2={m.top + ih} stroke="#cbd6ce" />
            <text x={x(marker.x) + 6} y={m.top + 12} fontSize={11} fill={INK2}>
              {marker.label}
            </text>
          </g>
        )}
        {series.map((s) => (
          <g key={s.id}>
            <path d={path(s)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {!s.step && s.points.map((p) => <circle key={p.x} cx={x(p.x)} cy={y(p.y)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />)}
          </g>
        ))}
        {nearest != null && <line x1={x(nearest)} x2={x(nearest)} y1={m.top} y2={m.top + ih} stroke="#9aa8a0" />}
      </svg>
      {nearest != null && (
        <div className="pointer-events-none absolute top-2 z-10 rounded-xl border border-line bg-paper px-3 py-2 text-[12.5px] shadow-lift" style={{ left: Math.min(x(nearest) + 12, width - 200) }}>
          <div className="font-medium text-ink">
            {xLabel.replace(' →', '')}: {xFormat(nearest)}
          </div>
          {series.map((s) => {
            const p = s.step ? [...s.points].reverse().find((q) => q.x <= nearest) : s.points.find((q) => q.x === nearest);
            return p ? (
              <div key={s.id} className="tabular mt-0.5 flex items-center gap-2 text-ink-3">
                <Swatch color={s.color} shape="line" />
                <span className="truncate">{s.label}</span>
                <span className="ml-auto pl-3 text-ink">{yFormat(p.y)}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
      {series.length > 1 && (
        <div className="mt-2">
          <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: 'line' as const }))} />
        </div>
      )}
    </div>
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
      <polyline points={pts.join(' ')} fill="none" stroke="#a9cbb5" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------- Meter

export function Meter({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  const color = v >= 0.8 ? 'bg-forest-500' : v >= 0.6 ? 'bg-[#c99a2e]' : 'bg-[#d0705f]';
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-sage-100', className)}>
      <div className={cx('h-full rounded-full', color)} style={{ width: `${Math.round(v * 100)}%` }} />
    </div>
  );
}
