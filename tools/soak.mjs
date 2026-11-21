import { Simulation } from '../src/simulation.js';
import { performance } from 'node:perf_hooks';
const args = process.argv.slice(2);
const seconds = Number(args.find(x => x.startsWith('--seconds='))?.split('=')[1] || 600);
const seeds = (args.find(x => x.startsWith('--seeds='))?.split('=')[1] || '1,42,1337').split(',').map(Number);
for (const seed of seeds) {
  const sim = new Simulation({ seed });
  const begin = performance.now();
  let checks = 0;
  for (let i = 0; i < seconds * 30; i++) {
    sim.step();
    if (i % 300 === 0) {
      const errors = sim.inspect();
      if (errors.length) throw new Error(`Seed ${seed} at ${sim.time}: ${errors.join('\n')}`);
      checks++;
    }
  }
  const result = { ...sim.snapshot(), invariantChecks: checks, wallMs: Math.round(performance.now() - begin) };
  console.log(JSON.stringify(result));
  if (!result.chamberReady || !result.queenAlive || !result.workers || result.metrics.births < 1) process.exitCode = 1;
}
