# Proposal

## Why

The observability view reports whether plugins loaded, fired, or failed. It cannot answer the product
questions the setup exists to answer: whether an initiative improves quality, token cost, speed, or
autonomy; whether subagents shorten tasks; or whether goal continuity produces longer autonomous runs.
Without a task-level unit, token accounting, and a baseline, silence is ambiguous and activity is
mistaken for value.

## What Changes

- Derive **task episodes** from human messages and use them as the unit for outcomes, cost, speed, and
  autonomy.
- Derive **token usage** from the existing `assistant/message` usage fields: input, output, cache read,
  cache write, context per step, cache hit ratio. No new log and no persisted store.
- Report **quality, cost, speed, and autonomy** per episode: completed, verified, failed and cut
  episodes; active time; human messages versus machine injections.
- Attribute **subagent child sessions** to their parent episode: delegate rate, parallel width, parent
  wait, child cost, and child success.
- Report **goals** (`goal/change`) and **work checkpoints** (`work_checkpoint`) as autonomy and
  verification evidence.
- Replace the single activity chart: the session range becomes a **timeline**; day, week, and month
  become **time series**; charts no longer stretch a fixed viewBox or draw a full-width categorical
  bar chart from two buckets.
- Add question-oriented sub-views: **Overview**, **Plugins**, **Tasks**, and **Hypotheses**.
- Add **plugin scorecards** with a declared business goal, activation rate, outcome comparison against
  matched episodes, sample size, and an explicit "association, not proof" label.
- Add **baseline comparison** against the previous equal window and matched cohorts, plus a **data
  sufficiency** verdict; the view must never report "healthy" on thin data.
- Add declarative **hypotheses** (configuration data, never code) evaluated over a window, with
  pre-registered thresholds and an insufficient-data state.

Out of scope for this change: diff churn and rework measured from git, price tables and currency,
per-session configuration or version snapshots, review verdicts, and CSV export. Those remain P2.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `observability`: the capability gains episode-level metrics, token usage, subagent, goal, quality,
  and autonomy reporting; plugin scorecards; baseline comparison; data sufficiency; question-oriented
  sub-views; and chart rendering that matches the shape of the data. Rows gain optional declarative
  `goal` and `eligible` fields.

## Impact

- `packages/plugin-observability` host: record extraction, aggregation, report shape, reader window,
  and route tests.
- `packages/plugin-observability` client: overview layout, session timeline, range series, scorecards,
  tasks and hypotheses sub-views, data-quality strip.
- `packages/setup/defaults.yml` and the generated setup patch: optional goal and eligibility metadata
  for shipped rows; the vendored tree is regenerated.
- Docs: `docs/plugins.md` and `README.md`; new tests use session fixtures.
- No new dependency: inline SVG and theme tokens. Baseline computation reads an earlier equal window
  through the existing session query service; caching stays in memory and is keyed by session identity
  and modification time.
