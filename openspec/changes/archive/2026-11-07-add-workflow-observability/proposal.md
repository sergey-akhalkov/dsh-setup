# Proposal

## Why

The process layer is spread across separate plugins and local records, and the Observability tab reports session statistics but not process decisions. Nothing answers "which configured trigger fired in this session, which step ran, what evidence satisfied it, and why did a trigger not fire". Past gate measurements showed that a noisy trigger, a silent trigger, and a broken plugin looked identical, so the owner could not tell whether decomposition, reflection, and review actually ran. This change adds the read-only surface first, before any enforcement, so the process becomes observable without changing behavior.

## What Changes

- Add a new `@dsh-setup/plugin-workflows` bundle with a Host recorder and a Client `Workflows` conversation view.
- Register a shadow trigger catalog for DSH agent, tool, subagent, and OpenSpec workspace events. Each evaluation records matched/not-matched and a reason.
- Write a bounded per-session event journal under `.dsh/workflows/events/` and project existing `.dsh/work-checkpoints`, `.dsh/delegation` run and settled review records, and `openspec/changes/*/reviews/*.json` as a unified run timeline with explicit session attribution.
- Add the Why-not view and a health strip that distinguishes "no event", "trigger did not match", and "listener is down".
- No steering, blocking, workflow execution, or editor. Existing plugins keep their behavior.

## Capabilities

### New Capabilities

- `workflow-observability`: the read-only process surface - shadow triggers, a per-session event journal, trigger evaluation reasons, unified run projection, and listener health.

### Modified Capabilities

None.

## Impact

- New package `packages/plugin-workflows` with Host and Client halves, `cordis.fragment.yml`, locale, icon, tests, and docs.
- `packages/setup` generation (bundle row and vendored tree), the root README, plugin docs, and installer bundle selection when the setup ships it.
- Reads existing local records and `openspec/changes/**`; writes only under `.dsh/workflows/`.
- No new DSH version and no external workflow-platform dependency.
- Out of scope: workflow definitions, execution, gates, and the visual editor (separate changes).
