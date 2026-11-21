// This is a mechanism-testing framework, not a claim of fitted empirical validation.
import { Simulation } from '../src/simulation.js';
import { DAY } from '../src/species.js';
import { OPEN, ROCK } from '../src/navigation.js';
import { mkdir, writeFile } from 'node:fs/promises';
const seeds = [1, 7, 42, 1337, 2026];
function run(s, seconds) {
  for (let i = 0; i < seconds; i++) s.step();
  const errors = s.inspect();
  if (errors.length) throw Error(errors.join('\n'));
  return s;
}
function summarize(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length,
    sd = Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length - 1),
    );
  return { n: values.length, mean, sd, min: Math.min(...values), max: Math.max(...values) };
}
function result(id, name, runs, measure, expected) {
  const values = runs.map(measure);
  return {
    id,
    name,
    runs,
    summary: summarize(values),
    expected,
    empiricalFit: 'not evaluated; no fabricated observational sample',
  };
}
const results = [];
// A: Hidden sources can only be discovered through movement. B/C: paired ablations.
for (const [id, name] of [
  ['A', 'Undiscovered food'],
  ['B', 'Quality and crowding'],
  ['C', 'Trail and memory ablation'],
]) {
  const runs = [];
  for (const seed of seeds) {
    if (id === 'A') {
      const s = run(new Simulation({ seed }), 3600);
      runs.push({
        seed,
        gathered: s.metrics.gathered,
        visits: s.metrics.discovered,
        firstHourBirths: s.metrics.births,
      });
    }
    if (id === 'B') {
      for (const quality of [1, 1.43]) {
        const s = new Simulation({ seed, resources: false, workers: 24 });
        // Constrained corridor, unknown resources at opposite ends. Geometry is an assay boundary.
        const w = s.world,
          y = w.surface - 1,
          x = Math.floor(w.width / 2);
        for (let row = 1; row < w.surface - 1; row++)
          for (let col = 1; col < w.width - 1; col++) w.grid[w.index(col, row)] = ROCK;
        s.addFood(w.index(x - 8, y), 6000, 0, 1);
        s.addFood(w.index(x + 8, y), 6000, 0, quality);
        run(s, 3600);
        runs.push({
          seed,
          quality,
          left: 6000 - w.food[w.index(x - 8, y)],
          right: 6000 - w.food[w.index(x + 8, y)],
          depositions: s.metrics.depositions,
          contacts: s.metrics.contacts,
        });
      }
    }
    if (id === 'C') {
      for (const mode of ['intact', 'erased', 'no-memory', 'neither']) {
        const s = new Simulation({
          seed,
          parameters: { memoryEnabled: !['no-memory', 'neither'].includes(mode) },
        });
        run(s, 1800);
        const before = s.metrics.gathered;
        for (let t = 0; t < 1800; t++) {
          if (['erased', 'neither'].includes(mode)) s.eraseTrails();
          s.step();
        }
        if (s.inspect().length) throw Error(s.inspect());
        runs.push({
          seed,
          mode,
          gatheredAfter: s.metrics.gathered - before,
          memoryWorkers: s.livingWorkers().filter((a) => a.memory.length).length,
        });
      }
    }
  }
  results.push(
    result(
      id,
      name,
      runs,
      (r) => r.gathered ?? r.right ?? r.gatheredAfter,
      'Positive discovery; quality response and memory/trail effects must be measured, not assumed.',
    ),
  );
}
// D/E/F: contact-based biological perturbations (not population-level empirical replicas).
{
  const runs = [];
  for (const seed of seeds) {
    const s = new Simulation({ seed, resources: false });
    const a = s.livingWorkers()[0],
      b = s.layEgg();
    b.stage = 'larva';
    s.spatial = new Map([[s.cell(a), [a]]]);
    s.updateWorker(a, 1);
    const local = a.behaviour;
    b.cell = s.world.index(3, 3);
    s.updateWorker(a, 1);
    runs.push({
      seed,
      contactNursing: Number(local === 'nurse'),
      distantBroodSensed: s.sense(a).brood.length,
    });
  }
  results.push(
    result(
      'D',
      'Local brood demand',
      runs,
      (r) => r.contactNursing,
      'Nursing responds at contact, distant brood cannot be sensed.',
    ),
  );
}
{
  const runs = [];
  for (const seed of seeds) {
    const s = run(new Simulation({ seed }), 3600);
    const l = s.snapshot().ledger;
    runs.push({
      seed,
      exchanges: s.metrics.contacts,
      ledgerErrorC: l.inputs.c - l.outputs.c - l.inventory.c,
      ledgerErrorP: l.inputs.p - l.inventory.p,
      observedEdges: s.interactions.length,
    });
  }
  results.push(
    result(
      'E',
      'Spatial food distribution',
      runs,
      (r) => Math.abs(r.ledgerErrorC),
      'Balanced ledgers and logged contact edges; network statistics not fitted.',
    ),
  );
}
{
  const runs = [];
  for (const temperatureC of [10, 20, 23, 27])
    for (const seed of seeds) {
      const s = new Simulation({
        seed,
        parameters: { temperatureC },
        resources: false,
        laying: false,
      });
      const b = s.layEgg();
      // Isolated development assay deliberately bypasses movement, but invokes the same stage model.
      s.updateBrood(10 * DAY);
      runs.push({ seed, temperatureC, eggProgressDays: b.stageAge / DAY, stage: b.stage });
    }
  results.push(
    result(
      'F',
      'Brood thermal sensitivity',
      runs,
      (r) => r.eggProgressDays,
      'Cold exposure stalls the provisional development model; nursing/transport tested separately.',
    ),
  );
}
{
  const runs = [];
  for (const seed of seeds)
    for (const soilHardness of [0.5, 2]) {
      const s = run(
        new Simulation({ seed, parameters: { soilHardness, diggingSeconds: 120 } }),
        7200,
      );
      runs.push({
        seed,
        soilHardness,
        ...s.snapshot().architecture,
        soilError: s.inspect().length,
      });
    }
  results.push(
    result(
      'G',
      'Local excavation sensitivity',
      runs,
      (r) => r.excavatedCells,
      'Harder soil should reduce removal. 2D morphology is not validated against 3D nests.',
    ),
  );
}
{
  const runs = [];
  for (const seed of seeds) {
    const s = run(new Simulation({ seed }), 1800);
    const victims = s
      .livingWorkers()
      .filter((a) => a.behaviour === 'forage' || a.behaviour === 'return');
    for (const a of victims) s.kill(a);
    const before = s.metrics.gathered;
    run(s, 3600);
    runs.push({
      seed,
      removed: victims.length,
      newGathered: s.metrics.gathered - before,
      remaining: s.livingWorkers().length,
    });
  }
  results.push(
    result(
      'H',
      'Forager removal',
      runs,
      (r) => r.newGathered,
      'Surviving workers can discover food without reassigned quotas; recovery magnitude is uncalibrated.',
    ),
  );
}
{
  const runs = [];
  for (const seed of seeds) {
    const s = new Simulation({ seed, resources: false });
    // Full spatial simulation after a physiology-only starvation preconditioning assay.
    s.time = 2 * DAY;
    for (let h = 0; h < 48; h++) s.physiology(3600);
    const before = s.livingWorkers().length;
    s.addFood(s.world.chamber, 2000, 500);
    run(s, 3600);
    runs.push({
      seed,
      survivorsBefore: before,
      survivorsAfter: s.livingWorkers().length,
      gathered: s.metrics.gathered,
    });
  }
  results.push(
    result(
      'I',
      'Starvation and refeeding',
      runs,
      (r) => r.gathered,
      'Only physically accessible added food is consumed; dead workers never revive.',
    ),
  );
}
{
  const runs = [];
  for (const seed of seeds) {
    const s = new Simulation({ seed, scenario: 'founding', resources: false, laying: true });
    // Multirate lifecycle assay: no movement during sealed founding; hour physiology resolution.
    for (let h = 0; h < 70 * 24; h++) {
      s.time += 3600;
      s.physiology(3600);
      if (s.inspect().length) throw Error(s.inspect());
    }
    runs.push({
      seed,
      days: s.time / DAY,
      births: s.metrics.births,
      workers: s.livingWorkers().length,
      queenAlive: s.queen.alive,
      ledger: s.snapshot().ledger,
      scope: 'physiology-only founding; no worker foraging or contacts after emergence',
    });
  }
  results.push(
    result(
      'J',
      'Extended lifecycle subsystem',
      runs,
      (r) => r.births,
      'Weeks-long reserve-funded development and conservative biomass inheritance; full spatial lifecycle remains unvalidated.',
    ),
  );
}
// Controlled navigation assay: trail-coated substrate and observed training walks are
// experimental boundary conditions, not information available to uninformed ants.
{
  const runs = [];
  for (const seed of seeds)
    for (const marked of [false, true]) {
      const s = new Simulation({ seed, workers: 1, resources: false, laying: false }),
        w = s.world,
        a = s.livingWorkers()[0],
        start = w.chamber;
      w.grid.fill(ROCK);
      const corridor = Array.from({ length: 21 }, (_, j) => start + j);
      for (const i of [...corridor, start - 1]) w.grid[i] = OPEN;
      if (marked) for (const i of corridor) w.trail[i] = 0.5;
      s.spatial = new Map([[start, [a, s.queen]]]);
      a.heading = null;
      let right = 0;
      for (let i = 0; i < 1000; i++) {
        const cues = s.sense(a);
        if (s.chooseMove(a, cues) === start + 1) right++;
      }
      // Training consists of traversing each cell; memory is copied from that personal walk.
      for (const i of corridor.slice(1)) s.moveTo(a, i);
      a.memory = [...a.walk];
      for (const i of corridor.slice(0, -1).reverse()) s.moveTo(a, i);
      a.thresholds.forage = 0;
      a.thresholds.dig = 1;
      a.moveBudget = 0;
      let seconds = 0;
      while (s.cell(a) !== corridor.at(-1) && seconds < 200) {
        s.step();
        seconds++;
      }
      runs.push({
        seed,
        marked,
        naiveMarkedBranchChoices: right,
        trials: 1000,
        experiencedSeconds: seconds,
        reached: s.cell(a) === corridor.at(-1),
      });
    }
  results.push(
    result(
      'C-controlled',
      'Naive branch choice and experienced route latency',
      runs,
      (r) => r.experiencedSeconds,
      'Surface cues bias naive branch choice; experienced ants retain personal routes when cues are erased. Faster travel with both inputs is model-encoded, not independently validated.',
    ),
  );
}
// Paired ablation contrasts are descriptive, not significance claims.
const c = results.find((r) => r.id === 'C').runs;
const contrasts = {};
for (const mode of ['erased', 'no-memory', 'neither'])
  contrasts[mode] = summarize(
    seeds.map(
      (seed) =>
        c.find((r) => r.seed === seed && r.mode === 'intact').gatheredAfter -
        c.find((r) => r.seed === seed && r.mode === mode).gatheredAfter,
    ),
  );
