import type { WorkloadMeta } from '@/core/workload/types';

/** Ferret: the four AI jobs in a prospecting tool for a sales rep. */
export const meta: WorkloadMeta = {
  id: 'scout-sdr',
  name: 'Ferret · SDR prospecting',
  short: 'Ferret',
  description: 'The four AI jobs in Ferret, a prospecting tool for a sales rep.',
  unit: 'rep',
  defaultUnits: 10,
  defaultDays: 21,
  isDefault: true,
  about: 'Ferret is a prospecting tool used daily in a full-cycle B2B sales job. Its AI work splits into four jobs with very different traffic shapes: a short signal check run on every account, a call debrief after every dial, a cold email, and a long call card before a call block. Bakeoff rebuilds those jobs on 24 fictional Bay Area accounts so no customer data is sent anywhere. Every request carries the same long rep playbook first, as Ferret does, which makes it a realistic prompt-caching test.',
  sharedPrompt: {
    button: 'Read the shared playbook',
    title: 'Shared rep playbook',
    note: 'Sent first on every request, byte-for-byte identical. That makes it the prompt-caching candidate: targets with caching on read it from cache after the first call.',
  },
  expected(task) {
    const gold = (task.gold ?? {}) as { signalStatus?: string; outcome?: string; meetingAsked?: boolean; meetingBooked?: boolean };
    return [
      ...(gold.signalStatus ? [`Expected: ${gold.signalStatus}`] : []),
      ...(gold.outcome ? [`Expected: ${gold.outcome.replace(/_/g, ' ')}`] : []),
      ...(gold.meetingAsked != null ? [`asked ${gold.meetingAsked} · booked ${gold.meetingBooked}`] : []),
    ];
  },
  taskSubtitle(task) {
    const account = task.account as { industry: string; city: string } | undefined;
    return account ? `${account.industry} · ${account.city}` : '';
  },
  taskDetail(task) {
    const a = task.account as { company: string; industry: string; contact: { name: string; title: string } } | undefined;
    return a ? `${a.company} · ${a.industry} · ${a.contact.name}, ${a.contact.title}` : '';
  },
  jobs: [
    {
    type: 'signal',
    workload: 'scout-sdr',
    short: 'Signal',
    label: 'Signal check',
    blurb: 'Is there a real reason to call this account today? HARD, SOFT or NO RECENT SIGNAL.',
    profile: 'Short in, very short out. Classification. Latency-sensitive: the rep runs it on every account in a list.',
    defaultSloMs: 4_000,
      budgetNote: 'signal checks, the job a rep runs on every account',
    defaultPerRepPerDay: 40,
    maxTokens: 300,
    },
    {
    type: 'debrief',
    workload: 'scout-sdr',
    short: 'Debrief',
    label: 'Call debrief',
    blurb: 'Messy after-call notes in, a clean outcome, next step and CRM notes out.',
    profile: 'Short in, medium out. Extraction with a right answer. Runs after every dial.',
    defaultSloMs: 10_000,
    defaultPerRepPerDay: 30,
    maxTokens: 600,
    },
    {
    type: 'email',
    workload: 'scout-sdr',
    short: 'Email',
    label: 'Cold email',
    blurb: 'One account record in, a 60-100 word email that follows the writing rules out.',
    profile: 'Medium in, medium out. Generation under strict style rules. The rep reads it before sending.',
    defaultSloMs: 15_000,
    defaultPerRepPerDay: 12,
    maxTokens: 700,
    },
    {
    type: 'callcard',
    workload: 'scout-sdr',
    short: 'Call card',
    label: 'Call card',
    blurb: 'Everything the rep needs before dialing: opening, question, angle, voicemail, next move.',
    profile: 'Medium in, longest out. The highest-judgment job. Prepared ahead of a call block.',
    defaultSloMs: 25_000,
    defaultPerRepPerDay: 15,
    maxTokens: 1_000,
    },
  ],
};
