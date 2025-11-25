// Procedural animation helper for ants.
// Lightweight state machine that drives leg gait, body bob, and antenna sway
// based on stride distance and delta time.

const ANT_ANIM = (() => {
  const LEG_COUNT = 6;
  const TAU = Math.PI * 2;

  const LEG_PHASE_OFFSETS = [0, 0.5, 0.25, 0.5, 0.0, 0.75];

  const ANCHORS = {
    worker: [
      { x: -3.2, y: -1.6 },
      { x: -3.0, y: 0.2 },
      { x: -2.2, y: 1.8 },
      { x: 3.2, y: -1.6 },
      { x: 3.0, y: 0.2 },
      { x: 2.2, y: 1.8 },
    ],
    queen: [
      { x: -4.4, y: -2.0 },
      { x: -4.0, y: 0.4 },
      { x: -3.0, y: 2.4 },
      { x: 4.4, y: -2.0 },
      { x: 4.0, y: 0.4 },
      { x: 3.0, y: 2.4 },
    ]
  };

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function createRig(type = "worker") {
    return {
      type,
      phase: Math.random(),
      stepSize: 0,
      bodyBob: 0,
      bodyTwist: 0,
      headLift: 0,
      antennaSway: 0,
      legs: new Array(LEG_COUNT).fill(0).map(() => ({ anchor: {x:0,y:0}, foot: {x:0,y:0}, lift: 0 })),
    };
  }

  function step(rig, opts) {
    const { dt, travel = 0, speedHint = 1 } = opts;
    const targetStride = clamp01(travel * 0.35);
    rig.stepSize = lerp(rig.stepSize, targetStride + speedHint * 0.002, 1 - Math.exp(-dt * 6));

    const gaitSpeed = 0.6 + rig.stepSize * 2.4 + speedHint * 0.01;
    rig.phase = (rig.phase + dt * gaitSpeed) % 1;

    const wobble = Math.sin(rig.phase * TAU);
    rig.bodyBob = wobble * (0.35 + rig.stepSize * 0.5);
    rig.bodyTwist = Math.cos(rig.phase * TAU * 0.5) * 0.08 * (0.4 + rig.stepSize);
    rig.headLift = (0.6 + rig.stepSize * 0.6) + Math.sin(rig.phase * TAU + 1.4) * (0.6 + rig.stepSize * 0.4);
    rig.antennaSway = Math.sin(rig.phase * TAU * 1.6 + 0.6) * (0.9 + rig.stepSize * 0.6);

    const anchors = (rig.type === "queen") ? ANCHORS.queen : ANCHORS.worker;
    const reach = (rig.type === "queen") ? 3.6 : 3.0;
    const liftScale = (rig.type === "queen") ? 1.2 : 1.0;

    for (let i = 0; i < LEG_COUNT; i++) {
      const a = anchors[i];
      const phase = (rig.phase + LEG_PHASE_OFFSETS[i]) % 1;
      const sine = Math.sin(phase * TAU);
      const lift = Math.max(0, Math.sin(phase * TAU + Math.PI / 2));
      const dir = a.x >= 0 ? 1 : -1;
      const stride = (reach + rig.stepSize * 2.0) * dir;

      rig.legs[i].anchor.x = a.x;
      rig.legs[i].anchor.y = a.y - rig.bodyBob * 0.6;
      rig.legs[i].foot.x = a.x + stride + sine * 0.5;
      rig.legs[i].foot.y = a.y + reach + rig.stepSize * 1.8 - lift * liftScale;
      rig.legs[i].lift = lift * liftScale;
    }
  }

  function getPose(rig) { return rig; }

  return { createRig, step, getPose };
})();
