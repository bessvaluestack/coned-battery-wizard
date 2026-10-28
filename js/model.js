// Assemble one scenario (modality + account + supply + riders or Value Stack
// + load + battery) into the bill stack, the LP inputs, and the results.
// Pure functions; the solver runs in the worker (see solve.js).
//
// Modalities: 'btm' a behind-the-meter battery on the building's SC 8 or
// SC 9 account that never exports;
// 'btm_vs' the same battery also exporting under the Value Stack (Rider R
// A.9(d) + SC 11); 'ftm' a stand-alone battery with its own account and no
// load, compensated under the Value Stack.

import { buildIndex, DT_HOURS, MONTH_NAMES } from './timeidx.js';
import { buildTariffArrays, makeCharge, peakGroups, billFromProfile, peakOf, monthlyEnergyKwh, monthlyPeakKw } from './tariff.js';
import { buildSupply } from './supply.js';
import { buildPrograms } from './programs.js';
import { buildValueStack, valueStackCredits } from './valuestack.js';

export const MODALITIES = {
  btm: 'Behind the meter, no export',
  btm_vs: 'Behind the meter, exporting under the Value Stack',
  ftm: 'Front of the meter (stand-alone), Value Stack',
};
export const exportsOn = (modality) => modality === 'btm_vs' || modality === 'ftm';

// Delivered share of the pledge below which results flag a Rider T program.
export const MIN_PERFORMANCE = 0.8;

export const RATE_LABELS = { 1: 'Rate I (standard)', 2: 'Rate II (mandatory time-of-day, >1,500 kW)', 3: 'Rate III (voluntary time-of-day)' };

// Match on the key suffix: the source data prefixes keys with their origin
// and the client build drops that prefix. SC 2 has no voltage split.
export function tariffFor(tariffs, rateNo, voltage, sc = 8) {
  const suffix = sc === 2 ? `sc2_rate${rateNo}` : `sc${sc}_rate${rateNo}_${voltage}`;
  const key = Object.keys(tariffs).find((k) => k.endsWith(suffix));
  return key ? tariffs[key] : null;
}

// Size limits in the tariff: SC 2 serves requirements up to 10 kW; storage
// up to 1 MW is a Designated Technology billed on standard rates (General
// Rule 20.3.2(b)), as is on-site generation within 15% of the maximum
// potential demand (20.3.1(a)); standby Rate V starts above 1,500 kW of
// contract demand; the Value Stack caps a project at 5 MW.
export const LIMITS = { sc2Kw: 10, designatedKw: 1000, smallShare: 0.15, rateVKw: 1500, valueStackKw: 5000 };
export const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };

/**
 * The account a battery's consumption (and the building's, behind the meter)
 * is billed on. Front of the meter the account is the battery's own: SC 2 up
 * to 10 kW, SC 9 up to 1 MW (Rate I, or Rate III if chosen), SC 9 standby
 * above. Behind the meter the building keeps its SC 8 or SC 9 rate (a
 * building already on standby, SC 9 Rate IV or V, stays there); with
 * exports it moves to standby when the battery is above 1 MW and above 15%
 * of the building's peak.
 * @returns { sc, rateNo, voltage, standby, reason }
 */
export function chargingAccount({ modality, sc = 8, rateNo, voltage, batteryKw, buildingPeakKw }) {
  const kw = +batteryKw || 0;
  if (modality === 'ftm') {
    if (kw <= LIMITS.sc2Kw) return { sc: 2, rateNo: 1, voltage: null, standby: false, reason: `SC 2 Rate I: the battery's ${kw} kW is within SC 2's 10 kW.` };
    if (kw <= LIMITS.designatedKw) {
      const r = rateNo === 3 ? 3 : 1;
      return { sc: 9, rateNo: r, voltage, standby: false, reason: `SC 9 Rate ${ROMAN[r]} on standard rates: storage up to 1 MW is a Designated Technology (General Rule 20.3.2(b)).` };
    }
    const r = kw > LIMITS.rateVKw ? 5 : 4;
    return { sc: 9, rateNo: r, voltage, standby: true, reason: `SC 9 Rate ${ROMAN[r]} standby: storage above 1 MW is billed under General Rule 20${r === 5 ? ', Rate V above 1,500 kW of contract demand' : ''}.` };
  }
  if (rateNo >= 4) return { sc, rateNo, voltage, standby: true, reason: `SC ${sc} Rate ${ROMAN[rateNo]} standby: the building is already a standby customer (General Rule 20).` };
  if (modality === 'btm_vs' && kw > LIMITS.designatedKw && !(buildingPeakKw > 0 && kw <= LIMITS.smallShare * buildingPeakKw)) {
    const cd = Math.max(+buildingPeakKw || 0, kw);
    const r = cd > LIMITS.rateVKw ? 5 : 4;
    return { sc, rateNo: r, voltage, standby: true, reason: `SC ${sc} Rate ${ROMAN[r]} standby: a battery above 1 MW and above 15% of the building's peak is billed under General Rule 20.` };
  }
  return { sc, rateNo, voltage, standby: false, reason: modality === 'btm_vs' ? `SC ${sc} standard rates: the battery is within 1 MW or 15% of the building's peak (General Rule 20.3).` : '' };
}

