// Per-kWh prices for reading: below a cent in cents (0.76¢/kWh), from a cent
// up in dollars (0.0167 $/kWh). A range takes one unit for both ends, cents
// only when every value is below a cent. Trailing zeros go; at least two
// decimals stay.

const trim = (s) => s.replace(/(\.\d\d\d*?)0+$/, '$1');
const minus = (s) => s.replace(/^-/, '−');
const isCents = (values) => values.every((v) => Math.abs(v) < 0.01);
const amount = (v, cents) => minus(trim((cents ? v * 100 : v).toFixed(cents ? 4 : 6)));
const unitOf = (cents) => (cents ? '¢/kWh' : ' $/kWh');

/** One price: perKwh(0.0076) = "0.76¢/kWh", perKwh(0.0167) = "0.0167 $/kWh". */
export const perKwh = (v) => `${amount(v, isCents([v]))}${unitOf(isCents([v]))}`;

/** A set of prices as "a to b" (or one value when they are all equal), in one unit. */
export function perKwhSpan(values) {
  const a = [...values], cents = isCents(a), lo = Math.min(...a), hi = Math.max(...a);
  return lo === hi ? `${amount(lo, cents)}${unitOf(cents)}` : `${amount(lo, cents)} to ${amount(hi, cents)}${unitOf(cents)}`;
}

/** A table column of prices: its unit for the header and a formatter for its cells. */
export function perKwhColumn(values) {
  const cents = isCents([...values]);
  return { unit: cents ? '¢/kWh' : '$/kWh', cell: (v) => amount(v, cents) };
}
