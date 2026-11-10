# Sparty On season automation

The score updater runs entirely in GitHub Actions using ordinary Python and Sleeper's public API.
It needs no ChatGPT account, AI service, OpenAI subscription, or AI API key. The existing optional
Ask Sparty feature is separate; its availability does not control scores, playoffs or rollover.

## One-time installation

1. Upload all files in the season-automation update ZIP to their matching repository paths.
   Commit them together. The ZIP contains changed/new files, not a replacement data export.
2. Open **Actions → Sleeper weekly update → Run workflow**. Leave **dry_run** checked and
   **baseline_ref** and **owner_changes** blank. The run validates current data, checks current
   Sleeper results, and shows a report. It does not publish while dry run is checked.
3. Check the report, then run again with **dry_run** unchecked. This pins stable Sleeper owner
   account IDs after proving all published weeks match. It also records the league identity
   for supporting features. Existing historical scores are preserved.
4. Confirm the commit, Pages build, and live pages. Subsequent scheduled runs handle the normal
   season cycle. Keep GitHub Actions allowed to write repository contents and request Pages builds.

The same weekly workflow name and Tuesday/Wednesday schedule remain in place. Daily transaction/
Max PF and weekly avatar jobs read the same owner map. All three publishers share a concurrency
queue to avoid simultaneous bot pushes. A concurrent human change still causes a normal
non-force push to fail; rerun the failed workflow after checking that change.

## What happens without annual maintenance

| When | Automatic behavior |
| --- | --- |
| Regular season | Verify previously published games and add newly completed weeks. Rebuild standings, career totals, records, head-to-head, query data and the deterministic mascot fact collection. |
| Weeks 15–17 | Read the official winners bracket, follow the championship's winner links, and publish completed quarterfinals, semifinals and the championship. Placement and consolation games are excluded from historical playoff stats. |
| After the final | Record champion, runner-up and scores. Show the final bracket, final results and season-complete labels. Keep the final regular-season standings separate from playoff statistics. |
| Offseason | Keep the finished season visible. Look for a unique next-season league whose `previous_league_id` identifies the current league. Never select a league by name alone. |
| Next season, first scored week | Verify linked league identity, format and owner accounts. Archive the outgoing snapshot, mark it Complete, activate the next year, and build the new season directly from Sleeper. No Excel export is needed. |
| After two completed weeks | Resume playoff forecasts for the new season. |

Renew the dynasty league in Sleeper as you normally would. That commissioner action still happens
in Sleeper; this read-only updater cannot renew leagues or change playoff decisions there.

The site deliberately keeps the finished season during the offseason rather than replacing it
with an empty preseason page. The switch occurs after Sleeper reports a completed Week 1, not
on January 1 or when the new league is created. Drafting and preseason leagues do not erase
published results. The regular-season publication cutoff stays at 14 during the playoffs;
`postseason_through_round` tracks completed playoff rounds separately.

Each season's evidence is retained under `site-data/sleeper/raw/<year>/`. At rollover, the
outgoing data bundle, configuration, raw context/matchups/bracket, and available transaction,
player-preview and forecast snapshots are saved under `site-data/sleeper/archive/<year>/`.
The main site continues to contain the full historical game archive. Saved snapshots are not
new historical-data pages; the Past Seasons page remains the way to browse scores and playoffs.
Daily transaction tables show the active season, while the previous snapshot is retained in
its archive. Completed-season classification is finalized at rollover; the outgoing season
remains the site's Current season, with phase Complete, until then.

## Supported league format

The automated path supports the existing 12-team, 14-week regular season, eight playoff teams,
three single-week rounds in Weeks 15–17, no byes, no divisions, no reseeding and no median game.
The official bracket must contain the top eight regular-season qualifiers. The updater follows
its actual winner links, rather than inventing future winners from projections. Tied playoff
scores, an unresolved official winner, changed format, changed published scores, missing games,
unknown owners or ambiguous successor leagues stop publication with a report.

During the regular season, the bracket uses current standings ranks, not predicted finish, and stays independent of hypothetical predictor picks. The connected bracket design is preserved. Once official
playoff results start, it changes into the official bracket. The Results tab and Home ticker
show completed playoff games; records, careers, owner pages and head-to-head include those games.
Regular-season tables and schedule analysis remain regular-season measures.

## New members or account changes at rollover

Roster numbers can change automatically when the same people retain their Sleeper accounts.
The updater tracks people by their pinned account IDs, not names or roster numbers.

