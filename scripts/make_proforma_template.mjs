#!/usr/bin/env node
// Derive the pro-forma template the app fills (templates/proforma.xlsx) from
// the owner's workbook in doc/. One-time, like export_data.py; rerun it when
// the source workbook changes.
//
//   node scripts/make_proforma_template.mjs [doc/<workbook>.xlsx]
//
// Edits the sheet XML directly so validations, conditional formats and
// dynamic-array metadata survive (a round trip through a spreadsheet library
// would drop them):
//   - a "Program revenue" stream: a Value_Streams column (K), a
//     Project_Cash_Flow column (F) feeding both net columns and the payback,
//     and an Outputs row (12); every reference in those sheets is shifted;
//   - the cells the app fills become blue input cells: Value_Streams billing
//     peaks (C:D) and demand savings (G), Hourly_Operations energy rate (H);
//   - notes saying where the filled numbers come from;
//   - the source's sample project removed from Inputs (and its strings from
//     the shared string table);
//   - a protected Wizard_Import sheet with everything the wizard provides
//     (js/wizardsheet.js), and the model's battery, savings and rate cells
//     linked to it;
//   - cached formula results and calcChain removed, full recalc on open;
//   - author and local-path metadata removed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate/fflate.mjs';
import { colToNum, numToCol, cellXml, setCells } from '../js/xlsx.js';
import { WIZ_SHEET, LAYOUT, sheetCells, fieldCell, monthCell, ref, UTILITY_COLS, PROGRAM_COLS, VS_COLS } from '../js/wizardsheet.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] || join(ROOT, 'doc', '2026-10-08-multifamily-energy-storage-mod.xlsx'));
const OUT = join(ROOT, 'templates', 'proforma.xlsx');

const SHEETS = { Inputs: 1, Utility_Rates: 2, Hourly_Operations: 3, Value_Streams: 4, Project_Cash_Flow: 5, Outputs: 6, Wizard_Import: 7 };
const STYLE = { kw: 15, usd: 18, rate: 34, note: 2, header: 32, money: 42, text: 5 };
const TOOL = 'Con Edison Battery Wizard';

// ---------------------------------------------------------------- references
// A cell or range reference, optionally sheet-qualified; not part of a name or a call.
const REF = /(?<![A-Za-z0-9_.$'])((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Z]{1,3}\$?\d+)(?::(\$?[A-Z]{1,3}\$?\d+))?(?![A-Za-z0-9_(!])/g;

function shiftCell(ref, { col = Infinity, row = Infinity }) {
  return ref.replace(/^(\$?)([A-Z]+)(\$?)(\d+)$/, (m, cd, c, rd, r) => {
    const cn = colToNum(c), rn = +r;
    return `${cd}${cn >= col ? numToCol(cn + 1) : c}${rd}${rn >= row ? rn + 1 : rn}`;
  });
}
const shiftRange = (range, at) => range.split(':').map((p) => shiftCell(p, at)).join(':');

// Shift references to `target` inside one formula written on `here`.
function shiftFormula(f, here, target, at) {
  return f.split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(REF, (m, pre, a, b) => {
    const sheet = pre ? pre.slice(0, -1).replace(/^'|'$/g, '') : here;
    if (sheet !== target) return m;
    return `${pre || ''}${shiftCell(a, at)}${b ? ':' + shiftCell(b, at) : ''}`;
  }))).join('');
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function mapFormulas(xml, fn) {
  return xml.replace(/<f([^>]*)>([^<]*)<\/f>/g, (m, attrs, text) => `<f${attrs}>${esc(fn(unesc(text)))}</f>`);
}

// Shift everything in the sheet being changed: cell positions, formulas,
// formula ranges, dimension, columns, panes and selections.
function shiftSheet(xml, name, at) {
  xml = mapFormulas(xml, (f) => shiftFormula(f, name, name, at));
  xml = xml.replace(/<c r="([A-Z]+\d+)"/g, (m, ref) => `<c r="${shiftCell(ref, at)}"`);
  xml = xml.replace(/<row r="(\d+)"/g, (m, r) => `<row r="${+r >= (at.row || Infinity) ? +r + 1 : r}"`);
  xml = xml.replace(/ spans="[^"]*"/g, '');
  xml = xml.replace(/(<f [^>]*\bref=")([^"]+)"/g, (m, p, ref) => `${p}${shiftRange(ref, at)}"`);
  xml = xml.replace(/(<dimension ref=")([^"]+)"/, (m, p, ref) => `${p}${shiftRange(ref, at)}"`);
  xml = xml.replace(/\b(topLeftCell|activeCell)="([A-Z]+\d+)"/g, (m, k, ref) => `${k}="${shiftCell(ref, at)}"`);
  xml = xml.replace(/\bsqref="([^"]+)"/g, (m, refs) => `sqref="${refs.split(' ').map((r) => shiftRange(r, at)).join(' ')}"`);
  if (at.col) {
    xml = xml.replace(/<col min="(\d+)" max="(\d+)"/g, (m, lo, hi) => `<col min="${+lo >= at.col ? +lo + 1 : lo}" max="${+hi >= at.col ? +hi + 1 : hi}"`);
  }
  return xml;
}

