window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-workflows",
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

    // packages/plugin-workflows/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      ENTRY_LIMITATION: () => ENTRY_LIMITATION,
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);

    // packages/plugin-workflows/src/client/panel.tsx
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime = require("react/jsx-runtime");
    var EVENTS_PATH = "/api/workflows/events";
    var RUNS_PATH = "/api/workflows/runs";
    var TRIGGERS_PATH = "/api/workflows/triggers";
    var HEALTH_PATH = "/api/workflows/health";
    var EVIDENCE_PATH = "/api/workflows/evidence";
    function pageUrl(path, session, cursor, limit) {
      const query = new URLSearchParams({ session });
      if (cursor !== void 0) query.set("cursor", cursor);
      if (limit !== void 0) query.set("limit", String(limit));
      return `${path}?${query.toString()}`;
    }
    function eventsUrl(session, cursor, limit) {
      return pageUrl(EVENTS_PATH, session, cursor, limit);
    }
    function runsUrl(session, cursor, limit) {
      return pageUrl(RUNS_PATH, session, cursor, limit);
    }
    function triggersUrl(session) {
      return pageUrl(TRIGGERS_PATH, session);
    }
    function isRecordEvidence(value) {
      if (!value.endsWith(".json")) return false;
      return value.startsWith(".dsh/delegation/") || value.startsWith(".dsh/work-checkpoints/") || value.startsWith("openspec/changes/");
    }
    function evidenceUrl(session, path) {
      const search = new URLSearchParams({ session, path });
      return `${EVIDENCE_PATH}?${search.toString()}`;
    }
    function healthUrl(session) {
      return pageUrl(HEALTH_PATH, session);
    }
    async function requestJson(url) {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `the request failed (${String(response.status)})`);
      return body;
    }
    var EN = {
      "view.label": "Workflows",
      "state.loading": "Reading the workflow journal\u2026",
      "state.error": "The Workflows view could not be loaded.",
      "state.retry": "Retry",
      "state.empty": "Nothing recorded yet.",
      "state.noSession": "Open a session to see its workflow process.",
      "health.title": "Health",
      "health.listener-down": "The recorder listener is down",
      "health.journal-readonly": "The journal is read-only",
      "health.waiting": "Listener healthy, no matching event yet",
      "health.healthy": "Listener healthy and matching events observed",
      "health.listeners": "listeners",
      "health.triggers": "triggers",
      "health.lastEvent": "last event",
      "health.lastCheck": "last check",
      "health.never": "never",
      "health.lastError": "last error",
      "triggers.title": "Triggers",
      "triggers.empty": "No trigger catalog is loaded.",
      "triggers.id": "Trigger",
      "triggers.event": "Event",
      "triggers.filter": "Filter",
      "triggers.mode": "Mode",
      "triggers.last": "Last evaluation",
      "triggers.notEvaluated": "not evaluated yet",
      "events.title": "Session",
      "events.empty": "No process event recorded in this session yet.",
      "events.truncated": "payload truncated",
      "events.calls": "Load more events",
      "runs.title": "Runs",
      "runs.empty": "No run is attributable to this session yet.",
      "runs.open": "Open run detail",
      "runs.detail": "Run detail",
      "runs.record": "Record",
      "runs.steps": "Steps",
      "runs.step": "Step",
      "runs.state": "State",
      "runs.time": "Time",
      "runs.evidence": "Evidence",
      "runs.attribution.local": "local",
      "runs.attribution.portable": "portable",
      "runs.attribution.unattributed": "unattributed",
      "runs.status.running": "running",
      "runs.status.done": "done",
      "runs.status.failed": "failed",
      "runs.status.unknown": "unknown",
      "runs.source.checkpoint": "checkpoint",
      "runs.source.delegation": "delegation",
      "runs.source.review": "review",
      "runs.source.workflow": "workflow",
      "whyNot.title": "Why not",
      "whyNot.empty": "No trigger evaluation has been recorded yet.",
      "whyNot.trigger": "Trigger",
      "whyNot.result": "Result",
      "whyNot.reason": "Reason",
      "whyNot.path": "Rejected path",
      "whyNot.filter": "Filter",
      "whyNot.matched": "matched",
      "whyNot.notMatched": "not matched",
      "reason.would-fire": "would fire",
      "reason.event-mismatch": "event mismatch",
      "reason.filter-mismatch": "filter mismatch",
      "reason.dedupe": "duplicate",
      "reason.disabled": "disabled",
      "reason.not-ready": "not ready",
      "reason.error": "error",
      "paging.more": "Load more",
      "paging.end": "End of the recorded page.",
      "time.unknown": "unknown time",
      "bytes.unknown": "size unknown"
    };
    function formatTime(at, t) {
      if (at === void 0 || Number.isNaN(at) || at <= 0) return t("time.unknown");
      return new Date(at).toLocaleTimeString();
    }
    function dotFor(state) {
      if (state === "healthy") return "done";
      if (state === "waiting") return "ongoing";
      if (state === "journal-readonly") return "warning";
      return "error";
    }
    function Section(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-wf-section", "data-section": props.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "dsh-wf-heading", children: props.title }),
        props.children
      ] });
    }
    function HealthStrip(props) {
      const { health, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-wf-health", "data-state": health.state, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-health-dot", "data-state": dotFor(health.state), "aria-hidden": "true" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t(`health.${health.state}`) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(health.listenerCount)} ${t("health.listeners")}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(health.triggerCount)} ${t("health.triggers")}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${t("health.lastEvent")}: ${formatTime(health.lastEventAt, t)}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${t("health.lastCheck")}: ${formatTime(health.lastCheckAt, t)}` }),
        health.lastError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-error", role: "alert", children: `${t("health.lastError")}: ${health.lastError}` })
      ] });
    }
    function filterText(trigger) {
      const parts = [];
      if (trigger.filter.path !== void 0) parts.push(`path: ${trigger.filter.path}`);
      if (trigger.filter.tool !== void 0) parts.push(`tool: ${trigger.filter.tool}`);
      if (trigger.filter.change !== void 0) parts.push(`change: ${trigger.filter.change}`);
      return parts.length === 0 ? "\u2014" : parts.join(", ");
    }
    function TriggersTable(props) {
      const { triggers, t } = props;
      if (triggers.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { id: "triggers", title: t("triggers.title"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-muted", children: t("triggers.empty") }) });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { id: "triggers", title: t("triggers.title"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dsh-wf-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("triggers.id") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("triggers.event") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("triggers.filter") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("triggers.mode") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("triggers.last") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: triggers.map((trigger) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { "data-trigger": trigger.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trigger.id }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trigger.event }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: filterText(trigger) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: trigger.mode }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: trigger.last === void 0 ? t("triggers.notEvaluated") : `${t(`reason.${trigger.last.reason}`)} \xB7 ${formatTime(trigger.last.at, t)}` })
        ] }, trigger.id)) })
      ] }) });
    }
    function EventList(props) {
      const { events, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { id: "events", title: t("events.title"), children: events.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-muted", children: t("events.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "dsh-wf-events", children: events.map((event, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { "data-kind": event.kind, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-time", children: formatTime(event.at, t) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-kind", children: event.kind }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-subject", children: event.subject }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-summary", children: event.summary }),
        event.truncated ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "warning", children: t("events.truncated") }) : null
      ] }, `${String(event.at)}:${String(index)}`)) }) });
    }
    function WhyNotTable(props) {
      const rows = props.events.flatMap(
        (event) => (event.triggers ?? []).map((evaluation) => ({ evaluation, at: event.at }))
      );
      const { t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { id: "why-not", title: t("whyNot.title"), children: rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-muted", children: t("whyNot.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dsh-wf-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("whyNot.trigger") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("whyNot.result") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("whyNot.reason") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("whyNot.path") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("whyNot.filter") })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: rows.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "tr",
          {
            "data-trigger": row.evaluation.id,
            "data-matched": row.evaluation.matched ? "true" : "false",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.evaluation.id }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.evaluation.matched ? t("whyNot.matched") : t("whyNot.notMatched") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: t(`reason.${row.evaluation.reason}`) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.evaluation.path ?? "\u2014" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: row.evaluation.filter ?? "\u2014" })
            ]
          },
          `${row.evaluation.id}:${String(row.at)}:${String(index)}`
        )) })
      ] }) });
    }
    function RunsList(props) {
      const { runs, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, { id: "runs", title: t("runs.title"), children: runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-muted", children: t("runs.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: "dsh-wf-runs", children: runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsh-wf-run",
          "data-run": run.id,
          "data-status": run.status,
          "aria-pressed": props.selected === run.id,
          onClick: () => props.onSelect(run),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-wf-time", children: formatTime(run.startedAt, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: run.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: t(`runs.source.${run.source}`) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "outline", children: t(`runs.attribution.${run.attribution}`) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: run.status === "failed" ? "danger" : "neutral", children: t(`runs.status.${run.status}`) })
          ]
        }
      ) }, run.id)) }) });
    }
    function RunDetail(props) {
      const { run, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, { id: "run-detail", title: t("runs.detail"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-wf-run-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: run.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(`runs.source.${run.source}`) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(`runs.attribution.${run.attribution}`) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(`runs.status.${run.status}`) })
        ] }),
        run.record === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-wf-muted", children: [
          `${t("runs.record")}: `,
          props.session === void 0 ? run.record : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: evidenceUrl(props.session, run.record), target: "_blank", rel: "noreferrer", children: run.record })
        ] }),
        run.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-error", role: "alert", children: run.error }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", { className: "dsh-wf-table", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("runs.step") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("runs.state") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("runs.time") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", { children: t("runs.evidence") })
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", { children: run.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", { "data-step": step.id, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: step.title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: step.state }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: step.at === void 0 ? "\u2014" : formatTime(step.at, t) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", { children: step.evidence === void 0 ? "\u2014" : props.session === void 0 || !isRecordEvidence(step.evidence) ? step.evidence : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "a",
              {
                href: evidenceUrl(props.session, step.evidence),
                target: "_blank",
                rel: "noreferrer",
                children: step.evidence
              }
            ) })
          ] }, step.id)) })
        ] })
      ] });
    }
    function LoadingLine(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-wf-muted", role: "status", children: props.t("state.loading") });
    }
    function ErrorLine(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-wf-error-block", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: `${props.t("state.error")} ${props.message}` }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "dsh-wf-retry", onClick: props.onRetry, children: props.t("state.retry") })
      ] });
    }
    function LoadMore(props) {
      if (props.next === void 0) return null;
      if (props.error !== void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ErrorLine, { message: props.error, t: props.t, onRetry: props.onLoad });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-wf-more",
          disabled: props.loading === true,
          onClick: props.onLoad,
          children: props.t("paging.more")
        }
      );
    }

    // packages/plugin-workflows/src/client/view.tsx
    var import_react = require("react");
    var import_jsx_runtime2 = require("react/jsx-runtime");
    var VIEW_CSS = `
    .dsh-wf { display: flex; flex-direction: column; gap: var(--dsw-space-3, 12px); padding: 12px; overflow: auto; }
    .dsh-wf-health { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
    .dsh-wf-health[data-state="listener-down"] { border-color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-health[data-state="journal-readonly"] { border-color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-health-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-secondary); }
    .dsh-wf-health-dot[data-state="done"] { background: var(--dsw-alias-state-success-primary); }
    .dsh-wf-health-dot[data-state="warning"] { background: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-health-dot[data-state="error"] { background: var(--dsw-alias-state-error-primary); }
    .dsh-wf-section { display: flex; flex-direction: column; gap: 6px; }
    .dsh-wf-heading { margin: 8px 0 2px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
    .dsh-wf-table { width: 100%; border-collapse: collapse; }
    .dsh-wf-table th, .dsh-wf-table td { padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
    .dsh-wf-table th { color: var(--dsw-alias-label-caption); font-size: 11px; font-weight: 600; }
    .dsh-wf-events, .dsh-wf-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .dsh-wf-events li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
    .dsh-wf-time { color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
    .dsh-wf-kind { color: var(--dsw-alias-label-secondary); }
    .dsh-wf-subject { font-weight: 600; }
    .dsh-wf-summary { color: var(--dsw-alias-label-secondary); }
    .dsh-wf-run { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; width: 100%; padding: 4px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .dsh-wf-run[data-status="failed"] { border-color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-run-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-secondary); }
    .dsh-wf-error { color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-error-block { display: flex; flex-direction: column; gap: 6px; }
    .dsh-wf-retry, .dsh-wf-more { align-self: flex-start; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; }
    `;
    function emptyPageStates() {
      return { events: void 0, runs: void 0 };
    }
    function updatePageState(states, kind, value) {
      return { ...states, [kind]: value };
    }
    function pageOf(body, items) {
      return { items, ...body.next === void 0 ? {} : { next: body.next } };
    }
    function isStaleGeneration(requested, current) {
      return requested !== current;
    }
    function WorkflowsView(props) {
      const { sessionId, t } = props;
      const [state, setState] = (0, import_react.useState)({ phase: "loading" });
      const [selected, setSelected] = (0, import_react.useState)(void 0);
      const loadId = (0, import_react.useRef)(0);
      const pendingPages = (0, import_react.useRef)(/* @__PURE__ */ new Set());
      const [pageStates, setPageStates] = (0, import_react.useState)({
        events: void 0,
        runs: void 0
      });
      const load = () => {
        if (sessionId === void 0) return;
        const generation = ++loadId.current;
        pendingPages.current.clear();
        setPageStates(emptyPageStates());
        setState({ phase: "loading" });
        Promise.all([
          requestJson(healthUrl(sessionId)),
          requestJson(triggersUrl(sessionId)),
          requestJson(eventsUrl(sessionId)),
          requestJson(runsUrl(sessionId))
        ]).then(
          ([health, triggers, events, runs]) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            setState({
              phase: "ready",
              loaded: {
                health,
                triggers: triggers.triggers,
                events: pageOf(events, events.events),
                runs: pageOf(runs, runs.runs)
              }
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            setState({
              phase: "error",
              message: error instanceof Error ? error.message : String(error)
            });
          }
        );
      };
      (0, import_react.useEffect)(() => {
        load();
        return () => {
          loadId.current += 1;
        };
      }, [sessionId]);
      if (sessionId === void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-wf", "data-state": "no-session", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-wf-muted", children: t("state.noSession") }) });
      }
      const mergeEvents = () => {
        const next = state.loaded?.events.next;
        if (next === void 0) return;
        const key = `events:${next}`;
        if (pendingPages.current.has(key)) return;
        const generation = loadId.current;
        pendingPages.current.add(key);
        setPageStates((current) => updatePageState(current, "events", { key, phase: "loading" }));
        void requestJson(eventsUrl(sessionId, next)).then(
          (page) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            setPageStates((current) => updatePageState(current, "events", void 0));
            setState((current) => {
              if (current.loaded === void 0) return current;
              return {
                ...current,
                loaded: {
                  ...current.loaded,
                  events: pageOf(page, [...current.loaded.events.items, ...page.events])
                }
              };
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            setPageStates(
              (current) => updatePageState(current, "events", {
                key,
                phase: "error",
                message: error instanceof Error ? error.message : String(error)
              })
            );
          }
        );
      };
      const mergeRuns = () => {
        const next = state.loaded?.runs.next;
        if (next === void 0) return;
        const key = `runs:${next}`;
        if (pendingPages.current.has(key)) return;
        const generation = loadId.current;
        pendingPages.current.add(key);
        setPageStates((current) => updatePageState(current, "runs", { key, phase: "loading" }));
        void requestJson(runsUrl(sessionId, next)).then(
          (page) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            setPageStates((current) => updatePageState(current, "runs", void 0));
            setState((current) => {
              if (current.loaded === void 0) return current;
              return {
                ...current,
                loaded: {
                  ...current.loaded,
                  runs: pageOf(page, [...current.loaded.runs.items, ...page.runs])
                }
              };
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            setPageStates(
              (current) => updatePageState(current, "runs", {
                key,
                phase: "error",
                message: error instanceof Error ? error.message : String(error)
              })
            );
          }
        );
      };
      let body;
      const pageProps = (kind, next) => {
        const page = pageStates[kind];
        if (next === void 0 || page?.key !== `${kind}:${next}`) return {};
        if (page.phase === "loading") return { loading: true };
        return { error: page.message ?? t("state.error") };
      };
      if (state.phase === "loading") {
        body = /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(LoadingLine, { t });
      } else if (state.phase === "error") {
        body = /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(ErrorLine, { message: state.message ?? "", t, onRetry: load });
      } else {
        const loaded = state.loaded;
        const selectedRun = loaded.runs.items.find((run) => run.id === selected);
        body = /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(HealthStrip, { health: loaded.health, t }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(TriggersTable, { triggers: loaded.triggers, t }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(EventList, { events: loaded.events.items, t }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            LoadMore,
            {
              next: loaded.events.next,
              t,
              onLoad: mergeEvents,
              ...pageProps("events", loaded.events.next)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            RunsList,
            {
              runs: loaded.runs.items,
              t,
              ...selected === void 0 ? {} : { selected },
              onSelect: (run) => setSelected(run.id)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            LoadMore,
            {
              next: loaded.runs.next,
              t,
              onLoad: mergeRuns,
              ...pageProps("runs", loaded.runs.next)
            }
          ),
          selectedRun === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RunDetail, { run: selectedRun, t, session: sessionId }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(WhyNotTable, { events: loaded.events.items, t })
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-wf", "data-state": state.phase, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: VIEW_CSS }),
        body
      ] });
    }

    // packages/plugin-workflows/src/client/index.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    var ENTRY_LIMITATION = "The host exposes no command that opens a conversation view; the Workflows tab is the entry.";
    var inject = ["slots", "locale"];
    var NS = "dsh-setup-workflows";
    function apply(ctx) {
      try {
        if (ctx.slots === void 0 || ctx.locale === void 0) {
          throw new Error("the conversation, slot, or locale services are unavailable");
        }
        const slots = ctx.slots;
        const locale = ctx.locale;
        ctx.effect(() => locale.register(NS, "en", EN));
        const t = locale.bind(NS);
        ctx.effect(
          () => slots.inject(
            "conversation.view",
            () => slots.register(
              { name: "conversation.view", id: "workflows", order: 30, label: () => t("view.label") },
              (props) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                WorkflowsView,
                {
                  t,
                  ...props.sessionId === void 0 ? {} : { sessionId: props.sessionId }
                }
              )
            )
          )
        );
      } catch (error) {
        console.error(
          `workflows: Client registration failed (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }
    return module.exports;
  },
});
