# Design

## Context

Release A (`move-review-runtime-into-workflows`) moved the review executor, the queue, the snapshots,
and the retained `spec-review`, work-progress, and lane gates into `@dsh-setup/plugin-workflows`, copied
the bundled review instructions, and left the delegation row installed with its rules and target
configured under five false switches. The one-release coexistence window exists only to prove the
replacement in a live profile before the legacy code is deleted, which Release A's live confirmation
does.

The package still has four in-repo consumers besides its own tests: `scripts/reviews-check.ts` imports
the committed-approval format from `src/shared/approval.ts`; the workflows engine reads and writes the
legacy `.dsh/delegation/**` paths when a signal is enabled; the setup patch, manifest, and vendored tree
list the package and the row; and the observability signal map carries the `delegation-rules` row. The
delegation skill, the `docs/delegation-rules.md` page, the legacy review prompt copies, and the
`legacy`/`ownership` blocks in the shipped definitions and the contributed `change-intake` also exist
only for that plugin.

Release B is planned while Release A is still an active change, so two `MODIFIED` blocks
(`Review executor`'s `Approval producer` neighbor in `review-approval`, and `Owned work-progress gate`
in `workflows`) name requirements Release A adds. `openspec validate retire-delegation-rules --strict`
exits 0 and reports those two headers as informational "archive would refuse" notes until Release A is
archived; the apply task refreshes the delta against the accepted post-Release A text before applying.

## Goals

- Delete one plugin and one gate system; `workflows` is the only review and gate owner.
- Fold the surviving `delegation-rules` requirements into `workflows` and `review-approval` without
  changing a behavior, a prompt semantic, a record field, or an audit command.
- Keep the committed approvals and their audit byte-compatible, and keep local records readable.
- Leave no reference to the deleted row, skill, prompt copies, tools, or switches in the shipped
  defaults, docs, setup bundle, or accepted specs.

## Non-Goals

- No new review scope, definition, trigger, gate, prompt, or approval field.
- No migration or deletion of the local `.dsh/delegation/**` scratch; it stays on disk, unread.
- No change to the `workflows` engine's current ownership resolution beyond deleting the legacy source.
- No second rollback switch: after Release B there is no legacy runtime to restore on the same install.

## Decisions

**D1 — Delete the package instead of leaving it disabled.** A disabled plugin keeps 8,300 source lines,
13,700 test lines, its skill, its docs, its setup row, and two record parsers alive. Rejected: ship
`enabled: false` (the same maintenance cost with no behavior), keep only `shared/approval.ts` in place
(a plugin whose only remaining export is an approval parser, and a bundle that still installs it).

**D2 — Fold by capability, not by copy.** The 70 requirements split into 47 folded into `workflows` as
46 requirement blocks (the settlement signal and queue settlement share one block), 4 folded into
`review-approval`, 13 already expressed by surviving engine requirements, and 6 that are plugin
mechanics with no surviving behavior. The proposal lists the destination of every requirement, and each
removed requirement's `**Migration**` names its absorber. Folded text is the removed normative text with
only the naming changed (`delegate` rule -> definition, target -> reviewer); no clause is added. The 6
deletions (`Model-facing cost`, `Removal and opt-out`, `Setup delivery and standalone use`, `Parallel
writer isolation`, `Deprecated lane-boundary trigger`, `Gate-only retirement switch`) describe the
deleted plugin's own skill, row, bundle, or trigger vocabulary.

**D3 — Move the approval format module into `workflows`.** `scripts/reviews-check.ts` and the archive
audit must keep reading the same committed record after the plugin is gone. `src/shared/approval.ts`
moves byte-identically to `packages/plugin-workflows/src/shared/approval.ts`, and the script imports the
new path. The committed path, field set, ordering, and sanitization are unchanged; tests that pin the
format move with it. Rejected: duplicate the parser into the script (two format owners, the split this
migration exists to end).

**D4 — Remove the legacy fallbacks after the coexistence window.** The engine reads and writes
`.dsh/delegation/**` only while a legacy signal is enabled; with the plugin and switches gone, the
legacy path resolution in `evidence.ts`, `notes.ts`, `condition.ts`, `engine-gates.ts`, `adoption.ts`,
`api.ts`, and the client panel is dead, as are the `legacy`/`ownership` blocks in the shipped
definitions and the contributed intake. They are deleted, not left dormant. Existing local records are
not read, rewritten, or removed.

