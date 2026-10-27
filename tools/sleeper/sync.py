#!/usr/bin/env python3
"""Sleeper weekly sync for the Sparty On site.

Subcommands
  fetch    download the league context and every scored week into site-data/sleeper/raw/
  build    turn the saved payloads into updated site data (nothing is written unless every gate
           and the independent verifier pass)
  run      fetch + build
  parity   rebuild the current season purely from Sleeper and compare it with the committed
           (Excel) export, to prove the two agree
  verify   verify a site-data directory on its own
  compare  compare two site-data directories (for example a fresh Excel export vs this repo)

Exit codes: 0 success / changes ready, 10 nothing new to publish, 2 data not ready or
inconsistent (gate failed), 3 verification failed, 4 could not reach Sleeper, 1 unexpected error.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build as bd          # noqa: E402
import compare as cmp       # noqa: E402
import datafiles as df      # noqa: E402
import sleeper_api as api   # noqa: E402
import verify as vf         # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sparty"))
import generate as sparty_dialogue  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DEFAULT_DATA = os.path.join(ROOT, "site-data")
EXIT_OK, EXIT_NOTHING, EXIT_GATE, EXIT_VERIFY, EXIT_FETCH, EXIT_ERROR = 0, 10, 2, 3, 4, 1


def paths(args):
    data = os.path.abspath(args.data_dir)
    return data, os.path.join(data, "sleeper"), os.path.join(data, "sleeper", "raw")


def emit(args, **kv):
    """Write key=value lines for GitHub Actions (and echo them for humans)."""
    for k, v in kv.items():
        print(f"{k}={v}")
    target = getattr(args, "github_output", None) or os.environ.get("GITHUB_OUTPUT")
    if target:
        with open(target, "a", encoding="utf-8") as fh:
            for k, v in kv.items():
                fh.write(f"{k}={v}\n")


def write_report(path, text):
    if path:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)


def sha_file(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


# ----------------------------------------------------------------------------------------
def do_fetch(args):
    data, sleeper_dir, raw_dir = paths(args)
    owner_map = bd.load_owner_map(os.path.join(sleeper_dir, "owner_map.json"))
    league_id = args.league_id or owner_map["league_id"]
    site = df.load(data).site
    cur = bd.current_season(site)
    ctx = api.fetch_context(league_id)
    last = ctx.get("last_scored_leg")
    if not isinstance(last, int):
        raise bd.GateError("Sleeper did not report last_scored_leg")
    target = min(last, bd.regular_season_limit(cur, ctx))
    if args.through:
        target = min(target, args.through)
    changes = {}
    changes["context.json"] = api.save_raw(raw_dir, "context.json", ctx)
    for week in range(1, target + 1):
        name = f"week-{week:02d}.json"
        existed = api.load_raw(raw_dir, name) is not None
        changed = api.save_raw(raw_dir, name, api.fetch_week(league_id, week, ctx["season"]))
        changes[name] = "changed" if (existed and changed) else ("new" if changed else "unchanged")
    # Only newly published weeks need player names; fetch once on the runner, not on a phone.
    published = site["league"]["current_season_through_week"]
    if target > published:
        latest = api.load_raw(raw_dir, f"week-{target:02d}.json")
        ids = [pid for m in latest["matchups"] for pid in (m.get("starters") or []) if str(pid) != '0']
        if ids:
            players = api.fetch_player_names(ids)
            api.save_raw(raw_dir, f"players-week-{target:02d}.json", {
                "season": ctx["season"], "week": target, "players": players,
                "fetched_at_utc": api.utc_now(),
            })
    return ctx, target, changes


def staged_build(args, mode, through=None):
    """Build into a temp dir, verify there, and only then return the result."""
    data, sleeper_dir, raw_dir = paths(args)
    base = df.load(data)
    owner_map = bd.load_owner_map(os.path.join(sleeper_dir, "owner_map.json"))
    context = api.load_raw(raw_dir, "context.json")
    if context is None:
        raise bd.GateError("no saved Sleeper context; run the fetch step first")
    raw_weeks = api.load_all_weeks(raw_dir)
    ds, report = bd.build_from_sleeper(base, owner_map, context, raw_weeks, mode=mode, through=through)
    stage = tempfile.mkdtemp(prefix="sleeper-stage-")
    for fname, text in df.render(ds).items():
        with open(os.path.join(stage, fname), "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
    problems = vf.verify_dir(stage)
    return base, ds, report, stage, problems, context, raw_weeks


def build_report(base, ds, report, changed, context, raw_weeks, stability, parity_md=None):
    cur = bd.current_season(ds.site)
    names = bd.owner_names(ds.site)
    lines = [f"## Sleeper sync · {cur['year']} season · weeks {report['new_weeks'][0]}–{report['new_weeks'][-1]}"
             if len(report["new_weeks"]) > 1 else f"## Sleeper sync · {cur['year']} season · week {report['new_weeks'][0]}",
             "",
             f"- Publication cutoff moves from **week {report['published_week_before']}** to **week {report['through_week']}**.",
             f"- Sleeper reports week {report['last_scored_leg']} as the last scored week (fetched {context['fetched_at_utc']}).",
             f"- Sleeper scoring snapshot: **{stability}**. A completed week can publish after verification; no second snapshot is required.",
             f"- Verified against Sleeper: {report['verification']['verified_weeks']} already-published weeks, "
             f"{report['verification']['verified_games']} matchups ({report['verification']['exact']} scores exact, "
             f"{report['verification']['within_tolerance']} within 0.011).",
             "- Independent verifier: **all checks passed** (manifests, hashes, cutoffs, game integrity, full recomputation).", ""]
    standings = ds["current_standings"]
    has_ties = any(r["ties"] for r in standings)
    record_heading = "W–L–T" if has_ties else "W–L"
    lines += ["### Standings after the new week", "", f"| # | Owner | Team | {record_heading} | PF |", "| --- | --- | --- | --- | --- |"]
    for r in standings:
        record = f"{r['wins']}–{r['losses']}" + (f"–{r['ties']}" if has_ties else "")
        lines.append(f"| {r['rank']} | {names[r['owner_id']]} | {r['team']} | {record} | {r['points_for']:.2f} |")
    lines += [""]
    for w in report["new_weeks"]:
        lines += [f"### Week {w} results", "", "| Matchup | Score |", "| --- | --- |"]
        seen = set()
        for g in ds["games"]:
            qualifies = g["result"] == "W" or (g["result"] == "T" and g["owner_id"] < g["opponent_owner_id"])
            if g["year"] == cur["year"] and g["stage"] == "Regular Season" and g["week"] == w and qualifies and g["game_id"] not in seen:
                seen.add(g["game_id"])
                outcome = "def." if g["result"] == "W" else "tied"
                lines.append(f"| {g['owner_name']} {outcome} {g['opponent_owner_name']} | {g['points_for']:.2f}–{g['points_against']:.2f} |")
        lines.append("")
    if report["notes"]:
        lines += ["### Notes", ""] + [f"- {n}" for n in report["notes"]] + [""]
    lines += ["### Files changed", ""] + [f"- `site-data/{f}`" for f in changed] + [""]
    if parity_md:
        lines += [parity_md, ""]
    lines += ["### Publication", "",
              "A dry run reports these results without updating the site.",
              "A scheduled run, or a manual run with dry_run disabled, publishes verified new data to main and requests a GitHub Pages build.",
              "Corrections to an already-published week require a manual update."]
    return "\n".join(lines) + "\n"


def write_provenance(sleeper_dir, raw_dir, base, ds, report, context):
    prov = {
        "generator": "tools/sleeper/sync.py",
        "generator_version": bd.GENERATOR_VERSION,
        "league_id": context["league_id"],
        "season": context["season"],
        "published_through_week": report["through_week"],
        "excel_export_source_sha256": base["manifest"]["source_sha256"],
        "excel_export_covers_through_week": report["published_week_before"] if report["mode"] == "incremental" else None,
        "context_fetched_at_utc": context["fetched_at_utc"],
        "raw_payload_sha256": {f: sha_file(os.path.join(raw_dir, f)) for f in sorted(os.listdir(raw_dir)) if f.endswith(".json")},
    }
    path = os.path.join(sleeper_dir, "provenance.json")
    text = json.dumps(prov, indent=2) + "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
    if old != text:
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(text)
        return True
    return False


def player_preview_text(data, raw_dir, week):
    """Merge verified week's names into the existing small ticker name map."""
    snapshot = api.load_raw(raw_dir, f"players-week-{week:02d}.json")
    if snapshot is None:
        return None  # Offline rebuilds and older fixtures have no player-name snapshot.
    if snapshot.get("week") != week or not isinstance(snapshot.get("players"), dict):
        raise bd.GateError("player-name snapshot does not match the candidate week")
    source = os.path.join(data, "sleeper-sample.js")
    prefix = 'window.SPARTY_SLEEPER_SAMPLE = '
    original = open(source, encoding="utf-8").read().strip()
    if not original.startswith(prefix):
        raise bd.GateError("ticker name map has an unexpected format")
    preview = json.loads(original[len(prefix):].rstrip(';'))
    preview["players"].update(snapshot["players"])
    return prefix + json.dumps(preview, separators=(",", ":"), ensure_ascii=False) + ";\n"


