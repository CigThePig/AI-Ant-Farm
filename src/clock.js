// Rendering never changes the simulation step. Slow frames retain their debt;
// callers can spread catch-up over subsequent frames without losing sim time.
export class FixedClock {
  constructor(step, { hz = 30, maxSteps = 240 } = {}) {
    this.step = step;
    this.dt = 1 / hz;
    this.maxSteps = maxSteps;
    this.accumulator = 0;
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 0;
    this.accumulator += seconds;
    let count = 0;
    while (this.accumulator + 1e-10 >= this.dt && count < this.maxSteps) {
      this.step(this.dt);
      this.accumulator -= this.dt;
      count++;
    }
    return count;
  }
  reset() {
    this.accumulator = 0;
  }
}
