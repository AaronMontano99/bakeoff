/**
 * The public demo: real results from past runs, loaded into memory, with
 * nothing to run and nothing to save. Off unless this is set.
 */
export const DEMO = process.env.NEXT_PUBLIC_BAKEOFF_DEMO === '1';

export const DEMO_MESSAGE = 'This is a demo of real past results, so starting runs and saving are turned off.';