/**
 * Build everything that does not depend on the load profile.
 * @param cfg  { serviceClass: 8|9, rateNo, voltage:'lt'|'ht', region:'nyc'|'westchester', zone, demandIntervalMin,
 *               adjustments: { kwh (delivery $/kWh), sbcDemand (bool), extraKwh, extraDemand ($/kW-mo) },
 *               taxPct, supply: {...}, programs: {...} }
 */
export function buildStack(cfg, data) {
  const idx = buildIndex();
  const modality = cfg.modality || 'btm';
  const acct = cfg.account || { sc: cfg.serviceClass || 8, rateNo: cfg.rateNo, voltage: cfg.voltage, standby: cfg.rateNo >= 4 };
  const tariff = tariffFor(data.tariffs, acct.rateNo, acct.voltage, acct.sc);
  if (!tariff) throw new Error(`no tariff for SC ${acct.sc} Rate ${acct.rateNo} ${acct.voltage || ''}`);
  const st = data.statements;
  const bc = st.by_class[`sc${acct.sc}`];
  const notes = [];

  // --- Value Stack (exports) ---
  const valueStack = exportsOn(modality) ? buildValueStack(cfg.valueStack || {}, data, { region: cfg.region, zone: cfg.zone }) : null;

  // --- delivery adjustments on the demand determinant (SBC; standby also SDR) ---
  const extraDemand = [];
  const adj = cfg.adjustments || {};
  if (adj.sbcDemand !== false && acct.sc !== 2) {
    if (acct.standby) {
      extraDemand.push({ name: 'SBC and SDR surcharges (contract demand)', rate: bc.kw.standby.contract_demand_kw, period: 'year', group: 'delivery_adjustment_demand', determinant: 'contract_demand_kw' });
    } else if (acct.rateNo === 1) {
      extraDemand.push({ name: 'SBC surcharge (monthly max)', rate: bc.kw.rate1.monthly_max_demand_kw, group: 'delivery_adjustment_demand', determinant: 'monthly_max_demand_kw' });
    } else {
      // SC 8 and SC 9 Rates II and III: the same weekday 8-22 window.
      const w = st.delivery_adjustments_usd_per_kw_month.sbc_sc8_rates_ii_iii_tod.window;
      extraDemand.push({ name: 'SBC surcharge (TOD weekdays 8-22)', rate: bc.kw.tod.tod_demand_kw, days: w.days, hours: w.hours, months: w.months, group: 'delivery_adjustment_demand', determinant: 'tod_demand_kw' });
    }
  }
  if (+adj.extraDemand) extraDemand.push({ name: 'Other demand adjustment', rate: +adj.extraDemand, group: 'delivery_adjustment_demand' });
  const ta = buildTariffArrays(tariff, { extraDemandCharges: extraDemand });

  // --- delivery $/kWh adjustments (standby schedules carry no SDR $/kWh) ---
  const k = st.delivery_adjustments_usd_per_kwh;
  const kwhAdjDefault = (k.sbc_total_nyserda.value || 0) + (k.mac.value || 0) + (k.mac_adjustment_factor.value || 0)
    + (bc.kwh.rdm || 0) + (acct.standby ? 0 : (bc.kwh.sdr || 0)) + (bc.kwh.sbc_company_ee || 0);
  const kwhAdj = (adj.kwh === null || adj.kwh === undefined || adj.kwh === '') ? kwhAdjDefault : +adj.kwh;

  // --- supply ---
  // Rider M hourly pricing is mandatory for standby customers and for
  // Value Stack storage above 115% of the on-site load (always, in front of
  // the meter); otherwise the MSC lookup covers SC 8 and SC 9 Rates I-III.
  const supplyCfg = { ...cfg.supply };
  const riderM = acct.standby || modality === 'ftm' || (modality === 'btm_vs' && cfg.riderMRequired);
  if (riderM && supplyCfg.mode === 'coned_msc') {
    supplyCfg.mode = 'coned_mhp';
    notes.push('Con Edison supply is on Rider M hourly pricing: it is mandatory for this account.');
  }
  const supply = buildSupply({ ...supplyCfg, region: cfg.region, zone: cfg.zone, sc: acct.sc, rateNo: acct.rateNo, mfcDefault: bc.mfc, icapTag: !!valueStack }, { ...data, tariff });
  const charges = [...ta.demandCharges];
  // The supply capacity charge, each month at its own rate.
  const capRates = supply.capacityByMonth;
  if (capRates.some((r) => r > 0)) {
    if (valueStack && supply.mode === 'coned_mhp') {
      // The Rider M capacity tag is the account's demand in the NYISO peak
      // hour: priced over the same likely peak hours the battery commits for
      // Alternative 3, and billed every month at that month's tag rate.
      const mask = new Uint8Array(idx.T); for (const t of valueStack.alt3.intervals) mask[t] = 1;
      charges.push(makeCharge(idx, { name: 'Supply capacity (ICAP tag, likely peak hours)', monthRates: capRates, period: 'year', mask, windowKey: 'icap_tag', group: 'supply_capacity' }));
    } else if (supply.capacityWindows) {
      // Rates II and III: weekday windows, by season.
      for (const w of supply.capacityWindows) {
        charges.push(makeCharge(idx, { name: `Supply capacity (weekdays ${w.hours[0]}-${w.hours[1]})`, monthRates: capRates, months: w.months, days: w.days, hours: w.hours, group: 'supply_capacity' }));
      }
    } else {
      charges.push(makeCharge(idx, { name: 'Supply capacity (monthly max)', monthRates: capRates, group: 'supply_capacity' }));
    }
  }

  const T = idx.T;
  const price = new Float64Array(T);
  for (let t = 0; t < T; t++) price[t] = ta.energyRate[t] + kwhAdj + supply.energyRate[t];

  // --- programs (a Value Stack customer is on Rider R: no performance pay) ---
  const programs = buildPrograms(cfg.programs || {}, data, cfg.zone || supply.zone, { riderR: !!valueStack });

  const taxFactor = 1 + (+cfg.taxPct || 0) / 100;
  // Demand response only (behind the meter without exports): the battery
  // discharges in program events and nowhere else.
  const drOnly = modality === 'btm' && (cfg.programs || {}).dispatch === 'dr_only';
  return {
    modality, account: acct, valueStack, notes, riderM, drOnly,
    idx, tariff, ta, supply, charges, price, kwhAdj, kwhAdjDefault, programs, taxFactor,
    demandIntervalMin: cfg.demandIntervalMin === 15 ? 15 : 30,
    energyComponents: [
      { name: 'Delivery energy', rate: ta.energyRate },
      { name: 'Delivery $/kWh adjustments', rate: kwhAdj },
      ...supply.components,
    ],
  };
}

