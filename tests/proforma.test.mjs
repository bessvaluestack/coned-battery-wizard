// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../vendor/fflate/fflate.mjs';
import { buildStack, billFor, summarize } from '../js/model.js';
import { proformaData, fillProforma } from '../js/proforma.js';
import { bannedWords } from '../scripts/build.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: read('tariffs_sc8.json'), statements: read('statements_sc8.json'), msc: read('msc_sc8.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'),
};
const template = readFileSync(new URL('../templates/proforma.xlsx', import.meta.url));
const cell = (xml, ref) => (xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`, 's')) || [])[1] || '';
const num = (xml, ref) => +((cell(xml, ref).match(/<v>([^<]*)<\/v>/) || [])[1]);

test('template: recalculates on open, no calc chain, no author or local path, no internal names', () => {
  const files = unzipSync(template);
  assert.ok(!files['xl/calcChain.xml']);
  const wb = strFromU8(files['xl/workbook.xml']);
  assert.match(wb, /fullCalcOnLoad="1"/);
  assert.doesNotMatch(wb, /absPath/);
  assert.doesNotMatch(strFromU8(files['docProps/core.xml']), /lastModifiedBy/);
  for (const [p, bytes] of Object.entries(files)) if (/\.xml$|\.rels$/.test(p)) assert.deepEqual(bannedWords(strFromU8(bytes)), [], p);
});

test('fill: hourly profiles, rates, savings and program revenue land in their cells', () => {
  const stack = buildStack({ rateNo: 1, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_msc' } }, data);
  const load = Float64Array.from(read('profiles/midrise_gas_windowac.json').kw);
  // A stand-in dispatch: shave 10% off every evening, charge it back overnight.
  const imp = Float64Array.from(load, (kw, t) => { const hr = Math.floor((t % 96) / 4); return hr >= 17 && hr < 21 ? kw * 0.9 : hr < 4 ? kw + 20 : kw; });
  const sol = { imp, dis: new Float64Array(load.length) };
  const battery = { kw: 100, kwh: 200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 250, throughputCost: 0 };
  const base = billFor(stack, load), withB = billFor(stack, imp);
  const revenue = { total: 3000, streams: [{ id: 'csrp', reservation: 2500, performance: 500, eventKw: [50, 75], eventDays: ['7/14', '8/3'], hours: [14, 18], terms: { performanceRate: 1 } }] };
  const summary = summarize(stack, load, battery, base, withB, null, null, sol, revenue);
  const months = Array.from({ length: 12 }, (_, m) => 10000 + m * 100);
  const d = proformaData({ stack, load, sol, summary, revenue, battery }, { rateLabel: 'SC 8 Rate I LT', programMonths: { csrp: [5, 6, 7, 8, 9] }, monthlyBills: months });
  const files = unzipSync(fillProforma(template, d));
  const [inputs, rates, hourly, vs] = [1, 2, 3, 4].map((n) => strFromU8(files[`xl/worksheets/sheet${n}.xml`]));

  assert.equal(num(inputs, 'C16'), 100);
  assert.match(cell(inputs, 'C10'), /SC 8 Rate I LT/);
  // Every hour filled; baseline minus dispatch is the hour's mean import.
  assert.equal((hourly.match(/<c r="H\d+" s="34"><v>/g) || []).length, 8760);
  for (const h of [0, 18, 4000, 8759]) {
    const r = 6 + h, meanImp = (imp[4 * h] + imp[4 * h + 1] + imp[4 * h + 2] + imp[4 * h + 3]) / 4;
    assert.ok(Math.abs(num(hourly, `D${r}`) - num(hourly, `E${r}`) - meanImp) < 1e-4, `hour ${h}`);
  }
  assert.ok(num(hourly, 'E7') < 0, '1 am charging is a negative dispatch');
  assert.ok(num(hourly, 'E24') > 0, '6 pm shaving is a positive dispatch');
  assert.equal(num(rates, 'C17'), 11100);
  const program = Array.from({ length: 12 }, (_, m) => num(vs, `K${6 + m}`));
  assert.ok(Math.abs(program.reduce((a, v) => a + v, 0) - 2500 - 50 * 4 - 75 * 4) < 1e-9);
  assert.equal(program[0], 0);
  assert.ok(Math.abs(program[6] - (500 + 200)) < 1e-9); // July: a fifth of the reservation + the 7/14 event
  const demandSaved = summary.monthly.reduce((a, m) => a + (m.demandBefore - m.demandAfter), 0) * stack.taxFactor;
  const g = Array.from({ length: 12 }, (_, m) => num(vs, `G${6 + m}`)).reduce((a, v) => a + v, 0);
  assert.ok(Math.abs(g - demandSaved) < 1e-6);
});
