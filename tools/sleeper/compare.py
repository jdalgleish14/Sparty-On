"""Compare two site-data directories (for example the Excel export and Sleeper-generated data).

Rows are matched by key, never by position, so cosmetic row-order differences do not show up as
data differences. Differences are classified:

* ``substantive``  : a value, a missing row or an extra row
* ``float_noise``  : numbers equal to within 1e-9 (last-digit floating point differences)
* ``order_only``   : the same rows in a different order (counted, never failing)
"""
import datafiles as df

TOL = 1e-9

# (logical name, key function, only-current-season?) for row tables
TABLES = [
    ("games", lambda r: (r["game_id"], r["owner_id"]), True),
    ("season_summaries", lambda r: (r["year"], r["owner_id"]), True),
    ("current_standings", lambda r: (r["owner_id"],), False),
    ("head_to_head", lambda r: (r["owner_a_id"], r["owner_b_id"]), False),
    ("owner_careers", lambda r: (r["owner_id"],), False),
    ("ai_games", lambda r: (r["year"], r["week"], r["owner"]), True),
    ("ai_all_games", lambda r: (r["year"], r["stage"], str(r["week_or_round"]), r["owner"]), True),
    ("ai_seasons", lambda r: (r["year"], r["owner"]), True),
    ("ai_league_years", lambda r: (r["year"],), True),
]


def _near(a, b):
    return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) <= TOL * max(1.0, abs(a), abs(b))


def _table_diff(name, rows_a, rows_b, key):
    ka = {key(r): r for r in rows_a}
    kb = {key(r): r for r in rows_b}
    out = {"table": name, "rows_a": len(ka), "rows_b": len(kb), "identical": 0, "float_noise": [],
           "substantive": [], "missing_in_b": sorted(map(str, set(ka) - set(kb))),
           "extra_in_b": sorted(map(str, set(kb) - set(ka))), "order_only": False}
    for k in sorted(set(ka) & set(kb), key=str):
        ra, rb = ka[k], kb[k]
        if list(ra) != list(rb):
            out["substantive"].append((str(k), "field list", list(ra), list(rb)))
            continue
        row_ok = True
        for f in ra:
            if ra[f] == rb[f] and type(ra[f]) is type(rb[f]):
                continue
            row_ok = False
            same_number = ra[f] == rb[f] or _near(ra[f], rb[f])   # e.g. 1 vs 1.0, or last-digit noise
            (out["float_noise"] if same_number else out["substantive"]).append((str(k), f, ra[f], rb[f]))
        out["identical"] += row_ok
    common_a = [key(r) for r in rows_a if key(r) in kb]
    common_b = [key(r) for r in rows_b if key(r) in ka]
    out["order_only"] = common_a != common_b
    return out


def compare_dirs(dir_a, dir_b, whole_history=False):
    """Compare A (baseline, usually the Excel export) with B (candidate)."""
    a, b = df.load(dir_a), df.load(dir_b)
    year = [s for s in a.site["seasons"] if s["status"] == "Current"][0]["year"]
    cut_a = a.site["league"]["current_season_through_week"]
    cut_b = b.site["league"]["current_season_through_week"]
    result = {"year": year, "cutoff_a": cut_a, "cutoff_b": cut_b, "tables": [], "notes": [], "records": None}
    same_cutoff = cut_a == cut_b
    through = min(cut_a, cut_b)
    if not same_cutoff:
        result["notes"].append(
            f"Cutoffs differ (baseline week {cut_a}, candidate week {cut_b}). Per-game rows are compared for weeks 1-{through}; "
            "season totals, standings, head-to-head, careers, records and Ask Sparty season tables are only comparable at the same week, so they are skipped.")

    def week_of(r):
        return r.get("week") if "week" in r else r.get("week_or_round")

    for name, key, current_only in TABLES:
        ra, rb = a[name] if name in a.objs else None, b[name] if name in b.objs else None
        if not same_cutoff and name not in ("games", "ai_games", "ai_all_games"):
            continue
        if current_only and not whole_history:
            ra = [r for r in ra if r.get("year") == year]
            rb = [r for r in rb if r.get("year") == year]
        if not same_cutoff:
            ra = [r for r in ra if not (r.get("year") == year and isinstance(week_of(r), int) and week_of(r) > through)]
            rb = [r for r in rb if not (r.get("year") == year and isinstance(week_of(r), int) and week_of(r) > through)]
        result["tables"].append(_table_diff(name, ra, rb, key))
    if same_cutoff:
        ra_rec = {k: [(g["game_id"], g["owner_id"]) for g in v] for k, v in a.site["records"].items()}
        rb_rec = {k: [(g["game_id"], g["owner_id"]) for g in v] for k, v in b.site["records"].items()}
        result["records"] = {k: ra_rec[k] == rb_rec[k] for k in ra_rec}
        result["validation_counts_equal"] = a["validation_report"]["counts"] == b["validation_report"]["counts"]
    return result


def has_substantive(result):
    if any(t["substantive"] or t["missing_in_b"] or t["extra_in_b"] for t in result["tables"]):
        return True
    if result.get("records") and not all(result["records"].values()):
        return True
    return result.get("validation_counts_equal") is False


def to_markdown(result, label_a="Excel export", label_b="Sleeper-generated"):
    lines = [f"### {label_a} vs {label_b}", "",
             f"Season {result['year']} · {label_a}: through week {result['cutoff_a']} · {label_b}: through week {result['cutoff_b']}", ""]
    for note in result["notes"]:
        lines += [f"> {note}", ""]
    lines += ["| Table | Rows compared | Identical | Float noise (≤1e-9) | Differences | Missing | Extra | Row order |",
              "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for t in result["tables"]:
        lines.append(f"| {t['table']} | {t['rows_a']} | {t['identical']} | {len(t['float_noise'])} | {len(t['substantive'])} | "
                     f"{len(t['missing_in_b'])} | {len(t['extra_in_b'])} | {'differs' if t['order_only'] else 'same'} |")
    if result["records"] is not None:
        ok = all(result["records"].values())
        lines += ["", f"Record leaderboards (top 25 each): {'identical' if ok else 'DIFFERENT: ' + ', '.join(k for k, v in result['records'].items() if not v)}"]
    detail = [(t["table"], d) for t in result["tables"] for d in t["substantive"]][:25]
    if detail:
        lines += ["", "**Differences (first 25):**", "", "| Table | Row | Field | " + label_a + " | " + label_b + " |", "| --- | --- | --- | --- | --- |"]
        for table, (k, f, va, vb) in detail:
            lines.append(f"| {table} | {k} | {f} | {va} | {vb} |")
    for t in result["tables"]:
        if t["missing_in_b"] or t["extra_in_b"]:
            lines += ["", f"{t['table']}: missing in {label_b}: {t['missing_in_b'][:10]} · extra in {label_b}: {t['extra_in_b'][:10]}"]
    lines += ["", "Result: **" + ("DIFFERENCES FOUND" if has_substantive(result) else "no substantive differences") + "**"]
    return "\n".join(lines) + "\n"
