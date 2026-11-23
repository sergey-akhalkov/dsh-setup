# Design

## Context

See `proposal.md` for motivation and `specs/dev-loop/spec.md` for the behavior contract. The current
loop is documented in [docs/plugins.md](../../../docs/plugins.md) and
[docs/contributing.md](../../../docs/contributing.md) as three manual commands; this design replaces
them with one command.

Constraints and measured facts that shape the approach (spike on 2026-11-23, DSH 0.2.2-rc.5, a `dev`
profile booted from the shipped `web` template, `packages/plugin-admin-indicator` linked):

- The base bundle mounts HMR with `disabled: !!js "!ctx.get('profileContext')"` and `config.root: []`
  (`dsh-base/cordis.patch.yml`): profile configuration is watched by default, module sources are not.
  Config watches use `awaitWriteFinish` (2 s stability); module roots debounce 100 ms.
- A recomposition replaces plugins whose loaded files under a linked target changed on disk, without a
  process restart. Live verification on 2026-11-23 with the installed Desktop CLI (0.2.2-rc.5): a Client
  edit produced the `rebuilt` frame after 0.23 s; a Host edit applied in place after 3.67 s through a
  profile-patch write with one boot banner; the configured `hmr` module-watch root did not deliver that
  change, and the Host printed no diagnostic when the rebuilt module threw at import; the next
  recomposition after the repair re-imported the plugin after 3.84 s.
- The Web composition mounts `@deepseek-ai/dsh-client-hmr`, which stat-polls each Client bundle and
  serves `rebuilt` frames on `/plugins/events`. Measured: rewriting `lib/client.js` produced the frame
  with a new revision after 0.97 s. Electron windows do not use that transport; the Desktop app reloads
  Client bundles only on reopen.
- `packages/setup` is outside the pnpm workspace on purpose; `pnpm gen` copies each plugin's publishable
  files into the tracked `packages/setup/node_modules` tree. A linked setup bundle therefore loads the
  vendored copies, not the workspace packages.
- The repository runs its scripts as plain TypeScript on Node 24 with `.ts` import specifiers, and
  `scripts/dogfood.ts` already resolves the Harness CLI as `DSH_CLI` (path or command line) → the
  installed Desktop CLI at `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd`
  → a wrapped `pnpm dlx @deepseek-ai/dsh@<runtime>` command line.
- The resolved Harness can be newer than the repository's pinned runtime: `dsh.json` names
  `0.2.2-rc.2`, the installed Desktop CLI on the owner's machine reports `0.2.2-rc.5`, and the shared
  resolver prefers the installed command line. The command therefore prints the line it runs.
- `dsh plugin --profile <name> remove <package>` drops both the dependency and the selection
  ([docs/install.md](../../../docs/install.md)), so reconciling a reused development profile needs the
  CLI's own command rather than hand-edited manifests.
- A failed plugin replacement is reported by HMR and the plugin stays inactive; the host keeps running,
  so the command's forwarded output carries the diagnostic and a later successful rebuild recovers.
- The repository already documents the Windows tree-kill limit in
  `packages/plugin-openspec/src/host/change-list.ts`: `taskkill /T` needs the shell shim alive, a detached
  descendant that outlives it is reported as unconfirmed rather than killed, and a stale pid is never
  taskkilled because Windows reuses it.

## Goals / Non-Goals

**Goals:**

- One command from "source is saved" to "the running page reflects it", with no release, no install
  step, and no Desktop relaunch.
- Exercise the full setup composition by default, and one plugin in isolation on request.
- A reused development profile always matches the requested mode, with no stale or duplicate mounts.
- Never write the `desktop` profile, never embed a machine path in the repository, never leave behind a
  tree it can still identify, and never claim a shutdown it cannot confirm.
- Keep the command honest: a Host change that could not apply in place, or a plugin that failed to
  activate, is reported rather than silently served from stale code.

**Non-Goals:**

