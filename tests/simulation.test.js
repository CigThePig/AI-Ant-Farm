import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { World } from '../src/world.js';
import { FixedClock } from '../src/clock.js';
import { OPEN, ROCK, SOIL, route, distance } from '../src/navigation.js';

const advance = (sim, seconds) => { for (let i = 0; i < Math.round(seconds * 30); i++) sim.step(); };
function addFood(sim, cell, amount, stored = true) {
  if (stored) assert.equal(sim.world.addStored(cell, amount), amount);
  else sim.world.food[cell] += amount;
  sim.metrics.foodCreated += amount;
}
function completed(options = {}) {
  const sim = new Simulation({ workers: 0, laying: false, regrowFood: false, starvation: false, ...options });
  const w = sim.world;
  for (const i of [...w.plan]) w.dig(i);
  // Open the whole connected plan independent of insertion order.
  for (let n = 0; n < 20; n++) for (const i of [...w.plan]) w.dig(i);
  sim.updateConstruction();
  Object.assign(sim.queen, w.center(w.chamber));
  return sim;
}
function clearFood(sim) {
  sim.world.food.fill(0);sim.world.stores.fill(0);sim.world.pantries.clear();
  sim.metrics.foodCreated = 0;sim.metrics.foodConsumed = 0;sim.metrics.foodSpoiled = 0;
}
function healthy(sim) { assert.deepEqual(sim.inspect(), []); }

for (const seed of [1, 42, 1337]) test(`seed ${seed}: build, forage, feed and reproduce for ten minutes`, () => {
  const sim = new Simulation({ seed });
  for (let block = 0; block < 60; block++) { advance(sim, 10); healthy(sim); }
  assert.equal(sim.chamberReady, true);
  assert.equal(sim.queen.alive, true);
  assert.ok(sim.metrics.delivered > 20);
  assert.ok(sim.metrics.fed >= 2);
  assert.ok(sim.metrics.births >= 10);
  assert.ok(sim.livingWorkers().length > 12);
  assert.ok(sim.metrics.cleaned > 0);
  assert.ok(sim.expansions >= 1);
  assert.equal(sim.metrics.deaths, 0);
});

test('blocked construction leaves food collection and self-preservation available', () => {
  const sim = new Simulation({ seed: 42, regrowFood: false });
  sim.world.grid[sim.world.entrance + sim.world.width] = ROCK;
  advance(sim, 180);
  assert.equal(sim.chamberReady, false);
  assert.ok(sim.metrics.gathered > 0);
  assert.ok(sim.ants.some(a => a.task?.kind === 'forage'));
  assert.ok(sim.events.some(e => /stalled/.test(e.message)));
  healthy(sim);
});

test('corridor extends through its own ancestry and can branch', () => {
  const w = new World();
  const x = Math.floor(w.width / 2);
  for (let y = w.surface + 1; y < w.surface + 15; y++) assert.equal(w.dig(w.index(x, y)), true);
  const branch = w.extendBranch(w.index(x, w.surface + 12), 10, 4, 3);
  for (let n = 0; n < 25; n++) for (const i of [...w.plan]) w.dig(i);
  assert.ok([...branch].every(i => w.grid[i] === OPEN));
  assert.ok(route(w, w.entrance, new Set([w.index(x + 10, w.surface + 16)])));
});

test('cardinal pathfinding takes a dogleg and reports disconnected goals', () => {
  const w = new World();w.grid.fill(ROCK);
  const cells = [[5,5],[6,5],[7,5],[7,6],[7,7],[8,7]].map(([x,y])=>w.index(x,y));
  for (const i of cells) w.grid[i] = OPEN;
  assert.deepEqual(route(w, cells[0], new Set([cells.at(-1)])), cells.slice(1));
  const isolated = w.index(12,12);w.grid[isolated] = OPEN;
  assert.equal(route(w, cells[0], new Set([isolated])), null);
  assert.deepEqual(route(w, cells[0], new Set([cells[0]])), []);
});

test('a carrier starting beside the queen reaches storage outside her buffer', () => {
  const sim = completed();const w = sim.world;
  const a = sim.spawnAnt('worker', w.chamber);
  a.cargo = 1;sim.metrics.foodCreated++;
  sim.assign(a, 'forage', [], {phase:'waiting'});
  assert.equal(sim.assignDelivery(a, a.task), true);
  const target = a.task.target;
  assert.ok(distance(w, target, w.chamber) >= 3.5);
  for (let i = 0; i < 300 && a.cargo > 0; i++) {
    const t = a.task;if (sim.move(a, t, 1/30)) sim.interact(a, 1/30);
  }
  assert.equal(a.cargo, 0);assert.equal(w.stores[target], 1);healthy(sim);
});

test('a cleaner can collect waste beside the queen and carry it to the midden', () => {
  const sim = completed();const w = sim.world;
  w.waste[w.chamber] = 1;
  const a = sim.spawnAnt('worker', w.chamber);
  assert.equal(sim.assignCleaning(a), true);
  for (let i=0; i<900 && a.task; i++) {const t=a.task;if(sim.move(a,t,1/30))sim.interact(a,1/30);}
  assert.equal(w.waste[w.chamber],0);assert.equal(sim.metrics.cleaned,1);healthy(sim);
});

