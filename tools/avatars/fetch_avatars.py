"""Download each owner's Sleeper avatar into assets/avatars/.

Only touches assets/avatars/. Standard library only. Public, read-only Sleeper endpoints.

Owner IDs follow site-data/sleeper/owner_map.json (roster id -> site owner id). A photo is
re-downloaded only when Sleeper's avatar reference changes, so reruns are cheap.

Output:
  assets/avatars/<owner-id>.<ext>   the image file
  assets/avatars/owners.json        owner id -> image path, Sleeper user id, avatar reference
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

LEAGUE_ID = "1386532723459362816"
API = "https://api.sleeper.app/v1"
CDN = "https://sleepercdn.com"
USER_AGENT = "sparty-on-avatar-sync/1.0 (+https://github.com/jdalgleish14/sparty-on)"

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OWNER_MAP = os.path.join(REPO, "site-data", "sleeper", "owner_map.json")
OUT_DIR = os.path.join(REPO, "assets", "avatars")
OUT_INDEX = os.path.join(OUT_DIR, "owners.json")


def get_json(url, retries=4):
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code < 500 and e.code != 429:
                break
        except (urllib.error.URLError, TimeoutError) as e:
            last = str(e)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not fetch {url}: {last}")


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as resp:
        data = resp.read()
        content_type = resp.headers.get("Content-Type", "")
    if not content_type.startswith("image/"):
        raise RuntimeError(f"{url} returned {content_type!r}, not an image")
    with open(dest, "wb") as out:
        out.write(data)


def ext_for(url):
    lower = url.lower().split("?")[0]
    for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp"):
        if lower.endswith(ext):
            return ext
    return ".jpg"


def image_url_and_ref(user):
    """Return (url, reference) for a user's avatar, or (None, None) if none is set."""
    custom = (user.get("metadata") or {}).get("avatar")
    if custom:
        return custom, custom          # custom upload: the URL itself is the reference
    hashed = user.get("avatar")
    if hashed:
        return f"{CDN}/avatars/{hashed}", hashed
    return None, None


def load_previous():
    if not os.path.exists(OUT_INDEX):
        return {}
    with open(OUT_INDEX, encoding="utf-8") as stream:
        return {row["owner_id"]: row for row in json.load(stream).get("owners", [])}


def main():
    with open(OWNER_MAP, encoding="utf-8") as stream:
        roster_to_owner = {int(k): v for k, v in json.load(stream)["rosters"].items()}

    rosters = get_json(f"{API}/league/{LEAGUE_ID}/rosters")
    users = {u["user_id"]: u for u in get_json(f"{API}/league/{LEAGUE_ID}/users")}
    previous = load_previous()
    os.makedirs(OUT_DIR, exist_ok=True)

    owners = []
    changed = 0
    for roster in sorted(rosters, key=lambda r: r["roster_id"]):
        owner_id = roster_to_owner.get(roster["roster_id"])
        user = users.get(roster.get("owner_id"))
        if owner_id is None or user is None:
            raise RuntimeError(f"Roster {roster['roster_id']} has no matching owner or user")

        url, ref = image_url_and_ref(user)
        row = {
            "owner_id": owner_id,
            "sleeper_user_id": user["user_id"],
            "display_name": user.get("display_name"),
            "avatar_ref": ref,
            "image": None,
        }

        if url is None:
            row["note"] = "no avatar set"
        else:
            prior = previous.get(owner_id, {})
            filename = f"{owner_id}{ext_for(url)}"
            dest = os.path.join(OUT_DIR, filename)
            unchanged = (
                prior.get("avatar_ref") == ref
                and prior.get("image") == f"assets/avatars/{filename}"
                and os.path.exists(dest)
            )
            if unchanged:
                row["image"] = prior["image"]
            else:
                download(url, dest)
                row["image"] = f"assets/avatars/{filename}"
                changed += 1
        owners.append(row)

    index = {
        "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "league_id": LEAGUE_ID,
        "owners": owners,
    }
    with open(OUT_INDEX, "w", encoding="utf-8") as stream:
        json.dump(index, stream, indent=2)
        stream.write("\n")

    print(f"{len(owners)} owners; {changed} photo(s) downloaded or updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
