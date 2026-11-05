# The owner pro-forma

**Download pro-forma (XLSX)** on the Results page fills the owner's financial model (*BESS Owner Financial Calculations*, v1.0) from the run. The wizard calculates Year 1: the battery, the energy model, the dispatch, the bill savings, program revenue, Value Stack credits, how much of the demand savings a real controller can expect to keep, and how the year changes as the battery fades. The workbook takes those across the analysis period with escalation, degradation, capital and operating costs, incentives, tax benefits, financing and returns.

The wizard writes one sheet, **Wizard_Import**. Every other sheet is the model's own, and the cells it needs from the run are green links to Wizard_Import. The battery is set in the wizard only: change the project there and download again rather than typing over a green cell. Excel recalculates the whole workbook when it opens.

> [!NOTE]
> The financing schedule (Debt_Schedule) uses Excel's dynamic arrays. Open the workbook in Microsoft 365 Excel; older Excel, LibreOffice and some online viewers show `#NAME?` there and in the returns that depend on it.

## The sheets

| Sheet | What it holds | Filled by |
|---|---|---|
| Inputs | Building, battery, degradation and O&M, escalation, capital costs, analysis assumptions, resiliency, ITC and depreciation, financing, the returns summary and readiness checks | Account and battery cells link to the wizard (green); the rest is yours |
| Project_Cash_Flow | Years 0 to 25 across the columns: investment and incentives, savings by stream, expenses, financing, cash flows, returns; capacity retained and each stream's share below | Formulas |
| Outputs | The summary | Formulas |
| Utility_Rates | Monthly effective rates, any bills entered in the wizard, each month's season and the 24-hour time-of-day schedule | Links to the wizard |
| Hourly_Operations | 8,760 hours: baseline load, battery dispatch, net grid demand, time-of-day period, energy rate, costs and export credits | D, E, H and L link to the wizard; the rest are the model's formulas |
| Value_Streams | Year 1 by month: peaks, demand savings before and after the peak matching efficiency, energy, programs, Value Stack, account change, resiliency | Links to the wizard and the model's formulas |
| Tax_Benefits, Debt_Schedule | ITC, depreciation, bridge and term loans | Formulas |
| Wizard_Import | Everything the wizard provides, in one protected sheet | The wizard |

## What you fill in

All on **Inputs**:

| Cells | What |
|---|---|
| C6:C8 | Building name, location, residential units (units only for a per-unit resiliency value) |
| C11 | Analysis start date: 1 January of a non-leap year |
| C24, C25 | Annual degradation (see below) and useful life (a reference) |
| C26, C27 | Replacement year (0 = none) and its cost |
| C28, C29 | Annual O&M and its escalation |
| C30, C31 | Escalation of energy and demand rates |
| C34:C40 | Installed capital cost by line. An installed cost entered in the wizard goes on C34 (battery system) as an all-in figure, with the other lines at 0 |
| C44, C45 | Analysis period (1 to 25 years) and discount rate |
| C49:C54 | Resiliency: a flat annual value, insurance savings, avoided downtime and a per-unit value; they add up |
| C58:C63 | ITC rate, share of the basis eligible, grants, upfront VPP revenue, owner tax rate, bonus depreciation |
| C69:C73, C78:C82 | Bridge loan and term loan |

The template comes with the model's own general assumptions (degradation, O&M, escalation, analysis period, discount rate, tax and loan terms) and without a sample project: the building, capital costs, resiliency amounts, VPP revenue and term loan are blank or zero. The returns (Inputs C85:D92) stay empty until the capital costs are in; **Model status** (Inputs C104) names what is still missing, and the readiness checks above it show which test fails.

## Peak matching efficiency

