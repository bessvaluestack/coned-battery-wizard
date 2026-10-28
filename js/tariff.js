// Con Edison delivery tariff (SC 2 / 8 / 9) -> per-interval delivery energy
// rate + demand charges, and the closed-form bill for a fixed import profile.
// Ported from the reference engine's app/tariffs/engine.py (seasons/TOU form
// only - that is what the compiled Con Edison schedules use).
//
// A demand charge bills rate x max(import kW over the intervals in its window)
// per period: the month (the default), the day (standby as-used daily demand,
// $/kW-day) or the year (standby contract demand: one kW for the whole year,
// billed every month). The demand interval (15 or 30 minutes) is a billing
// convention: with 30 minutes the determinant is the max of half-hour
// averages of the 15-minute profile.

import { buildIndex, dayMask, hourMask, andMasks, windowMask } from './timeidx.js';

export function buildTariffArrays(tariff, opts = {}) {
  const idx = buildIndex();
  const T = idx.T;
  const energyRate = new Float64Array(T).fill(NaN);
  for (const season of tariff.energy.seasons) {
    const sMask = windowMask(idx, { months: season.months });
    // specific windows first, then the catch-all (hours: null)
    const specific = season.tou.filter((w) => w.hours != null);
    const catchAll = season.tou.filter((w) => w.hours == null);
    for (const w of specific) {
      const m = andMasks(sMask, dayMask(idx, w.days || 'all'), hourMask(idx, w.hours));
      for (let t = 0; t < T; t++) if (m[t] && Number.isNaN(energyRate[t])) energyRate[t] = +w.rate;
    }
    for (const w of catchAll) {
      const m = andMasks(sMask, dayMask(idx, w.days || 'all'));
      for (let t = 0; t < T; t++) if (m[t] && Number.isNaN(energyRate[t])) energyRate[t] = +w.rate;
    }
  }
  let gaps = 0;
  for (let t = 0; t < T; t++) if (Number.isNaN(energyRate[t])) gaps++;
  if (gaps) throw new Error(`Tariff ${tariff.id}: ${gaps} intervals have no energy rate`);

  const demandCharges = [];
  for (const c of (tariff.demand && tariff.demand.charges) || []) {
    demandCharges.push(makeCharge(idx, {
      name: c.name, rate: +c.rate, months: c.months || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      days: c.days || 'all', hours: c.hours || null, group: 'delivery_demand',
      determinant: c.determinant, period: c.period,
    }));
  }
  for (const c of opts.extraDemandCharges || []) demandCharges.push(makeCharge(idx, c));

  return {
    tariffId: tariff.id,
    name: tariff.name,
    energyRate,
    demandCharges,
    fixedAnnual: (+tariff.fixed_charge_per_month || 0) * 12,
    monthIndex: idx.month,
    idx,
  };
}

