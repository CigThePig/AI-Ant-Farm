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

  sensorAngle: 0.8,
  sensorDist: 30,

  // Threshold for detecting the queen's close-range scent within the nest core
  nestCoreQueenThreshold: 0.45,

  turnSpeed: 0.4,
  wanderStrength: 0.1,
  forwardBias: 2.0,
  workerSpeed: 60,

  postDeliveryDuration: 0.8,   // seconds ants will exit the queen's chamber after dropping food

  stuckThreshold: 0.5,

  queenRadius: 8,             // tiles; pheromone-free buffer around the queen

  renderWastePiles: false,
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

const NEST_ENTRANCE = {
  gx: Math.floor(CONSTANTS.GRID_W / 2),
  gy: Math.max(2, CONSTANTS.REGION_SPLIT),
  radius: 2,
  corridorDepth: 8,
};
NEST_ENTRANCE.x = (NEST_ENTRANCE.gx + 0.5) * CONSTANTS.CELL_SIZE;
NEST_ENTRANCE.y = (NEST_ENTRANCE.gy + 0.5) * CONSTANTS.CELL_SIZE;

const QUEEN_RADIUS_PX = CONFIG.queenRadius * CONSTANTS.CELL_SIZE;
const QUEEN_RADIUS_PX2 = QUEEN_RADIUS_PX * QUEEN_RADIUS_PX;

const TILES = { GRASS: 0, SOIL: 1, TUNNEL: 2, BEDROCK: 3 };

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

const FOOD_TYPES = ["seed", "protein", "sugar"];

