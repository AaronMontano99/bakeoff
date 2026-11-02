import type { Judgement, Target, Task } from '../types';
import { callTarget } from '../providers';
import { extractJson } from '../json';
import { buildPrompt, workloadDef, type Workload } from '../workload';

/**
 * LLM-as-judge. One rubric per job, graded 1-5 against the same prompt the
 * candidate saw. Known limits, stated in the report: a judge can favor its
 * own model family, and it can be wrong; the calibration view compares it
 * to human grades so you can see how much to trust it.
 */
export async function judge(task: Task, output: string, workload: Workload, judgeTarget: Target): Promise<Judgement> {
  const original = buildPrompt(task, workload);
  const def = workloadDef(workload.id);
  const prompt = {
    playbook: original.playbook,
    system: def.judgeSystem,
    user: `## The task the assistant was given
${original.user}

## The assistant's answer
${output.slice(0, 6000)}

## Rubric (score 1-5)
${def.rubrics[task.type]}

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
