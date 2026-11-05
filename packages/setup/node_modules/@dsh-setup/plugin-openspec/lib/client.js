window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-openspec",
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

    // packages/plugin-openspec/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      CHANGES_PATH: () => CHANGES_PATH,
      CapabilityBody: () => CapabilityBody,
      CapabilityView: () => CapabilityView,
      ChangeBody: () => ChangeBody,
      ChangeView: () => ChangeView,
      FileWatch: () => FileWatch,
      OpenSpecTab: () => OpenSpecTab,
      RootBody: () => RootBody,
      RootView: () => RootView,
      apply: () => apply,
      createHandoff: () => createHandoff,
      inject: () => inject,
      registerPanel: () => registerPanel
    });
    module.exports = __toCommonJS(index_exports);
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react = require("react");

    // packages/plugin-openspec/src/client/panel.ts
    var CHANGE_PATH = "api/plugins/dsh-setup-openspec/change";
    var SPECS_PATH = "api/plugins/dsh-setup-openspec/specs";
    var OPENSPEC_ID = "@dsh-setup/plugin-openspec/panel";
    var OPENSPEC_KIND = "openspec";
    var ROOT_ADDRESS = "sidebar://openspec";
    var SPECS_ADDRESS = "dsh-resource://openspec/specs";
    var PROPOSE_DRAFT = "/openspec-propose ";
    function applyDraft(name) {
      return `/openspec-apply-change ${name}`;
    }
    var CHANGE_SEGMENT = "dsh-resource://openspec/change/";
    var CAPABILITY_SEGMENT = "dsh-resource://openspec/spec/";
    function changeAddress(name) {
      return `${CHANGE_SEGMENT}${encodeURIComponent(name)}`;
    }
    function capabilityAddress(id) {
      return `${CAPABILITY_SEGMENT}${encodeURIComponent(id)}`;
    }
    function singleSegment(address, prefix) {
      if (!address.startsWith(prefix)) return void 0;
      const rest = address.slice(prefix.length);
      if (rest === "" || rest.includes("/") || rest.includes("?") || rest.includes("#"))
        return void 0;
      try {
        const value = decodeURIComponent(rest);
        return value === "" ? void 0 : value;
      } catch {
        return void 0;
      }
    }
    function openSpecTarget(address) {
      if (address === ROOT_ADDRESS) return { view: "root", segment: "changes" };
      if (address === SPECS_ADDRESS) return { view: "root", segment: "specs" };
      const name = singleSegment(address, CHANGE_SEGMENT);
      if (name !== void 0) return { view: "change", name };
      const id = singleSegment(address, CAPABILITY_SEGMENT);
      if (id !== void 0) return { view: "capability", id };
      return void 0;
    }
    function canOpenOpenSpec(address) {
      return openSpecTarget(address) !== void 0;
    }
    function openSpecTitle(address) {
      const target = openSpecTarget(address);
      if (target?.view === "change") return target.name;
      if (target?.view === "capability") return target.id;
      return "OpenSpec";
    }
    function fileAddress(sessionId, path) {
      return `dsh-resource://file/session/${sessionId}/${path}`;
    }
    function changeArtifactPath(name, kind) {
      return `openspec/changes/${name}/${kind}.md`;
    }
    function deltaSpecPath(name, capability) {
      return `openspec/changes/${name}/specs/${capability}/spec.md`;
    }
    function capabilitySpecPath(id) {
      return `openspec/specs/${id}/spec.md`;
    }
    function changeWatchPaths(name, capabilities) {
      return [
        changeArtifactPath(name, "proposal"),
        changeArtifactPath(name, "design"),
        changeArtifactPath(name, "tasks"),
        ...capabilities.map((capability) => deltaSpecPath(name, capability))
      ];
    }
    function updatedLabel(modified, now = /* @__PURE__ */ new Date()) {
      if (modified === null) return null;
      const date = new Date(modified);
      if (Number.isNaN(date.getTime())) return null;
      const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
      const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
      if (sameDay) return `Updated ${time}`;
      return `Updated ${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${time}`;
    }
    function two(value) {
      return String(value).padStart(2, "0");
    }
    function sortChanges(rows) {
      return [...rows].sort(
        (left, right) => Number(left.status === "complete") - Number(right.status === "complete")
      );
    }
    var ARTIFACT_KINDS = ["proposal", "design", "specs", "tasks"];
    function hasArtifact(change, kind) {
      return kind === "specs" ? change.specs.length > 0 : change.artifacts[kind] !== null;
    }
    function initialArtifact(change) {
      return ARTIFACT_KINDS.find((kind) => hasArtifact(change, kind)) ?? "proposal";
    }
    var LOADING = { phase: "loading" };
    function isRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    async function request(path, failure, notUnderstood, decode) {
      const response = await fetch(path, {
        headers: { accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) {
        const body2 = await response.json().catch(() => void 0);
        throw new Error(
          typeof body2?.error === "string" ? body2.error : `${failure} (${String(response.status)}).`
        );
      }
      const body = await response.json();
      const value = isRecord(body) ? decode(body) : void 0;
      if (value === void 0) throw new Error(notUnderstood);
      return value;
    }
    async function requestChange(sessionId, name) {
      return request(
        `${CHANGE_PATH}?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`,
        "The OpenSpec change request failed",
        "The OpenSpec change response was not understood.",
        (body) => isRecord(body.change) ? body.change : void 0
      );
    }
    async function requestCapabilities(sessionId) {
      return request(
        `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}`,
        "The OpenSpec capability list request failed",
        "The OpenSpec capability list response was not understood.",
        (body) => Array.isArray(body.capabilities) ? body.capabilities : void 0
      );
    }
    async function requestCapability(sessionId, id) {
      return request(
        `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`,
        "The OpenSpec capability request failed",
        "The OpenSpec capability response was not understood.",
        (body) => isRecord(body.capability) ? body.capability : void 0
      );
    }

    // packages/plugin-openspec/src/client/index.tsx
    var import_jsx_runtime = require("react/jsx-runtime");
    var CHANGES_PATH = "api/plugins/dsh-setup-openspec/changes";
    var inject = ["commandUi", "sessions", "conversation"];
    async function requestChanges(sessionId) {
      const response = await fetch(`${CHANGES_PATH}?session=${encodeURIComponent(sessionId)}`, {
        headers: { accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) {
        const body2 = await response.json().catch(() => void 0);
        throw new Error(
          typeof body2?.error === "string" ? body2.error : `The OpenSpec change list request failed (${String(response.status)}).`
        );
      }
      const body = await response.json();
      if (!Array.isArray(body.changes)) {
        throw new Error("The OpenSpec change list response was not understood.");
      }
      return body.changes;
    }
    function optionsOf(changes) {
      return changes.filter((change) => change.status !== "complete").map((change) => ({
        id: change.name,
        label: change.name,
        detail: `${String(change.completedTasks)}/${String(change.totalTasks)}`
      }));
    }
    function apply(ctx) {
      const commands = ctx.get("commandUi");
      const sessions = ctx.get("sessions");
      const conversation = ctx.get("conversation");
      if (commands === void 0 || sessions === void 0 || conversation === void 0) return;
      ctx.effect(
        () => commands.register({
          name: "openspec-apply",
          label: () => "OpenSpec: apply a change",
          description: () => "Pick an unfinished OpenSpec change and fill the apply-change command line",
          available: () => true,
          ui: {
            kind: "popupSelect",
            options: async (session) => optionsOf(await requestChanges(session.sessionId)),
            onSelect: async (option, session) => {
              const actx = sessions.scope(session.sessionId);
              if (actx === void 0) {
                throw new Error("The session is not open, so the command line was not filled.");
              }
              conversation.input.for(actx).setDraft(`/openspec-apply-change ${option.id}`);
            }
          }
        })
      );
      ctx.inject(PANEL_SERVICES, (panelCtx) => {
        registerPanel(panelCtx);
      });
    }
    var PANEL_SERVICES = ["sidebarRight", "sidebarRightTabs", "slots", "locale", "resources"];
    var NS = "dsh-setup-openspec-panel";
    var EN = {
      "guide.title": "OpenSpec",
      "guide.description": "Browse OpenSpec changes and capability specs",
      "segment.label": "OpenSpec view",
      "segment.changes": "Changes",
      "segment.specs": "Specs",
      "state.loading": "Loading\u2026",
      "state.retry": "Retry",
      "changes.empty": "No open changes in this workspace.",
      "changes.propose": "Propose a change",
      "capabilities.empty": "No capability specs yet. Sync an accepted change to add one.",
      "presence.proposal": "proposal",
      "presence.design": "design",
      "presence.spec": "spec",
      "presence.specs": "specs",
      "presence.tasks": "tasks",
      "status.complete": "complete",
      "status.inProgress": "in progress",
      "status.noTasks": "no tasks",
      "change.apply": "Apply change",
      "change.tasks": "tasks",
      "change.artifactLabel": "Change artifacts",
      "change.deltas": "delta specs",
      "artifact.proposal": "Why",
      "artifact.design": "Design",
      "artifact.specs": "Specs",
      "artifact.tasks": "Tasks",
      "artifact.notWritten": "Not written yet.",
      "capability.requirements": "requirements",
      "markdown.copy": "Copy",
      "markdown.copied": "Copied",
      "markdown.footnotes": "Footnotes"
    };
    var fallbackTranslate = (key) => EN[key] ?? key;
    var noResource = () => ({ status: "none" });
    function registerPanel(ctx) {
      const tabs = ctx.get("sidebarRightTabs");
      const slots = ctx.get("slots");
      const locale = ctx.get("locale");
      const sidebarRight = ctx.get("sidebarRight");
      if (tabs === void 0 || slots === void 0 || locale === void 0 || sidebarRight === void 0 || ctx.get("resources") === void 0) {
        return;
      }
      const sessions = ctx.get("sessions");
      const conversation = ctx.get("conversation");
      const handoff = createHandoff(sessions, conversation, sidebarRight);
      ctx.effect(() => locale.register(NS, "en", EN));
      const t = locale.bind(NS);
      ctx.effect(
        () => tabs.register({
          id: OPENSPEC_ID,
          kind: OPENSPEC_KIND,
          patterns: [ROOT_ADDRESS, "dsh-resource://openspec/**"],
          priority: "extension",
          canOpen: canOpenOpenSpec,
          title: openSpecTitle,
          guide: [
            {
              id: "open",
              commandId: "openspec.panel",
              order: 10,
              title: () => t("guide.title"),
              description: () => t("guide.description")
            }
          ]
        })
      );
      ctx.effect(
        () => slots.inject(
          "sidebar.right.pane.tab",
          () => slots.register({ name: "sidebar.right.pane.tab", key: OPENSPEC_ID, locale: NS }, (props) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OpenSpecTab, { ...props, handoff }))
        )
      );
    }
    function createHandoff(sessions, conversation, sidebarRight) {
      return {
        draft(sessionId, text) {
          const actx = sessions?.scope(sessionId);
          if (actx === void 0 || conversation === void 0) {
            throw new Error("The session is not open, so the command line was not filled.");
          }
          conversation.input.for(actx).setDraft(text);
        },
        open(address) {
          sidebarRight.openResource(address);
        }
      };
    }
    function OpenSpecTab(props) {
      const { tab } = props.useTabInfo();
      const target = openSpecTarget(tab.navigation.address);
      const t = props.t ?? fallbackTranslate;
      if (target === void 0) return null;
      const draft = (text) => {
        props.handoff?.draft(props.sessionId, text);
      };
      const open = (address) => {
        const action = tab.actions.openResource;
        if (typeof action === "function") action(address);
        else props.handoff?.open(address);
      };
      let body;
      if (target.view === "root") {
        body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          RootBody,
          {
            tab,
            initialSegment: target.segment,
            sessionId: props.sessionId,
            t,
            draft,
            open
          }
        );
      } else if (target.view === "change") {
        body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ChangeBody,
          {
            tab,
            name: target.name,
            sessionId: props.sessionId,
            t,
            draft,
            open,
            useResource: props.useResource
          }
        );
      } else {
        body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          CapabilityBody,
          {
            tab,
            id: target.id,
            sessionId: props.sessionId,
            t,
            useResource: props.useResource
          }
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
        body
      ] });
    }
    function useRead(read) {
      const [state, setState] = (0, import_react.useState)(LOADING);
      const sequence = (0, import_react.useRef)(0);
      const reload = () => {
        const current = sequence.current + 1;
        sequence.current = current;
        setState(LOADING);
        read().then(
          (value) => {
            if (sequence.current === current) setState({ phase: "ready", value });
          },
          (error) => {
            if (sequence.current === current) {
              setState({
                phase: "error",
                message: error instanceof Error ? error.message : String(error)
              });
            }
          }
        );
      };
      return { state, reload };
    }
    function useTabRefresh(tab, reload) {
      const latest = (0, import_react.useRef)(reload);
      latest.current = reload;
      (0, import_react.useEffect)(() => tab.actions.bindCommands({ refresh: () => latest.current() }), [tab.actions]);
      const wasVisible = (0, import_react.useRef)(tab.visible);
      (0, import_react.useEffect)(() => {
        if (tab.visible && !wasVisible.current) latest.current();
        wasVisible.current = tab.visible;
      }, [tab.visible]);
    }
    var LIVE_DEBOUNCE_MS = 300;
    function FileWatch(props) {
      const file = props.useResource(props.address);
      const state = (0, import_react.useRef)({ settled: false, live: false });
      const settled = (0, import_react.useRef)(props.settle);
      settled.current = props.settle;
      const changed = (0, import_react.useRef)(props.change);
      changed.current = props.change;
      const status = file.status;
      const version = file.value?.version;
      (0, import_react.useEffect)(() => {
        const current = state.current;
        if (status === "loading") return;
        if (!current.settled) {
          current.settled = true;
          settled.current(props.address, status === "live");
          current.baseline = version;
          current.live = status === "live";
          return;
        }
        if (status === "live") {
          if (!current.live) {
            changed.current();
            current.baseline = version;
            current.live = true;
          } else if (version !== current.baseline) {
            current.baseline = version;
            changed.current();
          }
          return;
        }
        if (current.live) {
          current.live = false;
          changed.current();
        }
      }, [status, version]);
      return null;
    }
    function createObservationBatch(reconcile) {
      const known = /* @__PURE__ */ new Set();
      const pending = /* @__PURE__ */ new Set();
      let observable = false;
      let closed = true;
      return {
        add(addresses) {
          let added = false;
          for (const address of addresses) {
            if (known.has(address)) continue;
            known.add(address);
            pending.add(address);
            added = true;
          }
          if (added) closed = false;
        },
        settle(address, live) {
          if (closed || !pending.delete(address)) return;
          if (live) observable = true;
          if (pending.size > 0) return;
          const fire = observable;
          observable = false;
          closed = true;
          if (fire) reconcile();
        },
        clear() {
          known.clear();
          pending.clear();
          observable = false;
          closed = true;
        }
      };
    }
    function useObservation(reconcile) {
      const batch = (0, import_react.useRef)(void 0);
      if (batch.current === void 0) batch.current = createObservationBatch(reconcile);
      const disposed = (0, import_react.useRef)(false);
      (0, import_react.useEffect)(
        () => () => {
          disposed.current = true;
          batch.current?.clear();
        },
        []
      );
      return {
        add(addresses) {
          if (!disposed.current) batch.current?.add(addresses);
        },
        settle(address, observable) {
          if (!disposed.current) batch.current?.settle(address, observable);
        },
        change() {
          if (!disposed.current) reconcile();
        }
      };
    }
    function useLiveReload(reload) {
      const latest = (0, import_react.useRef)(reload);
      latest.current = reload;
      const timer = (0, import_react.useRef)(void 0);
      (0, import_react.useEffect)(
        () => () => {
          if (timer.current !== void 0) clearTimeout(timer.current);
          timer.current = void 0;
        },
        []
      );
      return () => {
        if (timer.current !== void 0) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = void 0;
          latest.current();
        }, LIVE_DEBOUNCE_MS);
      };
    }
    function useMarkdownLabels(t) {
      return (0, import_react.useMemo)(
        () => ({
          code: { copyLabel: t("markdown.copy"), copiedLabel: t("markdown.copied") },
          footnotes: t("markdown.footnotes")
        }),
        [t]
      );
    }
    function RootBody(props) {
      const { tab, initialSegment, sessionId, t, draft, open } = props;
      const [segment, setSegment] = (0, import_react.useState)(initialSegment);
      const changes = useRead(() => requestChanges(sessionId));
      const capabilities = useRead(() => requestCapabilities(sessionId));
      const started = (0, import_react.useRef)({ changes: false, specs: false });
      const load = (next) => {
        started.current[next] = true;
        if (next === "changes") changes.reload();
        else capabilities.reload();
      };
      (0, import_react.useEffect)(() => {
        load(initialSegment);
      }, []);
      useTabRefresh(tab, () => {
        if (segment === "changes") changes.reload();
        else capabilities.reload();
      });
      const choose = (next) => {
        setSegment(next);
        if (!started.current[next]) load(next);
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        RootView,
        {
          segment,
          changes: changes.state,
          capabilities: capabilities.state,
          t,
          onSegment: choose,
          onRetry: () => load(segment),
          onOpenChange: (name) => open(changeAddress(name)),
          onOpenCapability: (id) => open(capabilityAddress(id)),
          onPropose: () => draft(PROPOSE_DRAFT)
        }
      );
    }
    function ChangeBody(props) {
      const { tab, name, sessionId, t, draft } = props;
      const read = useRead(() => requestChange(sessionId, name));
      const [artifact, setArtifact] = (0, import_react.useState)(void 0);
      const [delta, setDelta] = (0, import_react.useState)(void 0);
      (0, import_react.useEffect)(() => {
        read.reload();
      }, []);
      useTabRefresh(tab, read.reload);
      const notify = useLiveReload(read.reload);
      const observation = useObservation(notify);
      const labels = useMarkdownLabels(t);
      const knownDeltas = (0, import_react.useRef)(/* @__PURE__ */ new Set());
      if (read.state.phase === "ready") {
        for (const spec of read.state.value.specs) knownDeltas.current.add(spec.capability);
      }
      const addresses = changeWatchPaths(name, [...knownDeltas.current]).map(
        (path) => fileAddress(sessionId, path)
      );
      observation.add(addresses);
      const useResource = props.useResource ?? noResource;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        addresses.map((address) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          FileWatch,
          {
            address,
            useResource,
            settle: observation.settle,
            change: observation.change
          },
          address
        )),
        readContent(read.state, t, read.reload, (change) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ChangeView,
          {
            change,
            artifact: artifact ?? initialArtifact(change),
            delta: delta ?? change.specs[0]?.capability,
            t,
            labels,
            onArtifact: setArtifact,
            onDelta: setDelta,
            onApply: () => draft(applyDraft(change.name))
          }
        ))
      ] });
    }
    function CapabilityBody(props) {
      const { tab, id, sessionId, t } = props;
      const read = useRead(() => requestCapability(sessionId, id));
      (0, import_react.useEffect)(() => {
        read.reload();
      }, []);
      useTabRefresh(tab, read.reload);
      const notify = useLiveReload(read.reload);
      const observation = useObservation(notify);
      const labels = useMarkdownLabels(t);
      const address = fileAddress(sessionId, capabilitySpecPath(id));
      observation.add([address]);
      const useResource = props.useResource ?? noResource;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          FileWatch,
          {
            address,
            useResource,
            settle: observation.settle,
            change: observation.change
          }
        ),
        readContent(read.state, t, read.reload, (capability) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CapabilityView, { capability, t, labels }))
      ] });
    }
    function readContent(state, t, retry, ready) {
      if (state.phase === "loading") {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-panel", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", role: "status", children: t("state.loading") }) }) });
      }
      if (state.phase === "error") {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-panel", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-state", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: state.message }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", onClick: retry, children: t("state.retry") })
        ] }) }) });
      }
      return ready(state.value);
    }
    function RootView(props) {
      const { segment, changes, capabilities, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: "dsh-openspec-root",
            value: segment,
            options: [
              { value: "changes", label: t("segment.changes") },
              { value: "specs", label: t("segment.specs") }
            ],
            onChange: props.onSegment,
            label: t("segment.label"),
            className: "dsh-openspec-segments"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: segment === "changes" ? readContent(
          changes,
          t,
          props.onRetry,
          (rows) => changeRows(rows, t, props.onOpenChange, props.onPropose)
        ) : readContent(
          capabilities,
          t,
          props.onRetry,
          (rows) => capabilityRows(rows, t, props.onOpenCapability)
        ) })
      ] });
    }
    function changeRows(rows, t, onOpen, onPropose) {
      const sorted = sortChanges(rows);
      if (sorted.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-state", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("changes.empty") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", onClick: onPropose, children: t("changes.propose") })
        ] });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: sorted.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsh-openspec-row",
          onClick: () => onOpen(row.name),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-row-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-name", children: row.name }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-progress", children: `${String(row.completedTasks)}/${String(row.totalTasks)}` })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-facts", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.StateDot, { state: row.status === "complete" ? "done" : "ongoing" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: statusLabel(row.status, t) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-tags", children: presenceFacts(row.presence, t) })
            ] })
          ]
        },
        row.name
      )) });
    }
    function capabilityRows(rows, t, onOpen) {
      if (rows.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-state", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("capabilities.empty") }) });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsh-openspec-row",
          onClick: () => onOpen(row.id),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-row-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-name", children: row.id }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-facts", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(row.requirementCount)} ${t("capability.requirements")}` }) })
          ]
        },
        row.id
      )) });
    }
    function statusLabel(status, t) {
      if (status === "complete") return t("status.complete");
      if (status === "no-tasks") return t("status.noTasks");
      return t("status.inProgress");
    }
    function presenceFacts(presence, t) {
      if (presence === void 0) return [];
      const facts = [];
      if (presence.proposal) {
        facts.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: t("presence.proposal") }, "proposal")
        );
      }
      if (presence.design) {
        facts.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: t("presence.design") }, "design")
        );
      }
      if (presence.specs > 0) {
        facts.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: presence.specs === 1 ? t("presence.spec") : t("presence.specs") }, "specs")
        );
      }
      if (presence.tasks) {
        facts.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: t("presence.tasks") }, "tasks")
        );
      }
      return facts;
    }
    function ChangeView(props) {
      const { change, artifact, delta, t, labels } = props;
      const updated = updatedLabel(change.modified, props.now);
      const options = ARTIFACT_KINDS.map((kind) => {
        const option = {
          value: kind,
          label: t(`artifact.${kind}`)
        };
        if (!hasArtifact(change, kind)) {
          option.disabled = true;
          option.title = t("artifact.notWritten");
        }
        return option;
      });
      const selectedSpec = change.specs.find((spec) => spec.capability === delta) ?? change.specs[0];
      const body = artifact === "specs" ? null : change.artifacts[artifact];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-name", children: change.name }),
          updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-updated", children: updated }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-progress", children: [
            `${String(change.completedTasks)}/${String(change.totalTasks)}`,
            " ",
            t("change.tasks")
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", onClick: props.onApply, children: t("change.apply") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: `dsh-openspec-artifacts-${encodeURIComponent(change.name)}`,
            value: artifact,
            options,
            onChange: props.onArtifact,
            label: t("change.artifactLabel"),
            className: "dsh-openspec-segments"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: artifact === "specs" ? selectedSpec === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: t("artifact.notWritten") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          change.specs.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-deltas", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${String(change.specs.length)} ${t("change.deltas")}` }),
            change.specs.map((spec) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Pill,
              {
                active: spec.capability === selectedSpec.capability,
                onClick: () => props.onDelta(spec.capability),
                children: spec.capability
              },
              spec.capability
            ))
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: selectedSpec.body, labels }) })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: body === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: t("artifact.notWritten") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: body, labels }) }) })
      ] });
    }
    function CapabilityView(props) {
      const { capability, t, labels } = props;
      const updated = updatedLabel(capability.modified, props.now);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-name", children: capability.id }),
          updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-updated", children: updated }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-progress", children: `${String(capability.requirementCount)} ${t("capability.requirements")}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: capability.body, labels }) }) })
      ] });
    }
    var CSS = `
    .dsh-openspec-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      min-width: 0;
      min-height: 0;
      height: 100%;
      padding: 8px;
      overflow: hidden;
    }
    .dsh-openspec-segments {
      min-width: 0;
    }
    .dsh-openspec-scroll {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }
    .dsh-openspec-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-name {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .dsh-openspec-progress {
      margin-left: auto;
    }
    .dsh-openspec-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .dsh-openspec-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 8px;
      border: 0;
      border-radius: var(--dsw-radius-sm);
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .dsh-openspec-row-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-row-head .dsh-openspec-progress {
      margin-left: auto;
    }
    .dsh-openspec-facts {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .dsh-openspec-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-width: 0;
    }
    .dsh-openspec-state {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
      padding: 8px;
    }
    .dsh-openspec-deltas {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .dsh-openspec-body {
      min-width: 0;
      overflow-x: auto;
    }
    `;
    return module.exports;
  },
});
