# Tasks

The change is one Host package with a shared start path; it is a single lane. Tests and docs land with the group that owns the behavior.

## 1. Configuration and queue state machine

- [x] 1.1 Add the `reviewQueue` config with `enabled`, `concurrency` (default 2, 1-4), `maxQueued` (default 16), `maxAttempts` (default 3), `baseDelayMs`, `maxDelayMs`, and `waitTimeoutMs`; verify defaults apply, an out-of-range value fails plugin load with the field, and an absent block preserves the current behavior when disabled. Verify with `pnpm build` then `pnpm exec vitest run packages/plugin-delegation-rules/test/config.test.ts`.
- [x] 1.2 Implement the queue state machine and FIFO admission (`new`, `queued`, `starting`, `running`, `retry-wait`, `settled`) with a bounded waiting list that counts unique per-key followers, concurrency, position, and a wait timeout that starts at acceptance; verify capacity, queued order, `queue-full`, an asynchronous `queue-timeout` settlement, and a cancelled queued run with unit tests under `packages/plugin-delegation-rules/test/review-queue.test.ts`.
- [x] 1.3 Implement identity dedupe computed after preparation (rule/change/task/phase + prepared digest + resolved reviewer) as an atomic replacement that covers `queued`, `starting`, `running`, and `retry-wait`; when re-preparation collides, settle the re-preparing run `discarded` with the incumbent run id, promote a queued key head's next follower, and preserve the per-key order so a follower cannot jump ahead of its key head; verify same-identity join, a changed digest as a new run, a D1-to-existing-D2 collision that starts one target and settles both handles once, and two keys running up to the limit.

## 2. Start-path integration

- [x] 2.1 Move preparation and cached-record reuse before the identity map decision and insert admission before `startTarget()`; a reused record bypasses the queue, a changed digest is a new identity, and a queued run returns its handle before the target starts; capture the publication baseline only when the queued run becomes start-eligible, after its predecessor has settled; verify the existing review tests still pass, a cached PASS starts no child, the pre-preparation `reviewIdentity` is not used for dedupe, and a record published while a queued run waits does not discard its completion.
- [x] 2.2 Record the `queueSignature` over the source input set for every preparation, including a successful frozen snapshot; re-check it once before a queued run starts, re-prepare and clean up the old snapshot when it changed, replace the identity atomically, and keep an in-run `reviewed-inputs-changed` as a terminal `ERROR`; verify queued source changes, a collision with the incumbent proceeding, and a stable run.
- [x] 2.3 Keep the `delegate` tool handle shape and return `queued` with a position or `running`; queue-full is an immediate tool error, while a wait timeout settles asynchronously in the run file and status after the handle was returned; verify a free slot, a full queue, and a timeout.

## 3. Failure classification and retry

- [x] 3.1 Add the classifier for `child-limit`, `provider-not-started`, `timeout`, `reviewed-inputs-changed`, `invalid-output`, `config`, `permission`, and `unknown`; verify each class from a fake provider result and a bounded redacted message.
- [x] 3.2 Add retry with `maxAttempts`, exponential backoff, full jitter, a provider-supplied retry-after cap, and a fake clock; verify the attempt count, the delay bounds, and that a permanent class starts no retry.
- [x] 3.3 Add the timeout retry guard: cancel and drain the started child, publish no record, and retry only when cancellation is confirmed; otherwise settle `ERROR` `timeout` and quarantine the conversation key, capacity slot, and snapshot until teardown is confirmed; verify a cancelled timeout retries, an unconfirmed timeout settles, and followers wait during quarantine.
- [x] 3.4 Add the queue-internal-error fallback: record `queue-internal-error`, start directly once when possible, and otherwise return `ERROR`; verify the fallback starts one target and the gate sees an `ERROR`, not a PASS.

## 4. Record integrity and settlement

- [x] 4.1 Make only the settled attempt call `publishRecord()`, and only while it owns the current identity; discard a retry when an authoritative record exists and discard a superseded predecessor so it never overwrites its successor; refresh the publication baseline only before a run's first start, never before a retry; verify exactly one `PASS`/`FINDINGS`/`ERROR` record for a retried identity, a superseded late completion, and a retry that does not adopt a record published while it waited.
- [x] 4.2 Wire the existing settlement observer so it fires once after the final attempt settles, not on queue admission or retry wait; verify queued, timeout, retried, and no-observer cases with a fake observer and no polling.
- [x] 4.3 Add bounded run fields (`queuePosition`, `queuedAt`, `waitMs`, `attempts`, `failureClass`, `lastRetryAt`) and the `delegation_status` queue summary; verify the status text and that no credential or machine path appears.

## 5. Restart recovery and verification

- [x] 5.1 On plugin load, reconcile each durable run with its authoritative record: preserve the published verdict and its terminal state (PASS and FINDINGS `completed`, ERROR `failed`) and evaluate approval through the existing verdict, digest, and reviewer checks; a FINDINGS or ERROR record is never an approval, and a stale whole-scope PASS does not approve the current digest; a run without a record is marked `interrupted` and never synthesized as a PASS; verify a current PASS, FINDINGS-is-not-approval, ERROR-is-not-approval, stale-whole-scope-PASS-is-not-approval, crash-before-publication, and that the gate uses the record, not the run status.
- [x] 5.2 Add an integration test that starts more reviews than the concurrency limit with a fake provider, releases slots in order, and asserts the queue order, the concurrency ceiling, one record per identity, a D1 predecessor settling while a queued D2 successor waits and D2 then publishing successfully, and the final status; verify with `pnpm exec vitest run packages/plugin-delegation-rules/test/review-queue.test.ts packages/plugin-delegation-rules/test/gate.test.ts`.
- [x] 5.3 Document the queue contract, defaults, failure classes, off switch, restart behavior, and the `queued` handle in `docs/delegation-rules.md`; verify the documented config and behavior against the implementation.
- [ ] 5.4 Run `pnpm gen`, `pnpm build`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, and `openspec validate harden-review-queue --strict`; verify all pass and the generated setup tree carries the queue config.

## Workflow follow-up

- Run a live review under a forced capacity shortage in a throwaway profile; confirm it queues, retries, and settles without a model-visible child-limit error.
- Archive the change after the project's review requirements are satisfied; do not change the review prompt or the archive gate in this change.
