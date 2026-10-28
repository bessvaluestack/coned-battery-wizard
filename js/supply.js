// Commodity supply on top of the delivery-only SC 2 / 8 / 9 schedules.
//
//   coned_msc   Con Edison full service: the observed Market Supply Charge
//               (energy, $/kWh by billing period from the corpus dataset,
//               laid onto the model year by calendar day) + the MSC capacity
//               charge ($/kW-month on the monthly maximum demand; Rates II
//               and III in weekday windows) + the merchant function charge +
//               the MSC adjustment factors.
//   coned_mhp   Con Edison full service under Rider M (day-ahead hourly
//               pricing): zonal DA LBMP + MFC, capacity as the Rider M ICAP
//               tag ($/kW-month). The MSC adjustment factors are not billed
//               to Rider M customers.
//
// The capacity charge, the MFC and the adjustment factors are each month's
// own statement value (statements.monthly), unless overridden by one value.
//   esco_fixed  third-party supply at a flat all-in $/kWh (+ optional $/kW-month)
//   esco_lbmp   third-party supply at zonal LBMP + adder (+ optional $/kW-month)
//
// Ported from the reference engine's app/tariffs/supply.py and msc_lookup.py.

import { buildIndex, windowMask, STEPS_PER_HOUR } from './timeidx.js';
import { mscProvenance, lbmpSource } from './edition.js';

export const SUPPLY_MODES = {
  coned_msc: 'Con Edison full service (Market Supply Charge)',
  coned_mhp: 'Con Edison full service, Rider M hourly pricing',
  esco_fixed: 'Third-party supply, fixed $/kWh',
  esco_lbmp: 'Third-party supply, LBMP + adder',
};

export function mscCodeFor(sc, rateNo) {
  // codes.yaml: 008CNV = SC 8 Rates I, III, IV; 008TOD = Rates II and V (Rider M
  // exempt); 009CNV / 009TOD the same for SC 9.
  return `00${sc}${rateNo === 2 || rateNo === 5 ? 'TOD' : 'CNV'}`;
}

export function mscWindowFor(rateNo) {
  return rateNo === 1 ? 'all' : 'on_off_peak';
}

// Union of the tariff's windows that carry hours (Con Ed's Rate II/III
// delivery energy is flat; the on-peak block lives on the TOD demand charges).
export function onPeakMask(tariff) {
  const idx = buildIndex();
  const mask = new Uint8Array(idx.T);
  const add = (w, months) => {
    if (!w.hours) return;
    const m = windowMask(idx, { months, days: w.days || 'all', hours: w.hours });
    for (let t = 0; t < idx.T; t++) if (m[t]) mask[t] = 1;
  };
  for (const s of tariff.energy.seasons || []) for (const w of s.tou || []) add(w, s.months);
  for (const c of (tariff.demand && tariff.demand.charges) || []) add(c, c.months);
  return mask;
}

function dailyToIntervals(daily) {
  const idx = buildIndex();
  const out = new Float64Array(idx.T);
  for (let t = 0; t < idx.T; t++) out[t] = daily[idx.doy[t]];
  return out;
}

export function hourlyToIntervals(hourly) {
  const idx = buildIndex();
  const out = new Float64Array(idx.T);
  for (let t = 0; t < idx.T; t++) out[t] = hourly[Math.floor(t / STEPS_PER_HOUR)];
  return out;
}

