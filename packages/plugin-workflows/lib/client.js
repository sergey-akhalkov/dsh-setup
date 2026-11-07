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
      EN: () => EN,
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var inject = ["slots", "locale"];
    var NS = "dsh-setup-workflows";
    var EN = {
      "view.label": "Workflows"
    };
    function apply(ctx) {
      try {
        ctx.effect(() => ctx.locale.register(NS, "en", EN));
        const t = ctx.locale.bind(NS);
        ctx.slots.inject(
          "conversation.view",
          () => ctx.slots.register(
            { name: "conversation.view", id: "workflows", order: 30, label: () => t("view.label") },
            () => null
          )
        );
      } catch (error) {
        console.error("workflows: Client registration failed", error);
      }
    }
    return module.exports;
  },
});
