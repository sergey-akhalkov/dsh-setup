# Design

## Context

`huashu-design` 3.5.0 is installed from a commit-pinned git spec by the one-command installer, so its
files are the upstream files; the setup does not vendor or translate them. Its SKILL.md frontmatter
carries the catalog description, and that text, like the manual, is Chinese.

The skill registry merges provider candidates by name. Inside one layer, the lower rank wins before
provider registration order is considered. The filesystem provider ranks its roots as: project
`.dsh` 100, project agents 200, custom 300, user `.dsh` 400, user agents 500, bundled root 600.

## Decisions

### Adapter, not a translation

A translation would fork about fifty upstream files (the manual, 41 references, the script messages)
and would have to be redone at every pin bump. The adapter instead supplies only the two things the
user needs in English — the catalog line and the working language — and keeps the upstream manual as
the authority for the work. The model reads Chinese; the user never has to.

### Rank 550, between the user roots and the bundled root

The adapter must win against the upstream bundled candidate (600) and lose against a project or user
skill (500 and below), which is the precedence the packaged-skills requirement already promises for
local overrides. 550 is that gap. A test asserts the inequality rather than the number alone, so a
future rank change in the harness fails loudly instead of silently inverting precedence.

### The description is derived metadata, and it is documented as such

The English description mirrors the upstream frontmatter's scope and trigger words for the pinned
version. It is the adapter's own text, not vendored upstream content, so the repository's provenance
rules for vendored prompts do not apply; the upstream project, author, licensed version, and source
are named in the package metadata, locale, and documentation. A pin bump that changes the skill's
scope or triggers must update this text, which `design.md` and the docs state.

### Read the upstream at runtime, never ship its bytes

`createRequire(import.meta.url).resolve('huashu-design/package.json')` from the installed plugin
finds the profile-installed package with the profile's hoisted node linker. The candidate carries that
directory as its resource base, so the manual's relative `references/`, `assets/`, and `scripts/` paths
resolve, and the body is read on load, never copied. When the package is absent, `list` returns
nothing: no dead catalog entry, no error, and no fetch.

### English directive after the body, separated

The loaded body is the upstream manual with its YAML frontmatter removed — that frontmatter is the
Chinese description this adapter replaces — followed by a separate `---` block stating the language
rule. The setup's packaged-skills rules already allow adapter text appended when a skill is presented,
as long as the vendored bytes stay unchanged; here the bytes are the installed ones.

## Risks

- The upstream manual is Chinese, so a Chinese-language reply from the model is still possible; the
  directive states the rule, and the model's answer language follows the user's request.
- A pin bump that renames the skill (`huashu-design`) or changes its scope leaves the adapter's
  description stale or unmatched. The rank gap keeps the entry visible only while it matches a
  candidate name, and the description must be re-synced with the new upstream version.
- The adapter resolves the package once per catalog read; if the upstream is installed while the
  session runs, the entry appears on the next catalog refresh, which is the same restart the bundle
  installation already needs.