for (const event of ['death','job change','hatching']) test(`brood transport releases ownership after ${event}`, () => {
  const sim = completed(), w = sim.world;
  const a = sim.spawnAnt('worker', w.chamber), b = sim.layEgg();
  b.stage = 'pupa';b.stageAge = event === 'hatching' ? 8 : 0;
  sim.assign(a, 'transport', [], {target:b.id,destination:w.chamber+1,phase:'carry'}, [`brood:${b.id}`]);
  b.carrier=a.id;a.carryingBrood=b.id;
  if(event==='death') {sim.kill(a);sim.ants=sim.ants.filter(a=>a.alive);}
  else if(event==='job change') sim.changeTask(a,'idle');
  else sim.updateBrood(1/30);
  assert.equal(a.carryingBrood,null);
  assert.equal(sim.claims.has(`brood:${b.id}`),false);
  if(event!=='hatching')assert.equal(b.carrier,null);
  else assert.equal(sim.brood.length,0);
  healthy(sim);
});

test('no worker hatches without nurse meals; two real meals allow maturation', () => {
  const hungry = completed();const b = hungry.layEgg();
  advance(hungry,80);
  assert.equal(hungry.metrics.births,0);assert.equal(b.stage,'larva');assert.equal(b.growth,0);
  const fed = completed(), w = fed.world;
  clearFood(fed);addFood(fed,w.chamber+4,3);
  const nurse = fed.spawnAnt('worker', w.chamber);
  const larva=fed.layEgg();larva.stage='larva';larva.age=6;
  for(let i=0;i<2400 && fed.metrics.births===0;i++)fed.step();
  assert.equal(fed.metrics.births,1);assert.ok(fed.metrics.fed>=2);
  assert.ok(fed.metrics.foodConsumed>=.8);assert.ok(nurse.alive);healthy(fed);
});

test('all stored food stays registered, spoils, and contributes to attainable pressure', () => {
  const sim=completed(),w=sim.world;
  clearFood(sim);
  const slots=sim.pantrySlots();assert.ok(slots.size>0);
  const first=slots.values().next().value;
  addFood(sim,first,1);sim.environment(.5);
  assert.ok(w.pantries.has(first));assert.ok(w.stores[first]<1);
  for(const i of slots)addFood(sim,i,10-w.stores[i]);
  assert.ok(sim.pressures().pantry>.99);
  const before=w.plan.size;sim.updateConstruction();
  assert.ok(w.plan.size>before);assert.equal(sim.expansions,1);healthy(sim);
});

test('scent diffuses into empty neighbors and respects solid soil', () => {
  const w=new World(),i=w.entrance;
  w.homeScent[i]=1;w.diffuse(w.homeScent,.5,.12,.55);
  assert.ok(w.homeScent[i-1]>0);assert.ok(w.homeScent[i]<1);
  w.homeScent.fill(0);w.homeScent[i]=1;w.grid[i-1]=SOIL;
  w.diffuse(w.homeScent,.5,.12,.55);assert.equal(w.homeScent[i-1],0);
});

test('air attenuates deeply, and a disconnected chamber has zero ventilation', () => {
  const w=new World({height:140});const x=Math.floor(w.width/2);
  for(let y=w.surface;y<w.height-1;y++)w.grid[w.index(x,y)]=OPEN;
  w.refreshAir();
  assert.ok(w.air[w.index(x,w.surface+80)]<.001);
  assert.ok(w.air[w.index(x,w.surface+10)]>w.air[w.index(x,w.surface+40)]);
  w.grid[w.index(x,w.surface+5)]=SOIL;w.refreshAir();
  assert.equal(w.air[w.index(x,w.surface+10)],0);
});

test('corpses cannot receive energy and do not count toward live population', () => {
  const sim=completed();const w=sim.world;
  const donor=sim.spawnAnt('worker',w.chamber),dead=sim.spawnAnt('worker',w.chamber);
  dead.energy=0;sim.kill(dead);
  assert.equal(sim.transferEnergy(donor,dead,50),0);assert.equal(donor.energy,100);
  assert.equal(sim.snapshot().workers,1);assert.equal(sim.snapshot().corpses,1);
  assert.equal(sim.pressures().space,2/sim.pressures().nest);
});

test('large displacement follows path segments without entering soil', () => {
  const sim=completed({workerSpeed:12.5}),w=sim.world;
  const a=sim.spawnAnt('worker',w.chamber),goal=w.chamber-4;
  const path=route(w,w.chamber,new Set([goal]));assert.ok(path);
  sim.assign(a,'idle',path,{duration:1});
  while(a.task.cursor<a.task.path.length) {sim.move(a,a.task,.1);assert.equal(w.grid[sim.cell(a)],OPEN);}
  assert.equal(sim.cell(a),goal);
  // Cancelling between centers and changing direction must recenter first.
  Object.assign(a,w.center(w.chamber));sim.assign(a,'idle',[w.chamber+1],{duration:1});
  sim.move(a,a.task,.04);sim.changeTask(a,'idle');
  sim.assign(a,'idle',route(w,sim.cell(a),new Set([w.chamber-w.width])),{duration:1});
  while(a.task.cursor<a.task.path.length){sim.move(a,a.task,.1);assert.equal(w.grid[sim.cell(a)],OPEN);}
  assert.equal(sim.cell(a),w.chamber-w.width);
});

