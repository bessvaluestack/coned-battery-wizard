// The owner pro-forma (templates/proforma.xlsx, built by
// scripts/make_proforma_template.mjs) filled from a run. The wizard writes
// two places only: the Wizard_Import sheet (project, battery, the monthly
// bill and its determinants, program revenue by program, Value Stack credits;
// see js/wizardsheet.js), which the model's battery, savings and rate cells
// link to, and the 8,760 hourly rows on Hourly_Operations. The installed
// cost, when one was entered, goes on the capital lines. O&M, finance and
// resiliency stay as the template has them for the user to set.
import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate/fflate.mjs';
import { setCells, setCellsBulk, fillRows } from './xlsx.js';
import { STEPS_PER_HOUR, DT_HOURS } from './timeidx.js';
import { sheetCells, PROGRAM_IDS, DEMAND_ROWS, MONTHS } from './wizardsheet.js';

export const TEMPLATE_URL = new URL('../templates/proforma.xlsx', import.meta.url);
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SHEET = { inputs: 1, hourly: 3, wizard: 7 };
const FIRST_ROW = 6; // hour 1 is on row 6 of Hourly_Operations
const PERIOD = { month: 'monthly', day: 'daily (as-used)', year: 'contract demand' };

/**
 * Everything the workbook needs from a run.
 * @param run  { stack, load (kW, 15-min), sol, summary, revenue, battery, baseline / withB (bills),
 *               credits (valueStackCredits) for the Value Stack, baseStack (the bill without the battery) }
 * @param opts { project: { id, name, config, run, version, ratesDate, modality, rate, area, supply, dr, load },
 *               programMonths: { csrp: [5..9], ... }, monthlyBills: [12] | null, installedCost ($), election }
 */
