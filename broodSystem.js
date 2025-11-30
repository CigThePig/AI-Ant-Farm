const BroodSystem = (() => {
  const brood = [];

  const SETTINGS = {
    layInterval: 7.5,
    layFoodReserve: 3.5,
    baseMaturationTime: 24, // Increased slightly for realism
    maturationJitter: 0.25,
    
    // BIOLOGY TWEAK: Larvae can survive longer without food, 
    // but they stop growing when hungry.
    starvationTime: 60, 
    
    // How much energy a nurse loses to feed a larva
    nurseEnergyCost: 15,
    
    // Satiation settings
    satiationDuration: 10,
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
      
      // State
      isHungry: false,
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
    if (!b.isHungry) return false;

    // Reset hunger
    b.isHungry = false;
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
      layTimer += dt;
      if (layTimer >= SETTINGS.layInterval) {
        layTimer = 0;
        // Queen eats from global storage to produce eggs (energy conversion)
        if (canLay(world, queen, antsList) && consumeFood(0.5)) {
          spawnBrood(queen);
          queen.energy = Math.max(0, queen.energy - 10);
        }
      }
    }

    const hatched = [];
    
    // 2. Larval Development Loop
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      
      // Digestion / Hunger Logic
      if (b.satiationTimer > 0) {
        b.satiationTimer -= dt;
        // Only grow when fed
        b.age += dt; 
      } else {
        b.isHungry = true;
        b.hungerTimer += dt;
      }

      // Starvation Death
      if (b.hungerTimer > SETTINGS.starvationTime) {
        // Larva dies and turns into waste
        if (addWaste) addWaste(b.x, b.y, 0.5);
        list.splice(i, 1);
        continue;
      }

      // Maturation
      if (b.age >= b.timeToMature) {
        hatched.push(b);
        list.splice(i, 1);
        continue;
      }

      // Pheromone Signalling (Begging for food)
      if (broodScentGrid && !b.lockedBy && b.isHungry) {
        const gx = Math.floor(b.x / world.constants.CELL_SIZE);
        const gy = Math.floor(b.y / world.constants.CELL_SIZE);

        if (gx >= 0 && gx < world.constants.GRID_W && gy >= 0 && gy < world.constants.GRID_H) {
           // The hungrier they are, the louder they scream (chemically)
           const urgency = Math.min(1.0, b.hungerTimer / (SETTINGS.starvationTime * 0.5));
           broodScentGrid[gy][gx] = Math.min(1.0, broodScentGrid[gy][gx] + 0.05 + urgency * 0.1);
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
