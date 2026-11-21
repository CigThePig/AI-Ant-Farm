import { Simulation } from './simulation.js';
import { FixedClock } from './clock.js';
import { Renderer } from './renderer.js';
import { OPEN } from './navigation.js';
const $ = (id) => document.getElementById(id);
const renderer = new Renderer($('world'));
let sim,
  clock,
  paused = false,
  speed = 1,
  last = null,
  uiTimer = 0,
  health = [];

function createColony() {
  const input = Number($('seed').value);
  const seed = Number.isFinite(input) ? Math.max(0, Math.min(4294967295, Math.floor(input))) : 42;
  $('seed').value = seed;
  sim = new Simulation({
    seed,
    scenario: $('scenario').value,
    parameters: {
      walkMMPerSecond: Number($('ant-speed').value),
      temperatureC: Number($('temperature').value),
      trailsEnabled: $('trails').checked,
      memoryEnabled: $('memory').checked,
    },
  });
  clock = new FixedClock((dt) => sim.step(dt), { hz: 1, maxSteps: 500 });
  renderer.selected = null;
  health = [];
  last = null;
  renderer.center(sim);
  updateUI();
}
function setPaused(value) {
  paused = value;
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
  $('step').disabled = !paused;
}
function setSettings(open) {
  $('settings').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
}
function updateUI() {
  const s = sim.snapshot(),
    w = sim.world;
  $('provision').disabled = w.grid[w.entrance] !== OPEN;
  $('workers').textContent = s.workers;
  $('brood').textContent = s.brood;
  $('food').textContent = Math.floor(s.food);
  $('phase').textContent = !s.queenAlive
    ? 'QUEEN LOST'
    : s.scenario === 'founding' && s.workers === 0
      ? 'CLAUSTRAL'
      : 'ESTABLISHED';
  $('sim-time').textContent =
    `${Math.floor(s.days)}d ${Math.floor(s.time / 3600) % 24}h ${Math.floor(s.time / 60) % 60}m`;
  $('progress').style.width = `${Math.min(100, s.metrics.gathered / 10)}%`;
  $('progress-text').textContent = `${s.metrics.discovered} visits`;
  $('objective-label').textContent = 'Local exploration and food discovery';
  $('status-detail').textContent =
    `${s.metrics.births} emerged · ${s.metrics.contacts} food transfers · ${s.metrics.dug} soil cells excavated`;
  $('event').textContent = sim.events.at(-1)?.message || '';
  $('jobs').textContent = Object.entries(s.jobs)
    .map(([k, v]) => `${k.padEnd(12)} ${v}`)
    .join('\n');
  health = sim.inspect();
  $('health').textContent = health.length
    ? `${health.length} issue(s): ${health[0]}`
    : 'State and C/P/soil ledgers balance; this is not empirical validation.';
  if (renderer.selected !== null) {
    const a = sim.ants.find((a) => a.id === renderer.selected);
    $('selection').hidden = !a;
    if (a)
      $('selection').textContent =
        `${a.type} #${a.id} · ${a.behaviour}\nAge ${(a.age / 86400).toFixed(1)} days; crop C ${a.crop.c.toFixed(1)} / P ${a.crop.p.toFixed(1)} µg equiv.\nMemory ${a.memory.length} cells; experience ${a.experience} visits\nLocal cues: ${JSON.stringify(a.stimuli)}`;
  } else $('selection').hidden = true;
}
$('pause').addEventListener('click', () => setPaused(!paused));
$('step').addEventListener('click', () => {
  if (paused) {
    sim.step();
    updateUI();
    renderer.draw(sim);
  }
});
$('reset').addEventListener('click', createColony);
$('follow').addEventListener('click', () => renderer.center(sim));
$('settings-toggle').addEventListener('click', () => setSettings($('settings').hidden));
$('settings-close').addEventListener('click', () => setSettings(false));
$('layer').addEventListener('change', () => {
  renderer.layer = $('layer').value;
});
$('trails').addEventListener('change', () =>
  sim.setParameter('trailsEnabled', $('trails').checked),
);
$('memory').addEventListener('change', () =>
  sim.setParameter('memoryEnabled', $('memory').checked),
);
$('provision').addEventListener('click', () => {
  const c = Number($('feeder-c').value),
    p = Number($('feeder-p').value);
  if (![c, p].every((value) => Number.isFinite(value) && value >= 0 && value <= 100000)) return;
  if (sim.world.grid[sim.world.entrance] !== OPEN) return;
  sim.addFood(sim.world.entrance, c, p);
  sim.note(`Experimental feeder provisioned: C ${c}, P ${p} µg equivalent.`);
  updateUI();
});
$('erase').addEventListener('click', () => sim.eraseTrails());
$('temperature').addEventListener('change', () =>
  sim.setParameter('temperatureC', Number($('temperature').value)),
);
$('ant-speed').addEventListener('input', () => {
  sim.setParameter('walkMMPerSecond', Number($('ant-speed').value));
  $('ant-speed-value').textContent = `${sim.p.walkMMPerSecond} mm/s (assumption)`;
});
for (const button of document.querySelectorAll('[data-speed]'))
  button.addEventListener('click', () => {
    speed = Number(button.dataset.speed);
    for (const b of document.querySelectorAll('[data-speed]'))
      b.classList.toggle('active', b === button);
  });
