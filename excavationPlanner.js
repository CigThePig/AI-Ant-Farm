const ExcavationPlanner = (() => {
  let constants = null;
  const workfaces = [];
  let nextWorkfaceId = 1;
  const endpointSet = new Set();
  const junctionHistory = [];
  const MAX_JUNCTION_HISTORY = 40;
  const MAX_BRANCH_DEPTH = 3;

  const DIRS = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];

  function init(constantValues) {
    constants = constantValues;
  }

  function reset(world) {
    workfaces.length = 0;
    nextWorkfaceId = 1;
    endpointSet.clear();
    junctionHistory.length = 0;

    const start = findStartingTunnel(world);
    if (!start) return;

    buildEndpointSet(world?.grid);

    workfaces.push({
      id: nextWorkfaceId++,
      type: "trunk",
      tip: { gx: start.gx, gy: start.gy },
      heading: { dx: 0, dy: 1 },
      status: "active",
      age: 0,
      steps: 0,
      branchDepth: 0,
      branchCooldownSteps: randomCooldown(),
      stepsSinceBranch: 0,
      lastJunctionCandidate: null,
      parentId: null,
    });
  }

  function update(world) {
    maintainBranchTargets(world);
  }

  function requestDigTarget(ant, world) {
    const grid = world?.grid;
    if (!grid) return null;

    const activeFaces = workfaces.filter((wf) => wf.status === "active");
    if (!activeFaces.length) return null;

    let targetFace = null;

    if (ant.excavationWorkfaceId) {
      targetFace = activeFaces.find((wf) => wf.id === ant.excavationWorkfaceId) || null;
    }

    if (!targetFace) {
      const gx = Math.floor(ant.x / (constants?.CELL_SIZE || 1));
      const gy = Math.floor(ant.y / (constants?.CELL_SIZE || 1));
      let bestDist = Infinity;
      for (const face of activeFaces) {
        const dx = face.tip.gx - gx;
        const dy = face.tip.gy - gy;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist < bestDist) {
          bestDist = dist;
          targetFace = face;
        }
      }
    }

    if (!targetFace) return null;

    const candidates = collectForwardCandidates(targetFace, grid);
    if (candidates.length === 0) {
      targetFace.status = "stalled";
      ant.excavationWorkfaceId = null;
      return null;
    }

    targetFace.status = "active";
    ant.excavationWorkfaceId = targetFace.id;

    const best = selectBestCandidate(candidates, targetFace.heading);
    if (!best) return null;

    return { x: best.gx, y: best.gy, mode: "corridor", workfaceId: targetFace.id };
  }

  function notifyTunnelDug(gx, gy, ant, world, meta) {
    const grid = world?.grid;
    if (!grid) return;

    const workfaceId = meta?.workfaceId;
    const workface = workfaces.find((wf) => wf.id === workfaceId);

    if (workface) {
      const prevTip = { ...workface.tip };
      workface.lastJunctionCandidate = prevTip;
      workface.tip = { gx, gy };

      const hx = gx - prevTip.gx;
      const hy = gy - prevTip.gy;
      if (hx !== 0 || hy !== 0) {
        workface.heading = { dx: Math.sign(hx), dy: Math.sign(hy) };
      }

      workface.steps = (workface.steps || 0) + 1;
      workface.stepsSinceBranch = (workface.stepsSinceBranch || 0) + 1;

      recordJunctionCandidate(prevTip, workface.id);
      considerBranching(workface, world);
    }

    updateEndpointStatus(gx, gy, grid);
    updateEndpointStatus(gx - 1, gy, grid);
    updateEndpointStatus(gx + 1, gy, grid);
    updateEndpointStatus(gx, gy - 1, grid);
    updateEndpointStatus(gx, gy + 1, grid);
  }

  function getDebugState() {
    const endpointsCount = endpointSet.size;
    const activeCount = workfaces.filter((wf) => wf.status === "active").length;
    return { workfaces: [...workfaces], endpointsCount, activeCount };
  }

  function findStartingTunnel(world) {
    const digStart = world?.digStart;
    const grid = world?.grid;
    if (!grid || !digStart) return null;

    const { gx, gy } = digStart;
    if (grid[gy]?.[gx] === TILES.TUNNEL) {
      return { gx, gy };
    }

    const radius = 3;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || ny < 0 || ny >= grid.length || nx >= grid[ny].length) continue;
        if (grid[ny][nx] === TILES.TUNNEL) {
          return { gx: nx, gy: ny };
        }
      }
    }

    return null;
  }

  function collectForwardCandidates(workface, grid) {
    const { gx, gy } = workface.tip;
    const dirs = orderDirections(workface.heading);

    const candidates = [];

    for (const { dx, dy } of dirs) {
      const nx = gx + dx;
      const ny = gy + dy;
      const tile = grid[ny]?.[nx];
      if (tile !== TILES.SOIL) continue;

      const tunnelNeighbors = countTunnelNeighbors4(nx, ny, grid);
      if (tunnelNeighbors !== 1) continue;

      if (!connectsToTipOnly(nx, ny, gx, gy, grid)) continue;
      if (tooCloseToOtherTunnels(nx, ny, gx, gy, grid)) continue;

      candidates.push({ gx: nx, gy: ny, dir: { dx, dy } });
    }

    return candidates;
  }

  function selectBestCandidate(candidates, heading) {
    const headingVec = heading || { dx: 0, dy: 1 };
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const { dx, dy } = candidate.dir;
      const alignment = headingVec.dx * dx + headingVec.dy * dy;
      const jitter = (Math.random() - 0.5) * 0.1;
      const score = alignment + jitter;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return best;
  }

  function countTunnelNeighbors4(gx, gy, grid) {
    let neighbors = 0;
    if (grid[gy - 1]?.[gx] === TILES.TUNNEL) neighbors++;
    if (grid[gy + 1]?.[gx] === TILES.TUNNEL) neighbors++;
    if (grid[gy]?.[gx - 1] === TILES.TUNNEL) neighbors++;
    if (grid[gy]?.[gx + 1] === TILES.TUNNEL) neighbors++;
    return neighbors;
  }

  function isEndpointTunnel(gx, gy, grid) {
    if (grid?.[gy]?.[gx] !== TILES.TUNNEL) return false;
    return countTunnelNeighbors4(gx, gy, grid) === 1;
  }

  function endpointKey(gx, gy) {
    return `${gx},${gy}`;
  }

  function buildEndpointSet(grid) {
    if (!grid) return;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        if (isEndpointTunnel(x, y, grid)) {
          endpointSet.add(endpointKey(x, y));
        }
      }
    }
  }

  function updateEndpointStatus(gx, gy, grid) {
    if (!grid || grid?.[gy]?.[gx] === undefined) return;
    const key = endpointKey(gx, gy);
    if (isEndpointTunnel(gx, gy, grid)) {
      endpointSet.add(key);
    } else {
      endpointSet.delete(key);
    }
  }

  function orderDirections(heading) {
    if (!heading) return DIRS;
    const { dx, dy } = heading;
    if (dx === 0 && dy === 0) return DIRS;

    const forward = { dx: Math.sign(dx), dy: Math.sign(dy) };
    const left = { dx: -forward.dy, dy: forward.dx };
    const right = { dx: forward.dy, dy: -forward.dx };
    const back = { dx: -forward.dx, dy: -forward.dy };

    return [forward, left, right, back];
  }

  function connectsToTipOnly(nx, ny, tipX, tipY, grid) {
    let connectsToTip = false;
    for (const { dx, dy } of DIRS) {
      const cx = nx + dx;
      const cy = ny + dy;
      if (grid?.[cy]?.[cx] === TILES.TUNNEL) {
        if (cx === tipX && cy === tipY) connectsToTip = true;
        else return false;
      }
    }
    return connectsToTip;
  }

  function tooCloseToOtherTunnels(nx, ny, tipX, tipY, grid) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = nx + dx;
        const cy = ny + dy;
        if (grid?.[cy]?.[cx] !== TILES.TUNNEL) continue;
        if (cx === tipX && cy === tipY) continue;
        return true;
      }
    }
    return false;
  }

  function randomCooldown() {
    return Math.floor(8 + Math.random() * 7);
  }

  function recordJunctionCandidate(cell, faceId) {
    if (!cell) return;
    junctionHistory.push({ ...cell, faceId });
    while (junctionHistory.length > MAX_JUNCTION_HISTORY) junctionHistory.shift();
  }

  function considerBranching(workface, world) {
    if (!workface || workface.branchDepth === undefined) return;

    if (workface.stepsSinceBranch >= workface.branchCooldownSteps && workface.branchDepth < MAX_BRANCH_DEPTH) {
      if (workface.lastJunctionCandidate) {
        spawnBranchFrom(workface, workface.lastJunctionCandidate, world);
        workface.stepsSinceBranch = 0;
        workface.branchCooldownSteps = randomCooldown();
      }
    }
  }

  function maintainBranchTargets(world) {
    const desiredBranches = computeDesiredBranches();
    const activeBranches = workfaces.filter((wf) => wf.status === "active" && wf.type === "branch");

    if (activeBranches.length >= desiredBranches) return;

    const grid = world?.grid;
    const trunk = workfaces.find((wf) => wf.id === 1);
    const candidate = pickJunctionCandidate(grid, trunk);
    if (candidate) {
      spawnBranchFrom(candidate.parent, { gx: candidate.gx, gy: candidate.gy }, world);
    }
  }

  function pickJunctionCandidate(grid, trunk) {
    const valid = (cell) => cell && grid?.[cell.gy]?.[cell.gx] === TILES.TUNNEL;

    if (trunk && valid(trunk.lastJunctionCandidate)) {
      return { ...trunk.lastJunctionCandidate, parent: trunk };
    }

    for (let i = junctionHistory.length - 1; i >= 0; i--) {
      const cell = junctionHistory[i];
      if (!valid(cell)) continue;
      const parent = workfaces.find((wf) => wf.id === cell.faceId);
      if (!parent || parent.branchDepth >= MAX_BRANCH_DEPTH) continue;
      return { ...cell, parent };
    }

    return null;
  }

  function spawnBranchFrom(parent, junctionCell, world) {
    if (!parent || !junctionCell) return;
    if (parent.branchDepth >= MAX_BRANCH_DEPTH) return;

    const grid = world?.grid;
    if (!grid || grid?.[junctionCell.gy]?.[junctionCell.gx] !== TILES.TUNNEL) return;

    const heading = chooseBranchHeading(parent.heading, junctionCell, grid);
    if (!heading) return;

    const branch = {
      id: nextWorkfaceId++,
      type: "branch",
      tip: { gx: junctionCell.gx, gy: junctionCell.gy },
      heading,
      status: "active",
      age: 0,
      steps: 0,
      branchDepth: Math.min(MAX_BRANCH_DEPTH, (parent.branchDepth || 0) + 1),
      branchCooldownSteps: randomCooldown(),
      stepsSinceBranch: 0,
      lastJunctionCandidate: null,
      parentId: parent.id,
    };

    workfaces.push(branch);
  }

  function chooseBranchHeading(parentHeading, origin, grid) {
    if (!parentHeading) return null;
    const options = [
      { dx: -parentHeading.dy, dy: parentHeading.dx },
      { dx: parentHeading.dy, dy: -parentHeading.dx },
    ];

    for (const dir of shuffle(options)) {
      const nx = origin.gx + dir.dx;
      const ny = origin.gy + dir.dy;
      if (grid?.[ny]?.[nx] !== TILES.SOIL) continue;
      if (countTunnelNeighbors4(nx, ny, grid) !== 1) continue;
      if (!connectsToTipOnly(nx, ny, origin.gx, origin.gy, grid)) continue;
      if (tooCloseToOtherTunnels(nx, ny, origin.gx, origin.gy, grid)) continue;
      return dir;
    }

    return null;
  }

  function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function computeDesiredBranches() {
    const spacePressure = (typeof ColonyState !== "undefined" && ColonyState.getSpacePressure)
      ? ColonyState.getSpacePressure()
      : 0.3;

    const base = 2;
    const max = 6;
    return base + Math.floor(spacePressure * (max - base));
  }

  return {
    init,
    reset,
    update,
    requestDigTarget,
    notifyTunnelDug,
    getDebugState,
  };
})();

