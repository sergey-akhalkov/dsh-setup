# Spec Delta

## MODIFIED Requirements

### Requirement: Page from a drafted source

When the user asks for a page, or an explanation is complex enough that a flow, comparison, hierarchy, ranked list, or state machine carries the answer, the agent SHALL write a compact Markdown draft and render it with the bundled CLI, without waiting to be asked. The CLI MUST produce one self-contained HTML file. The agent MUST NOT hand-write HTML, CSS, or SVG coordinates for that page.

#### Scenario: Requested page

- **WHEN** the user asks for a visual explanation or a page
- **THEN** the agent renders the drafted page with the bundled CLI and returns the rendered file

#### Scenario: Proactive page for a complex explanation

- **WHEN** the answer explains a flow, architecture, comparison of three or more options, hierarchy, ranked findings, or state machine, and the user did not ask for a page
- **THEN** the agent renders the page and returns it with a short reply that links the page

#### Scenario: Simple answer stays text

- **WHEN** the answer is a code change, a one-line fact, a delegated report, or a request for plain text
- **THEN** the agent answers in text and renders no page

## ADDED Requirements

### Requirement: Deployment flow owns the loaded policy

The loaded skill text SHALL make this deployment's render flow authoritative over the vendored upstream body where the two disagree: a workspace draft file rendered by path with `-o`, `AM_HOME`, `AM_NO_UPDATE_CHECK=1`, and `--no-open`, never stdin and never the default `~/.answer-me-with-html` directory. The text MUST state that the upstream always-on mode is not enabled here.

#### Scenario: Conflicting body instructions

- **WHEN** the vendored body describes stdin rendering or the default home output
- **THEN** the adapter text names the deployment flow as the one to follow

#### Scenario: Always-on stays off

- **WHEN** the skill text is presented
- **THEN** it does not enable the upstream `[answer-me-with-html always-on]` reminder
