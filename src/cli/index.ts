import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { businessCase, defaultCaseInputs, loadCurve, summarize } from '@/core/analysis';
import { getRun, listResults, listRuns, setJudgement } from '@/core/db';
import { decide, defaultPolicy, type Decision } from '@/core/decide';
import { judge } from '@/core/evals/judge';
import { callTarget, checkTarget } from '@/core/providers';
import { planRun, runAndWait } from '@/core/runner';
import { loadTargets } from '@/core/targets';
import type { RunConfig, TaskType, WorkloadId } from '@/core/types';
import { buildPrompt, DEFAULT_WORKLOAD, jobsOf, loadWorkload, workloadCommands, jobInfo, TASK_TYPES, WORKLOAD_ORDER, workloadMeta } from '@/core/workload';
import { sloName } from '@/core/workload/meta';

for (const f of ['.env.local', '.env']) if (fs.existsSync(f)) process.loadEnvFile(f);

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const sec = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`);
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}`);
const money = (v: number | null) => (v == null ? '—' : v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(5)}` : `$${v.toFixed(4)}`);

function table(rows: string[][]) {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => strip(r[i] ?? '').length)));
  for (const [n, r] of rows.entries()) {
    console.log(r.map((c, i) => c + ' '.repeat(widths[i]! - strip(c).length)).join('  '));
    if (n === 0) console.log(dim(widths.map((w) => '─'.repeat(w)).join('  ')));
  }
}

const commandHelp = Object.entries(workloadCommands())
  .map(([name, c]) => `  npm run bakeoff -- ${name.padEnd(24)} ${c.help}\n`)
  .join('');

const HELP = `${bold('bakeoff')}: inference bake-off on any app's AI jobs

  npm run bakeoff -- targets                 Which targets are ready to run
  npm run bakeoff -- run [options]           Run a benchmark (live progress in the terminal and the dashboard)
  npm run bakeoff -- report [run-id]         Summary + business case for a run (default: latest)
  npm run bakeoff -- runs                    List past runs
  npm run bakeoff -- judge [run-id]          Judge a run's unjudged answers afterwards (--judge id), so judging
                                             never competes with local models for the CPU while they're timed
${commandHelp}  npm run bakeoff -- decide [run-id]         Pick a model per job on dev tasks, then test the picks on holdout
                                             (--bar 0.8 --margin 0.05; writes data/reports/decision-<run>.md)

