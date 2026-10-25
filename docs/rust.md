# Rust

The `@dsh-setup/plugin-rust` bundle packages one on-demand skill for Rust work: MSRV-gated use of
newer standard-library APIs, the narrowest sufficient `cargo check`, `test` or `clippy` command, and
diagnosis of slow builds, slow tests and a growing target directory. It is first-party guidance for
DeepSeek Harness rather than a vendored third-party prompt.

## What the plugin ships

One skill, `rust`, listed in the agent skill catalog. Its body covers the language and the Cargo side
in one place, so a session sees one catalog line instead of choosing between two skills for the same
edit. Two references ship beside it and are read only when the body points at them:
`cargo-workflows.md`, the full diagnosis cookbook, and `std-replacements.md`, the mapping from
hand-written patterns to newer standard-library APIs.

The bundle contributes nothing else: no always-on system-prompt text, no tool, and no client or
background behavior; its Host module only publishes the skill. Nothing changes in a session until
the skill is invoked.

## Prompt cost

The catalog lists only the skill name and description. The body and both references load on demand,
so the bundle costs nothing per model step beyond that one catalog line. There is no always-on text
to turn off.

## Install

The plugin is part of the full setup bundle, so `install.ps1` or installing `@dsh-setup/setup` from
Discover enables it. To install only this plugin, use its entry in the Discover tab, or install a
commit-pinned git specification with the application fully quit:

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/plugin-rust"
```

Use either the full setup or this plugin, never both: installing both mounts the same bundle twice.

## Precedence and overrides

The skill name is `rust`. A project or user skill with the same name (for example a workspace
`.dsh/skills/rust/SKILL.md`) takes precedence over the packaged one, so a local copy overrides it
without uninstalling the plugin.

## Remove the plugin

Disable the bundle's row in the profile's `cordis.patch.yml` or uninstall the plugin bundle. Either
removes the skill; no other configuration changes.
