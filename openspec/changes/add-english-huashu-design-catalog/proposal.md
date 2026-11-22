# Proposal

## Why

The installer pins the third-party `huashu-design` bundle, whose skill is Chinese-only: the
description in its SKILL.md frontmatter is the catalog line, and its trigger words are Chinese. A
user who does not read Chinese sees an unreadable entry in the skills list, and an English or Russian
request does not route to the skill at all, because the routing description carries no matching
words. A full translation would fork roughly fifty upstream files and would have to be redone on
every pin bump.

## What Changes

- Add `@dsh-setup/plugin-huashu-design`, a Host-only bundle that registers the `huashu-design` skill
  name with an English description and English trigger words, and loads the installed upstream body
  unchanged plus a clearly separated English directive: talk to the user in their own language, and
  write the deliverable's own copy in English by default.
- Rank that entry between a project or user skill and the filesystem provider's bundled root, so a
  local copy of the skill still wins and the upstream Chinese catalog entry is shadowed.
- Ship no upstream bytes and no network access: resolve the installed upstream package from the
  profile at runtime, and list nothing while it is absent.
- Document the adapter and name the upstream project, license, and pinned version.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `packaged-skills`: an English catalog adapter over a pinned third-party skill, placed inside the
  existing precedence boundary between a local skill and the bundled root.

## Impact

- New package `packages/plugin-huashu-design` with one Host module and its test.
- The generated setup patch and setup manifest gain its row; the vendored setup tree carries it.
- Root `README.md` plugin row and a `docs/install.md` paragraph.
- No change to the upstream pin, the one-command installer, or the owner defaults.
