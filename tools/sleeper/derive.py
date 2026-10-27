"""Pure derivation of every published table from regular-season/postseason game rows.

Each function reproduces, exactly, what the Excel export publishes. The definitions here were
established by recomputing every committed file from ``games.json`` and requiring a perfect
match (see tests/test_golden.py). Nothing here invents a metric: if a definition cannot be
reproduced it is not implemented, and the corresponding file stays on the Excel export.
"""
from collections import defaultdict

ROUND_ORDER = {"Quarterfinal": 1, "Semifinal": 2, "Championship": 3}
# ai_* files write integral numbers as ints; matchup_total is the one field kept as a float.
AI_KEEP_FLOAT = {"matchup_total"}


def ssum(values):
    """Plain left-to-right float addition, as the Excel pipeline does.

    Python 3.12+ ``sum()`` uses compensated summation, which differs from the exporter in the
    last digits, so every statistic that feeds a published float uses this helper instead.
    """
    total = 0.0
    for v in values:
        total += v
    return total


def sample_std(values):
    """Sample standard deviation using the exporter's one-pass formula.

    ``(sum(v*v) - mean*mean*n) / (n-1)`` reproduces the published ``score_std_dev`` bit-for-bit
    for all 166 historical owner-seasons; the textbook two-pass form differs in the last digits.
    """
    n = len(values)
    mean = ssum(values) / n
    return ((ssum(v * v for v in values) - mean * mean * n) / (n - 1)) ** 0.5


def extreme_mean(values, k, top):
    """Mean of the k highest (or lowest) scores, summed in week order like the exporter."""
    order = sorted(range(len(values)), key=lambda i: (-values[i], i) if top else (values[i], i))
    chosen = set(order[:k])
    picked = [values[i] for i in range(len(values)) if i in chosen]
    return ssum(picked) / len(picked)


def ai_num(field, value):
    if isinstance(value, float) and value == int(value) and field not in AI_KEEP_FLOAT:
        return int(value)
    return value


def ai_row(pairs):
    """Build an ordered dict from (field, value) pairs applying the ai_* number convention."""
    return {k: ai_num(k, v) for k, v in pairs}


# ----------------------------------------------------------------------------------------
# Season summaries / standings
# ----------------------------------------------------------------------------------------
def regular_rows(games, year):
    return [g for g in games if g["year"] == year and g["stage"] == "Regular Season"]


def season_summary_rows(games, season, owners, status):
    """One row per owner for the season, sorted by owner_id (rank added for the current year)."""
    year = season["year"]
    acc = {}
    for g in sorted(regular_rows(games, year), key=lambda g: g["week"]):
        a = acc.setdefault(g["owner_id"], {"gp": 0, "w": 0, "l": 0, "t": 0, "pf": 0.0, "pa": 0.0, "team": None})
        a["gp"] += 1
        a["w"] += g["result"] == "W"
        a["l"] += g["result"] == "L"
        a["t"] += g["result"] == "T"
        a["pf"] += g["points_for"]
        a["pa"] += g["points_against"]
        a["team"] = g["team"]
    rows = []
    for owner_id in sorted(acc):
        a = acc[owner_id]
        rows.append({
            "season_id": season["season_id"], "year": year, "owner_id": owner_id, "team": a["team"],
            "games_played": a["gp"], "wins": a["w"], "losses": a["l"], "ties": a["t"],
            "points_for": round(a["pf"], 2), "points_against": round(a["pa"], 2),
            "average_points_for": round(a["pf"] / a["gp"], 2),
            "average_points_against": round(a["pa"] / a["gp"], 2),
            "average_margin": round((a["pf"] - a["pa"]) / a["gp"], 2),
            "season_status": status,
        })
    if status == "Current":
        order = sorted(rows, key=lambda s: (-s["wins"], s["losses"], -s["points_for"], s["owner_id"]))
        for i, row in enumerate(order, 1):
            row["rank"] = i
    return rows


def current_standings_rows(summary_rows):
    return [dict(r) for r in sorted(summary_rows, key=lambda r: r["rank"])]


