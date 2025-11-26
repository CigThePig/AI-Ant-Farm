const DiggingSystem = (() => {
  const SETTINGS = {
    pheromoneDeposit: 0.9,
    neighborDeposit: 0.35,
    decay: 0.995,
    minStrength: 0.01,
    sampleRadius: 8,
    forwardBias: 0.65,
  };

  let width = 0;
  let height = 0;
  let regionSplit = 0;
  let cellSize = 1;

  let digPheromone = [];
  let frontierMask = [];
  let frontierList = [];

  function init(constants) {
    width = constants.GRID_W;
    height = constants.GRID_H;
    regionSplit = constants.REGION_SPLIT;
    cellSize = constants.CELL_SIZE;

    digPheromone = new Array(height);
    frontierMask = new Array(height);
    for (let y = 0; y < height; y++) {
      digPheromone[y] = new Float32Array(width);
      frontierMask[y] = new Uint8Array(width);
    }
    frontierList = [];
  }

  function isFrontierCell(x, y, grid) {
    if (y < regionSplit || x <= 0 || x >= width - 1 || y >= height - 1) return false;
    if (grid[y][x] !== TILES.SOIL) return false;

    return (
      grid[y - 1][x] === TILES.TUNNEL ||
      grid[y + 1][x] === TILES.TUNNEL ||
      grid[y][x - 1] === TILES.TUNNEL ||
      grid[y][x + 1] === TILES.TUNNEL
    );
  }

  function addFrontier(x, y, grid) {
    if (frontierMask[y][x]) return;
    if (!isFrontierCell(x, y, grid)) return;

    frontierMask[y][x] = 1;
    frontierList.push({ x, y });
    digPheromone[y][x] = Math.max(digPheromone[y][x], SETTINGS.pheromoneDeposit);
  }

  function rebuildFrontier(grid) {
    frontierList.length = 0;
    for (let y = 0; y < height; y++) frontierMask[y].fill(0);
    for (let y = regionSplit; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        addFrontier(x, y, grid);
      }
    }
  }

  function updateFrontierTiles(world) {
    const grid = world.grid;
    for (let y = regionSplit; y < height; y++) {
      const row = digPheromone[y];
      for (let x = 0; x < width; x++) {
        const v = row[x];
        row[x] = v > SETTINGS.minStrength ? v * SETTINGS.decay : 0;
      }
    }

    // prune invalid frontier markers
    for (let i = frontierList.length - 1; i >= 0; i--) {
      const { x, y } = frontierList[i];
      if (!isFrontierCell(x, y, grid)) {
        frontierMask[y][x] = 0;
        frontierList.splice(i, 1);
      }
    }
  }

  function chooseDigTarget(ant, world) {
    if (ant.hasFood) return null;
    if (ant.y < regionSplit * cellSize) return null;

    const cx = Math.floor(ant.x / cellSize);
    const cy = Math.floor(ant.y / cellSize);
    const radius = SETTINGS.sampleRadius;
    let best = null;
    let bestScore = 0;

    for (let y = Math.max(regionSplit, cy - radius); y <= Math.min(height - 2, cy + radius); y++) {
      for (let x = Math.max(1, cx - radius); x <= Math.min(width - 2, cx + radius); x++) {
        if (!frontierMask[y][x]) continue;
        const pher = digPheromone[y][x];
        if (pher < SETTINGS.minStrength) continue;

        const tx = (x + 0.5) * cellSize;
        const ty = (y + 0.5) * cellSize;
        const dx = tx - ant.x;
        const dy = ty - ant.y;
        const dist = Math.hypot(dx, dy);
        const alignment = Math.cos(Math.atan2(dy, dx) - ant.angle);
        const facingBoost = 1 + SETTINGS.forwardBias * Math.max(0, alignment);
        const distancePenalty = 1 + dist / (cellSize * 3);

        const score = (pher * facingBoost) / distancePenalty;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }

    return best;
  }

  function reinforceNeighbors(gx, gy, grid) {
    addFrontier(gx - 1, gy, grid);
    addFrontier(gx + 1, gy, grid);
    addFrontier(gx, gy - 1, grid);
    addFrontier(gx, gy + 1, grid);
  }

  function applyDigAction(ant, world, gx, gy) {
    const grid = world.grid;
    if (!grid[gy] || grid[gy][gx] !== TILES.SOIL) return false;

    grid[gy][gx] = TILES.TUNNEL;
    digPheromone[gy][gx] = 0;
    frontierMask[gy][gx] = 0;

    // reinforce nearby frontier directions so others follow the same face
    for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
      if (grid[ny] && grid[ny][nx] === TILES.SOIL) {
        digPheromone[ny][nx] = Math.max(digPheromone[ny][nx], SETTINGS.neighborDeposit);
      }
    }

    reinforceNeighbors(gx, gy, grid);
    if (typeof world.onTunnelDug === 'function') world.onTunnelDug(gx, gy);
    if (typeof world.spawnDigParticles === 'function') world.spawnDigParticles(gx, gy);

    ant.digTarget = null;
    return true;
  }

  function reset(world) {
    const grid = world.grid;
    for (let y = 0; y < height; y++) digPheromone[y].fill(0);
    rebuildFrontier(grid);
  }

  return {
    init,
    reset,
    updateFrontierTiles,
    chooseDigTarget,
    applyDigAction,
    getDigPheromone: () => digPheromone,
  };
})();
