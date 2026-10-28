// Wizard controller: state, rendering, and the run.
import { buildIndex, DT_HOURS, MONTH_NAMES, labelOf } from './timeidx.js';
import { buildStack, billFor, monthlyBills, lpInputs, programRevenue, summarize, eventEnergyCheck, backupByMonth, MIN_PERFORMANCE, RATE_LABELS, MODALITIES, chargingAccount, exportsOn, LIMITS, ROMAN } from './model.js';
import { ELECTIONS, valueStackCredits, drvIntervals } from './valuestack.js';
import { SUPPLY_MODES } from './supply.js';
import { PROGRAM_IDS, PROGRAM_LABELS, PROGRAM_EXCLUDES } from './programs.js';
import { stats, scaleToBill, scaleToMonthlyBills, parseIntervalCsv, toCsv } from './profiles.js';
import { solveDispatch, solveAll } from './solve.js';
import { CURVE_LEVELS, pctOf, atLevel, curvePoint, capacityCurve } from './curve.js';
import { barChart, lineChart } from './charts.js';
import { monthlyEnergyKwh, monthlyPeakKw } from './tariff.js';
import { TEMPLATE_URL, XLSX_TYPE, proformaData, fillProforma } from './proforma.js';
import * as edition from './edition.js';
import { APP_VERSION, newProject, fingerprint, fileSlug, projectFile, readProjectFile, readProjectDoc, runSnapshot, solFromSnapshot, projectHash, readProjectHash } from './project.js';
import { STORE } from './store.js';

// The steps follow the modality: a stand-alone battery has no building load,
// and a Value Stack battery chooses its election instead of the riders.
const STEP_SETS = {
  btm: ['modality', 'rate', 'supply', 'riders', 'load', 'battery', 'results'],
  btm_vs: ['modality', 'rate', 'supply', 'valuestack', 'load', 'battery', 'results'],
  ftm: ['modality', 'rate', 'supply', 'valuestack', 'battery', 'results'],
};
const STEP_LABELS = { modality: 'Modality', rate: 'Rate', supply: 'Supply', riders: 'Riders', valuestack: 'Value Stack', load: 'Load', battery: 'Battery', results: 'Results' };
const steps = () => STEP_SETS[state.modality] || STEP_SETS.btm;
const stepId = () => steps()[state.step] || 'modality';
const stepLabel = (id) => (id === 'rate' && state.modality === 'ftm' ? 'Site' : STEP_LABELS[id]);
const STORAGE_KEY = 'coned-battery-wizard.v1';

const DEFAULTS = {
  step: 0, project: null, modality: 'btm', ftmRateNo: 1,
  serviceClass: 8, rateNo: 1, voltage: 'lt', region: 'nyc', zone: 'J', demandIntervalMin: 15, taxPct: 2.5,
  adjustments: { kwh: null, sbcDemand: true, extraDemand: 0 },
  supply: { mode: 'coned_msc', capacityRate: null, mfc: null, reconciliation: null, taxReimbursement: null, fixedRate: 0.09, adder: 0.02, escoCapacity: 0 },
  programs: { enabled: { csrp: false, dlrp: false, term_dlm: false, auto_dlm: false }, network: '', pledgeKw: 100, participation: 'direct', events: { csrp: 3, dlrp: 2, term_dlm: 3, auto_dlm: 3 }, termDlm: { reservationRate: '', performanceRate: '' }, autoDlm: { reservationRate: '', performanceRate: '' } },
  valueStack: { election: 'value_stack', lsrv: false, lsrvEvents: 10, alt3: { hours: [15, 18], days: 10, rate: null }, riderT: { csrp: true, dlrp: true }, acProgram: 'auto_dlm', acDlrp: false },
  load: { mode: 'preset', presetId: 'highrise_central_cooling', billTarget: null, billMode: 'annual', monthlyBills: null, billShape: 'highrise_central_cooling', uploadUnits: 'auto', loadTab: 'preset' },
  battery: { kw: 200, kwh: 400, rte: 88, usable: 95, cycles: 300, throughputCost: 0, capexK: '', curve: true },
};

let state = loadState();
let data = null;            // fetched JSON
const presetCache = new Map();
let uploaded = null;        // { kw, meta, name }: travels in the project file, not kept in the browser
let results = null;
let running = false;

const $ = (sel) => document.querySelector(sel);
const fmt$ = (v, d = 0) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtN = (v, d = 0) => (+v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const roman = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
// An input problem the user can fix: shown verbatim in every edition.
const userError = (msg) => Object.assign(new Error(msg), { user: true });

function loadState() {
  let s = structuredClone(DEFAULTS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = deepMerge(s, JSON.parse(raw));
  } catch (e) { /* ignore */ }
  if (!s.project || !s.project.id) s.project = newProject();
  return s;
}
function saveState() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, v) { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { if (o[k] == null) o[k] = {}; o = o[k]; } o[ks[ks.length - 1]] = v; }

// ---------------------------------------------------------------- data
async function loadData() {
  const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
  const [sc8, sc9, sc2, statements, msc, J, H, I, programs, presets, valueStack] = await Promise.all([
    get('data/tariffs_sc8.json'), get('data/tariffs_sc9.json'), get('data/tariffs_sc2.json'), get('data/statements.json'), get('data/msc.json'),
    get('data/lbmp_J.json'), get('data/lbmp_H.json'), get('data/lbmp_I.json'), get('data/programs.json'), get('data/profiles/index.json'),
    get('data/value_stack.json'),
  ]);
  data = { tariffs: { ...sc8, ...sc9, ...sc2 }, statements, msc, lbmp: { J, H, I }, programs, presets, valueStack };
}
async function loadPreset(id) {
  if (!presetCache.has(id)) {
    const r = await fetch(`data/profiles/${id}.json`);
    if (!r.ok) throw new Error(`preset ${id}: ${r.status}`);
    const doc = await r.json();
    presetCache.set(id, { ...doc, kw: Float64Array.from(doc.kw) });
  }
  return presetCache.get(id);
}

// ---------------------------------------------------------------- stack + load (memoised)
// The programs a Value Stack battery is enrolled in follow its election.
function electionPrograms(s) {
  const V = s.valueStack;
  const enabled = { csrp: false, dlrp: false, term_dlm: false, auto_dlm: false };
  if (V.election === 'rider_t') Object.assign(enabled, { csrp: !!V.riderT.csrp, dlrp: !!V.riderT.dlrp });
  if (V.election === 'rider_ac') Object.assign(enabled, { [V.acProgram]: true, dlrp: V.acProgram === 'term_dlm' && !!V.acDlrp });
  return { ...s.programs, enabled };
}
const buildingPeak = () => (state.modality !== 'ftm' && loadCache.value ? stats(loadCache.value.kw).peakKw : 0);
function stackConfig() {
  const s = state;
  const modality = s.modality || 'btm';
  const vs = exportsOn(modality);
  const peak = buildingPeak(), batteryKw = +s.battery.kw || 0;
  return {
    modality, serviceClass: +s.serviceClass || 8, rateNo: +s.rateNo, voltage: s.voltage, region: s.region, zone: s.zone, demandIntervalMin: +s.demandIntervalMin, taxPct: +s.taxPct || 0,
    account: chargingAccount({ modality, sc: +s.serviceClass || 8, rateNo: modality === 'ftm' ? +s.ftmRateNo : +s.rateNo, voltage: s.voltage, batteryKw, buildingPeakKw: peak }),
    riderMRequired: modality === 'btm_vs' && peak > 0 && batteryKw > 1.15 * peak,
    adjustments: s.adjustments, supply: s.supply,
    programs: vs ? electionPrograms(s) : s.programs,
    valueStack: vs ? { ...s.valueStack, network: s.programs.network } : null,
  };
}
// The building's bill today: its SC 8 or SC 9 rate (standby if it is on
// Rate IV or V already), no battery, no exports. The load estimate from bills
// and the baseline bill use it.
function baseConfig() {
  const cfg = stackConfig();
  return { ...cfg, modality: 'btm', account: { sc: cfg.serviceClass, rateNo: +state.rateNo, voltage: state.voltage, standby: +state.rateNo >= 4 }, riderMRequired: false, programs: {}, valueStack: null };
}
function cachedStack(cache, cfg) {
  const key = JSON.stringify(cfg);
  if (cache.key !== key) {
    Object.assign(cache, { key, value: null, error: null });
    try { cache.value = buildStack(cfg, data); } catch (e) { cache.error = e; edition.logError(e); }
  }
  if (cache.error) throw cache.error;
  return cache.value;
}
const stackCache = { key: null, value: null, error: null }, baseCache = { key: null, value: null, error: null };
const getStack = () => cachedStack(stackCache, stackConfig());
const getBaseStack = () => cachedStack(baseCache, baseConfig());

let loadCache = { key: null, value: null };
async function getLoad() {
  const L = state.load;
  if (state.modality === 'ftm') {
    const idx = buildIndex();
    if (loadCache.key !== 'none') loadCache = { key: 'none', value: { kw: new Float64Array(idx.T), label: 'No on-site load (stand-alone battery)', source: 'none', meta: {} } };
    return loadCache.value;
  }
  const stackKey = baseCache.key || JSON.stringify(baseConfig());
  const monthly = L.billMode === 'monthly' && L.monthlyBills;
  let key;
  if (L.mode === 'preset') key = `preset:${L.presetId}`;
  else if (L.mode === 'bill') key = `bill:${monthly ? L.monthlyBills.join(',') : L.billTarget}:${L.billShape}:${stackKey}`;
  else key = `upload:${uploaded ? uploaded.name + uploaded.kw.length : 'none'}`;
  if (loadCache.key === key) return loadCache.value;
  let value = null;
  if (L.mode === 'preset') {
    const p = await loadPreset(L.presetId);
    value = { kw: p.kw, label: p.name, source: 'preset', meta: p };
  } else if (L.mode === 'bill') {
    const p = await loadPreset(L.billShape);
    const stack = getBaseStack();
    if (monthly) {
      const targets = L.monthlyBills.map((v) => +v || 0);
      const { kw, scales, floor } = scaleToMonthlyBills(p.kw, targets, (k) => monthlyBills(stack, k), stack.idx.month);
      const total = targets.reduce((a, v) => a + v, 0);
      value = { kw, label: `Estimated from 12 monthly bills totalling ${fmt$(total)} / yr (${p.name} shape, x${Math.min(...scales).toFixed(2)} to x${Math.max(...scales).toFixed(2)})`, source: 'bill', meta: { shape: p.name, scales, belowFixed: targets.map((v, m) => v < floor[m]) } };
    } else {
      const { kw, scale } = scaleToBill(p.kw, +L.billTarget || 0, (k) => billFor(stack, k).total);
      value = { kw, label: `Estimated from ${fmt$(+L.billTarget)} / yr (${p.name} shape, x${scale.toFixed(3)})`, source: 'bill', meta: { shape: p.name, scale } };
    }
  } else if (uploaded) {
    value = { kw: uploaded.kw, label: `Uploaded: ${uploaded.name}`, source: 'upload', meta: uploaded.meta };
  }
  loadCache = { key, value };
  return value;
}

// Modelled bills for a profile under the current rate and supply: where the
// "From the annual bill" estimate starts (the annual total to the nearest
// $1,000, months to the nearest $100).
const roundBill = (v) => Math.round(v / 1000) * 1000;
const roundMonth = (v) => Math.round(v / 100) * 100;
function billsFor(kw) {
  const stack = getBaseStack();
  return { annual: billFor(stack, kw).total, monthly: monthlyBills(stack, kw) };
}
async function presetBills(id) { return billsFor((await loadPreset(id)).kw); }
function setBillTargets(bills) {
  state.load.billTarget = roundBill(bills.annual);
  state.load.monthlyBills = bills.monthly.map(roundMonth);
}

// ---------------------------------------------------------------- rendering
function render() {
  renderStepper();
  renderPanel().catch((e) => { $('#panel').innerHTML = edition.errorHtml(e); edition.logError(e); });
  renderRail().catch((e) => edition.logError(e));
  saveState();
}

function renderStepper() {
  const el = $('#stepper');
  el.innerHTML = steps().map((id, i) => `<button type="button" data-step="${i}" class="${i === state.step ? 'active' : ''} ${i < state.step ? 'done' : ''}" ${id === 'results' && !results ? 'disabled' : ''}><span class="n">${i + 1}</span><span class="l">${stepLabel(id)}</span></button>`).join('');
  el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => go(+b.dataset.step)));
}
function goToSilently(id) { state.step = Math.max(0, steps().indexOf(id)); }
function go(step) { state.step = Math.max(0, Math.min(steps().length - 1, step)); render(); window.scrollTo({ top: 0 }); }
const goTo = (id) => go(steps().indexOf(id));
function navButtons(opts = {}) {
  const ids = steps(), i = state.step;
  const prev = i > 0 ? `<button type="button" class="btn" data-nav="-1">Back</button>` : '<span></span>';
  const next = ids[i + 1] && ids[i + 1] !== 'results' ? `<button type="button" class="btn primary" data-nav="1">${opts.nextLabel || 'Next: ' + stepLabel(ids[i + 1])}</button>` : (opts.next || '');
  return `<div class="actions">${prev}${next}</div>`;
}

// Each step's page in the manual (manual.html, manual/*.md).
const MANUAL_PAGE = { modality: 'modality', rate: 'rate', supply: 'supply', riders: 'demand-response', valuestack: 'value-stack', load: 'load', battery: 'battery', results: 'results' };
const manualLink = (id) => `manual.html#/${MANUAL_PAGE[id]}${id === 'rate' && state.modality === 'ftm' ? '/site-and-charging-account-stand-alone' : ''}`;

async function renderPanel() {
  const panel = $('#panel');
  const fns = { modality: stepModality, rate: stepRate, supply: stepSupply, riders: stepRiders, valuestack: stepValueStack, load: stepLoad, battery: stepBattery, results: stepResults };
  const id = stepId();
  panel.innerHTML = await fns[id]();
  const head = panel.querySelector('h2');
  if (head) head.insertAdjacentHTML('afterbegin', `<a class="help-link" href="${manualLink(id)}" target="_blank" rel="noopener">Manual</a>`);
  bindInputs(panel);
  panel.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => go(state.step + +b.dataset.nav)));
  const after = panel._after; if (after) { panel._after = null; after(); }
  if (id === 'load') await afterLoadStep();
  if (id === 'results') afterResults();
}

function bindInputs(root) {
  root.querySelectorAll('[data-path]').forEach((input) => {
    input.addEventListener('change', async () => {
      let v;
      if (input.type === 'checkbox') v = input.checked;
      else if (input.type === 'number') v = input.value === '' ? (input.dataset.nullable ? null : 0) : +input.value;
      else if (input.type === 'range') v = +input.value;
      else v = input.value;
      if (input.dataset.cast === 'int') v = parseInt(v, 10);
      setPath(state, input.dataset.path, v);
      // Enrolling in a program drops the ones it cannot be combined with.
      const prog = input.dataset.path.match(/^programs\.enabled\.(\w+)$/);
      if (prog && v) for (const x of PROGRAM_EXCLUDES[prog[1]] || []) state.programs.enabled[x] = false;
      if (input.dataset.path === 'region') state.zone = v === 'nyc' ? 'J' : (state.zone === 'J' ? 'H' : state.zone);
      if (input.dataset.path === 'modality') state.step = 0;
      if (input.dataset.path === 'serviceClass' && !RATES_OF[v].includes(+state.rateNo)) state.rateNo = 1;
      if (input.dataset.path.startsWith('valueStack.alt3.hours')) state.valueStack.alt3.hours = state.valueStack.alt3.hours.map(Number);
      // Rate II customers are on Rider M hourly pricing by default.
      if (input.dataset.path === 'rateNo' && v === 2 && state.supply.mode === 'coned_msc') state.supply.mode = 'coned_mhp';
      // A new load shape restarts the bill estimate at that preset's own bills; the user edits from there.
      if (input.dataset.path === 'load.billShape') {
        try { setBillTargets(await presetBills(v)); } catch (e) { edition.logError(e); }
      }
      results = null;
      render();
    });
    // Sliders mirror their number box while dragging and commit on release.
    if (input.type === 'range') input.addEventListener('input', () => { const box = document.getElementById(input.dataset.mirror); if (box) box.value = input.value; });
  });
}

