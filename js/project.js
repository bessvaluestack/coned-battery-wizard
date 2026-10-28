// A project: one battery analysis with a stable identity. The id follows it
// into the project file, the results JSON and the pro-forma's Wizard_Import
// sheet, so the financial model can always tell which analysis (and which
// configuration of it, by the fingerprint) its numbers came from.

export const APP_VERSION = '0.4.0';
export const PROJECT_FORMAT = 'coned-battery-wizard/project';
export const PROJECT_FILE_VERSION = 1;

const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

export function newProject(name = '') {
  const now = new Date().toISOString();
  return { id: uuid(), name, created: now, updated: now };
}

// A short, stable fingerprint of a configuration (FNV-1a over its JSON with
// sorted keys): the same inputs always give the same value.
export function fingerprint(value) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const text = JSON.stringify(canon(value));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export const fileSlug = (name) => (name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';

/**
 * The project file: the wizard's inputs (everything but the open step), and
 * an uploaded interval profile when there is one (it is not kept in the
 * browser otherwise).
 */
export function projectFile(state, upload = null) {
  const { step, ...inputs } = state;
  return {
    format: PROJECT_FORMAT, version: PROJECT_FILE_VERSION, app: APP_VERSION, saved: new Date().toISOString(),
    project: state.project, inputs,
    upload: upload ? { name: upload.name, meta: upload.meta, kw: Array.from(upload.kw, (v) => Math.round(v * 1000) / 1000) } : null,
  };
}

// Parse and check a project file; throws a message the user can act on.
export function readProjectFile(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error('This is not a project file (it is not JSON).'); }
  return readProjectDoc(doc);
}

export function readProjectDoc(doc) {
  if (!doc || doc.format !== PROJECT_FORMAT) throw new Error('This is not a Con Edison Battery Wizard project file.');
  if (!(doc.version <= PROJECT_FILE_VERSION)) throw new Error(`This project file is from a newer version of the wizard (file version ${doc.version}).`);
  if (!doc.project || !doc.project.id || !doc.inputs) throw new Error('The project file is incomplete.');
  const upload = doc.upload && Array.isArray(doc.upload.kw) ? { name: doc.upload.name, meta: doc.upload.meta, kw: Float64Array.from(doc.upload.kw) } : null;
  return { project: doc.project, inputs: doc.inputs, upload, app: doc.app, saved: doc.saved, run: doc.run || null };
}

// A run kept with a project (hosted builds): the dispatch, from which the
// results page, the charts and the downloads are rebuilt without solving
// again, the capacity curve as it was solved, and the headline numbers for
// lists. Flows are rounded to 0.1 W, which keeps the rebuilt bills within a
// few cents.
const r3 = (a) => Array.from(a, (v) => Math.round(v * 1e4) / 1e4);
export function runSnapshot(R, ratesDate) {
  const s = R.sol;
  return {
    version: 1, app: APP_VERSION, ratesDate, runAt: R.runAt, config: R.config, elapsedMs: Math.round(R.elapsedMs || 0),
    summary: { net: R.summary.savingsTotal, billSavings: R.summary.savingsBill, programs: R.summary.programRevenue, credits: R.summary.creditsTotal || 0, cycles: R.summary.cycles },
    sol: {
      imp: r3(s.imp), exp: r3(s.exp), ch: r3(s.ch), dis: r3(s.dis), soc: r3(s.soc),
      programs: (s.programs || []).map((p) => ({ id: p.id, D: p.D, r: Object.fromEntries(Object.entries(p.r).map(([t, v]) => [t, Math.round(v * 1e4) / 1e4])) })),
      cycleInfo: s.cycleInfo || null, alt3Kw: s.alt3Kw || 0, dropped: s.dropped || null, timing: s.timing || null, status: s.status, objective: s.objective,
    },
    billOnly: R.billOnlySol ? { imp: r3(R.billOnlySol.imp) } : null,
    alternative: R.alternative ? { net: R.alternative.net, billTotal: R.alternative.billTotal, credits: { totals: R.alternative.credits.totals, total: R.alternative.credits.total, alt3Kw: R.alternative.credits.alt3Kw } } : null,
    curve: R.curve || null,
  };
}

// The dispatch of a kept run, as the solver returns it.
export function solFromSnapshot(snap) {
  const f = (a) => Float64Array.from(a);
  const s = snap.sol;
  return { ...s, imp: f(s.imp), exp: f(s.exp), ch: f(s.ch), dis: f(s.dis), soc: f(s.soc), peaks: [], washIntervals: [] };
}

// A project link (hosted builds): the site address with the project and,
// for one exact version, its number in the fragment, which never reaches
// the server's logs: #project=<id>&version=<n>.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const projectHash = (id, rev = null) => `#project=${id}${rev ? `&version=${rev}` : ''}`;
export function readProjectHash(hash) {
  const h = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const id = h.get('project'), rev = parseInt(h.get('version'), 10);
  if (!id || !UUID_RE.test(id)) return null;
  return { id, rev: rev > 0 ? rev : null };
}
