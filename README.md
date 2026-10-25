# dsh-setup

A portable, installable DeepSeek Harness setup. The repository is the source of truth for one
installable setup bundle, the individual plugin bundles it contains, and the static plugin market
index that makes them discoverable from the Harness Web UI.

- **Install:** see [docs/install.md](docs/install.md).
- **Add a plugin package:** see [docs/plugins.md](docs/plugins.md).
- **Understand the generated setup patch:** see [docs/setup-composition.md](docs/setup-composition.md).
- **Cut a release:** see [docs/releasing.md](docs/releasing.md).

## Development

```sh
pnpm install
pnpm check        # type-check, lint, unit tests, build
```

Committing is part of the workflow: the setup patch, `lib/` output, and `client.js` bundles are
generated and committed so that bundles install from git without an install-time build step. Run
`pnpm gen` after changing a composition fragment and `pnpm build` after changing TypeScript
sources; CI rejects a commit whose generated files do not match their sources.

## Security

Installing a bundle runs its code with the permissions of the Harness process. Market entries pin
an exact git commit so the reviewed source and the running code are the same revision. This
repository contains no credentials, sessions, or machine-specific paths.
