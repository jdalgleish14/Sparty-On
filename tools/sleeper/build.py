"""Assemble the published data set from game rows, with safety gates for Sleeper input.

``derive_dataset`` rebuilds every generated file from a list of game rows (and is checked
byte-for-byte against the committed Excel export in tests). ``build_from_sleeper`` turns Sleeper
matchup payloads into new game rows, but only after every gate passes.
"""
import json
import math

import datafiles as df
import derive as dv

TOLERANCE = 0.011           # same tolerance the site's own Sleeper preview uses
GENERATOR_VERSION = "1.0.0"


class GateError(Exception):
    """Data is incomplete, inconsistent or unexpected. Nothing may be published."""

    def __init__(self, reasons):
        self.reasons = [reasons] if isinstance(reasons, str) else list(reasons)
        super().__init__("; ".join(self.reasons))


class NothingToPublish(Exception):
    """No new fully scored week is available."""


# ----------------------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------------------
def current_season(site):
    cur = [s for s in site["seasons"] if s["status"] == "Current"]
    if len(cur) != 1:
        raise GateError(f"expected exactly one Current season, found {len(cur)}")
    return cur[0]


def owner_names(site):
    return {o["owner_id"]: o["owner_name"] for o in site["owners"]}


def game_pairs(games):
    pairs = {}
    for g in games:
        pairs.setdefault(g["game_id"], []).append(g)
    return pairs


# ----------------------------------------------------------------------------------------
# Whole-dataset derivation (pure; used for both Excel-parity tests and Sleeper builds)
# ----------------------------------------------------------------------------------------
def validation_report(base, games, site, through_week, source_entries):
    cur = current_season(site)
    reg = [g for g in games if g["stage"] == "Regular Season"]
    post = [g for g in games if g["stage"] == "Postseason"]
    owners = owner_names(site)
    team_count = cur["team_count"]
    ss = site["season_summaries"]
    cur_summary_owners = {r["owner_id"] for r in ss if r["year"] == cur["year"]}
    roster = set(cur["roster_owner_ids"])

    checks = []

    def add(name, ok, detail):
        checks.append({"name": name, "status": "PASS" if ok else "FAIL", "detail": detail})

    add("current_season_roster_order_complete",
        roster == cur_summary_owners and len(roster) == len(cur["roster_owner_ids"]) == team_count
        and roster <= set(owners), f"owners={len(cur['roster_owner_ids'])}")
    normalized = {(g["year"], g["week"], g["owner_id"], g["opponent_owner_id"], g["points_for"], g["points_against"])
                  for g in reg}
    missing = len(source_entries - normalized)
    extra = len(normalized - source_entries)
    add("original_entries_match_normalized_regular_season", missing == 0 and extra == 0,
        f"raw={len(source_entries)}, normalized={len(normalized)}, missing={missing}, extra={extra}")
    issues = sum(1 for g in games if g["owner_id"] not in owners or g["opponent_owner_id"] not in owners
                 or owners[g["owner_id"]] != g["owner_name"] or owners[g["opponent_owner_id"]] != g["opponent_owner_name"])
    add("owner_mapping_complete", issues == 0, f"issues={issues}")
    partial = sum(1 for g in games if not isinstance(g["points_for"], (int, float)) or not isinstance(g["points_against"], (int, float))
                  or not math.isfinite(g["points_for"]) or not math.isfinite(g["points_against"]) or g["points_for"] < 0)
    add("no_partial_published_score_rows", partial == 0, f"issues={partial}")
    incomplete = [w for w in range(1, through_week + 1)
                  if len([g for g in reg if g["year"] == cur["year"] and g["week"] == w]) != team_count]
    add("approved_current_weeks_are_complete", not incomplete,
        f"expected_matchups_per_week={team_count // 2}, incomplete_weeks={incomplete}")
    pairs = game_pairs(games)
    invalid = sum(1 for p in pairs.values() if len(p) != 2 or p[0]["owner_id"] != p[1]["opponent_owner_id"]
                  or p[1]["owner_id"] != p[0]["opponent_owner_id"] or p[0]["points_for"] != p[1]["points_against"]
                  or p[1]["points_for"] != p[0]["points_against"])
    add("two_owner_rows_per_game", invalid == 0, f"games={len(pairs)}, invalid={invalid}")
    post_pairs = [p for p in pairs.values() if p[0]["stage"] == "Postseason"]
    add("postseason_winners_have_higher_score",
        all(max(p, key=lambda g: g["points_for"])["result"] == "W" for p in post_pairs), f"games={len(post_pairs)}")
    add("all_release_checks", all(c["status"] == "PASS" for c in checks), "Export is releasable")
    return {
        "status": "PASS" if all(c["status"] == "PASS" for c in checks) else "FAIL",
        "source_sha256": base["validation_report"]["source_sha256"],
        "publication_cutoff": {"current_season_through_week": through_week},
        "checks": checks,
        "counts": {"regular_season_matchups": len(reg) // 2, "postseason_games": len(post) // 2,
                   "all_games": len(pairs), "game_rows": len(games), "owners": len(site["owners"]),
                   "active_season_summaries": len(ss)},
    }


