// The pro-forma's Wizard_Import sheet: everything the wizard hands the
// financial model, in one protected sheet with a fixed layout. The template
// generator lays it out (labels, headers, empty cells in their formats) and
// links the model's battery, savings and rate cells to it; the download only
// writes values here (and the 8,760 hourly rows on Hourly_Operations).
//
// The layout is the interface between the two tools: add rows at the end of
// a block or new blocks below, never move an existing cell.

export const WIZ_SHEET = 'Wizard_Import';
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// [key, label, format, note]
export const PROJECT_FIELDS = [
  ['id', 'Project ID', 'text', 'Stable for the life of the project'],
  ['name', 'Project name', 'text'],
  ['config', 'Configuration fingerprint', 'text', 'Changes whenever an input changes'],
  ['run', 'Run (date and time)', 'text', 'UTC'],
  ['version', 'Wizard version', 'text'],
  ['ratesDate', 'Rates and statements in force on', 'text'],
  ['modality', 'Modality', 'text'],
  ['utility', 'Utility', 'text'],
  ['rate', 'Account and rate', 'text'],
  ['area', 'Service area and NYISO zone', 'text'],
  ['supply', 'Supply', 'text'],
  ['dr', 'Demand response / Value Stack election', 'text'],
  ['load', 'Load profile', 'text'],
  ['exports', 'Value Stack exports', 'bool', 'TRUE: net hourly injections credited under Rider R A.9(d) with SC 11'],
  ['interval', 'Billing demand interval', 'int', 'minutes'],
  ['tax', 'Taxes and surcharges on the bill', 'pct', 'Included in every $ below'],
];
export const BATTERY_FIELDS = [
  ['kw', 'Power', 'num1', 'kW'],
  ['kwh', 'Energy, nameplate', 'num1', 'kWh'],
  ['duration', 'Duration', 'num1', 'hours'],
  ['rte', 'Round-trip efficiency', 'pct', 'AC to AC'],
  ['usable', 'Usable share of nameplate', 'pct'],
  ['cycles', 'Annual cycle limit', 'int', 'equivalent full cycles a year; 0 = no limit'],
  ['throughputCost', 'Throughput cost', 'rate4', '$/kWh discharged (dispatch penalty)'],
  ['cyclesYear1', 'Equivalent full cycles, Year 1', 'num1'],
  ['dischargedMwh', 'Energy discharged, Year 1', 'num1', 'MWh'],
  ['installedCost', 'Installed cost entered in the wizard', 'money', '$; blank when none was entered'],
];
export const SUMMARY_FIELDS = [
  ['baseline', 'Baseline bill', 'money', 'Without the battery (none for a stand-alone battery)'],
  ['withBattery', 'Bill with the battery', 'money'],
  ['billSavings', 'Bill savings', 'money', 'Demand + energy + fixed'],
  ['demandSavings', 'of which demand charges', 'money'],
  ['energySavings', 'of which energy', 'money'],
  ['fixedChange', 'of which fixed charges', 'money'],
  ['programs', 'Demand-response program revenue', 'money'],
  ['credits', 'Value Stack credits', 'money'],
  ['net', 'Annual net benefit', 'money', 'Bill savings + programs + Value Stack'],
  ['billOnly', 'Bill savings if dispatched for the bill alone', 'money', 'Blank unless programs are enrolled behind the meter'],
];
export const UTILITY_COLS = [
  ['month', 'Month', 'text'],
  ['kwhBase', 'Baseline energy (kWh)', 'int'],
  ['kwhAfter', 'Import with battery (kWh)', 'int'],
  ['kwhExport', 'Export (kWh)', 'int'],
  ['peakBase', 'Baseline billing peak (kW)', 'num1'],
  ['peakAfter', 'Billing peak with battery (kW)', 'num1'],
  ['demandBase', 'Baseline demand ($)', 'money'],
  ['demandAfter', 'Demand with battery ($)', 'money'],
  ['demandSav', 'Demand savings ($)', 'money'],
  ['demandRate', 'Effective demand rate, baseline ($/kW-mo)', 'money'],
  ['energyBase', 'Baseline energy ($)', 'money'],
  ['energyAfter', 'Energy with battery ($)', 'money'],
  ['energySav', 'Energy savings ($)', 'money'],
  ['energyRate', 'Average energy rate, baseline ($/kWh)', 'rate4'],
  ['fixedChange', 'Fixed charge change ($)', 'money'],
  ['rateChange', 'Of energy savings: rate change on the baseline load ($)', 'money'],
  ['billSav', 'Bill savings ($)', 'money'],
  ['actualBill', 'Actual bill entered ($)', 'money'],
];
export const PROGRAM_IDS = ['csrp', 'dlrp', 'term_dlm', 'auto_dlm'];
export const PROGRAM_NAMES = { csrp: 'CSRP', dlrp: 'DLRP', term_dlm: 'Term-DLM', auto_dlm: 'Auto-DLM' };
export const PROGRAM_COLS = [['month', 'Month', 'text'],
  ...PROGRAM_IDS.flatMap((id) => [[`${id}Res`, `${PROGRAM_NAMES[id]} reservation ($)`, 'money'], [`${id}Perf`, `${PROGRAM_NAMES[id]} performance ($)`, 'money']]),
  ['total', 'Total ($)', 'money']];
