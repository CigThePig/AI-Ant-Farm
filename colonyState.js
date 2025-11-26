const ColonyState = (() => {
  const state = {
    antCount: 0,
    storedFood: 0,
    nestTiles: 0,
    spacePressure: 0,
    foodPressure: 0,
    wastePressure: 0,
  };

  const SETTINGS = {
    queenRoomRadius: 10,
    targetAntsPerTile: 0.35,
    desiredFoodPerAnt: 0.6,
    minimumDesiredFood: 4,
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

  function updateColonyState(world, ants) {
    state.antCount = ants?.length || 0;
    state.storedFood = world?.storedFood ?? 0;

    const queen = findQueen(ants || []);
    state.nestTiles = countNestTiles(world?.grid, queen, world?.constants);

    state.spacePressure = computeSpacePressure();
    state.foodPressure = computeFoodPressure();
    state.wastePressure = computeWastePressure(world, queen);
  }

  return {
    updateColonyState,
    getSpacePressure: () => state.spacePressure,
    getFoodPressure: () => state.foodPressure,
    getWastePressure: () => state.wastePressure,
    getState: () => ({ ...state }),
  };
})();
