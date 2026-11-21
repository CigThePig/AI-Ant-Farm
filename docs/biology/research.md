# Biological research and model decisions

Research date: 2026-11-21. Model: 3.0.0. Baseline: `65db5f5` (latest main when work began).

This is an evidence-informed, individual-based laboratory model of **Lasius niger**, not a calibrated ecological predictor. Species-specific navigation, recruitment, founding and contact-feeding evidence make this species a coherent foundation. No seed granaries, soldiers, fungus or imported fire-ant chemical rules are included.

## Evidence matrix

The structured source of truth is [evidence.json](evidence.json). It includes methods, measured units, access limits, interpretations and implementation simplifications. High confidence in an observation does not confer high confidence on our model.

Biological system | Species | Observed behaviour | Proposed mechanism | Scientific source | Confidence | Simulation implementation | Validation method
---|---|---|---|---|---|---|---
Route memory and trail synergy | Lasius niger | Experienced foragers performed better with substrate trails than either information source alone. | Personal route recall combined with locally detected substrate marks; confidence is an interpretation. | [E1](https://pmc.ncbi.nlm.nih.gov/articles/PMC3130237/) | High for experimental effect; low for our exact navigation representation | src/simulation.js chooseMove/updateWorker; src/agents.js rememberStep | C and C-controlled; playback and hidden-resource tests
Trophallactic distribution | Lasius niger | Food exchange networks are spatial and heterogeneous. | Encounter-mediated donor/receiver crop transfers; exact flow rates were not measured in this paper. | [E2](https://pmc.ncbi.nlm.nih.gov/articles/PMC6821819/) | High for contact exchange; low for mass-flow calibration | src/nutrition.js transfer; Simulation.share/transferFood | E; sustained-contact and no-distant-transfer tests
Crowding and recruitment | Lasius niger | Limited feeding access changes collective allocation and permits flexibility. | Reduced intake and recruitment when workers compete locally for food. | [E3](https://pmc.ncbi.nlm.nih.gov/articles/PMC3440389/) | High for effect, approximate implementation | Simulation.updateWorker: intake and successful recruitment divided by local occupancy | B; feeding contact and conservation tests
Construction versus excavation | Lasius niger | Workers collectively assemble pillars and caps; natural CT nests have galleries/chambers. | Material-associated marks and local geometry explain laboratory deposition patterns, not necessarily subterranean excavation. | [E4](https://pmc.ncbi.nlm.nih.gov/articles/PMC4747701/) | High for published deposition experiments; low for our underground rule | World.dig and Simulation.updateWorker replace plan with local work; soil transported to surface | G, soil conservation; qualitative geometry diagnostics only
Founding organization | Lasius niger | Queens can actively form founding associations; mature colonies generally retain one queen. | Queen association is context-dependent, followed by conflict after worker emergence. | [E5](https://pmc.ncbi.nlm.nih.gov/articles/PMC7419493/) | High for species organization; single-queen scenario intentionally narrower | One mated queen; separate founding and established initial conditions | Founding test; J
Environmental nest response (excluded calibration) | Formica podzolica | Temperature and natal elevation alter nest depth/complexity. | Plasticity and population adaptation. | [E6](https://www.nature.com/articles/s41598-021-02491-w) | Species boundary established; no L. niger parameter inferred | Not used to calibrate L. niger; temperature model explicitly provisional | No empirical replication claimed
Decentralized collective behaviour | Multiple species (review) | Local interactions and environmental context shape collective dynamics. | Encounter-based feedback rather than global worker counts. | [E7](https://doi.org/10.1146/annurev-ento-011118-111923) | General principle only; not species-specific calibration | Simulation.sense/updateWorker; no allocate/quotas | D, H; hidden-information test
Development and reserve-funded founding | Lasius niger (Oulu population) | Queen reserves support founding and adult workers emerge over weeks. | Claustral provisioning, worker-mediated care after emergence. | [E8](https://pmc.ncbi.nlm.nih.gov/articles/PMC10087202/) | High for husbandry observations, low for our exact stage durations | Simulation.physiology/updateBrood/layEgg; queen reserve pools; DAY units | F,J; stage and founding tests
Development temperature/population variation | Lasius niger (Russian populations) | Thermal development responses vary among populations; low temperatures can induce larval diapause. | Population-specific thermal response norms. | [E9](https://doi.org/10.1023/B:JOEY.0000033808.45455.75) | Peer-reviewed finding, incomplete full-text access | species.developmentRate: explicitly unfitted bounded response | F sensitivity; no diapause validation
Corpse removal | Lasius niger | Workers remove conspecific corpses; response depends on time since death. | Local corpse cues, without globally dispatched cleaners. | [E10](https://dictionnaire-amoureux-des-fourmis.fr/Publications/1984-Ataya-Lenoir-IS.pdf) | High for necrophoresis; cue kinetics approximate | Simulation.sense corpseCueSeconds, carrier cleanup | Mortality/interruption invariants; local corpse tests
Trail quality and decay | Lasius niger | Richer sucrose sources elicited more marking; trail influence decays. | Quality-modulated deposited marks with exponential persistence. | [E11](https://citeseerx.ist.psu.edu/document?doi=7036c307b71634b825d0ca0cdb819ebd3532c0ad&repid=rep1&type=pdf) | High for laboratory measurements; surface-dependent calibration | World.decay; species trailHalfLifeSeconds; quality-modulated deposition | B,C; local non-diffusing decay test
L. niger environmental excavation data | Lasius niger | Surface temperature affects excavation depth and chamber placement. | Environmentally responsive nest modification; proximate individual rules unresolved. | [E12](https://dataverse.ird.fr/dataset.xhtml?persistentId=doi:10.23708/ZJTSDI&version=1.0) | Dataset metadata inspected, raw data restricted | Depth metric and temperature sensitivity hooks; no empirical morphology fit | G; external comparison pending authorized data access

## How evidence was used

Full methods/results were inspected where accessible for E1–E5, E8, E10 and E11. E6, E7 and E9 have limited access, explicitly recorded above. E12 raw files are restricted. No restricted data were fabricated or bypassed. Species and experimental conditions are retained in the matrix. See the structured entries for measurements; numerical source findings are not reprinted here.

A biological observation and its explanation are different. The route-confidence interpretation, difference-driven crop transfers, age bias, excavation selection and thermal response are candidate mechanisms. The experiments can falsify their effects. They are not established anatomical reconstructions.

## Units and numerical model

One step is one biological second; default geometry is 2 mm per cell. The browser FixedClock accumulates biological seconds independently of render frames. Playback factors change the number of identical updates, retaining catch-up debt. A 3600× selection may run slower than requested on slow devices. It never changes development parameters. Subsecond steps are accepted for diagnostics but are not promised to produce identical trajectories; the supported replay resolution is one second.

Nutrient pools C and P are µg substrate-equivalent carbohydrate and processed protein. They are not elemental masses, ATP or a validated dietary conversion. Imports = live crops + reserve + structural/brood biomass + corpses + external food + metabolized/exported equivalent. Metabolism is an explicit sink. Corpse disposal remains in the ledger. Soil cells removed = carried soil + deposited soil, with one unresolved cell-equivalent load per excavation.

Water is an ad-libitum boundary, not an untracked hydration bar. Moisture is an imposed dimensionless soil condition, temperature is °C, and deposited trail is in relative activity units. There is no oxygen, ventilation or fictitious concentration field.

## Decisions and test boundaries

Workers sense current and cardinal-neighbour cells; unseen source locations never enter worker decisions. Loop-erased odometry approximates personal navigation. A worker may return over its own observed path; it receives no global shortest path. Individual crop state, age tendency, local brood and local peers affect actions. Aggregate counts exist only for observation.

Default resources are finite laboratory provisioning, with no spontaneous regrowth. Protein represents an already processed soluble fraction; insect dismemberment and transport of solid prey remain absent. Food actually crosses source/ant, ant/ant, queen/egg and adult/larva boundaries. Nursing and brood relocation require spatial contact.

The nest starts from a stated initial cavity. Expansion removes adjacent soil, transports a load and deposits outside without a planned room list. This tests local construction and mass accounting, but the excavation selection law is explicitly a hypothesis. It does not reproduce the mound-deposition study.

Brood stages use days, with larval development contingent on acquired nutrients. A mated queen converts her own crop/reserves into eggs and tends first larvae. Exact fecundity, stage durations, larval nutrition budgets, ageing and thermal injury are not fitted. The queen does not debit remote colony inventory. No sexuals or unfertilized-egg pathway is claimed.

## Validation standard

[Experiments](../validation/experiments.json) distinguish full spatial trials from isolated physiology assays. A–J are runnable protocols, not ten claims of empirical agreement. See [limitations](limitations.md), [species parameters](species-profile.md), [baseline audit](audit.md), and [results](../validation/results.md). Stronger validation requires matching apparatus, colony demography, deprivation, temperatures and observational definitions, then fitting on training data and testing held-out empirical distributions.
