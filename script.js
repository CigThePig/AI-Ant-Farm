const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statsDisplay = document.getElementById("stats-display");
const controlsPanel = document.getElementById("controls-container");
const settingsBtn = document.getElementById("settings-btn");
const slidersArea = document.getElementById("sliders-area");
const debugPanel = document.getElementById("debug-panel");
const debugFlagsContainer = document.getElementById("debug-flags");
const debugCloseBtn = document.getElementById("debug-close");
const debugToggleBtn = document.getElementById("debug-btn");

// Lighting mask
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');

// ==============================
// CONFIG STATE
// ==============================

  const CONFIG = {
    scentDecay: 0.999,
    depositAmount: 0.5,
  entranceCueStrength: 0.8,
  entranceCueRadius: 2.4,
  entranceCueFadeDepth: 1,
  foundingSeedHole: true,

  queenChamberDepthTiles: 12,
  queenChamberRadiusTiles: 5,
  queenChamberMinTiles: 36,

  nurseryBandInner: 3,
  nurseryBandOuter: 6,
  larvaePerTileTarget: 1.1,
  nurseryPressureDigThreshold: 0.35,
  nurseryRoomRadius: 2.6,
  nurseryRoomDigBudget: 18,

  sensorAngle: 0.8,
  sensorDist: 30,

  // Threshold for detecting the queen's close-range scent within the nest core
  nestCoreQueenThreshold: 0.45,

  turnSpeed: 0.4,
  wanderStrength: 0.1,
  forwardBias: 2.0,
  workerSpeed: 60,
  queenSpeed: 28,

  queenScentSurfaceScale: 0.15,
  queenScentSurfaceReach: 3,
  queenScentRelocatingScale: 0.4,
  queenUnsettledLayMultiplier: 0.0,

  postDeliveryDuration: 0.8,   // seconds ants will exit the queen's chamber after dropping food

  stuckThreshold: 0.5,

  queenRadius: 8,             // tiles; pheromone-free buffer around the queen

  renderWastePiles: false,

  digHeadingDecayRate: 0.45,
  roomModeSpacePressure: 0.6,
  roomModeStuckTime: 5.5,
  roomRadiusMin: 2,
  roomRadiusMax: 3.5,
  roomCooldown: 7,
};

// Energy drains more slowly so ants take longer to seek food.
const ENERGY_DECAY_RATE = 0.15;

const ROLE_SETTINGS = {
  reassessPeriod: 2.5,
  batchSize: 3,
  baseDiggerFraction: 0.28,
  minDiggerFraction: 0.12,
  maxDiggerFraction: 0.78,
  baseCleanerFraction: 0.06,
  maxCleanerFraction: 0.28,
  cleanerPressureGain: 0.45,
};

const CONSTANTS = {
  CELL_SIZE: 12,
  GRID_W: 160,
  GRID_H: 140,
  WORKER_COST: 1,
};

CONSTANTS.WORLD_W = CONSTANTS.GRID_W * CONSTANTS.CELL_SIZE;
CONSTANTS.WORLD_H = CONSTANTS.GRID_H * CONSTANTS.CELL_SIZE;
CONSTANTS.REGION_SPLIT = Math.floor(CONSTANTS.GRID_H * 0.35);

const ENTRANCE = {
  gx: Math.floor(CONSTANTS.GRID_W / 2),
  gy: Math.max(1, CONSTANTS.REGION_SPLIT - 1),
};
ENTRANCE.x = (ENTRANCE.gx + 0.5) * CONSTANTS.CELL_SIZE;
ENTRANCE.y = (ENTRANCE.gy + 0.5) * CONSTANTS.CELL_SIZE;

const DIG_START = {
  gx: ENTRANCE.gx,
  gy: CONSTANTS.REGION_SPLIT,
};
DIG_START.x = (DIG_START.gx + 0.5) * CONSTANTS.CELL_SIZE;
DIG_START.y = (DIG_START.gy + 0.5) * CONSTANTS.CELL_SIZE;

const NEST_ENTRANCE = {
  gx: ENTRANCE.gx,
  gy: ENTRANCE.gy,
  radius: 2,
};
NEST_ENTRANCE.x = ENTRANCE.x;
NEST_ENTRANCE.y = ENTRANCE.y;

const QUEEN_RADIUS_PX = CONFIG.queenRadius * CONSTANTS.CELL_SIZE;
const QUEEN_RADIUS_PX2 = QUEEN_RADIUS_PX * QUEEN_RADIUS_PX;

const TILES = { GRASS: 0, SOIL: 1, TUNNEL: 2, BEDROCK: 3 };

const BROOD_PLACEMENT = {
  egg: { min: 0.8, max: 2, target: 1.2, searchRadius: 3, maxPerTile: 5 },
  larva: { min: 3, max: 6, target: 4.5, searchRadius: 7, maxPerTile: 3 },
  pupa: { min: 5, max: 9, target: 7, searchRadius: 9, maxPerTile: 3 },
};

// ==============================
// NEW: SCENT HEATMAP BUFFERS (PERF FIRST)
// ==============================

const SCENT = {
  UPDATE_EVERY_FRAMES: 2,    // performance knob
  BLUR_PX: 2,                // blur at low-res
  MIN_SHOW: 0.03,            // ignore tiny scent
  ALPHA: 0.70                // overlay strength
};

const DEBUG_SHOW_INTENT = false;

const AIR = {
  UPDATE_EVERY_FRAMES: 4,
};

let sunAngle = Math.random() * Math.PI * 2;

const OLEIC_ACID_THRESHOLD = 30; // seconds before corpses emit detectable oleic acid

const WASTE = {
  dropChancePerSecond: 0.18,
  dropAmount: 0.25,
  maxTile: 6,
  cleanerSightRadius: 7,
  cleanerPickup: 1.2,
  cleanerDumpY: 2,
  spoilageRate: 0.008,
};

const scentRawCanvas = document.createElement('canvas');
const scentRawCtx = scentRawCanvas.getContext('2d');
const scentBlurCanvas = document.createElement('canvas');
const scentBlurCtx = scentBlurCanvas.getContext('2d');

let scentImageData = null;
let scentFrameCounter = 0;
let airFrameCounter = 0;

function initScentBuffers() {
  scentRawCanvas.width = CONSTANTS.GRID_W;
  scentRawCanvas.height = CONSTANTS.GRID_H;
  scentBlurCanvas.width = CONSTANTS.GRID_W;
  scentBlurCanvas.height = CONSTANTS.GRID_H;
  scentImageData = scentRawCtx.createImageData(CONSTANTS.GRID_W, CONSTANTS.GRID_H);
}

function updateScentTexture(scentToFood, scentToHome, broodScent) {
  const w = CONSTANTS.GRID_W;
  const h = CONSTANTS.GRID_H;
  const data = scentImageData.data;

  let i = 0;
  for (let y = 0; y < h; y++) {
    const rowF = scentToFood[y];
    const rowH = scentToHome[y];
    const rowB = broodScent[y];
    for (let x = 0; x < w; x++) {
      const f = rowF[x];
      const hh = rowH[x];
      const b = rowB[x];

      // Thresholding keeps the overlay clean and faster visually
      const rf = (f >= SCENT.MIN_SHOW) ? f : 0;
      const bh = (hh >= SCENT.MIN_SHOW) ? hh : 0;
      const gb = (b >= SCENT.MIN_SHOW) ? b : 0;

      // Encode into RGB, with alpha tied to max channel
      const r8 = Math.min(255, Math.floor(rf * 255));
      const g8 = Math.min(255, Math.floor(gb * 255));
      const b8 = Math.min(255, Math.floor(bh * 255));
      const a8 = Math.min(220, Math.floor(Math.max(rf, gb, bh) * 220)); // cap alpha so it never nukes the scene

      data[i + 0] = r8;   // toFood (red)
      data[i + 1] = g8;   // brood needs (green)
      data[i + 2] = b8;   // toHome (blue)
      data[i + 3] = a8;
      i += 4;
    }
  }

  scentRawCtx.putImageData(scentImageData, 0, 0);

  // Blur pass (low-res blur is cheap and looks like mist)
  scentBlurCtx.save();
  scentBlurCtx.clearRect(0, 0, w, h);
  scentBlurCtx.filter = `blur(${SCENT.BLUR_PX}px)`;
  scentBlurCtx.drawImage(scentRawCanvas, 0, 0);
  scentBlurCtx.restore();
  scentBlurCtx.filter = "none";
}

// ==============================
// NEW: EDGE OVERLAY CANVAS (TILE OUTLINES)
// ==============================

const edgeCanvas = document.createElement('canvas');
const edgeCtx = edgeCanvas.getContext('2d');

function initEdgeCanvas() {
  edgeCanvas.width = CONSTANTS.WORLD_W;
  edgeCanvas.height = CONSTANTS.WORLD_H;
}

function isSolid(t) { return t === TILES.SOIL || t === TILES.BEDROCK; }

AirSystem.init(CONSTANTS);
DiggingSystem.init(CONSTANTS);

function drawEdgesForCell(gx, gy, grid) {
  const t = grid[gy][gx];
  if (t !== TILES.TUNNEL && t !== TILES.GRASS) return;

  const cs = CONSTANTS.CELL_SIZE;
  const px = gx * cs;
  const py = gy * cs;

  const up = grid[gy - 1][gx];
  const dn = grid[gy + 1][gx];
  const lf = grid[gy][gx - 1];
  const rt = grid[gy][gx + 1];

  // Tunnel edges: stronger shadow
  const edgeAlpha = (t === TILES.TUNNEL) ? 0.28 : 0.14;
  edgeCtx.fillStyle = `rgba(0,0,0,${edgeAlpha})`;

  // Draw shadow on the open tile edge when neighbor is solid
  if (isSolid(up)) edgeCtx.fillRect(px, py, cs, 2);
  if (isSolid(dn)) edgeCtx.fillRect(px, py + cs - 2, cs, 2);
  if (isSolid(lf)) edgeCtx.fillRect(px, py, 2, cs);
  if (isSolid(rt)) edgeCtx.fillRect(px + cs - 2, py, 2, cs);

  // Tiny corner darkening for tunnels (sells depth)
  if (t === TILES.TUNNEL) {
    edgeCtx.fillStyle = "rgba(0,0,0,0.18)";
    if (isSolid(up) && isSolid(lf)) edgeCtx.fillRect(px, py, 3, 3);
    if (isSolid(up) && isSolid(rt)) edgeCtx.fillRect(px + cs - 3, py, 3, 3);
    if (isSolid(dn) && isSolid(lf)) edgeCtx.fillRect(px, py + cs - 3, 3, 3);
    if (isSolid(dn) && isSolid(rt)) edgeCtx.fillRect(px + cs - 3, py + cs - 3, 3, 3);
  }
}

function rebuildEdgeOverlay(grid) {
  edgeCtx.clearRect(0, 0, edgeCanvas.width, edgeCanvas.height);
  for (let y = 1; y < CONSTANTS.GRID_H - 1; y++) {
    for (let x = 1; x < CONSTANTS.GRID_W - 1; x++) {
      drawEdgesForCell(x, y, grid);
    }
  }
}

function updateEdgesAround(gx, gy, grid) {
  const cs = CONSTANTS.CELL_SIZE;
  const minX = Math.max(1, gx - 2);
  const maxX = Math.min(CONSTANTS.GRID_W - 2, gx + 2);
  const minY = Math.max(1, gy - 2);
  const maxY = Math.min(CONSTANTS.GRID_H - 2, gy + 2);

  edgeCtx.clearRect(minX * cs, minY * cs, (maxX - minX + 1) * cs, (maxY - minY + 1) * cs);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      drawEdgesForCell(x, y, grid);
    }
  }
}

// ==============================
// UI GENERATION
// ==============================

const SLIDER_DEF = [
  { key: 'scentDecay', name: 'Trail Life', min: 0.900, max: 0.999, step: 0.001 },
  { key: 'depositAmount', name: 'Scent Strength', min: 0.1, max: 2.0, step: 0.1 },
  { key: 'sensorDist', name: 'Sensor Dist', min: 10, max: 60, step: 1 },
  { key: 'sensorAngle', name: 'Sensor Angle', min: 0.1, max: 1.5, step: 0.1 },
  { key: 'forwardBias', name: 'Forward Bias', min: 0.0, max: 5.0, step: 0.1 },
  { key: 'turnSpeed', name: 'Turn Agility', min: 0.05, max: 1.0, step: 0.05 },
  { key: 'wanderStrength', name: 'Jitter/Wander', min: 0.0, max: 0.5, step: 0.01 },
  { key: 'workerSpeed', name: 'Ant Speed', min: 10, max: 150, step: 5 },
];

function stepDecimals(step) {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot >= 0 ? (s.length - dot - 1) : 0;
}

function initUI() {
  settingsBtn.addEventListener('click', () => {
    controlsPanel.classList.toggle('visible');
    const isOpen = controlsPanel.classList.contains('visible');
    settingsBtn.textContent = isOpen ? '✖ Close' : '⚙️ Settings';
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    resetSimulation();
  });

  SLIDER_DEF.forEach(def => {
    const decimals = stepDecimals(def.step);

    const div = document.createElement('div');
    div.className = 'control-group';

    const labelRow = document.createElement('div');
    labelRow.className = 'control-label';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = def.name;

    const valSpan = document.createElement('span');
    valSpan.className = 'value-pill';
    valSpan.textContent = Number(CONFIG[def.key]).toFixed(decimals);

    labelRow.appendChild(nameSpan);
    labelRow.appendChild(valSpan);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    input.value = CONFIG[def.key];

    input.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      CONFIG[def.key] = val;
      valSpan.textContent = val.toFixed(decimals);
    });

    div.appendChild(labelRow);
    div.appendChild(input);
    slidersArea.appendChild(div);
  });
}

// ==============================
// DEBUG OVERLAY UI + DRAW HELPERS
// ==============================

const DebugOverlay = (() => {
  const flags = {
    showHomeScent: false,
    showEntranceCue: false,
    showBroodScent: false,
    showWaste: false,
    showRefuse: false,
    showStoredFood: false,
    showDigFrontier: false,
    showRoomIds: false,
    showAntState: false,
    highlightTransfers: false,
    showCleanTargets: false,
    showQueenPath: false,
    showQueenScent: false,
  };

  const toggleDefs = [
    { key: 'showHomeScent', label: 'Home scent field' },
    { key: 'showEntranceCue', label: 'Entrance cue' },
    { key: 'showBroodScent', label: 'Brood scent field' },
    { key: 'showWaste', label: 'Waste heatmap' },
    { key: 'showRefuse', label: 'Refuse / dump markers' },
    { key: 'showStoredFood', label: 'Stored food heatmap' },
    { key: 'showDigFrontier', label: 'Dig frontier tiles' },
    { key: 'showRoomIds', label: 'Room IDs / regions' },
    { key: 'showAntState', label: 'Ant state labels' },
    { key: 'highlightTransfers', label: 'Highlight trophallaxis transfers' },
    { key: 'showCleanTargets', label: 'Cleaner target lines' },
    { key: 'showQueenPath', label: 'Queen path & target' },
    { key: 'showQueenScent', label: 'Queen scent field' },
  ];

  const palettes = {
    blue: (t) => `rgba(80,180,255,${t})`,
    green: (t) => `rgba(120,255,180,${t})`,
    amber: (t) => `rgba(255,210,120,${t})`,
    violet: (t) => `rgba(185,150,255,${t})`,
    red: (t) => `rgba(255,120,140,${t})`,
  };

  let panelVisible = false;

  function setPanelVisible(next) {
    panelVisible = next;
    debugPanel?.classList.toggle('visible', panelVisible);
  }

  function togglePanel() {
    setPanelVisible(!panelVisible);
  }

  function buildToggle(def) {
    const row = document.createElement('label');
    row.className = 'debug-flag';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = flags[def.key];
    input.addEventListener('change', () => {
      flags[def.key] = input.checked;
    });

    const text = document.createElement('span');
    text.textContent = def.label;

    row.appendChild(input);
    row.appendChild(text);
    debugFlagsContainer?.appendChild(row);
  }

  function init() {
    if (!debugFlagsContainer) return;
    debugFlagsContainer.innerHTML = '';
    toggleDefs.forEach(buildToggle);

    debugToggleBtn?.addEventListener('click', togglePanel);
    debugCloseBtn?.addEventListener('click', () => setPanelVisible(false));

    setPanelVisible(false);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        togglePanel();
      }
    });
  }

  function drawHeatmapGrid(ctx, grid, options = {}) {
    if (!grid || !grid.length) return;

    const cs = options.cellSize ?? CONSTANTS.CELL_SIZE;
    const composite = options.composite ?? 'lighter';
    const palette = options.palette ?? palettes.violet;
    const threshold = options.threshold ?? 0.0001;

    const minX = Math.max(0, Math.floor(camX / cs) - 2);
    const maxX = Math.min(CONSTANTS.GRID_W, Math.ceil((camX + VIEW_W / ZOOM) / cs) + 2);
    const minY = Math.max(0, Math.floor(camY / cs) - 2);
    const maxY = Math.min(CONSTANTS.GRID_H, Math.ceil((camY + VIEW_H / ZOOM) / cs) + 2);

    let maxVal = options.max ?? null;
    if (maxVal === null) {
      maxVal = 0;
      for (let y = minY; y < maxY; y++) {
        const row = grid[y];
        if (!row) continue;
        for (let x = minX; x < maxX; x++) {
          const v = row[x];
          if (v > maxVal) maxVal = v;
        }
      }
    }

    if (!maxVal || maxVal <= threshold) return;

    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = options.alpha ?? 0.35;
    ctx.imageSmoothingEnabled = false;

    for (let y = minY; y < maxY; y++) {
      const row = grid[y];
      if (!row) continue;
      const py = y * cs;
      for (let x = minX; x < maxX; x++) {
        const v = row[x];
        if (v <= threshold) continue;
        const t = Math.min(1, Math.max(0, v / maxVal));
        ctx.fillStyle = palette(t);
        ctx.fillRect(x * cs, py, cs, cs);
      }
    }

    ctx.restore();
  }

  function drawTileMark(ctx, gx, gy, options = {}) {
    const cs = options.cellSize ?? CONSTANTS.CELL_SIZE;
    const size = options.size ?? cs * 0.55;
    const half = size / 2;
    const px = (gx + 0.5) * cs;
    const py = (gy + 0.5) * cs;

    ctx.save();
    ctx.strokeStyle = options.color ?? '#38ff8b';
    ctx.lineWidth = options.lineWidth ?? 1.3;
    ctx.globalAlpha = options.alpha ?? 0.9;

    if (options.shape === 'cross') {
      ctx.beginPath();
      ctx.moveTo(px - half, py - half);
      ctx.lineTo(px + half, py + half);
      ctx.moveTo(px - half, py + half);
      ctx.lineTo(px + half, py - half);
      ctx.stroke();
    } else {
      ctx.strokeRect(px - half, py - half, size, size);
    }

    ctx.restore();
  }

  return {
    init,
    flags,
    palettes,
    togglePanel,
    setPanelVisible,
    drawHeatmapGrid,
    drawTileMark,
  };
})();

