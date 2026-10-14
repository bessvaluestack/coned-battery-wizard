// Minimal SpreadsheetML helpers for filling an .xlsx template in place:
// cell references, and setting cell values while keeping each cell's style.
// Works on the sheet XML as text, so everything else in the workbook
// (validations, conditional formats, metadata) is left exactly as it was.

export const colToNum = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
export function numToCol(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A cell holding a number, a string (inline) or nothing, in style `style`.
export function cellXml(ref, value, style) {
  const s = style != null ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
}

const cellRe = (ref) => new RegExp(`<c r="${ref}"(?=[ >/])[^>]*?(?:/>|>.*?</c>)`, 's');

// Set existing cells: { C6: 12.5, B3: 'text', D7: null }. Each keeps its style
// (or takes `style` when given); any formula in it is replaced by the value.
export function setCells(xml, values, style) {
  for (const [ref, value] of Object.entries(values)) {
    const m = xml.match(cellRe(ref));
    if (!m) throw new Error(`cell ${ref} not found`);
    const s = style != null ? style : (m[0].match(/^<c [^>]*?\bs="(\d+)"/) || [])[1];
    xml = xml.slice(0, m.index) + cellXml(ref, value, s) + xml.slice(m.index + m[0].length);
  }
  return xml;
}

// Fill many rows in one pass (an 8,760-row sheet would be far too slow cell by
// cell): rowValues(n) returns { D: 1.5, E: -2 } for row n, or null to skip.
export function fillRows(xml, rowValues) {
  return xml.replace(/<row r="(\d+)"[^>]*>.*?<\/row>/gs, (row, n) => {
    const vals = rowValues(+n);
    if (!vals) return row;
    const refs = {};
    for (const [col, v] of Object.entries(vals)) refs[`${col}${n}`] = v;
    return setCells(row, refs);
  });
}
