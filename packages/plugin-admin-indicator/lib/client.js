window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-admin-indicator",
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

    // packages/plugin-admin-indicator/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      AdminIndicator: () => AdminIndicator,
      apply: () => apply,
      canRunAction: () => canRunAction,
      confirmRestart: () => confirmRestart,
      inject: () => inject,
      menuAction: () => menuAction,
      runAction: () => runAction,
      submitCommand: () => submitCommand
    });
    module.exports = __toCommonJS(index_exports);
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react = require("react");
    var import_jsx_runtime = require("react/jsx-runtime");
    var EMPTY_INPUT = {
      draft: "",
      draftRev: 0,
      attachmentIds: [],
      occurrences: [],
      phase: "plain"
    };
    var inject = ["slots", "locale"];
    var NS = "dsh-setup-admin-indicator";
    var STATUS_PATH = "/plugins/dsh-setup-admin-indicator/status";
    var SHORTCUT_PATH = "/plugins/dsh-setup-admin-indicator/shortcut";
    async function runAction(fetcher = fetch) {
      try {
        const response = await fetcher(SHORTCUT_PATH, {
          method: "POST",
          credentials: "same-origin",
          headers: { accept: "application/json" }
        });
        const body = await response.json().catch(() => void 0);
        if (!response.ok) {
          return {
            ok: false,
            text: typeof body?.error === "string" ? body.error : `The action failed (${String(response.status)}).`
          };
        }
        if (body?.ok !== true) {
          return {
            ok: false,
            text: typeof body?.text === "string" ? body.text : "The action was refused."
          };
        }
        return { ok: true, text: typeof body?.text === "string" ? body.text : "Done." };
      } catch (error) {
        return { ok: false, text: error instanceof Error ? error.message : String(error) };
      }
    }
    var EN = {
      "label.administrator": "Administrator",
      "label.standard": "Standard User",
      "tooltip.admin": "Administrator: DSH and all tools are running elevated",
      "tooltip.standard": "Standard User: DSH is not running as administrator",
      "menu.admin.title": "Administrator",
      "menu.standard.title": "Standard User",
      "menu.admin.body": "DSH and every session, tool, and terminal run with administrator rights.",
      "menu.standard.body": "DSH is not elevated. Restart it elevated to run with administrator rights.",
      "menu.standard.bodyShortcut": "DSH is not elevated. Create an admin desktop shortcut to launch it elevated.",
      "menu.create": "Create admin desktop shortcut",
      "menu.unsupported": "These actions can only be used from the Desktop app.",
      "menu.alreadyAdmin": "Already running as administrator.",
      "menu.restart": "Restart DSH as Administrator",
      "menu.restartWarning": "This closes DSH and starts an elevated instance. The current session ends.",
      "menu.restartConfirm": "Restart",
      "menu.restartCancel": "Cancel",
      "menu.clearDraft": "Clear the composer draft, references, and attachments to use these actions.",
      "modal.close": "Close"
    };
    function canRunAction(input) {
      return input.draft.trim() === "" && input.attachmentIds.length === 0 && input.occurrences.length === 0 && input.phase === "plain";
    }
    function submitCommand(actions, command, input) {
      if (actions === void 0 || !canRunAction(input)) return false;
      if (actions.captureInsertion().draftRev !== input.draftRev) return false;
      actions.setDraft(command);
      queueMicrotask(() => actions.submit());
      return true;
    }
    function menuAction(id, actions, input) {
      if (actions === void 0 || !canRunAction(input)) return "none";
      if (id === "shortcut") {
        return submitCommand(actions, "/admin-shortcut", input) ? "shortcut" : "none";
      }
      if (id === "restart") return "restart";
      return "none";
    }
    function confirmRestart(actions, input) {
      return submitCommand(actions, "/admin-restart confirm", input);
    }
    function apply(ctx) {
      try {
        ctx.locale.register(NS, "en", EN);
        const t = ctx.locale.bind(NS);
        ctx.slots.inject(
          "conversation.input.left",
          () => ctx.slots.register({ name: "conversation.input.left", id: NS, order: 50 }, (props = {}) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdminIndicator, { t, inputActions: props.inputActions, useInput: props.useInput }))
        );
      } catch (error) {
        console.error("admin indicator: Client registration failed", error);
      }
    }
    function ShieldIcon({ administrator }) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", focusable: "false", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M8 1.5 13 3.2v4.1c0 3.4-2.1 5.8-5 7.2-2.9-1.4-5-3.8-5-7.2V3.2Z",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.3",
            strokeLinejoin: "round"
          }
        ),
        administrator ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "m5.4 7.6 1.8 1.8 3.4-3.6",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.3",
            strokeLinecap: "round",
            strokeLinejoin: "round"
          }
        ) : null
      ] });
    }
    function ShortcutIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", focusable: "false", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "rect",
          {
            x: "1.5",
            y: "2.5",
            width: "13",
            height: "9",
            rx: "1.5",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.3"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M5.5 14h5M8 11.5V14M8 5v4M6 7h4",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.3",
            strokeLinecap: "round"
          }
        )
      ] });
    }
    function RestartIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", focusable: "false", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "path",
        {
          d: "M13 8a5 5 0 1 1-1.4-3.5M13 2.5V5h-2.5",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.3",
          strokeLinecap: "round",
          strokeLinejoin: "round"
        }
      ) });
    }
    function CancelIcon() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true", focusable: "false", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "path",
        {
          d: "m4.5 4.5 7 7M11.5 4.5l-7 7",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.3",
          strokeLinecap: "round"
        }
      ) });
    }
    function AdminIndicator({
      t,
      inputActions,
      useInput
    }) {
      const [status, setStatus] = (0, import_react.useState)(null);
      const [open, setOpen] = (0, import_react.useState)(false);
      const [confirmOpen, setConfirmOpen] = (0, import_react.useState)(false);
      const [busy, setBusy] = (0, import_react.useState)(false);
      const [toast, setToast] = (0, import_react.useState)(null);
      const toastSeq = (0, import_react.useRef)(0);
      const input = (useInput ?? (() => EMPTY_INPUT))((state) => state);
      const liveAttachments = (0, import_react.useRef)(new Set(input.attachmentIds));
      liveAttachments.current = new Set(input.attachmentIds);
      (0, import_react.useEffect)(() => {
        let active = true;
        fetch(STATUS_PATH, {
          headers: { accept: "application/json" },
          credentials: "same-origin"
        }).then((response) => response.ok ? response.json() : null).then((value) => {
          if (!active || value === null || value.platform !== "win32") return;
          if (value.elevated !== "administrator" && value.elevated !== "standard") return;
          setStatus(value);
        }).catch(() => {
        });
        return () => {
          active = false;
        };
      }, []);
      (0, import_react.useEffect)(() => {
        if (inputActions === void 0) return;
        const add = inputActions.addAttachments;
        const remove = inputActions.removeAttachment;
        const prune = inputActions.pruneAttachments;
        inputActions.addAttachments = (ids) => {
          for (const id of ids) liveAttachments.current.add(id);
          return add(ids);
        };
        inputActions.removeAttachment = (id) => {
          liveAttachments.current.delete(id);
          remove(id);
        };
        inputActions.pruneAttachments = (ids) => {
          const keep = new Set(ids);
          for (const id of [...liveAttachments.current]) {
            if (!keep.has(id)) liveAttachments.current.delete(id);
          }
          prune(ids);
        };
        return () => {
          inputActions.addAttachments = add;
          inputActions.removeAttachment = remove;
          inputActions.pruneAttachments = prune;
        };
      }, [inputActions]);
      if (status === null) return null;
      const administrator = status.elevated === "administrator";
      const restartEnabled = status.restart === true;
      const label = administrator ? t("tooltip.admin") : t("tooltip.standard");
      const canAct = inputActions !== void 0 && canRunAction(input);
      const currentInput = () => ({
        ...input,
        attachmentIds: [...liveAttachments.current]
      });
      const restart = () => {
        if (!canAct || !restartEnabled) return;
        setConfirmOpen(false);
        confirmRestart(inputActions, currentInput());
      };
      const createShortcut = async () => {
        setBusy(true);
        const outcome = await runAction();
        setBusy(false);
        toastSeq.current += 1;
        setToast({ key: toastSeq.current, text: outcome.text, success: outcome.ok });
      };
      const items = [
        {
          type: "label",
          id: "state",
          text: t(administrator ? "menu.admin.title" : "menu.standard.title")
        },
        {
          type: "label",
          id: "explanation",
          text: t(
            administrator ? "menu.admin.body" : restartEnabled ? "menu.standard.body" : "menu.standard.bodyShortcut"
          )
        },
        { type: "separator", id: "actions" }
      ];
      if (!status.desktop) {
        items.push({ type: "label", id: "unsupported", text: t("menu.unsupported") });
      } else {
        items.push({
          id: "shortcut",
          label: t("menu.create"),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShortcutIcon, {}),
          disabled: busy
        });
        if (administrator) {
          items.push({ type: "label", id: "already-admin", text: t("menu.alreadyAdmin") });
        } else if (restartEnabled) {
          items.push({
            id: "restart",
            label: t("menu.restart"),
            icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartIcon, {}),
            disabled: !canAct
          });
        }
        if (restartEnabled && !canAct) {
          items.push({ type: "label", id: "draft-note", text: t("menu.clearDraft") });
        }
      }
      const onSelect = (id) => {
        if (id === "shortcut") {
          void createShortcut();
          return;
        }
        if (restartEnabled && menuAction(id, inputActions, currentInput()) === "restart") {
          setConfirmOpen(true);
        }
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Menu,
          {
            open,
            onClose: () => setOpen(false),
            items,
            onSelect,
            side: "top",
            align: "start",
            portal: true,
            autoFocus: true,
            anchor: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "button",
              {
                type: "button",
                className: "dsh-admin-indicator",
                "data-state": status.elevated,
                "aria-label": label,
                title: label,
                "aria-haspopup": "menu",
                "aria-expanded": open,
                onClick: () => setOpen(!open),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldIcon, { administrator }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-admin-indicator-label", children: administrator ? t("label.administrator") : t("label.standard") })
                ]
              }
            )
          }
        ),
        toast !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Toast,
          {
            text: toast.text,
            tone: toast.success ? "success" : void 0,
            onDone: () => setToast(null)
          },
          toast.key
        ) : null,
        restartEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.Modal,
          {
            open: confirmOpen,
            onClose: () => setConfirmOpen(false),
            title: t("menu.restart"),
            closeLabel: t("modal.close"),
            description: t("menu.restartWarning"),
            footer: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_dsh_client_ui_primitives.Button,
                {
                  type: "button",
                  variant: "ghost",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CancelIcon, {}),
                  onClick: () => setConfirmOpen(false),
                  children: t("menu.restartCancel")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_dsh_client_ui_primitives.Button,
                {
                  type: "button",
                  variant: "primary",
                  icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RestartIcon, {}),
                  disabled: !canAct,
                  onClick: restart,
                  children: t("menu.restartConfirm")
                }
              )
            ] })
          }
        ) : null
      ] });
    }
    var CSS = `
    .dsh-admin-indicator {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      max-width: 220px;
      height: 28px;
      padding: 0 4px 0 8px;
      border: 0;
      border-radius: var(--dsw-radius-sm);
      background: transparent;
      color: var(--dsw-alias-label-secondary);
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      line-height: 20px;
      cursor: pointer;
      -webkit-app-region: no-drag;
    }
    .dsh-admin-indicator:hover {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    .dsh-admin-indicator:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
    }
    .dsh-admin-indicator[data-state="administrator"] {
      color: var(--dsw-alias-brand-primary);
    }
    .dsh-admin-indicator svg {
      flex: none;
    }
    .dsh-admin-indicator-label {
      min-width: 0;
      overflow: hidden;
      font-size: inherit;
      font-weight: inherit;
      line-height: inherit;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @container (width <= 460px) {
      .dsh-admin-indicator-label {
        display: none;
      }
    }
    @media (max-width: 460px) {
      .dsh-admin-indicator-label {
        display: none;
      }
    }
    `;
    return module.exports;
  },
});
