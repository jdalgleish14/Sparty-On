"""Minimal Sleeper API client (standard library only) and raw-snapshot helpers.

Only public, read-only endpoints are used; no credentials are needed. Snapshots are saved
under site-data/sleeper/raw/ so every published number can be traced to the exact payload it
came from, and so the build step can run offline and deterministically from those files.
"""
import datetime
import json
import os
import time
import urllib.error
import urllib.request

BASE_URL = "https://api.sleeper.app/v1"
USER_AGENT = "sparty-on-sleeper-sync/1.0 (+https://github.com/jdalgleish14/sparty-on)"


class FetchError(Exception):
    pass


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def get_json(path, retries=4, timeout=25, opener=None, sleep=time.sleep):
    """GET a Sleeper endpoint and return parsed JSON, retrying transient failures."""
    url = BASE_URL + path
    open_url = opener or urllib.request.urlopen
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with open_url(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8")
            return json.loads(body)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code < 500 and e.code != 429:
                break           # a client error will not fix itself
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            last = str(e)
        if attempt < retries:
            sleep(2 ** attempt)
    raise FetchError(f"could not fetch {url}: {last}")


def fetch_context(league_id, fetcher=None, now=None):
    fetcher, now = fetcher or get_json, now or utc_now
    league = fetcher(f"/league/{league_id}")
    rosters = fetcher(f"/league/{league_id}/rosters")
    users = fetcher(f"/league/{league_id}/users")
    state = fetcher("/state/nfl")
    if not isinstance(league, dict) or not isinstance(rosters, list) or not isinstance(users, list):
        raise FetchError("unexpected response shape from Sleeper")
    settings = league.get("settings") or {}
    return {
        "league_id": str(league.get("league_id", league_id)),
        "season": str(league.get("season")),
        "status": league.get("status"),
        "total_rosters": league.get("total_rosters"),
        "last_scored_leg": settings.get("last_scored_leg"),
        "leg": settings.get("leg"),
        "start_week": settings.get("start_week"),
        "playoff_week_start": settings.get("playoff_week_start"),
        "state": {k: (state or {}).get(k) for k in ("season", "season_type", "week", "display_week", "leg")},
        "rosters": [{"roster_id": r.get("roster_id"), "owner_id": r.get("owner_id"),
                     "co_owners": r.get("co_owners") or []} for r in rosters],
        "users": [{"user_id": u.get("user_id"), "display_name": u.get("display_name"),
                   "team_name": (u.get("metadata") or {}).get("team_name")} for u in users],
        "fetched_at_utc": now(),
    }


def fetch_week(league_id, week, season, fetcher=None, now=None):
    fetcher, now = fetcher or get_json, now or utc_now
    matchups = fetcher(f"/league/{league_id}/matchups/{week}")
    if not isinstance(matchups, list):
        raise FetchError(f"week {week}: unexpected matchups response")
    keep = [{"roster_id": m.get("roster_id"), "matchup_id": m.get("matchup_id"),
             "points": m.get("points"), "custom_points": m.get("custom_points")} for m in matchups]
    keep.sort(key=lambda m: (m["roster_id"] is None, m["roster_id"]))
    return {"league_id": str(league_id), "season": str(season), "week": week, "fetched_at_utc": now(), "matchups": keep}


def _dump(obj):
    return json.dumps(obj, indent=2) + "\n"


def raw_path(raw_dir, name):
    return os.path.join(raw_dir, name)


def save_raw(raw_dir, name, obj):
    """Write a snapshot only if its content (apart from the fetch time) changed."""
    os.makedirs(raw_dir, exist_ok=True)
    path = raw_path(raw_dir, name)
    old = load_raw(raw_dir, name)
    if old is not None and _strip_time(old) == _strip_time(obj):
        return False        # identical data: keep the original fetch time so reruns are no-ops
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(_dump(obj))
    return True


def _strip_time(obj):
    return {k: v for k, v in obj.items() if k != "fetched_at_utc"}


def load_raw(raw_dir, name):
    path = raw_path(raw_dir, name)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_all_weeks(raw_dir):
    weeks = {}
    if os.path.isdir(raw_dir):
        for fname in sorted(os.listdir(raw_dir)):
            if fname.startswith("week-") and fname.endswith(".json"):
                payload = load_raw(raw_dir, fname)
                weeks[int(payload["week"])] = payload
    return weeks
