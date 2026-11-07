# @dsh-setup/plugin-workflows

Read-only Workflows tab for the DSH conversation view: the shadow trigger
catalog, the observed session events, projected runs, the Why-not rows, and
health for the active workspace.

## Entry

The Workflows tab is the entry point. The host exposes no command that opens a
conversation view, so this bundle registers no Start or slash command; adding
one would require a host command surface for conversation views. The tab sits at
order 30, after Chat, Trajectory, and Observability.

## Data

Everything is local and read-only: bounded JSONL under `.dsh/workflows/events`,
projected records from `.dsh/work-checkpoints` and `.dsh/delegation`, and
OpenSpec review records. Secrets are redacted before a record is stored or
served, and record links are served only from allowed record directories inside
the session workspace.
