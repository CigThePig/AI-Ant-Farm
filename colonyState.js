const ColonyState = (() => {
  const state = {
    antCount: 0,
    storedFood: 0,
    nestTiles: 0,
    spacePressure: 0,
    foodPressure: 0,
    wastePressure: 0,
    broodCount: 0,
    broodPressure: 0,
    larvaCount: 0,
    nurseryTiles: 0,
    nurseryPressure: 0,
  };

  const SETTINGS = {
    queenRoomRadius: 10,
    targetAntsPerTile: 0.35,
    desiredFoodPerAnt: 0.6,
    minimumDesiredFood: 4,
    nurseryBandInner: 3,
    nurseryBandOuter: 6,
  };

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function findQueen(ants) {
    return ants.find((a) => a.type === "queen") || null;
  }

  function countNestTiles(grid, queen, constants) {
    if (!queen || !grid) return 0;
    const radius = SETTINGS.queenRoomRadius;
    const cs = constants?.CELL_SIZE || 1;

    const qgx = Math.floor(queen.x / cs);
    const qgy = Math.floor(queen.y / cs);

    let count = 0;
    for (let y = qgy - radius; y <= qgy + radius; y++) {
      const row = grid[y];
      if (!row) continue;
      for (let x = qgx - radius; x <= qgx + radius; x++) {
        const t = row[x];
        if (t === TILES.TUNNEL) count++;
      }
    }
    return count;
  }

  function computeSpacePressure() {
    if (state.nestTiles <= 0) return 1;
    const capacity = state.nestTiles * SETTINGS.targetAntsPerTile;
    const ratio = state.antCount / Math.max(1, capacity);
    return clamp01(ratio);
  }

  function computeFoodPressure() {
    const desiredFood = Math.max(
      SETTINGS.minimumDesiredFood,
      state.antCount * SETTINGS.desiredFoodPerAnt,
    );
    if (desiredFood <= 0) return 0;
    const fulfilled = state.storedFood / desiredFood;
    return clamp01(1 - fulfilled);
  }

  function computeWastePressure(world, queen) {
    if (!world || !world.wasteGrid || !queen) return 0;

    const radius = SETTINGS.queenRoomRadius;
    const cs = world.constants?.CELL_SIZE || 1;
    const qgx = Math.floor(queen.x / cs);
    const qgy = Math.floor(queen.y / cs);

    let sum = 0;
    let checked = 0;
    for (let y = qgy - radius; y <= qgy + radius; y++) {
      const row = world.wasteGrid[y];
      if (!row) continue;
      for (let x = qgx - radius; x <= qgx + radius; x++) {
        if (row[x] !== undefined) {
          sum += row[x];
          checked++;
        }
      }
    }

    if (checked === 0) return 0;
    const avg = sum / checked;
    const total = world.wasteTotal ?? sum;

    const localPressure = clamp01(avg * 0.5);
    const globalPressure = clamp01((total / Math.max(1, state.nestTiles)) * 0.2);
    return clamp01(localPressure * 0.6 + globalPressure * 0.4);
  }

  function computeBroodPressure() {
    if (state.nestTiles <= 0) return clamp01(state.broodCount * 0.15);
    const capacity = Math.max(4, state.nestTiles * SETTINGS.targetAntsPerTile * 0.55);
    const ratio = state.broodCount / capacity;
    return clamp01(ratio);
  }

  function countLarvae(list) {
    if (!Array.isArray(list)) return 0;
    let total = 0;
    for (const b of list) {
      const stage = b?.stage || b?.type;
      if (stage === "larva" || stage === "LARVA") total++;
    }
    return total;
  }

  function countNurseryTiles(grid, queen, constants) {
    const inner = CONFIG?.nurseryBandInner ?? SETTINGS.nurseryBandInner;
    const outer = CONFIG?.nurseryBandOuter ?? SETTINGS.nurseryBandOuter;
    if (!queen || !grid || inner >= outer) return 0;

    const cs = constants?.CELL_SIZE || 1;
    const qgx = Math.floor(queen.x / cs);
    const qgy = Math.floor(queen.y / cs);
    const inner2 = inner * inner;
    const outer2 = outer * outer;

    let tiles = 0;
    for (let y = qgy - outer; y <= qgy + outer; y++) {
      const row = grid[y];
      if (!row) continue;
      for (let x = qgx - outer; x <= qgx + outer; x++) {
        if (row[x] !== TILES.TUNNEL) continue;
        const dx = x - qgx;
        const dy = y - qgy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= inner2 && d2 <= outer2) tiles++;
      }
    }
    return tiles;
  }

  function computeNurseryPressure(world, queen) {
    const capacityPerTile = CONFIG?.larvaePerTileTarget ?? 1.1;
    const larvaLoad = state.larvaCount;
    const tiles = countNurseryTiles(world?.grid, queen, world?.constants);
    state.nurseryTiles = tiles;
    const capacity = Math.max(0, tiles * capacityPerTile);
    const pressure = clamp01((larvaLoad - capacity) / Math.max(1, capacity));
    return pressure;
  }

  function updateColonyState(world, ants) {
    state.antCount = ants?.length || 0;
    state.storedFood = world?.storedFood ?? 0;
    state.broodCount = world?.brood?.length ?? 0;
    state.larvaCount = countLarvae(world?.brood);

    const queen = findQueen(ants || []);
    state.nestTiles = countNestTiles(world?.grid, queen, world?.constants);

    state.spacePressure = computeSpacePressure();
    state.foodPressure = computeFoodPressure();
    state.wastePressure = computeWastePressure(world, queen);
    state.broodPressure = computeBroodPressure();
    state.nurseryPressure = computeNurseryPressure(world, queen);
  }

  return {
    updateColonyState,
    getSpacePressure: () => state.spacePressure,
    getFoodPressure: () => state.foodPressure,
    getWastePressure: () => state.wastePressure,
    getBroodPressure: () => state.broodPressure,
    getNurseryPressure: () => state.nurseryPressure,
    getState: () => ({ ...state }),
  };
})();