run options:
  --workload id        ${WORKLOAD_ORDER.join(', ')} (default ${DEFAULT_WORKLOAD})
  --targets a,b        Target ids (default: every ready target)
  --types t1,t2        Jobs to run (default: all of the workload's)
                       ${WORKLOAD_ORDER.map((w) => `${w}: ${jobsOf(w).join(',')}`).join(' · ')}
  --per-type N         Tasks per type (default 3)
  --repeats N          Repeats per task (default 1)
  --concurrency 1,4    Load-test levels (default: none)
  --load-requests N    Requests per load level (default 8)
  --judge id           Judge target (default claude-cli-haiku); --no-judge to skip
  --sequential         One target at a time (cleanest local timing)
  --name "..."         Run name`;

async function cmdTargets() {
  const targets = loadTargets();
  const statuses = await Promise.all(targets.map(checkTarget));
  table([
    ['', 'id', 'vendor', 'model', 'deployment', 'status'],
    ...targets.map((t, i) => {
      const s = statuses[i]!;
      const dot = s.state === 'ready' ? green('●') : s.state === 'disabled' ? dim('○') : red('●');
      return [dot, t.id, t.vendor, t.model, t.deployment, s.state === 'ready' ? green(s.detail ?? 'ready') : dim(s.detail)];
    }),
  ]);
}

async function cmdRun(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      workload: { type: 'string', default: DEFAULT_WORKLOAD },
      targets: { type: 'string' },
      types: { type: 'string' },
      'per-type': { type: 'string', default: '3' },
      repeats: { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '' },
      'load-requests': { type: 'string', default: '8' },
      judge: { type: 'string', default: 'claude-cli-haiku' },
      'no-judge': { type: 'boolean', default: false },
      sequential: { type: 'boolean', default: false },
      name: { type: 'string' },
    },
  });
  const workload = values.workload as WorkloadId;
  if (!WORKLOAD_ORDER.includes(workload)) throw new Error(`Unknown workload "${values.workload}". Use one of: ${WORKLOAD_ORDER.join(', ')}`);
  const types = (values.types?.split(',').map((t) => t.trim()) as TaskType[] | undefined) ?? jobsOf(workload);
  const wrong = types.filter((t) => !jobsOf(workload).includes(t));
  if (wrong.length) throw new Error(`${wrong.join(', ')} ${wrong.length > 1 ? 'are not jobs' : 'is not a job'} in ${workload}. Its jobs: ${jobsOf(workload).join(', ')}`);
  const targets = loadTargets();
  let targetIds = values.targets?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!targetIds) {
    const st = await Promise.all(targets.map(checkTarget));
    targetIds = targets.filter((_, i) => st[i]!.state === 'ready').map((t) => t.id);
  }
  if (!targetIds.length) throw new Error('No ready targets. Run `npm run bakeoff -- targets` to see why.');
  const config: RunConfig = {
    name: values.name ?? `CLI run · ${workloadMeta(workload).short} · ${targetIds.length} targets`,
    workload,
    targetIds,
    taskTypes: types,
    tasksPerType: Number(values['per-type']),
    repeats: Number(values.repeats),
    concurrency: values.concurrency ? values.concurrency.split(',').map(Number).filter((n) => n > 0) : [],
    loadRequests: Number(values['load-requests']),
    parallelTargets: !values.sequential,
    judge: { enabled: !values['no-judge'], targetId: values.judge! },
  };
  const plan = planRun(config);
  console.log(`${bold(config.name)}  ${dim(`${plan.warmup.length} warm-up + ${plan.quality.length} quality + ${plan.load.length} load requests`)}`);
  const id = await runAndWait(config, (e) => {
    if (e.kind === 'done') {
      const r = e.result;
      const mark = r.ok ? green('✓') : red('✗');
      const extra = r.ok ? `${sec(r.ttftMs)} ttft · ${sec(r.totalMs)} total · checks ${pct(r.checkScore)}` : red(r.error ?? 'failed');
      console.log(`${mark} ${r.targetId.padEnd(28)} ${r.phase === 'load' ? dim(`c=${r.concurrency}`) : r.phase === 'warmup' ? dim('warm') : '    '} ${r.taskId.padEnd(30)} ${extra}`);
    } else if (e.kind === 'status' && e.detail) console.log(dim(e.detail));
    else if (e.kind === 'status' && e.status === 'judging') console.log(dim('Judging the remaining outputs…'));
  });
  console.log(`\n${green('Done.')} Run id ${bold(id)}. Open http://localhost:3100/runs/${id} or run: npm run bakeoff -- report ${id}\n`);
  report(id);
}

function report(runId?: string) {
  const run = runId ? getRun(runId) : listRuns()[0];
  if (!run) throw new Error(runId ? `No run ${runId}` : 'No runs yet.');
  const results = listResults(run.id);
  const targets = loadTargets();
  const sums = summarize(results, run.config.targetIds);
  console.log(bold(`\n${run.name}`) + dim(`  ${run.id} · ${run.status}`));
  table([
    ['target', 'ok', 'ttft p50', 'ttft p95', 'total p95', 'tok/s', 'checks', 'judge', 'quality', '$/req', 'cache'],
    ...sums.map((s) => [
      targets.find((t) => t.id === s.targetId)?.label ?? s.targetId,
      pct(s.okRate) + '%',
      sec(s.ttftP50),
      sec(s.ttftP95),
      sec(s.totalP95),
      s.tokensPerSec == null ? '—' : s.tokensPerSec.toFixed(0),
      pct(s.checkScore),
      s.judgeScore == null ? '—' : s.judgeScore.toFixed(1),
      bold(pct(s.quality)),
      money(s.costPerRequest),
      s.cacheHitRate == null ? '—' : pct(s.cacheHitRate) + '%',
    ]),
  ]);
  const load = loadCurve(results);
  if (load.length) {
    console.log(bold('\nUnder load'));
    table([
      ['target', 'concurrency', 'p50', 'p95', 'req/s', 'out tok/s', 'errors'],
      ...load.map((l) => [l.targetId, String(l.concurrency), sec(l.totalP50), sec(l.totalP95), l.requestsPerSec?.toFixed(2) ?? '—', l.outputTokensPerSec?.toFixed(0) ?? '—', pct(l.errorRate) + '%']),
    ]);
  }
  const wm = workloadMeta(run.config.workload);
  const inputs = defaultCaseInputs(run.config.workload);
  const bc = businessCase(sums, targets, inputs);
  console.log(bold('\nBusiness case') + dim(` (${inputs.reps.toLocaleString('en-US')} ${wm.unit}s, ${inputs.workdays} days a month, default budgets)`));
  console.log(bc.headline);
  for (const l of bc.lines) console.log(`  • ${l}`);
  for (const g of bc.gaps) console.log(dim(`  ! ${g.message}`));
  console.log();
}