export function proformaData(run, opts = {}) {
  const { stack, load, sol, summary, revenue, battery, credits = null, baseline: B, withB: W } = run;
  const baseStack = run.baseStack || stack;
  const { programMonths = {}, monthlyBills = null, installedCost = 0 } = opts;
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

  // The monthly bill, baseline and with the battery, taxes included. The
  // baseline is the building's own account (none for a stand-alone battery);
  // with standby the battery's account prices energy differently, and the
  // part of the energy savings that comes from the new rate is shown apart.
  const zero = () => new Array(12).fill(0);
  const kwhBase = zero(), kwhAfter = zero(), kwhExport = zero(), energyBase = zero(), energyAfter = zero(), rateChange = zero();
  const btf = baseStack.taxFactor;
  for (let t = 0; t < idx.T; t++) {
    const m = idx.month[t] - 1;
    kwhBase[m] += load[t] * DT_HOURS; kwhAfter[m] += sol.imp[t] * DT_HOURS; kwhExport[m] += (sol.exp ? sol.exp[t] : 0) * DT_HOURS;
    energyBase[m] += baseStack.price[t] * load[t] * DT_HOURS * btf;
    energyAfter[m] += stack.price[t] * sol.imp[t] * DT_HOURS * tf;
    if (baseStack !== stack) rateChange[m] += load[t] * (baseStack.price[t] * btf - stack.price[t] * tf) * DT_HOURS;
  }
  if (B.total === 0) energyBase.fill(0); // no account before a stand-alone battery
  const demandOf = (bill, factor) => { const out = zero(); for (const p of bill.peaks) out[p.month - 1] += p.cost * factor; return out; };
  const demandBase = demandOf(B, btf), demandAfter = demandOf(W, tf);
  const fixedChange = ((B.fixed * btf) - (W.fixed * tf)) / 12;
  const utility = summary.monthly.map((mm, m) => ({
    kwhBase: kwhBase[m], kwhAfter: kwhAfter[m], kwhExport: kwhExport[m], peakBase: mm.peakBefore, peakAfter: mm.peakAfter,
    demandBase: demandBase[m], demandAfter: demandAfter[m], demandSav: demandBase[m] - demandAfter[m],
    demandRate: mm.peakBefore > 0 ? demandBase[m] / mm.peakBefore : 0,
    energyBase: energyBase[m], energyAfter: energyAfter[m], energySav: energyBase[m] - energyAfter[m],
    energyRate: kwhBase[m] > 0 ? energyBase[m] / kwhBase[m] : 0,
    fixedChange, rateChange: B.total === 0 ? 0 : rateChange[m],
    billSav: demandBase[m] - demandAfter[m] + energyBase[m] - energyAfter[m] + fixedChange,
    actualBill: monthlyBills ? +monthlyBills[m] || 0 : undefined,
  }));

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

  // Program revenue by program and month: reservations spread over the
  // Capability Period, performance in the event months.
  const programs = Array.from({ length: 12 }, () => ({ total: 0 }));
  const terms = {};
  for (const s of revenue.streams) {
    const season = programMonths[s.id] || [5, 6, 7, 8, 9];
    for (const m of season) { programs[m - 1][`${s.id}Res`] = (programs[m - 1][`${s.id}Res`] || 0) + s.reservation / season.length; programs[m - 1].total += s.reservation / season.length; }
    s.eventPerfKwh.forEach((kwh, e) => { const m = +s.eventDays[e].split('/')[0] - 1, v = s.terms.performanceRate * kwh; programs[m][`${s.id}Perf`] = (programs[m][`${s.id}Perf`] || 0) + v; programs[m].total += v; });
    terms[s.id] = { pledge: s.pledgeKw, delivered: s.deliveredKw, share: s.factor, events: s.events, resRate: s.terms.reservationRate, perfRate: s.terms.performanceRate, resAnnual: s.reservation, perfAnnual: s.performance };
  }
  for (const id of PROGRAM_IDS) for (const p of programs) for (const k of ['Res', 'Perf']) if (terms[id] && p[`${id}${k}`] === undefined) p[`${id}${k}`] = 0;

  const vsRows = credits ? Array.from({ length: 12 }, (_, m) => ({ exportKwh: kwhExport[m], energy: credits.energy[m], drv: credits.drv[m], alt3: credits.alt3[m], lsrv: credits.lsrv[m], total: credits.energy[m] + credits.drv[m] + credits.alt3[m] + credits.lsrv[m] })) : null;
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
  };

  // The installed cost is all-in: it goes on the first capital line, the rest are zero.
  const inputs = {};
  if (installedCost > 0) {
    Object.assign(inputs, { C32: installedCost, C33: 0, C34: 0, C35: 0, C36: 0, C37: 0, C38: 0 });
    inputs.E32 = 'All-in installed cost from the Con Edison Battery Wizard; the lines below are 0. Split it across them if you have a breakdown.';
  }
  return { hourly: { baseline, dispatch, rate, exportRate }, inputs, wizard };
}

// The Wizard_Import values as { cell: value }: every value cell of the layout,
// blank where the run has nothing (labels and totals stay as the template has them).
export function wizardValues(wizard) {
  const out = {};
  for (const [cell, [value, fmt]] of Object.entries(sheetCells(wizard))) {
    if (['title', 'note', 'head', 'colhead', 'label'].includes(fmt) || (value && value.f)) continue;
    out[cell] = value === undefined ? null : value;
  }
  return out;
}

// Fill the template bytes with proformaData() and return the new workbook.
export function fillProforma(template, d) {
  const files = unzipSync(template);
  const edit = (n, fn) => { const p = `xl/worksheets/sheet${n}.xml`; files[p] = strToU8(fn(strFromU8(files[p]))); };
  const { baseline, dispatch, rate, exportRate } = d.hourly;
  if (Object.keys(d.inputs).length) edit(SHEET.inputs, (x) => setCells(x, d.inputs));
  edit(SHEET.hourly, (x) => fillRows(x, (n) => {
    const h = n - FIRST_ROW;
    if (h < 0 || h >= baseline.length) return null;
    return exportRate ? { D: baseline[h], E: dispatch[h], H: rate[h], L: exportRate[h] } : { D: baseline[h], E: dispatch[h], H: rate[h] };
  }));
  edit(SHEET.wizard, (x) => setCellsBulk(x, wizardValues(d.wizard)));
  return zipSync(files, { level: 6 });
}
