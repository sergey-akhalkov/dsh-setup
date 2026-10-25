# Cargo workflow cookbook

This file expands the diagnosis procedure summarized in the skill body. Commands are shell-neutral;
replace `CRATE`, `PATH`, `NAME` and `FILTER` with the project's real values. The project's documented
or CI commands remain the completion gates.

Version-sensitive behavior here was assembled on 2026-10-26 from notes dated 2026-09-23; confirm it
with `rustc --version`, `cargo --version` and `cargo build -v`, and prefer what the installed
toolchain actually does.

## 1. Workloads and a matched baseline

```sh
# effective target root after configuration and environment (read target_directory)
cargo metadata --format-version 1 --no-deps

# cold build: fresh target root, timing report under <target>/cargo-timings/
cargo build -p CRATE --locked --timings

# warm reuse: rerun with no source change
cargo build -p CRATE --locked

# edit feedback: restore one small representative edit, then the narrowest command
cargo check -p CRATE --locked

# test execution: the project's own selected test command
cargo test -p CRATE FILTER --locked
```

- A fresh target root means a new `--target-dir` value or a target root that has never been used for
  this toolchain; the first build in it is the cold number.
- Report logical file length. Allocated size can differ under compression or sparse files, so compare
  like with like.
- One cold pair plus a few warm observations is a scoped measurement; say so instead of implying a
  population claim.
- When the intermediate build directory is relocated, measure it separately and add it to the total
  (section 5); with the default layout it is already inside the target directory.

## 2. Effective configuration: profiles, target dirs, toolchain, features

- The authoritative stable check is a verbose build: `cargo build -v -p CRATE` (or `cargo check -v`)
  prints each rustc invocation with the applied `-C debuginfo=...`, `-C incremental=...`, crate name
  and `--out-dir`. What appears there is what actually runs; when the intermediate build directory
  is relocated, its intermediate paths point there rather than into the target directory.
- Read configuration files instead of guessing: Cargo searches `.cargo/config.toml` from the
  invocation directory upward, then `$CARGO_HOME/config.toml`; environment variables
  (`CARGO_TARGET_DIR`, `CARGO_BUILD_TARGET_DIR`, `CARGO_BUILD_JOBS`, `CARGO_INCREMENTAL`,
  `RUSTFLAGS`) override files. Discovery depends on the invocation directory, so run from the
  workspace root for reproducible flags.
- Effective target root: `cargo metadata --format-version 1 --no-deps` reports `target_directory`
  after configuration and environment resolution.
- Toolchain identity: `rustc -vV` and `rustup show`. A different toolchain or target triple is a
  different build with separate fingerprints and often a separate directory; match the arms before
  comparing.
- Features: `cargo tree -e features` and `cargo tree -i CRATE` show which edges activate what.
  `--all-features` and `--no-default-features` change both time and artifact size. Compare arms with
  identical feature selection, and do not change resolver or edition settings as part of cost work:
  it invalidates comparisons and can change feature unification.

## 3. Debug information and the debugging profile

- Debug levels: `false`/`0`/`"none"`; `"line-tables-only"` for filename and line backtraces without
  variables or parameters; `"line-directives-only"` for specific targets; `1`/`"limited"`;
  `2`/`true`/`"full"` (the dev default).
- Wildcard scoping: `[profile.<name>.package."*"]` applies to dependencies that are not workspace
  members. A path dependency inside the workspace directory becomes a workspace member
  automatically unless excluded; it keeps the member profile, not the wildcard. Registry
  dependencies and path dependencies outside the workspace take the wildcard.
- Inheritance: custom profiles inherit the parent's package overrides. With the standard dev recipe
  (`debug = "line-tables-only"` for members, `debug = false` for dependencies), `--profile debugging`
  keeps dependencies stripped unless the debugging profile re-enables them; that is why the recipe
  adds `[profile.debugging.package."*"] debug = true`.
- Tests inherit `dev`; benches inherit `release`. `--profile debugging` output lives in
  `target/debugging` and needs a full rebuild the first time; use it deliberately when a debugger
  session needs variables and full dependency info.
- Build scripts and proc macros use `build-override` defaults (opt-level 0, debug off when
  possible); leave them alone unless you are debugging the build itself.
- Keep the dev profile honest: do not add `strip` or disable debug assertions or overflow checks for
  a quick win; backtraces, tests and runtime behavior must stay correct.
- The recipe assumes a current toolchain; if the project pins an old `rust-version`, check that its
  Cargo accepts string-valued debug levels before committing it.

## 4. Incremental local reuse versus disposable builds

- dev and test enable incremental compilation for workspace members and path dependencies by
  default; search for `-C incremental=` in verbose output to confirm.
