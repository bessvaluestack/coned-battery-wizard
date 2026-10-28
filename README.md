# Con Edison Battery Wizard

A static, browser-only wizard that models a battery in Con Edison territory
and reports its annual value, in three modalities:

- **Behind the meter, no export**: a large building on **Service
  Classification 8 (Multiple Dwellings, Redistribution)** or **9 (General -
  Large)**, bill savings plus Rider T / Rider AC demand response.
- **Behind the meter, exporting under the Value Stack**: the same building,
  with the battery's net hourly injections credited under Rider R A.9(d)
  with SC 11 buy-back service.
- **Front of the meter (stand-alone), Value Stack**: a battery with its own
  account (SC 2, SC 9, or SC 9 standby) and no load, charging from and
  exporting to the grid.

No backend: the tariff engine, supply model, program and Value Stack terms
and the dispatch optimisation (HiGHS compiled to WebAssembly) all run in the
page, so it deploys to GitHub Pages or as a claude.ai artifact as-is. It
started as a copy of the earlier SC 8 Battery Wizard.

Inputs are compiled from the Con Edison P.S.C. No. 10 tariff corpus by an
upstream tariff model (the reference engine); `scripts/export_data.py` is the
one-time bridge (see *Data*).

## The wizard

The steps follow the modality: a stand-alone battery has no Load step, and
the Value Stack modalities pick an election instead of the riders.

0. **Modality**: the three project types and an outline of what each needs
   (account and tariff, exports, revenue, demand response, interconnection,
   metering, permits and incentives, what is not available).
1. **Rate** (**Site** for a stand-alone battery): the building's service
   class and rate, SC 8 Rate I / II / III or SC 9 Rate I to V (Rates IV and
   V for a building already on standby, for example with on-site
   generation), or the battery's own account, which follows its power
   rating: SC 2 up to 10 kW, SC 9 Rate I or III on standard rates up to 1 MW
   (storage is a Designated Technology, General Rule 20.3.2(b)), SC 9
   standby Rate IV / V above (Rate V above 1,500 kW of contract demand).
   Behind the meter with exports the building stays on its standard rate
   unless the battery is above 1 MW and above 15% of the building's peak
   (then standby in the same class). Flags a rate the building's peak does
   not fit (Rate II is mandatory above 1,500 kW; Rate IV / V by contract
   demand). Low or high tension, NYC or Westchester,
   15-minute (default) or 30-minute billing demand, delivery $/kWh
   adjustments (SBC, MAC, RDM, SDR) and the SBC demand surcharge, a
   tax/surcharge percentage.
2. **Supply**: Con Edison full service (observed Market Supply Charge by
   billing period + MSC capacity $/kW-month), Con Edison Rider M hourly
   pricing (zonal day-ahead LBMP + ICAP tag), third-party fixed $/kWh, or
   third-party LBMP + adder.
   Rider M is forced where it is mandatory (standby customers, and Value
   Stack storage above 115% of the on-site load, so always in front of the
   meter); with the Value Stack its capacity tag is priced on the import in
   the likely NYISO peak hours.
3. **Riders** (no export): Rider T CSRP and DLRP (rates in the tariff, keyed
   on the site's distribution network: Contracted Hours, county group, DLRP
   tier) and Rider AC Term-DLM or Auto-DLM (pay-as-bid, rates entered), in
   the tariff's combinations only. Pledge, participation and events per
   season are scenario inputs.
   **Value Stack** (exports): the network (its CSRP call window sets the
   DRV hours), the election (keep the DRV and LSRV; or Rider T CSRP / DLRP,
   which ends them for good; or Rider AC Term- / Auto-DLM, which suspends
   them for the contract; a Rider R customer is paid the reservation only),
   LSRV where the location has MW left, and the Alternative 3 commitment
   band (hours, days, optional rate override).