**D5 — Delete the setup row and bundle entry, do not hide it.** The row, the dependency, the
`bundleDependencies` entry, the vendored tree, and the `tsconfig.json` project reference go; `pnpm gen`
regenerates the patch and manifest, and `pnpm gen:check` proves no drift. Rejected: leaving the package
vendored but unselected (a shipped tarball with no row, and a setup bundle that still resolves code it
never mounts).

**D6 — Remove the Release A scaffolding from the accepted specs.** `Gate-only switches` and
`Per-signal legacy ownership` describe configuration that no longer exists and are removed; the
legacy-owner clauses are deleted from the requirements that mention them. `Migration completion` is
updated to its completed form, and `Installed definitions` declares `own` without switch resolution.
The generic `Legacy gate composition` and `Ownership retirement` requirements stay: they are engine
mechanisms for any future installed legacy source, not delegation-specific.

**D7 — Rollback is not a switch after Release B; it is a version downgrade.** Release A's per-signal
flips are the rollback path only before Release B ships. Release B deletes the switches, so a profile on
Release B has no flip: rolling back means installing the last Release A release, which restores the
plugin, its row, its switches, and its rules. Committed approvals and local `.dsh/delegation/**` records
survive because Release B never rewrites them, and the approval format is unchanged. The owner accepts
this one-way boundary when the live confirmation is recorded, as `Migration completion` requires.

**D8 — Two-release ordering.** This change applies only after `move-review-runtime-into-workflows` is
archived and its live profile confirmation exists. The parent proposal and design link this change and
name the order; the Release B apply starts by refreshing the two `MODIFIED` blocks against the accepted
post-Release A text and re-running strict validation, then deletes the package. Rejected: creating the
Release B change earlier with full text (it would duplicate Release A's requirements) or applying both
releases at once (it would delete code before the live proof `Migration completion` requires).

## Risks / Trade-offs

- **A foreign profile still configures `rules`, `targets`, or `delegation.gates`** -> plugin load fails
  with the removed row named; release notes carry the migration to `reviewers` and definitions. This is
  the declared breaking change and is acceptable because the shipped profile never relied on a local
  delegation rule.
- **An unlisted importer of the package internals** -> only `src/shared/approval.ts` is imported outside
  the package today; the move and the grep in task 1.1 catch a stale import, and the full gate blocks a
  merge if one remains.
- **A section or queue edge case loses its spec home** -> the fold keeps one requirement per removed
  behavior and the parity report keeps its hashes; a missed case fails the strict archive audit of the
  specs, not only review.
- **The `.dsh/delegation/**` scratch grows unread** -> it is local, untracked, and never parsed again;
  deleting it is the user's choice and is out of scope.
- **The observability dashboards expect the `delegation-rules` signal row** -> the setup defaults and
  the signal map drop it in the same change, and the workflows review signals replace it; the
  observability tests pin the new row list.
- **The two Release A `MODIFIED` blocks** -> validate reports them as informational until Release A is
  archived; the apply task refreshes them first, so the applied delta always targets the accepted text.

## Migration Plan

1. Start only after Release A is archived and its live confirmation is recorded; archive Release A,
   sync its deltas, and re-run `openspec validate retire-delegation-rules --strict`.
2. Move `shared/approval.ts` into `workflows`, update the import, and run the review-audit tests before
   deleting anything else, so the approval boundary is proven first.
3. Delete the legacy engine fallbacks, the `legacy`/`ownership` blocks, and the package directory;
   update the root build references and lockfile.
4. Remove the setup row, dependency, bundle entry, and vendored tree; run `pnpm build` then `pnpm gen`,
   and commit the regenerated setup files.
5. Delete the docs page and skill, update the remaining docs and `AGENTS.md`, and remove the
   observability row.
6. Sync the specs: delete `openspec/specs/delegation-rules/spec.md`, apply the folded requirements, and
   drop the coexistence requirements.
7. Run `pnpm build && git diff --exit-code`, `pnpm check`, `pnpm validate:repo`,
   `pnpm validate:composition`, `pnpm validate:installer`, and `node scripts/workflows-parity.ts
   --check`; then install in a throwaway profile and confirm no delegation row, skill, or tool exists
   while one native review still produces its record and committed approval.

## Open Questions

None. The one-way rollback boundary is an owner decision recorded in D7, and the apply ordering is the
parent change's Release B contract.
