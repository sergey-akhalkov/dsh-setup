# Proposal

## Why

Testing a plugin change today means a release plus a full relaunch of the Desktop app, because the live
profile installs a commit-pinned setup bundle and the app owns its profile. That is minutes per edit, and
the loop was already documented as three manual commands with two traps (`docs/plugins.md`, "Development
loop"): `dsh --profile dev --from-default-profile web`, a `link:` install, and `pnpm build:watch`. The
missing piece is verified mechanics: on DSH 0.2.2-rc.5 a rebuilt Client bundle reaches an open page in
about one second over `/plugins/events`, and a Host plugin is re-applied in the running Host in under a
second when HMR watches its `lib` directory (measured 2026-11-23; the default profile watch needs a patch
write and took 2.4 s). None of that requires a release, a desktop restart, or a new dependency.

## What Changes

- Add `pnpm dev`, an opt-in development-host command that prepares a `dev` profile and runs the existing
  build watcher together with the Web host it starts, so a saved file reaches a running page without a
  manual install, a patch write, or a process restart.
- Default mode links the setup bundle (`packages/setup`) so the loop exercises the full composition, and
  refreshes the vendored tree with `pnpm gen`; `--plugin <name>` links one workspace plugin instead, for
  narrow work on a single package.
- Write the `hmr` module-watch override into the `dev` profile's patch so a rebuilt Host module applies
  in place; keep the profile patch as the only place that override lives.
- Create the `dev` profile from the shipped `web` template when it is absent, reuse it otherwise, and
  recreate it only on explicit `--refresh`. The `desktop` profile is never read or written.
- Reconcile the reused profile on every start: remove the development selections the requested mode does
  not want and rewrite the module-watch entry the command owns, so switching modes or packages never
  leaves a stale or duplicate mount and unrelated profile configuration survives.
- Resolve the Harness CLI in the existing order — `DSH_CLI`, else an installed Harness command line, else
  `pnpm dlx @deepseek-ai/dsh@<runtime>` — and print the resolved line; an unresolvable CLI fails with a
  message naming the override and the installed command line.
- Stop both children on interrupt and on host exit while their roots are alive, and report a tree whose
  root already exited as unconfirmed instead of guessing at its descendants or targeting a port owner.
- Document the loop with its measured behavior, the two modes, and what does not hot reload.
- Do not change any plugin, the setup composition, the installer, or the release process; do not add a
  dependency; do not hot reload the Desktop window, which still needs a reopen for Client bundles.

## Capabilities

### New Capabilities

- `dev-loop`: the development host command, its setup and single-plugin modes, the `dev` profile contract
  and its isolation from `desktop`, the live-apply contract for both plugin halves, CLI resolution, and
  clean shutdown.

### Modified Capabilities

- None. Plugin, setup, installer, and release behavior are unchanged; this change adds contributor
  tooling only.

## Impact

- New `scripts/dev.ts`, its pure helpers under `scripts/lib/`, and `scripts/test/dev-loop.test.ts`; the
  root `package.json` gains a `dev` script.
- `docs/plugins.md` (Development loop) and `docs/contributing.md` (commands reference and the linked
  development-loop section) describe the command, the two modes, and the measured behavior.
- The Harness home gains a `dev` profile (created from the `web` template, linked package, `hmr` patch
  override). The live `desktop` profile, the generated setup tree in git, and every plugin package are
  untouched.
- No new dependency and no install-time side effect; `pnpm gen` runs only in the setup mode it already
  supports.
