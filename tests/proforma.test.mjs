// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../vendor/fflate/fflate.mjs';
import { buildStack, billFor, summarize, chargingAccount } from '../js/model.js';
import { valueStackCredits } from '../js/valuestack.js';
import { proformaData, fillProforma, CAPITAL_CELLS, tariffCalendar } from '../js/proforma.js';
import { sheetPaths } from '../js/xlsx.js';
import { fieldCell, monthCell, termCell, colOf, UTILITY_COLS, PROGRAM_COLS, VS_COLS, PEAK_MATCH_COLS, SEASON_COLS, TOU_COLS, HOURLY_COLS, LAYOUT, WIZ_SHEET } from '../js/wizardsheet.js';
import { peakMatchFor } from '../js/peakmatch.js';
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
const SHEET_KEYS = { inputs: 'Inputs', rates: 'Utility_Rates', hourly: 'Hourly_Operations', vs: 'Value_Streams', cf: 'Project_Cash_Flow', out: 'Outputs', wiz: WIZ_SHEET };
const sheets = (files) => { const P = sheetPaths(files); return Object.fromEntries(Object.entries(SHEET_KEYS).map(([k, n]) => [k, strFromU8(files[P[n]])])); };
// Hour h's cell in the hourly block on Wizard_Import.
const hourCell = (key, h) => `${colOf(HOURLY_COLS, key)}${LAYOUT.hourlyData.first + h}`;
const link = (c) => new RegExp(`${WIZ_SHEET}!\\$?${c.replace(/(\d+)/, '\\$?$1')}(?!\\d)`);

test('template: recalculates on open, automatically; no calc chain, no author or local path, no internal names', () => {
  const files = unzipSync(template);
  assert.ok(!files['xl/calcChain.xml']);
  const wb = strFromU8(files['xl/workbook.xml']);
  assert.match(wb, /fullCalcOnLoad="1"/);
  assert.doesNotMatch(wb, /absPath|calcMode="manual"/);
  assert.doesNotMatch(strFromU8(files['docProps/core.xml']), /lastModifiedBy/);
  for (const [p, bytes] of Object.entries(files)) if (/\.xml$|\.rels$/.test(p)) assert.deepEqual(bannedWords(strFromU8(bytes)), [], p);
});

test('template: no sample project; the model\'s general assumptions stay', () => {
  const files = unzipSync(template);
  const { inputs, wiz } = sheets(files);
  for (const ref of ['C6', 'C7', 'C8', ...CAPITAL_CELLS, 'C50', 'C51', 'C52', 'C53', 'C54']) assert.equal(cell(inputs, ref), '', ref);
  for (const ref of ['C49', 'C61', 'C78']) assert.equal(num(inputs, ref), 0, ref);
  for (const ref of ['C24', 'C44', 'C45', 'C58']) assert.ok(Number.isFinite(num(inputs, ref)), ref);
  assert.doesNotMatch(strFromU8(files['xl/sharedStrings.xml']), /Southchester|New Rochelle/);
  assert.doesNotMatch(wiz, /<hyperlink|b5ee2e6b/, 'no sample project left on Wizard_Import');
  // Every shared string left with text is one some cell still uses.
  const used = new Set();
  for (const [p, bytes] of Object.entries(files)) if (/^xl\/worksheets\/sheet\d+\.xml$/.test(p)) for (const [, i] of strFromU8(bytes).matchAll(/t="s"[^>]*><v>(\d+)<\/v>/g)) used.add(+i);
  [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>(.*?)<\/si>/gs)].forEach(([, s], i) => {
    if (!used.has(i)) assert.equal(s.replace(/<[^>]+>/g, ''), '', `shared string ${i}`);
  });
});

