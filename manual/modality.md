# Choosing a modality

The first step decides how the battery connects and how it is paid. The rest of the wizard follows the choice: the steps change, and so do the account rules and the revenue streams.

| | Behind the meter, no export | Behind the meter, exporting | Front of the meter (stand-alone) |
|---|---|---|---|
| Account | The building's SC 8 or SC 9 rate | The building's rate, plus Rider R and SC 11 | The battery's own account: SC 2, SC 9 or SC 9 standby |
| Load | The building's | The building's | None |
| Earns | Bill savings, demand response | Bill savings, Value Stack credits, an election of programs | Value Stack credits, less the charging bill |
| Steps | Modality, Rate, Supply, Riders, Load, Battery, Results | Modality, Rate, Supply, Value Stack, Load, Battery, Results | Modality, Site, Supply, Value Stack, Battery, Results |

## Behind the meter, no export

The battery sits behind the building's meter and never sends power back to the grid: a non-export relay or controls keep the meter importing.

- **Account:** the building stays on its SC 8 or SC 9 rate. No Rider R or SC 11, and the battery does not move the building to standby.
- **Revenue:** demand-charge and energy savings on the bill, plus demand response with performance payments: Rider T CSRP and DLRP, or Rider AC Term-DLM or Auto-DLM, in the combinations the tariff allows.
- **Interconnection:** a NY SIR application as a non-exporting system, with a study (CESIR) above 50 kW. Demand response also needs Con Edison's Permission to Operate.
- **Metering:** the existing interval meter; a communicating interval meter for demand response.

This is the right starting point for most buildings: it needs the least paperwork, and demand charges are usually where a building battery earns most.

## Behind the meter, exporting under the Value Stack

The same battery may also export. Exports are credited under Rider R A.9(d) with SC 11 buy-back service, on each hour's **net** injection: what the battery sends out beyond the building's own load in that hour.

- **Account:** the building keeps its rate if the battery is 1 MW or less, or within 15% of the building's peak. Otherwise the building moves to standby service (Rate IV or V of the same class). Rider M hourly supply becomes mandatory when the battery exceeds 115% of the building's load.
- **Revenue:** bill savings, plus Value Stack credits on exports: energy at the day-ahead price plus losses, capacity under Alternative 3, the Demand Reduction Value (DRV) in the network's call window, and LSRV where MW remain. Storage gets no environmental component.
- **Demand response:** an election. Keep the DRV and LSRV, or take Rider T (the DRV and LSRV end for good) or Rider AC (they are suspended for the contract). Rider R customers get the reservation payment only. See [Value Stack](value-stack.md).
- **Interconnection:** a NY SIR exporting application with a CESIR. In New York City's network areas exports may be limited or refused, and hosting capacity is tight.
- **Metering:** a revenue-grade interval meter recording net hourly consumption and injection, at the customer's cost.

## Front of the meter (stand-alone)

A battery with its own Con Edison account and no load of its own. It charges from the grid and exports everything it discharges.

- **Account:** set by the battery's power rating: SC 2 up to 10 kW, SC 9 on standard rates up to 1 MW (storage up to 1 MW is a Designated Technology, General Rule 20.3.2(b)), SC 9 standby above, up to the Value Stack's 5 MW cap. Rider M hourly supply, or a third-party supplier.
- **Revenue:** Value Stack credits less the charging account's bill. Credits are bill credits on the account and can be allocated to other accounts; they are not paid out in cash.
- **Demand response:** the same election as behind the meter with exports. Most front-of-meter batteries in Con Edison's programs are in Auto-DLM.

## What none of them can use

- **Net metering:** an SC 8 or SC 9 building with storage cannot take Phase One net metering; only small SC 1 and SC 2 customers can.
- **The environmental component, the Market Transition Credit and the Community Credit:** storage is not an eligible generator.
- **The Wholesale Value Stack** (energy and capacity sold to NYISO directly) is an alternative for stand-alone storage that this tool does not model.

> [!NOTE]
> The comparison on the Modality step is an outline from Con Edison's tariff (Rider R, Rider T, Rider AC, General Rule 20, SC 11), the NY SIR and FDNY's storage guidance. Check the project's specifics with Con Edison and the authorities having jurisdiction.