def cmd_build(args, stability="unknown"):
    data, sleeper_dir, raw_dir = paths(args)
    base, ds, report, stage, problems, context, raw_weeks = staged_build(args, "incremental", args.through)
    try:
        if problems:
            write_report(args.report, "## Sleeper sync blocked\n\nThe independent verifier rejected the generated data:\n\n" + "\n".join(f"- {p}" for p in problems) + "\n")
            print("VERIFICATION FAILED:\n  " + "\n  ".join(problems), file=sys.stderr)
            emit(args, status="blocked", reason="verification")
            return EXIT_VERIFY
        parity_md = None
        if args.parity:
            parity_md = parity_markdown(args)
        # Generate against the verified staged snapshot before any published writes.
        # Failure blocks this publication and preserves the committed collection.
        try:
            sparty_dialogue.generate(stage)
        except Exception as error:
            message = f"Sparty dialogue validation failed; nothing published: {error}"
            print(message, file=sys.stderr)
            write_report(args.report, message + "\n")
            emit(args, status="blocked", reason="dialogue")
            return EXIT_VERIFY
        dialogue_name = "sparty-records.js"
        dialogue_text = df.read_text(stage, dialogue_name)
        preview = player_preview_text(data, raw_dir, report["through_week"])
        if args.dry_run:
            changed = [f for f, t in df.render(ds).items() if df.read_text(data, f) != t]
            if preview is not None and df.read_text(data, "sleeper-sample.js") != preview:
                changed.append("sleeper-sample.js")
            if not os.path.exists(os.path.join(data, dialogue_name)) or df.read_text(data, dialogue_name) != dialogue_text:
                changed.append(dialogue_name)
            print("dry run; would change:", ", ".join(changed))
        else:
            changed = df.save(ds, data)
            if not os.path.exists(os.path.join(data, dialogue_name)) or df.read_text(data, dialogue_name) != dialogue_text:
                target = os.path.join(data, dialogue_name)
                with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=data, delete=False) as fh:
                    fh.write(dialogue_text)
                    dialogue_temp = fh.name
                os.replace(dialogue_temp, target)
                changed.append(dialogue_name)
            if preview is not None and df.read_text(data, "sleeper-sample.js") != preview:
                with open(os.path.join(data, "sleeper-sample.js"), "w", encoding="utf-8", newline="") as fh:
                    fh.write(preview)
                changed.append("sleeper-sample.js")
            if write_provenance(sleeper_dir, raw_dir, base, ds, report, context):
                changed.append("sleeper/provenance.json")
        write_report(args.report, build_report(base, ds, report, changed, context, raw_weeks, stability, parity_md))
        emit(args, status="ready", week=report["through_week"], season=context["season"], files_changed=len(changed), stability=stability)
        return EXIT_OK
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def parity_markdown(args):
    """Rebuild the published weeks purely from Sleeper and compare with the committed export."""
    data, sleeper_dir, raw_dir = paths(args)
    published = df.load(data).site["league"]["current_season_through_week"]
    args2 = argparse.Namespace(**vars(args))
    base, ds, report, stage, problems, context, raw_weeks = staged_build(args2, "rebuild", published)
    try:
        if problems:
            return "### Sleeper vs Excel export\n\nThe Sleeper-only rebuild failed verification: " + "; ".join(problems) + "\n"
        result = cmp.compare_dirs(data, stage)
        md = cmp.to_markdown(result, "Excel export (committed)", "Sleeper-only rebuild")
        return md
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["fetch", "build", "run", "parity", "verify", "compare"])
    p.add_argument("--data-dir", default=DEFAULT_DATA)
    p.add_argument("--league-id")
    p.add_argument("--through", type=int, help="limit to this week")
    p.add_argument("--report", help="write a Markdown report to this path")
    p.add_argument("--parity", action="store_true", help="also compare a Sleeper-only rebuild with the committed export")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--github-output")
    p.add_argument("--baseline", help="compare: baseline directory (for example a fresh Excel export)")
    p.add_argument("--candidate", help="compare: candidate directory")
    p.add_argument("--whole-history", action="store_true", help="compare: include completed seasons")
    args = p.parse_args(argv)
    try:
        if args.command == "verify":
            problems = vf.verify_dir(args.data_dir)
            print("OK: data verified" if not problems else "VERIFICATION FAILED:\n  " + "\n  ".join(problems))
            return EXIT_OK if not problems else EXIT_VERIFY
        if args.command == "compare":
            if not args.baseline or not args.candidate:
                p.error("compare needs --baseline and --candidate")
            result = cmp.compare_dirs(args.baseline, args.candidate, args.whole_history)
            md = cmp.to_markdown(result, "Baseline", "Candidate")
            print(md)
            write_report(args.report, md)
            return EXIT_VERIFY if cmp.has_substantive(result) else EXIT_OK
        if args.command == "parity":
            md = parity_markdown(args)
            print(md)
            write_report(args.report, md)
            return EXIT_OK if "no substantive differences" in md else EXIT_VERIFY
        stability = "unknown"
        if args.command in ("fetch", "run"):
            ctx, target, changes = do_fetch(args)
            states = {k: v for k, v in changes.items() if k.startswith("week-")}
            latest = states.get(f"week-{target:02d}.json")
            stability = latest or "unknown"
            print(f"fetched league context and weeks 1-{target}; week {target} payload: {latest}")
            if args.command == "fetch":
                emit(args, status="fetched", week=target, stability=stability)
                return EXIT_OK
        return cmd_build(args, stability)
    except bd.NothingToPublish as e:
        print(f"Nothing to publish: {e}")
        write_report(args.report, f"Nothing to publish: {e}\n")
        emit(args, status="nothing")
        return EXIT_NOTHING
    except bd.GateError as e:
        text = "## Sleeper sync not ready\n\nNothing was changed. Reasons:\n\n" + "\n".join(f"- {r}" for r in e.reasons) + "\n"
        print(text, file=sys.stderr)
        write_report(args.report, text)
        emit(args, status="blocked", reason="gate")
        return EXIT_GATE
    except api.FetchError as e:
        print(f"Could not reach Sleeper: {e}", file=sys.stderr)
        write_report(args.report, f"## Sleeper sync could not fetch data\n\n{e}\n")
        emit(args, status="blocked", reason="fetch")
        return EXIT_FETCH


if __name__ == "__main__":
    sys.exit(main())
