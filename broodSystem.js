const BroodSystem = (() => {
  const brood = [];

  const SETTINGS = {
    layInterval: 7.5,
    layFoodReserve: 3.5,
    baseMaturationTime: 24, // Increased slightly for realism
    maturationJitter: 0.25,

    // Stage durations (scaffolding for future egg/pupa transitions)
    eggDuration: 6,
    pupaDuration: 8,
    larvaToPupaCondition: 10, // seconds of fed growth needed

    // BIOLOGY TWEAK: Larvae can survive longer without food,
    // but they stop growing when hungry.
    starvationTime: 60,

    // How much energy a nurse loses to feed a larva
    nurseEnergyCost: 15,

    // Satiation settings
    satiationDuration: 10,
    wastePerMeal: 0.12,
  };

  const STAGES = {
    EGG: "egg",
    LARVA: "larva",
    PUPA: "pupa",
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

  function canLay(world, queen, antsList) {
    if (!queen || queen.energy <= 25) return false;
    const unsettled = queen.state === "FOUNDING_SURFACE" || queen.state === "RELOCATING";
    if (unsettled && (CONFIG.queenUnsettledLayMultiplier ?? 0) <= 0) return false;
    const storedFood = world?.storedFood ?? 0;
    // Queen needs perceived safety (food reserves) to lay
    if (storedFood < SETTINGS.layFoodReserve) return false;
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

      // Stage tracking
      stage: STAGES.EGG,
      stageTimers: {
        egg: 0,
        larva: 0,
        pupa: 0,
      },
      stageDurations: {
        egg: SETTINGS.eggDuration,
        pupa: SETTINGS.pupaDuration,
      },

      larvaGrowth: 0,
      larvaGrowthNeeded: SETTINGS.larvaToPupaCondition,

      // State
      isHungry: false,
      needsFood: false,
      hungerTimer: 0, // Time spent starving
      satiationTimer: SETTINGS.satiationDuration, // Born full
    });
  }

  function updateBroodPos(broodItem, x, y) {
    broodItem.x = x;
    broodItem.y = y;
  }

  // EXTERNAL METHOD: Called by Nurse Ants
  function feedBrood(b, addWaste) {
    if (!b || b.stage !== STAGES.LARVA || !b.isHungry) return false;

    // Reset hunger
    b.isHungry = false;
    b.needsFood = false;
    b.hungerTimer = 0;
    b.satiationTimer = SETTINGS.satiationDuration;
    
    // Metabolic waste production
    if (addWaste) addWaste(b.x, b.y, SETTINGS.wastePerMeal);
    
    return true;
  }

  function update(world, colonyStateSnapshot, dt, queen, consumeFood, addWaste, antsList) {
    const list = attach(world);
    const broodScentGrid = world?.broodScent;

    // 1. Queen Laying Logic
    if (queen) {
      const layMultiplier = (queen.state === "SETTLED") ? 1 : (CONFIG.queenUnsettledLayMultiplier ?? 0);
      if (layMultiplier > 0) {
        layTimer += dt * layMultiplier;
        if (layTimer >= SETTINGS.layInterval) {
          layTimer = 0;
          // Queen eats from global storage to produce eggs (energy conversion)
          if (canLay(world, queen, antsList) && consumeFood(0.5)) {
            spawnBrood(queen);
            queen.energy = Math.max(0, queen.energy - 10);
          }
        }
      }
    }

    const hatched = [];
    
    // 2. Development Loop
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];

      // Ensure stage scaffolding is present for legacy brood
      if (!b.stage) b.stage = STAGES.LARVA;
      if (!b.stageTimers) {
        b.stageTimers = { egg: 0, larva: 0, pupa: 0 };
      }
      if (!b.stageDurations) {
        b.stageDurations = { egg: SETTINGS.eggDuration, pupa: SETTINGS.pupaDuration };
      }
      if (typeof b.larvaGrowth !== "number") b.larvaGrowth = Math.max(0, b.age || 0);
      if (typeof b.larvaGrowthNeeded !== "number") {
        const fallback = Math.max(SETTINGS.baseMaturationTime - (SETTINGS.eggDuration + SETTINGS.pupaDuration), SETTINGS.larvaToPupaCondition);
        b.larvaGrowthNeeded = fallback;
      }
      if (typeof b.satiationTimer !== "number") b.satiationTimer = SETTINGS.satiationDuration;
      if (typeof b.hungerTimer !== "number") b.hungerTimer = 0;
      if (typeof b.age !== "number") b.age = 0;
      if (typeof b.timeToMature !== "number") b.timeToMature = SETTINGS.baseMaturationTime;
      if (typeof b.isHungry !== "boolean") b.isHungry = false;
      if (typeof b.needsFood !== "boolean") b.needsFood = false;

      // Always track total age
      b.age += dt;

      // Track time spent in the current stage
      if (b.stageTimers[b.stage] !== undefined) {
        b.stageTimers[b.stage] += dt;
      }

      switch (b.stage) {
        case STAGES.EGG: {
          b.isHungry = false;
          b.needsFood = false;
          b.hungerTimer = 0;

          if (b.stageTimers.egg >= b.stageDurations.egg) {
            b.stage = STAGES.LARVA;
            b.stageTimers.larva = 0;
            b.isHungry = false;
            b.needsFood = false;
            b.hungerTimer = 0;
            b.satiationTimer = SETTINGS.satiationDuration;
          }
          break;
        }
        case STAGES.LARVA: {
          // Digestion / Hunger Logic (larvae only)
          if (b.satiationTimer > 0) {
            b.satiationTimer = Math.max(0, b.satiationTimer - dt);
            b.isHungry = false;
            b.needsFood = false;
            // Only grow when fed
            b.larvaGrowth += dt;
          } else {
            b.isHungry = true;
            b.needsFood = true;
            b.hungerTimer += dt;
          }

          // Starvation Death
          if (b.hungerTimer > SETTINGS.starvationTime) {
            // Larva dies and turns into waste
            if (addWaste) addWaste(b.x, b.y, 0.5);
            list.splice(i, 1);
            continue;
          }

          if (b.larvaGrowth >= b.larvaGrowthNeeded) {
            b.stage = STAGES.PUPA;
            b.stageTimers.pupa = 0;
            b.isHungry = false;
            b.needsFood = false;
            b.hungerTimer = 0;
          }
          break;
        }
        case STAGES.PUPA: {
          b.isHungry = false;
          b.needsFood = false;
          b.hungerTimer = 0;

          if (b.stageTimers.pupa >= b.stageDurations.pupa) {
            hatched.push(b);
            list.splice(i, 1);
            continue;
          }
          break;
        }
        default:
          break;
      }

      // Pheromone Signalling (Begging for food)
      if (b.stage === STAGES.LARVA && broodScentGrid && !b.lockedBy) {
        const gx = Math.floor(b.x / world.constants.CELL_SIZE);
        const gy = Math.floor(b.y / world.constants.CELL_SIZE);

        if (gx >= 0 && gx < world.constants.GRID_W && gy >= 0 && gy < world.constants.GRID_H) {
           // The hungrier they are, the louder they scream (chemically)
           const urgency = b.isHungry ? Math.min(1.0, b.hungerTimer / (SETTINGS.starvationTime * 0.5)) : 0.2;
           broodScentGrid[gy][gx] = Math.min(1.0, broodScentGrid[gy][gx] + 0.02 + urgency * 0.1);
        }
      }
    }

    return hatched;
  }

  return {
    reset,
    update,
    updateBroodPos,
    feedBrood,
    getBrood: () => brood,
    getNurseEnergyCost: () => SETTINGS.nurseEnergyCost,
  };
})();