$('export').addEventListener('click', () => {
  const report = sim.report();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `ant-farm-seed-${sim.world.seed}-${Math.floor(sim.time)}s.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('resize', () => renderer.resize());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setSettings(false);
    renderer.selected = null;
    updateUI();
    return;
  }
  if (
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(document.activeElement?.tagName)
  )
    return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  }
  if (e.key.toLowerCase() === 'd') {
    renderer.layer = renderer.layer === 'tasks' ? 'none' : 'tasks';
    $('layer').value = renderer.layer;
  }
});
// Pointer capture keeps a drag stable when a finger leaves the canvas. Pinch
// transitions reset their origins so lifting one finger never jumps the camera.
const pointers = new Map();
let gesture = null;
const canvas = $('world');
function gestureState() {
  const points = [...pointers.values()];
  if (points.length === 1) return { x: points[0].x, y: points[0].y, distance: 0 };
  if (points.length >= 2)
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2,
      distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y),
    };
  return null;
}
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, {
    x: e.clientX,
    y: e.clientY,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  });
  if (pointers.size > 1) for (const p of pointers.values()) p.moved = true;
  gesture = gestureState();
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (Math.hypot(p.x - p.startX, p.y - p.startY) > 5) p.moved = true;
  const current = gestureState();
  if (gesture && current) {
    renderer.camera.x -= (current.x - gesture.x) / renderer.camera.zoom;
    renderer.camera.y -= (current.y - gesture.y) / renderer.camera.zoom;
    if (current.distance > 0 && gesture.distance > 0)
      renderer.zoomAt(current.x, current.y, current.distance / gesture.distance);
    renderer.following = false;
  }
  gesture = current;
});
function release(e) {
  const p = pointers.get(e.pointerId);
  if (p && !p.moved && e.type === 'pointerup') {
    const pos = renderer.point(e.clientX, e.clientY);
    let closest = null,
      best = 0.9;
    for (const a of sim.ants) {
      const d = Math.hypot(pos.x - a.x, pos.y - a.y);
      if (d < best) {
        best = d;
        closest = a.id;
      }
    }
    renderer.selected = closest;
    updateUI();
  }
  pointers.delete(e.pointerId);
  gesture = gestureState();
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
}
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(name, release);
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    renderer.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.001));
  },
  { passive: false },
);
document.addEventListener('visibilitychange', () => {
  last = null;
});
function fail(error) {
  setPaused(true);
  $('fatal').hidden = false;
  $('fatal').textContent =
    `The colony paused after an unexpected error.\n${error.message}\nSeed: ${sim?.world.seed}. Reload to start again.`;
  console.error(error);
}
createColony();
function frame(now) {
  try {
    if (last === null) last = now;
    const elapsed = Math.max(0, (now - last) / 1000);
    last = now;
    if (!paused && !document.hidden) clock.advance(elapsed * speed);
    uiTimer += elapsed;
    if (uiTimer >= 0.25) {
      updateUI();
      uiTimer = 0;
    }
    renderer.draw(sim);
    requestAnimationFrame(frame);
  } catch (error) {
    fail(error);
  }
}
// Small read-only access surface used by browser smoke tests and manual diagnosis.
window.antFarm = {
  get simulation() {
    return sim;
  },
  get renderer() {
    return renderer;
  },
  get paused() {
    return paused;
  },
  inspect: () => sim.inspect(),
  snapshot: () => sim.snapshot(),
};
requestAnimationFrame(frame);