The wizard's dispatch knows the whole year's load in advance. A real controller works from a day-ahead forecast, and a month's demand charge is set by its single worst interval, so a forecast error on one day can set the month's bill. The wizard estimates, month by month, how much of the demand savings a controller can expect to keep: the **peak matching efficiency** (see [How the model works](how-it-works.md#peak-matching)).

- **Value_Streams C** is each month's efficiency, linked from Wizard_Import.
- **Value_Streams H** is the month's demand savings with perfect foresight; **I** = H x C is what the cash flow uses (Project_Cash_Flow row 23, through Value_Streams I18).
- The forecast error behind it is set on the [Battery step](battery.md#inputs) (5% by default) and recorded on Wizard_Import. With no demand savings to derate (a stand-alone battery, or [demand response only](demand-response.md#demand-response-only)), every month is 100%.

Energy savings, program revenue and Value Stack credits are not derated: their timing is set by prices and program calls, not by the month's worst interval.

## Degradation and replacement

The wizard's [capacity curve](battery.md#the-capacity-curve) lets the cash flow follow a fading battery. On Project_Cash_Flow, with the years across the columns:

- **Row 108** is the usable energy left each year: 100% in Year 1, then compounding the annual degradation in Inputs C24. A replacement in year N (Inputs C26) restores it to 100% from year N + 1; its cost is booked in year N.
- **Rows 109 to 112** are each stream's share of its Year 1 value at that capacity (demand savings, energy savings, program revenue, Value Stack credits with the account change), interpolated between the curve's levels on Wizard_Import. Below the lowest level (60%) the shares hold at that level's.
- **Rows 23 to 26** multiply the Year 1 streams by those shares; demand and energy savings then escalate.

With no degradation entered, or a run without the curve, the shares stay at 100% and savings hold at Year 1.

> [!TIP]
> At 5% a year with no replacement, the battery is down to 60% by year 11, and the shares hold at the curve's 60% level from then on, which flatters the later years. Model a replacement (Inputs C26, C27) or a shorter analysis period for a battery that fades that far.

## How the model links to Wizard_Import

Every green cell, and where it points. All dollars include taxes and surcharges.

| Model cells | Wizard_Import | What |
|---|---|---|
| Inputs C9, C10, C14 | C13, C14, C19 | Utility, account and rate, Value Stack exports |
| Inputs C16:C21, C23 | C24, C25, C27, C28, C29 | Power, energy, efficiency, usable share (and the state-of-charge limits from it), cycle limit |
| Utility_Rates C6:C17 | S49:S60 | Bills entered in the wizard |
| Utility_Rates F6:F17 | K49:K60 | Effective demand rate, baseline ($/kW-month) |
| Utility_Rates G6:J17 | O49:O60 | Average energy rate, baseline ($/kWh), in every period column |
| Utility_Rates K6:K17 | C331:C342 | Season (Summer June to September) |
| Utility_Rates C29:F52 | C346:F369 | Time-of-day period by hour starting, summer and winter, weekday and weekend |
| Hourly_Operations D, E, H, L (rows 6 to 8765) | D, E, F, G (rows 375 to 9134) | Baseline kW, battery dispatch kW, energy rate $/kWh, export credit rate $/kWh, hour for hour |
| Value_Streams C6:C17 | C308:C319 | Peak matching efficiency |
| Value_Streams D, E (rows 6 to 17) | F, G (rows 49 to 60) | Billing peak, baseline and with the battery |
| Value_Streams H6:H17 | J49:J60 | Demand savings |
| Value_Streams M6:M17 | K65:K76 | Program revenue |
| Value_Streams O6:O17 | F91:G102 | Alternative 3 and LSRV credits |
| Value_Streams P6:P17 | P49:Q60 | Fixed charge change, and the rate change on the baseline load |
| Project_Cash_Flow rows 109 to 112 | B274:B278 with L, M, N, O 274:278 | The capacity curve's levels and shares |

The energy savings and export credits in Value_Streams are the model's own sums over Hourly_Operations, so they follow the hourly links.

## Wizard_Import

One protected sheet with a fixed layout: the interface between the wizard and the financial model. Blocks are only ever added below, and a block no longer written keeps its rows empty, so no cell moves and links into it stay good across versions.

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
| (empty) | rows 280 to 295 | The capacity curve by month, until version 0.6 |
::: hosted
| Saved analysis | B298:D304 | The version holding the run and its links (below) |
:::
| Peak matching efficiency | B306:H320 | Per month: efficiency, days the battery has to shave, the billing peak cut and demand savings with perfect foresight and expected |
| Peak matching terms | B322:D325 | The forecast error, the forecast years simulated, what it applies to |
| Tariff calendar | B329:C342 | Season by month |
| Time-of-day periods | B344:F369 | Peak, Shoulder or Off-peak by hour starting, summer and winter, weekday and weekend: the account's demand and supply windows |
| The year hour by hour | B373:G9134 | Hour of the year, start, baseline kW, battery dispatch kW, energy rate, export credit rate |

The time-of-day periods are labels: an hour inside every time-of-day window of the season is Peak, inside some Shoulder, outside them all Off-peak, and a rate with no windows (Rate I) is Off-peak throughout. The hourly energy rate already prices every hour.

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