4. **Load** (behind the meter): four preset 35,040-interval profiles, an estimate scaled from the
   bills (an annual total, by bisection on the modelled bill, or twelve
   calendar-month bills, each month of the shape scaled on its own; boxes
   start at the shape's modelled bills, sliders run 50% to 200% of them), or
   an uploaded interval CSV (ISO or US timestamps, or Green Button date + time
   columns; kW or kWh; any interval 5 to 60 min).
5. **Battery**: kW, kWh, round-trip efficiency, usable depth, annual cycle
   limit, optional throughput cost and installed cost (k$), and the capacity
   curve for degradation (on by default). Warns when the battery cannot
   carry one full program event at the pledged kW (usable kWh below pledge x
   event hours / discharge efficiency, or kW below the pledge).
6. **Results**: annual savings (bill savings + program revenue), the bill by
   component before and after, monthly peaks, a week of dispatch with state
   of charge, assumptions and provenance, JSON / CSV export, and the owner
   pro-forma (XLSX, below). CSRP or DLRP delivering under 80% of the pledge
   (weakest event) is flagged. With the Value Stack: the annual net benefit,
   the credits by component and month (energy, Alternative 3, DRV, LSRV),
   the account's bill, and for a Rider T / Rider AC election what keeping
   the DRV and LSRV would have earned (a second solve). The capacity curve:
   the year again at 90, 80, 70 and 60% of the usable energy.

## Projects

One project at a time (`js/project.js`): a name and a stable project ID in
the header, kept in the browser with the inputs. **Save project** downloads
a project file (`<name>.coned-battery.json`: format, version, the project,
every input, and an uploaded interval profile if there is one); **Open
project** loads one back; **New project** starts over with a new ID. The
project ID, a fingerprint of the configuration (it changes whenever an
input does) and the run time go into the results JSON and the pro-forma's
Wizard_Import sheet, so the financial model can always tell which analysis
its numbers came from. The hosted version keeps projects, their versions and their
runs on a server (see *Hosted version*).

## Hosted version (saved runs and versions)

This build keeps a project in the browser and in files the user saves:
the inputs, not the results. **coned-battery-wizard-hosted** runs the same
app (this repo as a submodule) on a server, with `js/store.js` replaced by
one that keeps every save as a version on the server, the last run
included, so a project opens straight back to its results. Saving and
restoring a run is in this repo (`runSnapshot` / `solFromSnapshot` in
`js/project.js`, `restoreRun` in `js/app.js`), off unless the store says
`runs: true`.

Project links (hosted builds): `<site>#project=<id>&version=<n>` opens that
version with its inputs and run (without `&version`, the latest). The
address bar always shows the open version's link; **Copy link** in the
header, and one on each row of **Versions**, copy it. A run's pro-forma
carries the version that holds it and both links (Wizard_Import, *saved
analysis*), so the workbook points back to the exact saved analysis. The
link is in the fragment, which never reaches the server's logs; reloading
the open version keeps any edits made since.

## Owner pro-forma (XLSX)

The wizard writes two places only: a protected **Wizard_Import** sheet and
the 8,760 hourly rows. Wizard_Import (`js/wizardsheet.js` defines the layout,
the interface between the wizard and the financial model: add rows or
blocks, never move a cell) holds the project (ID, name, configuration
fingerprint, run time, wizard version, rates date, modality, account,
supply, programs, load), the battery (the source of truth: kW, kWh,
efficiency, usable share, cycle limit, Year 1 cycles), the Year 1 summary,
the monthly bill baseline and with the battery (kWh, billing peaks, demand,
energy and fixed $, effective $/kW and $/kWh, savings), program revenue by
program and month with each program's terms, Value Stack credits by month,
every demand determinant and rate by charge and month, energy by component,
and the capacity curve (each stream's Year 1 value at 100, 90, 80, 70 and
60% of the usable energy with its share of the full-capacity value, and the
net benefit by month at each level), and on the hosted site the saved
version holding the run, its link (with an "Open this version in the
wizard" cell) and the project's. The model's battery cells (Inputs C9:C10, C14, C16:C21, C23),
savings cells (Value_Streams C:D, G, K, M:N) and rates (Utility_Rates C, F:J)
are green links to it, so the battery is set in the wizard only.

`templates/proforma.xlsx` is the owner's multifamily storage workbook with a
program revenue stream and Value Stack streams added; the results page fills
it in the browser for all three modalities (`js/proforma.js`, zip handling by
the vendored `fflate`, MIT):

- Hourly_Operations: baseline and dispatch as hourly averages of the run
  (positive = discharge, net of charging, so baseline minus dispatch is the
  hour's net grid demand), the hour's all-in energy rate, taxes included,
  and with exports the credit per exported kWh (L: LBMP x losses, plus the
  DRV in the call window) and the hour's export credit (K).
- Value_Streams: the run's 15-minute billing peaks, demand savings (every
  demand window, SBC and supply capacity) and program revenue by month; the
  workbook's own formulas give arbitrage savings, which match the run. With
  exports: export credits (L, summed from the hourly sheet), Alternative 3
  and LSRV (M), and the account change (N: a stand-alone battery's customer
  charge, or the energy-rate change when the battery moves the building to
  standby). Project_Cash_Flow carries them as a Value Stack credits column,
  Outputs as a Year 1 row.
- Inputs C14 flags Value Stack exports: grid-export hours are then expected
  instead of invalid.
- Degradation: Project_Cash_Flow P is the usable energy left each year
  (Inputs C24, the annual degradation, compounding from Year 1; a
  replacement year in C26 restores it from the next year), and Q:T each
  stream's share at that capacity, interpolated on Wizard_Import's capacity
  curve (held at the lowest level below it). Demand, energy, program and
  Value Stack columns D:G take the share. With no degradation entered, or no
  curve in the import, the shares are 100% and savings hold at Year 1.
- Utility_Rates: effective monthly rates for its readiness checks and bill
  reconciliation, and the monthly bills when they were entered.
- Inputs: utility, rate and battery specs, and the installed cost when one
  was entered (all-in, on the battery system line; the other capital lines
  are set to 0). The template carries no sample project: building details,
  capital costs, analysis period and discount rate are blank, and
  replacement, O&M, escalation and resiliency are zero (flat annual), for
  the user to set. The returns stay empty until the capital costs, analysis
  period and discount rate are all in (the model status names what is
  missing); the savings sheets fill regardless.

Excel recalculates on open (the template carries no cached results). To
rebuild the template after the source workbook (kept out of git in `doc/`,
since it carries author and path metadata) changes:

```sh
node scripts/make_proforma_template.mjs doc/<workbook>.xlsx
```

## Model

- Canonical index: model year 2027, 15-minute, 35,040 intervals, naive local
  time (DST ignored), the reference engine's convention.
- Delivery bill: energy $/kWh + per-window demand charges (`rate x max import
  in window and period`), merged with every other $/kW determinant (SBC
  demand, supply capacity) that shares the window. The period is the month,
  the day (standby as-used daily demand, $/kW-day, weekdays 8-18 and 8-22)
  or the year (standby contract demand: one kW billed every month, chosen by
  the dispatch).
- Dispatch: one LP over the whole year with the battery sizes fixed, cyclic
  state of charge, an annual discharge budget, perfect foresight; program
  load relief as in the reference engine (`relief <= baseline - import +
  export`, delivered share = the worst event, reservation paid on the share,
  performance on relief kWh). When programs are enrolled behind the meter
  without exports, a second bill-only solve is reported for comparison.
- Value Stack (`js/valuestack.js`): exports only from discharge (no grid
  pass-through); energy credit at day-ahead LBMP x 1.061 (General Rule 25.1
  losses) on each hour's net injection; the DRV ($0.8536/kWh) on net
  injection in the network's CSRP call window, non-holiday weekdays June 24
  to September 15, with no charging in the window; Alternative 3 paid all
  year at the month's statement rate x 1.061 on a kW the battery holds
  through a band of likely NYCA peak hours (default 15:00 to 18:00 on the 10
  top-priced July and August weekdays: the real hour, the previous year's
  NYCA peak, is not known in advance); LSRV at $140.76/kW-year over at least
  10 events on the lowest net injection in each, where the location has MW
  left. Outside the DRV window the LP caps the export credit just below the
  import price so it never buys and sells in one interval; inside it a
  battery behind a building's meter can earn more exporting than the
  building pays importing, so each window interval is held to one side: a
  first solve on the load's hourly averages picks the side (export where
  the hour nets to an export and the interval's load is within the
  battery's power), and the exact 15-minute solve follows. With the cycle
  cap binding, or should that solve be infeasible, both passes run at 15
  minutes (the second fixes each interval to the side the first netted to,
  never worse than the first). A commitment the battery cannot hold over
  the building's load (Alternative 3, LSRV) is dropped with a note. The
  reported credits use the real prices and hourly netting.
- Capacity curve: the year solved again at 90, 80, 70 and 60% of the usable
  energy (`js/curve.js`), a full re-optimisation each, with power,
  round-trip efficiency and the annual cycle limit (counted on nameplate kWh,
  as warranties count it) unchanged. The four solves run two at a time in
  extra workers when the machine has the cores. Each level's streams are
  split the way the pro-forma carries them: demand, energy at the battery
  account's rates, programs, export credits, capacity credits and the
  account change.
- Hourly solve: when the load, prices and every window are constant within
  each hour (a stand-alone battery) the LP runs on 8,760 hours, which is
  exact (averaging a 15-minute dispatch over each hour keeps energy, cost
  and every window constraint and never raises a peak) and 5 to 12 times
  faster; the solution is laid back onto the 15-minute index.
- Solver: `highs` 1.15.3 (`vendor/highs`, MIT) in a module worker. In Node
  on a laptop: a full year behind the meter without exports in 5 to 20
  seconds; a stand-alone battery in about 0.5 s (4 to 6 s with a binding
  cycle cap); behind the meter with exports 7 to 16 s (about a minute with a
  binding cycle cap). A browser tab runs slower, and an election compared
  with keeping the DRV doubles the time.

## Run locally

```sh
python3 -m http.server 8080      # any static server; file:// blocks fetch and wasm
open http://localhost:8080/
npm test                            # engine tests + client-build checks
```

## Client edition (`--client`)

The source tree is the internal edition. For clients, build a sanitized copy:

```sh
node scripts/build.mjs --client     # writes dist/
npm run serve:client                # build, then serve dist/ on :8080
```

It differs from the internal edition only in text, never in numbers:

- `js/edition.client.js` ships as `js/edition.js`: no book / dataset
  vintages, compiler notes, internal tooling, solver timings or
  developer hints; errors the user can fix are shown, anything else gets a
  generic message and the console stays quiet. Any wording that should differ
  between editions belongs in those two files (a test keeps their exports in
  step).
- `data/` JSON loses its provenance fields (vintages, status, lineage,
  source files, notes) and the tariff keys lose their `corpus_` prefix.
- Comments are stripped from `js/` and `css/`.
- The build fails if any internal term or vintage string is left in the
  output (`LEAK_TERMS` and `BANNED_WORDS` in `scripts/build.mjs`; the
  banned words are stored as hashes so the repo does not spell them out).

`.github/workflows/pages.yml` runs the tests and publishes the client
edition to GitHub Pages on every push to `main` (Settings -> Pages ->
Source: GitHub Actions).

## Data (`data/`)

| File | Content | Source (paths in the reference engine's repo) |
|---|---|---|
| `tariffs_sc8.json` | SC 8 Rate I/II/III x LT/HT schedules with lineage | `config/tariffs/corpus_ced_sc8_*.yaml`, book `ny.ced.psc10@2026-08-01` (candidate) |
| `statements.json` | SBC, MAC, RDM, SDR, MSC capacity (SC 8 and SC 9 Rates I-III), MFC, MSC adjustment factors, and the per-class adjustments (SC 2, 8, 9) | `config/supply/ny.ced.psc10.yaml` + `config/tariff_db/.../statements` |
| `msc.json` | Observed MSC $/kWh per calendar day (codes 008CNV / 008TOD for SC 8, 009CNV / 009TOD for SC 9, zones J/H/I, all / on / off peak), 12 months to 2026-08 | MSC lookup dataset vintage 2026-09-25 |
| `lbmp_{J,H,I}.json` | NYISO day-ahead hourly LBMP on the model year | `data/lbmp/<zone>.csv` (2025-07 to 2026-06) |
| `programs.json` | CSRP / DLRP / Term-DLM / Auto-DLM terms and the 83-network table | `config/programs/ny.ced.psc10.yaml` |
| `tariffs_sc9.json`, `tariffs_sc2.json` | SC 9 Rate I / II / III and SC 2 Rate I (compiled), SC 9 standby Rate IV / V (all other customers, from the extracted book); `tariffs_sc8.json` also carries SC 8 Rate IV / V | `config/tariffs/corpus_ced_sc{9,2}_*.yaml`, `config/tariff_db/ny/ced/books/ny.ced.psc10_2026-08-01.json` |
| `value_stack.json` | Loss factor, Alternative 3 by month (statements Nov 2025 to Oct 2026), DRV rate and call window by network, LSRV rate and MW remaining | `config/compensation/ny.ced.psc10.yaml` + `scripts/value_stack_statements.json` (read from Con Edison's published Statements of Value Stack Credits) |
| `profiles/*.json` | Four synthetic multifamily profiles | `scripts/make_profiles.mjs` (seeded) |

Regenerate with the reference engine's virtualenv:

```sh
<engine-repo>/.venv/bin/python scripts/export_data.py --source <engine-repo>
node scripts/make_profiles.mjs
```

## Defaults decided with the owner (2026-10-08)

- 15-minute billing demand (Con Edison default); 30-minute available.
- Rate II defaults supply to Rider M hourly pricing (the 008TOD MSC series
  is the Rider M exempt case and stays selectable).
- MSC adjustment factors are included at the statement value for the supply
  mode and region (editable).
- Program combinations follow the tariff (revised 2026-10-16): CSRP + DLRP
  or Term-DLM + DLRP, never CSRP + Term-DLM (Rider AC I.2). Both
  reservations are paid on the same pledge; an hour in both programs' events
  pays performance once, CSRP over DLRP (Rider T J) and DLRP over Term-DLM
  (Rider AC I.1).
- Single editable tax/surcharge percentage (2.5%).

## Value Stack decisions (2026-10-16)

- Three modalities: behind the meter without export, behind the meter
  exporting under the Value Stack, front of the meter stand-alone.
- A Value Stack battery picks one election; the results compare a Rider T
  or Rider AC election with keeping the DRV and LSRV.
- Alternative 3 is paid on a kW committed over likely peak hours, not on a
  known hour.
- Alternative 3 uses the 12 monthly statement values (one override).
- Charging account: SC 2 up to 10 kW, SC 9 standard up to 1 MW, SC 9
  standby above, up to the 5 MW Value Stack cap.
- The owner pro-forma covers all three modalities.

## SC 9 decisions (2026-10-28)

- The building's account is SC 8 or SC 9; the load profiles stay the
  multifamily presets (scale to the bills or upload interval data).
- SC 9 offers all five rates; Rates IV and V as a starting rate are SC 9
  only for now.
- Taxes stay one editable percentage (2.5% default) for both classes; for
  SC 9 the help text says a commercial account generally also pays sales
  tax, a residential building may not.
- Flagged, not modelled: the SC 9 Rate I maximum-rate provision, and the
  size above which Rider M makes hourly pricing mandatory.

## Next version (planned)

- Multi-year cash flow in the wizard itself (the pro-forma already applies
  escalation, degradation through the capacity curve, replacement, NPV / IRR
  / payback).

## Known simplifications

- The MSC capacity charge and the Rider M ICAP tag are one monthly statement
  value applied to every month's maximum demand (the real charge varies by
  month and the tag by the customer's coincident-peak demand).
- MSC adjustment factors are one monthly reconciliation value applied all year.
- Delivery statements not compiled upstream (CES delivery surcharge, DLM
  surcharge, EV make-ready, arrears recovery) are not in the default
  adjustment; add them to the $/kWh override.
- Taxes are a single editable percentage (default 2.5%); residential
  redistribution is sales-tax exempt.
- Program baselines are the no-battery meter, not Con Edison's CBL; event
  days are chosen with perfect price foresight.
- SC 9 Rate I's maximum-rate provision is not modelled, and the Rider M
  mandatory hourly pricing threshold is not checked: the user picks the
  supply.
- No reactive charges, no minimum charges, single year, no escalation, no
  25-year Value Stack term. Degradation is usable energy only, through the
  capacity curve: no power or efficiency fade.
- Value Stack: the SC 11 charges are not added (the customer charge is
  waived when another service class serves the same connection; stand-alone
  storage is exempt from the SC 11 contract demand charge for 15 years if it
  qualifies by the end of 2030). The Wholesale Value Stack, remote crediting
  and the NYSERDA incentive are not modelled. Auto-DLM events are placed in
  the network's Contracted Hours (the real calls come at 10 minutes' notice
  between 8 AM and midnight). The standby exemption for storage up to 1 MW
  is applied to a front-of-meter account too.