// Annual bill for an import profile under a stack.
export function billFor(stack, importKw) {
  const dt = DT_HOURS;
  const b = billFromProfile({ energyRate: stack.price, charges: stack.charges, fixedAnnual: stack.ta.fixedAnnual, idx: stack.idx, importKw, dt, demandIntervalMin: stack.demandIntervalMin });
  const comps = {};
  for (const c of stack.energyComponents) {
    let s = 0;
    if (typeof c.rate === 'number') { for (let t = 0; t < importKw.length; t++) s += importKw[t]; s *= c.rate; }
    else { for (let t = 0; t < importKw.length; t++) s += c.rate[t] * importKw[t]; }
    comps[c.name] = s * dt;
  }
  const pretax = b.subtotal;
  const tax = pretax * (stack.taxFactor - 1);
  return { ...b, energyComponents: comps, tax, total: pretax + tax };
}

// The annual bill by calendar month: energy + demand + a twelfth of the fixed
// charges, taxes included. Sums to billFor().total.
export function monthlyBills(stack, importKw) {
  const idx = stack.idx, out = new Array(12).fill(0);
  for (let t = 0; t < idx.T; t++) out[idx.month[t] - 1] += stack.price[t] * importKw[t];
  for (let m = 0; m < 12; m++) out[m] = out[m] * DT_HOURS + stack.ta.fixedAnnual / 12;
  for (const g of peakGroups(stack.charges, idx)) {
    const pk = peakOf(importKw, g.idx, stack.demandIntervalMin);
    for (const [m, rate] of g.alloc) out[m - 1] += rate * pk;
  }
  return out.map((v) => v * stack.taxFactor);
}

