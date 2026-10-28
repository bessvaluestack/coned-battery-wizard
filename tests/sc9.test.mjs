// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, DT_HOURS } from '../js/timeidx.js';
import { buildTariffArrays, billFromProfile } from '../js/tariff.js';
import { buildStack, billFor, chargingAccount, tariffFor } from '../js/model.js';
import { mscCodeFor } from '../js/supply.js';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: { ...read('tariffs_sc8.json'), ...read('tariffs_sc9.json'), ...read('tariffs_sc2.json') }, statements: read('statements.json'), msc: read('msc.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'), valueStack: read('value_stack.json'),
};
const idx = buildIndex();
const flat = (kw) => new Float64Array(idx.T).fill(kw);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
const sc9 = (rateNo, more = {}) => ({ serviceClass: 9, rateNo, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 0, supply: { mode: 'coned_msc' }, programs: {}, ...more });

test('SC 9: all five rates, low and high tension; flat 100 kW bills by hand for Rates I and II', () => {
  for (const r of [1, 2, 3, 4, 5]) for (const v of ['lt', 'ht']) assert.ok(tariffFor(data.tariffs, r, v, 9), `SC 9 Rate ${r} ${v}`);
  const bill = (rateNo) => {
    const ta = buildTariffArrays(tariffFor(data.tariffs, rateNo, 'lt', 9));
    return billFromProfile({ energyRate: ta.energyRate, charges: ta.demandCharges, fixedAnnual: ta.fixedAnnual, idx, importKw: flat(100), dt: DT_HOURS, demandIntervalMin: 30 });
  };
  const r1 = bill(1);
  near(r1.energy, 0.0154 * 876000, 'Rate I energy');
  near(r1.demand, 4 * 44.05 * 100 + 8 * 34.5 * 100, 'Rate I demand');
  assert.equal(r1.fixed, 72 * 12);
  const r2 = bill(2);
  near(r2.energy, 0.0079 * 876000, 'Rate II energy');
  near(r2.demand, 4 * (11.33 + 22.82 + 20.61) * 100 + 8 * (19.41 + 5.85) * 100, 'Rate II demand');
  assert.equal(r2.fixed, 510 * 12);
});

test('SC 9 supply and surcharges: its own MSC series and capacity charge, SBC and RDM / SDR', () => {
  assert.deepEqual([[8, 1], [8, 2], [9, 1], [9, 2], [9, 3]].map(([s, r]) => mscCodeFor(s, r)), ['008CNV', '008TOD', '009CNV', '009TOD', '009CNV']);
  const st = data.statements, k = st.delivery_adjustments_usd_per_kwh, bc = st.by_class.sc9;
  const s1 = buildStack(sc9(1), data);
  assert.equal(s1.account.sc, 9);
  assert.equal(s1.riderM, false, 'standard SC 9 can take the MSC');
  assert.match(s1.supply.description, /009CNV/);
  assert.equal(s1.supply.capacityRate, 14.32);
  near(s1.kwhAdjDefault, k.sbc_total_nyserda.value + k.mac.value + k.mac_adjustment_factor.value + bc.kwh.rdm + bc.kwh.sdr, 'per-kWh adjustments');
  const b1 = billFor(s1, flat(100));
  near(b1.demandByGroup.supply_capacity, 14.32 * 12 * 100, 'MSC capacity');
  near(b1.demandByGroup.delivery_adjustment_demand, bc.kw.rate1.monthly_max_demand_kw * 12 * 100, 'SBC on the monthly max');
  assert.equal(buildStack(sc9(3), data).supply.capacityRate, 14.63);
  const s2 = buildStack(sc9(2), data);
  assert.match(s2.supply.description, /009TOD/);
  assert.equal(s2.supply.capacityRate, 19.26);
  const sbc = s2.charges.find((c) => c.group === 'delivery_adjustment_demand');
  assert.equal(sbc.rate, bc.kw.tod.tod_demand_kw);
  assert.deepEqual(sbc.hours, [8, 22]);
  // Westchester.
  assert.equal(buildStack(sc9(1, { region: 'westchester', zone: 'H' }), data).supply.capacityRate, 5.23);
});

test('SC 9 accounts: a building on standby stays there; an exporting battery moves a large building to SC 9 standby', () => {
  const acct = (modality, rateNo, kw, peak) => chargingAccount({ modality, sc: 9, rateNo, voltage: 'lt', batteryKw: kw, buildingPeakKw: peak });
  assert.deepEqual(['btm', 'btm_vs'].map((m) => { const a = acct(m, 4, 200, 900); return `${a.sc}/${a.rateNo}/${a.standby}`; }), ['9/4/true', '9/4/true']);
  const std = acct('btm_vs', 2, 500, 3000);
  assert.deepEqual([std.sc, std.rateNo, std.standby], [9, 2, false]);
  const big = acct('btm_vs', 2, 1200, 3000);
  assert.deepEqual([big.sc, big.rateNo, big.standby], [9, 5, true]);
  assert.equal(acct('btm_vs', 1, 1200, 9000).standby, false, 'within 15% of the building peak');
  assert.equal(acct('btm', 1, 3000, 3000).standby, false, 'no exports, no standby');
  // A front-of-meter battery's account does not follow the building's class.
  assert.equal(chargingAccount({ modality: 'ftm', sc: 8, rateNo: 1, voltage: 'lt', batteryKw: 500 }).sc, 9);
});

test('SC 9 standby building: contract demand every month on the year\'s peak, its SBC / SDR, Rider M supply', () => {
  const s = buildStack(sc9(4), data);
  assert.equal(s.account.standby, true);
  assert.equal(s.riderM, true);
  assert.equal(s.supply.mode, 'coned_mhp');
  assert.ok(s.notes.some((n) => /Rider M/.test(n)));
  const load = flat(100); load[idx.monthStart[6] + 60] = 250; // one July spike sets the contract demand
  const b = billFor(s, load);
  const contract = b.peaks.filter((p) => p.charge === 'contract_demand');
  assert.ok(contract.length >= 1 && contract.every((p) => Math.abs(p.peakKw - 250) < 1e-9), 'contract demand is the annual peak');
  near(contract.reduce((a, p) => a + p.cost, 0), 12 * 7.94 * 250, 'contract demand charge');
  near(b.demandByGroup.delivery_adjustment_demand, 12 * data.statements.by_class.sc9.kw.standby.contract_demand_kw * 250, 'standby SBC and SDR');
  assert.equal(b.fixed, 72 * 12);
  assert.equal(buildStack(sc9(5), data).tariff.fixed_charge_per_month, 510);
});
