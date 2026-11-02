import type { WorkloadMeta } from '@/core/workload/types';

/**
 * Copy this folder to workloads/<your-project>/ and set `id` to that folder
 * name. Everything on the screen about your project comes from here.
 */
export const meta: WorkloadMeta = {
  id: 'my-project',
  name: 'My project · what it does',
  short: 'My project',
  description: 'The AI jobs in my project.',
  unit: 'user',
  defaultUnits: 100,
  defaultDays: 30,
  about: 'What the app is and what its AI does.',
  sharedPrompt: {
    button: 'Read the shared prompt',
    title: 'Shared system prompt',
    note: 'Sent first on every request, so it is what prompt caching can reuse.',
  },
  taskSubtitle: (task) => String(task.input?.question ?? ''),
  jobs: [
    {
      type: 'my-answer',
      workload: 'my-project',
      short: 'Answer',
      label: 'Answer a question',
      blurb: 'What goes in and what comes out.',
      profile: 'Short in, medium out. The user is waiting on it.',
      defaultSloMs: 5_000,
      defaultPerRepPerDay: 3,
      maxTokens: 500,
      output: 'text',
    },
  ],
};