// LP inputs for the worker: merge every $/kW determinant that shares a
// (month, window) into one peak term with the summed rate. With `drOnly`
// (the stack's choice unless given) the battery may discharge only in the
// enrolled programs' event intervals: it still charges against the bill.
export function lpInputs(stack, load, battery, withPrograms, { drOnly = stack.drOnly } = {}) {
  const groups = peakGroups(stack.charges, stack.idx);
  const merged = new Map();
  for (const g of groups) {
    if (!merged.has(g.key)) merged.set(g.key, { key: g.key, rate: 0, idx: g.idx, month: g.month, names: [] });
    const m = merged.get(g.key); m.rate += g.rate; m.names.push(g.charge.name);
  }
  const peakTerms = [...merged.values()];
  const exports = stack.valueStack ? exportInputs(stack, load, battery) : null;
  let programs = null;
  if (withPrograms && stack.programs.programs.length) {
    programs = stack.programs.programs.filter((p) => p.events.length).map((p) => {
      const all = new Set(); for (const e of p.events) for (const t of e.intervals) all.add(t);
      return {
        id: p.id, pledgeKw: p.pledgeKw, events: p.events.map((e) => ({ intervals: e.intervals })),
        allIntervals: Int32Array.from([...all].sort((a, b) => a - b)),
        performanceIntervals: p.performanceIntervals, performanceRate: p.performanceRate,
        reservationValuePerKw: p.reservationValuePerKw,
      };
    });
    if (!programs.length) programs = null;
  }
  let dischargeAllowed = null;
  if (drOnly) {
    const all = new Set();
    for (const p of programs || []) for (const t of p.allIntervals) all.add(t);
    dischargeAllowed = Int32Array.from([...all].sort((a, b) => a - b));
  }
  return {
    load, price: stack.price, peakTerms, battery, dt: DT_HOURS, demandIntervalMin: stack.demandIntervalMin,
    programs, taxFactor: stack.taxFactor, exports, dischargeAllowed,
  };
}

// Can the battery hold a net export over every interval of each block (an
// Alternative 3 commitment day, an LSRV event)? It must carry the whole load
// at the meter and then some: power above the block's peak load, and the
// block's load energy within the usable capacity.
export function canNetExport(load, battery, blocks) {
  const P = +battery.kw, usable = +battery.kwh * +battery.usableFrac, etaD = Math.sqrt(+battery.rte);
  for (const pos of blocks) {
    let peak = 0, kwh = 0;
    for (const t of pos) { peak = Math.max(peak, load[t]); kwh += load[t] * DT_HOURS; }
    if (peak >= P || kwh / etaD >= usable) return false;
  }
  return true;
}

// LP export terms from the Value Stack: the credit per kWh (capped just
// under the import price outside the DRV window, see lp.js), no charging and
// no grid pass-through in the DRV window, the Alternative 3 commitment and
// the LSRV events. Behind a building's meter the DRV window is checked for
// intervals the LP both imports and exports in (solveScenario), and the
// commitments are dropped where the battery cannot net-export over the load.
function exportInputs(stack, load, battery) {
  const vs = stack.valueStack, T = stack.idx.T, tax = stack.taxFactor;
  const alt3Ok = vs.alt3.intervals.length > 0 && canNetExport(load, battery, vs.alt3.days.map((d) => d.intervals));
  const lsrvOk = !!vs.lsrv && canNetExport(load, battery, vs.lsrv.events.map((e) => e.intervals));
  const inDrv = new Uint8Array(T);
  if (vs.drv) for (const t of vs.drv.intervals) inDrv[t] = 1;
  const price = new Float64Array(T);
  for (let t = 0; t < T; t++) price[t] = inDrv[t] ? vs.energyPrice[t] + vs.drv.rate : Math.min(vs.energyPrice[t], stack.price[t] * tax - 1e-4);
  const drv = vs.drv ? vs.drv.intervals : new Int32Array(0);
  return {
    price, leDis: drv, noCharge: drv,
    alt3: alt3Ok ? { rate: vs.alt3.annualRate, intervals: vs.alt3.intervals } : null,
    lsrv: lsrvOk ? { perEvent: vs.lsrv.perEvent, events: vs.lsrv.events.map((e) => e.intervals) } : null,
    washCheck: stack.modality === 'btm_vs' && vs.drv ? drv : null,
    dropped: [
      ...(vs.alt3.intervals.length && !alt3Ok ? ['Alternative 3: the battery cannot carry the building\'s load and still export through every likely peak hour, so no capacity kW is committed.'] : []),
      ...(vs.lsrv && !lsrvOk ? ['LSRV: the battery cannot carry the building\'s load and still export through every event, so no LSRV kW is committed.'] : []),
    ],
  };
}

