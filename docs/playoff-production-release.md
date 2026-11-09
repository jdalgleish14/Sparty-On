# Playoff predictor production release

Approved by the owner on October 29, 2026. Prepared against the supplied website ZIP
14 plus the released Ask Sparty update. The patch does not replace historical scores,
standings, manifests, Ask Sparty files, sprites, or other website pages.

Includes the Current Season tab, all rooting games displayed, interactive scenarios,
team selection initially blank, a published Week 7/2026 forecast, raw Weeks 8–14
schedule evidence, code, tests, and weekly forecast refresh.

Validation: 10 playoff/PF-helper Python tests, 14 interactive JavaScript tests,
39 Ask Sparty tests, 13 schedule-swap tests, and 73 Sleeper tests: 149 passing.
Weekly workflow YAML and shell syntax pass. Local temporary-Git smoke checks verify
new-week publication, forecast-only retry publication and skipping unchanged data.
No remote repository, website or Cloudflare service was modified by these tests.

The weekly workflow refreshes optional forecasts on sync results 0 (new week) or
10 (no new scores), with a four-minute timeout and continue-on-error. A failed optional
forecast does not block verified scores. The next scheduled run retries. Forecast
signatures hide stale output. Empty diffs do not create commits or Pages builds.
Existing dry-run guards and non-force push protections are retained.

Specific late-season result/PF clinching combinations remain planned; the release
contains proven sufficient win totals and tested PF groundwork, not an exact route
generator. Forecasts stop beyond the regular-season scope. See the method and late-
season plan for modeling limitations. The owner reviewed desktop emulation; actual
mobile Safari should still receive a final check on the published site.

After upload: verify Current Season > Playoff Predictor loads a league table first,
team selection is blank, selecting Jack produces the team view, a winner pick updates
automatically, Clear picks resets, and all unpicked rooting games show directly.
Verify the workflow files are directly inside .github/workflows, not its extra nested
workflows directory. No Cloudflare deployment or new credentials are needed.

Rollback: restore current-season.html and .github/workflows/sleeper-weekly-update.yml
from the commit immediately before this release. The optional unused playoff assets
can remain until cleanup. Preserve normal site-data updates when rolling back.
