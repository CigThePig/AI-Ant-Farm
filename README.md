# AI Ant Farm

A browser ant colony simulation. A queen and twelve workers found a nest, maintain a food supply, feed and move brood, clean the nest, and expand as the colony grows.

## Run

Requires Node.js 22 or newer:

```sh
npm start
```

Open http://localhost:8080. The application has no production dependencies. It uses JavaScript modules and needs an HTTP server rather than opening `index.html` directly. Any ordinary static host works, including GitHub Pages.

Drag to pan, scroll or pinch to zoom, and click an ant to inspect its current task. Controls include a repeatable world seed, pause, single-step, 1×/4×/12× time, worker movement speed, and food regrowth. The **Colony** button recenters the camera. Space pauses; D toggles routes.

The view layers show task routes, planned excavation, food/home scent, and ventilation. **Colony diagnostics** checks positions, inventory, task reservations, and brood ownership. Download a JSON colony report to retain the seed, settings, metrics, and recent events. Reports are diagnostics, not save files or complete input replays.

## Tests

```sh
npm run check
npm test
npm run soak -- --seconds=3600 --seeds=1,42,1337
```

The tests need no installed packages. They exercise colony reproduction and survival, blocked construction, dogleg navigation, excavation and branching, delivery/cleaning inside the queen's core, nurse interruption/death/hatching, actual feeding requirements, storage pressure and spoilage, scent diffusion, ventilation, corpse handling, collision at high speeds, food conservation, and rendering-rate independence.

To run actual Chromium integration tests:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The smoke suite checks desktop, tablet, phone landscape, and phone portrait sizes, including 2340×1080. It exercises controls, seed reset, single-step, report download, panning, and pinch gestures, then records screenshots, video, and state reports in `test-artifacts/`. GitHub Actions runs both suites and uploads their evidence. Browser tests are separate from the headless simulation tests.

## Model and architecture

- `src/world.js`: seeded world generation, connected excavation plans, inventory, diffusion, and ventilation.
- `src/navigation.js`: shared cardinal pathfinding for workers and queen.
- `src/simulation.js`: colony lifecycle and owned ant tasks with explicit completion/cancellation/death cleanup.
- `src/clock.js`: fixed 30 Hz simulation, independent of display refresh rate. Catch-up debt is retained during slow frames; hidden tabs intentionally suspend time.
- `src/renderer.js`: cached canvas terrain, procedural ants, overlays, and camera.
- `src/app.js`: controls and input; presentation does not make colony decisions.

Ants have one task at a time. Foraging remains available while construction is incomplete. Food is a single fungible resource; every pickup, meal, egg cost, spoilage event, delivery, and dropped load is accounted for. Larvae begin hungry and need at least two physically delivered nurse meals before maturation. Only living workers affect population pressure. Corpse removal uses the same cleanup task system.

Excavation starts with a shaft and circular queen chamber, then adds connected branches and rooms in response to population/storage pressure. Workers use explicit routes and colony-wide assignment, rather than discovering all tasks purely through pheromones. Scent fields are real time-based, wall-aware diffusion fields available for inspection, but they do not override navigation. Ventilation attenuates with connected tunnel distance; it is informational and does not model suffocation. Food patches replenish by default; turn off regrowth for a finite-resource colony.

The old overlapping decision systems have been removed. This rebuild intentionally focuses on a stable, observable colony rather than preserving their tuning or exact behavior.