def derive_dataset(base, games, through_week, generated_at, source_entries=None):
    """Return a new DataSet whose generated files are rebuilt from ``games``.

    Completed seasons, owners, championships and the season list are carried over untouched;
    everything that depends on the current season's games is recalculated.
    """
    ds = base.copy()
    site = ds.site
    cur = current_season(site)
    year = cur["year"]
    names = owner_names(site)
    seasons_by_year = {s["year"]: s for s in site["seasons"]}
    era, status = cur["era"], cur["status"]

    site["games"] = games
    ds["games"] = games
    # season summaries: previous years kept as published, current year recalculated
    cur_rows = dv.season_summary_rows(games, cur, names, status)
    ss = [r for r in base["season_summaries"] if r["year"] != year] + cur_rows
    ds["season_summaries"] = site["season_summaries"] = ss
    ds["current_standings"] = site["current_standings"] = dv.current_standings_rows(cur_rows)
    ds["head_to_head"] = site["head_to_head"] = dv.head_to_head_rows(games, names)
    ds["owner_careers"] = site["owner_careers"] = dv.owner_career_rows(games, names)
    site["records"] = dv.record_lists(games)
    league = dict(site["league"])
    league["generated_at_utc"] = generated_at
    league["current_season_through_week"] = through_week
    site["league"] = league

    # Ask Sparty files: only the current season's rows are replaced.
    ai_games = dv.ai_game_rows(games, cur, era, status)
    ai_all = dv.ai_all_game_rows(games, seasons_by_year, year)
    ai_seasons_new = dv.ai_season_rows(games, cur, None, ai_games, era, status)
    ds["ai_games"] = [r for r in base["ai_games"] if r["year"] != year] + ai_games
    ds["ai_all_games"] = [r for r in base["ai_all_games"] if r["year"] != year] + ai_all
    ai_seasons = []
    for r in base["ai_seasons"]:
        ai_seasons.append(ai_seasons_new[r["owner"]] if r["year"] == year else r)
    existing = {(r["year"], r["owner"]) for r in base["ai_seasons"]}
    ai_seasons += [row for owner, row in ai_seasons_new.items() if (year, owner) not in existing]
    ds["ai_seasons"] = ai_seasons
    league_row = dv.ai_league_year_row(games, cur, era, status)
    ds["ai_league_years"] = [league_row if r["year"] == year else r for r in base["ai_league_years"]]

    if source_entries is None:
        source_entries = {(g["year"], g["week"], g["owner_id"], g["opponent_owner_id"], g["points_for"], g["points_against"])
                          for g in games if g["stage"] == "Regular Season"}
    report = validation_report(base, games, site, through_week, source_entries)
    ds["validation_report"] = site["validation_report"] = report

    # manifests describe the exact bytes of the files above
    files = {}
    for fname in sorted(["championships.json", "current_standings.json", "games.json", "head_to_head.json", "league.json",
                         "owner_careers.json", "owners.json", "records.json", "season_summaries.json", "seasons.json",
                         "validation_report.json"]):
        key = next(k for k, v in {**df.MAIN_FILES, **df.EMBEDDED_ONLY}.items() if v == fname)
        text = df.dumps_indent(site[key])
        files[fname] = {"sha256": df.sha256_text(text), "bytes": len(text.encode("utf-8"))}
    ds["manifest"] = {"schema_version": base["manifest"]["schema_version"], "generated_at_utc": generated_at,
                      "source_sha256": base["manifest"]["source_sha256"],
                      "publication_cutoff": {"current_season_through_week": through_week}, "files": files}
    ai_files = {}
    for key, fname in df.AI_FILES.items():
        text = df.dumps_compact(ds[key])
        ai_files[fname] = {"sha256": df.sha256_text(text), "bytes": len(text.encode("utf-8")), "rows": len(ds[key])}
    ds["ai_manifest"] = {"schema_version": base["ai_manifest"]["schema_version"],
                         "source_sha256": base["ai_manifest"]["source_sha256"],
                         "publication_cutoff": {"current_season_through_week": through_week}, "files": ai_files}
    return ds