# ----------------------------------------------------------------------------------------
# Head-to-head, careers, records
# ----------------------------------------------------------------------------------------
def head_to_head_rows(games, owners):
    acc = {}
    for g in games:
        a, b = g["owner_id"], g["opponent_owner_id"]
        if a > b:      # each game appears twice; use the lower id's perspective once
            continue
        x = acc.setdefault((a, b), {"g": 0, "aw": 0, "bw": 0, "apf": 0.0, "bpf": 0.0})
        x["g"] += 1
        x["aw"] += g["result"] == "W"
        x["bw"] += g["result"] == "L"
        x["apf"] += g["points_for"]
        x["bpf"] += g["points_against"]
    rows = []
    for (a, b) in sorted(acc):
        x = acc[(a, b)]
        rows.append({"owner_a_id": a, "owner_a_name": owners[a], "owner_b_id": b, "owner_b_name": owners[b],
                     "games": x["g"], "owner_a_wins": x["aw"], "owner_b_wins": x["bw"],
                     "ties": x["g"] - x["aw"] - x["bw"],
                     "owner_a_pf": round(x["apf"], 2), "owner_b_pf": round(x["bpf"], 2)})
    return rows


def owner_career_rows(games, owners):
    acc = {}
    for g in games:
        x = acc.setdefault(g["owner_id"], {"gp": 0, "w": 0, "l": 0, "pf": 0.0, "pa": 0.0, "years": set()})
        x["gp"] += 1
        x["w"] += g["result"] == "W"
        x["l"] += g["result"] == "L"
        x["pf"] += g["points_for"]
        x["pa"] += g["points_against"]
        x["years"].add(g["year"])
    rows = []
    for owner_id, x in acc.items():
        rows.append({"owner_id": owner_id, "owner_name": owners[owner_id], "seasons": len(x["years"]),
                     "games_played": x["gp"], "wins": x["w"], "losses": x["l"], "ties": x["gp"] - x["w"] - x["l"],
                     "win_percentage": round(x["w"] / x["gp"], 4),
                     "points_for": round(x["pf"], 2), "points_against": round(x["pa"], 2),
                     "average_points_for": round(x["pf"] / x["gp"], 2),
                     "average_margin": round((x["pf"] - x["pa"]) / x["gp"], 2)})
    rows.sort(key=lambda r: (-r["wins"], -r["win_percentage"], r["owner_id"]))
    return rows


def record_lists(games):
    winners = [g for g in games if g["result"] == "W"]
    return {
        "highest_scores": sorted(games, key=lambda g: (-g["points_for"], g["year"], g["game_id"]))[:25],
        "lowest_scores": sorted(games, key=lambda g: (g["points_for"], g["year"], g["game_id"]))[:25],
        "largest_margins": sorted(winners, key=lambda g: (-g["margin"], g["year"], g["game_id"]))[:25],
        "closest_games": sorted(winners, key=lambda g: (g["margin"], g["year"], g["game_id"]))[:25],
    }


# ----------------------------------------------------------------------------------------
# Ask Sparty files (current-season rows)
# ----------------------------------------------------------------------------------------
def _weekly_context(rows):
    """Per (week) lists of regular-season rows."""
    by = defaultdict(list)
    for g in rows:
        by[g["week"]].append(g)
    return by


def sheet_order(rows):
    """Order rows as the Ask Sparty sheet lists them: week, then matchups by winning score
    (best first), winner's row before the loser's."""
    return sorted(rows, key=lambda g: (g["week"], -max(g["points_for"], g["points_against"]),
                                       -(g["points_for"] > g["points_against"])))


