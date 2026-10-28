# Questions and troubleshooting

## Using the wizard

### The run takes a long time

Behind the meter with exports is the slowest case: one to two minutes for the year, about as much again for the capacity curve, and twice that for a Rider T or Rider AC election compared with keeping the DRV. A tight cycle limit slows every solve. For a quicker look, turn off the capacity curve on the Battery step and turn it back on for the final run.

### The results disappeared

Changing any input clears the results, since they no longer match.
::: pages
Results are also not kept when the page reloads: open the project file and run it again.
:::
::: hosted
Every run is kept with its version: open it from **Versions**.

### A project opened without its results

A run is brought back only when it was made with the same wizard version and the same rates. After an update, the project opens with its inputs and a note to run again.
:::

### My uploaded file was rejected

The file needs a timestamp column (or separate date and time columns) and one kW or kWh column, at an interval from 5 to 60 minutes. Check *Units* if the header does not say kW or kWh. See [Load](load.md#upload-interval-data).

::: hosted
### Copy link shows the link instead of copying it

On a plain `http://` address browsers do not let the page use the clipboard. Copy the link from the message, or from the address bar, which always shows the open version's link. Over `https://` the link is copied.

### Someone else saved over my work

Nothing is overwritten: every save is a new version. Open **Versions**, open the one you want and save it again to make it the latest.
:::

## Numbers

### Why does the same battery save less on SC 9 than on SC 8?

SC 9's demand charges are lower than SC 8's, so there is less peak for the battery to cut. Try the time-of-day rates (II or III): their weekday windows often suit a battery better.

### The baseline bill does not match the building's real bill

Check the rate, voltage, supply and tax settings, then scale the load to the real bills on the Load step (*From the annual bill*, annual or monthly). The wizard leaves out a few statements and charges: see [Assumptions and limits](limits.md#bill).

### Why is the program revenue lower than the pledge suggests?

The reservation is paid on what the battery delivers on its weakest event. A battery too small to carry the pledge through a full event earns a share of it; the Battery step warns before the run.

### Why does an exporting battery move the building to standby?

General Rule 20 bills customers with on-site generation on standby rates. Storage up to 1 MW, or within 15% of the building's peak, stays on standard rates; above both, the building moves to Rate IV or V. See [Rate or site](rate.md#with-an-exporting-battery).

## Pro-forma

### The returns are empty

The returns need the capital costs (Inputs C32:C38), the analysis period (C42) and the discount rate (C43). **Model status** in Inputs C65 says what is missing.

### Can I change the battery in the workbook?

No: the battery cells are green links to Wizard_Import, which holds the battery as set in the wizard. Change it in the wizard and download again, so the savings always match the battery.

### Savings stay flat in later years

Enter an annual degradation in Inputs C24. The cash flow then follows the capacity curve. If the run had the capacity curve turned off, the shares stay at 100%: run again with it on.