const assessments = {
  A: 'observed: local exploration collects food; one-hour brood emergence correctly absent',
  B: 'unvalidated: quality changes marking by construction; consistent colony-level preference not established',
  C: 'inconclusive: satiation limits post-disruption harvest and obscures ablation effects',
  D: 'mechanism observed: nursing requires local brood contact; no empirical task-distribution fit',
  E: 'mechanism observed: physical exchange edges and conservative nutrient accounting',
  F: 'encoded sensitivity observed: provisional temperature response; empirical curve not fitted',
  G: 'unvalidated: harder soil slows local work by construction, but colony-wide excavation is not reliably monotone',
  H: 'unvalidated: removal and subsequent harvesting measured; no empirical recovery criterion',
  I: 'mechanism observed: accessible provisioning supports surviving agents; no resurrection',
  J: 'subsystem only: reserve-funded development over weeks; spatial worker feeding absent',
  'C-controlled':
    'mechanism observed: naive local trail bias and retained personal routes; speed synergy is encoded, not independently predicted',
};
for (const r of results) r.assessment = assessments[r.id];
const grouping = {
  B: ['quality', 'right'],
  C: ['mode', 'gatheredAfter'],
  F: ['temperatureC', 'eggProgressDays'],
  G: ['soilHardness', 'excavatedCells'],
  'C-controlled': ['marked', 'experiencedSeconds'],
};
for (const r of results) {
  const spec = grouping[r.id];
  if (!spec) continue;
  const [key, metric] = spec;
  r.conditionSummaries = {};
  for (const value of new Set(r.runs.map((run) => run[key])))
    r.conditionSummaries[String(value)] = summarize(
      r.runs.filter((run) => run[key] === value).map((run) => run[metric]),
    );
}
const report = {
  modelVersion: 3,
  seeds,
  units: { time: 'biological seconds', food: 'µg substrate equivalent' },
  results,
  pairedIntactMinusAblation: contrasts,
  status:
    'Exploratory mechanism tests. Descriptive means and sample SD across seeds, no fitted empirical validation.',
  limitations: [
    'Ablation is not an exact replication of a published assay.',
    'J omits spatial interactions and uses an hour physiology step; it is not a 70-day whole-colony validation.',
  ],
};
await mkdir('docs/validation', { recursive: true });
await writeFile('docs/validation/experiments.json', JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    { experiments: results.map((r) => ({ id: r.id, ...r.summary })), contrasts },
    null,
    2,
  ),
);