# ----------------------------------------------------------------------------------------
# Sleeper payload handling
# ----------------------------------------------------------------------------------------
def entry_score(entry):
    """Final score for a roster: a commissioner correction (custom_points) wins over points."""
    raw = entry.get("custom_points")
    if raw is None:
        raw = entry.get("points")
    return raw


def parse_week(week, payload, roster_ids, league_id=None, season=None):
    """Validate one week's matchups and return [(roster_a, roster_b, score_a, score_b)]."""
    problems = []
    matchups = payload.get("matchups") if isinstance(payload, dict) else None
    if not isinstance(matchups, list):
        raise GateError(f"week {week}: payload has no matchups list")
    if payload.get("week") != week:
        problems.append(f"week {week}: payload is labelled week {payload.get('week')}")
    if league_id is not None and str(payload.get("league_id")) != str(league_id):
        problems.append(f"week {week}: payload belongs to league {payload.get('league_id')}, expected {league_id}")
    if season is not None and str(payload.get("season")) != str(season):
        problems.append(f"week {week}: payload is for season {payload.get('season')}, expected {season}")
    seen = [m.get("roster_id") for m in matchups]
    if sorted(x for x in seen if isinstance(x, int)) != sorted(roster_ids):
        problems.append(f"week {week}: roster ids {sorted(x for x in seen if x is not None)} do not match the {len(roster_ids)} expected rosters")
    groups = {}
    for m in matchups:
        mid = m.get("matchup_id")
        if mid is None:
            problems.append(f"week {week}: roster {m.get('roster_id')} has no matchup (bye or unscheduled)")
            continue
        groups.setdefault(mid, []).append(m)
    pairs = []
    for mid in sorted(groups):
        group = groups[mid]
        if len(group) != 2:
            problems.append(f"week {week}: matchup {mid} has {len(group)} teams, expected 2")
            continue
        scores = []
        for m in group:
            s = entry_score(m)
            if isinstance(s, bool) or not isinstance(s, (int, float)) or not math.isfinite(s):
                problems.append(f"week {week}: roster {m.get('roster_id')} has no numeric score")
                break
            if s <= 0:
                problems.append(f"week {week}: roster {m.get('roster_id')} has a zero or negative score ({s}); week may not be scored yet")
                break
            if abs(s - round(s, 2)) > 1e-6:
                problems.append(f"week {week}: roster {m.get('roster_id')} score {s} has more than two decimals")
                break
            scores.append(round(s, 2))
        else:
            if scores[0] == scores[1]:
                problems.append(f"week {week}: matchup {mid} is an exact tie ({scores[0]}); ties are not supported, so this week stays on the Excel export")
                continue
            pairs.append((group[0]["roster_id"], group[1]["roster_id"], scores[0], scores[1]))
    if problems:
        raise GateError(problems)
    return pairs


def _row(year, season_id, week, team, owner_id, owner_name, opp_team, opp_id, opp_name, pf, pa, game_id):
    return {"game_id": game_id, "season_id": season_id, "year": year, "stage": "Regular Season", "week": week,
            "round": None, "team": team, "owner_id": owner_id, "owner_name": owner_name, "opponent_team": opp_team,
            "opponent_owner_id": opp_id, "opponent_owner_name": opp_name, "points_for": pf, "points_against": pa,
            "margin": round(pf - pa, 2), "result": "W" if pf > pa else "L"}


def game_rows_for_week(cur, week, pairs, roster_to_owner, names, teams):
    """Two rows per matchup, in the same field order the exporter uses."""
    pos = {o: i for i, o in enumerate(cur["roster_owner_ids"])}
    rows = []
    year, season_id = cur["year"], cur["season_id"]
    ordered = sorted(pairs, key=lambda p: min(pos[roster_to_owner[p[0]]], pos[roster_to_owner[p[1]]]))
    for ra, rb, sa, sb in ordered:
        a, b = roster_to_owner[ra], roster_to_owner[rb]
        lo, hi = sorted([a, b])
        gid = f"{year}-regular-week-{week}-{lo}--{hi}"
        first, second = sorted([(a, sa, b, sb), (b, sb, a, sa)], key=lambda t: pos[t[0]])
        for oid, pf, opp, pa in (first, second):
            rows.append(_row(year, season_id, week, teams[oid], oid, names[oid], teams[opp], opp, names[opp], pf, pa, gid))
    return rows


