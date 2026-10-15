"""End-to-end tests of the command line, the Sleeper client and the comparison tool."""
import io
import json
import os
import shutil
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

import fixtures as fx
import compare as cmp
import datafiles as df
import sleeper_api as api
import sync


def run(argv):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = sync.main(argv)
    return code, out.getvalue(), err.getvalue()


class FakeSleeper:
    """Stands in for api.sleeper.app: serves the league, rosters, users, state and matchups."""

    def __init__(self, base, last_scored=5, weeks=None, week_edits=None):
        self.base = base
        self.omap = fx.owner_map()
        self.last = last_scored
        self.weeks = weeks or {}
        self.edits = week_edits or {}
        self.calls = []

    def __call__(self, path, **_):
        self.calls.append(path)
        lid = self.omap["league_id"]
        if path == f"/league/{lid}":
            return {"league_id": lid, "season": "2026", "status": "in_season", "total_rosters": 12,
                    "settings": {"last_scored_leg": self.last, "leg": self.last + 1, "start_week": 1, "playoff_week_start": 15}}
        if path == f"/league/{lid}/rosters":
            return [{"roster_id": r, "owner_id": f"user{r}", "co_owners": None} for r in sorted(self.omap["rosters"])]
        if path == f"/league/{lid}/users":
            return [{"user_id": f"user{r}", "display_name": f"Mgr{r}", "metadata": {"team_name": f"Team {r}"}} for r in sorted(self.omap["rosters"])]
        if path == "/state/nfl":
            return {"season": "2026", "season_type": "regular", "week": self.last + 1, "display_week": self.last + 1, "leg": self.last + 1}
        if path == "/players/nfl":
            return {"NEW5": {"full_name": "New Starter", "position": "WR", "team": "DET"}}
        if path.startswith(f"/league/{lid}/matchups/"):
            week = int(path.rsplit("/", 1)[1])
            data = self.weeks.get(week)
            if data is None:
                data = fx.payload(self.base, week) if week <= 4 else fx.synthetic_week(week)
            ms = [dict(m) for m in data["matchups"]]
            for fn in self.edits.get(week, []):
                fn(ms)
            return ms
        raise AssertionError(f"unexpected request {path}")


