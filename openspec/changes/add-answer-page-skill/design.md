# Design

## Context

Upstream `answer-me-with-html` is a skill plus a single bundled Node CLI (`scripts/am.mjs`, Node 20+)
that renders one self-contained HTML page from a compact Markdown draft. It is not published to npm;
the documented install is a GitHub bundle. Its default output directory is `~/.answer-me-with-html`,
its skill text invites liberal use, and its CLI performs a throttled background version check.

This repository already vendors third-party prompt content (Ponytail, OpenSpec) with an immutable
pin, a provenance lock, an offline provenance test, and an explicit update script. The DSH skill
service accepts a provider with a directory resource base, which is what the vendored skill needs to
resolve its own `scripts/` path. `present` accepts a workspace file and adds a deliverable card.

## Goals / Non-Goals

**Goals:**

- Ship the upstream skill and CLI offline, at an immutable pin, with attribution and a provenance
  test.
- Keep the page inside the workspace and surface it through `present` plus a path link.
- Narrow the usage policy to this repository: on request or for a genuinely complex explanation.

**Non-Goals:**

- Reimplementing the renderer, or replacing `am.mjs` with our own layout engine.
- An always-on page for every answer.
- A Client panel or an in-app browser route: the path link already opens the Document Preview panel.
- Upstream content edits: the vendored files stay byte-identical; our policy lives in adapter text.

## Decisions

### Vendor, not depend

There is no npm package, and a GitHub dependency would make installation network-bound and unpinned
against a branch. Vendoring follows the existing Ponytail/OpenSpec pattern: one git install delivers
the code, no runtime fetch, and the provenance test pins every byte. Cost: repository size and manual
updates through the update script.

### Skill-only bundle

The bundle registers a skill and nothing else: no tool, no Client half, no service. The model invokes
the skill and runs `node <asset-directory>/scripts/am.mjs`. This keeps the tool surface and the cached
prefix unchanged; the only per-step cost is the catalog description.

### Our own adapter text, vendored body untouched

The upstream SKILL.md says to use the skill liberally. We keep it byte-identical and append a short,
clearly separated adapter at presentation time (the mechanism `packaged-skills` already allows): render
only when asked or when the answer is diagram-shaped, never for code answers or delegated reports,
always write into the workspace, and never enable always-on. The catalog description is ours and
carries the same narrow bar, so the skill is not advertised as a default.

### Workspace output, a workspace data directory, and a file-based render

The adapter writes the draft to `<workspace>/.tmp/answers/<slug>.md` and renders that path, never
stdin: the CLI copies a stdin draft into its data directory when the render has warnings, and falls
back to a private system-temporary directory when the data directory is unwritable, so stdin cannot
guarantee that nothing lands outside the workspace. A draft passed as a file is never copied.

Every invocation passes `-o <workspace>/.tmp/answers/<slug>.html` and
`AM_HOME=<workspace>/.tmp/answers/.am`, so the page and the CLI's own state stay inside the
workspace and `present` receives a workspace path. The adapter also sets `AM_NO_UPDATE_CHECK=1`:
without it the CLI may start a detached update process that reads `package.json` from GitHub, which
breaks the offline guarantee that the skill is supposed to provide.

### A narrow scan exception for the pinned upstream example

The upstream `SKILL.md` documents a Windows example path, and `scripts/lib/scan.ts` rejects any
Windows drive or user-home path in reviewed files, including the vendored copy inside the setup
bundle. The vendored bytes cannot be edited (byte identity), so the scanner skips only the
machine-path check for files listed in the answer-page provenance lock, in both the source package
and the generated setup copy. Secret scanning still runs on those files, the lock still pins every
byte, and a test asserts that an arbitrary machine path outside the lock still fails validation.

Rejected alternatives: transforming the vendored file (breaks byte identity and provenance), and
loosening the global path patterns (weakens detection everywhere).

### Presentation

The adapter calls `present` with the absolute page path and ends the reply with a Markdown link to the
same path. In DSH a path link opens the Document Preview panel, which is the "page on the right"
behavior; no Client plugin is needed.

## Risks / Trade-offs

- The CLI bundle is large (Markdown parser, graph layout, math, font). → One vendored file per release,
  pinned by hash; it is not loaded unless the skill is used.
- Upstream drift and security. → The pin is a commit SHA; updates go through the update script and a
  release; no runtime self-update. The scanner exception is bounded by the same lock.
- A draft or page can escape the workspace through an upstream fallback. → The adapter renders a
  workspace draft file by path, pins `AM_HOME` inside the workspace, and a regression test covers an
  unwritable data directory.
- Node version mismatch. → The setup already requires Node 24; the adapter states the minimum and
  falls back to a text answer.
- A draft can still be wrong or noisy. → The CLI reports the offending line with a correct example;
  the adapter caps retries at two and falls back to text.
- Pages accumulate under `.tmp`. → The directory is ignored by git and the repository validation, and
  the adapter does not promise persistence.

## Migration Plan

New package, so no existing profile changes behavior until the setup is regenerated and installed.
Rollback is disabling or removing the `dsh-setup-answer-page` row, which removes the skill from the
catalog and leaves the rest of the setup untouched.

## Open Questions

Whether `present` renders an HTML preview inside the card or only offers the native open action. It
does not change the approach: the path link covers the case either way.