function field(label, inner, help = '') {
  return `<div class="field"><label class="lab">${label}</label>${inner}${help ? `<span class="help">${help}</span>` : ''}</div>`;
}
function numInput(path, value, { step = 'any', min, max, unit, nullable = false, placeholder = '' } = {}) {
  const v = value === null || value === undefined ? '' : value;
  const inp = `<input type="number" id="f-${path.replace(/\./g, '-')}" data-path="${path}" ${nullable ? 'data-nullable="1"' : ''} value="${v}" step="${step}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} placeholder="${placeholder}">`;
  return unit ? `<div class="unit">${inp}<span>${unit}</span></div>` : inp;
}
// A slider from 50% to 200% of a reference bill, paired with the number box for the same path.
function billSlider(path, value, ref, step, label) {
  const lo = Math.max(0, Math.floor(ref * 0.5 / step) * step), hi = Math.max(step, Math.ceil(ref * 2 / step) * step);
  return `<input type="range" data-path="${path}" data-mirror="f-${path.replace(/\./g, '-')}" min="${lo}" max="${hi}" step="${step}" value="${Math.min(hi, Math.max(lo, +value || 0))}" aria-label="${label}">`;
}
function select(path, value, options, cast) {
  return `<select id="f-${path.replace(/\./g, '-')}" data-path="${path}" ${cast ? `data-cast="${cast}"` : ''}>${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}

// ---------------------------------------------------------------- step 1: modality
const MODALITY_BLURB = {
  btm: 'The building\'s own battery on its SC 8 or SC 9 account. It cuts the building\'s demand and energy bill and can earn Con Edison demand-response payments, but never sends power back to the grid.',
  btm_vs: 'The same battery, also exporting to the grid under the Value Stack (Rider R A.9(d) with SC 11 buy-back service). Exports earn energy, capacity and demand-reduction credits; the building keeps its bill savings.',
  ftm: 'A stand-alone battery with its own Con Edison account and no load of its own, charging from and exporting to the grid under the Value Stack.',
};
// What each modality needs: the comparison shown on the first step.
const REQUIREMENTS = [
  ['Account and tariff',
    'The building stays on its SC 8 or SC 9 rate. No Rider R or SC 11, and the battery does not move it to standby.',
    'The building stays on its SC 8 or SC 9 rate and adds Rider R A.9(d) and SC 11. Standard rates stay if the battery is 1 MW or less or within 15% of the building\'s peak; otherwise standby (Rate IV / V of the same class). Rider M hourly supply when the battery exceeds 115% of the building\'s load.',
    'Its own account: SC 2 up to 10 kW, SC 9 standard rates up to 1 MW, SC 9 standby (Rate IV / V) above. Rider R A.9(d) and SC 11; Rider M hourly supply (or an ESCO). Up to 5 MW.'],
  ['Exports',
    'None: a non-export relay or controls keep the meter importing.',
    'Credited only on each hour\'s net injection, after the building\'s own load.',
    'All discharge is exported; credits on each hour\'s net injection.'],
  ['Revenue',
    'Demand-charge and energy savings on the bill, plus demand response with performance payments.',
    'Bill savings, plus Value Stack credits on exports: energy (day-ahead LBMP x 1.061 for losses), capacity under Alternative 3 only, DRV in the network\'s CSRP call window, LSRV where MW remain. Storage gets no environmental component.',
    'Value Stack credits, less the charging account\'s bill. Credits are bill credits on the account and can be allocated to other accounts; they are not paid out in cash.'],
  ['Demand response',
    'Rider T CSRP and DLRP (reservation and performance) or Rider AC Term- / Auto-DLM: CSRP + DLRP, Term-DLM + DLRP, or Auto-DLM alone.',
    'An election: keep DRV and LSRV, or take Rider T (DRV and LSRV end for good) or Rider AC (suspended for the contract). Rider R customers get the reservation only, no performance payments.',
    'The same election as behind the meter with exports. Most front-of-meter batteries in Con Edison\'s programs are in Auto-DLM.'],
  ['Inter\u00adconnection',
    'NY SIR application as a non-exporting system; a study (CESIR) above 50 kW. Demand response also needs Con Edison\'s Permission to Operate.',
    'NY SIR exporting application with a CESIR. In NYC\'s network areas exports may be limited or refused; hosting capacity is tight (Con Edison\'s January 2026 notice: about 2,500 MW of storage queued, 20+ substations at or near their limits).',
    'NY SIR up to 5 MW; the CESIR runs 60 business days after the applicant commits; upgrade costs fall on the project. The same hosting-capacity constraints apply.'],
  ['Metering',
    'The existing interval meter; a communicating interval meter for demand response.',
    'A revenue-grade interval meter recording net hourly consumption and injection, with telecommunications, at the customer\'s cost. Credits start after final SIR acceptance.',
    'As behind the meter with exports, on the battery\'s own service.'],
  ['Permits and incentives',
    'FDNY Certificate of Approval for the battery product (UL 9540 / 9540A), DOB work permit, FDNY inspection and operating permit (indoor, or outdoor above 20 kWh), a B-28 Certificate of Fitness holder.',
    'The same FDNY and DOB requirements. NYSERDA Retail Storage Incentive for systems up to 5 MW.',
    'The same; large outdoor systems need both FDNY and DOB review. NYSERDA Retail Storage Incentive (up to 5 MW, front of the meter on the distribution system included).'],
  ['Not available',
    'Net metering: an SC 8 or SC 9 building with storage cannot take Phase One net metering (only small SC 1 / SC 2 customers can); solar plus storage there goes on the Value Stack.',
    'The environmental component, Market Transition Credit and Community Credit (storage is not an eligible generator).',
    'The same. The Wholesale Value Stack (energy and capacity sold to NYISO directly, DRV and LSRV kept) is an alternative this tool does not model.'],
];

async function stepModality() {
  const m = state.modality;
  const head = Object.keys(MODALITIES).map((k) => `<th class="${k === m ? 'sel' : ''}">${esc(MODALITIES[k])}</th>`).join('');
  const body = REQUIREMENTS.map(([row, ...cells]) => `<tr><td><b>${row}</b></td>${cells.map((c, i) => `<td class="${Object.keys(MODALITIES)[i] === m ? 'sel' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('');
  return `
    <h2>Modality</h2>
    <p class="lede">How the battery connects and is paid. The rest of the wizard follows this choice: a behind-the-meter battery is modelled against the building's load and bill, a stand-alone one against its own charging account.</p>
    <fieldset><legend>Project type</legend>
      <div class="choices">
        ${Object.entries(MODALITIES).map(([k, l]) => `<label class="choice"><input type="radio" name="modality" data-path="modality" value="${k}" ${m === k ? 'checked' : ''}><b>${esc(l)}</b><small>${esc(MODALITY_BLURB[k])}</small></label>`).join('')}
      </div>
    </fieldset>
    <h3>What each one needs</h3>
    <div class="tablewrap"><table class="reqs"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="note">From Con Edison's electric tariff (Rider R, Rider T, Rider AC, General Rule 20, SC 11) and the Value Stack statements in force, the NY SIR and FDNY's storage guidance; an outline, not legal or interconnection advice.</p>
    ${navButtons()}`;
}

// ---------------------------------------------------------------- step 2: rate (site, for a stand-alone battery)
const SC_NAMES = { 2: 'SC 2 (General - Small)', 8: 'SC 8 (Multiple Dwellings, Redistribution)', 9: 'SC 9 (General - Large)' };
// The rates a building can be on, and what each one is.
const RATES_OF = { 8: [1, 2, 3], 9: [1, 2, 3, 4, 5] };
const SC_BLURB = {
  8: 'A multiple dwelling that buys at a master meter and redistributes electricity to its residents.',
  9: 'Commercial and other large accounts not on SC 8, above SC 2\'s 10 kW.',
};
const RATE_TEXT = {
  1: 'Standard service: one all-hours demand charge per month, summer and other-month prices.',
  2: 'Mandatory time-of-day above 1,500 kW: weekday 8-18 and 8-22 demand windows plus an all-hours charge. Supply defaults to Rider M hourly pricing.',
  3: 'Voluntary time-of-day for smaller customers: the Rate II windows at Rate III prices.',
  4: 'Standby service (General Rule 20) for a building already on standby, for example with on-site generation: a contract demand billed every month, daily as-used demand, Rider M hourly supply.',
  5: 'Standby, as Rate IV, for a contract demand above 1,500 kW.',
};
// Whether the building's peak fits the rate it is on.
function rateFitFlags(peakKw) {
  const r = +state.rateNo, flags = [];
  if (!(peakKw > 0)) return flags;
  if (r <= 3 && r !== 2 && peakKw > LIMITS.rateVKw) flags.push(`Peak above ${fmtN(LIMITS.rateVKw)} kW: Con Edison bills such customers under Rate II (mandatory time-of-day).`);
  if (r === 2 && peakKw < 900) flags.push('Peak below 900 kW for a year moves a Rate II customer back to Rate I.');
  if (r === 4 && peakKw > LIMITS.rateVKw) flags.push(`Peak above ${fmtN(LIMITS.rateVKw)} kW: a contract demand that size is billed under Rate V.`);
  if (r === 5 && peakKw <= LIMITS.rateVKw) flags.push(`Peak within ${fmtN(LIMITS.rateVKw)} kW: a contract demand that size is billed under Rate IV.`);
  return flags;
}
const MAX_RATE_NOTE = 'SC 9 Rate I carries a maximum-rate provision for some customers; it is not modelled here.';

function accountLabel(a) { return `SC ${a.sc} Rate ${ROMAN[a.rateNo]}${a.voltage ? ' ' + a.voltage.toUpperCase() : ''}${a.standby ? ' (standby)' : ''}`; }

function rateCard(stack) {
  const t = stack.tariff;
  const unit = (c) => (c.period === 'day' ? '$/kW-day' : '$/kW-mo');
  const what = (c) => (c.period === 'year' ? 'contract demand' : c.period === 'day' ? 'daily as-used demand' : 'monthly demand');
  const demandRows = stack.ta.demandCharges.map((c) => `<tr><td>${esc(c.name.replace(/_/g, ' '))} (${what(c)})</td><td>${c.months.length === 12 ? 'all year' : c.months.map((m) => MONTH_NAMES[m - 1]).join(', ')}</td><td>${c.days === 'all' ? 'all days' : c.days}${c.hours ? `, ${c.hours[0]}:00 to ${c.hours[1]}:00` : ', all hours'}</td><td class="num">${c.rate.toFixed(c.period === 'day' ? 4 : 2)} ${unit(c)}</td></tr>`).join('');
  const energyRows = t.energy.seasons.map((se) => se.tou.map((w) => `<tr><td>Delivery energy${t.energy.seasons.length > 1 ? ` (${esc(se.name.replace(/_/g, ' '))})` : ''}</td><td>${se.months.length === 12 ? 'all year' : se.months.map((m) => MONTH_NAMES[m - 1]).join(', ')}</td><td>${w.hours ? `${w.hours[0]}:00 to ${w.hours[1]}:00` : 'all hours'}</td><td class="num">${(+w.rate).toFixed(4)} $/kWh</td></tr>`).join('')).join('');
  return `
    <h3>Rate card: ${esc(t.name)}</h3>
    <p class="note">${esc(t.applicability || '').slice(0, 420)}${(t.applicability || '').length > 420 ? '...' : ''}</p>
    <div class="tablewrap"><table>
      <thead><tr><th>Charge</th><th>Months</th><th>Window</th><th class="num">Rate</th></tr></thead>
      <tbody>
        <tr><td>Customer charge</td><td>all year</td><td></td><td class="num">${(+t.fixed_charge_per_month).toFixed(2)} $/mo</td></tr>
        ${energyRows}${demandRows}
      </tbody>
    </table></div>
    ${t.standby ? '<p class="note">Standby service: the contract demand (the most the account takes from the grid, chosen by the dispatch here) is billed every month, and each weekday\'s peak in the as-used windows is billed per day. There is no delivery charge per kWh.</p>' : ''}`;
}

async function stepRate() {
  const st = data.statements, k = st.delivery_adjustments_usd_per_kwh;
  const stack = getStack();
  const ftm = state.modality === 'ftm', acct = stack.account, bc = st.by_class[`sc${acct.sc}`], sc = +state.serviceClass || 8;
  const kwhRows = [['NYSERDA SBC surcharge', k.sbc_total_nyserda.value, k.sbc_total_nyserda.statement.effective], ['Monthly Adjustment Clause (MAC)', k.mac.value, k.mac.statement.effective], ['MAC adjustment factor', k.mac_adjustment_factor.value, k.mac_adjustment_factor.statement.effective],
    [`Revenue decoupling (RDM), SC ${acct.sc}`, bc.kwh.rdm, k.rdm_sc8.statement.effective], ...(acct.standby ? [] : [[`Delivery revenue surcharge (SDR), SC ${acct.sc}`, bc.kwh.sdr, k.sdr_sc8_rates_i_ii_iii.statement.effective]]),
    ...(bc.kwh.sbc_company_ee ? [['Company-administered EE / BE charge', bc.kwh.sbc_company_ee, k.sbc_total_nyserda.statement.effective]] : [])];
  const sbc = acct.sc === 2 ? null : acct.standby ? `${bc.kw.standby.contract_demand_kw.toFixed(2)} $/kW-month on the contract demand (SBC and SDR, standby)` : acct.rateNo === 1 ? `${bc.kw.rate1.monthly_max_demand_kw} $/kW-month on the monthly maximum (Rate I)` : `${bc.kw.tod.tod_demand_kw} $/kW-month on the weekday 8-22 demand (time-of-day rates)`;
  const site = `
      ${field('Service voltage', select('voltage', state.voltage, [['lt', 'Low tension (secondary)'], ['ht', 'High tension (primary)']]))}
      ${field('Service area', select('region', state.region, [['nyc', 'New York City (NYISO zone J)'], ['westchester', 'Westchester (zone H / I)']]), 'Sets the supply capacity charge, LBMP zone, Alternative 3 rate and CSRP rate group.')}
      ${state.region === 'westchester' ? field('NYISO zone', select('zone', state.zone, [['H', 'H (Millwood)'], ['I', 'I (Dunwoodie)']])) : ''}
      ${field('Billing demand interval', select('demandIntervalMin', state.demandIntervalMin, [['15', '15-minute demand (Con Edison default)'], ['30', '30-minute integrated demand']], 'int'), 'The determinant the demand charges bill on.')}
      ${field('Taxes and surcharges on the bill', numInput('taxPct', state.taxPct, { step: 0.1, min: 0, max: 20, unit: '%' }), ftm ? 'Applied to the charging account\'s delivery and supply; Value Stack credits are not taxed here. Illustrative default.' : +state.serviceClass === 9 ? 'Applied to delivery and supply. GRT-type surcharges are a few percent; a commercial SC 9 account generally also pays state and local sales tax (about 8.875% in NYC), while a residential building may be exempt. Illustrative default: add the sales tax if it applies.' : 'Applied to delivery and supply. Residential redistribution is sales-tax exempt; GRT-type surcharges are a few percent. Illustrative default.')}`;
  const choose = ftm ? `
    <fieldset><legend>Charging account</legend>
      <p class="note">The battery's own account follows its power rating (set on the Battery step, ${fmtN(state.battery.kw)} kW now): SC 2 up to ${LIMITS.sc2Kw} kW, SC 9 on standard rates up to ${fmtN(LIMITS.designatedKw)} kW (storage is a Designated Technology, General Rule 20.3.2(b)), SC 9 standby above (Rate V above ${fmtN(LIMITS.rateVKw)} kW of contract demand).</p>
      <div class="choices">
        ${[1, 3].map((n) => `<label class="choice"><input type="radio" name="ftmRateNo" data-path="ftmRateNo" data-cast="int" value="${n}" ${+state.ftmRateNo === n ? 'checked' : ''}><b>SC 9 Rate ${roman[n]}</b><small>${n === 1 ? 'Standard: one all-hours demand charge per month.' : 'Voluntary time-of-day: weekday 8-18 and 8-22 demand windows plus an all-hours charge.'} Applies while the battery is between 10 kW and 1 MW.</small></label>`).join('')}
      </div>
      <p class="ok">Account now: <b>${accountLabel(acct)}</b>. ${esc(acct.reason)}</p>
    </fieldset>` : `
    <fieldset><legend>Service class</legend>
      <div class="choices">
        ${[8, 9].map((n) => `<label class="choice"><input type="radio" name="serviceClass" data-path="serviceClass" data-cast="int" value="${n}" ${sc === n ? 'checked' : ''}><b>${SC_NAMES[n]}</b><small>${SC_BLURB[n]}</small></label>`).join('')}
      </div>
    </fieldset>
    <fieldset><legend>SC ${sc} rate</legend>
      <div class="choices">
        ${RATES_OF[sc].map((n) => `<label class="choice"><input type="radio" name="rateNo" data-path="rateNo" data-cast="int" value="${n}" ${+state.rateNo === n ? 'checked' : ''}><b>Rate ${roman[n]}</b><small>${RATE_TEXT[n]}</small></label>`).join('')}
      </div>
      ${rateFitFlags(buildingPeak()).map((f) => `<p class="flag">${f}</p>`).join('')}
      ${sc === 9 && +state.rateNo === 1 ? `<p class="note">${MAX_RATE_NOTE}</p>` : ''}
      ${state.modality === 'btm_vs' && (acct.standby || acct.reason) ? `<p class="${acct.standby ? 'flag' : 'ok'}">With the battery: <b>${accountLabel(acct)}</b>. ${esc(acct.reason)}${acct.standby && +state.rateNo <= 3 ? ` The baseline stays the building's current SC ${sc} bill.` : ''}</p>` : ''}
      ${state.modality === 'btm' && acct.standby ? `<p class="ok">${esc(acct.reason)}</p>` : ''}
    </fieldset>`;
  return `
    <h2>${ftm ? 'Site and charging account' : 'Delivery rate'}</h2>
    <p class="lede">Con Edison P.S.C. No. 10, ${SC_NAMES[acct.sc]}.${edition.rateProvenance(stack.tariff)}</p>
    ${choose}
    <div class="grid2">${site}</div>
    <details><summary>Delivery adjustments and surcharges (advanced)</summary>
      <p class="note">Per-kWh statements in force on ${esc(st.in_force_on)}; the demand-based SBC surcharge rides the same determinant as the delivery demand charge. ${edition.UNLISTED_STATEMENTS}</p>
      <div class="tablewrap"><table><thead><tr><th>Statement</th><th>Effective</th><th class="num">$/kWh</th></tr></thead><tbody>
        ${kwhRows.map(([n, v, eff]) => `<tr><td>${n}</td><td>${esc(eff || '')}</td><td class="num">${(+v).toFixed(6)}</td></tr>`).join('')}
        <tr class="total"><td>Sum (default below)</td><td></td><td class="num">${stack.kwhAdjDefault.toFixed(6)}</td></tr>
      </tbody></table></div>
      <div class="grid2">
        ${field('Delivery $/kWh adjustments (override)', numInput('adjustments.kwh', state.adjustments.kwh, { step: 0.0001, unit: '$/kWh', nullable: true, placeholder: stack.kwhAdjDefault.toFixed(6) }), 'Leave blank to use the sum above.')}
        ${field('Other $/kW-month on the monthly maximum', numInput('adjustments.extraDemand', state.adjustments.extraDemand, { step: 0.01, unit: '$/kW-mo' }), 'Anything else billed on the monthly peak.')}
      </div>
      ${sbc ? `<label class="check"><input type="checkbox" data-path="adjustments.sbcDemand" ${state.adjustments.sbcDemand !== false ? 'checked' : ''}><span>Include the SBC demand surcharge <span class="d">${sbc}</span></span></label>` : ''}
    </details>
    ${rateCard(stack)}
    <p class="note">Not modelled: reactive power charges (General Rule 10.11), the Minimum Monthly Charge (General Rule 10.10)${exportsOn(state.modality) ? ', the SC 11 charges (the customer charge is waived when another service class serves the same connection, and stand-alone storage is exempt from the SC 11 contract demand charge for 15 years if it qualifies by the end of 2030)' : ''}.</p>
    ${navButtons()}`;
}

// ---------------------------------------------------------------- step 3: supply
async function stepSupply() {
  const stack = getStack();
  const sup = stack.supply, S = state.supply, st = data.statements;
  const vs = !!stack.valueStack;
  const capBasis = vs && sup.mode === 'coned_mhp' ? 'on the import in the likely NYISO peak hours (the ICAP tag)' : sup.capacityWindows ? 'on weekday demand 8-18 (Jun-Sep) / 8-22' : 'on the monthly max';
  const area = state.region === 'nyc' ? 'NYC' : 'Westchester';
  // The statements behind each month's default, November to October.
  const eff = st.monthly.effective.msc_capacity, first = eff.reduce((a, d) => (d < a ? d : a)), last = eff.reduce((a, d) => (d > a ? d : a));
  const monthName = (d) => `${MONTH_NAMES[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
  const span = (a, d) => (Math.min(...a) === Math.max(...a) ? a[0].toFixed(d) : `${Math.min(...a).toFixed(d)} to ${Math.max(...a).toFixed(d)}`);
  const byMonthNote = `Blank = each month's own statement (${monthName(first)} to ${monthName(last)}); a value here applies all year.`;
  const monthTable = () => `<details><summary>Statement values by month</summary><div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Capacity $/kW-mo</th><th class="num">MFC $/kWh</th>${sup.mode === 'coned_msc' ? '<th class="num">MSC adjustment $/kWh</th><th class="num">Tax reimbursement $/kWh</th>' : ''}</tr></thead><tbody>
    ${MONTH_NAMES.map((n, m) => `<tr><td>${n}</td><td class="num">${sup.capacityByMonth[m].toFixed(2)}</td><td class="num">${sup.mfcByMonth[m].toFixed(6)}</td>${sup.mode === 'coned_msc' ? `<td class="num">${sup.reconciliationByMonth[m].toFixed(6)}</td><td class="num">${sup.taxReimbursementByMonth[m].toFixed(6)}</td>` : ''}</tr>`).join('')}
    </tbody></table></div></details>`;
  const monthlyAvg = (() => { const idx = stack.idx; const s = new Array(12).fill(0), n = new Array(12).fill(0); for (let t = 0; t < idx.T; t++) { s[idx.month[t] - 1] += sup.energyRate[t]; n[idx.month[t] - 1]++; } return s.map((v, i) => v / n[i]); })();
  const fields = {
    coned_msc: `<div class="grid2">
        ${field('MSC capacity charge', numInput('supply.capacityRate', S.capacityRate, { step: 0.01, unit: '$/kW-mo', nullable: true, placeholder: 'by month' }), `SC ${stack.account.sc} Rate ${roman[stack.account.rateNo]}, ${area}: ${span(sup.capacityByMonth, 2)} $/kW-month${sup.capacityWindows ? ', on weekday demand 8 AM to 6 PM in June to September and 8 AM to 10 PM otherwise' : ', on the monthly maximum demand'}. ${byMonthNote}`)}
        ${field('Merchant function charge', numInput('supply.mfc', S.mfc, { step: 0.000001, unit: '$/kWh', nullable: true, placeholder: 'by month' }), `${stack.account.sc === 2 ? 'SC 2' : 'SCs 5, 6, 8, 9, 12, 13'} total, ${span(sup.mfcByMonth, 6)} $/kWh. ${byMonthNote}`)}
        ${field('MSC adjustment factors', numInput('supply.reconciliation', S.reconciliation, { step: 0.000001, unit: '$/kWh', nullable: true, placeholder: 'by month' }), `Each month's MSC reconciliation for ${stack.account.rateNo === 2 ? 'customers who would be on Rider M but for its exemptions (Rate II)' : 'all other customers'}, ${area}: ${span(sup.reconciliationByMonth, 6)} $/kWh, plus the tax reimbursement non-residential customers pay. ${byMonthNote}`)}
      </div>
      ${monthTable()}
      <p class="note">Rider M makes hourly pricing mandatory above a size it sets; this tool does not check that. If the account is on Rider M, choose hourly pricing.</p>`,
    coned_mhp: `<div class="grid2">
        ${field('Rider M capacity (ICAP tag)', numInput('supply.capacityRate', S.capacityRate, { step: 0.01, unit: '$/kW-mo', nullable: true, placeholder: 'by month' }), `${area}: ${span(sup.capacityByMonth, 2)} $/kW-month, ${vs ? 'billed every month on the most the account imports in the likely NYISO peak hours (the Alternative 3 commitment hours on the Value Stack step), which is how the tag is set' : "applied to each month's maximum demand (a simplification of the tag)"}. ${byMonthNote}`)}
        ${field('Merchant function charge', numInput('supply.mfc', S.mfc, { step: 0.000001, unit: '$/kWh', nullable: true, placeholder: 'by month' }), `${stack.account.sc === 2 ? 'SC 2' : 'SCs 5, 6, 8, 9, 12, 13'} total, ${span(sup.mfcByMonth, 6)} $/kWh. ${byMonthNote}`)}
        ${field('MSC adjustment factors', numInput('supply.reconciliation', S.reconciliation, { step: 0.000001, unit: '$/kWh', nullable: true, placeholder: '0' }), 'Not billed under Rider M: the Statement of Adjustment Factors applies to customers on the MSC. Enter a value only to add one.')}
      </div>
      ${monthTable()}`,
    esco_fixed: `<div class="grid2">
        ${field('Fixed supply price', numInput('supply.fixedRate', S.fixedRate, { step: 0.0001, unit: '$/kWh' }), 'All-in energy price from the ESCO contract.')}
        ${field('Separate capacity charge', numInput('supply.escoCapacity', S.escoCapacity, { step: 0.01, unit: '$/kW-mo' }), 'Leave 0 if capacity is bundled in the $/kWh.')}
      </div>`,
    esco_lbmp: `<div class="grid2">
        ${field('Adder over day-ahead LBMP', numInput('supply.adder', S.adder, { step: 0.0001, unit: '$/kWh' }), 'ESCO margin, ancillaries and losses.')}
        ${field('Separate capacity charge', numInput('supply.escoCapacity', S.escoCapacity, { step: 0.01, unit: '$/kW-mo' }))}
      </div>`,
  };
  const panelHtml = `
    <h2>Energy supply</h2>
    <p class="lede">${state.modality === 'ftm' ? 'The battery\'s charging energy' : `SC ${stack.account.sc} delivery`} is billed separately from the commodity. Pick who supplies the energy; the battery's value depends on the $/kWh shape and on any capacity charge.</p>
    ${stack.riderM ? `<p class="flag">Con Edison supply for this account is Rider M hourly pricing: it is mandatory for ${stack.account.standby ? 'standby customers' : state.modality === 'ftm' ? 'stand-alone Value Stack storage' : 'Value Stack storage above 115% of the building\'s load'}. An ESCO contract remains an alternative.</p>` : ''}
    <fieldset><legend>Supplier</legend>
      <div class="choices">
        ${Object.entries(SUPPLY_MODES).map(([m, l]) => `<label class="choice"><input type="radio" name="supplyMode" data-path="supply.mode" value="${m}" ${sup.mode === m ? 'checked' : ''} ${m === 'coned_msc' && stack.riderM ? 'disabled' : ''}><b>${l}</b><small>${{
    coned_msc: edition.MSC_BLURB,
    coned_mhp: 'Mandatory hourly pricing: NYISO zone day-ahead LBMP by hour plus the Rider M capacity tag.',
    esco_fixed: 'A flat contract price; the battery then earns only on delivery demand charges (and any separate capacity charge).',
    esco_lbmp: 'Index contract: hourly LBMP plus a fixed adder.',
  }[m]}</small></label>`).join('')}
      </div>
    </fieldset>
    ${fields[sup.mode]}
    <div class="card soft" style="margin-top:1rem">
      <b>Supply as modelled</b>
      <p class="note">${esc(sup.description)}</p>
      <div class="kpis">
        <div class="kpi"><div class="k">Average energy</div><div class="v">${(sup.avgEnergyRate * 100).toFixed(2)}&cent;</div><div class="s">per kWh, load-unweighted</div></div>
        <div class="kpi"><div class="k">Capacity</div><div class="v">${fmt$(sup.capacityRate, 2)}</div><div class="s">per kW-month, average of the months, ${capBasis}</div></div>
        ${sup.lbmpAvg ? `<div class="kpi"><div class="k">Zone ${sup.zone} LBMP</div><div class="v">${(sup.lbmpAvg * 100).toFixed(2)}&cent;</div><div class="s">average, ${esc(data.lbmp[sup.zone].source_span.map((s) => s.slice(0, 7)).join(' to '))}</div></div>` : ''}
      </div>
      ${sup.warnings.map((w) => `<p class="flag">${esc(w)}</p>`).join('')}
      <div id="supplyChart"></div>
    </div>
    ${navButtons()}`;
  $('#panel')._after = () => barChart($('#supplyChart'), { labels: MONTH_NAMES, series: [{ name: 'Supply energy, monthly average', values: monthlyAvg.map((v) => v * 100), color: 'var(--s1)' }], yFormat: (v) => v.toFixed(1) + '¢', height: 170, yLabel: 'supply ¢/kWh by month' });
  return panelHtml;
}

// ---------------------------------------------------------------- step 4: riders (or the Value Stack)
async function stepRiders() {
  const stack = getStack();
  const P = state.programs, pg = data.programs;
  const nets = Object.entries(pg.networks).sort((a, b) => a[0].localeCompare(b[0]));
  const anyOn = PROGRAM_IDS.some((id) => P.enabled[id]);
  const preview = stack.programs;
  const net = preview.network;
  const termsHtml = preview.programs.map((p) => `
    <tr><td>${esc(p.label)}</td><td class="num">${p.events.length}</td><td class="num">${p.terms.reservationRate ? p.terms.reservationRate.toFixed(2) : '0.00'}</td><td class="num">${p.terms.performanceRate.toFixed(2)}</td><td>${p.terms.group ? esc(p.terms.group.replace(/_/g, ' ')) + ', ' + p.terms.threshold + ' events' : 'program agreement'}</td><td>${p.events.map((e) => e.day).join(', ') || '-'}${p.events.length ? ` (${p.events[0].hours[0]}:00 to ${p.events[0].hours[1]}:00)` : ''}</td></tr>`).join('');
  return `
    <h2>Riders and demand-response programs</h2>
    <p class="lede">A non-exporting battery can pledge load relief into Con Edison's Rider T programs (rates in the tariff) and Rider AC Term-DLM (pay-as-bid). Supply riders live on the previous step (Rider M); Rider R and standby rates do not apply to a non-exporting system and are not modelled.</p>
    <fieldset><legend>Enrol</legend>
      ${PROGRAM_IDS.map((id) => { const pr = pg.programs[id]; return `<label class="check"><input type="checkbox" data-path="programs.enabled.${id}" ${P.enabled[id] ? 'checked' : ''}><span><b>${PROGRAM_LABELS[id]}</b><span class="d">${pr.season.start} to ${pr.season.end}, ${pr.days === 'weekdays' ? 'non-holiday weekdays' : 'any day'}, ${pr.events[Object.keys(pr.events).find((k) => pr.events[k].counts_toward_rate_step) || Object.keys(pr.events)[0]].obligation_hours || 4}-hour events from the network's Contracted Hours; minimum ${pr.min_kw} kW per direct participant.${id === 'csrp' ? ' Reservation $/kW-month by county group, stepping up from the fifth counted event; $1/kWh performance.' : id === 'dlrp' ? ' Reservation by DLRP tier, stepping up at five contingency events; $1/kWh performance.' : id === 'auto_dlm' ? ' Called at 10 minutes\' notice, 8 AM to midnight. Rates come from the Program Agreement: enter them below.' : ' Rates come from the Program Agreement: enter them below.'}</span></span></label>`; }).join('')}
    </fieldset>
    <fieldset><legend>Battery use</legend>
      <div class="choices">
        ${[['both', 'Bill and demand response together', 'One dispatch cuts the bill and carries the pledge through every event, so neither is counted twice.'], ['dr_only', 'Demand response only', 'The battery discharges only in program events; it charges when that costs least, and the bill shows what charging costs. No discharging to cut the bill.']].map(([v, l, d]) => `<label class="choice"><input type="radio" name="drDispatch" data-path="programs.dispatch" value="${v}" ${(P.dispatch || 'both') === v ? 'checked' : ''}><b>${l}</b><small>${d}</small></label>`).join('')}
      </div>
      ${P.dispatch === 'dr_only' && !anyOn ? '<p class="flag">Demand response only needs a program enrolled below: without one the battery never discharges.</p>' : ''}
    </fieldset>
    <p class="note">CSRP and DLRP can be combined, and so can Term-DLM and DLRP; CSRP and Term-DLM cannot, and Auto-DLM stands alone (Rider AC I.2 and the 2027/28 DLM procurement). Both reservations are paid on the same pledge, but an hour in both programs' events pays performance once: CSRP over DLRP, DLRP over Term-DLM.</p>
    ${anyOn ? `
    <div class="grid2">
      ${field('Distribution network', select('programs.network', P.network, [['', 'Select the site network'], ...nets.map(([n, r]) => [n, `${n} (${r.county_group === 'westchester_staten_island' ? 'Westchester / SI' : 'NYC'}, ${r.dlrp_tier.replace('_', ' ')}, ${r.contracted_hours[0]}:00 to ${r.contracted_hours[1]}:00)`])]), 'Contracted Hours, DLRP tier and CSRP county group key on it (2026 call-window edition).')}
      ${field('Pledged load relief', numInput('programs.pledgeKw', P.pledgeKw, { step: 1, min: 0, unit: 'kW' }), 'Entered, never optimised. Paid in proportion to what the dispatch delivers.')}
      ${field('Participation', select('programs.participation', P.participation, [['direct', 'Direct participant'], ['aggregated', 'Through an aggregator']]), 'Aggregated lets a pledge below 50 kW count toward the aggregation minimum.')}
      ${P.enabled.csrp ? field('CSRP planned events per season', numInput('programs.events.csrp', P.events.csrp, { step: 1, min: 0, max: 30 }), 'Scenario input (not in the tariff). Five or more moves the reservation to the higher step.') : ''}
      ${P.enabled.dlrp ? field('DLRP contingency events per season', numInput('programs.events.dlrp', P.events.dlrp, { step: 1, min: 0, max: 30 })) : ''}
      ${P.enabled.term_dlm ? field('Term-DLM events per season', numInput('programs.events.term_dlm', P.events.term_dlm, { step: 1, min: 0, max: 30 })) : ''}
      ${P.enabled.term_dlm ? field('Term-DLM reservation rate', numInput('programs.termDlm.reservationRate', P.termDlm.reservationRate, { step: 0.01, unit: '$/kW-mo' }), 'From the Program Agreement.') : ''}
      ${P.enabled.term_dlm ? field('Term-DLM performance rate', numInput('programs.termDlm.performanceRate', P.termDlm.performanceRate, { step: 0.01, unit: '$/kWh' })) : ''}
      ${P.enabled.auto_dlm ? field('Auto-DLM events per season', numInput('programs.events.auto_dlm', P.events.auto_dlm, { step: 1, min: 0, max: 30 }), 'Called at 10 minutes\' notice, 8 AM to midnight, any day; modelled from the network\'s Contracted Hours.') : ''}
      ${P.enabled.auto_dlm ? field('Auto-DLM reservation rate', numInput('programs.autoDlm.reservationRate', P.autoDlm.reservationRate, { step: 0.01, unit: '$/kW-mo' }), 'From the Program Agreement.') : ''}
      ${P.enabled.auto_dlm ? field('Auto-DLM performance rate', numInput('programs.autoDlm.performanceRate', P.autoDlm.performanceRate, { step: 0.01, unit: '$/kWh' })) : ''}
    </div>
    ${preview.blocked.map((b) => `<p class="flag">${esc(b)}</p>`).join('')}
    ${preview.programs.length ? `
      <h3>Terms for ${esc(net.name)}</h3>
      <div class="tablewrap"><table><thead><tr><th>Program</th><th class="num">Events</th><th class="num">Reservation $/kW-mo</th><th class="num">Performance $/kWh</th><th>Rate key</th><th>Event days (model year)</th></tr></thead><tbody>${termsHtml}</tbody></table></div>
      <p class="note">Reservation is paid over the five Capability Period months on the delivered share of the pledge (the worst event sets it). ${preview.notes.map(esc).join(' ')}</p>` : ''}
    ` : '<p class="note">No program enrolled: the battery earns on the bill alone.</p>'}
    ${navButtons()}`;
}

// The Value Stack modalities: the election (keep DRV / LSRV or take a
// demand-response rider instead), the network, LSRV and the Alternative 3
// commitment.
async function stepValueStack() {
  const stack = getStack();
  const V = state.valueStack, P = state.programs, vsd = data.valueStack, vs = stack.valueStack;
  const nets = Object.entries(data.programs.networks).sort((a, b) => a[0].localeCompare(b[0]));
  const win = P.network ? vsd.drv.window_by_network[P.network] : null;
  const reg = state.region === 'westchester' ? 'westchester' : 'nyc';
  const lf = vsd.loss_factor;
  const lsrvAreas = Object.entries(vsd.lsrv.mw_remaining).filter(([, mw]) => mw > 0);
  const months = MONTH_NAMES.map((n, m) => { const r = vsd.alt3.by_month[String(m + 1)]; return `<td class="num">${r[reg].toFixed(2)}</td>`; }).join('');
  const dr = V.election !== 'value_stack';
  const progTerms = stack.programs.programs.map((p) => `<tr><td>${esc(p.label)}</td><td class="num">${p.events.length}</td><td class="num">${p.terms.reservationRate ? p.terms.reservationRate.toFixed(2) : '0.00'}</td><td>${p.events.map((e) => e.day).join(', ') || '-'}${p.events.length ? ` (${p.events[0].hours[0]}:00 to ${p.events[0].hours[1]}:00)` : ''}</td></tr>`).join('');
  const electionFields = {
    value_stack: `
      <label class="check"><input type="checkbox" data-path="valueStack.lsrv" ${V.lsrv ? 'checked' : ''}><span>The site is in an LSRV area with MW left <span class="d">${lsrvAreas.map(([a, mw]) => `${esc(a)} (${mw.toFixed(2)} MW)`).join(', ') || 'none listed'} on the latest statement. ${fmt$(vsd.lsrv.rate, 2)}/kW-year over at least ${vsd.lsrv.min_events} events of up to ${vsd.lsrv.max_event_hours} hours, on the lowest net injection in each; fixed for ${vsd.lsrv.fixed_years} years.</span></span></label>
      ${V.lsrv ? `<div class="grid2">${field('LSRV events per year', numInput('valueStack.lsrvEvents', V.lsrvEvents, { step: 1, min: vsd.lsrv.min_events, max: 30 }), 'At least 10; the rate is divided over the events called.')}</div>` : ''}`,
    rider_t: `
      <div class="choices">
        ${['csrp', 'dlrp'].map((id) => `<label class="check"><input type="checkbox" data-path="valueStack.riderT.${id}" ${V.riderT[id] ? 'checked' : ''}><span><b>${PROGRAM_LABELS[id]}</b><span class="d">Reservation only for a Value Stack customer.</span></span></label>`).join('')}
      </div>`,
    rider_ac: `
      <div class="choices">
        ${['auto_dlm', 'term_dlm'].map((id) => `<label class="choice"><input type="radio" name="acProgram" data-path="valueStack.acProgram" value="${id}" ${V.acProgram === id ? 'checked' : ''}><b>${PROGRAM_LABELS[id]}</b><small>${id === 'auto_dlm' ? 'Called at 10 minutes\' notice, 8 AM to midnight, any day, May to September. Stands alone.' : 'Day-ahead (21 hours) peak calls on weekdays. Can add DLRP.'} Pay-as-bid reservation from the Program Agreement (3 to 5 years).</small></label>`).join('')}
      </div>
      ${V.acProgram === 'term_dlm' ? `<label class="check"><input type="checkbox" data-path="valueStack.acDlrp" ${V.acDlrp ? 'checked' : ''}><span>Also enrol in DLRP <span class="d">DLRP is Rider T: it ends the DRV and LSRV for good, not just for the contract.</span></span></label>` : ''}
      <div class="grid2">
        ${field(`${V.acProgram === 'auto_dlm' ? 'Auto' : 'Term'}-DLM reservation rate`, numInput(`programs.${V.acProgram === 'auto_dlm' ? 'autoDlm' : 'termDlm'}.reservationRate`, P[V.acProgram === 'auto_dlm' ? 'autoDlm' : 'termDlm'].reservationRate, { step: 0.01, unit: '$/kW-mo' }), 'From the Program Agreement; awarded prices are not public.')}
      </div>`,
  };
  return `
    <h2>Value Stack</h2>
    <p class="lede">Rider R Value Stack credits on each hour's net injection: energy at the day-ahead zone ${stack.supply.zone} LBMP x ${lf} for losses, capacity under Alternative 3 (the only option for storage), and the Demand Reduction Value in the network's CSRP call window. Storage gets no environmental component. Enrolling in demand response trades the DRV and LSRV away.</p>
    <div class="grid2">
      ${field('Distribution network', select('programs.network', P.network, [['', 'Select the site network'], ...nets.map(([n]) => [n, `${n} (DRV ${vsd.drv.window_by_network[n] ? vsd.drv.window_by_network[n].map((h) => h + ':00').join(' to ') : 'n/a'})`])]), 'Sets the DRV call window and the demand-response terms.')}
      ${win ? field('DRV', `<div class="figure">${fmt$(vsd.drv.rate, 4)}/kWh</div>`, `On net injection ${win[0]}:00 to ${win[1]}:00, non-holiday weekdays ${vsd.drv.date_range.join(' to ')}; fixed for ${vsd.drv.fixed_years} years. Exporting at full power through all ${fmtN(drvIntervals(vsd, win).length / 4)} window hours is worth ${fmt$(vsd.drv.rate * drvIntervals(vsd, win).length / 4, 2)} per kW a year.`) : ''}
    </div>
    <fieldset><legend>Election</legend>
      <div class="choices">
        ${Object.entries(ELECTIONS).map(([k, l]) => `<label class="choice"><input type="radio" name="election" data-path="valueStack.election" value="${k}" ${V.election === k ? 'checked' : ''}><b>${esc(l)}</b><small>${k === 'value_stack' ? 'DRV (and LSRV where MW remain) stay on top of the energy and capacity credits.' : k === 'rider_t' ? 'CSRP and DLRP reservations instead. A one-time, irreversible opt-out of DRV and LSRV for the rest of the 25-year term. No performance payments to Rider R customers.' : 'A multi-year DLM contract instead. DRV and LSRV pause for the contract and resume after it. No performance payments to Rider R customers.'}</small></label>`).join('')}
      </div>
      ${electionFields[V.election]}
    </fieldset>
    ${dr ? `<div class="grid2">
      ${field('Pledged load relief', numInput('programs.pledgeKw', P.pledgeKw, { step: 1, min: 0, unit: 'kW' }), 'Exports during events count as load relief; paid on the share delivered.')}
      ${field('Participation', select('programs.participation', P.participation, [['direct', 'Direct participant'], ['aggregated', 'Through an aggregator']]))}
      ${stack.programs.programs.map((p) => field(`${p.label.split('(').pop().replace(')', '')} events per season`, numInput(`programs.events.${p.id}`, P.events[p.id], { step: 1, min: 0, max: 30 }))).join('')}
    </div>
    ${progTerms ? `<div class="tablewrap"><table><thead><tr><th>Program</th><th class="num">Events</th><th class="num">Reservation $/kW-mo</th><th>Event days (model year)</th></tr></thead><tbody>${progTerms}</tbody></table></div>` : ''}
    <p class="note">The results compare this election with keeping the DRV${V.lsrv ? ' and LSRV' : ''}.</p>` : ''}
    <h3>Capacity: Alternative 3</h3>
    <p class="note">Paid every month at the statement's $/kW x ${lf} on the net injection during the previous year's New York Control Area peak hour (a non-holiday weekday in July or August). The hour is not known in advance, so the battery commits a kW it holds through a band of likely peak hours on the top-priced July and August weekdays, and is paid on that kW.</p>
    <div class="grid3">
      ${field('Band starts', numInput('valueStack.alt3.hours.0', V.alt3.hours[0], { step: 1, min: 10, max: 20, unit: ':00' }))}
      ${field('Band ends', numInput('valueStack.alt3.hours.1', V.alt3.hours[1], { step: 1, min: 11, max: 22, unit: ':00' }))}
      ${field('Days', numInput('valueStack.alt3.days', V.alt3.days, { step: 1, min: 0, max: 44 }), 'Top-priced July and August weekdays.')}
      ${field('Rate override', numInput('valueStack.alt3.rate', V.alt3.rate, { step: 0.01, unit: '$/kW-mo', nullable: true, placeholder: 'by month' }), 'Blank = each month\'s statement value.')}
    </div>
    <div class="tablewrap"><table><thead><tr><th>${reg === 'nyc' ? 'NYC' : 'Westchester'} $/kW-mo</th>${MONTH_NAMES.map((n) => `<th class="num">${n}</th>`).join('')}</tr></thead><tbody><tr><td>Alternative 3</td>${months}</tr></tbody></table></div>
    <p class="note">${vsd.statements.length} monthly Value Stack statements, ${esc(vsd.statements[0].effective)} to ${esc(vsd.statements[vsd.statements.length - 1].effective)}. With these, a kW committed all year earns ${fmt$(vs.alt3.annualRate, 2)}. Commitment days: ${vs.alt3.days.map((d) => d.day).join(', ') || 'none'}.</p>
    ${[...vs.blocked, ...stack.programs.blocked].map((b) => `<p class="flag">${esc(b)}</p>`).join('')}
    ${[...vs.notes, ...stack.programs.notes.slice(0, dr ? 2 : 0)].map((n) => `<p class="note">${esc(n)}</p>`).join('')}
    ${navButtons()}`;
}

// ---------------------------------------------------------------- step 5: load
async function stepLoad() {
  const L = state.load;
  const tab = L.loadTab || L.mode;
  const ref = tab === 'bill' ? await presetBills(L.billShape) : null;
  if (ref && (L.billTarget == null || !L.monthlyBills)) {
    if (L.billTarget == null) L.billTarget = roundBill(ref.annual);
    if (!L.monthlyBills) L.monthlyBills = ref.monthly.map(roundMonth);
  }
  const presetCards = data.presets.map((p) => `<label class="choice"><input type="radio" name="presetId" data-path="load.presetId" value="${p.id}" ${L.presetId === p.id ? 'checked' : ''}><b>${esc(p.name)}</b><small>${esc(p.description)}</small></label>`).join('');
  return `
    <h2>Load profile</h2>
    <p class="lede">A full year at 15 minutes (35,040 intervals) on the model-year calendar. Use a preset, estimate one from the annual bill under the rate and supply you picked, or upload interval data.</p>
    <div class="tabs">
      ${[['preset', 'Preset profiles'], ['bill', 'From the annual bill'], ['upload', 'Upload interval data']].map(([k, l]) => `<button type="button" data-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}
    </div>
    <div class="tabpane">
      ${tab === 'preset' ? `<div class="choices">${presetCards}</div><p class="note">${edition.PRESET_NOTE}</p>` : ''}
      ${tab === 'bill' ? billPane(L, ref) : ''}
      ${tab === 'upload' ? `<div class="grid2">
          <div class="field"><label class="lab" for="f-upload">Interval file (CSV)</label><input type="file" id="f-upload" accept=".csv,.txt,text/csv"><span class="help">A timestamp column (ISO or M/D/YYYY H:MM) or separate date and time columns, plus a kW or kWh column. Any year; 5 to 60-minute intervals; Feb 29 dropped; gaps interpolated.</span></div>
          ${field('Units', select('load.uploadUnits', L.uploadUnits, [['auto', 'Detect from the header'], ['kw', 'kW (average demand)'], ['kwh', 'kWh per interval']]))}
        </div>
        ${uploaded ? `<p class="ok">Parsed ${esc(uploaded.name)}: ${fmtN(uploaded.meta.rows)} rows, ${uploaded.meta.sourceIntervalMin}-minute ${uploaded.meta.units} from ${esc(uploaded.meta.timestampColumn)} / ${esc(uploaded.meta.valueColumn)}, years ${uploaded.meta.years.join(', ')}, ${(uploaded.meta.coverage * 100).toFixed(1)}% of the year covered${uploaded.meta.badRows ? `, ${uploaded.meta.badRows} rows skipped` : ''}.</p>` : '<p class="note">No file loaded yet (uploads are kept in memory only).</p>'}
        <p id="uploadError" class="bad"></p>` : ''}
    </div>
    <div id="loadSummary"><p class="note">Loading profile...</p></div>
    ${navButtons()}`;
}

function billPane(L, ref) {
  const mode = L.billMode === 'monthly' ? 'monthly' : 'annual';
  const toggle = `<div class="seg" role="group" aria-label="Bill input">${[['annual', 'Annual total'], ['monthly', 'Monthly bills']].map(([k, l]) => `<button type="button" data-billmode="${k}" class="${mode === k ? 'active' : ''}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>`;
  const shape = field('Building\'s load shape', select('load.billShape', L.billShape, data.presets.map((p) => [p.id, p.name])), 'The preset whose shape is scaled until the modelled bill matches.');
  if (mode === 'annual') {
    return `${toggle}<div class="grid2">
        ${field('Annual electricity bill', numInput('load.billTarget', L.billTarget, { step: 1000, min: 0, unit: '$ / year' }) + billSlider('load.billTarget', L.billTarget, ref.annual, 1000, 'Annual electricity bill'), 'Total of twelve bills, delivery plus supply, taxes included. Starts at the modelled bill for the selected load shape: replace it with the actual figure.')}
        ${shape}
      </div>
      <p class="note">The scale is solved by bisection on the modelled bill under the current rate, adjustments, supply and tax settings, so changing those re-estimates the profile. Sliders run from half to twice the shape's modelled bill.</p>`;
  }
  const total = L.monthlyBills.reduce((a, v) => a + (+v || 0), 0);
  const rows = MONTH_NAMES.map((name, m) => `<div class="billrow"><span>${name}</span>${numInput(`load.monthlyBills.${m}`, L.monthlyBills[m], { step: 100, min: 0, unit: '$' })}${billSlider(`load.monthlyBills.${m}`, L.monthlyBills[m], ref.monthly[m], 100, `${name} bill`)}</div>`).join('');
  return `${toggle}<div class="grid2">
      ${shape}
      ${field('Annual total', `<div class="figure">${fmt$(total)}</div>`, 'Sum of the twelve monthly bills.')}
    </div>
    <div class="billgrid">${rows}</div>
    <p class="note">Each bill is delivery plus supply, taxes included. Each calendar month of the shape is scaled on its own until its modelled bill matches, so changing the rate, supply or tax settings re-estimates the profile. Months start at the shape's modelled bills; sliders run from half to twice those. Calendar months stand in for Con Edison's meter-read billing periods.</p>`;
}

async function afterLoadStep() {
  const panel = $('#panel');
  panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    const tab = b.dataset.tab;
    if (tab === 'bill' && (state.load.loadTab || state.load.mode) !== 'bill') {
      // Start the estimate from what was just on screen: the selected preset's
      // shape and the baseline bill shown for the current profile.
      try {
        const shown = await getLoad();
        if (state.load.mode === 'preset') state.load.billShape = state.load.presetId;
        setBillTargets(shown ? billsFor(shown.kw) : await presetBills(state.load.billShape));
      } catch (e) { edition.logError(e); }
    }
    state.load.loadTab = tab;
    if (tab !== 'upload' || uploaded) state.load.mode = tab;
    results = null; render();
  }));
  panel.querySelectorAll('[data-billmode]').forEach((b) => b.addEventListener('click', async () => {
    const L = state.load, mode = b.dataset.billmode;
    if (mode === (L.billMode === 'monthly' ? 'monthly' : 'annual')) return;
    try {
      if (mode === 'monthly') {
        // Keep the monthly pattern (or the shape's) and match the annual total.
        const base = L.monthlyBills || (await presetBills(L.billShape)).monthly.map(roundMonth);
        const sum = base.reduce((a, v) => a + (+v || 0), 0), target = +L.billTarget || 0;
        L.monthlyBills = base.map((v) => roundMonth(sum > 0 ? (+v || 0) * target / sum : target / 12));
      } else {
        L.billTarget = roundBill((L.monthlyBills || []).reduce((a, v) => a + (+v || 0), 0));
      }
    } catch (e) { edition.logError(e); }
    L.billMode = mode;
    results = null; render();
  }));
  const fileInput = $('#f-upload');
  if (fileInput) fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    try {
      const text = await f.text();
      const parsed = parseIntervalCsv(text, { units: state.load.uploadUnits === 'auto' ? undefined : state.load.uploadUnits });
      uploaded = { ...parsed, name: f.name };
      state.load.mode = 'upload'; state.load.loadTab = 'upload';
      results = null; render();
    } catch (e) { $('#uploadError').textContent = e.message; }
  });
  const box = $('#loadSummary');
  try {
    const load = await getLoad();
    if (!load) { box.innerHTML = '<p class="note">Choose or upload a profile to continue.</p>'; return; }
    const stack = getStack();
    const s = stats(load.kw);
    const bill = billFor(stack, load.kw);
    const idx = stack.idx;
    const mKwh = monthlyEnergyKwh(load.kw, idx, DT_HOURS), mPk = monthlyPeakKw(load.kw, idx, stack.demandIntervalMin);
    box.innerHTML = `
      <h3>${esc(load.label)}</h3>
      <div class="kpis">
        <div class="kpi"><div class="k">Annual energy</div><div class="v">${fmtN(s.annualKwh / 1000, 0)}</div><div class="s">MWh</div></div>
        <div class="kpi"><div class="k">Peak demand</div><div class="v">${fmtN(s.peakKw, 0)}</div><div class="s">kW, ${stack.demandIntervalMin}-min</div></div>
        <div class="kpi"><div class="k">Load factor</div><div class="v">${(s.loadFactor * 100).toFixed(0)}%</div><div class="s">annual</div></div>
        <div class="kpi"><div class="k">Baseline bill</div><div class="v">${fmt$(bill.total)}</div><div class="s">per year, ${(bill.total / s.annualKwh * 100).toFixed(1)}¢/kWh all-in</div></div>
      </div>
      <div class="grid2">
        <div><div id="chartMonthlyKwh"></div></div>
        <div><div id="chartMonthlyPeak"></div></div>
      </div>
      ${load.meta && load.meta.belowFixed && load.meta.belowFixed.some(Boolean) ? `<p class="flag">${load.meta.belowFixed.map((b, m) => (b ? MONTH_NAMES[m] : null)).filter(Boolean).join(', ')}: the bill is below that month's fixed charges, so the month is modelled with no load.</p>` : ''}
      ${state.modality === 'ftm' ? '' : rateFitFlags(s.peakKw).map((f) => `<p class="flag">${f}</p>`).join('')}
      <div class="inline" style="margin-top:0.6rem"><button type="button" class="btn small" id="dlProfile">Download profile as CSV</button><span class="note">timestamp,kw on the 2027 model calendar</span></div>`;
    barChart($('#chartMonthlyKwh'), { labels: MONTH_NAMES, series: [{ name: 'Energy, MWh', values: mKwh.map((v) => v / 1000), color: 'var(--s1)' }], yFormat: (v) => v.toFixed(0), height: 180, yLabel: 'monthly energy MWh' });
    barChart($('#chartMonthlyPeak'), { labels: MONTH_NAMES, series: [{ name: 'Peak, kW', values: mPk, color: 'var(--s2)' }], yFormat: (v) => v.toFixed(0), height: 180, yLabel: 'monthly peak kW' });
    $('#dlProfile').addEventListener('click', () => download(`load_profile_${load.source}.csv`, toCsv(load.kw, idx, labelOf), 'text/csv'));
  } catch (e) { box.innerHTML = edition.errorHtml(e); edition.logError(e); }
  renderRail();
}

// ---------------------------------------------------------------- step 6: battery
async function stepBattery() {
  const B = state.battery;
  const dur = B.kw > 0 ? (B.kwh / B.kw) : 0;
  const lede = {
    btm: 'A behind-the-meter, non-exporting system dispatched with perfect foresight against the whole year: demand windows, supply prices, the annual cycle budget and any enrolled program events are co-optimised in one linear program (HiGHS, in your browser).',
    btm_vs: 'A behind-the-meter system that may also export: the building\'s bill, the Value Stack credits on net exports, the Alternative 3 commitment and any program events are co-optimised over the whole year with perfect foresight (HiGHS, in your browser).',
    ftm: 'A stand-alone system charging from and exporting to the grid: the charging account\'s bill, the Value Stack credits, the Alternative 3 commitment and any program events are co-optimised over the whole year with perfect foresight (HiGHS, in your browser).',
  }[state.modality];
  let acct = null; try { acct = getStack().account; } catch (e) { /* shown on run */ }
  const sizeFlags = [];
  if (exportsOn(state.modality) && +B.kw > LIMITS.valueStackKw) sizeFlags.push(`The Value Stack caps a project at ${fmtN(LIMITS.valueStackKw)} kW.`);
  return `
    <h2>Battery system</h2>
    <p class="lede">${lede}</p>
    ${state.modality === 'btm' && state.programs.dispatch === 'dr_only' ? '<p class="note">Demand response only (set on the Riders step): the battery discharges only in program events, and the run also solves the bill and demand response together for comparison.</p>' : ''}
    <div class="grid3">
      ${field('Power', numInput('battery.kw', B.kw, { step: 1, min: 0, unit: 'kW' }), 'Inverter rating, charge and discharge.')}
      ${field('Energy', numInput('battery.kwh', B.kwh, { step: 1, min: 0, unit: 'kWh' }), `Nameplate. ${dur ? dur.toFixed(1) + ' h duration.' : ''}`)}
      ${field('Round-trip efficiency', numInput('battery.rte', B.rte, { step: 0.5, min: 50, max: 100, unit: '%' }), 'AC to AC; split evenly between charge and discharge.')}
      ${field('Usable depth of discharge', numInput('battery.usable', B.usable, { step: 1, min: 10, max: 100, unit: '%' }), 'Share of nameplate the controller may use.')}
      ${field('Annual cycle limit', numInput('battery.cycles', B.cycles, { step: 1, min: 0, unit: 'cycles / yr' }), 'Equivalent full cycles of discharged energy per year (warranty cap). 0 = unlimited.')}
      ${field('Throughput cost', numInput('battery.throughputCost', B.throughputCost, { step: 0.001, min: 0, unit: '$/kWh' }), 'Optional degradation charge per kWh discharged; stops cycling for pennies.')}
      ${field('Installed cost (optional)', numInput('battery.capexK', B.capexK, { step: 1, min: 0, unit: 'k$', nullable: true }), 'Thousands of dollars. Used for a simple payback figure and as the pro-forma\'s capital cost.')}
    </div>
    <label class="check"><input type="checkbox" data-path="battery.curve" ${B.curve !== false ? 'checked' : ''}><span>Capacity curve for degradation <span class="d">Also solves the year at ${CURVE_BELOW}% of the usable energy, two at a time, so the pro-forma can follow capacity fade and a replacement without another run.${state.modality === 'btm_vs' ? ' Behind the meter with exports this about doubles the run time.' : ''}</span></span></label>
    ${acct && state.modality !== 'btm' ? `<p class="${acct.standby ? 'flag' : 'ok'}">${state.modality === 'ftm' ? 'Charging account' : 'Building account with the battery'}: <b>${accountLabel(acct)}</b>. ${esc(acct.reason)}</p>` : ''}
    ${sizeFlags.map((f) => `<p class="flag">${f}</p>`).join('')}
    ${pledgeFlags()}
    <div id="runBox"></div>
    <div class="actions"><button type="button" class="btn" data-nav="-1">Back</button><button type="button" class="btn primary" id="runBtn" ${running ? 'disabled' : ''}>Run simulation</button></div>`;
}

// Warn when the battery cannot carry one full program event at the pledge.
function pledgeFlags() {
  let progs;
  try { progs = getStack().programs.programs.filter((p) => p.events.length); } catch (e) { return ''; }
  if (!progs.length) return '';
  const b = batterySpec(), pledge = progs[0].pledgeKw;
  const hours = Math.max(...progs.map((p) => p.events[0].hours[1] - p.events[0].hours[0]));
  const names = progs.map((p) => p.id.toUpperCase().replace('_', '-')).join(' / ');
  const { needKwh, usableKwh, etaD } = eventEnergyCheck(b, pledge, hours);
  const flags = [];
  if (usableKwh < needKwh) flags.push(`Too small for the ${fmtN(pledge)} kW pledge on the Riders step: one ${hours}-hour ${names} event needs about ${fmtN(needKwh)} kWh of usable storage (${(etaD * 100).toFixed(0)}% discharge efficiency), and this battery has ${fmtN(usableKwh)} kWh usable (${fmtN(b.kwh)} kWh x ${(b.usableFrac * 100).toFixed(0)}%). Add energy or lower the pledge.`);
  if (b.kw < pledge) flags.push(`The ${fmtN(b.kw)} kW power rating is below the ${fmtN(pledge)} kW pledge, so no event can be met in full.`);
  return flags.map((f) => `<p class="flag">${f}</p>`).join('');
}

// The curve's levels below full capacity, in words: "90, 80, 70 and 60".
const CURVE_BELOW = CURVE_LEVELS.slice(1).map(pctOf).join(', ').replace(/, (\d+)$/, ' and $1');

// The configuration fingerprint of a run: every input it was made from.
const runConfig = (battery) => fingerprint({ cfg: stackConfig(), battery, load: loadCache.key, curve: state.battery.curve !== false ? CURVE_LEVELS : null });

// The capacity curve solves two levels at a time (the main worker and one
// more) when the machine has the cores.
const curveLanes = () => Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));

// Each program's Capability Period months, for spreading reservations.
const programMonths = () => Object.fromEntries(Object.entries(data.programs.programs).map(([id, p]) => [id, (p.season && p.season.months) || [5, 6, 7, 8, 9]]));

function batterySpec() {
  const B = state.battery;
  return { kw: +B.kw || 0, kwh: +B.kwh || 0, rte: Math.min(1, Math.max(0.05, (+B.rte || 88) / 100)), usableFrac: Math.min(1, Math.max(0.05, (+B.usable || 95) / 100)), cyclesPerYear: +B.cycles || 0, throughputCost: +B.throughputCost || 0 };
}

// The bill of an account that does not exist yet (a stand-alone battery's
// baseline): every component zero.
function zeroBill(stack, kw) {
  const b = billFor(stack, kw);
  const zero = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, 0]));
  return { ...b, energy: 0, demand: 0, fixed: 0, subtotal: 0, tax: 0, total: 0, energyComponents: zero(b.energyComponents), demandByGroup: zero(b.demandByGroup), peaks: b.peaks.map((p) => ({ ...p, cost: 0 })) };
}

// Everything after the solves: the bills, program revenue, credits and the
// summary. A kept run (hosted builds) goes through here from its saved
// dispatch, so its results page is the one the run produced.
function assembleResults({ stack, base, load, battery, inp, sol, billOnlySol = null, alternative = null, coopt = null, curve = null, curveFailed = false, elapsedMs = 0, runAt, config }) {
  const baseline = state.modality === 'ftm' ? zeroBill(stack, load.kw) : billFor(base, load.kw);
  const solBillOnly = billOnlySol ? billFor(stack, billOnlySol.imp) : null;
  const withB = billFor(stack, sol.imp);
  const revenue = programRevenue(stack, inp, sol);
  const credits = stack.valueStack ? valueStackCredits(stack.valueStack, sol.imp, sol.exp) : null;
  const summary = summarize(stack, load.kw, battery, baseline, withB, solBillOnly, inp, sol, revenue, credits);
  return { stack, base, load, battery, inp, sol, baseline, withB, revenue, credits, alternative, coopt, curve, curveFailed, summary, solBillOnly, billOnlySol, elapsedMs, timing: sol.timing, runAt, config };
}

// Bring back a kept run when it was made from these very inputs, with this
// wizard version and these rates; otherwise say why it was not.
async function restoreRun(snap) {
  if (!snap) return { restored: false, reason: 'none' };
  const load = await getLoad();
  if (!load) return { restored: false, reason: 'load' };
  const stack = getStack(), base = getBaseStack(), battery = batterySpec();
  const config = runConfig(battery);
  if (snap.app !== APP_VERSION || snap.ratesDate !== data.statements.in_force_on) return { restored: false, reason: 'version' };
  if (snap.config !== config) return { restored: false, reason: 'inputs' };
  const withPrograms = stack.programs.programs.some((p) => p.events.length);
  const inp = lpInputs(stack, load.kw, battery, withPrograms);
  results = assembleResults({ stack, base, load, battery, inp, sol: solFromSnapshot(snap), billOnlySol: snap.billOnly ? { imp: Float64Array.from(snap.billOnly.imp) } : null,
    alternative: snap.alternative, coopt: snap.coopt || null, curve: snap.curve || null, elapsedMs: snap.elapsedMs, runAt: snap.runAt, config });
  results.restored = true;
  return { restored: true };
}

async function run() {
  if (running) return;
  const box = $('#runBox');
  const btn = $('#runBtn');
  try {
    running = true; if (btn) btn.disabled = true;
    const load = await getLoad();
    if (!load) throw userError('No load profile selected.');
    const stack = getStack(), base = getBaseStack();
    const battery = batterySpec();
    if (battery.kw <= 0 || battery.kwh <= 0) throw userError('Enter a battery power and energy above zero.');
    if (stack.valueStack) {
      if (battery.kw > LIMITS.valueStackKw) throw userError(`The Value Stack caps a project at ${fmtN(LIMITS.valueStackKw)} kW.`);
      if (stack.valueStack.blocked.length) throw userError(stack.valueStack.blocked[0]);
    }
    const withPrograms = stack.programs.programs.some((p) => p.events.length);
    if (stack.drOnly && !withPrograms) throw userError('Demand response only needs a program enrolled on the Riders step: without one the battery never discharges.');
    const show = (msg) => { box.innerHTML = `<div class="progress">${msg}<div class="bar"><i></i></div></div>`; };
    show(edition.SOLVING + (stack.valueStack && state.modality === 'btm_vs' ? ' Behind the meter with exports the year takes two solves: allow up to a minute, more with a tight cycle limit, and twice that for an election compared with the DRV.' : ''));
    const t0 = performance.now();
    const inp = lpInputs(stack, load.kw, battery, withPrograms);
    const sol = await solveDispatch(inp);
    const baseline = state.modality === 'ftm' ? zeroBill(stack, load.kw) : billFor(base, load.kw);
    const benefit = (st, s) => billFor(st, s.imp).total;
    let billOnlySol = null, alternative = null, coopt = null;
    if (withPrograms && !stack.valueStack && !stack.drOnly) {
      show('Solving the bill-only dispatch for comparison.');
      billOnlySol = await solveDispatch(lpInputs(stack, load.kw, battery, false));
    }
    if (stack.drOnly) {
      // The same battery optimising the bill as well, for comparison.
      show('Solving the dispatch for the bill and demand response together, for comparison.');
      const inpBoth = lpInputs(stack, load.kw, battery, true, { drOnly: false });
      const both = await solveDispatch(inpBoth);
      const billSavings = baseline.total - billFor(stack, both.imp).total, programs = programRevenue(stack, inpBoth, both).total;
      coopt = { billSavings, programs, net: billSavings + programs };
    }
    if (stack.valueStack && state.valueStack.election !== 'value_stack') {
      // The same battery keeping the DRV (and LSRV) instead of the rider.
      show('Solving the Value Stack election for comparison.');
      const cfg = stackConfig();
      const alt = buildStack({ ...cfg, programs: { ...cfg.programs, enabled: {} }, valueStack: { ...cfg.valueStack, election: 'value_stack' } }, data);
      const altSol = await solveDispatch(lpInputs(alt, load.kw, battery, false));
      const altCredits = valueStackCredits(alt.valueStack, altSol.imp, altSol.exp);
      alternative = { credits: altCredits, billTotal: benefit(alt, altSol), net: baseline.total - benefit(alt, altSol) + altCredits.total };
    }
    // The capacity curve: the same year with less usable energy. A failure
    // here leaves the Year 1 results standing.
    let curve = null, curveFailed = false;
    if (state.battery.curve !== false) {
      const levels = CURVE_LEVELS.slice(1);
      let solved = 0;
      const progress = () => show(`Capacity curve for degradation: the year at ${CURVE_BELOW}% of the usable energy (${solved} of ${levels.length} solved).`);
      progress();
      try {
        const inps = levels.map((f) => lpInputs(stack, load.kw, atLevel(battery, f), withPrograms));
        const sols = await solveAll(inps, { lanes: curveLanes(), onSolved: () => { solved++; progress(); } });
        const baseStack = state.modality === 'ftm' ? stack : base, months = programMonths();
        const point = (level, inpL, solL) => curvePoint({ level, stack, baseStack, load: load.kw, battery, inp: inpL, sol: solL, baseline, programMonths: months });
        curve = capacityCurve([point(1, inp, sol), ...levels.map((f, i) => point(f, inps[i], sols[i]))]);
      } catch (e) { curveFailed = true; edition.logError(e); }
    }
    results = assembleResults({ stack, base, load, battery, inp, sol, billOnlySol, alternative, coopt, curve, curveFailed, elapsedMs: performance.now() - t0,
      runAt: new Date().toISOString(), config: runConfig(battery) });
    running = false;
    goTo('results');
    // A hosted build keeps every run: save it as a new version.
    if (STORE.kind === 'server') saveToServer();
  } catch (e) {
    running = false; if (btn) btn.disabled = false;
    box.innerHTML = edition.runFailedHtml(e);
    edition.logError(e);
  }
}

// ---------------------------------------------------------------- step 7: results
async function stepResults() {
  if (!results) return `<h2>Results</h2><p class="note">Run a simulation first.</p>${navButtons()}`;
  if (results.stack.valueStack) return resultsValueStack(results);
  const R = results, S = R.summary, B = R.baseline, W = R.withB;
  const pct = B.total > 0 ? (S.savingsTotal / B.total * 100) : 0;
  const capex = (+state.battery.capexK || 0) * 1000;
  const rows = [];
  const comp = (name, b, w) => rows.push(`<tr><td>${name}</td><td class="num">${fmt$(b)}</td><td class="num">${fmt$(w)}</td><td class="num ${b - w >= 0 ? 'ok' : 'bad'}">${fmt$(b - w)}</td></tr>`);
  for (const name of Object.keys(B.energyComponents)) comp(name, B.energyComponents[name], W.energyComponents[name]);
  const groups = { delivery_demand: 'Delivery demand charges', delivery_adjustment_demand: 'SBC demand surcharge', supply_capacity: 'Supply capacity charge' };
  for (const [g, label] of Object.entries(groups)) if (B.demandByGroup[g] !== undefined || W.demandByGroup[g] !== undefined) comp(label, B.demandByGroup[g] || 0, W.demandByGroup[g] || 0);
  comp('Customer charge', B.fixed, W.fixed);
  comp(`Taxes and surcharges (${state.taxPct}%)`, B.tax, W.tax);
  rows.push(`<tr class="total"><td>Annual bill</td><td class="num">${fmt$(B.total)}</td><td class="num">${fmt$(W.total)}</td><td class="num ok">${fmt$(S.savingsBill)}</td></tr>`);
  for (const s of R.revenue.streams) {
    rows.push(`<tr><td>${esc(s.label)}: reservation (${s.terms.months} months x ${s.terms.reservationRate.toFixed(2)} $/kW x ${fmtN(s.deliveredKw, 1)} kW delivered of ${fmtN(s.pledgeKw)} pledged)</td><td class="num">-</td><td class="num">${fmt$(-s.reservation)}</td><td class="num ok">${fmt$(s.reservation)}</td></tr>`);
    rows.push(`<tr><td>${esc(s.label)}: performance (${fmtN(s.reliefKwh)} kWh relief over ${s.events} events, ${s.eventDays.join(', ')})</td><td class="num">-</td><td class="num">${fmt$(-s.performance)}</td><td class="num ok">${fmt$(s.performance)}</td></tr>`);
  }
  if (R.revenue.streams.length) rows.push(`<tr class="total"><td>Net annual cost</td><td class="num">${fmt$(B.total)}</td><td class="num">${fmt$(W.total - R.revenue.total)}</td><td class="num ok">${fmt$(S.savingsTotal)}</td></tr>`);
  const monthRows = S.monthly.map((m) => `<tr><td>${m.month}</td><td class="num">${fmtN(m.peakBefore)}</td><td class="num">${fmtN(m.peakAfter)}</td><td class="num">${fmtN(m.peakBefore - m.peakAfter)}</td><td class="num">${fmt$(m.demandBefore - m.demandAfter)}</td><td class="num">${fmtN(m.kwhAfter - m.kwhBefore)}</td></tr>`).join('');
  const weak = R.revenue.streams.filter((s) => (s.id === 'csrp' || s.id === 'dlrp') && s.factor < MIN_PERFORMANCE).map((s) => {
    const worst = s.eventKw.indexOf(Math.min(...s.eventKw));
    const avg = s.eventKw.reduce((a, b) => a + b, 0) / s.eventKw.length / s.pledgeKw;
    return `<p class="flag">${esc(s.label)}: the battery delivers ${(s.factor * 100).toFixed(0)}% of the ${fmtN(s.pledgeKw)} kW pledge on its weakest event (${s.eventDays[worst]}) and ${(avg * 100).toFixed(0)}% on average over ${s.events} events, below ${MIN_PERFORMANCE * 100}% performance for the year. Add battery energy or power, or lower the pledge.</p>`;
  });
  const weeks = weekOptions(R.load.kw);
  const sup = R.stack.supply;
  const assumptions = [
    `SC ${R.stack.account.sc} Rate ${roman[state.rateNo]}, ${state.voltage.toUpperCase()}, ${state.region === 'nyc' ? 'New York City' : 'Westchester'} (zone ${R.stack.supply.zone})${edition.rateProvenanceClause(R.stack.tariff)}; ${R.stack.demandIntervalMin}-minute billing demand.`,
    `Delivery $/kWh adjustments ${R.stack.kwhAdj.toFixed(6)} $/kWh; statements in force on ${esc(data.statements.in_force_on)}.`,
    esc(sup.description) + '.',
    ...sup.warnings.map(esc),
    R.stack.account.standby ? `Non-exporting battery: imports never go negative, no Rider R / Value Stack; the building is on standby (Rate ${roman[state.rateNo]}) with and without it.` : `Non-exporting battery: imports never go negative, no Rider R / Value Stack, no standby (Rate IV / V) rates.`,
    ...(R.stack.account.sc === 9 && R.stack.account.rateNo === 1 ? [MAX_RATE_NOTE] : []),
    `Perfect-foresight dispatch over the model year (2027 calendar, DST ignored); cyclic state of charge; LP relaxation with a post-solve netting of simultaneous charge and discharge.`,
    `Cycle budget: ${fmtN(S.throughputKwh)} kWh discharged = ${S.cycles.toFixed(0)} equivalent full cycles${S.cycleLimit ? ` of the ${S.cycleLimit} allowed` : ' (no cap)'}.` + cycleNote(R),
    ...(R.stack.drOnly ? ['Demand response only: discharging is limited to the enrolled programs\' event intervals; charging is optimised against the bill, which includes its cost and any demand it adds.'] : []),
    ...(R.stack.programs.notes || []).map(esc),
    `One year, no escalation. ${curveNote(R)}`,
  ];
  const html = `
    <h2>Results</h2>
    <p class="lede">${esc(R.load.label)}; ${fmtN(R.battery.kw)} kW / ${fmtN(R.battery.kwh)} kWh, ${(R.battery.rte * 100).toFixed(0)}% round trip.${R.restored ? ` Kept run from ${new Date(R.runAt).toLocaleString()}.` : edition.solvedIn(R.elapsedMs)}</p>
    <div class="hero">
      <div><div class="k">Annual savings</div><div class="v">${fmt$(S.savingsTotal)}</div><div class="s">${pct.toFixed(1)}% of the ${fmt$(B.total)} baseline</div></div>
      <div><div class="k">Bill savings</div><div class="v">${fmt$(S.savingsBill)}</div><div class="s">${R.revenue.total ? `plus ${fmt$(R.revenue.total)} program revenue` : 'no program revenue'}</div></div>
      <div><div class="k">Annual peak</div><div class="v">${fmtN(S.peakBefore)} &rarr; ${fmtN(S.peakAfter)}</div><div class="s">kW, ${R.stack.demandIntervalMin}-minute</div></div>
      ${capex ? `<div><div class="k">Simple payback</div><div class="v">${S.savingsTotal > 0 ? (capex / S.savingsTotal).toFixed(1) + ' yr' : '-'}</div><div class="s">on ${fmt$(capex / 1000)}k installed</div></div>` : ''}
    </div>
    ${weak.join('')}
    ${R.coopt ? `<p class="note">Demand response only: the battery discharges only in program events. Optimising the bill as well would earn ${fmt$(R.coopt.net)} a year (${fmt$(R.coopt.billSavings)} on the bill, ${fmt$(R.coopt.programs)} from programs): ${R.coopt.net >= S.savingsTotal ? `${fmt$(R.coopt.net - S.savingsTotal)} more` : `${fmt$(S.savingsTotal - R.coopt.net)} less`} than demand response alone.</p>` : ''}
    ${S.billOnlySavings !== null ? `<p class="note">Dispatching for the bill alone would save ${fmt$(S.billOnlySavings)}; holding capacity for program events ${S.billOnlySavings > S.savingsBill ? `costs ${fmt$(S.billOnlySavings - S.savingsBill)} of bill savings` : 'costs nothing on the bill'} and earns ${fmt$(R.revenue.total)}.</p>` : ''}
    <h3>Annual bill, baseline vs with battery</h3>
    <div class="tablewrap"><table><thead><tr><th>Component</th><th class="num">Baseline</th><th class="num">With battery</th><th class="num">Savings</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    ${curveHtml(R)}
    <h3>Monthly peaks</h3>
    <div id="chartPeaks"></div>
    <div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Peak before kW</th><th class="num">Peak after kW</th><th class="num">Reduction kW</th><th class="num">Demand $ saved</th><th class="num">Extra kWh (losses)</th></tr></thead><tbody>${monthRows}</tbody></table></div>
    <h3>Dispatch</h3>
    <div class="inline"><label class="lab" for="weekSel" style="margin:0">Week</label><select id="weekSel">${weeks.map((w) => `<option value="${w.start}" ${w.selected ? 'selected' : ''}>${w.label}</option>`).join('')}</select></div>
    <div id="chartWeek"></div>
    <div id="chartSoc"></div>
    ${backupHtml(R)}
    <h3>Assumptions and provenance</h3>
    <ul class="tight">${assumptions.map((a) => `<li>${a}</li>`).join('')}</ul>
    <div class="inline" style="margin-top:1rem"><button type="button" class="btn small" id="dlXlsx">Download pro-forma (XLSX)</button><button type="button" class="btn small" id="dlJson">Download results (JSON)</button><button type="button" class="btn small" id="dlDispatch">Download dispatch (CSV)</button></div>
    <div class="actions"><button type="button" class="btn" data-nav="-1">Back to battery</button><button type="button" class="btn" id="rerun">Change inputs and re-run</button></div>`;
  return html;
}

// Results for the two Value Stack modalities: the credits, the account's bill
// and the election comparison.
function resultsValueStack(R) {
  const S = R.summary, B = R.baseline, W = R.withB, C = R.credits, vs = R.stack.valueStack;
  const ftm = state.modality === 'ftm';
  const capex = (+state.battery.capexK || 0) * 1000;
  const lf = data.valueStack.loss_factor;
  const billRows = [];
  const comp = (name, b, w) => billRows.push(ftm ? `<tr><td>${name}</td><td class="num">${fmt$(w)}</td></tr>` : `<tr><td>${name}</td><td class="num">${fmt$(b)}</td><td class="num">${fmt$(w)}</td><td class="num ${b - w >= 0 ? 'ok' : 'bad'}">${fmt$(b - w)}</td></tr>`);
  // The baseline and the battery account can bill different supply components.
  for (const name of new Set([...Object.keys(B.energyComponents), ...Object.keys(W.energyComponents)])) comp(name, B.energyComponents[name] || 0, W.energyComponents[name] || 0);
  const groups = { delivery_demand: 'Delivery demand charges', delivery_adjustment_demand: 'SBC / SDR demand surcharges', supply_capacity: 'Supply capacity charge' };
  for (const [g, label] of Object.entries(groups)) if (B.demandByGroup[g] !== undefined || W.demandByGroup[g] !== undefined) comp(label, B.demandByGroup[g] || 0, W.demandByGroup[g] || 0);
  comp('Customer charge', B.fixed, W.fixed);
  comp(`Taxes and surcharges (${state.taxPct}%)`, B.tax, W.tax);
  billRows.push(ftm ? `<tr class="total"><td>Charging account bill</td><td class="num">${fmt$(W.total)}</td></tr>` : `<tr class="total"><td>Annual bill</td><td class="num">${fmt$(B.total)}</td><td class="num">${fmt$(W.total)}</td><td class="num ok">${fmt$(S.savingsBill)}</td></tr>`);
  const drvKwh = vs.drv ? C.totals.drv / vs.drv.rate : 0;
  const creditRows = [
    [`Energy: ${fmtN(C.exportKwh / 1000, 1)} MWh of net exports at zone ${R.stack.supply.zone} day-ahead LBMP x ${lf}`, C.totals.energy],
    [`Capacity, Alternative 3: ${fmtN(C.alt3Kw, 1)} kW held through the likely peak hours x ${fmt$(vs.alt3.annualRate, 2)}/kW-year`, C.totals.alt3],
    ...(vs.drv ? [[`DRV: ${fmtN(drvKwh / 1000, 1)} MWh exported in the ${vs.drv.hours[0]}:00 to ${vs.drv.hours[1]}:00 call window x ${fmt$(vs.drv.rate, 4)}`, C.totals.drv]] : []),
    ...(vs.lsrv ? [[`LSRV: ${C.lsrvKw.length} events, lowest net injection ${C.lsrvKw.map((v) => fmtN(v)).join(' / ')} kW x ${fmt$(vs.lsrv.perEvent, 2)}/kW`, C.totals.lsrv]] : []),
    ...R.revenue.streams.map((st) => [`${esc(st.label)}: reservation (${st.terms.months} months x ${st.terms.reservationRate.toFixed(2)} $/kW x ${fmtN(st.deliveredKw, 1)} kW delivered of ${fmtN(st.pledgeKw)} pledged; no performance pay under Rider R)`, st.reservation]),
  ];
  const creditTable = creditRows.map(([n, v]) => `<tr><td>${n}</td><td class="num ok">${fmt$(v)}</td></tr>`).join('') + `<tr class="total"><td>Credits and program revenue</td><td class="num ok">${fmt$(S.creditsTotal + S.programRevenue)}</td></tr>`;
  const monthRows = MONTH_NAMES.map((n, m) => `<tr><td>${n}</td><td class="num">${fmt$(C.energy[m])}</td><td class="num">${fmt$(C.alt3[m])}</td><td class="num">${fmt$(C.drv[m])}</td>${vs.lsrv ? `<td class="num">${fmt$(C.lsrv[m])}</td>` : ''}<td class="num">${fmt$(C.energy[m] + C.alt3[m] + C.drv[m] + C.lsrv[m])}</td></tr>`).join('');
  const A = R.alternative;
  const altNote = A ? `<p class="note">Keeping the DRV${state.valueStack.lsrv ? ' and LSRV' : ''} instead, the same battery would earn ${fmt$(A.net)} a year (DRV ${fmt$(A.credits.totals.drv)}${A.credits.totals.lsrv ? `, LSRV ${fmt$(A.credits.totals.lsrv)}` : ''}): the ${state.valueStack.election === 'rider_t' ? 'Rider T election' : 'Rider AC contract'} is ${A.net > S.savingsTotal ? `worth ${fmt$(A.net - S.savingsTotal)} a year less` : `worth ${fmt$(S.savingsTotal - A.net)} a year more`}. ${state.valueStack.election === 'rider_t' || state.valueStack.acDlrp ? 'Rider T gives the DRV and LSRV up for the rest of the 25-year term.' : 'Rider AC only pauses them for the contract.'}</p>` : '';
  const dropped = [...(R.inp.exports.dropped || []), ...(R.sol.dropped || [])];
  const weeks = weekOptions(ftm ? R.sol.exp : R.load.kw, ftm);
  const sup = R.stack.supply;
  const assumptions = [
    `${ftm ? 'Charging account' : 'Building account with the battery'}: ${accountLabel(R.stack.account)}, ${state.region === 'nyc' ? 'New York City' : 'Westchester'} (zone ${sup.zone})${edition.rateProvenanceClause(R.stack.tariff)}; ${R.stack.demandIntervalMin}-minute billing demand. ${esc(R.stack.account.reason)}`,
    ...(R.stack.account.standby && !ftm ? [+state.rateNo >= 4 ? `The building is on SC ${R.stack.account.sc} standby (Rate ${roman[state.rateNo]}) with and without the battery.` : `The baseline is the building's current SC ${R.stack.account.sc} bill on standard rates; with the battery it moves to standby.`] : []),
    ...(R.stack.account.sc === 9 && R.stack.account.rateNo === 1 ? [MAX_RATE_NOTE] : []),
    `Delivery $/kWh adjustments ${R.stack.kwhAdj.toFixed(6)} $/kWh; statements in force on ${esc(data.statements.in_force_on)}.`,
    esc(sup.description) + '.', ...sup.warnings.map(esc), ...R.stack.notes.map(esc),
    `Value Stack (Rider R A.9(d) with SC 11): credits on each hour's net injection; energy at day-ahead LBMP x ${lf} (General Rule 25.1 losses); Alternative 3 at the ${data.valueStack.statements.length} monthly statements x ${lf}; the DRV and LSRV fixed for 10 years; no environmental component, MTC or Community Credit for storage. The 25-year Value Stack term and escalation are not modelled.`,
    curveNote(R),
    `Alternative 3: the battery holds ${fmtN(C.alt3Kw, 1)} kW of net injection through ${vs.alt3.hours[0]}:00 to ${vs.alt3.hours[1]}:00 on ${vs.alt3.days.length} top-priced July and August weekdays, standing in for the unknown NYCA peak hour; Con Edison estimates a new project's first-year kW.`,
    ...dropped.map(esc),
    ...(vs.drv ? ['No charging and no grid pass-through in the DRV window; outside it the export credit is capped just under the import price in the optimisation (the credits shown use the real prices).'] : []),
    ...(R.sol.timing && R.sol.timing.hourly ? ['Solved hour by hour: with no load and prices and windows constant within each hour, the hourly dispatch is exactly as good as a 15-minute one.'] : []),
    ...(R.sol.timing && R.sol.timing.firstPassHourly ? ['Behind the meter a first solve on hourly averages picked each DRV-window interval\'s side (import or export); the 15-minute solve then held each to it, so no interval both imports and exports.'] : []),
    ...(R.sol.timing && R.sol.timing.firstPassWash ? [`Behind the meter the first solve both imported and exported in ${R.sol.timing.firstPassWash} window intervals; a second solve fixed each to its net side.`] : []),
    `Perfect-foresight dispatch over the model year (2027 calendar, DST ignored); cyclic state of charge; ${S.cycles.toFixed(0)} equivalent full cycles${S.cycleLimit ? ` of the ${S.cycleLimit} allowed` : ''}.` + cycleNote(R),
    ...vs.notes.map(esc), ...(R.stack.programs.notes || []).map(esc),
    'SC 11 charges are not added: the customer charge is waived when another service class serves the same connection, and stand-alone storage is exempt from the SC 11 contract demand charge for 15 years if it qualifies by the end of 2030.',
  ];
  return `
    <h2>Results</h2>
    <p class="lede">${esc(MODALITIES[state.modality])}; ${fmtN(R.battery.kw)} kW / ${fmtN(R.battery.kwh)} kWh, ${(R.battery.rte * 100).toFixed(0)}% round trip${ftm ? '' : `; ${esc(R.load.label)}`}.${R.restored ? ` Kept run from ${new Date(R.runAt).toLocaleString()}.` : edition.solvedIn(R.elapsedMs)}</p>
    <div class="hero">
      <div><div class="k">Annual net benefit</div><div class="v">${fmt$(S.savingsTotal)}</div><div class="s">${ftm ? 'credits and program revenue less the charging bill' : 'bill savings, credits and program revenue'}</div></div>
      <div><div class="k">Value Stack credits</div><div class="v">${fmt$(S.creditsTotal)}</div><div class="s">${fmtN(C.exportKwh / 1000, 0)} MWh exported${R.revenue.total ? `; plus ${fmt$(R.revenue.total)} programs` : ''}</div></div>
      <div><div class="k">${ftm ? 'Charging bill' : 'Bill savings'}</div><div class="v">${fmt$(ftm ? W.total : S.savingsBill)}</div><div class="s">${ftm ? `per year, ${accountLabel(R.stack.account)}` : `of the ${fmt$(B.total)} baseline`}</div></div>
      <div><div class="k">Alternative 3</div><div class="v">${fmtN(C.alt3Kw, 0)} kW</div><div class="s">${fmt$(C.totals.alt3)} a year</div></div>
      ${capex ? `<div><div class="k">Simple payback</div><div class="v">${S.savingsTotal > 0 ? (capex / S.savingsTotal).toFixed(1) + ' yr' : '-'}</div><div class="s">on ${fmt$(capex / 1000)}k installed</div></div>` : ''}
    </div>
    ${dropped.map((d) => `<p class="flag">${esc(d)}</p>`).join('')}
    ${altNote}
    <h3>Value Stack credits${R.revenue.streams.length ? ' and program revenue' : ''}</h3>
    <div class="tablewrap"><table><thead><tr><th>Component</th><th class="num">Per year</th></tr></thead><tbody>${creditTable}</tbody></table></div>
    <h3>${ftm ? 'Charging account bill' : 'Annual bill, baseline vs with battery'}</h3>
    <div class="tablewrap"><table><thead><tr><th>Component</th>${ftm ? '<th class="num">Per year</th>' : '<th class="num">Baseline</th><th class="num">With battery</th><th class="num">Savings</th>'}</tr></thead><tbody>${billRows.join('')}</tbody></table></div>
    ${curveHtml(R)}
    <h3>Credits by month</h3>
    <div id="chartCredits"></div>
    <div class="tablewrap"><table><thead><tr><th>Month</th><th class="num">Energy</th><th class="num">Alt 3</th><th class="num">DRV</th>${vs.lsrv ? '<th class="num">LSRV</th>' : ''}<th class="num">Total</th></tr></thead><tbody>${monthRows}</tbody></table></div>
    ${ftm ? '' : '<h3>Monthly peaks</h3><div id="chartPeaks"></div>'}
    <h3>Dispatch</h3>
    <div class="inline"><label class="lab" for="weekSel" style="margin:0">Week</label><select id="weekSel">${weeks.map((w) => `<option value="${w.start}" ${w.selected ? 'selected' : ''}>${w.label}</option>`).join('')}</select></div>
    <div id="chartWeek"></div>
    <div id="chartSoc"></div>
    ${backupHtml(R)}
    <h3>Assumptions and provenance</h3>
    <ul class="tight">${assumptions.map((a) => `<li>${a}</li>`).join('')}</ul>
    <div class="inline" style="margin-top:1rem"><button type="button" class="btn small" id="dlXlsx">Download pro-forma (XLSX)</button><button type="button" class="btn small" id="dlJson">Download results (JSON)</button><button type="button" class="btn small" id="dlDispatch">Download dispatch (CSV)</button></div>
    <div class="actions"><button type="button" class="btn" data-nav="-1">Back to battery</button><button type="button" class="btn" id="rerun">Change inputs and re-run</button></div>`;
}

// The capacity curve on the results page: Year 1 again with less usable energy.
function curveHtml(R) {
  if (!R.curve) return R.curveFailed ? '<p class="flag">The capacity curve could not be solved, so the pro-forma holds savings at Year 1. The Year 1 results stand; run again to retry.</p>' : '';
  const ftm = state.modality === 'ftm', vs = !!R.stack.valueStack, progs = R.revenue.streams.length > 0;
  const rows = R.curve.levels.map((p) => {
    const bill = p.demand + p.energy + p.accountChange;
    return `<tr><td>${pctOf(p.level)}%</td><td class="num">${fmtN(p.usableKwh)}</td><td class="num">${fmt$(ftm ? -bill : bill)}</td>${progs ? `<td class="num">${fmt$(p.programs)}</td>` : ''}${vs ? `<td class="num">${fmt$(p.exportCredits + p.capacityCredits)}</td>` : ''}<td class="num">${fmt$(p.net)}</td><td class="num">${(p.netShare * 100).toFixed(0)}%</td></tr>`;
  }).join('');
  return `<h3>Capacity curve, for degradation</h3>
    <div class="tablewrap"><table><thead><tr><th>Usable energy</th><th class="num">kWh</th><th class="num">${ftm ? 'Charging bill' : 'Bill savings'}</th>${progs ? '<th class="num">Programs</th>' : ''}${vs ? '<th class="num">Value Stack credits</th>' : ''}<th class="num">Net benefit</th><th class="num">Of full</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">The whole year optimised again with less usable energy; power, efficiency and the annual cycle limit stay. The pro-forma's cash flow follows this curve from the annual degradation and the replacement year entered there, so a fading battery needs no second run.</p>`;
}
function curveNote(R) {
  return R.curve ? `Degradation through the capacity curve: the year solved again at ${CURVE_BELOW}% of the usable energy, with power, efficiency and the cycle limit (on nameplate kWh) unchanged.`
    : 'No capacity curve: the pro-forma holds savings at Year 1.';
}

// The state of charge month by month, and the backup it gives the building:
// hours at a critical load of 25% of the month's peak (none for a stand-alone
// battery, which has no load of its own).
const BACKUP_SHARE = 0.25;
const backupRows = (R) => backupByMonth({ idx: R.stack.idx, soc: R.sol.soc, battery: R.battery, share: BACKUP_SHARE,
  peaks: state.modality === 'ftm' ? null : R.summary.monthly.map((m) => m.peakBefore) });
function backupHtml(R) {
  const rows = backupRows(R), ftm = state.modality === 'ftm';
  const usable = R.battery.kwh * R.battery.usableFrac, pct = (v) => `${(v * 100).toFixed(0)}%`;
  const avg = rows.reduce((a, r) => a + r.avgKwh, 0) / 12;
  const lo = rows.reduce((a, r) => (r.avgKwh < a.avgKwh ? r : a)), hi = rows.reduce((a, r) => (r.avgKwh > a.avgKwh ? r : a));
  let note = `On average the battery holds ${fmtN(avg)} kWh, ${pct(avg / usable)} of its ${fmtN(usable)} kWh usable: least in ${lo.month} (${fmtN(lo.avgKwh)} kWh), most in ${hi.month} (${fmtN(hi.avgKwh)} kWh).`;
  if (!ftm) {
    const short = rows.reduce((a, r) => (r.hours < a.hours ? r : a)), long = rows.reduce((a, r) => (r.hours > a.hours ? r : a));
    note += ` In an outage, that average charge would carry a critical load of ${pct(BACKUP_SHARE)} of the month's peak for ${short.hours.toFixed(1)} to ${long.hours.toFixed(1)} hours: shortest in ${short.month} (${fmtN(short.loadKw)} kW), longest in ${long.month} (${fmtN(long.loadKw)} kW).`;
    const limited = rows.filter((r) => r.powerLimited);
    if (limited.length) note += ` In ${limited.length === 12 ? 'every month' : limited.map((r) => r.month).join(', ')}, ${pct(BACKUP_SHARE)} of the peak is more than the battery's ${fmtN(R.battery.kw)} kW, so it carries only ${fmtN(R.battery.kw)} kW of that load.`;
  }
  note += ' The dispatch keeps no reserve for outages. Between uses it recharges as soon as that costs nothing extra, but these are what normal operation leaves in the battery at an average moment, and right after a discharge it can be close to empty.';
  const head = `<th>Month</th><th class="num">Average stored kWh</th><th class="num">Of usable</th>${ftm ? '' : `<th class="num">${pct(BACKUP_SHARE)} of peak kW</th><th class="num">Backup hours</th>`}`;
  const body = rows.map((r) => `<tr><td>${r.month}</td><td class="num">${fmtN(r.avgKwh)}</td><td class="num">${pct(r.avgShare)}</td>${ftm ? '' : `<td class="num">${fmtN(r.loadKw)}</td><td class="num">${r.hours.toFixed(1)}${r.powerLimited ? ` at ${fmtN(r.carriedKw)} kW` : ''}</td>`}</tr>`).join('');
  return `<h3>State of charge${ftm ? '' : ' and backup'}</h3>
    <div id="chartSocMonthly"></div>
    <p class="note">${note}</p>
    <div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function cycleNote(R) {
  const c = R.sol.cycleInfo;
  if (!c || !R.battery.cyclesPerYear) return '';
  if (!c.binding) return ' The cap does not bind.';
  const perCycle = c.marginalUsdPerKwh != null ? c.marginalUsdPerKwh * R.battery.kwh : null;
  return ` The cap binds: unconstrained, the dispatch would run ${(c.uncappedThroughputKwh / R.battery.kwh).toFixed(0)} cycles${perCycle != null ? `; one more cycle of budget is worth about ${fmt$(perCycle)} a year at the margin` : ''}.`;
}

// The weeks of the year, opening on the one with the peak of `series` (or,
// with `byTotal`, the most of it: a stand-alone battery's busiest export week).
function weekOptions(series, byTotal = false) {
  const idx = buildIndex();
  const W = 7 * 96;
  let peakT = 0; for (let t = 0; t < idx.T; t++) if (series[t] > series[peakT]) peakT = t;
  if (byTotal) {
    let best = -1;
    for (let start = 0; start + W <= idx.T; start += W) { let sum = 0; for (let t = start; t < start + W; t++) sum += series[t]; if (sum > best) { best = sum; peakT = start; } }
  }
  const out = [];
  for (let start = 0; start + W <= idx.T; start += W) {
    const end = start + W - 1;
    out.push({ start, label: `${MONTH_NAMES[idx.month[start] - 1]} ${idx.day[start]} to ${MONTH_NAMES[idx.month[end] - 1]} ${idx.day[end]}`, selected: peakT >= start && peakT <= end });
  }
  if (!out.some((w) => w.selected)) out[out.length - 1].selected = true;
  return out;
}

function afterResults() {
  if (!results) return;
  const R = results, S = R.summary;
  if ($('#chartPeaks')) barChart($('#chartPeaks'), { labels: MONTH_NAMES, series: [{ name: 'Before', values: S.monthly.map((m) => m.peakBefore), color: 'var(--s1)' }, { name: 'With battery', values: S.monthly.map((m) => m.peakAfter), color: 'var(--s2)' }], yFormat: (v) => fmtN(v) + ' kW', height: 220, yLabel: 'monthly billing peak kW' });
  if ($('#chartCredits')) {
    const C = R.credits;
    barChart($('#chartCredits'), { labels: MONTH_NAMES, series: [{ name: 'Energy', values: C.energy, color: 'var(--s1)' }, { name: 'Alternative 3', values: C.alt3, color: 'var(--s2)' }, { name: 'DRV + LSRV', values: C.drv.map((v, m) => v + C.lsrv[m]), color: 'var(--s3)' }], yFormat: (v) => fmt$(v), height: 220, yLabel: 'Value Stack credits $ by month' });
  }
  if ($('#chartSocMonthly')) barChart($('#chartSocMonthly'), { labels: MONTH_NAMES, series: [{ name: 'Average state of charge', values: backupRows(R).map((r) => r.avgKwh), color: 'var(--s3)' }], yFormat: (v) => fmtN(v) + ' kWh', height: 200, yLabel: 'average stored energy kWh by month' });
  const drawWeek = () => {
    const start = +$('#weekSel').value;
    const n = 7 * 96;
    const idx = R.stack.idx;
    const slice = (arr) => Array.from(arr.subarray(start, start + n));
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const xTicks = []; for (let d = 0; d < 7; d++) { const t = start + d * 96; xTicks.push({ i: d * 96, label: `${DAYS[idx.dow[t]]} ${idx.month[t]}/${idx.day[t]}` }); }
    const labelAt = (i) => labelOf(idx, start + i);
    const lines = R.stack.valueStack
      ? [...(state.modality === 'ftm' ? [] : [{ name: 'Building load', values: slice(R.load.kw), color: 'var(--s1)' }]), { name: 'Grid import', values: slice(R.sol.imp), color: 'var(--s2)' }, { name: 'Grid export', values: slice(R.sol.exp), color: 'var(--s3)' }]
      : [{ name: 'Building load', values: slice(R.load.kw), color: 'var(--s1)' }, { name: 'Grid import', values: slice(R.sol.imp), color: 'var(--s2)' }];
    lineChart($('#chartWeek'), { series: lines, xTicks, labelAt, yFormat: (v) => fmtN(v) + ' kW', height: 240, yLabel: 'kW' });
    lineChart($('#chartSoc'), { series: [{ name: 'State of charge', values: slice(R.sol.soc), color: 'var(--s3)', area: true }], xTicks, labelAt, yFormat: (v) => fmtN(v) + ' kWh', height: 150, yLabel: 'kWh' });
  };
  $('#weekSel').addEventListener('change', drawWeek);
  drawWeek();
  $('#rerun').addEventListener('click', () => goTo('battery'));
  $('#dlXlsx').addEventListener('click', async (e) => {
    const btn = e.currentTarget, label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Building the pro-forma...';
    try {
      const res = await fetch(TEMPLATE_URL);
      if (!res.ok) throw new Error(`pro-forma template: ${res.status}`);
      const template = new Uint8Array(await res.arrayBuffer());
      await new Promise((r) => setTimeout(r, 30)); // let the button repaint before the zip work
      const L = state.load;
      if (saving) await saving.catch(() => null); // a hosted run's save, so the links point at its version
      const d = proformaData({ stack: R.stack, load: R.load.kw, sol: R.sol, summary: S, revenue: R.revenue, battery: R.battery, credits: R.credits, baseline: R.baseline, withB: R.withB, baseStack: state.modality === 'ftm' ? null : R.base }, {
        project: runIdentity(R),
        election: R.stack.valueStack ? ELECTIONS[state.valueStack.election] : undefined,
        programMonths: programMonths(),
        curve: R.curve,
        saved: savedInfo(R),
        hosted: STORE.kind === 'server',
        monthlyBills: R.load.source === 'bill' && L.billMode === 'monthly' && L.monthlyBills ? L.monthlyBills : null,
        installedCost: (+state.battery.capexK || 0) * 1000,
      });
      download(`${fileSlug(state.project.name)}_proforma.xlsx`, fillProforma(template, d), XLSX_TYPE);
    } catch (err) {
      edition.logError(err);
      btn.insertAdjacentHTML('afterend', '<span class="bad">The pro-forma could not be built. Reload the page and try again.</span>');
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  });
  $('#dlJson').addEventListener('click', () => {
    const out = { project: { ...runIdentity(R), saved: savedInfo(R) }, inputs: stackConfig(), battery: R.battery, load: { label: R.load.label, source: R.load.source, stats: stats(R.load.kw) }, baseline: R.baseline, withBattery: R.withB, programRevenue: R.revenue, valueStackCredits: R.credits, electionComparison: R.alternative, capacityCurve: R.curve, stateOfCharge: { backupShareOfPeak: state.modality === 'ftm' ? null : BACKUP_SHARE, byMonth: backupRows(R) }, summary: R.summary, generated: new Date().toISOString() };
    download(`${fileSlug(state.project.name)}_results.json`, JSON.stringify(out, (k, v) => (v instanceof Float64Array || v instanceof Int32Array ? undefined : v), 1), 'application/json');
  });
  $('#dlDispatch').addEventListener('click', () => {
    const idx = R.stack.idx;
    const lines = ['timestamp,load_kw,import_kw,export_kw,charge_kw,discharge_kw,soc_kwh,price_usd_per_kwh'];
    for (let t = 0; t < idx.T; t++) lines.push(`${labelOf(idx, t)},${R.load.kw[t].toFixed(2)},${R.sol.imp[t].toFixed(2)},${R.sol.exp[t].toFixed(2)},${R.sol.ch[t].toFixed(2)},${R.sol.dis[t].toFixed(2)},${R.sol.soc[t].toFixed(2)},${R.stack.price[t].toFixed(5)}`);
    download(`${fileSlug(state.project.name)}_dispatch.csv`, lines.join('\n'), 'text/csv');
  });
}

// Who and what a run is, for the downloads: the project, the configuration
// fingerprint and the scenario in words.
function runIdentity(R) {
  const enrolled = R.stack.programs.programs.map((p) => p.id.toUpperCase().replace('_', '-'));
  return {
    id: state.project.id, name: state.project.name || 'Untitled project', config: R.config, run: R.runAt, version: APP_VERSION,
    ratesDate: data.statements.in_force_on, modality: MODALITIES[state.modality],
    rate: `${accountLabel(R.stack.account)}${R.stack.valueStack ? '; Rider R A.9(d) with SC 11' : ''}`,
    area: `${state.region === 'nyc' ? 'New York City' : 'Westchester'} (zone ${R.stack.supply.zone})`,
    supply: SUPPLY_MODES[R.stack.supply.mode],
    dr: (R.stack.valueStack ? `${{ value_stack: 'DRV kept', rider_t: 'Rider T instead of DRV', rider_ac: 'Rider AC instead of DRV' }[state.valueStack.election]}; ` : '') + (enrolled.length ? `${enrolled.join(' + ')}, ${fmtN(state.programs.pledgeKw)} kW pledged at ${state.programs.network}${R.stack.drOnly ? '; demand response only (no discharging for the bill)' : ''}` : 'no programs'),
    load: R.load.label,
  };
}

// ---------------------------------------------------------------- project bar
// One project at a time: its name and id, and a project file to save and
// open it with (the uploaded interval data travels in the file).
let projectMsg = '';
function renderProject() {
  const el = $('#project');
  if (!el) return;
  if (STORE.kind === 'server') return renderServerProject(el);
  const P = state.project;
  el.innerHTML = `
    <input type="text" id="projectName" value="${esc(P.name || '')}" placeholder="Untitled project" aria-label="Project name" maxlength="80">
    <span class="pid" title="Project ID ${esc(P.id)}">#${esc(P.id.slice(0, 8))}</span>
    <button type="button" class="btn small" id="projectSave">Save project</button>
    <button type="button" class="btn small" id="projectOpen">Open project</button>
    <button type="button" class="btn small" id="projectNew">New project</button>
    <input type="file" id="projectFile" accept=".json,application/json" hidden>
    ${projectMsg ? `<span class="msg">${esc(projectMsg)}</span>` : ''}`;
  $('#projectName').addEventListener('change', (e) => { state.project.name = e.target.value.trim(); state.project.updated = new Date().toISOString(); saveState(); });
  $('#projectSave').addEventListener('click', () => {
    state.project.updated = new Date().toISOString();
    download(`${fileSlug(state.project.name)}.coned-battery.json`, JSON.stringify(projectFile(state, uploaded)), 'application/json');
    projectMsg = `Saved ${new Date().toLocaleTimeString()}${uploaded ? ', with the uploaded interval data' : ''}.`;
    saveState(); renderProject();
  });
  $('#projectOpen').addEventListener('click', () => $('#projectFile').click());
  $('#projectFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const doc = readProjectFile(await f.text());
      state = deepMerge(structuredClone(DEFAULTS), doc.inputs);
      state.project = doc.project; state.step = 0;
      uploaded = doc.upload;
      results = null; stackCache.key = null; baseCache.key = null; loadCache = { key: null, value: null };
      projectMsg = `Opened "${doc.project.name || 'Untitled project'}" (saved ${doc.saved ? new Date(doc.saved).toLocaleString() : 'earlier'}).`;
      render();
    } catch (err) { projectMsg = err.message; }
    renderProject();
  });
  let armed = null;
  $('#projectNew').addEventListener('click', (e) => {
    if (!armed) {
      e.target.textContent = 'Start over? Click again';
      armed = setTimeout(() => { armed = null; renderProject(); }, 4000);
      return;
    }
    clearTimeout(armed);
    state = structuredClone(DEFAULTS); state.project = newProject();
    uploaded = null; results = null; stackCache.key = null; baseCache.key = null; loadCache = { key: null, value: null };
    projectMsg = 'New project started. Save the old one first if you need it: it is not kept.';
    render(); renderProject();
  });
}

// ---------------------------------------------------------------- hosted: projects on the server
// Every save is a version on the server, the last run included; every run
// saves itself. No logins: the name below the Projects list says who saved.
const AUTHOR_KEY = 'coned-battery-wizard.author';
const author = () => { try { return localStorage.getItem(AUTHOR_KEY) || ''; } catch (e) { return ''; } };
let panel = null, panelData = null, conflict = null;
let saving = null, opening = false;

// A link to a project on this site, at one version or (without) its latest.
const projectLink = (id, rev = null) => `${location.origin}${location.pathname}${projectHash(id, rev)}`;
// The address bar follows the open version, so it is always a link to it.
function showLinkInAddress() {
  if (STORE.kind !== 'server' || opening) return;
  const want = state.project.rev ? projectHash(state.project.id, state.project.rev) : '';
  if (location.hash !== want) history.replaceState(null, '', want || location.pathname + location.search);
}
// Where a run is kept, for the downloads: the version holding it and links back to it.
const savedInfo = (R) => (R && R.saved ? { rev: R.saved.rev, link: projectLink(state.project.id, R.saved.rev), projectLink: projectLink(state.project.id), savedAt: R.saved.at || '', savedBy: R.saved.by || '' } : null);

async function copyText(text) {
  // The clipboard needs https (or localhost) and a visible, focused page; it
  // may also never answer, so give it a moment and then try the old way.
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((resolve, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1500))]);
    return true;
  } catch (e) { /* plain http, refused or no answer */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
async function copyLink(rev) {
  const link = projectLink(state.project.id, rev);
  projectMsg = (await copyText(link)) ? `Link to version ${rev} copied: it opens this version with its inputs and run.` : `Copy this link to version ${rev}: ${link}`;
  renderProject();
}

async function saveToServer({ force = false } = {}) {
  state.project.updated = new Date().toISOString();
  const R = results;
  const doc = { ...projectFile(state, uploaded), run: R ? runSnapshot(R, data.statements.in_force_on) : null };
  projectMsg = 'Saving...'; renderProject();
  try {
    saving = STORE.save(doc, { baseRev: force ? null : (state.project.rev ?? null), author: author() });
    const r = await saving;
    state.project.rev = r.rev; conflict = null; saveState();
    if (R) R.saved = { rev: r.rev, at: new Date().toISOString(), by: author() };
    projectMsg = `Saved as version ${r.rev}${doc.run ? ', with this run' : ''}.`;
  } catch (e) {
    if (e.conflict) {
      conflict = e.conflict;
      projectMsg = `Someone saved version ${e.conflict.latest} after the version you opened. Open the latest from Versions, or save yours as a new version anyway.`;
    } else { projectMsg = `Could not save: ${e.message}`; edition.logError(e); }
  } finally { saving = null; }
  if (panel) await showPanel(panel, true); else renderProject();
}

async function openFromServer(id, rev) {
  let opened = false;
  opening = true;
  projectMsg = 'Opening...'; renderProject();
  try {
    const got = await STORE.load(id, rev);
    const doc = readProjectDoc(got.doc);
    state = deepMerge(structuredClone(DEFAULTS), doc.inputs);
    state.project = { ...doc.project, rev: got.rev }; state.step = 0;
    uploaded = doc.upload; results = null; stackCache.key = null; baseCache.key = null; loadCache = { key: null, value: null };
    panel = null; conflict = null;
    const r = await restoreRun(doc.run);
    const who = `version ${got.rev}, saved ${new Date(got.saved_at).toLocaleString()}${got.saved_by ? ` by ${got.saved_by}` : ''}`;
    if (r.restored) {
      results.saved = { rev: got.rev, at: got.saved_at, by: got.saved_by };
      projectMsg = `Opened ${who}, with its run.`;
      goToSilently('results');
    } else {
      projectMsg = `Opened ${who}.` + (doc.run
        ? ` Its run (${new Date(doc.run.runAt).toLocaleDateString()}, ${fmt$(doc.run.summary.net)} a year) was made ${r.reason === 'version' ? 'with an earlier wizard version or other rates' : 'from different inputs'}: run again for results.`
        : ' It has no run: run it for results.');
    }
    render();
    opened = true;
  } catch (e) { projectMsg = `Could not open: ${e.message}`; edition.logError(e); }
  opening = false;
  renderProject();
  return opened;
}

// A hosted build, reopened: bring back the open version's run (and its
// uploaded profile, which the browser does not keep) if the inputs are still
// the ones it was run with.
async function resumeFromServer() {
  if (STORE.kind !== 'server' || !state.project.rev) return;
  try {
    const got = await STORE.load(state.project.id, state.project.rev);
    const doc = readProjectDoc(got.doc);
    if (state.load.mode === 'upload' && !uploaded && doc.upload) { uploaded = doc.upload; loadCache = { key: null, value: null }; }
    const r = await restoreRun(doc.run);
    if (r.restored) { results.saved = { rev: got.rev, at: got.saved_at, by: got.saved_by }; projectMsg = `Version ${got.rev} and its run are back.`; goToSilently('results'); render(); }
    renderProject();
  } catch (e) { edition.logError(e); }
}

async function showPanel(kind, refresh = false) {
  if (panel === kind && !refresh) { panel = null; renderProject(); return; }
  panel = kind; panelData = null; renderProject();
  try { panelData = kind === 'projects' ? await STORE.list() : await STORE.revisions(state.project.id); } catch (e) { panelData = { error: e.message }; }
  renderProject();
}

function panelHtml() {
  const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const run = (r) => (r.run_at ? `${fmt$(+r.net || 0)} <span class="d">${when(r.run_at)}</span>` : '<span class="d">no run</span>');
  if (!panelData) return '<p class="note">Loading...</p>';
  if (panelData.error) return `<p class="note">${esc(panel === 'versions' && /No such project/.test(panelData.error) ? 'This project has not been saved yet.' : panelData.error)}</p>`;
  if (panel === 'projects') {
    return `<div class="inline"><label class="lab" for="projectAuthor" style="margin:0">Saved by</label><input type="text" id="projectAuthor" value="${esc(author())}" placeholder="your name" maxlength="60"></div>
      ${panelData.length ? `<div class="tablewrap"><table><thead><tr><th>Project</th><th>Last saved</th><th class="num">Versions</th><th>Last run (net / yr)</th><th></th></tr></thead><tbody>
      ${panelData.map((p) => `<tr><td>${esc(p.name || 'Untitled project')}${p.id === state.project.id ? ' <span class="d">(open)</span>' : ''}</td><td>${when(p.updated_at)}${p.updated_by ? `<br><span class="d">${esc(p.updated_by)}</span>` : ''}</td><td class="num">${p.latest_rev}</td><td>${run(p)}</td><td><button type="button" class="btn small" data-open="${esc(p.id)}">Open</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="note">No projects saved yet.</p>'}`;
  }
  return `<div class="tablewrap"><table><thead><tr><th class="num">Version</th><th>Saved</th><th>Name</th><th>Run (net / yr)</th><th>Inputs</th><th></th></tr></thead><tbody>
    ${panelData.map((r) => `<tr><td class="num">v${r.rev}${r.rev === state.project.rev ? ' <span class="d">(open)</span>' : ''}</td><td>${when(r.saved_at)}${r.saved_by ? `<br><span class="d">${esc(r.saved_by)}</span>` : ''}</td><td>${esc(r.name || '')}</td><td>${run(r)}</td><td><span class="pid">${esc(r.config || '')}</span></td><td><button type="button" class="btn small" data-open="${esc(state.project.id)}" data-rev="${r.rev}">Open</button> <button type="button" class="btn small" data-link="${r.rev}">Copy link</button></td></tr>`).join('')}
    </tbody></table></div><p class="note">Every save is kept. The Inputs code changes whenever an input does. A version's link opens it, with its run, for anyone who has the link.</p>`;
}

function renderServerProject(el) {
  const P = state.project;
  el.innerHTML = `
    <input type="text" id="projectName" value="${esc(P.name || '')}" placeholder="Untitled project" aria-label="Project name" maxlength="80">
    <span class="pid" title="Project ID ${esc(P.id)}">#${esc(P.id.slice(0, 8))} ${P.rev ? `v${P.rev}` : 'not saved'}</span>
    <button type="button" class="btn small" id="projectSave">Save version</button>
    <button type="button" class="btn small ${panel === 'projects' ? 'on' : ''}" id="projectList">Projects</button>
    <button type="button" class="btn small ${panel === 'versions' ? 'on' : ''}" id="projectVersions">Versions</button>
    <button type="button" class="btn small" id="projectCopyLink" ${P.rev ? '' : 'disabled title="Save a version first"'}>Copy link</button>
    <button type="button" class="btn small" id="projectNew">New project</button>
    ${conflict ? '<button type="button" class="btn small" id="projectForce">Save as a new version anyway</button>' : ''}
    ${projectMsg ? `<span class="msg">${esc(projectMsg)}</span>` : ''}
    ${panel ? `<div class="ppanel" role="dialog" aria-label="${panel === 'projects' ? 'Projects' : 'Versions'}"><div class="ppanel-head"><b>${panel === 'projects' ? 'Projects on this server' : `Versions of ${esc(P.name || 'this project')}`}</b><button type="button" class="btn small" id="panelClose">Close</button></div>${panelHtml()}</div>` : ''}`;
  $('#projectName').addEventListener('change', (e) => { state.project.name = e.target.value.trim(); saveState(); });
  $('#projectSave').addEventListener('click', () => saveToServer());
  $('#projectList').addEventListener('click', () => showPanel('projects'));
  $('#projectVersions').addEventListener('click', () => showPanel('versions'));
  $('#projectCopyLink').addEventListener('click', () => { if (state.project.rev) copyLink(state.project.rev); });
  el.querySelectorAll('[data-link]').forEach((b) => b.addEventListener('click', () => copyLink(+b.dataset.link)));
  showLinkInAddress();
  const force = $('#projectForce'); if (force) force.addEventListener('click', () => saveToServer({ force: true }));
  const close = $('#panelClose'); if (close) close.addEventListener('click', () => { panel = null; renderProject(); });
  const who = $('#projectAuthor'); if (who) who.addEventListener('change', (e) => { try { localStorage.setItem(AUTHOR_KEY, e.target.value.trim()); } catch (err) { /* ignore */ } });
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openFromServer(b.dataset.open, b.dataset.rev ? +b.dataset.rev : undefined)));
  let armed = null;
  $('#projectNew').addEventListener('click', (e) => {
    if (!armed) { e.target.textContent = 'Start over? Click again'; armed = setTimeout(() => { armed = null; renderProject(); }, 4000); return; }
    clearTimeout(armed);
    state = structuredClone(DEFAULTS); state.project = newProject();
    uploaded = null; results = null; stackCache.key = null; baseCache.key = null; loadCache = { key: null, value: null };
    panel = null; conflict = null;
    projectMsg = 'New project started; the others stay on the server.';
    render(); renderProject();
  });
}

function download(name, text, type) {
  try {
    const blob = new Blob([text], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch (e) { edition.logError(e); }
}

// ---------------------------------------------------------------- rail
async function renderRail() {
  const rail = $('#rail');
  let stack = null, base = null, err = null;
  let load = null; try { load = await getLoad(); } catch (e) { /* shown in panel */ }
  try { stack = getStack(); base = getBaseStack(); } catch (e) { err = e; }
  const B = state.battery, ftm = state.modality === 'ftm';
  const s = load ? stats(load.kw) : null;
  const bill = load && base && !ftm ? billFor(base, load.kw) : null;
  const enrolled = stack ? stack.programs.programs.map((p) => p.id.toUpperCase().replace('_', '-')) : [];
  rail.innerHTML = `
    <div class="card"><h4>Scenario</h4><dl>
      <dt>Modality</dt><dd>${esc(MODALITIES[state.modality])}</dd>
      <dt>${ftm ? 'Account' : 'Rate'}</dt><dd>${stack ? accountLabel(stack.account) : `SC ${state.serviceClass || 8} Rate ${roman[state.rateNo]} ${state.voltage.toUpperCase()}`}, ${state.region === 'nyc' ? 'NYC' : 'Westchester'} (zone ${state.zone})</dd>
      <dt>Supply</dt><dd>${stack ? esc(SUPPLY_MODES[stack.supply.mode]) : esc(SUPPLY_MODES[state.supply.mode])}${stack ? `, ${(stack.supply.avgEnergyRate * 100).toFixed(1)}¢/kWh avg, ${fmt$(stack.supply.capacityRate, 2)}/kW-mo avg` : ''}</dd>
      ${exportsOn(state.modality) ? `<dt>Value Stack</dt><dd>${{ value_stack: 'DRV kept', rider_t: 'Rider T instead of DRV', rider_ac: 'Rider AC instead of DRV' }[state.valueStack.election]}${state.programs.network ? `, ${esc(state.programs.network)}` : ''}</dd>` : ''}
      <dt>Programs</dt><dd>${enrolled.join(', ') || 'none'}${stack && stack.programs.network && enrolled.length ? ` at ${esc(stack.programs.network.name)}, ${fmtN(state.programs.pledgeKw)} kW` : ''}</dd>
      <dt>Load</dt><dd>${ftm ? 'none (stand-alone)' : load ? `${esc(load.label)}<br>${fmtN(s.annualKwh / 1000)} MWh, ${fmtN(s.peakKw)} kW peak` : 'not set'}</dd>
      <dt>Battery</dt><dd>${fmtN(B.kw)} kW / ${fmtN(B.kwh)} kWh, ${B.rte}% RTE, ${B.cycles || 'unlimited'} cycles/yr</dd>
    </dl></div>
    ${bill ? `<div class="card"><h4>Baseline annual bill</h4><div class="big">${fmt$(bill.total)}</div><dl>
      <dt>Energy</dt><dd>${fmt$(bill.energy)}</dd><dt>Demand</dt><dd>${fmt$(bill.demand)}</dd><dt>Fixed + tax</dt><dd>${fmt$(bill.fixed + bill.tax)}</dd>
      <dt>All-in</dt><dd>${(bill.total / s.annualKwh * 100).toFixed(1)}¢/kWh</dd></dl></div>` : ''}
    ${results ? `<div class="card"><h4>Last run</h4><div class="big ok">${fmt$(results.summary.savingsTotal)}</div><p class="note">annual ${results.stack.valueStack ? 'net benefit' : 'savings'}; <a href="#results" data-goto="results">see results</a></p></div>` : ''}
    ${err ? edition.railErrorHtml(err) : ''}`;
  rail.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); goTo(a.dataset.goto); }));
}

