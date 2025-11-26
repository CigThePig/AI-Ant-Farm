const DiggingSystem = (() => {
  const SETTINGS = {
    pheromoneDeposit: 0.9,
    pheromoneBurst: 1.25,
    neighborDeposit: 0.35,
    decay: 0.995,
    minStrength: 0.01,
    sampleRadius: 8,
    forwardBias: 0.65,
    frontierSampleCount: 32,
    frontierQueueBudget: 120,
    decayRowsPerTick: 6,
    baseTileHP: 3.2,
    hardnessJitter: 1.4,
    depthHardness: 1.0,
    digDamage: 1.0,
  };

  let width = 0;
  let height = 0;
  let regionSplit = 0;
  let cellSize = 1;

  let digPheromone = [];
  let digHP = [];
  let frontierMask = [];
  let frontierList = [];
  let frontierUpdateMask = [];
  let frontierUpdateQueue = [];
  const sharedFrontierTiles = { list: frontierList, mask: frontierMask };
  let decayCursor = 0;

  function init(constants) {
    width = constants.GRID_W;
    height = constants.GRID_H;
    regionSplit = constants.REGION_SPLIT;
    cellSize = constants.CELL_SIZE;

    digPheromone = new Array(height);
    digHP = new Array(height);

    frontierMask.length = 0;
    frontierUpdateMask.length = 0;
    for (let y = 0; y < height; y++) {
      digPheromone[y] = new Float32Array(width);
      digHP[y] = new Float32Array(width);
      frontierMask[y] = new Uint8Array(width);
      frontierUpdateMask[y] = new Uint8Array(width);
    }

    frontierList.length = 0;
    frontierUpdateQueue.length = 0;
    decayCursor = regionSplit;
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

  function removeFrontierFromList(x, y) {
    for (let i = frontierList.length - 1; i >= 0; i--) {
      if (frontierList[i].x === x && frontierList[i].y === y) {
        frontierList.splice(i, 1);
        return;
      }
    }
  }

  function clearFrontier(x, y) {
    if (!frontierMask[y][x]) return;
    frontierMask[y][x] = 0;
    digPheromone[y][x] = 0;
    removeFrontierFromList(x, y);
  }

  function enqueueFrontierNeighborhood(cx, cy, radius = 1) {
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(height - 1, cy + radius);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (frontierUpdateMask[y][x]) continue;
        frontierUpdateMask[y][x] = 1;
        frontierUpdateQueue.push({ x, y });
      }
    }
  }

  function refreshFrontierCell(x, y, grid) {
    if (!grid[y]) return;
    if (y < regionSplit || x <= 0 || x >= width - 1 || y >= height - 1) {
      clearFrontier(x, y);
      return;
    }

    if (isFrontierCell(x, y, grid)) {
      addFrontier(x, y, grid);
    } else {
      clearFrontier(x, y);
    }
  }

  function processFrontierQueue(grid) {
    let remaining = SETTINGS.frontierQueueBudget;
    while (remaining > 0 && frontierUpdateQueue.length > 0) {
      const { x, y } = frontierUpdateQueue.pop();
      frontierUpdateMask[y][x] = 0;
      refreshFrontierCell(x, y, grid);
      remaining--;
    }
  }

  function decayPheromoneBudget() {
    for (let i = 0; i < SETTINGS.decayRowsPerTick; i++) {
      if (decayCursor < regionSplit || decayCursor >= height) decayCursor = regionSplit;
      const row = digPheromone[decayCursor];
      for (let x = 0; x < width; x++) {
        const v = row[x];
        row[x] = v > SETTINGS.minStrength ? v * SETTINGS.decay : 0;
      }
      decayCursor++;
      if (decayCursor >= height) decayCursor = regionSplit;
    }
  }

  function rebuildFrontier(grid) {
    frontierList.length = 0;
    for (let y = 0; y < height; y++) frontierMask[y].fill(0);
    for (let y = 0; y < height; y++) frontierUpdateMask[y].fill(0);
    frontierUpdateQueue.length = 0;
    for (let y = regionSplit; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        addFrontier(x, y, grid);
      }
    }
  }

  function updateFrontierTiles(world) {
    processFrontierQueue(world.grid);
    decayPheromoneBudget();
  }

  function chooseDigTarget(ant, world) {
    if (ant.hasFood || !ant.isDigger) return null;
    if (ant.y < regionSplit * cellSize) return null;

    const frontier = world.frontierTiles;
    if (!frontier || !frontier.list.length) return null;

    const queen = (typeof ants !== "undefined" && ants[0]) ? ants[0] : null;
    const qx = queen ? queen.x : ant.x;
    const qy = queen ? queen.y : ant.y;

    let best = null;
    let bestScore = -Infinity;
    const samples = Math.min(SETTINGS.frontierSampleCount, frontier.list.length);

    for (let i = 0; i < samples; i++) {
      const tile = frontier.list[Math.floor(Math.random() * frontier.list.length)];
      const { x, y } = tile;
      if (!frontierMask[y][x]) continue;

      const tx = (x + 0.5) * cellSize;
      const ty = (y + 0.5) * cellSize;
      const depthNorm = Math.max(0, (y - regionSplit) / Math.max(1, height - regionSplit));
      const upwardBias = 1 + (1 - depthNorm) * 0.9;

      const pher = digPheromone[y][x];
      const pherBonus = 1 + pher * 2.5;

      const nestDist = Math.hypot(tx - qx, ty - qy);
      const nestPenalty = 1 + nestDist / (cellSize * 10);

      const antDist = Math.hypot(tx - ant.x, ty - ant.y);
      const antPenalty = 1 + antDist / (cellSize * 4);

      const noise = Math.random() * 0.05;
      const score = (upwardBias * pherBonus) / (nestPenalty * antPenalty) + noise;

      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
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

  function seededNoise(x, y) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + 0.5) * 43758.5453;
    return s - Math.floor(s);
  }

  function computeTileHP(x, y, grid) {
    if (grid[y][x] !== TILES.SOIL) return 0;
    const depthNorm = Math.max(0, (y - regionSplit) / Math.max(1, height - regionSplit));
    const noise = seededNoise(x, y) - 0.5;
    const hp =
      SETTINGS.baseTileHP +
      SETTINGS.depthHardness * depthNorm +
      SETTINGS.hardnessJitter * noise;
    return Math.max(SETTINGS.digDamage, hp);
  }

  function depositBurst(cx, cy, radius, strength, grid) {
    const minX = Math.max(0, cx - radius);
    const maxX = Math.min(width - 1, cx + radius);
    const minY = Math.max(0, cy - radius);
    const maxY = Math.min(height - 1, cy + radius);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (grid[y][x] !== TILES.SOIL) continue;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > radius + 0.01) continue;
        const falloff = Math.max(0, 1 - dist / (radius || 1));
        const deposit = strength * falloff;
        if (deposit > digPheromone[y][x]) digPheromone[y][x] = deposit;
      }
    }
  }

  function applyDigAction(ant, world, gx, gy) {
    const grid = world.grid;
    if (!grid[gy] || grid[gy][gx] !== TILES.SOIL) return false;

    digHP[gy][gx] -= SETTINGS.digDamage;
    if (digHP[gy][gx] > 0) {
      digPheromone[gy][gx] = Math.max(digPheromone[gy][gx], SETTINGS.neighborDeposit);
      return true;
    }

    grid[gy][gx] = TILES.TUNNEL;
    digHP[gy][gx] = 0;
    digPheromone[gy][gx] = 0;
    frontierMask[gy][gx] = 0;

    // reinforce nearby frontier directions so others follow the same face
    for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
      if (grid[ny] && grid[ny][nx] === TILES.SOIL) {
        digPheromone[ny][nx] = Math.max(digPheromone[ny][nx], SETTINGS.neighborDeposit);
      }
    }

    depositBurst(gx, gy, 2, SETTINGS.pheromoneBurst, grid);

    reinforceNeighbors(gx, gy, grid);
    enqueueFrontierNeighborhood(gx, gy, 2);
    if (typeof world.onTunnelDug === 'function') world.onTunnelDug(gx, gy);
    if (typeof world.spawnDigParticles === 'function') world.spawnDigParticles(gx, gy);

    ant.digTarget = null;
    return true;
  }

  function reset(world) {
    const grid = world.grid;
    for (let y = 0; y < height; y++) digPheromone[y].fill(0);
    for (let y = 0; y < height; y++) {
      const hpRow = digHP[y];
      for (let x = 0; x < width; x++) {
        hpRow[x] = computeTileHP(x, y, grid);
      }
    }
    for (let y = 0; y < height; y++) frontierUpdateMask[y].fill(0);
    frontierUpdateQueue.length = 0;
    decayCursor = regionSplit;
    rebuildFrontier(grid);

    world.frontierTiles = sharedFrontierTiles;
  }

  return {
    init,
    reset,
    updateFrontierTiles,
    chooseDigTarget,
    applyDigAction,
    notifyTileChanged: enqueueFrontierNeighborhood,
    getDigPheromone: () => digPheromone,
  };
})();
