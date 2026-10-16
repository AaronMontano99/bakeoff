'use client';

import { Command } from 'cmdk';
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
  Menu,
  Play,
  Search,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { useJson } from '@/lib/use-json';
import type { RunListItem, TargetWithStatus } from '@/lib/types-client';
import { fmt } from '@/lib/format';
import { cx, Dot, Kbd } from './ui';

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
  const [mobileNav, setMobileNav] = useState(false);
  const print = pathname.endsWith('/brief');

  useEffect(() => setMobileNav(false), [pathname]);

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
      <div className="flex min-h-dvh bg-paper">
        <Sidebar pathname={pathname} onSearch={() => setPalette(true)} onShortcuts={() => setShortcuts(true)} className="hidden lg:flex" />

        <AnimatePresence>
          {mobileNav && (
            <>
              <motion.div className="fixed inset-0 z-40 bg-forest-950/40 backdrop-blur-[2px] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)} />
              <motion.div className="fixed inset-y-0 left-0 z-50 lg:hidden" initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
                <Sidebar pathname={pathname} onSearch={() => setPalette(true)} onShortcuts={() => setShortcuts(true)} className="flex h-full" />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <div className="min-w-0 flex-1">
          <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/85 px-4 backdrop-blur lg:hidden">
            <button onClick={() => setMobileNav(true)} className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-mist" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <Logo />
            <button onClick={() => setPalette(true)} className="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-mist" aria-label="Search">
              <Search className="size-[18px]" />
            </button>
          </div>
          <main>{children}</main>
        </div>
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} onShortcuts={() => setShortcuts(true)} />
      <Shortcuts open={shortcuts} onClose={() => setShortcuts(false)} />
      <Toaster
        position="bottom-right"
        toastOptions={{ classNames: { toast: '!rounded-xl !border-line !shadow-lift !font-sans', title: '!text-ink !font-medium', description: '!text-ink-3' } }}
      />
    </ShellCtx.Provider>
  );
}

function Logo({ dark }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className={cx('grid size-8 place-items-center rounded-[9px]', dark ? 'bg-forest-700 ring-1 ring-white/10' : 'bg-forest-800')}>
        <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
          <path d="M7 23h18M10 23V14M16 23V8M22 23v-6" stroke="#a9cbb5" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        </svg>
      </span>
      <span className={cx('text-[15px] font-semibold tracking-[-0.02em]', dark ? 'text-white' : 'text-ink')}>Bakeoff</span>
    </Link>
  );
}

function Sidebar({ pathname, onSearch, onShortcuts, className }: { pathname: string; onSearch: () => void; onShortcuts: () => void; className?: string }) {
  const { data: targets } = useJson<TargetWithStatus[]>('/api/targets', { refreshMs: 30_000 });
  const ready = targets?.filter((t) => t.status.state === 'ready').length ?? null;
  const enabled = targets?.filter((t) => t.enabled).length ?? null;

  const active = (href: string) => (href === '/' ? pathname === '/' : href === '/runs' ? pathname === '/runs' || (pathname.startsWith('/runs/') && pathname !== '/runs/new') : pathname.startsWith(href));

  return (
    <aside className={cx('sticky top-0 h-dvh w-[248px] shrink-0 flex-col bg-forest-900 text-white', className)}>
      <div className="flex h-16 items-center px-5">
        <Logo dark />
      </div>

      <div className="px-3">
        <button onClick={onSearch} className="flex h-9 w-full items-center gap-2 rounded-[10px] bg-white/[0.06] px-3 text-[13px] text-sage-200/80 ring-1 ring-white/[0.08] transition hover:bg-white/10">
          <Search className="size-3.5" />
          Search or jump to…
          <span className="ml-auto flex gap-0.5">
            <Kbd tone="dark">⌘</Kbd>
            <Kbd tone="dark">K</Kbd>
          </span>
        </button>
      </div>

      <nav className="mt-4 flex flex-col gap-0.5 px-3">
        {NAV.map((n) => {
          const on = active(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cx(
                'group relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors',
                on ? 'bg-white/[0.09] text-white' : 'text-sage-200/75 hover:bg-white/[0.05] hover:text-white'
              )}
            >
              {on && <motion.span layoutId="nav-pill" className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-forest-300" />}
              <n.icon className={cx('size-[17px]', on ? 'text-forest-300' : 'text-sage-300/60 group-hover:text-sage-200')} />
              {n.label}
              <span className="ml-auto text-[11px] text-white/0 transition group-hover:text-white/35">G {n.chord.toUpperCase()}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto space-y-3 p-3">
        <Link href="/targets" className="block rounded-xl bg-white/[0.05] p-3 ring-1 ring-white/[0.07] transition hover:bg-white/[0.08]">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-sage-100">
            <Dot tone={ready ? 'green' : 'muted'} pulse={!!ready} />
            {ready == null ? 'Checking targets…' : `${ready} of ${enabled} targets ready`}
          </div>
          <div className="mt-1 text-[12px] leading-snug text-sage-300/70">{ready === 0 ? 'Start Ollama or log in to Claude Code to begin.' : 'Add API keys in .env.local to unlock hosted providers.'}</div>
        </Link>
        <button onClick={onShortcuts} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] text-sage-300/70 hover:text-sage-100">
          <Keyboard className="size-3.5" /> Keyboard shortcuts <span className="ml-auto"><Kbd tone="dark">?</Kbd></span>
        </button>
      </div>
    </aside>
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
        <motion.div className="fixed inset-0 z-[60] flex items-start justify-center bg-forest-950/35 px-4 pt-[12vh] backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
            className="w-full max-w-[600px] overflow-hidden rounded-2xl bg-paper shadow-pop"
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
        <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-forest-950/35 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }} className="w-full max-w-md rounded-2xl bg-paper p-5 shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Keyboard shortcuts</h2>
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
