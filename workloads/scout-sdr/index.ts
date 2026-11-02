import { z } from 'zod';
import type { CheckResult, Prompt, Task, TaskType } from '@/core/types';
import { extractJson } from '@/core/json';
import { words } from '@/core/evals/text';
import type { Workload, WorkloadPlugin } from '@/core/workload/types';
import { PLAYBOOK } from './playbook';

/** Ferret: the four AI jobs in a sales rep's prospecting tool. */

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

interface Account {
  company: string;
  city: string;
  industry: string;
  employees: string;
  contact: { name: string; title: string };
  crmNotes: string;
  research: string;
}

/** What this project's tasks carry on top of the shared shape. */
type SalesTask = Task & {
  account: Account;
  callNotes?: string;
  gold?: { signalStatus?: string; outcome?: string; meetingBooked?: boolean; meetingAsked?: boolean };
};

type Rep = { name: string; company: string; city: string; phone: string };

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

const FIELD_SPECS: Partial<Record<TaskType, string>> = {
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

const INSTRUCTIONS: Partial<Record<TaskType, string>> = {
  signal: 'Label the reason to reach out to this account today, following the signal rules.',
  debrief: "Debrief this touch from the rep's raw notes, following the debrief rules.",
  email: 'Write the cold email for this account, following the writing rules.',
  callcard: 'Build the call card for this account, following the calling rules.',
};

export function salesPrompt(raw: Task, workload: Workload): Prompt {
  const task = raw as SalesTask;
  const account = task.account;
  const rep = workload.rep as Rep;
  const lines = [
    `Today is ${workload.today}. Rep: ${rep.name}, ${rep.company}, based in ${rep.city}. Rep phone: ${rep.phone}.`,
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


/**
 * Deterministic checks: things a script can grade without an opinion.
 * Every task gets "valid JSON" and "matches the contract"; then each task
 * type adds the rules from the playbook that are mechanically testable,
 * plus ground-truth accuracy where the task has a right answer.
 */

const BANNED = [
  'hope this finds you',
  'hope this email finds you',
  'just checking in',
  'touching base',
  'synergy',
  'leverage',
  'revolutionize',
];

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function salesChecks(raw: Task, output: string): { checks: CheckResult[]; score: number; parsed: unknown } {
  const task = raw as SalesTask;
  const checks: CheckResult[] = [];
  const parsed = extractJson(output);
  checks.push({ id: 'json', label: 'Valid JSON', pass: parsed != null, detail: parsed == null ? 'No parseable JSON object in the answer' : undefined });

  const schema = OUTPUT_SCHEMAS[task.type as keyof typeof OUTPUT_SCHEMAS];
  const shaped = parsed == null ? null : schema.safeParse(parsed);
  checks.push({
    id: 'contract',
    label: 'Matches the output contract',
    pass: !!shaped?.success,
    detail: shaped && !shaped.success ? shaped.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).slice(0, 3).join('; ') : undefined,
  });

  const o = (parsed ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');

  switch (task.type) {
    case 'signal': {
      const label = str('signalStatus').trim().toUpperCase();
      const gold = task.gold?.signalStatus;
      checks.push({
        id: 'signal-label',
        label: 'Signal label is correct',
        pass: !!gold && label === gold,
        detail: `Expected ${gold}, got ${label || 'nothing'}`,
      });
      checks.push({ id: 'whynow', label: 'Gives a why-now', pass: words(str('whyNow')) >= 5 });
      break;
    }
    case 'debrief': {
      const outcome = str('outcome').trim().toLowerCase();
      checks.push({
        id: 'outcome-valid',
        label: 'Outcome is a known label',
        pass: (OUTCOMES as readonly string[]).includes(outcome),
      });
      checks.push({
        id: 'outcome-correct',
        label: 'Outcome is correct',
        pass: outcome === task.gold?.outcome,
        detail: `Expected ${task.gold?.outcome}, got ${outcome || 'nothing'}`,
      });
      checks.push({
        id: 'meeting-flags',
        label: 'Meeting asked/booked flags are correct',
        pass: o.meetingAsked === task.gold?.meetingAsked && o.meetingBooked === task.gold?.meetingBooked,
        detail: `Expected asked=${task.gold?.meetingAsked} booked=${task.gold?.meetingBooked}, got asked=${String(o.meetingAsked)} booked=${String(o.meetingBooked)}`,
      });
      const notes = Array.isArray(o.crmNotes) ? o.crmNotes : [];
      checks.push({ id: 'crm-notes', label: 'Has CRM notes', pass: notes.length >= 1 && notes.length <= 8 });
      break;
    }
    case 'email': {
      const body = str('body');
      const subject = str('subject');
      const n = words(body);
      checks.push({ id: 'length', label: 'Body is 60-100 words', pass: n >= 60 && n <= 100, detail: `${n} words` });
      checks.push({ id: 'subject', label: 'Subject under 8 words', pass: words(subject) > 0 && words(subject) < 8, detail: `${words(subject)} words` });
      checks.push({ id: 'em-dash', label: 'No em dashes', pass: !/[—]/.test(body + subject) });
      checks.push({ id: 'exclaim', label: 'No exclamation marks', pass: !/!/.test(body + subject) });
      const hit = BANNED.find((b) => (body + ' ' + subject).toLowerCase().includes(b));
      checks.push({ id: 'cliche', label: 'No banned clichés', pass: !hit, detail: hit ? `Found "${hit}"` : undefined });
      checks.push({
        id: 'personal',
        label: "Uses the contact's first name",
        pass: body.includes(firstName(task.account.contact.name)),
      });
      const asks = (body.match(/\?/g) ?? []).length;
      checks.push({ id: 'one-ask', label: 'Ends on one clear ask', pass: asks >= 1 && asks <= 2, detail: `${asks} question marks` });
      break;
    }
    case 'callcard': {
      const opening = str('opening');
      const vm = str('voicemail');
      const vmWords = words(vm);
      checks.push({
        id: 'opening-shape',
        label: 'Opening follows "[Name], [rep] ... Reason for my call"',
        pass: opening.trim().startsWith(firstName(task.account.contact.name)) && /reason for my call/i.test(opening),
      });
      checks.push({ id: 'question', label: 'Primary question ends with ?', pass: str('primaryQuestion').trim().endsWith('?') });
      checks.push({ id: 'voicemail', label: 'Voicemail is 50-100 words', pass: vmWords >= 50 && vmWords <= 100, detail: `${vmWords} words` });
      checks.push({ id: 'callback', label: 'Voicemail leaves the callback number', pass: /555[-\s.]?0142/.test(vm) });
      checks.push({ id: 'minutes', label: 'Meeting ask names a length', pass: /\b\d+\s*(min|minutes)\b/i.test(str('meetingAsk')) });
      checks.push({ id: 'em-dash', label: 'No em dashes', pass: !/[—]/.test(Object.values(o).filter((v) => typeof v === 'string').join(' ')) });
      break;
    }
  }

  const score = checks.filter((c) => c.pass).length / checks.length;
  return { checks, score, parsed };
}

export const RUBRICS: Partial<Record<TaskType, string>> = {
  signal: `5 = correct label and a why-now a rep could say out loud, grounded only in the given facts.
3 = label defensible but the why-now is vague or leans on old CRM notes.
1 = wrong label, or treats an old note or a promise to call back as a signal, or invents facts.`,
  debrief: `5 = outcome and meeting flags right, next step specific, CRM notes contain only what the notes say.
3 = mostly right but a flag is off or the next step is vague.
1 = wrong outcome, invented facts in the CRM notes, or missing the real next step.`,
  email: `5 = a strong rep would send it as is: specific reason tied to the account, one hypothesis, one clear ask, follows every writing rule, no invented facts.
3 = usable after edits: generic in places, or breaks a rule.
1 = generic template, pushy or salesy, wrong ask, or invents numbers, names or results.`,
  callcard: `5 = the rep could dial with it now: opening follows the shape, one sharp question, the right single angle, voicemail in range with callback, sensible next move. Existing-customer problems lead with the fix.
3 = workable but generic, or misses the best angle.
1 = wrong angle (e.g. upselling an angry customer), invented facts, or unusable lines.`,
};


export const JUDGE_SYSTEM = "You are grading an AI assistant's answer for a sales rep, strictly, against the rep playbook above. Answer with one JSON object and nothing else.";

export const plugin: WorkloadPlugin = { buildPrompt: salesPrompt, runChecks: (task, output) => salesChecks(task, output), rubrics: RUBRICS, judgeSystem: JUDGE_SYSTEM };
