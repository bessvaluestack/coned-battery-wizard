# Introduction

The Con Edison Battery Wizard works out what a battery is worth in a year, for a building or a site in Con Edison territory. You describe the account, the supply, any demand-response programs, the load and the battery; the wizard optimises the battery's dispatch over a full year at 15 minutes and reports the bill savings, the program revenue and the Value Stack credits. It also fills an owner pro-forma workbook, so the financial model starts from the same numbers.

## What it models

The wizard covers three kinds of project, chosen on the first step:

| Modality | What it is | What it earns |
|---|---|---|
| Behind the meter, no export | The building's own battery on its SC 8 or SC 9 account, never sending power to the grid | Demand and energy savings on the bill, plus demand-response payments |
| Behind the meter, exporting under the Value Stack | The same battery, also exporting under Rider R with SC 11 | Bill savings plus Value Stack credits on each hour's net export |
| Front of the meter (stand-alone) | A battery with its own account and no load, charging from and exporting to the grid | Value Stack credits less the charging account's bill |

[Choosing a modality](modality.md) compares them in detail.

## What you get

- **The annual value**: bill savings by component, demand-response revenue by program, Value Stack credits by component, and the net benefit.
- **The dispatch**: a week of charging, discharging and state of charge, and the whole year as a CSV file.
- **A capacity curve**: the same year solved again with 90, 80, 70 and 60% of the usable energy, so a fading battery can be followed for years without another run.
- **The owner pro-forma**: an Excel workbook with the year's 8,760 hours, the monthly bill and every demand charge, and a cash flow that applies your capital costs, degradation and replacement.

## Where it runs

Everything runs in your browser: the tariff calculations, the supply prices and the optimisation (the HiGHS solver, running as WebAssembly).

::: pages
Nothing you enter leaves your browser unless you save a project file. The open project is kept in the browser, and in project files you save and open; results are not kept, so open a project and run it again. See [Projects](projects.md).
:::
::: hosted
The site keeps every project on its server: every save is a version, every run is saved with it, so a project opens straight back to its results, and each version has a link you can share. See [Projects and versions](projects.md).
:::

> [!NOTE]
> The wizard is a screening and planning tool. Its numbers come from Con Edison's filed tariff and published statements, but it is not a bill, an interconnection study or legal advice. [Assumptions and limits](limits.md) lists what it leaves out.

## How to read this manual

- New to the tool? Start with the [Quick start](quick-start.md): a first run in a few minutes.
- *The wizard, step by step* follows the steps in order and explains every input.
- *Projects and the pro-forma* covers saving, sharing and the Excel handoff.
- *Reference* explains the model, its limits and the vocabulary.

Press `/` anywhere in the manual to search it. Every step of the wizard has a **Manual** link to its page here.