test('template: the model\'s inputs the wizard provides link to Wizard_Import; the capacity curve block below it stays put', () => {
  const S = sheets(unzipSync(template));
  for (const [c, key] of [['D', 'baseline'], ['E', 'dispatch'], ['H', 'rate'], ['L', 'exportRate']]) {
    assert.match(cell(S.hourly, `${c}6`), link(hourCell(key, 0)), `${c}6`);
    assert.match(cell(S.hourly, `${c}8765`), link(hourCell(key, 8759)), `${c}8765`);
    assert.equal((S.hourly.match(new RegExp(`<c r="${c}\\d+" s="\\d+"><f>IF\\(ISNUMBER\\(${WIZ_SHEET}!${colOf(HOURLY_COLS, key)}\\d+\\)`, 'g')) || []).length, 8760, c);
  }
  for (const m of [0, 5, 11]) assert.match(cell(S.rates, `K${6 + m}`), link(monthCell('season', SEASON_COLS, 'season', m)));
  assert.match(cell(S.rates, 'C29'), link(`${colOf(TOU_COLS, 'summerWeekday')}${LAYOUT.tou.first}`));
  assert.match(cell(S.rates, 'F52'), link(`${colOf(TOU_COLS, 'winterWeekend')}${LAYOUT.tou.first + 23}`));
  // Value_Streams: C the peak matching efficiency, H each month's own demand savings, I the two multiplied.
  for (const m of [0, 1, 6, 11]) {
    assert.match(cell(S.vs, `C${6 + m}`), link(monthCell('peakMatch', PEAK_MATCH_COLS, 'efficiency', m)), `C${6 + m}`);
    assert.match(cell(S.vs, `H${6 + m}`), link(monthCell('utility', UTILITY_COLS, 'demandSav', m)), `H${6 + m}`);
  }
  assert.match(cell(S.vs, 'I9'), /IF\(AND\(ISNUMBER\(H9\),ISNUMBER\(C9\)\),H9\*C9,""\)/);
  assert.doesNotMatch(cell(S.vs, 'I18'), /"1"/);
  // The rest of the model's links, as it has them.
  assert.match(cell(S.inputs, 'C14'), new RegExp(`${WIZ_SHEET}!\\$C\\$${LAYOUT.project.rows.exports}\\)?=TRUE`));
  assert.match(cell(S.inputs, 'C16'), link(fieldCell('battery', 'kw')));
  assert.match(cell(S.rates, 'C17'), link(monthCell('utility', UTILITY_COLS, 'actualBill', 11)));
  assert.match(cell(S.vs, 'M12'), link(monthCell('programs', PROGRAM_COLS, 'total', 6)));
  assert.match(cell(S.vs, 'O6'), link(monthCell('vs', VS_COLS, 'alt3', 0)));
  assert.match(cell(S.vs, 'N6'), /Hourly_Operations!\$K\$6:\$K\$8765/);
  assert.match(cell(S.hourly, 'K6'), /F6&lt;Inputs!\$C\$109\),-F6\*L6/);
  assert.match(cell(S.cf, 'F109'), new RegExp(`INDEX\\(${WIZ_SHEET}!\\$L\\$${LAYOUT.curve.first}:\\$L\\$${LAYOUT.curve.last},`));
  assert.match(cell(S.cf, 'F26'), /Value_Streams!\$N\$18\+Value_Streams!\$O\$18\+Value_Streams!\$P\$18/);
  assert.match(cell(S.out, 'C13'), /Value_Streams!N18/);
  // The capacity curve by month is gone; its rows stay empty, so nothing below moved.
  for (let r = LAYOUT.curve.last + 2; r < LAYOUT.curveNote; r++) assert.doesNotMatch(S.wiz, new RegExp(`<row r="${r}"`), `row ${r}`);
  assert.equal(LAYOUT.saved.head, 298);
  assert.match(S.wiz, /<sheetProtection sheet="1"/);
});

