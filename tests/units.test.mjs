// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { perKwh, perKwhSpan, perKwhColumn } from '../js/units.js';

test('per-kWh prices: cents below a cent, dollars from a cent up; one unit for a range or a column', () => {
  assert.equal(perKwh(0.0076), '0.76¢/kWh');
  assert.equal(perKwh(0.002632), '0.2632¢/kWh');
  assert.equal(perKwh(0.000086), '0.0086¢/kWh');
  assert.equal(perKwh(-0.00726), '−0.726¢/kWh');
  assert.equal(perKwh(0.0167), '0.0167 $/kWh');
  assert.equal(perKwh(0.067341), '0.067341 $/kWh');
  assert.equal(perKwh(0.01), '0.01 $/kWh');
  assert.equal(perKwhSpan([0.001234, 0.002895, 0.0015]), '0.1234 to 0.2895¢/kWh');
  assert.equal(perKwhSpan([-0.026229, 0.067341]), '−0.026229 to 0.067341 $/kWh', 'any value from a cent up keeps the range in dollars');
  assert.equal(perKwhSpan([0.0167, 0.0167]), '0.0167 $/kWh');
  const col = perKwhColumn([0.000341, 0.0039]);
  assert.equal(col.unit, '¢/kWh');
  assert.equal(col.cell(0.000341), '0.0341');
  assert.equal(perKwhColumn([0.005, 0.02]).unit, '$/kWh');
});