// Insert a column at `col` (1-based): new cells take the style of their left neighbour.
function insertColumn(xml, name, col) {
  xml = shiftSheet(xml, name, { col });
  const left = numToCol(col - 1), here = numToCol(col);
  return xml.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>.*?<\/c>)/gs, (m, c, r, attrs) => {
    if (c !== left) return m;
    const s = (attrs.match(/\bs="(\d+)"/) || [])[1];
    return m + cellXml(`${here}${r}`, null, s);
  });
}

// Insert a row at `row`: a copy of the row above with empty cells.
function insertRow(xml, name, row) {
  xml = shiftSheet(xml, name, { row });
  const above = xml.match(new RegExp(`<row r="${row - 1}"[^>]*>.*?</row>`, 's'))[0];
  const fresh = above.replace(`<row r="${row - 1}"`, `<row r="${row}"`)
    .replace(/<c r="([A-Z]+)\d+"([^>]*?)(\/>|>.*?<\/c>)/gs, (m, c, attrs) => cellXml(`${c}${row}`, null, (attrs.match(/\bs="(\d+)"/) || [])[1]));
  return xml.replace(above, above + fresh);
}

// Put a formula into an existing cell (keeping its style).
function setFormula(xml, ref, formula) {
  return xml.replace(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>.*?</c>)`, 's'), (m, attrs) => {
    const s = (attrs.match(/\bs="(\d+)"/) || [])[1];
    return `<c r="${ref}"${s ? ` s="${s}"` : ''}><f>${esc(formula)}</f></c>`;
  });
}

function editFormula(xml, ref, from, to) {
  const re = new RegExp(`(<c r="${ref}"[^>]*>)<f([^>]*)>([^<]*)</f>`);
  const m = xml.match(re);
  if (!m || !unesc(m[3]).includes(from)) throw new Error(`${ref}: expected "${from}" in ${m ? unesc(m[3]) : 'no formula'}`);
  return xml.replace(re, (all, open, attrs, text) => `${open}<f${attrs}>${esc(unesc(text).split(from).join(to))}</f>`);
}

// A cell's formula text (unescaped), or null.
function formulaOf(xml, ref) {
  const m = xml.match(new RegExp(`<c r="${ref}"[^>]*>(?:<f[^>]*>([^<]*)</f>)?`));
  return m && m[1] !== undefined ? unesc(m[1]) : null;
}

// Put a formula into an existing cell in a given style.
function setFormulaStyled(xml, ref, formula, style) {
  return xml.replace(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>.*?</c>)`, 's'), () => `<c r="${ref}" s="${style}"><f>${esc(formula)}</f></c>`);
}

// Append cells to the end of each row `rowCells(n)` returns XML for (or '').
function appendCells(xml, rowCells) {
  return xml.replace(/(<row r="(\d+)"[^>]*>)(.*?)(<\/row>)/gs, (m, open, n, body, close) => {
    const extra = rowCells(+n);
    return extra ? open + body + extra + close : m;
  });
}

function appendRow(xml, row, cells) {
  return xml.replace('</sheetData>', `<row r="${row}">${cells}</row></sheetData>`);
}

// Drop cached results so every app recalculates; keep the formulas.
function dropCachedValues(xml) {
  return xml.replace(/<c ([^>]*?)>(<f[^>]*?(?:\/>|>[^<]*<\/f>))(?:<v>[^<]*<\/v>|<v\/>)?<\/c>/g, (m, attrs, f) => `<c ${attrs.replace(/\s+t="[^"]*"/, '')}>${f}</c>`);
}

