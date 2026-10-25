# Working principles

`@dsh-setup/plugin-working-principles` contributes the working contract this setup follows on top of
the Harness's own prompt and the packaged lazy-dev ruleset. Unlike [Ponytail](ponytail.md), the text
is not vendored from another project: it is authored and edited here, and the adaptations are recorded
instead of pinned.

## What the plugin ships

- **An always-on working contract, enabled by default.** The contract is registered as an always-on
  system-prompt section, so every session in a profile where the row is active follows it without
  invoking anything. The section appends a short footer that says how to suspend it for a session and
  how to turn it off for good.
- **Two on-demand skills.** `working-principles` carries the reasoning behind each rule, and
  `verify-change` carries the procedure for proving a change works. Both are listed in the catalog and
  cost nothing until invoked.

The plugin makes no network request at installation or at runtime and executes no code: it registers
one prompt section and one skill provider over the Markdown files that ship inside the package.

## Prompt cost

| Contribution                         | Size        | Cost per model step |
| ------------------------------------ | ----------- | ------------------- |
| Packaged lazy-dev ruleset (Ponytail) | 2,721 bytes | ~0.7k tokens        |
| This working contract                | 4,424 bytes | ~1.1k tokens        |
| **Both, active (this page)**         |             | **~1.8k tokens**    |

The setup also ships the [RTK token workflow](rtk.md) routing rule, which adds about 0.2k tokens per
step; with it active the combined cost is about 2.0k. The table above counts only the two contributions
this page owns.

The contract is a hard budget, not a preference: `packages/plugin-working-principles/test/budget.test.ts`
fails when the section exceeds 1500 estimated tokens, where a token is estimated as one quarter of the
UTF-8 byte count. Raise the budget only as a deliberate decision, because it is paid on every step of
every session.

The two skills cost only their catalog descriptions. `working-principles` is 5,875 bytes and
`verify-change` is 3,986 bytes, and both load only when invoked.

## Install

The plugin is part of the full setup bundle, so `install.ps1` or installing `@dsh-setup/setup` from
Discover enables it. To install only this plugin, use its own entry in the Discover tab, or install a
commit-pinned git specification with the application fully quit:

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/plugin-working-principles"
```

Use either the full setup or the individual plugin for this package, never both: installing both mounts
the same row twice.

## Turn off the always-on mode

Keep both skills but drop the system-prompt section by overriding the row in the profile's
`cordis.patch.yml`:

```yaml
- id: dsh-setup-working-principles
  config:
    alwaysOn: false
```

A patch replaces the whole `config` object for the row, so restate every option the row needs; this row
only has `alwaysOn`. Restart DeepSeek Harness after editing the profile patch.

## Remove the plugin

Disable the row in the profile patch:

```yaml
- id: dsh-setup-working-principles
  disabled: true
```

or uninstall the plugin bundle. Either removes the contract and both skills; no other configuration
changes.

## Precedence and overrides

The skill names are `working-principles` and `verify-change`. A project or user skill with the same name
(for example a workspace `.dsh/skills/verify-change/SKILL.md`) takes precedence over the packaged one.
The always-on contract is governed by the row configuration, not by skill-name precedence.

## Adaptation and what is deliberately not shipped

The contract is adapted from `global/principles-of-work.md` and the `.agents/skills/` directory of
<https://github.com/sergey-akhalkov/codex-harness>, which this setup's author also maintains. The source
is guidance for Codex, and roughly a third of it describes tools this Harness does not have, so the
text is edited rather than copied. Both repositories share one owner, so the reuse carries no upstream
license obligation and no provenance pin; the full cut list with a reason per section lives in
`openspec/changes/archive/2026-10-26-add-working-ruleset-plugins/design.md`.

Not shipped, and why:

| Source content                                                                                                                   | Why it is not here                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team-lead`, `board-workflow`, `self-improvement-loop`, `director-self-reflection`, `executor-self-reflection`, `executor-model` | They document executor tabs, a board, quotas and a dispatch transport. This Harness has teammates, shared tasks and `wait_agent` instead                        |
| `skill-evolution`, `skills-usage-analysis`                                                                                       | They wrap a skill-lifecycle service and an invocation ledger that do not exist here                                                                             |
| `harness-deploy`, `windows-disk-reclaim`, `serena-setup`                                                                         | Each wraps a command or helper crate of the source project; the prose without the mechanism is unsafe                                                           |
| `token-efficient-workflow` (five references), `tokenomics`                                                                       | Shell-output and tool-result rules for another runtime's output fitter and Code Mode; its bundled-session and busy-poll advice is already in the Harness prompt |
| `structured-codex-run`, `project-memory`                                                                                         | One wraps a source-run CLI; the other duplicates `session_search` and project `AGENTS.md`                                                                       |
| `global/roles/*`                                                                                                                 | Role personas for a fixed director/lead/executor hierarchy that this Harness does not use                                                                       |
| `cargo-fast` delivery receipts and benchmark numbers                                                                             | Another project's measurements presented as facts                                                                                                               |
| The source's Rust and PowerShell defaults                                                                                        | One owner's language policy, wrong for a TypeScript repository                                                                                                  |

The Rust guidance that did survive ships separately, in [rust.md](rust.md).
