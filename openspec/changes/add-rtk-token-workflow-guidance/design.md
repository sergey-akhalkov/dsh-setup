# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- DSH `0.2.1-rc.3` exposes tool policy but not tool-argument rewriting. `tools/pre-execute` can only
  allow, deny, cancel, or ask; its contract explicitly excludes input rewriting because arguments are
  already logged and presented. `tools/execute` wrappers may replace only `exec.signal`, and
  `tools/post-execute` can replace a result only after the command ran. `ctx.shell` is a single
  implementation per context, not an interception point.
- The setup already ships two first-party guidance shapes: `@dsh-setup/plugin-working-principles`
  (always-on contract plus on-demand skills) and `@dsh-setup/plugin-rust` (on-demand domain skill).
  `session-guidance` owns their behavior; `packaged-skills` owns pinned third-party prompt content.
- RTK is installed on the owner machine and already used outside DSH. The installed CLI reports
  0.42.4; `rtk gain` reports 9,145 commands and 23.7M tokens saved at 32% average. The exact version
  is not a dependency: the skill defers to `rtk --version` and the checked date.
- The previous ruleset change deliberately did not ship RTK because DSH had no integration point for
  it. This change adds the integration the Harness does support: agent guidance.

## Goals / Non-Goals

**Goals:**

- Make every session in a profile with the row active aware of the rtk workflow by default, without
  loading a skill first.
- Keep the always-on rule small and enforceable by a budget (`300` estimated tokens), while the
  command table, fallbacks, and safety notes stay in an on-demand `rtk` skill.
- Preserve DSH's execution and audit model: no shell patch, no tool-argument rewrite, no result
  filtering, no rtk child process from plugin code.
- Keep the plugin standalone, offline, installable through the normal bundle path, and safe when rtk
  is absent.

**Non-Goals:**

- Installing, vendoring, pinning, or auto-updating rtk.
- A transparent post-execute output filter or a shell-command adapter; both are rejected below.
- A Client UI, a settings page, or a token dashboard inside DSH.
- Shipping the source repository's `token-efficient-workflow`, `tokenomics`, or other RTK-adjacent
  skills.
- Replacing the `read`, `grep`, or `glob` tools with rtk counterparts.

## Decisions

### D1 — Two tiers: always-on binding rule, on-demand procedure

The always-on section carries only the binding rule and the suspension phrase. The skill body carries
the supported-command groups, the fallback, the raw-output recovery route, and the security
boundary. This follows the tiering already used by the working contract: an always-on rule the model
cannot forget, plus a body it loads when it needs the details.

The alternative — skill only — is rejected because the owner requires the route to be active without
a load, and a skill with no trigger is easy to skip before the first bulky command. The alternative —
put the full command table in the always-on section — is rejected because it would multiply the
per-step cost for details that are needed only on some steps.

- Section name: `dsh-setup:rtk`.
- Section order: `120`, after the packaged lazy-dev ruleset (`100`) and the working contract (`110`),
  before the first-party plan policy (`500`).
- Configuration: `alwaysOn?: boolean`, default on, only an explicit `false` removes the section. The
  skill stays cataloged and loadable.
- Suspension phrase: `stop rtk routing`. It names only this rule; the other always-on sections keep
  their own phrases and are not suspended by it.
- No runtime footer is appended: the asset is the exact registered text, so the budget test measures
  what the prompt receives.

### D2 — Always-on text (draft, measured by the budget test)

The implementation writes this to `assets/rtk/rules.md`. The final text may be edited, but it must
keep the categories, the fallback, the file-tool boundary, and the suspension phrase, and stay within
the budget.

```markdown
# RTK shell output

Bulky shell output is a large token sink. When a `pwsh` command's output may be large — git
status/diff/log, test suites, build or lint logs, or a repo-wide search — run the supported command
through the installed `rtk` CLI instead of the native form (for example `rtk git diff`,
`rtk cargo test`, or `rtk rg "pattern" src`). Load the `rtk` skill for the command list, the
unsupported-command fallback, and how to recover full output.

Keep using the `read`, `grep`, and `glob` tools for file inspection; do not route them through
`rtk`. If `rtk` is missing or a subcommand is unsupported, run the native command and keep its
errors. Never prefix PowerShell-only commands or double-prefix.

Say "stop rtk routing" to suspend this rule for the rest of the session; it does not suspend the
other always-on guidance.
```

At roughly 950 UTF-8 bytes this is about 240 estimated tokens, under the 300-token budget. The
documentation states the measured value from the budget test.

### D3 — Skill body

`assets/rtk/SKILL.md` starts with frontmatter whose `name` is `rtk` and whose folded `description`
matches the catalog description in the Host provider. The body covers:

