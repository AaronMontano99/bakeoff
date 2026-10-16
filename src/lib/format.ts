export const fmt = {
  sec(ms: number | null | undefined, digits = 1): string {
    if (ms == null) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(digits)}s`;
  },
  pct(v: number | null | undefined): string {
    return v == null ? '—' : `${Math.round(v * 100)}%`;
  },
  score(v: number | null | undefined): string {
    return v == null ? '—' : `${Math.round(v * 100)}`;
  },
  usd(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v === 0) return '$0';
    if (v < 0.001) return `$${v.toFixed(5)}`;
    if (v < 1) return `$${v.toFixed(4)}`;
    if (v < 100) return `$${v.toFixed(2)}`;
    return `$${Math.round(v).toLocaleString('en-US')}`;
  },
  usdShort(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v === 0) return '$0';
    if (v < 0.01) return `$${v.toPrecision(2)}`;
    if (v < 1000) return `$${v.toFixed(v < 10 ? 2 : 0)}`;
    if (v < 1_000_000) return `$${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`;
    return `$${(v / 1_000_000).toFixed(1)}M`;
  },
  int(v: number | null | undefined): string {
    return v == null ? '—' : Math.round(v).toLocaleString('en-US');
  },
  compact(v: number | null | undefined): string {
    if (v == null) return '—';
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`;
    return `${(v / 1_000_000).toFixed(1)}M`;
  },
  ago(ts: number): string {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  duration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60 ? `${s % 60}s` : ''}`.trim();
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  },
};
