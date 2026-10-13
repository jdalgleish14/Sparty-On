"""Sleeper build tests: the happy path against real data, and every way it must refuse to publish."""
import copy
import unittest

import fixtures as fx
import build as bd
import datafiles as df
import verify as vf


class IncrementalBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = fx.load_base()
        cls.omap = fx.owner_map()

    def build(self, base=None, raw=None, ctx=None, **kw):
        base = base or fx.base_through(self.base, 3)
        raw = raw or fx.raw_weeks(self.base, 4)
        return bd.build_from_sleeper(base, self.omap, ctx or fx.context(4), raw, **kw)

    def test_real_week4_reproduces_the_excel_export(self):
        """Real Sleeper week-4 data on a week-3 base equals the committed Excel week-4 export."""
        ds, report = self.build()
        self.assertEqual(report["new_weeks"], [4])
        self.assertEqual(report["verification"]["verified_weeks"], 3)
        rendered = df.render(ds)
        # Only games.json row order inside week 4 (and the files embedding it) may differ.
        order_only = {"games.json", "manifest.json", "site-data.js"}
        for fname, text in rendered.items():
            if fname in order_only:
                continue
            with self.subTest(file=fname):
                self.assertEqual(df.read_text(fx.DATA, fname), text)
        key = lambda g: (g["game_id"], g["owner_id"])
        self.assertEqual(sorted(ds["games"], key=key), sorted(self.base["games"], key=key))

    def test_generated_output_passes_the_verifier(self):
        import os, shutil, tempfile
        ds, _ = self.build()
        stage = tempfile.mkdtemp()
        try:
            for fname, text in df.render(ds).items():
                with open(os.path.join(stage, fname), "w", encoding="utf-8", newline="") as fh:
                    fh.write(text)
            self.assertEqual(vf.verify_dir(stage), [])
        finally:
            shutil.rmtree(stage)

    def test_rerun_is_idempotent(self):
        """Once week 4 is published, running again with the same payloads changes nothing."""
        ds, _ = self.build()
        with self.assertRaises(bd.NothingToPublish):
            bd.build_from_sleeper(ds, self.omap, fx.context(4), fx.raw_weeks(self.base, 4))

    def test_new_week_five_is_added_and_dependents_recalculate(self):
        raw = fx.raw_weeks(self.base, 4)
        raw[5] = fx.synthetic_week(5)
        ds, report = bd.build_from_sleeper(self.base, self.omap, fx.context(5), raw)
        self.assertEqual(report["new_weeks"], [5])
        self.assertEqual(ds.site["league"]["current_season_through_week"], 5)
        self.assertEqual(ds["validation_report"]["publication_cutoff"]["current_season_through_week"], 5)
        self.assertEqual(ds["manifest"]["publication_cutoff"]["current_season_through_week"], 5)
        self.assertEqual(ds["ai_manifest"]["publication_cutoff"]["current_season_through_week"], 5)
        self.assertEqual(len([g for g in ds["games"] if g["year"] == 2026]), 60)
        self.assertEqual({r["games_played"] for r in ds["current_standings"]}, {5})
        self.assertEqual(len([r for r in ds["ai_games"] if r["year"] == 2026]), 60)
        self.assertEqual({r["games_played"] for r in ds["ai_seasons"] if r["year"] == 2026}, {5})
        self.assertEqual([r for r in ds["ai_league_years"] if r["year"] == 2026][0]["matchups"], 30)
        # nothing historical moved
        for key in ("championships",):
            self.assertEqual(ds[key], self.base[key])
        self.assertEqual([r for r in ds["season_summaries"] if r["year"] != 2026],
                         [r for r in self.base["season_summaries"] if r["year"] != 2026])
        self.assertEqual([r for r in ds["ai_seasons"] if r["year"] != 2026],
                         [r for r in self.base["ai_seasons"] if r["year"] != 2026])
        self.assertEqual([g for g in ds["games"] if g["year"] != 2026], [g for g in self.base["games"] if g["year"] != 2026])
        # postseason block still follows the regular-season block
        stages = [g["stage"] for g in ds["games"]]
        self.assertEqual(stages, sorted(stages, key=lambda s: s == "Postseason"))

    def test_two_new_weeks_in_one_run(self):
        raw = fx.raw_weeks(self.base, 4)
        raw[5], raw[6] = fx.synthetic_week(5), fx.synthetic_week(6)
        ds, report = bd.build_from_sleeper(self.base, self.omap, fx.context(6), raw)
        self.assertEqual(report["new_weeks"], [5, 6])
        self.assertEqual(ds.site["league"]["current_season_through_week"], 6)

    def test_commissioner_correction_overrides_points(self):
        raw = fx.raw_weeks(self.base, 4)
        w5 = fx.synthetic_week(5)
        w5["matchups"][0]["points"] = 100.0
        w5["matchups"][0]["custom_points"] = 133.33
        raw[5] = w5
        ds, _ = bd.build_from_sleeper(self.base, self.omap, fx.context(5), raw)
        scores = {g["points_for"] for g in ds["games"] if g["year"] == 2026 and g["week"] == 5}
        self.assertIn(133.33, scores)
        self.assertNotIn(100.0, scores)