// ---------------------------------------------------------------- build
const files = unzipSync(readFileSync(SRC));
const read = (p) => strFromU8(files[p]);
const write = (p, s) => { files[p] = strToU8(s); };
const sheetPath = (name) => `xl/worksheets/sheet${SHEETS[name]}.xml`;
const sheet = (name) => read(sheetPath(name));

const months = Array.from({ length: 12 }, (_, i) => i + 6); // rows 6..17

// Value_Streams: program revenue column at K; tool values in C:D and G.
let vs = insertColumn(sheet('Value_Streams'), 'Value_Streams', 11);
vs = setCells(vs, { K5: 'Program revenue ($)' });
for (const r of months) {
  vs = setCells(vs, { [`C${r}`]: null, [`D${r}`]: null }, STYLE.kw);
  vs = setCells(vs, { [`G${r}`]: null, [`K${r}`]: null }, STYLE.usd);
  vs = editFormula(vs, `M${r}`, `SUM(G${r},J${r},L${r})`, `SUM(G${r},J${r},K${r},L${r})`);
}
vs = setFormula(vs, 'K18', 'SUM(K6:K17)');
vs = editFormula(vs, 'M18', 'SUM(G18,J18,L18)', 'SUM(G18,J18,K18,L18)');
vs = appendRow(vs, 32, cellXml('B32', `Blue cells are filled by the ${TOOL}: 15-minute billing peaks (C:D) and demand savings (G) cover every demand window, the SBC demand surcharge and the supply capacity charge, taxes included, so G is not simply E x F.`, STYLE.note));
vs = appendRow(vs, 33, cellXml('B33', 'Program revenue (K): Rider T CSRP / DLRP and Rider AC Term-DLM, from the same dispatch. Reservation payments are spread over the Capability Period months, performance payments land in the event months.', STYLE.note));
// Value Stack columns after program revenue: L export credits (energy and
// DRV, summed from the hourly sheet), M capacity (Alternative 3) and LSRV,
// N the account change (fixed charges, and a rate change to standby);
// resiliency moves to O and the total to P.
for (let i = 0; i < 3; i++) vs = insertColumn(vs, 'Value_Streams', 12);
const hStyle = (vs.match(/<c r="H6" s="(\d+)"/) || [])[1];
vs = setCells(vs, { L5: 'Export credits: energy + DRV ($)', M5: 'Capacity (Alt 3) + LSRV ($)', N5: 'Account change ($)' });
for (const r of months) {
  vs = setFormulaStyled(vs, `L${r}`, formulaOf(vs, `H${r}`).split('Hourly_Operations!$I$6:$I$8765').join('Hourly_Operations!$K$6:$K$8765'), hStyle);
  vs = setCells(vs, { [`M${r}`]: null, [`N${r}`]: null }, STYLE.usd);
  vs = editFormula(vs, `P${r}`, `SUM(G${r},J${r},K${r},O${r})`, `SUM(G${r},J${r},K${r},L${r},M${r},N${r},O${r})`);
}
vs = setFormula(vs, 'L18', 'IF(Inputs!$C$62,SUM(L6:L17),"")');
vs = setFormula(vs, 'M18', 'SUM(M6:M17)');
vs = setFormula(vs, 'N18', 'SUM(N6:N17)');
vs = editFormula(vs, 'P18', 'SUM(G18,J18,K18,O18)', 'SUM(G18,J18,K18,L18,M18,N18,O18)');
vs = appendRow(vs, 34, cellXml('B34', 'Value Stack (Rider R A.9(d) with SC 11, Inputs C14): L sums the hourly export credits (Hourly_Operations K); M is Alternative 3 capacity on the kW held through the likely NYISO peak hours, at each month\'s statement rate, plus any LSRV in the event months. Storage gets no environmental component.', STYLE.note));
vs = appendRow(vs, 35, cellXml('B35', 'N is the account change, taxes included: the change in fixed customer charges (the whole charging account\'s customer charge for a stand-alone battery) and, when the battery moves the building to standby rates, the baseline load\'s energy at the old rate less the new one, since H prices every hour at the new rate. Zero behind the meter on the same rate.', STYLE.note));
vs = vs.replace(/<dimension ref="[^"]+"/, '<dimension ref="B2:P35"');
write(sheetPath('Value_Streams'), vs);