export function programRevenue(stack, lpIn, sol) {
  const out = { total: 0, streams: [] };
  if (!lpIn.programs) return out;
  lpIn.programs.forEach((pg, pi) => {
    const s = sol.programs[pi];
    const perf = pg.performanceIntervals || pg.allIntervals;
    let relief = 0, perfKwh = 0;
    for (const t of pg.allIntervals) relief += s.r[t] * DT_HOURS;
    for (const t of perf) perfKwh += s.r[t] * DT_HOURS;
    const reservation = pg.reservationValuePerKw * s.D;
    const performance = pg.performanceRate * perfKwh;
    const meta = stack.programs.programs.find((p) => p.id === pg.id);
    const eventKw = pg.events.map((e) => { let sum = 0; for (const t of e.intervals) sum += s.r[t]; return e.intervals.length ? sum / e.intervals.length : 0; });
    const perfSet = new Set(perf);
    const eventPerfKwh = pg.events.map((e) => { let sum = 0; for (const t of e.intervals) if (perfSet.has(t)) sum += s.r[t]; return sum * DT_HOURS; });
    out.streams.push({
      id: pg.id, label: meta.label, pledgeKw: pg.pledgeKw, deliveredKw: s.D, factor: pg.pledgeKw ? s.D / pg.pledgeKw : 0,
      reservation, performance, reliefKwh: relief, events: pg.events.length, eventKw, eventPerfKwh, terms: meta.terms,
      eventDays: meta.events.map((e) => e.day), hours: meta.events.length ? meta.events[0].hours : null,
    });
    out.total += reservation + performance;
  });
  return out;
}

// Storage one full event at the pledge takes, from discharge alone (relief is
// the baseline minus import), against what the battery can use.
export function eventEnergyCheck(battery, pledgeKw, hours) {
  const etaD = Math.sqrt(battery.rte);
  return { needKwh: pledgeKw * hours / etaD, usableKwh: battery.kwh * battery.usableFrac, etaD };
}

export function summarize(stack, load, battery, baselineBill, solBill, solBillOnly, lpIn, sol, revenue, credits = null) {
  const idx = stack.idx;
  const dt = DT_HOURS;
  let thr = 0; for (let t = 0; t < idx.T; t++) thr += sol.dis[t];
  thr *= dt;
  const cycles = battery.kwh > 0 ? thr / battery.kwh : 0;
  const savingsBill = baselineBill.total - solBill.total;
  const monthly = [];
  for (let m = 1; m <= 12; m++) {
    const a = idx.monthStart[m - 1], b = idx.monthStart[m];
    const pos = []; for (let t = a; t < b; t++) pos.push(t);
    monthly.push({
      month: MONTH_NAMES[m - 1],
      peakBefore: peakOf(load, pos, stack.demandIntervalMin), peakAfter: peakOf(sol.imp, pos, stack.demandIntervalMin),
    });
  }
  // per-month cost delta from the peak tables
  const costBefore = new Array(12).fill(0), costAfter = new Array(12).fill(0);
  for (const p of baselineBill.peaks) costBefore[p.month - 1] += p.cost;
  for (const p of solBill.peaks) costAfter[p.month - 1] += p.cost;
  const eBefore = monthlyEnergyKwh(load, idx, dt), eAfter = monthlyEnergyKwh(sol.imp, idx, dt);
  monthly.forEach((m, i) => { m.demandBefore = costBefore[i]; m.demandAfter = costAfter[i]; m.kwhBefore = eBefore[i]; m.kwhAfter = eAfter[i]; });
  const creditsTotal = credits ? credits.total : 0;
  return {
    savingsBill, programRevenue: revenue.total, credits, creditsTotal, savingsTotal: savingsBill + revenue.total + creditsTotal,
    exportKwh: credits ? credits.exportKwh : 0,
    throughputKwh: thr, cycles, cycleLimit: battery.cyclesPerYear,
    peakBefore: Math.max(...monthlyPeakKw(load, idx, stack.demandIntervalMin)),
    peakAfter: Math.max(...monthlyPeakKw(sol.imp, idx, stack.demandIntervalMin)),
    monthly, billOnlySavings: solBillOnly ? baselineBill.total - solBillOnly.total : null,
  };
}

