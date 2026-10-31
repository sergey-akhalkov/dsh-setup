window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-observability",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __export = (target, all) => {
      for (var name in all)
        __defProp(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))
          if (!__hasOwnProp.call(to, key) && key !== except)
            __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // packages/plugin-observability/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      ActivityPanel: () => ActivityPanel,
      BaselineStrip: () => BaselineStrip,
      BlindSpots: () => BlindSpots,
      DataQualityStrip: () => DataQualityStrip,
      DataSufficiency: () => DataSufficiency,
      EN: () => EN,
      EPISODE_TABLE_LIMIT: () => EPISODE_TABLE_LIMIT,
      EpisodeDetail: () => EpisodeDetail,
      FAILURE_SECTION_ID: () => FAILURE_SECTION_ID,
      FailureList: () => FailureList,
      FindingsStrip: () => FindingsStrip,
      HealthBanner: () => HealthBanner,
      HypothesesView: () => HypothesesView,
      KpiStrip: () => KpiStrip,
      MAX_FIX_ENTRY_CHARS: () => MAX_FIX_ENTRY_CHARS,
      MAX_FIX_PROMPT_CHARS: () => MAX_FIX_PROMPT_CHARS,
      MAX_FIX_PROMPT_ENTRIES: () => MAX_FIX_PROMPT_ENTRIES,
      MIN_EPISODES: () => MIN_EPISODES,
      ObservabilityPanel: () => ObservabilityPanel,
      ObservabilityView: () => ObservabilityView,
      OutcomeTiles: () => OutcomeTiles,
      OverviewView: () => OverviewView,
      PluginBoard: () => PluginBoard,
      PluginCard: () => PluginCard,
      ProcessPanel: () => ProcessPanel,
      ProcessSummaryTable: () => ProcessSummaryTable,
      ProcessTimeline: () => ProcessTimeline,
      REPORT_PATH: () => REPORT_PATH,
      RangeSelector: () => RangeSelector,
      RangeSeries: () => RangeSeries,
      SUB_VIEWS: () => SUB_VIEWS,
      ScorecardCard: () => ScorecardCard,
      ScorecardList: () => ScorecardList,
      SessionTimeline: () => SessionTimeline,
      SignalsPanel: () => SignalsPanel,
      Sparkline: () => Sparkline,
      StatusPill: () => StatusPill,
      SubViewTabs: () => SubViewTabs,
      TasksView: () => TasksView,
      TokenMix: () => TokenMix,
      ToolsPanel: () => ToolsPanel,
      apply: () => apply,
      categoryBand: () => categoryBand,
      chartWidth: () => chartWidth,
      counted: () => counted,
      failureCopyText: () => failureCopyText,
      failureFacts: () => failureFacts,
      failureFixPrompt: () => failureFixPrompt,
      hypothesisCopyText: () => hypothesisCopyText,
      inject: () => inject,
      reportUrl: () => reportUrl,
      scorecardStatus: () => scorecardStatus,
      sufficiency: () => sufficiency,
      timeScale: () => timeScale,
      useChartWidth: () => useChartWidth,
      visibleEpisodes: () => visibleEpisodes
    });
    module.exports = __toCommonJS(index_exports);
    var import_react = require("react");
    var import_jsx_runtime = require("react/jsx-runtime");
    var inject = ["slots", "locale"];
    var NS = "dsh-setup-observability";
    var REPORT_PATH = "/plugins/dsh-setup-observability/report";
    var FAILURE_SECTION_ID = "dsh-obs-failures";
    var MAX_FIX_PROMPT_CHARS = 1200;
    var MAX_FIX_PROMPT_ENTRIES = 10;
    var RANGE_OPTIONS = ["session", "day", "week", "month"];
    var SEVERITY_ORDER = ["turn failure", "turn cut", "tool failure"];
    var SEVERITY_KEYS = {
      "turn failure": "severity.turnFailure",
      "turn cut": "severity.turnCut",
      "tool failure": "severity.toolFailure"
    };
    var SUB_VIEWS = ["overview", "plugins", "tasks", "hypotheses"];
    var EPISODE_TABLE_LIMIT = 200;
    var MIN_EPISODES = 10;
    var REPORT_CACHE_MS = 3e4;
    var reportCache = /* @__PURE__ */ new Map();
    var SUB_VIEW_KEYS = {
      overview: "tab.overview",
      plugins: "tab.plugins",
      tasks: "tab.tasks",
      hypotheses: "tab.hypotheses"
    };
    var OUTCOME_KEYS = {
      completed: "outcome.completed",
      failed: "outcome.failed",
      cut: "outcome.cut",
      blocked: "outcome.blocked",
      other: "outcome.other",
      open: "outcome.open"
    };
    var SCORECARD_STATUS_KEYS = {
      "not applicable": "scorecard.notApplicable",
      insufficient: "scorecard.insufficient",
      error: "scorecard.error",
      silent: "scorecard.silent",
      active: "scorecard.active"
    };
    var METRIC_KEYS = {
      "verified-completion-rate": "hypothesis.metric.verifiedCompletionRate",
      "tokens-per-episode": "hypothesis.metric.tokensPerEpisode",
      "context-tokens-per-step": "hypothesis.metric.contextTokensPerStep",
      "active-minutes-per-episode": "hypothesis.metric.activeMinutesPerEpisode",
      "steps-per-human-message": "hypothesis.metric.stepsPerHumanMessage",
      "human-messages-per-completed-goal": "hypothesis.metric.humanMessagesPerCompletedGoal",
      "delegate-rate": "hypothesis.metric.delegateRate",
      "checkpoint-coverage": "hypothesis.metric.checkpointCoverage",
      "failure-rate": "hypothesis.metric.failureRate"
    };
    var HYPOTHESIS_STATUS_KEYS = {
      collecting: "hypothesis.status.collecting",
      supported: "hypothesis.status.supported",
      refuted: "hypothesis.status.refuted",
      inconclusive: "hypothesis.status.inconclusive"
    };
    var READINESS_KEYS = {
      mounted: "readiness.mounted",
      "not mounted": "readiness.notMounted",
      "readiness unknown": "readiness.unknown"
    };
    var EN = {
      "view.label": "Observability",
      "range.label": "Range",
      "range.session": "Session",
      "range.day": "Day",
      "range.week": "Week",
      "range.month": "Month",
      "window.events": "events",
      "window.plugins": "plugins",
      "health.ok": "Everything looks healthy",
      "health.attention": "Something needs attention",
      "health.missing": "A configured tool is not loaded",
      "health.notMounted": "A declared prompt contribution is not mounted",
      "health.notMountedCount": "not mounted",
      "health.active": "active",
      "health.silent": "silent",
      "health.guidance": "guidance-only",
      "health.failure": "failure",
      "health.failures": "failures",
      "kpi.turns": "Turns",
      "kpi.steps": "Steps",
      "kpi.toolCalls": "Tool calls",
      "kpi.failures": "Failures",
      "kpi.turn": "turn",
      "kpi.toolCall": "tool call",
      "kpi.session": "session",
      "chart.events": "events",
      "chart.errors": "errors",
      "legend.events": "Events",
      "legend.errors": "Errors",
      "timeline.title": "Session timeline",
      "timeline.empty": "No activity in this session.",
      "timeline.laneSteps": "Steps",
      "timeline.laneTools": "Tools",
      "timeline.laneHuman": "Human",
      "timeline.laneErrors": "Errors",
      "timeline.turn": "Turn",
      "timeline.step": "step",
      "timeline.call": "call",
      "timeline.error": "error",
      "timeline.humanMessage": "human message",
      "timeline.minute": "m",
      "timeline.second": "s",
      "process.title": "Process",
      "process.empty": "No episodes in this window.",
      "process.noWorkers": "No worker was observed; this is not evidence that decomposition ran.",
      "process.noDecomposition": "No decomposition was observed in this window.",
      "process.activeWorkers": "Active workers",
      "process.decomposition": "Decomposition",
      "process.reflection": "Reflection",
      "process.stepRate": "Steps per bucket",
      "process.workers": "workers",
      "process.episodes": "episodes",
      "process.activations": "worker activations",
      "process.episodesWithWorker": "episodes with a worker",
      "process.maxConcurrency": "maximum concurrent workers",
      "process.timeToFirst": "time to first worker",
      "process.stepsBetween": "steps between reflections",
      "process.reflectionsPerEpisode": "reflections per episode",
      "process.reflectionCoverage": "reflection coverage",
      "process.stepsSince": "steps since the previous reflection",
      "process.metric": "Metric",
      "process.value": "Value",
      "process.p50": "p50",
      "process.p90": "p90",
      "process.n": "n",
      "process.after": "after",
      "process.before": "before",
      "process.comparison": "Compared with",
      "process.interventionAt": "Configured intervention date",
      "process.basisIntervention": "the configured intervention date",
      "series.title": "Activity in the range",
      "series.empty": "No activity in this range.",
      "tokens.title": "Token mix",
      "tokens.cacheRead": "Cache read",
      "tokens.input": "Input",
      "tokens.output": "Output",
      "tokens.empty": "No tokens recorded in this scope.",
      "section.attention": "Needs attention",
      "section.active": "Active",
      "section.silent": "Silent",
      "section.guidance": "Guidance only",
      "section.absence": "No traces in this period; absence is not evidence of a fault.",
      "card.lastActivity": "last activity",
      "card.never": "no traces",
      "card.recent": "Recent traces",
      "card.tools": "Tools",
      "card.errors": "errors",
      "card.showFailures": "View failures",
      "failure.title": "Failures",
      "failure.entry": "entry",
      "failure.entries": "entries",
      "failure.bound": "Showing the newest",
      "failure.of": "of",
      "failure.copy": "Copy list",
      "failure.fix": "Fix in a new session",
      "failure.open": "Open",
      "failure.none": "No failures in this range.",
      "failure.filtered": "Filtered to",
      "failure.clear": "Clear filter",
      "severity.turnFailure": "turn failure",
      "severity.turnCut": "turn cut",
      "severity.toolFailure": "tool failure",
      "entry.recovered": "recovered",
      "readiness.mounted": "mounted",
      "readiness.notMounted": "not mounted",
      "readiness.unknown": "readiness unknown",
      "fix.head": "Investigate and fix these failures recorded by the Observability view.",
      "fix.instructions": "Read the events of each session with the session tools, find the root cause of every failure, and fix it. Add a test that would have caught it. Do not simply retry the failed call.",
      "fix.omitted": "older failures are omitted from this draft.",
      "fix.truncated": "[draft truncated to fit the size bound]",
      "fix.event": "event",
      "tools.title": "Tool calls",
      "tools.empty": "No tool calls in this range.",
      "tools.share": "failed",
      "signals.title": "Injected messages and aborts",
      "status.guidance": "guidance only",
      "status.active": "active",
      "status.error": "error",
      "status.silent": "silent",
      "status.not loaded": "not loaded",
      "tab.label": "Sections",
      "tab.overview": "Overview",
      "tab.plugins": "Plugins",
      "tab.tasks": "Tasks",
      "tab.hypotheses": "Hypotheses",
      "findings.title": "Attention findings",
      "verdict.title": "Data sufficiency",
      "verdict.insufficient": "Insufficient data",
      "verdict.partial": "Partial coverage",
      "verdict.sufficient": "Sufficient for the observed window",
      "verdict.episodes": "episodes",
      "verdict.of": "of",
      "verdict.coverage": "usage coverage",
      "tiles.title": "Outcomes",
      "tile.quality": "Quality",
      "tile.cost": "Cost",
      "tile.speed": "Speed",
      "tile.autonomy": "Autonomy",
      "tile.n": "n",
      "tile.p50": "p50",
      "tile.p90": "p90",
      "tile.verified": "verified",
      "tile.failed": "failed",
      "tile.cutoff": "cutoff",
      "tile.cacheHit": "cache hit",
      "tile.contextPerStep": "context / step",
      "baseline.title": "Compared with",
      "baseline.previousWindow": "previous equal window",
      "baseline.previousSession": "previous completed session",
      "baseline.none": "No baseline data for the previous window.",
      "baseline.n": "episodes",
      "baseline.current": "current",
      "baseline.previous": "baseline",
      "baseline.delta": "delta",
      "baseline.association": "association, not proof",
      "baseline.verified": "verified completions",
      "baseline.failure": "failure rate",
      "baseline.tokens": "tokens per episode",
      "baseline.active": "active minutes",
      "baseline.steps": "steps per human message",
      "tile.humanMessages": "human messages",
      "tile.completed": "completed",
      "cutoff.through": "through cutoff",
      "cutoff.full": "full episode",
      "unit.minutes": "min",
      "unit.tokens": "tokens",
      "unit.steps": "steps",
      "dq.title": "Data quality",
      "dq.steps": "steps with usage",
      "dq.messages": "messages with usage",
      "dq.episodes": "episodes",
      "dq.children": "linked children",
      "dq.unlinked": "unlinked children",
      "dq.goals": "goal events",
      "dq.checkpoints": "checkpoints",
      "dq.unmapped": "unmapped closers",
      "dq.comparison": "comparison sample",
      "dq.partial": "Partial coverage; the metrics above are lower bounds.",
      "scorecards.title": "Plugin scorecards",
      "scorecards.empty": "No signal rows are configured.",
      "scorecard.notApplicable": "not applicable",
      "scorecard.insufficient": "insufficient data",
      "scorecard.error": "error",
      "scorecard.silent": "silent",
      "scorecard.active": "active",
      "scorecard.goal": "Goal",
      "scorecard.noGoal": "No goal declared",
      "scorecard.activation": "Activation",
      "scorecard.of": "of",
      "scorecard.eligible": "eligible",
      "scorecard.firedOutside": "fired outside eligibility; excluded from activation and cohorts",
      "scorecard.primary": "Verified completion",
      "scorecard.errorRate": "error rate",
      "scorecard.primaryNone": "No completed episodes to compare",
      "scorecard.delta": "delta",
      "scorecard.unavailable": "No completed comparison sample",
      "scorecard.matching": "Matched by tool-call bin and local week",
      "scorecard.relaxed": "a size bin was compared across weeks",
      "scorecard.points": "points",
      "scorecard.n": "n",
      "scorecard.insufficientNote": "Below the comparison minimum; no improvement or regression is claimed.",
      "scorecard.noEligibility": "Eligibility is not declared; every episode is eligible.",
      "scorecard.rowDetail": "View plugin row",
      "bar.treated": "treated episodes",
      "bar.control": "control episodes",
      "tasks.title": "Tasks",
      "tasks.outcome": "Outcome",
      "tasks.allOutcomes": "All outcomes",
      "tasks.plugin": "Plugin",
      "tasks.allPlugins": "All plugins",
      "tasks.episodeSpan": "Episode",
      "tasks.empty": "No episodes in this range.",
      "tasks.capped": "Showing the newest",
      "tasks.columnDate": "Date and title",
      "tasks.columnStepsPerHuman": "Steps per human message",
      "tasks.columnSteps": "Steps",
      "tasks.columnTokens": "Tokens (through cutoff)",
      "tasks.columnActive": "Active time",
      "tasks.columnOutcome": "Outcome",
      "tasks.columnVerified": "Verified",
      "tasks.columnSubagents": "Subagents",
      "tasks.columnGoal": "Goal",
      "tasks.columnFailures": "Failures",
      "tasks.verifiedYes": "yes",
      "tasks.verifiedNo": "no",
      "tasks.detail": "Episode detail",
      "tasks.close": "Close",
      "tasks.span": "Span",
      "tasks.tokenPerStep": "Tokens per step",
      "tasks.throughCutoff": "Window cost",
      "tasks.fullEpisode": "Full episode cost",
      "tasks.subagents": "Subagents",
      "tasks.delegateCalls": "Delegate calls",
      "tasks.parallelWidth": "Parallel width",
      "tasks.parentWait": "Parent wait",
      "tasks.goalsRow": "Goals",
      "tasks.checkpoints": "Checkpoints",
      "tasks.checkpointTotal": "total",
      "tasks.checkpointCloses": "closes",
      "tasks.checkpointVerified": "verified",
      "tasks.noChildren": "No child sessions.",
      "tasks.created": "created",
      "tasks.completed": "completed",
      "tasks.rounds": "rounds",
      "tasks.phase": "phase",
      "outcome.completed": "completed",
      "outcome.failed": "failed",
      "outcome.cut": "cut",
      "outcome.blocked": "blocked",
      "outcome.other": "other",
      "outcome.open": "open",
      "hypothesis.title": "Hypotheses",
      "hypothesis.empty": "No hypotheses are configured.",
      "hypothesis.loading": "Reading the comparison windows\u2026",
      "hypothesis.copy": "Copy summary",
      "hypothesis.baseline": "Baseline",
      "hypothesis.current": "Current",
      "hypothesis.threshold": "Threshold",
      "hypothesis.samples": "Samples",
      "hypothesis.window": "Window",
      "hypothesis.guardrail": "Guardrail",
      "hypothesis.regressed": "guardrail regressed",
      "hypothesis.regressedBlock": "Guardrail regressed; support is blocked.",
      "hypothesis.collecting": "Collecting more samples",
      "hypothesis.noBaseline": "no baseline",
      "hypothesis.association": "association, not proof",
      "hypothesis.status.collecting": "collecting",
      "hypothesis.status.supported": "supported in the observed window",
      "hypothesis.status.refuted": "refuted in the observed window",
      "hypothesis.status.inconclusive": "inconclusive in the observed window",
      "hypothesis.metric.verifiedCompletionRate": "Verified completion rate",
      "hypothesis.metric.tokensPerEpisode": "Tokens per episode",
      "hypothesis.metric.contextTokensPerStep": "Context tokens per step",
      "hypothesis.metric.activeMinutesPerEpisode": "Active minutes per episode",
      "hypothesis.metric.stepsPerHumanMessage": "Steps per human message",
      "hypothesis.metric.humanMessagesPerCompletedGoal": "Human messages per completed goal",
      "hypothesis.metric.delegateRate": "Delegate rate",
      "hypothesis.metric.checkpointCoverage": "Checkpoint coverage",
      "hypothesis.metric.failureRate": "Failure rate",
      "state.loading": "Reading session logs\u2026",
      "state.empty": "No sessions recorded activity in this range.",
      "state.error": "The report could not be loaded.",
      "detail.turn": "turn",
      "detail.step": "step",
      "detail.failed": "error",
      "blind.title": "What this view cannot see",
      "time.minute": "m ago",
      "time.hour": "h ago",
      "time.day": "d ago",
      "time.now": "just now"
    };
    function reportUrl(range, sessionId, includeHypotheses = false) {
      const session = sessionId === void 0 || sessionId === "" ? "" : `&session=${encodeURIComponent(sessionId)}`;
      const hypotheses = includeHypotheses ? "&hypotheses=1" : "";
      return `${REPORT_PATH}?range=${range}${session}${hypotheses}`;
    }
    function formatTime(time) {
      return new Date(time).toLocaleString();
    }
    function formatAge(time, now, t) {
      const diff = Math.max(0, now - time);
      if (diff < 6e4) return t("time.now");
      if (diff < 36e5) return `${String(Math.floor(diff / 6e4))}${t("time.minute")}`;
      if (diff < 864e5) return `${String(Math.floor(diff / 36e5))}${t("time.hour")}`;
      return `${String(Math.floor(diff / 864e5))}${t("time.day")}`;
    }
    function counted(count, one, many = `${one}s`) {
      return `${String(count)} ${count === 1 ? one : many}`;
    }
    function chartWidth(entryWidth, fallback) {
      return entryWidth !== void 0 && Number.isFinite(entryWidth) && entryWidth > 0 ? entryWidth : fallback;
    }
    function useChartWidth(fallback = 640) {
      const [node, setNode] = (0, import_react.useState)(null);
      const [width, setWidth] = (0, import_react.useState)(fallback);
      (0, import_react.useEffect)(() => {
        if (node === null || typeof ResizeObserver === "undefined") return void 0;
        const observer = new ResizeObserver((entries) => {
          setWidth(chartWidth(entries[0]?.contentRect.width, fallback));
        });
        observer.observe(node);
        return () => observer.disconnect();
      }, [node, fallback]);
      return { ref: setNode, width };
    }
    function timeScale(from, to, width) {
      if (from === to || width <= 0) return () => 0;
      return (time) => Math.max(0, Math.min(width, (time - from) / (to - from) * width));
    }
    function categoryBand(count, width, maxBarWidth) {
      if (count <= 0 || width <= 0) return { band: 0, bar: 0, offset: 0 };
      const band = width / count;
      const bar = Math.min(maxBarWidth, band * 0.62);
      return { band, bar, offset: (band - bar) / 2 };
    }
    function sessionName(failure) {
      return failure.sessionTitle ?? failure.sessionId.slice(0, 8);
    }
    function failureFacts(failure, t) {
      const facts = [formatTime(failure.time), t(SEVERITY_KEYS[failure.severity])];
      facts.push(sessionName(failure));
      if (failure.turn !== void 0) facts.push(`${t("detail.turn")} ${String(failure.turn)}`);
      if (failure.step !== void 0) facts.push(`${t("detail.step")} ${String(failure.step)}`);
      if (failure.tool !== void 0) facts.push(failure.tool);
      const identity = [failure.errorName, failure.errorCode].filter((value) => value !== void 0).join("/");
      if (identity !== "") facts.push(identity);
      if (failure.recovered) facts.push(t("entry.recovered"));
      return facts;
    }
    function failureCopyText(failures, t) {
      return failures.map((failure) => failureFacts(failure, t).join(" \xB7 ")).join("\n");
    }
    var MAX_FIX_ENTRY_CHARS = 300;
    function fixEntry(failure, t) {
      const locator = `${t("fix.event")} ${String(failure.seq)} \xB7 session ${failure.sessionId}`;
      const text = `- ${locator} \xB7 ${failureFacts(failure, t).join(" \xB7 ")}`;
      if (text.length <= MAX_FIX_ENTRY_CHARS) return text;
      return `${text.slice(0, MAX_FIX_ENTRY_CHARS - 1)}\u2026`;
    }
    function failureFixPrompt(failures, t) {
      const assemble = (shown2) => {
        const lines = [t("fix.head")];
        for (const failure of shown2) lines.push(fixEntry(failure, t));
        if (failures.length > shown2.length) {
          lines.push(`- ${String(failures.length - shown2.length)} ${t("fix.omitted")}`);
        }
        lines.push(t("fix.instructions"));
        return lines.join("\n");
      };
      let shown = failures.slice(0, MAX_FIX_PROMPT_ENTRIES);
      let text = assemble(shown);
      while (text.length > MAX_FIX_PROMPT_CHARS && shown.length > 1) {
        shown = shown.slice(0, -1);
        text = assemble(shown);
      }
      if (text.length <= MAX_FIX_PROMPT_CHARS) return text;
      const boundary = MAX_FIX_PROMPT_CHARS - t("fix.truncated").length - 1;
      return `${text.slice(0, Math.max(0, boundary))}\u2026${t("fix.truncated")}`;
    }
    function copyText(text) {
      const clipboard = typeof navigator === "undefined" ? void 0 : navigator.clipboard;
      if (clipboard === void 0) return;
      void clipboard.writeText(text).catch(() => {
      });
    }
    function focusFailures() {
      if (typeof document === "undefined") return;
      document.getElementById(FAILURE_SECTION_ID)?.focus();
    }
    function optionalWorkspace(ctx) {
      try {
        return ctx.reflect?.get("uiWorkspace") ?? void 0;
      } catch {
        return void 0;
      }
    }
    function byAttention(left, right) {
      const rank = (row) => {
        if (row.status === "error" && row.unrecoveredErrors > 0) return 0;
        if (row.status === "not loaded") return 1;
        if (row.readiness === "not mounted") return 2;
        if (row.status === "active" || row.status === "error") return 3;
        return 4;
      };
      return rank(left) - rank(right) || right.traces - left.traces || left.label.localeCompare(right.label);
    }
    function KpiStrip({
      report,
      t,
      failuresOpen,
      onRevealFailures
    }) {
      const cards = [
        { key: "turns", value: report.totals.turns },
        { key: "steps", value: report.totals.steps },
        { key: "toolCalls", value: report.totals.toolCalls },
        {
          key: "failures",
          value: report.failureTotals.total,
          ...report.failureTotals.total > 0 ? { tone: "error" } : {}
        }
      ];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { className: "dsh-obs-kpis", children: cards.map((card) => {
        const content = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-kpi-label", children: t(`kpi.${card.key}`) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-kpi-value", children: card.value })
        ] });
        return card.key === "failures" && onRevealFailures !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "dsh-obs-kpi",
            "data-kpi": card.key,
            "data-tone": card.tone,
            "aria-expanded": failuresOpen === true,
            "aria-controls": FAILURE_SECTION_ID,
            onClick: onRevealFailures,
            children: content
          },
          card.key
        ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-kpi", "data-kpi": card.key, "data-tone": card.tone, children: content }, card.key);
      }) });
    }
    function HealthBanner({ report, t }) {
      const plugins = report.rows.filter((row) => row.group === "plugin");
      const notLoaded = plugins.filter((row) => row.status === "not loaded");
      const notMounted = plugins.filter((row) => row.readiness === "not mounted");
      const active = plugins.filter((row) => row.status === "active" || row.status === "error").length;
      const silent = plugins.filter((row) => row.status === "silent").length;
      const guidance = plugins.filter((row) => row.kind === "guidance").length;
      const unrecovered = report.failureTotals.toolFailures - report.failureTotals.recovered;
      const failed = report.failureTotals.turnFailures + report.failureTotals.turnCuts + unrecovered;
      const attention = failed > 0 || notLoaded.length > 0 || notMounted.length > 0;
      const headline = failed > 0 ? t("health.attention") : notLoaded.length > 0 ? t("health.missing") : notMounted.length > 0 ? t("health.notMounted") : t("health.ok");
      const summary = `${String(active)} ${t("health.active")} \xB7 ${String(silent)} ${t("health.silent")} \xB7 ${String(guidance)} ${t("health.guidance")}`;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-health", "data-tone": attention ? "attention" : "ok", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-health-dot", "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-health-text", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: headline }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: summary }),
          report.failureTotals.total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-err", children: counted(report.failureTotals.total, t("health.failure"), t("health.failures")) }) : null,
          notMounted.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-err", children: `${String(notMounted.length)} ${t("health.notMountedCount")}` }) : null
        ] })
      ] });
    }
    function clock(time) {
      return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    function formatDuration(ms, t) {
      const total = Math.max(0, Math.round(ms / 1e3));
      const minutes = Math.floor(total / 60);
      const seconds = total % 60;
      return minutes === 0 ? `${String(seconds)}${t("timeline.second")}` : `${String(minutes)}${t("timeline.minute")} ${String(seconds)}${t("timeline.second")}`;
    }
    function SessionTimeline({
      from,
      to,
      turns,
      width,
      t
    }) {
      const measured = useChartWidth();
      const chartWidthPx = width ?? measured.width;
      const height = 96;
      const pad = { left: 46, right: 8, top: 4, bottom: 18 };
      const plotWidth = Math.max(0, chartWidthPx - pad.left - pad.right);
      const laneHeight = (height - pad.top - pad.bottom) / 4;
      const scale = timeScale(from, to, plotWidth);
      const at = (time) => pad.left + scale(time);
      const laneY = (index) => pad.top + laneHeight * (index + 0.5);
      const visible = (span) => span.to >= from && span.from <= to;
      const barLength = (span) => Math.max(1, at(span.to) - at(span.from));
      const timeVisible = (time) => time >= from && time <= to;
      const laneLabels = [
        t("timeline.laneSteps"),
        t("timeline.laneTools"),
        t("timeline.laneHuman"),
        t("timeline.laneErrors")
      ];
      const ticks = [.../* @__PURE__ */ new Set([from, from + (to - from) / 2, to])];
      const activity = turns.some(
        (turn) => turn.steps.length > 0 || turn.tools.length > 0 || turn.human.length > 0 || turn.errors.length > 0 || (turn.stepsCount ?? 0) > 0 || (turn.callsCount ?? 0) > 0
      );
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("timeline.title") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "svg",
          {
            ref: width === void 0 ? measured.ref : void 0,
            className: "dsh-obs-timeline-chart",
            viewBox: `0 0 ${String(chartWidthPx)} ${String(height)}`,
            role: "img",
            "aria-label": t("timeline.title"),
            children: [
              laneLabels.map((label, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-tl-label",
                  x: 2,
                  y: laneY(index) + 4,
                  children: label
                },
                `lane-${String(index)}`
              )),
              turns.flatMap((turn, turnIndex) => [
                ...turn.steps.filter(visible).map((span, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "rect",
                  {
                    className: "dsh-obs-tl-bar",
                    "data-tone": "steps",
                    x: at(span.from),
                    y: laneY(0) - 3,
                    width: barLength(span),
                    height: 6,
                    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${clock(span.from)}\u2013${clock(span.to)} \xB7 ${counted(1, t("timeline.step"))}` })
                  },
                  `${String(turnIndex)}:step:${String(index)}`
                )),
                ...turn.tools.filter(visible).map((span, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "rect",
                  {
                    className: "dsh-obs-tl-bar",
                    "data-tone": "tools",
                    x: at(span.from),
                    y: laneY(1) - 3,
                    width: barLength(span),
                    height: 6,
                    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${clock(span.from)}\u2013${clock(span.to)} \xB7 ${counted(1, t("timeline.call"))}` })
                  },
                  `${String(turnIndex)}:tool:${String(index)}`
                )),
                ...turn.human.filter(timeVisible).map((time, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "line",
                  {
                    className: "dsh-obs-tl-tick",
                    "data-tone": "human",
                    x1: at(time),
                    x2: at(time),
                    y1: laneY(2) - 5,
                    y2: laneY(2) + 5,
                    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${clock(time)} \xB7 ${counted(1, t("timeline.humanMessage"))}` })
                  },
                  `${String(turnIndex)}:human:${String(index)}`
                )),
                ...turn.errors.filter(timeVisible).map((time, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "line",
                  {
                    className: "dsh-obs-tl-tick",
                    "data-tone": "errors",
                    x1: at(time),
                    x2: at(time),
                    y1: laneY(3) - 5,
                    y2: laneY(3) + 5,
                    children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${clock(time)} \xB7 ${counted(1, t("timeline.error"))}` })
                  },
                  `${String(turnIndex)}:error:${String(index)}`
                ))
              ]),
              ticks.map((time, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-axis",
                  x: at(time),
                  y: height - 5,
                  textAnchor: index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle",
                  children: clock(time)
                },
                `axis-${String(time)}`
              )),
              activity ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-chart-empty",
                  x: pad.left + plotWidth / 2,
                  y: laneY(1.5),
                  textAnchor: "middle",
                  children: t("timeline.empty")
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "dsh-obs-turn-rows", children: turns.map((turn, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "li",
          {
            className: "dsh-obs-turn-row",
            "data-turn": turn.turn,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: turn.rowLabel ?? `${t("timeline.turn")} ${String(turn.turn)}` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: formatDuration(turn.end - turn.start, t) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: counted(turn.stepsCount ?? turn.steps.length, t("timeline.step")) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: counted(turn.callsCount ?? turn.tools.length, t("timeline.call")) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { ...turn.errors.length > 0 ? { "data-tone": "error" } : {}, children: counted(turn.errors.length, t("timeline.error")) })
            ]
          },
          `${String(turn.turn)}:${String(index)}`
        )) })
      ] });
    }
    function RangeSeries({
      labels,
      counts,
      errors,
      t
    }) {
      const { ref: measureRef, width } = useChartWidth();
      const height = 140;
      const pad = { left: 28, right: 10, top: 10, bottom: 22 };
      const plotWidth = Math.max(0, width - pad.left - pad.right);
      const plotHeight = height - pad.top - pad.bottom;
      const baseline = pad.top + plotHeight;
      const values = counts.map((count) => Math.max(0, count));
      const max = Math.max(1, ...values);
      const { band, bar, offset } = categoryBand(values.length, plotWidth, 24);
      const labelIndexes = [
        .../* @__PURE__ */ new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])
      ].filter((index) => index >= 0 && index < labels.length);
      const empty = values.length === 0 || values.every((value) => value === 0);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("series.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-legend", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "events", "aria-hidden": "true" }),
              t("legend.events")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "errors", "aria-hidden": "true" }),
              t("legend.errors")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "svg",
          {
            ref: measureRef,
            className: "dsh-obs-series-chart",
            viewBox: `0 0 ${String(width)} ${String(height)}`,
            role: "img",
            "aria-label": t("series.title"),
            children: [
              values.map((count, index) => {
                const failed = Math.min(count, Math.max(0, errors[index] ?? 0));
                const totalHeight = count / max * plotHeight;
                const errorHeight = failed / max * plotHeight;
                const label = labels[index] ?? String(index + 1);
                const x = pad.left + index * band + offset;
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${label}: ${String(count)} ${t("chart.events")} \xB7 ${String(failed)} ${t("chart.errors")}` }),
                  count > failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "rect",
                    {
                      className: "dsh-obs-bar",
                      "data-tone": "events",
                      x,
                      y: baseline - totalHeight + errorHeight,
                      width: bar,
                      height: totalHeight - errorHeight
                    }
                  ) : null,
                  errorHeight > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "rect",
                    {
                      className: "dsh-obs-bar",
                      "data-tone": "errors",
                      x,
                      y: baseline - totalHeight,
                      width: bar,
                      height: errorHeight
                    }
                  ) : null
                ] }, `${label}:${String(index)}`);
              }),
              labelIndexes.map((index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-axis",
                  x: pad.left + index * band + band / 2,
                  y: height - 6,
                  textAnchor: index === 0 ? "start" : index === values.length - 1 ? "end" : "middle",
                  children: labels[index] ?? ""
                },
                `label-${String(index)}`
              )),
              empty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-chart-empty",
                  x: pad.left + plotWidth / 2,
                  y: pad.top + plotHeight / 2,
                  textAnchor: "middle",
                  children: t("series.empty")
                }
              ) : null
            ]
          }
        )
      ] });
    }
    function processDistributionText(distribution, kind, t) {
      if (distribution.n === 0) return "\u2014";
      const show = (value) => kind === "minutes" ? minutesText(value / 6e4, t) : `${String(Math.round(value))} ${t("unit.steps")}`;
      return `${t("process.p50")} ${show(distribution.p50)} \xB7 ${t("process.p90")} ${show(distribution.p90)} \xB7 ${t("process.n")} ${String(distribution.n)}`;
    }
    function processMetricRows(t) {
      return [
        {
          key: "workers",
          label: "process.workers",
          value: (summary) => String(summary.workers)
        },
        {
          key: "episodesWithWorker",
          label: "process.episodesWithWorker",
          value: (summary) => String(summary.episodesWithWorker)
        },
        {
          key: "activations",
          label: "process.activations",
          value: (summary) => String(summary.activations)
        },
        {
          key: "maxConcurrency",
          label: "process.maxConcurrency",
          value: (summary) => String(summary.maxConcurrency)
        },
        {
          key: "timeToFirst",
          label: "process.timeToFirst",
          value: (summary) => processDistributionText(summary.timeToFirstWorker, "minutes", t)
        },
        {
          key: "stepsBetween",
          label: "process.stepsBetween",
          value: (summary) => processDistributionText(summary.stepsBetweenReflections, "steps", t)
        },
        {
          key: "reflectionsPerEpisode",
          label: "process.reflectionsPerEpisode",
          value: (summary) => summary.reflectionsPerEpisode === void 0 ? "\u2014" : summary.reflectionsPerEpisode.toFixed(1)
        },
        {
          key: "reflectionCoverage",
          label: "process.reflectionCoverage",
          value: (summary) => summary.reflectionCoverage === void 0 ? "\u2014" : percent(summary.reflectionCoverage)
        }
      ];
    }
    function processBasisLabel(basis, t) {
      if (basis === "intervention date") return t("process.basisIntervention");
      return t(
        basis === "previous equal window" ? "baseline.previousWindow" : "baseline.previousSession"
      );
    }
    function formatIntervention(time) {
      return new Date(time).toLocaleDateString();
    }
    function ProcessTimeline({
      process,
      labels,
      t
    }) {
      const measured = useChartWidth();
      const width = measured.width;
      const height = 170;
      const pad = { left: 44, right: 8, top: 8, bottom: 18 };
      const plotWidth = Math.max(0, width - pad.left - pad.right);
      const scale = timeScale(process.from, process.to, plotWidth);
      const at = (time) => pad.left + scale(time);
      const concurrencyTop = pad.top;
      const concurrencyBottom = 98;
      const stripTop = 116;
      const stripBottom = 140;
      const peak = Math.max(0, ...process.concurrency.map((point) => point.active));
      const maxActive = Math.max(1, peak);
      const activeY = (active) => concurrencyBottom - Math.max(0, active) / maxActive * (concurrencyBottom - concurrencyTop);
      const ordered = [...process.concurrency].sort((left, right) => left.time - right.time);
      const stepPath = ordered.length === 0 ? void 0 : `M ${String(at(process.from))} ${String(activeY(0))}${ordered.map((point) => ` H ${String(at(point.time))} V ${String(activeY(point.active))}`).join("")} H ${String(at(process.to))}`;
      const maxSteps = Math.max(1, ...process.stepRate.map((bucket) => bucket.steps));
      const band = process.stepRate.length === 0 ? 0 : plotWidth / process.stepRate.length;
      const ticks = [
        .../* @__PURE__ */ new Set([process.from, process.from + (process.to - process.from) / 2, process.to])
      ];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "svg",
        {
          ref: measured.ref,
          className: "dsh-obs-process-chart",
          viewBox: `0 0 ${String(width)} ${String(height)}`,
          role: "img",
          "aria-label": t("process.title"),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { className: "dsh-obs-tl-label", x: 2, y: concurrencyTop + 10, children: t("process.activeWorkers") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { className: "dsh-obs-tl-label", x: 2, y: stripTop + 16, children: t("process.stepRate") }),
            Array.from({ length: peak + 1 }, (_unused, workers) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "text",
              {
                className: "dsh-obs-axis dsh-obs-process-tick",
                x: pad.left - 4,
                y: activeY(workers) + 4,
                textAnchor: "end",
                children: String(workers)
              },
              `workers-${String(workers)}`
            )),
            stepPath === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { className: "dsh-obs-process-line", d: stepPath, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${t("process.activeWorkers")}: ${t("process.maxConcurrency")} ${String(peak)}` }) }),
            process.decomposition.map((marker, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "line",
              {
                className: "dsh-obs-process-marker",
                "data-tone": "decomposition",
                x1: at(marker.time),
                x2: at(marker.time),
                y1: concurrencyTop,
                y2: concurrencyBottom,
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${formatTime(marker.time)} \xB7 ${t("process.decomposition")} \xB7 ${String(marker.workers)} ${t("process.workers")} \xB7 ${marker.episodeId}` })
              },
              `decomposition-${String(index)}`
            )),
            process.reflections.map((marker, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "line",
              {
                className: "dsh-obs-process-marker",
                "data-tone": "reflection",
                x1: at(marker.time),
                x2: at(marker.time),
                y1: concurrencyTop,
                y2: concurrencyBottom,
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${formatTime(marker.time)} \xB7 ${t("process.reflection")} \xB7 ${marker.outcome} \xB7 ${String(marker.stepsSince)} ${t("process.stepsSince")} \xB7 ${marker.episodeId}` })
              },
              `reflection-${String(index)}`
            )),
            process.stepRate.map((bucket, index) => {
              const timed = bucket.from > 0 && bucket.to > 0;
              const x = timed ? at(bucket.from) : pad.left + index * band;
              const width2 = timed ? Math.max(1, at(bucket.to) - x - 1) : Math.max(1, band - 1);
              const top = stripBottom - Math.max(0, bucket.steps) / maxSteps * (stripBottom - stripTop);
              return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "rect",
                {
                  className: "dsh-obs-process-step",
                  x,
                  y: top,
                  width: width2,
                  height: stripBottom - top,
                  children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${labels[index] ?? String(index + 1)}: ${String(bucket.steps)} ${t("unit.steps")}` })
                },
                `bucket-${String(index)}`
              );
            }),
            ticks.map((time, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "text",
              {
                className: "dsh-obs-axis",
                x: at(time),
                y: height - 5,
                textAnchor: index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle",
                children: clock(time)
              },
              `axis-${String(time)}`
            )),
            process.summary.workers === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "text",
              {
                className: "dsh-obs-chart-empty",
                x: pad.left + plotWidth / 2,
                y: (concurrencyTop + concurrencyBottom) / 2,
                textAnchor: "middle",
                children: t("process.noWorkers")
              }
            ) : null
          ]
        }
      );
    }
    function ProcessSummaryTable({
      process,
      t
    }) {
      const comparison = process.comparison;
      const rows = processMetricRows(t);
      const episodes = (summary) => `${String(summary.episodes)} ${t("process.episodes")}`;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "table",
        {
          className: "dsh-obs-table dsh-obs-process-summary",
          "data-insufficient": comparison?.status === "insufficient" ? "true" : void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("process.metric") }),
              comparison === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: `${t("process.value")} (${episodes(process.summary)})` }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: `${t("process.after")} (${episodes(comparison.after.summary)})` }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: `${t("process.before")} (${episodes(comparison.before.summary)})` })
              ] })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { "data-process-metric": row.key, children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t(row.label) }),
              comparison === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.value(process.summary) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.value(comparison.after.summary) }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.value(comparison.before.summary) })
              ] })
            ] }, row.key)) })
          ]
        }
      );
    }
    function ProcessPanel({
      process,
      labels,
      t
    }) {
      const comparison = process.comparison;
      const intervention = comparison?.interventionAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", "data-process-intervention": "true", children: `${t("process.interventionAt")}: ${formatIntervention(comparison.interventionAt)}` });
      if (process.summary.episodes === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("process.title"), "data-process": "empty", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("process.title") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("process.empty") }),
          intervention
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("process.title"), "data-process": "timeline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("process.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-legend", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "workers", "aria-hidden": "true" }),
              t("process.activeWorkers")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "decomposition", "aria-hidden": "true" }),
              t("process.decomposition")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "reflection", "aria-hidden": "true" }),
              t("process.reflection")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProcessTimeline, { process, labels, t }),
        comparison === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "p",
          {
            className: "dsh-obs-muted",
            "data-process-comparison": comparison.basis,
            "data-process-status": comparison.status,
            children: `${t("process.comparison")} ${processBasisLabel(comparison.basis, t)} \xB7 ${comparison.label}`
          }
        ),
        intervention,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProcessSummaryTable, { process, t }),
        process.summary.decompositionObserved ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("process.noDecomposition") })
      ] });
    }
    function TokenMix({
      cacheRead,
      input,
      output,
      t
    }) {
      const parts = [
        { key: "cacheRead", label: t("tokens.cacheRead"), value: Math.max(0, cacheRead) },
        { key: "input", label: t("tokens.input"), value: Math.max(0, input) },
        { key: "output", label: t("tokens.output"), value: Math.max(0, output) }
      ];
      const total = parts.reduce((sum, part) => sum + part.value, 0);
      const share = (value) => total === 0 ? 0 : value * 100 / total;
      let filled = 0;
      const segments = parts.map((part) => {
        const before = filled;
        filled += share(part.value);
        return { ...part, x: before, width: share(part.value) };
      });
      const caption = parts.map((part) => `${part.label} ${String(Math.round(share(part.value)))}%`).join(" \xB7 ");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("tokens.title") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-token-track", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "svg",
          {
            className: "dsh-obs-token-bar",
            height: 10,
            role: "img",
            "aria-label": `${t("tokens.title")}: ${caption}`,
            children: segments.map(
              (segment) => segment.width > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "rect",
                {
                  "data-tone": segment.key,
                  x: `${String(segment.x)}%`,
                  y: 0,
                  width: `${String(segment.width)}%`,
                  height: 10
                },
                segment.key
              ) : null
            )
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-token-caption", children: parts.map((part, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-token-key", children: [
          index > 0 ? " \xB7 " : "",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": part.key, "aria-hidden": "true" }),
          `${part.label} ${String(Math.round(share(part.value)))}%`
        ] }, part.key)) }),
        total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("tokens.empty") }) : null
      ] });
    }
    var EPISODE_OUTCOMES = [
      "completed",
      "failed",
      "cut",
      "blocked",
      "other",
      "open"
    ];
    function shortSessionId(sessionId) {
      return sessionId.slice(0, 8);
    }
    function percent(value) {
      return value === void 0 ? "\u2014" : `${String(Math.round(value * 100))}%`;
    }
    function minutesText(value, t) {
      return `${value.toFixed(1)} ${t("unit.minutes")}`;
    }
    function SubViewTabs({
      view,
      t,
      onView
    }) {
      const index = SUB_VIEWS.indexOf(view);
      const select = (next) => {
        const option = SUB_VIEWS[(next + SUB_VIEWS.length) % SUB_VIEWS.length];
        if (option === void 0) return;
        onView(option);
        if (typeof document !== "undefined") document.getElementById(`dsh-obs-tab-${option}`)?.focus();
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-tabs", role: "tablist", "aria-label": t("tab.label"), children: SUB_VIEWS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          role: "tab",
          id: `dsh-obs-tab-${option}`,
          className: "dsh-obs-tab",
          "aria-selected": option === view,
          "aria-controls": `dsh-obs-panel-${option}`,
          tabIndex: option === view ? 0 : -1,
          onClick: () => onView(option),
          onKeyDown: (event) => {
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
              event.preventDefault();
              select(index + 1);
            } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
              event.preventDefault();
              select(index - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              select(0);
            } else if (event.key === "End") {
              event.preventDefault();
              select(SUB_VIEWS.length - 1);
            }
          },
          children: t(SUB_VIEW_KEYS[option])
        },
        option
      )) });
    }
    function sufficiency(report) {
      const data = report.dataQuality;
      if (report.quality.episodes < report.minEpisodes) return "insufficient";
      const silent = report.rows.filter((row) => row.group === "plugin" && row.status === "silent");
      const emptyEligibility = silent.some((row) => {
        const card = report.scorecards.find((entry) => entry.rowId === row.id);
        return card !== void 0 && card.eligibilityDeclared && card.eligible === 0;
      });
      if (emptyEligibility) return "insufficient";
      if (data.steps === 0 || data.messages === 0) return "partial";
      if (data.stepsWithUsage < data.steps || data.messagesWithUsage < data.messages) return "partial";
      if (data.unlinkedChildren > 0 || data.unmappedClosers > 0) return "partial";
      return "sufficient";
    }
    function DataSufficiency({ report, t }) {
      const status = sufficiency(report);
      const data = report.dataQuality;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "section",
        {
          className: "dsh-obs-health",
          "data-tone": status === "sufficient" ? "ok" : "attention",
          "data-sufficiency": status,
          "aria-label": t("verdict.title"),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-health-dot", "aria-hidden": "true" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-health-text", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t(`verdict.${status}`) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(report.quality.episodes)} ${t("verdict.episodes")} ${t("verdict.of")} ${String(report.minEpisodes)}` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(Math.round(data.usageCoverage * 100))}% ${t("verdict.coverage")}` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: counted(report.failureTotals.total, t("health.failure"), t("health.failures")) })
            ] })
          ]
        }
      );
    }
    function OutcomeTiles({ report, t }) {
      const quality = report.quality;
      const cost = report.cost;
      const speed = report.speed;
      const autonomy = report.autonomy;
      const tiles = [
        {
          key: "quality",
          label: t("tile.quality"),
          n: quality.episodes,
          values: [
            { label: t("tile.verified"), value: percent(quality.verifiedShare) },
            { label: t("tile.failed"), value: percent(quality.failureRate) },
            { label: t("tile.completed"), value: String(quality.completed) },
            {
              label: t("tile.p50"),
              value: quality.stepsToCompletion.n === 0 ? "\u2014" : `${String(Math.round(quality.stepsToCompletion.p50))} ${t("unit.steps")}`
            },
            {
              label: t("tile.p90"),
              value: quality.stepsToCompletion.n === 0 ? "\u2014" : `${String(Math.round(quality.stepsToCompletion.p90))} ${t("unit.steps")}`
            }
          ],
          note: `${t("tile.n")} ${String(quality.stepsToCompletion.n)} ${t("tile.completed")}`
        },
        {
          key: "cost",
          label: t("tile.cost"),
          n: cost.tokensPerEpisode.n,
          values: [
            { label: t("tile.p50"), value: String(Math.round(cost.tokensPerEpisode.p50)) },
            { label: t("tile.p90"), value: String(Math.round(cost.tokensPerEpisode.p90)) },
            { label: t("tile.cacheHit"), value: percent(cost.cacheHitRatio) },
            { label: t("tile.contextPerStep"), value: String(Math.round(cost.contextPerStep)) }
          ],
          note: `${t("tile.cutoff")}: ${t(cost.cutoffLabel === "through cutoff" ? "cutoff.through" : "cutoff.full")}`
        },
        {
          key: "speed",
          label: t("tile.speed"),
          n: speed.n,
          values: [
            { label: t("tile.p50"), value: minutesText(speed.activeMinutes.p50, t) },
            { label: t("tile.p90"), value: minutesText(speed.activeMinutes.p90, t) }
          ]
        },
        {
          key: "autonomy",
          label: t("tile.autonomy"),
          n: autonomy.episodes,
          values: [
            {
              label: t("tile.p50"),
              value: `${autonomy.stepsPerHumanMessage.p50.toFixed(1)} ${t("unit.steps")}`
            },
            {
              label: t("tile.p90"),
              value: `${autonomy.stepsPerHumanMessage.p90.toFixed(1)} ${t("unit.steps")}`
            }
          ],
          note: `${String(autonomy.humanMessages)} ${t("tile.humanMessages")}`
        }
      ];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", "aria-label": t("tiles.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("tiles.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-tiles", children: tiles.map((tile) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "dsh-obs-tile", "data-tile": tile.key, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-tile-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tile.label }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `${t("tile.n")} ${String(tile.n)}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", { children: tile.values.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: value.label }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: value.value })
          ] }, value.label)) }),
          tile.note === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted dsh-obs-tile-note", children: tile.note })
        ] }, tile.key)) })
      ] });
    }
    function BaselineStrip({ report, t }) {
      const baseline = report.baseline;
      const format = (value, kind) => {
        if (value === void 0) return "\u2014";
        if (kind === "percent") return percent(value);
        if (kind === "minutes") return minutesText(value, t);
        if (kind === "decimal") return value.toFixed(1);
        return String(Math.round(value));
      };
      if (baseline === void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("baseline.title"), "data-baseline": "none", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("baseline.title") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("baseline.none") })
        ] });
      }
      const rows = [
        {
          key: "verified",
          label: t("baseline.verified"),
          current: report.quality.verifiedShare,
          previous: baseline.quality.verifiedShare,
          kind: "percent"
        },
        {
          key: "failure",
          label: t("baseline.failure"),
          current: report.quality.failureRate,
          previous: baseline.quality.failureRate,
          kind: "percent"
        },
        {
          key: "tokens",
          label: t("baseline.tokens"),
          current: report.cost.tokensPerEpisode.p50,
          previous: baseline.cost.tokensPerEpisode.p50,
          kind: "number"
        },
        {
          key: "active",
          label: t("baseline.active"),
          current: report.speed.activeMinutes.p50,
          previous: baseline.speed.activeMinutes.p50,
          kind: "minutes"
        },
        {
          key: "steps",
          label: t("baseline.steps"),
          current: report.autonomy.stepsPerHumanMessage.p50,
          previous: baseline.autonomy.stepsPerHumanMessage.p50,
          kind: "decimal"
        }
      ];
      const insufficient = report.quality.episodes < report.minEpisodes || baseline.episodes < report.minEpisodes;
      const deltaText = (row) => {
        if (row.current === void 0 || row.previous === void 0) return void 0;
        const diff = row.current - row.previous;
        const sign = diff >= 0 ? "+" : "\u2212";
        const value = row.kind === "percent" ? `${sign}${String(Math.round(Math.abs(diff) * 100))} ${t("scorecard.points")}` : row.kind === "number" ? `${sign}${String(Math.round(Math.abs(diff)))}` : row.kind === "minutes" ? `${sign}${Math.abs(diff).toFixed(1)} ${t("unit.minutes")}` : `${sign}${Math.abs(diff).toFixed(1)}`;
        return `${t("baseline.delta")} ${value}`;
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "section",
        {
          className: "dsh-obs-panel",
          "aria-label": t("baseline.title"),
          "data-baseline": baseline.kind,
          "data-insufficient": insufficient ? "true" : void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("baseline.title") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: t(
                baseline.kind === "previous equal window" ? "baseline.previousWindow" : "baseline.previousSession"
              ) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: `${t("baseline.n")} ${String(report.quality.episodes)} ${t("baseline.current")} \xB7 ${String(baseline.episodes)} ${t("baseline.previous")}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dl", { className: "dsh-obs-compare", children: rows.map((row) => {
              const delta = deltaText(row);
              return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: row.label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${format(row.current, row.kind)} ${t("baseline.current")} \xB7 ${format(row.previous, row.kind)} ${t("baseline.previous")}${delta === void 0 ? "" : ` \xB7 ${delta}`}` })
              ] }, row.key);
            }) }),
            insufficient ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("scorecard.insufficientNote") }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("baseline.association") })
          ]
        }
      );
    }
    function ActivityPanel({ report, t }) {
      if (report.range === "session" && report.timeline !== void 0) {
        const timeline = report.timeline;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          SessionTimeline,
          {
            from: timeline.from,
            to: timeline.to,
            turns: timeline.turns.map((turn) => ({
              turn: turn.turn,
              start: turn.start,
              end: turn.end,
              steps: turn.steps,
              tools: turn.tools,
              human: turn.human,
              errors: turn.errors,
              stepsCount: turn.stepsCount,
              callsCount: turn.callsCount
            })),
            t
          }
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        RangeSeries,
        {
          labels: report.bucketLabels,
          counts: report.activity,
          errors: report.errorSeries,
          t
        }
      );
    }
    function DataQualityStrip({ report, t }) {
      const data = report.dataQuality;
      const facts = [
        { label: t("dq.steps"), value: `${String(data.stepsWithUsage)}/${String(data.steps)}` },
        {
          label: t("dq.messages"),
          value: `${String(data.messagesWithUsage)}/${String(data.messages)}`
        },
        { label: t("dq.episodes"), value: String(data.episodes) },
        { label: t("dq.children"), value: String(data.linkedChildren) },
        { label: t("dq.unlinked"), value: String(data.unlinkedChildren) },
        { label: t("dq.goals"), value: String(data.goalEvents) },
        { label: t("dq.checkpoints"), value: String(data.checkpoints) },
        { label: t("dq.unmapped"), value: String(data.unmappedClosers) },
        { label: t("dq.comparison"), value: String(data.comparisonSample) }
      ];
      const partial = data.stepsWithUsage < data.steps || data.messagesWithUsage < data.messages || data.unlinkedChildren > 0 || data.unmappedClosers > 0;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("dq.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("dq.title") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-dq", children: facts.map((fact) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fact.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: fact.value })
        ] }, fact.label)) }),
        partial ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("dq.partial") }) : null
      ] });
    }
    function scorecardStatus(card) {
      if (card.eligible === 0) return "not applicable";
      if (card.fired === 0) return "silent";
      if ((card.errorRate ?? 0) > 0) return "error";
      if (card.insufficient) return "insufficient";
      return "active";
    }
    function ScoreBars({
      treated,
      control,
      t
    }) {
      if (treated === void 0 || control === void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("scorecard.unavailable") });
      }
      const values = [control, treated];
      const labels = [t("bar.control"), t("bar.treated")];
      const max = Math.max(1, ...values);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "svg",
        {
          className: "dsh-obs-spark",
          viewBox: "0 0 120 24",
          role: "img",
          "aria-label": t("scorecard.primary"),
          children: values.map((value, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${labels[index] ?? ""}: ${percent(value)}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "rect",
              {
                x: index * 60 + 8,
                y: 24 - value / max * 22,
                width: 44,
                height: value / max * 22
              }
            )
          ] }, labels[index] ?? String(index)))
        }
      );
    }
    function ScorecardCard({
      card,
      t,
      onOpenRow
    }) {
      const status = scorecardStatus(card);
      const treated = card.treated.verifiedShare;
      const control = card.control.verifiedShare;
      const delta = treated === void 0 || control === void 0 ? void 0 : treated - control;
      const activation = card.activation === void 0 ? "\u2014" : percent(card.activation);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "dsh-obs-card", "data-card": card.rowId, "data-status": status, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-card-name", children: card.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": status, children: t(SCORECARD_STATUS_KEYS[status]) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-score-goal", children: `${t("scorecard.goal")}: ${card.goal ?? t("scorecard.noGoal")}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-card-metrics", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${t("scorecard.activation")} ${activation}` }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(card.fired)} ${t("scorecard.of")} ${String(card.eligible)} ${t("scorecard.eligible")}` }),
          card.errorRate === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-err", children: `${t("scorecard.errorRate")} ${percent(card.errorRate)}` })
        ] }),
        card.firedOutside > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-err", children: `${String(card.firedOutside)} ${t("scorecard.firedOutside")}` }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-card-metrics", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("scorecard.primary") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: treated === void 0 ? t("scorecard.primaryNone") : `${percent(treated)} ${t("scorecard.of")} ${percent(control)}` }),
          delta === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${t("scorecard.delta")} ${delta >= 0 ? "+" : "\u2212"}${String(Math.round(Math.abs(delta) * 100))} ${t("scorecard.points")}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScoreBars, { treated, control, t }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: `${t("scorecard.n")} ${String(card.treated.n)} ${t("scorecard.treated")} \xB7 ${String(card.control.n)} ${t("scorecard.control")}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: `${t("scorecard.matching")}${card.weekRelaxed ? ` \xB7 ${t("scorecard.relaxed")}` : ""}` }),
        card.insufficient ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("scorecard.insufficientNote") }) : null,
        card.eligibilityDeclared ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("scorecard.noEligibility") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: card.association }),
        onOpenRow === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-obs-link", onClick: () => onOpenRow(card.rowId), children: t("scorecard.rowDetail") })
      ] });
    }
    function ScorecardList({
      scorecards,
      t,
      onOpenRow
    }) {
      if (scorecards.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("scorecards.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("scorecards.empty") })
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", "aria-label": t("scorecards.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("scorecards.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-grid", children: scorecards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScorecardCard, { card, t, onOpenRow }, card.rowId)) })
      ] });
    }
    var TASK_COLUMNS = [
      { key: "start", label: "tasks.columnDate" },
      { key: "stepsPerHuman", label: "tasks.columnStepsPerHuman" },
      { key: "steps", label: "tasks.columnSteps" },
      { key: "tokens", label: "tasks.columnTokens" },
      { key: "active", label: "tasks.columnActive" },
      { key: "outcome", label: "tasks.columnOutcome" },
      { key: "verified", label: "tasks.columnVerified" },
      { key: "subagents", label: "tasks.columnSubagents" },
      { key: "goal", label: "tasks.columnGoal" },
      { key: "failures", label: "tasks.columnFailures" }
    ];
    function stepsPerHuman(episode) {
      return episode.humanMessages === 0 ? 0 : episode.steps / episode.humanMessages;
    }
    function taskSortValue(episode, key) {
      switch (key) {
        case "stepsPerHuman":
          return stepsPerHuman(episode);
        case "steps":
          return episode.steps;
        case "tokens":
          return episode.throughCutoffUsage.total;
        case "active":
          return episode.activeMs;
        case "outcome":
          return episode.outcome;
        case "verified":
          return episode.verified ? 1 : 0;
        case "subagents":
          return episode.children.length;
        case "goal":
          return episode.goals.created;
        case "failures":
          return episode.failures;
        default:
          return episode.start;
      }
    }
    function visibleEpisodes(episodes, outcome, plugin, sort) {
      const filtered = episodes.filter((episode) => outcome === "all" || episode.outcome === outcome).filter((episode) => plugin === "all" || episode.firedRows.includes(plugin));
      filtered.sort((left, right) => {
        const a = taskSortValue(left, sort.key);
        const b = taskSortValue(right, sort.key);
        const order = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
        return order * sort.direction || left.start - right.start;
      });
      return filtered.slice(0, EPISODE_TABLE_LIMIT);
    }
    function EpisodeDetail({
      episode,
      t,
      onClose
    }) {
      const lane = episode.timeline;
      const turns = [
        {
          turn: 1,
          start: lane.from,
          end: lane.to,
          steps: lane.steps,
          tools: lane.tools,
          human: lane.human,
          errors: lane.errors,
          stepsCount: lane.stepsCount,
          callsCount: lane.callsCount,
          rowLabel: t("tasks.episodeSpan")
        }
      ];
      const perStep = episode.steps === 0 ? 0 : Math.round(episode.usage.total / Math.max(1, episode.steps));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "section",
        {
          className: "dsh-obs-panel",
          "aria-label": t("tasks.detail"),
          "data-episode-detail": episode.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: `${t("tasks.detail")} \xB7 ${episode.sessionTitle ?? shortSessionId(episode.sessionId)}` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-obs-link", onClick: onClose, children: t("tasks.close") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: `${formatTime(episode.start)} \u2013 ${formatTime(episode.end)} \xB7 ${formatDuration(episode.durationMs, t)}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { className: "dsh-obs-facts", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.span") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatDuration(episode.durationMs, t) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.tokenPerStep") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(perStep) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: `${t("tasks.throughCutoff")} (${t("cutoff.through")})` }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(episode.throughCutoffUsage.total) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: `${t("tasks.fullEpisode")} (${t("cutoff.full")})` }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(episode.fullUsage.total) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.delegateCalls") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(episode.delegateCalls) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.parallelWidth") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: String(episode.parallelWidth) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.parentWait") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: formatDuration(episode.parentWaitMs, t) })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.goalsRow") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${String(episode.goals.created)} ${t("tasks.created")} \xB7 ${String(episode.goals.completed)} ${t("tasks.completed")} \xB7 ${String(episode.goals.rounds)} ${t("tasks.rounds")}${episode.goals.phase === void 0 ? "" : ` \xB7 ${episode.goals.phase}`}` })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("tasks.checkpoints") }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${String(episode.checkpoints.total)} ${t("tasks.checkpointTotal")} \xB7 ${String(episode.checkpoints.closes)} ${t("tasks.checkpointCloses")} \xB7 ${String(episode.checkpoints.verified)} ${t("tasks.checkpointVerified")}` })
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("tasks.subagents") }),
            episode.children.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("tasks.noChildren") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-dq", children: episode.children.map((child) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${child.sessionTitle ?? shortSessionId(child.sessionId)} \xB7 ${t(OUTCOME_KEYS[child.outcome])}${child.verified ? ` \xB7 ${t("tasks.verifiedYes")}` : ""}` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(child.toolCalls)} ${t("kpi.toolCall")} \xB7 ${String(child.usage.total)} ${t("unit.tokens")}` })
            ] }, child.sessionId)) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SessionTimeline, { from: lane.from, to: lane.to, turns, t })
          ]
        }
      );
    }
    function TasksView({
      report,
      t,
      sort,
      outcome,
      plugin,
      selectedId,
      onSort,
      onOutcome,
      onPlugin,
      onSelect
    }) {
      const rows = visibleEpisodes(report.episodes, outcome, plugin, sort);
      const selected = selectedId === void 0 ? void 0 : report.episodes.find((episode) => episode.id === selectedId);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("tasks.title"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("tasks.title") }),
            report.episodes.length > EPISODE_TABLE_LIMIT || report.episodeCount > EPISODE_TABLE_LIMIT ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `${t("tasks.capped")} ${String(rows.length)} ${t("failure.of")} ${String(report.episodeCount)}` }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `${String(rows.length)} ${t("failure.of")} ${String(report.episodeCount)}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-task-controls", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              t("tasks.outcome"),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                "select",
                {
                  value: outcome,
                  onChange: (event) => onOutcome(event.currentTarget.value),
                  children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: t("tasks.allOutcomes") }),
                    EPISODE_OUTCOMES.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: option, children: t(OUTCOME_KEYS[option]) }, option))
                  ]
                }
              )
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              t("tasks.plugin"),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { value: plugin, onChange: (event) => onPlugin(event.currentTarget.value), children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "all", children: t("tasks.allPlugins") }),
                report.scorecards.map((card) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: card.rowId, children: card.label }, card.rowId))
              ] })
            ] })
          ] }),
          rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("tasks.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-table-wrap", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dsh-obs-table", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tr", { children: TASK_COLUMNS.map((column) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "th",
              {
                "aria-sort": sort.key === column.key ? sort.direction === 1 ? "ascending" : "descending" : "none",
                children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => onSort(column.key), children: t(column.label) })
              },
              column.key
            )) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((episode) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "tr",
              {
                "data-episode": episode.id,
                "data-outcome": episode.outcome,
                "data-selected": selectedId === episode.id ? "true" : void 0,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      className: "dsh-obs-link",
                      onClick: () => onSelect(episode.id),
                      children: `${new Date(episode.start).toLocaleDateString()} \xB7 ${episode.sessionTitle ?? shortSessionId(episode.sessionId)}`
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: stepsPerHuman(episode).toFixed(1) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: String(episode.steps) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: String(episode.throughCutoffUsage.total) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: minutesText(episode.activeMs / 6e4, t) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t(OUTCOME_KEYS[episode.outcome]) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: episode.verified ? t("tasks.verifiedYes") : t("tasks.verifiedNo") }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: String(episode.children.length) }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: episode.goals.created === 0 ? "\u2014" : `${String(episode.goals.created)} \xB7 ${episode.goals.phase ?? t("tasks.phase")}` }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: String(episode.failures) })
                ]
              },
              episode.id
            )) })
          ] }) })
        ] }),
        selected === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EpisodeDetail, { episode: selected, t, onClose: () => onSelect(void 0) })
      ] });
    }
    function metricText(metric, value, t) {
      if (value === void 0) return "\u2014";
      switch (metric) {
        case "verified-completion-rate":
        case "delegate-rate":
        case "checkpoint-coverage":
        case "failure-rate":
          return `${String(Math.round(value * 100))}%`;
        case "active-minutes-per-episode":
          return minutesText(value, t);
        case "tokens-per-episode":
        case "context-tokens-per-step":
          return String(Math.round(value));
        default:
          return value.toFixed(1);
      }
    }
    function hypothesisCopyText(results, t) {
      return results.map((result) => {
        const parts = [
          t(METRIC_KEYS[result.metric]),
          t(HYPOTHESIS_STATUS_KEYS[result.status]),
          `${t("hypothesis.baseline")} ${metricText(result.metric, result.baseline, t)}`,
          `${t("hypothesis.current")} ${metricText(result.metric, result.current, t)}`,
          `${t("hypothesis.threshold")} ${metricText(result.metric, result.threshold, t)}`,
          `${t("hypothesis.samples")} ${String(result.samples)}/${String(result.minSamples)}`,
          `${t("hypothesis.window")} ${t(`range.${result.window}`)}`
        ];
        if (result.guardrail !== void 0) {
          parts.push(
            `${t("hypothesis.guardrail")} ${t(METRIC_KEYS[result.guardrail.metric])}${result.guardrail.regressed ? ` \xB7 ${t("hypothesis.regressed")}` : ""}`
          );
        }
        parts.push(t("hypothesis.association"));
        return parts.join(" \xB7 ");
      }).join("\n");
    }
    function HypothesisCard({ result, t }) {
      const guardrail = result.guardrail;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "dsh-obs-hypo", "data-status": result.status, "data-hypothesis": result.index, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-card-name", children: result.description ?? t(METRIC_KEYS[result.metric]) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": result.status, children: t(HYPOTHESIS_STATUS_KEYS[result.status]) })
        ] }),
        result.description === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t(METRIC_KEYS[result.metric]) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { className: "dsh-obs-facts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.baseline") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: result.baseline === void 0 ? t("hypothesis.noBaseline") : metricText(result.metric, result.baseline, t) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.current") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: metricText(result.metric, result.current, t) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.threshold") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: metricText(result.metric, result.threshold, t) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.samples") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${String(result.samples)}/${String(result.minSamples)}` })
          ] }),
          result.baselineSamples === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: `${t("hypothesis.samples")} (${t("baseline.previous")})` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${String(result.baselineSamples)}/${String(result.minSamples)}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.window") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: t(`range.${result.window}`) })
          ] }),
          guardrail === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("hypothesis.guardrail") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: `${t(METRIC_KEYS[guardrail.metric])} ${metricText(guardrail.metric, guardrail.current, t)}${guardrail.regressed ? ` \xB7 ${t("hypothesis.regressed")}` : ""}` })
          ] })
        ] }),
        result.status === "collecting" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: `${t("hypothesis.collecting")} \xB7 ${String(result.samples)} ${t("verdict.of")} ${String(result.minSamples)}` }) : null,
        guardrail?.regressed === true ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-err", children: t("hypothesis.regressedBlock") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("hypothesis.association") })
      ] });
    }
    function HypothesesView({ report, t }) {
      const results = report.hypotheses;
      if (results.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", "aria-label": t("hypothesis.title"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("hypothesis.title") }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("hypothesis.empty") })
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", "aria-label": t("hypothesis.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("hypothesis.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              type: "button",
              className: "dsh-obs-link",
              onClick: () => copyText(hypothesisCopyText(results, t)),
              children: t("hypothesis.copy")
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-hypo-list", children: results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HypothesisCard, { result, t }, result.index)) })
      ] });
    }
    function FindingsStrip({
      findings,
      t
    }) {
      if (findings.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-findings", "aria-label": t("findings.title"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("findings.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: findings.map((finding) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { "data-finding": finding.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: finding.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: finding.evidence }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: finding.nextAction })
        ] }, finding.id)) })
      ] });
    }
    function OverviewView({
      report,
      t,
      failuresOpen,
      failureFilter,
      onToggleFailures,
      onRevealFailures,
      onClearFilter,
      onOpenFailure,
      canOpenFailure,
      onFix,
      onOpenRow
    }) {
      const silent = report.rows.filter((row) => row.group === "plugin" && row.status === "silent");
      const silentIds = new Set(silent.map((row) => row.id));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DataSufficiency, { report, t }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(FindingsStrip, { findings: report.findings, t }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          KpiStrip,
          {
            report,
            t,
            failuresOpen,
            onRevealFailures: report.failureTotals.total === 0 ? void 0 : onRevealFailures
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-columns", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OutcomeTiles, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BaselineStrip, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            TokenMix,
            {
              cacheRead: report.cost.cacheRead,
              input: report.cost.input,
              output: report.cost.output,
              t
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityPanel, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProcessPanel, { process: report.process, labels: report.bucketLabels, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DataQualityStrip, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            ScorecardList,
            {
              scorecards: report.scorecards.filter((card) => !silentIds.has(card.rowId)),
              t,
              onOpenRow
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SilentRows, { rows: silent, report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToolsPanel, { outcomes: report.toolOutcomes, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignalsPanel, { rows: report.rows, t })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          FailureList,
          {
            failures: report.failures,
            totals: report.failureTotals,
            t,
            open: failuresOpen,
            onToggle: onToggleFailures,
            ...onOpenFailure === void 0 ? {} : { onOpen: onOpenFailure },
            ...canOpenFailure === void 0 ? {} : { canOpen: canOpenFailure },
            ...onFix === void 0 ? {} : { onFix },
            ...failureFilter === void 0 ? {} : { filterTool: failureFilter },
            onClearFilter
          }
        )
      ] });
    }
    function StatusPill({ row, t }) {
      if (row.kind === "guidance") {
        const readiness = row.readiness;
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": "guidance", "data-readiness": readiness, children: readiness === void 0 ? t("status.guidance") : t(READINESS_KEYS[readiness]) });
      }
      const status = row.status ?? "silent";
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": status, children: t(`status.${status}`) });
    }
    function Sparkline({
      counts,
      label
    }) {
      if (counts.length === 0) return null;
      const width = 120;
      const height = 24;
      const max = Math.max(1, ...counts);
      const barWidth = width / counts.length;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "svg",
        {
          className: "dsh-obs-spark",
          viewBox: `0 0 ${String(width)} ${String(height)}`,
          preserveAspectRatio: "none",
          role: "img",
          "aria-label": label,
          children: counts.map((count, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${label}: ${String(count)}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "rect",
              {
                x: index * barWidth + 0.5,
                y: height - count / max * height,
                width: Math.max(1, barWidth - 1),
                height: count / max * height
              }
            )
          ] }, `${label}:${String(index)}`))
        }
      );
    }
    function RecentTraces({ row, t }) {
      const recent = row.details.slice(0, 5);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-obs-more", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: `${t("card.recent")} (${String(recent.length)})` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { children: recent.map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
          `${formatTime(entry.time)} \xB7 ${entry.signalId}`,
          entry.turn === void 0 ? "" : ` \xB7 ${t("detail.turn")} ${String(entry.turn)}`,
          entry.tool === void 0 ? "" : ` \xB7 ${entry.tool}`,
          entry.failed === true ? ` \xB7 ${t("detail.failed")}` : ""
        ] }, `${String(entry.time)}:${entry.signalId}:${String(index)}`)) })
      ] });
    }
    function PluginCard({
      row,
      t,
      now,
      onShowFailures,
      focused
    }) {
      const silent = row.status === "silent" || row.status === "not loaded";
      const lastFailure = row.lastFailure;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "article",
        {
          className: "dsh-obs-card",
          "data-status": row.status,
          "data-focus": focused === true ? "true" : void 0,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-card-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-card-name", children: row.label }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusPill, { row, t })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-card-metrics", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: row.traces }),
                " ",
                t("chart.events")
              ] }),
              row.errors > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-err", children: `${String(row.errors)} ${t("card.errors")}` }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: row.lastActivity === void 0 ? t("card.never") : formatAge(row.lastActivity, now, t) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Sparkline, { counts: row.counts, label: row.label }),
            row.tools.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-chips", children: row.tools.map((tool) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-chip", children: tool }, tool)) }) : null,
            lastFailure === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-obs-card-failure", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: [lastFailure.tool, lastFailure.errorName, lastFailure.errorCode].filter((value) => value !== void 0).join(" \xB7 ") }),
              onShowFailures === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "button",
                {
                  type: "button",
                  className: "dsh-obs-link",
                  onClick: () => onShowFailures(lastFailure.tool),
                  children: t("card.showFailures")
                }
              )
            ] }),
            silent ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: row.note }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RecentTraces, { row, t })
          ]
        }
      );
    }
    function PluginSection({
      title,
      rows,
      t,
      now,
      tone,
      onShowFailures,
      focusRow
    }) {
      if (rows.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", "data-tone": tone, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: `${title} (${String(rows.length)})` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-grid", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PluginCard,
          {
            row,
            t,
            now,
            ...onShowFailures === void 0 ? {} : { onShowFailures },
            ...focusRow === void 0 ? {} : { focused: focusRow === row.id }
          },
          row.id
        )) })
      ] });
    }
    function SilentRows({
      rows,
      report,
      t
    }) {
      if (rows.length === 0) return null;
      const byRow = new Map(report.scorecards.map((card) => [card.rowId, card]));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: `${t("section.silent")} (${String(rows.length)})` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("section.absence") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-silent", children: rows.map((row) => {
          const card = byRow.get(row.id);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { "data-status": "silent", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-silent-name", children: row.label }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": "silent", children: t("status.silent") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: row.trigger ?? t("card.never") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: card === void 0 || !card.eligibilityDeclared ? t("scorecard.noEligibility") : `${String(card.fired)} ${t("scorecard.of")} ${String(card.eligible)} ${t("scorecard.eligible")}` }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `0 ${t("failure.of")} ${counted(report.totals.turns, t("kpi.turn"))} \xB7 0 ${t("failure.of")} ${counted(report.totals.toolCalls, t("kpi.toolCall"))} \xB7 0 ${t("failure.of")} ${counted(report.totals.sessions, t("kpi.session"))}` })
          ] }, row.id);
        }) })
      ] });
    }
    function PluginBoard({
      report,
      t,
      now,
      onShowFailures,
      focusRow
    }) {
      const plugins = report.rows.filter((row) => row.group === "plugin").sort(byAttention);
      const needsAttention = (row) => row.status === "not loaded" || row.status === "error" && row.unrecoveredErrors > 0;
      const attention = plugins.filter(needsAttention);
      const active = plugins.filter(
        (row) => row.status === "active" || row.status === "error" && !needsAttention(row)
      );
      const silent = plugins.filter((row) => row.status === "silent");
      const guidance = plugins.filter((row) => row.kind === "guidance");
      const guidanceNeedsAttention = guidance.some((row) => row.readiness === "not mounted");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PluginSection,
          {
            title: t("section.attention"),
            rows: attention,
            t,
            now,
            tone: "attention",
            ...onShowFailures === void 0 ? {} : { onShowFailures },
            ...focusRow === void 0 ? {} : { focusRow }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PluginSection,
          {
            title: t("section.active"),
            rows: active,
            t,
            now,
            ...onShowFailures === void 0 ? {} : { onShowFailures },
            ...focusRow === void 0 ? {} : { focusRow }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SilentRows, { rows: silent, report, t }),
        guidance.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "section",
          {
            className: "dsh-obs-section",
            ...guidanceNeedsAttention ? { "data-tone": "attention" } : {},
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: `${t("section.guidance")} (${String(guidance.length)})` }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-guidance", children: guidance.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-guidance-name", children: row.label }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusPill, { row, t })
              ] }, row.id)) })
            ]
          }
        ) : null
      ] });
    }
    function ToolsPanel({
      outcomes,
      t
    }) {
      const max = Math.max(1, ...outcomes.map((outcome) => outcome.calls));
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("tools.title") }) }),
        outcomes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("tools.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-bars", children: outcomes.map((outcome) => {
          const percent2 = outcome.calls === 0 ? 0 : Math.round(outcome.failed / outcome.calls * 100);
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-bars-label", children: outcome.tool }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-bars-track", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "span",
              {
                className: "dsh-obs-bars-fill",
                style: { width: `${String(outcome.calls / max * 100)}%` },
                children: outcome.failed > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "span",
                  {
                    className: "dsh-obs-bars-fail",
                    style: { width: `${String(percent2)}%` },
                    title: `${String(outcome.failed)} ${t("tools.share")}`
                  }
                ) : null
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-bars-value", children: `${String(outcome.failed)} ${t("failure.of")} ${String(outcome.calls)} \xB7 ${String(percent2)}%` })
          ] }, outcome.tool);
        }) })
      ] });
    }
    function FailureList({
      failures,
      totals,
      t,
      open,
      onToggle,
      onOpen,
      canOpen,
      onFix,
      filterTool,
      onClearFilter
    }) {
      if (totals.total === 0) return null;
      const visible = filterTool === void 0 ? failures : failures.filter((failure) => failure.tool === filterTool);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "section",
        {
          id: FAILURE_SECTION_ID,
          tabIndex: -1,
          className: "dsh-obs-panel dsh-obs-failures",
          "aria-label": t("failure.title"),
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "details",
            {
              open,
              onToggle: onToggle === void 0 ? void 0 : (event) => onToggle(event.currentTarget.open),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: `${t("failure.title")} (${counted(totals.total, t("failure.entry"), t("failure.entries"))})` }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-failure-bar", children: [
                  totals.total > failures.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `${t("failure.bound")} ${String(failures.length)} ${t("failure.of")} ${String(totals.total)}` }) : null,
                  filterTool === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-muted", children: [
                    `${t("failure.filtered")} ${filterTool}`,
                    onClearFilter === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-obs-link", onClick: onClearFilter, children: t("failure.clear") })
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      type: "button",
                      className: "dsh-obs-link",
                      onClick: () => copyText(failureCopyText(visible, t)),
                      children: t("failure.copy")
                    }
                  ),
                  onFix === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: onFix, children: t("failure.fix") })
                ] }),
                visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("failure.none") }) : SEVERITY_ORDER.map((severity) => {
                  const entries = visible.filter((failure) => failure.severity === severity);
                  if (entries.length === 0) return null;
                  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-failure-group", "data-severity": severity, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: `${t(SEVERITY_KEYS[severity])} (${String(entries.length)})` }),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { children: entries.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                      "li",
                      {
                        ...failure.recovered ? { "data-recovered": "true" } : {},
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: failureFacts(failure, t).join(" \xB7 ") }),
                          onOpen === void 0 || canOpen !== void 0 && !canOpen(failure) ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                            "button",
                            {
                              type: "button",
                              className: "dsh-obs-link",
                              onClick: () => onOpen(failure),
                              children: t("failure.open")
                            }
                          )
                        ]
                      },
                      `${failure.sessionId}:${String(failure.seq)}`
                    )) })
                  ] }, severity);
                })
              ]
            }
          )
        }
      );
    }
    function SignalsPanel({ rows, t }) {
      const signals = rows.filter((row) => row.group === "sources" || row.group === "aborts");
      if (signals.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-obs-panel-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("signals.title") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-obs-chips", children: signals.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "span",
          {
            className: "dsh-obs-chip",
            "data-tone": row.errors > 0 ? "errors" : void 0,
            children: `${row.label} \xB7 ${String(row.traces)}`
          },
          row.id
        )) })
      ] });
    }
    function BlindSpots({ report, t }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-obs-blind", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("blind.title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: report.blindSpots.map((text) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: text }, text)) })
      ] });
    }
    function RangeSelector({
      range,
      t,
      onRange
    }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("fieldset", { className: "dsh-obs-ranges", "aria-label": t("range.label"), children: RANGE_OPTIONS.map((option) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          "aria-pressed": option === range,
          onClick: () => onRange(option),
          children: t(`range.${option}`)
        },
        option
      )) });
    }
    function ObservabilityPanel({
      range,
      report,
      error,
      t,
      onRange,
      now,
      sessionId,
      workspace,
      inspectCall,
      openView,
      onSubView,
      hypothesesLoading = false
    }) {
      const [view, setViewState] = (0, import_react.useState)("overview");
      const setView = (next) => {
        setViewState(next);
        onSubView?.(next);
      };
      const [failuresOpen, setFailuresOpen] = (0, import_react.useState)(false);
      const [failureFilter, setFailureFilter] = (0, import_react.useState)(void 0);
      const [rowFocus, setRowFocus] = (0, import_react.useState)(void 0);
      const [tasksSort, setTasksSort] = (0, import_react.useState)({ key: "start", direction: -1 });
      const [tasksOutcome, setTasksOutcome] = (0, import_react.useState)("all");
      const [tasksPlugin, setTasksPlugin] = (0, import_react.useState)("all");
      const [tasksSelected, setTasksSelected] = (0, import_react.useState)(void 0);
      const plugins = report?.rows.filter((row) => row.group === "plugin").length ?? 0;
      const revealFailures = (tool) => {
        setFailureFilter(tool);
        setFailuresOpen(true);
        if (view === "overview") {
          focusFailures();
          return;
        }
        setView("overview");
        setTimeout(focusFailures, 0);
      };
      const sortTasks = (key) => {
        setTasksSort(
          (current) => current.key === key ? { key, direction: current.direction === 1 ? -1 : 1 } : { key, direction: key === "start" ? -1 : 1 }
        );
      };
      const openRow = (rowId) => {
        setRowFocus(rowId);
        setView("plugins");
      };
      const canOpenLocal = sessionId !== void 0 && (inspectCall !== void 0 || openView !== void 0);
      const canOpenRemote = workspace !== void 0;
      const openFailure = (failure) => {
        if (failure.sessionId === sessionId) {
          if (failure.callId === void 0) return;
          if (inspectCall !== void 0) inspectCall(failure.callId);
          else openView?.("trajectory", failure.callId);
          return;
        }
        workspace?.openSession(failure.sessionId);
      };
      const canOpenFailure = (failure) => failure.sessionId === sessionId ? failure.callId !== void 0 && (inspectCall !== void 0 || openView !== void 0) : workspace !== void 0;
      const visibleFailures = report === null || failureFilter === void 0 ? report?.failures ?? [] : report.failures.filter((failure) => failure.tool === failureFilter);
      const fixSession = report === null || workspace === void 0 ? void 0 : () => {
        workspace.startSession(void 0, {
          prompt: failureFixPrompt(visibleFailures, t),
          whenDraftExists: "append"
        });
      };
      const canOpenAny = canOpenLocal || canOpenRemote;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RangeSelector, { range, t, onRange }),
          report === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-window", children: `${String(report.totals.records)} ${t("window.events")} \xB7 ${String(plugins)} ${t("window.plugins")}` })
        ] }),
        error !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", className: "dsh-obs-error", children: `${t("state.error")} ${error}` }) : report === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-loading", children: t("state.loading") }) : report.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-empty", children: t("state.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SubViewTabs, { view, t, onView: setView }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "div",
            {
              className: "dsh-obs-tabpanel",
              role: "tabpanel",
              id: `dsh-obs-panel-${view}`,
              "aria-labelledby": `dsh-obs-tab-${view}`,
              children: [
                view === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  OverviewView,
                  {
                    report,
                    t,
                    failuresOpen,
                    ...failureFilter === void 0 ? {} : { failureFilter },
                    onToggleFailures: setFailuresOpen,
                    onRevealFailures: () => revealFailures(),
                    onClearFilter: () => setFailureFilter(void 0),
                    ...canOpenAny ? { onOpenFailure: openFailure, canOpenFailure } : {},
                    ...fixSession === void 0 ? {} : { onFix: fixSession },
                    onOpenRow: openRow
                  }
                ) : null,
                view === "plugins" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HealthBanner, { report, t }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    PluginBoard,
                    {
                      report,
                      t,
                      now,
                      onShowFailures: revealFailures,
                      ...rowFocus === void 0 ? {} : { focusRow: rowFocus }
                    }
                  )
                ] }) : null,
                view === "tasks" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  TasksView,
                  {
                    report,
                    t,
                    sort: tasksSort,
                    outcome: tasksOutcome,
                    plugin: tasksPlugin,
                    ...tasksSelected === void 0 ? {} : { selectedId: tasksSelected },
                    onSort: sortTasks,
                    onOutcome: setTasksOutcome,
                    onPlugin: setTasksPlugin,
                    onSelect: setTasksSelected
                  }
                ) : null,
                view === "hypotheses" ? hypothesesLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-loading", children: t("hypothesis.loading") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HypothesesView, { report, t }) : null
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlindSpots, { report, t })
        ] })
      ] });
    }
    function ObservabilityView({
      t,
      sessionId,
      workspace,
      inspectCall,
      openView
    }) {
      const [range, setRange] = (0, import_react.useState)("session");
      const [report, setReport] = (0, import_react.useState)(null);
      const [error, setError] = (0, import_react.useState)(null);
      const [now, setNow] = (0, import_react.useState)(() => Date.now());
      const [needsHypotheses, setNeedsHypotheses] = (0, import_react.useState)(false);
      const [hypothesesLoading, setHypothesesLoading] = (0, import_react.useState)(false);
      (0, import_react.useEffect)(() => {
        let active = true;
        const key = `${range}|${sessionId ?? ""}|${needsHypotheses ? "h" : "v"}`;
        const cached = reportCache.get(key);
        if (cached !== void 0 && Date.now() - cached.at < REPORT_CACHE_MS) setReport(cached.report);
        else setReport(null);
        setError(null);
        setNow(Date.now());
        if (needsHypotheses) setHypothesesLoading(true);
        fetch(reportUrl(range, sessionId, needsHypotheses), {
          headers: { accept: "application/json" },
          credentials: "same-origin"
        }).then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => void 0);
            throw new Error(
              typeof body?.error === "string" ? body.error : `The report request failed (${String(response.status)}).`
            );
          }
          return await response.json();
        }).then((value) => {
          reportCache.set(key, { at: Date.now(), report: value });
          if (active) {
            setReport(value);
            setHypothesesLoading(false);
          }
        }).catch((cause) => {
          if (active) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setHypothesesLoading(false);
          }
        });
        return () => {
          active = false;
        };
      }, [range, sessionId, needsHypotheses]);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        ObservabilityPanel,
        {
          range,
          report,
          error,
          t,
          onRange: setRange,
          now,
          ...sessionId === void 0 ? {} : { sessionId },
          ...workspace === void 0 ? {} : { workspace },
          ...inspectCall === void 0 ? {} : { inspectCall },
          ...openView === void 0 ? {} : { openView },
          hypothesesLoading,
          onSubView: (view) => {
            if (view === "hypotheses") setNeedsHypotheses(true);
          }
        }
      );
    }
    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(NS, "en", EN));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject(
          "conversation.view",
          () => ctx.slots.register(
            { name: "conversation.view", id: "observability", order: 20, label: () => t("view.label") },
            (props) => {
              const workspace = optionalWorkspace(ctx);
              return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                ObservabilityView,
                {
                  t,
                  ...props.sessionId === void 0 ? {} : { sessionId: props.sessionId },
                  ...props.inspectCall === void 0 ? {} : { inspectCall: props.inspectCall },
                  ...props.openView === void 0 ? {} : { openView: props.openView },
                  ...workspace === void 0 ? {} : { workspace }
                }
              );
            }
          )
        );
      } catch (error) {
        console.error("observability: Client registration failed", error);
      }
    }
    var CSS = `
    .dsh-obs {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 16px 20px 28px;
      overflow: auto;
      color: var(--dsw-alias-label-primary);
      font: inherit;
      font-size: 13px;
    }
    .dsh-obs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .dsh-obs-window {
      color: var(--dsw-alias-label-secondary);
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-ranges {
      display: flex;
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    .dsh-obs-ranges button {
      padding: 4px 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
      background: transparent;
      color: var(--dsw-alias-label-secondary);
      font: inherit;
      cursor: pointer;
    }
    .dsh-obs-ranges button[aria-pressed="true"] {
      border-color: var(--dsw-alias-state-business-primary);
      color: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-ranges button:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-findings {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 16px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-left: 4px solid var(--dsw-alias-state-error-primary);
      border-radius: var(--dsw-radius-sm);
    }
    .dsh-obs-findings h2 {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }
    .dsh-obs-findings ul {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding-left: 18px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-health {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-left-width: 4px;
      border-left-color: var(--dsw-alias-state-success-primary);
      border-radius: var(--dsw-radius-sm);
    }
    .dsh-obs-health[data-tone="attention"] {
      border-left-color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-health-dot {
      width: 10px;
      height: 10px;
      flex: none;
      border-radius: 50%;
      background: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-health[data-tone="attention"] .dsh-obs-health-dot {
      background: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-health-text {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 10px;
    }
    .dsh-obs-health-text strong {
      font-size: 15px;
    }
    .dsh-obs-health-text > span {
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
    }
    .dsh-obs-kpi {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
    }
    button.dsh-obs-kpi {
      cursor: pointer;
    }
    button.dsh-obs-kpi:hover {
      border-color: var(--dsw-alias-state-business-primary);
    }
    button.dsh-obs-kpi:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-kpi-label {
      color: var(--dsw-alias-label-secondary);
      font-size: 12px;
    }
    .dsh-obs-kpi-value {
      font-size: 24px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .dsh-obs-kpi[data-tone="error"] .dsh-obs-kpi-value {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-panel {
      padding: 12px 16px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
    }
    .dsh-obs-panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }
    .dsh-obs-panel-head h2,
    .dsh-obs-section h2 {
      margin: 0;
      color: var(--dsw-alias-label-primary);
      font-size: 13px;
      font-weight: 600;
    }
    .dsh-obs-legend {
      display: flex;
      gap: 12px;
      color: var(--dsw-alias-label-secondary);
      font-size: 12px;
    }
    .dsh-obs-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .dsh-obs-swatch {
      width: 9px;
      height: 9px;
      border-radius: 2px;
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-swatch[data-tone="errors"] {
      background: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-axis {
      fill: var(--dsw-alias-label-caption);
      font-size: 11px;
    }
    .dsh-obs-chart-empty {
      fill: var(--dsw-alias-label-caption);
      font-size: 12px;
    }
    .dsh-obs-bar[data-tone="events"] {
      fill: var(--dsw-alias-state-business-primary);
      opacity: 0.75;
    }
    .dsh-obs-bar[data-tone="errors"] {
      fill: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-section[data-tone="attention"] h2 {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 12px;
    }
    .dsh-obs-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .dsh-obs-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
    }
    .dsh-obs-card[data-status="error"] {
      border-color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-card-failure {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin: 0;
      flex-wrap: wrap;
    }
    .dsh-obs-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .dsh-obs-card-name {
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-obs-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      flex: none;
      padding: 1px 8px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: 999px;
      color: var(--dsw-alias-label-secondary);
      font-size: 11px;
      text-transform: lowercase;
    }
    .dsh-obs-pill::before {
      content: "";
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dsw-alias-label-caption);
    }
    .dsh-obs-pill[data-status="active"] {
      color: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-pill[data-status="active"]::before {
      background: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-pill[data-status="error"],
    .dsh-obs-pill[data-readiness="not mounted"] {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-pill[data-status="error"]::before,
    .dsh-obs-pill[data-readiness="not mounted"]::before {
      background: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-pill[data-status="not loaded"] {
      color: var(--dsw-alias-brand-primary);
    }
    .dsh-obs-pill[data-status="not loaded"]::before {
      background: var(--dsw-alias-brand-primary);
    }
    .dsh-obs-card-metrics {
      display: flex;
      align-items: baseline;
      gap: 10px;
      color: var(--dsw-alias-label-secondary);
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-card-metrics strong {
      color: var(--dsw-alias-label-primary);
      font-size: 16px;
    }
    .dsh-obs-spark {
      display: block;
      width: 100%;
      height: 24px;
      color: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-spark rect {
      fill: currentColor;
      opacity: 0.7;
    }
    .dsh-obs-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dsh-obs-chip {
      padding: 1px 8px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: 999px;
      color: var(--dsw-alias-label-secondary);
      font-size: 11px;
    }
    .dsh-obs-chip[data-tone="errors"] {
      border-color: var(--dsw-alias-state-error-primary);
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-more summary {
      color: var(--dsw-alias-label-secondary);
      cursor: pointer;
      font-size: 12px;
    }
    .dsh-obs-more ol {
      margin: 6px 0 0;
      padding-left: 18px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-guidance {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 6px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .dsh-obs-guidance li {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 0;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
    }
    .dsh-obs-guidance-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-obs-silent {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .dsh-obs-silent li {
      display: grid;
      grid-template-columns: minmax(120px, 200px) auto 1fr auto;
      align-items: center;
      gap: 10px;
      padding: 3px 0;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
    }
    .dsh-obs-silent-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-obs-failures summary {
      cursor: pointer;
      color: var(--dsw-alias-label-primary);
      font-weight: 600;
    }
    .dsh-obs-failures summary:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-failures:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-failure-bar {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 12px;
      margin: 8px 0;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-failure-group h3 {
      margin: 10px 0 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-failure-group ol {
      margin: 0;
      padding-left: 18px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-failure-group li {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
      padding: 2px 0;
    }
    .dsh-obs-failure-group li[data-recovered="true"] {
      opacity: 0.75;
    }
    .dsh-obs-link {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--dsw-alias-state-business-primary);
      font: inherit;
      cursor: pointer;
      text-decoration: underline;
    }
    .dsh-obs-link:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-bars {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .dsh-obs-bars li {
      display: grid;
      grid-template-columns: minmax(90px, 180px) 1fr auto;
      align-items: center;
      gap: 10px;
    }
    .dsh-obs-bars-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-bars-track {
      height: 8px;
      border-radius: 999px;
      background: var(--dsw-alias-border-l2);
      overflow: hidden;
    }
    .dsh-obs-bars-fill {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-bars-fail {
      display: block;
      height: 100%;
      min-width: 1px;
      background: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-bars-value {
      font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-err {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-muted {
      color: var(--dsw-alias-label-caption);
    }
    .dsh-obs-blind {
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-blind summary {
      cursor: pointer;
      font-weight: 600;
    }
    .dsh-obs-blind ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    .dsh-obs-error {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-timeline-chart {
      display: block;
      width: 100%;
      height: 96px;
    }
    .dsh-obs-tl-label {
      fill: var(--dsw-alias-label-secondary);
      font-size: 11px;
    }
    .dsh-obs-tl-bar[data-tone="steps"] {
      fill: var(--dsw-alias-state-business-primary);
      opacity: 0.75;
    }
    .dsh-obs-tl-bar[data-tone="tools"] {
      fill: var(--dsw-alias-brand-primary);
      opacity: 0.75;
    }
    .dsh-obs-tl-tick {
      stroke-width: 2;
    }
    .dsh-obs-tl-tick[data-tone="human"] {
      stroke: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-tl-tick[data-tone="errors"] {
      stroke: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-process-chart {
      display: block;
      width: 100%;
      height: 170px;
    }
    .dsh-obs-process-line {
      fill: none;
      stroke: var(--dsw-alias-state-business-primary);
      stroke-width: 2;
      stroke-linejoin: round;
    }
    .dsh-obs-process-marker[data-tone="decomposition"] {
      stroke: var(--dsw-alias-brand-primary);
      stroke-width: 1.5;
    }
    .dsh-obs-process-marker[data-tone="reflection"] {
      stroke: var(--dsw-alias-state-success-primary);
      stroke-width: 1.5;
      stroke-dasharray: 3 2;
    }
    .dsh-obs-process-step {
      fill: var(--dsw-alias-state-business-primary);
      opacity: 0.55;
    }
    .dsh-obs-swatch[data-tone="workers"] {
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-swatch[data-tone="decomposition"] {
      background: var(--dsw-alias-brand-primary);
    }
    .dsh-obs-swatch[data-tone="reflection"] {
      background: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-process-summary {
      margin-top: 8px;
    }
    .dsh-obs-turn-rows {
      display: flex;
      flex-wrap: wrap;
      gap: 2px 18px;
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
      color: var(--dsw-alias-label-secondary);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-turn-row {
      display: inline-flex;
      gap: 6px;
    }
    .dsh-obs-turn-row > span + span::before {
      content: "\xB7";
      margin-right: 6px;
      color: var(--dsw-alias-label-caption);
    }
    .dsh-obs-turn-row [data-tone="error"] {
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-series-chart {
      display: block;
      width: 100%;
      height: 140px;
    }
    .dsh-obs-token-track {
      border-radius: 999px;
      overflow: hidden;
      background: var(--dsw-alias-border-l2);
    }
    .dsh-obs-token-bar {
      display: block;
      width: 100%;
    }
    .dsh-obs-token-bar rect[data-tone="cacheRead"] {
      fill: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-token-bar rect[data-tone="input"] {
      fill: var(--dsw-alias-brand-primary);
    }
    .dsh-obs-token-bar rect[data-tone="output"] {
      fill: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-swatch[data-tone="cacheRead"] {
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-swatch[data-tone="input"] {
      background: var(--dsw-alias-brand-primary);
    }
    .dsh-obs-swatch[data-tone="output"] {
      background: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-token-caption {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 8px 0 0;
      color: var(--dsw-alias-label-secondary);
      font-size: 12px;
    }
    .dsh-obs-token-key {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .dsh-obs-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
    }
    .dsh-obs-tab {
      padding: 6px 12px;
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--dsw-alias-label-secondary);
      font: inherit;
      cursor: pointer;
    }
    .dsh-obs-tab[aria-selected="true"] {
      border-bottom-color: var(--dsw-alias-state-business-primary);
      color: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-tab:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-tabpanel {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .dsh-obs-columns {
      columns: 1;
      column-gap: 16px;
    }
    @media (min-width: 901px) {
      .dsh-obs-columns {
        columns: 2;
      }
    }
    .dsh-obs-columns > * {
      break-inside: avoid;
      margin: 0 0 16px;
    }
    .dsh-obs-tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .dsh-obs-tile {
      padding: 10px 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
      min-width: 0;
    }
    .dsh-obs-tile-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-tile dl {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin: 8px 0 0;
    }
    .dsh-obs-tile dl div {
      display: flex;
      align-items: baseline;
      gap: 4px;
    }
    .dsh-obs-tile dt {
      color: var(--dsw-alias-label-caption);
      font-size: 11px;
    }
    .dsh-obs-tile dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-tile-note {
      margin: 6px 0 0;
    }
    .dsh-obs-dq {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 4px 16px;
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--dsw-alias-label-secondary);
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-dq li {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      padding: 2px 0;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
    }
    .dsh-obs-task-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-task-controls label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .dsh-obs-task-controls select {
      padding: 2px 6px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .dsh-obs-table-wrap {
      overflow-x: auto;
    }
    .dsh-obs-table {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-table th {
      padding: 4px 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
      color: var(--dsw-alias-label-secondary);
      font-weight: 600;
      text-align: left;
      white-space: nowrap;
    }
    .dsh-obs-table th button {
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .dsh-obs-table th button:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-obs-table td {
      padding: 4px 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l2);
      vertical-align: top;
    }
    .dsh-obs-table tr[data-selected="true"] td {
      border-bottom-color: var(--dsw-alias-state-business-primary);
    }
    .dsh-obs-facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px 16px;
      margin: 8px 0 0;
    }
    .dsh-obs-facts div {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .dsh-obs-facts dt {
      color: var(--dsw-alias-label-caption);
      font-size: 11px;
    }
    .dsh-obs-facts dd {
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    .dsh-obs-panel h3 {
      margin: 12px 0 4px;
      color: var(--dsw-alias-label-secondary);
      font-size: 12px;
      font-weight: 600;
    }
    .dsh-obs-score-goal {
      margin: 0;
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-obs-hypo-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
    }
    .dsh-obs-hypo {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-sm);
    }
    .dsh-obs-hypo[data-status="supported"] {
      border-color: var(--dsw-alias-state-success-primary);
    }
    .dsh-obs-hypo[data-status="refuted"] {
      border-color: var(--dsw-alias-state-error-primary);
    }
    .dsh-obs-card[data-focus="true"] {
      border-color: var(--dsw-alias-state-business-primary);
    }
    `;
    return module.exports;
  },
});
