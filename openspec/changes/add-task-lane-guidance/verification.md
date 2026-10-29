# Verification

Implementation commit: `592d98d feat(openspec): add portable task-lane guidance`.

Verified on Windows with Node 24 and pnpm 11.28.5 against that committed content:

- `pnpm build` — exit 0; 15 workspace packages and one client bundle built.
- `pnpm check` — exit 0; typecheck, lint, and build passed, and Vitest ran 63 files with 880 tests
  passed. Lint reported only pre-existing warnings and infos.
- `pnpm validate:repo` — exit 0; 584 files scanned, 15 plugin packages, AGENTS.md 14097 bytes (budget
  16000), no problems.
- `pnpm validate:composition` — exit 0; the setup bundle composes on DSH 0.2.1-rc.3.
- `pnpm gen:check` — exit 0; 270 generated files match their sources.
- A fresh `pnpm build` followed by `git diff --exit-code` — exit 0 with an empty `git status
  --short`; the committed build and generated output match a fresh build.

The task-lane guidance lives at `packages/plugin-openspec/assets/guidance/task-lanes.md` and is
vendored at `packages/setup/node_modules/@dsh-setup/plugin-openspec/assets/guidance/task-lanes.md`.
The only local scratch was the gitignored `.dsh` delegation state.
