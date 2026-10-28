# The owner pro-forma

**Download pro-forma (XLSX)** on the Results page fills the owner's multifamily storage workbook from the run. The wizard handles the battery, the energy model, the dispatch and the utility savings; the workbook takes those through capital costs, operating costs and returns. The battery is set in the wizard only: the workbook links to it and cannot change it.

## The sheets

| Sheet | What it holds | Filled by |
|---|---|---|
| Inputs | Project, battery, capital costs, analysis assumptions, resiliency, readiness checks | Battery and account cells link to the wizard (green); the rest is yours |
| Utility_Rates | Effective monthly rates and any bills entered in the wizard; escalation | Rates link to the wizard; escalation is yours |
| Hourly_Operations | 8,760 hours: baseline load, battery dispatch, energy rate, export credit rate | The wizard |
| Value_Streams | Monthly peaks and savings by stream, with the totals the cash flow uses | Peaks, demand savings, program revenue and Value Stack capacity link to the wizard; energy savings and export credits are the workbook's own formulas on the hourly sheet |
| Project_Cash_Flow | Years 0 to 25: costs, savings, net and cumulative cash flow, returns | Formulas |
| Outputs | The summary | Formulas |
| Wizard_Import | Everything the wizard provides, in one protected sheet | The wizard |

Green cells are links to Wizard_Import: change the project in the wizard and download again rather than typing over them. Excel recalculates the whole workbook when it opens.

## What you fill in

| Where | What |
|---|---|
| Inputs C6:C8 | Building name, location, residential units (units only for a per-unit resiliency value) |
| Inputs C32:C38 | Installed capital cost by line. An installed cost entered in the wizard goes on C32 (battery system) as an all-in figure, with the other lines at 0 |
| Inputs C42, C43 | Analysis period (1 to 25 years) and discount rate |
| Inputs C24 | Annual degradation (see below) |
| Inputs C26, C27 | Replacement year (0 = none) and its cost |
| Inputs C28, C29 | Annual O&M and its escalation |
| Utility_Rates C22, C23 | Escalation of energy and demand prices |
| Inputs C46:C52 | Resiliency: one method (flat annual value, insurance savings, avoided downtime or a per-unit value) and its inputs |

The returns (IRR, NPV, simple payback and lifetime net benefit, with and without resiliency, on Project_Cash_Flow) stay empty until the capital costs, analysis period and discount rate are in. **Inputs C65, Model status**, names what is still missing. The savings sheets fill regardless.

## Degradation and replacement

The wizard's [capacity curve](battery.md#the-capacity-curve) lets the cash flow follow a fading battery:

- **Project_Cash_Flow P** is the usable energy left each year: 100% in Year 1, then compounding the annual degradation in Inputs C24. A replacement in year N (Inputs C26) restores it to 100% from year N + 1; its cost is booked in year N.
- **Q to T** are each stream's share of its Year 1 value at that capacity (demand savings, energy savings, program revenue, Value Stack credits with the account change), interpolated between the curve's levels. Below the lowest level (60%) the shares hold at that level's.
- **D to G** multiply the Year 1 streams by those shares; demand and energy savings then escalate as before.

With no degradation entered, or a run without the curve, the shares stay at 100% and savings hold at Year 1.

> [!TIP]
> With 2.5% a year, the battery is at 76% by year 12. A replacement in year 12 brings it back to 100% in year 13. Each stream fades at its own pace, which Q to T show: in typical buildings demand savings fade more slowly than the battery's energy.

## Wizard_Import

One protected sheet with a fixed layout: the interface between the wizard and the financial model. Blocks are only ever added below; no cell moves, so links into it stay good across versions.

| Block | Cells | What it holds |
|---|---|---|
| Project | B5:D21 | Project ID, name, configuration fingerprint, run time, wizard version, rates date, modality, utility, account and rate, area and zone, supply, programs, load, export flag, billing interval, tax |
| Battery | B23:D33 | The battery, as set in the wizard (the source of truth), Year 1 cycles and MWh discharged, installed cost |
| Year 1 summary | B35:D45 | Baseline bill, bill with the battery, bill savings and their split, program revenue, Value Stack credits, net benefit, the bill-only comparison |
| Monthly utility bill | B47:S61 | Per month: kWh, exports, billing peaks, demand and energy dollars and savings, effective $/kW and $/kWh, fixed and rate changes, any bill entered |
| Program revenue by month | B63:K77 | Reservation and performance for CSRP, DLRP, Term-DLM and Auto-DLM, from one dispatch |
| Program terms | B79:F87 | Pledge, delivered kW and share, events, rates and Year 1 revenue, per program |
| Value Stack by month | B89:H103 | Exports, energy, DRV, Alternative 3 and LSRV credits |
| Value Stack terms | B105:D110 | Election, Alternative 3 kW and rate, DRV window, LSRV events |
| Demand charges | B112:L257 | Every demand charge by month: rate, determinant baseline and with the battery, dollars and savings |
| Energy by component | B259:E268 | Each energy component, baseline and with the battery |
| Capacity curve | B272:P278 | Per level of usable energy (B): kWh, each stream's Year 1 value, net benefit, and the shares the cash flow uses (K net, L demand, M energy, N programs, O Value Stack), cycles |
| Capacity curve by month | B280:G294 | Net benefit by month at each level |
::: hosted
| Saved analysis | B298:D304 | The version holding the run and its links (below) |
:::

All dollars include taxes and surcharges.

::: hosted
### Saved analysis and links

The pro-forma records where its run is kept:

| Cell | What |
|---|---|
| C299 | The version number that holds this run |
| C300 | The link to that version |
| C301 | *Open this version in the wizard*: click it |
| C302 | The link to the project's latest version |
| C303, C304 | When it was saved, and by whom |

The block is blank when the run was not saved, for instance when its save failed; the project ID and fingerprint in the Project block still identify the run.
:::
