import type { CheckResult, Task } from '../types';
import { extractJson } from '../json';
import { OUTCOMES, OUTPUT_SCHEMAS } from '../workload';

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

export function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

export function runChecks(task: Task, output: string): { checks: CheckResult[]; score: number; parsed: unknown } {
  const checks: CheckResult[] = [];
  const parsed = extractJson(output);
  checks.push({ id: 'json', label: 'Valid JSON', pass: parsed != null, detail: parsed == null ? 'No parseable JSON object in the answer' : undefined });

  const schema = OUTPUT_SCHEMAS[task.type];
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