// A demand charge with an explicit day/hour mask (month handled per billing
// month), or an explicit interval mask (`mask`, e.g. the likely system-peak
// hours an ICAP tag is measured in) with its own `windowKey`. `monthRates`
// (12 values, January first) bills each month at its own rate; `rate` is
// then their average, for display.
export function makeCharge(idx, c) {
  const monthRates = c.monthRates ? c.monthRates.map(Number) : null;
  return {
    name: c.name, rate: monthRates ? monthRates.reduce((a, r) => a + r, 0) / 12 : +c.rate, monthRates,
    months: c.months || [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    days: c.days || 'all', hours: c.hours || null,
    mask: c.mask || andMasks(dayMask(idx, c.days || 'all'), hourMask(idx, c.hours || null)),
    group: c.group || 'other_demand', determinant: c.determinant || null,
    period: c.period || 'month',
    windowKey: c.windowKey || `${c.days || 'all'}|${c.hours ? c.hours.join('-') : 'all'}`,
  };
}

// One group per billed peak: { charge, key, month (first billed month), idx
// (Int32Array of eligible interval positions), alloc: [[month, $/kW], ...] }.
// A monthly charge gives one group per month, a daily one a group per day, a
// yearly one a single group billed in each of its months.
export function peakGroups(charges, idx) {
  const out = [];
  for (const ch of charges) {
    const wk = `${ch.period}|${ch.windowKey}`;
    const rateIn = (m) => (ch.monthRates ? ch.monthRates[m - 1] : ch.rate);
    if (ch.period === 'year') {
      const pos = [];
      for (const m of ch.months) for (let t = idx.monthStart[m - 1]; t < idx.monthStart[m]; t++) if (ch.mask[t]) pos.push(t);
      if (pos.length) out.push({ charge: ch, key: `y|${wk}`, month: ch.months[0], idx: Int32Array.from(pos), alloc: ch.months.map((m) => [m, rateIn(m)]) });
      continue;
    }
    for (const m of ch.months) {
      const a = idx.monthStart[m - 1], b = idx.monthStart[m];
      if (ch.period === 'day') {
        let day = -1, pos = [];
        const flush = () => { if (pos.length) out.push({ charge: ch, key: `d${day}|${wk}`, month: m, day, idx: Int32Array.from(pos), alloc: [[m, rateIn(m)]] }); pos = []; };
        for (let t = a; t < b; t++) {
          if (idx.doy[t] !== day) { flush(); day = idx.doy[t]; }
          if (ch.mask[t]) pos.push(t);
        }
        flush();
        continue;
      }
      const pos = [];
      for (let t = a; t < b; t++) if (ch.mask[t]) pos.push(t);
      if (pos.length) out.push({ charge: ch, key: `m${m}|${wk}`, month: m, idx: Int32Array.from(pos), alloc: [[m, rateIn(m)]] });
    }
  }
  for (const g of out) g.rate = g.alloc.reduce((a, [, r]) => a + r, 0);
  return out;
}
export const monthlyPeakGroups = peakGroups;

// Billing demand over a set of interval positions. 30-minute billing takes
// the max of half-hour averages (pairs aligned to :00 / :30).
export function peakOf(importKw, pos, demandIntervalMin) {
  let peak = 0;
  if (demandIntervalMin === 30) {
    for (let i = 0; i < pos.length; i++) {
      const t = pos[i];
      if (t % 2 !== 0) continue;
      const v = 0.5 * (importKw[t] + importKw[t + 1]);
      if (v > peak) peak = v;
    }
  } else {
    for (let i = 0; i < pos.length; i++) { const v = importKw[pos[i]]; if (v > peak) peak = v; }
  }
  return peak;
}

// Closed-form bill for a fixed import profile. `energyRate` is the total
// $/kWh series applied to imports (delivery + adjustments + supply), the
// charges are delivery demand + adjustment demand + supply capacity.
export function billFromProfile({ energyRate, charges, fixedAnnual, idx, importKw, dt, demandIntervalMin }) {
  let energy = 0;
  for (let t = 0; t < idx.T; t++) energy += energyRate[t] * importKw[t];
  energy *= dt;
  const peaks = [];
  const byGroup = {};
  let demand = 0;
  for (const g of peakGroups(charges, idx)) {
    const pk = peakOf(importKw, g.idx, demandIntervalMin);
    for (const [month, rate] of g.alloc) {
      const cost = rate * pk;
      demand += cost;
      byGroup[g.charge.group] = (byGroup[g.charge.group] || 0) + cost;
      peaks.push({ charge: g.charge.name, group: g.charge.group, month, day: g.day, period: g.charge.period, peakKw: pk, rate, cost });
    }
  }
  return { energy, demand, demandByGroup: byGroup, fixed: fixedAnnual, peaks, subtotal: energy + demand + fixedAnnual };
}

// Split an energy series bill into named components for reporting.
export function energyComponents(importKw, dt, components) {
  // components: [{name, rate: Float64Array|number}]
  const out = {};
  for (const c of components) {
    let s = 0;
    if (typeof c.rate === 'number') { for (let t = 0; t < importKw.length; t++) s += importKw[t]; s *= c.rate; }
    else { for (let t = 0; t < importKw.length; t++) s += c.rate[t] * importKw[t]; }
    out[c.name] = s * dt;
  }
  return out;
}

export function monthlyEnergyKwh(kw, idx, dt) {
  const out = new Array(12).fill(0);
  for (let t = 0; t < idx.T; t++) out[idx.month[t] - 1] += kw[t];
  return out.map((v) => v * dt);
}

export function monthlyPeakKw(kw, idx, demandIntervalMin) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const pos = [];
    for (let t = idx.monthStart[m - 1]; t < idx.monthStart[m]; t++) pos.push(t);
    out.push(peakOf(kw, pos, demandIntervalMin));
  }
  return out;
}
