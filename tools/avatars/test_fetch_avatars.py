"""Local tests for publication safety; no Sleeper network calls."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import fetch_avatars as avatars


class AvatarSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = self.temp.name
        self.owner_map = os.path.join(root, "owner_map.json")
        self.out_dir = os.path.join(root, "avatars")
        self.index = os.path.join(self.out_dir, "owners.json")
        with open(self.owner_map, "w", encoding="utf-8") as stream:
            json.dump({"league_id": avatars.LEAGUE_ID, "rosters": {"1": "owner-jack", "2": "owner-alex"}}, stream)
        for name, value in [("OWNER_MAP", self.owner_map), ("OUT_DIR", self.out_dir), ("OUT_INDEX", self.index)]:
            patcher = patch.object(avatars, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.users = [
            {"user_id": "a", "avatar": "hash123", "display_name": "Jack"},
            {"user_id": "b", "avatar": None, "display_name": "Alex"},
        ]
        rosters = [{"roster_id": 1, "owner_id": "a"}, {"roster_id": 2, "owner_id": "b"}]
        self.api = patch.object(avatars, "get_json", side_effect=lambda url: rosters if url.endswith("/rosters") else self.users)
        self.api.start()
        self.addCleanup(self.api.stop)

    def test_no_change_does_not_rewrite_index_or_download(self):
        png = b"\x89PNG\r\n\x1a\n" + b"example"
        with patch.object(avatars, "download_image", return_value=(png, ".png")) as download:
            self.assertEqual(avatars.main(), 0)
            with open(self.index, "rb") as stream:
                before = stream.read()
            self.assertEqual(avatars.main(), 0)
            with open(self.index, "rb") as stream:
                self.assertEqual(stream.read(), before)
            download.assert_called_once()
        with open(self.index, encoding="utf-8") as stream:
            rows = json.load(stream)["owners"]
        self.assertEqual(rows[0]["image"], "assets/avatars/owner-jack.png")
        self.assertIsNone(rows[1]["image"])

    def test_changed_format_replaces_old_image(self):
        with patch.object(avatars, "download_image", return_value=(b"\x89PNG\r\n\x1a\n", ".png")):
            avatars.main()
        self.users[0]["avatar"] = "newhash"
        with patch.object(avatars, "download_image", return_value=(b"\xff\xd8\xff", ".jpg")):
            avatars.main()
        self.assertFalse(os.path.exists(os.path.join(self.out_dir, "owner-jack.png")))
        self.assertTrue(os.path.isfile(os.path.join(self.out_dir, "owner-jack.jpg")))

    def test_failure_keeps_published_files(self):
        with patch.object(avatars, "download_image", return_value=(b"\x89PNG\r\n\x1a\n", ".png")):
            avatars.main()
        with open(self.index, "rb") as stream:
            before = stream.read()
        self.users[0]["avatar"] = "newhash"
        with patch.object(avatars, "download_image", side_effect=RuntimeError("bad image")):
            with self.assertRaisesRegex(RuntimeError, "bad image"):
                avatars.main()
        with open(self.index, "rb") as stream:
            self.assertEqual(stream.read(), before)
        self.assertTrue(os.path.isfile(os.path.join(self.out_dir, "owner-jack.png")))


if __name__ == "__main__":
    unittest.main()
