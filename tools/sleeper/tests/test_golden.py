"""Excel-parity tests: the derivation code must reproduce the committed export exactly."""
import copy
import os
import unittest

import fixtures as fx
import build as bd
import datafiles as df
import derive as dv
import verify as vf


class GoldenParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = fx.load_base()

    def test_every_generated_file_is_byte_identical(self):
        """Rebuilding all 14 files from games.json must equal the Excel export, byte for byte."""
        ds = bd.derive_dataset(self.base, self.base["games"], 4, self.base.site["league"]["generated_at_utc"])
        for fname, text in df.render(ds).items():
            with self.subTest(file=fname):
                self.assertEqual(df.read_text(fx.DATA, fname), text)

    def test_committed_data_passes_the_independent_verifier(self):
        self.assertEqual(vf.verify_dir(fx.DATA), [])

    def test_historical_seasons_rederive_from_games(self):
        """Every completed season's summary, Ask Sparty game rows and league row match the export."""
        names = bd.owner_names(self.base.site)
        by_year = {s["year"]: s for s in self.base.site["seasons"]}
        for year, season in sorted(by_year.items()):
            if season["status"] not in ("Complete", "Current"):
                continue
            with self.subTest(year=year):
                rows = dv.season_summary_rows(self.base["games"], season, names, season["status"])
                self.assertEqual(rows, [r for r in self.base["season_summaries"] if r["year"] == year])
                ai = dv.ai_game_rows(self.base["games"], season, season["era"], season["status"])
                key = lambda a: (a["week"], a["owner"])
                self.assertEqual(df.dumps_compact(sorted(ai, key=key)),
                                 df.dumps_compact(sorted([a for a in self.base["ai_games"] if a["year"] == year], key=key)))

    def test_ai_season_columns_match_for_every_owner_season(self):
        """All 33 Ask Sparty season columns reproduce for 166 owner-seasons (one known 2019 quirk)."""
        quirk = (2019, "Maggie", "average_bottom_5")
        by_year = {s["year"]: s for s in self.base.site["seasons"]}
        mismatches = []
        for year, season in by_year.items():
            if season["status"] not in ("Complete", "Current"):
                continue
            ai = dv.ai_game_rows(self.base["games"], season, season["era"], season["status"])
            rows = dv.ai_season_rows(self.base["games"], season, None, ai, season["era"], season["status"])
            for published in (r for r in self.base["ai_seasons"] if r["year"] == year):
                mine = rows[published["owner"]]
                for k in published:
                    if df.dumps_compact(mine[k]) != df.dumps_compact(published[k]):
                        mismatches.append((year, published["owner"], k))
        self.assertEqual(mismatches, [quirk])

    def test_python_sum_difference_is_handled(self):
        """ssum is plain left-to-right addition, independent of the interpreter's sum()."""
        values = [124.78, 125.56, 110.3, 136.26]
        total = 0.0
        for v in values:
            total += v
        self.assertEqual(dv.ssum(values), total)


if __name__ == "__main__":
    unittest.main()
