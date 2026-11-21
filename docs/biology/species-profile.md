# Flagship: Lasius niger

This profile represents a single mated queen and worker-producing summer laboratory colony. It is a deliberately restricted portion of the species' biology. [Evidence IDs](evidence.json) are the traceability authority; [parameters.json](parameters.json) labels every numerical default. No whole-model preset is empirically calibrated.

| Trait | Species evidence and represented scope |
|---|---|
| Reproductive organization | One queen in the established scenario; cofounding exists but is excluded, E5 |
| Founding | Claustral reserves, queen-only sealed initial cavity; initial excavation itself is a boundary condition, E8 |
| Workers | Worker agents vary in age, lifespan and thresholds; no soldiers or discrete permanent castes. Distribution shapes and age biases are assumptions |
| Colony size/maturity | Default 12 workers is a young established scenario. No claim that it represents a mature thousands-worker colony |
| Diet | Carbohydrate and processed-protein resources; adult crop storage and contact transfer, E2/E3/E8 |
| Chemical communication | Deposited foraging trail, decay, local attraction; no invented alarm channels or colony-global queen field, E1/E11 |
| Personal navigation | Experienced route use; exact odometric cell lists simplify real landmarks and route learning, E1 |
| Nest | Initial cavity followed by adjacent excavation and material transport. Quantitative 3D morphology unsupported, E4/E12 |
| Brood | Eggs → larvae → pupae → workers; no invented larval instar counts. Nutrition-dependent larval progress, E8/E9 |
| Environment | Constant summer temperature and imposed moisture; water ad libitum. No unsupported ventilation/oxygen field |
| Seasonality | Known seasonal reproductive pauses and population-dependent development, E8/E9; true diapause, winter and annual sexual production are not implemented |
| Mortality | Nutrient depletion, adverse brood conditions and variable lifespan; rates are hypotheses, no measured survival curve fitted |
| Hygiene | Corpse ageing cue and local removal, E10; no cemetery ritual or pathogen model |

## Parameter interpretation

| Parameter family | Units/default | Status / sensitivity |
|---|---|---|
| Time and geometry | 1 s ticks; 2 mm cells | Numerical resolution assumptions; playback never changes these |
| Walking | 1 mm/s; individual movement is discrete | Unfitted speed; UI 0.25–2 mm/s sensitivity. Single-cell/tick cap limits high-speed synergy |
| Crop | C 120, P 30 µg equivalent | Unfitted capacities; separate body/reserve/crop pools, not actual elemental composition |
| Feeding | Uptake 2 µg equivalent/s, transfer 1/s | Unfitted; 6 s contact delay is inspired by E2 event definition, not measured digestive latency |
| Maintenance | Worker 18, queen 30 µg C equivalent/day | Unfitted metabolism, no ATP or assimilation-efficiency claim |
| Development | Egg 17, larva 14, pupa 21 days at rate 1 | Coarse assumptions constrained to weeks; not inferred individual stage means from E8 colony-first events |
| Queen | 3-day start delay; 1-day maximum interval; eggs C2/P2 | Unfitted reserve-limited fecundity; no ovarian/endocrine or fertilization model |
| Larval growth | C12/P12 body target | Unfitted growth budget, no hidden nurse service creates biomass |
| Initial reserves | Queen C1800/P450; worker C18 | Unfitted. Initial structural and crop quantities are explicit in agents.js and included in the initial ledger |
| Trail | half-life `47×60×ln(2)` s; marks relative | E11 exponential mean lifetime converted correctly. Surface, climate and concentration caveats apply |
| Trail deposition/choice | 0.5 relative marks/cell; saturating gain 4 | Unfitted local rule; quality and crowding modify marks |
| Thermal response | Rate rises above 17°C, bounded; halt at ≥35°C | Unfitted, not a critical thermal-limit estimate or true diapause |
| Soil | Moisture .6; hardness 1; 600 s work/cell | Unfitted monotone sensitivity. One load per cell is a coarse transport abstraction |
| Corpse cue | 7200 s | Unfitted approximation of gradual postmortem detection; E10 does not establish a sharp threshold |
| Lifespan | Worker base 365 days × uniform 0.7–1.3; queen base 5000 days × same | Assumptions, not measured survival curves; initially workers have uniform 0–60 day ages |

Threshold distributions (uniform 0.2–0.8), rest bouts, exploration-return times (300 + 600×individual forage threshold seconds), local crowd-triggered excavation, soft congestion, initial food patches, corpse disposal walks and the nest thermal depth gradient are all explicitly uncalibrated. Future profiles can replace these parameters without renderer changes; a second species has not been implemented.
