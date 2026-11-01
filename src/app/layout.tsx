import type { Metadata } from 'next';
import { Figtree, Fraunces, Fredoka, Geist_Mono, Nunito_Sans, Outfit } from 'next/font/google';
import { AppShell } from '@/components/app-shell';
import { AppearanceProvider, BOOT_SCRIPT } from '@/lib/appearance';
import './globals.css';

// Every face here is open source (SIL OFL). Only the default direction's two preload.
const outfit = Outfit({ subsets: ['latin'], variable: '--f-outfit', preload: false });
const figtree = Figtree({ subsets: ['latin'], variable: '--f-figtree' });
const fredoka = Fredoka({ subsets: ['latin'], variable: '--f-fredoka' });
const nunito = Nunito_Sans({ subsets: ['latin'], variable: '--f-nunito', preload: false });
const fraunces = Fraunces({ subsets: ['latin'], variable: '--f-fraunces', preload: false });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--f-mono', preload: false });

const fonts = [outfit, figtree, fredoka, nunito, fraunces, mono].map((f) => f.variable).join(' ');

export const metadata: Metadata = {
  title: { default: 'Bakeoff', template: '%s · Bakeoff' },
  description: 'Inference bake-off on a real sales workload: latency, throughput, cost and eval quality across providers.',
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fonts} data-theme="nine" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <AppearanceProvider>
          <AppShell>{children}</AppShell>
        </AppearanceProvider>
      </body>
    </html>
  );
}