// Project_Cash_Flow: program revenue column at F, in both net columns and the payback.
let cf = insertColumn(sheet('Project_Cash_Flow'), 'Project_Cash_Flow', 6);
cf = setCells(cf, { F5: 'Program revenue' });
for (let r = 6; r <= 31; r++) {
  cf = setFormula(cf, `F${r}`, `IF(AND(Inputs!$C$64,ISNUMBER($B${r})),IF($B${r}=Inputs!$C$68,Inputs!$C$68,Value_Streams!$K$18),"")`);
  cf = editFormula(cf, `K${r}`, `SUM(C${r}:E${r},I${r}:J${r})`, `SUM(C${r}:F${r},I${r}:J${r})`);
}
cf = editFormula(cf, 'C37', 'SUM(D7:E7,I7)', 'SUM(D7:F7,I7)');
cf = editFormula(cf, 'D37', 'SUM(D7:E7,I7)', 'SUM(D7:F7,I7)');
cf = appendRow(cf, 45, cellXml('B45', 'Program revenue is held at its Year 1 value (program rates are set by the tariff and are not escalated).', STYLE.note));
// Value Stack credits at G, after program revenue, in both net columns and the payback.
cf = insertColumn(cf, 'Project_Cash_Flow', 7);
cf = setCells(cf, { G5: 'Value Stack credits' });
for (let r = 6; r <= 31; r++) {
  cf = setFormula(cf, `G${r}`, `IF(AND(Inputs!$C$64,ISNUMBER($B${r})),IF($B${r}=Inputs!$C$68,Inputs!$C$68,Value_Streams!$L$18+Value_Streams!$M$18+Value_Streams!$N$18),"")`);
  cf = editFormula(cf, `L${r}`, `SUM(C${r}:F${r},J${r}:K${r})`, `SUM(C${r}:G${r},J${r}:K${r})`);
}
cf = editFormula(cf, 'C37', 'SUM(D7:F7,J7)', 'SUM(D7:G7,J7)');
cf = editFormula(cf, 'D37', 'SUM(D7:F7,J7)', 'SUM(D7:G7,J7)');
cf = appendRow(cf, 46, cellXml('B46', 'Value Stack credits are held at their Year 1 value: the DRV and LSRV rates are fixed for 10 years from the in-service date, then reset; energy and capacity follow the market. The Value Stack term is 25 years.', STYLE.note));
cf = cf.replace(/<dimension ref="[^"]+"/, '<dimension ref="B2:O46"');
write(sheetPath('Project_Cash_Flow'), cf);

// Outputs: a program revenue row at 12 (the total below picks it up).
let out = insertRow(sheet('Outputs'), 'Outputs', 12);
out = setCells(out, { B12: 'Year 1 program revenue ($)' });
out = setFormula(out, 'C12', 'IF(ISNUMBER(Value_Streams!K18),Value_Streams!K18,"")');
out = setFormula(out, 'D12', 'IF(ISNUMBER(C12),C12,"")');
// and a Value Stack row at 13.
out = insertRow(out, 'Outputs', 13);
out = setCells(out, { B13: 'Year 1 Value Stack credits ($)' });
out = setFormula(out, 'C13', 'IF(ISNUMBER(Value_Streams!L18),Value_Streams!L18+Value_Streams!M18+Value_Streams!N18,"")');
out = setFormula(out, 'D13', 'IF(ISNUMBER(C13),C13,"")');
out = out.replace(/Imported dispatch includes charging and efficiency losses\. No exports, optimizer, or SOC \/ cycle validation\./,
  `Imported dispatch includes charging and efficiency losses. Exports are credited only under the Value Stack (Inputs C14); the dispatch, state of charge and cycles come from the ${TOOL}.`);
write(sheetPath('Outputs'), out);

// Hourly_Operations: the energy rate becomes an input the app fills.
let ho = sheet('Hourly_Operations');
ho = ho.replace(/<c r="H(\d+)"[^>]*?(?:\/>|>.*?<\/c>)/gs, (m, r) => (+r >= 6 && +r <= 8765 ? cellXml(`H${r}`, null, STYLE.rate) : m));
ho = setCells(ho, { B3: `Filled by the ${TOOL}: D baseline and E dispatch are hourly averages of its 15-minute run (positive = discharge, net of charging, so D - E is the hour's net grid demand); H is the all-in energy rate for the hour, taxes included; L is the Value Stack credit per exported kWh (energy at LBMP x losses, plus the DRV in the call window), blank without exports.` });
// K: the hour's export credit, L: the credit per exported kWh (filled by the app).
const kFormula = (r) => `IF(AND(ISNUMBER(F${r}),ISNUMBER(L${r}),F${r}<Inputs!$C$68),-F${r}*L${r}*Inputs!$C$69,"")`;
ho = appendCells(ho, (n) => (n === 5 ? cellXml('K5', 'Export credit ($/hour)', STYLE.header) + cellXml('L5', 'Export credit rate ($/kWh)', STYLE.header)
  : n >= 6 && n <= 8765 ? `<c r="K${n}" s="${STYLE.money}"><f>${esc(kFormula(n))}</f></c>` + cellXml(`L${n}`, null, STYLE.rate) : ''));
