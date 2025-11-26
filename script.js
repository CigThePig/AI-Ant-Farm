const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const statsDisplay = document.getElementById("stats-display");
const controlsPanel = document.getElementById("controls-container");
const settingsBtn = document.getElementById("settings-btn");
const slidersArea = document.getElementById("sliders-area");

// Lighting mask
const maskCanvas = document.createElement('canvas');
const maskCtx = maskCanvas.getContext('2d');

// ==============================
// CONFIG STATE
// ==============================

const CONFIG = {
  scentDecay: 0.999,
  depositAmount: 0.5,

  sensorAngle: 0.8,
  sensorDist: 30,

  turnSpeed: 0.4,
  wanderStrength: 0.1,
  forwardBias: 2.0,
  workerSpeed: 60,

  stuckThreshold: 0.5,
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

const scentRawCanvas = document.createElement('canvas');
const scentRawCtx = scentRawCanvas.getContext('2d');
const scentBlurCanvas = document.createElement('canvas');
const scentBlurCtx = scentBlurCanvas.getContext('2d');

let scentImageData = null;
let scentFrameCounter = 0;

function initScentBuffers() {
  scentRawCanvas.width = CONSTANTS.GRID_W;
  scentRawCanvas.height = CONSTANTS.GRID_H;
  scentBlurCanvas.width = CONSTANTS.GRID_W;
  scentBlurCanvas.height = CONSTANTS.GRID_H;
  scentImageData = scentRawCtx.createImageData(CONSTANTS.GRID_W, CONSTANTS.GRID_H);
}

function updateScentTexture(scentToFood, scentToHome) {
  const w = CONSTANTS.GRID_W;
  const h = CONSTANTS.GRID_H;
  const data = scentImageData.data;

  let i = 0;
  for (let y = 0; y < h; y++) {
    const rowF = scentToFood[y];
    const rowH = scentToHome[y];
    for (let x = 0; x < w; x++) {
      const f = rowF[x];
      const hh = rowH[x];

      // Thresholding keeps the overlay clean and faster visually
      const rf = (f >= SCENT.MIN_SHOW) ? f : 0;
      const bh = (hh >= SCENT.MIN_SHOW) ? hh : 0;

      // Encode into RGB, with alpha tied to max channel
      const r8 = Math.min(255, Math.floor(rf * 255));
      const b8 = Math.min(255, Math.floor(bh * 255));
      const a8 = Math.min(220, Math.floor(Math.max(rf, bh) * 220)); // cap alpha so it never nukes the scene

      data[i + 0] = r8;   // toFood (red)
      data[i + 1] = 0;
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
let scentToFood = [];
let scentToHome = [];
let ants = [];
let particles = [];
let foodInStorage = 0;

const worldState = {
  grid: null,
  particles: null,
  constants: CONSTANTS,
  onTunnelDug: (gx, gy) => updateEdgesAround(gx, gy, grid),
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
function hsl(h,s,l){ return `hsl(${h} ${s}% ${l}%)`; }

function resetSimulation() {
  grid = [];
  gridTexture = [];
  foodGrid = [];
  scentToFood = [];
  scentToHome = [];
  ants = [];
  particles = [];
  foodInStorage = 0;

  for (let y = 0; y < CONSTANTS.GRID_H; y++) {
    grid[y] = new Uint8Array(CONSTANTS.GRID_W);
    gridTexture[y] = new Float32Array(CONSTANTS.GRID_W);
    foodGrid[y] = new Uint8Array(CONSTANTS.GRID_W);
    scentToFood[y] = new Float32Array(CONSTANTS.GRID_W);
    scentToHome[y] = new Float32Array(CONSTANTS.GRID_W);

    for (let x = 0; x < CONSTANTS.GRID_W; x++) {
      const n = Math.sin(x*0.27)*Math.cos(y*0.29)*0.5+0.5;
      gridTexture[y][x] = n;

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
            foodGrid[Math.floor(fy)][Math.floor(fx)] += Math.floor(Math.random() * 15 + 5);
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

  worldState.grid = grid;
  worldState.particles = particles;
  DiggingSystem.reset(worldState);

  ants.push(new Ant("queen", qx, qy));
  for (let i = 0; i < 6; i++) ants.push(new Ant("worker", qx, qy));

  // Build edges once per reset
  rebuildEdgeOverlay(grid);

  // Reset Camera
  ZOOM = 1.0;
  camX = qx - VIEW_W / 2;
  camY = qy - VIEW_H / 2;

  // Fresh scent texture
  updateScentTexture(scentToFood, scentToHome);
  scentFrameCounter = 0;
}

// ==============================
// ANT CLASS
// ==============================

function spreadQueenScent(qgx, qgy) {
  const coreRadius = 3;
  const reachRadius = 6;

  // Anchor the queen's own tile as a solid beacon
  scentToHome[qgy][qgx] = 1.0;

  for (let dy = -reachRadius; dy <= reachRadius; dy++) {
    const ny = qgy + dy;
    if (ny <= 0 || ny >= CONSTANTS.GRID_H - 1) continue;

    for (let dx = -reachRadius; dx <= reachRadius; dx++) {
      const nx = qgx + dx;
      if (nx <= 0 || nx >= CONSTANTS.GRID_W - 1) continue;

      // Only let the scent flow through open spaces
      if (grid[ny][nx] === TILES.SOIL || grid[ny][nx] === TILES.BEDROCK) continue;

      const dist = Math.hypot(dx, dy);
      if (dist > reachRadius) continue;

      // Dense scent inside the chamber, softer haze creeping outward
      let strength = 0;
      if (dist < 0.5) strength = 0.7;
      else if (dist <= coreRadius) strength = 0.35 + (coreRadius - dist) * 0.08;
      else strength = Math.max(0.12, 0.22 - (dist - coreRadius) * 0.025);

      scentToHome[ny][nx] = Math.min(1.0, scentToHome[ny][nx] + strength);
    }
  }

  // A little push toward the entrance (upward toward the surface)
  for (let step = 1; step <= 4; step++) {
    const ny = qgy - step;
    if (ny <= 0) break;
    const nx = qgx;

    if (grid[ny][nx] === TILES.SOIL || grid[ny][nx] === TILES.BEDROCK) break;

    const taper = 0.35 - (step - 1) * 0.06;
    scentToHome[ny][nx] = Math.min(1.0, scentToHome[ny][nx] + Math.max(0.12, taper));
  }
}

class Ant {
  constructor(type, x, y) {
    this.type = type;
    this.x = x; this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    this.hasFood = false;
    this.returnDir = null;
    this.animRig = ANT_ANIM.createRig(type);
    this.stepDistance = 0;

    this.isDigger = type === "worker" && Math.random() < 0.6;

    this.lastX = x; this.lastY = y;
    this.stuckT = 0;
    this.panicT = 0;

    this.digTarget = null;
    this.digRetargetT = Math.random() * 0.4;
  }

  resetStuckTimer() {
    this.lastX = this.x;
    this.lastY = this.y;
    this.stuckT = 0;
    this.panicT = 0;
  }

  update(dt) {
    this.stepDistance = 0;
    if (this.type === "queen") {
      if (foodInStorage >= CONSTANTS.WORKER_COST) {
        foodInStorage -= CONSTANTS.WORKER_COST;
        ants.push(new Ant("worker", this.x, this.y + 10));
      }

      // Keep the nest as the strongest attractor by flooding the home scent map at the queen's position
      const qgx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
      const qgy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
      if (
        qgx >= 0 && qgx < CONSTANTS.GRID_W &&
        qgy >= 0 && qgy < CONSTANTS.GRID_H &&
        scentToHome[qgy]
      ) {
        spreadQueenScent(qgx, qgy);
      }

      ANT_ANIM.step(this.animRig, { dt, travel: dt * 0.6, speedHint: 15 });
      return;
    }

    this.stuckT += dt;
    if (this.stuckT > CONFIG.stuckThreshold) {
      const d2 = (this.x - this.lastX) ** 2 + (this.y - this.lastY) ** 2;
      if (d2 < 100) { this.panicT = 0.8; this.angle = Math.random() * Math.PI * 2; }
      this.lastX = this.x; this.lastY = this.y;
      this.stuckT = 0;
    }

    if (this.panicT > 0) {
      this.panicT -= dt;
      this.move(dt, 2.0);
      return;
    }

    if (this.hasFood || !this.isDigger) {
      this.digTarget = null;
    } else {
      this.digRetargetT -= dt;
      if (this.digRetargetT <= 0) {
        this.digTarget = DiggingSystem.chooseDigTarget(this, worldState);
        this.digRetargetT = 0.6 + Math.random() * 0.6;
      }
    }

    const desired = this.sense(dt);

    let diff = desired - this.angle;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff >  Math.PI) diff -= Math.PI * 2;

    const turnRate = CONFIG.turnSpeed * 15 * dt;
    if (Math.abs(diff) > turnRate) diff = Math.sign(diff) * turnRate;

    this.angle += diff;
    this.angle += (Math.random() - 0.5) * CONFIG.wanderStrength;

    this.move(dt, 1.0);
    this.dropScent();
    ANT_ANIM.step(this.animRig, { dt, travel: this.stepDistance, speedHint: CONFIG.workerSpeed });
  }

  sense(dt) {
    if (!this.hasFood && this.digTarget) {
      const { x, y } = this.digTarget;
      if (!grid[y] || grid[y][x] !== TILES.SOIL) {
        this.digTarget = null;
      } else {
        return Math.atan2((y + 0.5) * CONSTANTS.CELL_SIZE - this.y, (x + 0.5) * CONSTANTS.CELL_SIZE - this.x);
      }
    }

    const g = this.hasFood ? scentToHome : scentToFood;
    const sa = CONFIG.sensorAngle;
    const sd = CONFIG.sensorDist;

    const valL = this.sample(g, -sa, sd);
    const valC = this.sample(g, 0, sd);
    const valR = this.sample(g, sa, sd);

    const weightedC = valC * CONFIG.forwardBias;

    if (Math.max(valL, valC, valR) > 0.05) {
      const best = (weightedC > valL && weightedC > valR)
        ? this.angle
        : (valL > valR ? this.angle - sa : this.angle + sa);

      if (this.hasFood) this.returnDir = best;
      return best;
    }

    if (this.hasFood) {
      if (this.returnDir === null) this.returnDir = this.angle;
      // Keep heading along the remembered return direction with light wander
      return this.returnDir + (Math.random() - 0.5) * 0.4;
    } else {
      if (this.y > CONSTANTS.REGION_SPLIT * CONSTANTS.CELL_SIZE) {
        return -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
      }
      return this.angle + (Math.random() - 0.5) * 2.0;
    }
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

  move(dt, speedMult) {
    const speed = CONFIG.workerSpeed * speedMult;
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

        if (!this.hasFood && (targetMatch || sharedFrontier)) {
          if (DiggingSystem.applyDigAction(this, worldState, gx, gy)) return;
        }
      }
    } else {
      const dx = Math.cos(this.angle) * speed * dt;
      const dy = Math.sin(this.angle) * speed * dt;
      this.x += dx;
      this.y += dy;
      this.stepDistance = Math.hypot(dx, dy);
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

    if (this.hasFood) scentToFood[gy][gx] = Math.min(1.0, scentToFood[gy][gx] + CONFIG.depositAmount);
    else scentToHome[gy][gx] = Math.min(1.0, scentToHome[gy][gx] + (CONFIG.depositAmount * 0.5));
  }

  interact() {
    const gx = Math.floor(this.x / CONSTANTS.CELL_SIZE);
    const gy = Math.floor(this.y / CONSTANTS.CELL_SIZE);
    if (gx < 0 || gx >= CONSTANTS.GRID_W || gy < 0 || gy >= CONSTANTS.GRID_H) return;

    if (!this.hasFood && foodGrid[gy][gx] > 0) {
      foodGrid[gy][gx]--;
      this.hasFood = true;
      this.returnDir = this.angle + Math.PI;
      this.resetStuckTimer();
      this.angle += Math.PI;
      return;
    }

    if (this.hasFood) {
      const q = ants[0];
      if ((q.x - this.x) ** 2 + (q.y - this.y) ** 2 < 1600) {
        this.hasFood = false;
        this.returnDir = null;
        foodInStorage++;
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
  const ex = sx + (VIEW_W / ZOOM / cs) + 2;
  const ey = sy + (VIEW_H / ZOOM / cs) + 2;

  // Terrain
  ctx.imageSmoothingEnabled = false;
  for (let y = Math.max(0, sy); y < Math.min(CONSTANTS.GRID_H, ey); y++) {
    for (let x = Math.max(0, sx); x < Math.min(CONSTANTS.GRID_W, ex); x++) {
      const t = grid[y][x];
      const n = gridTexture[y][x];
      const px = x * cs, py = y * cs;

      if (t === TILES.GRASS) {
        const hue = 132 + (n * 10);
        const sat = 46 + (n * 10);
        const lit = 14 + (n * 10);
        ctx.fillStyle = hsl(hue, sat, lit);
        ctx.fillRect(px, py, cs, cs);
        if (n > 0.82) {
          ctx.fillStyle = "rgba(180,255,214,0.04)";
          ctx.fillRect(px + 2, py + 2, 2, 2);
        }
      } else if (t === TILES.SOIL) {
        const hue = 28 + (n * 6);
        const sat = 30 + (n * 8);
        const lit = 10 + (n * 10);
        ctx.fillStyle = hsl(hue, sat, lit);
        ctx.fillRect(px, py, cs, cs);
        ctx.fillStyle = "rgba(0,0,0,0.20)";
        ctx.fillRect(px, py + (cs - 2), cs, 2);
      } else if (t === TILES.TUNNEL) {
        const hue = 24 + (n * 4);
        const sat = 24 + (n * 10);
        const lit = 10 + (n * 8);
        ctx.fillStyle = hsl(hue, sat, lit);
        ctx.fillRect(px, py, cs, cs);
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.95)";
        ctx.fillRect(px, py, cs, cs);
      }

      // Food
      if (foodGrid[y][x] > 0) {
        const k = Math.min(1, foodGrid[y][x] / 16);
        const sz = Math.min(cs, 4 + foodGrid[y][x]);

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(135,255,120,${0.14 + k*0.14})`;
        ctx.fillRect(px + (cs/2 - (sz/2) - 2), py + (cs/2 - (sz/2) - 2), sz + 4, sz + 4);
        ctx.restore();

        ctx.fillStyle = `rgba(120,255,150,0.70)`;
        ctx.fillRect(px + (cs/2 - sz/2), py + (cs/2 - sz/2), sz, sz);
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

    const body = (a.type === "queen") ? "#d07" : "#2a241f";
    const body2 = (a.type === "queen") ? "#a05" : "#1b1714";
    const hi = (a.type === "queen") ? "rgba(255,170,210,0.20)" : "rgba(255,255,255,0.10)";

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

    if (a.hasFood) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(120,255,150,0.35)";
      ctx.fillRect(-2.6, -7.0, 5.2, 5.2);
      ctx.restore();

      ctx.fillStyle = "#7dff9a";
      ctx.fillRect(-2.0, -6.4, 4.0, 4.0);
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

  DiggingSystem.updateFrontierTiles(worldState);

  // Decay pheromones (full grid)
  const decay = CONFIG.scentDecay;
  for (let y = 0; y < CONSTANTS.GRID_H; y++) {
    for (let x = 0; x < CONSTANTS.GRID_W; x++) {
      if (scentToFood[y][x] > 0.01) scentToFood[y][x] *= decay; else scentToFood[y][x] = 0;
      if (scentToHome[y][x] > 0.01) scentToHome[y][x] *= decay; else scentToHome[y][x] = 0;

      // Food emits its own attractor so ants can find it even before a trail exists
      const foodAmount = foodGrid[y][x];
      if (foodAmount > 0) {
        const add = Math.min(0.5, 0.015 * foodAmount);
        scentToFood[y][x] = Math.min(1.0, scentToFood[y][x] + add);
      }
    }
  }

  ants.forEach(a => a.update(dt));

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
    updateScentTexture(scentToFood, scentToHome);
  }

  render();

  const fps = Math.round(1 / Math.max(dt, 0.00001));
  statsDisplay.innerHTML =
    `<span class="dim">Ants</span>: ${ants.length} &nbsp;|&nbsp; <span class="dim">Food</span>: ${foodInStorage} &nbsp;|&nbsp; <span class="dim">FPS</span>: ${fps}`;
}

// ==============================
// BOOT
// ==============================

initUI();
initScentBuffers();
initEdgeCanvas();
resize();
resetSimulation();
requestAnimationFrame(loop);
