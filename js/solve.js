// Run the dispatch LP in module workers (falls back to the main thread). Lane
// 0 is the worker every run uses; solveAll adds lanes for solves that can run
// side by side and closes them when it is done, since each holds its own HiGHS.
import { logWarn } from './edition.js';

const lanes = [];
let seq = 0;

function getWorker(lane) {
  if (lanes[lane]) return lanes[lane];
  const worker = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
  const L = { worker, pending: new Map() };
  worker.onmessage = (ev) => {
    const { id, ok, result, error } = ev.data;
    const p = L.pending.get(id); if (!p) return;
    L.pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  worker.onerror = (ev) => {
    for (const [, p] of L.pending) p.reject(new Error('solver worker failed: ' + (ev.message || 'unknown error')));
    L.pending.clear();
    if (lanes[lane] === L) lanes[lane] = null;
  };
  lanes[lane] = L;
  return L;
}

export async function solveDispatch(inputs, lane = 0) {
  if (typeof Worker !== 'undefined') {
    try {
      const L = getWorker(lane);
      return await new Promise((resolve, reject) => {
        const id = ++seq;
        L.pending.set(id, { resolve, reject });
        L.worker.postMessage({ id, inputs });
      });
    } catch (e) {
      logWarn('worker solve failed, falling back to the main thread:', e);
    }
  }
  const [{ default: loadHighs }, { solveScenario }] = await Promise.all([
    import('../vendor/highs/highs.mjs'), import('./lp.js'),
  ]);
  const highs = await loadHighs({ locateFile: (f) => new URL('../vendor/highs/' + f, import.meta.url).href });
  return solveScenario(highs, inputs);
}

// Solve every LP in `list`, `lanes` at a time, in the order of `list`;
// `onSolved(i, result)` as each one finishes.
export async function solveAll(list, { lanes: n = 1, onSolved } = {}) {
  const out = new Array(list.length);
  let next = 0;
  const lane = async (k) => {
    while (next < list.length) {
      const i = next++;
      try { out[i] = await solveDispatch(list[i], k); } catch (e) { next = list.length; throw e; }
      if (onSolved) onSolved(i, out[i]);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, list.length)) }, (_, k) => lane(k)));
  } finally {
    for (let k = 1; k < lanes.length; k++) {
      const L = lanes[k]; if (!L) continue;
      lanes[k] = null;
      L.worker.terminate();
      for (const [, p] of L.pending) p.reject(new Error('solver lane closed'));
    }
  }
  return out;
}