ho = ho.replace(/<dimension ref="[^"]+"/, '<dimension ref="B2:L8765"').replace('<col min="4" max="10" width="17.5" customWidth="1"/>', '<col min="4" max="12" width="17.5" customWidth="1"/>');
write(sheetPath('Hourly_Operations'), ho);

// Inputs: no sample project. Project values, the cells the app fills, the
// analysis period and the discount rate are left blank; replacement, O&M,
// escalation and resiliency take the zero ("none") defaults their notes give.
const inputCells = (...ranges) => ranges.flatMap((r) => {
  const [a, b = a] = r.split(':').map((c) => +c.slice(1));
  return Array.from({ length: b - a + 1 }, (_, i) => `C${a + i}`);
});
const blank = Object.fromEntries(inputCells('C6:C10', 'C16:C25', 'C32:C38', 'C42:C43', 'C48:C52').map((ref) => [ref, null]));
let inp = setCells(sheet('Inputs'), { ...blank, C26: 0, C27: 0, C28: 0, C29: 0, C46: 'Flat annual', C47: 0 });
// Value Stack exports (C14): grid-export hours are then expected, not invalid.
inp = setCells(inp, { B14: 'Value Stack exports', D14: 'TRUE / FALSE', E14: 'TRUE when exports are credited under the Value Stack (Rider R A.9(d) with SC 11); negative net grid demand is then allowed.', B59: 'Grid-export hours', D59: 'must be 0 unless C14', E59: 'Without Value Stack exports (C14 FALSE) negative net grid demand blocks savings and returns.' });
inp = setCells(inp, { C14: false }, STYLE.text);
inp = editFormula(inp, 'C62', 'C59=$C$68,', 'OR(C59=$C$68,C14=TRUE),');
inp = editFormula(inp, 'C65', 'IF(C59>C68,"INVALID: grid exports"', 'IF(AND(C59>C68,C14<>TRUE),"INVALID: grid exports"');
write(sheetPath('Inputs'), inp);

// Utility_Rates: say what the filled rates are.
let ur = sheet('Utility_Rates');
ur = ur.replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:K57"');
ur = appendRow(ur, 57, cellXml('B57', `Linked from ${WIZ_SHEET} (green): Demand ($/kW-mo) is the effective baseline rate (all demand charges over the 15-minute billing peak), every TOU column the month\'s average baseline $/kWh, and the bills those entered in the wizard, taxes included. They drive the readiness checks and the bill reconciliation; ${WIZ_SHEET} carries the exact monthly savings.`, STYLE.note));
write(sheetPath('Utility_Rates'), ur);

// ---------------------------------------------------------------- Wizard_Import
// One protected sheet holds everything the wizard provides (js/wizardsheet.js
// lays it out); the model's battery, savings and rate cells link to it in
// green, so the battery is set in the wizard only.
let styles = read('xl/styles.xml');
const xfs = styles.match(/<cellXfs count="(\d+)">(.*?)<\/cellXfs>/s);
const blackFont = (xfs[2].match(/<xf\b[^>]*?(?:\/>|>.*?<\/xf>)/gs)[11].match(/fontId="(\d+)"/) || [])[1];
const addXf = (numFmtId) => {
  const n = +styles.match(/<cellXfs count="(\d+)">/)[1];
  styles = styles.replace(/<cellXfs count="\d+">(.*?)<\/cellXfs>/s, (m, body) => `<cellXfs count="${n + 1}">${body}<xf numFmtId="${numFmtId}" fontId="${blackFont}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>`);
  return n;
};
const FMT = { title: 1, note: 7, head: 12, colhead: STYLE.header, label: 4, text: 2, bool: 2, int: 39, num1: 11, money: 44, rate4: addXf(170), pct: addXf(167) };
write('xl/styles.xml', styles);

