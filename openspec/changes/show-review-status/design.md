# Design

## Context

See [proposal.md](proposal.md) for the motivation. The behavior lives in two installed plugins and
one shell extension point:

- `@dsh-setup/plugin-workflows` owns the review records, the review executor, and the in-memory
  review scheduler (`reviewScheduler.liveRunById`). It already serves a read-only HTTP API through
  `packages/plugin-workflows/src/host/api.ts` and provides two host services to other plugins.
- `@dsh-setup/plugin-openspec` owns the right-sidebar panel. Its change-list route
  (`packages/plugin-openspec/src/host/change-list.ts`) shells out to `openspec list`, so it is
  loaded once per list refresh and must not be polled.
- The shell owns the session list. A Client plugin cannot mark a session active, but it can mount an
  occupant in `sidebar.session.row.leading`; that seat renders only while the row's primary state is
  idle, which is the waiting-close state.

The liveness predicate is owned by `fix-review-run-liveness` (issue #7): the scheduler entry or the
in-flight admission is `live`, an open run whose executor returned early behind a live covering
review is `waiting`, and an open run with no executor is `orphaned`. This change consumes that
predicate and does not define liveness from persisted run status.

## Goals / Non-Goals

**Goals:**

- One review-state read model owned by the workflows host, used by both surfaces.
- Static review facts (whole-spec verdict, current/stale, task coverage) ride the existing
  change-list response.
- Live review facts are a separate, cheap, in-memory read that both clients poll only while visible.
- The card grows by exactly one line; the session list gains one 14px glyph.
- Every surface is inert without the workflows plugin, and no review action is ever triggered by a
  read.

**Non-Goals:**

- Replacing or restoring the shell's own session activity spinner.
- Showing the integration-review verdict on the card (needs the reviewed worktree digest).
- A per-task review list or a Review tab in the change detail view.
- Persisting liveness, caching it across restarts, or a push channel.
- Changing the review records, the portable approval format, or the archive gate.

## Decisions

**D1 — The workflows host is the single owner of review state; the OpenSpec host consumes a
service.** A new optional service `workflowsReviewStatus` is provided next to `workflowsArchiveGate`
and read by the OpenSpec change-list route at request time with `ctx.get`. The OpenSpec plugin never
reads `.dsh/workflows/records` or re-implements the approval match. Alternatives rejected: reading
the files in the OpenSpec plugin (duplicates digest and approval semantics and can disagree with the
gate); joining two HTTP responses in the Client (larger client surface for the same data).

**D2 — Static state rides the existing change-list response; only liveness gets a new route.**
The change-list rows already carry `presence`, `phase`, and provenance; each active row gains an
optional `review` object. The new route `GET /api/workflows/reviews/live` returns live entries only
and has two request forms: a single live `session` resolves that session's workspace and returns
every live or waiting review in it (the card, including a review another session started), while a
bounded `sessions` list returns only the entries of those sessions (the sidebar rows). A request
with neither form, with both, or with more than 100 ids is refused. A live-to-settled transition
triggers one debounced change-list re-read, because a verdict-only write changes no watched artifact
and the settled static state rides that response; the periodic read never re-reads the list.
Alternatives rejected: a second static route (more requests for data that changes only when files
change); polling the change-list route on a timer (it spawns the CLI); a session-only liveness read
(cannot show a review another session owns and would contradict the card's workspace view).

**D3 — Current means digest-current.** The whole-spec state compares the record's `digest` with
`currentSpecDigest(workspace, change)`, the same rule `verifyWholeSpecRecord` applies. A PASS on the
card therefore means the archive gate would accept the spec record now; a plan edit after the PASS
renders as outdated. Task coverage counts checked task lines whose portable approval matches rule,
change, task id, verdict PASS, and the reviewer binding, i.e. the working-tree `taskReviewCoverage`
match the archive gate reads. A valid approval counts even before it is committed; the commit-backed
audit stays with `pnpm reviews:check`, which the card does not replace. Alternatives rejected: a
commit check in the card (the gate does not perform one, so the card and the gate would disagree);
showing the last verdict regardless of digest (claims a review that the gate would reject); counting
every `reviews/*.json` file (misses stale task ids after a task-text edit).

**D4 — The session-list indicator is a Client occupant in `sidebar.session.row.leading`.** The seat
is documented as the state-dot position and renders only while the row is idle, so the indicator
never competes with the agent-turn spinner and disappears when the verdict starts the next turn. The
occupant draws a 14px ring only; the text lives in its tooltip and accessible name. Alternatives
rejected: `sidebar.session.row.trailing` (a quieter icon row whose meaning is not "live activity";
kept as a fallback if the leading cell is too crowded); `conversation.input.activity` (shadows
shipped UI and is not the session list issue #8 names); a shell-level activity service (does not
exist).

**D5 — One shared batch poll for the sidebar, one workspace read for the panel.** Every row
occupant subscribes to a module-level store. The store collects its mounted session ids, sends one
`?sessions=` request per interval, and pauses while the document is hidden. The panel polls the
`?session=` form for its own session while its tab is visible; that form is workspace-scoped, so a
review another session started still reaches the card. The interval is 4000 ms: a review runs for
tens of seconds at minimum, so this is a deliberate approximation. When a previously observed live
entry disappears, the panel performs one debounced change-list re-read so the settled verdict
replaces the spinner; a verdict-only write changes no watched artifact, and the periodic read itself
never re-reads the list. Alternatives rejected: keeping the settled state until an artifact edit
(the card would show a stale live state until the next manual refresh); per-row requests (N sessions
per interval); a session-only panel read (an idle panel session would miss a review its workspace
owns); SSE/WebSocket (the Host fetch carrier is request/response only); a host heartbeat file watched
through the resource service (more write/observe machinery for the same latency).

**D6 — The card adds exactly one line.** The line has two units, `spec` and `reviewed X/Y`; a live
review replaces only its own unit with a spinner and the unit label. Colors use the existing `Tag`
tones, and the spinner reuses the panel's animation with the existing reduced-motion rule. Missing
task numbers and PASS provenance stay in the tooltip, so card height does not depend on task count.
Alternatives rejected: extra chips in the artifact-tag row (wraps and crowds the commit tail); a
progress-bar overlay (mixes completion and review); a new tab (the card is the requested surface).

**D7 — A missing local record reads as not reviewed.** `.dsh/workflows/records` is machine-local and
not committed, so a fresh clone can have a reviewed change without a local spec record. The card
states that there is no local record and never claims a failure. Task coverage stays meaningful
across clones because the portable approvals are files in the change directory; a card that reads an
uncommitted approval says so only by counting it, and the commit audit remains a separate check.

## Risks / Trade-offs

- [Leading-cell occupancy] The shell already registers a schedule mark in the same cell → verify on
  the live row; fall back to `sidebar.session.row.trailing` if the two occupants cannot share it.
- [Poll latency] The indicator can lag a review start or settle by up to the interval → pause while
  hidden, fetch on the visibility edge, and replace polling with a push channel when one exists.
- [Dependency on #7] `waiting` and `orphaned` are only correct after the liveness change → the
  static card state has no such dependency and can land earlier; keep the liveness predicate in one
  place.
- [Cross-session visibility] The card reflects the workspace (a review another session started is
  visible), while the row indicator reflects only the owning session → document both and keep the
  route's entries limited to live sessions in the requested workspaces.
- [Batch route surface] The route accepts session ids → cap the list, reject non-GET methods, skip
  closed ids, and never accept a workspace path or return prompts, findings, diffs, or paths.
- [List latency] The current-digest check hashes the change artifacts on each list load → bounded by
  the number of active changes and skipped for archived rows.

## Migration Plan

- Source and UI change only; no data migration. Existing records, approvals, runs, and receipts stay
  valid, and the records format is unchanged.
- The panel's review field is additive; a host without the workflows plugin omits it, and a Client
  that does not know it renders the current card.
- Rollback is a version downgrade; no persisted state is rewritten.
- Release through the repository process (`pnpm release:prepare`, `pnpm build`, `pnpm gen`, the full
  gate, tag, push). The live desktop profile keeps its behavior until a release is installed.

## Test Plan

- `packages/plugin-workflows/test/review-status.test.ts`: current PASS, stale PASS (plan edit),
  findings/error, missing record, task counts and missing numbers, unreadable tasks, and a fresh
  clone with no local record.
- `packages/plugin-workflows/test/api.test.ts` (or the existing route test): live entries, the
  `sessions` batch, closed ids skipped, the 100-id cap, empty result, non-GET refusal, and no
  prompts/paths in the response.
- `packages/plugin-openspec/test/change-detail.test.ts` / `change-list.test.ts`: the additive
  `review` field decodes, a malformed or absent field is dropped without failing the list, and a
  summary failure omits the field.
- `packages/plugin-openspec/test/panel.test.ts`: live-state mapping, the review line states, and the
  polling stop on 404 and hidden tabs.
- Client verification in a throwaway `DSH_HOME` with the Nuphus browser: the row indicator appears
  while a review is live and disappears on settle; the card line updates without a manual refresh.
- Gate: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm build` with no uncommitted
  generated diff.
