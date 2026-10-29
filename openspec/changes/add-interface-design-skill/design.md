# Design

## Context

See [proposal.md](proposal.md) for motivation. The change sits inside
`packages/plugin-working-principles`, which already ships one always-on working contract and three
on-demand skills (`working-principles`, `verify-change`, `instruction-budget`). The catalog
descriptions are hardcoded in the `SKILLS` array in `src/host/index.ts`; a test compares each one to
the skill's frontmatter and loads every body through the provider.

Two constraints shape the change:

- The always-on contract is 5,814 bytes against a reviewed maximum of 5,850 bytes
  (`test/budget.test.ts`), so there is no room to append a pointer line without a deliberate
  contract rewrite.
- The repository already has the patterns to point at: the client primitives and `--dsw-*` tokens
  in `packages/plugin-admin-indicator/src/client/index.tsx`, the one-command installer contract in
  `openspec/specs/portable-setup/spec.md`, and the skill packaging rules in
  `openspec/specs/session-guidance/spec.md`.
- The setup bundle vendors each plugin's publishable files into `packages/setup/node_modules` via
  `scripts/lib/generate.ts`, so a package file-list or asset change is incomplete until `pnpm gen`
  refreshes that copy.

The community scan found useful MIT/Apache-2.0 rubrics, but no reusable skill covers the whole
surface. `luongnv89/skills`' `dont-make-me-think` (MIT) is a UI review rubric that explicitly
excludes backend/API review and carries Claude-specific `/browse`/`asm` plumbing;
`markphelps/agent-plugins`' `cli-design` (MIT) covers CLI and errors and restates clig.dev;
`cli-guidelines/cli-guidelines` is CC-BY-SA, so its text cannot be copied into this MIT repository.
The DSH ecosystem has UI plugins and UI generators, but no skill for API, CLI, error, or agent-facing
interface design.

## Goals / Non-Goals

**Goals:**

- One on-demand skill that makes the first-time test and the house pattern available at the moment of
  design, across client UI, CLI or installer, API or signature, code, and agent-facing definitions.
- Content that points at this repository's concrete anchors, not a generic design essay.
- Adapted, attributed content with a recorded boundary; no vendored third-party skill.
- No new bundle, row, always-on section, dependency, or runtime.

**Non-Goals:**

- A new `@dsh-setup/plugin-interface-design` bundle, its row, market card, or always-on trigger.
- Changing the working contract text or its budget.
- Vendoring the community skills, their scripts, `/browse`, or `asm` plumbing.
- A screenshot harness, a design-review gate, or a delegation rule.
- Fixing the installer documentation's advanced one-liner form; that belongs to the installer change.

## Decisions

### D1. Home: the existing guidance bundle

The skill ships in `@dsh-setup/plugin-working-principles`. That bundle already owns the always-on
"Interface discipline" line and the on-demand skill mechanism, so the change adds one catalog entry
and its assets without a new row, market entry, or prompt budget.

Alternatives: a dedicated `plugin-interface-design` bundle (more boilerplate, its own row and
always-on budget; warranted only if the content grows a second skill or needs its own always-on
trigger); a docs page (not loadable by the model at design time).

### D2. Shape: one skill with references

One skill, one trigger, a body of roughly 150 lines, and reference files for UI, CLI/installer,
API/code, and agent-facing definitions, plus a source record. References load only when read.

Alternatives: separate per-surface skills (a catalog choice and more descriptions to maintain); one
long body (context cost on every load).

### D3. Content spine: the five-cost matrix

The body applies one cost model — recall, decision, prediction, interpretation, recovery — to every
surface, then gives each surface concrete rules. This keeps the skill from becoming a UI-only essay
and gives reviews a shared vocabulary.

Alternatives: Krug's ten lenses alone (UI-only); a flat list of heuristics (no cross-surface
structure).

### D4. Adapt, do not vendor

The useful community rubrics are adapted into first-party text: Krug's lenses for UI review, the
four-surface CLI model, and the interface copy rules. The source record names what was taken, what
was removed, and why. The community skills are not vendored: the UI skill excludes backend/API review
and carries Claude plumbing, the CLI skill restates clig.dev principles in its own words while the
clig.dev text itself is CC-BY-SA, and vendoring would add provenance pins, license files, and still
miss code/API/agent surfaces. Adaptation also satisfies the existing
`session-guidance` "Recorded adaptation of source content" requirement.

Alternatives: vendor `dont-make-me-think` and `cli-design` as separate packaged skills (two catalog
entries and license/provenance overhead for partial coverage).

### D5. No always-on change

The contract has 36 bytes of headroom against its reviewed maximum, and it already states the
principle ("Do not make the reader think"). The catalog description is the trigger; an always-on
pointer would require a deliberate contract rewrite, not an append. If evidence later shows the
description is not discovered, that rewrite is its own change.

Alternatives: append a pointer (breaks the reviewed 5,850-byte range); compress the contract now
(unnecessary scope).

### D6. Name: `interface-design`

The community UI skill already uses `dont-make-me-think` for a narrower, UI-only review. The broader
scope is signaled by `interface-design`; the description carries the phrase for triggering, and the
market card can show it. This avoids implying the book-title association belongs to this project.

### D7. Review output

The skill ends with a review format: Thinking Cost (high, moderate, low), severity (critical,
moderate, minor), and a one-line problem, impact, fix, and location per finding, adapted from the
community rubric. Principles without an output format are not actionable.

Alternatives: a prose review (not scannable); a score without a fix (not actionable).

### D8. Enforcement

The skill is guidance; the durable contract for a specific interface is a spec scenario, as the
administrator indicator already does. The skill directs the agent to add the scenario for a new
visual contract. The existing tests enforce the catalog description, offline loading, and the
contract budget; no new gate is added in this change.

Alternatives: a design-review gate (a new capability; defer until the same correction repeats).

## Risks / Trade-offs

- **Prompt-only enforcement** → the skill requires a spec scenario for each new visual contract; add
  a review gate only if the same correction repeats.
- **Discovery** → measure whether sessions load the skill; if the catalog description is not enough,
  compress the contract in a separate change rather than appending to it.
- **Overlap with Ponytail and the working contract** → the skill's "when to use" and body state the
  boundary: Ponytail cuts scope, this skill shapes the interface, and the contract keeps the
  always-on principle.
- **Reference drift** → the adapted text is first-party, sources are recorded, and runtime never
  fetches upstream.
- **Token cost** → on-demand only; the body is roughly 150 lines, references load on read, and the
  always-on cost is unchanged.
- **Generated vendor copy drift** → the serial tail runs `pnpm gen`, and the gate runs
  `pnpm gen:check`.

## Migration Plan

Add the assets, register the catalog entry, update the package file list and description, update the
provider test, rebuild `lib/**`, update the README row, then run `pnpm gen` and commit the regenerated
`packages/setup/**` vendor copy, then run `pnpm build`, `pnpm check`, `pnpm gen:check`, and
`pnpm validate:repo`. There is no data, profile, or runtime state to migrate; rollback is a revert of
the commit.
