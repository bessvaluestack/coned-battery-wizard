# Supply

Con Edison's delivery charges are billed separately from the energy itself. The **Supply** step sets who supplies the energy and at what price. The battery's value depends on the shape of the $/kWh over the day and on any capacity charge.

## The four options

| Option | Energy price | Capacity |
|---|---|---|
| Con Edison full service (Market Supply Charge) | The observed MSC for the account's class and rate, by billing period over the last 12 months, laid onto the model year | The MSC capacity charge, $/kW-month on the monthly maximum demand |
| Con Edison full service, Rider M hourly pricing | NYISO day-ahead LBMP for the zone, hour by hour | The Rider M capacity tag, $/kW-month |
| Third-party supply, fixed $/kWh | A flat contract price | An optional separate $/kW-month |
| Third-party supply, LBMP + adder | Day-ahead LBMP plus a fixed adder | An optional separate $/kW-month |

Con Edison's options also carry the merchant function charge and the MSC adjustment factors, both at the statement value unless you enter your own.

### Con Edison full service (MSC)

- **Rate I** prices every hour at the period's all-hours MSC. **Rates II and III** use the on-peak MSC in the time-of-day windows and the off-peak MSC outside them.
- SC 8 and SC 9 each have their own MSC series and capacity charge; the step shows the statement values for the account's class, rate and service area.
- The capacity charge is one monthly statement value applied to every month's maximum demand. The real charge runs higher in summer.

> [!NOTE]
> Rider M makes hourly pricing mandatory above a size it sets; the wizard does not check that. If the account is on Rider M, choose hourly pricing.

### Rider M hourly pricing

Energy at the zone's day-ahead LBMP each hour. The capacity charge is the Rider M tag statement value:

- **with the Value Stack**, it is billed every month on the most the account imports during the likely NYISO peak hours (the Alternative 3 band on the [Value Stack](value-stack.md) step), which is how the tag is set;
- **otherwise** it is applied to each month's maximum demand, a simplification of the tag.

### Third-party supply

For an ESCO contract. With a fixed price the battery earns only on delivery demand charges and any separate capacity charge; with LBMP plus an adder it can also shift energy to cheaper hours.

## When hourly pricing is mandatory

The wizard forces Rider M (an ESCO remains an alternative) where the tariff requires it:

- for standby customers (Rates IV and V);
- for a stand-alone battery;
- behind the meter with exports, when the battery exceeds 115% of the building's load.

The option for the MSC is then disabled, with a note saying why.

Picking **Rate II** on the Rate step switches the supply to Rider M by default, since Rate II customers are normally on it. The MSC stays selectable: the TOD series is the Rider M exempt case.

## Supply as modelled

The card at the bottom summarises what the run will use: where the prices come from, the average energy price, the capacity charge and, for hourly pricing, the zone's average LBMP. The chart shows the average supply price by month.
