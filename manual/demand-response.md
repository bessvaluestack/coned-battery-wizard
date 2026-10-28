# Demand response

Behind the meter without exports, the **Riders** step enrols the building in Con Edison's demand-response programs. The battery pledges load relief: during an event it lowers what the building takes from the grid. The wizard optimises the bill and the events together in one dispatch, so revenue is never counted twice.

With the Value Stack, programs are part of the election instead: see [Value Stack](value-stack.md).

## The programs

| Program | Rider | Events | Pays |
|---|---|---|---|
| CSRP (Commercial System Relief Program) | Rider T | Planned 4-hour events in the network's Contracted Hours, day-ahead notice, non-holiday weekdays, May to September | A reservation $/kW-month by county group, stepping up from the fifth counted event; $1/kWh performance |
| DLRP (Distribution Load Relief Program) | Rider T | Contingency events of 4 hours, any day, May to September | A reservation by DLRP tier, stepping up at five contingency events; $1/kWh performance |
| Term-DLM | Rider AC | Day-ahead (21 hours) peak calls on weekdays, May to September | Reservation and performance rates from the Program Agreement (pay-as-bid): enter them |
| Auto-DLM | Rider AC | Called at 10 minutes' notice, 8 AM to midnight, any day, May to September | Reservation and performance rates from the Program Agreement: enter them |

Each program needs at least 50 kW per direct participant.

### Combinations

Only the combinations the tariff allows can be enrolled:

- **CSRP + DLRP**
- **Term-DLM + DLRP**
- **Auto-DLM alone**

CSRP and Term-DLM never go together (Rider AC I.2). Ticking a program clears any it cannot be combined with.

Both reservations are paid on the same pledge. When an hour falls in both programs' events, performance is paid once: CSRP over DLRP (Rider T J), and DLRP over Term-DLM (Rider AC I.1).

## Inputs

| Input | What it does |
|---|---|
| Distribution network | The site's network sets the CSRP Contracted Hours, the county group (New York City, or Westchester and Staten Island) for the CSRP rates and the DLRP tier |
| Pledged load relief | The kW pledged. It is entered, never optimised; payment follows what the dispatch delivers |
| Participation | Direct participant, or through an aggregator |
| Events per season | For each enrolled program: CSRP planned events, DLRP contingency events, Term-DLM and Auto-DLM events |
| Term-DLM and Auto-DLM rates | Reservation $/kW-month and performance $/kWh from the Program Agreement |

## How revenue is worked out

- **Delivered relief** is the drop in the building's import during the event below its no-battery load, averaged over each event.
- **The reservation** is paid on the delivered share of the pledge, set by the weakest event: a battery that delivers 80 kW of a 100 kW pledge on its weakest event earns 80% of the reservation.
- **Performance** is paid on the kWh of relief during events.
- Reservations are spread over the Capability Period months in the pro-forma; performance lands in the event months.

The results flag CSRP or DLRP delivering under 80% of the pledge on the weakest event, which falls below the performance the programs expect.

### The cost of holding the battery for events

With a program enrolled, the wizard also solves the year for the bill alone. The results then say what dispatching only for the bill would have saved, so you can see what reserving the battery for events costs on the bill against what the programs pay.

## Demand response only

*Battery use* on the Riders step chooses how the battery is dispatched:

| Battery use | What the battery does |
|---|---|
| Bill and demand response together (the default) | One dispatch cuts the bill and carries the pledge through every event |
| Demand response only | It discharges only in the enrolled programs' events. It charges whenever that costs least; the bill includes the cost of charging and any demand it adds, but the battery never discharges to cut the bill |

Use demand response only to see what the programs alone are worth, or to model a battery operated for demand response and nothing else. It needs at least one program enrolled. The run also solves the bill and demand response together, and the results say how much more that would earn.

> [!TIP]
> A battery that only does demand response cycles a few times a year, so the bill barely moves, and its program revenue can be slightly higher than in the combined dispatch, where events compete with bill savings for the battery's energy. The combined dispatch is usually worth several times more.

> [!WARNING]
> On the Battery step the wizard warns when the battery cannot carry one full event at the pledged kW: when its usable energy is below the pledge times the event hours, divided by the discharge efficiency, or when its power is below the pledge. Lower the pledge or add battery.

## What the model assumes

- Event days are chosen with perfect foresight of prices; the real calls are not known in advance.
- The baseline relief is measured against is the no-battery meter, not Con Edison's customer baseline load (CBL).
- Auto-DLM events are placed in the network's Contracted Hours; the real calls come at 10 minutes' notice between 8 AM and midnight.
