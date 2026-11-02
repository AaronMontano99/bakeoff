'use client';

import { Command } from 'cmdk';
import { DEMO } from '@/lib/demo';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookOpen,
  ChevronRight,
  Cpu,
  FlaskConical,
  History,
  Keyboard,
  LayoutDashboard,
  ListChecks,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  SwatchBook,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast, Toaster } from 'sonner';
import { ACCENTS, DIRECTIONS, HEADING_FONTS, useLook } from '@/lib/appearance';
import { useJson } from '@/lib/use-json';
import type { RunListItem, TargetWithStatus } from '@/lib/types-client';
import { fmt } from '@/lib/format';
import { Button, cx, Dot, Kbd } from './ui';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, chord: 'o' },
  { href: '/runs/new', label: 'New run', icon: Play, chord: 'n' },
  { href: '/runs', label: 'Runs', icon: History, chord: 'r' },
  { href: '/targets', label: 'Targets', icon: Cpu, chord: 't' },
  { href: '/workload', label: 'Workload', icon: ListChecks, chord: 'w' },
  { href: '/method', label: 'Method', icon: BookOpen, chord: 'm' },
];

const ShellCtx = createContext<{ openPalette: () => void; openShortcuts: () => void }>({ openPalette: () => {}, openShortcuts: () => {} });
export const useShell = () => useContext(ShellCtx);

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const [tweaks, setTweaks] = useState(false);
  const print = pathname.endsWith('/brief');

  useEffect(() => {
    let chord: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '?') {
        setShortcuts(true);
        return;
      }
      if (e.key === 'g') {
        chord = window.setTimeout(() => (chord = null), 900);
        return;
      }
      if (chord != null) {
        const hit = NAV.find((n) => n.chord === e.key);
        window.clearTimeout(chord);
        chord = null;
        if (hit) router.push(hit.href);
        return;
      }
      if (e.key === 'n' && pathname !== '/runs/new') router.push('/runs/new');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, pathname]);

  const ctx = useMemo(() => ({ openPalette: () => setPalette(true), openShortcuts: () => setShortcuts(true) }), []);

  if (print) return <ShellCtx.Provider value={ctx}>{children}</ShellCtx.Provider>;

  return (
    <ShellCtx.Provider value={ctx}>
      <Sky />
      {DEMO && (
        <p className="relative z-30 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-accent px-4 py-2 text-center text-[13.5px] text-on-accent">
          <span>Demo of real past results. Starting runs and saving are turned off.</span>
          <a href="https://github.com/AaronMontano99/bakeoff" className="font-semibold underline">
            See the code
          </a>
          <a href="https://aaronmontano.vercel.app/" className="font-semibold underline">
            Back to Aaron&apos;s site
          </a>
        </p>
      )}
      <TopBar pathname={pathname} />
      <main className="pb-32">{children}</main>
      <Dock onSearch={() => setPalette(true)} onShortcuts={() => setShortcuts(true)} onTweaks={() => setTweaks((v) => !v)} tweaksOpen={tweaks} />
      <Tweaks open={tweaks} onClose={() => setTweaks(false)} />
      <Palette open={palette} onClose={() => setPalette(false)} onShortcuts={() => setShortcuts(true)} />
      <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
      <Toaster position="top-center" toastOptions={{ classNames: { toast: '!rounded-xl !border-line !bg-[var(--paper-solid)] !shadow-lift !font-sans', title: '!text-ink !font-medium', description: '!text-ink-3' } }} />
    </ShellCtx.Provider>
  );
}

/** The clouds. They hold still until a run is in flight, then the weather moves. */
function Sky() {
  const { data: runs } = useJson<RunListItem[]>('/api/runs', { refreshMs: 6_000 });
  const moving = !!runs?.some((r) => r.status === 'running' || r.status === 'judging' || r.status === 'queued');
  return (
    <div className="sky no-print" data-moving={moving} aria-hidden>
      <i className="sky-img" />
      <i className="sky-wash" />
    </div>
  );
}

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-[12px] bg-accent text-on-accent">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden fill="currentColor">
          <path d="M9.5 24a5 5 0 0 1-.7-9.95 7 7 0 0 1 13.45-1.1A5.6 5.6 0 0 1 22.5 24Z" />
        </svg>
      </span>
      <span className="font-head text-[19px]">bakeoff</span>
    </Link>
  );
}

