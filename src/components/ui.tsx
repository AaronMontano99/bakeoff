'use client';

/**
 * Primitives in the shadcn/ui spirit (MIT): small, composable, styled with
 * Tailwind tokens from globals.css. Kept in one file so the whole design
 * language is readable in one place.
 */
import { motion } from 'motion/react';
import { Loader2, Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,box-shadow,color,transform] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45 select-none';
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-forest-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(7_26_18/0.3)] hover:bg-forest-800',
  secondary: 'bg-paper text-ink border border-line-strong shadow-card hover:bg-mist hover:border-ink-4',
  ghost: 'text-ink-2 hover:bg-sage-50 hover:text-ink',
  subtle: 'bg-sage-50 text-forest-800 hover:bg-sage-100',
  danger: 'bg-paper text-bad border border-line-strong hover:bg-[#fdf3f1] hover:border-[#e8b4aa]',
};
const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg',
  md: 'h-9 px-3.5 text-sm rounded-[10px]',
  lg: 'h-11 px-5 text-[15px] rounded-xl',
};

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  kbd?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, kbd, className, children, disabled, ...rest },
  ref
) {
  return (
    <button ref={ref} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
      {kbd && <Kbd tone={variant === 'primary' ? 'dark' : 'light'}>{kbd}</Kbd>}
    </button>
  );
});

export function ButtonLink({ href, variant = 'secondary', size = 'md', icon, className, children, kbd }: { href: string; variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; className?: string; children: ReactNode; kbd?: string }) {
  return (
    <Link href={href} className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}>
      {icon}
      {children}
      {kbd && <Kbd tone={variant === 'primary' ? 'dark' : 'light'}>{kbd}</Kbd>}
    </Link>
  );
}

// ---------------------------------------------------------------- Kbd

export function Kbd({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <kbd
      className={cx(
        'ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-sans text-[11px] font-medium',
        tone === 'dark' ? 'bg-white/15 text-white/85' : 'border border-line bg-mist text-ink-3 shadow-[0_1px_0_var(--color-line)]'
      )}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------- Badge

type Tone = 'neutral' | 'green' | 'warn' | 'bad' | 'info' | 'dark';
const TONE: Record<Tone, string> = {
  neutral: 'bg-mist text-ink-2 border-line',
  green: 'bg-sage-50 text-forest-700 border-sage-200',
  warn: 'bg-[#fdf6e9] text-warn border-[#f1dcb2]',
  bad: 'bg-[#fdf1ef] text-bad border-[#f2c9c1]',
  info: 'bg-[#eef4fc] text-[#1f5fae] border-[#cfe0f6]',
  dark: 'bg-forest-800 text-white border-forest-800',
};

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[12px] font-medium whitespace-nowrap', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone = 'green', pulse }: { tone?: 'green' | 'warn' | 'bad' | 'muted'; pulse?: boolean }) {
  const color = { green: 'bg-forest-500', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-ink-4' }[tone];
  return <span className={cx('inline-block size-2 shrink-0 rounded-full', color, pulse && 'animate-pulse-dot')} />;
}

// ---------------------------------------------------------------- Card

export function Card({ className, children, ...rest }: ComponentProps<'div'>) {
  return (
    <div className={cx('rounded-2xl border border-line bg-paper shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Stat tile

export function Stat({ label, value, sub, accent, icon }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean; icon?: ReactNode }) {
  return (
    <div className={cx('rounded-2xl border p-4', accent ? 'border-forest-700 bg-forest-800 text-white' : 'border-line bg-paper shadow-card')}>
      <div className={cx('flex items-center gap-1.5 text-[12.5px] font-medium', accent ? 'text-sage-200' : 'text-ink-3')}>
        {icon}
        {label}
      </div>
      <div className={cx('tabular mt-1.5 text-[26px] leading-none font-semibold tracking-[-0.02em]', accent ? 'text-white' : 'text-ink')}>{value}</div>
      {sub && <div className={cx('mt-1.5 line-clamp-2 text-[12.5px] leading-snug', accent ? 'text-sage-200/90' : 'text-ink-3')}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Tabs

export function Tabs<T extends string>({ value, onChange, items, id }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; icon?: ReactNode; count?: ReactNode }[]; id: string }) {
  return (
    <div role="tablist" className="flex items-center gap-1 overflow-x-auto border-b border-line scrollbar-thin">
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cx('relative flex h-10 items-center gap-1.5 px-3 text-[13.5px] font-medium whitespace-nowrap transition-colors', active ? 'text-forest-800' : 'text-ink-3 hover:text-ink')}
          >
            {it.icon}
            {it.label}
            {it.count != null && <span className="tabular rounded-full bg-mist px-1.5 text-[11px] text-ink-3">{it.count}</span>}
            {active && <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-forest-600" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Segmented

export function Segmented<T extends string | number>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex rounded-[10px] border border-line bg-mist p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-lg font-medium transition-all',
            size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
            o.value === value ? 'bg-paper text-ink shadow-card' : 'text-ink-3 hover:text-ink'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Switch

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-forest-600' : 'bg-line-strong')}
      >
        <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 35 }} className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow', checked ? 'right-0.5' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <span>
          {label && <span className="block text-sm font-medium text-ink">{label}</span>}
          {description && <span className="block text-[13px] text-ink-3">{description}</span>}
        </span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------- Stepper

export function Stepper({ value, onChange, min = 1, max = 99, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="inline-flex h-9 items-center rounded-[10px] border border-line-strong bg-paper shadow-card">
      <button className="grid h-full w-8 place-items-center text-ink-3 hover:text-ink disabled:opacity-30" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease">
        <Minus className="size-3.5" />
      </button>
      <span className="tabular min-w-12 text-center text-sm font-medium">
        {value}
        {suffix && <span className="ml-1 text-ink-3">{suffix}</span>}
      </span>
      <button className="grid h-full w-8 place-items-center text-ink-3 hover:text-ink disabled:opacity-30" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- misc

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('rounded-lg bg-[linear-gradient(90deg,var(--color-mist),var(--color-sage-50),var(--color-mist))] bg-[length:200%_100%] animate-shimmer', className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-sage-200 bg-sage-50 text-forest-600">{icon}</div>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-3">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionLabel({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{children}</h2>
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

export function Swatch({ color, shape = 'dot' }: { color: string; shape?: 'dot' | 'line' }) {
  return shape === 'line' ? <span className="inline-block h-[3px] w-3.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ background: color }} />;
}

export function Progress({ value, running }: { value: number; running?: boolean }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-sage-100">
      <motion.div className="relative h-full rounded-full bg-forest-500" initial={false} animate={{ width: `${Math.max(2, value * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 24 }}>
        {running && <div className="sheen absolute inset-0 rounded-full" />}
      </motion.div>
    </div>
  );
}