- When the `CI` environment variable is set, Cargo defaults incremental off (absent other
  configuration). For packaging or cache experiments, pass `CARGO_INCREMENTAL=0` (or profile
  `incremental = false`) for that build: it drops incremental state and its disk growth and does not
  disable Cargo's ordinary unchanged-output reuse. The cost is workload-specific, so pass it
  explicitly per invocation rather than as an ambient environment variable or committed config, and
  measure before making it a default.
- Compiler caches: sccache cannot cache incrementally compiled crates, so adopting it means turning
  incremental off — a real trade-off between local edit reuse and cache sharing, decided per project.
- Incremental state lives under the build directory (`<build-dir>/<profile>/incremental`; the target
  root by default) and grows with edit churn; remove it by retiring the whole root or a scoped
  `cargo clean`, never by deleting inside it.

## 5. Target directories: inventory, footprint and safe retirement

- Enumerate the roots in play: the effective `target_directory`, known
  `--target-dir`/`CARGO_TARGET_DIR` experiment roots, per-worktree roots, and the intermediate build
  directory. The build directory defaults to the target directory, but Cargo can relocate it
  (`build.build-dir` configuration or `CARGO_BUILD_BUILD_DIR`). Confirm with a verbose build rather
  than assuming: the intermediate `--out-dir` in that output shows where intermediates go.
  Relocation is not exposed as a `cargo metadata` field; `target_directory` stays the
  final-artifact root. Final artifacts (binaries, `cargo doc` output, `--timings` reports) stay in
  the target directory, while intermediates (`deps/` rlibs, `incremental/`, `build/`, fingerprints)
  go to the build directory. Count each location once.
- What typically dominates on Windows MSVC debug trees: PDB files next to every test or binary
  artifact, incremental state, and the count of separately linked test/bench/example executables;
  variant roots duplicate all of it. Count executables and measure by subdirectory before acting.
- Retirement checklist for one root: resolve every path the configuration puts in play (target
  directory and any relocated build directory; `cargo clean` covers the build directory only while
  the same environment and configuration that located it are in effect); confirm ownership (your
  checkout or worktree, not another's) and inactivity (no running cargo/rustc/test process, no
  unfinished work that will reuse it); record size and shape per location; then preview with
  `cargo clean --target-dir PATH --dry-run` and retire exactly those paths, keeping the roots
  serving the current worktree.
- Scoped cleanups when full retirement is too blunt: `cargo clean -p CRATE`, `--profile NAME`,
  `--target TRIPLE`, `--doc`, `--release`. `cargo clean` never touches the global cache.
- Concurrency: builds sharing one target directory contend and serialize; parallel checkouts are
  better isolated by separate `--target-dir` roots than by one ambient `CARGO_TARGET_DIR`. On
  Windows, a running test executable can lock outputs, so stop it or build into a dedicated root.
- Two separate lifecycles: the global cache (`CARGO_HOME`) self-cleans with Cargo's automatic
  garbage collection (`cache.auto-clean-frequency`, skipped in offline or frozen mode) and never
  removes target outputs; target roots are removed only by explicit `cargo clean` or an owner-bound
  retirement. When reporting total footprint, include any sccache cache directory too.
- Retire caches at worktree retirement or demonstrated disk pressure, not before every build; no
  background cleaner is required.

## 6. Test scheduling and shared resources

`cargo test` schedules at two levels, and only the target level is serial by default:

- Targets: each compiled test target is its own executable (one unit-test binary per crate target,
  one per file under `tests/`, plus bench and example targets when selected), and Cargo runs those
  executables serially.
- Functions: inside one executable, libtest runs the `#[test]` functions on multiple threads in
  parallel by default; the thread count comes from `--test-threads` or `RUST_TEST_THREADS`.

A plain `cargo test` run therefore does not serialize test functions: two tests in the same unit-test
or integration binary can race for one exclusive resource. Wherever tests share a service, port,
database or fixture directory, establish one of:

- `cargo test -p CRATE FILTER --locked -- --test-threads=1` (or `RUST_TEST_THREADS=1`) serializes the
  functions of the libtest binaries the run selects — scope it to the target or filter that needs
  exclusivity instead of making it the project's running mode.
- The project's own verified locking or synchronization of the resource, with evidence that every
  access path uses it.
- An equivalent scoped scheduling control with evidence; for nextest, a test group with
  `max-threads = 1` (section 7).

Keep the parallel default and doctests everywhere no shared resource requires otherwise. Doctests
are their own case: rustdoc builds doctest executables that run in parallel in separate processes,
and Cargo documents that execution model as not guaranteed, so a doctest that needs exclusivity
needs the same explicit evidence rather than an assumption.

## 7. Optional tools: decide from measurement, then check compatibility

Adopt any of these only when the workloads in section 1 show the remaining bottleneck (link time,
repeated dependency recompiles, test orchestration), the project accepts the tool, and required
coverage is unchanged. None of them fix missing basic profile and selection hygiene.

