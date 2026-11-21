import { OPEN, ROCK, SOIL, neighbors } from './navigation.js';

export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class World {
  constructor({ seed = 42, width = 96, height = 80 } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 40 || height < 45) {
      throw new RangeError('World dimensions must be integers of at least 40 × 45.');
    }
    this.seed = Number(seed) >>> 0;
    this.random = seededRandom(this.seed);
    this.width = width;
    this.height = height;
    this.surface = Math.floor(height * .3);
    this.grid = new Uint8Array(width * height).fill(SOIL);
    this.food = new Float64Array(this.grid.length);
    this.stores = new Float64Array(this.grid.length);
    this.waste = new Float64Array(this.grid.length);
    this.homeScent = new Float32Array(this.grid.length);
    this.foodScent = new Float32Array(this.grid.length);
    this.air = new Float32Array(this.grid.length);
    this.sources = new Set();
    this.pantries = new Set();
    this.plan = new Set();
    this.room = new Set();
    this.excavated = 0;
    this.version = 0;
    this.entrance = this.index(Math.floor(width / 2), this.surface - 1);
    this.chamber = this.index(Math.floor(width / 2), this.surface + 12);
    this.dump = this.index(Math.floor(width / 2) + 9, this.surface - 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = this.index(x, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) this.grid[i] = ROCK;
        else if (y < this.surface) this.grid[i] = OPEN;
      }
    }
    this.grid[this.entrance + width] = OPEN;
    for (let y = this.surface; y <= this.surface + 12; y++) {
      this.plan.add(this.index(Math.floor(width / 2), y));
    }
    this.addRoom(this.chamber, 5, this.room);
    // Keep near and far food patches, so every founding seed has accessible food.
    for (const side of [-1, 1]) {
      for (let patch = 0; patch < 3; patch++) {
        const x = Math.floor(width / 2) + side * (9 + patch * 8);
        const y = this.surface - 5 - Math.floor(this.random() * (this.surface - 9));
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (x + dx <= 0 || x + dx >= width - 1 || y + dy <= 0 || y + dy >= this.surface) continue;
          const i = this.index(x + dx, y + dy);
          if (this.grid[i] === OPEN) {
            this.sources.add(i);
            this.food[i] = 8 + this.random() * 8;
          }
        }
      }
    }
    this.refreshAir();
  }

  index(x, y) { return y * this.width + x; }
  cell(x, y) { return this.index(Math.floor(x), Math.floor(y)); }
  center(i) { return { x: i % this.width + .5, y: Math.floor(i / this.width) + .5 }; }
  adjacent(i) { return neighbors(i, this.width, this.height); }

  addRoom(center, radius, destination = new Set()) {
    const cx = center % this.width, cy = Math.floor(center / this.width);
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x <= 0 || y < this.surface || x >= this.width - 1 || y >= this.height - 1) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
        const i = this.index(x, y);
        if (this.grid[i] === ROCK) continue;
        destination.add(i);
        this.plan.add(i);
      }
    }
    return destination;
  }

  // Growth follows an explicit connected branch. Existing ancestry never blocks it.
  extendBranch(center, offsetX, offsetY, radius = 3) {
    const targetX = Math.max(5, Math.min(this.width - 6, center % this.width + offsetX));
    const targetY = Math.max(this.surface + 3, Math.min(this.height - 6,
      Math.floor(center / this.width) + offsetY));
    let x = center % this.width, y = Math.floor(center / this.width);
    while (x !== targetX || y !== targetY) {
      if (x !== targetX) x += Math.sign(targetX - x);
      else y += Math.sign(targetY - y);
      const i = this.index(x, y);
      if (this.grid[i] !== ROCK) this.plan.add(i);
    }
    return this.addRoom(this.index(targetX, targetY), radius);
  }

  dig(i) {
    if (this.grid[i] !== SOIL || !this.adjacent(i).some(n => this.grid[n] === OPEN)) return false;
    this.grid[i] = OPEN;
    this.excavated++;
    this.version++;
    this.plan.delete(i);
    return true;
  }

  addStored(i, amount) {
    if (this.grid[i] !== OPEN || Math.floor(i / this.width) < this.surface) return 0;
    const added = Math.max(0, Math.min(amount, 10 - this.stores[i]));
    this.stores[i] += added;
    if (this.stores[i] > 0) this.pantries.add(i);
    return added;
  }

  takeStored(i, amount) {
    const taken = Math.max(0, Math.min(amount, this.stores[i]));
    this.stores[i] -= taken;
    if (this.stores[i] < 1e-10) { this.stores[i] = 0; this.pantries.delete(i); }
    return taken;
  }

  get storedFood() { let total = 0; for (const i of this.pantries) total += this.stores[i]; return total; }

  refreshAir() {
    this.air.fill(0);
    const queue = new Int32Array(this.grid.length);
    let head = 0, tail = 0;
    for (let y = 1; y < this.surface; y++) for (let x = 1; x < this.width - 1; x++) {
      const i = this.index(x, y);
      if (this.grid[i] === OPEN) { this.air[i] = 1; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      for (const n of this.adjacent(i)) {
        if (this.grid[n] !== OPEN || this.air[n] !== 0) continue;
        this.air[n] = this.air[i] * .9;
        queue[tail++] = n;
      }
    }
  }

  diffuse(field, dt, decay, spread) {
    const next = new Float32Array(field.length);
    for (let i = 0; i < field.length; i++) {
      if (this.grid[i] !== OPEN) continue;
      let sum = 0, count = 0;
      for (const n of this.adjacent(i)) {
        if (this.grid[n] === OPEN) { sum += field[n]; count++; }
      }
      const value = field[i] + (count ? sum / count - field[i] : 0) * spread * dt;
      next[i] = Math.max(0, value * Math.exp(-decay * dt));
    }
    field.set(next);
  }
}
