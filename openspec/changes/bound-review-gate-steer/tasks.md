# Tasks

## 1. Gate contract and delivery bound (owns packages/plugin-workflows/src/host)

- [x] 1.1 Add `hold: boolean` to the `refuse` outcome in `packages/plugin-workflows/src/host/gates.ts`; in `evaluateReviewClose` steer the full refusal with `hold: true` while the session's per-turn review counter is below `maxBlocks`, and return `refuse` with `hold: false` and the run unchanged at or above it. Verify with a gate unit test that ten close attempts in one turn submit exactly `maxBlocks` steering messages, the remaining attempts return `hold: false` with the run open, and no `allow` or `VIOLATION` appears.
- [x] 1.2 In `packages/plugin-workflows/src/host/index.ts`, handle `hold: false` in the turn-stopping loop: keep the run owner, do not set `refusedThisClose`, and continue evaluating the remaining runs and the post-loop obligations; keep the existing path for every other non-`allow` outcome. Verify with a host test where an exhausted review bound plus a pending verification or checkpoint obligation still steers for that obligation.
- [x] 1.3 Thread one per-turn review delivery budget into `evaluateTurnClose` (a `remaining()`/`spend()` object owned by the listener and keyed by session and turn) and use it at every review-refusal steer site: `evaluateReviewClose` (both branches), the owned-review fallback at `gates.ts:344-356` reached when `input.review` is undefined, the settled-verdict steer loop (`index.ts:6249-6341`), and the review-start failure branch (`index.ts:6345-6349`). The owned-review fallback MUST return `hold: false` after the bound instead of the `ownedRefusal` `VIOLATION` release, and the start-failure branch sets `refusedThisClose` only when it actually steered. Verify with host tests that a settled `FINDINGS` unit, an unavailable review status, and a repeatedly failing review start each steer at most `maxBlocks` times in a turn, steer again on the next turn, and do not swallow a pending verification or checkpoint obligation.

## 2. Tests and docs (owns packages/plugin-workflows/test, docs/workflows.md, docs/plugins.md)

- [x] 2.1 Extend `packages/plugin-workflows/test/gates.test.ts` with the bounded-delivery, ended-turn, unrelated-obligation, and new-turn cases; run `pnpm exec vitest run packages/plugin-workflows/test/gates.test.ts`.
- [x] 2.2 Add the exhausted-review-plus-verification and exhausted-review-plus-checkpoint host cases to the host wiring tests; run the same suite and confirm both obligations still apply their own rules.
- [x] 2.3 Update `docs/workflows.md` (turn-close gate) and `docs/plugins.md` where the review close is described, stating that the close is never approved by the bound, delivery is capped per turn, an ended turn leaves the run and completion open, and unrelated obligations are still evaluated; verify with `pnpm lint`.

## 3. Verification (owns packages/plugin-workflows/lib)

- [ ] 3.1 Run `pnpm build`, `pnpm check` and `pnpm gen:check`; verify the committed build output matches the sources and no generated file drifted.
- [x] 3.2 Re-read the gate tests and confirm the asserted message count equals `settings.maxBlocks` from the definition fixture, not a literal that could drift from the shipped definition; verify by pointing the assertion at the fixture value.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Release after the archive, per the repository's standing release rule.
