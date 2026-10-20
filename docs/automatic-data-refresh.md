# Automatic score refresh

The six statistics pages load their scripts through `assets/data-refresh.js`. This checks
`site-data/manifest.json` with `cache: no-store`, then loads the original scripts in their
original order. The three generated JavaScript data files receive a `snapshot` URL parameter
based on the manifest timestamp. A new weekly publication therefore has new data URLs.

After initialization, a lightweight manifest check runs every five minutes while visible,
when returning to the tab, when Safari restores a page, and when connectivity returns.
Requests are throttled to one per thirty seconds and time out after eight seconds. Hidden
tabs do not poll. An unchanged snapshot does not reload. Failed requests keep the current
page. Local file previews load the bundled scripts without manifest requests.

When the manifest timestamp differs from the loaded dataset, the same page reloads with
an `_sparty_version` query parameter. Other query parameters and the fragment remain.
The current scroll coordinates are saved in session storage and restored after scripts
initialize. If storage is unavailable, updating still works but scroll restoration is not
guaranteed. The version parameter prevents repeated reloads for the same publication.
Page filters and expanded panels reset with the reload.

The statistics-page CSPs allow same-origin connections for the manifest check. No third-party
connection permissions were added. Ask Sparty has no bundled statistics and is unchanged.
The existing weekly workflow already advances the manifest timestamp; it needs no changes.

## Install

Extract `Sparty-On-auto-refresh-update.zip` and upload its contents into the repository root,
keeping the `assets/`, `docs/`, and `tools/` folder structure. Replace the six included HTML
pages. Commit to main and let GitHub Pages finish deploying. The ZIP contains only changed
files; it does not include or replace published score data, including the new Week 6 results.

An already-open page from before this deployment needs one normal reload to acquire the new
refresh code. Once loaded, future score publications are detected automatically. Safari may
still cache that first pre-update page until its cache expires. Suspended iPhone tabs cannot
check in the background; returning to a visible tab triggers the check.

## Verification

Run `node --test tools/refresh/tests/test_refresh.cjs` (Node standard library only).
Seven checks cover versioned loading/order, unchanged data, tab returns, the polling interval,
hidden tabs, network failures, storage restrictions, reload-loop prevention, local previews,
and integration on all six pages. `node --check assets/data-refresh.js` also passes.

Full browser validation could not run here because Playwright's browser executables are
not installed. After deployment, verify Safari on an iPhone by returning to an existing tab
following the next published snapshot, and confirm the latest standings and scroll position.

The pre-existing mascot interaction suite has two failures in the supplied ZIP: expected
Home wording differs from the current dialogue, and the Records intro visibility assertion
fails. Its source and mascot scripts were verified unchanged by this update. Six other
mascot interaction checks pass. These failures are separate from the refresh tests.
