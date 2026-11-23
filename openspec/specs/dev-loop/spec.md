# dev-loop Specification

## Purpose
Lets a contributor see a plugin change in a running Harness without a release, an install, or a Desktop
relaunch: one command owns a dedicated development profile, the repository's build watcher, and the Web
host it starts.

## Requirements

### Requirement: Development host command

The repository SHALL provide one development command that prepares a dedicated profile, starts the Web
host for it, and runs the existing build watcher alongside it, so a saved source file reaches a running
page without a manual install step. The command MUST print the page URL and keep running until it is
interrupted or the host exits.

#### Scenario: Setup mode by default

- **WHEN** a contributor starts the command with no mode argument
- **THEN** the development profile links the workspace setup bundle, the vendored setup tree is refreshed
  before the host starts, and the composed profile selects the setup bundle and no individual workspace
  plugin bundle

#### Scenario: Single-plugin mode

- **WHEN** a contributor starts the command with `--plugin <name>` naming a workspace plugin package
- **THEN** the development profile links that package only, refreshes no vendored tree, and the host
  serves that plugin's rows

#### Scenario: Existing profile is reused

- **WHEN** the development profile already exists and the contributor starts the command without
  `--refresh`
- **THEN** the command keeps the existing profile, reconciles only the development selections and the
  module-watch entry it manages, and preserves every other profile entry, without replacing the profile
  from the shipped template

#### Scenario: Mode switch without refresh

- **WHEN** a contributor switches between setup mode and plugin mode, or from one plugin package to
  another, without `--refresh`
- **THEN** exactly the requested development selection is present, the previously selected development
  bundle and its module-watch entry are gone, and no bundle is mounted twice

#### Scenario: Explicit refresh

- **WHEN** a contributor starts the command with `--refresh`
- **THEN** the development profile is recreated from the shipped `web` template before the host starts,
  and a profile that is replaced this way is named in the command output

#### Scenario: Unknown plugin package

- **WHEN** `--plugin <name>` names no workspace plugin package
- **THEN** the command fails before starting the host or the watcher, and its error names the requested
  name and the workspace packages that are accepted

### Requirement: Development profile isolation

The command SHALL write only the development profile under the Harness home selected by the environment,
and MUST NOT write the `desktop` profile, whose lifecycle belongs to the Desktop application. It MAY read
that profile's manifest and patch to mirror its selection, which is read-only. The Harness home MUST be
`$DSH_HOME` when set and the user's default Harness home otherwise.

#### Scenario: Desktop profile untouched

- **WHEN** the command runs while a Desktop application profile exists
- **THEN** that profile's manifest, patch, and installed dependencies are unchanged

#### Scenario: Selection mirrors the desktop profile

- **WHEN** the machine has a desktop profile and the development profile's patch holds no entries of its
  own
- **THEN** the development profile records that profile's bundle selection without the setup bundle, the
  same non-managed dependencies, and its patch followed by the development entry the command owns, so the
  Web host mounts the same bundles on first use

#### Scenario: Page-written settings survive a restart

- **WHEN** the development profile's patch already holds entries of its own, including the settings the
  running page writes there (the chosen locale, an acknowledged notice version)
- **THEN** the command rewrites only the entry it owns and keeps every existing entry, so those settings
  survive the next start

#### Scenario: Module-watch override location

- **WHEN** the development profile enables module watching for the linked package's build output
- **THEN** that setting exists only in the development profile's own patch file, and no tracked
  repository file carries a machine path

### Requirement: Live apply of a linked package

A rebuild of the linked package SHALL reach the running Harness without a release, an install, or a
Desktop relaunch. The Client half MUST reach an open page through the Web transport without a navigation.
The Host half SHALL apply in place through a profile recomposition the command triggers after every Host
rebuild, and SHALL restart only its own host child when that trigger cannot be written.

#### Scenario: Client half swaps without navigation

- **WHEN** a Client source edit rewrites the linked package's Client bundle
- **THEN** the open page replaces the plugin bundle without a reload, and page state outside that plugin
  survives

#### Scenario: Host half applies in place

- **WHEN** a Host source edit rewrites the linked package's Host entry
- **THEN** the running Host re-applies the changed plugin through a profile recomposition, the session
  survives, and the command reports no restart

#### Scenario: Failed replacement stays inactive

- **WHEN** a rebuilt plugin fails to import or start
- **THEN** the plugin stays inactive until a later rebuild succeeds, the host and the watcher keep
  running, and the next recomposition after the repair starts it again

### Requirement: Harness CLI resolution

The command SHALL resolve the Harness CLI in one fixed order and print it before starting: `DSH_CLI` when
it holds a non-empty value, used verbatim; otherwise an installed Harness command line when one is found;
otherwise `pnpm dlx @deepseek-ai/dsh@<runtime>` for the runtime version in `dsh.json`. An unresolvable CLI
MUST fail before the profile is changed, with an error naming the override and the locally installed
command line.

#### Scenario: Override wins

- **WHEN** `DSH_CLI` holds a non-empty value
- **THEN** the command runs that exact command line for every Harness invocation and runs no package
  download for it

#### Scenario: Empty override is unset

- **WHEN** `DSH_CLI` is empty or whitespace
- **THEN** the command treats it as unset and continues with the next resolution source

#### Scenario: Installed command line wins over the download form

- **WHEN** no override is set and a locally installed Harness command line is available
- **THEN** the command runs that command line and downloads nothing, even when its version differs from
  the `dsh.json` runtime

#### Scenario: Download fallback

- **WHEN** no override is set and no installed Harness command line is available
- **THEN** the command uses the `dsh.json` runtime version in the download form

#### Scenario: Unresolvable CLI

- **WHEN** the resolved CLI cannot run
- **THEN** the command exits non-zero before creating or changing the development profile, and the error
  names `DSH_CLI` and the locally installed command line as remedies

### Requirement: Shutdown without orphans

The command SHALL terminate each build-watcher and host tree it started while that tree's root is still
alive, and MUST report a tree whose root exited before cleanup as unconfirmed rather than guess at its
descendants. It MUST NOT terminate a process whose identity was not established at launch, including a
process that holds the page port.

#### Scenario: Interrupt

- **WHEN** the contributor interrupts the command
- **THEN** the host and the watcher trees are terminated while their roots are alive, the page port is
  free, and the command exits with a status that reports the interruption

#### Scenario: Host exits on its own

- **WHEN** the host process exits without an interrupt
- **THEN** the watcher tree is terminated while its root is alive, the host's exit status is reported, the
  command states that the host tree could not be confirmed terminated, and it exits non-zero unless the
  exit was requested by the command itself

#### Scenario: Foreign listener survives

- **WHEN** a process the command did not start holds or takes the page port
- **THEN** that process is not terminated, and the command reports only the outcomes of the trees it owns
