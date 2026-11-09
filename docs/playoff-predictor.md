# Playoff predictor — implementation checkpoint, October 29, 2026

Approved for production release on October 29, 2026. This package is ready for the
owner to upload; deployment has not been performed from this workspace.

## Confirmed rules

Eight teams, no divisions or special bids. Regular season ends Week 14. PF is the
standings tiebreaker. Playoff rounds are Weeks 15, 16, 17, one week each, without
byes or reseeding. A final tie on both record and PF requires commissioner resolution.
The engine uses wins plus half a win for tied games before PF; review this convention
if the league uses a different treatment of tied games.

## Current implementation

A batch Python engine reads verified current-season game scores and standings. It
validates one matchup per team in every remaining regular-season week. It runs
50,000 seeded simulations and publishes playoff odds, mean finish, projected wins,
and each seed's probability. A conservative mathematical solver independently
proves qualification or elimination where record bounds suffice, allowing future
PF to change and including possible future tied games. It does not claim complete
exact seed scenarios; bounds may be wider than the true attainable seed range.
An unresolved status means not proven, not proof of an attainable playoff route.

This interface covers qualification, seeds, team-focused conditional scenarios, rooting
interests, and proven sufficient win totals. It does not forecast championships, Max PF,
or draft positioning, or enumerate all possible clinching combinations.
No assumed bracket pairings are used by these calculations.

The display has a dedicated Playoff Predictor tab on Current Season. It uses the existing
site tables and typography. Missing or stale outputs show a refresh message, never
invented odds. A null data placeholder lets the existing page continue loading.

## Model

Team means use completed current-season scores, with four league-average pseudo
weeks. One pooled weekly standard deviation is estimated from team-demeaned scores,
with a ten-point floor. Future scores are independent normal draws floored at zero.
Each score drives both that game's result and future PF. Future ties are not simulated;
proof bounds include them. Injuries, lineups, player projections, schedule-specific
NFL bye effects, correlated scoring, and parameter uncertainty are not modeled.
50,000 trials imply at most roughly ±0.44 percentage points of 95% sampling error;
model uncertainty is larger and is not measured by that error. Display near-zero or
near-100% forecasts as inequalities unless mathematical proof establishes certainty.

## Running

    pip install -r tools/playoffs/requirements.txt
    python -m unittest discover -s tools/playoffs -v
    python tools/playoffs/predict.py --fetch

Without --fetch, --schedule points to a directory containing week-NN.json remaining
matchups. Output is site-data/playoff-predictor.js. Raw API payloads and their hashes
are retained for reproducibility. Core inputs must match the site's manifest hashes.
League identity, season, and playoff settings are checked when fetching. Output is
replaced atomically only after a complete valid build; no partial forecast is published.

## Weekly integration

playoff-preview-check.yml is a manual artifact-only workflow. It never deploys.
The included weekly-sync workflow adds an optional forecast build after verification
and before git add site-data. Dependencies are installed in that job. The step uses
continue-on-error so it does not block core scores. Old forecasts remain stored but
their standings signature/cutoff mismatch hides them. There is no competing publisher.
The approved production package includes this workflow modification. Forecasts are
also retried when a sync has no new scores, so an optional failure can recover on the
next scheduled run. The optional step is limited to four minutes. Empty changes
do not create a commit or request a Pages build. Dry-run mode still prevents pushes.
Postseason rollover beyond Week 14 is intentionally rejected until postseason-aware
forecasting is designed. Existing standings and site features stay independent.

## Actual-data verification

The user supplied the read-only GitHub artifact on October 29, 2026. All seven
remaining weeks validate against the roster map; the live league identity, season,
eight-team field, Week 15 start, one-week rounds, and no reseeding match the rules.
Forecasts were generated from these exact raw payloads, not a reconstructed schedule.
Engine tests cover exhaustive small-league proof comparisons (including ties),
validation, reproducibility, probability conservation, clinches and elimination.
UI tests cover real-data rendering, owner selection, missing/stale forecasts,
and same-cutoff corrections. A model-sensitivity report compares 0/4/8 prior weeks.
All 39 existing Ask Sparty tests are retained and run against the assembled preview.