const LINK = { text: 22, num1: 10, int: 21, money: 42, rate4: 41, pct: 50 }; // green: a link to another sheet
const cells = sheetCells(null);
const byRow = new Map();
for (const [c, [value, fmt]] of Object.entries(cells)) {
  const r = +c.match(/\d+/)[0];
  if (!byRow.has(r)) byRow.set(r, []);
  byRow.get(r).push([c, value, fmt]);
}
const rowsXml = [...byRow.keys()].sort((a, b) => a - b).map((r) => {
  const cs = byRow.get(r).sort((a, b) => colToNum(a[0].match(/[A-Z]+/)[0]) - colToNum(b[0].match(/[A-Z]+/)[0]));
  return `<row r="${r}">${cs.map(([c, value, fmt]) => (value && value.f ? `<c r="${c}" s="${FMT[fmt]}"><f>${esc(value.f)}</f></c>` : cellXml(c, value, FMT[fmt]))).join('')}</row>`;
}).join('');
const wizXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  + '<sheetPr><tabColor rgb="FF16324F"/></sheetPr>'
  + `<dimension ref="B2:S${LAYOUT.lastRow}"/>`
  + '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>'
  + '<cols><col min="1" max="1" width="3" customWidth="1"/><col min="2" max="2" width="44" customWidth="1"/><col min="3" max="19" width="17" customWidth="1"/></cols>'
  + `<sheetData>${rowsXml}</sheetData>`
  + '<sheetProtection sheet="1" objects="1" scenarios="1"/>'
  + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
write(`xl/worksheets/sheet${SHEETS[WIZ_SHEET]}.xml`, wizXml);
{
  let rels = read('xl/_rels/workbook.xml.rels');
  const rid = `rId${Math.max(...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => +m[1])) + 1}`;
  rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${SHEETS[WIZ_SHEET]}.xml"/></Relationships>`);
  write('xl/_rels/workbook.xml.rels', rels);
  let w = read('xl/workbook.xml');
  const sid = Math.max(...[...w.matchAll(/<sheet [^>]*sheetId="(\d+)"/g)].map((m) => +m[1])) + 1;
  w = w.replace('</sheets>', `<sheet name="${WIZ_SHEET}" sheetId="${sid}" r:id="${rid}"/></sheets>`);
  write('xl/workbook.xml', w);
  write('[Content_Types].xml', read('[Content_Types].xml').replace('</Types>', `<Override PartName="/xl/worksheets/sheet${SHEETS[WIZ_SHEET]}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`));
  let app = read('docProps/app.xml');
  app = app.replace(/(<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>)(\d+)(<\/vt:i4>)/, (m, a, n, b) => `${a}${+n + 1}${b}`)
    .replace(/<TitlesOfParts><vt:vector size="(\d+)" baseType="lpstr">(.*?)<\/vt:vector>/s, (m, n, body) => `<TitlesOfParts><vt:vector size="${+n + 1}" baseType="lpstr">${body}<vt:lpstr>${WIZ_SHEET}</vt:lpstr></vt:vector>`);
  write('docProps/app.xml', app);
}

// The links. Blank stays blank; numbers come across as they are.
const num = (cell) => `IF(ISNUMBER(${ref(cell)}),${ref(cell)},"")`;
const txt = (cell) => `IF(${ref(cell)}="","",${ref(cell)})`;
const link = (xml, target, formula, fmt) => setFormulaStyled(xml, target, formula, LINK[fmt]);
let inp2 = sheet('Inputs');
const bat = (k) => fieldCell('battery', k), prj = (k) => fieldCell('project', k);
inp2 = link(inp2, 'C9', txt(prj('utility')), 'text');
inp2 = link(inp2, 'C10', txt(prj('rate')), 'text');
inp2 = link(inp2, 'C14', `${ref(prj('exports'))}=TRUE`, 'text');
inp2 = link(inp2, 'C16', num(bat('kw')), 'num1');
inp2 = link(inp2, 'C17', num(bat('kwh')), 'num1');
inp2 = link(inp2, 'C18', num(bat('usable')), 'pct');
inp2 = link(inp2, 'C19', `IF(ISNUMBER(${ref(bat('usable'))}),1-${ref(bat('usable'))},"")`, 'pct');
inp2 = link(inp2, 'C20', `IF(ISNUMBER(${ref(bat('usable'))}),1,"")`, 'pct');
inp2 = link(inp2, 'C21', num(bat('rte')), 'pct');
inp2 = link(inp2, 'C23', `IF(AND(ISNUMBER(${ref(bat('cycles'))}),N(${ref(bat('cycles'))})>0),${ref(bat('cycles'))},"")`, 'int');
if (/<c r="E16"/.test(inp2)) inp2 = setCells(inp2, { E16: `Green: from ${WIZ_SHEET}. The battery is set in the wizard; change it there and download again.` });
write(sheetPath('Inputs'), inp2);

