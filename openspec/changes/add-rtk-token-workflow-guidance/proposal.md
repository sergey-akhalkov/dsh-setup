# Proposal

## Why

Shell output is one of the largest controllable context costs in a coding session, and the RTK CLI is
already installed and proven on this machine: its own `rtk gain` reports 9,145 commands, 23.7M tokens
saved, and 32% average reduction. DSH `0.2.1-rc.3` has no pre-tool command-rewrite hook, so the previous
ruleset change deliberately left RTK out instead of building an adapter around a missing extension
point. The owner now wants the shell workflow available to every session by default, and the bounded
always-on guidance shape plus one on-demand skill is the smallest way to deliver it without changing
how DSH executes tools.

## What Changes

- Add `@dsh-setup/plugin-rtk`: a Host-only bundle that registers a short always-on routing rule and one
  on-demand `rtk` skill. The always-on rule binds the model to run supported bulk-output shell commands
  through the user-installed rtk CLI, keeps the `read`, `grep`, and `glob` tools for file inspection,
  and names the fallback when rtk is absent or a command has no rtk equivalent.
- The plugin is guidance only. It does not patch the shell service, rewrite tool arguments, install or
  vendor rtk, spawn rtk from plugin code, post-process tool results, or ship a Client half.
- Generalize `session-guidance`'s always-on and prompt-budget requirements from one guidance bundle to
  any bundle that declares an always-on contribution, and add the RTK token-workflow requirement with
  its own 300-token always-on budget, external-runtime contract, suspension phrase, version-freshness
  rule, and standalone-install rule.
- Add the package assets, Host provider, unit tests, documentation, market metadata, root TypeScript
  reference, generated setup/vendored output, and a set version bump. The setup bundle delivers the
  plugin; `dsh.json` and `install.ps1` do not change.

Out of scope: installing rtk, pinning an rtk version, a post-execute output filter, a shell-command
adapter, a Client UI, and per-project `rtk init --codex` automation.

## Capabilities

### New Capabilities

None. The change extends the existing `session-guidance` capability; RTK guidance is first-party
guidance like the working contract, not pinned third-party prompt content.

### Modified Capabilities

- `session-guidance`: the always-on contribution and bounded-prompt-cost requirements become
  per-bundle, and a new requirement defines the RTK token-workflow guidance bundle, its external rtk
  prerequisite, and the explicit no-interception boundary.

`packaged-skills` is not modified: the RTK text is authored for this setup, not vendored or pinned
from upstream.

## Impact

- New package `packages/plugin-rtk`: `package.json`, `cordis.fragment.yml` with row id
  `dsh-setup-rtk`, `src/host/index.ts`, `assets/rtk/rules.md`, `assets/rtk/SKILL.md`,
  `locale/en.json`, `icon.svg`, `tsconfig.json`, and host/budget tests.
- Root `tsconfig.json` gains the project reference. `pnpm gen` rewrites the package patch, the setup
  patch/manifest, and the vendored setup tree; `pnpm build` adds `lib/**`.
- `docs/rtk.md` documents the prerequisite, the always-on size, the `alwaysOn: false` override,
  suspension, measurement, limits, and security boundaries. The market card names the external
  prerequisite and the checked date.
- No `dsh.json`, `install.ps1`, Client bundle, runtime dependency, network request, or secret change.
- Permanent prompt cost: the always-on rule is budgeted at 300 estimated tokens per model step
  (`UTF-8 bytes / 4`); the skill body is paid only when invoked. The documentation states the measured
  sizes.
- Risks: model adoption is the main uncertainty; rtk filters can omit detail the model needs; rtk
  version drift changes the command surface; `rtk trust` on an untrusted repository is a security
  boundary; a confined DSH sandbox may block rtk's statistics storage while filtering still works.
