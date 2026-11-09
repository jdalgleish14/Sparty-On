# Playoff display freshness fix — November 9, 2026

Prepared from Sparty-On-main (15).zip. Both the forecast and core snapshot are through
Week 8; standings and score signatures agree. A local UI harness renders all twelve
owners with that data. The live site was inaccessible from this environment, so the
specific browser cache contents could not be inspected.

The loader previously keyed the optional forecast exclusively by the core manifest
version. Forecast-only publication does not change that version, so a previously
cached forecast can remain in use after a successful retry. The loader now gives
only the forecast bundle an additional per-page-load cache key. Current Season also
bumps its loader URL so browsers request this fix. Offline loading is unchanged.

Two automated loader tests pass: fresh forecast requests with an unchanged core
manifest, and unchanged offline file loading. Week 8 UI rendering and the rejection
of mismatched Week 7 forecasts also pass. Calculations, data validation, published
scores, workflows and sync repairs are unchanged.

Upload this patch's contents to the repository root and commit. After Pages publishes,
reload Current Season > Playoff Predictor. Rollback restores the prior two runtime
files: current-season.html and assets/data-refresh.js.
