import json
import os
import shutil
import tempfile
import unittest

import fixtures  # noqa: F401  (sets sys.path)
import stability


class Stability(unittest.TestCase):
    def setUp(self):
        self.cur = tempfile.mkdtemp()
        self.prev = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.cur)
        self.addCleanup(shutil.rmtree, self.prev)

    def put(self, folder, name, points, when):
        path = os.path.join(folder, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"week": 5, "fetched_at_utc": when, "matchups": [{"points": points}]}, fh)
        return path

    def test_classification(self):
        thu, wed = "2026-10-15T12:00:00+00:00", "2026-10-14T12:00:00+00:00"
        a = self.put(self.cur, "week-05.json", 1, thu)
        self.assertEqual(stability.classify([a], ""), "new")
        self.assertEqual(stability.classify([a], self.prev), "new")          # no earlier look
        self.put(self.prev, "week-05.json", 1, wed)
        self.assertEqual(stability.classify([a], self.prev), "unchanged")    # 24h apart, same scores
        self.put(self.prev, "week-05.json", 1, "2026-10-15T11:00:00+00:00")
        self.assertEqual(stability.classify([a], self.prev), "too-soon")     # looked an hour ago
        self.put(self.prev, "week-05.json", 2, wed)
        self.assertEqual(stability.classify([a], self.prev), "changed")

    def test_most_cautious_result_wins_across_files(self):
        thu, wed = "2026-10-15T12:00:00+00:00", "2026-10-14T12:00:00+00:00"
        a = self.put(self.cur, "week-05.json", 1, thu)
        b = self.put(self.cur, "week-06.json", 1, thu)
        self.put(self.prev, "week-05.json", 1, wed)                          # week 6 was never seen before
        self.assertEqual(stability.classify([a, b], self.prev), "new")
        self.put(self.prev, "week-06.json", 1, wed)
        self.assertEqual(stability.classify([a, b], self.prev), "unchanged")
        self.put(self.prev, "week-06.json", 3, wed)
        self.assertEqual(stability.classify([a, b], self.prev), "changed")

    def test_no_files_is_never_settled(self):
        self.assertEqual(stability.classify([], self.prev), "new")


if __name__ == "__main__":
    unittest.main()
