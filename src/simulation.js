import { World } from './world.js';
import { OPEN, SOIL, distance, route } from './navigation.js';

export const TASKS = ['forage', 'dig', 'feed', 'feedQueen', 'transport', 'clean', 'eat', 'eatLoose', 'idle'];
const DEFAULTS = Object.freeze({ workers: 12, maxWorkers: 80, workerSpeed: 5,
  regrowFood: true, laying: true, starvation: true });

export class Simulation {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.world = new World(options);
    this.time = 0;
    this.nextId = 1;
    this.ants = [];
    this.brood = [];
    this.corpses = [];
    this.claims = new Map();
    this.events = [];
    this.tick = 0;
    this.environmentTimer = 0;
    this.layTimer = 0;
    this.planTimer = 0;
    this.chamberReady = false;
    this.lastProgress = 0;
    this.lastExcavated = 0;
    this.expansions = 0;
    this.metrics = { births: 0, laid: 0, fed: 0, deaths: 0, broodDeaths: 0,
      dug: 0, gathered: 0, delivered: 0, cleaned: 0, cancelled: 0,
      foodCreated: this.world.food.reduce((a, b) => a + b, 0), foodConsumed: 0, foodSpoiled: 0 };
    this.queen = this.spawnAnt('queen', this.world.entrance);
    for (let i = 0; i < this.options.workers; i++) this.spawnAnt('worker', this.world.entrance);
    this.note('Colony founded. Workers are building and foraging.');
  }

  spawnAnt(type, cell) {
    const p = this.world.center(cell);
    const ant = { id: this.nextId++, type, alive: true, ...p,
      age: 0, lifespan: type === 'queen' ? 100000 : 2400 + this.world.random() * 600,
      energy: 100, task: null, cargo: 0, carryingBrood: null, angle: 0,
      distance: 0, retryAt: 0 };
    this.ants.push(ant);
    return ant;
  }

  livingWorkers() { return this.ants.filter(a => a.alive && a.type === 'worker'); }
  cell(ant) { return this.world.cell(ant.x, ant.y); }
  note(message) {
    this.events.push({ time: this.time, message });
    if (this.events.length > 60) this.events.shift();
  }

  pantrySlots() {
    const w = this.world, result = new Set();
    for (let y = w.surface; y < w.height - 1; y++) {
      for (let x = 1; x < w.width - 1; x++) {
        const i = w.index(x, y), d = distance(w, i, w.chamber);
        if (w.grid[i] === OPEN && d >= 3.5 && d <= 22) result.add(i);
      }
    }
    return result;
  }

  pressures() {
    const w = this.world, live = this.livingWorkers().length;
    const slots = this.pantrySlots();
    let nest = 0;
    for (let i = w.surface * w.width; i < w.grid.length; i++) if (w.grid[i] === OPEN) nest++;
    const capacity = slots.size * 10;
    return { space: live * 2 / Math.max(1, nest),
      food: Math.max(0, 1 - w.storedFood / Math.max(8, live * 1.2)),
      pantry: capacity ? Math.max(0, (w.storedFood / capacity - .7) / .3) : 0,
      storageCapacity: capacity, nest };
  }

  reserve(task, key, ant) {
    if (this.claims.has(key)) return false;
    this.claims.set(key, ant.id);
    task.claims.push(key);
    return true;
  }

  assign(ant, kind, path, extra = {}, keys = []) {
    if (path === null) return false;
    const center = this.world.center(this.cell(ant));
    if (Math.hypot(ant.x - center.x, ant.y - center.y) > 1e-8 && path[0] !== this.cell(ant)) path = [this.cell(ant), ...path];
    const task = { kind, path, cursor: 0, work: 0, phase: 'work', claims: [],
      started: this.time, lastProgress: this.time, ...extra };
    for (const key of keys) {
      if (!this.reserve(task, key, ant)) {
        for (const held of task.claims) this.claims.delete(held);
        return false;
      }
    }
    ant.task = task;
    return true;
  }

  // Every exit (completion, interruption, invalid target, or death) has one cleanup.
  cancelTask(ant, { dropCargo = false } = {}) {
    const task = ant.task;
    if (task) {
      if (task.kind === 'clean' && task.waste > 0) this.world.waste[this.cell(ant)] += task.waste;
      for (const key of task.claims) if (this.claims.get(key) === ant.id) this.claims.delete(key);
      this.metrics.cancelled++;
    }
    if (ant.carryingBrood !== null) {
      const b = this.brood.find(b => b.id === ant.carryingBrood);
      if (b) { b.carrier = null; b.cell = this.cell(ant); }
      ant.carryingBrood = null;
    }
    if (dropCargo && ant.cargo > 0) {
      this.world.food[this.cell(ant)] += ant.cargo;
      ant.cargo = 0;
    }
    ant.task = null;
  }

  kill(ant) {
    if (!ant.alive) return;
    this.cancelTask(ant, { dropCargo: true });
    ant.alive = false;
    this.corpses.push({ id: ant.id, cell: this.cell(ant) });
    this.metrics.deaths++;
    if (ant.type === 'queen') this.note('The queen has died. Existing brood can still mature.');
  }

  changeTask(ant, kind) {
    this.cancelTask(ant, { dropCargo: true });
    ant.retryAt = this.time;
    if (kind === 'idle') this.assign(ant, 'idle', [], { duration: 1 });
  }

  foodRoute(ant, stored = true, minimum = .001) {
    const w = this.world, field = stored ? w.stores : w.food;
    const goals = new Set();
    for (let i = 0; i < field.length; i++) {
      if (field[i] >= minimum && w.grid[i] === OPEN && !this.claims.has(`food:${i}`)) goals.add(i);
    }
    const path = route(w, this.cell(ant), goals);
    return path === null ? null : { path, target: path.at(-1) ?? this.cell(ant) };
  }

  assignEating(ant) {
    for (const stored of [true, false]) {
      const found = this.foodRoute(ant, stored);
      if (found && this.assign(ant, stored ? 'eat' : 'eatLoose', found.path,
        { target: found.target }, [`food:${found.target}`])) return true;
    }
    return false;
  }

  assignForage(ant) {
    const found = this.foodRoute(ant, false, .5);
    return !!found && this.assign(ant, 'forage', found.path,
      { target: found.target, phase: 'pickup' }, [`food:${found.target}`]);
  }

  assignDelivery(ant, task) {
    const w = this.world;
    const available = new Set([...this.pantrySlots()].filter(i => w.stores[i] <= 10 - ant.cargo));
    const path = route(w, this.cell(ant), available);
    if (path === null) return false;
    task.phase = 'deliver';
    task.path = path;
    task.cursor = 0;
    task.target = path.at(-1) ?? this.cell(ant);
    task.lastProgress = this.time;
    return true;
  }

  assignDig(ant) {
    const w = this.world, approaches = new Map();
    // Finish the entry shaft before widening the chamber. Every workface has an
    // open approach and all workers follow real paths to that approach.
    const pendingShaft = [...w.plan].filter(i => i % w.width === w.chamber % w.width && i <= w.chamber && w.grid[i] === SOIL);
    const candidates = pendingShaft.length ? pendingShaft : [...w.plan];
    for (const target of candidates) {
      if (w.grid[target] !== SOIL || this.claims.has(`dig:${target}`)) continue;
      for (const n of w.adjacent(target)) if (w.grid[n] === OPEN) approaches.set(n, target);
    }
    const path = route(w, this.cell(ant), new Set(approaches.keys()));
    if (path === null) return false;
    const approach = path.at(-1) ?? this.cell(ant), target = approaches.get(approach);
    return this.assign(ant, 'dig', path, { target, approach }, [`dig:${target}`]);
  }

  assignMeal(ant, kind, target, key) {
    const found = this.foodRoute(ant, true, .4);
    if (!found) return false;
    return this.assign(ant, kind, found.path, { target, source: found.target, phase: 'collect' },
      [key, `food:${found.target}`]);
  }

  nurseryDestination(brood) {
    const w = this.world, occupied = new Map();
    for (const b of this.brood) if (b !== brood) occupied.set(b.cell, (occupied.get(b.cell) || 0) + 1);
    let best = null, score = Infinity;
    for (const i of w.room) {
      if (w.grid[i] !== OPEN || (occupied.get(i) || 0) >= 3) continue;
      const d = distance(w, i, w.chamber);
      if (d < 2 || d > 4.5) continue;
      const s = (occupied.get(i) || 0) * 4 + Math.abs(d - 3);
      if (s < score) { score = s; best = i; }
    }
    return best;
  }

  assignNursing(ant) {
    if (this.queen.alive && this.queen.energy < 65 && !this.claims.has('queenMeal')) {
      if (this.assignMeal(ant, 'feedQueen', this.queen.id, 'queenMeal')) return true;
    }
    for (const b of this.brood) {
      if (b.stage !== 'larva' || b.satiation > 1 || this.claims.has(`brood:${b.id}`)) continue;
      if (this.assignMeal(ant, 'feed', b.id, `brood:${b.id}`)) return true;
    }
    for (const b of this.brood) {
      if (b.stage === 'egg' || b.carrier !== null || distance(this.world, b.cell, this.world.chamber) >= 2 || this.claims.has(`brood:${b.id}`)) continue;
      const destination = this.nurseryDestination(b);
      if (destination === null) continue;
      const path = route(this.world, this.cell(ant), new Set([b.cell]));
      if (this.assign(ant, 'transport', path, { target: b.id, destination, phase: 'pickup' }, [`brood:${b.id}`])) return true;
    }
    return false;
  }

  assignCleaning(ant) {
    const w = this.world, targets = new Set();
    for (let i = w.surface * w.width; i < w.grid.length; i++) {
      if (w.waste[i] >= .4 && !this.claims.has(`waste:${i}`)) targets.add(i);
    }
    for (const corpse of this.corpses) if (!this.claims.has(`waste:${corpse.cell}`)) targets.add(corpse.cell);
    const path = route(w, this.cell(ant), targets);
    if (path === null) return false;
    const target = path.at(-1) ?? this.cell(ant);
    return this.assign(ant, 'clean', path, { target, phase: 'pickup', waste: 0 }, [`waste:${target}`]);
  }

  allocate(ant) {
    if (ant.task || !ant.alive || ant.type !== 'worker') return;
    if (ant.cargo > 0) {
      this.assign(ant, 'forage', [], { phase: 'waiting' });
      this.assignDelivery(ant, ant.task);
      return;
    }
    if (ant.energy < 50 && this.assignEating(ant)) return;
    const workers = this.livingWorkers();
    const counts = workers.reduce((r, a) => { const kind = a.task?.kind; r[kind] = (r[kind] || 0) + 1; return r; }, {});
    const scarcity = this.world.storedFood < Math.max(8, workers.length);
    const forageQuota = Math.max(2, Math.ceil(workers.length * (scarcity ? .55 : .25)));
    if ((counts.forage || 0) < forageQuota && this.assignForage(ant)) return;
    if (this.assignNursing(ant)) return;
    const cleaningQuota = Math.max(1, Math.ceil(workers.length * .15));
    if ((counts.clean || 0) < cleaningQuota && this.assignCleaning(ant)) return;
    const digQuota = Math.max(1, Math.ceil(workers.length * (this.chamberReady ? .25 : .5)));
    if ((counts.dig || 0) < digQuota && this.assignDig(ant)) return;
    const home = this.queen.alive ? this.cell(this.queen) : this.world.entrance;
    if (distance(this.world, this.cell(ant), home) > 4) {
      if (this.assign(ant, 'idle', route(this.world, this.cell(ant), new Set([home])), { duration: .5 })) return;
    }
    const open = this.world.adjacent(this.cell(ant)).filter(i => this.world.grid[i] === OPEN);
    const goal = open[Math.floor(this.world.random() * open.length)];
    this.assign(ant, 'idle', goal === undefined ? [] : [goal], { duration: .4 + this.world.random() });
  }

  move(ant, task, dt) {
    const w = this.world;
    let remaining = (ant.type === 'queen' ? 2.4 : this.options.workerSpeed) * dt;
    while (remaining > 1e-10 && task.cursor < task.path.length) {
      const next = task.path[task.cursor];
      if (w.grid[next] !== OPEN) { this.cancelTask(ant, { dropCargo: true }); return false; }
      const from = this.cell(ant);
      if (next !== from && !w.adjacent(from).includes(next)) {
        this.cancelTask(ant, { dropCargo: true }); return false;
      }
      const target = w.center(next), dx = target.x - ant.x, dy = target.y - ant.y;
      const length = Math.hypot(dx, dy);
      if (length < 1e-10) { task.cursor++; continue; }
      const step = Math.min(length, remaining);
      ant.x += dx / length * step;
      ant.y += dy / length * step;
      ant.angle = Math.atan2(dy, dx);
      ant.distance += step;
      remaining -= step;
      task.lastProgress = this.time;
      if (step >= length - 1e-10) { ant.x = target.x; ant.y = target.y; task.cursor++; }
      if (ant.carryingBrood !== null) {
        const b = this.brood.find(b => b.id === ant.carryingBrood);
        if (b) b.cell = this.cell(ant);
      }
    }
    return task.cursor >= task.path.length;
  }

  eat(ant, amount) {
    const eaten = Math.max(0, Math.min(amount, (100 - ant.energy) / 40));
    ant.energy = Math.min(100, ant.energy + eaten * 40);
    this.metrics.foodConsumed += eaten;
    return eaten;
  }

  // Public energy transfer rejects dead participants at the operation boundary.
  transferEnergy(donor, receiver, amount) {
    if (!donor.alive || !receiver.alive || donor === receiver || distance(this.world, this.cell(donor), this.cell(receiver)) > 1.5) return 0;
    const actual = Math.max(0, Math.min(amount, donor.energy - 25, 100 - receiver.energy));
    donor.energy -= actual;
    receiver.energy += actual;
    return actual;
  }

  interact(ant, dt) {
    const t = ant.task, w = this.world;
    if (!t || !ant.alive) return;
    t.work += dt;
    if (t.kind === 'idle') { if (t.work >= t.duration) this.cancelTask(ant); return; }
    if (t.kind === 'dig') {
      if (w.grid[t.target] !== SOIL || !w.adjacent(this.cell(ant)).includes(t.target)) { this.cancelTask(ant); return; }
      if (t.work >= .65) {
        if (w.dig(t.target)) {
          this.metrics.dug++;
          this.lastProgress = this.time;
        }
        this.cancelTask(ant);
      }
      return;
    }
    if (t.kind === 'eat' || t.kind === 'eatLoose') {
      const need = (100 - ant.energy) / 40;
      const food = t.kind === 'eat' ? w.takeStored(t.target, need) : Math.min(w.food[t.target], need);
      if (t.kind === 'eatLoose') w.food[t.target] -= food;
      this.eat(ant, food);
      this.cancelTask(ant);
      return;
    }
    if (t.kind === 'forage') {
      if (t.phase === 'pickup') {
        const amount = Math.min(1, w.food[t.target]);
        w.food[t.target] -= amount;
        ant.cargo += amount;
        this.metrics.gathered += amount;
        if (ant.cargo === 0) { this.cancelTask(ant); return; }
        // Release the source claim as soon as the food is physically collected.
        for (const key of t.claims) if (this.claims.get(key) === ant.id) this.claims.delete(key);
        t.claims.length = 0;
        t.phase = 'waiting';
        this.assignDelivery(ant, t);
      } else if (t.phase === 'waiting') {
        if (ant.energy < 25) { ant.cargo -= this.eat(ant, ant.cargo); }
        if (ant.cargo <= 1e-10) { ant.cargo = 0; this.cancelTask(ant); return; }
        this.assignDelivery(ant, t);
      } else {
        const deposited = w.addStored(t.target, ant.cargo);
        ant.cargo -= deposited;
        this.metrics.delivered += deposited;
        if (ant.cargo > 1e-10) { t.phase = 'waiting'; this.assignDelivery(ant, t); }
        else { ant.cargo = 0; this.cancelTask(ant); }
      }
      return;
    }
    if (t.kind === 'feed' || t.kind === 'feedQueen') {
      const b = t.kind === 'feed' ? this.brood.find(b => b.id === t.target) : null;
      const target = b ? b.cell : this.cell(this.queen);
      if ((t.kind === 'feed' && (!b || b.stage !== 'larva')) || (t.kind === 'feedQueen' && !this.queen.alive)) {
        this.cancelTask(ant, { dropCargo: true }); return;
      }
      if (t.phase === 'collect') {
        const meal = w.takeStored(t.source, .4);
        ant.cargo += meal;
        if (meal < .399999) { this.cancelTask(ant, { dropCargo: true }); return; }
        const path = route(w, this.cell(ant), new Set([target]));
        if (path === null) { this.cancelTask(ant, { dropCargo: true }); return; }
        t.phase = 'serve'; t.path = path; t.cursor = 0;
      } else if (this.cell(ant) !== target) {
        const path = route(w, this.cell(ant), new Set([target]));
        if (path === null) this.cancelTask(ant, { dropCargo: true });
        else { t.path = path; t.cursor = 0; }
      } else {
        if (b) {
          if (b.satiation < 1) {
            b.satiation += 5;
            b.hunger = 0;
            b.meals++;
            this.metrics.foodConsumed += ant.cargo;
            ant.cargo = 0;
            this.metrics.fed++;
            w.waste[target] += .06;
          }
        } else ant.cargo -= this.eat(this.queen, ant.cargo);
        this.cancelTask(ant, { dropCargo: true });
      }
      return;
    }
    if (t.kind === 'transport') {
      const b = this.brood.find(b => b.id === t.target);
      if (!b) { this.cancelTask(ant); return; }
      if (t.phase === 'pickup') {
        if (b.carrier !== null || b.cell !== this.cell(ant)) { this.cancelTask(ant); return; }
        const path = route(w, b.cell, new Set([t.destination]));
        if (path === null) { this.cancelTask(ant); return; }
        b.carrier = ant.id;
        ant.carryingBrood = b.id;
        t.phase = 'carry'; t.path = path; t.cursor = 0;
      } else {
        b.cell = this.cell(ant);
        this.cancelTask(ant);
      }
      return;
    }
    if (t.kind === 'clean') {
      if (t.phase === 'pickup') {
        const path = route(w, this.cell(ant), new Set([w.dump]));
        if (path === null) { this.cancelTask(ant); return; }
        const corpse = this.corpses.find(c => c.cell === t.target);
        if (corpse) { this.corpses.splice(this.corpses.indexOf(corpse), 1); t.waste = 1; }
        else { t.waste = Math.min(1, w.waste[t.target]); w.waste[t.target] -= t.waste; }
        t.phase = 'dump'; t.path = path; t.cursor = 0;
      } else {
        // The exterior midden is disposed material, never a new cleaning target.
        this.metrics.cleaned += t.waste;
        t.waste = 0;
        this.cancelTask(ant);
      }
    }
  }

  updateBrood(dt) {
    const removed = new Set();
    for (const b of this.brood) {
      b.age += dt;
      if (b.stage === 'egg' && b.age >= 6) {
        b.stage = 'larva'; b.stageAge = 0;
      } else if (b.stage === 'larva') {
        const growing = Math.min(dt, b.satiation);
        b.growth += growing;
        b.satiation = Math.max(0, b.satiation - dt);
        b.hunger += dt - growing;
        if (b.growth >= 10 - 1e-8 && b.meals >= 2) {
          b.stage = 'pupa'; b.stageAge = 0;
        } else if (b.hunger > 100) {
          removed.add(b.id);
          this.world.waste[b.cell] += .4;
          this.metrics.broodDeaths++;
        }
      } else if (b.stage === 'pupa' && b.stageAge >= 8) {
        this.spawnAnt('worker', b.cell);
        this.metrics.births++;
        removed.add(b.id);
      }
      b.stageAge += dt;
    }
    if (removed.size) {
      for (const a of this.ants) {
        if (removed.has(a.carryingBrood) || (a.task?.kind === 'feed' && removed.has(a.task.target)) ||
          (a.task?.kind === 'transport' && removed.has(a.task.target))) this.cancelTask(a, { dropCargo: true });
      }
      this.brood = this.brood.filter(b => !removed.has(b.id));
    }
  }

  layEgg() {
    const b = { id: this.nextId++, cell: this.cell(this.queen), stage: 'egg', age: 0,
      stageAge: 0, satiation: 0, growth: 0, hunger: 0, meals: 0, carrier: null };
    this.brood.push(b);
    this.metrics.laid++;
    return b;
  }

  updateQueen(dt) {
    const q = this.queen;
    if (!q.alive) return;
    if (this.chamberReady && this.cell(q) !== this.world.chamber && !q.task) {
      this.assign(q, 'relocate', route(this.world, this.cell(q), new Set([this.world.chamber])));
    }
    if (q.task && this.move(q, q.task, dt)) this.cancelTask(q);
    this.layTimer += dt;
    if (this.options.laying && this.chamberReady && this.cell(q) === this.world.chamber && !q.task && this.time >= 10 && this.layTimer >= 12 &&
      q.energy > 30 && this.world.storedFood >= 3 &&
      this.livingWorkers().length + this.brood.length < this.options.maxWorkers) {
      // Check inventory first; eggs consume food atomically across storage tiles.
      let remaining = .5;
      for (const i of this.world.pantries) {
        remaining -= this.world.takeStored(i, remaining);
        if (remaining <= 1e-10) break;
      }
      this.metrics.foodConsumed += .5;
      this.layEgg();
      q.energy -= 1;
      this.layTimer = 0;
    }
  }

  updateConstruction() {
    const w = this.world;
    for (const i of w.plan) if (w.grid[i] !== SOIL) w.plan.delete(i);
    const complete = [...w.room].every(i => w.grid[i] === OPEN) && route(w, w.entrance, new Set([w.chamber])) !== null;
    if (complete && !this.chamberReady) {
      this.chamberReady = true;
      this.note('Queen chamber complete. The queen is moving underground.');
    }
    if (!this.chamberReady && this.time - this.lastProgress > 20) {
      // An obstruction is reported and retried, without taking away foragers.
      for (const a of this.ants) if (a.task?.kind === 'dig') this.cancelTask(a);
      this.lastProgress = this.time;
      this.note('Construction stalled; work assignments refreshed. Foraging continues.');
    }
    if (this.chamberReady && w.plan.size === 0) {
      const p = this.pressures();
      if (p.space > .8 || p.pantry > .5) {
        const n = this.expansions++;
        const side = n % 2 ? 1 : -1;
        const depth = Math.floor(n / 2);
        w.extendBranch(w.chamber, side * (10 + depth % 3 * 7), 5 + Math.floor(depth / 3) * 9, 3 + depth % 2);
        this.note(p.pantry > .5 ? 'Expanding food storage.' : 'Expanding the nest for the growing colony.');
      }
    }
  }

  environment(dt) {
    const w = this.world;
    if (this.options.regrowFood) for (const i of w.sources) {
      const add = Math.min(.018 * dt, Math.max(0, 18 - w.food[i]));
      w.food[i] += add;
      this.metrics.foodCreated += add;
    }
    for (const i of [...w.pantries]) {
      const spoil = w.takeStored(i, w.stores[i] * (1 - Math.exp(-.0005 * dt)));
      this.metrics.foodSpoiled += spoil;
      w.waste[i] += spoil * .2;
    }
    for (const a of this.livingWorkers()) if (Math.floor(a.y) >= w.surface) w.waste[this.cell(a)] += .001 * dt;
    w.diffuse(w.homeScent, dt, .12, .55);
    w.diffuse(w.foodScent, dt, .18, .55);
    w.homeScent[w.entrance] = 1;
    if (this.queen.alive) w.homeScent[this.cell(this.queen)] = 1;
    for (const i of w.sources) if (w.food[i] > .1) w.foodScent[i] = Math.min(1, w.foodScent[i] + .3 * dt);
    for (const i of w.pantries) w.foodScent[i] = Math.min(1, w.foodScent[i] + .2 * dt);
    if (w.version !== this.lastExcavated) { w.refreshAir(); this.lastExcavated = w.version; }
  }

  step(dt = 1 / 30) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1) throw new RangeError('Simulation steps must be in (0, 0.1] seconds. Use FixedClock for elapsed time.');
    this.time += dt;
    this.tick++;
    this.updateBrood(dt);
    // Iterate a stable snapshot: births and removals cannot skip another ant.
    for (const a of [...this.ants]) {
      if (!a.alive) continue;
      a.age += dt;
      if (this.options.starvation) a.energy = Math.max(0, a.energy - dt * (a.type === 'queen' ? .025 : .055));
      if (a.age >= a.lifespan || a.energy <= 0) { this.kill(a); continue; }
      if (a.type === 'queen') continue;
      if (a.energy < 12 && a.task && !['eat', 'eatLoose'].includes(a.task.kind)) {
        if (a.cargo > 0) a.cargo -= this.eat(a, a.cargo);
        this.cancelTask(a, { dropCargo: true });
      }
      if (!a.task && this.time >= a.retryAt) {
        this.allocate(a);
        if (!a.task) a.retryAt = this.time + .5;
      }
      const t = a.task;
      if (!t) continue;
      if (this.time - t.lastProgress > 30 && t.phase !== 'waiting') {
        this.cancelTask(a, { dropCargo: true }); continue;
      }
      if (this.move(a, t, dt) && a.task === t) {
        this.interact(a, dt);
        if (a.task === t) t.lastProgress = this.time;
      }
    }
    this.updateQueen(dt);
    this.ants = this.ants.filter(a => a.alive);
    this.environmentTimer += dt;
    this.planTimer += dt;
    if (this.environmentTimer >= .5 - 1e-8) { this.environment(this.environmentTimer); this.environmentTimer = 0; }
    if (this.planTimer >= 1 - 1e-8) { this.updateConstruction(); this.planTimer = 0; }
  }

  snapshot() {
    const workers = this.livingWorkers();
    return { seed: this.world.seed, time: Math.round(this.time * 100) / 100,
      workers: workers.length, queenAlive: this.queen.alive,
      queenEnergy: Math.round(this.queen.energy * 100) / 100,
      chamberReady: this.chamberReady, food: Math.round(this.world.storedFood * 100) / 100,
      brood: this.brood.length, corpses: this.corpses.length,
      jobs: workers.reduce((r, a) => { const k = a.task?.kind || 'idle'; r[k] = (r[k] || 0) + 1; return r; }, {}),
      metrics: { ...this.metrics }, pressure: this.pressures(), expansions: this.expansions };
  }

  inspect() {
    const errors = [], w = this.world;
    const liveIds = new Set(this.ants.filter(a => a.alive).map(a => a.id));
    for (const a of this.ants) {
      if (!a.alive) errors.push(`Dead ant ${a.id} retained as living.`);
      if (!Number.isFinite(a.x + a.y + a.energy) || a.energy < 0 || a.energy > 100.00001) errors.push(`Invalid ant ${a.id}.`);
      if (w.grid[this.cell(a)] !== OPEN) errors.push(`Ant ${a.id} inside solid terrain.`);
      if (a.cargo < -1e-8) errors.push(`Negative cargo ${a.id}.`);
      if (a.carryingBrood !== null && !this.brood.some(b => b.id === a.carryingBrood && b.carrier === a.id)) errors.push(`Dangling brood on ant ${a.id}.`);
    }
    for (const b of this.brood) {
      if (w.grid[b.cell] !== OPEN) errors.push(`Brood ${b.id} inside solid terrain.`);
      if (b.carrier !== null && !this.ants.some(a => a.alive && a.id === b.carrier && a.carryingBrood === b.id && a.task?.kind === 'transport')) errors.push(`Orphan carrier for brood ${b.id}.`);
    }
    for (const [key, id] of this.claims) {
      if (!liveIds.has(id) || !this.ants.find(a => a.id === id)?.task?.claims.includes(key)) errors.push(`Orphan claim ${key}.`);
    }
    for (const i of w.pantries) if (w.stores[i] <= 0) errors.push(`Empty pantry membership ${i}.`);
    for (let i = 0; i < w.grid.length; i++) {
      if (w.food[i] < -1e-8 || w.stores[i] < -1e-8 || w.waste[i] < -1e-8 || w.stores[i] > 10.00001) errors.push(`Invalid inventory at ${i}.`);
      if (w.stores[i] > 0 && !w.pantries.has(i)) errors.push(`Unregistered stored food ${i}.`);
    }
    const inventory = w.food.reduce((a, b) => a + b, 0) + w.storedFood + this.ants.reduce((a, b) => a + b.cargo, 0);
    const balance = this.metrics.foodCreated - this.metrics.foodConsumed - this.metrics.foodSpoiled - inventory;
    if (Math.abs(balance) > .0001) errors.push(`Food ledger differs by ${balance}.`);
    return errors;
  }
}