def load_owner_map(path):
    with open(path, encoding="utf-8") as fh:
        m = json.load(fh)
    m["rosters"] = {int(k): v for k, v in m["rosters"].items()}
    return m


def check_mapping(cur, owner_map, context):
    reasons = []
    if str(context.get("league_id")) != str(owner_map["league_id"]):
        reasons.append(f"Sleeper league id {context.get('league_id')} does not match the configured {owner_map['league_id']}")
    if str(context.get("season")) != str(cur["year"]) or str(owner_map["season"]) != str(cur["year"]):
        reasons.append(f"Sleeper season {context.get('season')} / map season {owner_map['season']} do not match the site's current season {cur['year']}")
    status = context.get("status")
    if status in ("pre_draft", "drafting"):
        raise NothingToPublish(f"Sleeper league status is {status!r}; there is nothing to sync before the season starts")
    if status not in ("in_season", "complete"):
        reasons.append(f"Sleeper league status is {status!r}, expected in_season or complete")
    rosters = owner_map["rosters"]
    if len(set(rosters.values())) != len(rosters):
        reasons.append("owner_map assigns one owner to more than one roster")
    if set(rosters.values()) != set(cur["roster_owner_ids"]):
        reasons.append("owner_map owners differ from the site's current-season roster")
    live = {r["roster_id"]: r for r in context.get("rosters", [])}
    if set(live) != set(rosters):
        reasons.append(f"Sleeper roster ids {sorted(live)} differ from owner_map roster ids {sorted(rosters)}")
    if context.get("total_rosters") not in (None, cur["team_count"]):
        reasons.append(f"Sleeper reports {context.get('total_rosters')} rosters, site expects {cur['team_count']}")
    for rid, user in (owner_map.get("sleeper_user_ids") or {}).items():
        if int(rid) in live and live[int(rid)].get("owner_id") != user:
            reasons.append(f"roster {rid} is now owned by a different Sleeper user than the pinned one; confirm before publishing")
    if reasons:
        raise GateError(reasons)