For a new member or a known member with a new account, supply **owner_changes** on a manual
**Sleeper weekly update** run. Use a JSON object scoped to the exact incoming year and league ID:

```json
{
  "season": 2027,
  "league_id": "NEW_SLEEPER_LEAGUE_ID",
  "owners": {
    "NEW_SLEEPER_USER_ID": {
      "owner_id": "owner-new-member",
      "owner_name": "New Member"
    }
  }
}
```

Replace all example values. Add only new Sleeper accounts; unchanged accounts are matched
automatically. For a returning historical owner or the same person with a new account, use
that person's existing site `owner_id` and exact existing `owner_name`. For a different person,
use a new unique `owner_id` so the outgoing owner's historical games stay with that person.
The updater rejects duplicate owner assignments and historical name changes.

You can find the new league ID in its Sleeper URL. To see user/roster IDs, open
`https://api.sleeper.app/v1/league/NEW_SLEEPER_LEAGUE_ID/rosters` and `/users` in a browser.
Existing site IDs and names are in `site-data/sleeper/owner_map.json` and the `owners` block of
`site-data/site-data.js`. No AI is needed to fill in this mapping.

Run with dry run checked first. When the report is correct, run again with the same JSON and
dry run unchecked. The published owner map remembers the new assignments; subsequent runs need
no input. The exception only applies when the incoming league has a completed Week 1. During
preseason the finished season remains visible. A midseason ownership transfer requires a
separate explicit decision about historical attribution; it is not silently treated as rollover.

## When a run stops

Open the failed workflow, then its job summary. The updater reports the blocking condition.

- **Nothing new:** normal. Completed data is already published.
- **Sleeper/network unavailable:** retry the workflow. Current published data remains available.
  Failure to discover a future league does not block otherwise verified current-season scores.
- **Winner not final / tied playoff score:** resolve the game in Sleeper, then rerun. The updater
  requires a non-tied score and agreement between bracket winner and weekly scores. A manual
  tie-break winner with exactly tied published scores needs a reviewed scoring-policy change.
- **Unknown new owner:** use the scoped owner_changes input above when rolling over.
- **Changed published scores:** compare the report against Sleeper before replacing data. The
  normal updater deliberately does not rewrite already-published results. The legacy regular-
  season rebuild/parity tools and an Excel export remain available for reviewed corrections.
- **Changed league rules:** this is an intentional stop. A developer must update the supported
  format and its tests; the updater will not guess a new tournament or standings policy.
- **More than one linked successor:** remove/resolve an accidental duplicate league in Sleeper.
  A genuinely ambiguous successor needs a reviewed explicit configuration change.
- **New season already in playoffs:** rollover must happen while the successor is in its regular
  season. If automation was offline for an entire regular season, backfill needs a reviewed run.
- **Pages build failed after a data commit:** fix Pages permissions/builds and request a build.
  A successful data commit by itself does not prove the public site updated.

Review occasional workflow failures and enable GitHub's notification preferences as desired.
No ChatGPT chat needs to remain open. Retain repository access, GitHub Pages and Sleeper access
for commissioner actions. Ask Sparty's separate Cloudflare configuration can stay as it is.

## Local verification

```sh
python -m unittest discover -s tools/sleeper/tests -p 'test_*.py'
node --test tools/sleeper/tests/test_season_pages.cjs
python tools/sleeper/sync.py verify
python tools/sleeper/season_sync.py --dry-run --report season-report.md
```

The first three commands work offline. The final command reads Sleeper and produces a report
without modifying published files. Synthetic tests exercise playoff progression, placement-game
exclusion, stale/invalid results, championships, archive verification, stable-owner remapping,
Week 1 startup, new members, repeat-run idempotence and page rendering logic.

Sleeper API reference: https://docs.sleeper.com/ (leagues, user leagues, matchups and winners bracket).

## Validation of this update

199 automated checks passed across score generation, playoff predictions, season transitions,
page integration, schedule analysis, transactions, avatars, data refresh and mascot facts.
The existing published data also passed its independent verifier. Tests use synthetic/frozen
fixtures; page integration uses a DOM adapter, not visual browser rendering. Live Sleeper and
GitHub publication were not exercised here. The first GitHub dry run is the live validation step.
Some older test assertions were updated for existing deployed copy/timing, flexible cache keys,
and changing season data; no mascot wording or timing was changed by this update.
