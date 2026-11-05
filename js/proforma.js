// The owner pro-forma (templates/proforma.xlsx, built by
// scripts/make_proforma_template.mjs from the owner's financial model) filled
// from a run. The wizard writes the Wizard_Import sheet only (project,
// battery, the monthly bill and its determinants, program revenue by program,
// Value Stack credits, the capacity curve, the saved version and its links,
// the peak matching efficiency, the tariff calendar and the year hour by
// hour; see js/wizardsheet.js), which the model's battery, savings, rate,
// hourly and degradation cells link to. The installed cost, when one was
// entered, goes on the model's capital lines. O&M, finance and resiliency
// stay as the template has them for the user to set.
import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate/fflate.mjs';
import { setCells, setCellsBulk, sheetPaths } from './xlsx.js';
import { STEPS_PER_HOUR } from './timeidx.js';
import { monthlyBillChange, programsByMonth } from './model.js';
import { sheetCells, savedBlockCells, DEMAND_ROWS, MONTHS, WIZ_SHEET } from './wizardsheet.js';

export const TEMPLATE_URL = new URL('../templates/proforma.xlsx', import.meta.url);
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// The model's capital lines (Inputs), first to last.
export const CAPITAL_CELLS = ['C34', 'C35', 'C36', 'C37', 'C38', 'C39', 'C40'];
const CAPITAL_NOTE = 'E34';
const PERIOD = { month: 'monthly', day: 'daily (as-used)', year: 'contract demand' };
const SUMMER = [6, 7, 8, 9]; // Con Edison's summer rates: June to September

// The account's seasons and time-of-day periods, in the shape of the model's
// Utility_Rates: a season per month, and per hour starting a period for
// summer and winter weekdays and weekends. An hour inside every time-of-day
// window of the season (demand charges and any energy windows) is Peak,
// inside some Shoulder, outside them all Off-peak.
export function tariffCalendar(tariff) {
  const charges = (tariff.demand && tariff.demand.charges) || [];
  const named = charges.find((c) => /^summer/.test(c.name || '') && c.months);
  const summer = named ? named.months : SUMMER;
  const season = MONTHS.map((month, m) => ({ month, season: summer.includes(m + 1) ? 'Summer' : 'Winter' }));
  const windows = new Map();
  const add = (w, months) => { if (w.hours) windows.set(`${(months || []).join(',')}|${w.days || 'all'}|${w.hours.join('-')}`, { months: months || MONTHS.map((_, i) => i + 1), days: w.days || 'all', hours: w.hours }); };
  for (const s of (tariff.energy && tariff.energy.seasons) || []) for (const w of s.tou || []) add(w, s.months);
  for (const c of charges) add(c, c.months);
  const inHours = ([a, b], h) => (a <= b ? h >= a && h < b : h >= a || h < b);
  const onDay = (days, weekday) => days === 'all' || (weekday ? days === 'weekdays' : days === 'weekends');
  const month = { summer: summer.includes(7) ? 7 : summer[0], winter: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].find((m) => !summer.includes(m)) };
  const periods = (which, weekday) => {
    const ws = [...windows.values()].filter((w) => w.months.includes(month[which]) && onDay(w.days, weekday));
    const n = Array.from({ length: 24 }, (_, h) => ws.filter((w) => inHours(w.hours, h)).length);
    const top = Math.max(0, ...n);
    return n.map((k) => (k === 0 ? 'Off-peak' : k === top ? 'Peak' : 'Shoulder'));
  };
  const sw = periods('summer', true), se = periods('summer', false), ww = periods('winter', true), we = periods('winter', false);
  const tou = Array.from({ length: 24 }, (_, h) => ({ hour: h, summerWeekday: sw[h], summerWeekend: se[h], winterWeekday: ww[h], winterWeekend: we[h] }));
  return { season, tou };
}

const NO_PEAK_MATCH = {
  ftm: 'Nothing to derate: a stand-alone battery has no building load to shave (100%)',
  dr_only: 'Nothing to derate: demand response only, the battery discharges in program events alone (100%)',
};

/**
 * Everything the workbook needs from a run.
 * @param run  { stack, load (kW, 15-min), sol, summary, revenue, battery, baseline / withB (bills),
 *               credits (valueStackCredits) for the Value Stack, baseStack (the bill without the battery) }
 * @param opts { project: { id, name, config, run, version, ratesDate, modality, rate, area, supply, dr, load },
 *               programMonths: { csrp: [5..9], ... }, monthlyBills: [12] | null, installedCost ($), election,
 *               curve (capacityCurve) | null, saved: { rev, link, projectLink, savedAt, savedBy } | null,
 *               peakMatch (peakMatchFor) | null, hosted (the hosted edition: it keeps the saved-analysis block) }
 */
