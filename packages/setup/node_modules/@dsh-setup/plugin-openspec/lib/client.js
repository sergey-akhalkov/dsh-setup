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

    // packages/plugin-openspec/src/client/index.ts
    var index_exports = {};
    __export(index_exports, {
      CHANGES_PATH: () => CHANGES_PATH,
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
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
    }
    return module.exports;
  },
});
