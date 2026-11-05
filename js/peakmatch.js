// Peak matching efficiency: the share of the perfect-foresight demand savings
// a controller working from a day-ahead load forecast can expect to keep,
// month by month. The year's dispatch is optimised knowing every interval of
// load in advance; a real controller has to choose each day how far down it
// can hold the building's demand from a forecast that is off by a few
// percent, and a demand charge is set by the single worst interval of the
// month, so one bad day sets the bill.
//
// The test, for every month:
//   1. Each day, the lowest demand the battery could hold all day, day after
//      day, recharging below that line ("holdable"), is found for the day's
//      actual load and for the same load scaled up and down.
//   2. In each of many simulated forecast years (seeded, so a run repeats),
//      every day gets a forecast error drawn from a normal distribution
//      (`forecastError`, one standard deviation of the day's load). The
//      controller aims at the line it believes it can hold, never below the
//      month's peak so far. A forecast too high makes it stop short; one too
//      low makes it shave too deep early, run short, and let the peak through
//      about as far above the line as it aimed below it.
//   3. The month's expected peak is the average over the forecast years. The
//      efficiency is the expected peak reduction over the reduction with a
//      perfect forecast. The more days in the month that need the battery's
//      full energy, the more chances one of them goes wrong, and the lower it
//      is.
import { DT_HOURS, STEPS_PER_HOUR } from './timeidx.js';

export const FORECAST_ERROR = 0.05;
export const DRAWS = 400;
const STEPS_PER_DAY = 24 * STEPS_PER_HOUR;
const SPREAD = 4; // the forecast grid spans +-4 standard deviations
const GRID = 33;
const ITER = 22;

// Can the battery hold demand at `theta` over one day of load x c, day after
// day? It starts full and runs the day twice, the second time from where the
// first left it, and must end the second with no less than it began it: a
// line it can only hold by running down, without recharging, fails.
function canHold(load, a, c, theta, kw, usable, etaC, etaD) {
  let soc = usable, start = usable;
  for (let pass = 0; pass < 2; pass++) {
    start = soc;
    for (let t = a; t < a + STEPS_PER_DAY; t++) {
      const x = c * load[t];
      if (x > theta) {
        soc -= ((x - theta) * DT_HOURS) / etaD;
        if (soc < -1e-9) return false;
      } else {
        soc = Math.min(usable, soc + Math.min(kw, theta - x) * DT_HOURS * etaC);
      }
    }
  }
  return soc >= start - 1e-6;
}

// The lowest demand the battery can hold over the day (load scaled by c).
function holdable(load, a, c, kw, usable, etaC, etaD, maxKw) {
  let lo = Math.max(0, c * maxKw - kw), hi = c * maxKw;
  if (canHold(load, a, c, lo, kw, usable, etaC, etaD)) return lo;
  for (let i = 0; i < ITER; i++) {
    const mid = (lo + hi) / 2;
    if (canHold(load, a, c, mid, kw, usable, etaC, etaD)) hi = mid; else lo = mid;
  }
  return hi;
}

// A small seeded generator (mulberry32) and standard normal draws from it.
function normals(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let spare = null;
  return () => {
    if (spare !== null) { const z = spare; spare = null; return z; }
    const r = Math.sqrt(-2 * Math.log(1 - u())), th = 2 * Math.PI * u();
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

/**
 * Peak matching efficiency by month.
 * @param idx      the model-year index (monthStart)
 * @param load     the building's load, kW per 15 minutes
 * @param battery  { kw, kwh, rte, usableFrac }
 * @returns { forecastError, draws, months: [{ efficiency, peakBase, peakPerfect, peakExpected, shaveDays }] }
 *          peakPerfect is the lowest monthly peak a battery holding a line can
 *          reach with a perfect forecast; the efficiency is a ratio to it, so it
 *          can be applied to the optimised dispatch's demand savings.
 */
export function peakMatching({ idx, load, battery, forecastError = FORECAST_ERROR, draws = DRAWS, seed = 20271 }) {
  const kw = battery.kw, usable = battery.kwh * battery.usableFrac, eta = Math.sqrt(battery.rte);
  const sd = Math.max(0, forecastError);
  const days = Math.floor(idx.T / STEPS_PER_DAY);
  const maxKw = new Float64Array(days), hold = new Float64Array(days), grid = new Float64Array(days * GRID);
  const scale = (k) => 1 + sd * SPREAD * (2 * k / (GRID - 1) - 1);
  for (let d = 0; d < days; d++) {
    const a = d * STEPS_PER_DAY;
    let mx = 0; for (let t = a; t < a + STEPS_PER_DAY; t++) if (load[t] > mx) mx = load[t];
    maxKw[d] = mx;
    if (kw <= 0 || usable <= 0) { hold[d] = mx; continue; }
    hold[d] = holdable(load, a, 1, kw, usable, eta, eta, mx);
    if (sd > 0) for (let k = 0; k < GRID; k++) grid[d * GRID + k] = holdable(load, a, scale(k), kw, usable, eta, eta, mx);
  }
  // What the controller believes it can hold on day d when its forecast is the load x (1 + e).
  const believed = (d, e) => {
    const x = Math.min(GRID - 1, Math.max(0, ((e / (sd * SPREAD)) + 1) * (GRID - 1) / 2));
    const k = Math.min(GRID - 2, Math.floor(x)), f = x - k;
    return grid[d * GRID + k] * (1 - f) + grid[d * GRID + k + 1] * f;
  };
  const z = normals(seed);
  const months = [];
  for (let m = 0; m < 12; m++) {
    const d0 = Math.round(idx.monthStart[m] / STEPS_PER_DAY), d1 = Math.round(idx.monthStart[m + 1] / STEPS_PER_DAY);
    let peakBase = 0, peakPerfect = 0;
    for (let d = d0; d < d1; d++) { peakBase = Math.max(peakBase, maxKw[d]); peakPerfect = Math.max(peakPerfect, hold[d]); }
    let shaveDays = 0;
    for (let d = d0; d < d1; d++) if (maxKw[d] > peakPerfect + 1e-6) shaveDays++;
    const reduction = peakBase - peakPerfect;
    let peakExpected = peakPerfect;
    if (sd > 0 && reduction > 1e-6) {
      let sum = 0;
      for (let s = 0; s < draws; s++) {
        let peak = 0;
        for (let d = d0; d < d1; d++) {
          const aim = Math.max(peak, believed(d, sd * z()));
          const day = aim >= hold[d] ? aim : 2 * hold[d] - aim;
          peak = Math.max(peak, Math.min(maxKw[d], day));
        }
        sum += peak;
      }
      peakExpected = sum / draws;
    }
    const efficiency = reduction > 1e-6 ? Math.min(1, Math.max(0, (peakBase - peakExpected) / reduction)) : 1;
    months.push({ efficiency, peakBase, peakPerfect, peakExpected, shaveDays });
  }
  return { forecastError: sd, draws, months };
}

// The efficiency a run's pro-forma applies. None to apply (100%) for a
// stand-alone battery, which has no building load to shave, or for demand
// response only, where the battery discharges in the program events alone.
export function peakMatchFor({ stack, load, battery, forecastError = FORECAST_ERROR }) {
  if (stack.modality === 'ftm') return { applies: false, reason: 'ftm', forecastError, draws: 0, months: null };
  if (stack.drOnly) return { applies: false, reason: 'dr_only', forecastError, draws: 0, months: null };
  return { applies: true, reason: null, ...peakMatching({ idx: stack.idx, load, battery, forecastError }) };
}
