# Validation results and interpretation

Model 3.0.0, research and execution date 2026-11-21. Five experiment seeds: 1, 7, 42, 1337, 2026. Descriptive mean ± sample SD across seeds is not an empirical confidence interval or a statistical significance claim. Conditions are separated in the machine-readable report; pooled summaries below identify the runner's primary measurement and must not be used to compare different treatment types.

## Software correctness

19 correctness and mechanism tests pass locally. They cover seeded reproducibility, unavailable information, cardinal movement, sustained and interrupted contacts, corpse locality, physical brood transport, source switching, C/P and soil ledgers, cold/dry parameters, fixed-step playback, founding reserves and brood stages.

GitHub Actions separately runs syntax checks, these tests, seeded 86400-second soaks (1, 42, 1337), experiments, and Chromium browser regression tests. The previous checked code revision passed all five browser sizes: 1280×720, 2340×1080, 1024×768, 888×400 and 390×844. Final revision checks are linked in the PR. Browser evidence includes screenshots, videos and JSON reports. No Samsung-device FPS measurement is claimed.

## Mechanism experiments

Experiment | Protocol | Primary output mean ± SD | Interpretation
---|---|---|---
| A | Undiscovered food | 962.1 ± 44.05 (n=5) | observed: local exploration collects food; one-hour brood emergence correctly absent |
| B | Quality and crowding | 695.2 ± 67.08 (n=10) | unvalidated: quality changes marking by construction; consistent colony-level preference not established |
| C | Trail and memory ablation | 5.885 ± 10.54 (n=20) | inconclusive: satiation limits post-disruption harvest and obscures ablation effects |
| D | Local brood demand | 1 ± 0 (n=5) | mechanism observed: nursing requires local brood contact; no empirical task-distribution fit |
| E | Spatial food distribution | 1.855e-11 ± 1.522e-12 (n=5) | mechanism observed: physical exchange edges and conservative nutrient accounting |
| F | Brood thermal sensitivity | 7.663 ± 4.833 (n=20) | encoded sensitivity observed: provisional temperature response; empirical curve not fitted |
| G | Local excavation sensitivity | 31.6 ± 6.769 (n=10) | unvalidated: harder soil slows local work by construction, but colony-wide excavation is not reliably monotone |
| H | Forager removal | 17.8 ± 24.44 (n=5) | unvalidated: removal and subsequent harvesting measured; no empirical recovery criterion |
| I | Starvation and refeeding | 1754 ± 2.542e-13 (n=5) | mechanism observed: accessible provisioning supports surviving agents; no resurrection |
| J | Extended lifecycle subsystem | 16 ± 0 (n=5) | subsystem only: reserve-funded development over weeks; spatial worker feeding absent |
| C-controlled | Naive branch choice and experienced route latency | 36.5 ± 3.689 (n=10) | mechanism observed: naive local trail bias and retained personal routes; speed synergy is encoded, not independently predicted |

A's quantity is gathered C+P in µg substrate-equivalent during one biological hour: **962.10 ± 44.05**, n=5. Every seed found food without a source assignment. Zero workers emerged within that hour, as expected with days-long development.

The controlled C assay gives naive right-branch choices of **49.72%** without marks versus **70.36%** with a local right-branch trail (5000 draws per condition across five seeded runs). Experienced workers reached their personally learned endpoint in every marked/unmarked run: **40 s unmarked versus 33 s marked**. This demonstrates implementation of cue use and preserved memory. The speed advantage is encoded by a literature-inspired multiplier; it is not independent experimental validation of that multiplier.

The whole-colony C collection assay is satiation-limited: intact-minus-erased mean collection difference was 0.00 µg equivalent. It does not demonstrate a colony-level efficiency advantage. B does not establish reliable quality preference and G does not establish a monotonic colony-wide hardness effect. Those results are retained without retuning rules to force the desired sign.

F's thermal response and J's reserve-funded lifecycle are subsystem assays. Identical F/J seed outcomes do not imply zero biological variation. J runs 70 days of physiology without spatial worker feeding after emergence; reserve depletion and deaths are recorded, not corrected away.

## Full spatial lifecycle

A separate **70-day** seed-42 run used **6,048,000 one-second spatial updates**, with **1680 hourly invariant checks**, plus daily snapshots. It took 109.2 s on the execution host; this is an offline small-colony timing, not browser/mobile performance.

- First adult emergence appeared in the day-56 snapshot; 15 total adults emerged by day 70.
- Day-70 population: 2 workers, 35 brood; queen alive: true.
- Worker population reached zero at day 50 before remaining fed brood emerged. This is a major model/feeding-scenario limitation, not realistic-growth validation.
- 25 adult deaths and 18 brood deaths; 33 corpse removals.
- 305 excavated cell-equivalent loads; deepest open cell 36 mm below the surface. No empirical 3D architecture fit is claimed.
- Final C ledger residual: -3.8e-08 µg equivalent. P residual: 0. No inventory correction was applied.

The scenario starts with finite food, so it is not a continuously provisioned colony-growth experiment. Worker loss, food access, local nursing and the provisional physiology interact; an isolated counterfactual design would be required to attribute mortality to a specific cause.

Run `npm run lifecycle -- --days=70 --seed=42` to repeat the complete spatial protocol. [Full daily measurements](spatial-70-days.json) and [A–J measurements](experiments.json) retain the actual outputs.

## Performance profile

[Execution-host measurements](performance.json) report p50/p95/p99 step times for 12, 100 and 500 synthetic workers over 900 biological seconds. The simulation maintains a spatial worker index; brood/corpse scans and full-grid decay remain scaling costs. These timings exclude rendering and do not validate large-colony biology or Galaxy S25 frame rates. Run `npm run benchmark` to reproduce locally.

## Scientific status

Empirical validation remains **incomplete**. There is no held-out fit of feeding-network distributions, task responses, colony growth, 3D architecture or field foraging. The available evidence supports the selected kinds of mechanisms; it does not validate every numerical approximation. See [limitations](../biology/limitations.md).
