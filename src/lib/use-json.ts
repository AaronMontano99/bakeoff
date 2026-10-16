'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Tiny fetch hook: data, error, loading, and a refresh that keeps the old data on screen while it reloads. */
export function useJson<T>(url: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!url) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      if (alive.current) {
        setData(body as T);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    void load();
    if (!opts.refreshMs) return () => void (alive.current = false);
    const t = setInterval(load, opts.refreshMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load, opts.refreshMs]);

  return { data, error, loading, refresh: load, setData };
}