test('stationary ants can eat; cancel and death return carried food without losing inventory', () => {
  const sim=completed(),w=sim.world;clearFood(sim);
  const a=sim.spawnAnt('worker',w.chamber);a.energy=40;
  addFood(sim,w.chamber,1);
  assert.equal(sim.assignEating(a),true);assert.deepEqual(a.task.path,[]);
  sim.interact(a,1/30);assert.equal(a.energy,80);
  a.cargo=1;sim.metrics.foodCreated++;sim.changeTask(a,'idle');
  assert.equal(w.food[w.chamber],1);a.cargo=.4;sim.metrics.foodCreated+=.4;
  sim.kill(a);sim.ants=sim.ants.filter(a=>a.alive);
  assert.ok(Math.abs(w.food[w.chamber]-1.4)<1e-9);healthy(sim);
});

test('interrupted waste hauling returns its load and releases reservations', () => {
  const sim=completed(),w=sim.world,a=sim.spawnAnt('worker',w.chamber);
  w.waste[w.chamber]=1;sim.assignCleaning(a);sim.interact(a,1/30);
  assert.equal(w.waste[w.chamber],0);assert.equal(a.task.waste,1);
  sim.changeTask(a,'idle');assert.equal(w.waste[w.chamber],1);healthy(sim);
});

test('resource exhaustion causes honest starvation without stale locks or invalid population', () => {
  const sim=new Simulation({workers:3,regrowFood:false,laying:false});clearFood(sim);
  for(const a of sim.ants)if(a.type==='worker')a.energy=.01;
  advance(sim,1);
  assert.equal(sim.livingWorkers().length,0);assert.equal(sim.corpses.length,3);healthy(sim);
});

test('equal simulation time at 30, 60 and 120 rendering FPS produces identical worlds', () => {
  const states=[];
  for(const fps of [30,60,120]) {
    const sim=new Simulation({seed:1337});const clock=new FixedClock(dt=>sim.step(dt));
    for(let i=0;i<120*fps;i++)clock.advance(1/fps);
    states.push({snapshot:sim.snapshot(),food:[...sim.world.food],grid:[...sim.world.grid],brood:sim.brood,ants:sim.ants});
    healthy(sim);
  }
  assert.deepEqual(states[0],states[1]);assert.deepEqual(states[1],states[2]);
});

test('slow-frame catch-up retains time debt and pause/reset discards it explicitly', () => {
  let ticks=0;const clock=new FixedClock(()=>ticks++,{maxSteps:2});
  clock.advance(1);assert.equal(ticks,2);assert.ok(clock.accumulator>.9);
  for(let i=0;i<20;i++)clock.advance(0);
  assert.equal(ticks,30);clock.advance(.01);clock.reset();assert.equal(clock.accumulator,0);
});

test('invalid step durations and world sizes fail explicitly', () => {
  const sim=new Simulation();
  for(const dt of [0,-1,1,NaN,Infinity])assert.throws(()=>sim.step(dt),RangeError);
  assert.throws(()=>new World({width:4,height:6}),RangeError);
});

test('queen meals move real stored food and refill queen energy', () => {
  const sim=completed(),w=sim.world;clearFood(sim);
  addFood(sim,w.chamber+4,2);sim.queen.energy=35;
  const nurse=sim.spawnAnt('worker',w.chamber);
  assert.equal(sim.assignNursing(nurse),true);assert.equal(nurse.task.kind,'feedQueen');
  for(let i=0;i<600 && nurse.task;i++){const t=nurse.task;if(sim.move(nurse,t,1/30))sim.interact(nurse,1/30);}
  assert.equal(sim.queen.energy,51);assert.ok(Math.abs(w.storedFood-1.6)<1e-9);
  assert.ok(Math.abs(sim.metrics.foodConsumed-.4)<1e-9);healthy(sim);
});

test('low reserves retain both construction and foraging workers', () => {
  const sim=new Simulation({seed:42});advance(sim,2);
  const counts=sim.snapshot().jobs;
  assert.ok(counts.forage>=2);assert.ok(counts.dig>=1);assert.ok(counts.forage<12);healthy(sim);
});

test('full pantry delivery waiting cannot consume the construction workforce', () => {
  const sim=completed({workers:12});const w=sim.world;
  clearFood(sim);
  for(const i of sim.pantrySlots())addFood(sim,i,10);
  const carrier=sim.livingWorkers()[0];carrier.cargo=1;sim.metrics.foodCreated++;
  sim.assign(carrier,'forage',[],{phase:'waiting'});
  sim.updateConstruction();assert.ok(w.plan.size>0);
  advance(sim,20);assert.ok(sim.metrics.dug>0);healthy(sim);
});
