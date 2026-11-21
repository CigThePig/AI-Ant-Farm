import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { DAY, developmentRate } from '../src/species.js';
import { OPEN } from '../src/navigation.js';
import { FixedClock } from '../src/clock.js';
const run = (s, n) => {
  for (let i = 0; i < n; i++) s.step();
  return s;
};
test('seeded state, routes, resources and ledgers reproduce', () => {
  const a = run(new Simulation({ seed: 7 }), 3600),
    b = run(new Simulation({ seed: 7 }), 3600);
  assert.deepEqual(a.report(), b.report());
  assert.deepEqual(a.inspect(), []);
  assert.ok(a.metrics.gathered > 0);
  assert.ok(a.metrics.depositions > 0);
});
test('unseen resources do not enter decisions or memory', () => {
  const a = new Simulation({ seed: 1, resources: false }),
    b = new Simulation({ seed: 1, resources: false });
  b.addFood(b.world.index(3, 3), 100);
  run(a, 20);
  run(b, 20);
  assert.deepEqual(a.ants, b.ants);
  assert.ok(a.livingWorkers().every((a) => a.memory.length === 0));
});
test('no disconnected or distant trophallaxis, no food creation', () => {
  const s = new Simulation(),
    [a, b] = s.livingWorkers();
  a.crop.c = 100;
  b.crop.c = 0;
  b.x += 2;
  assert.equal(s.transferFood(a, b, 10), 0);
  b.x = a.x;
  assert.equal(s.transferFood(a, b, 10), 10);
  assert.equal(a.crop.c + b.crop.c, 100);
  s.kill(b);
  assert.equal(s.transferFood(a, b, 10), 0);
});
test('trophallaxis requires sustained encounters', () => {
  const s = new Simulation({ workers: 2, resources: false }),
    [a, b] = s.livingWorkers();
  a.crop.c = 100;
  b.crop.c = 0;
  s.queen.x += 3;
  s.spatial = new Map([[s.cell(a), [a, b]]]);
  const sense = s.sense(a);
  for (let i = 0; i < 5; i++) s.share(a, sense, 1);
  assert.equal(b.crop.c, 0);
  s.share(a, sense, 1);
  assert.ok(b.crop.c > 0);
});
test('surface trail decays in place and never diffuses', () => {
  const s = new Simulation(),
    w = s.world,
    i = w.entrance;
  w.trail[i] = 1;
  w.decay(s.p.trailHalfLifeSeconds, s.p);
  assert.equal(w.trail[i], 0.5);
  for (const n of w.adjacent(i)) assert.equal(w.trail[n], 0);
  s.eraseTrails();
  assert.equal(w.trail[i], 0);
});
test('queen-only founding funds eggs and larvae from reserves, no remote food', () => {
  const s = new Simulation({ scenario: 'founding', resources: false });
  assert.equal(s.livingWorkers().length, 0);
  const before = s.queen.reserve.p;
  const b = s.layEgg();
  assert.ok(b);
  assert.equal(s.queen.reserve.p + s.queen.crop.p + b.body.p, before + 12);
  b.stage = 'larva';
  s.feedBrood(s.queen, b, 10, true);
  assert.ok(b.body.p > 2);
  assert.deepEqual(s.inspect(), []);
});
test('brood development is measured in days, requires larval nutrition', () => {
  const s = new Simulation({ resources: false, laying: false });
  const b = s.layEgg();
  s.updateBrood(s.p.eggDays * DAY - 1);
  assert.equal(b.stage, 'egg');
  s.updateBrood(1);
  assert.equal(b.stage, 'larva');
  s.updateBrood(20 * DAY);
  assert.equal(b.stage, 'larva');
  s.feedBrood(s.queen, b, 20, true);
  s.updateBrood(s.p.larvaDays * DAY);
  assert.equal(b.stage, 'pupa');
  s.updateBrood(s.p.pupaDays * DAY);
  assert.equal(s.metrics.births, 1);
  assert.deepEqual(s.inspect(), []);
});
test('temperature response is bounded and explicitly stalls at cold boundary', () => {
  assert.equal(developmentRate(17), 0);
  assert.ok(developmentRate(20) < developmentRate(25));
  const s = new Simulation({ parameters: { temperatureC: 1 } }),
    b = s.layEgg();
  s.updateBrood(DAY);
  assert.equal(b.stageAge, 0);
});
test('cargo and biomass survive death and interaction interruption', () => {
  const s = new Simulation(),
    a = s.livingWorkers()[0],
    b = s.layEgg();
  b.carrier = a.id;
  a.carryingBrood = b.id;
  const before = s.inventory();
  s.kill(a);
  assert.equal(b.carrier, null);
  assert.deepEqual(s.inventory(), before);
  assert.deepEqual(s.inspect(), []);
});
test('clock playback batching preserves equivalent biological time', () => {
  const a = new Simulation({ seed: 9 }),
    b = new Simulation({ seed: 9 });
  const ca = new FixedClock(() => a.step(), { hz: 1, maxSteps: 10000 }),
    cb = new FixedClock(() => b.step(), { hz: 1, maxSteps: 10000 });
  for (let i = 0; i < 1000; i++) ca.advance(0.5);
  cb.advance(500);
  assert.deepEqual(a.report(), b.report());
});
test('local soil excavation carries a conserved soil load, no future blueprint', () => {
  const s = run(new Simulation({ parameters: { diggingSeconds: 10 } }), 2000);
  assert.ok(s.metrics.dug > 0);
  assert.equal(s.world.plan, undefined);
  assert.deepEqual(s.inspect(), []);
});
test('randomized seeds, starvation and invalid inputs', () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = run(new Simulation({ seed, resources: seed % 2 === 0, workers: seed % 15 }), 1000);
    assert.deepEqual(s.inspect(), [], `seed ${seed}`);
  }
  const s = new Simulation({ resources: false });
  s.physiology(10 * DAY);
  assert.ok(s.metrics.deaths > 0);
  assert.deepEqual(s.inspect(), []);
  assert.throws(() => s.step(2));
  assert.throws(() => new Simulation({ parameters: { trailHalfLifeSeconds: 0 } }));
  assert.throws(() => new Simulation({ workers: -1 }));
  assert.throws(() => s.addFood(0, 1));
});
test('larval response uses contact, not colony demand or quotas', () => {
  const s = new Simulation(),
    a = s.livingWorkers()[0],
    b = s.layEgg();
  b.stage = 'larva';
  s.spatial = new Map([[s.cell(a), [a]]]);
  s.updateWorker(a, 1);
  assert.equal(a.behaviour, 'nurse');
  b.cell = s.world.index(3, 3);
  assert.equal(s.sense(a).brood.length, 0);
  assert.equal(s.allocate, undefined);
  assert.equal(s.foodRoute, undefined);
});
test('all walked positions are open cardinal transitions', () => {
  const s = new Simulation();
  for (let i = 0; i < 500; i++) {
    const old = new Map(s.ants.map((a) => [a.id, s.cell(a)]));
    s.step();
    for (const a of s.ants) {
      const from = old.get(a.id),
        to = s.cell(a);
      assert.ok(from === to || s.world.adjacent(from).includes(to));
      assert.equal(s.world.grid[to], OPEN);
    }
  }
});
test('separating a trophallactic pair resets the contact timer', () => {
  const s = new Simulation({ workers: 2, resources: false }),
    [a, b] = s.livingWorkers();
  a.crop.c = 100;
  b.crop.c = 0;
  s.queen.x += 3;
  s.spatial = new Map([[s.cell(a), [a, b]]]);
  s.share(a, s.sense(a), 5);
  assert.equal(a.contact.seconds, 5);
  Object.assign(b, s.world.center(s.world.entrance));
  s.spatial = new Map([
    [s.cell(a), [a]],
    [s.cell(b), [b]],
  ]);
  s.updateWorker(a, 1);
  assert.equal(a.contact, null);
});
test('corpse detection is local and delayed; disposal cancellation retains biomass', () => {
  const s = new Simulation(),
    [a, b] = s.livingWorkers();
  s.kill(b);
  s.spatial = new Map([[s.cell(a), [a]]]);
  assert.equal(s.sense(a).corpses.length, 0);
  s.time = s.p.corpseCueSeconds;
  assert.equal(s.sense(a).corpses.length, 1);
  const c = s.corpses[0];
  c.carrier = a.id;
  a.corpse = c.id;
  const before = s.inventory();
  s.cancelTask(a);
  assert.equal(c.carrier, null);
  assert.deepEqual(s.inventory(), before);
  c.cell = s.world.index(3, 3);
  assert.equal(s.sense(a).corpses.length, 0);
});
test('brood relocation requires contact and carries it to a locally cooler cell', () => {
  const s = new Simulation({ parameters: { temperatureC: 40 } }),
    a = s.livingWorkers()[0],
    b = s.layEgg();
  s.spatial = new Map([[s.cell(a), [a]]]);
  a.moveBudget = 1;
  const before = s.temperature(b.cell);
  s.updateWorker(a, 1);
  assert.equal(a.carryingBrood, b.id);
  assert.equal(b.carrier, a.id);
  assert.equal(b.cell, s.cell(a));
  assert.ok(s.temperature(b.cell) < before);
  s.cancelTask(a);
  assert.equal(b.carrier, null);
  assert.deepEqual(s.inspect(), []);
});
test('cold and completely dry experimental boundaries are accepted', () => {
  const s = new Simulation({ parameters: { temperatureC: -5, soilMoisture: 0 } });
  assert.equal(s.p.soilMoisture, 0);
  assert.equal(developmentRate(-5), 0);
});
test('foragers abandon memory of food offering only an already-full nutrient', () => {
  const s = new Simulation({ workers: 1, resources: false }),
    a = s.livingWorkers()[0],
    cell = s.cell(a);
  s.queen.reserve.c += a.crop.c;
  a.crop.c = 0;
  const missing = s.p.cropP - a.crop.p;
  s.queen.reserve.p -= missing;
  a.crop.p = s.p.cropP;
  s.addFood(cell, 0, 80);
  a.memory = [cell];
  s.spatial = new Map([[cell, [a]]]);
  s.updateWorker(a, 1);
  assert.deepEqual(a.memory, []);
  assert.equal(a.behaviour, 'explore');
  assert.deepEqual(s.inspect(), []);
});
