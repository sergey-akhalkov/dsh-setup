---
name: rust
description: >
  Rust and Cargo work: use a newer standard-library feature only when the project's
  MSRV covers it, pick the narrowest check, test or clippy command for the job, and
  diagnose slow builds, slow tests and a growing target directory. Use for any Rust
  edit or review, and only then.
---

# Rust working rules

Use this for Rust code changes, reviews and build-cost problems. The project's documented or CI
gates still decide when work is done; these rules shorten the path to them and keep new code current
without weakening them. When the project documents no gates, say so and use plain Cargo commands
instead of inventing a sequence.

Rust and Cargo behavior decays. This material was assembled on 2026-10-26 from notes dated
2026-09-23; confirm anything version-sensitive with `rustc --version`, `cargo --version` and the
official documentation before committing it. A mapping that contradicts the installed toolchain is
worse than no mapping.

## Gate every feature on the project's MSRV

- Read the workspace `Cargo.toml` for `edition`, `rust-version` and member overrides, plus
  `rust-toolchain.toml` when present; check `rustc --version` when the installed toolchain decides
  the answer.
- Use a stable feature only when the project's MSRV covers it. When a newer feature would clearly
  remove code, an allocation or a dependency, propose an explicit MSRV bump as its own decision and
  offer the MSRV-compatible fallback meanwhile.
- Raise `rust-version` deliberately, never as a side effect: read the compatibility notes of every
  skipped minor, expect new warning and deny lints, and finish the bump with the project's
  warning-as-error check and native tests on the new toolchain. Adopt new APIs in code you touch; a
  repository-wide rewrite needs its own change and rationale.
- Edition 2024 code can use let chains in `if` and `while`, `unsafe extern` blocks and
  `#[unsafe(...)]` attributes, and a workspace on that edition sets `resolver = "3"`. Do not use
  `static mut`; use atomics, `OnceLock`/`LazyLock` or `UnsafeCell`. Write `Iter<'_, T>` when the
  inputs use an anonymous lifetime.
- Before adding a dependency or hand-rolling logic, check the modern standard-library form. See
  [std replacements](references/std-replacements.md); the mapping is not a promise that this
  toolchain has every item, so compile it in the real crate before relying on it.

## Choose the narrowest sufficient command

Match the command to the current question; do not run a fixed format/check/clippy/test sequence after
every edit.

- Does it compile? `cargo check -p CRATE` — no codegen, no link.
- Does one behavior hold? `cargo test -p CRATE FILTER` (or `--test NAME`, `--exact`); `--no-run`
  compiles tests without executing them.
- Lint or API risk the project gates on? `cargo clippy -p CRATE --all-targets -- -D warnings`.
- Do edits span members or a shared type? Widen `-p` to `--workspace` for that step.
- At the completion boundary? Run the project's full documented gates.

Keep `--locked` when a lockfile exists and use `--manifest-path PATH` outside the workspace root.
Package-scoped runs beat whole-workspace rebuilds; reserve broad runs for their required boundary.
Formatting belongs in the loop only where the project gates on it.

### Tests: serial targets, parallel functions

`cargo test` compiles each test target to its own executable and runs those executables serially,
while libtest runs the `#[test]` functions inside one binary on parallel threads. Plain `cargo test`
therefore does not serialize test functions: two tests in the same unit-test or integration binary
can race for one exclusive resource (service, port, database, fixture directory). Where tests share
such a resource, keep the project's verified locking, or scope serialization to the affected target:

```sh
cargo test -p CRATE FILTER -- --test-threads=1
```

Keep the parallel default everywhere else. Doctests run in their own processes under an execution
model Cargo does not guarantee, so a doctest that needs exclusivity needs explicit evidence too.

## Profiles: compact development, explicit full debugging

Use the official build-performance recipe with one addition for dependency backtraces:

```toml
[profile.dev]
debug = "line-tables-only"

[profile.dev.package."*"]
debug = false

[profile.debugging]
inherits = "dev"
debug = true

# A custom profile inherits the parent's wildcard, so re-enable dependency debug info explicitly.
[profile.debugging.package."*"]
debug = true
```

- `line-tables-only` keeps filename and line backtraces without variable or parameter info. Tests
  inherit `dev`, so they get compact info too.
