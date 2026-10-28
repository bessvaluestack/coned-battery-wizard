# Value Stack

In the two exporting modalities the **Value Stack** step replaces Riders. Exports are credited under Rider R A.9(d) with SC 11 buy-back service, on each hour's net injection: what goes out to the grid in the hour, after the building's own load. Credits are bill credits on the account.

## The credits

| Component | How it is paid | Notes |
|---|---|---|
| Energy | Day-ahead zonal LBMP x 1.061 (losses, General Rule 25.1) on each hour's net injection | Every hour of the year |
| Capacity, Alternative 3 | The month's statement $/kW x 1.061, every month, on the kW the battery holds through the likely peak hours | The only capacity option for storage |
| DRV (Demand Reduction Value) | $/kWh on net injection in the network's CSRP call window, non-holiday weekdays from June 24 to September 15 | Fixed for 10 years; no charging in the window |
| LSRV (Locational System Relief Value) | $/kW-year, spread over at least 10 events, on the lowest net injection in each | Only where the location has MW left |

Standalone storage gets no environmental component, Market Transition Credit or Community Credit.

## Inputs

### Network

The site's distribution network. Its CSRP call window sets the DRV hours. With a Rider T or Rider AC election it also sets the program terms, as on [Demand response](demand-response.md).

### Election

Each Value Stack project picks one of three:

| Election | What it means |
|---|---|
| Keep the Value Stack DRV (and LSRV) | The DRV, and LSRV where MW remain, stay on top of the energy and capacity credits |
| Rider T: CSRP and / or DLRP instead | CSRP and DLRP reservations instead. A one-time, irreversible opt-out of the DRV and LSRV for the rest of the 25-year term |
| Rider AC: Term-DLM or Auto-DLM instead | A multi-year DLM contract (pay-as-bid, 3 to 5 years). The DRV and LSRV pause for the contract and resume after it. With Term-DLM, DLRP can be added, but DLRP is Rider T: it ends the DRV and LSRV for good |

Rider R customers are paid the program reservation only, no performance payments. Exports during events count as load relief.

With Rider T or Rider AC, the run solves a second year with the same battery keeping the DRV instead, and the results say which is worth more. The comparison doubles the run time.

### LSRV

Tick *The site is in an LSRV area with MW left* if it is; the step lists the areas with MW remaining on the latest statement. Set the number of events per year: at least 10, with the rate divided over the events called.

### Alternative 3 commitment

Alternative 3 pays on the net injection during the previous year's New York Control Area peak hour, a non-holiday weekday in July or August. The hour is not known in advance, so the battery commits a kW it holds through a band of likely peak hours:

| Input | Default | What it does |
|---|---|---|
| Band starts / ends | 15:00 to 18:00 | The hours the commitment is held |
| Days | 10 | The top-priced July and August weekdays it is held on |
| Rate override | blank | Blank uses each month's statement value; enter a $/kW-month to use one value all year |

The step shows the 12 monthly statement rates, what a kW committed all year earns, and the commitment days. The optimiser chooses how many kW to commit; holding more costs bill savings and energy credits in those hours.

> [!TIP]
> A wider band or more days is safer against missing the real peak hour, and costs more to hold. The default band covers the usual summer weekday afternoon peak.

## Behind the meter

- Credits count only on each hour's net injection, after the building's load.
- The battery charges from the grid outside the DRV window only, and does not pass grid power through: exports come from discharge.
- The building moves to standby when the battery is above 1 MW and above 15% of the building's peak, and Rider M hourly supply becomes mandatory when the battery exceeds 115% of the building's load. See [Rate or site](rate.md) and [Supply](supply.md).
- If the battery cannot carry the building's load and still export through every Alternative 3 hour or LSRV event, that commitment is dropped and the results say so.

## Not modelled

- The 25-year Value Stack term: the run is one year, with the rates in force.
- The SC 11 charges: the customer charge is waived when another service class serves the same connection, and stand-alone storage is exempt from the SC 11 contract demand charge for 15 years if it qualifies by the end of 2030.
- **The Wholesale Value Stack**: selling the battery's energy and capacity into the NYISO markets directly, while still taking the DRV and LSRV from Con Edison. It is an alternative to the Value Stack credits modelled here, mainly for stand-alone storage.
- **Remote crediting**: allocating the project's Value Stack credits to other Con Edison accounts. The wizard values every credit on the project's own account.
- **NYSERDA's Retail Storage Incentive**: the upfront incentive for storage up to 5 MW. It is a capital incentive, so it belongs with the capital costs in the financial model rather than in the year's value.