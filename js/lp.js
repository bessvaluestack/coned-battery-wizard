// Dispatch LP in CPLEX LP text for HiGHS. Battery sizes are fixed (the user
// sets them), so the problem is a pure dispatch LP over the whole year:
//
//   min  sum_t price_t * imp_t * dt          (delivery + supply energy, taxed)
//      + sum_k rate_k * pk_k                 (every $/kW-month determinant:
//                                             delivery demand windows, SBC
//                                             demand, supply capacity)
//      + c_thr * dt * sum_t dis_t            (optional throughput cost)
//      - sum_p [ resValue_p * D_p + perf_p * dt * sum_{t in perf} r_{p,t} ]
//      - sum_t xprice_t * exp_t * dt          (Value Stack energy (+ DRV) credit)
//      - alt3 * X - lsrv * sum_e F_e          (capacity and locational relief)
//   s.t. imp_t - exp_t - ch_t + dis_t = load_t                (exp = 0 without the Value Stack)
//        soc_{t+1} = soc_t + (eta_c ch_t - dis_t / eta_d) dt, cyclic
//        0 <= ch, dis <= P ; 0 <= soc <= E_usable
//        imp (or the half-hour average) <= pk_k for every interval in window k
//        sum_t dis_t dt <= cycles_per_year * E_nameplate
//        programs: r <= load_t - imp_t + exp_t, r <= pledge, mean_e(r) >= D, D <= pledge
//        Value Stack: exp_t - imp_t >= X on the Alternative 3 commitment hours,
//        exp_t - imp_t >= F_e in each LSRV event, exp_t <= dis_t and no charging
//        in the DRV window (no grid pass-through)
//
// Same formulation as the reference engine's app/optimizer/model.py with the
// sizes pinned. Exports only exist on the Value Stack (Rider R A.9(d)). The
// export credit is capped just below the import price outside the DRV window
// (`exports.price` comes in capped), so the LP never buys and sells in the
// same interval; inside the window the cap does not hold and the caller fixes
// each interval to import or export (see solveScenario).

function f6(x) { return (Math.abs(x) < 5e-7 ? 0 : x).toFixed(6); }

