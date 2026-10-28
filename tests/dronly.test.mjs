// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import loadHighs from '../vendor/highs/highs.mjs';
import { buildStack, billFor, lpInputs, programRevenue } from '../js/model.js';
import { buildLP, extractSolution, solveScenario } from '../js/lp.js';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: { ...read('tariffs_sc8.json'), ...read('tariffs_sc9.json'), ...read('tariffs_sc2.json') }, statements: read('statements.json'), msc: read('msc.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'), valueStack: read('value_stack.json'),
};

test('LP: with discharge allowed only in some intervals, the battery discharges there and nowhere else', async () => {
  const highs = await loadHighs();
  const n = 2 * 96;
  const load = new Float64Array(n).fill(100);
  for (let t = 96 + 72; t < 96 + 80; t++) load[t] = 150; // a spike 18:00-20:00 on day 2
  const inp = { load, price: new Float64Array(n).fill(0.1), peakTerms: [{ key: 'all', rate: 40, idx: Int32Array.from({ length: n }, (_, i) => i) }],
    battery: { kw: 50, kwh: 100, rte: 0.85, usableFrac: 1, cyclesPerYear: 365, throughputCost: 0 }, dt: 0.25, demandIntervalMin: 15, programs: null, taxFactor: 1,
    dischargeAllowed: Int32Array.from({ length: 8 }, (_, k) => 40 + k) }; // 10:00-12:00 on day 1, not the spike
  const r = extractSolution(highs.solve(buildLP(inp), { output_flag: false }), inp);
  for (let t = 0; t < n; t++) if (t < 40 || t >= 48) assert.ok(r.dis[t] < 1e-9, `discharge at ${t}`);
  assert.ok(Math.max(...r.imp.slice(96 + 72, 96 + 80)) > 149.9, 'the spike is not shaved');
});

test('demand response only: discharge only in events, the programs still paid, the bill and programs together worth more', async () => {
  const highs = await loadHighs();
  const programs = { enabled: { csrp: true, dlrp: true }, network: 'YORKVILLE', pledgeKw: 100, participation: 'direct', events: { csrp: 3, dlrp: 2 } };
  const cfg = (dispatch) => ({ modality: 'btm', rateNo: 1, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_msc' }, programs: { ...programs, dispatch } });
  const load = Float64Array.from(read('profiles/highrise_central_cooling.json').kw);
  const battery = { kw: 200, kwh: 600, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 300, throughputCost: 0 };
  const dr = buildStack(cfg('dr_only'), data), both = buildStack(cfg(undefined), data);
  assert.equal(dr.drOnly, true);
  assert.equal(both.drOnly, false);
  assert.equal(buildStack({ ...cfg('dr_only'), modality: 'btm_vs', valueStack: { election: 'rider_t', network: 'YORKVILLE', alt3: { hours: [15, 18], days: 10 } } }, data).drOnly, false, 'behind the meter without exports only');
  const inpDr = lpInputs(dr, load, battery, true), inpBoth = lpInputs(dr, load, battery, true, { drOnly: false });
  assert.ok(inpDr.dischargeAllowed.length > 0 && inpBoth.dischargeAllowed === null);
  const solDr = solveScenario(highs, inpDr), solBoth = solveScenario(highs, inpBoth);
  const allowed = new Set(inpDr.dischargeAllowed);
  for (let t = 0; t < load.length; t++) if (!allowed.has(t)) assert.ok(solDr.dis[t] < 1e-6, `discharge at ${t} outside the events`);
  const base = billFor(dr, load).total;
  const value = (inp, sol) => ({ bill: base - billFor(dr, sol.imp).total, programs: programRevenue(dr, inp, sol).total });
  const a = value(inpDr, solDr), b = value(inpBoth, solBoth);
  assert.ok(a.programs > 0.9 * b.programs, `programs ${a.programs} vs ${b.programs}`);
  assert.ok(b.bill > a.bill + 1000, `the bill: ${a.bill} alone vs ${b.bill} together`);
  assert.ok(b.bill + b.programs > a.bill + a.programs, 'together is worth more');
});
