// Evidence IDs resolve to docs/biology/evidence.json. Unfitted values are assumptions.
export const DAY = 86400;
export const LASIUS_NIGER = Object.freeze({
  id: 'lasius-niger',
  name: 'Lasius niger',
  reproduction: 'single mated queen; claustral founding',
  cellMM: 2,
  stepSeconds: 1, // spatial and numerical resolutions, not measured traits
  walkMMPerSecond: 1,
  cropC: 120,
  cropP: 30,
  uptakePerSecond: 2,
  transferPerSecond: 1,
  contactSeconds: 6,
  metabolismCPerDay: 18,
  queenMetabolismCPerDay: 30,
  eggDays: 17,
  larvaDays: 14,
  pupaDays: 21,
  eggC: 2,
  eggP: 2,
  larvalTargetC: 12,
  larvalTargetP: 12,
  eggIntervalDays: 1,
  foundingDelayDays: 3,
  workerLifeDays: 365,
  trailHalfLifeSeconds: 47 * 60 * Math.LN2,
  trailDeposit: 0.5,
  trailGain: 4,
  memoryEnabled: true,
  trailsEnabled: true,
  memorySynergy: 1.25,
  temperatureC: 23,
  soilMoisture: 0.6,
  soilHardness: 1,
  diggingSeconds: 600,
  corpseCueSeconds: 7200,
  provenance: {
    foraging: 'E1',
    transfer: 'E2',
    crowding: 'E3',
    founding: 'E5',
    development: 'E8',
    digging: 'E4',
    hygiene: 'E10',
  },
});
export function parameters(overrides = {}) {
  const p = { ...LASIUS_NIGER, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in LASIUS_NIGER)) throw new RangeError(`Unknown parameter: ${key}`);
    const original = LASIUS_NIGER[key];
    if (
      typeof original === 'number' &&
      (!Number.isFinite(value) ||
        (key === 'temperatureC'
          ? value < -50 || value > 60
          : key === 'soilMoisture'
            ? value < 0 || value > 1
            : value <= 0))
    )
      throw new RangeError(`Invalid parameter: ${key}`);
    if (typeof original === 'boolean' && typeof value !== 'boolean')
      throw new RangeError(`Invalid parameter: ${key}`);
  }
  if (p.soilMoisture > 1) throw new RangeError('Soil moisture is a fraction.');
  return p;
}
// Qualitative temperature response only; no fitted thermal performance curve.
export function developmentRate(temperatureC) {
  return temperatureC <= 17 || temperatureC >= 35
    ? 0
    : Math.min(1.5, Math.max(0, (temperatureC - 12) / 11));
}