export function buildLP(inp) {
  const { load, price, peakTerms, battery, dt, demandIntervalMin, programs, taxFactor } = inp;
  const X = inp.exports || null;
  const T = load.length;
  const P = +battery.kw, E = +battery.kwh;
  const eta = Math.sqrt(+battery.rte);
  const usable = E * (+battery.usableFrac);
  const cycles = +battery.cyclesPerYear;
  const thr = +battery.throughputCost || 0;
  const tax = taxFactor || 1;
  const out = [];
  const push = (s) => out.push(s);

  // ---- objective ------------------------------------------------------
  push('Minimize');
  let line = ' obj:';
  let n = 0;
  const term = (coef, name) => {
    if (coef === 0) return;
    line += (coef < 0 ? ' - ' : ' + ') + f6(Math.abs(coef)) + ' ' + name;
    if (++n % 12 === 0) { push(line); line = ' '; }
  };
  for (let t = 0; t < T; t++) term(price[t] * dt * tax, 'i' + t);
  if (X) {
    for (let t = 0; t < T; t++) term(-X.price[t] * dt, 'e' + t);
    if (X.alt3 && X.alt3.intervals.length) term(-X.alt3.rate, 'X');
    if (X.lsrv) X.lsrv.events.forEach((ev, k) => term(-X.lsrv.perEvent, 'F' + k));
  }
  if (thr > 0) for (let t = 0; t < T; t++) term(thr * dt, 'd' + t);
  peakTerms.forEach((k, j) => term(k.rate * tax, 'p' + j));
  if (programs) programs.forEach((pg, pi) => {
    term(-pg.reservationValuePerKw, 'D' + pi);
    const perf = pg.performanceIntervals || pg.allIntervals;
    if (pg.performanceRate > 0) for (const t of perf) term(-pg.performanceRate * dt, `r${pi}_${t}`);
  });
  if (line.trim() !== '') push(line);

  // ---- constraints ----------------------------------------------------
  push('Subject To');
  const ec = f6(eta * dt), ed = f6(dt / eta);
  for (let t = 0; t < T; t++) {
    push(` b${t}: i${t}${X ? ` - e${t}` : ''} - c${t} + d${t} = ${f6(load[t])}`);
    const nx = (t + 1) % T;
    push(` s${t}: s${nx} - s${t} - ${ec} c${t} + ${ed} d${t} = 0`);
  }
  peakTerms.forEach((k, j) => {
    const pos = k.idx;
    if (demandIntervalMin === 30) {
      for (let i = 0; i < pos.length; i++) {
        const t = pos[i];
        if (t % 2 !== 0 || t + 1 >= T) continue;
        push(` k${j}_${t}: 0.5 i${t} + 0.5 i${t + 1} - p${j} <= 0`);
      }
    } else {
      for (let i = 0; i < pos.length; i++) push(` k${j}_${pos[i]}: i${pos[i]} - p${j} <= 0`);
    }
  });
  // annual throughput cap
  if (cycles > 0 && E > 0) {
    line = ' cyc:'; n = 0;
    for (let t = 0; t < T; t++) {
      line += ' + ' + f6(dt) + ' d' + t;
      if (++n % 16 === 0) { push(line); line = ' '; }
    }
    push(line + ` <= ${f6(cycles * E)}`);
  }
  if (X) {
    for (const t of X.leDis) push(` x${t}: e${t} - d${t} <= 0`);
    if (X.alt3) for (const t of X.alt3.intervals) push(` a${t}: e${t} - i${t} - X >= 0`);
    if (X.lsrv) X.lsrv.events.forEach((ev, k) => { for (const t of ev) push(` l${k}_${t}: e${t} - i${t} - F${k} >= 0`); });
  }
  if (programs) programs.forEach((pg, pi) => {
    for (const t of pg.allIntervals) push(` pr${pi}_${t}: r${pi}_${t} + i${t}${X ? ` - e${t}` : ''} <= ${f6(load[t])}`);
    pg.events.forEach((ev, ei) => {
      const coef = f6(1 / ev.intervals.length);
      let l = ` pe${pi}_${ei}:`;
      for (const t of ev.intervals) l += ` + ${coef} r${pi}_${t}`;
      push(l + ` - D${pi} >= 0`);
    });
  });

  // ---- bounds ---------------------------------------------------------
  push('Bounds');
  const zero = (list) => { const m = new Uint8Array(T); if (list) for (const t of list) m[t] = 1; return m; };
  const noCh = zero(X && X.noCharge), noImp = zero(X && X.fixImportZero), noExp = zero(X && X.fixExportZero);
  for (let t = 0; t < T; t++) {
    push(` c${t} <= ${noCh[t] ? '0' : f6(P)}`);
    push(` d${t} <= ${f6(P)}`);
    push(` s${t} <= ${f6(usable)}`);
    if (noImp[t]) push(` i${t} <= 0`);
    if (X && noExp[t]) push(` e${t} <= 0`);
  }
  if (X && X.alt3) push(` X <= ${f6(P)}`);
  if (X && X.lsrv) X.lsrv.events.forEach((ev, k) => push(` F${k} <= ${f6(P)}`));
  if (programs) programs.forEach((pg, pi) => {
    for (const t of pg.allIntervals) push(` r${pi}_${t} <= ${f6(pg.pledgeKw)}`);
    push(` D${pi} <= ${f6(pg.pledgeKw)}`);
  });
  push('End');
  return out.join('\n');
}

