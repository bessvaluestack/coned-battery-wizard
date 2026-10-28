// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../js/timeidx.js';
import { backupByMonth } from '../js/model.js';

test('backup: average stored energy by month, and the hours it carries 25% of the month\'s peak', () => {
  const idx = buildIndex();
  const soc = new Float64Array(idx.T).fill(100);
  for (let t = idx.monthStart[6]; t < idx.monthStart[7]; t++) soc[t] = idx.hour[t] < 12 ? 0 : 160; // July: half the day empty, half at 160
  const battery = { kw: 50, kwh: 200, usableFrac: 0.95, rte: 0.81 }; // discharge efficiency 0.9
  const peaks = new Array(12).fill(100); peaks[0] = 400;
  const rows = backupByMonth({ idx, soc, battery, peaks });
  assert.equal(rows.length, 12);
  assert.ok(Math.abs(rows[3].avgKwh - 100) < 1e-9 && Math.abs(rows[3].avgShare - 100 / 190) < 1e-12);
  assert.ok(Math.abs(rows[6].avgKwh - 80) < 1e-9, 'July averages the day');
  assert.ok(Math.abs(rows[3].hours - 100 * 0.9 / 25) < 1e-9, '25 kW critical load: 3.6 hours');
  assert.equal(rows[3].powerLimited, false);
  // January: 25% of 400 kW is 100 kW, above the battery's 50 kW: it carries 50 kW.
  assert.equal(rows[0].powerLimited, true);
  assert.equal(rows[0].carriedKw, 50);
  assert.ok(Math.abs(rows[0].hours - 100 * 0.9 / 50) < 1e-9);
  // No building (stand-alone): the charge only.
  assert.equal(backupByMonth({ idx, soc, battery })[0].hours, undefined);
});
