'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const DIRECTIONS = [
  { id: 'golden', name: 'Golden Hour', blurb: 'Dark glass over a toasted dusk. Closest to the reference dashboard.' },
  { id: 'dust', name: 'Cheese Dust', blurb: 'The whole ground is the seasoning. Loud, puffy, very Bakeoff.' },
  { id: 'nine', name: 'Cloud Nine', blurb: 'Morning above the weather. Cheese accent, puffy headings, bright glass.' },
] as const;

export type DirectionId = (typeof DIRECTIONS)[number]['id'];

export const DEFAULT_DIRECTION: DirectionId = 'nine';

export const HEADING_FONTS = [
  { id: 'theme', label: 'Direction default', value: '' },
  { id: 'outfit', label: 'Outfit', value: 'var(--f-outfit)' },
  { id: 'fredoka', label: 'Fredoka', value: 'var(--f-fredoka)' },
  { id: 'fraunces', label: 'Fraunces', value: 'var(--f-fraunces)' },
] as const;

/** Accent overrides. Each carries the text color that stays readable on it. */
export const ACCENTS = [
  { id: 'theme', label: 'Direction default', value: '', on: '' },
  { id: 'cheese', label: 'Cheese', value: '#ffb81f', on: '#2a1505' },
  { id: 'puff', label: 'Puff orange', value: '#ff8a14', on: '#2a1505' },
  { id: 'chili', label: 'Chili', value: '#ff5a1f', on: '#220c02' },
  { id: 'lemon', label: 'Lemon', value: '#ffe03d', on: '#2a1f05' },
] as const;

export interface Look {
  direction: DirectionId;
  font: (typeof HEADING_FONTS)[number]['id'];
  accent: (typeof ACCENTS)[number]['id'];
  /** Multiplies the direction's corner radius. */
  roundness: number;
  /** Pixels of glass blur; null keeps the direction's own. */
  blur: number | null;
  /** How much of the cloud picture shows, 0-1; null keeps the direction's own. */
  clouds: number | null;
  /** Root font scale. */
  density: number;
}

export const DEFAULT_LOOK: Look = { direction: DEFAULT_DIRECTION, font: 'theme', accent: 'theme', roundness: 1, blur: null, clouds: null, density: 1 };

const KEY = 'bakeoff-look';

/** Runs before first paint so a chosen direction never flashes the default. */
export const BOOT_SCRIPT = `(function(){try{var d=document.documentElement,l=JSON.parse(localStorage.getItem('${KEY}')||'{}');d.dataset.theme=l.direction||'${DEFAULT_DIRECTION}'}catch(e){document.documentElement.dataset.theme='${DEFAULT_DIRECTION}'}})();`;

function apply(look: Look) {
  const root = document.documentElement;
  root.dataset.theme = look.direction;
  const set = (name: string, value: string) => (value ? root.style.setProperty(name, value) : root.style.removeProperty(name));
  const accent = ACCENTS.find((a) => a.id === look.accent)!;
  set('--accent', accent.value);
  set('--on-accent', accent.on);
  set('--hero', accent.value);
  set('--on-hero', accent.on);
  set('--on-hero-2', accent.value ? `color-mix(in oklab, ${accent.on} 78%, ${accent.value})` : '');
  set('--font-head', HEADING_FONTS.find((f) => f.id === look.font)!.value);
  set('--glass-blur', look.blur == null ? '' : `${look.blur}px`);
  set('--sky-amount', look.clouds == null ? '' : String(look.clouds));
  set('--density', look.density === 1 ? '' : String(look.density));
  root.style.removeProperty('--r-card');
  root.style.removeProperty('--r-inner');
  root.style.removeProperty('--r-control');
  if (look.roundness !== 1) {
    const cs = getComputedStyle(root);
    for (const name of ['--r-card', '--r-inner', '--r-control']) {
      const px = parseFloat(cs.getPropertyValue(name));
      if (Number.isFinite(px)) root.style.setProperty(name, `${Math.min(px * look.roundness, 999)}px`);
    }
  }
}

const Ctx = createContext<{ look: Look; update: (patch: Partial<Look>) => void; reset: () => void }>({ look: DEFAULT_LOOK, update: () => {}, reset: () => {} });
export const useLook = () => useContext(Ctx);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  // Nothing gets applied until the saved look is read, or the default flashes over what BOOT_SCRIPT set.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read once after hydration
      if (saved) setLook({ ...DEFAULT_LOOK, ...saved });
    } catch {
      // Private window or cleared storage: the default look is fine.
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) apply(look);
  }, [look, loaded]);

  const update = useCallback((patch: Partial<Look>) => {
    setLook((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Not worth interrupting anyone over: it just won't survive a reload.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setLook((prev) => {
      const next = { ...DEFAULT_LOOK, direction: prev.direction };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // See above.
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ look, update, reset }), [look, update, reset]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