class CommandLine(unittest.TestCase):
    def setUp(self):
        self.base = fx.load_base()
        self.tmp, self.data = fx.copy_repo_data()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.out = os.path.join(self.tmp, "github_output.txt")

    def argv(self, command, *extra):
        return [command, "--data-dir", self.data, "--github-output", self.out, *extra]

    def status(self):
        with open(self.out, encoding="utf-8") as fh:
            return dict(line.strip().split("=", 1) for line in fh if "=" in line)

    def test_new_week_includes_names_for_new_starters_without_shipping_player_catalog(self):
        payload = fx.synthetic_week(5)
        payload["matchups"][0]["starters"] = ["NEW5"]
        fake = FakeSleeper(self.base, last_scored=5, weeks={5: payload})
        with mock.patch.object(api, "get_json", fake):
            code, _, err = run(self.argv("run"))
        self.assertEqual(code, 0, err)
        self.assertIn("/players/nfl", fake.calls)
        with open(os.path.join(self.data, "sleeper-sample.js"), encoding="utf-8") as fh:
            preview = fh.read()
        self.assertIn('"NEW5":{"name":"New Starter","position":"WR","team":"DET"}', preview)
        self.assertNotIn('"players":{"NEW5":', preview)  # Existing names were retained.
        self.assertLess(len(preview), 30000)

    def test_full_run_produces_a_verified_week_five(self):
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake):
            code, out, err = run(self.argv("run", "--parity", "--report", os.path.join(self.tmp, "report.md")))
        self.assertEqual(code, 0, err)
        st = self.status()
        self.assertEqual((st["status"], st["week"], st["stability"]), ("ready", "5", "new"))
        site = df.load(self.data).site
        self.assertEqual(site["league"]["current_season_through_week"], 5)
        with open(os.path.join(self.tmp, "report.md"), encoding="utf-8") as fh:
            report = fh.read()
        self.assertTrue(report.strip())
        self.assertIn("no substantive differences", report)
        self.assertIn("week 5", report.lower())
        self.assertTrue(os.path.exists(os.path.join(self.data, "sleeper", "provenance.json")))
        self.assertEqual(code, 0)
        code, _, _ = run(["verify", "--data-dir", self.data])
        self.assertEqual(code, 0)

    def test_dialogue_matches_new_week_and_is_capped(self):
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake):
            code, _, err = run(self.argv("run"))
        self.assertEqual(code, 0, err)
        text = df.read_text(self.data, "sparty-records.js")
        collection = json.loads(text[len(sync.sparty_dialogue.PREFIX):].strip().rstrip(";"))
        self.assertEqual(collection["cutoff"], {"year": 2026, "week": 5})
        self.assertEqual(collection["source_fingerprint"], sync.sparty_dialogue.fingerprint(df.load(self.data).site))
        self.assertEqual(len(collection["sayings"]), 200)

    def test_dialogue_failure_blocks_publication_and_preserves_last_file(self):
        target = os.path.join(self.data, "sparty-records.js")
        with open(target, "w", encoding="utf-8") as stream:
            stream.write("LAST VALID COLLECTION")
        before = df.read_text(self.data, "site-data.js")
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake), mock.patch.object(sync.sparty_dialogue, "generate", side_effect=ValueError("bad candidate")):
            code, _, err = run(self.argv("run"))
        self.assertEqual(code, sync.EXIT_VERIFY)
        self.assertEqual(self.status()["reason"], "dialogue")
        self.assertEqual(df.read_text(self.data, "site-data.js"), before)
        self.assertEqual(df.read_text(self.data, "sparty-records.js"), "LAST VALID COLLECTION")

    def test_second_run_with_unchanged_scores_is_a_no_op(self):
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake):
            self.assertEqual(run(self.argv("run"))[0], 0)
            snapshot = {f: df.read_text(self.data, f) for f in os.listdir(self.data) if f.endswith((".json", ".js"))}
            code, out, _ = run(self.argv("run"))
        self.assertEqual(code, 10)
        self.assertEqual(self.status()["status"], "nothing")
        after = {f: df.read_text(self.data, f) for f in os.listdir(self.data) if f.endswith((".json", ".js"))}
        self.assertEqual(snapshot, after)

    def test_rerunning_the_same_unmerged_week_reports_stability(self):
        """Branch already holds week 5 raw data; a later run with identical scores says 'unchanged'."""
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake):
            run(self.argv("fetch"))
            st1 = self.status()["stability"]
        # simulate the proposal branch: published data still at week 4, raw week 5 present
        with mock.patch.object(api, "get_json", fake):
            code, _, _ = run(self.argv("fetch"))
        self.assertEqual((st1, self.status()["stability"]), ("new", "unchanged"))

    def test_score_correction_between_runs_is_flagged(self):
        fake = FakeSleeper(self.base, last_scored=5)
        with mock.patch.object(api, "get_json", fake):
            run(self.argv("fetch"))
        fake.edits = {5: [lambda ms: ms[0].update(points=round(ms[0]["points"] + 2.0, 2))]}
        with mock.patch.object(api, "get_json", fake):
            run(self.argv("fetch"))
        self.assertEqual(self.status()["stability"], "changed")

    def test_week_not_yet_scored_publishes_nothing(self):
        fake = FakeSleeper(self.base, last_scored=4)
        before = {f: df.read_text(self.data, f) for f in ("games.json", "site-data.js")}
        with mock.patch.object(api, "get_json", fake):
            code, _, _ = run(self.argv("run"))
        self.assertEqual(code, 10)
        self.assertEqual(before, {f: df.read_text(self.data, f) for f in before})

    def test_incomplete_week_blocks_and_changes_nothing(self):
        fake = FakeSleeper(self.base, last_scored=5, week_edits={5: [lambda ms: ms.pop()]})
        before = {f: df.read_text(self.data, f) for f in df.render(df.load(self.data))}
        with mock.patch.object(api, "get_json", fake):
            code, _, err = run(self.argv("run", "--report", os.path.join(self.tmp, "r.md")))
        self.assertEqual(code, 2)
        self.assertEqual(self.status()["status"], "blocked")
        with open(os.path.join(self.tmp, "r.md"), encoding="utf-8") as fh:
            self.assertIn("not ready", fh.read())
        self.assertEqual(before, {f: df.read_text(self.data, f) for f in before})

    def test_changed_published_week_blocks(self):
        edits = {2: [lambda ms: ms[0].update(points=round(ms[0]["points"] + 3.0, 2))]}
        fake = FakeSleeper(self.base, last_scored=5, week_edits=edits)
        with mock.patch.object(api, "get_json", fake):
            code, _, err = run(self.argv("run"))
        self.assertEqual(code, 2)
        self.assertIn("published data", err)

    def test_sleeper_unreachable(self):
        def boom(path, **_):
            raise api.FetchError("network down")
        with mock.patch.object(api, "get_json", boom):
            code, _, err = run(self.argv("run"))
        self.assertEqual(code, 4)
        self.assertEqual(self.status()["reason"], "fetch")

    def test_dry_run_writes_nothing(self):
        fake = FakeSleeper(self.base, last_scored=5)
        before = {f: df.read_text(self.data, f) for f in ("games.json", "site-data.js", "manifest.json")}
        with mock.patch.object(api, "get_json", fake):
            code, out, _ = run(self.argv("run", "--dry-run"))
        self.assertEqual(code, 0)
        self.assertEqual(before, {f: df.read_text(self.data, f) for f in before})

    def test_parity_confirms_sleeper_matches_the_excel_export(self):
        fake = FakeSleeper(self.base, last_scored=4)
        with mock.patch.object(api, "get_json", fake):
            run(self.argv("fetch"))
        code, out, _ = run(self.argv("parity"))
        self.assertEqual(code, 0, out)
        self.assertIn("no substantive differences", out)

    def test_parity_detects_a_difference(self):
        edits = {4: [lambda ms: ms[0].update(points=round(ms[0]["points"] + 4.0, 2))]}
        fake = FakeSleeper(self.base, last_scored=4, week_edits=edits)
        with mock.patch.object(api, "get_json", fake):
            run(self.argv("fetch"))
        code, out, _ = run(self.argv("parity"))
        self.assertEqual(code, 3)
        self.assertIn("DIFFERENCES FOUND", out)


