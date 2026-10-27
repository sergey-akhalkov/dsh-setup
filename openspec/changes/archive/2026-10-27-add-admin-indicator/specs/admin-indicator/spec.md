# Spec Delta

## Purpose

Shows whether the running DeepSeek Harness Desktop has Windows administrator rights, lets the user create an administrator launch shortcut, and offers a confirmed restart into administrator mode without confusing OS elevation with a session permission.

## ADDED Requirements

### Requirement: Windows administrator status

The system SHALL determine whether the process hosting the Harness runs with Windows administrator rights and SHALL expose the result to the Web client as `administrator`, `standard`, or `unknown`. The result MUST come from the running process token, not from a configured setting, a session permission, or a client guess. On non-Windows platforms the status SHALL be `unknown`.

#### Scenario: Elevated Host

- **WHEN** the Host process token has a High or System integrity level
- **THEN** the Web client receives `administrator`

#### Scenario: Standard Host

- **WHEN** the Host process token has a Medium or lower integrity level
- **THEN** the Web client receives `standard`

#### Scenario: Unsupported platform

- **WHEN** the Host runs on a platform other than Windows
- **THEN** the Web client receives `unknown`

### Requirement: Elevation status endpoint

The Host SHALL expose the result through a read-only same-origin GET status route. The response SHALL state only the platform, the elevation state, and whether the Desktop actions are available; it MUST NOT return a secret or an action token. Detection failure SHALL report `unknown`.

#### Scenario: Elevated Host

- **WHEN** the Host process token has a High or System integrity level
- **THEN** the Web client receives `administrator`

#### Scenario: Standard Host

- **WHEN** the Host process token has a Medium or lower integrity level
- **THEN** the Web client receives `standard`

#### Scenario: Unsupported platform

- **WHEN** the Host runs on a platform other than Windows
- **THEN** the Web client receives `unknown`

#### Scenario: Detection failure

- **WHEN** the Host cannot determine its integrity level
- **THEN** the Web client receives `unknown` and the indicator is not shown

### Requirement: Composer administrator indicator

When the status is `administrator` or `standard` and the client is the Windows Desktop app, the system SHALL show a compact indicator in the composer tool row after the session permission control. The indicator SHALL display a shield and, while the composer has room, the visible label `Standard User` or `Administrator`. At narrow composer widths it SHALL collapse to the shield with the accessible name, matching the permission control's compact treatment, and it SHALL visually distinguish the two states.

#### Scenario: Administrator label

- **WHEN** the status is `administrator`
- **THEN** the indicator shows the visible label “Administrator” and the administrator treatment

#### Scenario: Standard label

- **WHEN** the status is `standard`
- **THEN** the indicator shows the visible label “Standard User” and the standard treatment

#### Scenario: Narrow window

- **WHEN** the composer is too narrow for the full label
- **THEN** the indicator collapses to the shield while its accessible name and tooltip still report the state

### Requirement: Indicator accessibility and menu

The indicator SHALL expose an accessible name and a passive tooltip and SHALL open a menu on activation. The menu actions SHALL be presented as native-styled buttons with an icon and a visible hover, focus, and disabled treatment. The indicator MUST NOT replace or report the state of the session permission control, and it MUST NOT alter the window title bar or the shell chrome.

#### Scenario: Menu

- **WHEN** the user activates the indicator
- **THEN** a menu opens with the current state, an explanation that all sessions, tools, and terminals inherit the OS privilege level, and the available actions

#### Scenario: Menu buttons

- **WHEN** the menu shows the shortcut or restart actions
- **THEN** each action is a visibly interactive button with an icon and a native hover/focus treatment, not a plain text row

#### Scenario: Permission distinction

- **WHEN** the session permission control says “Full access” while the status is `standard`
- **THEN** the indicator still communicates `standard` and does not imply that Full access grants OS administrator rights

#### Scenario: Unknown or unsupported

- **WHEN** the status is `unknown`
- **THEN** no indicator is shown

### Requirement: Administrator shortcut action

The indicator menu SHALL offer a “Create admin desktop shortcut” action when the running app is the Windows Desktop app. The Host SHALL perform the action through the fixed authenticated POST shortcut route. The action SHALL create or repair the fixed `DeepSeek Harness (Administrator)` shortcut on the current user's Desktop, which launches the installed Desktop app through a UAC elevation prompt, and SHALL report success or failure as a native toast.

#### Scenario: Menu invocation

- **WHEN** the user chooses “Create admin desktop shortcut”
- **THEN** the menu calls the fixed authenticated shortcut route and shows a native success or error toast

#### Scenario: Manual command remains available

- **WHEN** the user runs `/admin-shortcut` manually
- **THEN** the same Host command creates the shortcut

#### Scenario: Create shortcut

- **WHEN** the Desktop app is in the standard state and the user chooses “Create admin desktop shortcut”
- **THEN** the shortcut appears on the Desktop, the running app remains in the standard state, and the menu reports success

#### Scenario: Repair shortcut

- **WHEN** the shortcut already exists with stale content and the user chooses the action
- **THEN** the fixed shortcut is replaced and the menu reports success

#### Scenario: Unsupported host

- **WHEN** the running Host is not the Windows Desktop app
- **THEN** the action is unavailable and the menu explains why

#### Scenario: Creation failure

- **WHEN** the shortcut cannot be written
- **THEN** the menu reports failure and the running app is unchanged

### Requirement: Shortcut action input and origin constraints

