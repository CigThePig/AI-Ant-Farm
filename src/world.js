import { OPEN, ROCK, SOIL, neighbors } from './navigation.js';
export function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export class World {
  constructor({
    seed = 42,
    width = 96,
    height = 80,
    resources = true,
    scenario = 'established',
  } = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 40 || height < 45)
      throw new RangeError('World must be at least 40 × 45 cells.');
    this.seed = Number(seed) >>> 0;
    this.random = seededRandom(seed);
    this.width = width;
    this.height = height;
    this.surface = Math.floor(height * 0.3);
    this.grid = new Uint8Array(width * height).fill(SOIL);
    this.food = new Float64Array(this.grid.length);
    this.protein = new Float64Array(this.grid.length);
    this.trail = new Float64Array(this.grid.length);
    this.quality = new Float64Array(this.grid.length).fill(1);
    this.soilWork = new Float64Array(this.grid.length);
    this.depositedSoil = new Float64Array(this.grid.length);
    this.sources = new Set();
    this.excavated = 0;
    this.version = 0;
    this.entrance = this.index(Math.floor(width / 2), this.surface - 1);
    this.chamber = this.index(Math.floor(width / 2), this.surface + 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = this.index(x, y);
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) this.grid[i] = ROCK;
        else if (y < this.surface) this.grid[i] = OPEN;
      }
    // An initial cavity is a boundary condition, never a future construction blueprint.
    for (let y = this.surface; y <= this.surface + 4; y++)
      this.grid[this.index(Math.floor(width / 2), y)] = OPEN;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -2; dx <= 2; dx++) this.grid[this.chamber + dy * width + dx] = OPEN;
    if (scenario === 'founding') this.grid[this.entrance] = SOIL; // sealed claustral cavity
    if (resources)
      for (const side of [-1, 1])
        for (let patch = 0; patch < 3; patch++) {
          const x = Math.floor(width / 2) + side * (8 + patch * 7),
            y = this.surface - 3 - Math.floor(this.random() * Math.max(1, this.surface - 8));
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++) {
              const i = this.index(x + dx, y + dy);
              if (this.grid[i] !== OPEN) continue;
              this.food[i] = 200;
              this.protein[i] = patch === 0 ? 80 : 0;
              this.sources.add(i);
            }
        }
  }
  index(x, y) {
    return y * this.width + x;
  }
  cell(x, y) {
    return this.index(Math.floor(x), Math.floor(y));
  }
  center(i) {
    return { x: (i % this.width) + 0.5, y: Math.floor(i / this.width) + 0.5 };
  }
  adjacent(i) {
    return neighbors(i, this.width, this.height);
  }
  dig(i) {
    if (this.grid[i] !== SOIL || !this.adjacent(i).some((n) => this.grid[n] === OPEN)) return false;
    this.grid[i] = OPEN;
    this.excavated++;
    this.version++;
    return true;
  }
  decay(dt, p) {
    const factor = Math.exp((-Math.LN2 * dt) / p.trailHalfLifeSeconds);
    for (let i = 0; i < this.trail.length; i++) this.trail[i] *= factor;
  }
}
