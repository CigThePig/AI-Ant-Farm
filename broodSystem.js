const BroodSystem = (() => {
  const brood = [];

  const SETTINGS = {
    layInterval: 7.5,
    layFoodReserve: 3.5,
    baseMaturationTime: 16,
    maturationJitter: 0.25,
    feedInterval: 20.0,
    feedCost: 0.25,
    hungryGrowthMultiplier: 0.35,
    starvationTime: 20,
    wastePerMeal: 0.12,
    satiationDuration: 5,
  };

  let layTimer = 0;

  function reset(world) {
    brood.length = 0;
    layTimer = 0;
    if (world) world.brood = brood;
  }

  function attach(world) {
    if (!world.brood) world.brood = brood;
    return world.brood;
  }

  // FIX: Added antsList parameter to access the colony census
  function nearbyAntCount(queen, radius, antsList) {
    if (!queen || !Array.isArray(antsList)) return 0;
    const r2 = radius * radius;
    let count = 0;

    for (const ant of antsList) {
      if (ant === queen || ant.type === "corpse") continue;
      const dx = ant.x - queen.x;
      const dy = ant.y - queen.y;
      if ((dx * dx + dy * dy) <= r2) count++;
    }

    return count;
  }

  // FIX: Added antsList parameter
  function canLay(world, queen, antsList) {
    if (!queen || queen.energy <= 25) return false;

    const storedFood = world?.storedFood ?? 0;
    if (storedFood < SETTINGS.layFoodReserve) return false;

    // Pass the list so we can actually count them
    const crowding = nearbyAntCount(queen, 100, antsList);
    return crowding > 2;
  }

  function spawnBrood(queen) {
    const jitter = () => (Math.random() - 0.5) * 6;
    const base = SETTINGS.baseMaturationTime;
    const jitterScale = 1 + (Math.random() - 0.5) * SETTINGS.maturationJitter;
    brood.push({
      x: queen.x + jitter(),
      y: queen.y + 6 + jitter(),
      type: "worker",
      age: 0,
      timeToMature: base * jitterScale,
      feedTimer: SETTINGS.feedInterval * (0.8 + Math.random() * 0.5),
      hungryTime: 0,
      satiationTimer: 0,
    });
  }

  function updateBroodPos(broodItem, x, y) {
    broodItem.x = x;
    broodItem.y = y;
  }

  function feedOrStarve(b, consumeFood, addWaste, dt) {
    b.satiationTimer = Math.max(0, (b.satiationTimer ?? 0) - dt);
    b.feedTimer -= dt;
    const remainingToMeal = Math.max(0, b.feedTimer);
    const feedUrgency = 1 - remainingToMeal / SETTINGS.feedInterval;

    // Begin accumulating care needs as the next feeding approaches.
    b.hungryTime += dt * feedUrgency * 0.25;

    let fed = false;
    if (b.feedTimer <= 0) {
      if (consumeFood(SETTINGS.feedCost)) {
        b.feedTimer = SETTINGS.feedInterval;
        b.hungryTime = Math.max(0, b.hungryTime - 2.5);
        b.satiationTimer = SETTINGS.satiationDuration;
        fed = true;
        if (addWaste) {
          addWaste(b.x, b.y, SETTINGS.wastePerMeal);
        }
      } else {
        b.feedTimer = 1.0;
        b.hungryTime += dt;
      }
    }
    return fed;
  }

  // FIX: Added antsList to signature
  function update(world, colonyStateSnapshot, dt, queen, consumeFood, addWaste, antsList) {
    const list = attach(world);
    if (!queen) return [];

    const broodScentGrid = world?.broodScent;

    layTimer += dt;
    if (layTimer >= SETTINGS.layInterval) {
      layTimer = 0;
      // FIX: Pass antsList to canLay so the queen knows if the nest is crowded enough
      if (canLay(world, queen, antsList) && consumeFood(SETTINGS.feedCost)) {
        spawnBrood(queen);
        queen.energy -= 15;
      }
    }

    const hatched = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const fed = feedOrStarve(b, consumeFood, addWaste, dt);

      const satiated = b.satiationTimer > 0;
      const growthRate = satiated ? 1 : SETTINGS.hungryGrowthMultiplier;
      b.age += dt * growthRate;

      if (!fed) {
        b.hungryTime += dt;
        if (b.hungryTime > SETTINGS.starvationTime) {
          if (addWaste) addWaste(b.x, b.y, SETTINGS.wastePerMeal * 1.5);
          list.splice(i, 1);
          continue;
        }
      }

      if (b.age >= b.timeToMature) {
        hatched.push(b);
        list.splice(i, 1);
        continue;
      }

      // MYRMECOLOGIST FIX: Demand-Driven Pheromones
      // 1. If lockedBy (being carried), no scent (nurse is already handling it).
      // 2. If b.hungryTime is low (recently fed), emit NO scent. Nurses will ignore it.
      // 3. Scent strength scales with hunger level.
      if (broodScentGrid && !b.lockedBy) {
        const gx = Math.floor(b.x / world.constants.CELL_SIZE);
        const gy = Math.floor(b.y / world.constants.CELL_SIZE);

        if (
          gx >= 0 && gx < world.constants.GRID_W &&
          gy >= 0 && gy < world.constants.GRID_H &&
          broodScentGrid[gy] && broodScentGrid[gy][gx] !== undefined
        ) {
          const feedingUrgency = Math.max(0, 1 - Math.max(0, b.feedTimer) / SETTINGS.feedInterval);
          const hungerUrgency = Math.min(1.0, b.hungryTime / SETTINGS.starvationTime);
          const careUrgency = Math.max(feedingUrgency, hungerUrgency);

          if (careUrgency > 0.05) {
            const hungerSignal = Math.min(1.0, careUrgency);
            broodScentGrid[gy][gx] = Math.min(1.0, broodScentGrid[gy][gx] + hungerSignal);
          }
        }
      }
    }

    return hatched;
  }

  return {
    reset,
    update,
    updateBroodPos,
    getBrood: () => brood,
  };
})();
