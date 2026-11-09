# Detailed clinching routes — planned extension

The current interface gives proven sufficient win totals and estimates the effect
of chosen winners. It does not yet calculate all combinations that clinch a spot.
Do not label a rooting suggestion or a run of successful simulations as a clinch.

## When to search

Start detailed path generation with three or fewer regular-season weeks left
(after Week 11), rather than enumerating seven weeks of outcomes. Trigger from the
verified weekly snapshot and retain the same source/schedule/rules versions.
A helper in tools/playoffs/late_paths.py formalizes this window. It is a development
plan, not an enabled automatic exact-path generator.

## Desired routes

1. A result alone: “Win this week and you are in.”
2. A short result combination: “A Jack win, plus TJ and Kyle losses, clinches a spot.”
3. A PF-dependent route: “With those results, stay ahead of Spencer on total PF.”
4. If only one scoring week remains, show the relative score condition and, when
   the user fixes their own score, an equivalent rival score threshold.

These are examples of wording, not verified routes for the current league.

## Calculation approach

- Enumerate the six next-week matchups, including ties (3^6 = 729 branches).
  Search later weeks with bounded optimization rather than expanding all branches.
- Use final win-equivalent points and cumulative PF, retaining game-by-game score
  consistency. Scores are nonnegative integer cents. Chosen scores must agree with
  the selected game winner. Do not freeze current PF or assume a future score cap.
- Find combinations that guarantee qualification against EVERY legal remaining
  result and score assignment. A solver timeout is “not checked,” never a proof.
- Minimize each proven route: remove a result condition and try to find a losing
  counterexample. Keep conditions only when needed; retain proof/witness metadata.
- Enumerate routes in order of fewest required outcomes, prioritize the selected
  team's next game, and publish only a handful of distinct verified routes.
- Test the shortlist against exhaustive small leagues and frozen late-season cases,
  including tied records, multiway PF ties, chosen scores, score corrections, and
  schedule changes. Simulations and guarantees must stay separate.

## Why “Spencer below 100” needs context

If the selected owner trails Spencer by 20 PF and scores 120 in the last week,
Spencer must score less than 100 for that owner to finish above him on PF. At 100,
PF is tied, and the supplied league rules do not resolve that further. If the
owner's own score is still unknown, the correct condition is “Spencer scores less
than your score minus 20.” With two weeks left, this is a condition on TOTAL remaining
scoring, not just this week's score. PF only determines a route if the relevant
records also tie and the complete league qualification calculation confirms it.

The tested pf_requirement helper preserves this distinction and explicitly sets
proves_playoff_spot=false. It cannot manufacture a stand-alone clinching guarantee.

## Versioned output contract

Each route should include snapshot/rules versions, scope (current results or selected
picks), target owner, required game results, necessary score inequalities, unresolved
PF equality cases, proof status and evidence. UI displays a route only after complete
verification. Unsupported cases remain plain-language explanations. Failed optional
path generation must not remove the last usable league forecast; stale routes are
hidden after standings, scores, schedule or rules change.

## Presentation

The Path to a playoff spot section gets a short list of result combinations only
when verified routes exist. Put source/verification and edge-case explanations in
More about this path. Relative PF conditions stay relative until a score is supplied.
There is no fabricated “below 100” condition and no claim that all paths were found.