class CompareTool(unittest.TestCase):
    def setUp(self):
        self.tmp, self.data = fx.copy_repo_data()
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_identical_directories(self):
        result = cmp.compare_dirs(fx.DATA, self.data)
        self.assertFalse(cmp.has_substantive(result))

    def test_reordered_rows_are_not_differences(self):
        path = os.path.join(self.data, "games.json")
        with open(path, encoding="utf-8") as fh:
            games = json.load(fh)
        idx = [i for i, g in enumerate(games) if g["year"] == 2026 and g["week"] == 4]
        block = [games[i] for i in idx][::-1]
        for i, g in zip(idx, block):
            games[i] = g
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(df.dumps_indent(games))
        result = cmp.compare_dirs(fx.DATA, self.data)
        self.assertFalse(cmp.has_substantive(result))
        self.assertTrue([t for t in result["tables"] if t["table"] == "games"][0]["order_only"])

    def test_changed_score_is_a_difference(self):
        path = os.path.join(self.data, "games.json")
        with open(path, encoding="utf-8") as fh:
            games = json.load(fh)
        games[2100]["points_for"] += 1
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(df.dumps_indent(games))
        self.assertTrue(cmp.has_substantive(cmp.compare_dirs(fx.DATA, self.data)))

    def test_different_cutoffs_compare_only_common_weeks(self):
        base = fx.load_base()
        raw = fx.raw_weeks(base, 4)
        raw[5] = fx.synthetic_week(5)
        import build as bd
        ds, _ = bd.build_from_sleeper(base, fx.owner_map(), fx.context(5), raw)
        out = os.path.join(self.tmp, "week5")
        shutil.copytree(self.data, out)
        df.save(ds, out)
        result = cmp.compare_dirs(fx.DATA, out)
        self.assertFalse(cmp.has_substantive(result))
        self.assertTrue(result["notes"])
        self.assertEqual({t["table"] for t in result["tables"]}, {"games", "ai_games", "ai_all_games"})


class SleeperClient(unittest.TestCase):
    def test_retries_then_succeeds(self):
        calls = []

        class Resp:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return b'{"ok": true}'

        def opener(req, timeout=None):
            calls.append(1)
            if len(calls) < 3:
                raise urllib.error.URLError("temporary")
            return Resp()
        self.assertEqual(api.get_json("/x", opener=opener, sleep=lambda s: None), {"ok": True})
        self.assertEqual(len(calls), 3)

    def test_gives_up_after_retries(self):
        def opener(req, timeout=None):
            raise urllib.error.URLError("down")
        with self.assertRaises(api.FetchError):
            api.get_json("/x", opener=opener, sleep=lambda s: None, retries=2)

    def test_client_error_is_not_retried(self):
        calls = []

        def opener(req, timeout=None):
            calls.append(1)
            raise urllib.error.HTTPError(req.full_url, 404, "nf", {}, None)
        with self.assertRaises(api.FetchError):
            api.get_json("/x", opener=opener, sleep=lambda s: None)
        self.assertEqual(len(calls), 1)

    def test_snapshot_rewrite_only_when_data_changes(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        obj = {"week": 1, "fetched_at_utc": "a", "matchups": [1]}
        self.assertTrue(api.save_raw(tmp, "w.json", obj))
        self.assertFalse(api.save_raw(tmp, "w.json", {**obj, "fetched_at_utc": "b"}))
        self.assertEqual(api.load_raw(tmp, "w.json")["fetched_at_utc"], "a")
        self.assertTrue(api.save_raw(tmp, "w.json", {**obj, "matchups": [2]}))


if __name__ == "__main__":
    unittest.main()
