# Sleeper weekly update automation

After the one-time setup PR is merged, scheduled GitHub Actions runs publish a new completed
regular-season week automatically. The first check is Tuesday at 8:13 a.m. Eastern, with
retries at 11:13 a.m. and 12:43 p.m.; Wednesday at 8:13 a.m. is a fallback. GitHub may
delay scheduled runs. There is no 18-hour score-stability wait and no weekly PR to merge.

## Publication

The workflow reads public Sleeper league `1386532723459362816`, rebuilds the current-season
data in the established site format, runs unit tests and the independent data verifier,
and commits only `site-data/` to `main` using a normal, non-force push. If `main` changes
while it runs, the push fails rather than overwriting another edit. After a successful
push it explicitly requests a GitHub Pages build through GitHub's Pages API. A commit
using the workflow's built-in token alone does not trigger a branch-source Pages build.
If the Pages request fails, the job fails and the data commit remains on GitHub; fix the
Pages permission or build issue before assuming the live site has updated.

Scheduled retries report "nothing new" once a week is published. Manual runs default to
`dry_run: true`, which builds and reports without committing or publishing. Turn dry run
off only when you want an immediate publication. A manual `baseline_ref` can compare the
generated data against an Excel-export branch; substantive differences stop publication.
The Excel exporter is still available for postseason, championships and manual corrections.

## Gates

The run stops before publication if Sleeper has not marked the week scored; the league,
season or owner mapping is unexpected; a matchup is missing, unpaired, null, tied or
otherwise invalid; weeks are not contiguous; an already-published week disagrees with
Sleeper; or the rebuilt data fails parity or verification. New starter names are obtained
from Sleeper's player catalog on the runner and saved in the compact site preview, with
existing names preserved. No full player catalog is downloaded in a visitor's browser.
The worker behind Ask Sparty was not available here for an end-to-end test.

Published outputs include `games.json`, `current_standings.json`,
`season_summaries.json`, `head_to_head.json`, `owner_careers.json`,
`validation_report.json`, `manifest.json`, `site-data.js`, the `ai_*.json`
files, `ai_manifest.json`, `sleeper-sample.js`, and Sleeper provenance/raw
snapshots. Existing page HTML, scripts, completed season rows and the workbook
are not edited by the weekly workflow. If the workbook exporter later overwrites
the generated files, the next run requires the published weeks to match Sleeper.

## One-time setup and first live check

1. Update the Claude feature branch with the supplied replacement files, then merge
   its **setup PR #1** once. This is the one manual merge required to install the workflow.
   Confirm the 12 roster-to-owner entries in `site-data/sleeper/owner_map.json`.
2. In Settings > Actions > General, grant the workflow **Read and write permissions**.
   This design does not require the "create and approve pull requests" setting.
   Allow `github-actions[bot]` to push to `main` if branch rules restrict pushes.
   It never uses a force push or bypasses branch protection.
3. Keep GitHub Pages publishing from the existing `main` branch/root. Run the new
   workflow once manually with dry run on. Check its report and tests.
4. When a new scored week is available, run it manually with dry run off to verify
   the first real end-to-end publication: the main commit, Pages build request and
   the live site. Subsequent weeks can use the schedule alone.

If a Pages build request returns a permissions error, the run cannot complete live
publication with the default GitHub token. Inspect the failed step before changing
credentials or switching the Pages publishing source; avoid assuming a successful
commit means the live site changed. If branch protection prohibits bot pushes,
adjust the rule or use an approved publishing approach before relying on automation.

## Scope and limitations

- Postseason, ties, the first week of a new season, and corrections to a week
  already published still require a manual Excel update.
- Sleeper does not preserve the Excel sheet's row order within a week. New weeks
  use deterministic roster order; comparisons use game identity.
- The baseline `source_sha256` retains the Excel hash; Sleeper source details
  live in `site-data/sleeper/provenance.json`.
- The 2019 Maggie `average_bottom_5` historical quirk is kept as published.
- Live Sleeper and GitHub Pages publishing cannot be tested in this sandbox.

For local checks, run `python -m unittest discover -s tools/sleeper/tests -p "test_*.py"`
and `python tools/sleeper/sync.py verify`. Tests use a frozen Week 4 fixture and
also exercise a synthetic new week.
