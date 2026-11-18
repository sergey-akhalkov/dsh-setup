# Behavioral acceptance: cycle change A lifecycle

Run date: 2026-11-18. Method under test: the packaged `exploratory-testing` skill.

## Setup

- Disposable git workspace `.tmp/behavioral-acceptance/cycle-a` with a minimal OpenSpec root
  (`demo` capability, `Demo greeting` requirement, `Greeting shown` scenario).
- A fresh subagent followed the packaged skill to prepare cycle A. The user approved the proposed
  focus (`demo greeting`, `knowledge` mode) before any session.
- The host lifecycle runs through the built workflows host code with a throwaway host key
  (`cycle-a-acceptance-host-key-012345`): intake run → adoption → click-archive authorization →
  `openspec archive`.

## Behavioral preparation (subagent)

Observed behavior:

- Ran the state scan: one candidate `demo greeting`, B=1 K=3 T=3 C=0 D=0 A=0 S=3 F=0, score 9; no
  rejected candidates; focus approved by the user in `knowledge` mode.
- Created `explore-demo-2026-11-18` with `openspec new change`, set `skip_specs: true`, and wrote
  proposal, design (register, charter, approval decision), `state.md`, `brief.md`, and tasks.
- `openspec validate explore-demo-2026-11-18 --strict` → valid, INFO "skip_specs is set … zero
  deltas accepted"; `openspec status` → 3/3 artifacts complete (1 skipped); `openspec validate
  --specs --strict` → `spec/demo` passed.
- Created no outcome change and archived nothing.

## Host lifecycle (engine + CLI)

Output of `.tmp/behavioral-acceptance/run-cycle-a.mjs`:

```json
{
  "ok": true,
  "steps": [
    "openspec validate --strict: exit 0",
    "change-intake run completed: run run-cycle-a-intake",
    "intake receipt written: intake",
    "adoption accepted: adoption",
    "click archive authorization: 1 receipt(s)",
    "openspec archive moved the change: 2026-11-18-explore-demo-2026-11-18",
    "archived A keeps skip_specs"
  ]
}
```

The completed intake run (`run-cycle-a-intake.json`) has every step `done`
(`requirements, architecture, interface, create-change, spec, spec-review, approval`); the whole-spec
PASS record (`3c0d65c1…`) matched the change digest, the adoption confirmation wrote the adoption
receipt, the click authorization wrote the archive receipt, and the real `openspec archive` moved the
change with `skip_specs: true` intact.

## Conclusion

The packaged method prepared a proper spec-less cycle change with the user's focus approval, and the
host accepted it end to end: intake completion and receipt, adoption, click-archive authorization, and
CLI archive. This satisfies the behavioral cycle-A lifecycle in task 5.4.
