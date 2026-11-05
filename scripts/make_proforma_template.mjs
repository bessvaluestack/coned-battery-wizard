#!/usr/bin/env node
// Derive the pro-forma template the app fills (templates/proforma.xlsx) from
// the owner's financial model in doc/. Rerun it whenever a new version of the
// model arrives:
//
//   node scripts/make_proforma_template.mjs ["doc/<model>.xlsx"]
//
// The model already links to a Wizard_Import sheet in the wizard's layout
// (js/wizardsheet.js). This script edits the sheet XML directly, so
// validations, conditional formats and dynamic-array metadata survive (a
// round trip through a spreadsheet library would drop them):
//   - Wizard_Import is laid out again from js/wizardsheet.js, every value
//     empty, in the styles the model's copy uses (protected);
//   - the model's remaining inputs that the wizard now provides become green
//     links to it: Hourly_Operations D baseline, E dispatch, H energy rate and
//     L export credit rate; Utility_Rates K season and C29:F52 TOU schedule;
//     Value_Streams C peak matching efficiency;
//   - Value_Streams H and I take each month's own demand savings (H7:H17 and
//     I7:I17 read January's and February's in v1.0);
//   - the sample project removed from Inputs (name, location, units, capital
//     costs, resiliency amounts, VPP revenue and term loan), and its strings
//     from the shared string table; the model's general assumptions stay;
//   - cached formula results and calcChain removed; automatic recalculation,
//     full recalc on open;
//   - author and local-path metadata removed.
// Each edit checks what it replaces, so a model that has moved a cell stops
// the build instead of producing a wrong template.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate/fflate.mjs';
import { colToNum, cellXml, setCells, sheetPaths } from '../js/xlsx.js';
import { WIZ_SHEET, LAYOUT, sheetCells, monthCell, ref, colOf, UTILITY_COLS, PEAK_MATCH_COLS, SEASON_COLS, TOU_COLS, HOURLY_COLS, HOURS } from '../js/wizardsheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] || join(ROOT, 'doc', 'BESS Owner Financial Calculations Template v1.0.xlsx'));
const OUT = join(ROOT, 'templates', 'proforma.xlsx');
const TOOL = 'Con Edison Battery Wizard';
const OLD_LAST_ROW = 304; // the end of the layout the model was built on (0.6.0)

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CELL = /<c r="([A-Z]+)(\d+)"(?=[ >/])([^>]*?)(?:\/>|>.*?<\/c>)/gs;
const styleOf = (attrs) => (attrs.match(/\bs="(\d+)"/) || [])[1];

// A cell's formula text (unescaped), or null.
function formulaOf(xml, cellRef) {
  const m = xml.match(new RegExp(`<c r="${cellRef}"[^>]*>(?:<f[^>]*>([^<]*)</f>)?`));
  return m && m[1] !== undefined ? unesc(m[1]) : null;
}
function styleAt(xml, cellRef) {
  const m = xml.match(new RegExp(`<c r="${cellRef}"([^>]*?)(?:/>|>)`));
  if (!m) throw new Error(`no cell ${cellRef}`);
  return styleOf(m[1]);
}
// The cell's text: an inline string, or a shared string by index.
function textAt(xml, cellRef, shared) {
  const m = xml.match(new RegExp(`<c r="${cellRef}"([^>]*?)(?:/>|>(.*?)</c>)`, 's'));
  if (!m || !m[2]) return '';
  if (/t="s"/.test(m[1])) return shared[+(m[2].match(/<v>(\d+)<\/v>/) || [])[1]] || '';
  return unesc((m[2].match(/<t[^>]*>([^<]*)<\/t>/) || [])[1] || '');
}

// Formulas for many existing cells in one pass: { D6: [formula, style] },
// the style a number or a function of the cell's own (green, say).
function setFormulasBulk(xml, cells) {
  const seen = new Set();
  const out = xml.replace(CELL, (m, c, r, attrs) => {
    const k = `${c}${r}`;
    if (!(k in cells)) return m;
    seen.add(k);
    const [f, spec] = cells[k];
    const s = typeof spec === 'function' ? spec(styleOf(attrs)) : spec;
    return `<c r="${k}" s="${s}"><f>${esc(f)}</f></c>`;
  });
  for (const k of Object.keys(cells)) if (!seen.has(k)) throw new Error(`cell ${k} not found`);
  return out;
}

// Check a cell holds what the edit expects before replacing it.
function expectFormula(xml, cellRef, pattern) {
  const f = formulaOf(xml, cellRef);
  if (f === null || !pattern.test(f)) throw new Error(`${cellRef}: expected ${pattern}, found ${f}`);
}

