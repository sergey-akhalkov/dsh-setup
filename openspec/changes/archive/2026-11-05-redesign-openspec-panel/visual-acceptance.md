# Visual acceptance record (task 3.3)

Host: throwaway Web Harness, DSH CLI 0.2.2-rc.1 (a host that provides `connection.fetch`), web
profile created from the shipped template, `@dsh-setup/plugin-openspec` linked from this checkout
with its built `lib/`, workspace the repository root. Driven through a system Chrome window with
the desktop tools. Screenshots are committed under `screenshots/` in this directory.

## Light appearance, full checklist

- Open from the Start card: the `OpenSpec` guide card opens the panel in the right sidebar
  (`screenshots/root.png`).
- Root header: `1 changes · 20 specs · 55 archived`, Explore and Propose actions, `Changes 1 |
  Specs 20 | Archive 55`.
- Change card: `applying` state dot + tag, `11/14`, two-line purpose, progress bar, `proposal design
  spec tasks`, `updated … ago`, commit `5d70626 … 2026-11-05`.
- Specs list: search field; each card states the purpose, requirement count and provenance
  `Accepted via <change> · <archive date> · n/n · <short hash> · <commit date>`.
- Capability detail (`screenshots/capability.png`): full purpose; `10 requirements · 41 scenarios ·
  Accepted 2026-10-27 · via 2026-10-27-add-admin-indicator · 7e87448 2026-10-27`; `Requirements (10)
  | History (1)`; requirement cards with visibly marked `SHALL`/`MUST` and inline code; labelled
  `WHEN`/`THEN` scenario blocks.
- History: newest-first row `2026-10-27 · 2026-10-27-add-admin-indicator · 12/12 · 7e87448
  2026-10-27`; activating it opens that archived change in its own tab.
- Archived change header (`screenshots/archived-change.png`): `archived` tag, archive date, `12/12`,
  commit, `Why | Design | Specs (2) | Tasks` tabs, proposal Markdown.
- Remembered segment: closing the archived change tab and closing a capability tab after a Specs
  round trip both return to the Specs root.
- Empty Changes state (`screenshots/empty-changes.png`): an initialized workspace with no active
  change renders `0 changes · 1 specs · 1 archived`, the two action cards (Explore / Propose), the
  `RECENTLY ARCHIVED` card and `See all archive`.
- Archive: reverse-chronological cards with archive date, task completion, purpose, artifact facts,
  update time and commit; the filter narrows by name/purpose (`hindsight` matched five rows).
- Narrow width (572 px window): segments, filter, cards and metadata wrap with no horizontal
  scrollbar.
- Native refresh: `Ctrl+Alt+R` in the change tab re-read without an error.
- Live update: touching `openspec/changes/redesign-openspec-panel/tasks.md` changed the change
  header from `updated 20m ago` to `updated just now` without a click.

## Dark appearance

The same throwaway Harness reopened in a forced-dark Chrome (`--force-dark-mode`, separate
user-data-dir). Surfaces, hairlines, labels, the success tag on the completed change, the progress
bar, metadata, commit facts and the failure state all followed the dark theme; no light patch or
unreadable label appeared (`screenshots/dark-appearance.png`).

## Supported floor host

The DSH 0.2.1-rc.3 floor host was installed from the registry with a pnpm override for the broken
`@aws-sdk/token-providers@3.1161.0` transitive pin and booted as a throwaway Web profile with the
plugin linked. The panel rendered with live route data (`1 changes · 20 specs · 55 archived`, the
complete change card, requirement and history tabs) — `screenshots/rc3-floor-host.png`. So the
supported range floor already provides `connection.fetch`, and a **supported** host without it does
not exist in the `>=0.2.1-rc.3 <0.3.0` range. The degradation path is defensive for hosts outside
the range.

## Missing-route degradation (defensive path)

Because no supported host lacks `connection.fetch`, the consequence was exercised on the 0.2.2-rc.1
host with a copy of the plugin whose host half registers no read routes (the exact code path a
`connection.fetch`-less host takes) and the unchanged client bundle:

- the panel renders its designed error state naming the failing request: `The OpenSpec change list
  request failed (404).` with a Retry action (`screenshots/degradation-panel.png`);
- typing `/openspec-apply` opens the picker shell with the same failing request in its error strip
  and a Retry action; the draft is not submitted (`screenshots/degradation-picker.png`);
- the six skills are host-side: the same loaded plugin module registers its skill provider before the
  route registration (`skill-provider.test.ts`), and the panel tab and picker command from that
  module loaded on this host.

## Dogfood

`pnpm dogfood` exited 0 against a copy of the live `desktop` profile: it composed the copied owner
profile, ran `install.ps1` (5.7 s), verified the backup, that only the setup bundle is appended and
stays last, the byte-identical profile patch, the installed setup version, the composed setup rows
and defaults, every owner-patched row's effective config, and that the live profile and the running
Harness were not modified. The live profile was not touched.
