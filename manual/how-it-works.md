# How the model works

A summary of what happens between **Run simulation** and the results.

## The year

Everything runs on one model year, 2027, at 15 minutes: 35,040 intervals on local time, without daylight-saving shifts. Loads, prices and windows are laid onto that calendar: an uploaded year of any date, the supply prices from the last 12 months of observations, and the day-ahead LBMP from the latest 12 months available.

## The bill

A bill is:

- **energy**: each interval's kWh at its all-in price (delivery energy, the per-kWh adjustments and supply), taxed;
- **demand**: every $/kW charge times its determinant, which is the highest import in the charge's window over its period. The period is the month for most charges, the day for standby as-used demand, and the year for the standby contract demand (one kW, billed every month);
- **fixed**: the customer charge.

Demand charges that share a window and period are merged: the delivery demand charge, the SBC demand surcharge and a capacity charge billed on the monthly maximum all ride one determinant.

## The dispatch

The battery's sizes are fixed; the dispatch is optimised over the whole year at once, as one linear program solved by HiGHS in the browser:

- **minimise** the energy cost, every demand charge, any throughput cost, less program payments and Value Stack credits;
- **subject to** the energy balance in every interval, the state of charge from one interval to the next (round-trip efficiency split evenly), the power and usable-energy limits, the annual discharge budget, and a state of charge that ends the year where it started.

The dispatch has **perfect foresight**: it knows the whole year's load and prices in advance. A real controller does worse, so treat the results as the value available, not a guarantee.

When nothing else decides when the battery charges (prices flat within the day, say), a tie-break worth a few dollars a year makes it recharge early and stay ready, as a controller holding a reserve would, rather than leaving the state of charge wherever the solver happens to. It changes the year's value by cents.

After the solve, any interval that both charges and discharges is netted, and the bills are worked out from the resulting import.

### Programs

Program relief in each event interval is at most the drop in import below the no-battery load (plus exports, with the Value Stack), and at most the pledge. The delivered kW is the weakest event's average relief. The reservation is paid on the delivered kW, performance on the relief kWh. One hour pays performance once when two programs' events overlap.

### The Value Stack

Exports come from discharge only, credited on each hour's net injection. The DRV window allows no charging. Alternative 3 pays on a kW the battery holds as net injection through every hour of the commitment band; LSRV on the lowest net injection in each event. Outside the DRV window the export credit is capped just below the import price in the optimisation, so the model never buys and sells in the same interval; the credits reported use the real prices.

Inside the window a battery behind a building's meter can earn more exporting than the building pays importing, so each window interval is held to one side, import or export. A first solve on hourly averages picks the side; the exact 15-minute solve follows. If the cycle limit binds, both passes run at 15 minutes.

A commitment the battery cannot hold over the building's load is dropped, with a note.

## The capacity curve

The same year is solved again at 90, 80, 70 and 60% of the usable energy, each a full re-optimisation of the bill, the programs and the Value Stack together. Each level's value is split the way the pro-forma carries it: demand savings, energy savings at the battery account's rates, program revenue, export credits, capacity credits and the account change. The four solves run two at a time.

## Solving faster

- **The cycle limit** couples every interval of the year and slows the solver, so the year is solved without it first; the limit is added only if the free dispatch would exceed it.
- **A stand-alone battery** has no load, and its prices and windows are constant within each hour, so the year is solved on 8,760 hours. That is exact, and several times faster.