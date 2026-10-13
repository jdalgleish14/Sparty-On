"""Shared test fixtures: the committed Excel export, real Sleeper week-4 data, synthetic weeks."""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import build as bd      # noqa: E402
import datafiles as df  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DATA = os.path.join(HERE, "frozen", "site-data")   # frozen week-4 export, see frozen/README.md
LIVE = os.path.join(ROOT, "site-data")
FETCHED = "2026-10-07T01:06:47+00:00"       # same timestamp as the committed export


def load_base():
    return df.load(DATA)


def real_week4_sample():
    """The genuine Sleeper week-4 payload that already ships in sleeper-sample.js."""
    with open(os.path.join(DATA, "sleeper-sample.js"), encoding="utf-8") as fh:
        txt = fh.read()
    return json.loads(txt[txt.index("=") + 1:].strip().rstrip(";"))


def owner_map():
    return bd.load_owner_map(os.path.join(DATA, "sleeper", "owner_map.json"))


def context(last_scored=4, **over):
    m = owner_map()
    ctx = {"league_id": m["league_id"], "season": "2026", "status": "in_season", "total_rosters": 12,
           "last_scored_leg": last_scored, "fetched_at_utc": FETCHED,
           "rosters": [{"roster_id": r, "owner_id": f"user{r}", "co_owners": []} for r in sorted(m["rosters"])],
           "users": []}
    ctx.update(over)
    return ctx


def payload(base, week, fetched=FETCHED):
    """Sleeper-shaped matchups: real data for week 4, rebuilt from the Excel rows for weeks 1-3."""
    m = owner_map()
    o2r = {o: r for r, o in m["rosters"].items()}
    if week == 4:
        ms = [{"roster_id": x["roster_id"], "matchup_id": x["matchup_id"], "points": x["points"],
               "custom_points": x["custom_points"]} for x in real_week4_sample()["week4"]]
    else:
        ids, ms = {}, []
        for g in base["games"]:
            if g["year"] == 2026 and g["stage"] == "Regular Season" and g["week"] == week:
                mid = ids.setdefault(g["game_id"], len(ids) + 1)
                ms.append({"roster_id": o2r[g["owner_id"]], "matchup_id": mid, "points": g["points_for"], "custom_points": None})
    return {"league_id": m["league_id"], "season": "2026", "week": week, "fetched_at_utc": fetched, "matchups": ms}


def synthetic_week(week, base_scores=None):
    """A complete, plausible week for a week the Excel export does not have yet."""
    m = owner_map()
    rosters = sorted(m["rosters"])
    # rotate opponents so pairings differ from earlier weeks
    rot = rosters[week % len(rosters):] + rosters[:week % len(rosters)]
    ms = []
    for i in range(0, len(rot), 2):
        a, b = rot[i], rot[i + 1]
        sa = round(90 + ((week * 7 + a * 13) % 400) / 10, 2)
        sb = round(90 + ((week * 11 + b * 17) % 400) / 10, 2)
        if sa == sb:
            sb = round(sb + 0.01, 2)
        mid = i // 2 + 1
        ms.append({"roster_id": a, "matchup_id": mid, "points": sa, "custom_points": None})
        ms.append({"roster_id": b, "matchup_id": mid, "points": sb, "custom_points": None})
    return {"league_id": m["league_id"], "season": "2026", "week": week, "fetched_at_utc": FETCHED, "matchups": ms}


def raw_weeks(base, through=4):
    return {w: payload(base, w) for w in range(1, through + 1)}


def base_through(base, week):
    """The committed export pretended to stop after ``week`` (derived with the same pipeline)."""
    year = 2026
    games = [g for g in base["games"] if not (g["year"] == year and g["stage"] == "Regular Season" and g["week"] > week)]
    return bd.derive_dataset(base, games, week, base.site["league"]["generated_at_utc"])


def copy_repo_data():
    """A throwaway copy of site-data/ for CLI tests."""
    tmp = tempfile.mkdtemp(prefix="sparty-test-")
    dest = os.path.join(tmp, "site-data")
    shutil.copytree(DATA, dest)
    return tmp, dest