const worldState = {
  grid: null,
  gridTexture: null,
  particles: null,
  airLevels: null,
  storedFood: 0,
  wasteGrid: null,
  wasteTags: null,
  wasteTotal: 0,
  brood: null,
  broodScent: null,
  nurseScent: null,
  frontierTiles: null,
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
  const queen = worldState?.queen ?? ants[0];

  if (queen) {
    const queenSignal = computeDirectionalSignal(ant, queenScent, {
      weight: underground ? 1.4 : 0.8,
      min: 0,
    });
    signals.push(queenSignal);
  }

  const entranceDistance = Math.hypot((NEST_ENTRANCE.x - ant.x), (NEST_ENTRANCE.y - ant.y));
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

  // Queen & room
  const qx = (CONSTANTS.GRID_W / 2) * CONSTANTS.CELL_SIZE;
  const qy = (CONSTANTS.REGION_SPLIT + 8) * CONSTANTS.CELL_SIZE;
  const qgx = Math.floor(qx / CONSTANTS.CELL_SIZE);
  const qgy = Math.floor(qy / CONSTANTS.CELL_SIZE);

  for (let y = qgy - 4; y <= qgy + 4; y++) {
    if (y <= 0 || y >= CONSTANTS.GRID_H - 1) continue;
    for (let x = qgx - 5; x <= qgx + 5; x++) {
      if (x <= 0 || x >= CONSTANTS.GRID_W - 1) continue;
      grid[y][x] = TILES.TUNNEL;
    }
  }

  // Carve a narrow corridor from the queen's chamber toward the entrance
  for (let dy = 0; dy <= NEST_ENTRANCE.corridorDepth; dy++) {
    const y = Math.max(1, qgy - dy);
    for (let dx = -1; dx <= 1; dx++) {
      const x = NEST_ENTRANCE.gx + dx;
      if (x <= 0 || x >= CONSTANTS.GRID_W - 1) continue;
      grid[y][x] = TILES.TUNNEL;
    }
  }

  // Mark the entrance band near the surface
  for (let y = Math.max(1, NEST_ENTRANCE.gy - 1); y <= Math.min(CONSTANTS.GRID_H - 2, NEST_ENTRANCE.gy + 1); y++) {
    for (let x = Math.max(1, NEST_ENTRANCE.gx - NEST_ENTRANCE.radius); x <= Math.min(CONSTANTS.GRID_W - 2, NEST_ENTRANCE.gx + NEST_ENTRANCE.radius); x++) {
      grid[y][x] = TILES.TUNNEL;
    }
  }

  worldState.grid = grid;
  worldState.gridTexture = gridTexture;
  worldState.particles = particles;
  worldState.wasteGrid = wasteGrid;
  worldState.wasteTags = wasteTags;
  worldState.wasteTotal = wasteTotal;
  worldState.broodScent = broodScent;
  worldState.nurseScent = nurseScent;
  AirSystem.reset(worldState);
  DiggingSystem.reset(worldState);
  BroodSystem.reset(worldState);
  brood = BroodSystem.getBrood();
  worldState.brood = brood;

  ants.push(new Ant("queen", qx, qy));

  const createWorkerWithAgeFraction = (ageFraction, role) => {
    const worker = new Ant("worker", qx, qy, role);
    worker.age = worker.lifespan * ageFraction;
    worker.updateAgeBasedRole();
    return worker;
  };

  for (let i = 0; i < 10; i++) {
    ants.push(createWorkerWithAgeFraction(0.1, "nurse"));
  }

  for (let i = 0; i < 10; i++) {
    ants.push(createWorkerWithAgeFraction(0.8, "forager"));
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
  return (
    Math.abs(gx - NEST_ENTRANCE.gx) <= NEST_ENTRANCE.radius &&
    Math.abs(gy - NEST_ENTRANCE.gy) <= 1
  );
}

function spreadQueenScent(qgx, qgy) {
  const coreRadius = 3;
  const reachRadius = 6;

  for (let dy = -reachRadius; dy <= reachRadius; dy++) {
    const ny = qgy + dy;
    if (ny <= 0 || ny >= CONSTANTS.GRID_H - 1) continue;

    for (let dx = -reachRadius; dx <= reachRadius; dx++) {
      const nx = qgx + dx;
      if (nx <= 0 || nx >= CONSTANTS.GRID_W - 1) continue;

      if (grid[ny][nx] === TILES.SOIL || grid[ny][nx] === TILES.BEDROCK) continue;

      const dist = Math.hypot(dx, dy);
      if (dist > reachRadius) continue;

      let strength = 0;
      if (dist < 0.5) strength = 0.8;
      else if (dist <= coreRadius) strength = 0.45 + (coreRadius - dist) * 0.1;
      else strength = Math.max(0.12, 0.25 - (dist - coreRadius) * 0.03);

      queenScent[ny][nx] = Math.min(1.0, queenScent[ny][nx] + strength);
    }
  }
}

function seedEntranceHomeScent() {
  const { gx, gy } = NEST_ENTRANCE;
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
    this.type = type;
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

    this.inNestCore = false;
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

    const queen = ants[0];
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
    const queen = ants[0];
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

    const queen = ants[0];
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
      // Emit a local queen scent used only for nest-core state detection
      const qgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const qgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      if (
        qgx >= 0 && qgx < CONSTANTS.GRID_W &&
        qgy >= 0 && qgy < CONSTANTS.GRID_H &&
        scentToHome[qgy]
      ) {
        spreadQueenScent(qgx, qgy);
      }

      const intentScores = this.computeIntentScores(worldState);
      this.intentScores = intentScores;
      this.intentTopChoices = Object.entries(intentScores).sort((a, b) => b[1] - a[1]).slice(0, 2);
      this.intent = this.chooseIntent(intentScores);

      ANT_ANIM.step(this.animRig, { dt, travel: dt * 0.6, speedHint: 15 });
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
      const queen = ants[0];
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
      const queen = ants[0];
      if (queen) {
        const away = Math.atan2(this.y - queen.y, this.x - queen.x);
        return away + (Math.random() - 0.5) * 0.35;
      }
      return this.angle + (Math.random() - 0.5) * 0.8;
    }

    if (this.role === "nurse") {
      const queen = ants[0];
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
      const queen = ants[0];

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
      const queen = ants[0];
      
      // 1. CHECK FOR HUNGRY BROOD TO FEED (Priority)
      // Only feed if nurse has energy in social stomach (> 30)
      if (this.energy > 30) {
        // Simple collision check with brood
        const feedDist = CONSTANTS.CELL_SIZE;
        const hungryBrood = worldState.brood?.find(b => {
           return b.stage === "larva" && b.isHungry &&
                  Math.abs(b.x - this.x) < feedDist &&
                  Math.abs(b.y - this.y) < feedDist;
        });

        if (hungryBrood) {
          // Perform Trophallaxis (Nurse -> Larva)
          const cost = BroodSystem.getNurseEnergyCost();
          this.energy -= cost;
          BroodSystem.feedBrood(hungryBrood, addWasteAtWorldPos);
          
          // Visual feedback
          trophallaxisEvents.push({
            x1: this.x, y1: this.y,
            x2: hungryBrood.x, y2: hungryBrood.y,
            amount: 20, life: trophallaxisLife(0.3)
          });
          
          // Stop moving for a moment to feed
          this.stuckT = -0.5; 
        }
      }

      // 2. EXISTING CARRYING LOGIC (Secondary)
      if (queen) {
        const dx = queen.x - this.x;
        const dy = queen.y - this.y;
        const distTiles = Math.hypot(dx, dy) / CONSTANTS.CELL_SIZE;

        if (!this.carryingBrood && distTiles < 4) {
          const broodHere = worldState.brood?.find((b) => {
            const bx = Math.floor(b.x / CONSTANTS.CELL_SIZE);
            const by = Math.floor(b.y / CONSTANTS.CELL_SIZE);
            return bx === gx && by === gy && (!b.lockedBy || b.lockedBy === this);
          });

          if (broodHere) {
            this.carryingBrood = broodHere;
            broodHere.lockedBy = this;
            this.broodTimer = 2.0;
          }
        }

        if (this.carryingBrood) {
          BroodSystem.updateBroodPos(this.carryingBrood, this.x, this.y);

          if (this.broodTimer > 0) this.broodTimer -= 0.016;

          // BIOLOGY TWEAK: Nurses move brood to optimal temperature/humidity zones.
          // In this sim, that's a ring around the queen.
          const inDropRing = distTiles >= 3 && distTiles <= 7;
          
          // Don't drop if there's no pheromone marker (keep it tidy)
          const dropChance = inDropRing && Math.random() < 0.05 && this.broodTimer <= 0;
          const wanderedTooFar = distTiles > 12;

          if (dropChance || wanderedTooFar) {
            delete this.carryingBrood.lockedBy;
            this.carryingBrood = null;
            this.broodTimer = 0;

            if (wanderedTooFar) {
              this.angle += Math.PI; // Turn back
            }
          }
        }
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

    const queen = ants[0];
    const distanceToQueen = queen ? Math.hypot(queen.x - this.x, queen.y - this.y) : Infinity;
    const deepInNest = gy > (CONSTANTS.REGION_SPLIT + 2);
    const canStoreFoodHere = this.inNestCore || this.isInsideQueenRadius() || !queen;
    if (this.carrying && canStoreFoodHere && deepInNest && distanceToQueen > 15) {
      const tile = grid[gy]?.[gx];
      if (tile === TILES.TUNNEL && getStoredFoodTotalAt(gx, gy) < 5) {
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

  const queen = ants[0];
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
    `<span class="dim">Ants</span>: ${ants.length} &nbsp;|&nbsp; <span class="dim">Brood</span>: ${worldState.brood?.length ?? 0} &nbsp;|&nbsp; <span class="dim">Food</span>: ${foodInStorage.toFixed(1)} &nbsp;|&nbsp; <span class="dim">Waste</span>: ${wasteTotal.toFixed(1)} &nbsp;|&nbsp; <span class="dim">FPS</span>: ${fps}`;
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
