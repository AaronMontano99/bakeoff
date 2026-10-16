import type { Metadata } from 'next';
import { PageHeader } from '@/components/page';

export const metadata: Metadata = { title: 'Method' };

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'The workload',
    body: (
      <>
        <p>
          Scout is a prospecting tool used daily in a full-cycle B2B sales job. Its AI work splits into four jobs with very different traffic shapes: a short <b>signal check</b> run on every account,
          a <b>call debrief</b> after every dial, a <b>cold email</b>, and a long <b>call card</b> before a call block. Bakeoff rebuilds those jobs on 24 fictional Bay Area accounts so no customer data
          is sent anywhere. Every request carries the same long rep playbook first, as Scout does, which makes it a realistic prompt-caching test.
        </p>
      </>
    ),
  },
  {
    title: 'What gets measured',
    body: (
      <ul>
        <li><b>Time to first token (TTFT):</b> wall clock from sending the request to the first visible text token, timed in this process from the stream. Reasoning models spend part of this thinking.</li>
        <li><b>Total time:</b> request start to the last token. p50 and p95 use linear interpolation.</li>
        <li><b>Output tokens per second:</b> output tokens divided by the time after the first token.</li>
        <li><b>Cold start:</b> each target gets one warm-up request first (model load, TLS, CLI start). It’s reported separately and left out of the stats.</li>
        <li><b>Under load:</b> for each concurrency level, a fixed batch runs with that many requests in flight, one target at a time. Throughput is completed requests (and output tokens) over the level’s wall time.</li>
      </ul>
    ),
  },
  {
    title: 'How quality is scored',
    body: (
      <>
        <ul>
          <li><b>Deterministic checks</b> grade what a script can: valid JSON, the output contract, ground-truth labels (signal status, debrief outcome, meeting flags), and the playbook’s mechanical rules (word counts, no em dashes, banned phrases, one ask, callback number).</li>
          <li><b>An LLM judge</b> grades each output 1-5 against a rubric written per job, using the same playbook the candidate saw.</li>
          <li><b>Composite quality</b> = half the check pass rate, half the judge score rescaled to 0-1, multiplied by the success rate, so a model that errors doesn’t look good on the requests it finished.</li>
          <li><b>Calibration:</b> grade outputs yourself in the Outputs tab and Bakeoff reports exact agreement, within-one agreement, rank correlation and bias between you and the judge.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'How cost is computed',
    body: (
      <ul>
        <li><b>Serverless:</b> tokens from the provider’s own usage report × the per-million price in <code>config/targets.json</code>. Cache reads and writes are priced separately when the provider has caching.</li>
        <li><b>Local:</b> $0 marginal. The real cost is hardware and the throughput ceiling, which the load test shows.</li>
        <li><b>Claude Code (subscription):</b> the plan covers it; Bakeoff shows the API-equivalent cost the CLI reports so it can be compared.</li>
        <li><b>Dedicated:</b> GPU-hour price × 730 hours, with replicas sized from the load test’s measured throughput at 60% utilization.</li>
        <li>A missing price stays missing. The report asks for it instead of guessing.</li>
      </ul>
    ),
  },
  {
    title: 'The business case',
    body: (
      <p>
        Monthly volume per job comes from reps × workdays × requests per rep per day (editable). For each job, Bakeoff routes to the cheapest target that clears the quality bar, stays under the p95
        budget and succeeds at least 95% of the time. It compares that against running everything on the single best-scoring priced model. The point is the shape of the answer: different jobs
        want different models, and the right model for a job a rep runs on every account is rarely the one you’d pick for the hardest job.
      </p>
    ),
  },
  {
    title: 'What this does not prove',
    body: (
      <ul>
        <li>One laptop, one network, one time of day. Hosted latency moves with region, load and model version; rerun before relying on a number.</li>
        <li>24 tasks is enough to see large differences, not small ones. Use repeats for variance and treat a few points of quality as noise.</li>
        <li>A Claude judge grading Claude outputs can prefer its own family. Calibrate it against your own grades.</li>
        <li>Claude Code timings include starting a CLI process per request and are not API latency.</li>
        <li>Prices are list prices on the date in the config, not negotiated rates.</li>
      </ul>
    ),
  },
];

export default function MethodPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-8">
      <PageHeader eyebrow="Method" title="How the numbers are made" description="Everything Bakeoff measures, how, and where it stops being trustworthy." />
      <div className="space-y-4">
        {SECTIONS.map((s, i) => (
          <section key={s.title} className="rounded-2xl border border-line bg-paper p-6 shadow-card">
            <div className="flex items-center gap-3">
              <span className="tabular grid size-6 place-items-center rounded-full bg-sage-100 text-[12px] font-semibold text-forest-700">{i + 1}</span>
              <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{s.title}</h2>
            </div>
            <div className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-2 [&_code]:rounded [&_code]:bg-mist [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12.5px] [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:top-[9px] [&_li]:before:left-0 [&_li]:before:size-1.5 [&_li]:before:rounded-full [&_li]:before:bg-forest-400 [&_ul]:space-y-2">
              {s.body}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