- Hot reload of the Desktop window or of the `desktop` profile.
- A release/install substitute: installing into the live profile stays the installer's job.
- Auto-detecting or downloading a Harness CLI beyond the existing convention.
- A persistent daemon, a second build system, or a debugger/attach integration.
- Reproducing Desktop-only rows (native pickers, browser tab, primary-runtime Python) on the Web host.

## Decisions

### D1. One command script, with the planning kept pure

Add `scripts/dev.ts` as the runner and `scripts/lib/dev-loop.ts` for the pure decisions it makes: mode
resolution, the `link:` spec, the profile paths, the reconciliation plan, the patch text, the install
argument list, and the CLI command line. Tests cover the pure helpers directly and the runner through a
fake CLI (D8).

Alternatives: a documentation-only rewrite (leaves three commands, a profile-creation step, and a
machine-specific CLI on the reader); a plugin with a UI button (installing a plugin into a profile to
develop the plugins that profile runs is circular, and the live profile must stay under the app's
control); a shell script (the repository's automation is TypeScript on Node 24 and must also run on the
CI operating system).

### D2. Two modes, setup by default

`pnpm dev` links `packages/setup` and refreshes the vendored tree; `pnpm dev --plugin <name>` links one
workspace plugin package. The setup is the shipped product, so the default loop must compose the rows
the owner's profile actually runs; single-plugin mode is the narrow, faster path for iterating on one
package.

Alternatives: setup only (the ~19 vendored plugins make every cycle pay a `pnpm gen` and a host
restart); single plugin only (the composition under test is not the one shipped, and integration
between setup plugins is invisible).

### D3. A dedicated `dev` profile, created from the shipped template and reconciled on every start

