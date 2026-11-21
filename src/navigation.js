// Cardinal lattice geometry. The global route utility is not called by biological agents.
export const SOIL = 1,
  OPEN = 2,
  ROCK = 3;

export function neighbors(index, width, height) {
  const x = index % width,
    y = Math.floor(index / width),
    out = [];
  if (y > 0) out.push(index - width);
  if (x > 0) out.push(index - 1);
  if (x + 1 < width) out.push(index + 1);
  if (y + 1 < height) out.push(index + width);
  return out;
}

// Find the closest reachable member of a goal set. A start already on a goal
// deliberately returns []: a stationary ant must still execute its interaction.
export function route(world, start, goals) {
  if (!goals.size || world.grid[start] !== OPEN) return null;
  if (goals.has(start)) return [];
  const prev = new Int32Array(world.grid.length).fill(-1);
  const queue = new Int32Array(world.grid.length);
  let head = 0,
    tail = 1;
  queue[0] = start;
  prev[start] = start;
  while (head < tail) {
    const current = queue[head++];
    for (const next of neighbors(current, world.width, world.height)) {
      if (prev[next] !== -1 || world.grid[next] !== OPEN) continue;
      prev[next] = current;
      if (goals.has(next)) {
        const path = [];
        for (let at = next; at !== start; at = prev[at]) path.push(at);
        return path.reverse();
      }
      queue[tail++] = next;
    }
  }
  return null;
}

export function distance(world, a, b) {
  return Math.hypot(
    (a % world.width) - (b % world.width),
    Math.floor(a / world.width) - Math.floor(b / world.width),
  );
}