function TopBar({ pathname }: { pathname: string }) {
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets', { refreshMs: 30_000 });
  const ready = targets?.filter((t) => t.status.state === 'ready').length ?? null;
  const enabled = targets?.filter((t) => t.enabled).length ?? null;
  const active = (href: string) => (href === '/' ? pathname === '/' : href === '/runs' ? pathname === '/runs' || (pathname.startsWith('/runs/') && pathname !== '/runs/new') : pathname.startsWith(href));

  return (
    <header className="no-print sticky top-0 z-30 px-3 pt-3 sm:px-6">
      <div className="glass mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line px-3 py-2 shadow-card sm:flex-nowrap sm:pl-4">
        <Logo />
        <Link href="/targets" title="Targets that can run right now" className="ml-auto flex h-9 items-center gap-2 rounded-control px-2.5 text-[13px] font-medium text-ink-2 hover:bg-mist sm:order-3 sm:ml-0">
          <Dot tone={ready ? 'green' : 'muted'} />
          {ready == null ? 'Checking…' : `${ready} of ${enabled} ready`}
        </Link>
        <nav aria-label="Main" className="scrollbar-none -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-0.5 overflow-x-auto px-1 sm:order-2 sm:mx-auto sm:w-auto">
          {NAV.filter((n) => n.href !== '/runs/new').map((n) => {
            const on = active(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} className={cx('relative flex h-10 shrink-0 items-center rounded-control px-4 text-[14px] font-medium transition-colors', on ? 'text-ink' : 'text-ink-3 hover:text-ink')}>
                {on && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-control bg-tint-2" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative">{n.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function DockButton({ label, onClick, href, children, on }: { label: string; onClick?: () => void; href?: string; children: ReactNode; on?: boolean }) {
  const cls = cx('grid size-11 place-items-center rounded-control transition-colors [&_svg]:size-[19px]', on ? 'bg-tint-2 text-ink' : 'text-ink-2 hover:bg-mist hover:text-ink');
  return href ? (
    <Link href={href} className={cls} aria-label={label} title={label}>
      {children}
    </Link>
  ) : (
    <button onClick={onClick} className={cls} aria-label={label} title={label} aria-pressed={on}>
      {children}
    </button>
  );
}

function Dock({ onSearch, onShortcuts, onTweaks, tweaksOpen }: { onSearch: () => void; onShortcuts: () => void; onTweaks: () => void; tweaksOpen: boolean }) {
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
      <div className="glass pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-line-strong p-1.5 shadow-lift">
        <DockButton label="Search (⌘K)" onClick={onSearch}><Search /></DockButton>
        <DockButton label="New run (N)" href="/runs/new"><Plus /></DockButton>
        <DockButton label="Quick check" href="/runs/new?preset=quick"><Zap /></DockButton>
        <span className="mx-1 h-6 w-px bg-line" />
        <DockButton label="Compare looks" href="/lab"><SwatchBook /></DockButton>
        <DockButton label="Tweaks" onClick={onTweaks} on={tweaksOpen}><SlidersHorizontal /></DockButton>
        <DockButton label="Keyboard shortcuts (?)" onClick={onShortcuts}><Keyboard /></DockButton>
      </div>
    </div>
  );
}

function Tweaks({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { look, update, reset } = useLook();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(look));
      toast.success('Look copied', { description: 'Paste it to Claude to make it the permanent default.' });
    } catch {
      toast.error('The browser blocked the clipboard', { description: 'Allow clipboard access for this page, then try again.' });
    }
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          aria-label="Tweaks"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          className="solid no-print fixed inset-x-3 bottom-[88px] z-40 max-h-[70dvh] overflow-y-auto rounded-2xl border border-line-strong p-5 shadow-pop scrollbar-thin sm:right-6 sm:left-auto sm:w-[340px]"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-head text-[18px]">Tweaks</h2>
            <button onClick={onClose} className="grid size-9 place-items-center rounded-lg text-ink-3 hover:bg-mist hover:text-ink" aria-label="Close tweaks">
              <X className="size-4" />
            </button>
          </div>
          <Field label="Direction">
            <Choice value={look.direction} options={DIRECTIONS.map((d) => ({ id: d.id, label: d.name }))} onChange={(direction) => update({ direction })} />
          </Field>
          <Field label="Accent">
            <Choice value={look.accent} options={ACCENTS.map((a) => ({ id: a.id, label: a.id === 'theme' ? 'Default' : a.label }))} onChange={(accent) => update({ accent })} />
          </Field>
          <Field label="Headings">
            <Choice value={look.font} options={HEADING_FONTS.map((f) => ({ id: f.id, label: f.id === 'theme' ? 'Default' : f.label }))} onChange={(font) => update({ font })} />
          </Field>
          <Slider label="Clouds" value={look.clouds ?? 1} min={0} max={1} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(clouds) => update({ clouds })} />
          <Slider label="Glass blur" value={look.blur ?? 22} min={0} max={40} step={1} show={(v) => `${v}px`} onChange={(blur) => update({ blur })} />
          <Slider label="Roundness" value={look.roundness} min={0.3} max={1.3} step={0.05} show={(v) => `${Math.round(v * 100)}%`} onChange={(roundness) => update({ roundness })} />
          <Slider label="Text size" value={look.density} min={0.9} max={1.15} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(density) => update({ density })} />
          <div className="mt-5 flex gap-2">
            <Button variant="primary" size="sm" className="flex-1" onClick={copy}>Copy this look</Button>
            <Button size="sm" onClick={reset}>Reset</Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[13px] font-medium text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: readonly { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={o.id === value} className={cx('h-8 rounded-control border px-3 text-[13px] font-medium transition-colors', o.id === value ? 'border-tint-line bg-tint-2 text-ink' : 'border-line text-ink-3 hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="mt-4 block">
      <span className="flex items-baseline justify-between text-[13px] font-medium text-ink-2">
        {label}
        <span className="tabular text-ink-3">{show(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1.5 w-full accent-[var(--accent)]" />
    </label>
  );
}

function Palette({ open, onClose, onShortcuts }: { open: boolean; onClose: () => void; onShortcuts: () => void }) {
  const router = useRouter();
  const { data: runs } = useJson<RunListItem[]>(open ? '/api/runs' : null);
  const { data: targets } = useJson<TargetWithStatus[]>(open ? '/api/targets' : null);
  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router]
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-scrim/60 px-4 pt-[12vh] backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="solid w-full max-w-[600px] overflow-hidden rounded-2xl shadow-pop"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Command label="Command menu" loop onKeyDown={(e) => e.key === 'Escape' && onClose()}>
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search className="size-4 text-ink-3" />
                <Command.Input autoFocus placeholder="Search runs, targets, actions…" className="h-[52px] flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-4" />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[56vh] overflow-y-auto p-2 scrollbar-thin">
                <Command.Empty className="py-10 text-center text-sm text-ink-3">Nothing matches that.</Command.Empty>
                <Command.Group heading="Actions">
                  <Item icon={<Play />} onSelect={() => go('/runs/new')} hint="N">Start a new run</Item>
                  <Item icon={<Zap />} onSelect={() => go('/runs/new?preset=quick')}>Quick check: one task per type on every ready target</Item>
                  <Item icon={<FlaskConical />} onSelect={() => go('/runs/new?preset=load')}>Load test: latency under concurrency</Item>
                  {runs?.[0] && <Item icon={<History />} onSelect={() => go(`/runs/${runs[0]!.id}`)}>Open latest run: {runs[0].name}</Item>}
                  <Item icon={<Keyboard />} onSelect={() => { onClose(); onShortcuts(); }} hint="?">Keyboard shortcuts</Item>
                </Command.Group>
                <Command.Group heading="Go to">
                  {NAV.map((n) => (
                    <Item key={n.href} icon={<n.icon />} onSelect={() => go(n.href)} hint={`G ${n.chord.toUpperCase()}`}>
                      {n.label}
                    </Item>
                  ))}
                </Command.Group>
                {!!runs?.length && (
                  <Command.Group heading="Runs">
                    {runs.slice(0, 8).map((r) => (
                      <Item key={r.id} icon={<History />} onSelect={() => go(`/runs/${r.id}`)} value={`run ${r.name} ${r.id}`} hint={fmt.ago(r.createdAt)}>
                        {r.name}
                      </Item>
                    ))}
                  </Command.Group>
                )}
                {!!targets?.length && (
                  <Command.Group heading="Targets">
                    {targets.map((t) => (
                      <Item key={t.id} icon={<Cpu />} onSelect={() => go(`/targets#${t.id}`)} value={`target ${t.label} ${t.vendor} ${t.model}`} hint={t.status.state === 'ready' ? 'ready' : t.status.state.replace('-', ' ')}>
                        {t.label}
                      </Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Item({ icon, children, onSelect, hint, value }: { icon: ReactNode; children: ReactNode; onSelect: () => void; hint?: string; value?: string }) {
  return (
    <Command.Item onSelect={onSelect} value={value} className="flex h-10 cursor-pointer items-center gap-3 rounded-[10px] px-3 text-[14px] text-ink-2 [&_svg]:size-4 [&_svg]:text-ink-3">
      {icon}
      <span className="truncate">{children}</span>
      {hint ? <span className="ml-auto shrink-0 text-[12px] text-ink-4">{hint}</span> : <ChevronRight className="ml-auto !size-3.5 opacity-0" />}
    </Command.Item>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['⌘', 'K'], 'Command menu'],
  [['N'], 'New run'],
  [['G', 'O'], 'Overview'],
  [['G', 'R'], 'Runs'],
  [['G', 'T'], 'Targets'],
  [['G', 'W'], 'Workload'],
  [['⌘', '↵'], 'Start run (in the run builder)'],
  [['J', 'K'], 'Next / previous task (Outputs tab)'],
  [['1', '–', '5'], 'Grade the focused output'],
  [['?'], 'This list'],
];

function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-scrim/60 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }} className="solid w-full max-w-md rounded-2xl p-5 shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-head text-[18px]">Keyboard shortcuts</h2>
              <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-ink-3 hover:bg-mist" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
            <ul className="mt-3 divide-y divide-line">
              {SHORTCUTS.map(([keys, label]) => (
                <li key={label} className="flex items-center justify-between py-2.5 text-sm text-ink-2">
                  {label}
                  <span className="flex gap-1">{keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
