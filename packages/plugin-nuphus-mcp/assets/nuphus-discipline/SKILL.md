---
name: nuphus-discipline
description: >
  Nuphus browser work: a fresh snapshot after every navigation, per-step success and
  detail inspection, redo only the failed step, DOM extraction for values and
  screenshots only for visual questions, and batching up to the next checkpoint.
---

# Nuphus discipline

These rules cover the Nuphus browser tools, whether they appear directly as
`mcp__nuphus-mcp__browser_*` or through the lazy MCP proxy (`mcp_tools`, then `mcp_call` with
`server: nuphus-mcp`).

1. **Snapshot after every change.** Take a fresh `browser_snapshot` after navigation or a DOM change;
   element refs from an earlier snapshot go stale.
2. **Inspect every step's result.** Read every `browser_exec` step's `success` and `detail`: a
   fulfilled MCP response can carry a failed step, and an empty result proves nothing.
3. **Redo only what failed.** After a partial failure, inspect the observed page state and redo just
   the failed step instead of replaying the sequence.
4. **DOM for values, screenshots for visuals.** Use DOM extraction for values and screenshots only
   for a genuine visual question about the UI; never use a screenshot to read text.
5. **Batch to the next checkpoint.** Batch steps only up to the next semantic checkpoint, so a
   failure leaves a state you can reason about.