// ==============================
// VIEWPORT & INPUT
// ==============================

let DPR = 1;
let VIEW_W = 0;
let VIEW_H = 0;

let ZOOM = 1.0;
let camX = 0, camY = 0;
let evCache = [];
let prevDiff = -1;
const lastPos = new Map();

function resize() {
  VIEW_W = window.innerWidth;
  VIEW_H = window.innerHeight;

  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  canvas.style.width = VIEW_W + "px";
  canvas.style.height = VIEW_H + "px";
  canvas.width = Math.floor(VIEW_W * DPR);
  canvas.height = Math.floor(VIEW_H * DPR);

  maskCanvas.style.width = VIEW_W + "px";
  maskCanvas.style.height = VIEW_H + "px";
  maskCanvas.width = canvas.width;
  maskCanvas.height = canvas.height;
}
window.addEventListener("resize", resize);

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  evCache.push(e);
  lastPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (evCache.length === 2) prevDiff = -1;
});

canvas.addEventListener("pointermove", (e) => {
  const idx = evCache.findIndex(c => c.pointerId === e.pointerId);
  if (idx >= 0) evCache[idx] = e;

  if (evCache.length === 1) {
    const prev = lastPos.get(e.pointerId);
    if (prev) {
      camX -= (e.clientX - prev.x) / ZOOM;
      camY -= (e.clientY - prev.y) / ZOOM;
      prev.x = e.clientX;
      prev.y = e.clientY;
    }
  } else if (evCache.length === 2) {
    const curDiff = Math.hypot(
      evCache[0].clientX - evCache[1].clientX,
      evCache[0].clientY - evCache[1].clientY
    );

    if (prevDiff > 0) {
      const cx = (evCache[0].clientX + evCache[1].clientX) / 2;
      const cy = (evCache[0].clientY + evCache[1].clientY) / 2;

      const wx = camX + cx / ZOOM;
      const wy = camY + cy / ZOOM;

      ZOOM = Math.max(0.2, Math.min(6.0, ZOOM + (curDiff - prevDiff) * 0.005 * ZOOM));

      camX = wx - cx / ZOOM;
      camY = wy - cy / ZOOM;
    }
    prevDiff = curDiff;
  }

  const vw = VIEW_W / ZOOM, vh = VIEW_H / ZOOM;
  camX = Math.max(-100, Math.min(camX, CONSTANTS.WORLD_W - vw + 100));
  camY = Math.max(-100, Math.min(camY, CONSTANTS.WORLD_H - vh + 100));
});

function removeEv(e) {
  const idx = evCache.findIndex(c => c.pointerId === e.pointerId);
  if (idx >= 0) evCache.splice(idx, 1);
  lastPos.delete(e.pointerId);
  if (evCache.length < 2) prevDiff = -1;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}

canvas.addEventListener("pointerup", removeEv);
canvas.addEventListener("pointercancel", removeEv);
canvas.addEventListener("pointerout", removeEv);
canvas.addEventListener("pointerleave", removeEv);

// ==============================
// WORLD DATA
// ==============================

let grid = [];
let gridTexture = [];
let foodGrid = [];
let storedFoodGrid = [];
let wasteGrid = [];
let wasteTags = [];
let scentToFood = [];
let scentToHome = [];
let queenScent = [];
let broodScent = [];
let nurseScent = [];
let ants = [];
let particles = [];
let trophallaxisEvents = [];
let foodInStorage = 0;
let wasteTotal = 0;
let brood = [];
let nextAntId = 1;

const FOOD_TYPES = ["seed", "protein", "sugar"];

const worldState = {
  grid: null,
  gridTexture: null,
  particles: null,
  airLevels: null,
  queen: null,
  queenRef: null,
  queenId: null,
  queenMoveTarget: null,
  entrance: ENTRANCE,
  digStart: DIG_START,
  foundingMode: false,
  storedFood: 0,
  wasteGrid: null,
  wasteTags: null,
  wasteTotal: 0,
  brood: null,
  broodScent: null,
  nurseScent: null,
  frontierTiles: null,
  objectives: {
    queenChamber: {
      status: "unstarted",
      center: null,
      radiusTiles: CONFIG.queenChamberRadiusTiles,
      priority: false,
    },
  },
  queenChamber: {
    centerGxGy: null,
    radiusTiles: CONFIG.queenChamberRadiusTiles,
    minTiles: CONFIG.queenChamberMinTiles,
    roomTiles: new Set(),
  },
  constants: CONSTANTS,
  onTunnelDug: (gx, gy) => {
    updateEdgesAround(gx, gy, grid);
    AirSystem.notifyTileOpened(gx, gy, grid);
  },
  spawnDigParticles: (gx, gy) => {
    for (let k = 0; k < 3; k++) {
      particles.push({
        x: (gx + 0.5) * CONSTANTS.CELL_SIZE,
        y: (gy + 0.5) * CONSTANTS.CELL_SIZE,
        vx: (Math.random() - 0.5) * 50,
        vy: (Math.random() - 0.5) * 50,
        life: 0.5,
        c: '#9a6b39'
      });
    }
  },
};

function getQueen(world = worldState) {
  const resolvedWorld = world || worldState;

  if (resolvedWorld?.queenRef && resolvedWorld.queenRef.type === "queen") return resolvedWorld.queenRef;

  if (resolvedWorld?.queenId && Array.isArray(ants)) {
    const queenById = ants.find((a) => a.id === resolvedWorld.queenId && a.type === "queen");
    if (queenById) {
      resolvedWorld.queenRef = queenById;
      resolvedWorld.queen = queenById;
      return queenById;
    }
  }

  if (Array.isArray(ants)) {
    const queenFromList = ants.find((a) => a.type === "queen");
    if (queenFromList) {
      if (resolvedWorld) {
        resolvedWorld.queenRef = queenFromList;
        resolvedWorld.queenId = queenFromList.id;
        resolvedWorld.queen = queenFromList;
      }
      return queenFromList;
    }
  }

  return null;
}

function getNestCorePos(world = worldState) {
  const queen = getQueen(world);
  if (!queen) return null;

  return {
    x: queen.x,
    y: queen.y,
    settled: queen.state === "SETTLED",
    queen,
  };
}

function findTunnelPath(start, goal, gridRef = grid) {
  if (!start || !goal || !gridRef) return null;

  const height = gridRef.length;
  const width = gridRef[0]?.length || 0;
  if (width === 0 || height === 0) return null;

  const inBounds = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  if (!inBounds(goal.gx, goal.gy)) return null;
  if (gridRef[goal.gy]?.[goal.gx] !== TILES.TUNNEL) return null;

  const startKey = `${start.gx},${start.gy}`;
  const goalKey = `${goal.gx},${goal.gy}`;
  if (startKey === goalKey) return [{ gx: goal.gx, gy: goal.gy }];

  const visited = new Uint8Array(width * height);
  const prevX = new Int16Array(width * height);
  const prevY = new Int16Array(width * height);

  const idx = (x, y) => y * width + x;
  const queue = [];

  const pushNode = (x, y) => {
    visited[idx(x, y)] = 1;
    queue.push({ gx: x, gy: y });
  };

  if (!inBounds(start.gx, start.gy)) return null;
  pushNode(start.gx, start.gy);

  while (queue.length) {
    const node = queue.shift();
    const nKey = `${node.gx},${node.gy}`;
    if (nKey === goalKey) {
      const path = [];
      let cx = node.gx;
      let cy = node.gy;
      while (!(cx === start.gx && cy === start.gy)) {
        path.push({ gx: cx, gy: cy });
        const pIdx = idx(cx, cy);
        const px = prevX[pIdx];
        const py = prevY[pIdx];
        cx = px;
        cy = py;
      }
      path.push({ gx: start.gx, gy: start.gy });
      path.reverse();
      return path;
    }

    const neighbors = [
      [node.gx + 1, node.gy],
      [node.gx - 1, node.gy],
      [node.gx, node.gy + 1],
      [node.gx, node.gy - 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (!inBounds(nx, ny)) continue;
      const nIdx = idx(nx, ny);
      if (visited[nIdx]) continue;
      const tile = gridRef[ny]?.[nx];
      const isStart = nx === start.gx && ny === start.gy;
      if (!isStart && tile !== TILES.TUNNEL) continue;

      visited[nIdx] = 1;
      prevX[nIdx] = node.gx;
      prevY[nIdx] = node.gy;
      queue.push({ gx: nx, gy: ny });
    }
  }

  return null;
}

function clampQueenChamberTarget(gx, gy) {
  const minX = 1;
  const maxX = CONSTANTS.GRID_W - 2;
  const minY = CONSTANTS.REGION_SPLIT + 1;
  const maxY = CONSTANTS.GRID_H - 2;

  return {
    gx: Math.max(minX, Math.min(maxX, gx)),
    gy: Math.max(minY, Math.min(maxY, gy)),
  };
}

function pickQueenChamberCenter(gridRef = grid) {
  const depth = CONFIG.queenChamberDepthTiles ?? 12;
  const desired = clampQueenChamberTarget(
    ENTRANCE.gx,
    CONSTANTS.REGION_SPLIT + depth,
  );

  const tileAt = (gx, gy) => gridRef?.[gy]?.[gx];
  if (tileAt(desired.gx, desired.gy) !== TILES.BEDROCK) return desired;

  for (let radius = 1; radius <= 3; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = desired.gx + dx;
        const ny = desired.gy + dy;
        const candidate = clampQueenChamberTarget(nx, ny);
        if (tileAt(candidate.gx, candidate.gy) !== TILES.BEDROCK) {
          return candidate;
        }
      }
    }
  }

  return desired;
}

function findChamberPathStart(world) {
  const gridRef = world?.grid;
  if (!gridRef) return null;

  const bases = [world?.digStart, world?.entrance];
  const isOpen = (p) => p && gridRef[p.gy]?.[p.gx] === TILES.TUNNEL;

  for (const base of bases) {
    if (isOpen(base)) return base;
  }

  const searchAround = (base) => {
    if (!base) return null;
    const radius = 3;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = base.gx + dx;
        const ny = base.gy + dy;
        if (gridRef[ny]?.[nx] === TILES.TUNNEL) return { gx: nx, gy: ny };
      }
    }
    return null;
  };

  for (const base of bases) {
    const found = searchAround(base);
    if (found) return found;
  }

  return null;
}

function collectQueenChamberTiles(center, radius, gridRef, outSet) {
  if (!center || !gridRef) return { count: 0, tiles: new Set() };
  const radius2 = radius * radius;

  const inRadius = (x, y) => {
    const dx = x - center.gx;
    const dy = y - center.gy;
    return dx * dx + dy * dy <= radius2;
  };

  const visited = new Set();
  if (gridRef[center.gy]?.[center.gx] !== TILES.TUNNEL) {
    if (outSet?.clear) outSet.clear();
    return { count: 0, tiles: visited };
  }

  const queue = [{ gx: center.gx, gy: center.gy }];
  visited.add(center.gy * CONSTANTS.GRID_W + center.gx);

  while (queue.length) {
    const node = queue.pop();
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of neighbors) {
      const nx = node.gx + dx;
      const ny = node.gy + dy;
      if (!gridRef[ny] || gridRef[ny][nx] !== TILES.TUNNEL) continue;
      if (!inRadius(nx, ny)) continue;
      const key = ny * CONSTANTS.GRID_W + nx;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ gx: nx, gy: ny });
    }
  }

  if (outSet?.clear) outSet.clear();
  if (outSet) {
    for (const key of visited) outSet.add(key);
  }

  return { count: visited.size, tiles: visited };
}

function hasTunnelNearby(center, radius, gridRef) {
  if (!center || !gridRef) return false;
  const radius2 = radius * radius;
  const minX = Math.max(1, Math.floor(center.gx - radius));
  const maxX = Math.min(CONSTANTS.GRID_W - 2, Math.ceil(center.gx + radius));
  const minY = Math.max(CONSTANTS.REGION_SPLIT + 1, Math.floor(center.gy - radius));
  const maxY = Math.min(CONSTANTS.GRID_H - 2, Math.ceil(center.gy + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - center.gx;
      const dy = y - center.gy;
      if (dx * dx + dy * dy > radius2) continue;
      if (gridRef[y]?.[x] === TILES.TUNNEL) return true;
    }
  }
  return false;
}

function initQueenChamberObjective(world) {
  if (!world) return;

  const radiusTiles = CONFIG.queenChamberRadiusTiles ?? 5;
  const minTiles = CONFIG.queenChamberMinTiles ?? Math.max(8, Math.round(Math.PI * radiusTiles * radiusTiles * 0.55));
  const center = pickQueenChamberCenter(world.grid);

  world.objectives = world.objectives || {};
  world.objectives.queenChamber = {
    status: "unstarted",
    center,
    radiusTiles,
    minTiles,
    priority: true,
  };

  world.queenChamber = {
    centerGxGy: center,
    radiusTiles,
    minTiles,
    roomTiles: new Set(),
  };
}

function updateQueenChamberObjective(world) {
  if (!world) return;

  const objective = world.objectives?.queenChamber;
  if (!objective) return;

  const gridRef = world.grid;
  const chamber = world.queenChamber || {};
  const center = objective.center || chamber.centerGxGy;
  const radius = objective.radiusTiles ?? chamber.radiusTiles ?? CONFIG.queenChamberRadiusTiles;
  const minTiles = chamber.minTiles || objective.minTiles || CONFIG.queenChamberMinTiles || Math.max(8, Math.round(Math.PI * radius * radius * 0.55));

  if (!center) {
    objective.status = "unstarted";
    return;
  }

  chamber.centerGxGy = center;
  chamber.radiusTiles = radius;
  chamber.minTiles = minTiles;

  const roomSet = chamber.roomTiles;
  if (roomSet?.clear) roomSet.clear();

  const centerTile = gridRef?.[center.gy]?.[center.gx];
  const hasNearby = hasTunnelNearby(center, radius, gridRef);
  const start = findChamberPathStart(world);
  const path = start ? findTunnelPath(start, center, gridRef) : null;

  const tiles = collectQueenChamberTiles(center, radius, gridRef, roomSet);
  const ready = !!path && tiles.count >= minTiles;

  if (world.zoneGrid && roomSet) {
    for (const key of roomSet) {
      const gy = Math.floor(key / CONSTANTS.GRID_W);
      const gx = key % CONSTANTS.GRID_W;
      if (!world.zoneGrid[gy]) world.zoneGrid[gy] = [];
      world.zoneGrid[gy][gx] = "queen";
    }
  }

  objective.center = center;
  objective.radiusTiles = radius;
  objective.minTiles = minTiles;
  objective.status = ready
    ? "ready"
    : (centerTile === TILES.TUNNEL || hasNearby ? "digging" : "unstarted");
  if (objective.status === "ready") {
    objective.priority = false;
  }

  world.queenChamber = chamber;
}