def build_from_sleeper(base, owner_map, context, raw_weeks, mode="incremental", through=None):
    """Return (DataSet, report dict). Raises GateError / NothingToPublish.

    mode "incremental": keep the published weeks as they are, verify them against Sleeper, and
    add new complete weeks. mode "rebuild": rebuild the whole current season from Sleeper, used
    to compare Sleeper-derived data with the Excel export.
    """
    site = base.site
    cur = current_season(site)
    check_mapping(cur, owner_map, context)
    year = cur["year"]
    names = owner_names(site)
    roster_to_owner = owner_map["rosters"]
    published = site["league"]["current_season_through_week"]
    if published != base["validation_report"]["publication_cutoff"]["current_season_through_week"]:
        raise GateError("published league cutoff and validation cutoff already disagree in the base data")
    last_scored = context.get("last_scored_leg")
    if not isinstance(last_scored, int):
        raise GateError("Sleeper did not report last_scored_leg, so scoring cannot be confirmed as final")
    target = min(last_scored, cur["regular_season_weeks"])
    if through is not None:
        if through > target:
            raise GateError(f"week {through} is not yet scored in Sleeper (last scored week is {last_scored})")
        target = through
    if mode == "incremental" and target < published:
        raise GateError(f"Sleeper reports week {last_scored} as the last scored week but the site already publishes week {published}")
    missing = [w for w in range(1, target + 1) if w not in raw_weeks]
    if missing:
        raise GateError(f"missing Sleeper payloads for weeks {missing}; every week up to {target} is needed to verify the owner mapping")

    base_cur = [g for g in base["games"] if g["year"] == year and g["stage"] == "Regular Season"]
    if not base_cur:
        raise GateError("the base data has no rows for the current season; start the season from the Excel export first")
    teams = {}
    for g in base_cur:
        teams[g["owner_id"]] = g["team"]
    if set(teams) != set(roster_to_owner.values()):
        raise GateError("could not establish a team name for every current-season owner from the base data")

    notes, drift, errors = [], [], []
    parsed = {}
    roster_ids = sorted(roster_to_owner)
    for w in range(1, target + 1):
        try:
            parsed[w] = parse_week(w, raw_weeks[w], roster_ids, owner_map["league_id"], cur["year"])
        except GateError as e:
            errors.extend(e.reasons)
    if errors:
        raise GateError(errors)

    # Published weeks must agree with Sleeper: proves the roster-to-owner mapping every run.
    stats = {"verified_weeks": 0, "verified_games": 0, "exact": 0, "within_tolerance": 0}
    if mode == "incremental":
        by_week = {}
        for g in base_cur:
            by_week.setdefault(g["week"], {})[(g["owner_id"], g["opponent_owner_id"])] = g
        for w in range(1, published + 1):
            pub = by_week.get(w, {})
            seen = set()
            for ra, rb, sa, sb in parsed[w]:
                a, b = roster_to_owner[ra], roster_to_owner[rb]
                row = pub.get((a, b))
                if row is None:
                    errors.append(f"week {w}: Sleeper pairs {names[a]} with {names[b]} but the published week does not")
                    continue
                seen.add((a, b))
                for label, got, want in ((names[a], sa, row["points_for"]), (names[b], sb, row["points_against"])):
                    d = abs(got - want)
                    if d > TOLERANCE:
                        errors.append(f"week {w}: {label} is {got} in Sleeper but {want} in the published data (difference {d:.2f})")
                        drift.append((w, label, want, got))
                    elif d > 0:
                        stats["within_tolerance"] += 1
                        notes.append(f"week {w}: {label} differs by {d:.3f} (Sleeper {got}, published {want}); within tolerance")
                    else:
                        stats["exact"] += 1
                stats["verified_games"] += 1
            if len(seen) != cur["team_count"] // 2:
                errors.append(f"week {w}: Sleeper and the published data do not cover the same matchups")
            stats["verified_weeks"] += 1
        if errors:
            raise GateError(errors)
        if target == published:
            raise NothingToPublish(f"week {published} is the latest scored week and is already published")
        new_weeks = list(range(published + 1, target + 1))
        keep = base["games"]
    else:
        new_weeks = list(range(1, target + 1))
        keep = [g for g in base["games"] if not (g["year"] == year and g["stage"] == "Regular Season")]

    new_rows = []
    for w in new_weeks:
        new_rows.extend(game_rows_for_week(cur, w, parsed[w], roster_to_owner, names, teams))
    # games.json lists every regular-season row first and the postseason rows after them. Earlier
    # rows stay exactly as published; the current season's rows are the last regular-season block.
    idx = [i for i, g in enumerate(keep) if g["year"] == year and g["stage"] == "Regular Season"]
    if mode == "incremental":
        if not idx or idx != list(range(idx[0], idx[-1] + 1)):
            raise GateError("current-season rows are not one contiguous block in games.json; refusing to guess where new rows belong")
        insert_at = idx[-1] + 1
    else:
        insert_at = next((i for i, g in enumerate(keep) if g["stage"] == "Postseason"), len(keep))
    if any(g["stage"] == "Regular Season" for g in keep[insert_at:]):
        raise GateError("regular-season rows follow the insertion point in games.json; refusing to guess where new rows belong")
    games = list(keep[:insert_at]) + new_rows + list(keep[insert_at:])

    sleeper_entries = set()
    for w in new_weeks:
        for ra, rb, sa, sb in parsed[w]:
            a, b = roster_to_owner[ra], roster_to_owner[rb]
            sleeper_entries.add((year, w, a, b, sa, sb))
            sleeper_entries.add((year, w, b, a, sb, sa))
    carried = {(g["year"], g["week"], g["owner_id"], g["opponent_owner_id"], g["points_for"], g["points_against"])
               for g in games if g["stage"] == "Regular Season" and not (g["year"] == year and g["week"] in new_weeks)}
    generated_at = context.get("fetched_at_utc") or context.get("fetched_at")
    if not generated_at:
        raise GateError("the Sleeper context has no fetch timestamp")
    ds = derive_dataset(base, games, target, generated_at, source_entries=carried | sleeper_entries)
    if ds["validation_report"]["status"] != "PASS":
        failed = [c for c in ds["validation_report"]["checks"] if c["status"] != "PASS"]
        raise GateError([f"validation check {c['name']} failed: {c['detail']}" for c in failed])

    # team names: report differences, never change them silently
    for user in context.get("users", []):
        rid = next((r["roster_id"] for r in context.get("rosters", []) if r.get("owner_id") == user.get("user_id")), None)
        if rid in roster_to_owner and user.get("team_name") and user["team_name"] != teams[roster_to_owner[rid]]:
            notes.append(f"team name for {names[roster_to_owner[rid]]}: site has {teams[roster_to_owner[rid]]!r}, Sleeper has {user['team_name']!r} (site name kept)")
    report = {"mode": mode, "through_week": target, "published_week_before": published, "new_weeks": new_weeks,
              "verification": stats, "notes": notes, "last_scored_leg": last_scored}
    return ds, report
