# Sparty dialogue

## Install

Extract the replacement ZIP and merge its contents into the website repository root,
retaining `assets/`, `site-data/`, `tools/`, `docs/`, and `.github/workflows/` paths.
These are replacement/new files only, not a complete website. Include the two workflow
files when uploading. Commit the complete patch together to avoid mismatched scripts.
Existing GitHub Actions write and Pages permissions used by Sleeper automation are sufficient.
No package installation, service connection, API key, or workbook change is required.

## Behavior

Home retains the approved intro, Go Green bubble and original timing. After the intro,
clicking the mascot shows one of the 17 supplied sayings verbatim and keeps the existing
wave. During a wave, further taps update the saying immediately without restarting or
extending the animation. The four-second dialogue timer restarts on every tap.

Records retains its existing idle/wave behavior. The fixed introductory saying appears
once per page load when the validated Records mascot is visible, and lasts four seconds.
It is separate from the 200-record shuffle queue. Taps supersede it immediately.
Home and Records have independent shuffle queues, reset on page reload. Every item is
used before reshuffling; the last item cannot immediately repeat at the cycle boundary.

Champions does not load the new dialogue files. Its markup, shared animation script,
styles, trophy sequence, sprite images and timing are unchanged.

Native buttons support mouse, touch, Enter and Space. Bubbles are polite live regions;
Escape dismisses them. They reposition on scrolling/resizing and avoid the masthead.
They do not intercept navigation or other clicks. Reduced-motion settings preserve
static/approved mascot behavior while dialogue continues to work.

## Future Records entrance

`mountRecords()` in `assets/sparty-dialogue.js` currently uses an IntersectionObserver
for the fixed intro. When the entrance animation is added, replace that observer trigger
with `window.SpartyDialogue.recordsIntro()` at animation completion. Keep controller
mounting after `assets/records.js` has exposed the validated page. The intro method is
one-shot and will not overwrite a saying if the visitor has already interacted.
No entrance animation is added in this patch.

## Generator and publication

`python tools/sparty/generate.py` builds `site-data/sparty-records.js` from the local,
verified historical export. The command uses standard-library Python only and makes
no network requests. Source data is the existing published games, seasons, owners and
championships; the workbook and its exporter are not included in this repository.
No visitor-side statistics or additional fetch requests are introduced.

The generator validates core data/manifests using the existing verifier, then adds checks
for complete historical weeks, valid scores and results, paired matchups, eligible
seasons, source counts and championship evidence. Statistics are derived from game rows,
not copied from cached historical AI aggregates. Invalid inputs block generation.

103 registered statistical questions produce candidates. Selection prioritizes different
questions, then fills category targets with additional ranked records. Semantic duplicates
are removed. Rankings use competition ranks, represent ties explicitly, and compare values
to ten decimal places to prevent floating-point noise from breaking mathematical ties.
Each fact contains template, category, numeric value, rank, scope and source identifiers.
Facts include their population/scope; some game records intentionally overlap a specific
postseason or championship record because those are distinct comparisons.

The published collection is limited to 200 items and 180,000 UTF-8 bytes. There is no
history of prior collections appended to the file. Current output is approximately 76 KB,
with 200 sayings representing 101 distinct registered questions. Categories currently meet
all target allocations: games 30, careers 30, completed seasons 30, playoffs 25, rivalries
25, streaks/consistency 25, luck/oddities 20, league history 15. These are selection targets;
fewer eligible records are allowed rather than fabricating facts.

A source fingerprint, generator-source hash and output checksum permit a no-change run
without recalculating facts or rewriting a valid existing collection. Updating the
underlying data or generator code invalidates that shortcut. Candidate data is fully
serialized, reloaded and validated before an atomic file replacement. Any error leaves
the previous output intact and returns a nonzero exit code.

The Sleeper sync builds the collection from its verified staging directory before writing
published files. Dialogue failure blocks that week's publication and is reported in the
existing workflow summary. Dry runs make no published changes. Normal successful weekly
updates commit dialogue with the rest of `site-data/` and request the existing Pages build.

