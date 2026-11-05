// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex } from '../js/timeidx.js';
import { peakMatching } from '../js/peakmatch.js';

const idx = buildIndex();
const battery = { kw: 100, kwh: 200, rte: 0.9, usableFrac: 1 };
const preset = Float64Array.from(JSON.parse(readFileSync(new URL('../data/profiles/midrise_gas_windowac.json', import.meta.url), 'utf8')).kw);

// A flat 100 kW load with an evening bump on chosen days of the year.
function bumps(days, kw = 80) {
  const load = new Float64Array(idx.T).fill(100);
  for (const d of days) for (let t = d * 96 + 72; t < d * 96 + 84; t++) load[t] = 100 + kw; // 18:00-21:00
  return load;
}

test('peak matching: a perfect forecast keeps every kW the battery can hold; the line it holds is the lowest it can', () => {
  const r = peakMatching({ idx, load: bumps([10, 11, 12]), battery, forecastError: 0 });
  assert.equal(r.months[0].efficiency, 1);
  // 3 hours over the line: 200 kWh x 0.9^0.5 delivered over 3 h is about 63 kW off the 180 kW bump.
  const cut = 180 - r.months[0].peakPerfect, deliverable = (200 * Math.sqrt(0.9)) / 3;
  assert.ok(Math.abs(cut - deliverable) < 0.05, `cut ${cut} vs ${deliverable}`);
  assert.equal(r.months[0].shaveDays, 3);
  assert.equal(r.months[1].efficiency, 1, 'a month with nothing to shave');
  assert.equal(r.months[1].shaveDays, 0);
});

test('peak matching: falls as the forecast error grows, and with the number of days at the battery\'s limit', () => {
  const at = (load, fe) => peakMatching({ idx, load, battery, forecastError: fe }).months[0];
  const one = bumps([10]), many = bumps(Array.from({ length: 31 }, (_, d) => d));
  const e3 = at(many, 0.03).efficiency, e5 = at(many, 0.05).efficiency, e10 = at(many, 0.1).efficiency;
  assert.ok(e3 > e5 && e5 > e10, `${e3} > ${e5} > ${e10}`);
  assert.ok(at(one, 0.05).efficiency > e5 + 0.05, `one shave day ${at(one, 0.05).efficiency} vs 31: ${e5}`);
  assert.equal(at(many, 0.05).shaveDays, 31);
  for (const e of [e3, e5, e10]) assert.ok(e > 0 && e < 1);
});

test('peak matching: seeded, so the same inputs give the same months; a building preset lands in a sensible range', () => {
  const a = peakMatching({ idx, load: preset, battery: { kw: 200, kwh: 400, rte: 0.88, usableFrac: 0.95 } });
  const b = peakMatching({ idx, load: preset, battery: { kw: 200, kwh: 400, rte: 0.88, usableFrac: 0.95 } });
  assert.deepEqual(a, b);
  assert.equal(a.forecastError, 0.05);
  for (const m of a.months) {
    assert.ok(m.efficiency > 0.6 && m.efficiency < 1, `${m.efficiency}`);
    assert.ok(m.peakExpected > m.peakPerfect && m.peakExpected < m.peakBase);
  }
});
