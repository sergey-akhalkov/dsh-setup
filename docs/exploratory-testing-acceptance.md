# Exploratory testing acceptance

Reviewable acceptance evidence for the `add-exploratory-testing` change. This page lives outside
the change directory on purpose: recording the final comparison here does not change the change
artifact digest it reports on.

## Final review-loop comparison

Executed on 2026-11-18 after the last plan edit (commit `3354d92`):

```text
currentSpecDigest("add-exploratory-testing") = 8c5ca2dec4146a6c809c9a5fe796923077fd11568aa63c327a6a11cc2101df53
whole-spec PASS record digest                = 8c5ca2dec4146a6c809c9a5fe796923077fd11568aa63c327a6a11cc2101df53
verdict                                      = PASS
matches                                      = true
```

- Record: `.dsh/workflows/records/spec-review/add-exploratory-testing/spec.json` (native store).
- Whole-spec run: `run-mwmktlu4-0a1deeae`.
- The recorded PASS binds exactly the current plan digest, so the archive gate's current-record check
  passes.

## Behavioral acceptance

- Decision gate: `openspec/changes/add-exploratory-testing/acceptance/decision-gate.md` — the packaged
  skill withheld F-1 while its classification was pending, then executed red → fix → green after the
  user classified it as a bug, staying spec-less.
- Cycle A lifecycle: `openspec/changes/add-exploratory-testing/acceptance/cycle-a-lifecycle.md` — the
  skill prepared `explore-demo-2026-11-18` with `skip_specs: true`; a completed intake run with its
  receipt, adoption, click authorization, and a real `openspec archive` followed.

## Regression coverage

`pnpm check` is green (163 files, 3016 tests), including the marker tests (duplicate keys, escaped
keys, aliases, quoted keys, escaping links), the live-fallback `reviewed-inputs-changed` cases, and
the fixture-based acceptance test that drives the contributed `change-intake` run to completion.
