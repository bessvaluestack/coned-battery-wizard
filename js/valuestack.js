// Rider R Value Stack (Phase Two) credits for a battery's net injections:
// a stand-alone battery (Rider R A.9(d), with SC 11) in front of or behind
// the meter. Storage gets the energy component, capacity under Alternative 3
// only, the DRV and, where MW remain, the LSRV; not the environmental
// component, the MTC or the Community Credit.
//
//   energy  day-ahead zonal LBMP x the loss factor, on each hour's net injection
//   alt3    the month's $/kW x the loss factor x the net injection during the
//           previous year's NYCA peak hour (a July or August non-holiday
//           weekday), paid all 12 months. The hour is not known in advance, so
//           the battery commits a kW it holds over a band of likely peak hours
//           on the top-priced days, and Alternative 3 is paid on that kW.
//   drv     $/kWh on net injection inside the network's 4-hour CSRP call window,
//           non-holiday weekdays June 24 - September 15 (fixed for 10 years)
//   lsrv    $/kW-year / 10 per event x the lowest net injection in the event,
//           at least 10 events a year, only where the location has MW left
//
// Enrolling in Rider T gives up DRV and LSRV for good; Rider AC suspends
// them for the contract term (see programs.js for the election).

import { buildIndex, STEPS_PER_HOUR } from './timeidx.js';
import { hourlyToIntervals } from './supply.js';

export const ELECTIONS = {
  value_stack: 'Keep the Value Stack DRV (and LSRV)',
  rider_t: 'Rider T: CSRP and / or DLRP instead (gives up DRV and LSRV for good)',
  rider_ac: 'Rider AC: Term-DLM or Auto-DLM instead (DRV and LSRV suspended for the contract)',
};

const md = (s) => { const [m, d] = s.split('-').map(Number); return m * 100 + d; };

// Interval positions of the DRV window: the network's call window hours on
// non-holiday weekdays inside the date range.
export function drvIntervals(vs, hours) {
  const idx = buildIndex();
  const [a, b] = vs.drv.date_range.map(md);
  const out = [];
  for (let t = 0; t < idx.T; t++) {
    const d = idx.month[t] * 100 + idx.day[t];
    if (d < a || d > b || idx.dow[t] >= 5 || idx.holiday[t]) continue;
    if (idx.hour[t] >= hours[0] && idx.hour[t] < hours[1]) out.push(t);
  }
  return Int32Array.from(out);
}

// The n top-priced non-holiday weekdays (mean LBMP over `hours`) among
// `months` / the date range, as { day, doy, intervals }.
export function topDays(lbmp15, { months, dateRange, hours, n }) {
  const idx = buildIndex();
  const [a, b] = dateRange ? dateRange.map(md) : [0, 9999];
  const byDay = new Map();
  for (let t = 0; t < idx.T; t++) {
    const d = idx.month[t] * 100 + idx.day[t];
    if ((months && !months.includes(idx.month[t])) || d < a || d > b || idx.dow[t] >= 5 || idx.holiday[t]) continue;
    if (idx.hour[t] < hours[0] || idx.hour[t] >= hours[1]) continue;
    if (!byDay.has(idx.doy[t])) byDay.set(idx.doy[t], []);
    byDay.get(idx.doy[t]).push(t);
  }
  const days = [...byDay.entries()].map(([doy, pos]) => {
    let s = 0; for (const t of pos) s += lbmp15[t];
    return { doy, day: `${idx.month[pos[0]]}/${idx.day[pos[0]]}`, intervals: Int32Array.from(pos), price: s / pos.length };
  });
  days.sort((x, y) => (y.price - x.price) || (x.doy - y.doy));
  return days.slice(0, Math.max(0, n)).sort((x, y) => x.doy - y.doy);
}

/**
 * @param cfg  { election: 'value_stack'|'rider_t'|'rider_ac', network, lsrv: bool, lsrvEvents,
 *               alt3: { hours: [h0, h1], days: n, rate: override $/kW-month or null } }
 * @param data { valueStack (value_stack.json), lbmp: {J,H,I} }
 * @returns    { energyPrice: Float64Array $/kWh, drv: {rate, hours, intervals} | null,
 *               alt3: { monthly: [12] $/kW-month incl. losses, annualRate, intervals, days, hours },
 *               lsrv: { perEvent, events: [{day, intervals}] } | null, lossFactor, notes, blocked }
 */