// Two-stage solve: the annual cycle row couples every interval and makes the
// simplex several times slower, so solve without it first and only add the
// cap when the free dispatch overshoots the budget. The capped solve's row
// dual is the marginal value of one more kWh of annual discharge budget.
// `capped` (an earlier solve of the same year found the cap binding, with
// its uncapped throughput) goes straight to the capped LP.
export function solveWithCycleCap(highs, inputs, opts = { output_flag: false }, capped = null) {
  const cap = +inputs.battery.cyclesPerYear || 0;
  const E = +inputs.battery.kwh || 0;
  const timing = {};
  const dt = inputs.dt;
  const sumDis = (r) => { let s = 0; for (let t = 0; t < r.dis.length; t++) s += r.dis[t]; return s * dt; };
  let t0 = performance.now(), thr1;
  if (capped && cap > 0 && E > 0) {
    thr1 = capped.uncappedThroughputKwh;
  } else {
    const free = { ...inputs, battery: { ...inputs.battery, cyclesPerYear: 0 } };
    const lp1 = buildLP(free);
    const sol1 = highs.solve(lp1, opts);
    if (sol1.Status !== 'Optimal') throw new Error(`solver status ${sol1.Status}`);
    const r1 = extractSolution(sol1, free);
    timing.uncappedMs = performance.now() - t0;
    thr1 = sumDis(r1);
    r1.cycleInfo = { capped: false, binding: false, throughputKwh: thr1, capKwh: cap * E, marginalUsdPerKwh: 0 };
    r1.timing = timing;
    if (!(cap > 0 && E > 0 && thr1 > cap * E * 1.0005)) return r1;
  }
  t0 = performance.now();
  const lp2 = buildLP(inputs);
  const sol2 = highs.solve(lp2, opts);
  if (sol2.Status !== 'Optimal') throw new Error(`solver status ${sol2.Status}`);
  const r2 = extractSolution(sol2, inputs);
  timing.cappedMs = performance.now() - t0;
  const row = (sol2.Rows || []).find((r) => r.Name === 'cyc');
  r2.cycleInfo = { capped: true, binding: sumDis(r2) >= cap * E * 0.9995, throughputKwh: sumDis(r2), capKwh: cap * E, uncappedThroughputKwh: thr1,
    marginalUsdPerKwh: row && typeof row.Dual === 'number' ? Math.max(0, -row.Dual) : null };
  r2.timing = timing;
  return r2;
}

// The full solve: the cycle-capped LP, and where the export credit can beat
// the import price (the DRV window of a battery behind a building's meter)
// a second pass with each such interval fixed to the side the first pass
// netted to. The meter only sees the net, so a first-pass interval that both
// imports and exports is not a dispatch the credits would pay; fixed, the
// second pass is exact, and the first-pass dispatch stays feasible in it.
// When every input is constant within each hour (a stand-alone battery: no
// load, hourly prices, hour-aligned windows) the hourly LP is exact: averaging
// a 15-minute dispatch over each hour keeps energy, cost and every window
// constraint and never raises a peak. It is a quarter of the size, so solve
// that and lay the result back onto the 15-minute index.
//
// Behind a building's meter the load moves within the hour, so the hourly LP
// is not exact; but the first of the two passes (see solveExact) only picks
// each DRV-window interval's side, so it runs on the hourly average and the
// exact 15-minute pass follows. Should that pass be infeasible, both passes
// run at 15 minutes.
export function solveScenario(highs, inputs, opts) {
  const hourly = toHours(inputs);
  if (hourly) {
    const t0 = performance.now();
    const r = fromHours(solveExact(highs, hourly, opts), inputs);
    r.timing = { ...r.timing, hourly: true, hourlyMs: performance.now() - t0 };
    return r;
  }
  if (inputs.exports && inputs.exports.washCheck) {
    try {
      return solveTwoPass(highs, inputs, opts);
    } catch (e) {
      if (!/Infeasible/.test(e.message)) throw e;
    }
  }
  return solveExact(highs, inputs, opts);
}

// A solve that drops the Alternative 3 and LSRV commitments when the battery
// cannot hold them (the LP is infeasible) and says so.
function solveDropping(highs, inputs, opts, capped) {
  try {
    const r = solveWithCycleCap(highs, inputs, opts, capped);
    r.inputs = inputs;
    return r;
  } catch (e) {
    const X0 = inputs.exports;
    if (!X0 || !(X0.alt3 || X0.lsrv) || !/Infeasible/.test(e.message)) throw e;
    inputs = { ...inputs, exports: { ...X0, alt3: null, lsrv: null, dropped: [...(X0.dropped || []), 'The capacity and LSRV commitments could not be held with this battery and were dropped.'] } };
    const r = solveWithCycleCap(highs, inputs, opts, capped);
    r.dropped = inputs.exports.dropped;
    r.inputs = inputs;
    return r;
  }
}

