# Proposal

## Why

The shipped setup pins `@openai/codex` `0.169.0` and `reviewers.codex.model` `gpt-6-astra` at
`xhigh`. OpenAI released GPT-6.2 Astra and Sol on 2026-11-17, and Codex `0.170.0` shipped the same
day. The pin keeps the bundled reviewer on the previous model and misses the 0.170.0 Windows fixes;
the review instructions also predate the GPT-6.2 behavior that may stop and ask instead of returning
the required verdict.

## What Changes

- Bump the bundled `@openai/codex` dependency to `0.170.0` (not `0.169.1`, whose `win32-x64` package
  is unavailable), including the lockfile, the workspace release-age exclusion, `NOTICE`, locale,
  README, docs, the pinned-version test, and the live acceptance.
- Change the shipped `reviewers.codex` default model to `gpt-6.2-astra`; keep `reasoningEffort:
  xhigh` and keep `gpt-6.2-sol` available as a profile override.
- Add a `## Review posture` section to the three bundled review instructions: the reviewer decides,
  does not ask or wait, and finishes with the single JSON block; cover it in the assets test.
- Update the `codex-subagent` delta spec for the pinned CLI and the verified handshake; add the
  autonomy requirement to `workflows`.
- Regenerate the setup patch, setup `package.json`, and vendored tree with `pnpm gen`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-subagent`: the pinned bundled CLI version and the app-server handshake it is verified
  against move from `0.169.0` to `0.170.0`.
- `workflows`: the bundled review instructions require the reviewer to make reasonable assumptions
  and deliver the verdict instead of stopping to ask.

## Impact

- `packages/plugin-codex-subagent/**`: dependency, `NOTICE`, locale, package README, pinned-version
  test, live acceptance.
- `packages/plugin-workflows/assets/reviews/**` and `test/assets.test.ts`.
- `packages/setup/defaults.yml` and the generated `cordis.patch.yml`, setup `package.json`, and
  vendored tree.
- `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
- `README.md`, `docs/codex-subagent.md`, and the delta specs under
  `openspec/changes/update-codex-cli-and-reviewer-model/specs/`; the main specs are synced from those
  deltas at archive.

Not changed: `engines.dsh`, provider names, the row schema, install scripts, Ponytail or
working-principles (they instruct `deepseek-flash`), and Codex-owned API request mechanics.
