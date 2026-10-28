# Assumptions and limits

The wizard follows Con Edison's filed tariff and published statements, the NY SIR and FDNY guidance as summarised in the tool. It is a screening and planning tool, not a bill, an interconnection study, a permit review or legal advice.

## Analysis

- **One year.** The run is Year 1, at the rates and statements in force. Escalation, the 25-year Value Stack term and capital costs are the pro-forma's job; degradation enters through the [capacity curve](battery.md#the-capacity-curve).
- **Perfect foresight.** The dispatch knows the whole year's load and prices in advance, and demand-response event days are chosen with that knowledge. A real controller earns less.
- **Fixed sizes.** Power and energy are inputs; to compare sizes, run each.
- **Degradation is usable energy only.** The capacity curve keeps power, efficiency and the cycle limit; there is no power or efficiency fade.
- **The load presets are synthetic** multifamily buildings. For a real analysis, scale a preset to the building's bills or upload its interval data.

## Bill

- The capacity charge, the MFC and the MSC adjustment factors are the last 12 statements, one per month; next year's will differ.
- The Rider M capacity tag is applied to each month's maximum demand, where the real tag is the customer's demand at the previous year's system peak. With the Value Stack, the tag is priced on the import in the likely peak hours instead.
- The MSC adjustment factors are taken as non-residential: they include the tax reimbursement recovery.
- Some delivery statements are not in the default per-kWh adjustment: the CES delivery surcharge, the DLM surcharge, EV make-ready and arrears recovery. Add them to the $/kWh override on the [Rate](rate.md#delivery-adjustments-advanced) step if needed.
- Taxes are one editable percentage, 2.5% by default. A commercial SC 9 account generally also pays sales tax; add it if it applies.
- **Reactive power charges** (General Rule 10.11) are not applied.
- **The Minimum Monthly Charge** (General Rule 10.10) is not applied. It covers SC 8 and SC 9 Rates I to III: in a month when the delivery demand and energy charges (with the MAC) come to less than 40% of the per-kW demand delivery charges times the Contract Demand, the highest demand in the last 18 months, the customer pays that minimum instead. Standby rates (IV and V) and Value Stack (Rider R) customers are exempt. It binds only in a month whose demand falls far below the 18-month peak: on the preset buildings, with and without a battery, the minimum stays at 55 to 78% of the charges it would replace. The monthly customer charge is a separate charge and is on every bill.
- **SC 9 Rate I's maximum-rate provision** is not modelled.
- **The size above which Rider M makes hourly pricing mandatory** is not checked: choose the supply the account is on.
- Calendar months stand in for Con Edison's meter-read billing periods.

## Demand response

- Relief is measured against the no-battery meter, not Con Edison's customer baseline load (CBL).
- Auto-DLM events are placed in the network's Contracted Hours; the real calls come at 10 minutes' notice, 8 AM to midnight.
- Term-DLM and Auto-DLM rates are what you enter from the Program Agreement.

## Value Stack

- The SC 11 (Buy-back service) charges are not added: the customer charge is waived when another service class serves the same connection, and stand-alone storage is exempt from the SC 11 contract demand charge for 15 years if it qualifies by the end of 2030.
- Alternative 3 is earned on a kW held through a band of likely peak hours, since the real hour is the previous year's system peak and is not known in advance.
- Not modelled: **the Wholesale Value Stack**, selling the battery's energy and capacity into the NYISO markets directly, while still taking the DRV and LSRV from Con Edison. It is an alternative to the Value Stack credits modelled here, mainly for stand-alone storage.
- Not modelled: **remote crediting**, allocating the project's Value Stack credits to other Con Edison accounts. The wizard values every credit on the project's own account.
- Not counted: **NYSERDA's Retail Storage Incentive**, the upfront incentive for storage up to 5 MW. It is a capital incentive, so it belongs with the capital costs in the financial model rather than in the year's value.
- The standby exemption for storage up to 1 MW is applied to a stand-alone battery's account too.