- **What rtk is:** a local CLI proxy that runs the real command and prints a compact version of its
  output; exit codes and stderr remain meaningful.
- **Supported groups:** git inspection and changes; JavaScript/TypeScript tests (pnpm, npm, vitest,
  jest); Rust/Python/Go/.NET tests and builds; TypeScript, ESLint, Ruff, Prettier, and Mypy; search
  (`grep`, `rg`, `find`, `fd`); Docker, Kubernetes, AWS, and psql; file commands (`read`, `ls`,
  `tree`). The command table stays a bounded group list, not an exhaustive copy of `rtk --help`.
- **Rules:** one supported command per call; no PowerShell-only prefixes; no `read`/`grep`/`glob`
  prefixing; no double prefix; keep errors and non-zero exits; skip when rtk is missing.
- **Recovery:** `rtk proxy <command>` for raw output that is still tracked; never rerun a mutating
  command only to recover detail; do not use `rtk run` on Windows because it goes through `sh -c`.
- **Security:** do not run `rtk trust` or load project-local filters in a repository you do not
  trust; project-local filters are code.
- **Verification:** `rtk --version` is the version authority; `rtk gain --history` shows recent
  savings; the text records the date it was checked and does not assert a current version. Under a
  confined DSH sandbox rtk may be unable to write its statistics; filtering still works, so measure
  with the DSH token meter as well.

The skill body is tested for a reviewed size range and for the absence of a current-version claim. It
loads only on invocation.

### D4 — No runtime interception

| Option | Verdict | Why |
| --- | --- | --- |
| Always-on guidance + skill | **chosen** | Uses the supported extension points; full rtk behavior; audit stays true; no new failure path |
| Skill only | rejected | The owner requires the rule to be active by default; the catalog line alone does not catch the first bulky command |
| Post-execute output filter | deferred | Runs after the command, so it cannot use rtk's command-specific invocation; `git status` does not match the `git-status` pipe filter format; two-stream test commands need separate stdout/stderr handling; it adds a process per call and duplicates rtk's command-to-filter mapping |
| Shell-service patch | rejected | The executed command would differ from the logged `args.command`; replay, fork, and audit could not reconstruct the execution; it relies on a non-public method and breaks on upgrade |
| `rtk init --codex` per project | documented alternative | Writes `RTK.md` and an `AGENTS.md` reference; DSH reads `AGENTS.md`, so it works per project, but it is not portable through the setup profile and can be overwritten by newer rtk releases |

The post-execute filter is not part of this change. If adoption dogfood shows many supported
commands still bypass rtk, a follow-up change may add a narrow, opt-in filter for commands whose raw
output format is known to match a pipe filter; it must not replace the direct rtk route.

### D5 — External runtime contract

