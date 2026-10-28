# Battery

The **Battery** step sizes the system and runs the year. Sizes are inputs, not optimised: to compare sizes, run each one.

## Inputs

| Input | Default | What it does |
|---|---|---|
| Power | 200 kW | Inverter rating, for charge and discharge |
| Energy | 400 kWh | Nameplate energy; the step shows the duration (kWh / kW) |
| Round-trip efficiency | 88% | AC to AC, split evenly between charging and discharging |
| Usable depth of discharge | 95% | The share of nameplate the controller may use |
| Annual cycle limit | 300 cycles / yr | Equivalent full cycles of discharged energy a year, as a warranty caps them; 0 = unlimited |
| Throughput cost | $0 / kWh | An optional charge per kWh discharged, to stop the battery cycling for pennies |
| Installed cost | blank | Optional, in thousands of dollars: gives a simple payback and goes on the pro-forma's capital cost line |
| Capacity curve for degradation | on | Also solves the year at 90, 80, 70 and 60% of the usable energy (below) |

One equivalent full cycle is a discharge equal to the nameplate energy: 300 cycles of a 400 kWh battery is 120 MWh discharged in the year.

## The capacity curve

With the curve on, the run solves the year again with 90, 80, 70 and 60% of the usable energy, a full re-optimisation each time. Power, efficiency and the annual cycle limit stay as entered: warranties count cycles on nameplate kWh.

The curve answers *what is this battery worth as it fades*:

- the results show the net benefit at each level, and its share of the full-capacity value;
- the pro-forma uses it to scale each later year's savings from the degradation and replacement year entered there, without another run (see [The owner pro-forma](proforma.md#degradation-and-replacement)).

The four extra solves run two at a time. Turn the curve off for a quicker run when you only need Year 1.

## Warnings before the run

- **Pledge too large**: the battery cannot carry one full demand-response event at the pledged kW. See [Demand response](demand-response.md).
- **Value Stack cap**: the Value Stack caps a project at 5 MW.
- **Account**: with exports or stand-alone, the step shows the account the battery will be billed on and why.

## Running

Click **Run simulation**. A progress note says what is being solved:

| Modality | Typical time in a browser |
|---|---|
| Stand-alone | a few seconds, plus a few for the curve |
| Behind the meter, no export | 10 to 20 seconds, about as much again for the curve |
| Behind the meter, exporting | one to two minutes, about as much again for the curve |

Programs behind the meter add a bill-only comparison solve; a Rider T or Rider AC election with exports adds a comparison with keeping the DRV. A tight cycle limit makes every solve slower.

The run opens the [Results](results.md).
::: hosted
It also saves itself as a new version of the project.
:::

> [!TIP]
> Changing any input clears the results, since they no longer match the inputs. Run again after the change.
