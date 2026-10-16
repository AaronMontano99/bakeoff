import type { TaskType, TaskTypeInfo } from '../types';

/** Client-safe workload metadata (no Node imports), shared by the UI and the analysis code. */

export const TASK_TYPES: Record<TaskType, TaskTypeInfo> = {
  signal: {
    type: 'signal',
    short: 'Signal',
    label: 'Signal check',
    blurb: 'Is there a real reason to call this account today? HARD, SOFT or NO RECENT SIGNAL.',
    profile: 'Short in, very short out. Classification. Latency-sensitive: the rep runs it on every account in a list.',
    defaultSloMs: 4_000,
    defaultPerRepPerDay: 40,
    maxTokens: 300,
  },
  debrief: {
    type: 'debrief',
    short: 'Debrief',
    label: 'Call debrief',
    blurb: 'Messy after-call notes in, a clean outcome, next step and CRM notes out.',
    profile: 'Short in, medium out. Extraction with a right answer. Runs after every dial.',
    defaultSloMs: 10_000,
    defaultPerRepPerDay: 30,
    maxTokens: 600,
  },
  email: {
    type: 'email',
    short: 'Email',
    label: 'Cold email',
    blurb: 'One account record in, a 60-100 word email that follows the writing rules out.',
    profile: 'Medium in, medium out. Generation under strict style rules. The rep reads it before sending.',
    defaultSloMs: 15_000,
    defaultPerRepPerDay: 12,
    maxTokens: 700,
  },
  callcard: {
    type: 'callcard',
    short: 'Call card',
    label: 'Call card',
    blurb: 'Everything the rep needs before dialing: opening, question, angle, voicemail, next move.',
    profile: 'Medium in, longest out. The highest-judgment job. Prepared ahead of a call block.',
    defaultSloMs: 25_000,
    defaultPerRepPerDay: 15,
    maxTokens: 1_000,
  },
};

export const TASK_TYPE_ORDER: TaskType[] = ['signal', 'debrief', 'email', 'callcard'];

export const OUTCOMES = [
  'no_answer',
  'voicemail',
  'gatekeeper',
  'general_staff',
  'decision_maker',
  'meeting_booked',
  'follow_up_required',
  'not_interested',
  'wrong_contact',
] as const;

