# Spec Delta

## Purpose

Turns a complex answer into one rendered HTML page: the model writes only the content draft, the
bundled CLI owns layout, diagrams, and styling, and the page is delivered as a file inside the
workspace.

## ADDED Requirements

### Requirement: Page from a drafted source

When the user asks for a page, or an explanation is complex enough that a diagram or a comparison
carries the answer, the agent SHALL write a compact Markdown draft and render it with the bundled
CLI. The CLI MUST produce one self-contained HTML file. The agent MUST NOT hand-write HTML, CSS, or
SVG coordinates for that page.

#### Scenario: Requested page

- **WHEN** the user asks for a visual explanation or a page
- **THEN** the agent renders the drafted page with the bundled CLI and returns the rendered file

#### Scenario: Simple answer stays text

- **WHEN** the answer is a code change, a one-line fact, a delegated report, or a request for plain
  text
- **THEN** the agent answers in text and renders no page

### Requirement: Workspace page and presentation

The draft MUST be written as a file inside the session workspace and rendered by that path, so the
CLI saves no draft copy of its own. The rendered page MUST be written under the session workspace at
`.tmp/answers/`, never into a user home directory or the system temporary directory. The agent SHALL
call `present` with the absolute page path and SHALL end the reply with a link to that path. The
reply text MUST stay short and MUST NOT repeat the page content.

#### Scenario: Page delivered inside the app

- **WHEN** a page renders successfully
- **THEN** the file exists under the workspace `.tmp/answers/`, the reply carries a link to it, and
  the page is presented as a deliverable card

#### Scenario: No writes outside the workspace

- **WHEN** any draft is rendered, including one that fails or carries warnings
- **THEN** neither the page nor a saved draft is written outside the workspace

### Requirement: Offline render

Every render SHALL run with the CLI's update check disabled, so the CLI starts no background update
process and makes no request to the upstream repository. Rendering MUST succeed without network
access.

#### Scenario: No update check

- **WHEN** the vendored CLI renders a page in a session
- **THEN** it performs no upstream request and starts no detached update process

#### Scenario: Offline rendering

- **WHEN** the machine has no network access
- **THEN** the page renders normally

### Requirement: Render failure and fallback

A rejected draft MUST be reported with the offending line and a correct example, and the agent
SHALL edit the draft file at those lines and retry at most twice. When the runtime is missing or
older than the supported Node version, the agent MUST report the requirement and stop. When retries
fail, the agent SHALL answer in text and say that no page was produced.

#### Scenario: Invalid draft

- **WHEN** the CLI rejects a draft
- **THEN** the agent fixes the reported lines in the workspace draft file and renders again

#### Scenario: Retries exhausted

- **WHEN** rendering still fails after two fixes
- **THEN** the agent returns the text answer and states that no page was produced