function findQueenChamberTunnelTarget(world) {
  const gridRef = world?.grid;
  const objective = world?.objectives?.queenChamber;
  const chamber = world?.queenChamber;
  if (!gridRef || !objective) return null;

  const center = objective.center || chamber?.centerGxGy;
  const radius = objective.radiusTiles || chamber?.radiusTiles || CONFIG.queenChamberRadiusTiles || 4;
  if (!center) return null;

  const radius2 = radius * radius;
  const roomTiles = chamber?.roomTiles;
  let best = null;
  let bestScore = Infinity;

  const consider = (gx, gy) => {
    if (gridRef[gy]?.[gx] !== TILES.TUNNEL) return;
    const dx = gx - center.gx;
    const dy = gy - center.gy;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > radius2 + 4) return;
    if (dist2 < bestScore) {
      bestScore = dist2;
      best = { gx, gy };
    }
  };

  if (roomTiles?.size) {
    for (const key of roomTiles) {
      const gx = key % CONSTANTS.GRID_W;
      const gy = Math.floor(key / CONSTANTS.GRID_W);
      consider(gx, gy);
    }
  }

  if (!best) consider(center.gx, center.gy);

  if (!best) {
    const minX = Math.max(1, Math.floor(center.gx - radius));
    const maxX = Math.min(CONSTANTS.GRID_W - 2, Math.ceil(center.gx + radius));
    const minY = Math.max(CONSTANTS.REGION_SPLIT + 1, Math.floor(center.gy - radius));
    const maxY = Math.min(CONSTANTS.GRID_H - 2, Math.ceil(center.gy + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - center.gx;
        const dy = y - center.gy;
        if (dx * dx + dy * dy > radius2) continue;
        consider(x, y);
      }
    }
  }

  return best;
}

function getQueenPathStart(queen, world) {
  const gridRef = world?.grid;
  if (!queen || !gridRef) return findChamberPathStart(world);

  const cs = CONSTANTS.CELL_SIZE;
  const qgx = Math.floor(queen.x / cs);
  const qgy = Math.floor(queen.y / cs);

  if (gridRef[qgy]?.[qgx] === TILES.TUNNEL) return { gx: qgx, gy: qgy };

  const radius = 2;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = qgx + dx;
      const ny = qgy + dy;
      if (gridRef[ny]?.[nx] === TILES.TUNNEL) return { gx: nx, gy: ny };
    }
  }

  return findChamberPathStart(world);
}

function updateQueenRelocation(world) {
  const objective = world?.objectives?.queenChamber;
  if (!objective || objective.status !== "ready") return;

  const queen = getQueen(world);
  const target = findQueenChamberTunnelTarget(world);
  if (!target) return;

  const start = queen ? getQueenPathStart(queen, world) : findChamberPathStart(world);
  const hasPath = start && findTunnelPath(start, target, world.grid);
  if (!hasPath) return;

  const prev = world.queenMoveTarget;
  const changed = !prev || prev.gx !== target.gx || prev.gy !== target.gy;
  if (changed) {
    world.queenMoveTarget = { gx: target.gx, gy: target.gy };
    if (queen) {
      queen.targetGxGy = null;
      queen.path = null;
      queen.pathIndex = 0;
      queen.repathCooldown = 0;
    }
  }

  if (queen && queen.state === "FOUNDING_SURFACE") {
    queen.repathCooldown = 0;
  }
}

function initQueenState(queen) {
  if (!queen || queen.type !== "queen") return;
  if (queen.state) return;
  const qgy = Math.floor(queen.y / CONSTANTS.CELL_SIZE);
  const onSurface = qgy < CONSTANTS.REGION_SPLIT;
  queen.state = onSurface ? "FOUNDING_SURFACE" : "SETTLED";
}

function syncQueenTarget(queen, world) {
  if (!queen || queen.type !== "queen") return false;
  const target = world?.queenMoveTarget;
  const changed = !!target && (!queen.targetGxGy || queen.targetGxGy.gx !== target.gx || queen.targetGxGy.gy !== target.gy);
  if (changed) {
    queen.targetGxGy = { gx: target.gx, gy: target.gy };
    queen.path = null;
    queen.pathIndex = 0;
  }
  return changed;
}

function updateQueenPath(queen, world, force = false) {
  if (!queen || queen.type !== "queen" || !queen.targetGxGy) return;
  if (!force && queen.repathCooldown > 0) return;

  const gridRef = world?.grid ?? grid;
  const start = getQueenPathStart(queen, world) || {
    gx: Math.floor(queen.x / CONSTANTS.CELL_SIZE),
    gy: Math.floor(queen.y / CONSTANTS.CELL_SIZE),
  };
  const path = findTunnelPath(start, queen.targetGxGy, gridRef);
  queen.path = path || null;
  queen.pathIndex = 0;
  queen.repathCooldown = 0.8;
}

function stepQueenAlongPath(queen, dt, world) {
  if (!queen?.path || queen.path.length === 0) return 0;

  const gridRef = world?.grid ?? grid;
  const cs = CONSTANTS.CELL_SIZE;
  let remaining = (CONFIG.queenSpeed ?? 25) * dt;
  let travel = 0;

  while (remaining > 0 && queen.pathIndex < queen.path.length) {
    const node = queen.path[queen.pathIndex];
    const nodeTile = gridRef[node.gy]?.[node.gx];
    const isStart = queen.pathIndex === 0;
    if (!isStart && nodeTile !== TILES.TUNNEL) {
      queen.path = null;
      break;
    }

    const tx = (node.gx + 0.5) * cs;
    const ty = (node.gy + 0.5) * cs;
    const dx = tx - queen.x;
    const dy = ty - queen.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      queen.pathIndex++;
      continue;
    }

    const step = Math.min(dist, remaining);
    const nx = queen.x + (dx / dist) * step;
    const ny = queen.y + (dy / dist) * step;
    queen.x = nx;
    queen.y = ny;
    remaining -= step;
    travel += step;

    if (step === dist) {
      queen.pathIndex++;
    }
  }

  return travel;
}

function clamp01(v){ return Math.max(0, Math.min(1, v)); }

function angleLerp(current, target, factor) {
  const twoPi = Math.PI * 2;
  const diff = ((target - current + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return current + diff * factor;
}

function computeDirectionalSignal(ant, field, opts = {}) {
  const sa = CONFIG.sensorAngle;
  const sd = CONFIG.sensorDist;

  const wasteAdjustedSample = (angOff) => {
    const base = ant.sample(field, angOff, sd);
    const waste = ant.sampleWaste(angOff, sd);
    return base * (1 - Math.min(0.5, waste * 0.12));
  };

  const valL = wasteAdjustedSample(-sa);
  const valC = wasteAdjustedSample(0);
  const valR = wasteAdjustedSample(sa);

  const weightedC = valC * CONFIG.forwardBias;
  const bestVal = Math.max(weightedC, valL, valR);
  const minThreshold = opts.min ?? 0.01;

  if (bestVal <= minThreshold) return { angle: null, confidence: 0, magnitude: bestVal };

  const angle = (weightedC >= valL && weightedC >= valR)
    ? ant.angle
    : (valL > valR ? ant.angle - sa : ant.angle + sa);

  const secondBest = (weightedC >= valL && weightedC >= valR)
    ? Math.max(valL, valR)
    : Math.max(weightedC, (valL > valR ? valR : valL));

  const spread = Math.max(0, bestVal - secondBest);
  const baseConfidence = clamp01((bestVal * 0.7) + spread);
  const confidence = baseConfidence * (opts.weight ?? 1);

  return { angle, confidence, magnitude: bestVal };
}

function getHomeSteeringField(ant, gx, gy, worldState) {
  const signals = [];
  const underground = ant.y > CONSTANTS.REGION_SPLIT * CONSTANTS.CELL_SIZE;
  const nestCore = getNestCorePos(worldState);
  const queen = nestCore?.queen ?? null;
  const entrance = worldState?.entrance ?? ENTRANCE;

  if (queen) {
    const queenSignal = computeDirectionalSignal(ant, queenScent, {
      weight: nestCore?.settled ? (underground ? 1.4 : 0.8) : 0.4,
      min: 0,
    });
    signals.push(queenSignal);
  }

  const entranceDistance = Math.hypot((entrance.x - ant.x), (entrance.y - ant.y));
  const entranceRadiusPx = (CONFIG.entranceCueRadius ?? NEST_ENTRANCE.radius) * CONSTANTS.CELL_SIZE;
  const entranceWeight = 0.6 + 0.6 * clamp01(1 - (entranceDistance / Math.max(1, entranceRadiusPx * 2.5)));
  const entranceSignal = computeDirectionalSignal(ant, scentToHome, {
    weight: entranceWeight,
  });
  signals.push(entranceSignal);

  const bestSignal = signals.reduce((best, next) => next.confidence > best.confidence ? next : best, { angle: null, confidence: 0 });

  const hvx = ant.homeVector?.x ?? 0;
  const hvy = ant.homeVector?.y ?? 0;
  const hvMag = Math.hypot(hvx, hvy);
  const vectorConfidence = hvMag > 0 ? clamp01((hvMag - (ant.vectorUncertainty || 0)) / (hvMag + 1)) * 0.9 : 0;
  if (vectorConfidence > bestSignal.confidence) {
    return { angle: Math.atan2(hvy, hvx), confidence: vectorConfidence };
  }

  return bestSignal;
}
function trophallaxisLife(baseLife) { return DebugOverlay.flags.highlightTransfers ? Math.max(baseLife, 0.8) : baseLife; }
function hsl(h,s,l){ return `hsl(${h} ${s}% ${l}%)`; }
function shadeHex(hex, factor) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;

  const adjust = (c) => {
    const delta = factor >= 0 ? (255 - c) * factor : c * factor;
    return Math.min(255, Math.max(0, Math.round(c + delta)));
  };

  r = adjust(r);
  g = adjust(g);
  b = adjust(b);

  return `rgb(${r},${g},${b})`;
}

function pseudoRandom(x, y, seed = 0) {
  const v = Math.sin((x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453);
  return v - Math.floor(v);
}

function getTile(x, y) {
  if (y < 0 || y >= CONSTANTS.GRID_H || x < 0 || x >= CONSTANTS.GRID_W) return TILES.BEDROCK;
  const row = grid[y];
  if (!row) return TILES.BEDROCK;
  const val = row[x];
  return (val === undefined || val === null) ? TILES.BEDROCK : val;
}

function getTexture(x, y) {
  if (y < 0 || y >= CONSTANTS.GRID_H || x < 0 || x >= CONSTANTS.GRID_W) return 0;
  const row = gridTexture[y];
  if (!row) return 0;
  const val = row[x];
  return (val === undefined || val === null) ? 0 : val;
}

function broodCountAtTile(gx, gy, stage = null) {
  let count = 0;
  const cs = CONSTANTS.CELL_SIZE;
  for (const b of brood) {
    const bx = Math.floor(b.x / cs);
    const by = Math.floor(b.y / cs);
    if (bx === gx && by === gy && (!stage || b.stage === stage)) count++;
  }
  return count;
}

function countNearbyBrood(gx, gy, radius, stage = null) {
  const r2 = radius * radius;
  let count = 0;
  for (const b of brood) {
    if (stage && b.stage !== stage) continue;
    const bx = Math.floor(b.x / CONSTANTS.CELL_SIZE);
    const by = Math.floor(b.y / CONSTANTS.CELL_SIZE);
    const dx = bx - gx;
    const dy = by - gy;
    if ((dx * dx + dy * dy) <= r2) count++;
  }
  return count;
}

function findPlacementTile(stage, queenGx, queenGy) {
  const prefs = BROOD_PLACEMENT[stage] || BROOD_PLACEMENT.larva;
  const search = Math.ceil(prefs.searchRadius);
  let best = null;
  let bestScore = -Infinity;

  for (let dy = -search; dy <= search; dy++) {
    const gy = queenGy + dy;
    if (gy < 0 || gy >= CONSTANTS.GRID_H) continue;
    for (let dx = -search; dx <= search; dx++) {
      const gx = queenGx + dx;
      if (gx < 0 || gx >= CONSTANTS.GRID_W) continue;
      const tile = getTile(gx, gy);
      if (tile !== TILES.TUNNEL) continue;

      const dist = Math.hypot(dx, dy);
      const stageCount = broodCountAtTile(gx, gy, stage);
      if (stageCount >= (prefs.maxPerTile || 3)) continue;

      if (dist < 0.6) continue; // avoid stacking on the queen's exact tile

      // Distance band preference
      const bandCenter = prefs.target ?? ((prefs.min + prefs.max) / 2);
      let score = Math.max(0, 6 - Math.abs(dist - bandCenter) * 3);
      if (dist < prefs.min) score -= (prefs.min - dist) * 2.5;
      if (dist > prefs.max) score -= (dist - prefs.max) * 2.0;

      // Entrance avoidance
      const distToEntrance = Math.hypot(gx - NEST_ENTRANCE.gx, gy - NEST_ENTRANCE.gy);
      if (distToEntrance < 6) score -= (6 - distToEntrance) * 0.8;

      // Waste penalty
      if (wasteGrid && wasteGrid[gy]) {
        const wasteAmt = wasteGrid[gy][gx] || 0;
        score -= wasteAmt * 2.5;
      }

      // Traffic approximation: avoid strong food/home trails for brood storage
      const traffic = Math.max(scentToFood?.[gy]?.[gx] || 0, scentToHome?.[gy]?.[gx] || 0);
      score -= traffic * 0.5;

      // Cluster with same stage nearby but avoid overcrowding
      const nearbySame = countNearbyBrood(gx, gy, 2, stage);
      score += Math.min(nearbySame, 3) * 0.5;

      if (score > bestScore) {
        bestScore = score;
        best = { gx, gy };
      }
    }
  }

  return best;
}

function consumeStoredFood(amount) {
  const pulled = takeStoredFoodAnywhere(amount, "seed");
  return pulled >= amount;
}

function addWasteAtWorldPos(wx, wy, amount) {
  const gx = Math.floor(wx / CONSTANTS.CELL_SIZE);
  const gy = Math.floor(wy / CONSTANTS.CELL_SIZE);
  addWaste(gx, gy, amount);
}

function addWaste(gx, gy, amount) {
  if (!wasteGrid[gy] || wasteGrid[gy][gx] === undefined) return;
  const amt = Math.min(WASTE.maxTile, amount);
  const next = Math.min(WASTE.maxTile, wasteGrid[gy][gx] + amt);
  wasteTotal += next - wasteGrid[gy][gx];
  wasteGrid[gy][gx] = next;
}

function takeWaste(gx, gy, amount) {
  if (!wasteGrid[gy] || wasteGrid[gy][gx] === undefined) return 0;
  const available = Math.min(amount, wasteGrid[gy][gx]);
  const before = wasteGrid[gy][gx];
  wasteGrid[gy][gx] -= available;
  wasteTotal -= available;
  if (wasteGrid[gy][gx] < 0.001) wasteGrid[gy][gx] = 0;
  const ratio = before > 0 ? (wasteGrid[gy][gx] / before) : 0;
  rescaleWasteTags(gx, gy, ratio);
  return available;
}

function getWaste(gx, gy) {
  if (!wasteGrid[gy]) return 0;
  return wasteGrid[gy][gx] || 0;
}

function tagWaste(gx, gy, tag, amount = 1) {
  if (!wasteTags[gy] || wasteTags[gy][gx] === undefined) return;
  if (amount <= 0) return;
  const cell = wasteTags[gy][gx];
  cell[tag] = (cell[tag] || 0) + amount;
}

function getWasteTag(gx, gy, tag) {
  return wasteTags[gy]?.[gx]?.[tag] || 0;
}

function rescaleWasteTags(gx, gy, ratio) {
  const cell = wasteTags[gy]?.[gx];
  if (!cell) return;
  if (ratio <= 0) {
    wasteTags[gy][gx] = {};
    return;
  }
  for (const key of Object.keys(cell)) {
    cell[key] *= ratio;
    if (cell[key] < 0.0001) delete cell[key];
  }
}

function makeFoodStore() {
  return { seed: 0, protein: 0, sugar: 0 };
}

function getStoredFoodTotalAt(gx, gy) {
  const cell = storedFoodGrid[gy]?.[gx];
  if (!cell) return 0;
  return FOOD_TYPES.reduce((sum, type) => sum + (cell[type] || 0), 0);
}

function addStoredFoodAt(gx, gy, type, amount) {
  if (!storedFoodGrid[gy] || !storedFoodGrid[gy][gx]) return 0;
  const cell = storedFoodGrid[gy][gx];
  const amt = Math.max(0, amount || 0);
  cell[type] = (cell[type] || 0) + amt;
  foodInStorage += amt;
  return amt;
}

function takeStoredFoodAt(gx, gy, type, amount) {
  const cell = storedFoodGrid[gy]?.[gx];
  if (!cell || !cell[type]) return 0;
  const taken = Math.min(amount, cell[type]);
  cell[type] -= taken;
  foodInStorage -= taken;
  if (cell[type] < 0.0001) cell[type] = 0;
  return taken;
}

function takeStoredFoodAnywhere(amount, type = "seed") {
  let remaining = amount;
  for (let y = 0; y < storedFoodGrid.length; y++) {
    const row = storedFoodGrid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      const pulled = takeStoredFoodAt(x, y, type, remaining);
      remaining -= pulled;
      if (remaining <= 0) return amount;
    }
  }
  return amount - remaining;
}

function getFoodInStorageTotal() {
  let total = 0;
  for (let y = 0; y < storedFoodGrid.length; y++) {
    const row = storedFoodGrid[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x++) {
      total += getStoredFoodTotalAt(x, y);
    }
  }
  return total;
}

function getStoredFoodTotalsGrid() {
  const totals = [];
  for (let y = 0; y < storedFoodGrid.length; y++) {
    const row = new Float32Array(storedFoodGrid[y]?.length || 0);
    for (let x = 0; x < row.length; x++) {
      row[x] = getStoredFoodTotalAt(x, y);
    }
    totals[y] = row;
  }
  return totals;
}

function computeDesiredRoleFractions() {
  const spacePressure = ColonyState?.getSpacePressure ? ColonyState.getSpacePressure() : 0.3;
  const foodPressure = ColonyState?.getFoodPressure ? ColonyState.getFoodPressure() : 0.3;
  const wastePressure = ColonyState?.getWastePressure ? ColonyState.getWastePressure() : 0.0;

  let diggerFrac = ROLE_SETTINGS.baseDiggerFraction;
  diggerFrac += spacePressure * 0.45;
  diggerFrac -= foodPressure * 0.30;
  diggerFrac = clamp01(diggerFrac);
  diggerFrac = Math.min(ROLE_SETTINGS.maxDiggerFraction, Math.max(ROLE_SETTINGS.minDiggerFraction, diggerFrac));

  let cleanerFrac = ROLE_SETTINGS.baseCleanerFraction + wastePressure * ROLE_SETTINGS.cleanerPressureGain;
  cleanerFrac = clamp01(Math.min(ROLE_SETTINGS.maxCleanerFraction, cleanerFrac));

  const remaining = clamp01(1 - cleanerFrac);
  diggerFrac = clamp01(diggerFrac * remaining);
  const foragerFrac = clamp01(1 - diggerFrac - cleanerFrac);
  return { digger: diggerFrac, forager: foragerFrac, cleaner: cleanerFrac };
}

function pickRoleForNewWorker() {
  const workers = ants.filter(a => a.type === "worker");
  const desired = computeDesiredRoleFractions();
  const counts = {
    digger: workers.filter(a => a.role === "digger").length,
    cleaner: workers.filter(a => a.role === "cleaner").length,
  };

  const desiredCounts = {
    digger: Math.round((workers.length + 1) * desired.digger),
    cleaner: Math.round((workers.length + 1) * desired.cleaner),
  };

  if (counts.cleaner < desiredCounts.cleaner) return "cleaner";
  if (counts.digger < desiredCounts.digger) return "digger";
  return "forager";
}

function resetSimulation() {
  grid = [];
  gridTexture = [];
  foodGrid = [];
  storedFoodGrid = [];
  wasteGrid = [];
  wasteTags = [];
  scentToFood = [];
  scentToHome = [];
  queenScent = [];
  broodScent = [];
  nurseScent = [];
  ants = [];
  particles = [];
  foodInStorage = 0;
  wasteTotal = 0;
  brood = [];
  nextAntId = 1;
  worldState.queenRef = null;
  worldState.queenId = null;
  worldState.queen = null;
  worldState.queenMoveTarget = null;

  for (let y = 0; y < CONSTANTS.GRID_H; y++) {
    grid[y] = new Uint8Array(CONSTANTS.GRID_W);
    gridTexture[y] = new Float32Array(CONSTANTS.GRID_W);
    foodGrid[y] = new Uint8Array(CONSTANTS.GRID_W);
    storedFoodGrid[y] = new Array(CONSTANTS.GRID_W);
    wasteGrid[y] = new Float32Array(CONSTANTS.GRID_W);
    wasteTags[y] = new Array(CONSTANTS.GRID_W);
    scentToFood[y] = new Float32Array(CONSTANTS.GRID_W);
    scentToHome[y] = new Float32Array(CONSTANTS.GRID_W);
    queenScent[y] = new Float32Array(CONSTANTS.GRID_W);
    broodScent[y] = new Float32Array(CONSTANTS.GRID_W);
    nurseScent[y] = new Float32Array(CONSTANTS.GRID_W);

    for (let x = 0; x < CONSTANTS.GRID_W; x++) {
      const n = Math.sin(x*0.27)*Math.cos(y*0.29)*0.5+0.5;
      gridTexture[y][x] = n;

      storedFoodGrid[y][x] = makeFoodStore();
      wasteTags[y][x] = {};

      if (x===0 || x===CONSTANTS.GRID_W-1 || y===CONSTANTS.GRID_H-1 || y===0) grid[y][x] = TILES.BEDROCK;
      else if (y < CONSTANTS.REGION_SPLIT) grid[y][x] = TILES.GRASS;
      else grid[y][x] = TILES.SOIL;
    }
  }

  if (CONFIG.foundingSeedHole) {
    grid[DIG_START.gy][DIG_START.gx] = TILES.TUNNEL;
  }

  const findEntranceTunnel = () => {
    const radius = 2;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = DIG_START.gx + dx;
        const ny = DIG_START.gy + dy;
        if (getTile(nx, ny) === TILES.TUNNEL) {
          return { gx: nx, gy: ny };
        }
      }
    }
    return null;
  };

  // Food clusters
  for (let i = 0; i < 15; i++) {
    const cx = Math.floor(Math.random() * (CONSTANTS.GRID_W - 10) + 5);
    const cy = Math.floor(Math.random() * (CONSTANTS.REGION_SPLIT - 5) + 5);
    const r = Math.random() * 3 + 2;

    for (let fy = cy - r; fy <= cy + r; fy++) {
      for (let fx = cx - r; fx <= cx + r; fx++) {
        if ((fx - cx) ** 2 + (fy - cy) ** 2 <= r * r) {
          if (fx > 0 && fx < CONSTANTS.GRID_W && fy > 0 && fy < CONSTANTS.GRID_H) {
            const gx = Math.floor(fx);
            const gy = Math.floor(fy);
            const added = Math.floor(Math.random() * 15 + 5);
            const next = Math.min(255, foodGrid[gy][gx] + added);
            foodGrid[gy][gx] = next;
          }
        }
      }
    }
  }

  // Queen & founding group spawn near the surface entrance
  const entranceJitter = () => (Math.random() - 0.5) * CONSTANTS.CELL_SIZE * 0.9;
  const qx = ENTRANCE.x + entranceJitter();
  const qy = ENTRANCE.y + entranceJitter();
  const qgx = Math.floor(qx / CONSTANTS.CELL_SIZE);
  const qgy = Math.floor(qy / CONSTANTS.CELL_SIZE);

  worldState.grid = grid;
  worldState.gridTexture = gridTexture;
  worldState.particles = particles;
  worldState.entrance = ENTRANCE;
  worldState.digStart = DIG_START;
  worldState.foundingMode = true;
  worldState.queenMoveTarget = getTile(DIG_START.gx, DIG_START.gy) === TILES.TUNNEL
    ? { gx: DIG_START.gx, gy: DIG_START.gy }
    : findEntranceTunnel();
  worldState.wasteGrid = wasteGrid;
  worldState.wasteTags = wasteTags;
  worldState.wasteTotal = wasteTotal;
  worldState.broodScent = broodScent;
  worldState.nurseScent = nurseScent;
  initQueenChamberObjective(worldState);
  AirSystem.reset(worldState);
  DiggingSystem.reset(worldState);
  BroodSystem.reset(worldState);
  brood = BroodSystem.getBrood();
  worldState.brood = brood;

  const queen = new Ant("queen", qx, qy);
  ants.push(queen);
  worldState.queenRef = queen;
  worldState.queenId = queen.id;
  worldState.queen = queen;

  const createWorkerWithAgeFraction = (ageFraction, role, options = {}) => {
    const { skipAgeBasedRole = false } = options;
    const wx = qx + entranceJitter();
    const wy = qy + entranceJitter();
    const worker = new Ant("worker", wx, wy, role);
    worker.age = worker.lifespan * ageFraction;
    if (!skipAgeBasedRole) worker.updateAgeBasedRole();
    return worker;
  };

  const foundingWorkers = Math.floor(Math.random() * 7) + 6; // 6-12 workers
  for (let i = 0; i < foundingWorkers; i++) {
    const ageFraction = clamp01(Math.random());
    ants.push(createWorkerWithAgeFraction(ageFraction, "digger", { skipAgeBasedRole: true }));
  }

  // Build edges once per reset
  rebuildEdgeOverlay(grid);

  ColonyState.updateColonyState(worldState, ants);

  // Reset Camera
  ZOOM = 1.0;
  camX = qx - VIEW_W / 2;
  camY = qy - VIEW_H / 2;

  // Fresh scent texture
  updateScentTexture(scentToFood, scentToHome, broodScent);
  scentFrameCounter = 0;
  airFrameCounter = 0;
}