async function cmdJudge(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { judge: { type: 'string', default: 'claude-cli-haiku' } } });
  const run = positionals[0] ? getRun(positionals[0]) : listRuns()[0];
  if (!run) throw new Error('No run found.');
  const judgeTarget = loadTargets().find((t) => t.id === values.judge);
  if (!judgeTarget) throw new Error(`No target ${values.judge}`);
  const workload = loadWorkload(run.config.workload);
  const todo = listResults(run.id).filter((r) => r.phase === 'quality' && r.ok && r.judgeScore == null);
  console.log(`${bold(run.name)}  ${dim(`${todo.length} answers to judge with ${judgeTarget.label}`)}`);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const r = todo[next++]!;
      const task = workload.tasks.find((t) => t.id === r.taskId);
      if (!task) continue;
      try {
        const j = await judge(task, r.output ?? '', workload, judgeTarget);
        setJudgement(r.id, j.score, j.rationale);
        console.log(`${green('✓')} ${r.targetId.padEnd(28)} ${r.taskId.padEnd(22)} ${j.score}/5 ${dim(j.rationale.slice(0, 90))}`);
      } catch (e) {
        setJudgement(r.id, null, `Judge failed: ${(e as Error).message}`);
        console.log(`${red('✗')} ${r.targetId.padEnd(28)} ${r.taskId.padEnd(22)} ${red((e as Error).message.slice(0, 90))}`);
      }
    }
  };
  // Two at a time, the same as judging during a run.
  await Promise.all([worker(), worker()]);
  report(run.id);
}

function cmdDecide(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { bar: { type: 'string' }, margin: { type: 'string' } },
  });
  const run = positionals[0] ? getRun(positionals[0]) : listRuns()[0];
  if (!run) throw new Error('No run found.');
  const policy = defaultPolicy();
  if (values.bar) policy.qualityBar = Number(values.bar);
  if (values.margin) policy.margin = Number(values.margin);
  const targets = loadTargets();
  const d = decide(listResults(run.id), loadWorkload(run.config.workload).tasks, targets, policy);
  const md = decisionMarkdown(run.id, run.name, d, (id) => targets.find((t) => t.id === id)?.label ?? id);
  fs.mkdirSync('data/reports', { recursive: true });
  const file = `data/reports/decision-${run.id}.md`;
  fs.writeFileSync(file, md);
  console.log(md);
  console.log(dim(`Written to ${file}`));
}

