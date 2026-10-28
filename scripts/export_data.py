#!/usr/bin/env python
"""One-time exporter: pull the Con Edison SC 8 / SC 9 inputs out of the
reference engine's repo (the upstream tariff model) into plain JSON files
this static app can fetch.

    <engine-repo>/.venv/bin/python scripts/export_data.py --source <engine-repo>

Writes into data/:
  tariffs_sc8.json    the six compiled SC 8 schedules (Rate I/II/III x LT/HT)
                      plus the standby Rates IV / V
  statements.json     surcharges + utility supply components (SBC, MAC, RDM,
                      SDR, MSC capacity by service class, MFC, MSC adjustment
                      factors), the supply ones also month by month from
                      scripts/supply_statements.json
  msc.json            observed Market Supply Charge, daily $/kWh laid onto
                      the model year (codes 008CNV / 008TOD for SC 8,
                      009CNV / 009TOD for SC 9, zones J/H/I, windows all /
                      on_peak / off_peak)
  lbmp_<Z>.json       NYISO day-ahead zonal LBMP, 8,760 hourly $/MWh on the
                      model year, zones J, H, I
  programs.json       Rider T (CSRP / DLRP) and Rider AC (Term-DLM) terms +
                      the network table (Contracted Hours, DLRP tier, group)
  tariffs_sc9.json    SC 9 Rates I / II / III (compiled) and the standby Rates IV / V
  tariffs_sc2.json    SC 2 Rate I (the charging account of a battery of 10 kW or less)
  value_stack.json    Rider R Value Stack terms: loss factor, Alternative 3 by
                      month, DRV rate and call window by network, LSRV

Every file records its provenance (book vintage, dataset vintage, source
file) so the app can print it next to the numbers.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "data"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="path to the reference engine repo")
    args = ap.parse_args()
    repo = Path(args.source).resolve()
    if not (repo / "app").is_dir():
        sys.exit(f"reference engine repo not found at {repo}")
    sys.path.insert(0, str(repo))
    import os
    os.chdir(repo)  # app.config resolves config/ relative to the repo

    import numpy as np
    import pandas as pd
    import yaml

    from app.tariffs.msc_lookup import daily_mean, load_series, load_vintage, onto_model_year
    from app.tariffs.vder import load_lbmp
    from app.timeidx import year_index

    OUT.mkdir(parents=True, exist_ok=True)

    # ---- tariffs ---------------------------------------------------------
    tariffs = {}
    for f in sorted((repo / "config" / "tariffs").glob("corpus_ced_sc8_rate[123]_*.yaml")):
        t = yaml.safe_load(f.read_text())
        tariffs[t["id"]] = {
            "id": t["id"], "name": t["name"], "service_class": t["service_class"],
            "applicability": t.get("applicability"), "rate_basis": t.get("rate_basis"),
            "fixed_charge_per_month": t.get("fixed_charge_per_month", 0.0),
            "energy": t["energy"], "demand": t.get("demand"),
            "book_vintage": t.get("book_vintage"), "conversion_notes": t.get("conversion_notes"),
            "unmodelled": t.get("unmodelled"), "lineage": t.get("lineage"),
            "source_file": f"config/tariffs/{f.name}",
        }
    # Standby (General Rule 20) schedules are extracted in the book but not
    # compiled: lay them out in the same form, with the contract demand as a
    # yearly determinant and the as-used demands as daily ones.
    book = json.loads((repo / "config" / "tariff_db" / "ny" / "ced" / "books" / "ny.ced.psc10_2026-08-01.json").read_text())
    schedules = {s["id"]: s for s in book["schedules"]}
    all_months = list(range(1, 13))

    def standby(book_id: str, out_id: str, service_class: str) -> dict:
        s = schedules[book_id]
        charges = []
        for d in s["demand"]:
            w = d.get("window") or {}
            if d["determinant"] == "contract_demand_kw":
                charges.append({"name": "contract_demand", "rate": d["rate"]["value"], "months": all_months,
                                "days": "all", "period": "year", "determinant": "contract_demand_kw",
                                "lineage": [d["id"]]})
            elif d["determinant"] == "daily_as_used_demand_kw":
                h = w.get("hours")
                charges.append({"name": f"as_used_{'summer' if w.get('months') == [6, 7, 8, 9] else 'other'}_{h[0]}_{h[1]}",
                                "rate": d["rate"]["value"], "months": w.get("months") or all_months,
                                "days": w.get("days") or "all", "hours": h, "period": "day",
                                "determinant": "daily_as_used_demand_kw", "lineage": [d["id"]]})
            else:
                raise SystemExit(f"{book_id}: unexpected determinant {d['determinant']}")
        doc = s["customer_charge"]["source"]["anchor"]["document_id"]
        return {
            "id": out_id, "name": s["name"], "service_class": service_class, "standby": True,
            "applicability": (s.get("applicability") or {}).get("text", {}).get("value"),
            "rate_basis": "delivery_only", "fixed_charge_per_month": s["customer_charge"]["value"],
            "energy": {"units": "usd_per_kwh", "seasons": [{"name": "all_year", "months": all_months,
                       "tou": [{"name": "all_hours", "days": "all", "rate": 0.0}]}]},
            "demand": {"units": "usd_per_kw_month or usd_per_kw_day (period: day)", "charges": charges},
            "book_vintage": book["book"].get("vintage") if isinstance(book.get("book"), dict) else None,
            "lineage": [doc], "source_file": f"config/tariff_db/ny/ced/books/ny.ced.psc10_2026-08-01.json#{book_id}",
        }

    def compiled(pattern: str) -> dict:
        out = {}
        for f in sorted((repo / "config" / "tariffs").glob(pattern)):
            t = yaml.safe_load(f.read_text())
            out[t["id"]] = {
                "id": t["id"], "name": t["name"], "service_class": t["service_class"],
                "applicability": t.get("applicability"), "rate_basis": t.get("rate_basis"),
                "fixed_charge_per_month": t.get("fixed_charge_per_month", 0.0),
                "energy": t["energy"], "demand": t.get("demand"),
                "book_vintage": t.get("book_vintage"), "conversion_notes": t.get("conversion_notes"),
                "unmodelled": t.get("unmodelled"), "lineage": t.get("lineage"),
                "source_file": f"config/tariffs/{f.name}",
            }
        return out

    # "All other Customers" leaves: new standby customers, not the phase-in ones.
    for book_id, out_id in [("ny.ced.psc10.sc8.rate4.lt", "corpus_ced_sc8_rate4_lt"), ("ny.ced.psc10.sc8.rate4.ht", "corpus_ced_sc8_rate4_ht"),
                            ("ny.ced.psc10.sc8.rate5.lt", "corpus_ced_sc8_rate5_lt"), ("ny.ced.psc10.sc8.rate5.ht_below138", "corpus_ced_sc8_rate5_ht")]:
        tariffs[out_id] = standby(book_id, out_id, "SC 8")
    (OUT / "tariffs_sc8.json").write_text(json.dumps(tariffs, indent=1))
    print("tariffs:", list(tariffs))

    sc9 = compiled("corpus_ced_sc9_rate[123]_*.yaml")
    for book_id, out_id in [("ny.ced.psc10.sc9.rate4.lt.leaf452_2", "corpus_ced_sc9_rate4_lt"), ("ny.ced.psc10.sc9.rate4.ht.leaf452_2", "corpus_ced_sc9_rate4_ht"),
                            ("ny.ced.psc10.sc9.rate5.lt", "corpus_ced_sc9_rate5_lt"), ("ny.ced.psc10.sc9.rate5.ht_below138", "corpus_ced_sc9_rate5_ht")]:
        sc9[out_id] = standby(book_id, out_id, "SC 9")
    (OUT / "tariffs_sc9.json").write_text(json.dumps(sc9, indent=1))
    print("tariffs sc9:", list(sc9))
    sc2 = compiled("corpus_ced_sc2_rate1.yaml")
    (OUT / "tariffs_sc2.json").write_text(json.dumps(sc2, indent=1))
    print("tariffs sc2:", list(sc2))

    # ---- statements ------------------------------------------------------
    sup = yaml.safe_load((repo / "config" / "supply" / "ny.ced.psc10.yaml").read_text())
    st = sup["statements"]

    def pick(kind: str, key: str) -> float | None:
        for e in st.get(kind) or []:
            if e.get("key") == key:
                return float(e["value"])
        return None

    S = repo / "config" / "tariff_db" / "ny" / "ced" / "statements" / "ny.ced.psc10"

    def stmt_rows(code: str) -> tuple[dict, list[dict]]:
        f = sorted((S / code).glob("*.json"))[-1]
        d = json.loads(f.read_text())
        s = (d.get("statements") or [{}])[0]
        return {"file": f.name, "name": s.get("name"), "effective": s.get("effective")}, s.get("rows") or []

    def row_value(rows: list[dict], id_suffix: str) -> float | None:
        for r in rows:
            if str(r.get("id", "")).endswith(id_suffix):
                return float(r["rate"]["value"])
        return None

    sbc_meta, sbc_rows = stmt_rows("SBC")
    rdm_meta, rdm_rows = stmt_rows("RDM")
    sdr_meta, sdr_rows = stmt_rows("SDR")
    mac_meta, mac_rows = stmt_rows("MAC")
    macadj_meta, macadj_rows = stmt_rows("MAC_ADJ")

    statements = {
        "book_vintage": sup.get("book_vintage"), "in_force_on": sup.get("in_force_on"),
        "status": sup.get("status"),
        "delivery_adjustments_usd_per_kwh": {
            "sbc_total_nyserda": {"value": row_value(sbc_rows, "total_nyserda_sbc_surcharge.kwh"),
                                   "statement": sbc_meta, "applies": "all SCs"},
            "mac": {"value": row_value(mac_rows, "all_except_sc_11.kwh"), "statement": mac_meta,
                    "applies": "all except SC 11"},
            "mac_adjustment_factor": {"value": row_value(macadj_rows, "mac_adj.all.kwh"),
                                      "statement": macadj_meta, "applies": "all"},
            "rdm_sc8": {"value": row_value(rdm_rows, "rdm.sc_8.kwh"), "statement": rdm_meta,
                        "applies": "SC 8"},
            "sdr_sc8_rates_i_ii_iii": {"value": row_value(sdr_rows, "sc_8_rates_i_ii_and_iii.kwh"),
                                       "statement": sdr_meta, "applies": "SC 8 Rates I, II, III"},
        },
        "delivery_adjustments_usd_per_kw_month": {
            "sbc_sc8_rate_i_monthly_max": {"value": row_value(sbc_rows, "sc_8_rate_i.monthly_max_demand_kw.n3"),
                                            "statement": sbc_meta, "determinant": "monthly_max_demand_kw"},
            "sbc_sc8_rates_ii_iii_tod": {"value": row_value(sbc_rows, "sc_8_rates_ii_and_iii.total.tod_demand_kw"),
                                          "statement": sbc_meta, "determinant": "tod_demand_kw",
                                          "window": {"days": "weekdays", "hours": [8, 22], "months": list(range(1, 13))}},
        },
        "msc_capacity_usd_per_kw_month": {
            "note": "Statement of Market Supply Charge - Capacity (one monthly statement, not a 12-month profile); billed on the monthly maximum demand of full-service customers",
            **{area: {**{f"sc{sc}": {f"rate{n}": pick("MSC CAP", f"sc{sc}_rate_{roman}_{area}") for n, roman in ((1, "i"), (2, "ii"), (3, "iii"))}
                         for sc in (8, 9)},
                      "rider_m_icap_tag": pick("MSC CAP", f"rider_m_icap_tag_{area}")} for area in ("nyc", "westchester")},
        },
        "merchant_function_charge_usd_per_kwh": {
            "scs5_6_8_9_12_13_total": pick("MFC", "scs5_6_8_9_12_13_total_merchant_function_charge_all"),
            "components": {
                "supply_related": pick("MFC", "scs5_6_8_9_12_13_supply_related_charge_all"),
                "credit_and_collection": pick("MFC", "scs5_6_8_9_12_13_credit_and_collection_related_charge_all"),
                "uncollectible_bill_expense": pick("MFC", "scs5_6_8_9_12_13_uncollectible_bill_expense_msc_all"),
                "transition_adjustment": pick("MFC", "scs5_6_8_9_12_13_transition_adjustment_all"),
            },
        },
        "msc_adjustment_factors_usd_per_kwh": {
            "note": "Statement of Adjustment Factors - MSC: month-specific reconciliation factors; the app defaults them to zero and shows these values",
            "reconciliation_all_other_nonresidential": {"nyc": pick("MSC ADJ", "msc_reconciliation_all_other_nonresidential_nyc"),
                                                         "westchester": pick("MSC ADJ", "msc_reconciliation_all_other_nonresidential_westchester")},
            "reconciliation_rider_m_nonresidential": {"nyc": pick("MSC ADJ", "msc_reconciliation_rider_m_nonresidential_nyc"),
                                                       "westchester": pick("MSC ADJ", "msc_reconciliation_rider_m_nonresidential_westchester")},
            "tax_reimbursement_recovery_nonresidential": pick("MSC ADJ", "tax_reimbursement_recovery_provision_nonresidential_nyc"),
        },
        "indexed_not_compiled": sup.get("indexed_not_compiled"),
    }

    def demand_row(rows: list[dict], id_suffix: str) -> float | None:
        # Demand surcharges print a non-LMI line, an LMI line (.n2) and the total (.n3).
        return row_value(rows, id_suffix + ".n3") if row_value(rows, id_suffix + ".n3") is not None else row_value(rows, id_suffix)

    # Per service class, for the accounts a Value Stack battery charges on:
    # $/kWh adjustments (on top of the NYSERDA SBC and the MAC) and $/kW
    # adjustments keyed by the determinant they ride on.
    statements["by_class"] = {
        "sc2": {"kwh": {"rdm": row_value(rdm_rows, "rdm.sc_2.kwh"), "sdr": row_value(sdr_rows, "sc_2_rates_i_ii_and_rider_aa.kwh"),
                        "sbc_company_ee": row_value(sbc_rows, "sc_2_rates_i_and_ii.total_company_administered_ee_be_charge.kwh")},
                "kw": {}, "mfc": pick("MFC", "sc2_total_merchant_function_charge_all")},
        "sc8": {"kwh": {"rdm": row_value(rdm_rows, "rdm.sc_8.kwh"), "sdr": row_value(sdr_rows, "sc_8_rates_i_ii_and_iii.kwh")},
                "kw": {"rate1": {"monthly_max_demand_kw": demand_row(sbc_rows, "sc_8_rate_i.monthly_max_demand_kw")},
                       "tod": {"tod_demand_kw": demand_row(sbc_rows, "sc_8_rates_ii_and_iii.total.tod_demand_kw")},
                       "standby": {"contract_demand_kw": (demand_row(sbc_rows, "sc_8_rates_iv_and_v.contract_demand_kw") or 0)
                                   + (row_value(sdr_rows, "sc_8_rates_iv_and_v.contract_demand_kw") or 0)}},
                "mfc": pick("MFC", "scs5_6_8_9_12_13_total_merchant_function_charge_all")},
        "sc9": {"kwh": {"rdm": row_value(rdm_rows, "rdm.sc_9.kwh"), "sdr": row_value(sdr_rows, "sc_9_rates_i_ii_and_iii.kwh")},
                "kw": {"rate1": {"monthly_max_demand_kw": demand_row(sbc_rows, "sc_9_rate_i.monthly_max_demand_kw")},
                       "tod": {"tod_demand_kw": demand_row(sbc_rows, "sc_9_rates_ii_and_iii.total.tod_demand_kw")},
                       "standby": {"contract_demand_kw": (demand_row(sbc_rows, "sc_9_rates_iv_and_v.contract_demand_kw") or 0)
                                   + (row_value(sdr_rows, "sc_9_rates_iv_and_v.contract_demand_kw") or 0)}},
                "mfc": pick("MFC", "scs5_6_8_9_12_13_total_merchant_function_charge_all")},
        "note": "Standby contract-demand adjustments are the SBC and SDR contract-demand rows; standby schedules carry no SDR $/kWh.",
    }
    # The supply statements month by month (scripts/supply_statements.json,
    # read from Con Edison's PDFs): the latest issue for each calendar month
    # of the MSC capacity charge, the merchant function charge and the MSC
    # adjustment factors, so each model month is billed at its own values.
    sup_hist = json.loads((HERE / "supply_statements.json").read_text())

    def by_month(rows: list[dict]) -> list[dict]:
        out = {}
        for r in sorted(rows, key=lambda r: r["effective"]):
            out[int(r["effective"][5:7])] = r
        if sorted(out) != list(range(1, 13)):
            sys.exit(f"supply statements cover months {sorted(out)}; all twelve are needed")
        return [out[m] for m in range(1, 13)]

    cap, mfc, adj = by_month(sup_hist["msc_capacity"]), by_month(sup_hist["mfc"]), by_month(sup_hist["msc_adjustment"])
    areas = ("nyc", "westchester")
    statements["monthly"] = {
        "effective": {"msc_capacity": [r["effective"] for r in cap], "mfc": [r["effective"] for r in mfc], "msc_adjustment": [r["effective"] for r in adj]},
        "msc_capacity_usd_per_kw_month": {a: {**{f"sc{sc}": {f"rate{n}": [r[f"sc{sc}"][a][f"rate{n}"] for r in cap] for n in (1, 2, 3)} for sc in (8, 9)},
                                              "rider_m_icap_tag": [r["rider_m_icap_tag"][a] for r in cap]} for a in areas},
        "mfc_usd_per_kwh": {"sc2": [r["sc2_total"] for r in mfc], "scs5_6_8_9_12_13": [r["scs5_6_8_9_12_13_total"] for r in mfc]},
        "msc_adjustment_usd_per_kwh": {k: {a: [r[k][a] for r in adj] for a in areas}
                                       for k in ("reconciliation_all_other", "reconciliation_would_be_rider_m", "tax_reimbursement_recovery_nonresidential")},
        "capacity_windows_rates_ii_iii": [{"months": [6, 7, 8, 9], "days": "weekdays", "hours": [8, 18]},
                                          {"months": [1, 2, 3, 4, 5, 10, 11, 12], "days": "weekdays", "hours": [8, 22]}],
    }
    (OUT / "statements.json").write_text(json.dumps(statements, indent=1))
    print("statements written")

    # ---- MSC lookup (daily) ---------------------------------------------
    vin = load_vintage()
    if vin is None:
        sys.exit("no MSC vintage vendored in the reference engine")
    daily_idx = year_index(interval_min=1440)
    msc = {"vintage": vin["vintage"], "document_id": vin["manifest"].get("document_id"),
           "date_range": vin["manifest"].get("date_range"), "lookback_months": 12,
           "model_year_days": len(daily_idx), "codes": {}}
    for code in ("008CNV", "008TOD", "009CNV", "009TOD"):
        series = load_series(vin["dir"], code)
        zones = {}
        for zone in ("J", "H", "I"):
            zd = (series.get("zones") or {}).get(zone) or {}
            wins = {}
            info_any = None
            for win in ("all", "on_peak", "off_peak"):
                entries = (zd.get(win) or {}).get("lt") or []
                dm, info = daily_mean(entries, lookback_months=12, max_period_days=35)
                info_any = info
                wins[win] = [round(float(x), 6) for x in onto_model_year(dm, daily_idx)]
            zones[zone] = {"windows": wins, "lookback": {k: info_any.get(k) for k in ("from", "to", "periods")}}
        msc["codes"][code] = {"description": vin["codes"][code]["description"], "zones": zones}
    (OUT / "msc.json").write_text(json.dumps(msc))
    print("msc written")

    # ---- LBMP (hourly, model year) --------------------------------------
    hidx = year_index(interval_min=60)
    for zone in ("J", "H", "I"):
        vals, source = load_lbmp(zone, hidx)
        src_file = repo / "data" / "lbmp" / f"{zone}.csv"
        span = None
        if src_file.exists():
            df = pd.read_csv(src_file)
            span = [str(df.iloc[0, 0]), str(df.iloc[-1, 0])]
        (OUT / f"lbmp_{zone}.json").write_text(json.dumps({
            "zone": zone, "source": source, "source_span": span, "units": "usd_per_mwh",
            "model_year": int(hidx[0].year), "hourly": [round(float(v), 2) for v in vals]}))
        print("lbmp", zone, source, span, "avg", round(float(np.mean(vals)), 2))

    # ---- programs + networks --------------------------------------------
    pg = yaml.safe_load((repo / "config" / "programs" / "ny.ced.psc10.yaml").read_text())
    keep = ("name", "rider", "option", "season", "days", "exclude_holidays", "min_kw", "events",
            "rates_in_tariff", "reservation_rate_key", "reservation_rates", "performance_rates",
            "performance_factor_initial")
    programs = {"book_vintage": pg.get("book_vintage"), "status": pg.get("status"),
                "in_force_on": pg.get("in_force_on"),
                "programs": {k: {kk: v.get(kk) for kk in keep} for k, v in pg["programs"].items()
                             if k in ("csrp", "dlrp", "term_dlm", "auto_dlm")},
                "networks": pg["networks"], "networks_source": pg.get("networks_source"),
                "notes": pg.get("notes")}
    (OUT / "programs.json").write_text(json.dumps(programs, indent=1))
    print("programs written:", len(pg["networks"]), "networks")

    # ---- Value Stack (Rider R Phase Two) --------------------------------
    # Component terms and the DRV call window by network from the compiled
    # compensation file; the monthly rates from the twelve statements in
    # scripts/value_stack_statements.json (read from Con Edison's PDFs).
    comp = yaml.safe_load((repo / "config" / "compensation" / "ny.ced.psc10.yaml").read_text())
    vs_hist = json.loads((HERE / "value_stack_statements.json").read_text())
    c = comp["components"]
    stmts = sorted(vs_hist["statements"], key=lambda r: r["effective"])
    latest = stmts[-1]
    by_month = {}
    for r in stmts:  # the latest statement for each calendar month
        by_month[int(r["effective"][5:7])] = r
    drv = c["drv"]
    value_stack = {
        "book_vintage": comp.get("book_vintage"), "status": comp.get("status"),
        "loss_factor": vs_hist["loss_factor"]["value"], "loss_factor_note": vs_hist["loss_factor"]["note"],
        "region_zones": comp["region_zones"],
        "energy": {"basis": "NYISO day-ahead hourly zonal LBMP x loss factor, on each hour's net injection"},
        "alt3": {"unit": "USD/kW-month",
                 "by_month": {str(m): {"nyc": r["alt3_usd_per_kw_month"]["nyc"], "westchester": r["alt3_usd_per_kw_month"]["westchester"],
                                       "statement": r["no"], "effective": r["effective"]} for m, r in sorted(by_month.items())},
                 "peak_hour": "the New York Control Area peak hour of the previous calendar year, on a non-holiday weekday in July or August"},
        "drv": {"rate": latest["drv_usd_per_kwh"], "unit": "USD/kWh", "date_range": drv["window"]["date_range"],
                "days": drv["window"]["days"], "exclude_holidays": drv["window"]["exclude_holidays"],
                "call_windows": [w["hours"] for w in drv["call_windows"]],
                "window_by_network": {n: w["hours"] for n, w in sorted(drv["window_by_network"].items())},
                "fixed_years": 10},
        "lsrv": {"rate": latest["lsrv_usd_per_kw_year"], "unit": "USD/kW-year", "min_events": 10, "max_event_hours": 4,
                 "date_range": ["06-24", "09-15"], "days": "weekdays",
                 "mw_remaining": vs_hist["lsrv_mw_remaining"]["locations"],
                 "mw_remaining_statement": vs_hist["lsrv_mw_remaining"]["statement"], "fixed_years": 10},
        "environmental": {"rate": latest["environmental_usd_per_kwh"], "storage_eligible": False},
        "statements": [{"no": r["no"], "effective": r["effective"], "source": r["source"]} for r in stmts],
    }
    (OUT / "value_stack.json").write_text(json.dumps(value_stack, indent=1))
    print("value stack written: alt3 months", sorted(by_month), "drv networks", len(value_stack["drv"]["window_by_network"]))


if __name__ == "__main__":
    main()
