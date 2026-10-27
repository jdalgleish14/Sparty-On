# Schedule Swap Analysis

Schedule Swap Analysis appears directly below Standings Race on Current Season.
Its sortable summary and team selector compare actual records with results on every
schedule. Schedule Difficulty is a separate table beneath the analysis, always
ranked hardest to easiest. The full matrix and schedule-table sync footers have
been removed.

## Install this layout cleanup

This ZIP updates the previously supplied Schedule Swap feature. Extract it and
upload its contents into the existing repository root, preserving the `assets`,
`tools`, and `docs` folders and replacing `current-season.html`. Do not upload an
extra enclosing folder. Keep files not supplied in this patch.

Commit the changes and wait for the existing GitHub Pages deployment. This cleanup
changes seven files. It requires no new data, workflow changes, or manual sync.
The stylesheet version was advanced to refresh the updated layout.

## Check after deployment

1. Open Current Season. Schedule Swap Analysis should follow Standings Race,
   with a separate Schedule Difficulty panel immediately beneath it.
2. Confirm there is no matrix or difficulty-order selector, and no Last Sync /
   Next Sync line beneath the schedule tables. Other site tables retain their
   existing sync footers.
3. Tap the summary headers to sort. Select a team by its name or the dropdown
   and confirm its full schedule breakdown appears.
4. On a phone, swipe the summary to reach all six columns. The compact Team
   column should stay aligned with its header; other headers should scroll
   vertically with the table. The three-column detail and difficulty tables
   should fit the available width.
5. Confirm the difficulty table begins with the hardest schedule. For the
   supplied Week 7 snapshot, Room 40 is hardest and The Vandercruyssen Empire
   easiest. Touchy Time shows 4–3 actual, 4.42 average wins, 6–1 best, 3–4 worst,
   and −0.42 impact.

## Calculations and updates

The calculations and automatic updates are unchanged by the layout cleanup.
Scores and opponents come from the verified `site-data/site-data.js` bundle.
Current team names use the existing daily Sleeper snapshot, matched by stable
owner IDs, with published team names as the fallback.

For evaluated team A borrowing schedule B, compare A's actual weekly score with
B's original opponent's score. If that opponent is A, substitute B. This is a
full fixture-position swap and avoids comparing a team with itself.

Scores use integer hundredths, including commissioner overrides already handled
by the Sleeper sync. Equal scores are ties. Every scenario covers the same
completed regular-season weeks. Future and playoff games are excluded; incomplete
or inconsistent published data stops the analysis rather than shortening it.
Calculations use the current roster size, with one paired opponent per team/week.

- Average Wins: mean wins across all schedules, including the actual schedule.
  Ties stay separate and do not receive half-win credit in this metric.
- Impact: actual wins minus Average Wins. Positive means the actual schedule
  helped relative to this team's alternatives; negative means it hurt.
- Best/worst records: compare wins first, then losses.
- Difference: hypothetical wins minus actual wins.
- Schedule Difficulty: average wins all teams earn on one schedule, including
  its owner's actual record. Lower means harder. Equal averages share a rank.

The existing weekly checks remain Tuesday at 6:00 AM, 11:13 AM, and 12:43 PM
Eastern, with Wednesday's 8:13 AM fallback. GitHub can delay scheduled jobs.
The existing refresh loader picks up newly verified snapshots. Regular-season
ties and playoff-boundary checks remain supported by the previously supplied
sync changes. Existing owner/season rollover and published-score correction
gates remain in place.

## Validation

For this cleanup, all 17 targeted tests passed: eight calculation tests, five
interface-controller tests, and four freshness-footer tests. These confirm the
summary and detail interactions, fixed difficulty order, rename handling, removal
of the matrix controls, and sync-footer opt-outs. HTML IDs, labels, referenced
assets, and section placement were checked. No score data or mascot assets changed.

```sh
node --test tools/schedule-swap/tests/*.cjs tools/refresh/tests/test_freshness.cjs
```

Calculation tests compare every scenario independently against saved raw Sleeper
fixtures, including own records and self-matchup substitutions. They also cover
ties, column averages, different league sizes, missing data, and playoff exclusion.
The previous feature delivery passed all 73 Sleeper generator/CLI tests, the
published-data verifier, 16 Sparty generator tests, and six transaction tests.
Those generators were not changed by this cleanup.

Actual desktop/mobile browser rendering remains unverified here because browser
binaries are unavailable and downloads are blocked. Controller tests do not
establish pixel layout; perform the desktop and phone checks above after deployment.

Four unrelated pre-existing refresh/mascot JavaScript assertions also failed in
the original ZIP: one expects an older script URL, and three expect older mascot
text, intro behavior, or snapshot details. Their implementations remain unchanged.
