const BroodSystem = (() => {
  const brood = [];

  const SETTINGS = {
    layInterval: 7.5,
    layFoodReserve: 3.5,
    baseMaturationTime: 16,
    maturationJitter: 0.25,
    feedInterval: 3.2,
    feedCost: 0.35,
    hungryGrowthMultiplier: 0.35,
    starvationTime: 20,
    wastePerMeal: 0.12,
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

  function canLay(state, world) {
    const storedFood = world?.storedFood ?? 0;
    if (storedFood < SETTINGS.layFoodReserve) return false;

    const spacePressure = state?.spacePressure ?? 0;
    const foodPressure = state?.foodPressure ?? 0;
    const wastePressure = state?.wastePressure ?? 0;
    const broodPressure = state?.broodPressure ?? 0;

    if (spacePressure > 0.9) return false;
    if (foodPressure > 0.85) return false;
    if (wastePressure > 0.92) return false;
    if (broodPressure > 0.95) return false;
    return true;
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
    });
  }

  function feedOrStarve(b, consumeFood, addWaste, dt) {
    b.feedTimer -= dt;
    let fed = false;
    if (b.feedTimer <= 0) {
      if (consumeFood(SETTINGS.feedCost)) {
        b.feedTimer = SETTINGS.feedInterval;
        b.hungryTime = Math.max(0, b.hungryTime - 2.5);
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

  function update(world, colonyStateSnapshot, dt, queen, consumeFood, addWaste) {
    const list = attach(world);
    if (!queen) return [];

    layTimer += dt;
    if (layTimer >= SETTINGS.layInterval) {
      layTimer = 0;
      if (canLay(colonyStateSnapshot, world) && consumeFood(SETTINGS.feedCost)) {
        spawnBrood(queen);
      }
    }

    const hatched = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const fed = feedOrStarve(b, consumeFood, addWaste, dt);

      const growthRate = fed ? 1 : SETTINGS.hungryGrowthMultiplier;
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
      }
    }

    return hatched;
  }

  return {
    reset,
    update,
    getBrood: () => brood,
  };
})();
