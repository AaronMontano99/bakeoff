import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { businessCase, defaultCaseInputs, loadCurve, summarize } from '@/core/analysis';
import { getRun, listResults, listRuns } from '@/core/db';
import { checkTarget } from '@/core/providers';
import { planRun, runAndWait } from '@/core/runner';
import { loadTargets } from '@/core/targets';
import type { RunConfig, TaskType } from '@/core/types';
import { TASK_TYPE_ORDER } from '@/core/workload';

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

const HELP = `${bold('bakeoff')}: inference bake-off on the Scout SDR workload

  npm run bakeoff -- targets                 Which targets are ready to run
  npm run bakeoff -- run [options]           Run a benchmark (live progress in the terminal and the dashboard)
  npm run bakeoff -- report [run-id]         Summary + business case for a run (default: latest)
  npm run bakeoff -- runs                    List past runs

run options:
  --targets a,b        Target ids (default: every ready target)
  --types t1,t2        signal,debrief,email,callcard (default: all)
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
  const targets = loadTargets();
  let targetIds = values.targets?.split(',').map((s) => s.trim()).filter(Boolean);
  if (!targetIds) {
    const st = await Promise.all(targets.map(checkTarget));
    targetIds = targets.filter((_, i) => st[i]!.state === 'ready').map((t) => t.id);
  }
  if (!targetIds.length) throw new Error('No ready targets. Run `npm run bakeoff -- targets` to see why.');
  const config: RunConfig = {
    name: values.name ?? `CLI run · ${targetIds.length} targets`,
    targetIds,
    taskTypes: (values.types?.split(',') as TaskType[] | undefined) ?? TASK_TYPE_ORDER,
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
    ['target', 'ok', 'ttft p50', 'total p95', 'tok/s', 'checks', 'judge', 'quality', '$/req', 'cache'],
    ...sums.map((s) => [
      targets.find((t) => t.id === s.targetId)?.label ?? s.targetId,
      pct(s.okRate) + '%',
      sec(s.ttftP50),
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
  const bc = businessCase(sums, targets, defaultCaseInputs());
  console.log(bold('\nBusiness case') + dim(' (10 reps, 21 workdays, default budgets)'));
  console.log(bc.headline);
  for (const l of bc.lines) console.log(`  • ${l}`);
  for (const g of bc.gaps) console.log(dim(`  ! ${g.message}`));
  console.log();
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
