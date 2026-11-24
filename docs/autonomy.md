# Autonomy: release the turn with a timed question

`ask_user_question` holds the whole turn until the user answers, so one night-time question can hold a
turn for hours. The shipped `standard` agent preset declares a `tool-ask-user` row with no config,
which is the legacy behavior; the installed `@deepseek-ai/dsh-tool-ask-user` also offers a timed mode
that shows a countdown with a **Take time** button, returns `{pending: true, callId}` at the deadline,
and keeps the question answerable. The setup bundle enables that mode for every preset, states what a
pending result authorizes, and configures the wait; the policy is part of the always-on working
contract.

## What the setup configures

`@dsh-setup/plugin-question-timeout` (row `dsh-setup-question-timeout`) carries `timed` (default
`true`) and `timeout` in seconds (default `300`), read from the profile-local settings file
`.dsh-setup-question-timeout.json`. On activation and on every save of that file it reads every
installed `preset-*` declaration, rewrites that declaration's `tool-ask-user` child row to
`mode: timed` with the timeout, and commits the result through the profile's config editor. Every
derivation reads the installed declaration — never its own persisted row — so a DSH upgrade cannot
leave a stale copy behind. Disable or remove the row to stop managing the presets.

## Configure the wait

The wait lives in the profile-local file `.dsh-setup-question-timeout.json`:

```json
{ "timed": true, "timeout": 300 }
```

The bundle watches that file: save it and the **next** session uses the new value, without a
Harness restart; the current session keeps the tool schema it composed with. `timed: false` restores
the shipped row, so a question blocks the turn again. The file also carries the `managed` ownership
record the bundle maintains — leave that object intact.

A preset that already carries its own `cordis.patch.yml` override keeps it — the bundle logs that
preset and leaves it alone, because a local override stays authoritative. Remove that override to let
the setup manage the preset.

## The row itself

```yaml
- id: tool-ask-user
  name: "@deepseek-ai/dsh-tool-ask-user"
  config:
    mode: timed
    timeout: 300
```

`mode` is `legacy` (the default) or `timed`; `timeout` is in seconds, defaults to `120` in the
Harness tool, and accepts `-1` for no timeout.

### Manual fallback

When the bundle is not installed, or the profile provides no configuration editor, set the row by
hand. The Web UI does not edit presets: Settings → "Agent presets" shows the roster, a read-only
"View configuration", and "Set as new task default"; its Creator entry ("Let the agent help me create
a preset") starts a Creator-mode task that authors or overrides a preset as a bundle. Editing the
shipped Standard composition means overriding the Loader row `preset-standard` by id with the
complete child plugin list, through a bundle patch or the profile's `cordis.patch.yml` override
layer. The override replaces the complete `config`, so the whole child list must be restated; the
shipped list is `presets/standard.patch.yml` inside the installed `@deepseek-ai/dsh-web-app` package
(`node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml` under the DSH install directory).
A DSH upgrade can change that list and the override does not merge, so re-apply the row after an
upgrade.

A session's composition is fixed when it starts: existing sessions keep theirs, and a new session
uses the change.

## What a pending result means

At the deadline the tool returns `{pending: true, callId}` with a message and the turn continues; the
question stays answerable, so a pending result is not a lost question. It is neither a pause nor
permission:

- continue independent work; a question never ends a turn and the agent never asks whether to
  continue;
- take the `(Recommended)` option only for a reversible operational choice, and record that assumption
  in the next checkpoint so it is visible and can be revised;
- leave scope, product, release, credential, and destructive choices open and unauthorized.

The rule lives in the `Recover instead of repeating` section of the
[working contract](../packages/plugin-working-principles/assets/working-principles/contract.md), so a
profile that mounts that plugin follows it in every session; [principles.md](principles.md) describes
the plugin.

## Acceptance check

In a new session, ask the agent to ask a question **without** a `timeout` parameter: the composed tool
uses the configured wait, the card shows a countdown and a **Take time** button, and when the wait
expires the tool returns `{pending: true, callId}` with a message while the turn continues. Answer a
second question late: the reply arrives as a steering user message identified as
`answer_to_pending_question`.

`timeout: -1` is the explicit indefinite wait; use it only when an answer is required before
proceeding. An already-returned pending result is never converted into an indefinite wait.

## Limits

- In `legacy` mode, or on a preset with its own profile override, the turn still blocks until the
  user answers; the pending policy describes only the timed result.
- The goal-continuity question review applies to goal-round questions only; a question on a direct turn
  is not reviewed.
- A loop-guard final stop stays deliberate; a pending result does not resume it.
- Pending is not an answer and not permission, and the question stays answerable for a late answer.
- The setup ships no auto-answer plugin: nothing selects an option on the user's behalf.
