# Answer pages

[answer-me-with-html](https://github.com/QingYunA/answer-me-with-html) is a third-party skill plus a
single bundled Node CLI that turns a compact Markdown draft into one self-contained HTML page. The
model writes only the content; the CLI owns layout, diagrams, colours, and dark mode. Upstream reports
4,893 -> 612 output tokens on the same nine pages, because a page does not spend tokens on SVG
coordinates, CSS, or tags ([benchmark](https://github.com/QingYunA/answer-me-with-html/blob/main/bench/README.md)).

`@dsh-setup/plugin-answer-page` packages that skill and renderer for DeepSeek Harness. The upstream
project is MIT licensed, copyright (c) 2026 Answer me with HTML contributors, maintained by QingYunA.

## What the plugin ships

One contribution: the on-demand `answer-me-with-html` skill in the agent skill catalog. It has no
always-on system-prompt section, no tool, and no Client half, so a session that never uses it pays only
the catalog description.

The vendored files live in `packages/plugin-answer-page/assets/answer-me-with-html/` and are pinned in
`answer-page.lock.json`:

- `SKILL.md`, the upstream skill prompt, appended at runtime with a clearly separated DeepSeek Harness
  adapter note;
- `scripts/am.mjs`, the complete renderer (a single file, Node.js 20 or newer);
- `references/settings.md` and `references/video.md`, which the skill reads when the user changes
  settings or asks for a video;
- `licenses/OFL-Bangers.txt` for the bundled font, and `LICENSE`, the upstream MIT license.

The vendored skill directory is the skill's resource base, so the prompt's own `scripts/am.mjs` path
resolves to the packaged renderer. The plugin makes no network request and executes no code at
installation; the CLI runs only when the skill is invoked.

## When a page is produced

The upstream prompt invites liberal use. In this deployment the adapter note narrows that policy:

- produce a page when the user asks for one or for a visual explanation, or when the explanation is
  genuinely diagram-shaped (a flow, comparison, hierarchy, or state machine that a diagram carries);
- produce no page for a code answer, a delegated report, a one-line answer, small talk, or a request
  for plain text;
- there is no always-on mode, and a video is rendered only when the user explicitly asks for one.

The page is for a reply to the user. A delegated report returned to a parent agent stays text unless
the delegated task explicitly asks for a page.

## Where the page goes

Every render stays inside the session workspace:

- draft: `<workspace>/.tmp/answers/<slug>.md`;
- page: `<workspace>/.tmp/answers/<slug>.html`;
- CLI data directory: `AM_HOME=<workspace>/.tmp/answers/.am`;
- `AM_NO_UPDATE_CHECK=1`, `-o <workspace>/.tmp/answers/<slug>.html`, and `--no-open` on every call.

The draft is rendered by its file path, never through stdin. The CLI copies a stdin draft into its
data directory when the render has warnings; a draft passed as a file is never copied, so nothing can
land outside the workspace. `-o` writes the page in place, and the CLI's own state, themes, and caches
stay under `AM_HOME`. Rerendering after a fix reuses the same `-o` path; `--replace` applies only to
pages the CLI wrote into its own data directory.

After a successful render the agent calls `present` with the absolute page path and ends the reply
with a Markdown link to the same path, which opens the Document Preview panel. The reply itself stays
short and does not repeat the page content.

An invalid draft is reported with the offending line and a correct example; the agent edits the
workspace draft and retries, at most twice. If the render still fails, or Node.js is missing or older
than 20, the answer stays text and says that no page was produced.

## Offline guarantee

`AM_NO_UPDATE_CHECK=1` is required in this deployment. Without it the CLI may start a detached update
process that reads metadata from the upstream repository. With it, the CLI performs no upstream
request and starts no update process; the on-demand skill therefore works without network access and
never replaces its vendored content at runtime. The setting is per invocation, so the vendored
`update_check` preference is not used.

## Limits

- The page is a file, not an in-app route. The path link opens the Document Preview panel.
- `.tmp/answers/` is local scratch space: it is gitignored, may be cleaned, and pages are not
  promised to survive. There is no history or indexing.
- Images must be local files; remote images do not load in the page. The CLI refuses files outside the
  current folder for embedded source code.
- The renderer and the skill are upstream content. This repository pins them and narrows the usage
  policy in the adapter note; it does not reimplement the layout engine.
- The renderer reports the checks it performs, and fixing them can take a second render. The adapter
  caps those fixes at two and falls back to a text answer.

## Provenance and attribution

The vendored bytes are byte-identical to answer-me-with-html `0.5.10` at tag `v0.5.10`, commit
`f82dd6dce3ca95b0e565f8cffaf5eba23f4c995f`, and the upstream MIT license ships beside them. The
project, author, version, license, and source link are also named on the plugin's market card in
`locale/en.json`. The offline provenance test checks every file against the size and SHA-256 in
`answer-page.lock.json`, and a corrupted byte fails it.

One machine-path exception is deliberate. The upstream `SKILL.md` documents one Windows example path
for its path-link instruction; vendored bytes cannot be edited, and the repository scan rejects
machine paths in reviewed files. `scripts/lib/scan.ts` therefore skips only the machine-path check for
files listed in `answer-page.lock.json`, in the source package and in the generated setup copy. Secret
scanning still runs on those files, the lock still pins every byte, and a machine path in any file not
listed by the lock still fails `pnpm validate:repo`.

## Install, remove, and override

The plugin is part of the full setup bundle, so `install.ps1` or installing `@dsh-setup/setup` from
Discover enables it. To install only this plugin, use its own Discover entry or a commit-pinned git
specification with the application fully quit:

```sh
dsh plugin --profile desktop add "git+https://github.com/sergey-akhalkov/dsh-setup.git#<commit>&path:/packages/plugin-answer-page"
```

Use either the full setup or the individual plugin for this package, never both: installing both
mounts the same row twice. Disable the row in the profile's `cordis.patch.yml` to remove the skill:

```yaml
- id: dsh-setup-answer-page
  disabled: true
```

The skill name is `answer-me-with-html`. A project or user skill with the same name takes precedence
over the packaged one. The plugin has no configuration.

## Updates

Updating the vendored content is a repository release step, not a runtime fetch:

```sh
pnpm answer-page:update --version X.Y.Z --commit <40-hex commit>
```

Review the asset and lock diff, run `pnpm gen` and `pnpm build`, then follow
[docs/releasing.md](releasing.md). A newer plugin version arrives through the market like any other
bundle; older versions stay installable from their own entries.