The command uses profile `dev` under the Harness home the environment selects (`$DSH_HOME`, else the
user's default). It creates the profile from the `web` template only when it is absent, or on
`--refresh`; otherwise it reuses it.

Reuse is reconciled, not merely added to. Before starting, the command removes every development
selection it manages that the requested mode does not want — the setup bundle or any workspace plugin
package recorded as a dependency — through the CLI's own `plugin --profile dev remove`, which drops both
the dependency and the selection. It also rewrites the one patch entry it owns, `id: hmr`, and preserves
every other patch entry verbatim. The patch edit is source-preserving rather than a YAML round trip: a
parse/stringify pass would turn Harness `!!js` expressions in unrelated entries into plain strings, so
only the owned entry's lines are appended, replaced, or removed. Switching setup → plugin, plugin →
setup, or one plugin → another therefore leaves exactly one development selection and no duplicate
mounts, and unrelated entries keep their tags.

The requested package is installed with `plugin --profile dev add link:<dir>` (measured 0.36 s,
idempotent), so pnpm keeps the manifest and lockfile consistent. The `desktop` profile is never read or
written, and the command refuses to target it.

Alternatives: adding without removing (the reuse path accumulates the previous mode's bundle selection
and mounts a plugin twice, which the repository already documents as a conflict); recreating the profile
on every start (discards the module-watch entry and any contributor tweak); writing `package.json` and
the patch by hand (bypasses pnpm and the lockfile, and duplicates the CLI's own logic).

### D4. Every Host rebuild writes a profile recomposition trigger

Single-plugin mode still writes the `hmr` module-watch entry into the `dev` profile's patch, but live
verification showed the installed Desktop CLI did not deliver those module events, so the runner does not
depend on them. After every Host-classified rebuild it appends a comment line to the profile patch — a
real write that makes HMR recompose and replace the changed linked module in place. Measured: 3.67 s
after the edit with one boot banner, and 3.84 s for the recovery after a deliberately broken build. The
restart remains the fallback when that write fails. The patch entry and the trigger line live in the
profile, never in a tracked file, so the repository carries no machine path (validated by `validate:repo`).

Alternatives: rely on the module-watch root alone (it did not fire under the installed carrier);
restart the host on every Host edit (sessions die); watch the whole checkout (reload storms from
`tsbuildinfo` and unrelated writes).

### D5. Setup mode runs the vendored step and restarts rather than promising an unverified path

The linked setup loads `packages/setup/node_modules`, so a plugin rebuild reaches it only after
`pnpm gen`. The command runs one `pnpm gen` before the host boots, so a previously built change is not
served stale, then recursively polls every build artifact under `packages/*/lib` (a bounded, portable
poll), debounces, and runs `pnpm gen` again. A changed Client bundle needs no Host action: the Client
half still swaps over `/plugins/events`. A changed Host entry runs the same profile-patch trigger as
plugin mode, so the recomposition replaces the vendored copy in place; the restart remains the fallback
when the vendored copy does not come through, and the verification task records which one applied.

Why not rely on HMR replacing the vendored copies at a recomposition: the package reference documents
replacement for "linked package targets", but whether the comparison descends into a linked target's own
`node_modules` is unverified, and a silent stale Host half is exactly the failure the spec forbids.
Restarting is deterministic, costs seconds, and keeps the loop free of a release and a Desktop relaunch.
The verification task in `tasks.md` records the observed recomposition behavior so the documentation
states what happens; dropping the restart is a follow-up change once the in-place path is proven.

Alternatives: write the profile patch after every `gen` and hope the recomposition replaces the vendored
modules (unverified, and a failure is invisible); link each vendored plugin (duplicate rows with the
setup bundle's patch, and the generated tree is tracked).

### D6. One CLI resolution, extracted from the dogfood check

Move `resolveDshCli` from `scripts/dogfood.ts` into `scripts/lib/cli.ts` with an injectable environment
and use it from both places. The order is fixed and printed before the host starts:

1. `DSH_CLI`, used verbatim when it holds a non-empty value (an existing executable path, or a command
   line wrapped into a `.cmd`/`.sh` shim); an empty or whitespace-only value counts as unset.
2. A locally installed Harness command line when one is found.
3. `pnpm dlx @deepseek-ai/dsh@<runtime from dsh.json>` in the wrapped form.

Printing matters: the installed CLI can be newer than the repository's pinned runtime, so the command
prints the resolved line and the version that command reports before starting, and the operator needs to
know which Harness the loop runs. A failure to run the resolved command stops the command before any
profile change, and the message names `DSH_CLI` and the installed command line.

Alternatives: duplicate the resolution in the dev script (two behaviors drift); require a global `dsh`
(new machine prerequisite for a repository that already auto-detects the Desktop install); force the
pinned runtime even when the installed Harness is newer (contradicts the shared convention and can
install packages that only the newer runtime resolves).

### D7. Verified ownership only: kill live trees, report an exited root as unconfirmed

The runner spawns the existing `pnpm build:watch` and the resolved host command line through a shell,
records each child's pid and handle at spawn, forwards their output, and keeps the host's URL line. The
host is started with `--no-open` so a restart does not open another browser tab; the URL is printed
instead.

Cleanup acts only on identities the runner established at launch:

- **While the root is alive** the runner owns the handle and the observed exit state, so it terminates
  the tree: on Windows `taskkill /pid <pid> /T /F`, on POSIX a signal to the process group. The tree walk
  is valid only while the root exists; a root whose exit was observed is never taskkilled, because
  Windows reuses pids and the repository already states that rule in
  `plugin-openspec/src/host/change-list.ts`.
- **When a root exited before cleanup** its descendants are no longer reachable through any identity the
  runner holds, so the command reports that tree as **unconfirmed**, names the root it owned, and exits
  non-zero. It does not try to discover or kill the descendants.

The security invariant: a kill target is only ever a pid the runner spawned and whose exit it has not
observed. Port occupancy proves neither ownership nor identity — after the owned host releases the port,
any other process can bind it — so the runner never resolves a kill target by port, image name, or
command line, and a foreign listener is left untouched.

Alternatives: resolving the process that holds the released page port (rejected: a foreign process can
hold it, so the kill could hit an unrelated application — a security defect, not a heuristic); a Windows
job object (the only complete containment, but Node cannot create one without a native addon and the
repository takes no dependency for this; it is the recorded upgrade path if the unconfirmed case ever
matters); a supervisor process (the runner already is one, and ancestry still breaks when an intermediate
exits); matching command lines (can terminate another run of the same profile); a `dev:stop` companion
command (the runner already holds the pids; a second command would need a pidfile and add a stale-state
failure mode).

### D8. Testing without a Harness installation

Pure helpers are unit-tested, including the CLI resolution order and the reconciliation plan. The runner
is tested against a fake CLI: a generated Node script that prints a URL line, spawns a grandchild, writes
a stop file, and exits on request, plus a fake workspace package on disk. The test asserts the profile
directory and patch content the runner prepares in setup mode, plugin mode, and on a mode switch without
`--refresh`, the printed resolved CLI line and URL, no `pnpm gen` run in plugin mode, the exit status on
interrupt and on host failure, and three cleanup cases: a live tree with a grandchild is terminated and
the grandchild is gone; a host that exits on its own makes the command report that tree as unconfirmed
and exit non-zero while the orphaned grandchild survives; and a foreign process that binds the recorded
page port is never terminated. No DSH download and no real profile is involved, so the test runs in CI.

A fake cannot prove plugin activation failure. The live verification covers that lifecycle in plugin
mode: a deliberately broken import leaves the host and the watcher running while the plugin stays
inactive, the host prints no diagnostic of its own, and the next recomposition after the repair starts
the plugin again (measured 3.84 s). The spec records that diagnostic as Host-owned, so the command only
forwards what the Host prints. The real loop is also verified in a throwaway `DSH_HOME` on this machine,
including the measured timings.

### D9. Documentation replaces the manual recipes

Rewrite the "Development loop" section of [docs/plugins.md](../../../docs/plugins.md) and the linked
section of [docs/contributing.md](../../../docs/contributing.md): the two modes, what reloads live and
what restarts, the measured timings, the `desktop` boundary, the CLI resolution order and the version it
prints, and the cleanup of a `dev` profile. Add a `pnpm dev` row to the commands reference. No root
`README.md` row (contributor tooling, not a shipped plugin) and no `AGENTS.md` change (its 16,000-byte
budget buys nothing here; the contributing page is linked from it).

## Risks / Trade-offs

- **Setup mode restarts the Host on a Host edit** → sessions in that host end; the command prints the
  restart and the URL, and the Client half still swaps without a reload. The docs state it plainly.
- **Two hosts share one Harness home** (dev host and Desktop app) → sessions, credentials, and storage
  are shared; concurrent writes were not stress-tested. `DSH_HOME` can isolate the dev loop, and the
  docs name the trade-off.
- **A Client swap drops the plugin's React state** (shipped behavior: fresh fiber, fresh components) →
  the docs say so; the rest of the page state survives.
- **The vendored Client bundle may not be stat-polled in setup mode** (unverified) → the Client half may
  need the host restart too; the verification task records the observed behavior and the docs match it.
- **The resolved Harness can be newer or older than `dsh.json`** → the installed CLI wins by convention;
  the command prints the resolved line, and a profile that needs the pinned runtime sets `DSH_CLI`.
- **Reconciliation edits the profile on every start** → the `hmr` entry and the managed selection are
  command-owned; any unrelated patch entry survives verbatim, and `--refresh` restores the template.
- **An unresolvable CLI on a machine without the Desktop app and a broken registry** → the error names
  both remedies before any profile write.
- **The Host does not print a failed replacement** → the plugin stays inactive until the next successful
  rebuild, and the spec records that diagnostic as Host-owned rather than promising command output.
- **Port changes on a host restart** → the command prints the URL after every boot and restart.
- **A Windows tree whose root exited before cleanup cannot be walked** → reported as unconfirmed with the
  owned root pid, never guessed at, matching the repository's existing shortcut convention; a job object
  is the upgrade path but needs a native addon the repository does not take.
- **A moved checkout leaves a stale link in the dev profile** → `--refresh` recreates it; the command
  fails with the link target it cannot read instead of starting a broken host.

## Migration Plan

New command only; no existing behavior changes. Rollback: remove `scripts/dev.ts`, its helpers and
tests, the `dev` script row, and the documentation sections. A leftover `dev` profile is harmless and
can be deleted; the `desktop` profile is untouched by construction.

## Open Questions

None.