// ==============================
// ANT CLASS
// ==============================

function isInEntranceRegion(gx, gy) {
  const radius = CONFIG.entranceCueRadius ?? NEST_ENTRANCE.radius;
  const dx = gx - ENTRANCE.gx;
  const dy = gy - ENTRANCE.gy;
  return (dx * dx + dy * dy) <= radius * radius;
}

function spreadQueenScent(queen, world) {
  if (!queen) return;

  const gridRef = world?.grid ?? grid;
  const qgx = Math.floor(queen.x / CONSTANTS.CELL_SIZE);
  const qgy = Math.floor(queen.y / CONSTANTS.CELL_SIZE);

  const tile = gridRef?.[qgy]?.[qgx];
  const inTunnel = tile === TILES.TUNNEL;
  const settled = queen.state === "SETTLED";

  const surfaceScale = CONFIG.queenScentSurfaceScale ?? 0;
  const relocatingScale = CONFIG.queenScentRelocatingScale ?? 0.4;

  const spreadScale = inTunnel
    ? (settled ? 1 : relocatingScale)
    : surfaceScale;

  if (spreadScale <= 0) return;

  const reachRadius = Math.max(1, Math.round(inTunnel ? 6 : (CONFIG.queenScentSurfaceReach ?? 3)));
  const coreRadius = inTunnel && settled ? 3 : 1.5;

  for (let dy = -reachRadius; dy <= reachRadius; dy++) {
    const ny = qgy + dy;
    if (ny <= 0 || ny >= CONSTANTS.GRID_H - 1) continue;

    for (let dx = -reachRadius; dx <= reachRadius; dx++) {
      const nx = qgx + dx;
      if (nx <= 0 || nx >= CONSTANTS.GRID_W - 1) continue;

      const targetTile = gridRef?.[ny]?.[nx];
      if (targetTile === TILES.SOIL || targetTile === TILES.BEDROCK) continue;
      if (!inTunnel && targetTile !== TILES.TUNNEL) continue;

      const dist = Math.hypot(dx, dy);
      if (dist > reachRadius) continue;

      let strength = 0;
      if (dist < 0.5) strength = 0.8;
      else if (dist <= coreRadius) strength = 0.45 + (coreRadius - dist) * 0.1;
      else strength = Math.max(0.08, 0.25 - (dist - coreRadius) * 0.03);

      queenScent[ny][nx] = Math.min(1.0, queenScent[ny][nx] + strength * spreadScale);
    }
  }
}

function seedEntranceHomeScent() {
  const { gx, gy } = ENTRANCE;
  const cueStrength = CONFIG.entranceCueStrength ?? 0;
  const cueRadius = CONFIG.entranceCueRadius ?? NEST_ENTRANCE.radius;
  const fadeDepth = Math.max(0, Math.min(CONFIG.entranceCueFadeDepth ?? 0, 2));

  if (cueStrength <= 0 || cueRadius <= 0) return;

  const sampleRadius = Math.max(1, Math.ceil(cueRadius));
  for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
    const ny = gy + dy;
    if (!scentToHome[ny]) continue;
    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
      const nx = gx + dx;
      if (nx <= 0 || nx >= CONSTANTS.GRID_W - 1) continue;
      if (grid[ny][nx] === TILES.SOIL || grid[ny][nx] === TILES.BEDROCK) continue;

      const dist = Math.hypot(dx, dy);
      if (dist > cueRadius + 0.001) continue;

      const falloff = 1 - Math.min(1, dist / Math.max(0.0001, cueRadius));
      const add = cueStrength * (0.55 + 0.45 * falloff);
      scentToHome[ny][nx] = Math.min(1.0, scentToHome[ny][nx] + add);
    }
  }

  // Small fade just inside the entrance (optional and shallow)
  for (let step = 1; step <= fadeDepth; step++) {
    const ny = gy + step;
    if (ny >= CONSTANTS.GRID_H - 1) break;
    if (!scentToHome[ny]) continue;
    if (grid[ny][gx] === TILES.SOIL || grid[ny][gx] === TILES.BEDROCK) break;

    const fade = cueStrength * Math.max(0.15, 0.45 - (step - 1) * 0.2);
    scentToHome[ny][gx] = Math.min(1.0, scentToHome[ny][gx] + fade);

    if (grid[ny][gx - 1] !== TILES.SOIL) scentToHome[ny][gx - 1] = Math.min(1.0, scentToHome[ny][gx - 1] + fade * 0.6);
    if (grid[ny][gx + 1] !== TILES.SOIL) scentToHome[ny][gx + 1] = Math.min(1.0, scentToHome[ny][gx + 1] + fade * 0.6);
  }
}

class Ant {
  constructor(type, x, y, role = null) {
    this.id = nextAntId++;
    this.type = type;
    this.isQueen = type === "queen";
    this.x = x; this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.carrying = null;
    this.returnDir = null;
    this.maxEnergy = 100;
    this.energy = this.maxEnergy;
    this.animRig = ANT_ANIM.createRig(type);
    this.stepDistance = 0;

    this.homeVector = { x: NEST_ENTRANCE.x - x, y: NEST_ENTRANCE.y - y };
    this.vectorUncertainty = 0;

    this.age = 0;
    const baseLifespan = 2000 + Math.random() * 1000;
    this.lifespan = (type === "queen") ? baseLifespan * 40 : baseLifespan;

    this.carryingWaste = false;
    this.carryingWasteAmount = 0;
    this.cleanTarget = null;
    this.carryingCorpse = false;
    this.carryingBrood = null;
    this.broodDropTarget = null;
    this.broodTimer = 0;

    this.baseThreshold = 0.1 + Math.random() * 0.5;
    this.broodThreshold = this.baseThreshold;

    this.postDeliveryTime = 0;

    this.lostMode = null;
    this.lostT = 0;
    this.searchPhase = Math.random() * Math.PI * 2;
    this.searchGain = 0;
    this.lastHomeConfidence = 0;
    this.homeSignalLowT = 0;

    this.intent = "wander";
    this.intentScores = null;
    this.intentTopChoices = null;

    if (type === "queen") this.role = "queen";
    else this.role = role || (type === "worker" ? "forager" : "forager");
    this.workerPreference = this.role;

    this.lastX = x; this.lastY = y;
    this.stuckT = 0;
    this.panicT = 0;

    this.digTarget = null;
    this.digRetargetT = Math.random() * 0.4;
    this.lastDigVector = null;
    this.pendingDigVector = null;
    this.lastDugCell = null;
    this.digHeadingAngle = null;
    this.digHeadingStrength = 0;
    this.digIdleTime = 0;
    this.digMode = "corridor";
    this.roomCenter = null;
    this.roomRadius = 0;
    this.roomDigBudget = 0;
    this.roomDug = 0;
    this.roomCooldown = 0;

    this.inNestCore = false;

    if (type === "queen") {
      this.state = null;
      this.targetGxGy = null;
      this.path = null;
      this.pathIndex = 0;
      this.repathCooldown = 0;
      this.pathProgressTimer = 0;
      this.lastPathSample = { x, y };
    }
  }

  getEffectiveThreshold() {
    const ageFactor = clamp01(this.age / this.lifespan);
    let threshold = this.baseThreshold + ageFactor * 0.5;

    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    if (
      gx >= 0 && gx < CONSTANTS.GRID_W &&
      gy >= 0 && gy < CONSTANTS.GRID_H &&
      nurseScent[gy] && nurseScent[gy][gx] !== undefined
    ) {
      threshold += nurseScent[gy][gx] * 0.8;
    }

    this.broodThreshold = threshold;
    return threshold;
  }