Browser screenshot testing is blocked: this environment has no browser executable
and downloading one returns HTTP 403. The owner reviewed the preview and approved release. Automated checks do not
replace a final check on the published page.

## Interactive expansion

Select a team to view its remaining opponents, win chances, playoff odds conditional
on winning/losing each game, seed distribution, and final-win-total outlook. The league
overview is shown first. Team selection starts blank and no simulation runs until
an owner is selected. Owner names in the overview also select that team.

Try different results contains a week selector, game picks, and Win out / Lose out.
Picks recalculate automatically after a short debounce; Clear picks returns to the
current forecast. Quick Pick buttons in rooting advice reuse the same controls.
Nothing writes to Sleeper. Pending scenario outputs are hidden rather than shown as
current. Team changes keep the current picks intact.

The browser runs 20,000 seeded trials in asynchronous chunks, cancelling superseded
work. Chosen winners are implemented by rejection sampling the normal score pair,
not by swapping teams' scores or adding arbitrary points. A bounded rejection loop
returns an error on an excessively rare condition. No third-party APIs or AI calls
are used. Browser scenarios are reproducible but use a different RNG than Python;
compare them with the same 20,000-trial browser baseline. The 50,000-trial league
summary is explicitly labeled baseline and is never relabeled as a picked scenario.

Rooting advice compares selected-team playoff probabilities conditional on each
remaining other-team game's winner. It requires at least 300 samples per side and
an absolute edge exceeding the approximate 95% sampling margin. Multiple comparisons
are exploratory; this is not a causal or guaranteed effect. Win-total conditional
estimates show sampling margins and suppress estimates with fewer than 300 samples.

The Python solver also derives seed bounds at each target final win-equivalent score,
including future ties and adverse PF, allowing safe sufficient win-total guarantees.
For Jack, at least five additional wins guarantee qualification in the Week 7 snapshot.
These are not minimum wins needed, and baseline guarantees stay labeled when picks
change. Fast browser proof bounds are conservative independent record intervals,
so failure to establish a clinch/elimination does not imply it is impossible to prove
with a stronger solver. Sampled 100% never becomes a proven clinch.

Verification: 10 Python tests (engine plus late-season groundwork), 14 scenario/UI
tests, and 39 existing Ask Sparty tests: 63 in total. UI/scenario regressions use frozen
Week 7 inputs in tools/playoffs/fixtures, independent of weekly forecast refreshes.
Fixed-record bounds match exhaustive enumeration of small leagues including ties;
conditional simulation agrees with a filtered baseline; winning-out picks enforce
results and the proof correctly guarantees Jack. HTML tags balance, IDs are unique,
and all five Current Season tabs remain separate. Visual browser testing is still
unavailable in this environment and remains a user preview step.

## Refined interface

League Overview is the initial view and remains unpicked. Team details are hidden
until selection. Published no-pick headline numbers match the league table exactly;
conditional views still use a consistent 20,000-trial scenario baseline for deltas.
Rooting advice shows every unpicked other-team game for the selected week directly,
without a More games expander.
Conditional comparisons, sample counts and margins are retained under Compare
outcomes. Remaining schedule, seeds and win-total estimates are expandable.

The main path uses plain sufficient-condition language: “5 more wins guarantee Jack
a playoff spot. Fewer may be enough with help.” Quick-solver limitations and rank
bounds are in More about this path. Unresolved picked scenarios say “These picks
leave the spot undecided. Other results and PF can still matter.” A simulated 100%
still never becomes a guarantee. The technical method remains under How it works.

Detailed clinching combinations are planned, not implemented. See
late-season-clinch-paths.md for the verified-search plan, late-season window and
score-condition contract. Tested helpers demonstrate relative PF thresholds without
claiming qualification or inventing a tiebreaker. This revision does not promise that
exact routes will appear automatically in Week 12 before that engine is implemented.