test('fill: the wizard writes Wizard_Import, the year hour by hour included; the model links to it', () => {
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
  assert.match(cell(S.inputs, 'C10'), link(fieldCell('project', 'rate')));
  // The installed cost is all-in: first capital line, the rest zero; none entered leaves them blank.
  assert.deepEqual(CAPITAL_CELLS.map((r) => num(S.inputs, r)), [400000, 0, 0, 0, 0, 0, 0]);
  assert.match(text(S.inputs, 'E34'), /All-in installed cost/);
  assert.ok(!(CAPITAL_CELLS[0] in proformaData(run, {}).inputs));
  // Every hour on Wizard_Import; baseline minus dispatch is the hour's mean import.
  for (const key of ['baseline', 'dispatch', 'rate']) assert.ok(Number.isFinite(num(S.wiz, hourCell(key, 8759))), key);
  assert.equal(cell(S.wiz, hourCell('exportRate', 0)), '', 'no export credit rate without exports');
  for (const h of [0, 18, 4000, 8759]) {
    const meanImp = (imp[4 * h] + imp[4 * h + 1] + imp[4 * h + 2] + imp[4 * h + 3]) / 4;
    assert.ok(Math.abs(num(S.wiz, hourCell('baseline', h)) - num(S.wiz, hourCell('dispatch', h)) - meanImp) < 1e-4, `hour ${h}`);
  }
  assert.ok(num(S.wiz, hourCell('dispatch', 1)) < 0, '1 am charging is a negative dispatch');
  assert.ok(num(S.wiz, hourCell('dispatch', 18)) > 0, '6 pm shaving is a positive dispatch');
  assert.equal(num(S.wiz, hourCell('hour', 18)), 19);
  assert.equal(text(S.wiz, hourCell('start', 18)), '2027-01-01 18:00');
  assert.equal(text(S.wiz, hourCell('start', 8759)), '2027-12-31 23:00');
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
  // No peak matching computed: every month 100%, expected savings the perfect-foresight ones.
  const pm = (k, m) => num(S.wiz, monthCell('peakMatch', PEAK_MATCH_COLS, k, m));
  for (let m = 0; m < 12; m++) {
    assert.equal(pm('efficiency', m), 1);
    assert.ok(Math.abs(pm('demandExpected', m) - u('demandSav', m)) < 1e-9);
  }
  assert.match(text(S.wiz, fieldCell('peakMatchFields', 'basis')), /Not computed/);
  // The tariff calendar: Con Edison's summer, and Rate I's one period.
  assert.deepEqual(Array.from({ length: 12 }, (_, m) => text(S.wiz, monthCell('season', SEASON_COLS, 'season', m))).join(' '), 'Winter Winter Winter Winter Winter Summer Summer Summer Summer Winter Winter Winter');
  assert.equal(text(S.wiz, `${colOf(TOU_COLS, 'summerWeekday')}${LAYOUT.tou.first + 18}`), 'Off-peak');
  assert.equal(num(S.wiz, `B${LAYOUT.tou.first + 23}`), 23);
  // Program revenue by program and month.
  const p = (k, m) => num(S.wiz, monthCell('programs', PROGRAM_COLS, k, m));
  assert.ok(Math.abs(Array.from({ length: 12 }, (_, m) => p('total', m)).reduce((a, v) => a + v, 0) - 3000) < 1e-9);
  assert.ok(Math.abs(p('csrpRes', 6) - 500) < 1e-9 && Math.abs(p('csrpPerf', 6) - 200) < 1e-9); // July: a fifth of the reservation + the 7/14 event
  assert.equal(p('total', 0), 0);
  assert.equal(num(S.wiz, termCell('pledge', 'csrp')), 100);
  // The demand determinants add up to the demand savings.
  const demandSaved = Array.from({ length: 12 }, (_, m) => u('demandSav', m)).reduce((a, v) => a + v, 0);
  let detSav = 0; for (let i = 0; i < 144; i++) { const v = num(S.wiz, `L${LAYOUT.demand.first + i}`); if (Number.isFinite(v)) detSav += v; }
  assert.ok(Math.abs(detSav - demandSaved) < 1e-6);
  assert.match(S.wiz, /<sheetProtection sheet="1"/);
});

