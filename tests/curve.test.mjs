// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import loadHighs from '../vendor/highs/highs.mjs';
import { unzipSync, strFromU8 } from '../vendor/fflate/fflate.mjs';
import { buildStack, billFor, lpInputs, chargingAccount, programRevenue, summarize } from '../js/model.js';
import { solveScenario } from '../js/lp.js';
import { valueStackCredits } from '../js/valuestack.js';
import { CURVE_LEVELS, atLevel, curvePoint, capacityCurve } from '../js/curve.js';
import { proformaData, fillProforma } from '../js/proforma.js';
import { runSnapshot } from '../js/project.js';
import { LAYOUT, CURVE_COLS, colOf, WIZ_SHEET } from '../js/wizardsheet.js';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: { ...read('tariffs_sc8.json'), ...read('tariffs_sc9.json'), ...read('tariffs_sc2.json') }, statements: read('statements_sc8.json'), msc: read('msc_sc8.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'), valueStack: read('value_stack.json'),
};
const template = readFileSync(new URL('../templates/proforma.xlsx', import.meta.url));
const cell = (xml, ref) => (xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`, 's')) || [])[1] || '';
const num = (xml, ref) => +((cell(xml, ref).match(/<v>([^<]*)<\/v>/) || [])[1]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// A stand-alone battery solves hour by hour, so five levels take a few seconds.
async function ftmCurve() {
  const highs = await loadHighs();
  const battery = { kw: 300, kwh: 1200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 365, throughputCost: 0 };
  const stack = buildStack({ modality: 'ftm', account: chargingAccount({ modality: 'ftm', rateNo: 1, voltage: 'lt', batteryKw: 300 }), region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5,
    supply: { mode: 'coned_mhp' }, valueStack: { election: 'value_stack', network: 'CHELSEA', alt3: { hours: [15, 18], days: 10 } } }, data);
  const load = new Float64Array(stack.idx.T);
  const b0 = billFor(stack, load);
  const baseline = { ...b0, energy: 0, demand: 0, fixed: 0, total: 0, peaks: b0.peaks.map((p) => ({ ...p, cost: 0 })) };
  const runs = CURVE_LEVELS.map((level) => { const inp = lpInputs(stack, load, atLevel(battery, level), false); return { level, inp, sol: solveScenario(highs, inp) }; });
  const curve = capacityCurve(runs.map((r) => curvePoint({ ...r, stack, load, battery, baseline })));
  return { stack, load, battery, baseline, runs, curve };
}

test('capacity curve: each level solved again with less usable energy; its streams add up; shares of full', async () => {
  const { stack, load, battery, baseline, runs, curve } = await ftmCurve();
  const L = curve.levels;
  assert.deepEqual(L.map((p) => p.level), CURVE_LEVELS);
  L.forEach((p, i) => {
    near(p.usableKwh, battery.kwh * battery.usableFrac * p.level, 1e-9, 'usable kWh');
    near(p.demand + p.energy + p.programs + p.exportCredits + p.capacityCredits + p.accountChange, p.net, 1e-6, `streams at ${p.level}`);
    near(p.monthlyNet.reduce((a, v) => a + v, 0), p.net, 1e-6, `months at ${p.level}`);
    if (i) assert.ok(p.net < L[i - 1].net, `less energy, less benefit at ${p.level}`);
  });
  for (const k of ['netShare', 'demandShare', 'energyShare', 'programsShare', 'vsShare']) assert.equal(L[0][k], 1, k);
  near(L[4].netShare, L[4].net / L[0].net, 1e-12, 'net share');
  assert.equal(L[0].programsShare, 1, 'no programs: share 1');
  // The full-capacity point is the run's own result.
  const { sol, inp } = runs[0];
  const withB = billFor(stack, sol.imp), credits = valueStackCredits(stack.valueStack, sol.imp, sol.exp);
  const S = summarize(stack, load, battery, baseline, withB, null, inp, sol, programRevenue(stack, inp, sol), credits);
  near(L[0].net, S.savingsTotal, 1e-9, 'Year 1 net');
  near(L[0].exportCredits + L[0].capacityCredits, credits.total, 1e-9, 'credits');
  // A kept run keeps its curve.
  const snap = JSON.parse(JSON.stringify(runSnapshot({ sol, summary: S, curve, runAt: 'x', config: 'y' }, '2026-10-07')));
  assert.deepEqual(snap.curve.levels.map((p) => p.net), L.map((p) => p.net));
});

test('pro-forma: the capacity curve on Wizard_Import, and the cash flow follows it from the degradation inputs', async () => {
  const { stack, load, battery, baseline, runs, curve } = await ftmCurve();
  const { sol, inp } = runs[0];
  const withB = billFor(stack, sol.imp), revenue = programRevenue(stack, inp, sol), credits = valueStackCredits(stack.valueStack, sol.imp, sol.exp);
  const summary = summarize(stack, load, battery, baseline, withB, null, inp, sol, revenue, credits);
  const files = unzipSync(fillProforma(template, proformaData({ stack, load, sol, summary, revenue, battery, credits, baseline, withB }, { curve })));
  const wiz = strFromU8(files['xl/worksheets/sheet7.xml']), cf = strFromU8(files['xl/worksheets/sheet5.xml']), inputs = strFromU8(files['xl/worksheets/sheet1.xml']);
  const C = LAYOUT.curve, at = (key, i) => `${colOf(CURVE_COLS, key)}${C.first + i}`;
  CURVE_LEVELS.forEach((level, i) => {
    assert.equal(num(wiz, at('level', i)), level);
    near(num(wiz, at('net', i)), curve.levels[i].net, 1e-6, 'net');
    near(num(wiz, at('vsShare', i)), curve.levels[i].vsShare, 1e-12, 'Value Stack share');
  });
  near(num(wiz, `C${LAYOUT.curveMonthly.first + 6}`), curve.levels[0].monthlyNet[6], 1e-6, 'July at 100%');
  // P: capacity left (C24 compounding, a C26 replacement restoring it); Q:T interpolate the shares; D:G take them.
  const range = (key) => `${WIZ_SHEET}!\\$${colOf(CURVE_COLS, key)}\\$${C.first}:\\$${colOf(CURVE_COLS, key)}\\$${C.last}`;
  assert.match(cell(cf, 'P7'), /N\(Inputs!\$C\$24\)/);
  assert.match(cell(cf, 'P7'), /N\(Inputs!\$C\$26\)/);
  for (const [c, key] of [['Q', 'demandShare'], ['R', 'energyShare'], ['S', 'programsShare'], ['T', 'vsShare']]) {
    assert.match(cell(cf, `${c}7`), new RegExp(`MATCH\\(MAX\\(MIN\\(${range('level')}\\)`), c);
    assert.match(cell(cf, `${c}7`), new RegExp(`INDEX\\(${range(key)},`), c);
  }
  assert.match(cell(cf, 'D7'), /\^\(\$B7-Inputs!\$C\$69\)\*\$Q7/);
  assert.match(cell(cf, 'E7'), /\*\$R7/);
  assert.match(cell(cf, 'F7'), /Value_Streams!\$K\$18\*\$S7/);
  assert.match(cell(cf, 'G7'), /\(Value_Streams!\$L\$18\+Value_Streams!\$M\$18\+Value_Streams!\$N\$18\)\*\$T7/);
  assert.match(cell(cf, 'G31'), /\*\$T31/);
  assert.match(cell(inputs, 'E24'), /capacity curve/);
});
