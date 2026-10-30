# Proposal

## Why

Long explanations, comparisons, and architecture answers currently arrive as Markdown text. When the
result must be a readable, laid-out page, the only alternative today is to hand-write HTML, CSS, and
SVG coordinates, which is slow and token-expensive: in the upstream measurement, 47% of a
hand-written page's tokens are SVG coordinates, 15% CSS, and 17% tags, leaving 21% for content
([benchmark](https://github.com/QingYunA/answer-me-with-html/blob/main/bench/README.md)).

`answer-me-with-html` is a published skill plus a self-contained CLI: the model writes a short
Markdown draft and the CLI renders one offline HTML page (4,893 -> 612 tokens on the same nine
pages; 4.9x fewer output tokens, 2.6x faster in the lean run). It is not on npm, so the setup cannot
depend on a registry version, and its default behavior does not fit this repository: the skill says
to use it liberally, and the CLI writes pages into the user's home directory by default.

## What Changes

- Add a new skill-only bundle `@dsh-setup/plugin-answer-page` that vendors the upstream skill and CLI
  at an immutable pin (tag, commit, per-file size, SHA-256) and registers the skill through the DSH
  skill service with its asset directory as the base directory, so the CLI path resolves.
- Ship a short setup adapter on top of the vendored prompt: render only on an explicit request or for
  a genuinely complex explanation, never for a code answer or a delegated report; write the page
  into the workspace (`.tmp/answers/`), call `present` with the absolute path, and end the reply
  with the path link. No always-on mode.
- Ship the vendored MIT license and the upstream attribution in the package metadata and docs.
- Add an update script that refetches the pinned commit and regenerates the provenance lock, plus an
  offline provenance test that checks every vendored file's size and hash.
- Document the skill in `docs/plugins.md` and a dedicated `docs/answer-pages.md`.

## Capabilities

### New Capabilities

- `answer-pages`: the contract for turning an answer into a rendered page: when a page is allowed,
  where the file is written, how it is presented to the user, and what the adapter forbids.

### Modified Capabilities

- `packaged-skills`: packaged third-party content may now include an executable CLI script next to
  the prompt, the always-on ruleset is optional rather than default-on, and the vendored bytes must
  include the upstream runtime the skill invokes.

## Impact

- New package `packages/plugin-answer-page/` (manifest, fragment, vendored assets, provenance lock,
  host module, tests, locale, icon).
- `scripts/update-answer-page.ts` and a `package.json` script, following the Ponytail and OpenSpec
  update scripts.
- `scripts/lib/generate.ts` picks the package up automatically through the fragment; the generated
  `packages/setup/{package.json,cordis.patch.yml,node_modules/@dsh-setup/**}` must be regenerated.
- `docs/plugins.md`, `docs/answer-pages.md`, and the README plugin table.
- `scripts/lib/scan.ts`: a narrowly scoped machine-path exception for the lock-listed vendored files,
  because the pinned upstream prompt contains one Windows example path.
- No DSH API change: the skill service already supports a provider with a directory base, and
  `present` already accepts a workspace file.
