# Ask Sparty reliability — version 9

The owner confirmed the version 9 Worker works in production on October 29, 2026.
This package records that source in GitHub and updates the website error presentation.
Uploading these files does not deploy a Cloudflare Worker.

## Website changes

assets/ask.js preserves the Worker error explanation, including the approved joke.
Network errors and timeouts use “A Wolverine got in the way. Try again.” plus the cause.
ask.html changes only the ask.js version parameter so browsers request the new script.
Sprites, animation logic, endpoint, and successful response fields are unchanged.

## Worker behavior

Verified calculations support highest/lowest scoring stretches, scoped head-to-head,
tied leaders, dynamic years, and conversational templates without extra AI calls.
Structured AI plans are validated before execution; numeric text is normalized only
for declared numerical fields. Unsupported calculations return an explanation.
Zero-title questions compare all historical owners against completed championship
records; explicitly requesting current owners restricts that population. Year/stage
restrictions on this dedicated career calculation are declined rather than ignored.

## Tests and maintenance

Run from the repository root with Node 22:

    node --test cloudflare/ask-sparty/tests/*.test.mjs

The 39 tests use frozen supplied data and mocked AI/network responses. They cover
calculations, validation, integrity, caching, limits, zero titles and mascot DOM behavior.
The test workflow uses read-only permissions and never deploys. Fixtures are regression
snapshots, not live league updates. Refresh them intentionally with consistent manifests.

## Cloudflare settings and recovery

Production Worker name: sparty. Keep the Workers AI binding named AI.
wrangler.toml documents the configuration; GitHub Actions does not deploy it.
Keep credentials outside GitHub. AI_DEBUG should remain unset in production.
AI_ENABLED=false disables open-ended AI interpretation while deterministic queries remain.
To update manually, preserve the existing deployment, paste worker.txt in Cloudflare,
and deploy only when authorized. Restore the previous Cloudflare version to roll back.
For website rollback, revert assets/ask.js and ask.html together in GitHub.

## Limits

Cloudflare Free plan; expected traffic below one query daily. CPU usage is unmeasured.
Snapshot and answer caches and request/AI limits are per Worker isolate, not global
spending caps. Snapshot cache lifetime is 60 seconds; up to 128 answers are held per
isolate, keyed by release, data version, model, AI setting and question. Data integrity
failures reject expired snapshots. Backend and AI timeouts bound waiting.
Live user checks are representative, not proof of all natural-language interpretations.
Playoff scenarios, schedule swaps and historical discovery are outside this release.
All code and execution remain independent of this ChatGPT profile.