// Drop cached results so every app recalculates; keep the formulas.
function dropCachedValues(xml) {
  return xml.replace(/<c ([^>]*?)>(<f[^>]*?(?:\/>|>[^<]*<\/f>))(?:<v>[^<]*<\/v>|<v\/>)?<\/c>/g, (m, attrs, f) => `<c ${attrs.replace(/\s+t="[^"]*"/, '')}>${f}</c>`);
}

// ---------------------------------------------------------------- read
const files = unzipSync(readFileSync(SRC));
const read = (p) => strFromU8(files[p]);
const write = (p, s) => { files[p] = strToU8(s); };
const PATH = sheetPaths(files);
for (const name of ['Inputs', 'Utility_Rates', 'Hourly_Operations', 'Value_Streams', 'Project_Cash_Flow', WIZ_SHEET]) if (!PATH[name]) throw new Error(`the model has no ${name} sheet`);
const sheet = (name) => read(PATH[name]);
const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(([, s]) => unesc(s.replace(/<rPh\b.*?<\/rPh>/gs, '').replace(/<[^>]+>/g, '')));

// ---------------------------------------------------------------- styles
// Green (a link to another sheet): each input cell's own style with the
// font of the model's green links (Inputs C16, the battery power link).
let styles = read('xl/styles.xml');
const xfList = () => styles.match(/<cellXfs count="\d+">(.*?)<\/cellXfs>/s)[1].match(/<xf\b[^>]*?(?:\/>|>.*?<\/xf>)/gs);
const inputs0 = sheet('Inputs');
expectFormula(inputs0, 'C16', /Wizard_Import!/);
const greenFont = (xfList()[+styleAt(inputs0, 'C16')].match(/fontId="(\d+)"/) || [])[1];
const greens = new Map();
function green(style) {
  if (greens.has(style)) return greens.get(style);
  const list = xfList(), n = list.length;
  const xf = list[+style].replace(/fontId="\d+"/, `fontId="${greenFont}"`).replace(/<xf\b(?![^>]*applyFont)/, '<xf applyFont="1"');
  styles = styles.replace(/<cellXfs count="\d+">(.*?)<\/cellXfs>/s, (m, body) => `<cellXfs count="${n + 1}">${body}${xf}</cellXfs>`);
  greens.set(style, n);
  return n;
}

