// Execution-host profile only; no inference about biological or mobile scaling.
import { Simulation } from '../src/simulation.js';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
const results = [];
for (const workers of [12, 100, 500]) {
  const sim = new Simulation({ seed: 42, workers }),
    samples = [],
    start = performance.now();
  for (let tick = 0; tick < 900; tick++) {
    const begin = performance.now();
    sim.step();
    samples.push(performance.now() - begin);
  }
  const errors = sim.inspect();
  if (errors.length) throw Error(errors.join('\n'));
  samples.sort((a, b) => a - b);
  results.push({
    workers,
    biologicalSeconds: 900,
    wallMs: performance.now() - start,
    p50StepMs: samples[Math.floor(samples.length * 0.5)],
    p95StepMs: samples[Math.floor(samples.length * 0.95)],
    p99StepMs: samples[Math.floor(samples.length * 0.99)],
    checks: errors,
  });
}
const report = {
  runtime: process.version,
  platform: process.platform,
  status:
    'Short execution-host profile, without rendering. Synthetic larger initial cohorts are performance tests, not validated mature colonies.',
  results,
};
await mkdir('docs/validation', { recursive: true });
await writeFile('docs/validation/performance.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
