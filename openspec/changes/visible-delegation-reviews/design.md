# Design

## Context

See proposal.md - Why. `startTarget()` in
`packages/plugin-delegation-rules/src/host/index.ts` starts every contract with
`delivery: 'caller'`. The subagent service catalogs an external run only for
`delivery: 'parent'`; it rejects a requested name on a caller-delivered run, and it
assigns a default unique name when a parent-delivered run requests none. A closed
child's catalog row stays, so a re-run must not reserve the same name.

## Goals / Non-Goals

**Goals:**

- Review runs are cataloged external children labelled `delegation:<rule>`; their
  answer arrives as a settlement notice.
- Answer and patch behave exactly as before, with no catalog entry or notice.

**Non-Goals:**

- A local DSH Session, token/duration metrics, follow-up messages, or opening the
  review entry.
- Any change to records, gates, digests, queue, or thread reuse.

## Decisions

### D1: Delivery by contract

`review` -> `delivery: 'parent'`; `answer` and `patch` -> `delivery: 'caller'`; `note`
starts no provider. The catalog guarantee is scoped to external providers: the service
catalogs a local (in-process) child unconditionally, with its own mode (continuable when
the provider supports follow-up), independent of the delivery flag, so the engine cannot
make local answer/patch runs invisible and does not try to. The delivery flag decides
whether the child's answer is also delivered as a settlement notice. Alternatives:
parent delivery for everything (rejected: answer and patch are synchronous, so the
caller would receive the result twice); a catalog-only API (does not exist).

### D2: No explicit child name

The engine sends no `name`, so the service assigns the next default name, unique among
siblings. A requested name derived from the review identity would collide on a re-run
because the closed row stays in the catalog; a per-run suffix needs a run identity the
engine does not pass into `startTarget`, and the label already names the rule.

### D3: The settlement notice is the accepted cost

Parent delivery also delivers the child's answer as a notice that wakes the parent with
a new turn. The engine's `finishTarget` still awaits the same activation result, writes
the same record, and disposes the same run; the extra turn is how a visible subagent
reports completion. The notice can arrive just before the record is written, so a woken
turn may briefly see the review pending and steer; the gate always reads the record
that follows.

## Risks / Trade-offs

- **Chat noise**: the verdict JSON arrives as a message; the record remains the gate
  source.
- **Transient pending state**: see D3; no mitigation beyond the existing gate.
- **Queue timing**: unchanged; the catalog insert happens after the provider publishes
  the run.

## Migration Plan

Revert the delivery expression (and its tests/docs) to roll back; catalog rows and
records already written stay harmless. Ship as 0.38.0 and install.

## Open Questions

None.