class GatesRefuseUnsafeData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = fx.load_base()
        cls.omap = fx.owner_map()

    def week5(self, mutate=None, last=5):
        raw = fx.raw_weeks(self.base, 4)
        w5 = fx.synthetic_week(5)
        if mutate:
            mutate(w5)
        raw[5] = w5
        return raw, fx.context(last)

    def refused(self, raw, ctx, fragment, omap=None, **kw):
        with self.assertRaises(bd.GateError) as cm:
            bd.build_from_sleeper(self.base, omap or self.omap, ctx, raw, **kw)
        self.assertTrue(any(fragment in r for r in cm.exception.reasons), cm.exception.reasons)

    def test_week_not_scored_yet(self):
        raw, ctx = self.week5(last=4)
        with self.assertRaises(bd.NothingToPublish):
            bd.build_from_sleeper(self.base, self.omap, ctx, raw)

    def test_sleeper_behind_published_weeks(self):
        raw, ctx = self.week5(last=3)
        self.refused(raw, ctx, "already publishes week 4")

    def test_incomplete_week_missing_a_team(self):
        raw, ctx = self.week5(lambda w: w["matchups"].pop())
        self.refused(raw, ctx, "do not match the 12 expected rosters")

    def test_matchup_with_one_team(self):
        def mutate(w):
            w["matchups"][1]["matchup_id"] = 99
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "has 1 teams, expected 2")

    def test_zero_score_means_not_scored(self):
        def mutate(w):
            w["matchups"][0]["points"] = 0.0
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "zero or negative score")

    def test_all_zero_week(self):
        def mutate(w):
            for m in w["matchups"]:
                m["points"] = 0
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "zero or negative score")

    def test_missing_score(self):
        def mutate(w):
            w["matchups"][0]["points"] = None
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "no numeric score")

    def test_exact_tie_is_not_guessed(self):
        def mutate(w):
            w["matchups"][1]["points"] = w["matchups"][0]["points"]
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "exact tie")

    def test_score_with_extra_decimals(self):
        def mutate(w):
            w["matchups"][0]["points"] = 101.123
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "more than two decimals")

    def test_bye_week_team(self):
        def mutate(w):
            w["matchups"][0]["matchup_id"] = None
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "no matchup")

    def test_missing_earlier_payload_blocks_verification(self):
        raw, ctx = self.week5()
        del raw[2]
        self.refused(raw, ctx, "missing Sleeper payloads for weeks [2]")

    def test_published_week_score_changed_in_sleeper(self):
        raw, ctx = self.week5()
        raw[2]["matchups"][0]["points"] = round(raw[2]["matchups"][0]["points"] + 1.5, 2)
        self.refused(raw, ctx, "in Sleeper but")

    def test_published_week_small_rounding_difference_is_noted_not_fatal(self):
        raw, ctx = self.week5()
        raw[2]["matchups"][0]["points"] = round(raw[2]["matchups"][0]["points"] + 0.01, 2)
        ds, report = bd.build_from_sleeper(self.base, self.omap, ctx, raw)
        self.assertEqual(report["verification"]["within_tolerance"], 1)
        self.assertTrue(any("within tolerance" in n for n in report["notes"]))

    def test_wrong_roster_mapping_is_caught_by_published_weeks(self):
        """Swap two owners in the map: published weeks no longer match Sleeper, so nothing publishes."""
        omap = copy.deepcopy(self.omap)
        omap["rosters"][1], omap["rosters"][2] = omap["rosters"][2], omap["rosters"][1]
        raw, ctx = self.week5()
        self.refused(raw, ctx, "week 1", omap=omap)

    def test_owner_map_missing_a_roster(self):
        omap = copy.deepcopy(self.omap)
        del omap["rosters"][12]
        raw, ctx = self.week5()
        self.refused(raw, ctx, "differ", omap=omap)

    def test_one_owner_on_two_rosters(self):
        omap = copy.deepcopy(self.omap)
        omap["rosters"][2] = omap["rosters"][1]
        raw, ctx = self.week5()
        self.refused(raw, ctx, "more than one roster", omap=omap)

    def test_pairing_that_differs_from_published_schedule(self):
        raw, ctx = self.week5()
        a, b = raw[3]["matchups"][0], raw[3]["matchups"][2]
        a["matchup_id"], b["matchup_id"] = b["matchup_id"], a["matchup_id"]
        self.refused(raw, ctx, "week 3")

    def test_wrong_league(self):
        raw, ctx = self.week5()
        ctx["league_id"] = "999"
        self.refused(raw, ctx, "does not match the configured")

    def test_wrong_season(self):
        raw, ctx = self.week5()
        ctx["season"] = "2025"
        self.refused(raw, ctx, "do not match the site's current season")

    def test_league_before_the_season_is_nothing_to_publish(self):
        raw, ctx = self.week5()
        for status in ("pre_draft", "drafting"):
            ctx["status"] = status
            with self.assertRaises(bd.NothingToPublish):
                bd.build_from_sleeper(self.base, self.omap, ctx, raw)

    def test_unknown_league_status_is_refused(self):
        raw, ctx = self.week5()
        ctx["status"] = "archived"
        self.refused(raw, ctx, "expected in_season or complete")

    def test_payload_from_another_league_or_season_is_refused(self):
        raw, ctx = self.week5()
        raw[5]["league_id"] = "999"
        self.refused(raw, ctx, "belongs to league 999")
        raw, ctx = self.week5()
        raw[5]["season"] = "2025"
        self.refused(raw, ctx, "season 2025")

    def test_roster_changed_hands_when_pinned(self):
        omap = copy.deepcopy(self.omap)
        omap["sleeper_user_ids"] = {"1": "someone-else"}
        raw, ctx = self.week5()
        self.refused(raw, ctx, "different Sleeper user", omap=omap)

    def test_scoring_status_unknown(self):
        raw, ctx = self.week5()
        ctx["last_scored_leg"] = None
        self.refused(raw, ctx, "last_scored_leg")

    def test_requested_week_not_scored(self):
        raw, ctx = self.week5(last=5)
        self.refused(raw, ctx, "not yet scored", through=6)

    def test_payload_labelled_with_wrong_week(self):
        def mutate(w):
            w["week"] = 6
        raw, ctx = self.week5(mutate)
        self.refused(raw, ctx, "labelled week 6")

    def test_regular_season_never_extended_past_the_last_week(self):
        raw, _ = self.week5()
        ctx = fx.context(18)           # Sleeper counting playoff legs
        ctx["last_scored_leg"] = 18
        raw[5] = fx.synthetic_week(5)
        for w in range(6, 15):
            raw[w] = fx.synthetic_week(w)
        ds, report = bd.build_from_sleeper(self.base, self.omap, ctx, raw)
        self.assertEqual(report["through_week"], 14)   # capped at the 14-week regular season