let vs2 = sheet('Value_Streams');
for (let m = 0; m < 12; m++) {
  const r = 6 + m, u = (k) => monthCell('utility', UTILITY_COLS, k, m);
  vs2 = link(vs2, `C${r}`, num(u('peakBase')), 'num1');
  vs2 = link(vs2, `D${r}`, num(u('peakAfter')), 'num1');
  vs2 = link(vs2, `G${r}`, num(u('demandSav')), 'money');
  vs2 = link(vs2, `K${r}`, `N(${ref(monthCell('programs', PROGRAM_COLS, 'total', m))})`, 'money');
  vs2 = link(vs2, `M${r}`, `N(${ref(monthCell('vs', VS_COLS, 'alt3', m))})+N(${ref(monthCell('vs', VS_COLS, 'lsrv', m))})`, 'money');
  vs2 = link(vs2, `N${r}`, `N(${ref(u('fixedChange'))})+N(${ref(u('rateChange'))})`, 'money');
}
vs2 = setCells(vs2, { B32: `Green cells link to ${WIZ_SHEET}: 15-minute billing peaks (C:D) and demand savings (G) cover every demand window, the SBC demand surcharge and the supply capacity charge, taxes included, so G is not simply E x F. ${WIZ_SHEET} also carries the energy savings and every determinant and rate behind them.` });
write(sheetPath('Value_Streams'), vs2);

let ur2 = sheet('Utility_Rates');
for (let m = 0; m < 12; m++) {
  const r = 6 + m, u = (k) => monthCell('utility', UTILITY_COLS, k, m);
  ur2 = link(ur2, `C${r}`, num(u('actualBill')), 'money');
  ur2 = link(ur2, `F${r}`, num(u('demandRate')), 'money');
  for (const c of ['G', 'H', 'I', 'J']) ur2 = link(ur2, `${c}${r}`, num(u('energyRate')), 'rate4');
}
write(sheetPath('Utility_Rates'), ur2);

for (const name of Object.keys(SHEETS)) write(sheetPath(name), dropCachedValues(sheet(name)));

// Shared strings no cell uses any more (the sample's names) are emptied in
// place, so the indexes the remaining cells hold stay valid.
const used = new Set();
for (const name of Object.keys(SHEETS)) for (const [, i] of sheet(name).matchAll(/<c [^>]*?t="s"[^>]*>(?:<f[^>]*?(?:\/>|>[^<]*<\/f>))?<v>(\d+)<\/v>/g)) used.add(+i);
let si = -1;
write('xl/sharedStrings.xml', read('xl/sharedStrings.xml').replace(/<si>.*?<\/si>/gs, (m) => (used.has(++si) ? m : '<si><t></t></si>')));

// Recalculate on open; calcChain would name cells that no longer hold formulas.
delete files['xl/calcChain.xml'];
write('xl/_rels/workbook.xml.rels', read('xl/_rels/workbook.xml.rels').replace(/<Relationship [^>]*Target="calcChain.xml"\/>/, ''));
write('[Content_Types].xml', read('[Content_Types].xml').replace(/<Override [^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/, ''));
let wb = read('xl/workbook.xml');
wb = wb.replace(/<mc:AlternateContent[^>]*>(?:(?!<\/mc:AlternateContent>).)*absPath(?:(?!<\/mc:AlternateContent>).)*<\/mc:AlternateContent>/s, '');
wb = wb.replace(/<calcPr ([^/]*)\/>/, (m, attrs) => `<calcPr ${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
write('xl/workbook.xml', wb);
write('docProps/core.xml', read('docProps/core.xml').replace(/<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, ''));

for (const [p, re] of [['xl/workbook.xml', /absPath/], ['docProps/core.xml', /lastModifiedBy/], ['[Content_Types].xml', /calcChain/]]) {
  if (re.test(read(p))) throw new Error(`${p} still matches ${re}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, zipSync(files, { level: 9 }));
console.log(`wrote ${OUT}`);
