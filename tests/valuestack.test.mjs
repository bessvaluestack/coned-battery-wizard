// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import loadHighs from '../vendor/highs/highs.mjs';
import { buildStack, billFor, lpInputs, chargingAccount, tariffFor } from '../js/model.js';
import { solveScenario } from '../js/lp.js';
import { buildValueStack, drvIntervals, valueStackCredits } from '../js/valuestack.js';
import { buildPrograms } from '../js/programs.js';
import { peakGroups, makeCharge } from '../js/tariff.js';
import { buildIndex, STEPS_PER_HOUR } from '../js/timeidx.js';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: { ...read('tariffs_sc8.json'), ...read('tariffs_sc9.json'), ...read('tariffs_sc2.json') }, statements: read('statements_sc8.json'), msc: read('msc_sc8.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'), valueStack: read('value_stack.json'),
};
const idx = buildIndex();

test('charging account follows the battery size (SC 2, SC 9 standard, SC 9 standby; SC 8 standby behind the meter)', () => {
  const acct = (modality, kw, peak = 0) => chargingAccount({ modality, rateNo: 1, voltage: 'lt', batteryKw: kw, buildingPeakKw: peak });
  assert.deepEqual([10, 11, 1000, 1001, 1500, 1501].map((kw) => { const a = acct('ftm', kw); return `${a.sc}/${a.rateNo}/${a.standby}`; }),
    ['2/1/false', '9/1/false', '9/1/false', '9/4/true', '9/4/true', '9/5/true']);
  assert.equal(acct('btm_vs', 1200, 9000).standby, false, 'within 15% of the building peak');
  assert.deepEqual(acct('btm_vs', 1200, 3000), { ...acct('btm_vs', 1200, 3000), sc: 8, rateNo: 5, standby: true });
  assert.equal(acct('btm', 3000, 3000).standby, false);
  for (const [sc, r, v] of [[2, 1, null], [9, 1, 'lt'], [9, 4, 'ht'], [9, 5, 'lt'], [8, 4, 'lt'], [8, 5, 'ht']]) assert.ok(tariffFor(data.tariffs, r, v, sc), `SC ${sc} Rate ${r} ${v}`);
});

test('standby demand: the contract demand bills every month on one kW, as-used demand per weekday', () => {
  const t = tariffFor(data.tariffs, 4, 'lt', 9);
  const charges = t.demand.charges.map((c) => makeCharge(idx, c));
  const groups = peakGroups(charges, idx);
  const contract = groups.filter((g) => g.charge.period === 'year');
  assert.equal(contract.length, 1);
  assert.equal(contract[0].alloc.length, 12);
  assert.equal(contract[0].idx.length, idx.T);
  const summer818 = groups.filter((g) => g.charge.name === 'as_used_summer_8_18');
  let weekdays = 0; for (let d = 0; d < 365; d++) { const t0 = d * 96; if ([6, 7, 8, 9].includes(idx.month[t0]) && idx.dow[t0] < 5) weekdays++; }
  assert.equal(summer818.length, weekdays);
  assert.ok(summer818.every((g) => g.idx.length === 10 * STEPS_PER_HOUR));
  // A flat 100 kW all year: contract 12 x 7.94 x 100 plus the as-used days.
  const bill = billFor({ ...buildStack({ modality: 'ftm', account: { sc: 9, rateNo: 4, voltage: 'lt', standby: true }, region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 0, supply: { mode: 'coned_mhp' }, valueStack: { network: 'CHELSEA' } }, data) }, new Float64Array(idx.T).fill(100));
  const asUsed = t.demand.charges.filter((c) => c.period === 'day').reduce((a, c) => a + c.rate * 100 * groups.filter((g) => g.charge.name === c.name).length, 0);
  assert.ok(Math.abs(bill.demandByGroup.delivery_demand - (12 * 7.94 * 100 + asUsed)) < 1e-6);
});