// The fixed second pass: each DRV-window interval to the side `exporting(t)` says.
function fixedPass(highs, inputs, opts, exporting, capped) {
  const X = inputs.exports, fixImportZero = [], fixExportZero = [];
  for (const t of X.washCheck) (exporting(t) ? fixImportZero : fixExportZero).push(t);
  return solveWithCycleCap(highs, { ...inputs, exports: { ...X, fixImportZero: Int32Array.from(fixImportZero), fixExportZero: Int32Array.from(fixExportZero) } }, opts, capped);
}

function solveTwoPass(highs, inputs, opts) {
  const t0 = performance.now();
  const approx = toHours(inputs, true);
  const r1 = solveDropping(highs, approx, opts);
  const firstMs = performance.now() - t0;
  // With the cycle cap binding, sides fixed from hourly averages can leave the
  // capped 15-minute LP barely feasible (slow, and worse): use both 15-minute passes.
  if (r1.cycleInfo.binding) {
    const r = solveExact(highs, inputs, opts, r1.cycleInfo);
    r.timing = { ...r.timing, hourlyProbeMs: firstMs };
    return r;
  }
  const S = stepsPerHour(inputs), P = +inputs.battery.kw;
  // Export where the hour netted to an export and the interval's load is
  // within the battery's power; import everywhere else.
  const exporting = (t) => { const h = Math.floor(t / S); return r1.dis[h] - r1.ch[h] > approx.load[h] + 1e-6 && inputs.load[t] < P - 1e-6; };
  const pass2 = r1.dropped ? { ...inputs, exports: { ...inputs.exports, alt3: null, lsrv: null, dropped: r1.dropped } } : inputs;
  const r2 = fixedPass(highs, pass2, opts, exporting, r1.cycleInfo.binding ? r1.cycleInfo : null);
  r2.timing = { ...r2.timing, firstPassMs: firstMs, firstPassHourly: true };
  r2.dropped = r1.dropped;
  return r2;
}

const stepsPerHour = (inp) => Math.round(1 / inp.dt);

// The hourly LP inputs, or null if any series varies within an hour or any
// interval set covers part of an hour.
// With `approximate`, the load (and any series) is averaged over the hour
// instead: for a first pass only.
export function toHours(inp, approximate = false) {
  const S = stepsPerHour(inp), T = inp.load.length;
  if (S <= 1 || T % S) return null;
  const H = T / S;
  const flat = (a) => {
    if (!a || typeof a === 'number') return true;
    for (let h = 0; h < H; h++) for (let k = 1; k < S; k++) if (Math.abs(a[h * S + k] - a[h * S]) > 1e-9) return false;
    return true;
  };
  const X = inp.exports;
  if (!approximate && (!flat(inp.load) || !flat(inp.price) || (X && !flat(X.price)))) return null;
  let partial = false;
  const hours = (list) => {
    if (!list) return list;
    const n = new Map();
    for (const t of list) { const h = Math.floor(t / S); n.set(h, (n.get(h) || 0) + 1); }
    for (const c of n.values()) if (c !== S) partial = true;
    return Int32Array.from([...n.keys()].sort((a, b) => a - b));
  };
  const every = (a) => Float64Array.from({ length: H }, (_, h) => { let v = 0; for (let k = 0; k < S; k++) v += a[h * S + k]; return v / S; });
  const out = {
    ...inp, load: every(inp.load), price: every(inp.price), dt: inp.dt * S, demandIntervalMin: 15,
    peakTerms: inp.peakTerms.map((k) => ({ ...k, idx: hours(k.idx) })),
    programs: inp.programs && inp.programs.map((pg) => ({ ...pg, allIntervals: hours(pg.allIntervals), performanceIntervals: hours(pg.performanceIntervals), events: pg.events.map((e) => ({ intervals: hours(e.intervals) })) })),
    exports: X && {
      ...X, price: every(X.price), leDis: hours(X.leDis), noCharge: hours(X.noCharge), fixImportZero: hours(X.fixImportZero), fixExportZero: hours(X.fixExportZero), washCheck: hours(X.washCheck),
      alt3: X.alt3 && { ...X.alt3, intervals: hours(X.alt3.intervals) }, lsrv: X.lsrv && { ...X.lsrv, events: X.lsrv.events.map(hours) },
    },
  };
  return partial && !approximate ? null : out;
}

