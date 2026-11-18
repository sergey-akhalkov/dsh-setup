# Review-loop acceptance

Run date: 2026-11-18. Scope: the review-loop contract in design D12 and task 5.5.

## Frozen whole-scope review and the digest

A whole-spec review runs on a frozen snapshot of the change artifacts and binds the prepared digest;
later worktree edits do not invalidate the verdict, and only a change to the reviewed plan artifacts
does. The whole-spec PASS that this acceptance rests on:

- Record: `.dsh/workflows/records/spec-review/add-exploratory-testing/spec.json`, verdict `PASS`,
  digest `e44aa6980dcc9114218c120c4719fabdef84ba2784827c9adfcdb97c5789b8ba`.
- Run: `run-mwmk5osc-97c027e3`.
- `currentSpecDigest` at the time of the PASS returned the same digest, so the record was current for
  the change.

The current PASS after the final review round is whatever the record shows at archive time; this
document is itself part of the reviewed plan, so the final PASS binds the digest that includes it.

## A plan edit makes the record stale

The first whole-spec PASS (`run-mwkp57ls-e1962b2e`, digest
`72dd08f30fd4211a1196d998e764a733aca12a7299b789e956838b84208f4791`) was earned on the original plan.
Editing the plan (the lane-headings correction and the review-loop revision) changed the change-artifact
digest to a different value (`c462d9e0…`), and the old record no longer verified: adoption and archive
refused it as stale and the engine required another whole-spec round. No step was skipped and no fake
spec delta was created.

## A code-only edit does not invalidate the spec review

The change-artifact digest hashes only files under `openspec/changes/<change>/` (normalizing
`tasks.md` checkboxes and excluding `portable reviews/`). Source, test, documentation, and generated
code edits are outside that input set, so they cannot change the digest or stale the whole-spec
record. `packages/plugin-workflows/test/review-host.test.ts` covers the boundary (a plan edit moves
the digest; ticks, approvals, and code writes do not).

## Live fallback tracks the marker

When a snapshot cannot be built, the review falls back to live inputs under the reviewed-input guard.
`.openspec.yaml` is a tracked input, so a `skip_specs` flip or an edit-read-restore during a live
whole-spec review publishes `ERROR` with failure class `reviewed-inputs-changed`, never a `PASS`
(regressions in `review-host.test.ts`: "changes the skip_specs marker" and "changes and restores the
skip_specs marker").

## Result

The review loop holds: a frozen PASS survives concurrent code work, a plan edit stales it and forces
another round, a code-only edit does not, and the live fallback binds the marker. This record is
verified by the final whole-spec review, whose PASS record and digest live in the native store named
above.
