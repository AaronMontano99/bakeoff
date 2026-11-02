import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REGISTERED_META } from '@/core/workload/registry-meta.generated';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !e.name.includes('.generated.') ? [full] : [];
  });
}

/** The engine and the screens work with any project, so none may be named outside workloads/. */
describe('no project is hard-coded', () => {
  const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = REGISTERED_META.flatMap((m) => [m.id, m.short]).map(escape);
  // Job ids can be ordinary words ("email"), so only a quoted id or a property access counts.
  const jobs = REGISTERED_META.flatMap((m) => m.jobs.map((j) => j.type)).map(escape);
  const pattern = new RegExp(`(?<![\\w-])(${names.join('|')})(?![\\w-])|['"\`](${jobs.join('|')})['"\`]|byType\\.(${jobs.join('|')})\\b`, 'i');

  it('keeps every project and job name out of src/', () => {
    const hits = sourceFiles(path.join(process.cwd(), 'src')).flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (pattern.test(line) ? [`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim().slice(0, 100)}`] : []))
    );
    expect(hits).toEqual([]);
  });

  it('gives every job a unique id that belongs to its project', () => {
    const jobs = REGISTERED_META.flatMap((m) => m.jobs.map((j) => ({ ...j, owner: m.id })));
    expect(new Set(jobs.map((j) => j.type)).size).toBe(jobs.length);
    expect(jobs.filter((j) => j.workload !== j.owner)).toEqual([]);
  });
});
