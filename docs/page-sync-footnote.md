# Page-level sync footnotes

Upload this patch into the repository root, preserving its folders, and commit.
The patch changes assets/freshness.js, ask.html, and the freshness tests, and adds
this note. Existing current-season.html and seasons.html files are not replaced,
so manual edits to the Luck descriptions are preserved.

Each of the seven pages now has one small sync footnote after its existing footer.
The shared script no longer inserts timing lines under individual tables. It
continues to apply the existing compact team-column styling.

The footnote shows the actual league-results publication time and the next
scheduled weekly check, using Eastern time and its date-specific daylight-saving
offset. Current Season also notes that transactions and Max PF update daily at
9 AM Eastern. No sync schedule or calculation changed.

Ask Sparty loads only the small publication manifest to obtain the timestamp;
its existing question interface and service remain unchanged. Its security policy
allows that same-origin metadata request. Offline or invalid metadata is handled
without inventing a timestamp or disrupting the page.

After Pages deploys, refresh and check the bottom of each page. Tables should have
no Last Sync / Next Sync lines. If an existing tab still has the old layout,
reload it after deployment. No Actions run is required for this display change.

Validation: all 20 targeted freshness and schedule-analysis checks passed,
including one-footnote placement, all seven page integrations, daily/weekly labels,
DST, failure handling, and existing team-column styling. Actual browser rendering
remains unverified in this environment.
