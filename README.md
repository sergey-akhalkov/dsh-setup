# dsh-setup

A portable, installable DeepSeek Harness setup. The repository is the source of truth for one
installable setup bundle, the individual plugin bundles it contains, the static plugin market index
that makes them discoverable from the Harness Web UI, and the one-command installer that reproduces
the setup on another machine.

- **Install or update:** run
  `irm https://raw.githubusercontent.com/sergey-akhalkov/dsh-setup/main/install.ps1 | iex` in an
  external PowerShell window (see [docs/install.md](docs/install.md)). It enables the shipped bundles
  the setup expects and installs or updates the setup bundle in one command; rerun it to update.
- **Add a plugin package:** see [docs/plugins.md](docs/plugins.md).
- **Understand the generated setup patch:** see [docs/setup-composition.md](docs/setup-composition.md).
- **Cut a release:** see [docs/releasing.md](docs/releasing.md).
- **Delegate tasks to another model:** see [docs/delegation-rules.md](docs/delegation-rules.md); the
  installed-Codex target is [docs/codex-subagent.md](docs/codex-subagent.md).

## Development

```sh
pnpm install
pnpm check        # type-check, lint, unit tests, build
pnpm dogfood      # Windows: verify install.ps1 against a copy of this machine's profile
```

Committing is part of the workflow: the setup patch, `lib/` output, and `client.js` bundles are
generated and committed so that bundles install from git without an install-time build step. Run
`pnpm gen` after changing a composition fragment and `pnpm build` after changing TypeScript
sources; CI rejects a commit whose generated files do not match their sources.

## Security

Installing a bundle runs its code with the permissions of the Harness process. Market entries pin
an exact git commit so the reviewed source and the running code are the same revision. The installer
closes DeepSeek Harness while it writes the profile, saves a manifest backup, and changes only the
bundle selection and installed packages — never the profile's own patch. This repository contains no
credentials, sessions, or machine-specific paths.
