# Ponytail

[Ponytail](https://github.com/DietrichGebert/ponytail) is a third-party prompt that makes an agent
behave like a "lazy senior dev": the smallest change that fully solves the task, no unrequested
abstractions, and a reply a busy human understands in one read. The upstream project is MIT
licensed, copyright (c) 2026 Dietrich Gebert.

The `@dsh-setup/plugin-ponytail` bundle packages that prompt for DeepSeek Harness. It is not a copy
of the upstream Claude Code plugin: only the two canonical prompt files are vendored, with no hooks,
no status bar, no slash commands, and none of the twenty agent adapters.

## What the plugin ships

Two contributions, both read from the vendored files pinned in `ponytail.lock.json`:

- **An always-on ruleset, enabled by default.** The compact upstream `AGENTS.md` is registered as an
  always-on system-prompt section, so sessions in a profile where the row is active follow Ponytail's
  rules without invoking anything. The section appends a short adapter footer that names the pinned
  upstream version and license, explains that levels are requested in words, and tells the agent that
  "stop ponytail" or "normal mode" suspends the rules for the rest of the session.
- **An on-demand skill.** The full upstream `SKILL.md` is listed in the agent skill catalog. Its body
  is loaded only when the model or the user invokes it, so the longer skill text costs nothing until
  it is used.

The plugin makes no network request at installation or at runtime, and it executes no upstream code:
it only reads the two vendored Markdown files and the license that ship inside the package.

## Prompt cost

The always-on section adds roughly 0.7 thousand tokens to the system prompt of every model step while
the row is active (the rules file is 2,721 bytes plus the footer). Turn it off if that trade is not
worth it; the on-demand skill remains available.

## Install

The plugin is part of the full setup bundle, so `install.ps1` or installing `@dsh-setup/setup` from
Discover enables it. To install only this plugin, use its own entry in the Discover tab, or install a
commit-pinned git specification with the application fully quit:

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/plugin-ponytail"
```

Use either the full setup or the individual plugin for this package, never both: installing both
mounts the same row twice.

## Turn off the always-on mode

Keep the on-demand skill but drop the system-prompt section by overriding the row in the profile's
`cordis.patch.yml`:

```yaml
- id: dsh-setup-ponytail
  config:
    alwaysOn: false
```

A patch replaces the whole `config` object for the row, so restate every option the row needs; this
row only has `alwaysOn`. Restart DeepSeek Harness after editing the profile patch.

## Remove the plugin

Disable the row in the profile patch:

```yaml
- id: dsh-setup-ponytail
  disabled: true
```

or uninstall the plugin bundle. Either removes both the ruleset and the skill; no other
configuration changes.

## Precedence and overrides

The skill name is `ponytail`. A project or user skill with the same name (for example a workspace
`.dsh/skills/ponytail/SKILL.md`) takes precedence over the packaged one, so a local copy overrides it
without uninstalling the plugin. The always-on ruleset is governed by the row configuration, not by
skill-name precedence.

## Attribution and updates

The vendored files are byte-identical to the upstream release at the pinned commit and are shipped
with the upstream MIT license. The plugin's market card names the upstream project and license; the
source is <https://github.com/DietrichGebert/ponytail>.

Updating the vendored prompt is a repository release step, not a runtime fetch: run
`pnpm ponytail:update --version X.Y.Z`, review the asset and lock diff, then follow
[docs/releasing.md](releasing.md). A newer plugin version arrives through the market like any other
bundle; older versions stay installable from their own entries.