// An hourly solution on the 15-minute index: flows repeat within the hour,
// the state of charge moves linearly between hour starts.
export function fromHours(r, inp) {
  const S = stepsPerHour(inp), T = inp.load.length, H = T / S;
  const rep = (a) => Float64Array.from({ length: T }, (_, t) => a[Math.floor(t / S)]);
  const soc = Float64Array.from({ length: T }, (_, t) => { const h = Math.floor(t / S), f = (t % S) / S; return r.soc[h] + f * (r.soc[(h + 1) % H] - r.soc[h]); });
  const spread = (byHour) => { const o = {}; for (const [h, v] of Object.entries(byHour)) for (let k = 0; k < S; k++) o[+h * S + k] = v; return o; };
  return {
    ...r, imp: rep(r.imp), exp: rep(r.exp), ch: rep(r.ch), dis: rep(r.dis), soc,
    programs: r.programs.map((p) => ({ ...p, r: spread(p.r) })),
    washIntervals: r.washIntervals.flatMap((h) => Array.from({ length: S }, (_, k) => h * S + k)),
  };
}

function solveExact(highs, inputs, opts, capped = null) {
  const r1 = solveDropping(highs, inputs, opts, capped);
  inputs = r1.inputs;
  delete r1.inputs;
  const X = inputs.exports;
  if (!X || !X.washCheck || !r1.washIntervals.length) return r1;
  const r2 = fixedPass(highs, inputs, opts, (t) => r1.dis[t] - r1.ch[t] >= inputs.load[t], r1.cycleInfo.binding ? r1.cycleInfo : null);
  r2.timing = { ...r2.timing, firstPassMs: (r1.timing.uncappedMs || 0) + (r1.timing.cappedMs || 0), firstPassWash: r1.washIntervals.length };
  r2.dropped = r1.dropped;
  return r2;
}

// Pull the dispatch out of a HiGHS solution object (highs.solve() result).
export function extractSolution(sol, inp) {
  const T = inp.load.length;
  const cols = sol.Columns;
  const imp = new Float64Array(T), exp = new Float64Array(T), ch = new Float64Array(T), dis = new Float64Array(T), soc = new Float64Array(T);
  const get = (name) => { const c = cols[name]; return c ? c.Primal : 0; };
  const wash = [];
  for (let t = 0; t < T; t++) {
    imp[t] = Math.max(0, get('i' + t)); ch[t] = Math.max(0, get('c' + t));
    dis[t] = Math.max(0, get('d' + t)); soc[t] = Math.max(0, get('s' + t));
    if (inp.exports && imp[t] > 1e-6 && get('e' + t) > 1e-6) wash.push(t);
  }
  // LP netting cleanup: remove residual simultaneous charge/discharge; the
  // meter sees only the net, so import and export follow from it.
  for (let t = 0; t < T; t++) {
    const both = Math.min(ch[t], dis[t]);
    if (both > 0) { ch[t] -= both; dis[t] -= both; }
    const net = inp.load[t] + ch[t] - dis[t];
    imp[t] = Math.max(0, net);
    exp[t] = inp.exports ? Math.max(0, -net) : 0;
  }
  const peaks = inp.peakTerms.map((k, j) => get('p' + j));
  const programs = (inp.programs || []).map((pg, pi) => {
    const r = {};
    for (const t of pg.allIntervals) r[t] = Math.max(0, get(`r${pi}_${t}`));
    return { id: pg.id, D: Math.max(0, get('D' + pi)), r };
  });
  return { status: sol.Status, objective: sol.ObjectiveValue, imp, exp, ch, dis, soc, peaks, programs,
    alt3Kw: inp.exports && inp.exports.alt3 ? Math.max(0, get('X')) : 0, washIntervals: wash };
}