### sccache (compiler cache)

- Configure as a compiler wrapper: `build.rustc-wrapper = "sccache"` in `.cargo/config.toml`
  (environment equivalents: `RUSTC_WRAPPER`, `CARGO_BUILD_RUSTC_WRAPPER`). Prebuilt binaries exist
  for Windows, Linux and macOS.
- Cache gaps: incrementally compiled crates cannot be cached, so turn incremental off, and crates
  that invoke the system linker cannot be cached: `bin`, `dylib`, `cdylib`, `proc-macro`. Large
  binary crates and proc-macro-heavy graphs see less benefit; a thin `bin` wrapper over a `lib`
  changes what can be cached.
- Its on-disk cache is separate from Cargo's (`SCCACHE_DIR`) and counts toward total footprint.
- Verify on the target platform, and make the check exercise real cache reuse: an unchanged re-run
  in the same target can be Cargo-fresh and never invoke rustc or sccache at all. Instead compile
  the same workload into a second owned fresh artifact root (for example a fresh `--target-dir`)
  with the same sccache cache retained, or after explicitly retiring an owned target; compare
  `sccache --show-stats` and wall time against the same run with a cold cache, count the cache's
  disk footprint, and keep Cargo no-op reuse out of the comparison.

### nextest (test runner)

- External runner; it executes each test in its own process, which adds isolation and enables
  retries (`--retries`, `.config/nextest.toml`) but increases process spawns — measure execution
  time, especially on Windows where process creation is relatively expensive.
- Scheduling is nextest's own, not libtest's: `-j`/`--test-threads N` on `cargo nextest run` sets
  how many tests run simultaneously (default: number of CPUs), and only a small set of libtest
  arguments is emulated after `--`, so a Cargo/libtest `-- --test-threads=1` is not the control
  here. For tests that share an exclusive resource, keep the project's verified locking or assign
  exactly those tests to a test group with `max-threads = 1` (or the needed limit); tests outside
  the group keep global concurrency.
- `cargo nextest run` accepts the usual cargo test options (package and target selection); keep the
  project's selectors, ignored or platform conditions and required gates equivalent.
- nextest does not run doctests: keep `cargo test --doc` as a separate, required step in the
  project's gates.
- Consider it when a large suite's execution time or retry and isolation behavior dominates; it does
  not reduce compilation.

### Alternative linkers

- The official build-performance guide suggests LLD, mold or wild (with Linux configuration
  examples for mold) and notes the default linker is often fast enough that switching may not pay
  off.
- Platform-gate hard: Linux recipes (`-fuse-ld=mold`, clang driver shims) do not transfer to Windows.
  There, check what the installed toolchain actually offers (for example a shipped `rust-lld`, or an
  LLVM `lld-link`), that every crate and build script still links, and that the override is scoped
  and reversible in `.cargo/config.toml` under the correct target.
- Measure matched link-heavy rebuilds before and after; link time is part of build wall time, and
  `--timings` shows where units spend time.

## 8. Dependency and manifest hygiene

- `cargo tree -d` lists duplicate versions; `cargo tree -i CRATE` shows why a dependency is present;
  `cargo add` and `cargo remove` keep manifests tight; `cargo update --precise VER -p CRATE` makes
  minimal, reviewable bumps.
- Centralize versions in `[workspace.dependencies]` with `dep = { workspace = true }`, and lints in
  `[workspace.lints]` with `[lints] workspace = true`. This is maintenance hygiene, not a measured
  build-cost improvement.
- Unused dependencies and features are evidence to check, not automatic removals; confirm the
  consumers still build before deleting.
- For quick experiments, an `examples/` target or a temporary filtered test inside the real crate
  keeps the same toolchain, features and dependencies; remove or promote it afterwards.
- Nightly-only options (unstable `-Z` flags, alternative codegen backends) stay out of stable
  projects.

## 9. Portability

- Use the target project's documented commands, toolchain and limits; do not require tools specific
  to the environment you were invoked from, and keep raw measurements in local project storage.
- State the platform your observations came from; platform support governs optional tools (linkers,
  process behavior).
- Keep changes scoped and reversible for the project that adopted them; never edit global
  configuration or impose concurrency or cleanup policy on other checkouts.

## Further reading

- Build performance guide: https://doc.rust-lang.org/cargo/guide/build-performance.html
- Profiles reference: https://doc.rust-lang.org/cargo/reference/profiles.html
- Cargo configuration: https://doc.rust-lang.org/cargo/reference/config.html
- Build cache, target directory versus build directory:
  https://doc.rust-lang.org/cargo/reference/build-cache.html
- `cargo test`: https://doc.rust-lang.org/cargo/commands/cargo-test.html
- Rust test harness: https://doc.rust-lang.org/rustc/tests/index.html
- Rustdoc documentation tests:
  https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html