- rtk is user-installed (scoop, winget, Homebrew, or the project's installer). The plugin ships no
  binary, no installer, no postinstall step, and no rtk package dependency.
- The profile must compose and start when rtk is absent. The always-on rule says so, and the skill
  says to skip the workflow and run the native command.
- The plugin does not spawn rtk. The model runs the CLI through the ordinary `pwsh` tool; the tool's
  sandbox, approvals, timeout, and output handling remain unchanged.
- The documentation names the install routes, the checked date, and the rtk project as the source of
  the command contract. It does not claim pinned, vendored, or verbatim upstream content; the guidance
  is authored for this setup.
- `rtk trust` on an untrusted repository is forbidden by the skill. rtk's telemetry is off by
  default; the plugin neither enables it nor sends anything.
- Windows note: `rtk run` goes through `sh -c`; use `rtk proxy` for a raw rerun. The routine route is
  the direct `rtk <command>` form.

### D6 — Package mechanics

| Item | Decision |
| --- | --- |
| Package | `packages/plugin-rtk`, name `@dsh-setup/plugin-rtk`, version equal to the set |
| Shape | Host-only bundle; `main`/`types`/`lib`; no Client half; no `dsh.client` |
| Host module | Exports `name`, `inject = ['skills', 'systemPrompt']`, `apply(ctx, config)`; registers one skill provider and, unless `alwaysOn === false`, one prompt section |
| Provider | `dsh-setup-rtk`; one `rtk` candidate; `rank: 600` (bundled); `source: 'bundled'`; body read from `assets/rtk/SKILL.md` |
| Assets | `assets/rtk/rules.md` (always-on text), `assets/rtk/SKILL.md` (body); both listed in `files` and vendored by `pnpm gen` |
| Manifest | `dsh.bundle.patch`, exact `engines.dsh`, `@deepseek-ai/cordis` peer, `dsh-skill` and `dsh-system-prompt` dev dependencies pinned to `0.2.1-rc.3` |
| Fragment | One row, `dsh-setup-rtk`; no foreign adapter name, no second row |
| TypeScript | `tsconfig.json` extends the base, composite, `rootDir: src/host`, `outDir: lib`; root `tsconfig.json` reference |
| Metadata | `locale/en.json` names the bundle, the rtk prerequisite, and the `alwaysOn: false` opt-out; original `icon.svg` |
| Tests | Provider/candidate/frontmatter/body/opt-out/no-network test; budget test; no-current-version test; no-interception review or static check |
| Generation | `pnpm gen` writes the package patch, setup patch/manifest, and vendored tree; `pnpm build` writes `lib/**`; both committed |
| Release | One set version bump; market card from `locale/en.json`; no `dsh.json` or installer change |

The provider returns `undefined` for a name it does not ship, matching the existing skill providers.
The plugin imports only Node builtins and type-only DSH packages at runtime; it is dependency-contained
and offline.

### D7 — Verification and measurement

- Package tests: identity/injection; one candidate with the expected rank and description matching
  the asset frontmatter; body loads on demand; unknown name returns `undefined`; `alwaysOn: false`
  removes only the section; the section name/order/text/suspension phrase; the budget; no slash
  command; no "current version" assertion; no network.
- Repository checks: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`; inspect the composed
  patch and vendored tree for exactly one new row.
- Live acceptance in a throwaway profile: the assembled prompt contains the RTK rule; the catalog
  lists `rtk`; the body is absent until invoked; a large `git diff`/`git log`/search runs through
  rtk; a failing test still shows its failure and exit code; `rtk gain --history` records the new
  commands; `alwaysOn: false` removes only the section; a PATH without rtk still boots and the
  guidance falls back.
- Measurement: compare `rtk gain` and the DSH token meter on two or three representative tasks
  (large diff, test suite, repo-wide search) before and after. Attribute only what the session log
  and `rtk gain` show; do not convert byte savings into a bill claim.
- Adoption: after the first dogfood sessions, inspect whether supported bulky commands used the rtk
  form. If the always-on rule is being ignored, the follow-up is a wording/section revision or the
  optional post-execute filter, not a broader always-on prompt.

### D8 — Two always-on contributions

The working contract and the RTK rule are independent contributions with independent opt-outs. Their
section order is `110` then `120`; disabling one leaves the other. The rtk phrase is `stop rtk
routing`, distinct from the working contract's and Ponytail's suspension wording, so a user can
suspend one route without suspending the others.

The prompt-cost documentation adds the RTK section to the existing table so the total per-step cost
is visible. The budget remains per contribution: 1500 estimated tokens for the working contract, 300
for the RTK rule.

## Risks / Trade-offs

- **Adoption may stay low.** The always-on rule and skill are the mitigation; measure `rtk gain` and
  the session log, and revise the wording or add the narrow post-execute filter only if the evidence
  shows a gap. → No silent success claim.
- **rtk filters can omit detail.** The skill names `rtk proxy` and tells the agent not to hide errors;
  the raw spill path remains available from the shell tool when its output was truncated. → The user
  can suspend the route for a session.
- **rtk version drift changes the command surface.** The guidance states the checked date and defers
  to `rtk --version`/`rtk --help`; the plugin does not pin a version. → Refresh the skill text when
  the installed CLI changes materially.
- **`rtk trust` on an untrusted repository is a security boundary.** The skill forbids it and treats
  project-local filters as code. → No trust command from the guidance.
- **A confined DSH sandbox may block rtk's statistics storage.** The filtering still works; the docs
  say to use the DSH token meter for the authoritative measurement. → Do not fail a session on a
  missing `rtk gain` entry.
- **Two always-on sections could conflict in suspension wording.** The distinct phrase and the
  two-bundle scenario in the spec cover it; section order is cosmetic. → Keep the phrases distinct.
- **The always-on rule is paid on every step.** The 300-token budget and the reviewed text bound it;
  the skill body is on demand. → Raise the budget only as a deliberate change.

## Migration Plan

1. Implement the package, tests, assets, docs, and root reference; run `pnpm install` if the dev
   dependency lock changes.
2. Run `pnpm gen` and `pnpm build`; commit the generated package patch, setup patch/manifest, vendored
   tree, and `lib/**`.
3. Run the repository gate and the live acceptance in a throwaway profile. Do not install into the
   live desktop profile from a shell hosted by the running Harness.
4. Bump the set version as a release step; publish through the market.
5. Rollback: set `alwaysOn: false` to remove only the section, or `disabled: true`/uninstall to remove
   the row and the skill. No data or profile state is migrated.

## Open Questions

- The exact adoption threshold for a follow-up (for example, the share of supported bulky commands
  that use rtk across the first dogfood sessions) is an evaluation decision, not a spec or design
  blocker. The measurement method is fixed in D7; the threshold can be set when the first results
  exist.
