import type { Prompt, Task } from '@/core/types';
import type { Workload, WorkloadPlugin } from '@/core/workload/types';

const SHARED_PROMPT = 'You are the assistant inside my app. Answer clearly and briefly.';

function buildPrompt(task: Task, _workload: Workload): Prompt {
  return { playbook: SHARED_PROMPT, system: '', user: String(task.input?.question ?? '') };
}

/** Things a script can grade without an opinion. Add whatever must always be true. */
function runChecks(task: Task, output: string) {
  const expected = String(task.gold?.mustMention ?? '');
  const checks = [
    { id: 'answered', label: 'Gave an answer', pass: output.trim().length > 0, detail: `${output.length} characters` },
    { id: 'mentions', label: 'Mentions the right thing', pass: !expected || output.toLowerCase().includes(expected.toLowerCase()), detail: `Looked for "${expected}"` },
  ];
  return { checks, score: checks.filter((c) => c.pass).length / checks.length, parsed: output };
}

export const plugin: WorkloadPlugin = {
  buildPrompt,
  runChecks,
  rubrics: { 'my-answer': '5 = correct, clear and useful. 1 = wrong or unusable.' },
  judgeSystem: "You are grading an AI assistant's answer. Be strict and fair.",
};
