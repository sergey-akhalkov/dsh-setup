# Spec Delta

## ADDED Requirements

### Requirement: Administrator desktop shortcut

The installer SHALL create or repair the fixed `DeepSeek Harness (Administrator)` shortcut on the current user's Desktop by default when the installed Desktop app can be resolved. The shortcut SHALL start the installed Desktop app through a Windows UAC elevation prompt.

#### Scenario: Default install

- **WHEN** a user runs the installer without shortcut-suppression options and the Desktop app is installed
- **THEN** the administrator shortcut is created on the Desktop and the run reports its name

### Requirement: Administrator shortcut skip and rerun safety

`-DryRun` and `-NoDesktopShortcut` SHALL skip the shortcut. A missing Desktop app SHALL be a warning rather than a failed installation. Shortcut creation MUST be idempotent and MUST NOT change the profile, its patch, or the app installation; the installer's existing setup-update behavior is unchanged.

#### Scenario: Intentional skip

- **WHEN** the installer runs with `-DryRun` or `-NoDesktopShortcut`
- **THEN** no shortcut is created and the run reports that the step was skipped

#### Scenario: Missing Desktop app

- **WHEN** the installer cannot resolve an installed Desktop app
- **THEN** it warns about the skipped shortcut, completes the profile installation, and does not fail

#### Scenario: Rerun

- **WHEN** the installer runs again with the same Desktop app
- **THEN** the shortcut is created or repaired without duplicating files, and the installer's normal setup update behavior is unchanged

#### Scenario: Repository validation

- **WHEN** the installer exercise or dogfood runs in the repository
- **THEN** it passes `-NoDesktopShortcut` and creates no shortcut on the runner or owner Desktop
