# Sleeper weekly update automation

Status: **proposal-only**. Nothing here publishes by itself. A person reviews and merges every week.

## What it does

After a week's games and stat corrections have settled, a GitHub Actions workflow reads that week's
matchups from Sleeper (league `1386532723459362816`), rebuilds the 2026 current-season data using the
site's existing definitions, verifies it, and opens a **draft pull request**. The Excel exporter keeps
working and stays the publisher of record during the comparison period.

## Data flow today (unchanged)

```
Excel workbook --(exporter on your PC / ChatGPT)--> site-data/*.json + site-data.js
                                                        |
        pages (index, current-season, seasons, owners, records, head-to-head) read site-data.js
        ask.html -> Ask Sparty Worker reads ai_*.json + ai_manifest.json (published copy)
```

Pages validate at load: `validation_report` PASS, one publication cutoff everywhere, game pairing,
weekly completeness, row counts. The Worker's own checks are not in this repo and could not be reviewed.

## What the new process generates

All of these are rewritten together from one dataset, so the site and Ask Sparty always share one cutoff:

`games.json`, `current_standings.json`, `season_summaries.json`, `head_to_head.json`, `owner_careers.json`,
`validation_report.json`, `manifest.json`, `site-data.js`, `ai_games.json`, `ai_all_games.json`,
`ai_seasons.json`, `ai_league_years.json`, `ai_manifest.json`.

New files it owns: `site-data/sleeper/raw/*.json` (the exact Sleeper payloads, for traceability),
`site-data/sleeper/provenance.json`, `site-data/sleeper/owner_map.json` (roster id to owner id; edit if a
team changes hands), and the code in `tools/sleeper/`.

It does **not** touch: `championships.json`, any completed season's rows, `index.html` and all other pages
and scripts, homepage text, styles, `sleeper-sample.js`, the Excel workbook.

Metric definitions (standings tie-breaks, bonus standings, all-play/expected wins, luck, streaks, records,
head-to-head, careers) are reimplemented from the exporter's behaviour and proven by tests that rebuild
**all 14 committed files byte-for-byte** from `games.json`. Real Sleeper week-4 data also reproduces the
committed week-4 export exactly (except cosmetic row order, below).

## Safety gates (fail safely, change nothing)

A run stops with an explanation if: the league, season or status is unexpected; roster-to-owner mapping is
incomplete or changed; Sleeper has not scored the week (`last_scored_leg`); any matchup is missing, unpaired,
zero, null, or has more than 2 decimals; a snapshot belongs to another league or season; there is a tie;
already-published weeks differ from Sleeper by more than 0.011 (a scoring correction to published history
needs a human); the new weeks are not a contiguous block after the published cutoff; or the independent verifier (`tools/sleeper/verify.py`) fails. Data is built in a temp
folder, verified, and only then written. Reruns are idempotent (a second run reports "nothing to publish").

Exit codes: 0 ready, 10 nothing new, 2 gate failure, 3 verification failure, 4 Sleeper unreachable, 1 unexpected.

## Weekly flow

1. Wednesday ~8am ET: workflow fetches, builds, opens a **draft** PR on `sleeper-sync/2026-week-NN`.
2. Thursday ~8am ET: runs again. If every new or corrected week's scores are identical to the previous look **and that look was at least 18 hours earlier**, the PR is marked **ready for review**. If scores changed (stat correction) or the look was too recent, it stays a draft and says so.

Guard rails: only one sync PR may be open at a time (merge or close it first, so weeks are reviewed in order); if a person has added commits to the proposal branch the workflow refuses to overwrite them; if several weeks were missed, one PR catches up all of them. Before the draft (`pre_draft`/`drafting`) the run reports "nothing to publish" instead of failing.
3. You review the report (standings, parity table) and merge. Merging is the only publish step.

Run manually any time: Actions > "Sleeper weekly update" > Run workflow. `dry_run` (default on) builds and
reports without pushing. Optional `baseline_ref` points at a branch with a fresh Excel export to compare.

## Comparing with your Excel export (next few weeks)

Each PR includes a **Sleeper-only rebuild vs committed export** table for already-published weeks.
To compare the *new* week with your own Excel export:

1. After the Excel export for week N is committed on a branch (for example `excel-week-N`), run the workflow with `baseline_ref = excel-week-N`; or locally:
2. `python tools/sleeper/sync.py compare --baseline <folder with Excel export site-data> --candidate site-data`

Differences are classified: identical, float noise, **substantive**, missing, extra, order-only. Only
"substantive" matters (exit 3). Plan: once three consecutive weeks show no substantive differences, decide
whether to move to the next phase.

## Ownership transition

| Phase | Who publishes the current-season slice | What you do |
|---|---|---|
| Now: comparison | Excel exporter (publisher of record). Sleeper PRs are reviewed but you merge only one source per week. | Compare each week; do not merge both for the same week. |
| After ~3 clean weeks | Sleeper PRs. Excel exporter stays usable for history, season setup, championships, postseason. | Stop updating the workbook weekly; backfill it from the repo occasionally. |

Switching source mid-season is safe: both write the same schema, and the generator rebuilds from `games.json`.
If the Excel exporter later overwrites the files, the next Sleeper run simply continues from the new cutoff
(it requires the published weeks to match Sleeper).

## Known limitations (left on the Excel export, not guessed)

- **Postseason, ties, and a new season's first week** are unsupported; the run fails safely.
- **Row order in `games.json`**: within a week, which game/owner comes first follows your sheet. Sleeper has no such order, so new weeks use a deterministic roster-position rule. Comparisons are key-based; pages are unaffected.
- **Team names** from Sleeper are reported as notes only; the site's established names are kept.
- **`source_sha256` in manifest** stays the Excel baseline hash (schema unchanged); provenance lives in `site-data/sleeper/provenance.json`.
- One long-standing 2019 quirk (Maggie `average_bottom_5`) is preserved as published.
- Ask Sparty's Worker code is not in this repo; its checks of `ai_*` files could not be reviewed.
- The standings tie-break and league-year sums are proven against all completed seasons and week-4 data; weeks 5 to 14 are exercised by synthetic tests only until real weeks are compared.
- Sleeper's public API was not reachable from the development sandbox, so the live end-to-end run happens first in GitHub Actions (use the manual dry run).

## One-time setup

1. Settings > Actions > General > Workflow permissions: **Read and write**, and tick **Allow GitHub Actions to create and approve pull requests**.
2. (Recommended) Protect `main`: require a pull request. The workflow only pushes `sleeper-sync/week-*`.
3. Run the workflow manually once with `dry_run` on and read the job summary. In the offseason you can disable the schedule.
4. If a team changes owners, update `site-data/sleeper/owner_map.json` (optionally add `sleeper_user_ids` to pin identities).

No secrets are needed: only public, read-only Sleeper endpoints are used.

## Developing

`python -m unittest discover -s tools/sleeper/tests -p "test_*.py"` (65 tests, standard library only). Tests run against a frozen week-4 copy of the export in `tools/sleeper/tests/frozen/`, so they keep passing after newer weeks are merged.
`python tools/sleeper/sync.py verify` checks the committed data independently.
