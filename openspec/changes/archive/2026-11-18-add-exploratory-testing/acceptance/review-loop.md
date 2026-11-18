# Review-loop acceptance

Run date: 2026-11-18. Scope: the review-loop contract in design D12 and task 5.5.

## Frozen whole-scope review and the digest

A whole-spec review runs on a frozen snapshot of the change artifacts and binds the prepared digest;
later worktree edits do not invalidate the verdict, and only a change to the reviewed plan artifacts
does. A historical PASS that this acceptance observed:

- Record: `.dsh/workflows/records/spec-review/add-exploratory-testing/spec.json`, verdict `PASS`,
  digest `e44aa6980dcc9114218c120c4719fabdef84ba2784827c9adfcdb97c5789b8ba`.
- Run: `run-mwmk5osc-97c027e3`.
- `currentSpecDigest` at the time returned the same value, so the record was current.

The final verification is mechanical and is repeated at authorization: the final whole-spec `PASS`
record is the one at the path above, and the archive gate recomputes `currentSpecDigest` of the
complete change and refuses a missing or stale record. Editing this document is itself a plan edit,
so the final PASS covering the complete artifact set is the record whose digest equals
`currentSpecDigest`; nothing is deferred to prose.

## Observed: a plan edit makes the record stale

The first whole-spec PASS (`run-mwkp57ls-e1962b2e`, digest
`72dd08f30fd4211a1196d998e764a733aca12a7299b789e956838b84208f4791`) was earned on the original plan.
Editing the plan (the lane-headings correction and the review-loop revision) changed the
change-artifact digest (`c462d9e0…`), and the old record no longer verified: adoption and archive
refused it as stale and the engine required another whole-spec round. No step was skipped and no fake
spec delta was created.

## Observed: a code-only edit does not invalidate a spec review

The change-artifact digest hashes only files under `openspec/changes/<change>/` (normalizing
`tasks.md` checkboxes and excluding the portable `reviews/` directory). Observed on this change:
commit `88761e0` changed source, tests, and generated files after the whole-spec PASS at digest
`f8b97cff50bb3c140d3acaa6d5f7793e99f8c625ca9701c90a92f9b53512daaa`; `currentSpecDigest` recomputed
after that commit stayed `f8b97cff…`, so the spec review record remained current. Code, test,
documentation, and generated-output writes are outside the reviewed plan input set.

## Observed: the live fallback binds the marker

When a snapshot cannot be built, the review falls back to live inputs under the reviewed-input guard.
`.openspec.yaml` is a tracked input, so a `skip_specs` flip or an edit-read-restore during a live
whole-spec review publishes `ERROR` with failure class `reviewed-inputs-changed`, never a `PASS`.
Observed in the acceptance suite: `packages/plugin-workflows/test/review-host.test.ts` — "changes the
skip_specs marker" and "changes and restores the skip_specs marker" both settle with that ERROR; the
same suite records the digest boundary for ticks, approvals, and code writes.

## Result

The review loop holds: a frozen PASS survives concurrent code work, a plan edit stales it and forces
another round, a code-only edit does not, and the live fallback binds the marker. The final
whole-spec PASS record and its digest are verified against `currentSpecDigest` by the archive gate.
