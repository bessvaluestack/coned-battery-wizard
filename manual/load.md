# Load

Behind the meter the battery works against the building's load: a full year at 15 minutes, 35,040 intervals, on the model-year calendar. A stand-alone battery has no load and no Load step.

There are three ways to give the wizard a load.

## Preset profiles

Four synthetic multifamily buildings:

| Preset | Character |
|---|---|
| Mid-rise, 150 units, gas heat, window AC | Evening-peaking residential load with a moderate summer air-conditioning bump; sized for Rate I (about 300 kW) |
| High-rise, 400 units, central chiller, gas heat | A central cooling plant makes summer afternoons the annual peak (about 850 kW); flat-ish shoulder seasons |
| Large complex, 600 units, electric heat pumps | Electrified heating: winter-peaking mornings (about 1,000 kW) plus a summer cooling peak |
| Tower, 900 units, central plant | Above the 1,500 kW mandatory time-of-day threshold (about 2,300 kW peak); pairs with Rate II and Rider M supply |

The presets serve SC 9 buildings too: scale one to the building's bills, or upload its interval data.

## From the bills

Pick a preset as the shape, then scale it to the building's bills under the rate and supply already chosen:

- **Annual**: one total for the year. The wizard finds the scale whose modelled bill matches it.
- **Monthly**: twelve bills. Each calendar month of the shape is scaled on its own until its modelled bill matches.

Each bill is delivery plus supply, taxes included. The boxes start at the shape's own modelled bills; the sliders run from half to twice those. Changing the rate, supply or tax settings later re-estimates the profile.

> [!NOTE]
> Calendar months stand in for Con Edison's meter-read billing periods. A month whose bill is below its fixed charges is modelled with no load, and the step says so.

## Upload interval data

A CSV file with:

- a timestamp column (ISO, or `M/D/YYYY H:MM`), or separate date and time columns (as in Green Button exports);
- a kW or kWh column. *Units* detects which from the header, or set it yourself: kW is average demand over the interval, kWh is energy per interval.

Any year, at any interval from 5 to 60 minutes. February 29 is dropped and gaps are interpolated. The step reports what it read: rows, interval, units, columns, years and coverage.

::: pages
The uploaded data stays with the project: it travels in the project file you save.
:::
::: hosted
The uploaded data stays with the project: it is kept with every saved version.
:::

## The load summary

Whichever way the load comes in, the step shows its annual energy, its peak at the billing-demand interval, its load factor and the baseline bill, with charts of monthly energy and monthly peaks. It warns when the peak does not fit the rate: see [Rate or site](rate.md#when-the-rate-does-not-fit-the-building).

*Download profile as CSV* saves the year as `timestamp,kw` on the model calendar.
