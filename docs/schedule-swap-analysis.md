# Schedule Swap Analysis

Schedule Swap Analysis appears on Current Season directly below Standings Race.
It uses the verified data already loaded by the page. There is no new analytics
snapshot, API credential, scheduled workflow, or weekly manual step.

## Deploy the changed-files ZIP

1. Extract the ZIP. Its top level contains `assets`, `tools`, `docs`,
   `.github`, and `current-season.html`.
2. Copy those files into the existing repository root, preserving their paths
   and replacing the existing files. Upload the contents, not a new enclosing
   folder. Existing files not present in the ZIP should remain in place.
3. Put the two workflow files directly in `.github/workflows/`. Do not put
   them in the extra `.github/workflows/workflows/` directory. That old nested
   directory is not part of this patch.
4. Commit the update to the branch used by your existing GitHub Pages setup.
   Wait for Pages deployment, then open Current Season and scroll below
   Standings Race. No Sleeper sync is needed for the first display: the
   existing Week 7 snapshot already contains all inputs.
5. Confirm Touchy Time shows 4–3 actual, 4.42 average wins, 6–1 best, 3–4
   worst, and −0.42 Schedule Impact for the supplied Week 7 snapshot.
   Motor City Dan Campbell should have a 7–0 best record, and The Prodigal
   Sons a 6–1 best record.
6. Try sorting the summary, selecting a team from its name and dropdown,
   opening the matrix, and reversing the difficulty ranking. On a phone,
   swipe the summary and choose different borrowed schedules in the matrix.
7. In Actions, the existing Sleeper weekly update should include
   “Check schedule swap calculations.” You can run it with dry run enabled
   to check the process; if Week 7 is still the latest result, “nothing new”
   is expected. No new workflow needs to appear.

## Inputs and update schedule

- Source: `window.SPARTY_ON_DATA` from `site-data/site-data.js`, containing
  game scores, opponents, current standings, roster IDs, regular-season length,
  validation result, and publication cutoff.
- Weekly publication continues to check Tuesday at 6:00 AM, 11:13 AM,
  12:43 PM Eastern and Wednesday at 8:13 AM Eastern. GitHub may delay scheduled
  jobs. The existing refresh loader picks up new verified snapshots.
- The daily transaction snapshot supplies current team labels through the
  existing event, matched by stable owner IDs. When it is unavailable or its
  season/mapping is inconsistent, published team names remain available.
- Last Sync / Next Sync footers reuse `assets/freshness.js`. Weekly footers
  describe the score snapshot, while daily label updates do not change scores.
- Score changes to already-published weeks continue to trigger the existing
  correction gate and require a reviewed manual correction. This feature
  recalculates from whichever verified snapshot is published afterward.
- The historical workbook and saved historical scores are unchanged.

## Calculation

For evaluated team A borrowing schedule B, take A's actual score each week and
compare it with the score of B's original opponent. If that opponent is A,
substitute B. This swaps the teams' fixture positions and prevents comparisons
against A's own score. The own-schedule diagonal uses the original opponent.

Scores are compared in integer hundredths. The Sleeper sync honors numeric
`custom_points` overrides ahead of `points`. Equal scores produce a tie, not a
win or half-win. Every scenario includes the same verified regular-season weeks.
Missing, duplicate, inconsistent or unpaired published data stops the analysis
instead of silently shortening it. Future weeks and postseason rows are excluded.
All roster-sized calculations use the current roster count; there is no 12-team
constant. The paired-schedule model requires one opponent per team per week;
byes and unpaired fixtures are reported as unsupported rather than invented.

- Average Wins: mean wins across every available schedule, including the actual
  schedule. Ties are retained in records, without being added to this mean.
- Schedule Impact: actual wins minus Average Wins. Positive indicates a benefit
  from the actual schedule relative to that team's other scenarios.
- Best/worst records: compare wins first, then losses. With equal wins, fewer
  losses makes the better record.
- Difference: hypothetical wins minus actual wins.
- Schedule Difficulty: mean wins down one schedule's matrix column, including
  its actual diagonal. Lower is harder. Equal averages share a difficulty rank.
  This is a descriptive comparison across all teams, including the required
  self-matchup substitutions, rather than a neutral-opponent model.
- Matrix shading compares each cell's wins with the evaluated team's actual
  wins. Outlined cells are actual schedules. Focusing or selecting a desktop
  cell reveals its full record below the matrix. Mobile displays one complete
  matrix column at a time, with wins and full records for every evaluated team.

These scenarios are independent counterfactuals, not one simultaneous replacement
league schedule. Their aggregate records do not need to balance like real games.

## Sync compatibility

The weekly generator and verifier now accept exact regular-season ties. Ties
count in season records, do not become losses in Ask Sparty data, and reset
winning/losing streaks. Ask Sparty season rows include a `ties` field when nonzero.
No-winner and no-loser averages are null when every game is tied.

Before fetching or building, the sync checks Sleeper's playoff start against the
configured regular-season length. The current league starts playoffs in Week 15,
so publication ends at Week 14. A changed boundary blocks publication with an
explanation until the season configuration is reviewed. The existing owner/season
rollover gates remain in place; starting a new season still uses the existing
season setup process.

## Local validation

```sh
node --test tools/schedule-swap/tests/*.cjs
python -m unittest discover -s tools/sleeper/tests -p 'test_*.py'
python tools/sleeper/sync.py verify
python -m unittest discover -s tools/sparty/tests -p 'test_*.py'
node --test tools/refresh/tests/*.cjs tools/sparty/tests/*.cjs
python -m unittest discover -s tools/transactions -p 'test_*.py'
```

The schedule tests independently swap labels in the saved raw Sleeper fixtures
and compare every matrix cell with the page's algorithm. They check all diagonal
records, equal game counts, self substitutions, synthetic ties, column means,
2/4/6/10/14-team leagues, zero-week data, and malformed/missing inputs. Sync tests
check tied weeks through verification and dialogue generation, a fully tied
season, playoff boundary mismatches, and the cap on playoff results. The existing
frozen-export tests ensure unchanged data still reproduces the established files.

## Validation performed for this patch

- All 14 schedule calculation and interface-controller tests passed.
- All 73 Sleeper generator/CLI tests and the published-data verifier passed,
  including the existing frozen-export parity checks.
- All 16 Sparty generator tests and all six transaction counting tests passed.
- Published `site-data` files and existing mascot/animation assets are byte-for-byte
  identical to the uploaded ZIP. HTML asset references, unique IDs, labels, and
  placement immediately after Standings Race were checked.
- Four pre-existing JavaScript assertions fail in both the original ZIP and this
  patch: the refresh test expects a `v=3` URL although Records already uses `v=4`;
  three mascot tests expect older saying punctuation, intro behavior, or a Week 5
  snapshot label. Their implementations were left unchanged. The other 14 existing
  refresh/mascot JavaScript checks passed.
- Actual desktop/mobile browser rendering could not be executed here: no Chromium
  or WebKit binaries were installed, and the environment blocked browser downloads.
  Controller tests exercise selectors, sorting, all mobile matrix columns, difficulty
  order, names, cell details and failure states, but do not establish pixel layout.
  Please perform the desktop and phone checks in the deployment steps, especially
  horizontal scrolling and pinned-header alignment on iPhone Safari.
- No live GitHub deployment or remote Ask Sparty service test was performed.
