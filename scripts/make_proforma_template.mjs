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
//   - cached formula results and calcChain removed, full recalc on open;
//   - author and local-path metadata removed.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from '../vendor/fflate/fflate.mjs';
import { colToNum, numToCol, cellXml, setCells } from '../js/xlsx.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] || join(ROOT, 'doc', '2026-10-08-multifamily-energy-storage-mod.xlsx'));
const OUT = join(ROOT, 'templates', 'proforma.xlsx');

const SHEETS = { Inputs: 1, Utility_Rates: 2, Hourly_Operations: 3, Value_Streams: 4, Project_Cash_Flow: 5, Outputs: 6 };
const STYLE = { kw: 15, usd: 18, rate: 34, note: 2 };

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
vs = appendRow(vs, 32, cellXml('B32', 'Blue cells are filled by the SC 8 Battery Wizard: 15-minute billing peaks (C:D) and demand savings (G) cover every demand window, the SBC demand surcharge and the supply capacity charge, taxes included, so G is not simply E x F.', STYLE.note));
vs = appendRow(vs, 33, cellXml('B33', 'Program revenue (K): Rider T CSRP / DLRP and Rider AC Term-DLM, from the same dispatch. Reservation payments are spread over the Capability Period months, performance payments land in the event months.', STYLE.note));
vs = vs.replace(/<dimension ref="[^"]+"/, '<dimension ref="B2:M33"');
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
cf = cf.replace(/<dimension ref="[^"]+"/, '<dimension ref="B2:N45"');
write(sheetPath('Project_Cash_Flow'), cf);

// Outputs: a program revenue row at 12 (the total below picks it up).
let out = insertRow(sheet('Outputs'), 'Outputs', 12);
out = setCells(out, { B12: 'Year 1 program revenue ($)' });
out = setFormula(out, 'C12', 'IF(ISNUMBER(Value_Streams!K18),Value_Streams!K18,"")');
out = setFormula(out, 'D12', 'IF(ISNUMBER(C12),C12,"")');
write(sheetPath('Outputs'), out);

// Hourly_Operations: the energy rate becomes an input the app fills.
let ho = sheet('Hourly_Operations');
ho = ho.replace(/<c r="H(\d+)"[^>]*?(?:\/>|>.*?<\/c>)/gs, (m, r) => (+r >= 6 && +r <= 8765 ? cellXml(`H${r}`, null, STYLE.rate) : m));
ho = setCells(ho, { B3: 'Filled by the SC 8 Battery Wizard: D baseline and E dispatch are hourly averages of its 15-minute run (positive = discharge); H is the all-in energy rate for the hour, taxes included.' });
write(sheetPath('Hourly_Operations'), ho);

// Inputs: no sample project. Project values, the cells the app fills, the
// analysis period and the discount rate are left blank; replacement, O&M,
// escalation and resiliency take the zero ("none") defaults their notes give.
const inputCells = (...ranges) => ranges.flatMap((r) => {
  const [a, b = a] = r.split(':').map((c) => +c.slice(1));
  return Array.from({ length: b - a + 1 }, (_, i) => `C${a + i}`);
});
const blank = Object.fromEntries(inputCells('C6:C10', 'C16:C25', 'C32:C38', 'C42:C43', 'C48:C52').map((ref) => [ref, null]));
write(sheetPath('Inputs'), setCells(sheet('Inputs'), { ...blank, C26: 0, C27: 0, C28: 0, C29: 0, C46: 'Flat annual', C47: 0 }));

// Utility_Rates: say what the filled rates are.
let ur = sheet('Utility_Rates');
ur = ur.replace(/<dimension ref="[^"]+"/, '<dimension ref="A1:K57"');
ur = appendRow(ur, 57, cellXml('B57', 'When filled by the SC 8 Battery Wizard: Demand ($/kW-mo) is the effective baseline rate (all demand charges over the 15-minute billing peak) and every TOU column holds the month\'s average all-in $/kWh, taxes included. They drive the readiness checks and the bill reconciliation; Value_Streams carries the exact savings.', STYLE.note));
write(sheetPath('Utility_Rates'), ur);

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
