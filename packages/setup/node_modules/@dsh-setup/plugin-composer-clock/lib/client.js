window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-composer-clock",
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

    // packages/plugin-composer-clock/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      apply: () => apply,
      inject: () => inject
    });
    module.exports = __toCommonJS(index_exports);
    var import_jsx_runtime = require("react/jsx-runtime");
    var inject = ["slots"];
    function ComposerClock() {
      const now = /* @__PURE__ */ new Date();
      const time = now.toLocaleTimeString(void 0, { hour: "2-digit", minute: "2-digit" });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "span",
        {
          style: {
            alignSelf: "flex-end",
            fontSize: "11px",
            fontVariantNumeric: "tabular-nums",
            opacity: 0.55,
            padding: "0 2px"
          },
          title: now.toLocaleDateString(),
          children: time
        }
      );
    }
    function apply(ctx) {
      ctx.slots.inject(
        "conversation.composer.dock",
        () => ctx.slots.register(
          { name: "conversation.composer.dock", id: "dsh-setup-composer-clock", order: 50 },
          ComposerClock
        )
      );
    }
    return module.exports;
  },
});
