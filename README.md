# AI-Ant-Farm · Lasius niger

Browser-based, seeded individual-agent model of a young black garden ant colony. Workers explore with local information, deposit and follow substrate trails, retain personal route memories, exchange crop nutrients through physical encounters and excavate neighbouring soil. Queen reserves and nutritional brood development use a biological clock measured in seconds and days.

This is an **evidence-informed, uncalibrated model**, not a validated prediction of natural colony growth. [Research](docs/biology/research.md), [species parameters](docs/biology/species-profile.md), [evidence matrix](docs/biology/evidence.json), [function audit](docs/biology/audit.csv) and [limitations](docs/biology/limitations.md) separate observations from assumptions.

Requires Node ≥22.

```sh
npm ci
npm start
npm run check
npm test
npm run soak -- --seconds=86400 --seeds=1,42,1337
npm run experiment
npm run benchmark
npm run lifecycle -- --days=70 --seed=42
npx playwright install --with-deps chromium
npm run test:browser
```

Open http://localhost:8080. Choose a young established colony or a single claustral queen. Pan/zoom on desktop or mobile; select ants for their crop state, age, local stimuli and memory. Controls include substrate trail view, trail erasure, memory/trail ablation, surface temperature, locomotion sensitivity and explicit finite feeder provisioning. Playback changes elapsed biological time, not developmental biology. A first worker takes weeks, not minutes.

Exports include parameters, seed, initial scenario, interventions, nutrient ledgers, bounded colony history and contact edges. [Experiment results](docs/validation/experiments.json) include A–J and a controlled navigation assay, with explicit scope limits. See [validation interpretation](docs/validation/results.md).

Simulation code is independent of rendering. `species.js` defines the model, `agents.js` the individual state, `nutrition.js` conservative transfers, `world.js` geometry/resources/surface trails, and `simulation.js` sensing, decisions and lifecycle. Global navigation helpers are not called by workers. The fixed clock preserves update debt during accelerated viewing.

CI runs correctness/invariant tests, seeded day-long soaks, mechanism experiments and Chromium checks at desktop/mobile sizes including 2340×1080. If using system Chromium locally, set `CHROMIUM_PATH=/path/to/chromium`. Recorded artifacts do not imply real-device performance validation.
