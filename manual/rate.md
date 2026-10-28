# Rate or site

The second step sets the account the bill is calculated on. Behind the meter it is called **Rate** and describes the building's account; for a stand-alone battery it is called **Site** and describes the battery's own charging account.

## Service class

| Service class | Who it serves |
|---|---|
| SC 8 (Multiple Dwellings, Redistribution) | A multiple dwelling that buys at a master meter and redistributes electricity to its residents |
| SC 9 (General - Large) | Commercial and other large accounts not on SC 8, above SC 2's 10 kW |

The class sets the delivery rates, the per-kWh adjustments, the demand surcharges and Con Edison's supply prices and capacity charge. SC 9's demand charges are lower than SC 8's, so the same building saves less with the same battery on SC 9.

## The rates

| Rate | SC 8 | SC 9 | What it is |
|---|:-:|:-:|---|
| I | ✓ | ✓ | Standard service: one all-hours demand charge per month, at summer and other-month prices |
| II | ✓ | ✓ | Mandatory time-of-day above 1,500 kW: weekday 8 AM to 6 PM and 8 AM to 10 PM demand windows plus an all-hours charge. Supply defaults to Rider M hourly pricing |
| III | ✓ | ✓ | Voluntary time-of-day for smaller customers: the Rate II windows at Rate III prices |
| IV | | ✓ | Standby service (General Rule 20) for a building already on standby, for example with on-site generation: a contract demand billed every month, daily as-used demand, Rider M hourly supply |
| V | | ✓ | Standby, as Rate IV, for a contract demand above 1,500 kW |

Rates IV and V are offered as a starting rate on SC 9 only for now. An SC 8 building can still move to standby when an exporting battery triggers it (see below).

The **rate card** at the bottom of the step lists every charge of the selected schedule: the customer charge, energy by season and hour, and each demand charge with its months, days and hours.

### When the rate does not fit the building

Once the load is known, the wizard checks the rate against the building's peak and warns when:

- the peak is above 1,500 kW on Rate I or III: such customers are billed under Rate II;
- the peak is below 900 kW on Rate II: a year below that moves a customer back to Rate I;
- the peak is above 1,500 kW on Rate IV, or within it on Rate V: the contract demand sets which standby rate applies.

The warnings appear on the Rate and Load steps. The wizard still runs the rate you picked.

### With an exporting battery

Behind the meter with exports, the building keeps its standard rate if the battery is 1 MW or less, or within 15% of the building's peak (General Rule 20.3). Otherwise it moves to standby in the same class: Rate IV, or Rate V when the larger of the battery's power and the building's peak is above 1,500 kW. The step shows the account the battery will be billed on. The baseline stays the building's current bill on its standard rate.

> [!NOTE]
> **SC 9 Rate I** carries a maximum-rate provision for some customers. It is not modelled; the step and the results say so.

## Site details

| Input | What it does |
|---|---|
| Service voltage | Low tension (secondary) or high tension (primary); each has its own schedule, shown on the rate card |
| Service area | New York City (NYISO zone J) or Westchester (zone H or I). Sets the supply capacity charge, the LBMP zone, the Alternative 3 rate and the CSRP rate group |
| NYISO zone | Westchester only: H (Millwood) or I (Dunwoodie) |
| Billing demand interval | 15-minute demand (Con Edison's default) or 30-minute integrated demand: the determinant every demand charge bills on |
| Taxes and surcharges | One percentage on delivery and supply, 2.5% by default (see below) |

### Taxes

The default 2.5% stands for the gross-receipts-type surcharges, which are a few percent. Residential redistribution (SC 8) is exempt from sales tax. A commercial SC 9 account generally also pays state and local sales tax, about 8.875% in New York City, while a residential building may be exempt: add the sales tax to the percentage if it applies. Value Stack credits are not taxed here.

### Delivery adjustments (advanced)

Under *Delivery adjustments and surcharges*:

- **Per-kWh adjustments**: the NYSERDA SBC surcharge, the Monthly Adjustment Clause (MAC) and its adjustment factor, the revenue decoupling mechanism (RDM) and the delivery revenue surcharge (SDR) for the class, from the statements in force. Their sum is the default; enter an override to replace it.
- **Other $/kW-month on the monthly maximum**: anything else billed on the monthly peak.
- **SBC demand surcharge**: on by default. It rides the same determinant as the delivery demand charge: the monthly maximum on Rate I, the weekday 8 AM to 10 PM demand on Rates II and III, the contract demand on standby (where it includes the SDR).

Not modelled: reactive power charges (General Rule 10.11), the Minimum Monthly Charge (General Rule 10.10, see [Assumptions and limits](limits.md#bill)) and, with exports, the SC 11 charges. The monthly customer charge is on every bill.

## Site and charging account (stand-alone)

A stand-alone battery's account follows its power rating, set on the [Battery](battery.md) step:

| Battery power | Account |
|---|---|
| Up to 10 kW | SC 2 Rate I |
| Above 10 kW up to 1 MW | SC 9 on standard rates: Rate I, or Rate III if you choose it (storage up to 1 MW is a Designated Technology, General Rule 20.3.2(b)) |
| Above 1 MW | SC 9 standby: Rate IV, or Rate V above 1,500 kW of contract demand |

The Value Stack caps a project at 5 MW. The site details and taxes work as above; the building's service class does not apply.
