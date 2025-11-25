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

  // Adjusted anchors for a slightly wider, more stable stance
  const ANCHORS = {
    worker: [
      { x: -2.5, y: -2.5 }, // L1
      { x: -3.0, y: 0.0 },  // L2
      { x: -2.5, y: 2.5 },  // L3
      { x: 2.5, y: -2.5 },  // R1
      { x: 3.0, y: 0.0 },   // R2
      { x: 2.5, y: 2.5 },   // R3
    ],
    queen: [
      { x: -4.0, y: -3.5 },
      { x: -4.5, y: 0.0 },
      { x: -4.0, y: 4.0 },
      { x: 4.0, y: -3.5 },
      { x: 4.5, y: 0.0 },
      { x: 4.0, y: 4.0 },
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
    const { dt, travel = 0, speedHint = 1 } = opts;
    
    // Smoothly interpolate step size based on movement
    const targetStride = clamp01(travel * 0.5); 
    rig.stepSize = lerp(rig.stepSize, targetStride, 1 - Math.exp(-dt * 10));

    // Calculate Global Phase
    // Speed up animation when moving, slow idle breathe when still
    const gaitSpeed = rig.stepSize > 0.01 
      ? (0.8 + rig.stepSize * 3.5) // Fast when moving
      : 0.5; // Slow idle
      
    rig.phase = (rig.phase + dt * gaitSpeed) % 1;

    // --- Body procedural animation ---
    // Sharper, less floaty body bob based on the gait step
    const walkBob = Math.sin(rig.phase * TAU * 2); 
    rig.bodyBob = walkBob * (0.2 + rig.stepSize * 0.4);
    
    // Twist body slightly into the step
    rig.bodyTwist = Math.cos(rig.phase * TAU) * 0.1 * rig.stepSize;
    
    // Head and Antennae (Secondary motion)
    rig.headLift = rig.stepSize * 0.5 + Math.sin(rig.phase * TAU) * 0.2;
    rig.antennaSway = Math.cos(rig.phase * TAU * 2.5) * (0.5 + rig.stepSize);

    const anchors = (rig.type === "queen") ? ANCHORS.queen : ANCHORS.worker;
    const reach = (rig.type === "queen") ? 3.2 : 2.8; // Shorter reach = snappier look
    const strideLen = (rig.type === "queen") ? 3.0 : 2.5;

    for (let i = 0; i < LEG_COUNT; i++) {
      const a = anchors[i];
      
      // Calculate local leg phase
      let legP = (rig.phase + LEG_PHASE_OFFSETS[i]) % 1;
      
      // --- GAIT LOGIC ---
      // 0.0 to 0.65: STANCE (Foot on ground, dragging back)
      // 0.65 to 1.0: SWING (Foot in air, snapping forward)
      
      const swingStart = 0.65;
      let legOffset = 0; // -1 (back) to 1 (forward)
      let legLift = 0;   // 0 (ground) to 1 (high)

      if (legP < swingStart) {
        // STANCE PHASE: Move linearly from Front(+1) to Back(-1)
        // This simulates the body moving forward over the planted foot
        const progress = legP / swingStart;
        legOffset = lerp(1, -1, progress);
        legLift = 0; // Foot planted
      } else {
        // SWING PHASE: Move quickly from Back(-1) to Front(+1)
        const progress = (legP - swingStart) / (1 - swingStart);
        // Use a curve to snap the leg forward
        legOffset = lerp(-1, 1, Math.sin(progress * Math.PI / 2)); 
        // Parabolic arc for lift
        legLift = Math.sin(progress * Math.PI); 
      }

      // Apply to rig
      // Scale movement by stepSize (if we stop, legs return to neutral 0)
      const currentStride = legOffset * strideLen * rig.stepSize;
      const currentLift = legLift * (1.5 + rig.stepSize) * rig.stepSize;

      // X/Y calculations relative to body center
      // Anchor position
      rig.legs[i].anchor.x = a.x;
      rig.legs[i].anchor.y = a.y;

      // Foot Position
      // X: Anchor X + outward reach + slight breathing motion
      // Y: Anchor Y + stride offset
      
      const side = a.x > 0 ? 1 : -1;
      
      rig.legs[i].foot.x = a.x + (side * reach); 
      rig.legs[i].foot.y = a.y + currentStride;

      // Add a little randomization/wiggle to feet when idle
      if (rig.stepSize < 0.1) {
        rig.legs[i].foot.x += Math.sin(Date.now()*0.005 + i)*0.2;
      }

      rig.legs[i].lift = currentLift;
    }
  }

  function getPose(rig) { return rig; }

  return { createRig, step, getPose };
})();
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
