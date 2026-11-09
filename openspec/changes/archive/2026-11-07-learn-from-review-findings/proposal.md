# Proposal

## Why

Review findings are write-only. The 2026-11-05 analysis counted 321 FINDINGS that never became a rule, a test, or a prompt change, and the same classes recur across changes. The review engine already stores each finding with evidence and a fix, but nothing clusters them, nothing turns a repeated class into a durable lesson, and the next review starts with the same blind spots. This change closes that loop without adding a second reviewer or a new log.

## What Changes

- Add a controlled `class` to every review finding (`spec-ambiguity`, `missing-test`, `path-boundary`, `state-persistence`, `stale-input`, `api-contract`, `plan-shape`, `docs-drift`, `security`, `other`). The review prompt asks for it; the parser normalizes an absent or unknown class to `other`; the local record stores it.
- Add a local lesson store under `.dsh/review-learning/` with `proposed`, `accepted`, `rejected`, and `applied` states, bounded dedupe, and a source link to the findings that produced it.
- Add a deterministic `review_retro` tool that clusters the last N review findings by class, reports the repeat rate, and returns at most one proposed lesson with evidence. It calls no model.
- Add a `review_lesson` decision action that requires a direct user answer before a lesson becomes accepted or applied. A model may propose, but it cannot accept its own lesson.
- Inject up to three accepted or applied lessons, matching the rule and the change's capabilities, into the next review prompt. A missing or empty store adds no section.
- Retain a bounded sanitized finding history so a later PASS does not erase the learning input.
- Report the repeat-finding rate per class from the finding history. No new telemetry is added.

## Capabilities

### New Capabilities

- `review-learning`: the finding-class vocabulary, the local lesson store, the deterministic retro report, the user-approved lesson lifecycle, the bounded prompt injection, and the repeat-finding metric.

### Modified Capabilities

- `delegation-rules`: review findings carry a class, the review instructions request it, and the record parser normalizes an absent or unknown class.

## Impact

- `packages/plugin-delegation-rules/src/shared/approval.ts` (finding shape and parser), `src/host/index.ts` (record, prompt assembly, tools), the new `src/host/{lesson-store,learning-tools,retro,finding-history}.ts` modules, the three review prompt assets, `packages/plugin-delegation-rules/package.json` (publishable file list), tests, and `docs/delegation-rules.md`.
- A new local lesson store and finding history under `.dsh/review-learning/`; no tracked data, no new package, no DSH version.
- Out of scope: automatic edits, auto-accepting a lesson, changing the P0/P1 pass rule, a new reviewer, and the workflow trigger that runs the retro (change `add-workflow-obligations` wraps the tool).
