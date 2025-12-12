const ExcavationPlanner = (() => {
  let constants = null;
  const workfaces = [];
  let nextWorkfaceId = 1;

  function init(constantValues) {
    constants = constantValues;
  }

  function reset(world) {
    workfaces.length = 0;
    nextWorkfaceId = 1;

    const start = findStartingTunnel(world);
    if (!start) return;

    workfaces.push({
      id: nextWorkfaceId++,
      type: "corridor",
      tip: { gx: start.gx, gy: start.gy },
      heading: { dx: 0, dy: 1 },
      status: "active",
      age: 0,
      steps: 0,
    });
  }

  function update() {}

  function requestDigTarget(ant, world) {
    const activeWorkface = workfaces.find((wf) => wf.status === "active");
    if (!activeWorkface) return null;

    const grid = world?.grid;
    if (!grid) return null;

    const candidates = collectForwardCandidates(activeWorkface, grid);
    if (candidates.length === 0) return null;

    const best = selectBestCandidate(candidates, activeWorkface.heading);
    if (!best) return null;

    activeWorkface.steps += 1;

    return { x: best.gx, y: best.gy, mode: "corridor", workfaceId: activeWorkface.id };
  }

  function notifyTunnelDug() {}

  function getDebugState() {
    const endpointsCount = workfaces.length;
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
    const dirs = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    const candidates = [];

    for (const { dx, dy } of dirs) {
      const nx = gx + dx;
      const ny = gy + dy;
      const tile = grid[ny]?.[nx];
      if (tile !== TILES.SOIL) continue;
      if (countTunnelNeighbors4(nx, ny, grid) !== 1) continue;
      candidates.push({ gx: nx, gy: ny, dir: { dx, dy } });
    }

    return candidates;
  }

  function selectBestCandidate(candidates, heading) {
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
      const { dx, dy } = candidate.dir;
      const alignment = heading.dx * dx + heading.dy * dy;
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

  return {
    init,
    reset,
    update,
    requestDigTarget,
    notifyTunnelDug,
    getDebugState,
  };
})();

