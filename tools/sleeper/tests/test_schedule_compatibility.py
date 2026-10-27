"""Ties and playoff boundaries must remain valid through the full publishing path."""
import tempfile
import unittest
from unittest import mock

import fixtures as fx
import build as bd
import datafiles as df
import sync
import verify as vf


class ScheduleCompatibility(unittest.TestCase):
    def test_tied_week_survives_verification_and_dialogue_generation(self):
        base = fx.load_base()
        raw = fx.raw_weeks(base)
        raw[5] = fx.synthetic_week(5)
        for row in raw[5]["matchups"]:
            row["points"] = 100
        ds, report = bd.build_from_sleeper(base, fx.owner_map(), fx.context(5), raw)
        self.assertEqual(report["through_week"], 5)
        markdown = sync.build_report(base, ds, report, [], fx.context(5), raw, "new")
        self.assertIn("W–L–T", markdown)
        self.assertEqual(markdown.count(" tied "), 6)
        for row in ds["current_standings"]:
            self.assertEqual(row["ties"], 1)
            self.assertEqual(row["wins"] + row["losses"] + row["ties"], 5)
        ai = [r for r in ds["ai_games"] if r["year"] == 2026 and r["week"] == 5]
        self.assertTrue(all(r["win_streak"] == r["loss_streak"] == 0 for r in ai))
        for row in [r for r in ds["ai_seasons"] if r["year"] == 2026]:
            self.assertEqual(row["wins"] + row["losses"] + row["ties"], row["games_played"])
        with tempfile.TemporaryDirectory() as stage:
            df.save(ds, stage)
            self.assertEqual(vf.verify_dir(stage), [])
            sync.sparty_dialogue.generate(stage)

    def test_all_tied_season_has_no_invented_winner_or_division_by_zero(self):
        base = fx.load_base()
        raw = fx.raw_weeks(base)
        for week in raw.values():
            for row in week["matchups"]:
                row["points"] = 100
                row["custom_points"] = None
        ds, _ = bd.build_from_sleeper(base, fx.owner_map(), fx.context(4), raw, mode="rebuild")
        self.assertTrue(all(r["wins"] == r["losses"] == 0 and r["ties"] == 4 for r in ds["current_standings"]))
        league = next(r for r in ds["ai_league_years"] if r["year"] == 2026)
        self.assertIsNone(league["average_winning_score"])
        self.assertIsNone(league["average_losing_score"])
        self.assertEqual(league["average_matchup_total"], 200)
        with tempfile.TemporaryDirectory() as stage:
            df.save(ds, stage)
            self.assertEqual(vf.verify_dir(stage), [])
            sync.sparty_dialogue.generate(stage)

    def test_playoff_boundary_mismatch_blocks_build_and_fetch(self):
        base = fx.load_base()
        ctx = fx.context(5, playoff_week_start=14, start_week=1)
        with self.assertRaisesRegex(bd.GateError, "playoff_week_start"):
            bd.build_from_sleeper(base, fx.owner_map(), ctx, fx.raw_weeks(base))
        args = type("Args", (), {"data_dir":fx.DATA,"league_id":None,"through":None})()
        with mock.patch.object(sync.api, "fetch_context", return_value=ctx), mock.patch.object(sync.api, "fetch_week") as fetch:
            with self.assertRaisesRegex(bd.GateError, "playoff_week_start"):
                sync.do_fetch(args)
            fetch.assert_not_called()

    def test_playoff_results_cannot_extend_regular_season(self):
        base = fx.load_base()
        raw = fx.raw_weeks(base)
        raw.update({w:fx.synthetic_week(w) for w in range(5,15)})
        # Deliberately incomplete playoff data must never even be parsed.
        raw[15] = {"week":15,"matchups":[]}
        ctx = fx.context(18, playoff_week_start=15, start_week=1)
        ds, report = bd.build_from_sleeper(base, fx.owner_map(), ctx, raw)
        self.assertEqual(report["through_week"], 14)
        self.assertTrue(all(g["week"] <= 14 for g in ds["games"] if g["year"] == 2026))
        with self.assertRaises(bd.NothingToPublish):
            bd.build_from_sleeper(ds, fx.owner_map(), ctx, raw)

    def test_boundary_works_for_other_regular_season_lengths(self):
        self.assertEqual(bd.regular_season_limit({"regular_season_weeks":13},{"playoff_week_start":14,"start_week":1}),13)
        self.assertEqual(bd.regular_season_limit({"regular_season_weeks":14},{"playoff_week_start":0}),14)
        with self.assertRaises(bd.GateError):
            bd.regular_season_limit({"regular_season_weeks":14},{"playoff_week_start":15,"start_week":2})
