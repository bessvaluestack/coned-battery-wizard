// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from '../vendor/fflate/fflate.mjs';
import { buildStack, billFor, summarize } from '../js/model.js';
import { proformaData, fillProforma } from '../js/proforma.js';
import { projectHash, readProjectHash, newProject } from '../js/project.js';
import { fieldCell } from '../js/wizardsheet.js';

const read = (p) => JSON.parse(readFileSync(new URL('../data/' + p, import.meta.url), 'utf8'));
const data = { tariffs: read('tariffs_sc8.json'), statements: read('statements.json'), msc: read('msc.json'), lbmp: { J: read('lbmp_J.json'), H: read('lbmp_H.json'), I: read('lbmp_I.json') }, programs: read('programs.json') };
const template = readFileSync(new URL('../templates/proforma.xlsx', import.meta.url));
const cell = (xml, ref) => (xml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`, 's')) || [])[1] || '';
const text = (xml, ref) => ((cell(xml, ref).match(/<t[^>]*>([^<]*)<\/t>/) || [])[1] || '').replace(/&amp;/g, '&');

test('project links: a version, or the latest, in the fragment; anything else is not a link', () => {
  const { id } = newProject();
  assert.equal(projectHash(id, 3), `#project=${id}&version=3`);
  assert.deepEqual(readProjectHash(projectHash(id, 3)), { id, rev: 3 });
  assert.deepEqual(readProjectHash(projectHash(id)), { id, rev: null });
  assert.deepEqual(readProjectHash(`#project=${id}&version=0`), { id, rev: null });
  for (const h of ['', '#', '#project=', '#project=../api', '#version=2', '#results']) assert.equal(readProjectHash(h), null, h);
});

test('pro-forma: the saved version and its links on Wizard_Import, with a link to open it', () => {
  const stack = buildStack({ rateNo: 1, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5, supply: { mode: 'coned_msc' } }, data);
  const load = Float64Array.from(read('profiles/midrise_gas_windowac.json').kw);
  const sol = { imp: load, exp: null, dis: new Float64Array(load.length), ch: new Float64Array(load.length) };
  const bill = billFor(stack, load), battery = { kw: 100, kwh: 200, rte: 0.88, usableFrac: 0.95, cyclesPerYear: 0 };
  const summary = summarize(stack, load, battery, bill, bill, null, null, sol, { total: 0, streams: [] });
  const run = { stack, load, sol, summary, revenue: { total: 0, streams: [] }, battery, baseline: bill, withB: bill };
  const id = newProject().id, link = `https://wizard.example${projectHash(id, 4)}`;
  const saved = { rev: 4, link, projectLink: `https://wizard.example${projectHash(id)}`, savedAt: '2026-10-21T14:00:00.000Z', savedBy: 'Analyst' };
  const wiz = strFromU8(unzipSync(fillProforma(template, proformaData(run, { saved })))['xl/worksheets/sheet7.xml']);
  assert.match(cell(wiz, fieldCell('saved', 'rev')), /<v>4<\/v>/);
  assert.equal(text(wiz, fieldCell('saved', 'link')), link);
  assert.equal(text(wiz, fieldCell('saved', 'savedBy')), 'Analyst');
  assert.match(cell(wiz, fieldCell('saved', 'open')), new RegExp(`HYPERLINK\\(${fieldCell('saved', 'link')},`));
  // Not saved on a server (GitHub Pages): blank, the formula stays.
  const blank = strFromU8(unzipSync(fillProforma(template, proformaData(run, {})))['xl/worksheets/sheet7.xml']);
  assert.equal(cell(blank, fieldCell('saved', 'link')), '');
  assert.match(cell(blank, fieldCell('saved', 'open')), /HYPERLINK/);
});
