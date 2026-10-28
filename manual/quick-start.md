# Quick start

A first run with the wizard's defaults takes a few minutes: a 400-unit high-rise on SC 8 Rate I with a 200 kW / 400 kWh battery behind the meter.

## 1. Pick the modality

Open the wizard. The first step, **Modality**, starts on *Behind the meter, no export*. Keep it, and look over the table *What each one needs*: it lists the account, interconnection, metering and permits each project type needs.

Click **Next**.

## 2. Check the rate

The **Rate** step starts on SC 8 (Multiple Dwellings, Redistribution), Rate I, low tension, New York City, with 15-minute billing demand. The rate card at the bottom shows every charge the bill uses. Keep the defaults.

> [!TIP]
> A commercial building or any other account that is not a redistributing multiple dwelling is usually on SC 9. Pick **SC 9 (General - Large)** under *Service class*, then its rate. See [Rate or site](rate.md).

## 3. Supply and riders

**Supply** starts on Con Edison full service (the Market Supply Charge). **Riders** starts with no demand-response program enrolled. Keep both for a first run.

## 4. Load

**Load** starts on the preset *High-rise, 400 units, central chiller, gas heat*: a full year at 15 minutes with an annual peak of about 900 kW. The summary shows the year's energy, peak, load factor and the baseline bill.

To model a real building, use *From the annual bill* (scale a preset to the building's bills) or *Upload interval data*. See [Load](load.md).

## 5. Battery and run

**Battery** starts at 200 kW / 400 kWh, 88% round-trip efficiency, 95% usable, 300 cycles a year, with the capacity curve on. Click **Run simulation**.

The run optimises the year and then the capacity curve, about half a minute in all for this building. A behind-the-meter battery that exports takes longer, a stand-alone one a few seconds.

## 6. Read the results

The **Results** page opens with the annual savings: roughly $95,000 a year for this building at the rates in force in October 2026, about 12.5% of its $754,000 baseline bill. Below it:

- the bill by component, baseline and with the battery
- the capacity curve
- the monthly peaks before and after
- a week of dispatch (pick any week), with the state of charge
- the assumptions the run used

Download the **pro-forma (XLSX)** to take the run into the owner's financial model, the **results (JSON)** for everything the run computed, or the **dispatch (CSV)** for every 15-minute interval.

## Next steps

- Enrol the building in demand response: [Demand response](demand-response.md).
- Let the battery export under the Value Stack: [Value Stack](value-stack.md).
::: pages
- Save the project to a file, to open and run it again later: [Projects](projects.md).
:::
::: hosted
- Share a link to the saved run: [Projects and versions](projects.md).
:::
- Add the capital costs and degradation in the workbook: [The owner pro-forma](proforma.md).