class VerifierDetectsTampering(unittest.TestCase):
    def setUp(self):
        import tempfile, shutil
        self.tmp, self.dir = fx.copy_repo_data()
        self.addCleanup(lambda: shutil.rmtree(self.tmp))

    def test_clean_copy_passes(self):
        self.assertEqual(vf.verify_dir(self.dir), [])

    def edit(self, fname, fn):
        import json, os
        path = os.path.join(self.dir, fname)
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        fn(data)
        compact = fname.startswith("ai_")
        with open(path, "w", encoding="utf-8", newline="") as fh:
            fh.write(df.dumps_compact(data) if compact else df.dumps_indent(data))

    def test_changed_score_without_updating_dependents(self):
        def f(games):
            games[2100]["points_for"] = round(games[2100]["points_for"] + 5, 2)
        self.edit("games.json", f)
        self.assertTrue(vf.verify_dir(self.dir))

    def test_cutoff_disagreement(self):
        def f(m):
            m["publication_cutoff"]["current_season_through_week"] = 5
        self.edit("manifest.json", f)
        problems = vf.verify_dir(self.dir)
        self.assertTrue(any("cutoff" in p for p in problems))

    def test_ai_file_out_of_date(self):
        def f(rows):
            rows[-1]["points_for"] = 1.5
        self.edit("ai_games.json", f)
        self.assertTrue(vf.verify_dir(self.dir))

    def test_validation_report_failure(self):
        def f(v):
            v["checks"][0]["status"] = "FAIL"
        self.edit("validation_report.json", f)
        self.assertTrue(vf.verify_dir(self.dir))


if __name__ == "__main__":
    unittest.main()