- A custom profile inherits the parent's package overrides. `debugging` must re-enable dependency
  debug info as shown, or dependencies stay stripped and a debugger cannot show their variables.
- `--profile debugging` builds in its own directory (`target/debugging` by default), so it costs one
  full rebuild; use it deliberately for a debugger session, not in routine loops.
- `[profile.<name>.package."*"]` applies to dependencies that are not workspace members. A path
  dependency inside the workspace directory becomes a workspace member automatically unless it is
  excluded, so it keeps the member profile rather than the wildcard; registry dependencies and path
  dependencies outside the workspace take the wildcard.
- The recipe assumes a current toolchain. If the project pins an old `rust-version`, check that its
  Cargo accepts string-valued debug levels before committing it.
- Never weaken debug assertions, overflow checks or test coverage, and never add `strip`, for speed.

## Incremental reuse, caches and target directories

- Keep incremental compilation for local edit loops; dev and test enable it for workspace members and
  path dependencies. The `CI` environment variable makes Cargo default it off. For packaging or
  reproducible builds, pass `CARGO_INCREMENTAL=0` for that invocation instead of setting it ambient
  or committed; it drops incremental state and its disk growth without disabling ordinary
  unchanged-output reuse. The edit-loop cost is workload-specific, so measure before making it a
  default.
- sccache cannot cache incrementally compiled crates, so adopting it means turning incremental off —
  a real edit-loop trade-off — and it cannot cache crates that invoke the system linker (`bin`,
  `dylib`, `cdylib`, `proc-macro`), so thin wrappers cache better than large binaries. Its cache is a
  separate on-disk directory and counts toward the footprint.
- Target roots multiply: the default `target`, explicit `--target-dir`/`CARGO_TARGET_DIR`
  experiment roots, per-profile directories, one linked executable per test/bench/example target,
  and a relocated intermediate build directory when `build.build-dir` is configured. Locate each
  root before concluding what dominates.
- Cargo's global cache self-cleans and never removes target directories; target cleanup is explicit.
  Scope and preview it with `cargo clean -p CRATE --profile NAME --dry-run`. Retire only whole roots
  you own and have verified inactive, keep the active root warm, and never hand-delete fingerprint
  or incremental internals.
- Optional tools — sccache, nextest, alternative linkers — come only after a matched measurement
  shows the remaining bottleneck and the platform check passes. nextest runs each test in its own
  process and does not run doctests, so keep `cargo test --doc` in the gates; the official linker
  suggestions are Linux-specific and do not transfer to Windows. Details:
  [cargo workflows](references/cargo-workflows.md).

## Measure before claiming an improvement

Cold compilation, warm reuse, edit feedback and test execution are separate workloads with separate
bottlenecks. Measure them separately, before and after, with the same toolchain, features, profile
and target root. Compare wall or compiler time (`cargo build --timings`) and logical bytes under the
target roots you own. A scoped pair supports a scoped claim, never a universal number; keep raw
numbers in local project storage and commit only the conclusion the project needs. A suspected
regression deserves one cause-driven confirmation before changing defaults.

## Fix cost in the manifest where possible

- Keep versions in `[workspace.dependencies]` and use `dep = { workspace = true }`; keep lints in
  `[workspace.lints]` with `[lints] workspace = true`. This is maintenance hygiene, not a measured
  build-cost improvement.
- Use `cargo tree -d` for duplicate versions, `cargo tree -i CRATE` to see why a dependency is
  present, and `cargo add`/`cargo remove` to keep manifests tight. Use
  `cargo update --precise VER -p CRATE` for minimal, reviewable bumps.
- Treat unused dependencies and features as evidence to check, not as automatic removals; confirm
  the consumers still build before deleting.
- Verify experiments with an `examples/` target or a temporary filtered test in the real crate so the
  experiment keeps the same toolchain, features and dependencies; remove or promote it afterwards.
- Nightly-only options (unstable `-Z` flags, alternative codegen backends) stay out of stable
  projects.

## Portability

Use the target project's documented commands, toolchain and limits; do not require tools specific to
the environment you were invoked from. State the platform your observations came from, because
platform support governs optional tools. Keep changes scoped and reversible for the project that
adopted them, and never edit global configuration or impose concurrency or cleanup policy on other
checkouts.