The Host MUST use a fixed shortcut name and target for the action and MUST NOT accept a client-supplied path, name, or executable. The action MUST be reachable only through the DSH authenticated session's fixed POST route; the plugin MUST NOT expose an unauthenticated action route. The Host SHALL validate the request with the DSH connection service, which enforces the Host/Origin fence and the live browser credential.

#### Scenario: Client input ignored

- **WHEN** a request for the action includes a path, name, or executable
- **THEN** the Host ignores those values and uses the fixed shortcut

#### Scenario: Authenticated session only

- **WHEN** the action is invoked
- **THEN** it runs through the DSH authenticated session; the Host validates the browser credential through the connection service, and no unauthenticated route can perform it

#### Scenario: Unauthenticated request

- **WHEN** a request for the action does not come from the DSH authenticated session
- **THEN** the Host rejects it and the action does not run

### Requirement: Composer draft preservation

The shortcut action MUST NOT read or modify composer content; it SHALL remain usable with any draft, reference, or attachment. The restart action, when its feature flag is enabled, MUST NOT replace an unsent draft, inline reference, or attachment; while any is present, or the composer is submitting, that action SHALL be disabled with an explanation and SHALL recheck before submitting.

#### Scenario: Existing composer content

- **WHEN** the composer contains text, a reference, or an attachment
- **THEN** the shortcut action remains available and leaves that content untouched, while the restart action is disabled with an explanation

#### Scenario: Clean composer

- **WHEN** the composer is empty and not submitting
- **THEN** both enabled actions run without replacing anything

### Requirement: Administrator restart action

The restart action SHALL be behind a row feature flag named `restart`, default disabled. When disabled, the menu SHALL offer only the shortcut and the Host SHALL NOT register the restart command. When enabled, the indicator menu SHALL offer “Restart DSH as Administrator” only when the status is `standard` and the running Host is the Windows Desktop app. The Host SHALL perform the enabled action through the registered `/admin-restart` command, submitted through the DSH authenticated composer input. The action SHALL require an explicit confirmation and request UAC; after approval, the elevated helper SHALL close the running Desktop app and start a new instance. The current session ends. Declining UAC SHALL leave the current app running.

#### Scenario: Disabled by default

- **WHEN** the row has no `restart` flag or it is false
- **THEN** the menu shows only “Create admin desktop shortcut” and no restart command is registered

#### Scenario: Standard state offers restart when enabled

- **WHEN** the `restart` flag is true, the status is `standard`, and the Host is the Windows Desktop app
- **THEN** the menu offers “Restart DSH as Administrator” with a warning that the current session ends

#### Scenario: Menu invocation

- **WHEN** the user chooses “Restart DSH as Administrator” and confirms
- **THEN** the menu submits `/admin-restart confirm` through the authenticated composer input, and the Host launches the UAC-first elevated helper, without requiring a manual submission

#### Scenario: Manual command remains available

- **WHEN** the user runs `/admin-restart confirm` manually
- **THEN** the same Host command starts the confirmed UAC-first restart sequence

#### Scenario: Confirmation required

- **WHEN** the user chooses the restart action
- **THEN** the action first asks for explicit confirmation and starts no process before it is confirmed

#### Scenario: Destructive command needs a second confirmation

- **WHEN** a user submits `/admin-restart` without the `confirm` argument
- **THEN** the Host returns the warning and the exact command to run instead of restarting

#### Scenario: Restart closes and starts

- **WHEN** the user confirms the restart and accepts the UAC prompt
- **THEN** the elevated helper closes the running Desktop app promptly and starts a new elevated instance, with no long grace period before the app closes

#### Scenario: Unavailable when administrator

- **WHEN** the status is `administrator`
- **THEN** the restart action is unavailable and the menu says DSH is already running as administrator

#### Scenario: Unavailable outside the Desktop app

- **WHEN** the running Host is not the Windows Desktop app
- **THEN** the restart action is unavailable and the menu explains why

#### Scenario: Declined UAC

- **WHEN** the user declines the UAC prompt
- **THEN** no elevated app starts and the current app keeps running

#### Scenario: Restart failure

- **WHEN** the Host cannot start the restart mechanism
- **THEN** the running app is unchanged and the menu reports failure

### Requirement: Restart action safety

The system MUST NOT claim the app restarted until the new instance starts. The Host MUST use a fixed restart mechanism with no client-supplied executable or command. The action MUST run only as the registered `/admin-restart` command through the authenticated composer input; the plugin MUST NOT expose an HTTP action route.

#### Scenario: Fixed mechanism

- **WHEN** `/admin-restart confirm` arrives through the authenticated session
- **THEN** the Host uses the installed executable and its fixed UAC-first elevated close-and-start mechanism, ignoring any request content

#### Scenario: No action route

- **WHEN** an out-of-session request tries to trigger the restart
- **THEN** no action route exists, so the Host cannot close or start anything

### Requirement: No in-process elevation

The system SHALL NOT change the integrity level of the running process in place. The indicator and the shortcut action MUST NOT restart or close the app. The separate administrator restart action SHALL request UAC first and, after approval, close the app and start a new elevated process; elevation happens in the new process. Declining UAC leaves the current app running.

#### Scenario: Indicator and shortcut do not restart

- **WHEN** the user opens the indicator menu or creates the shortcut
- **THEN** the current app process keeps its existing privilege level and keeps running

#### Scenario: Restart creates a new elevated process

- **WHEN** the user confirms the restart and accepts the UAC prompt
- **THEN** the newly started Desktop app and its Host inherit administrator rights

#### Scenario: Declined UAC leaves no replacement

- **WHEN** the user declines the UAC prompt for the restart or the shortcut
- **THEN** no elevated process starts and the current app keeps running