test('Value Stack terms: DRV window by network, Alternative 3 by month with losses, LSRV events', () => {
  const vs = buildValueStack({ election: 'value_stack', network: 'CHELSEA', lsrv: true, alt3: { hours: [15, 18], days: 10 } }, data, { region: 'nyc', zone: 'J' });
  const win = data.valueStack.drv.window_by_network.CHELSEA;
  assert.deepEqual(win, [14, 18]);
  assert.equal(vs.drv.intervals.length, drvIntervals(data.valueStack, win).length);
  for (const t of vs.drv.intervals) {
    assert.ok(idx.dow[t] < 5 && !idx.holiday[t] && idx.hour[t] >= 14 && idx.hour[t] < 18);
    const md = idx.month[t] * 100 + idx.day[t];
    assert.ok(md >= 624 && md <= 915);
  }
  const sum = Object.values(data.valueStack.alt3.by_month).reduce((a, m) => a + m.nyc, 0);
  assert.ok(Math.abs(vs.alt3.annualRate - sum * data.valueStack.loss_factor) < 1e-9);
  assert.equal(vs.alt3.days.length, 10);
  assert.ok(vs.alt3.days.every((d) => [7, 8].includes(idx.month[d.intervals[0]])));
  assert.equal(vs.lsrv.events.length, 10);
  assert.ok(Math.abs(vs.lsrv.perEvent * 10 - data.valueStack.lsrv.rate) < 1e-9);
  // Rider T or Rider AC: no DRV, no LSRV.
  for (const election of ['rider_t', 'rider_ac']) {
    const v = buildValueStack({ election, network: 'CHELSEA', lsrv: true }, data, { region: 'nyc', zone: 'J' });
    assert.equal(v.drv, null); assert.equal(v.lsrv, null);
  }
});

test('Rider R customers earn the reservation only; Auto-DLM stands alone', () => {
  const cfg = { enabled: { csrp: true, dlrp: true }, network: 'CHELSEA', pledgeKw: 200, events: { csrp: 3, dlrp: 2 } };
  const plain = buildPrograms(cfg, data, 'J'), riderR = buildPrograms(cfg, data, 'J', { riderR: true });
  assert.ok(plain.programs.every((p) => p.performanceRate > 0));
  assert.ok(riderR.programs.every((p) => p.performanceRate === 0));
  for (const other of ['csrp', 'dlrp', 'term_dlm']) {
    const out = buildPrograms({ ...cfg, enabled: { auto_dlm: true, [other]: true }, autoDlm: { reservationRate: 10 }, termDlm: { reservationRate: 10 } }, data, 'J');
    assert.match(out.blocked[0] || '', /cannot be combined/, other);
  }
});

test('stand-alone battery: exports only from discharge, no charging in the DRV window, credits from the net', async () => {
  const highs = await loadHighs();
  const kw = 300, battery = { kw, kwh: 1200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 0, throughputCost: 0 };
  const cfg = { modality: 'ftm', account: chargingAccount({ modality: 'ftm', rateNo: 1, voltage: 'lt', batteryKw: kw }), region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 0,
    supply: { mode: 'coned_mhp' }, valueStack: { election: 'value_stack', network: 'CHELSEA', alt3: { hours: [15, 18], days: 10 } } };
  const stack = buildStack(cfg, data);
  const load = new Float64Array(idx.T);
  const sol = solveScenario(highs, lpInputs(stack, load, battery, false));
  for (let t = 0; t < idx.T; t++) assert.ok(!(sol.imp[t] > 1e-6 && sol.exp[t] > 1e-6), `interval ${t} imports and exports`);
  for (const t of stack.valueStack.drv.intervals) assert.ok(sol.ch[t] < 1e-6, `charging at ${t} in the DRV window`);
  const c = valueStackCredits(stack.valueStack, sol.imp, sol.exp);
  assert.ok(sol.alt3Kw > 0.9 * kw, 'commits most of its power for Alternative 3');
  assert.ok(c.alt3Kw >= sol.alt3Kw - 1e-3, 'the dispatch holds the committed kW');
  assert.ok(c.totals.drv > 0 && c.totals.energy > 0);
  const bill = billFor(stack, sol.imp);
  assert.ok(c.total > bill.total, 'credits beat the charging bill');
});