export function mean(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

// Twelve monthly values (January first): the override when one is entered,
// else the statements' series, else one statement value.
function byMonth(override, series, scalar) {
  const v = num(override, null);
  if (v !== null) return new Array(12).fill(v);
  return series ? series.slice() : new Array(12).fill(scalar || 0);
}
const span = (a) => (Math.min(...a) === Math.max(...a) ? a[0].toFixed(a[0] < 0.1 ? 6 : 2) : `${Math.min(...a).toFixed(a[0] < 0.1 ? 6 : 2)} to ${Math.max(...a).toFixed(a[0] < 0.1 ? 6 : 2)}`);

/**
 * @param cfg  { mode, region: 'nyc'|'westchester', zone: 'J'|'H'|'I', sc: 2|8|9, rateNo: 1|2|3, mfcDefault,
 *               capacityRate (override $/kW-month or null), mfc ($/kWh), reconciliation ($/kWh),
 *               taxReimbursement ($/kWh), fixedRate ($/kWh), adder ($/kWh), escoCapacity ($/kW-month) }
 * @param data { msc, lbmp: {J,H,I}, statements, tariff }
 * @returns { energyRate: Float64Array ($/kWh), capacityByMonth ($/kW-month, January first), capacityRate (their
 *            average), capacityWindows (Rates II / III on the MSC: [{ months, days, hours }], else null: the monthly max),
 *            components, description, warnings }
 */
export function buildSupply(cfg, data) {
  const idx = buildIndex();
  const T = idx.T;
  const st = data.statements;
  const warnings = [];
  const region = cfg.region === 'westchester' ? 'westchester' : 'nyc';
  const zone = cfg.zone || (region === 'nyc' ? 'J' : 'H');
  const M = st.monthly || null;
  const sc = cfg.sc || 8;
  const mfcDefault = cfg.mfcDefault != null ? cfg.mfcDefault : st.merchant_function_charge_usd_per_kwh.scs5_6_8_9_12_13_total;
  const mfc = byMonth(cfg.mfc, M && M.mfc_usd_per_kwh[sc === 2 ? 'sc2' : 'scs5_6_8_9_12_13'], mfcDefault);
  // The MSC adjustment factors (each month's reconciliation, and the tax
  // reimbursement non-residential customers pay on top) apply to full-service
  // customers on the MSC, not under Rider M. A Rate II customer on the MSC is
  // one who would be on Rider M but for its exemptions, with its own factor.
  const onMsc = cfg.mode === 'coned_msc';
  const adj = M && M.msc_adjustment_usd_per_kwh;
  const recKey = cfg.rateNo === 2 ? 'reconciliation_would_be_rider_m' : 'reconciliation_all_other';
  const reconciliation = byMonth(cfg.reconciliation, onMsc ? (adj ? adj[recKey][region] : null) : new Array(12).fill(0),
    onMsc ? (st.msc_adjustment_factors_usd_per_kwh[cfg.rateNo === 2 ? 'reconciliation_rider_m_nonresidential' : 'reconciliation_all_other_nonresidential'][region] || 0) : 0);
  const taxReimb = byMonth(cfg.taxReimbursement, onMsc ? (adj ? adj.tax_reimbursement_recovery_nonresidential[region] : null) : new Array(12).fill(0),
    onMsc ? (st.msc_adjustment_factors_usd_per_kwh.tax_reimbursement_recovery_nonresidential || 0) : 0);

  const components = []; // [{name, rate: number|Float64Array, kind:'energy'}]
  let energyMarket;      // Float64Array
  let capacityByMonth = new Array(12).fill(0), capacityWindows = null;
  let description = '';
  const lbmpHourly = data.lbmp[zone] && data.lbmp[zone].hourly;

  if (cfg.mode === 'coned_msc') {
    const code = mscCodeFor(sc, cfg.rateNo);
    const win = mscWindowFor(cfg.rateNo);
    const cap = (st.msc_capacity_usd_per_kw_month[region][`sc${sc}`] || {})[`rate${cfg.rateNo}`];
    if (!data.msc.codes[code] || cap === undefined) throw new Error(`no Market Supply Charge for SC ${sc} Rate ${cfg.rateNo}`);
    const capSeries = M && M.msc_capacity_usd_per_kw_month[region][`sc${sc}`][`rate${cfg.rateNo}`];
    const z = data.msc.codes[code].zones[zone];
    if (win === 'all') {
      energyMarket = dailyToIntervals(z.windows.all);
    } else {
      const on = dailyToIntervals(z.windows.on_peak), off = dailyToIntervals(z.windows.off_peak);
      const mask = onPeakMask(data.tariff);
      energyMarket = new Float64Array(T);
      for (let t = 0; t < T; t++) energyMarket[t] = mask[t] ? on[t] : off[t];
    }
    capacityByMonth = byMonth(cfg.capacityRate, capSeries, cap);
    // Rates II and III: the capacity charge applies weekdays 8-18 in June to
    // September and 8-22 in other months (the statement's note).
    if (cfg.rateNo !== 1 && M) capacityWindows = M.capacity_windows_rates_ii_iii;
    components.push({ name: 'Market Supply Charge (energy)', rate: energyMarket });
    description = `Con Edison MSC lookup ${code}/${win}, zone ${zone}, billed ${z.lookback.from} to ${z.lookback.to} (${z.lookback.periods} billing periods)${mscProvenance(data.msc)}; capacity ${span(capacityByMonth)} $/kW-month by month (${num(cfg.capacityRate, null) !== null ? 'your value' : `each month's statement for ${region === 'nyc' ? 'NYC' : 'Westchester'}, SC ${sc} Rate ${['', 'I', 'II', 'III'][cfg.rateNo]}`}) on ${capacityWindows ? 'the weekday demand 8 AM to 6 PM in June to September and 8 AM to 10 PM otherwise' : 'the monthly max demand'}`;
    if (cfg.rateNo === 2) warnings.push(`Rate II customers are normally on Rider M hourly pricing; the ${code} series is the Rider M exempt MSC.`);
  } else if (cfg.mode === 'coned_mhp') {
    if (!lbmpHourly) throw new Error(`no LBMP data for zone ${zone}`);
    const lb = hourlyToIntervals(lbmpHourly);
    energyMarket = new Float64Array(T);
    for (let t = 0; t < T; t++) energyMarket[t] = lb[t] / 1000;
    capacityByMonth = byMonth(cfg.capacityRate, M && M.msc_capacity_usd_per_kw_month[region].rider_m_icap_tag, st.msc_capacity_usd_per_kw_month[region].rider_m_icap_tag);
    components.push({ name: 'Rider M day-ahead LBMP (energy)', rate: energyMarket });
    if (cfg.icapTag) {
      description = `Rider M mandatory hourly pricing: NYISO day-ahead zone ${zone} LBMP (${lbmpSource(data.lbmp[zone])}) laid onto the model year; capacity ${span(capacityByMonth)} $/kW-month by month on the ICAP tag, taken as the most the account imports in the likely NYISO peak hours (the Alternative 3 commitment hours)`;
    } else {
      description = `Rider M mandatory hourly pricing: NYISO day-ahead zone ${zone} LBMP (${lbmpSource(data.lbmp[zone])}) laid onto the model year; capacity ${span(capacityByMonth)} $/kW-month by month (the Rider M ICAP tag statements, applied to the monthly max demand - a simplification of the tag mechanism)`;
      warnings.push('The Rider M capacity charge is really set by the customer\'s ICAP tag (demand at the NYISO peak hour of the prior year); it is applied here to each month\'s maximum demand.');
    }
  } else if (cfg.mode === 'esco_fixed') {
    const r = num(cfg.fixedRate, 0.09);
    energyMarket = new Float64Array(T).fill(r);
    capacityByMonth = new Array(12).fill(num(cfg.escoCapacity, 0));
    components.push({ name: 'Third-party supply (fixed)', rate: energyMarket });
    description = `Third-party supply at a fixed ${r.toFixed(4)} $/kWh` + (capacityByMonth[0] ? ` plus ${capacityByMonth[0].toFixed(2)} $/kW-month` : ' (capacity assumed included)');
  } else if (cfg.mode === 'esco_lbmp') {
    if (!lbmpHourly) throw new Error(`no LBMP data for zone ${zone}`);
    const adder = num(cfg.adder, 0.02);
    const lb = hourlyToIntervals(lbmpHourly);
    energyMarket = new Float64Array(T);
    for (let t = 0; t < T; t++) energyMarket[t] = lb[t] / 1000 + adder;
    capacityByMonth = new Array(12).fill(num(cfg.escoCapacity, 0));
    components.push({ name: `Third-party supply (LBMP + ${adder.toFixed(4)})`, rate: energyMarket });
    description = `Third-party supply at zone ${zone} day-ahead LBMP + ${adder.toFixed(4)} $/kWh adder` + (capacityByMonth[0] ? ` plus ${capacityByMonth[0].toFixed(2)} $/kW-month` : '');
  } else {
    throw new Error(`unknown supply mode ${cfg.mode}`);
  }

  const energyRate = new Float64Array(T);
  const isUtility = cfg.mode === 'coned_msc' || cfg.mode === 'coned_mhp';
  // Monthly $/kWh adders as interval series (a flat value stays a number).
  const series = (v) => (v.every((x) => x === v[0]) ? v[0] : Float64Array.from({ length: T }, (_, t) => v[idx.month[t] - 1]));
  const adders = isUtility ? mfc.map((v, m) => v + taxReimb[m] + reconciliation[m]) : new Array(12).fill(0);
  for (let t = 0; t < T; t++) energyRate[t] = energyMarket[t] + adders[idx.month[t] - 1];
  if (isUtility) {
    components.push({ name: 'Merchant function charge', rate: series(mfc) });
    if (taxReimb.some((v) => v)) components.push({ name: 'Tax reimbursement recovery', rate: series(taxReimb) });
    if (reconciliation.some((v) => v)) components.push({ name: 'MSC adjustment factors', rate: series(reconciliation) });
    description += `; MFC ${span(mfc)} $/kWh by month` + (onMsc ? `, MSC adjustment factors ${span(reconciliation)} $/kWh by month` : '; no MSC adjustment factors under Rider M');
  }

  const capacityRate = mean(capacityByMonth);
  return {
    mode: cfg.mode, zone, region, energyRate, capacityRate, capacityByMonth, capacityWindows, components, description, warnings,
    mfcByMonth: mfc, reconciliationByMonth: reconciliation, taxReimbursementByMonth: taxReimb,
    avgEnergyRate: mean(energyRate),
    lbmpAvg: lbmpHourly ? mean(lbmpHourly) / 1000 : null,
  };
}

function num(v, dflt) {
  if (v === null || v === undefined || v === '' || Number.isNaN(+v)) return dflt;
  return +v;
}