test('fill: the peak matching efficiency by month, and the expected demand savings it gives', () => {
  const stack = buildStack({ rateNo: 1, voltage: 'lt', region: 'westchester', zone: 'I', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_msc' } }, data);
  const load = Float64Array.from(read('profiles/midrise_gas_windowac.json').kw);
  const imp = Float64Array.from(load, (kw, t) => { const hr = Math.floor((t % 96) / 4); return hr >= 17 && hr < 21 ? kw * 0.85 : hr < 4 ? kw + 30 : kw; });
  const sol = { imp, dis: new Float64Array(load.length) };
  const battery = { kw: 100, kwh: 200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 0, throughputCost: 0 };
  const base = billFor(stack, load), withB = billFor(stack, imp), revenue = { total: 0, streams: [] };
  const summary = summarize(stack, load, battery, base, withB, null, null, sol, revenue);
  const peakMatch = peakMatchFor({ stack, load, battery, forecastError: 0.05 });
  const d = proformaData({ stack, load, sol, summary, revenue, battery, baseline: base, withB }, { peakMatch });
  const S = sheets(unzipSync(fillProforma(template, d)));
  const pm = (k, m) => num(S.wiz, monthCell('peakMatch', PEAK_MATCH_COLS, k, m)), u = (k, m) => num(S.wiz, monthCell('utility', UTILITY_COLS, k, m));
  for (let m = 0; m < 12; m++) {
    const e = pm('efficiency', m);
    assert.ok(e > 0.3 && e < 1, `month ${m + 1}: ${e}`);
    assert.equal(e, peakMatch.months[m].efficiency);
    assert.equal(pm('shaveDays', m), peakMatch.months[m].shaveDays);
    assert.ok(Math.abs(pm('demandExpected', m) - e * u('demandSav', m)) < 1e-9);
    assert.ok(Math.abs(pm('cutExpected', m) - e * (u('peakBase', m) - u('peakAfter', m))) < 1e-9);
  }
  assert.equal(num(S.wiz, fieldCell('peakMatchFields', 'forecastError')), 0.05);
  assert.match(text(S.wiz, fieldCell('peakMatchFields', 'basis')), /Value_Streams C/);
  assert.match(cell(S.wiz, `${colOf(PEAK_MATCH_COLS, 'efficiency')}${LAYOUT.peakMatch.total}`), /<f>/, 'the year\'s efficiency is a formula');
  // A stand-alone battery, or demand response only: nothing to derate.
  assert.equal(peakMatchFor({ stack: { ...stack, modality: 'ftm' }, load, battery }).applies, false);
  assert.equal(peakMatchFor({ stack: { ...stack, drOnly: true }, load, battery }).reason, 'dr_only');
  const flat = proformaData({ stack, load, sol, summary, revenue, battery, baseline: base, withB }, { peakMatch: peakMatchFor({ stack: { ...stack, drOnly: true }, load, battery }) });
  assert.ok(flat.wizard.peakMatch.every((r) => r.efficiency === 1));
  assert.match(flat.wizard.peakMatchFields.basis, /demand response only/);
});

test('tariff calendar: time-of-day periods from the windows of each rate', () => {
  const t9 = read('tariffs_sc9.json');
  const row = (cal, k) => cal.tou.map((x) => x[k][0]).join('');
  const r1 = tariffCalendar(t9.corpus_ced_sc9_rate1_lt), r2 = tariffCalendar(t9.corpus_ced_sc9_rate2_lt);
  assert.equal(row(r1, 'summerWeekday'), 'O'.repeat(24));
  assert.equal(row(r2, 'summerWeekday'), 'OOOOOOOOPPPPPPPPPPSSSSOO', 'summer weekday: 8-18 inside both windows, 18-22 inside one');
  assert.equal(row(r2, 'winterWeekday'), 'OOOOOOOOPPPPPPPPPPPPPPOO');
  assert.equal(row(r2, 'summerWeekend'), 'O'.repeat(24));
  assert.deepEqual(r2.season.filter((s) => s.season === 'Summer').map((s) => s.month), ['Jun', 'Jul', 'Aug', 'Sep']);
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
  const d = proformaData({ stack, load, sol, summary, revenue: { total: 0, streams: [] }, battery, credits, baseline: zeroBill, withB },
    { project: { rate: 'SC 9 Rate I LT' }, election: 'Keep the DRV', peakMatch: peakMatchFor({ stack, load, battery }) });
  const S = sheets(unzipSync(fillProforma(template, d)));
  assert.match(cell(S.wiz, fieldCell('project', 'exports')), /t="b"|<v>1<\/v>/);
  assert.equal(num(S.wiz, fieldCell('project', 'exports')), 1);
  const drvHour = stack.valueStack.drv.intervals[0] / 4;
  assert.ok(Math.abs(num(S.wiz, hourCell('exportRate', drvHour)) - (stack.valueStack.energyPrice[drvHour * 4] + stack.valueStack.drv.rate)) < 1e-12);
  assert.ok(Math.abs(num(S.wiz, hourCell('baseline', drvHour)) - num(S.wiz, hourCell('dispatch', drvHour)) + 50) < 1e-9, 'net grid demand is the export, negative');
  const v = (k) => Array.from({ length: 12 }, (_, i) => num(S.wiz, monthCell('vs', VS_COLS, k, i))).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(v('alt3') - credits.totals.alt3) < 1e-6);
  assert.ok(Math.abs(v('total') - credits.total) < 1e-6);
  const u = (k) => Array.from({ length: 12 }, (_, i) => num(S.wiz, monthCell('utility', UTILITY_COLS, k, i))).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(u('fixedChange') + withB.fixed * stack.taxFactor) < 1e-6, 'the new account\'s customer charge');
  assert.ok(Math.abs(u('billSav') + withB.total) < 1e-6, 'a stand-alone battery\'s bill is all cost');
  // No building load to shave: the efficiency is 100%, so the demand cost is not derated.
  assert.equal(num(S.wiz, monthCell('peakMatch', PEAK_MATCH_COLS, 'efficiency', 6)), 1);
  assert.match(text(S.wiz, fieldCell('peakMatchFields', 'basis')), /stand-alone/);
});