// ---------------------------------------------------------------- Wizard_Import
// Laid out again from js/wizardsheet.js. Each format takes the style the
// model's copy has on a cell of that format; the hourly block's fixed hour
// number and start take the int and text styles.
const wiz0 = sheet(WIZ_SHEET);
const empty = sheetCells(null);
const FMT = {};
for (const [c, [, fmt]] of Object.entries(empty)) {
  if (FMT[fmt] !== undefined || +c.match(/\d+/)[0] > OLD_LAST_ROW) continue;
  const m = wiz0.match(new RegExp(`<c r="${c}"([^>]*?)(?:/>|>)`));
  if (m && styleOf(m[1]) !== undefined) FMT[fmt] = styleOf(m[1]);
}
FMT.hourN = FMT.int; FMT.hourT = FMT.text;
for (const fmt of ['title', 'note', 'head', 'colhead', 'label', 'text', 'bool', 'int', 'num1', 'money', 'rate4', 'pct']) if (FMT[fmt] === undefined) throw new Error(`no ${WIZ_SHEET} cell styled ${fmt}`);
const byRow = new Map();
for (const [c, [value, fmt]] of Object.entries(empty)) {
  const r = +c.match(/\d+/)[0];
  if (!byRow.has(r)) byRow.set(r, []);
  byRow.get(r).push([c, value, fmt]);
}
const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
  const cs = byRow.get(r).sort((a, b) => colToNum(a[0].match(/[A-Z]+/)[0]) - colToNum(b[0].match(/[A-Z]+/)[0]));
  return `<row r="${r}">${cs.map(([c, value, fmt]) => (value && value.f ? `<c r="${c}" s="${FMT[fmt]}"><f>${esc(value.f)}</f></c>` : cellXml(c, value, FMT[fmt]))).join('')}</row>`;
}).join('');
write(PATH[WIZ_SHEET], '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheetPr><tabColor rgb="FF16324F"/></sheetPr>'
  + `<dimension ref="B2:S${LAYOUT.lastRow}"/>`
  + '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>'
  + '<cols><col min="1" max="1" width="3" customWidth="1"/><col min="2" max="2" width="44" customWidth="1"/><col min="3" max="19" width="17" customWidth="1"/></cols>'
  + `<sheetData>${rowsXml}</sheetData>`
  + '<sheetProtection sheet="1" objects="1" scenarios="1"/>'
  + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
// The model's copy had a hyperlink (the sample's saved version); the new sheet has none.
delete files[PATH[WIZ_SHEET].replace(/([^/]+)$/, '_rels/$1.rels')];

const num = (cell) => `IF(ISNUMBER(${cell}),${cell},"")`;
const txt = (cell) => `IF(${cell}="","",${cell})`;
const W = (c) => `${WIZ_SHEET}!${c}`; // relative, so a fill-down keeps working

// ---------------------------------------------------------------- Hourly_Operations
// D, E, H and L link to the year hour by hour at the end of Wizard_Import.
let ho = sheet('Hourly_Operations');
for (const [c, label] of [['D5', 'Baseline'], ['E5', 'Battery dispatch'], ['H5', 'Energy rate'], ['L5', 'Export credit rate']]) {
  if (!textAt(ho, c, shared).startsWith(label)) throw new Error(`Hourly_Operations ${c}: expected "${label}", found "${textAt(ho, c, shared)}"`);
}
{
  const H = LAYOUT.hourlyData, cells = {};
  const src = { D: colOf(HOURLY_COLS, 'baseline'), E: colOf(HOURLY_COLS, 'dispatch'), H: colOf(HOURLY_COLS, 'rate'), L: colOf(HOURLY_COLS, 'exportRate') };
  for (let h = 0; h < HOURS; h++) for (const [c, w] of Object.entries(src)) cells[`${c}${6 + h}`] = [num(W(`${w}${H.first + h}`)), green];
  ho = setFormulasBulk(ho, cells);
}
ho = setCells(ho, { B3: `Green: linked from ${WIZ_SHEET} (rows ${LAYOUT.hourlyData.first} on), which the ${TOOL} fills. D baseline and E dispatch are hourly averages of its 15-minute run (positive = discharge, net of charging, so D - E is the hour's net grid demand); H is the all-in energy rate for the hour, taxes included; L is the Value Stack credit per exported kWh (energy at LBMP x losses, plus the DRV in the call window), blank without exports.` });
write(PATH.Hourly_Operations, ho);

// ---------------------------------------------------------------- Utility_Rates
// The season column and the TOU schedule link to the tariff calendar.
let ur = sheet('Utility_Rates');
if (textAt(ur, 'K5', shared) !== 'Season' || textAt(ur, 'C28', shared) !== 'Summer weekday' || textAt(ur, 'F28', shared) !== 'Winter weekend') throw new Error('Utility_Rates: the season column or the TOU schedule has moved');
{
  const cells = {};
  for (let m = 0; m < 12; m++) cells[`K${6 + m}`] = [txt(W(monthCell('season', SEASON_COLS, 'season', m))), green];
  const T = LAYOUT.tou;
  ['summerWeekday', 'summerWeekend', 'winterWeekday', 'winterWeekend'].forEach((k, i) => {
    const c = 'CDEF'[i], w = colOf(TOU_COLS, k);
    for (let h = 0; h < 24; h++) cells[`${c}${29 + h}`] = [txt(W(`${w}${T.first + h}`)), green];
  });
  ur = setFormulasBulk(ur, cells);
}
ur = setCells(ur, {
  B3: `Green: linked from ${WIZ_SHEET}, which the ${TOOL} fills: the monthly rates, any bills entered there, each month's season and the 24-hour time-of-day schedule. Change them in the wizard and download again.`,
  B26: `Linked from ${WIZ_SHEET}: Con Edison's summer is June to September. Peak is inside every time-of-day window of the season, Shoulder inside some, Off-peak outside them all; Rate I has one period, shown as Off-peak. Weekdays include holidays.`,
  B54: 'Weekdays are Monday to Friday. The hourly energy rate (Hourly_Operations H) already prices every hour; the period is a label.',
});
write(PATH.Utility_Rates, ur);

// ---------------------------------------------------------------- Value_Streams
// C: each month's peak matching efficiency. H: each month's demand savings
// (v1.0 has January's in every month). I: H x C.
let vs = sheet('Value_Streams');
if (!/Peak Matching Efficiency/i.test(textAt(vs, 'C5', shared)) || !/Raw Demand Savings/i.test(textAt(vs, 'H5', shared)) || !/Net Demand savings/i.test(textAt(vs, 'I5', shared))) throw new Error('Value_Streams: C, H or I has moved');
{
  const cells = {};
  for (let m = 0; m < 12; m++) {
    const r = 6 + m;
    expectFormula(vs, `H${r}`, /Wizard_Import!\$J\$\d+/);
    const same = (s) => s;
    cells[`C${r}`] = [num(ref(monthCell('peakMatch', PEAK_MATCH_COLS, 'efficiency', m))), green];
    cells[`H${r}`] = [num(ref(monthCell('utility', UTILITY_COLS, 'demandSav', m))), same];
    cells[`I${r}`] = [`IF(AND(ISNUMBER(H${r}),ISNUMBER(C${r})),H${r}*C${r},"")`, same];
  }
  expectFormula(vs, 'I18', /^IF\(Inputs!\$C\$101,SUM\(I6:I17\),"1?"\)$/);
  cells.I18 = ['IF(Inputs!$C$101,SUM(I6:I17),"")', (s) => s]; // v1.0 shows "1" when not ready
  vs = setFormulasBulk(vs, cells);
}
write(PATH.Value_Streams, vs);

// ---------------------------------------------------------------- Inputs
// No sample project: its identity, capital costs, resiliency amounts, VPP
// revenue and term loan go; the model's general assumptions (degradation,
// O&M, escalation, analysis period, discount rate, tax and loan terms) stay.
let inp = inputs0;
for (const [c, label] of [['B6', 'Building name'], ['B7', 'Location'], ['B8', 'Residential units'], ['B34', 'Battery system'], ['B40', 'Other upfront costs'],
  ['B50', 'Annual insurance premium'], ['B54', 'Per-unit resiliency value'], ['B61', 'Post-service upfront VPP revenue'], ['B78', 'Term principal']]) {
  if (textAt(inp, c, shared) !== label) throw new Error(`Inputs ${c}: expected "${label}", found "${textAt(inp, c, shared)}"`);
}
const blank = Object.fromEntries(['C6', 'C7', 'C8', 'C34', 'C35', 'C36', 'C37', 'C38', 'C39', 'C40', 'C50', 'C51', 'C52', 'C53', 'C54'].map((c) => [c, null]));
inp = setCells(inp, { ...blank, C61: 0, C78: 0 });
if (/E106:AD110/.test(textAt(inp, 'E24', shared))) inp = setCells(inp, { E24: textAt(inp, 'E24', shared).replace('E106:AD110', 'E108:AD112') });
write(PATH.Inputs, inp);

write('xl/styles.xml', styles);
for (const name of Object.keys(PATH)) write(PATH[name], dropCachedValues(sheet(name)));

// Shared strings no cell uses any more (the sample's names) are emptied in
// place, so the indexes the remaining cells hold stay valid.
const used = new Set();
for (const name of Object.keys(PATH)) for (const [, i] of sheet(name).matchAll(/<c [^>]*?t="s"[^>]*>(?:<f[^>]*?(?:\/>|>[^<]*<\/f>))?<v>(\d+)<\/v>/g)) used.add(+i);
let si = -1;
write('xl/sharedStrings.xml', read('xl/sharedStrings.xml').replace(/<si>.*?<\/si>/gs, (m) => (used.has(++si) ? m : '<si><t></t></si>')));

// Recalculate on open, automatically; calcChain would name cells that no longer hold formulas.
delete files['xl/calcChain.xml'];
write('xl/_rels/workbook.xml.rels', read('xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain.xml"\/>/, ''));
write('[Content_Types].xml', read('[Content_Types].xml').replace(/<Override [^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/, ''));
let wb = read('xl/workbook.xml');
wb = wb.replace(/<mc:AlternateContent[^>]*>(?:(?!<\/mc:AlternateContent>).)*absPath(?:(?!<\/mc:AlternateContent>).)*<\/mc:AlternateContent>/s, '');
wb = wb.replace(/<calcPr ([^/]*)\/>/, (m, attrs) => `<calcPr ${attrs.replace(/\s*(?:fullCalcOnLoad|calcMode)="[^"]*"/g, '')} fullCalcOnLoad="1"/>`);
write('xl/workbook.xml', wb);
write('docProps/core.xml', read('docProps/core.xml').replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, ''));

for (const [p, re] of [['xl/workbook.xml', /absPath|calcMode="manual"/], ['docProps/core.xml', /lastModifiedBy/], ['[Content_Types].xml', /calcChain/]]) {
  if (re.test(read(p))) throw new Error(`${p} still matches ${re}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zipSync(files, { level: 9 }));
console.log(`wrote ${OUT} from ${SRC}`);
