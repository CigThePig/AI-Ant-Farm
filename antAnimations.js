// Procedural animation helper for ants.
// Implements a Tripod Gait (3 legs moved, 3 legs grounded)
// with distinct "Stance" (grip) and "Swing" (step) phases.

const ANT_ANIM = (() => {
  const LEG_COUNT = 6;
  const TAU = Math.PI * 2;

  // Tripod Gait:
  // Group A: Legs 0, 3, 4 (Left-Front, Right-Mid, Right-Back)
  // Group B: Legs 1, 2, 5 (Left-Mid, Left-Back, Right-Front)
  // We alternate phases so one group is grounded while the other steps.
  const LEG_PHASE_OFFSETS = [
    0.0,  // L1 (Group A)
    0.5,  // L2 (Group B)
    0.0,  // L3 (Group A)
    0.5,  // R1 (Group B)
    0.0,  // R2 (Group A)
    0.5   // R3 (Group B)
  ];

  // Adjusted anchors to be TIGHTER to the body (closer to x=0)
  // This prevents the "floating alongside body" look.
  const ANCHORS = {
    worker: [
      { x: -1.2, y: -2.0 }, // L1 (Front)
      { x: -1.4, y: 0.0 },  // L2 (Mid)
      { x: -1.2, y: 2.5 },  // L3 (Back)
      { x: 1.2, y: -2.0 },  // R1
      { x: 1.4, y: 0.0 },   // R2
      { x: 1.2, y: 2.5 },   // R3
    ],
    queen: [
      { x: -2.0, y: -3.5 },
      { x: -2.2, y: 0.0 },
      { x: -2.0, y: 4.0 },
      { x: 2.0, y: -3.5 },
      { x: 2.2, y: 0.0 },
      { x: 2.0, y: 4.0 },
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
      legs: new Array(LEG_COUNT).fill(0).map(() => ({ 
        anchor: {x:0,y:0}, 
        foot: {x:0,y:0}, 
        lift: 0 
      })),
    };
  }

  function step(rig, opts) {
    const { dt, travel = 0 } = opts;
   
    // Smoothly interpolate step size based on movement
    const targetStride = clamp01(travel * 0.5); 
    rig.stepSize = lerp(rig.stepSize, targetStride, 1 - Math.exp(-dt * 10));

    // Calculate Global Phase
    const gaitSpeed = rig.stepSize > 0.01 
      ? (0.8 + rig.stepSize * 3.5) 
      : 0.5;
      
    rig.phase = (rig.phase + dt * gaitSpeed) % 1;

    // Body Animation
    const walkBob = Math.sin(rig.phase * TAU * 2); 
    rig.bodyBob = walkBob * (0.2 + rig.stepSize * 0.4);
    rig.bodyTwist = Math.cos(rig.phase * TAU) * 0.1 * rig.stepSize;
    rig.headLift = rig.stepSize * 0.5 + Math.sin(rig.phase * TAU) * 0.2;
    rig.antennaSway = Math.cos(rig.phase * TAU * 2.5) * (0.5 + rig.stepSize);

    const anchors = (rig.type === "queen") ? ANCHORS.queen : ANCHORS.worker;
   
    // INCREASED REACH: Since anchors are closer to body, legs must be longer
    const reach = (rig.type === "queen") ? 5.0 : 4.5; 
    const strideLen = (rig.type === "queen") ? 3.5 : 3.0;

    for (let i = 0; i < LEG_COUNT; i++) {
      const a = anchors[i];
      let legP = (rig.phase + LEG_PHASE_OFFSETS[i]) % 1;
      
      const swingStart = 0.65;
      let legOffset = 0; 
      let legLift = 0;

      if (legP < swingStart) {
        // STANCE
        const progress = legP / swingStart;
        legOffset = lerp(1, -1, progress);
        legLift = 0; 
      } else {
        // SWING
        const progress = (legP - swingStart) / (1 - swingStart);
        legOffset = lerp(-1, 1, Math.sin(progress * Math.PI / 2)); 
        legLift = Math.sin(progress * Math.PI); 
      }

      const currentStride = legOffset * strideLen * rig.stepSize;
      const currentLift = legLift * (1.5 + rig.stepSize) * rig.stepSize;

      rig.legs[i].anchor.x = a.x;
      rig.legs[i].anchor.y = a.y;

      const side = a.x > 0 ? 1 : -1;
      
      // Splay legs out slightly based on front/back position for a natural bug look
      const splay = (i === 0 || i === 3) ? -0.5 : (i === 2 || i === 5) ? 0.5 : 0;
      
      rig.legs[i].foot.x = a.x + (side * reach) + (side * Math.abs(splay)*1.5); 
      rig.legs[i].foot.y = a.y + currentStride + (splay * 2.0);

      if (rig.stepSize < 0.1) {
        rig.legs[i].foot.x += Math.sin(Date.now()*0.005 + i)*0.2;
      }

      rig.legs[i].lift = currentLift;
    }
  }

  function getPose(rig) { return rig; }

  return { createRig, step, getPose };
})();
