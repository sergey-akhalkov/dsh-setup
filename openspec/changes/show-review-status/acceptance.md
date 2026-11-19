# Acceptance evidence: tasks 1.6 and 1.16

These observations come from a live run of this checkout, not from unit tests. The run used a
throwaway `DSH_HOME` under `.tmp/accept-*`, a `web` profile with `@dsh-setup/setup` installed from
`packages/setup` (`file:`), and a fake change `review-acceptance`. The installed
`plugin-workflows/lib/client.js` and `plugin-openspec/lib/client.js` were byte-identical to the
checkout. The host ran on `127.0.0.1:3099`; the owner's desktop profile and the live GUI port were
never touched. The fake change's spec review was started by a model turn that edited
`proposal.md`, so the run exercised the real turn-close review path.

The browser was driven by a self-spawned `nuphus-mcp` child with
`NUPHUS_MCP_ALLOW_PRIVATE_NAV=1`; each observation below was read from the live DOM
(`browser_evaluate`), not from a screenshot.

## 1.6 Session-row review indicator

- Before the turn: no `[data-workflows-review-mark]` in the session row (0 marks).
- While the review ran: one mark with `aria-label="Review running: spec"` (1 mark), the ring element
  present.
- After the verdict: the mark disappeared (0 marks); the card line below had already changed to the
  settled verdict, and the review loop re-armed a new round, which brought the mark back — the
  indicator follows the executor, not the run file.

## 1.16 Panel review line, live and settled without a reload

- The OpenSpec panel rendered the change card `review-acceptance` before the review:
  `Review spec not reviewed · reviewed 0/1 tasks`.
- While the review ran the line showed `spec review running - attempt 1 · reviewing tasks - 1. Probe`
  and later `reviewed 0/1 tasks`.
- When the verdict landed the line showed `spec findings (1) · reviewed 1/1 tasks` without a page
  reload: `window.__acceptancePage` stayed `'A'` across every poll.
- The panel's own four-second liveness poll drove the first live state; the settled line came from
  the debounced change-list re-read, again with no reload.

## Scope limits

- The browser observations were taken in one session. The end-to-end cross-session case (an idle
  session's panel showing a review owned by another session) is covered by the host route test for
  the `?session=` form; the browser run did not open a second session, and this file does not claim
  it did.
- The fake change's review ended in `FINDINGS` and the loop started another round, so the settled
  state was observed for one full verdict cycle, not for a final `PASS`.

## Gate state

The panel and observability deltas are synced into the main specs (`ab99f60`) and validate. At the
time this line was written `pnpm reviews:check --change show-review-status` reported 14/16 portable
approvals, missing only these two acceptance tasks; their task-review runs were already in flight.
The change is ready to close once those two approvals land.

