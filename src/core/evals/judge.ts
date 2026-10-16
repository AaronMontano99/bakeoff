import type { Judgement, Target, Task } from '../types';
import { callTarget } from '../providers';
import { extractJson } from '../json';
import { buildPrompt, type Workload } from '../workload';

/**
 * LLM-as-judge. One rubric per task type, graded 1-5 against the same
 * playbook the candidate saw. Known limits, stated in the report:
 * a judge can favor its own model family, and it can be wrong; the
 * calibration view compares it to human grades so you can see how much
 * to trust it.
 */
const RUBRICS: Record<Task['type'], string> = {
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

export async function judge(task: Task, output: string, workload: Workload, judgeTarget: Target): Promise<Judgement> {
  const original = buildPrompt(task, workload);
  const prompt = {
    playbook: original.playbook,
    system: 'You are grading an AI assistant\'s answer for a sales rep, strictly, against the rep playbook above. Answer with one JSON object and nothing else.',
    user: `## The task the assistant was given
${original.user}

## The assistant's answer
${output.slice(0, 6000)}

## Rubric (score 1-5)
${RUBRICS[task.type]}

Answer with exactly: {"score": 1-5, "rationale": "one or two sentences naming the main reason"}`,
  };
  const res = await callTarget(judgeTarget, prompt, { maxTokens: 300 });
  const parsed = extractJson(res.text) as { score?: unknown; rationale?: unknown } | null;
  const score = Number(parsed?.score);
  if (!parsed || !Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error(`Judge returned an unreadable grade: ${res.text.slice(0, 160)}`);
  }
  return { score: Math.round(score), rationale: String(parsed.rationale ?? '').slice(0, 500) };
}
