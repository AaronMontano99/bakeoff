'use client';
import { useEffect, useRef, useState } from 'react';
import type { ResultRow, RunEvent, RunRow, RunStatus } from '@/core/types';

export interface Lane {
  targetId: string;
  taskId: string | null;
  phase: string | null;
  text: string;
  startedAt: number | null;
  firstTokenAt: number | null;
}

const TERMINAL: RunStatus[] = ['done', 'failed', 'cancelled'];

/**
 * Loads a run, then keeps it live over SSE: finished results append,
 * judge scores patch in, and each target's lane shows the response
 * streaming token by token.
 */
export function useRunLive(id: string) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [lanes, setLanes] = useState<Record<string, Lane>>({});
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let laneBuffer: Record<string, Lane> = {};
    let flush: number | null = null;

    const scheduleFlush = () => {
      if (flush != null) return;
      flush = window.setTimeout(() => {
        flush = null;
        setLanes({ ...laneBuffer });
      }, 50);
    };

    (async () => {
      try {
        const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        if (cancelled) return;
        setRun(body.run);
        setResults(body.results);
        lastId.current = Math.max(0, ...body.results.map((r: ResultRow) => r.id));
        if (TERMINAL.includes(body.run.status)) return;

        es = new EventSource(`/api/runs/${id}/events?after=${lastId.current}`);
        es.onmessage = (msg) => {
          const e = JSON.parse(msg.data) as RunEvent | { kind: 'ping' };
          switch (e.kind) {
            case 'start':
              laneBuffer[e.targetId] = { targetId: e.targetId, taskId: e.taskId, phase: e.phase, text: '', startedAt: Date.now(), firstTokenAt: null };
              scheduleFlush();
              break;
            case 'lane':
              laneBuffer[e.targetId] = { targetId: e.targetId, taskId: e.taskId, phase: e.phase, text: e.text, startedAt: e.startedAt, firstTokenAt: e.firstTokenAt };
              scheduleFlush();
              break;
            case 'token': {
              const lane = laneBuffer[e.targetId];
              if (lane) {
                lane.text = (lane.text + e.text).slice(-4000);
                lane.firstTokenAt ??= Date.now();
                scheduleFlush();
              }
              break;
            }
            case 'done':
              if (e.result.id <= lastId.current) break;
              lastId.current = e.result.id;
              // That target's request is finished; its next one sends a fresh 'start'.
              if (laneBuffer[e.result.targetId] && e.result.phase !== 'load') {
                delete laneBuffer[e.result.targetId];
                scheduleFlush();
              }
              setResults((rs) => [...rs, e.result]);
              setRun((r) => (r ? { ...r, completed: r.completed + 1 } : r));
              break;
            case 'judged':
              setResults((rs) => rs.map((r) => (r.id === e.resultId ? { ...r, judgeScore: e.score, judgeRationale: e.rationale } : r)));
              break;
            case 'status':
              setRun((r) => (r ? { ...r, status: e.status } : r));
              if (e.kind === 'status' && 'detail' in e && e.detail) setDetail(e.detail);
              if (TERMINAL.includes(e.status)) {
                es?.close();
                laneBuffer = {};
                setLanes({});
                // Final refetch picks up judge scores written after the last event.
                void fetch(`/api/runs/${id}`, { cache: 'no-store' })
                  .then((r) => r.json())
                  .then((b) => {
                    if (!cancelled && b.run) {
                      setRun(b.run);
                      setResults(b.results);
                    }
                  });
              }
              break;
          }
        };
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      es?.close();
      if (flush != null) window.clearTimeout(flush);
    };
  }, [id]);

  return { run, results, setResults, lanes, detail, error };
}
