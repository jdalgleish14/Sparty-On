"""Reading and writing the published site data with byte-exact formatting.

The Excel exporter writes the main JSON files with ``json.dumps(indent=2)`` and the
Ask Sparty (``ai_*``) files compactly. This module reproduces those conventions exactly so
that regenerated files differ from the committed ones only where the data actually changed.
"""
import hashlib
import json
import os

SITE_JS_PREFIX = "window.SPARTY_ON_DATA = "

# Files that the site embeds in site-data.js (key -> standalone file name in the manifest).
EMBEDDED_ONLY = {"league": "league.json", "owners": "owners.json",
                 "records": "records.json", "seasons": "seasons.json"}
# Standalone JSON files that mirror a key inside site-data.js.
MAIN_FILES = {"championships": "championships.json", "current_standings": "current_standings.json",
              "games": "games.json", "head_to_head": "head_to_head.json",
              "owner_careers": "owner_careers.json", "season_summaries": "season_summaries.json",
              "validation_report": "validation_report.json"}
AI_FILES = {"ai_games": "ai_games.json", "ai_all_games": "ai_all_games.json",
            "ai_seasons": "ai_seasons.json", "ai_league_years": "ai_league_years.json"}
MANIFESTS = {"manifest": "manifest.json", "ai_manifest": "ai_manifest.json"}
SITE_KEYS_ORDER = ["championships", "current_standings", "games", "head_to_head", "league",
                   "owner_careers", "owners", "records", "season_summaries", "seasons",
                   "validation_report"]


def dumps_indent(obj):
    return json.dumps(obj, indent=2) + "\n"


def dumps_compact(obj):
    return json.dumps(obj, separators=(",", ":")) + "\n"


def site_js_text(site):
    """site-data.js layout: one ``"key":<indent-2 json>`` block per key."""
    body = ",\n".join(json.dumps(k) + ":" + json.dumps(site[k], indent=2) for k in SITE_KEYS_ORDER)
    return SITE_JS_PREFIX + "{\n" + body + "\n};\n"


def parse_site_js(text):
    if not text.startswith(SITE_JS_PREFIX):
        raise ValueError("site-data.js does not start with the expected assignment")
    return json.loads(text[len(SITE_JS_PREFIX):].rstrip().rstrip(";"))


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def canonical_text(name, obj):
    """The exact serialized text for a named data object."""
    if name in AI_FILES or name == "ai_manifest":
        return dumps_compact(obj)
    return dumps_indent(obj)


class DataSet:
    """All published data objects, keyed by logical name."""

    def __init__(self, objs, site):
        self.objs = objs      # main + ai + manifests + validation_report objects
        self.site = site      # parsed site-data.js (11 keys)

    def __getitem__(self, name):
        return self.objs[name]

    def __setitem__(self, name, value):
        self.objs[name] = value

    def copy(self):
        return DataSet(json.loads(json.dumps(self.objs)), json.loads(json.dumps(self.site)))


def load(directory):
    objs = {}
    for name, fname in {**MAIN_FILES, **AI_FILES, **MANIFESTS}.items():
        with open(os.path.join(directory, fname), encoding="utf-8") as fh:
            objs[name] = json.loads(fh.read())
    with open(os.path.join(directory, "site-data.js"), encoding="utf-8") as fh:
        site = parse_site_js(fh.read())
    return DataSet(objs, site)


def read_text(directory, fname):
    with open(os.path.join(directory, fname), encoding="utf-8") as fh:
        return fh.read()


def render(ds):
    """Return {file name: text} for every file this generator owns."""
    out = {}
    for name, fname in {**MAIN_FILES, **AI_FILES, **MANIFESTS}.items():
        out[fname] = canonical_text(name, ds[name])
    out["site-data.js"] = site_js_text(ds.site)
    return out


def save(ds, directory, only_changed=True):
    """Write rendered files; return the list of file names whose content changed."""
    changed = []
    for fname, text in render(ds).items():
        path = os.path.join(directory, fname)
        old = None
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                old = fh.read()
        if old != text:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(text)
            changed.append(fname)
    return changed
