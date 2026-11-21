# Baseline biological audit

Baseline `65db5f5` was fetched from main before edits. All source, test, browser, soak, check, server, HTML, styles, package and workflow files were inspected. Historical branches were not treated as current biology.

[Function inventory](baseline-functions.json) records all 184 parsed functions, including methods and anonymous callbacks, with their baseline source locations. [Per-function audit](audit.csv) maps each inventoried function to purpose, species, evidence, deficiency, disposition, replacement and validation. Anonymous event handlers have their own inventory rows and are classified at the UI-system level. The inventory is generated with Acorn by `npm run audit:baseline`; it excludes control statements and requires the historical baseline commit in the local Git object database.

## System dispositions

| System | Baseline judgement | Decision and evidence |
|---|---|---|
| Work allocation | Technically reliable but global food/worker counts create quotas | Replace with local stimuli and individual response hypotheses, E7 |
| Global resource routes | Gives undiscovered food coordinates to ants | Replace with local sensing, exploration and personal routes, E1 |
| Food/pantries | Generic piles and energy transfers omit social crop physiology | Replace with C/P pools, physical feeding and contact transfers, E2/E3 |
| Queen/brood | Pantry-funded eggs and seconds-long development | Queen reserve-funded founding, days-long stages; rates remain assumptions, E5/E8/E9 |
| Excavation | A shaft and rooms exist as future coordinate plans | Remove all future blueprints; local work and conserved carried soil; morphology unvalidated, E4/E12 |
| Chemical fields | Diffusion/visual overlays do not direct foraging | Successful returners deposit surface marks, local following and decay, E1/E11 |
| Ventilation | Distance field has no gas units or boundary/source terms | Remove; no oxygen claims |
| Corpse removal | Global cleaner assignments and instant cues | Local delayed contact, transport and interruption recovery, E10 |
| Navigation | Cardinal movement and obstacle checks technically useful | Retain cell/neighbour helpers; global route function unused by ants |
| Clock | Fixed-step accumulator and retained time debt are useful | Retain; biological tick becomes one second |
| Rendering/mobile | Canvas, camera, gestures and cached terrain are useful | Retain; remove pantry/air/plan graphics, add crop/state diagnostics |
| Testing/CI | Good reliability basis but biological expectations wrong | Replace births-in-minutes and guaranteed-survival assertions with explicit invariants and experiments |

The initial cavity is an initial condition, not a hidden future excavation objective. Scientific conclusions require behaviour comparisons; passing software tests does not validate the approximations in this audit.
