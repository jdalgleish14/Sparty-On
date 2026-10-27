"""Independent verification of a published site-data directory.

These checks do not trust the generator: they re-read the files on disk and require that they are
internally consistent, match their manifests, follow the same invariants the site's own pages
enforce when they load, and equal a fresh recomputation from the game rows.
"""
import json
import os

import build as bd
import datafiles as df


def verify_dir(directory):
    """Return a list of problems (empty means the directory is publishable)."""
    problems = []
    try:
        ds = df.load(directory)
    except Exception as e:  # missing or unparseable file
        return [f"could not load the data files: {e}"]
    site = ds.site

    # 1. every standalone JSON mirrors its key in site-data.js, and formatting is canonical
    for key, fname in df.MAIN_FILES.items():
        if ds[key] != site[key]:
            problems.append(f"{fname} differs from the {key} block inside site-data.js")
    for name, fname in {**df.MAIN_FILES, **df.AI_FILES, **df.MANIFESTS}.items():
        if df.read_text(directory, fname) != df.canonical_text(name, ds[name]):
            problems.append(f"{fname} is not in the exporter's canonical format")
    if df.read_text(directory, "site-data.js") != df.site_js_text(site):
        problems.append("site-data.js is not in the exporter's canonical format")

    # 2. manifests describe the exact bytes on disk
    manifest = ds["manifest"]
    for fname, meta in manifest["files"].items():
        key = next((k for k, v in {**df.MAIN_FILES, **df.EMBEDDED_ONLY}.items() if v == fname), None)
        if key is None:
            problems.append(f"manifest lists unknown file {fname}")
            continue
        text = df.dumps_indent(site[key])
        if df.sha256_text(text) != meta["sha256"] or len(text.encode()) != meta["bytes"]:
            problems.append(f"manifest.json entry for {fname} does not match the data")
    ai_manifest = ds["ai_manifest"]
    for key, fname in df.AI_FILES.items():
        meta = ai_manifest["files"].get(fname)
        text = df.dumps_compact(ds[key])
        if not meta or df.sha256_text(text) != meta["sha256"] or len(text.encode()) != meta["bytes"] or meta["rows"] != len(ds[key]):
            problems.append(f"ai_manifest.json entry for {fname} does not match the data")

    # 3. one publication cutoff everywhere
    cutoffs = {"league": site["league"]["current_season_through_week"],
               "validation_report": ds["validation_report"]["publication_cutoff"]["current_season_through_week"],
               "manifest": manifest["publication_cutoff"]["current_season_through_week"],
               "ai_manifest": ai_manifest["publication_cutoff"]["current_season_through_week"]}
    if len(set(cutoffs.values())) != 1:
        problems.append(f"publication cutoffs disagree: {cutoffs}")
    cutoff = cutoffs["league"]
    if len({manifest["generated_at_utc"], site["league"]["generated_at_utc"]}) != 1:
        problems.append("generated_at_utc differs between league and manifest")
    if len({manifest["source_sha256"], ai_manifest["source_sha256"], ds["validation_report"]["source_sha256"]}) != 1:
        problems.append("source_sha256 differs between manifest, ai_manifest and validation_report")

    # 4. the same game-integrity rules the site pages enforce at load time
    try:
        cur = bd.current_season(site)
    except bd.GateError as e:
        return problems + e.reasons
    games = ds["games"]
    pairs = bd.game_pairs(games)
    bad_pairs = [gid for gid, p in pairs.items() if len(p) != 2 or p[0]["owner_id"] != p[1]["opponent_owner_id"]
                 or p[1]["owner_id"] != p[0]["opponent_owner_id"] or p[0]["points_for"] != p[1]["points_against"]
                 or p[1]["points_for"] != p[0]["points_against"]]
    if bad_pairs:
        problems.append(f"{len(bad_pairs)} games do not have two mirrored owner rows (first: {bad_pairs[0]})")
    for g in games:
        expected = "W" if g["points_for"] > g["points_against"] else "L" if g["points_for"] < g["points_against"] else "T"
        if g["result"] != expected or (expected == "T" and g["stage"] != "Regular Season"):
            problems.append(f"{g['game_id']} ({g['owner_id']}): result {g['result']} contradicts the score")
            break
        if round(g["points_for"] - g["points_against"], 2) != g["margin"]:
            problems.append(f"{g['game_id']} ({g['owner_id']}): margin does not equal the score difference")
            break
    year = cur["year"]
    weeks_beyond = [g for g in games if g["year"] == year and (g["stage"] != "Regular Season" or g["week"] > cutoff)]
    if weeks_beyond:
        problems.append("games.json contains current-season rows beyond the publication cutoff")
    if not 1 <= cutoff <= cur["regular_season_weeks"]:
        problems.append(f"publication cutoff {cutoff} is outside the regular season")
    for w in range(1, cutoff + 1):
        owners_seen = [g["owner_id"] for g in games if g["year"] == year and g["stage"] == "Regular Season" and g["week"] == w]
        if len(owners_seen) != cur["team_count"] or set(owners_seen) != set(cur["roster_owner_ids"]):
            problems.append(f"week {w} does not contain exactly one game for every current-season owner")
    report = ds["validation_report"]
    if report["status"] != "PASS" or any(c["status"] != "PASS" for c in report["checks"]):
        problems.append("validation_report.json is not all PASS")
    for champ in ds["championships"]:
        match = [g for g in games if g["year"] == champ["year"] and g["round"] == "Championship"
                 and g["owner_id"] == champ["champion_owner_id"] and g["points_for"] == champ["champion_score"]]
        if not match:
            problems.append(f"championship for {champ['year']} does not match a postseason game")

    # 5. a fresh recomputation from games.json must reproduce every generated file
    try:
        fresh = bd.derive_dataset(ds, games, cutoff, site["league"]["generated_at_utc"])
    except Exception as e:
        return problems + [f"could not recompute the data set: {e}"]
    fresh_text = df.render(fresh)
    for fname, text in fresh_text.items():
        if df.read_text(directory, fname) != text:
            problems.append(f"{fname} does not match a fresh recomputation from games.json")
    return problems