export const PROGRAM_TERMS = [
  ['pledge', 'Pledged load relief (kW)', 'num1'],
  ['delivered', 'Delivered on the weakest event (kW)', 'num1'],
  ['share', 'Delivered share of the pledge', 'pct'],
  ['events', 'Events per season', 'int'],
  ['resRate', 'Reservation rate ($/kW-month)', 'money'],
  ['perfRate', 'Performance rate ($/kWh)', 'money'],
  ['resAnnual', 'Reservation, Year 1 ($)', 'money'],
  ['perfAnnual', 'Performance, Year 1 ($)', 'money'],
];
export const VS_COLS = [['month', 'Month', 'text'], ['exportKwh', 'Export (kWh)', 'int'], ['energy', 'Energy ($)', 'money'], ['drv', 'DRV ($)', 'money'],
  ['alt3', 'Capacity, Alternative 3 ($)', 'money'], ['lsrv', 'LSRV ($)', 'money'], ['total', 'Total ($)', 'money']];
export const VS_FIELDS = [
  ['election', 'Election', 'text'],
  ['alt3Kw', 'Alternative 3: kW held through the likely peak hours', 'num1'],
  ['alt3Rate', 'Alternative 3: $/kW-year with losses', 'money'],
  ['drvWindow', 'DRV call window', 'text'],
  ['lsrvEvents', 'LSRV events', 'int'],
];
export const DEMAND_COLS = [['charge', 'Charge', 'text'], ['period', 'Billed', 'text'], ['month', 'Month', 'text'], ['rate', 'Rate', 'rate4'], ['rateUnit', 'Rate unit', 'text'],
  ['detBase', 'Baseline determinant', 'num1'], ['detAfter', 'Determinant with battery', 'num1'], ['detUnit', 'Determinant unit', 'text'],
  ['costBase', 'Baseline ($)', 'money'], ['costAfter', 'With battery ($)', 'money'], ['savings', 'Savings ($)', 'money']];
export const DEMAND_ROWS = 144;
export const ENERGY_COLS = [['component', 'Energy component', 'text'], ['base', 'Baseline ($)', 'money'], ['after', 'With battery ($)', 'money'], ['savings', 'Savings ($)', 'money']];
export const ENERGY_ROWS = 8;

const col = (i) => String.fromCharCode(66 + i); // B, C, ...

// Row numbers of every block, laid out top to bottom.
function layout() {
  let r = 5;
  const L = { title: 2, note: 3 };
  const block = (fields) => { const head = r; const rows = {}; fields.forEach(([k], i) => { rows[k] = head + 1 + i; }); r = head + 1 + fields.length + 1; return { head, rows }; };
  const table = (n, extra = 0) => { const head = r, cols = head + 1, first = head + 2; r = first + n + extra + 1; return { head, cols, first, last: first + n - 1, total: extra ? first + n : null }; };
  L.project = block(PROJECT_FIELDS);
  L.battery = block(BATTERY_FIELDS);
  L.summary = block(SUMMARY_FIELDS);
  L.utility = table(12, 1);
  L.programs = table(12, 1);
  L.terms = block(PROGRAM_TERMS); // its value columns are the four programs
  L.vs = table(12, 1);
  L.vsFields = block(VS_FIELDS);
  L.demand = table(DEMAND_ROWS);
  L.energy = table(ENERGY_ROWS);
  L.hourly = r;
  L.lastRow = r;
  return L;
}
export const LAYOUT = layout();

// Cell addresses for the links and the writer.
export const fieldCell = (blockKey, key) => `C${LAYOUT[blockKey].rows[key]}`;
export function colOf(cols, key) { const i = cols.findIndex(([k]) => k === key); if (i < 0) throw new Error(`no column ${key}`); return col(i); }
export const monthCell = (tableKey, cols, key, m) => `${colOf(cols, key)}${LAYOUT[tableKey].first + m}`;
export const termCell = (key, programId) => `${col(1 + PROGRAM_IDS.indexOf(programId))}${LAYOUT.terms.rows[key]}`;
export const ref = (cell) => `${WIZ_SHEET}!$${cell.replace(/(\d+)/, '$$$1')}`;

