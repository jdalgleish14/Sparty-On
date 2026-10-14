"""Publish owner avatars from the Sleeper roster pinned in owner_map.json.

Only writes assets/avatars/. Failed downloads do not change published files,
and a run with no avatar or owner changes does not make a commit.
"""
import datetime
import json
import os
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

LEAGUE_ID = "1386532723459362816"
API = "https://api.sleeper.app/v1"
CDN = "https://sleepercdn.com"
USER_AGENT = "sparty-on-avatar-sync/1.1 (+https://github.com/jdalgleish14/Sparty-On)"
MAX_IMAGE_BYTES = 4 * 1024 * 1024

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OWNER_MAP = os.path.join(REPO, "site-data", "sleeper", "owner_map.json")
OUT_DIR = os.path.join(REPO, "assets", "avatars")
OUT_INDEX = os.path.join(OUT_DIR, "owners.json")


def get_json(url, retries=4):
    last = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=25) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            last = f"HTTP {error.code}"
            if error.code < 500 and error.code != 429:
                break
        except (urllib.error.URLError, TimeoutError) as error:
            last = str(error)
        if attempt < retries:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Could not fetch {url}: {last}")


def avatar_url(user):
    metadata = user.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise RuntimeError("Sleeper user metadata is invalid")
    custom = metadata.get("avatar")
    if custom:
        if not isinstance(custom, str):
            raise RuntimeError("Sleeper avatar URL is invalid")
        parsed = urllib.parse.urlparse(custom)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not any(
            host == domain or host.endswith("." + domain)
            for domain in ("sleepercdn.com", "sleeper.app")
        ):
            raise RuntimeError(f"Sleeper avatar URL has an unexpected host: {host!r}")
        return custom, custom
    avatar = user.get("avatar")
    if avatar:
        if not isinstance(avatar, str) or not avatar.isalnum():
            raise RuntimeError("Sleeper avatar ID is invalid")
        return f"{CDN}/avatars/{avatar}", avatar
    return None, None


def image_extension(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    raise RuntimeError("Sleeper returned an unsupported or invalid image")


def download_image(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=25) as response:
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if not content_type.startswith("image/"):
            raise RuntimeError(f"Avatar returned {content_type!r}, not an image")
        data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise RuntimeError("Sleeper avatar exceeded the 4 MiB size limit")
    return data, image_extension(data)


def read_previous():
    if not os.path.exists(OUT_INDEX):
        return None
    with open(OUT_INDEX, encoding="utf-8") as stream:
        value = json.load(stream)
    if value.get("league_id") != LEAGUE_ID or not isinstance(value.get("owners"), list):
        raise RuntimeError("Existing avatar index is invalid")
    return value


def main():
    with open(OWNER_MAP, encoding="utf-8") as stream:
        config = json.load(stream)
    if config.get("league_id") != LEAGUE_ID:
        raise RuntimeError("Avatar owner map has the wrong league ID")
    roster_to_owner = {int(key): value for key, value in config["rosters"].items()}
    if not roster_to_owner or len(roster_to_owner) != len(set(roster_to_owner.values())):
        raise RuntimeError("Avatar owner map must contain distinct owner IDs")

    rosters = get_json(f"{API}/league/{LEAGUE_ID}/rosters")
    users = get_json(f"{API}/league/{LEAGUE_ID}/users")
    if not isinstance(rosters, list) or not isinstance(users, list):
        raise RuntimeError("Sleeper returned invalid league rosters or users")
    users_by_id = {user["user_id"]: user for user in users}
    roster_ids = {roster["roster_id"] for roster in rosters}
    if len(roster_ids) != len(rosters) or roster_ids != set(roster_to_owner):
        raise RuntimeError("Sleeper roster IDs disagree with the pinned owner map")
    previous = read_previous()
    previous_rows = {row["owner_id"]: row for row in previous["owners"]} if previous else {}
    os.makedirs(OUT_DIR, exist_ok=True)

    owners = []
    staged = []
    with tempfile.TemporaryDirectory(prefix="sparty-avatars-") as staging:
        for roster in sorted(rosters, key=lambda entry: entry["roster_id"]):
            owner_id = roster_to_owner[roster["roster_id"]]
            user = users_by_id.get(roster.get("owner_id"))
            if user is None:
                raise RuntimeError(f"Roster {roster['roster_id']} has no Sleeper user")
            url, reference = avatar_url(user)
            old = previous_rows.get(owner_id, {})
            row = {
                "owner_id": owner_id,
                "sleeper_user_id": user["user_id"],
                "display_name": user.get("display_name"),
                "avatar_ref": reference,
                "image": None,
            }
            if url is None:
                row["note"] = "no avatar set"
            else:
                old_image = old.get("image") or ""
                old_filename = os.path.basename(old_image)
                if (
                    old.get("avatar_ref") == reference
                    and old_image == f"assets/avatars/{old_filename}"
                    and old_filename.startswith(f"{owner_id}.")
                    and os.path.isfile(os.path.join(OUT_DIR, old_filename))
                ):
                    row["image"] = old_image
                else:
                    data, extension = download_image(url)
                    filename = f"{owner_id}{extension}"
                    staged_file = os.path.join(staging, filename)
                    with open(staged_file, "wb") as image:
                        image.write(data)
                    staged.append((staged_file, os.path.join(OUT_DIR, filename)))
                    row["image"] = f"assets/avatars/{filename}"
            owners.append(row)

        # Only publish after every owner and image has been validated.
        if previous and previous["owners"] == owners and not staged:
            print(f"{len(owners)} owners; no avatar changes")
            return 0
        for source, target in staged:
            os.replace(source, target)
        index = {
            "generated_at_utc": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
            "league_id": LEAGUE_ID,
            "owners": owners,
        }
        index_file = os.path.join(staging, "owners.json")
        with open(index_file, "w", encoding="utf-8") as stream:
            json.dump(index, stream, indent=2)
            stream.write("\n")
        os.replace(index_file, OUT_INDEX)

    # Remove superseded files only after the new index and images are published.
    current_images = {row["image"] for row in owners if row["image"]}
    for owner_id, old in previous_rows.items():
        old_image = old.get("image")
        if old_image and old_image not in current_images:
            old_filename = os.path.basename(old_image)
            if old_image == f"assets/avatars/{old_filename}" and old_filename.startswith(f"{owner_id}."):
                old_path = os.path.join(OUT_DIR, old_filename)
                if os.path.isfile(old_path):
                    os.remove(old_path)

    print(f"{len(owners)} owners; {len(staged)} photo(s) downloaded or updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
