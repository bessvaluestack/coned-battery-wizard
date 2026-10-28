// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../vendor/fflate/fflate.mjs';
import { buildStack, billFor, summarize, chargingAccount } from '../js/model.js';
import { valueStackCredits } from '../js/valuestack.js';
import { proformaData, fillProforma } from '../js/proforma.js';
import { fieldCell, monthCell, termCell, UTILITY_COLS, PROGRAM_COLS, VS_COLS, LAYOUT, WIZ_SHEET } from '../js/wizardsheet.js';
import { projectFile, readProjectFile, fingerprint, newProject } from '../js/project.js';
import { bannedWords } from '../scripts/build.mjs';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = {
  tariffs: { ...read('tariffs_sc8.json'), ...read('tariffs_sc9.json'), ...read('tariffs_sc2.json') }, statements: read('statements.json'), msc: read('msc.json'),
  lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json'), valueStack: read('value_stack.json'),
};
const template = readFileSync(new URL('../templates/proforma.xlsx', import.meta.url));
const cell = (xml, ref) => (xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`, 's')) || [])[1] || '';
const num = (xml, ref) => +((cell(xml, ref).match(/<v>([^<]*)<\/v>/) || [])[1]);
const text = (xml, ref) => ((cell(xml, ref).match(/<t[^>]*>([^<]*)<\/t>/) || [])[1] || '');
const sheets = (files) => Object.fromEntries([['inputs', 1], ['rates', 2], ['hourly', 3], ['vs', 4], ['cf', 5], ['out', 6], ['wiz', 7]].map(([k, n]) => [k, strFromU8(files[`xl/worksheets/sheet${n}.xml`])]));

test('template: recalculates on open, no calc chain, no author or local path, no internal names', () => {
  const files = unzipSync(template);
  assert.ok(!files['xl/calcChain.xml']);
  const wb = strFromU8(files['xl/workbook.xml']);
  assert.match(wb, /fullCalcOnLoad="1"/);
  assert.doesNotMatch(wb, /absPath/);
  assert.doesNotMatch(strFromU8(files['docProps/core.xml']), /lastModifiedBy/);
  for (const [p, bytes] of Object.entries(files)) if (/\.xml$|\.rels$/.test(p)) assert.deepEqual(bannedWords(strFromU8(bytes)), [], p);
});

test('template: no sample project; zero where the notes say "none"', () => {
  const files = unzipSync(template);
  const inputs = strFromU8(files['xl/worksheets/sheet1.xml']);
  for (const ref of ['C6', 'C7', 'C8', 'C22', 'C25', 'C32', 'C38', 'C42', 'C43', 'C48', 'C52']) assert.equal(cell(inputs, ref), '', ref);
  for (const ref of ['C26', 'C27', 'C28', 'C29', 'C47']) assert.equal(num(inputs, ref), 0, ref);
  assert.match(cell(inputs, 'C46'), /Flat annual/);
  // Every shared string left with text is one some cell still uses.
  const used = new Set();
  for (const [p, bytes] of Object.entries(files)) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(p)) for (const [, i] of strFromU8(bytes).matchAll(/t="s"[^>]*><v>(\d+)<\/v>/g)) used.add(+i);
  [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>(.*?)<\/si>/gs)].forEach(([, s], i) => {
    if (!used.has(i)) assert.equal(s.replace(/<[^>]+>/g, ''), '', `shared string ${i}`);
  });
});

test('fill: the wizard writes Wizard_Import and the hourly rows; the model links to them', () => {
  const stack = buildStack({ rateNo: 1, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_msc' } }, data);
  const load = Float64Array.from(read('profiles/midrise_gas_windowac.json').kw);
  // A stand-in dispatch: shave 10% off every evening, charge it back overnight.
  const imp = Float64Array.from(load, (kw, t) => { const hr = Math.floor((t % 96) / 4); return hr >= 17 && hr < 21 ? kw * 0.9 : hr < 4 ? kw + 20 : kw; });
  const sol = { imp, dis: new Float64Array(load.length) };
  const battery = { kw: 100, kwh: 200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 250, throughputCost: 0 };
  const base = billFor(stack, load), withB = billFor(stack, imp);
  const revenue = { total: 3000, streams: [{ id: 'csrp', pledgeKw: 100, deliveredKw: 50, factor: 0.5, events: 2, reservation: 2500, performance: 500, eventKw: [50, 75], eventPerfKwh: [200, 300], eventDays: ['7/14', '8/3'], hours: [14, 18], terms: { performanceRate: 1, reservationRate: 18 } }] };
  const summary = summarize(stack, load, battery, base, withB, null, null, sol, revenue);
  const months = Array.from({ length: 12 }, (_, m) => 10000 + m * 100);
  const run = { stack, load, sol, summary, revenue, battery, baseline: base, withB };
  const project = { id: 'p-123', name: 'Test building', config: 'abcd1234', run: '2026-10-18T12:00:00Z', rate: 'SC 8 Rate I LT' };
  const d = proformaData(run, { project, programMonths: { csrp: [5, 6, 7, 8, 9] }, monthlyBills: months, installedCost: 400000 });
  const S = sheets(unzipSync(fillProforma(template, d)));

  // Project and battery land on Wizard_Import; the model's cells are links to them.
  assert.equal(text(S.wiz, fieldCell('project', 'id')), 'p-123');
  assert.equal(text(S.wiz, fieldCell('project', 'name')), 'Test building');
  assert.equal(text(S.wiz, fieldCell('project', 'rate')), 'SC 8 Rate I LT');
  assert.equal(num(S.wiz, fieldCell('battery', 'kw')), 100);
  assert.match(cell(S.inputs, 'C16'), new RegExp(`${WIZ_SHEET}!\\$C\\$${LAYOUT.battery.rows.kw}`));
  assert.match(cell(S.inputs, 'C10'), new RegExp(`${WIZ_SHEET}!\\$C\\$${LAYOUT.project.rows.rate}`));
  // The installed cost is all-in: first capital line, the rest zero; none entered leaves them blank.
  assert.deepEqual(['C32', 'C33', 'C34', 'C35', 'C36', 'C37', 'C38'].map((r) => num(S.inputs, r)), [400000, 0, 0, 0, 0, 0, 0]);
  assert.ok(!('C32' in proformaData(run, {}).inputs));
  // Every hour filled; baseline minus dispatch is the hour's mean import.
  assert.equal((S.hourly.match(/<c r="H\d+" s="34"><v>/g) || []).length, 8760);
  for (const h of [0, 18, 4000, 8759]) {
    const r = 6 + h, meanImp = (imp[4 * h] + imp[4 * h + 1] + imp[4 * h + 2] + imp[4 * h + 3]) / 4;
    assert.ok(Math.abs(num(S.hourly, `D${r}`) - num(S.hourly, `E${r}`) - meanImp) < 1e-4, `hour ${h}`);
  }
  assert.ok(num(S.hourly, 'E7') < 0, '1 am charging is a negative dispatch');
  assert.ok(num(S.hourly, 'E24') > 0, '6 pm shaving is a positive dispatch');
  // The monthly bill: demand, energy and fixed add up to the bill savings, month by month and for the year.
  const u = (k, m) => num(S.wiz, monthCell('utility', UTILITY_COLS, k, m));
  let total = 0;
  for (let m = 0; m < 12; m++) {
    assert.ok(Math.abs(u('billSav', m) - u('demandSav', m) - u('energySav', m) - u('fixedChange', m)) < 1e-6);
    total += u('billSav', m);
  }
  assert.ok(Math.abs(total - summary.savingsBill) < 1e-6);
  assert.ok(Math.abs(num(S.wiz, fieldCell('summary', 'billSavings')) - summary.savingsBill) < 1e-6);
  assert.equal(u('actualBill', 11), 11100);
  assert.match(cell(S.vs, 'G6'), new RegExp(`${WIZ_SHEET}!\\$J\\$${LAYOUT.utility.first}`));
  assert.match(cell(S.rates, 'C17'), new RegExp(`${WIZ_SHEET}!\\$S\\$${LAYOUT.utility.first + 11}`));
  // Program revenue by program and month.
  const p = (k, m) => num(S.wiz, monthCell('programs', PROGRAM_COLS, k, m));
  assert.ok(Math.abs(Array.from({ length: 12 }, (_, m) => p('total', m)).reduce((a, v) => a + v, 0) - 3000) < 1e-9);
  assert.ok(Math.abs(p('csrpRes', 6) - 500) < 1e-9 && Math.abs(p('csrpPerf', 6) - 200) < 1e-9); // July: a fifth of the reservation + the 7/14 event
  assert.equal(p('total', 0), 0);
  assert.equal(num(S.wiz, termCell('pledge', 'csrp')), 100);
  assert.match(cell(S.vs, "K12"), new RegExp(`${WIZ_SHEET}!\\$K\\$${LAYOUT.programs.first + 6}`));
  // The demand determinants add up to the demand savings.
  const demandSaved = Array.from({ length: 12 }, (_, m) => u('demandSav', m)).reduce((a, v) => a + v, 0);
  let detSav = 0; for (let i = 0; i < 144; i++) { const v = num(S.wiz, `L${LAYOUT.demand.first + i}`); if (Number.isFinite(v)) detSav += v; }
  assert.ok(Math.abs(detSav - demandSaved) < 1e-6);
  assert.match(S.wiz, /<sheetProtection sheet="1"/);
});

test('project file: saves the inputs and the upload, opens back, and the fingerprint follows the configuration', () => {
  const state = { step: 3, project: newProject('Riverside Towers'), modality: 'btm', battery: { kw: 200 } };
  const upload = { name: 'meter.csv', meta: { rows: 35040 }, kw: Float64Array.from({ length: 35040 }, (_, t) => 100 + (t % 96)) };
  const doc = readProjectFile(JSON.stringify(projectFile(state, upload)));
  assert.equal(doc.project.id, state.project.id);
  assert.equal(doc.inputs.step, undefined);
  assert.equal(doc.inputs.battery.kw, 200);
  assert.equal(doc.upload.kw.length, 35040);
  assert.equal(doc.upload.kw[95], 195);
  assert.throws(() => readProjectFile('{"format":"something else"}'), /not a Con Edison Battery Wizard project/);
  assert.equal(fingerprint({ a: 1, b: [1, 2] }), fingerprint({ b: [1, 2], a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('template: Value Stack columns, the export flag and the cash-flow stream', () => {
  const files = unzipSync(template);
  const [inputs, , hourly, vs, cf, out] = [1, 2, 3, 4, 5, 6].map((n) => strFromU8(files[`xl/worksheets/sheet${n}.xml`]));
  assert.match(cell(inputs, 'C14'), new RegExp(`${WIZ_SHEET}!\\$C\\$${LAYOUT.project.rows.exports}\\)?=TRUE`));
  assert.match(cell(inputs, 'C62'), /OR\(C59=\$C\$68,C14=TRUE\)/);
  assert.match(cell(inputs, 'C65'), /AND\(C59&gt;C68,C14&lt;&gt;TRUE\)/);
  for (const [ref, text] of [['L5', 'Export credits'], ['M5', 'Capacity'], ['N5', 'Account change']]) assert.match(cell(vs, ref), new RegExp(text), ref);
  assert.match(cell(vs, 'L6'), /Hourly_Operations!\$K\$6:\$K\$8765/);
  assert.match(cell(vs, 'P18'), /SUM\(G18,J18,K18,L18,M18,N18,O18\)/);
  assert.match(cell(hourly, 'K6'), /F6&lt;Inputs!\$C\$68\),-F6\*L6/);
  assert.match(hourly, /<c r="L8765" s="34"\/>/);
  assert.match(cell(cf, 'G7'), /Value_Streams!\$L\$18\+Value_Streams!\$M\$18\+Value_Streams!\$N\$18/);
  assert.match(cell(cf, 'L7'), /SUM\(C7:G7,J7:K7\)/);
  assert.match(cell(out, 'C13'), /Value_Streams!L18/);
});

test('fill: a stand-alone battery sets the export flag, the export credit rates and the capacity months', () => {
  const account = chargingAccount({ modality: 'ftm', rateNo: 1, voltage: 'lt', batteryKw: 200 });
  const stack = buildStack({ modality: 'ftm', account, region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_mhp' },
    valueStack: { election: 'value_stack', network: 'CHELSEA', alt3: { hours: [15, 18], days: 10 } } }, data);
  const T = stack.idx.T, load = new Float64Array(T);
  // Charge 100 kW 1-3 am, export 200 kW in the DRV window (14-18) and the Alternative 3 band.
  const imp = new Float64Array(T), exp = new Float64Array(T);
  for (let t = 0; t < T; t++) { const h = stack.idx.hour[t]; if (h >= 1 && h < 3) imp[t] = 100; if (h >= 14 && h < 18) exp[t] = 50; }
  const sol = { imp, exp, dis: exp, ch: imp };
  const battery = { kw: 200, kwh: 400, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 0, throughputCost: 0 };
  const zeroBill = { ...billFor(stack, load), fixed: 0, total: 0 };
  const withB = billFor(stack, imp), credits = valueStackCredits(stack.valueStack, imp, exp);
  const summary = summarize(stack, load, battery, zeroBill, withB, null, null, sol, { total: 0, streams: [] }, credits);
  const d = proformaData({ stack, load, sol, summary, revenue: { total: 0, streams: [] }, battery, credits, baseline: zeroBill, withB }, { project: { rate: 'SC 9 Rate I LT' }, election: 'Keep the DRV' });
  const S = sheets(unzipSync(fillProforma(template, d)));
  assert.match(cell(S.wiz, fieldCell('project', 'exports')), /t="b"|<v>1<\/v>/);
  assert.equal(num(S.wiz, fieldCell('project', 'exports')), 1);
  const drvHour = stack.valueStack.drv.intervals[0] / 4, r = 6 + drvHour;
  assert.ok(Math.abs(num(S.hourly, `L${r}`) - (stack.valueStack.energyPrice[drvHour * 4] + stack.valueStack.drv.rate)) < 1e-12);
  assert.ok(Math.abs(num(S.hourly, `D${r}`) - num(S.hourly, `E${r}`) + 50) < 1e-9, 'net grid demand is the export, negative');
  const v = (k) => Array.from({ length: 12 }, (_, i) => num(S.wiz, monthCell('vs', VS_COLS, k, i))).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(v('alt3') - credits.totals.alt3) < 1e-6);
  assert.ok(Math.abs(v('total') - credits.total) < 1e-6);
  const u = (k) => Array.from({ length: 12 }, (_, i) => num(S.wiz, monthCell('utility', UTILITY_COLS, k, i))).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(u('fixedChange') + withB.fixed * stack.taxFactor) < 1e-6, 'the new account\'s customer charge');
  assert.ok(Math.abs(u('billSav') + withB.total) < 1e-6, 'a stand-alone battery\'s bill is all cost');
  assert.match(cell(S.vs, 'M6'), new RegExp(`${WIZ_SHEET}!\\$F\\$${LAYOUT.vs.first}`));
});
