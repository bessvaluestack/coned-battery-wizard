// The capacity curve: the year solved again with less usable energy, so the
// financial model can follow degradation, replacement and augmentation
// without another run. Each level is a full re-optimisation of the bill, the
// programs and the Value Stack together; power, round-trip efficiency and the
// annual cycle limit (counted on nameplate kWh, as warranties count it) stay
// as set.
import { billFor, programRevenue, summarize, monthlyBillChange, programsByMonth } from './model.js';
import { valueStackCredits } from './valuestack.js';

export const CURVE_LEVELS = [1, 0.9, 0.8, 0.7, 0.6];
export const pctOf = (level) => Math.round(level * 100);

// The battery with `level` of its usable energy.
export const atLevel = (battery, level) => ({ ...battery, usableFrac: battery.usableFrac * level });

// One level's Year 1 streams, split the way the pro-forma's cash flow carries
// them: demand savings, energy savings at the battery account's rates,
// program revenue, export credits (energy + DRV), capacity credits
// (Alternative 3 + LSRV), and the account change (fixed charges and a move to
// standby rates), which does not depend on the battery's energy.
export function curvePoint({ level, stack, baseStack = stack, load, battery, inp, sol, baseline, programMonths = {} }) {
  const b = atLevel(battery, level);
  const withB = billFor(stack, sol.imp);
  const revenue = programRevenue(stack, inp, sol);
  const credits = stack.valueStack ? valueStackCredits(stack.valueStack, sol.imp, sol.exp) : null;
  const S = summarize(stack, load, b, baseline, withB, null, inp, sol, revenue, credits);
  const { utility } = monthlyBillChange({ stack, baseStack, load, sol, baseline, withB, monthly: S.monthly });
  const { programs } = programsByMonth(revenue, programMonths);
  const sum = (k) => utility.reduce((a, u) => a + u[k], 0);
  const c = credits || { totals: { energy: 0, drv: 0, alt3: 0, lsrv: 0 } };
  const creditsIn = (m) => (credits ? credits.energy[m] + credits.drv[m] + credits.alt3[m] + credits.lsrv[m] : 0);
  return {
    level, usableKwh: b.kwh * b.usableFrac,
    demand: sum('demandSav'), energy: sum('energySav') - sum('rateChange'), programs: revenue.total,
    exportCredits: c.totals.energy + c.totals.drv, capacityCredits: c.totals.alt3 + c.totals.lsrv, accountChange: sum('fixedChange') + sum('rateChange'),
    net: S.savingsTotal, cycles: S.cycles, alt3Kw: credits ? credits.alt3Kw : 0,
    monthlyNet: utility.map((u, m) => u.billSav + programs[m].total + creditsIn(m)),
  };
}

// The curve from one point per level, the first at full capacity (the run
// itself), with each stream's share of its full-capacity value: Year n's
// stream is its Year 1 value times the share at Year n's capacity. A stream
// that is zero at full capacity keeps a share of 1.
export function capacityCurve(points) {
  const full = points[0];
  const ratio = (v, v0) => (Math.abs(v0) > 1e-6 ? v / v0 : 1);
  const vs = (p) => p.exportCredits + p.capacityCredits + p.accountChange;
  return {
    levels: points.map((p) => ({
      ...p, netShare: ratio(p.net, full.net), demandShare: ratio(p.demand, full.demand), energyShare: ratio(p.energy, full.energy),
      programsShare: ratio(p.programs, full.programs), vsShare: ratio(vs(p), vs(full)),
    })),
  };
}
