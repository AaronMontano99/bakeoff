import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Prompt, Task, TaskType } from '../types';
import { PLAYBOOK } from './playbook';

export { TASK_TYPES, TASK_TYPE_ORDER, OUTCOMES } from './meta';
import { OUTCOMES, TASK_TYPE_ORDER } from './meta';

/** Output contracts. Loose on purpose (strings, not enums) so we can score wrong answers instead of failing them. */
export const OUTPUT_SCHEMAS = {
  signal: z.object({ signalStatus: z.string(), whyNow: z.string(), evidence: z.string() }),
  debrief: z.object({
    outcome: z.string(),
    meetingAsked: z.boolean(),
    meetingBooked: z.boolean(),
    summary: z.string(),
    nextStep: z.string(),
    crmNotes: z.array(z.string()),
  }),
  email: z.object({ subject: z.string(), body: z.string(), ctaType: z.string() }),
  callcard: z.object({
    opening: z.string(),
    reason: z.string(),
    hypothesis: z.string(),
    primaryQuestion: z.string(),
    angle: z.string(),
    meetingAsk: z.string(),
    voicemail: z.string(),
    ifNoAnswer: z.string(),
  }),
} as const;

const FIELD_SPECS: Record<TaskType, string> = {
  signal: `{
  "signalStatus": "HARD SIGNAL" | "SOFT SIGNAL" | "NO RECENT SIGNAL",
  "whyNow": "one or two sentences: the honest reason to reach out today",
  "evidence": "the dated fact the label rests on, or 'none in the last 6 months'"
}`,
  debrief: `{
  "outcome": one of ${OUTCOMES.map((o) => `"${o}"`).join(' | ')},
  "meetingAsked": true | false,
  "meetingBooked": true | false,
  "summary": "one sentence: what happened",
  "nextStep": "the single next action with a day if known",
  "crmNotes": ["short factual bullet", "..."]
}`,
  email: `{
  "subject": "under 8 words",
  "body": "the full email, greeting to sign-off, 60-100 words, paragraphs separated by blank lines",
  "ctaType": "meeting" | "question"
}`,
  callcard: `{
  "opening": "the exact spoken opening line",
  "reason": "why this account, why now",
  "hypothesis": "one hypothesis, framed as something to test",
  "primaryQuestion": "one open question ending with ?",
  "angle": "the one entry point, and what not to bring up",
  "meetingAsk": "the exact meeting ask, with a length in minutes",
  "voicemail": "20-40 seconds spoken, 50-100 words, with callback number",
  "ifNoAnswer": "the next move if nobody picks up"
}`,
};

const INSTRUCTIONS: Record<TaskType, string> = {
  signal: 'Label the reason to reach out to this account today, following the signal rules.',
  debrief: "Debrief this touch from the rep's raw notes, following the debrief rules.",
  email: 'Write the cold email for this account, following the writing rules.',
  callcard: 'Build the call card for this account, following the calling rules.',
};

export interface Workload {
  id: string;
  name: string;
  description: string;
  today: string;
  rep: { name: string; company: string; city: string; phone: string };
  tasks: Task[];
}

let cached: Workload | null = null;

export function loadWorkload(root = process.cwd()): Workload {
  if (cached) return cached;
  const file = path.join(root, 'workloads', 'scout-sdr', 'tasks.json');
  cached = JSON.parse(fs.readFileSync(file, 'utf8')) as Workload;
  return cached;
}

export function tasksFor(workload: Workload, types: TaskType[], perType: number): Task[] {
  return TASK_TYPE_ORDER.filter((t) => types.includes(t)).flatMap((t) =>
    workload.tasks.filter((task) => task.type === t).slice(0, perType)
  );
}

export function buildPrompt(task: Task, workload: Workload): Prompt {
  const { account } = task;
  const lines = [
    `Today is ${workload.today}. Rep: ${workload.rep.name}, ${workload.rep.company}, based in ${workload.rep.city}. Rep phone: ${workload.rep.phone}.`,
    '',
    INSTRUCTIONS[task.type],
    '',
    '## Account',
    `Company: ${account.company} (${account.city})`,
    `Industry: ${account.industry}`,
    `Employees: ${account.employees}`,
    `Contact: ${account.contact.name}, ${account.contact.title}`,
    `CRM notes: ${account.crmNotes}`,
    `Current research: ${account.research}`,
  ];
  if (task.callNotes) lines.push('', '## Rep notes from this touch', task.callNotes);
  lines.push('', '## Answer with exactly this JSON shape', FIELD_SPECS[task.type]);
  return {
    playbook: PLAYBOOK,
    system: 'Follow the rep playbook exactly. Answer with one JSON object and nothing else.',
    user: lines.join('\n'),
  };
}

export { extractJson } from '../json';
