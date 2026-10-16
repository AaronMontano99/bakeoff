/** Small, dependency-free stats helpers. Percentiles use linear interpolation (same as numpy's default). */

export function percentile(values: number[], p: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0]!;
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (rank - lo);
}

export function mean(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v));
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Spearman rank correlation, for judge vs human agreement. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const rank = (xs: number[]) => {
    const sorted = xs.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < sorted.length; ) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1]!.v === sorted[i]!.v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[sorted[k]!.i] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra)!;
  const mb = mean(rb)!;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    dbb += (rb[i]! - mb) ** 2;
  }
  return da === 0 || dbb === 0 ? null : num / Math.sqrt(da * dbb);
}
