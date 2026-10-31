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
      ActivityChart: () => ActivityChart,
      BlindSpots: () => BlindSpots,
      FAILURE_SECTION_ID: () => FAILURE_SECTION_ID,
      FailureList: () => FailureList,
      HealthBanner: () => HealthBanner,
      KpiStrip: () => KpiStrip,
      MAX_FIX_ENTRY_CHARS: () => MAX_FIX_ENTRY_CHARS,
      MAX_FIX_PROMPT_CHARS: () => MAX_FIX_PROMPT_CHARS,
      MAX_FIX_PROMPT_ENTRIES: () => MAX_FIX_PROMPT_ENTRIES,
      ObservabilityPanel: () => ObservabilityPanel,
      ObservabilityView: () => ObservabilityView,
      PluginBoard: () => PluginBoard,
      PluginCard: () => PluginCard,
      REPORT_PATH: () => REPORT_PATH,
      RangeSelector: () => RangeSelector,
      SignalsPanel: () => SignalsPanel,
      Sparkline: () => Sparkline,
      StatusPill: () => StatusPill,
      ToolsPanel: () => ToolsPanel,
      apply: () => apply,
      counted: () => counted,
      failureCopyText: () => failureCopyText,
      failureFacts: () => failureFacts,
      failureFixPrompt: () => failureFixPrompt,
      inject: () => inject,
      reportUrl: () => reportUrl
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
      "chart.title": "Activity over the range",
      "chart.events": "events",
      "chart.errors": "errors",
      "chart.empty": "No activity in this range.",
      "legend.events": "Events",
      "legend.errors": "Errors",
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
    function reportUrl(range, sessionId) {
      const session = sessionId === void 0 || sessionId === "" ? "" : `&session=${encodeURIComponent(sessionId)}`;
      return `${REPORT_PATH}?range=${range}${session}`;
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
    function ActivityChart({ report, t }) {
      const width = 720;
      const height = 190;
      const pad = { left: 40, right: 14, top: 12, bottom: 30 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const max = Math.max(1, ...report.activity);
      const step = plotWidth / Math.max(1, report.activity.length);
      const barWidth = Math.max(2, step * 0.62);
      const ticks = [.../* @__PURE__ */ new Set([0, Math.round(max / 2), max])];
      const labelIndexes = [
        .../* @__PURE__ */ new Set([
          0,
          Math.floor((report.bucketLabels.length - 1) / 2),
          report.bucketLabels.length - 1
        ])
      ].filter((index) => index >= 0);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-obs-panel-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: t("chart.title") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-obs-legend", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "events" }),
              t("legend.events")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-obs-legend-item", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { className: "dsh-obs-swatch", "data-tone": "errors" }),
              t("legend.errors")
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "svg",
          {
            className: "dsh-obs-chart",
            viewBox: `0 0 ${String(width)} ${String(height)}`,
            preserveAspectRatio: "none",
            role: "img",
            "aria-label": t("chart.title"),
            children: [
              ticks.map((tick) => {
                const y = pad.top + plotHeight - tick / max * plotHeight;
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "line",
                    {
                      className: "dsh-obs-gridline",
                      x1: pad.left,
                      x2: width - pad.right,
                      y1: y,
                      y2: y
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("text", { className: "dsh-obs-axis", x: pad.left - 6, y: y + 4, textAnchor: "end", children: tick })
                ] }, `tick-${String(tick)}`);
              }),
              report.activity.map((count, index) => {
                const errors = report.errorSeries[index] ?? 0;
                const normal = Math.max(0, count - errors);
                const totalHeight = count / max * plotHeight;
                const normalHeight = normal / max * plotHeight;
                const errorHeight = totalHeight - normalHeight;
                const x = pad.left + index * step + (step - barWidth) / 2;
                const baseline = pad.top + plotHeight;
                const label = report.bucketLabels[index] ?? String(index + 1);
                return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("g", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("title", { children: `${label}: ${String(count)} ${t("chart.events")} \xB7 ${String(errors)} ${t("chart.errors")}` }),
                  normalHeight > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "rect",
                    {
                      className: "dsh-obs-bar",
                      "data-tone": "events",
                      x,
                      y: baseline - normalHeight,
                      width: barWidth,
                      height: normalHeight
                    }
                  ) : null,
                  errorHeight > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "rect",
                    {
                      className: "dsh-obs-bar",
                      "data-tone": "errors",
                      x,
                      y: baseline - totalHeight,
                      width: barWidth,
                      height: errorHeight
                    }
                  ) : null
                ] }, `${label}:${String(index)}`);
              }),
              labelIndexes.map((index) => {
                const label = report.bucketLabels[index] ?? "";
                return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "text",
                  {
                    className: "dsh-obs-axis",
                    x: pad.left + index * step + step / 2,
                    y: height - 8,
                    textAnchor: index === 0 ? "start" : index === report.bucketLabels.length - 1 ? "end" : "middle",
                    children: label
                  },
                  `label-${String(index)}`
                );
              }),
              report.activity.every((count) => count === 0) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "text",
                {
                  className: "dsh-obs-chart-empty",
                  x: width / 2,
                  y: pad.top + plotHeight / 2,
                  textAnchor: "middle",
                  children: t("chart.empty")
                }
              ) : null
            ]
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
      onShowFailures
    }) {
      const silent = row.status === "silent" || row.status === "not loaded";
      const lastFailure = row.lastFailure;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "dsh-obs-card", "data-status": row.status, children: [
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
      ] });
    }
    function PluginSection({
      title,
      rows,
      t,
      now,
      tone,
      onShowFailures
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
            ...onShowFailures === void 0 ? {} : { onShowFailures }
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
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-obs-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: `${t("section.silent")} (${String(rows.length)})` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-obs-muted", children: t("section.absence") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "dsh-obs-silent", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { "data-status": "silent", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-silent-name", children: row.label }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-pill", "data-status": "silent", children: t("status.silent") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: row.trigger ?? t("card.never") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-muted", children: `0 ${t("failure.of")} ${counted(report.totals.turns, t("kpi.turn"))} \xB7 0 ${t("failure.of")} ${counted(report.totals.toolCalls, t("kpi.toolCall"))} \xB7 0 ${t("failure.of")} ${counted(report.totals.sessions, t("kpi.session"))}` })
        ] }, row.id)) })
      ] });
    }
    function PluginBoard({
      report,
      t,
      now,
      onShowFailures
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
            ...onShowFailures === void 0 ? {} : { onShowFailures }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          PluginSection,
          {
            title: t("section.active"),
            rows: active,
            t,
            now,
            ...onShowFailures === void 0 ? {} : { onShowFailures }
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
          const percent = outcome.calls === 0 ? 0 : Math.round(outcome.failed / outcome.calls * 100);
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
                    style: { width: `${String(percent)}%` },
                    title: `${String(outcome.failed)} ${t("tools.share")}`
                  }
                ) : null
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-obs-bars-value", children: `${String(outcome.failed)} ${t("failure.of")} ${String(outcome.calls)} \xB7 ${String(percent)}%` })
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
      openView
    }) {
      const [failuresOpen, setFailuresOpen] = (0, import_react.useState)(false);
      const [failureFilter, setFailureFilter] = (0, import_react.useState)(void 0);
      const plugins = report?.rows.filter((row) => row.group === "plugin").length ?? 0;
      const revealFailures = (tool) => {
        setFailureFilter(tool);
        setFailuresOpen(true);
        focusFailures();
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
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HealthBanner, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            KpiStrip,
            {
              report,
              t,
              failuresOpen,
              onRevealFailures: report.failureTotals.total === 0 ? void 0 : () => revealFailures()
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActivityChart, { report, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            FailureList,
            {
              failures: report.failures,
              totals: report.failureTotals,
              t,
              open: failuresOpen,
              onToggle: setFailuresOpen,
              ...canOpenAny ? { onOpen: openFailure, canOpen: canOpenFailure } : {},
              ...fixSession === void 0 ? {} : { onFix: fixSession },
              ...failureFilter === void 0 ? {} : { filterTool: failureFilter },
              onClearFilter: () => setFailureFilter(void 0)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PluginBoard, { report, t, now, onShowFailures: revealFailures }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ToolsPanel, { outcomes: report.toolOutcomes, t }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignalsPanel, { rows: report.rows, t }),
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
      (0, import_react.useEffect)(() => {
        let active = true;
        setReport(null);
        setError(null);
        setNow(Date.now());
        fetch(reportUrl(range, sessionId), {
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
          if (active) setReport(value);
        }).catch((cause) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause));
        });
        return () => {
          active = false;
        };
      }, [range, sessionId]);
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
          ...openView === void 0 ? {} : { openView }
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
    .dsh-obs-chart {
      display: block;
      width: 100%;
      height: 190px;
    }
    .dsh-obs-gridline {
      stroke: var(--dsw-alias-border-l2);
      stroke-width: 1;
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
    `;
    return module.exports;
  },
});
