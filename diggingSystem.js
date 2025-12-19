const DiggingSystem = (() => {
  const SETTINGS = {
    pheromoneDeposit: 0.9,
    directionalPheromoneStrength: 1.25,
    directionalPheromoneLength: 4,
    directionalSideFalloff: 0.35,
    directionalBackStrength: 0.1,
    neighborDeposit: 0.35,
    decay: 0.995,
    minStrength: 0.01,
    sampleRadius: 8,
    maxSampleRadius: 22,
    sampleRadiusStep: 4,
    forwardBias: 0.65,
    headingAheadBias: 0.9,
    headingGain: 0.5,
    corridorEndpointBonus: 2.4,
    corridorBranchPenalty: 0.45,
    corridorBranchChance: 0.12,
    corridorBalloonPenalty: 0.08,
    roomNeighborPenalty: 0.6,
    roomNeighborBonus: 1.35,
    roomCenterBias: 3.5,
    frontierSampleCount: 32,
    frontierQueueBudget: 120,
    decayRowsPerTick: 6,
    baseTileHP: 3.5,
    hardnessJitter: 0.2,
    depthHardness: 1.0,
    digDamage: 1.0,
  };

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const isOpenTile = (tile) => tile === TILES.TUNNEL || tile === TILES.AIR;

  let headingNaNWarningIssued = false;
  const warnHeadingNaNOnce = (context) => {
    if (headingNaNWarningIssued) return;
    headingNaNWarningIssued = true;
    if (typeof CONFIG !== "undefined" && CONFIG?.devMode === false) return;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[diggingSystem] Invalid heading vector in chooseDigTarget", context);
    }
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
      isOpenTile(grid[y - 1][x]) ||
      isOpenTile(grid[y + 1][x]) ||
      isOpenTile(grid[y][x - 1]) ||
      isOpenTile(grid[y][x + 1])
    );
  }

  function countTunnelNeighbors4(gx, gy, grid) {
    let neighbors = 0;
    if (isOpenTile(grid[gy - 1]?.[gx])) neighbors++;
    if (isOpenTile(grid[gy + 1]?.[gx])) neighbors++;
    if (isOpenTile(grid[gy]?.[gx - 1])) neighbors++;
    if (isOpenTile(grid[gy]?.[gx + 1])) neighbors++;
    return neighbors;
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

  function collectFrontierCandidates(cx, cy, radius, grid) {
    const candidates = [];
    const minX = Math.max(1, cx - radius);
    const maxX = Math.min(width - 2, cx + radius);
    const minY = Math.max(regionSplit, cy - radius);
    const maxY = Math.min(height - 2, cy + radius);

    for (let y = minY; y <= maxY; y++) {
      const frontierRow = frontierMask[y];
      const gridRow = grid[y];
      if (!frontierRow || !gridRow) continue;
      for (let x = minX; x <= maxX; x++) {
        if (frontierRow[x] && gridRow[x] === TILES.SOIL) {
          candidates.push({ x, y });
        }
      }
    }
    return candidates;
  }

  function findReachableTunnelNear(center, radius, grid, start) {
    if (!center || !grid || !start) return null;
    const visited = new Set();
    const queue = [start];
    visited.add(start.gy * width + start.gx);
    const radius2 = (radius + 0.5) * (radius + 0.5);
    const maxChecks = Math.min(width * height, 6000);
    let checks = 0;

    while (queue.length && checks < maxChecks) {
      const node = queue.shift();
      checks++;
      const dx = node.gx - center.gx;
      const dy = node.gy - center.gy;
      if (dx * dx + dy * dy <= radius2 && isOpenTile(grid[node.gy]?.[node.gx])) return node;

      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [ox, oy] of neighbors) {
        const nx = node.gx + ox;
        const ny = node.gy + oy;
        if (nx <= 0 || nx >= width - 1 || ny <= regionSplit || ny >= height - 1) continue;
        if (!isOpenTile(grid[ny]?.[nx])) continue;
        const key = ny * width + nx;
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ gx: nx, gy: ny });
      }
    }
    return null;
  }

  function findNurseryFrontier(center, bandInner, bandOuter, grid, wasteGrid) {
    if (!center || !grid) return null;
    const searchRadius = Math.max(bandOuter + 6, SETTINGS.sampleRadius);
    let candidates = collectFrontierCandidates(center.gx, center.gy, searchRadius, grid);
    if (!candidates.length) return null;

    const targetRadius = bandOuter + 1.5;
    const minRadius = Math.max(1, bandInner - 1);
    const maxRadius = bandOuter + 4;

    let best = null;
    let bestScore = -Infinity;
    for (const tile of candidates) {
      const dx = tile.x - center.gx;
      const dy = tile.y - center.gy;
      const dist = Math.hypot(dx, dy);
      if (dist < minRadius || dist > maxRadius) continue;

      const ringDelta = Math.abs(dist - targetRadius);
      const neighborCount = countTunnelNeighbors4(tile.x, tile.y, grid);
      const neighborBonus = neighborCount === 1 ? 0.8 : neighborCount === 2 ? 0.45 : -0.5;
      const entranceDist = Math.hypot(tile.x - NEST_ENTRANCE.gx, tile.y - NEST_ENTRANCE.gy);
      const entrancePenalty = 0.4 / Math.max(1, entranceDist);
      const wastePenalty = wasteGrid?.[tile.y]?.[tile.x] ?? 0;
      const depthBonus = Math.max(0, (tile.y - regionSplit) / Math.max(1, height - regionSplit)) * 0.3;

      const score = -ringDelta * 0.9 + neighborBonus - entrancePenalty - wastePenalty * 0.35 + depthBonus;
      if (score > bestScore) {
        bestScore = score;
        best = tile;
      }
    }

    return best ? { anchor: best, center, targetRadius } : null;
  }

  function findPantryFrontier(pantry, center, grid, queen) {
    if (!pantry || !pantry.tiles?.size || !center || !grid) return null;

    const radius = CONFIG?.pantryDigRadius ?? SETTINGS.sampleRadius;
    const radius2 = radius * radius;
    let best = null;
    let bestScore = -Infinity;

    const queenGx = queen ? Math.floor(queen.x / cellSize) : null;
    const queenGy = queen ? Math.floor(queen.y / cellSize) : null;

    for (const key of pantry.tiles) {
      const gx = key % width;
      const gy = Math.floor(key / width);

      const dxCenter = gx - center.gx;
      const dyCenter = gy - center.gy;
      if (dxCenter * dxCenter + dyCenter * dyCenter > radius2) continue;

      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

      for (const [ox, oy] of neighbors) {
        const nx = gx + ox;
        const ny = gy + oy;
        if (nx <= 0 || nx >= width - 1 || ny <= regionSplit || ny >= height - 1) continue;
        if (!frontierMask[ny]?.[nx] || grid[ny]?.[nx] !== TILES.SOIL) continue;

        const distCenter = Math.hypot(nx - center.gx, ny - center.gy);
        const ringScore = clamp01(1 - Math.abs(distCenter - radius * 0.55) / Math.max(1, radius * 0.8));
        const tunnelNeighbors = countTunnelNeighbors4(nx, ny, grid);
        const edgeBonus = tunnelNeighbors <= 1 ? 1.1 : tunnelNeighbors === 2 ? 0.7 : 0.2;

        let queenPenalty = 0;
        if (queenGx !== null && queenGy !== null) {
          const qd = Math.hypot(nx - queenGx, ny - queenGy);
          const buffer = CONFIG?.pantryQueenBuffer ?? 3.5;
          queenPenalty = clamp01(Math.max(0, buffer - qd) / Math.max(1, buffer)) * 0.7;
        }

        const score = ringScore * 1.2 + edgeBonus - queenPenalty + Math.random() * 0.05;
        if (score > bestScore) {
          bestScore = score;
          best = { anchor: { x: nx, y: ny }, center, radius };
        }
      }
    }

    return best;
  }

  function findCorridorFrontierTarget(start, center, grid) {
    if (!start || !center || !grid) return null;
    const maxSteps = Math.max(40, Math.abs(center.gy - start.gy) + Math.abs(center.gx - start.gx));
    let cx = start.gx;
    let cy = start.gy;

    for (let i = 0; i < maxSteps; i++) {
      if (cx === center.gx && cy === center.gy) break;

      const dx = Math.sign(center.gx - cx);
      const dy = Math.sign(center.gy - cy) || 1;
      const prioritizeY = Math.abs(center.gy - cy) >= Math.abs(center.gx - cx);
      const stepChoices = prioritizeY ? [[0, dy], [dx, 0]] : [[dx, 0], [0, dy]];

      let advanced = false;
      for (const [ox, oy] of stepChoices) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx <= 0 || nx >= width - 1 || ny <= regionSplit || ny >= height - 1) continue;
        const tile = grid[ny]?.[nx];
        if (tile === TILES.BEDROCK) continue;
        if (isOpenTile(tile)) { cx = nx; cy = ny; advanced = true; break; }
        if (tile === TILES.SOIL && frontierMask[ny]?.[nx]) return { x: nx, y: ny };
        if (tile === TILES.SOIL && isFrontierCell(nx, ny, grid)) return { x: nx, y: ny };
      }

      if (!advanced) {
        let best = null;
        let bestScore = -Infinity;
        const offsets = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [ox, oy] of offsets) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx <= 0 || nx >= width - 1 || ny <= regionSplit || ny >= height - 1) continue;
          if (!frontierMask[ny]?.[nx] || grid[ny]?.[nx] !== TILES.SOIL) continue;
          const distDown = (center.gy - ny);
          const align = -Math.abs(center.gx - nx);
          const score = distDown * 1.2 + align;
          if (score > bestScore) { bestScore = score; best = { x: nx, y: ny }; }
        }
        if (best) return best;
        break;
      }
    }
    return null;
  }

  function chooseDigTarget(ant, world) {
    if (ant.carrying || ant.role !== "digger") return null;

    const aboveSplit = ant.y < regionSplit * cellSize;
    const anchor = world?.digStart;
    const effectiveX = aboveSplit ? (anchor?.x ?? ant.x) : ant.x;
    const effectiveY = aboveSplit ? (anchor?.y ?? ant.y) : ant.y;

    const frontier = world.frontierTiles;
    const airField = world.airLevels;
    if (!frontier || !frontier.list.length) return null;

    const spacePressure = (typeof ColonyState !== "undefined" && ColonyState.getSpacePressure)
      ? ColonyState.getSpacePressure()
      : 0.3;
    const wastePressure = (typeof ColonyState !== "undefined" && ColonyState.getWastePressure)
      ? ColonyState.getWastePressure()
      : 0.0;
    const broodPressure = (typeof ColonyState !== "undefined" && ColonyState.getBroodPressure)
      ? ColonyState.getBroodPressure()
      : 0.0;
    const nurseryPressure = (typeof ColonyState !== "undefined" && ColonyState.getNurseryPressure)
      ? ColonyState.getNurseryPressure()
      : 0.0;

    const queen = (typeof getQueen === "function") ? getQueen(world) : null;
    const qx = queen ? queen.x : effectiveX;
    const qy = queen ? queen.y : effectiveY;

    const queenObjective = world?.objectives?.queenChamber;
    const queenPending = queenObjective && queenObjective.status !== "ready";
    const queenUnsettled = queen && (queen.state === "FOUNDING_SURFACE" || queen.state === "RELOCATING");
    const prioritizeQueen = queenPending || queenUnsettled;

    const nurseryReady = queenObjective?.status === "ready" && !queenUnsettled;
    const bandInner = CONFIG?.nurseryBandInner ?? 3;
    const bandOuter = CONFIG?.nurseryBandOuter ?? 6;
    const nurseryDigThreshold = CONFIG?.nurseryPressureDigThreshold ?? 0.35;

    let digMode = ant.digMode || "corridor";
    if (digMode === "room" && (!ant.roomCenter || ant.roomDigBudget <= 0)) {
      digMode = "corridor";
      ant.digMode = "corridor";
      ant.roomCenter = null;
      ant.roomRadius = 0;
      ant.roomDigBudget = 0;
      ant.roomDug = 0;
    }

    const favorSoftSoil = spacePressure < 0.5 && broodPressure < 0.2;
    let headingStrength = ant.digHeadingStrength || 0;
    const hasHeading = headingStrength > 0.01 && Number.isFinite(ant.digHeadingAngle);
    let headingVec = hasHeading ? { x: Math.cos(ant.digHeadingAngle), y: Math.sin(ant.digHeadingAngle) } : null;
    const lastDug = ant.lastDugCell || null;

    const makeUnitVector = (dx, dy, fallbackVec, context) => {
      const safeFallback = fallbackVec || headingVec || { x: 1, y: 0 };
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
        warnHeadingNaNOnce({ context, dx, dy });
        return safeFallback;
      }
      const mag = Math.hypot(dx, dy);
      if (!Number.isFinite(mag) || mag < 1e-6) {
        warnHeadingNaNOnce({ context, dx, dy, mag });
        return safeFallback;
      }
      return { x: dx / mag, y: dy / mag };
    };

    const cgx = Math.floor(effectiveX / cellSize);
    const cgy = Math.floor(effectiveY / cellSize);

    let queenPlan = null;
    let nurseryPlan = null;
    let pantryPlan = null;
    if (prioritizeQueen && queenObjective?.center) {
      const center = queenObjective.center || world.queenChamber?.centerGxGy;
      const radius = queenObjective.radiusTiles || world.queenChamber?.radiusTiles || CONFIG.queenChamberRadiusTiles || 4;
      const pathStart = (typeof findChamberPathStart === "function") ? findChamberPathStart(world) : null;
      const corridorTarget = findCorridorFrontierTarget(pathStart, center, world.grid);
      const chamberTunnel = findReachableTunnelNear(center, radius, world.grid, pathStart);
      const phase = chamberTunnel ? "chamber" : "corridor";
      const anchor = phase === "chamber" ? (chamberTunnel || center) : (corridorTarget || pathStart || center);

      if (anchor) {
        queenPlan = { phase, anchor, center, radius, pathStart, tunnel: chamberTunnel };
        const anchorGx = anchor.gx ?? anchor.x;
        const anchorGy = anchor.gy ?? anchor.y;
        const centerGx = center.gx ?? center.x;
        const centerGy = center.gy ?? center.y;
        const dirX = centerGx - anchorGx;
        const dirY = centerGy - anchorGy;
        headingVec = makeUnitVector(dirX, dirY, headingVec ?? { x: 1, y: 0 }, "queen-plan-heading");
        headingStrength = Math.max(headingStrength, phase === "corridor" ? 0.95 : 0.65);
        if (phase === "chamber") {
          ant.digMode = "room";
          ant.roomCenter = { x: center.gx, y: center.gy };
          ant.roomRadius = radius;
          ant.roomDigBudget = Math.max(ant.roomDigBudget || 0, (queenObjective.minTiles || radius * radius));
        } else {
          ant.digMode = "corridor";
          ant.roomCenter = null;
          ant.roomRadius = 0;
          ant.roomDigBudget = 0;
          ant.roomDug = 0;
          ant.digHeadingAngle = Math.atan2(dirY, dirX);
          ant.digHeadingStrength = headingStrength;
        }
        digMode = ant.digMode || digMode;
      }
    }

    if (!queenPlan && nurseryReady && nurseryPressure > nurseryDigThreshold && wastePressure < 0.8) {
      const center = queen
        ? { gx: Math.floor(queen.x / cellSize), gy: Math.floor(queen.y / cellSize) }
        : queenObjective?.center;
      const pick = center ? findNurseryFrontier(center, bandInner, bandOuter, world.grid, world.wasteGrid) : null;
      if (pick) {
        nurseryPlan = pick;
        const radius = CONFIG?.nurseryRoomRadius ?? 2.6;
        const budget = CONFIG?.nurseryRoomDigBudget ?? Math.max(6, Math.round(Math.PI * radius * radius * 0.6));
        ant.digMode = "room";
        ant.roomCenter = { x: pick.anchor.x, y: pick.anchor.y };
        ant.roomRadius = radius;
        ant.roomDigBudget = Math.max(ant.roomDigBudget || 0, budget);
        ant.roomDug = 0;
        const dirX = pick.anchor.x - cgx;
        const dirY = pick.anchor.y - cgy;
        headingVec = makeUnitVector(dirX, dirY, headingVec ?? { x: 1, y: 0 }, "nursery-plan-heading");
        headingStrength = Math.max(headingStrength, 0.55);
        digMode = ant.digMode || digMode;
      }
    }

    const pantryPressures = (typeof ColonyState !== "undefined" && ColonyState.getPantryPressureByType)
      ? ColonyState.getPantryPressureByType()
      : null;
    const pantryPressure = (typeof ColonyState !== "undefined" && ColonyState.getPantryPressure)
      ? ColonyState.getPantryPressure()
      : 0;
    const pantryPressureThreshold = CONFIG?.pantryPressureDigThreshold ?? 0.55;
    const pantryReady = queenObjective?.status === "ready" && queen && queen.state === "SETTLED";
    const canExpandPantry = pantryReady && pantryPressure > pantryPressureThreshold && wastePressure < 0.95;
    if (!queenPlan && !nurseryPlan && canExpandPantry && pantryPressures) {
      let targetType = null;
      let bestPressure = pantryPressureThreshold;
      for (const [type, pressure] of Object.entries(pantryPressures)) {
        if (pressure > bestPressure) {
          bestPressure = pressure;
          targetType = type;
        }
      }

      const pantry = targetType ? world.pantries?.[targetType] : null;
      const pantryCenter = pantry?.center || null;
      if (pantry && pantryCenter) {
        const pick = findPantryFrontier(pantry, pantryCenter, world.grid, queen);
        if (pick) {
          pantryPlan = pick;
          const radius = CONFIG?.pantryRoomRadius ?? 2.8;
          const budget = CONFIG?.pantryRoomDigBudget ?? Math.max(6, Math.round(Math.PI * radius * radius * 0.55));
          ant.digMode = "room";
          ant.roomCenter = { x: pick.anchor.x, y: pick.anchor.y };
          ant.roomRadius = radius;
          ant.roomDigBudget = Math.max(ant.roomDigBudget || 0, budget);
          ant.roomDug = 0;
          const dirX = pick.anchor.x - cgx;
          const dirY = pick.anchor.y - cgy;
          headingVec = makeUnitVector(dirX, dirY, headingVec ?? { x: 1, y: 0 }, "pantry-plan-heading");
          headingStrength = Math.max(headingStrength, 0.6);
          digMode = ant.digMode || digMode;
        }
      }
    }

    const hasPriorityObjective = !!(queenPlan || nurseryPlan || pantryPlan || prioritizeQueen);
    if (spacePressure < 0.05 && !hasPriorityObjective) {
      return null;
    }

    const currentPlan = queenPlan;

    if (headingVec) {
      headingVec = makeUnitVector(headingVec.x, headingVec.y, { x: 1, y: 0 }, "heading-normalize");
    }

    const shouldStartRoom =
      !queenPlan &&
      !nurseryPlan &&
      digMode !== "room" &&
      ant.roomCooldown <= 0 &&
      ant.digIdleTime >= (CONFIG?.roomModeStuckTime ?? 6) &&
      spacePressure >= (CONFIG?.roomModeSpacePressure ?? 0.6);

    if (shouldStartRoom) {
      const anchorX = lastDug ? lastDug.x : cgx;
      const anchorY = lastDug ? lastDug.y : cgy;
      const radius = (CONFIG?.roomRadiusMin ?? 2) + Math.random() * ((CONFIG?.roomRadiusMax ?? 3.5) - (CONFIG?.roomRadiusMin ?? 2));
      const projX = headingVec ? Math.max(-1, Math.min(1, Math.round(headingVec.x * 2))) : Math.round((Math.random() - 0.5) * 2);
      const projY = headingVec ? Math.max(-1, Math.min(1, Math.round(headingVec.y * 2))) : Math.round((Math.random() - 0.5) * 2);
      const centerX = Math.max(1, Math.min(width - 2, anchorX + projX));
      const centerY = Math.max(regionSplit + 1, Math.min(height - 2, anchorY + projY));

      ant.digMode = "room";
      ant.roomCenter = { x: centerX, y: centerY };
      ant.roomRadius = radius;
      ant.roomDigBudget = Math.max(4, Math.round(Math.PI * radius * radius * 0.75));
      ant.roomDug = 0;
      ant.digIdleTime = 0;
      digMode = "room";
    }

    if (
      digMode === "corridor" &&
      !currentPlan &&
      !nurseryPlan &&
      !pantryPlan &&
      typeof ExcavationPlanner !== "undefined"
    ) {
      const planned = ExcavationPlanner.requestDigTarget(ant, world, { reason: "free-dig" });
      if (planned && planned.x !== undefined) {
        const neighborCount = countTunnelNeighbors4(planned.x, planned.y, world.grid);
        const allowBranching = planned.allowBranching === true || neighborCount >= 2;
        return {
          x: planned.x,
          y: planned.y,
          mode: "corridor",
          workfaceId: planned.workfaceId,
          allowBranching,
        };
      }
    }

    const pressureBoost = 0.6 + spacePressure * 1.4;
    let best = null;
    let bestScore = -Infinity;
    let bestBranching = false;

    let searchRadius = SETTINGS.sampleRadius;
    let candidates;
    if (queenPlan) {
      const baseRadius = queenPlan.phase === "corridor" ? 7 : Math.max(4, Math.round(queenPlan.radius * 0.6));
      searchRadius = baseRadius;
      const anchorX = queenPlan.anchor.gx ?? queenPlan.anchor.x;
      const anchorY = queenPlan.anchor.gy ?? queenPlan.anchor.y;
      candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      while (!candidates.length && searchRadius < baseRadius + 10) {
        searchRadius += 3;
        candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      }
      if (queenPlan.phase === "chamber") {
        const radius2 = (queenPlan.radius + 1) * (queenPlan.radius + 1);
        candidates = candidates.filter((t) => {
          const dx = t.x - queenPlan.center.gx;
          const dy = t.y - queenPlan.center.gy;
          return dx * dx + dy * dy <= radius2;
        });
      }
    } else if (nurseryPlan) {
      searchRadius = Math.max(bandOuter + 5, SETTINGS.sampleRadius);
      const anchorX = nurseryPlan.anchor.x;
      const anchorY = nurseryPlan.anchor.y;
      candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      candidates = candidates.filter((t) => {
        const dx = t.x - nurseryPlan.center.gx;
        const dy = t.y - nurseryPlan.center.gy;
        const dist = Math.hypot(dx, dy);
        return dist >= bandInner - 1 && dist <= bandOuter + 4;
      });
      while (!candidates.length && searchRadius < SETTINGS.maxSampleRadius) {
        searchRadius += 2;
        candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      }
    } else if (pantryPlan) {
      searchRadius = Math.max(CONFIG?.pantryDigRadius ?? SETTINGS.sampleRadius, SETTINGS.sampleRadius);
      const anchorX = pantryPlan.anchor.x;
      const anchorY = pantryPlan.anchor.y;
      candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      candidates = candidates.filter((t) => {
        const dx = t.x - pantryPlan.center.gx;
        const dy = t.y - pantryPlan.center.gy;
        return Math.hypot(dx, dy) <= pantryPlan.radius + 2;
      });
      while (!candidates.length && searchRadius < SETTINGS.maxSampleRadius) {
        searchRadius += 2;
        candidates = collectFrontierCandidates(anchorX, anchorY, searchRadius, world.grid);
      }
    } else {
      candidates = collectFrontierCandidates(cgx, cgy, searchRadius, world.grid);
      while (!candidates.length && searchRadius < SETTINGS.maxSampleRadius) {
        searchRadius += SETTINGS.sampleRadiusStep;
        candidates = collectFrontierCandidates(cgx, cgy, searchRadius, world.grid);
      }

      if (!candidates.length) {
        const fallbackSamples = Math.min(SETTINGS.frontierSampleCount, frontier.list.length);
        for (let i = 0; i < fallbackSamples; i++) {
          const tile = frontier.list[Math.floor(Math.random() * frontier.list.length)];
          candidates.push(tile);
        }
      }
    }

    if (!candidates || !candidates.length) {
      if (queenPlan) {
        candidates = collectFrontierCandidates(cgx, cgy, Math.min(SETTINGS.maxSampleRadius, searchRadius + SETTINGS.sampleRadiusStep), world.grid);
      }
      if ((!candidates || !candidates.length) && nurseryPlan) {
        candidates = collectFrontierCandidates(cgx, cgy, Math.min(SETTINGS.maxSampleRadius, searchRadius + SETTINGS.sampleRadiusStep), world.grid);
      }
      if ((!candidates || !candidates.length) && pantryPlan) {
        candidates = collectFrontierCandidates(cgx, cgy, Math.min(SETTINGS.maxSampleRadius, searchRadius + SETTINGS.sampleRadiusStep), world.grid);
      }
      if (!candidates || !candidates.length) return null;
    }

    for (const tile of candidates) {
      const { x, y } = tile;
      if (!frontierMask[y][x]) continue;

      const tx = (x + 0.5) * cellSize;
      const ty = (y + 0.5) * cellSize;
      const depthNorm = Math.max(0, (y - regionSplit) / Math.max(1, height - regionSplit));
      const upwardBias = 1 + (1 - depthNorm) * (0.35 + wastePressure * 0.25);

      const airLevel = airField && airField[y] ? airField[y][x] : 0;
      const airBonus = 1 + airLevel * (1.6 + wastePressure * 0.8);

      const pher = digPheromone[y][x];
      const pherBonus = 1 + pher * 2.5;

      const nestDist = Math.hypot(tx - qx, ty - qy);
      const nestPenalty = 1 + nestDist / (cellSize * 10);

      const antDist = Math.hypot(tx - effectiveX, ty - effectiveY);
      const antPenalty = 1 + antDist / (cellSize * 4);

      const noise = Math.random() * 0.05;

      let modeBonus = 1;
      if (favorSoftSoil && world.gridTexture && world.gridTexture[y]) {
        const hardness = world.gridTexture[y][x] ?? 0.5;
        const softnessBonus = Math.max(0.4, 1.6 - hardness * 1.2);
        modeBonus *= softnessBonus;
      }

      let headingBonus = 1;
      if (headingVec) {
      const anchorX = queenPlan ? (queenPlan.anchor.gx ?? queenPlan.anchor.x) + 0.5 : (lastDug ? lastDug.x + 0.5 : cgx + 0.5);
        const anchorY = queenPlan ? (queenPlan.anchor.y ?? queenPlan.anchor.gy) + 0.5 : (lastDug ? lastDug.y + 0.5 : cgy + 0.5);
        const dx = x + 0.5 - anchorX;
        const dy = y + 0.5 - anchorY;
        const dist = Math.hypot(dx, dy);
        if (dist > 0) {
          const alignment = (dx * headingVec.x + dy * headingVec.y) / dist;
          const forwardMatch = (alignment + 1) * 0.5;
          const aheadPreference = 1 / (1 + Math.abs(dist - 1));
          headingBonus += headingStrength * ((forwardMatch * SETTINGS.forwardBias) + (aheadPreference * SETTINGS.headingAheadBias));
        }
      }

      const tunnelNeighbors = countTunnelNeighbors4(x, y, world.grid);
      let shapeBonus = 1;
      let allowBranch = false;
      if (digMode === "corridor") {
        if (tunnelNeighbors === 1) {
          shapeBonus *= SETTINGS.corridorEndpointBonus;
        } else if (tunnelNeighbors === 2) {
          const branchChance = SETTINGS.corridorBranchChance + spacePressure * 0.15 + headingStrength * 0.1;
          allowBranch = Math.random() < branchChance;
          const forkFavor = allowBranch ? SETTINGS.corridorBranchPenalty * 1.8 : SETTINGS.corridorBranchPenalty;
          shapeBonus *= forkFavor;
        } else {
          shapeBonus *= SETTINGS.corridorBalloonPenalty;
        }

        if (tunnelNeighbors >= 2 && allowBranch !== true) continue;
      } else {
        if (tunnelNeighbors <= 1) shapeBonus *= SETTINGS.roomNeighborBonus;
        else if (tunnelNeighbors === 2) shapeBonus *= 1;
        else shapeBonus *= SETTINGS.roomNeighborPenalty;
      }

      let roomBias = 1;
      if (digMode === "room" && ant.roomCenter) {
        const distCenter = Math.hypot(x - ant.roomCenter.x, y - ant.roomCenter.y);
        const targetRadius = ant.roomRadius || 2.5;
        if (distCenter <= targetRadius + 0.5) {
          roomBias += SETTINGS.roomCenterBias * Math.max(0, 1 - distCenter / Math.max(0.001, targetRadius + 0.5));
        } else {
          roomBias *= Math.max(0.1, 1 - (distCenter - targetRadius) * 0.35);
        }
      }

      const score = ((upwardBias * airBonus * pherBonus * headingBonus * pressureBoost * modeBonus * shapeBonus * roomBias) /
        (nestPenalty * antPenalty)) + noise;

      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
        bestBranching = allowBranch && digMode === "corridor" && tunnelNeighbors >= 2;
      }
    }

    if (best) {
      best.allowBranching = bestBranching;
      best.mode = digMode;
    }

    if (best && best.mode === "corridor") {
      const verifyNeighbors = countTunnelNeighbors4(best.x, best.y, world.grid);
      if (verifyNeighbors >= 2 && best.allowBranching !== true) {
        best.allowBranching = true;
      }
      if (verifyNeighbors >= 2 && best.allowBranching !== true) {
        if (!chooseDigTarget.branchingMismatchWarned) {
          chooseDigTarget.branchingMismatchWarned = true;
          if (typeof CONFIG === "undefined" || CONFIG?.devMode !== false) {
            if (typeof console !== "undefined" && console.warn) {
              console.warn("[diggingSystem] chooseDigTarget picked corridor target rejected by canCarveHere", best);
            }
          }
        }
        return null;
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

  function depositDirectionalPheromone(ant, gx, gy, grid) {
    const digTarget = ant.digTarget;
    const headingStrength = ant.digHeadingStrength || 0;
    let dirX = 0;
    let dirY = 1;

    if (headingStrength > 0 && Number.isFinite(ant.digHeadingAngle)) {
      dirX = Math.cos(ant.digHeadingAngle);
      dirY = Math.sin(ant.digHeadingAngle);
    } else if (ant.pendingDigVector) {
      dirX = ant.pendingDigVector.x;
      dirY = ant.pendingDigVector.y;
    } else if (digTarget) {
      const dx = digTarget.x + 0.5 - (ant.lastDugCell?.x ?? gx) - 0.5;
      const dy = digTarget.y + 0.5 - (ant.lastDugCell?.y ?? gy) - 0.5;
      const mag = Math.hypot(dx, dy) || 1;
      dirX = dx / mag;
      dirY = dy / mag;
    }

    const strength = SETTINGS.directionalPheromoneStrength;
    const aheadSteps = SETTINGS.directionalPheromoneLength;
    const sideFalloff = SETTINGS.directionalSideFalloff;
    const behindStrength = SETTINGS.directionalBackStrength;

    digPheromone[gy][gx] = Math.max(digPheromone[gy][gx], SETTINGS.neighborDeposit * 0.75);

    const visited = new Set();
    const addDeposit = (tx, ty, weight) => {
      if (!grid[ty] || grid[ty][tx] !== TILES.SOIL) return;
      if (countTunnelNeighbors4(tx, ty, grid) <= 0 && isFrontierCell(tx, ty, grid) !== true) return; // avoid marking non-frontier soil (prevents false sharedFrontier signals)
      const key = (ty << 16) | tx;
      if (visited.has(key)) return;
      visited.add(key);
      const deposit = strength * weight;
      if (deposit > digPheromone[ty][tx]) digPheromone[ty][tx] = deposit;
    };

    const norm = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / norm;
    const ny = dirY / norm;
    const px = -ny;
    const py = nx;

    for (let i = 1; i <= aheadSteps; i++) {
      const fx = Math.round(gx + nx * i);
      const fy = Math.round(gy + ny * i);
      const forwardWeight = Math.max(0.2, 1 - (i - 1) / aheadSteps);
      addDeposit(fx, fy, forwardWeight);

      if (i <= 2) {
        addDeposit(Math.round(fx + px), Math.round(fy + py), forwardWeight * sideFalloff);
        addDeposit(Math.round(fx - px), Math.round(fy - py), forwardWeight * sideFalloff);
      }
    }

    addDeposit(Math.round(gx - nx), Math.round(gy - ny), behindStrength);
  }

  function isTunnelLike(x, y, grid, newX, newY) {
    if (x === newX && y === newY) return true;
    const tile = grid[y]?.[x];
    return tile === TILES.TUNNEL || tile === TILES.AIR;
  }

  function formsCheckerboardArtifact(gx, gy, grid) {
    for (let oy = -1; oy <= 0; oy++) {
      for (let ox = -1; ox <= 0; ox++) {
        const x0 = gx + ox;
        const y0 = gy + oy;
        if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) continue;
        const a = isTunnelLike(x0, y0, grid, gx, gy);
        const b = isTunnelLike(x0 + 1, y0, grid, gx, gy);
        const c = isTunnelLike(x0, y0 + 1, grid, gx, gy);
        const d = isTunnelLike(x0 + 1, y0 + 1, grid, gx, gy);
        if ((a && d && !b && !c) || (b && c && !a && !d)) return true;
      }
    }
    return false;
  }

  function canCarveHere(gx, gy, ant, world) {
    const grid = world.grid;
    const mode = ant.digMode || "corridor";
    const target = ant.digTarget;
    const allowBranching = !!(target && target.x === gx && target.y === gy && target.allowBranching);
    const tunnelNeighbors = countTunnelNeighbors4(gx, gy, grid);

    if (tunnelNeighbors <= 0) return false;
    if (mode === "corridor" && tunnelNeighbors >= 2 && !allowBranching) return false;
    if (formsCheckerboardArtifact(gx, gy, grid)) return false;

    return true;
  }

  function applyDigAction(ant, world, gx, gy) {
    const grid = world.grid;
    if (!grid[gy] || grid[gy][gx] !== TILES.SOIL) return false;

    if (!canCarveHere(gx, gy, ant, world)) return false;

    const spacePressure = (typeof ColonyState !== "undefined" && ColonyState.getSpacePressure)
      ? ColonyState.getSpacePressure()
      : 0.3;

    if (spacePressure <= 0.9) {
      const openTiles = new Set([TILES.TUNNEL]);
      if (typeof TILES.AIR !== "undefined") openTiles.add(TILES.AIR);
      let openNeighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (!grid[ny] || typeof grid[ny][nx] === "undefined") continue;
          if (openTiles.has(grid[ny][nx])) openNeighbors++;
        }
      }

      if (openNeighbors > 3) {
        return false;
      }
    }

    digHP[gy][gx] -= SETTINGS.digDamage;
    if (digHP[gy][gx] > 0) {
      digPheromone[gy][gx] = Math.max(digPheromone[gy][gx], SETTINGS.neighborDeposit);
      return true;
    }

    if (!canCarveHere(gx, gy, ant, world)) {
      digHP[gy][gx] = computeTileHP(gx, gy, grid);
      return false;
    }

    grid[gy][gx] = TILES.TUNNEL;
    digHP[gy][gx] = 0;
    digPheromone[gy][gx] = 0;
    frontierMask[gy][gx] = 0;

    const meta = ant.digTarget ? { workfaceId: ant.digTarget.workfaceId } : null;

    ant.digIdleTime = 0;
    if (ant.digMode === "room") {
      ant.roomDug = (ant.roomDug || 0) + 1;
      if (ant.roomDigBudget > 0) ant.roomDigBudget--;
      if (ant.roomDigBudget <= 0 || ant.roomDug >= Math.max(4, Math.round(Math.PI * (ant.roomRadius || 2.5) ** 2))) {
        ant.digMode = "corridor";
        ant.roomCooldown = CONFIG?.roomCooldown ?? 6;
        ant.roomCenter = null;
        ant.roomRadius = 0;
        ant.roomDigBudget = 0;
        ant.roomDug = 0;
      }
    }

    const digVecX = (gx + 0.5) * cellSize - ant.x;
    const digVecY = (gy + 0.5) * cellSize - ant.y;
    const digMag = Math.hypot(digVecX, digVecY);
    if (digMag > 0) {
      ant.pendingDigVector = { x: digVecX / digMag, y: digVecY / digMag };
    }

    const prevDug = ant.lastDugCell;
    ant.lastDugCell = { x: gx, y: gy };
    if (prevDug) {
      const hx = gx - prevDug.x;
      const hy = gy - prevDug.y;
      const hMag = Math.hypot(hx, hy);
      if (hMag > 0) {
        ant.digHeadingAngle = Math.atan2(hy, hx);
        ant.digHeadingStrength = Math.min(1, (ant.digHeadingStrength || 0) * 0.6 + SETTINGS.headingGain);
      }
    } else if (ant.pendingDigVector) {
      ant.digHeadingAngle = Math.atan2(ant.pendingDigVector.y, ant.pendingDigVector.x);
      ant.digHeadingStrength = Math.min(1, (ant.digHeadingStrength || 0) + SETTINGS.headingGain * 0.6);
    }

    // reinforce nearby frontier directions so others follow the same face
    for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]]) {
      if (grid[ny] && grid[ny][nx] === TILES.SOIL) {
        digPheromone[ny][nx] = Math.max(digPheromone[ny][nx], SETTINGS.neighborDeposit);
      }
    }

    depositDirectionalPheromone(ant, gx, gy, grid);

    reinforceNeighbors(gx, gy, grid);
    enqueueFrontierNeighborhood(gx, gy, 2);
    if (typeof world.onTunnelDug === 'function') world.onTunnelDug(gx, gy);
    if (typeof world.spawnDigParticles === 'function') world.spawnDigParticles(gx, gy);

    if (typeof ExcavationPlanner !== "undefined" && meta && meta.workfaceId !== undefined) {
      ExcavationPlanner.notifyTunnelDug(gx, gy, ant, world, meta);
    }

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
