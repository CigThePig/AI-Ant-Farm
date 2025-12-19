const AirSystem = (() => {
  const SETTINGS = {
    stepFalloff: 0.88,
    propagationBudget: 600,
    minLevel: 0.01,
    reseedInterval: 180,
    neighborBonus: 0.05,
  };

  let width = 0;
  let height = 0;
  let regionSplit = 0;

  let airLevels = [];
  let queue = [];
  let reseedCounter = 0;
  let enqueuedWhileEmpty = false;

  function init(constants) {
    width = constants.GRID_W;
    height = constants.GRID_H;
    regionSplit = constants.REGION_SPLIT;

    airLevels = new Array(height);
    for (let y = 0; y < height; y++) {
      airLevels[y] = new Float32Array(width);
    }

    queue.length = 0;
    reseedCounter = 0;
    enqueuedWhileEmpty = false;
  }

  function isOpen(tile) {
    return tile !== TILES.SOIL && tile !== TILES.BEDROCK;
  }

  function enqueue(x, y, level, { markEnqueue = true } = {}) {
    if (level <= airLevels[y][x] + 0.001) return;
    const wasEmpty = queue.length === 0;
    airLevels[y][x] = level;
    queue.push({ x, y, level });
    if (wasEmpty && markEnqueue) enqueuedWhileEmpty = true;
  }

  function seedSurface(grid, { clearQueue = true } = {}) {
    if (clearQueue) queue.length = 0;
    for (let y = 1; y <= regionSplit; y++) {
      const row = grid[y];
      for (let x = 1; x < width - 1; x++) {
        if (isOpen(row[x])) enqueue(x, y, 1.0, { markEnqueue: false });
      }
    }
  }

  function notifyTileOpened(x, y, grid) {
    if (x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1) return;
    if (!grid[y] || !isOpen(grid[y][x])) return;

    if (y < regionSplit) {
      enqueue(x, y, 1.0);
      return;
    }

    let best = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
      if (!grid[ny] || grid[ny][nx] === undefined) continue;
      if (!isOpen(grid[ny][nx])) continue;
      const candidate = airLevels[ny][nx] * SETTINGS.stepFalloff + SETTINGS.neighborBonus;
      if (candidate > best) best = candidate;
    }

    if (best > 0) enqueue(x, y, best);
  }

  function updateAirField(world) {
    const grid = world.grid;
    if (!grid || !grid.length) return;

    const queueWasEmptyAtStart = queue.length === 0;

    if (queueWasEmptyAtStart || reseedCounter >= SETTINGS.reseedInterval) {
      seedSurface(grid);
      reseedCounter = 0;
      enqueuedWhileEmpty = false;
    } else if (enqueuedWhileEmpty) {
      seedSurface(grid, { clearQueue: false });
      reseedCounter = 0;
      enqueuedWhileEmpty = false;
    }

    reseedCounter++;

    let budget = SETTINGS.propagationBudget;
    while (budget > 0 && queue.length > 0) {
      const { x, y, level } = queue.pop();
      const next = level * SETTINGS.stepFalloff;
      if (next < SETTINGS.minLevel) {
        budget--;
        continue;
      }

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx <= 0 || nx >= width - 1 || ny <= 0 || ny >= height - 1) continue;
        if (!isOpen(grid[ny][nx])) continue;
        const candidate = next + SETTINGS.neighborBonus;
        if (candidate > airLevels[ny][nx] + 0.001) {
          airLevels[ny][nx] = candidate;
          queue.push({ x: nx, y: ny, level: candidate });
        }
        budget--;
        if (budget <= 0) break;
      }
    }
  }

  function reset(world) {
    for (let y = 0; y < height; y++) airLevels[y].fill(0);
    queue.length = 0;
    reseedCounter = 0;
    enqueuedWhileEmpty = false;
    seedSurface(world.grid);
    world.airLevels = airLevels;
  }

  return {
    init,
    reset,
    updateAirField,
    notifyTileOpened,
    getAirLevels: () => airLevels,
  };
})();