// ---------------------------------------------------------------- boot
async function boot() {
  const status = $('#status');
  $('#footnote').innerHTML = edition.FOOTER;
  try {
    await loadData();
    status.textContent = '';
    if (!STEP_SETS[state.modality]) state.modality = 'btm';
    if (stepId() === 'results') goToSilently('battery');
    // A link to another project or version opens it; otherwise (a reload of
    // the open version keeps any edits since) a hosted build brings back the
    // version open last time.
    const link = STORE.kind === 'server' ? readProjectHash(location.hash) : null;
    if (link && (link.id !== state.project.id || (link.rev && link.rev !== state.project.rev))) {
      openFromServer(link.id, link.rev).then((ok) => { if (!ok) resumeFromServer(); });
    } else { renderProject(); resumeFromServer(); }
    if (STORE.kind === 'server') window.addEventListener('hashchange', () => {
      const l = readProjectHash(location.hash);
      if (l && (l.id !== state.project.id || (l.rev && l.rev !== state.project.rev))) openFromServer(l.id, l.rev);
    });
    document.addEventListener('click', (e) => { if (e.target && e.target.id === 'runBtn') run(); });
    render();
  } catch (e) {
    status.textContent = 'Failed to load data';
    $('#panel').innerHTML = edition.loadFailedHtml(e);
  }
}
boot();