export function decisionMarkdown(runId: string, runName: string, d: Decision, label: (id: string) => string): string {
  const p = (v: number | null) => (v == null ? 'n/a' : String(Math.round(v * 100)));
  const s = (v: number | null) => (v == null ? 'n/a' : `${(v / 1000).toFixed(1)}s`);
  const verdictLine = {
    pass: 'PASS: routing is cheaper and a quality loss bigger than the margin is ruled out on unseen tasks.',
    fail: 'FAIL: the routing policy did not prove itself on unseen tasks.',
    'no-change': 'NO CHANGE: the best single model is also the right pick for every job.',
    'not-enough-data': 'NOT ENOUGH DATA to make or check a decision.',
  }[d.verdict];
  const out: string[] = [
    `# Decision: ${runName}`,
    '',
    `Run \`${runId}\` · decision fingerprint \`${d.fingerprint}\` · ${d.devTasks} dev tasks, ${d.holdoutTasks} holdout tasks`,
    '',
    `Constraints: quality bar ${p(d.policy.qualityBar)}, latency budgets ${d.jobs.map((j) => `${jobInfo(j.taskType).short} ${sloName(j.taskType)} ${s(d.policy.sloMs[j.taskType]!)}`).join(', ')}, at least ${p(d.policy.minOkRate)}% of requests succeed, non-inferiority margin ${p(d.policy.margin)} points, ${p(d.policy.confidence)}% bootstrap intervals over tasks.`,
    '',
    `**${verdictLine}**`,
    '',
    ...d.reasons.map((r) => `- ${r}`),
    '',
    '## Step 1: picks made on dev tasks only',
    '',
    `Baseline ("one model for everything"): ${d.baselineTargetId ? label(d.baselineTargetId) : 'none'}`,
    '',
    '| Job | Model | Quality (interval) | Checks only | p95 | $/req | Status |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const j of d.jobs) {
    for (const c of j.candidates) {
      const picked = j.pick?.targetId === c.targetId;
      out.push(
        `| ${jobInfo(j.taskType).label} | ${picked ? '**' + label(c.targetId) + '** (pick)' : label(c.targetId)} | ${p(c.quality)} (${p(c.qualityLow)} to ${p(c.qualityHigh)}) | ${p(c.checksOnly)} | ${s(c.p95)} | ${c.costPerRequest == null ? 'n/a' : '$' + c.costPerRequest.toFixed(5)} | ${c.confidence}${c.why.length ? ': ' + c.why.join('; ') : ''} |`
      );
    }
    if (!j.pick) out.push(`| ${jobInfo(j.taskType).label} | *no pick* | | | | | nothing cleared every constraint |`);
  }
  if (d.holdout.length) {
    out.push('', '## Step 2: the frozen picks on holdout tasks', '', '| Job | Pick: quality / checks / p95 | Baseline: quality / checks / p95 | Held? |', '|---|---|---|---|');
    for (const h of d.holdout) {
      out.push(
        `| ${jobInfo(h.taskType).label} | ${label(h.pick.targetId)}: ${p(h.pick.quality)} / ${p(h.pick.checksOnly)} / ${s(h.pick.p95)} | ${label(h.baseline.targetId)}: ${p(h.baseline.quality)} / ${p(h.baseline.checksOnly)} / ${s(h.baseline.p95)} | ${h.held ? 'yes' : 'no: ' + h.why.join(', ')} |`
      );
    }
    if (d.routedMonthly != null && d.baselineMonthly != null) {
      out.push('', `Monthly cost over the routed jobs (10 reps, 21 workdays): $${d.routedMonthly.toFixed(2)} routed vs $${d.baselineMonthly.toFixed(2)} baseline${d.savingsPct != null ? ` (${Math.round(d.savingsPct * 100)}% ${d.savingsPct >= 0 ? 'less' : 'more'})` : ''}.`);
    }
  }
  out.push(
    '',
    '## How to read this',
    '',
    '- Picks are made on dev tasks and frozen before holdout is scored. If the fingerprint changes between reports, the decision changed.',
    '- "Confident" means the low end of the interval clears the bar, not just the average. "Tentative" picks are allowed but flagged.',
    '- The composite quality uses an LLM judge. The checks-only row is the part no model graded; the verdict needs both.',
    '- Holdout tasks are fictional and were written before any model answered them. Never tune prompts or checks on them.',
    ''
  );
  return out.join('\n');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'targets':
      return cmdTargets();
    case 'run':
      return cmdRun(rest);
    case 'report':
      return report(rest[0]);
    case 'judge':
      return cmdJudge(rest);
    case 'decide':
      return cmdDecide(rest);
    case 'runs':
      return table([['id', 'name', 'status', 'requests'], ...listRuns().map((r) => [r.id, r.name, r.status, `${r.completed}/${r.totalPlanned}`])]);
    default:
      console.log(HELP);
  }
}

main().catch((e: Error) => {
  console.error(red(e.message));
  process.exit(1);
});
