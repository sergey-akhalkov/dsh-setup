---
name: instruction-budget
description: >
  Audit a workspace instruction file against its documented byte budget and move duplicated or
  repository-level detail into the docs that own it. Use when AGENTS.md (or an equivalent file) is
  over budget, feels too long, or a rule keeps being skipped because it is buried in prose.
---

# Instruction budget

The workspace instruction file is loaded on every request, so it is the most expensive prose in the
repository. This skill audits it; it does not shrink it by deleting facts.

## Measure

- Read the repository's documented budget. Here it is 16,000 bytes for `AGENTS.md`, enforced by
  `pnpm validate:repo`; a token is estimated as UTF-8 bytes / 4. Use the repository's own convention,
  not a tokenizer guess.
- Report the measured size, the budget, and the remaining headroom. Over budget is a blocking
  finding, not a warning.

## Find duplication

Read the file line by line and label each block by its destination:

- **Repository fact** the code, config, or `scripts/` already states: drop it after linking the
  authoritative file.
- **Detail that belongs to docs/**: repository maps, command tables, checklists, CI sequences, hard
  rules with their explanations, troubleshooting, history. These move, not vanish.
- **Architecture or inventory** that changes with the code: keep only the one-paragraph mental model
  the agent needs before it can find the detail.
- **Rule that must stay in front of an agent**: generated-file rules, sync constraints, safety
  limits, the workflow it must follow. These stay, compressed to their action.
- **Duplicated link or repeated section**: keep one.

## Move, never delete

A line that carries a fact found nowhere else gets a destination before it leaves the file: the doc
that owns that subject, a new section in it, or a spec. Say where it went and confirm the heading
exists there. Deleting a unique fact to hit the number is a failed audit.

## Report

Give the measured size before and after, the budget, the lines moved and their destinations, and the
lines deliberately kept with the reason. If the budget still cannot be met without losing a fact,
report which rule needs enforcement (a hook or check) instead of more prose.
