# Results

The **Results** page shows what the battery is worth in the year, how it earns it, and how it runs. The layout follows the modality.

## Behind the meter, no export

**The headline**

- **Annual savings**: bill savings plus program revenue, and their share of the baseline bill.
- **Bill savings**, with any program revenue.
- **Annual peak**: the billing peak before and after.
- **Simple payback**: when an installed cost was entered, installed cost / annual savings.

**Annual bill, baseline vs with battery**: every component of the bill before and after, with the savings on each: energy by component, delivery demand charges, the SBC demand surcharge, the supply capacity charge, the customer charge and taxes. Program revenue follows, program by program, split into reservation and performance with the terms behind each.

With programs, a note says what dispatching for the bill alone would have saved, and so what holding the battery for events costs on the bill. With [demand response only](demand-response.md#demand-response-only), the note instead says what optimising the bill as well would earn. CSRP or DLRP delivering less than 80% of the pledge on its weakest event is flagged.

## With the Value Stack

**The headline**: the annual net benefit (bill savings plus credits and program revenue; for a stand-alone battery, credits and program revenue less the charging bill), the Value Stack credits and MWh exported, the bill savings or the charging bill, and the kW committed under Alternative 3.

- **Value Stack credits**: energy, Alternative 3, DRV and LSRV, each with how it was worked out, and any program reservations.
- **The bill**: baseline and with the battery behind the meter; the charging account's bill for a stand-alone battery.
- **Credits by month**, as a chart and a table.
- **The election**: with Rider T or Rider AC, what keeping the DRV (and LSRV) would have earned instead, and which is worth more.
- Any commitment the battery could not hold (Alternative 3 or LSRV), flagged.

## On every results page

### Capacity curve

The year solved again with less usable energy (see [Battery](battery.md#the-capacity-curve)):

| Column | Meaning |
|---|---|
| Usable energy | 100, 90, 80, 70 and 60% of the usable energy |
| kWh | The usable kWh at that level |
| Bill savings / charging bill | The bill part of the value |
| Programs, Value Stack credits | Where they apply |
| Net benefit | The year's value at that level |
| Of full | Its share of the full-capacity value |

### Charts

- **Monthly peaks** (behind the meter): each month's billing peak before and with the battery, with the demand dollars saved and the extra kWh the battery's losses add.
- **Dispatch**: a week at a time (pick any week; it opens on the week of the peak, or a stand-alone battery's busiest export week): the building load, grid import and, with exports, grid export, and the state of charge below.

### State of charge and backup

After the dispatch, a chart shows the energy the battery holds on average in each month, and a table and note turn it into backup:

| Column | Meaning |
|---|---|
| Average stored kWh | The month's average state of charge |
| Of usable | That as a share of the usable energy |
| 25% of peak kW | A critical load of a quarter of the month's peak load |
| Backup hours | How long the average charge, less discharge losses, would carry that load in an outage |

Where 25% of the peak is more than the battery's power, the battery carries only its rated kW of that load, and the table says so. A stand-alone battery has no building to back up, so it shows the state of charge only.

> [!NOTE]
> The dispatch keeps no reserve for outages. Between uses it recharges as soon as that costs nothing extra (see [How the model works](how-it-works.md#the-dispatch)), but these figures are what normal operation leaves in the battery at an average moment, and right after a discharge it can be close to empty. A month with little room to recharge under the shaved peak, such as a hot August, shows little backup. A battery that only does [demand response](demand-response.md#demand-response-only) sits charged most of the time, so it shows much more backup.

### Assumptions and provenance

The list says what the run used: the account and rate, the statements in force, the supply, the cycles run against the limit (and whether the limit binds, with what one more cycle would be worth), the Value Stack terms, the capacity curve, and anything the model simplifies.

## Downloads

| Download | What is in it |
|---|---|
| Pro-forma (XLSX) | The owner's workbook filled from the run: see [The owner pro-forma](proforma.md) |
| Results (JSON) | Everything the run computed: the project and its configuration fingerprint, inputs, battery, load statistics, both bills, program revenue, Value Stack credits, the election comparison, the capacity curve, the state of charge and backup by month, and the summary |
| Dispatch (CSV) | Every 15-minute interval: timestamp, load, import, export, charge, discharge, state of charge and the all-in price |

**Change inputs and re-run** goes back to the Battery step.

::: pages
> [!NOTE]
> Results are not kept: they clear when an input changes or the page reloads. Save the project to a file and run it again when you open it. See [Projects](projects.md).
:::
::: hosted
> [!NOTE]
> A project opened from the server comes back with its results, marked *Kept run from* the date it ran. If the wizard or the rates have changed since, it opens with its inputs and a note to run again. See [Projects and versions](projects.md).
:::