The additional Sparty dialogue workflow covers manual historical exports and generator
changes on main; it also runs checks on pull requests. It commits only the generated
collection when needed, then requests Pages rebuilding. It shares the Sleeper concurrency
group and uses a normal, non-force push. Bot-created commits do not retrigger the workflow;
weekly bot updates already include dialogue through the sync integration. Existing Pages
permission and branch-protection requirements still apply. No repository was deployed
or pushed from this development session.

The existing Sleeper automation remains limited to regular-season updates. Postseason,
new-season setup and corrections to already-published weeks follow the existing manual
export process. After their validated data is committed, dialogue regeneration is automatic.

All displayed facts include an as-of week. If the current source identity differs from a
retained collection, its label becomes `Historical snapshot · YEAR Week N`, so old all-time
claims remain explicitly dated. Malformed/missing dialogue shows a non-statistical fallback
and leaves the existing verified record tables usable. The compact browser source check
is an input-association checksum, not a security signature; the SHA-256 fingerprints and
output integrity checks are enforced by the Python generation process.

## Statistical definitions

- Career and game records include regular season plus postseason, through the approved
  current-season cutoff. Current completed games count immediately.
- Season comparisons use only `Complete` seasons and regular-season games. Totals may span
  different season lengths; rate comparisons use per-game values. `Future` seasons do not count.
- Career percentage/average leaderboards require at least 30 games. Rivalry rates/averages
  require five meetings. Playoff percentage/average leaderboards require five playoff games.
- Scores and score differences originate in exact integer cents; displayed point values use
  two decimals. Counts are integers; expected wins may be fractional. Percentages use one decimal.
- A close game is decided by five points or fewer, inclusive. A blowout is 30 or more points.
  `100+`, `120+` and other thresholds are inclusive; `below` thresholds are strict.
- Expected wins are summed weekly all-play win shares: `(teams outscored + 0.5 * other equal
  scores) / (teams that week - 1)`. Luck is actual wins minus expected wins. These season
  comparisons exclude incomplete seasons and do not use postseason all-play estimates.
- Weekly top/bottom-half and second-highest-score flags use competition score ranks, matching
  the existing site's AI exporter definitions. A tie at the median can enlarge the top half.
- Score variation uses sample standard deviation. Scoring range is maximum minus minimum.
- Streaks follow each owner's consecutive played games, including postseason and across
  season boundaries. Byes and absent seasons do not create games or reset a streak.
  Rivalry streaks follow successive meetings, ignoring games against other opponents.
- Matchup totals and rivalry meetings count each matchup once. League weekly points count
  each team's score once. Weekly facts state league size; averages/shares normalize comparisons.
- Playoff participation means a recorded postseason game; no unrecorded byes, seeds or
  official final placements are inferred. Championship facts must match championship games.

## Checks

Run from the repository root:

```
python -m unittest discover -s tools/sleeper/tests -p 'test_*.py'
python -m unittest discover -s tools/sparty/tests -p 'test_*.py'
node --test tools/sparty/tests/test_dialogue.cjs
python tools/sleeper/sync.py verify
python tools/sparty/generate.py
```

The JavaScript tests use a dependency-free DOM/timer harness. They check full shuffle cycles,
independent queues, immediate replacement, timer resets, Escape/live-region behavior,
stale/invalid data handling and placement calculations for 320/390/768px viewports.
They do not simulate native browser rendering or native keyboard click synthesis.

Visual browser QA could not run in the development environment: Playwright was installed,
but no browser executable was available and the browser download was blocked by network
policy. After upload, visually check Home and Records on a phone, tap rapidly, rotate the
screen and confirm long bubbles fit. Confirm the Home intro and Champions trophy still look
as expected. Native mouse/touch/keyboard interactions and rendered layout need that final
browser check. GitHub Actions publication also needs verification in the real repository.
