"""Decide whether Sleeper's scores have settled between two scheduled looks.

usage: stability.py --previous-dir DIR [--min-hours 18] RAW_FILE [RAW_FILE ...]

Each RAW_FILE is a raw week snapshot that this run added or changed. DIR holds the snapshots from the
earlier look (the proposal branch), if any. Prints exactly one word, the most cautious applicable:
  changed   a score differs from the earlier look (stat correction), keep as a draft
  new       no earlier look at one of the weeks
  too-soon  scores match but the earlier look was less than --min-hours ago, so it proves little
  unchanged scores match and the earlier look was far enough back: settled
Fetch times are ignored when comparing scores.
"""
import argparse
import datetime
import json
import os
import sys

ORDER = ["changed", "new", "too-soon", "unchanged"]


def _scores(payload):
    return {k: v for k, v in payload.items() if k != "fetched_at_utc"}


def _when(payload):
    try:
        return datetime.datetime.fromisoformat(payload["fetched_at_utc"])
    except (KeyError, ValueError, TypeError):
        return None


def classify_file(current_path, previous_path, min_hours=18):
    if not previous_path or not os.path.exists(previous_path) or os.path.getsize(previous_path) == 0:
        return "new"
    with open(current_path, encoding="utf-8") as a, open(previous_path, encoding="utf-8") as b:
        cur, prev = json.load(a), json.load(b)
    if _scores(cur) != _scores(prev):
        return "changed"
    t1, t0 = _when(cur), _when(prev)
    if t1 is None or t0 is None or (t1 - t0) < datetime.timedelta(hours=min_hours):
        return "too-soon"
    return "unchanged"


def classify(files, previous_dir, min_hours=18):
    if not files:
        return "new"
    results = [classify_file(f, os.path.join(previous_dir, os.path.basename(f)) if previous_dir else "", min_hours) for f in files]
    return min(results, key=ORDER.index)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--previous-dir", default="")
    ap.add_argument("--min-hours", type=float, default=18)
    ap.add_argument("files", nargs="*")
    args = ap.parse_args(argv)
    print(classify(args.files, args.previous_dir, args.min_hours))
    return 0


if __name__ == "__main__":
    sys.exit(main())