def ai_game_rows(games, season, era, status):
    """ai_games rows for one season: weekly rank, all-play, half flags and within-season streaks."""
    year = season["year"]
    rows = regular_rows(games, year)
    by_week = _weekly_context(rows)
    streak = defaultdict(lambda: [0, 0])
    keyed = {}
    for week in sorted(by_week):
        wk = by_week[week]
        n = len(wk)
        for g in wk:
            pf = g["points_for"]
            higher = sum(1 for o in wk if o["points_for"] > pf)
            same = sum(1 for o in wk if o["points_for"] == pf) - 1
            lower = sum(1 for o in wk if o["points_for"] < pf)
            s = streak[g["owner_id"]]
            if g["result"] == "W":
                s[0], s[1] = s[0] + 1, 0
            elif g["result"] == "L":
                s[1], s[0] = s[1] + 1, 0
            else:
                s[0], s[1] = 0, 0
            rank = higher + 1
            keyed[(week, g["owner_id"])] = ai_row([
                ("year", year), ("week", week), ("team", g["team"]), ("owner", g["owner_name"]),
                ("opponent", g["opponent_team"]), ("opponent_owner", g["opponent_owner_name"]),
                ("points_for", g["points_for"]), ("points_against", g["points_against"]),
                ("margin", g["points_for"] - g["points_against"]), ("result", g["result"]),
                ("weekly_rank", rank), ("top_half", int(rank <= n // 2)), ("bottom_half", int(rank > n // 2)),
                ("all_play_wins", lower + 0.5 * same), ("expected_wins", (lower + 0.5 * same) / (n - 1)),
                ("win_streak", s[0]), ("loss_streak", s[1]), ("era", era), ("season_status", status)])
    out = []
    for week in sorted(by_week):
        # Within a week the file lists matchups by winning score (best first), winner's row first.
        out.extend(keyed[(week, g["owner_id"])] for g in sheet_order(by_week[week]))
    return out


def _chronological(games):
    def key(g):
        rank = ROUND_ORDER.get(g["round"]) if g["stage"] == "Postseason" else g["week"]
        return (g["year"], 0 if g["stage"] == "Regular Season" else 1, rank)
    return sorted(games, key=key)


def ai_all_game_rows(games, seasons_by_year, year):
    """ai_all_games rows for one season; streaks run across seasons and the postseason."""
    streak = defaultdict(lambda: [0, 0])
    rival = defaultdict(int)
    keyed = {}
    for g in _chronological(games):
        s = streak[g["owner_id"]]
        r = (g["owner_id"], g["opponent_owner_id"])
        if g["result"] == "W":
            s[0], s[1] = s[0] + 1, 0
            rival[r] += 1
        elif g["result"] == "L":
            s[1], s[0] = s[1] + 1, 0
            rival[r] = 0
        else:
            s[0], s[1] = 0, 0
            rival[r] = 0
        if g["year"] != year:
            continue
        season = seasons_by_year[g["year"]]
        wk = g["week"] if g["stage"] == "Regular Season" else g["round"]
        keyed[(g["stage"], wk, g["owner_id"])] = ai_row([
            ("year", g["year"]), ("stage", g["stage"]), ("week_or_round", wk), ("team", g["team"]),
            ("owner", g["owner_name"]), ("opponent", g["opponent_team"]), ("opponent_owner", g["opponent_owner_name"]),
            ("points_for", g["points_for"]), ("points_against", g["points_against"]),
            ("margin", g["points_for"] - g["points_against"]), ("result", g["result"]), ("era", season["era"]),
            ("win_streak", s[0]), ("loss_streak", s[1]), ("rivalry_win_streak", rival[r]),
            ("matchup_total", g["points_for"] + g["points_against"]), ("season_status", season["status"])])
    year_games = [g for g in games if g["year"] == year]

    def order_key(g):
        wk = g["week"] if g["stage"] == "Regular Season" else ROUND_ORDER[g["round"]]
        return (0 if g["stage"] == "Regular Season" else 1, wk,
                -max(g["points_for"], g["points_against"]), -(g["points_for"] > g["points_against"]))
    out = []
    for g in sorted(year_games, key=order_key):
        wk = g["week"] if g["stage"] == "Regular Season" else g["round"]
        out.append(keyed[(g["stage"], wk, g["owner_id"])])
    return out


CLOSE_MARGIN = 5.0


def ai_season_rows(games, season, owners_by_name_order, ai_games_rows, era, status):
    """ai_seasons rows for one season, one per owner (caller supplies order via owner_order)."""
    year = season["year"]
    by_owner = defaultdict(list)
    for g in sorted(regular_rows(games, year), key=lambda g: g["week"]):
        by_owner[g["owner_name"]].append(g)
    ai_by = {(a["week"], a["owner"]): a for a in ai_games_rows if a["year"] == year}
    out = {}
    for owner, rows in by_owner.items():
        n = len(rows)
        if n < 2:
            raise ValueError("score_std_dev is undefined with fewer than 2 games")
        pf = [g["points_for"] for g in rows]
        pa = [g["points_against"] for g in rows]
        a = [ai_by[(g["week"], owner)] for g in rows]
        wins = sum(g["result"] == "W" for g in rows)
        ew = ssum(x["expected_wins"] for x in a)
        top_half = sum(x["top_half"] for x in a)
        close = lambda g: round(abs(g["margin"]), 2) <= CLOSE_MARGIN
        out[owner] = ai_row([
            ("year", year), ("owner", owner), ("team", rows[-1]["team"]), ("games_played", n),
            ("wins", wins), ("losses", sum(g["result"] == "L" for g in rows)), ("win_percentage", wins / n),
            ("points_for", ssum(pf)), ("points_against", ssum(pa)),
            ("average_points_for", ssum(pf) / n), ("average_opponent_score", ssum(pa) / n),
            ("average_margin", (ssum(pf) - ssum(pa)) / n), ("expected_wins", ew), ("luck", wins - ew),
            ("top_half", top_half), ("bottom_half", sum(x["bottom_half"] for x in a)),
            ("top_half_percentage", top_half / n),
            ("scores_100_plus", sum(1 for s in pf if s >= 100)), ("scores_120_plus", sum(1 for s in pf if s >= 120)),
            ("scores_140_plus", sum(1 for s in pf if s >= 140)), ("scores_below_90", sum(1 for s in pf if s < 90)),
            ("scores_below_80", sum(1 for s in pf if s < 80)), ("score_std_dev", sample_std(pf)),
            ("average_top_3", extreme_mean(pf, 3, True)), ("average_top_5", extreme_mean(pf, 5, True)),
            ("average_bottom_3", extreme_mean(pf, 3, False)), ("average_bottom_5", extreme_mean(pf, 5, False)),
            ("close_wins", sum(1 for g in rows if g["result"] == "W" and close(g))),
            ("close_losses", sum(1 for g in rows if g["result"] == "L" and close(g))),
            ("wins_bottom_half", sum(1 for g, x in zip(rows, a) if g["result"] == "W" and x["bottom_half"])),
            ("losses_top_half", sum(1 for g, x in zip(rows, a) if g["result"] == "L" and x["top_half"])),
            ("second_place_losses", _second_place_losses(rows, ai_by)),
            ("season_status", status), ("era", era)])
        ties = sum(g["result"] == "T" for g in rows)
        if ties:
            out[owner]["ties"] = ties
    return out


def _second_place_losses(rows, ai_by):
    """Losses in weeks where the owner scored the league's second-highest score."""
    return sum(1 for g in rows if g["result"] == "L" and ai_by[(g["week"], g["owner_name"])]["weekly_rank"] == 2)


def ai_league_year_row(games, season, era, status):
    year = season["year"]
    rows = sheet_order(regular_rows(games, year))   # sums follow the sheet's row order
    wins = [g for g in rows if g["result"] == "W"]
    losses = [g for g in rows if g["result"] == "L"]
    n = len(rows)
    margins = [abs(g["margin"]) for g in wins]
    tied_pairs = [g for g in rows if g["result"] == "T" and g["owner_id"] < g["opponent_owner_id"]]
    margins += [0] * len(tied_pairs)
    matchups = wins + tied_pairs
    mean = lambda values: ssum(values) / len(values) if values else None
    week_totals = defaultdict(float)
    for g in sorted(rows, key=lambda g: g["week"]):
        week_totals[g["week"]] += g["points_for"]
    teams = season["team_count"]
    return ai_row([
        ("year", year), ("teams", teams), ("matchups", n // 2),
        ("average_score", ssum(g["points_for"] for g in rows) / n),
        ("average_winning_score", mean([g["points_for"] for g in wins])),
        ("average_losing_score", mean([g["points_for"] for g in losses])),
        ("average_margin", mean([g["margin"] for g in matchups])),
        ("average_matchup_total", mean([g["points_for"] + g["points_against"] for g in matchups])),
        ("percent_games_under_5", sum(1 for m in margins if m < 5) / len(margins)),
        ("percent_games_under_10", sum(1 for m in margins if m < 10) / len(margins)),
        ("percent_games_under_20", sum(1 for m in margins if m < 20) / len(margins)),
        ("percent_scores_100_plus", sum(1 for g in rows if g["points_for"] >= 100) / n),
        ("highest_week_total", max(week_totals.values())), ("lowest_week_total", min(week_totals.values())),
        ("highest_week_average", max(week_totals.values()) / teams),
        ("lowest_week_average", min(week_totals.values()) / teams),
        ("era", era), ("season_status", status)])