export function proformaData(run, opts = {}) {
  const { stack, load, sol, summary, revenue, battery, credits = null, baseline: B, withB: W } = run;
  const baseStack = run.baseStack || stack;
  const { programMonths = {}, monthlyBills = null, installedCost = 0, curve = null, saved = null, peakMatch = null, hosted = false } = opts;
  const idx = stack.idx, tf = stack.taxFactor, hours = idx.T / STEPS_PER_HOUR;
  const vs = stack.valueStack;
  const inDrv = new Uint8Array(hours);
  if (vs && vs.drv) for (const t of vs.drv.intervals) inDrv[Math.floor(t / STEPS_PER_HOUR)] = 1;

  // Hourly averages. kW go in at 0.1 W so that baseline minus dispatch (the
  // workbook's net grid demand) is exactly the hour's net import: never a
  // hair below zero without exports, and the hour's net injection with them
  // (Con Edison nets each hour). The export credit rate is the energy
  // component plus the DRV in the call window.
  const baseline = new Float64Array(hours), dispatch = new Float64Array(hours), rate = new Float64Array(hours);
  const exportRate = vs ? new Float64Array(hours) : null;
  for (let h = 0; h < hours; h++) {
    let b = 0, net = 0, p = 0;
    for (let k = 0; k < STEPS_PER_HOUR; k++) { const t = h * STEPS_PER_HOUR + k; b += load[t]; net += sol.imp[t] - (sol.exp ? sol.exp[t] : 0); p += stack.price[t]; }
    const bq = Math.round(Math.max(0, b / STEPS_PER_HOUR) * 1e4);
    const nq = Math.round((vs ? net / STEPS_PER_HOUR : Math.max(0, net / STEPS_PER_HOUR)) * 1e4);
    baseline[h] = bq / 1e4;
    dispatch[h] = (bq - nq) / 1e4;
    rate[h] = (p / STEPS_PER_HOUR) * tf; // every price component is constant within an hour
    if (vs) exportRate[h] = vs.energyPrice[h * STEPS_PER_HOUR] + (inDrv[h] ? vs.drv.rate : 0);
  }

  // The monthly bill, baseline and with the battery (see monthlyBillChange).
  const btf = baseStack.taxFactor;
  const { utility, kwhExport } = monthlyBillChange({ stack, baseStack, load, sol, baseline: B, withB: W, monthly: summary.monthly, monthlyBills });

  // Every demand determinant and rate, by charge and month.
  const demand = new Map();
  const addPeaks = (bill, side, factor) => {
    for (const p of bill.peaks) {
      const key = `${p.charge}|${p.period || 'month'}|${p.month}`;
      if (!demand.has(key)) demand.set(key, { charge: p.charge.replace(/_/g, ' '), period: PERIOD[p.period || 'month'], month: MONTHS[p.month - 1],
        rate: p.rate, rateUnit: p.period === 'day' ? '$/kW-day' : '$/kW-month', detUnit: p.period === 'day' ? 'kW-days (sum of daily peaks)' : 'kW', detBase: 0, detAfter: 0, costBase: 0, costAfter: 0 });
      const d = demand.get(key);
      d[side === 'base' ? 'detBase' : 'detAfter'] += p.peakKw; d[side === 'base' ? 'costBase' : 'costAfter'] += p.cost * factor;
    }
  };
  if (B.total !== 0) addPeaks(B, 'base', btf);
  addPeaks(W, 'after', tf);
  const demandRows = [...demand.values()].map((d) => ({ ...d, savings: d.costBase - d.costAfter }));
  if (demandRows.length > DEMAND_ROWS) demandRows.splice(DEMAND_ROWS - 1, Infinity, { charge: `(${demandRows.length - DEMAND_ROWS + 1} more rows: see the results JSON)` });
  const names = [...new Set([...Object.keys(B.energyComponents), ...Object.keys(W.energyComponents)])];
  const energy = names.map((n) => { const b = (B.energyComponents[n] || 0) * btf, a = (W.energyComponents[n] || 0) * tf; return { component: n, base: b, after: a, savings: b - a }; });

  const { programs, terms } = programsByMonth(revenue, programMonths);

  const vsRows = credits ? Array.from({ length: 12 }, (_, m) => ({ exportKwh: kwhExport[m], energy: credits.energy[m], drv: credits.drv[m], alt3: credits.alt3[m], lsrv: credits.lsrv[m], total: credits.energy[m] + credits.drv[m] + credits.alt3[m] + credits.lsrv[m] })) : null;

  // Peak matching: each month's efficiency applied to its demand savings.
  // Without one (none computed, a stand-alone battery, demand response only)
  // every month is 100%, so the model's derate leaves the savings whole.
  const pm = peakMatch && peakMatch.applies ? peakMatch : null;
  const peakMatchRows = utility.map((u, m) => {
    const e = pm ? pm.months[m].efficiency : 1, cut = u.peakBase - u.peakAfter;
    return { efficiency: e, shaveDays: pm ? pm.months[m].shaveDays : undefined, cutPerfect: cut, cutExpected: cut * e, demandSav: u.demandSav, demandExpected: u.demandSav * e };
  });
  const peakMatchFields = {
    forecastError: pm ? pm.forecastError : undefined,
    draws: pm ? pm.draws : undefined,
    basis: pm ? 'Demand savings, month by month (Value_Streams C links here)' : NO_PEAK_MATCH[peakMatch && peakMatch.reason] || 'Not computed for this run (100%)',
  };

  const sum = (a, k) => a.reduce((x, r) => x + (r[k] || 0), 0);
  const wizard = {
    project: { ...(opts.project || {}), utility: 'Con Edison', exports: !!vs, interval: stack.demandIntervalMin, tax: Math.round((tf - 1) * 1e6) / 1e6 },
    battery: { kw: battery.kw, kwh: battery.kwh, duration: battery.kw > 0 ? battery.kwh / battery.kw : 0, rte: battery.rte, usable: battery.usableFrac, cycles: battery.cyclesPerYear || 0,
      throughputCost: battery.throughputCost || 0, cyclesYear1: summary.cycles, dischargedMwh: summary.throughputKwh / 1000, installedCost: installedCost > 0 ? installedCost : undefined },
    summary: { baseline: B.total, withBattery: W.total, billSavings: summary.savingsBill, demandSavings: sum(utility, 'demandSav'), energySavings: sum(utility, 'energySav'), fixedChange: sum(utility, 'fixedChange'),
      programs: revenue.total, credits: summary.creditsTotal || 0, net: summary.savingsTotal, billOnly: summary.billOnlySavings === null || summary.billOnlySavings === undefined ? undefined : summary.billOnlySavings },
    utility, programs: revenue.streams.length ? programs : null, terms, vs: vsRows,
    vsFields: vs ? { election: opts.election, alt3Kw: credits ? credits.alt3Kw : 0, alt3Rate: vs.alt3.annualRate, drvWindow: vs.drv ? `${vs.drv.hours[0]}:00 to ${vs.drv.hours[1]}:00, non-holiday weekdays ${vs.drv.intervals.length ? 'June 24 to September 15' : ''}` : 'none (election)', lsrvEvents: vs.lsrv ? vs.lsrv.events.length : 0 } : null,
    demand: demandRows, energy,
    curve: curve ? curve.levels : null,
    saved,
    peakMatch: peakMatchRows, peakMatchFields,
    ...tariffCalendar(stack.tariff),
    hourly: { baseline, dispatch, rate, exportRate },
  };

  // The installed cost is all-in: it goes on the first capital line, the rest are zero.
  const inputs = {};
  if (installedCost > 0) {
    CAPITAL_CELLS.forEach((c, i) => { inputs[c] = i ? 0 : installedCost; });
    inputs[CAPITAL_NOTE] = 'All-in installed cost from the Con Edison Battery Wizard; the lines below are 0. Split it across them if you have a breakdown.';
  }
  return { inputs, wizard, hosted };
}

// The Wizard_Import values as { cell: value }: every value cell of the layout,
// blank where the run has nothing (labels, totals and the fixed hour columns
// stay as the template has them).
const FIXED = new Set(['title', 'note', 'head', 'colhead', 'label', 'hourN', 'hourT']);
export function wizardValues(wizard) {
  const out = {};
  for (const [cell, [value, fmt]] of Object.entries(sheetCells(wizard))) {
    if (FIXED.has(fmt) || (value && value.f)) continue;
    out[cell] = value === undefined ? null : value;
  }
  return out;
}

// Fill the template bytes with proformaData() and return the new workbook.
export function fillProforma(template, d) {
  const files = unzipSync(template);
  const path = sheetPaths(files);
  const edit = (name, fn) => { const p = path[name]; if (!p) throw new Error(`the pro-forma has no ${name} sheet`); files[p] = strToU8(fn(strFromU8(files[p]))); };
  if (Object.keys(d.inputs).length) edit('Inputs', (x) => setCells(x, d.inputs));
  const values = wizardValues(d.wizard);
  if (!d.hosted) for (const c of savedBlockCells()) values[c] = null;
  edit(WIZ_SHEET, (x) => setCellsBulk(x, values));
  return zipSync(files, { level: 6 });
}