// The monthly bill, baseline and with the battery, taxes included. The
// baseline is the building's own account (none for a stand-alone battery);
// with standby the battery's account prices energy differently, and the
// part of the energy savings that comes from the new rate is shown apart.
export function monthlyBillChange({ stack, baseStack = stack, load, sol, baseline: B, withB: W, monthly, monthlyBills = null }) {
  const idx = stack.idx, tf = stack.taxFactor, btf = baseStack.taxFactor;
  const zero = () => new Array(12).fill(0);
  const kwhBase = zero(), kwhAfter = zero(), kwhExport = zero(), energyBase = zero(), energyAfter = zero(), rateChange = zero();
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
  const utility = monthly.map((mm, m) => ({
    kwhBase: kwhBase[m], kwhAfter: kwhAfter[m], kwhExport: kwhExport[m], peakBase: mm.peakBefore, peakAfter: mm.peakAfter,
    demandBase: demandBase[m], demandAfter: demandAfter[m], demandSav: demandBase[m] - demandAfter[m],
    demandRate: mm.peakBefore > 0 ? demandBase[m] / mm.peakBefore : 0,
    energyBase: energyBase[m], energyAfter: energyAfter[m], energySav: energyBase[m] - energyAfter[m],
    energyRate: kwhBase[m] > 0 ? energyBase[m] / kwhBase[m] : 0,
    fixedChange, rateChange: B.total === 0 ? 0 : rateChange[m],
    billSav: demandBase[m] - demandAfter[m] + energyBase[m] - energyAfter[m] + fixedChange,
    actualBill: monthlyBills ? +monthlyBills[m] || 0 : undefined,
  }));
  return { utility, kwhExport };
}

// Program revenue by program and month: reservations spread over the
// Capability Period (`programMonths`: { csrp: [5..9], ... }), performance in
// the event months; and each program's terms.
export function programsByMonth(revenue, programMonths = {}) {
  const programs = Array.from({ length: 12 }, () => ({ total: 0 }));
  const terms = {};
  for (const s of revenue.streams) {
    const season = programMonths[s.id] || [5, 6, 7, 8, 9];
    for (const m of season) { programs[m - 1][`${s.id}Res`] = (programs[m - 1][`${s.id}Res`] || 0) + s.reservation / season.length; programs[m - 1].total += s.reservation / season.length; }
    s.eventPerfKwh.forEach((kwh, e) => { const m = +s.eventDays[e].split('/')[0] - 1, v = s.terms.performanceRate * kwh; programs[m][`${s.id}Perf`] = (programs[m][`${s.id}Perf`] || 0) + v; programs[m].total += v; });
    terms[s.id] = { pledge: s.pledgeKw, delivered: s.deliveredKw, share: s.factor, events: s.events, resRate: s.terms.reservationRate, perfRate: s.terms.performanceRate, resAnnual: s.reservation, perfAnnual: s.performance };
  }
  for (const id of Object.keys(terms)) for (const p of programs) for (const k of ['Res', 'Perf']) if (p[`${id}${k}`] === undefined) p[`${id}${k}`] = 0;
  return { programs, terms };
}

// What the battery holds through each month, and how long that would carry
// a critical load of `share` of the month's peak in an outage. The dispatch
// keeps nothing back for one: this is what normal operation leaves in the
// battery at an average moment. A load above the battery's power is carried
// only up to it.
export function backupByMonth({ idx, soc, battery, peaks = null, share = 0.25 }) {
  const usable = battery.kwh * battery.usableFrac, etaD = Math.sqrt(battery.rte);
  return Array.from({ length: 12 }, (_, m) => {
    const a = idx.monthStart[m], b = idx.monthStart[m + 1];
    let s = 0; for (let t = a; t < b; t++) s += soc[t];
    const avgKwh = s / (b - a);
    const out = { month: MONTH_NAMES[m], avgKwh, avgShare: usable > 0 ? avgKwh / usable : 0 };
    if (peaks) {
      const loadKw = share * peaks[m], carriedKw = Math.min(loadKw, battery.kw);
      Object.assign(out, { loadKw, carriedKw, powerLimited: battery.kw < loadKw, hours: carriedKw > 0 ? avgKwh * etaD / carriedKw : 0 });
    }
    return out;
  });
}