export function buildValueStack(cfg, data, { region, zone }) {
  const vs = data.valueStack;
  const out = { notes: [], blocked: [], election: cfg.election || 'value_stack', lossFactor: vs.loss_factor };
  const lf = vs.loss_factor;
  const lbmp15 = hourlyToIntervals(data.lbmp[zone].hourly);
  out.energyPrice = Float64Array.from(lbmp15, (p) => (p / 1000) * lf);

  // Alternative 3: the statement's $/kW for each calendar month (or one
  // override), with losses; the commitment band on the top-priced days.
  const reg = region === 'westchester' ? 'westchester' : 'nyc';
  const override = cfg.alt3 && cfg.alt3.rate !== null && cfg.alt3.rate !== '' && cfg.alt3.rate !== undefined ? +cfg.alt3.rate : null;
  const monthly = Array.from({ length: 12 }, (_, m) => (override !== null ? override : vs.alt3.by_month[String(m + 1)][reg]) * lf);
  const hours = (cfg.alt3 && cfg.alt3.hours) || [15, 18];
  const nDays = cfg.alt3 && cfg.alt3.days !== undefined ? +cfg.alt3.days : 10;
  const days = topDays(lbmp15, { months: [7, 8], hours, n: nDays });
  const pos = []; for (const d of days) pos.push(...d.intervals);
  out.alt3 = { monthly, annualRate: monthly.reduce((a, v) => a + v, 0), intervals: Int32Array.from(pos), days, hours };
  if (!days.length) out.notes.push('Alternative 3: no commitment days, so no capacity credit.');

  // DRV and LSRV need the network (its CSRP call window) and stay only
  // while the battery is not in Rider T or Rider AC.
  out.drv = null; out.lsrv = null;
  const win = cfg.network ? vs.drv.window_by_network[cfg.network] : null;
  if (!win) { out.blocked.push('Pick the site\'s distribution network: the DRV pays in its CSRP call window.'); return out; }
  out.window = win;
  if (out.election !== 'value_stack') {
    out.notes.push(out.election === 'rider_t'
      ? 'Rider T enrolment ends the DRV and LSRV for the rest of the 25-year Value Stack term.'
      : 'Rider AC suspends the DRV and LSRV for the contract term; they resume after it.');
    return out;
  }
  out.drv = { rate: vs.drv.rate, hours: win, intervals: drvIntervals(vs, win) };
  if (cfg.lsrv) {
    const n = Math.max(vs.lsrv.min_events, +cfg.lsrvEvents || vs.lsrv.min_events);
    const evHours = [win[0], Math.min(win[1], win[0] + vs.lsrv.max_event_hours)];
    const events = topDays(lbmp15, { dateRange: vs.lsrv.date_range, hours: evHours, n });
    out.lsrv = { perEvent: vs.lsrv.rate / n, annualRate: vs.lsrv.rate, events, hours: evHours };
    out.notes.push(`LSRV: ${events.length} events of ${evHours[1] - evHours[0]} hours on the top-priced weekdays, each paying ${(vs.lsrv.rate / n).toFixed(2)} $/kW on the lowest net injection in the event.`);
  }
  return out;
}

// Hourly net injection (kW, positive = export) from a 15-minute import and
// export pair: Con Edison credits net hourly injections.
export function hourlyNet(imp, exp) {
  const H = imp.length / STEPS_PER_HOUR, out = new Float64Array(H);
  for (let h = 0; h < H; h++) {
    let s = 0;
    for (let k = 0; k < STEPS_PER_HOUR; k++) { const t = h * STEPS_PER_HOUR + k; s += (exp ? exp[t] : 0) - imp[t]; }
    out[h] = s / STEPS_PER_HOUR;
  }
  return out;
}

// The credits a dispatch earns: energy and DRV on each hour's positive net
// injection, Alternative 3 on the lowest net injection over the commitment
// hours, LSRV on the lowest per event. By month, for the results and the
// pro-forma.
export function valueStackCredits(vs, imp, exp) {
  const idx = buildIndex();
  const net = hourlyNet(imp, exp);
  const energy = new Array(12).fill(0), drv = new Array(12).fill(0), alt3 = new Array(12).fill(0), lsrv = new Array(12).fill(0);
  const inDrv = new Uint8Array(net.length);
  if (vs.drv) for (const t of vs.drv.intervals) inDrv[Math.floor(t / STEPS_PER_HOUR)] = 1;
  let exportKwh = 0;
  for (let h = 0; h < net.length; h++) {
    if (net[h] <= 0) continue;
    const t = h * STEPS_PER_HOUR, m = idx.month[t] - 1;
    exportKwh += net[h];
    energy[m] += net[h] * vs.energyPrice[t];
    if (inDrv[h]) drv[m] += net[h] * vs.drv.rate;
  }
  const minOver = (pos) => { let v = Infinity; const seen = new Set(); for (const t of pos) { const h = Math.floor(t / STEPS_PER_HOUR); if (!seen.has(h)) { seen.add(h); v = Math.min(v, net[h]); } } return pos.length ? Math.max(0, v) : 0; };
  const alt3Kw = minOver(vs.alt3.intervals);
  for (let m = 0; m < 12; m++) alt3[m] = alt3Kw * vs.alt3.monthly[m];
  const lsrvKw = [];
  if (vs.lsrv) for (const e of vs.lsrv.events) {
    const kw = minOver(e.intervals); lsrvKw.push(kw);
    lsrv[idx.month[e.intervals[0]] - 1] += kw * vs.lsrv.perEvent;
  }
  const sum = (a) => a.reduce((x, v) => x + v, 0);
  return {
    energy, drv, alt3, lsrv, alt3Kw, lsrvKw, exportKwh,
    totals: { energy: sum(energy), drv: sum(drv), alt3: sum(alt3), lsrv: sum(lsrv) },
    total: sum(energy) + sum(drv) + sum(alt3) + sum(lsrv),
  };
}
