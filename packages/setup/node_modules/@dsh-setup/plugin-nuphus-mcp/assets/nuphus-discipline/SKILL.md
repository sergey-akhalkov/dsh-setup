---
name: nuphus-discipline
description: >
  Nuphus browser work: a fresh snapshot after every navigation, per-step success and
  detail inspection, redo only the failed step, DOM extraction for values and
  screenshots only for visual questions, and batching up to the next checkpoint.
---

# Nuphus discipline

The setup configures `nuphus-mcp` as a lazy MCP server: it mounts no static adapter row, and the
server starts on the first call. Reach it with `mcp_tools` and `mcp_call`:

- `mcp_tools` with `server: nuphus-mcp` (optionally a `query`) lists the server's tools and schemas.
- `mcp_call` with `server: nuphus-mcp`, `tool`, and `args` invokes one; later calls reuse the same
  process until the plugin unloads.

The setup's lazy entry passes `--confirm-write`, so a machine-mutating tool needs the call's explicit
confirmation argument and is rejected otherwise. Pass `path` to `desktop_screenshot`, save the PNG and
read it with `read_image`: the lazy proxy drops image content. The entry allows 120000 ms per call,
and the first `desktop_perceive` downloads local OCR models, so it can approach that limit; retry once
the download finishes.

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