/**
 * The sheet's rows as { cell: [value, format] }, from `values` (null: the
 * empty template). Formats: title, note, head (block header), colhead,
 * label, text, bool, int, num1, money, rate4, pct.
 */
export function sheetCells(values = null) {
  const v = values || {};
  const out = {};
  const put = (cell, value, fmt) => { out[cell] = [value, fmt]; };
  put(`B${LAYOUT.title}`, 'WIZARD IMPORT | FROM THE CON EDISON BATTERY WIZARD', 'title');
  put(`B${LAYOUT.note}`, 'Written by the wizard on every download; the model links here. Protected: change the project in the wizard and download again. All $ include taxes and surcharges; Year 1 only.', 'note');
  const block = (key, title, fields, data) => {
    const b = LAYOUT[key];
    data = data || {};
    put(`B${b.head}`, title, 'head'); put(`C${b.head}`, '', 'head'); put(`D${b.head}`, '', 'head');
    for (const [k, label, fmt, note] of fields) {
      put(`B${b.rows[k]}`, label, 'label');
      put(`C${b.rows[k]}`, data[k] === undefined ? null : data[k], fmt);
      put(`D${b.rows[k]}`, note || '', 'note');
    }
  };
  block('project', 'PROJECT', PROJECT_FIELDS, v.project);
  block('battery', 'BATTERY (SET IN THE WIZARD, THE SOURCE OF TRUTH)', BATTERY_FIELDS, v.battery);
  block('summary', 'YEAR 1 SUMMARY ($)', SUMMARY_FIELDS, v.summary);
  const table = (key, title, cols, rows, n, totalKeys = []) => {
    const t = LAYOUT[key];
    put(`B${t.head}`, title, 'head');
    cols.forEach(([, label], i) => put(`${col(i)}${t.cols}`, label, 'colhead'));
    for (let i = 0; i < n; i++) {
      const row = (rows || [])[i] || {};
      cols.forEach(([k, , fmt], c) => put(`${col(c)}${t.first + i}`, row[k] === undefined ? (k === 'month' && n === 12 ? MONTHS[i] : null) : row[k], fmt));
    }
    if (t.total) {
      put(`B${t.total}`, 'Year 1', 'label');
      cols.forEach(([k, , fmt], c) => { if (totalKeys.includes(k)) put(`${col(c)}${t.total}`, { f: `SUM(${col(c)}${t.first}:${col(c)}${t.last})` }, fmt); });
    }
  };
  const sumKeys = (cols) => cols.filter(([k, , fmt]) => (fmt === 'money' || fmt === 'int') && !/Rate$/.test(k)).map(([k]) => k);
  table('utility', 'MONTHLY UTILITY BILL: BASELINE AND WITH THE BATTERY', UTILITY_COLS, v.utility, 12, sumKeys(UTILITY_COLS));
  table('programs', 'DEMAND-RESPONSE PROGRAM REVENUE BY MONTH (ONE DISPATCH, NO DOUBLE COUNTING)', PROGRAM_COLS, v.programs, 12, sumKeys(PROGRAM_COLS));
  const T = LAYOUT.terms;
  put(`B${T.head}`, 'PROGRAM TERMS', 'head');
  PROGRAM_IDS.forEach((id, i) => put(`${col(1 + i)}${T.head}`, PROGRAM_NAMES[id], 'head'));
  for (const [k, label, fmt] of PROGRAM_TERMS) {
    put(`B${T.rows[k]}`, label, 'label');
    PROGRAM_IDS.forEach((id) => { const x = v.terms && v.terms[id] ? v.terms[id][k] : undefined; put(termCell(k, id), x === undefined ? null : x, fmt); });
  }
  table('vs', 'VALUE STACK CREDITS BY MONTH', VS_COLS, v.vs, 12, sumKeys(VS_COLS));
  block('vsFields', 'VALUE STACK TERMS', VS_FIELDS, v.vsFields);
  table('demand', 'DEMAND CHARGES BY MONTH (EACH DETERMINANT AND RATE)', DEMAND_COLS, v.demand, DEMAND_ROWS);
  table('energy', 'ENERGY BY COMPONENT, YEAR 1', ENERGY_COLS, v.energy, ENERGY_ROWS);
  put(`B${LAYOUT.hourly}`, 'Hourly (8,760 rows): Hourly_Operations D baseline kW, E battery dispatch kW (net of charging), H energy rate $/kWh, L export credit $/kWh.', 'note');
  return out;
}