  updateAgeBasedRole() {
    if (this.type !== "worker") return;

    const queenObjective = worldState?.objectives?.queenChamber;
    const queenChamberPriority = !!(queenObjective?.priority && queenObjective.status !== "ready");
    if (queenChamberPriority) {
      if (this.role !== "digger") {
        this.role = "digger";
        this.digRetargetT = 0;
      }
      return;
    }

    const ageFrac = clamp01(this.age / this.lifespan);
    const effectiveThreshold = this.getEffectiveThreshold();
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);

    let broodStimulus = 0;
    if (
      gx >= 0 && gx < CONSTANTS.GRID_W &&
      gy >= 0 && gy < CONSTANTS.GRID_H &&
      broodScent[gy] && broodScent[gy][gx] !== undefined
    ) {
      broodStimulus = broodScent[gy][gx];
    }

    let nextRole = this.role;

    if (broodStimulus > effectiveThreshold) {
      nextRole = "nurse";
    } else if (ageFrac <= 0.75) {
      nextRole = this.chooseMiddleAgeRole();
    } else {
      nextRole = "forager";
    }

    if (nextRole !== this.role) {
      if (nextRole !== "digger") this.digTarget = null;
      if (nextRole === "digger") this.digRetargetT = 0;
      this.role = nextRole;
    }
  }

  chooseMiddleAgeRole() {
    // 1. Immediate environmental trigger: Is the ant holding trash or standing on it?
    if (this.cleanTarget || this.carryingWaste || this.carryingCorpse) return "cleaner";

    const localWaste = this.findLocalWasteTarget(2);
    if (localWaste) return "cleaner";

    // 2. Colony-wide pressure (Task Allocation)
    // Check global colony state rather than static birth preference
    const wastePressure = ColonyState.getWastePressure(); // 0.0 to 1.0
    const spacePressure = ColonyState.getSpacePressure(); // 0.0 to 1.0

    // Priority A: Hygiene is critical (prevent disease)
    if (wastePressure > 0.45) return "cleaner";

    // Priority B: Space is critical (crowding)
    if (spacePressure > 0.6) return "digger";

    // Priority C: Default maintenance behavior
    // If no crisis, middle-aged ants default to digging/maintenance
    return "digger";
  }

  computeIntentScores(worldState) {
    const scores = {
      panic: 0,
      dig: 0,
      clean: 0,
      forage: 0,
      returnHome: 0,
      wander: 0.1,
    };

    const queenObjective = worldState?.objectives?.queenChamber;
    const queenChamberPriority = !!(queenObjective?.priority && queenObjective.status !== "ready");
    const constructionPush = queenChamberPriority && this.type !== "queen";

    scores.panic = this.lostMode ? 1 : (this.panicT > 0 ? 1 : 0);

    if (this.role === "nurse") {
      scores.returnHome = 0.95;
      scores.dig = 0;
      scores.clean = Math.max(scores.clean, 0.1);
      scores.forage = 0;
    }

    if (this.carrying) {
      scores.returnHome = 0.95;
    } else {
      const lowEnergy = this.energy / this.maxEnergy;
      if (lowEnergy < 0.35) scores.returnHome = Math.max(scores.returnHome, 0.6);
    }

    if (!this.carrying && this.role === "digger") {
      let digScore = 0.5;
      if (this.digTarget) digScore += 0.25;
      scores.dig = digScore;
    }

    if (!this.carrying && this.role === "cleaner") {
      const wastePressure = clamp01((worldState?.wasteTotal || 0) / (CONSTANTS.GRID_W * 0.7));
      let cleanScore = 0.35 + wastePressure * 0.4;
      if (this.cleanTarget || this.carryingWaste || this.carryingCorpse) cleanScore = Math.max(cleanScore, 0.8);
      scores.clean = cleanScore;
    }

    if (!this.carrying && this.role !== "nurse") {
      let forageScore = 0.4;
      if (this.role === "forager") forageScore += 0.2;
      if (worldState?.storedFood !== undefined) {
        const scarcity = clamp01(1 - Math.min(1, worldState.storedFood / 25));
        forageScore += scarcity * 0.25;
      }
      scores.forage = forageScore;
    }

    scores.wander = Math.max(scores.wander, 0.2 - scores.panic * 0.1);

    if (constructionPush) {
      scores.dig = Math.max(scores.dig, 1.0);
      scores.clean = Math.min(scores.clean, 0.02);
      scores.forage = Math.min(scores.forage, 0.02);
      scores.wander = Math.min(scores.wander, 0.05);
      if (!this.carrying) {
        scores.returnHome = Math.min(scores.returnHome, 0.2);
      }
    }

    return scores;
  }

  lostModeDirection(dt, worldState) {
    this.lostT += dt;

    const cgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const cgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    const homeSignal = getHomeSteeringField(this, cgx, cgy, worldState);
    this.lastHomeConfidence = homeSignal.confidence;

    if (homeSignal.confidence > 0.35 && homeSignal.angle !== null) {
      this.clearLostMode();
      this.returnDir = homeSignal.angle;
      return angleLerp(this.angle, homeSignal.angle, 0.25);
    }

    const maxLostDuration = 6;
    if (this.lostT > maxLostDuration) {
      this.clearLostMode();
      return this.angle + (Math.random() - 0.5) * 0.6;
    }

    if (this.lostMode === "surface") {
      const homeAngle = Math.atan2(this.homeVector.y, this.homeVector.x);
      const baseBias = Number.isFinite(homeAngle)
        ? angleLerp(sunAngle, homeAngle, 0.6)
        : sunAngle;

      this.searchGain = Math.min(this.searchGain + dt * 0.45, 1.6);
      this.searchPhase += dt * (1.1 + this.searchGain * 0.5);
      const sweep = Math.sin(this.searchPhase) * (0.4 + this.searchGain * 0.35);
      const jitter = (Math.random() - 0.5) * 0.25;

      return baseBias + sweep + jitter;
    }

    const queen = getQueen(worldState);
    let biasAngle = null;
    if (queen) {
      const queenSignal = computeDirectionalSignal(this, queenScent, { weight: 1.2, min: 0 });
      if (queenSignal.angle !== null && queenSignal.confidence > 0) {
        biasAngle = queenSignal.angle;
        this.lastHomeConfidence = Math.max(this.lastHomeConfidence, queenSignal.confidence);
      }
    }

    this.searchGain = Math.min(this.searchGain + dt * 0.3, 1.2);
    this.searchPhase += dt * (1 + this.searchGain * 0.7);
    const arc = Math.sin(this.searchPhase) * (0.25 + this.searchGain * 0.25);
    const base = biasAngle ?? this.angle;
    let candidate = base + arc;

    const cs = CONSTANTS.CELL_SIZE;
    const aheadX = Math.floor((this.x + Math.cos(candidate) * cs) / cs);
    const aheadY = Math.floor((this.y + Math.sin(candidate) * cs) / cs);
    const aheadTile = getTile(aheadX, aheadY);

    if (aheadTile === TILES.SOIL || aheadTile === TILES.BEDROCK) {
      const left = base - 0.7;
      const right = base + 0.7;
      const leftTile = getTile(Math.floor((this.x + Math.cos(left) * cs) / cs), Math.floor((this.y + Math.sin(left) * cs) / cs));
      const rightTile = getTile(Math.floor((this.x + Math.cos(right) * cs) / cs), Math.floor((this.y + Math.sin(right) * cs) / cs));
      if (leftTile === TILES.TUNNEL || leftTile === TILES.GRASS) candidate = left;
      else if (rightTile === TILES.TUNNEL || rightTile === TILES.GRASS) candidate = right;
    }

    const jitter = (Math.random() - 0.5) * 0.15;
    return candidate + jitter;
  }

  registerHomeSignal(confidence, dt) {
    this.lastHomeConfidence = confidence;
    if (this.lostMode) return;

    if (this.carrying || this.intent === "returnHome") {
      if (confidence < 0.15) {
        this.homeSignalLowT += dt;
        if (this.homeSignalLowT > 1.1) this.startLostMode("low-signal");
      } else {
        this.homeSignalLowT = 0;
      }
    } else {
      this.homeSignalLowT = 0;
    }
  }

  chooseIntent(scores) {
    let bestIntent = "wander";
    let bestScore = -Infinity;

    for (const [intent, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestIntent = intent;
      }
    }

    return bestIntent;
  }

  resetStuckTimer() {
    this.lastX = this.x;
    this.lastY = this.y;
    this.stuckT = 0;
    this.panicT = 0;
  }

  startLostMode(reason = "") {
    if (this.lostMode) return;
    const isSurface = this.y < CONSTANTS.REGION_SPLIT * CONSTANTS.CELL_SIZE;
    this.lostMode = isSurface ? "surface" : "underground";
    this.lostT = 0;
    this.searchGain = 0;
    this.searchPhase = Math.random() * Math.PI * 2;
    this.homeSignalLowT = 0;
    this.lostReason = reason;
  }

  clearLostMode() {
    this.lostMode = null;
    this.lostT = 0;
    this.searchGain = 0;
    this.homeSignalLowT = 0;
  }

  isInsideQueenRadius() {
    const queen = getQueen(worldState);
    if (!queen) return false;

    const dx = queen.x - this.x;
    const dy = queen.y - this.y;
    return (dx * dx + dy * dy) <= QUEEN_RADIUS_PX2;
  }
  updateNestCoreState() {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);

    let scentStrength = 0;
    if (queenScent[gy] && queenScent[gy][gx] !== undefined) {
      scentStrength = queenScent[gy][gx];
    }

    const queen = getQueen(worldState);
    if (queen) {
      const dx = queen.x - this.x;
      const dy = queen.y - this.y;
      const dist = Math.hypot(dx, dy);
      const distFactor = 1 - clamp01(dist / (CONFIG.queenRadius * CONSTANTS.CELL_SIZE));
      scentStrength = Math.max(scentStrength, distFactor);
    }

    this.inNestCore = scentStrength >= CONFIG.nestCoreQueenThreshold;
  }

  maybeDropWaste(dt) {
    const chance = WASTE.dropChancePerSecond * dt;
    if (Math.random() > chance) return;
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    if (grid[gy] && grid[gy][gx] === TILES.TUNNEL) {
      addWaste(gx, gy, WASTE.dropAmount);
    }
  }

  findLocalWasteTarget(radius) {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    let best = null;
    let bestAmt = 0.4;

    for (let y = gy - radius; y <= gy + radius; y++) {
      const row = wasteGrid[y];
      if (!row) continue;
      for (let x = gx - radius; x <= gx + radius; x++) {
        const amt = row[x];
        if (amt === undefined || amt <= bestAmt) continue;
        if (grid[y] && grid[y][x] !== TILES.TUNNEL) continue;
        bestAmt = amt;
        best = { x, y };
      }
    }
    return best;
  }

  cleanerSense() {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);

    if (this.carryingCorpse) {
      const dumpRow = Math.max(1, CONSTANTS.REGION_SPLIT - WASTE.cleanerDumpY);
      if (gy < dumpRow) {
        const dropY = Math.max(1, Math.min(dumpRow, gy));
        addWaste(gx, dropY, WASTE.maxTile);
        tagWaste(gx, dropY, "refuse", WASTE.maxTile);
        tagWaste(gx, dropY, "corpse", WASTE.maxTile);
        this.carryingCorpse = false;
        this.cleanTarget = null;
        return this.angle + (Math.random() - 0.5) * 0.6;
      }
      const targetY = (CONSTANTS.REGION_SPLIT - 2) * CONSTANTS.CELL_SIZE;
      return Math.atan2(targetY - this.y, (gx + 0.5) * CONSTANTS.CELL_SIZE - this.x);
    }

    if (this.carryingWaste) {
      const dumpRow = Math.max(1, CONSTANTS.REGION_SPLIT - WASTE.cleanerDumpY);
      if (gy < dumpRow) {
        const dropY = Math.max(1, Math.min(dumpRow, gy));
        const amt = this.carryingWasteAmount || WASTE.cleanerPickup;
        addWaste(gx, dropY, amt);
        tagWaste(gx, dropY, "refuse", amt);
        this.carryingWaste = false;
        this.carryingWasteAmount = 0;
        this.cleanTarget = null;
        return this.angle + (Math.random() - 0.5) * 0.6;
      }
      const targetY = (CONSTANTS.REGION_SPLIT - 2) * CONSTANTS.CELL_SIZE;
      return Math.atan2(targetY - this.y, (gx + 0.5) * CONSTANTS.CELL_SIZE - this.x);
    }

    if (this.cleanTarget) {
      if (this.cleanTarget.type === "corpse") {
        if (ants.includes(this.cleanTarget.ant) && this.cleanTarget.ant.type === "corpse") {
          return Math.atan2(this.cleanTarget.ant.y - this.y, this.cleanTarget.ant.x - this.x);
        }
        this.cleanTarget = null;
      } else {
        const amt = getWaste(this.cleanTarget.x, this.cleanTarget.y);
        if (amt > 0.1) {
          return Math.atan2((this.cleanTarget.y + 0.5) * CONSTANTS.CELL_SIZE - this.y, (this.cleanTarget.x + 0.5) * CONSTANTS.CELL_SIZE - this.x);
        }
        this.cleanTarget = null;
      }
    }

    let corpseTarget = null;
    const maxCorpseDist2 = (WASTE.cleanerSightRadius * CONSTANTS.CELL_SIZE) ** 2;
    for (const other of ants) {
      if (other === this || other.type !== "corpse") continue;
      if ((other.decompositionTimer ?? 0) <= OLEIC_ACID_THRESHOLD) continue;
      const dx = other.x - this.x;
      const dy = other.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= maxCorpseDist2) {
        corpseTarget = other;
        break;
      }
    }

    if (corpseTarget) {
      this.cleanTarget = { type: "corpse", ant: corpseTarget };
      return Math.atan2(corpseTarget.y - this.y, corpseTarget.x - this.x);
    }

    const local = this.findLocalWasteTarget(WASTE.cleanerSightRadius);
    if (local) {
      this.cleanTarget = { ...local, type: "waste" };
      return Math.atan2((local.y + 0.5) * CONSTANTS.CELL_SIZE - this.y, (local.x + 0.5) * CONSTANTS.CELL_SIZE - this.x);
    }

    if (gy > CONSTANTS.REGION_SPLIT * 1.2) {
      return -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    }

    return this.angle + (Math.random() - 0.5) * 0.6;
  }

  update(dt) {
    this.stepDistance = 0;
    this.age += dt;
    this.updateAgeBasedRole();

    const handleDeath = () => {
      if (this.type !== "corpse") this.decompositionTimer = 0;
      this.isDead = true;
      this.type = "corpse";
      this.carrying = null;
      this.cleanTarget = null;
      ANT_ANIM.step(this.animRig, { dt, travel: 0, speedHint: 0 });
    };

    if (this.type === "corpse") {
      this.decompositionTimer = (this.decompositionTimer ?? 0) + dt;
      ANT_ANIM.step(this.animRig, { dt, travel: 0, speedHint: 0 });
      return;
    }

    if (this.isDead) { handleDeath(); return; }

    if (this.age > this.lifespan || this.energy <= 0) { handleDeath(); return; }
    if (this.type === "queen") {
      initQueenState(this);
      this.repathCooldown = Math.max(0, (this.repathCooldown ?? 0) - dt);

      const targetChanged = syncQueenTarget(this, worldState);
      const qgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const qgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      const gridRef = worldState?.grid ?? grid;

      const atTarget = () => {
        if (!this.targetGxGy) return false;
        const tx = (this.targetGxGy.gx + 0.5) * CONSTANTS.CELL_SIZE;
        const ty = (this.targetGxGy.gy + 0.5) * CONSTANTS.CELL_SIZE;
        return Math.hypot(this.x - tx, this.y - ty) < 2;
      };

      const canAttemptRelocate = (this.state === "FOUNDING_SURFACE" || targetChanged) && this.targetGxGy && gridRef;
      if (canAttemptRelocate && this.repathCooldown <= 0) {
        updateQueenPath(this, worldState, true);
        if (this.path && this.path.length > 0) {
          this.state = "RELOCATING";
        }
      }

      if (this.state === "RELOCATING") {
        const pathInvalid = !this.path || this.path.length === 0;
        const stuckCheckInterval = 1.0;
        this.pathProgressTimer = (this.pathProgressTimer ?? 0) + dt;
        let isStuck = false;
        if (this.pathProgressTimer >= stuckCheckInterval) {
          const moved = Math.hypot(this.x - this.lastPathSample.x, this.y - this.lastPathSample.y);
          isStuck = moved < 2;
          this.lastPathSample = { x: this.x, y: this.y };
          this.pathProgressTimer = 0;
        }

        const cooldownElapsed = this.repathCooldown <= 0;
        const shouldRepath =
          targetChanged ||
          isStuck ||
          (pathInvalid && cooldownElapsed) ||
          cooldownElapsed;
        if (shouldRepath) {
          const forceRepath = targetChanged || isStuck;
          updateQueenPath(this, worldState, forceRepath || cooldownElapsed);
        }

        this.stepDistance = stepQueenAlongPath(this, dt, worldState);

        const nextNode = this.path?.[this.pathIndex] || null;
        if (nextNode && gridRef?.[nextNode.gy]?.[nextNode.gx] !== TILES.TUNNEL && this.pathIndex > 0) {
          this.path = null;
        }

        if (this.path && this.pathIndex >= this.path.length) {
          this.path = null;
        }

        if (atTarget()) {
          this.state = "SETTLED";
          this.path = null;
          this.pathIndex = 0;
          worldState.foundingMode = false;
          if (worldState?.objectives?.queenChamber) {
            worldState.objectives.queenChamber.priority = false;
            worldState.objectives.queenChamber.status = "ready";
          }
        } else if (!this.path || this.path.length === 0) {
          this.state = qgy < CONSTANTS.REGION_SPLIT ? "FOUNDING_SURFACE" : this.state;
        }
      } else {
        this.stepDistance = 0;
      }

      // Emit a local queen scent used only for nest-core state detection
      spreadQueenScent(this, worldState);

      const intentScores = this.computeIntentScores(worldState);
      this.intentScores = intentScores;
      this.intentTopChoices = Object.entries(intentScores).sort((a, b) => b[1] - a[1]).slice(0, 2);
      this.intent = this.chooseIntent(intentScores);

      ANT_ANIM.step(this.animRig, { dt, travel: this.stepDistance, speedHint: CONFIG.queenSpeed });
      return;
    }

    this.energy = Math.max(0, Math.min(this.maxEnergy, this.energy - ENERGY_DECAY_RATE * dt));

    if (this.age > this.lifespan || this.energy <= 0) { handleDeath(); return; }

    if (this.carrying && this.energy < 15) {
      this.carrying = null;
      this.energy = Math.min(this.maxEnergy, this.energy + 40);
      this.returnDir = null;
    }

    this.shareEnergy();

    if (this.postDeliveryTime > 0) {
      this.postDeliveryTime = Math.max(0, this.postDeliveryTime - dt);
    }

    if (this.age > this.lifespan || this.energy <= 0) { handleDeath(); return; }

    this.stuckT += dt;
    if (this.stuckT > CONFIG.stuckThreshold) {
      const d2 = (this.x - this.lastX) ** 2 + (this.y - this.lastY) ** 2;
      if (d2 < 100) {
        this.startLostMode("stuck");
        this.angle = Math.random() * Math.PI * 2;
      }
      this.lastX = this.x; this.lastY = this.y;
      this.stuckT = 0;
    }

    this.maybeDropWaste(dt);

    const intentScores = this.computeIntentScores(worldState);
    this.intentScores = intentScores;
    this.intentTopChoices = Object.entries(intentScores).sort((a, b) => b[1] - a[1]).slice(0, 2);
    this.intent = this.chooseIntent(intentScores);

    let speedMult = 1.0;
    let forcedAngle = null;
    if (!this.carrying && this.energy < 25) {
      this.intent = "returnHome";
      const queen = getQueen(worldState);
      if (queen) forcedAngle = Math.atan2(queen.y - this.y, queen.x - this.x);
      speedMult = 0.7;
    }

    const lostDesired = this.lostMode ? this.lostModeDirection(dt, worldState) : null;
    if (this.lostMode) {
      speedMult = Math.min(1.2, speedMult + 0.1);
    }

    if (this.carrying || this.role !== "digger") {
      this.digTarget = null;
    } else {
      this.digRetargetT -= dt;
      if (this.digRetargetT <= 0) {
        this.digTarget = DiggingSystem.chooseDigTarget(this, worldState);
        this.digRetargetT = 0.6 + Math.random() * 0.6;
      }
    }

    if (this.digHeadingStrength > 0) {
      this.digHeadingStrength = Math.max(0, this.digHeadingStrength - CONFIG.digHeadingDecayRate * dt);
      if (this.digHeadingStrength === 0) this.digHeadingAngle = null;
    }

    this.digIdleTime += dt;
    if (this.roomCooldown > 0) this.roomCooldown = Math.max(0, this.roomCooldown - dt);

    this.updateNestCoreState();

    const desired = forcedAngle ?? lostDesired ?? this.sense(dt);

    let diff = desired - this.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff >  Math.PI) diff -= Math.PI * 2;

    const turnRate = CONFIG.turnSpeed * 15 * dt;
    if (Math.abs(diff) > turnRate) diff = Math.sign(diff) * turnRate;

    this.angle += diff;
    this.angle += (Math.random() - 0.5) * CONFIG.wanderStrength;

    this.move(dt, speedMult);

    if (this.role === "nurse") {
      const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      if (
        gx >= 0 && gx < CONSTANTS.GRID_W &&
        gy >= 0 && gy < CONSTANTS.GRID_H &&
        nurseScent[gy] && nurseScent[gy][gx] !== undefined
      ) {
        nurseScent[gy][gx] = Math.min(1.0, nurseScent[gy][gx] + 0.1);
      }
    }
    this.dropScent();
    ANT_ANIM.step(this.animRig, { dt, travel: this.stepDistance, speedHint: CONFIG.workerSpeed });
  }

  shareEnergy() {
    const maxDist2 = CONSTANTS.CELL_SIZE * CONSTANTS.CELL_SIZE;

    // Prioritize feeding the queen
    for (const other of ants) {
      if (other === this || other.type !== "queen") continue;

      const dx = other.x - this.x;
      const dy = other.y - this.y;
      if ((dx * dx + dy * dy) >= maxDist2) continue;

      if (this.energy > 10 && other.energy < other.maxEnergy) {
        const receiverCapacity = other.maxEnergy - other.energy;
        const availableToGive = this.energy - 10;
        const actualTransfer = Math.min(40, receiverCapacity, availableToGive);

        if (actualTransfer > 0) {
          this.energy = Math.max(0, this.energy - actualTransfer);
          other.energy = Math.min(other.maxEnergy, other.energy + actualTransfer);

          trophallaxisEvents.push({
            x1: this.x,
            y1: this.y,
            x2: other.x,
            y2: other.y,
            amount: actualTransfer,
            life: trophallaxisLife(0.2),
          });
        }
      }
    }

    // Share with nearby workers using existing safety margin logic
    for (const other of ants) {
      if (other === this || other.type === "queen") continue;

      const dx = other.x - this.x;
      const dy = other.y - this.y;
      if ((dx * dx + dy * dy) >= maxDist2) continue;

      if (this.energy > other.energy + 20) {
        const desiredTransfer = (this.energy - other.energy) / 2;
        const receiverCapacity = other.maxEnergy - other.energy;
        const actualTransfer = Math.min(desiredTransfer, receiverCapacity, this.energy);

        if (actualTransfer > 0) {
          this.energy = Math.max(0, this.energy - actualTransfer);
          other.energy = Math.min(other.maxEnergy, other.energy + actualTransfer);

          trophallaxisEvents.push({
            x1: this.x,
            y1: this.y,
            x2: other.x,
            y2: other.y,
            amount: actualTransfer,
            life: trophallaxisLife(0.2),
          });
        }
      }
    }
  }

  sense(dt) {
    if (this.postDeliveryTime > 0) {
      const queen = getQueen(worldState);
      if (queen) {
        const away = Math.atan2(this.y - queen.y, this.x - queen.x);
        return away + (Math.random() - 0.5) * 0.35;
      }
      return this.angle + (Math.random() - 0.5) * 0.8;
    }

    if (this.carryingBrood && this.broodDropTarget) {
      const targetX = (this.broodDropTarget.gx + 0.5) * CONSTANTS.CELL_SIZE;
      const targetY = (this.broodDropTarget.gy + 0.5) * CONSTANTS.CELL_SIZE;
      const offset = Math.atan2(targetY - this.y, targetX - this.x);
      return offset + (Math.random() - 0.5) * 0.25;
    }

    if (this.role === "nurse") {
      const queen = getQueen(worldState);
      const preferredRadius = Math.max(QUEEN_RADIUS_PX, 80);
      if (queen) {
        const dx = queen.x - this.x;
        const dy = queen.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > preferredRadius * preferredRadius) {
          return Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.25;
        }
      }

      let nearestBrood = null;
      let bestD2 = preferredRadius * preferredRadius;
      // BIOLOGICAL FIX: minimum interaction distance to avoid walking through brood
      const ARRESTMENT_DIST_SQ = 100;
      for (const b of brood) {
        const dx = b.x - this.x;
        const dy = b.y - this.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; nearestBrood = b; }
      }
      if (nearestBrood) {
        if (bestD2 < ARRESTMENT_DIST_SQ) {
          return this.angle + (Math.random() - 0.5) * 1.5;
        }
        return Math.atan2(nearestBrood.y - this.y, nearestBrood.x - this.x) + (Math.random() - 0.5) * 0.3;
      }

      return this.angle + (Math.random() - 0.5) * 0.35;
    }

    if (this.inNestCore) {
      const queen = getQueen(worldState);

      if (this.carrying && queen) {
        const towardQueen = Math.atan2(queen.y - this.y, queen.x - this.x);
        return towardQueen + (Math.random() - 0.5) * 0.25;
      }

      if (queen) {
        const away = Math.atan2(this.y - queen.y, this.x - queen.x);
        return away + (Math.random() - 0.5) * 0.45;
      }

      return this.angle + (Math.random() - 0.5) * 0.6;
    }

    const homeDx = NEST_ENTRANCE.x - this.x;
    const homeDy = NEST_ENTRANCE.y - this.y;
    const entranceRadius = NEST_ENTRANCE.radius * CONSTANTS.CELL_SIZE;
    const nearEntrance = (homeDx * homeDx + homeDy * homeDy) <= entranceRadius * entranceRadius;
    if (nearEntrance) {
      this.homeVector.x = homeDx;
      this.homeVector.y = homeDy;
      this.vectorUncertainty = 0;
    }

    switch (this.intent) {
      case "clean":
        if (!this.carrying) {
          return this.cleanerSense();
        }
        break;
      case "dig":
        if (!this.carrying && this.digTarget) {
          const { x, y } = this.digTarget;
          if (!grid[y] || grid[y][x] !== TILES.SOIL) {
            this.digTarget = null;
          } else {
            return Math.atan2((y + 0.5) * CONSTANTS.CELL_SIZE - this.y, (x + 0.5) * CONSTANTS.CELL_SIZE - this.x);
          }
        }
        break;
      default:
        break;
    }

    const g = this.carrying || this.intent === "returnHome" ? scentToHome : scentToFood;
    const ignoreFoodPheromone = this.inNestCore || (!this.carrying && this.isInsideQueenRadius());
    const sa = CONFIG.sensorAngle;
    const sd = CONFIG.sensorDist;

    if (this.carrying || this.intent === "returnHome") {
      const cgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const cgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      const steering = getHomeSteeringField(this, cgx, cgy, worldState);
      this.registerHomeSignal(steering.confidence, dt);

      if (steering.angle !== null) {
        this.returnDir = steering.angle;
        const smoothed = angleLerp(this.angle, steering.angle, 0.2);
        return smoothed;
      }

      if (this.returnDir === null) this.returnDir = this.angle;
      const homeAngle = Math.atan2(this.homeVector.y, this.homeVector.x);
      return Number.isFinite(homeAngle) ? homeAngle : this.returnDir;
    }

    const valL = ignoreFoodPheromone ? 0 : this.sample(g, -sa, sd);
    const valC = ignoreFoodPheromone ? 0 : this.sample(g, 0, sd);
    const valR = ignoreFoodPheromone ? 0 : this.sample(g, sa, sd);

    const wasteL = this.sampleWaste(-sa, sd);
    const wasteC = this.sampleWaste(0, sd);
    const wasteR = this.sampleWaste(sa, sd);

    const adjust = (v, w) => v * (1 - Math.min(0.5, w * 0.12));
    const adjL = adjust(valL, wasteL);
    const adjC = adjust(valC, wasteC);
    const adjR = adjust(valR, wasteR);

    const weightedC = adjC * CONFIG.forwardBias;

    const hasPheromoneTrail = Math.max(adjL, adjC, adjR) > 0.05;
    if (hasPheromoneTrail) {
      const best = (weightedC > adjL && weightedC > adjR)
        ? this.angle
        : (adjL > adjR ? this.angle - sa : this.angle + sa);

      if (this.carrying) this.returnDir = best;
      this.homeVector.x = NEST_ENTRANCE.x - this.x;
      this.homeVector.y = NEST_ENTRANCE.y - this.y;
      this.vectorUncertainty = 0;
      return best;
    }

    if (this.y > CONSTANTS.REGION_SPLIT * CONSTANTS.CELL_SIZE) {
      return -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
    }
    return this.angle + (Math.random() - 0.5) * 2.0;
  }

  sample(g, angOff, dist) {
    if (dist === 0) {
      const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      if (gx >= 0 && gx < CONSTANTS.GRID_W && gy >= 0 && gy < CONSTANTS.GRID_H) return g[gy][gx];
      return 0;
    }
    const tx = this.x + Math.cos(this.angle + angOff) * dist;
    const ty = this.y + Math.sin(this.angle + angOff) * dist;
    const gx = Math.floor(tx / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(ty / CONSTANTS.CELL_SIZE);
    if (gx >= 0 && gx < CONSTANTS.GRID_W && gy >= 0 && gy < CONSTANTS.GRID_H) return g[gy][gx];
    return 0;
  }

  sampleWaste(angOff, dist) {
    const tx = this.x + Math.cos(this.angle + angOff) * dist;
    const ty = this.y + Math.sin(this.angle + angOff) * dist;
    const gx = Math.floor(tx / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(ty / CONSTANTS.CELL_SIZE);
    if (gx >= 0 && gx < CONSTANTS.GRID_W && gy >= 0 && gy < CONSTANTS.GRID_H) return getWaste(gx, gy);
    return 0;
  }

  move(dt, speedMult) {
    const cgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const cgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    const wasteSlow = 1 - Math.min(0.35, getWaste(cgx, cgy) * 0.08);
    const speed = CONFIG.workerSpeed * speedMult * wasteSlow;
    const look = 6;

    const nx = this.x + Math.cos(this.angle) * look;
    const ny = this.y + Math.sin(this.angle) * look;

    if (this.isBlocked(nx, ny)) {
      const lBlocked = this.isBlocked(this.x + Math.cos(this.angle - 1) * look, this.y + Math.sin(this.angle - 1) * look);
      const rBlocked = this.isBlocked(this.x + Math.cos(this.angle + 1) * look, this.y + Math.sin(this.angle + 1) * look);

      if (!lBlocked) this.angle -= 1.5;
      else if (!rBlocked) this.angle += 1.5;
      else this.angle += Math.PI;

      const gx = Math.floor(nx / CONSTANTS.CELL_SIZE);
      const gy = Math.floor(ny / CONSTANTS.CELL_SIZE);

      if (grid[gy] && grid[gy][gx] === TILES.SOIL) {
        const digPher = DiggingSystem.getDigPheromone();
        const targetMatch = this.digTarget && this.digTarget.x === gx && this.digTarget.y === gy;
        const sharedFrontier = digPher[gy][gx] > 0.08;

        if (!this.carrying && (targetMatch || sharedFrontier)) {
          if (DiggingSystem.applyDigAction(this, worldState, gx, gy)) return;
        }
      }
    } else {
      const dx = Math.cos(this.angle) * speed * dt;
      const dy = Math.sin(this.angle) * speed * dt;
      this.x += dx;
      this.y += dy;
      this.stepDistance = Math.hypot(dx, dy);

      this.homeVector.x -= dx;
      this.homeVector.y -= dy;

      const noiseScale = 0.02 * this.stepDistance;
      const noiseX = (Math.random() - 0.5) * 2 * noiseScale;
      const noiseY = (Math.random() - 0.5) * 2 * noiseScale;
      this.homeVector.x += noiseX;
      this.homeVector.y += noiseY;
      this.vectorUncertainty += Math.hypot(noiseX, noiseY);

      this.interact();
    }
  }

  isBlocked(tx, ty) {
    const gx = Math.floor(tx / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(ty / CONSTANTS.CELL_SIZE);
    if (gx <= 0 || gx >= CONSTANTS.GRID_W - 1 || gy <= 0 || gy >= CONSTANTS.GRID_H - 1) return true;
    const t = grid[gy][gx];
    return t === TILES.SOIL || t === TILES.BEDROCK;
  }

  dropScent() {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    if (gx < 0 || gy < 0 || gx >= CONSTANTS.GRID_W || gy >= CONSTANTS.GRID_H) return;

    if (this.inNestCore || this.isInsideQueenRadius()) return;

    const vecToEntranceX = NEST_ENTRANCE.x - this.x;
    const vecToEntranceY = NEST_ENTRANCE.y - this.y;
    const dotToEntrance = Math.cos(this.angle) * vecToEntranceX + Math.sin(this.angle) * vecToEntranceY;
    const movingTowardEntrance = dotToEntrance > 0;
    const movingAwayFromEntrance = dotToEntrance < 0;

    if (this.carrying) {
      if (movingTowardEntrance) {
        scentToFood[gy][gx] = Math.min(1.0, scentToFood[gy][gx] + CONFIG.depositAmount);
      }
    } else {
      if (movingAwayFromEntrance) {
        scentToHome[gy][gx] = Math.min(1.0, scentToHome[gy][gx] + (CONFIG.depositAmount * 0.5));
      }
    }
  }

  interact() {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    if (gx < 0 || gx >= CONSTANTS.GRID_W || gy < 0 || gy >= CONSTANTS.GRID_H) return;

    if (this.pendingDigVector) {
      this.lastDigVector = this.pendingDigVector;
      this.pendingDigVector = null;
    }

    if (this.role === "nurse") {
      const queen = getQueen(worldState);
      const cs = CONSTANTS.CELL_SIZE;

      // 1. CHECK FOR HUNGRY BROOD TO FEED (Priority)
      // Only feed if nurse has energy in social stomach (> 30)
      if (this.energy > 30) {
        const feedDist = cs;
        const hungryBrood = worldState.brood?.find(b => {
           return b.stage === "larva" && b.needsFood &&
                  Math.abs(b.x - this.x) < feedDist &&
                  Math.abs(b.y - this.y) < feedDist;
        });

        if (hungryBrood) {
          const cost = BroodSystem.getNurseEnergyCost();
          this.energy -= cost;
          BroodSystem.feedBrood(hungryBrood, addWasteAtWorldPos);

          trophallaxisEvents.push({
            x1: this.x, y1: this.y,
            x2: hungryBrood.x, y2: hungryBrood.y,
            amount: 28, life: trophallaxisLife(0.5)
          });

          this.stuckT = -0.5;
        }
      }

      if (queen) {
        const queenGx = Math.floor(queen.x / cs);
        const queenGy = Math.floor(queen.y / cs);
        const larvaCrowding = countNearbyBrood(queenGx, queenGy, 2.5, "larva");

        const broodHere = worldState.brood?.find((b) => {
          const bx = Math.floor(b.x / cs);
          const by = Math.floor(b.y / cs);
          return bx === gx && by === gy && (!b.lockedBy || b.lockedBy === this);
        });

        const shouldPickupBrood = (b) => {
          const prefs = BROOD_PLACEMENT[b.stage] || BROOD_PLACEMENT.larva;
          const distTiles = Math.hypot(b.x - queen.x, b.y - queen.y) / cs;

          if (b.stage === "larva" && b.needsFood) return true;
          if (b.stage === "larva" && larvaCrowding > prefs.maxPerTile + 1 && distTiles < prefs.min + 0.5) return true;

          if (distTiles < prefs.min - 0.1) return true;
          if (distTiles > prefs.max + 0.6) return true;

          return false;
        };

        if (!this.carryingBrood && broodHere && shouldPickupBrood(broodHere)) {
          this.carryingBrood = broodHere;
          broodHere.lockedBy = this;
          this.broodTimer = 2.0;
          this.broodDropTarget = findPlacementTile(broodHere.stage, queenGx, queenGy) || null;
        }

        if (this.carryingBrood) {
          BroodSystem.updateBroodPos(this.carryingBrood, this.x, this.y);

          if (!this.broodDropTarget || broodCountAtTile(this.broodDropTarget.gx, this.broodDropTarget.gy, this.carryingBrood.stage) >= (BROOD_PLACEMENT[this.carryingBrood.stage]?.maxPerTile || 3)) {
            this.broodDropTarget = findPlacementTile(this.carryingBrood.stage, queenGx, queenGy) || this.broodDropTarget;
          }

          if (this.broodTimer > 0) this.broodTimer -= 0.016;

          const target = this.broodDropTarget;
          if (target) {
            const targetX = (target.gx + 0.5) * cs;
            const targetY = (target.gy + 0.5) * cs;
            const dist = Math.hypot(targetX - this.x, targetY - this.y);
            const crowded = broodCountAtTile(target.gx, target.gy, this.carryingBrood.stage) >= (BROOD_PLACEMENT[this.carryingBrood.stage]?.maxPerTile || 3);
            const reachedTile = gx === target.gx && gy === target.gy;

            if (dist < cs * 0.6 && reachedTile && !crowded && this.broodTimer <= 0) {
              BroodSystem.updateBroodPos(this.carryingBrood, targetX, targetY);
              delete this.carryingBrood.lockedBy;
              this.carryingBrood = null;
              this.broodDropTarget = null;
              this.broodTimer = 0;
            } else if (crowded) {
              this.broodDropTarget = findPlacementTile(this.carryingBrood.stage, queenGx, queenGy) || null;
            }
          } else if (this.broodTimer <= 0) {
            delete this.carryingBrood.lockedBy;
            this.carryingBrood = null;
            this.broodTimer = 0;
          }
        }
      } else if (this.carryingBrood && this.broodTimer <= 0) {
        delete this.carryingBrood.lockedBy;
        this.carryingBrood = null;
        this.broodDropTarget = null;
      }
    }

    if (this.role === "cleaner") {
      if (!this.carryingCorpse) {
        let corpseIndex = -1;
        const maxDist2 = (CONSTANTS.CELL_SIZE * 0.8) ** 2;
        for (let i = 0; i < ants.length; i++) {
          const other = ants[i];
          if (other === this || other.type !== "corpse") continue;
          const dx = other.x - this.x;
          const dy = other.y - this.y;
          if ((dx * dx + dy * dy) <= maxDist2) { corpseIndex = i; break; }
        }
        if (corpseIndex >= 0) {
          ants.splice(corpseIndex, 1);
          this.carryingCorpse = true;
          this.cleanTarget = null;
          this.resetStuckTimer();
          return;
        }
      }

      if (!this.carryingWaste && !this.carryingCorpse) {
        const pulled = takeWaste(gx, gy, WASTE.cleanerPickup);
        if (pulled > 0) {
          this.carryingWaste = true;
          this.carryingWasteAmount = pulled;
          this.cleanTarget = null;
          this.resetStuckTimer();
          return;
        }
      }
    }

    // CONSUME STORED FOOD (Metabolism)
    // If hungry, empty-handed, and standing on stored food in the nest, eat it.
    if (!this.carrying && this.energy < this.maxEnergy * 0.6) {
      const storedTotal = getStoredFoodTotalAt(gx, gy);
      if (storedTotal > 0) {
        const needed = this.maxEnergy - this.energy;
        // Eat up to 20 energy units or whatever is available
        const amountToEat = Math.min(20, needed, storedTotal);

        if (amountToEat > 0) {
          const eaten = takeStoredFoodAt(gx, gy, "seed", amountToEat);
          this.energy += eaten;

          // 20% chance to generate waste (metabolic byproduct)
          if (eaten > 0 && Math.random() < 0.2) {
            addWaste(gx, gy, 0.1);
          }
          if (eaten > 0) return; // Action consumed this tick
        }
      }
    }

    if (!this.carrying && foodGrid[gy][gx] > 0) {
      foodGrid[gy][gx]--;
      this.carrying = { type: "seed", amount: 1 };
      this.returnDir = this.angle + Math.PI;
      this.resetStuckTimer();
      this.angle += Math.PI;
      return;
    }

    const queen = getQueen(worldState);
    const distanceToQueen = queen ? Math.hypot(queen.x - this.x, queen.y - this.y) : Infinity;
    const deepInNest = gy > (CONSTANTS.REGION_SPLIT + 2);
    const queenSettled = queen && queen.state === "SETTLED";
    const preferQueenDrop = queenSettled && distanceToQueen < Math.max(QUEEN_RADIUS_PX * 0.9, 60);
    const canStoreFoodHere = this.inNestCore || this.isInsideQueenRadius() || !queen;
    if (this.carrying && canStoreFoodHere && deepInNest && distanceToQueen > 15) {
      const tile = grid[gy]?.[gx];
      const foodCap = preferQueenDrop ? 8 : 5;
      if (tile === TILES.TUNNEL && getStoredFoodTotalAt(gx, gy) < foodCap) {
        addStoredFoodAt(gx, gy, this.carrying.type, 1);
        this.carrying.amount = Math.max(0, this.carrying.amount - 1);
        if (this.carrying.amount <= 0) this.carrying = null;
        this.returnDir = null;
        this.postDeliveryTime = CONFIG.postDeliveryDuration;
        this.resetStuckTimer();
        this.angle += Math.PI;
      }
    }
  }
}

// ==============================
// RENDER & LOOP
// ==============================

function render() {
  // Base transform for DPR (CSS pixel coordinate system)
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // Clear
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // World transform
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-camX, -camY);

  const cs = CONSTANTS.CELL_SIZE;

  const sx = Math.floor(camX / cs);
  const sy = Math.floor(camY / cs);
  const ex = sx + Math.ceil(VIEW_W / ZOOM / cs) + 2;
  const ey = sy + Math.ceil(VIEW_H / ZOOM / cs) + 2;

  // Terrain
  ctx.imageSmoothingEnabled = false;
  for (let y = sy; y < ey; y++) {
    for (let x = sx; x < ex; x++) {
      const t = getTile(x, y);
      const n = getTexture(x, y);
      const px = x * cs, py = y * cs;

      const foodRow = foodGrid[y];

      if (t === TILES.GRASS) {
        const variation = (n - 0.5) * 0.3;
        const base = shadeHex("#567d46", variation);
        ctx.fillStyle = base;
        ctx.fillRect(px, py, cs, cs);

        // Patchy grass noise
        for (let i = 0; i < 2; i++) {
          const tone = variation + (pseudoRandom(x, y, i + 1) > 0.5 ? 0.12 : -0.12);
          const size = Math.max(3, Math.floor(cs * (0.35 + pseudoRandom(x, y, i + 3) * 0.35)));
          const ox = Math.floor(pseudoRandom(x, y, i + 5) * (cs - size));
          const oy = Math.floor(pseudoRandom(x, y, i + 7) * (cs - size));
          ctx.fillStyle = shadeHex("#567d46", tone);
          ctx.fillRect(px + ox, py + oy, size, size);
        }
      } else if (t === TILES.SOIL) {
        const variation = (n - 0.5) * 0.18;
        ctx.fillStyle = shadeHex("#3e2f26", variation);
        ctx.fillRect(px, py, cs, cs);

        const topHeight = Math.min(4, cs);
        ctx.fillStyle = shadeHex("#3e2f26", variation + 0.18);
        ctx.fillRect(px, py, cs, topHeight);
      } else if (t === TILES.TUNNEL) {
        const variation = (n - 0.5) * 0.25;
        ctx.fillStyle = shadeHex("#786452", variation);
        ctx.fillRect(px, py, cs, cs);

        const pebbles = 2 + Math.floor(pseudoRandom(x, y, 11) * 3);
        ctx.fillStyle = "#3e2f26";
        for (let i = 0; i < pebbles; i++) {
          const sz = 1 + Math.floor(pseudoRandom(x, y, 20 + i) * 2);
          const ox = Math.floor(pseudoRandom(x, y, 30 + i) * (cs - sz));
          const oy = Math.floor(pseudoRandom(x, y, 40 + i) * (cs - sz));
          ctx.fillRect(px + ox, py + oy, sz, sz);
        }

        if (isSolid(getTile(x, y - 1))) {
          const shadowH = Math.max(2, Math.ceil(cs * 0.2));
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(px, py, cs, shadowH);
        }
      } else {
        const variation = (n - 0.5) * 0.12;
        ctx.fillStyle = shadeHex("#1f1a17", variation);
        ctx.fillRect(px, py, cs, cs);
      }

      // Food
      const foodAmount = foodRow?.[x] ?? 0;
      if (foodAmount > 0) {
        const centerX = px + cs / 2;
        const centerY = py + cs / 2;
        const pileCount = 3 + Math.floor(pseudoRandom(x, y, 50) * 2);

        for (let i = 0; i < pileCount; i++) {
          const jitterX = (pseudoRandom(x, y, 60 + i) - 0.5) * 3;
          const jitterY = (pseudoRandom(x, y, 70 + i) - 0.5) * 3;
          const sz = 1 + Math.floor(pseudoRandom(x, y, 80 + i) * 2);
          ctx.fillStyle = pseudoRandom(x, y, 90 + i) > 0.5 ? "#f3c943" : "#d9942c";
          ctx.fillRect(Math.floor(centerX + jitterX), Math.floor(centerY + jitterY), sz, sz);
        }
      }

      const drawRefuse = CONFIG.renderWastePiles || DebugOverlay.flags.showRefuse;
      if (drawRefuse) {
        const refuse = getWasteTag(x, y, "refuse");
        if (refuse > 0.01) {
          const intensity = Math.min(1, refuse / Math.max(0.001, WASTE.maxTile));
          const specks = 1 + Math.floor(pseudoRandom(x, y, 140) * 2);
          ctx.fillStyle = `rgba(220, 190, 130, ${0.12 + intensity * 0.28})`;
          for (let i = 0; i < specks; i++) {
            const ox = Math.floor(pseudoRandom(x, y, 150 + i) * (cs - 2));
            const oy = Math.floor(pseudoRandom(x, y, 160 + i) * (cs - 2));
            const size = 1 + Math.floor(pseudoRandom(x, y, 170 + i) * 2);
            ctx.fillRect(px + ox, py + oy, size, size);
          }
        }
      }

      const stored = getStoredFoodTotalAt(x, y);
      if (stored > 0) {
        const radius = Math.min(cs * 0.45, 2.2 + stored * 0.7);
        const alpha = 0.35 + Math.min(0.35, stored * 0.08);
        ctx.fillStyle = `rgba(255, 200, 100, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px + cs / 2, py + cs / 2, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // NEW: pheromone mist overlay (blurred low-res texture)
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = SCENT.ALPHA;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(scentBlurCanvas, 0, 0, CONSTANTS.WORLD_W, CONSTANTS.WORLD_H);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;

  // NEW: edge overlay (crisp outlines)
  ctx.drawImage(edgeCanvas, 0, 0);

  // Debug overlays (opt-in; add new flags + branches here)
  if (DebugOverlay.flags.showHomeScent) {
    DebugOverlay.drawHeatmapGrid(ctx, scentToHome, {
      palette: DebugOverlay.palettes.blue,
      alpha: 0.35,
    });
  }
  if (DebugOverlay.flags.showQueenScent) {
    DebugOverlay.drawHeatmapGrid(ctx, queenScent, {
      palette: DebugOverlay.palettes.red,
      alpha: 0.35,
      threshold: 0.02,
    });
  }
  if (DebugOverlay.flags.showEntranceCue && CONFIG.entranceCueStrength > 0) {
    const cs = CONSTANTS.CELL_SIZE;
    const px = (NEST_ENTRANCE.gx + 0.5) * cs;
    const py = (NEST_ENTRANCE.gy + 0.5) * cs;
    const r = CONFIG.entranceCueRadius * cs;

    ctx.save();
    ctx.strokeStyle = '#7cc8ff';
    ctx.fillStyle = 'rgba(120, 190, 255, 0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (CONFIG.entranceCueFadeDepth > 0) {
      for (let step = 1; step <= Math.min(2, CONFIG.entranceCueFadeDepth); step++) {
        const y = py + step * cs;
        ctx.globalAlpha = Math.max(0.25, 0.6 - step * 0.2);
        ctx.beginPath();
        ctx.ellipse(px, y, cs * 0.65, cs * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  if (DebugOverlay.flags.showBroodScent) {
    DebugOverlay.drawHeatmapGrid(ctx, broodScent, {
      palette: DebugOverlay.palettes.violet,
      alpha: 0.32,
    });
  }
  if (DebugOverlay.flags.showWaste) {
    DebugOverlay.drawHeatmapGrid(ctx, wasteGrid, {
      palette: DebugOverlay.palettes.amber,
      alpha: 0.28,
      max: WASTE.maxTile,
      composite: 'source-over',
    });
  }
  if (DebugOverlay.flags.showStoredFood) {
    DebugOverlay.drawHeatmapGrid(ctx, getStoredFoodTotalsGrid(), {
      palette: DebugOverlay.palettes.green,
      alpha: 0.32,
      max: 6,
      composite: 'source-over',
    });
  }
  if (DebugOverlay.flags.showDigFrontier && worldState.frontierTiles?.list?.length) {
    const frontier = worldState.frontierTiles.list;
    for (const f of frontier) {
      DebugOverlay.drawTileMark(ctx, f.x, f.y, { color: '#38ffef', lineWidth: 1.2 });
    }
  }
  // Future room debugging hooks: if a room-id grid exists, draw it through this flag.
  if (DebugOverlay.flags.showRoomIds && worldState.roomIds) {
    DebugOverlay.drawHeatmapGrid(ctx, worldState.roomIds, {
      palette: DebugOverlay.palettes.red,
      alpha: 0.25,
      composite: 'source-over',
    });
  }

  // Brood clusters
  if (worldState.brood?.length) {
    for (const b of worldState.brood) {
      ctx.save();
      ctx.translate(b.x, b.y);

      const pulse = 0.8 + Math.sin(performance.now() * 0.005 + b.x) * 0.08;
      const size = 4.4 + Math.sin(b.age * 0.8) * 0.5;

      ctx.fillStyle = `rgba(255,230,170,${0.22 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 1.3, size, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(235,180,120,${0.65 * pulse})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.75, 0.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  if (trophallaxisEvents.length) {
    ctx.save();
    for (const e of trophallaxisEvents) {
      const strength = clamp01((e.amount || 15) / 60);
      const alpha = 0.4 + strength * 0.5;
      ctx.strokeStyle = `rgba(255,230,90,${alpha})`;
      ctx.lineWidth = 0.9 + strength * 1.8;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1);
      ctx.lineTo(e.x2, e.y2);
      ctx.stroke();

      if (DebugOverlay.flags.highlightTransfers) {
        ctx.fillStyle = `rgba(255,230,90,${alpha})`;
        ctx.beginPath();
        ctx.arc(e.x2, e.y2, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  if (DebugOverlay.flags.showCleanTargets) {
    ctx.save();
    ctx.strokeStyle = 'rgba(180,240,255,0.45)';
    ctx.lineWidth = 0.9;

    const padding = 24;
    const minX = camX - padding;
    const maxX = camX + VIEW_W / ZOOM + padding;
    const minY = camY - padding;
    const maxY = camY + VIEW_H / ZOOM + padding;

    for (const a of ants) {
      if (a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;
      if (!a.cleanTarget) continue;

      let tx = null, ty = null;
      if (a.cleanTarget.type === 'corpse') {
        const targetAnt = a.cleanTarget.ant;
        if (targetAnt && ants.includes(targetAnt)) {
          tx = targetAnt.x;
          ty = targetAnt.y;
        }
      } else if (a.cleanTarget.type === 'waste') {
        tx = (a.cleanTarget.x + 0.5) * CONSTANTS.CELL_SIZE;
        ty = (a.cleanTarget.y + 0.5) * CONSTANTS.CELL_SIZE;
      }

      if (tx === null || ty === null) continue;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    ctx.restore();
  }

  if (DebugOverlay.flags.showQueenPath) {
    const queen = getQueen(worldState);
    if (queen) {
      if (queen.path && queen.path.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,130,210,0.6)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i < queen.path.length; i++) {
          const n = queen.path[i];
          const px = (n.gx + 0.5) * CONSTANTS.CELL_SIZE;
          const py = (n.gy + 0.5) * CONSTANTS.CELL_SIZE;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (queen.targetGxGy) {
        DebugOverlay.drawTileMark(ctx, queen.targetGxGy.gx, queen.targetGxGy.gy, { color: '#ff7acc', lineWidth: 1.8 });
      }

      ctx.save();
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3 / ZOOM;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const label = `Q: ${queen.state ?? 'UNKNOWN'}`;
      ctx.strokeText(label, queen.x, queen.y - 10);
      ctx.fillText(label, queen.x, queen.y - 10);
      ctx.restore();
    }
  }

  // Ants
  for (const a of ants) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle + Math.PI / 2);

    const sc = a.type === "queen" ? 2.6 : 1.25;
    ctx.scale(sc, sc);

    const pose = ANT_ANIM.getPose(a.animRig);
    ctx.translate(0, pose.bodyBob);
    ctx.rotate(pose.bodyTwist);

    let body = (a.type === "queen") ? "#d07" : "#2a241f";
    let body2 = (a.type === "queen") ? "#a05" : "#1b1714";
    let hi = (a.type === "queen") ? "rgba(255,170,210,0.20)" : "rgba(255,255,255,0.10)";

    if (a.type === "corpse") {
      const isRotting = (a.decompositionTimer ?? 0) > OLEIC_ACID_THRESHOLD;
      if (isRotting) {
        body = "#d6d6d6";
        body2 = "#b5b5b5";
        hi = "rgba(255,255,255,0.25)";
      } else {
        body = "#161616";
        body2 = "#0d0d0d";
        hi = "rgba(255,255,255,0.05)";
      }
    }

    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 4.8, 3.6, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // DRAW LEGS
    for (const leg of pose.legs) {
      // 1. Calculate explicit Knee Position (2-Bone IK approximation)
      // Vector from Hip (anchor) to Foot
      const dx = leg.foot.x - leg.anchor.x;
      const dy = leg.foot.y - leg.anchor.y;
      const dist = Math.hypot(dx, dy);

      // Midpoint
      const midX = (leg.anchor.x + leg.foot.x) / 2;
      const midY = (leg.anchor.y + leg.foot.y) / 2;

      // Knee "Out" vector (perpendicular to leg direction)
      // If right side (anchor.x > 0), knee points right. Left points left.
      const side = leg.anchor.x > 0 ? 1 : -1;

      // How high the knee sticks up in the air
      const kneeHeight = 2.5 + (leg.lift * 3.0);
      // Small forward bias keeps the bend from looking pinned behind the body
      const kneeForwardBias = 0.16;

      // Perpendicular vector (-dy, dx)
      // We push the knee OUTWARD from the body
      const perpX = -dy / dist * side;
      const perpY = dx / dist * side;

      // Final Knee Position
      const kneeX = midX + perpX * kneeHeight + dx * kneeForwardBias;
      const kneeY = midY + perpY * kneeHeight + dy * kneeForwardBias;

      // 2. Draw Femur (Hip -> Knee)
      ctx.beginPath();
      const alpha = 0.85 - (leg.lift * 0.5);
      ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
      ctx.lineWidth = 1.2; // Thicker femur
      ctx.lineCap = "round";
      ctx.moveTo(leg.anchor.x, leg.anchor.y);
      ctx.lineTo(kneeX, kneeY);
      ctx.stroke();

      // 3. Draw Tibia (Knee -> Foot)
      ctx.beginPath();
      ctx.lineWidth = 0.8; // Thinner tibia
      ctx.moveTo(kneeX, kneeY);
      ctx.lineTo(leg.foot.x, leg.foot.y);
      ctx.stroke();

      // 4. Draw Joint circles (helps visualize the connection)
      // Hip Joint (hidden mostly by body, but good for depth)
      ctx.fillStyle = body2;
      ctx.beginPath();
      ctx.arc(leg.anchor.x, leg.anchor.y, 0.5, 0, Math.PI*2);
      ctx.fill();

      // Knee Joint
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.arc(kneeX, kneeY, 0.4, 0, Math.PI*2);
      ctx.fill();
    }

    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.ellipse(0, 4, 2.2, 3.4, 0, 0, 6.28); ctx.fill(); ctx.stroke();
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.ellipse(-0.6, 3.3, 1.2, 2.0, 0.2, 0, 6.28); ctx.fill();

    ctx.fillStyle = body2;
    ctx.beginPath(); ctx.ellipse(0, 0.2, 1.4, 1.8, 0, 0, 6.28); ctx.fill();
    ctx.fillStyle = hi;
    ctx.beginPath(); ctx.ellipse(-0.4, -0.1, 0.7, 1.0, 0.2, 0, 6.28); ctx.fill();

    ctx.fillStyle = body2;
    ctx.beginPath(); ctx.ellipse(0, -2.6, 1.7, 1.6, 0, 0, 6.28); ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-0.4, -4.0 - pose.headLift * 0.4); ctx.quadraticCurveTo(-1.2 - pose.antennaSway, -5.8 - pose.headLift, -2.0 - pose.antennaSway, -6.4 - pose.headLift * 0.4);
    ctx.moveTo( 0.4, -4.0 - pose.headLift * 0.4); ctx.quadraticCurveTo( 1.2 + pose.antennaSway, -5.8 - pose.headLift,  2.0 + pose.antennaSway, -6.4 - pose.headLift * 0.4);
    ctx.stroke();

    if (a.carrying) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(120,255,150,0.35)";
      ctx.fillRect(-2.6, -7.0, 5.2, 5.2);
      ctx.restore();

      ctx.fillStyle = "#7dff9a";
      ctx.fillRect(-2.0, -6.4, 4.0, 4.0);
    }

    ctx.restore();

    if (DEBUG_SHOW_INTENT && a.intentTopChoices) {
      ctx.save();
      ctx.translate(a.x, a.y - 10);
      ctx.font = "8px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";

      const lines = [];
      lines.push(`intent: ${a.intent ?? "?"}`);

      const [first, second] = a.intentTopChoices;
      if (first) lines.push(`${first[0]}: ${first[1].toFixed(2)}`);
      if (second) lines.push(`${second[0]}: ${second[1].toFixed(2)}`);

      let offsetY = -4 * (lines.length - 1);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 3 / ZOOM;
      ctx.fillStyle = "#fff";
      for (const line of lines) {
        ctx.strokeText(line, 0, offsetY);
        ctx.fillText(line, 0, offsetY);
        offsetY += 10;
      }

      ctx.restore();
    }
  }

    if (DebugOverlay.flags.showAntState) {
    ctx.save();
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';

    const padding = 30;
    const minX = camX - padding;
    const maxX = camX + VIEW_W / ZOOM + padding;
    const minY = camY - padding;
    const maxY = camY + VIEW_H / ZOOM + padding;

    const roleInitials = { nurse: 'N', forager: 'F', digger: 'D', cleaner: 'C', queen: 'Q' };

    for (const a of ants) {
      if (a.x < minX || a.x > maxX || a.y < minY || a.y > maxY) continue;

      const markers = [];
      const roleMark = roleInitials[a.role] ?? (a.role ? a.role[0]?.toUpperCase() : '');
      if (roleMark) markers.push(roleMark);
      if (a.carryingBrood) markers.push('B');
      if (a.carryingWaste) markers.push('W');
      if (a.carryingCorpse) markers.push('C');
      if (a.carrying) markers.push('F');

      const label = markers.join(' ');
      if (label) {
        ctx.lineWidth = 3 / ZOOM;
        ctx.strokeText(label, a.x, a.y - 7);
        ctx.fillText(label, a.x, a.y - 7);
      }
    }

    ctx.restore();
  }

  // Particles
  for (const p of particles) {
    ctx.globalAlpha = clamp01(p.life);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x, p.y, 3 / ZOOM, 3 / ZOOM);
  }
  ctx.globalAlpha = 1.0;

  // Lighting mask (underground)
  maskCtx.setTransform(DPR,0,0,DPR,0,0);
  maskCtx.clearRect(0,0,VIEW_W,VIEW_H);
  maskCtx.scale(ZOOM, ZOOM);
  maskCtx.translate(-camX, -camY);

  const splitY = CONSTANTS.REGION_SPLIT * CONSTANTS.CELL_SIZE;

  maskCtx.fillStyle = "rgba(0,0,0,0.92)";
  maskCtx.fillRect(0, splitY, CONSTANTS.WORLD_W, CONSTANTS.WORLD_H - splitY);

  maskCtx.globalCompositeOperation = "destination-out";
  for (const a of ants) {
    if (a.y < splitY) continue;
    const r = (a.type === "queen") ? 170 : 70;
    const g = maskCtx.createRadialGradient(a.x, a.y, 10, a.x, a.y, r);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    maskCtx.fillStyle = g;
    maskCtx.beginPath();
    maskCtx.arc(a.x, a.y, r, 0, Math.PI * 2);
    maskCtx.fill();
  }
  maskCtx.globalCompositeOperation = "source-over";

  // FIX: composite mask without DPR double-scaling
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.drawImage(maskCanvas, 0, 0, VIEW_W, VIEW_H);

  // Vignette (CSS pixels)
  ctx.save();
  const vg = ctx.createRadialGradient(VIEW_W*0.5, VIEW_H*0.45, Math.min(VIEW_W,VIEW_H)*0.15,
                                      VIEW_W*0.5, VIEW_H*0.5, Math.max(VIEW_W,VIEW_H)*0.65);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.50)");
  ctx.fillStyle = vg;
  ctx.fillRect(0,0,VIEW_W,VIEW_H);
  ctx.restore();
}

let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (lastT === 0) lastT = t;

  const dt = Math.min((t - lastT) / 1000, 0.1);
  lastT = t;

  sunAngle = (sunAngle + dt * 0.05) % (Math.PI * 2);

  const queen = getQueen(worldState);
  if (queen) {
    const spoil = Math.max(0, foodInStorage - 6) * WASTE.spoilageRate * dt;
    if (spoil > 0.0001) {
      const spoiled = takeStoredFoodAnywhere(spoil, "seed");
      const qgx = Math.floor(queen.x / CONSTANTS.CELL_SIZE);
      const qgy = Math.floor(queen.y / CONSTANTS.CELL_SIZE);
      const wasted = spoiled * 0.8;
      addWaste(qgx, qgy, wasted);
      tagWaste(qgx, qgy, "refuse", wasted);
      tagWaste(qgx, qgy, "spoiledFood", wasted);
    }
  }

  worldState.storedFood = foodInStorage;
  worldState.wasteTotal = wasteTotal;
  worldState.wasteGrid = wasteGrid;
  worldState.wasteTags = wasteTags;
  worldState.broodScent = broodScent;
  worldState.nurseScent = nurseScent;
  worldState.brood = BroodSystem.getBrood();
  ColonyState.updateColonyState(worldState, ants);
  const colonySnapshot = ColonyState.getState();

  // FIX: Passed 'ants' array as the last argument so BroodSystem can count colony population
  const hatched = BroodSystem.update(
    worldState,
    colonySnapshot,
    dt,
    queen,
    consumeStoredFood,
    addWasteAtWorldPos,
    ants 
  );

  for (const b of hatched) {
    ants.push(new Ant(b.type || "worker", b.x, b.y, pickRoleForNewWorker()));
  }

  worldState.storedFood = foodInStorage;
  ColonyState.updateColonyState(worldState, ants);

  DiggingSystem.updateFrontierTiles(worldState);
  updateQueenChamberObjective(worldState);
  updateQueenRelocation(worldState);

  airFrameCounter++;
  if ((airFrameCounter % AIR.UPDATE_EVERY_FRAMES) === 0) {
    AirSystem.updateAirField(worldState);
  }

  // Decay pheromones (full grid)
  const decay = CONFIG.scentDecay;
  const broodDecay = 0.95;
  for (let y = 0; y < CONSTANTS.GRID_H; y++) {
    for (let x = 0; x < CONSTANTS.GRID_W; x++) {
      if (scentToFood[y][x] > 0.01) scentToFood[y][x] *= decay; else scentToFood[y][x] = 0;
      if (scentToHome[y][x] > 0.01) scentToHome[y][x] *= decay; else scentToHome[y][x] = 0;
      if (queenScent[y][x] > 0.01) queenScent[y][x] *= decay; else queenScent[y][x] = 0;
      if (broodScent[y][x] > 0.01) broodScent[y][x] *= broodDecay; else broodScent[y][x] = 0;
      if (nurseScent[y][x] > 0.01) nurseScent[y][x] *= broodDecay; else nurseScent[y][x] = 0;

      // Food emits its own attractor so ants can find it even before a trail exists
      const foodAmount = foodGrid[y][x];
      if (foodAmount > 0) {
        const add = Math.min(0.5, 0.015 * foodAmount);
        scentToFood[y][x] = Math.min(1.0, scentToFood[y][x] + add);
      }
    }
  }

  seedEntranceHomeScent();

  ants.forEach(a => a.update(dt));

  for (let i = trophallaxisEvents.length - 1; i >= 0; i--) {
    trophallaxisEvents[i].life -= dt;
    if (trophallaxisEvents[i].life <= 0) trophallaxisEvents.splice(i, 1);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  // PERF: Update scent texture every N frames
  scentFrameCounter++;
  if ((scentFrameCounter % SCENT.UPDATE_EVERY_FRAMES) === 0) {
    updateScentTexture(scentToFood, scentToHome, broodScent);
  }

  render();

  const fps = Math.round(1 / Math.max(dt, 0.00001));
  statsDisplay.innerHTML =
    `<span class="dim">Ants</span>: ${ants.length} &nbsp;|&nbsp; <span class="dim">Brood</span>: ${worldState.brood?.length ?? 0} &nbsp;|&nbsp; <span class="dim">Nursery P</span>: ${ColonyState.getNurseryPressure().toFixed(2)} &nbsp;|&nbsp; <span class="dim">Food</span>: ${foodInStorage.toFixed(1)} &nbsp;|&nbsp; <span class="dim">Waste</span>: ${wasteTotal.toFixed(1)} &nbsp;|&nbsp; <span class="dim">FPS</span>: ${fps}`;
}

// ==============================
// BOOT
// ==============================

initUI();
DebugOverlay.init();
initScentBuffers();
initEdgeCanvas();
resize();
resetSimulation();
requestAnimationFrame(loop);
