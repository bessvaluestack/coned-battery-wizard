# Release notes

The wizard's version is shown in the pro-forma (Wizard_Import, Project block).
::: hosted
Every saved run records it too: a run saved by an earlier version opens with its inputs and a note to run it again.
:::

## 0.5 — October 2026

- **Monthly supply charges.** The MSC capacity charge, the merchant function charge and the MSC adjustment factors are each month's own statement (the last 12), not the latest one applied all year. A value entered on the Supply step still applies all year.
- On Rates II and III the MSC capacity charge bills on the weekday time-of-day demand the statement names, not the all-hours peak.
- No MSC adjustment factors under Rider M hourly pricing, as their statement says; Rate II on the MSC takes the factor for customers exempt from Rider M.

## 0.4 — October 2026

- **SC 9 buildings.** The building's account can be SC 8 (Rates I to III) or SC 9 (Rates I to V), with SC 9's own supply prices, capacity charge and surcharges.
- Rates IV and V as a starting rate, for an SC 9 building already on standby.
- Warnings when the building's peak does not fit the rate.
- An exporting battery moves an SC 9 building to SC 9 standby by the same rule as SC 8.
- This manual, with a **Manual** link on every step.

## 0.3 — October 2026

- **The capacity curve.** Each run also solves the year at 90, 80, 70 and 60% of the usable energy. The pro-forma's cash flow uses it to apply degradation and a replacement year.
::: hosted
- **Project links**: every version has a link that opens it with its run, and the pro-forma records the version and the link.
:::

## 0.2 — October 2026

::: pages
- **Projects**: a name and project ID, saved to and opened from a project file.
:::
::: hosted
- **Projects** with a name and a stable project ID, kept on the server: every save a version, every run kept with it.
:::
- **The Wizard_Import sheet** in the pro-forma: everything the wizard provides in one protected sheet, with the workbook's battery, savings and rate cells linked to it.

## Earlier — October 2026

- Three modalities: behind the meter without export, behind the meter exporting under the Value Stack, and stand-alone.
- The Value Stack (energy, Alternative 3, DRV, LSRV) and the demand-response elections.
- Charging accounts for stand-alone batteries: SC 2, SC 9 and SC 9 standby.
- Demand-response stacking as the tariff allows it, with performance paid once per hour.
- Faster solves for stand-alone and exporting batteries.
