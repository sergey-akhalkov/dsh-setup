window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-workflows",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";
    var __create = Object.create;
    var __defProp = Object.defineProperty;
    var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames = Object.getOwnPropertyNames;
    var __getProtoOf = Object.getPrototypeOf;
    var __hasOwnProp = Object.prototype.hasOwnProperty;
    var __commonJS = (cb, mod) => function __require() {
      try {
        return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
      } catch (e) {
        throw mod = 0, e;
      }
    };
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
    var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

    // node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js
    var require_use_sync_external_store_shim_development = __commonJS({
      "node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js"(exports) {
        "use strict";
        (function() {
          function is(x, y) {
            return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
          }
          function useSyncExternalStore$2(subscribe, getSnapshot) {
            didWarnOld18Alpha || void 0 === React.startTransition || (didWarnOld18Alpha = true, console.error(
              "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
            ));
            var value2 = getSnapshot();
            if (!didWarnUncachedGetSnapshot) {
              var cachedValue = getSnapshot();
              objectIs(value2, cachedValue) || (console.error(
                "The result of getSnapshot should be cached to avoid an infinite loop"
              ), didWarnUncachedGetSnapshot = true);
            }
            cachedValue = useState7({
              inst: { value: value2, getSnapshot }
            });
            var inst = cachedValue[0].inst, forceUpdate = cachedValue[1];
            useLayoutEffect3(
              function() {
                inst.value = value2;
                inst.getSnapshot = getSnapshot;
                checkIfSnapshotChanged(inst) && forceUpdate({ inst });
              },
              [subscribe, value2, getSnapshot]
            );
            useEffect5(
              function() {
                checkIfSnapshotChanged(inst) && forceUpdate({ inst });
                return subscribe(function() {
                  checkIfSnapshotChanged(inst) && forceUpdate({ inst });
                });
              },
              [subscribe]
            );
            useDebugValue2(value2);
            return value2;
          }
          function checkIfSnapshotChanged(inst) {
            var latestGetSnapshot = inst.getSnapshot;
            inst = inst.value;
            try {
              var nextValue = latestGetSnapshot();
              return !objectIs(inst, nextValue);
            } catch (error) {
              return true;
            }
          }
          function useSyncExternalStore$1(subscribe, getSnapshot) {
            return getSnapshot();
          }
          "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
          var React = require("react"), objectIs = "function" === typeof Object.is ? Object.is : is, useState7 = React.useState, useEffect5 = React.useEffect, useLayoutEffect3 = React.useLayoutEffect, useDebugValue2 = React.useDebugValue, didWarnOld18Alpha = false, didWarnUncachedGetSnapshot = false, shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
          exports.useSyncExternalStore = void 0 !== React.useSyncExternalStore ? React.useSyncExternalStore : shim;
          "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
        })();
      }
    });

    // node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/shim/index.js
    var require_shim = __commonJS({
      "node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/shim/index.js"(exports, module2) {
        "use strict";
        if (false) {
          module2.exports = null;
        } else {
          module2.exports = require_use_sync_external_store_shim_development();
        }
      }
    });

    // node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js
    var require_with_selector_development = __commonJS({
      "node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js"(exports) {
        "use strict";
        (function() {
          function is(x, y) {
            return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
          }
          "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
          var React = require("react"), shim = require_shim(), objectIs = "function" === typeof Object.is ? Object.is : is, useSyncExternalStore = shim.useSyncExternalStore, useRef6 = React.useRef, useEffect5 = React.useEffect, useMemo3 = React.useMemo, useDebugValue2 = React.useDebugValue;
          exports.useSyncExternalStoreWithSelector = function(subscribe, getSnapshot, getServerSnapshot, selector2, isEqual) {
            var instRef = useRef6(null);
            if (null === instRef.current) {
              var inst = { hasValue: false, value: null };
              instRef.current = inst;
            } else inst = instRef.current;
            instRef = useMemo3(
              function() {
                function memoizedSelector(nextSnapshot) {
                  if (!hasMemo) {
                    hasMemo = true;
                    memoizedSnapshot = nextSnapshot;
                    nextSnapshot = selector2(nextSnapshot);
                    if (void 0 !== isEqual && inst.hasValue) {
                      var currentSelection = inst.value;
                      if (isEqual(currentSelection, nextSnapshot))
                        return memoizedSelection = currentSelection;
                    }
                    return memoizedSelection = nextSnapshot;
                  }
                  currentSelection = memoizedSelection;
                  if (objectIs(memoizedSnapshot, nextSnapshot))
                    return currentSelection;
                  var nextSelection = selector2(nextSnapshot);
                  if (void 0 !== isEqual && isEqual(currentSelection, nextSelection))
                    return memoizedSnapshot = nextSnapshot, currentSelection;
                  memoizedSnapshot = nextSnapshot;
                  return memoizedSelection = nextSelection;
                }
                var hasMemo = false, memoizedSnapshot, memoizedSelection, maybeGetServerSnapshot = void 0 === getServerSnapshot ? null : getServerSnapshot;
                return [
                  function() {
                    return memoizedSelector(getSnapshot());
                  },
                  null === maybeGetServerSnapshot ? void 0 : function() {
                    return memoizedSelector(maybeGetServerSnapshot());
                  }
                ];
              },
              [getSnapshot, getServerSnapshot, selector2, isEqual]
            );
            var value2 = useSyncExternalStore(subscribe, instRef[0], instRef[1]);
            useEffect5(
              function() {
                inst.hasValue = true;
                inst.value = value2;
              },
              [value2]
            );
            useDebugValue2(value2);
            return value2;
          };
          "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
        })();
      }
    });

    // node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/shim/with-selector.js
    var require_with_selector = __commonJS({
      "node_modules/.pnpm/use-sync-external-store@1.7.0/node_modules/use-sync-external-store/shim/with-selector.js"(exports, module2) {
        "use strict";
        if (false) {
          module2.exports = null;
        } else {
          module2.exports = require_with_selector_development();
        }
      }
    });

    // packages/plugin-workflows/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      DESIGN_ID: () => DESIGN_ID,
      DESIGN_KIND: () => DESIGN_KIND,
      DESIGN_SERVICES: () => DESIGN_SERVICES,
      ENTRY_LIMITATION: () => ENTRY_LIMITATION,
      apply: () => apply,
      inject: () => inject,
      registerDesignPage: () => registerDesignPage
    });
    module.exports = __toCommonJS(index_exports);

    // packages/plugin-workflows/src/client/design-page.tsx
    var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react7 = require("react");

    // packages/plugin-workflows/src/client/design.tsx
    var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react6 = require("react");

    // packages/plugin-workflows/src/client/a11y.ts
    var NARROW_WIDTH = 720;
    var WIDE_WIDTH = 980;
    function inspectorPlacement(width) {
      return width >= WIDE_WIDTH ? "column" : "drawer";
    }
    var RAIL_WIDTH = { min: 220, default: 280, max: 460 };
    var INSPECTOR_WIDTH = { min: 300, default: 360, max: 560 };
    var PANE_STORAGE_KEY = "dsh-workflows.panes";
    function clampPaneWidth(value2, bounds) {
      if (!Number.isFinite(value2)) return bounds.min;
      return Math.min(bounds.max, Math.max(bounds.min, Math.round(value2)));
    }
    function parsePaneWidths(raw) {
      const defaults = {
        rail: RAIL_WIDTH.default,
        inspector: INSPECTOR_WIDTH.default
      };
      if (raw === null || raw === "") return defaults;
      try {
        const parsed = JSON.parse(raw);
        return {
          rail: clampPaneWidth(
            typeof parsed.rail === "number" ? parsed.rail : defaults.rail,
            RAIL_WIDTH
          ),
          inspector: clampPaneWidth(
            typeof parsed.inspector === "number" ? parsed.inspector : defaults.inspector,
            INSPECTOR_WIDTH
          )
        };
      } catch {
        return defaults;
      }
    }
    function defaultMode(width) {
      return width > 0 && width < NARROW_WIDTH ? "list" : "canvas";
    }
    function resolveSurface(requested, canvasFailed) {
      if (canvasFailed) return "list";
      return requested;
    }
    function fallbackNotice(canvasFailed) {
      return canvasFailed ? "The canvas could not render; the list editor is showing and the definition stays editable." : void 0;
    }
    function summaryText(definition, selectedTitle, overlay) {
      const steps = definition.steps.length;
      const trigger = String(definition.trigger.kind ?? "unknown");
      const run = overlay?.run;
      const runText = run === void 0 ? "no run selected" : `run ${run.status}${overlay?.versionsDiffer === true ? " on another version" : ""}`;
      const selected2 = selectedTitle === void 0 ? "" : ` Selected: ${selectedTitle}.`;
      return `Trigger ${trigger}. ${String(steps)} step${steps === 1 ? "" : "s"}. ${runText}.${selected2}`;
    }
    function isConnectShortcut(event) {
      if (event.key !== "c" && event.key !== "C") return false;
      if (event.defaultPrevented === true) return false;
      if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) return false;
      if (event.isComposing === true) return false;
      const target = event.target;
      if (target?.isContentEditable === true) return false;
      const tag = (target?.tagName ?? "").toLowerCase();
      return tag !== "input" && tag !== "textarea" && tag !== "select";
    }
    function paletteLabel(kind) {
      return kind === "step" || kind === "main" ? "Add step" : `Add ${kind}`;
    }

    // packages/plugin-workflows/src/client/canvas.tsx
    var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

    // node_modules/.pnpm/@xyflow+react@12.12.1_@type_79c3edc1609b0dbde12434fc5353f6b8/node_modules/@xyflow/react/dist/esm/index.js
    var import_jsx_runtime = require("react/jsx-runtime");
    var import_react2 = require("react");

    // node_modules/.pnpm/classcat@5.0.5/node_modules/classcat/index.js
    function cc(names) {
      if (typeof names === "string" || typeof names === "number") return "" + names;
      let out = "";
      if (Array.isArray(names)) {
        for (let i = 0, tmp; i < names.length; i++) {
          if ((tmp = cc(names[i])) !== "") {
            out += (out && " ") + tmp;
          }
        }
      } else {
        for (let k in names) {
          if (names[k]) out += (out && " ") + k;
        }
      }
      return out;
    }

    // node_modules/.pnpm/d3-dispatch@3.0.2/node_modules/d3-dispatch/dist/d3-dispatch.mjs
    var noop = { value: () => {
    } };
    function dispatch() {
      for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
        if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
        _[t] = [];
      }
      return new Dispatch(_);
    }
    function Dispatch(_) {
      this._ = _;
    }
    function parseTypenames(typenames, types) {
      return typenames.trim().split(/^|\s+/).map(function(t) {
        var name = "", i = t.indexOf(".");
        if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
        if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
        return { type: t, name };
      });
    }
    Dispatch.prototype = dispatch.prototype = {
      constructor: Dispatch,
      on: function(typename, callback) {
        var _ = this._, T = parseTypenames(typename + "", _), t, i = -1, n = T.length;
        if (arguments.length < 2) {
          while (++i < n) if ((t = (typename = T[i]).type) && (t = get(_[t], typename.name))) return t;
          return;
        }
        if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
        while (++i < n) {
          if (t = (typename = T[i]).type) _[t] = set(_[t], typename.name, callback);
          else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
        }
        return this;
      },
      copy: function() {
        var copy = {}, _ = this._;
        for (var t in _) copy[t] = _[t].slice();
        return new Dispatch(copy);
      },
      call: function(type, that) {
        if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      },
      apply: function(type, that, args) {
        if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
        for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
      }
    };
    function get(type, name) {
      for (var i = 0, n = type.length, c; i < n; ++i) {
        if ((c = type[i]).name === name) {
          return c.value;
        }
      }
    }
    function set(type, name, callback) {
      for (var i = 0, n = type.length; i < n; ++i) {
        if (type[i].name === name) {
          type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
          break;
        }
      }
      if (callback != null) type.push({ name, value: callback });
      return type;
    }

    // node_modules/.pnpm/d3-selection@3.0.1/node_modules/d3-selection/dist/d3-selection.mjs
    var xhtml = "http://www.w3.org/1999/xhtml";
    var namespaces = {
      svg: "http://www.w3.org/2000/svg",
      xhtml,
      xlink: "http://www.w3.org/1999/xlink",
      xml: "http://www.w3.org/XML/1998/namespace",
      xmlns: "http://www.w3.org/2000/xmlns/"
    };
    function namespace(name) {
      var prefix = name += "", i = prefix.indexOf(":");
      if (i >= 0 && (prefix = name.slice(0, i)) !== "xmlns") name = name.slice(i + 1);
      return namespaces.hasOwnProperty(prefix) ? { space: namespaces[prefix], local: name } : name;
    }
    function creatorInherit(name) {
      return function() {
        var document2 = this.ownerDocument, uri = this.namespaceURI;
        return uri === xhtml && document2.documentElement.namespaceURI === xhtml ? document2.createElement(name) : document2.createElementNS(uri, name);
      };
    }
    function creatorFixed(fullname) {
      return function() {
        return this.ownerDocument.createElementNS(fullname.space, fullname.local);
      };
    }
    function creator(name) {
      var fullname = namespace(name);
      return (fullname.local ? creatorFixed : creatorInherit)(fullname);
    }
    function none() {
    }
    function selector(selector2) {
      return selector2 == null ? none : function() {
        return this.querySelector(selector2);
      };
    }
    function selection_select(select2) {
      if (typeof select2 !== "function") select2 = selector(select2);
      for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
          if ((node = group[i]) && (subnode = select2.call(node, node.__data__, i, group))) {
            if ("__data__" in node) subnode.__data__ = node.__data__;
            subgroup[i] = subnode;
          }
        }
      }
      return new Selection(subgroups, this._parents);
    }
    function array(x) {
      return x == null ? [] : Array.isArray(x) ? x : Array.from(x);
    }
    function empty() {
      return [];
    }
    function selectorAll(selector2) {
      return selector2 == null ? empty : function() {
        return this.querySelectorAll(selector2);
      };
    }
    function arrayAll(select2) {
      return function() {
        return array(select2.apply(this, arguments));
      };
    }
    function selection_selectAll(select2) {
      if (typeof select2 === "function") select2 = arrayAll(select2);
      else select2 = selectorAll(select2);
      for (var groups = this._groups, m = groups.length, subgroups = [], parents = [], j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
          if (node = group[i]) {
            subgroups.push(select2.call(node, node.__data__, i, group));
            parents.push(node);
          }
        }
      }
      return new Selection(subgroups, parents);
    }
    function matcher(selector2) {
      return function() {
        return this.matches(selector2);
      };
    }
    function childMatcher(selector2) {
      return function(node) {
        return node.matches(selector2);
      };
    }
    var find = Array.prototype.find;
    function childFind(match) {
      return function() {
        return find.call(this.children, match);
      };
    }
    function childFirst() {
      return this.firstElementChild;
    }
    function selection_selectChild(match) {
      return this.select(match == null ? childFirst : childFind(typeof match === "function" ? match : childMatcher(match)));
    }
    var filter = Array.prototype.filter;
    function children() {
      return Array.from(this.children);
    }
    function childrenFilter(match) {
      return function() {
        return filter.call(this.children, match);
      };
    }
    function selection_selectChildren(match) {
      return this.selectAll(match == null ? children : childrenFilter(typeof match === "function" ? match : childMatcher(match)));
    }
    function selection_filter(match) {
      if (typeof match !== "function") match = matcher(match);
      for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
          if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
            subgroup.push(node);
          }
        }
      }
      return new Selection(subgroups, this._parents);
    }
    function sparse(update) {
      return new Array(update.length);
    }
    function selection_enter() {
      return new Selection(this._enter || this._groups.map(sparse), this._parents);
    }
    function EnterNode(parent, datum2) {
      this.ownerDocument = parent.ownerDocument;
      this.namespaceURI = parent.namespaceURI;
      this._next = null;
      this._parent = parent;
      this.__data__ = datum2;
    }
    EnterNode.prototype = {
      constructor: EnterNode,
      appendChild: function(child) {
        return this._parent.insertBefore(child, this._next);
      },
      insertBefore: function(child, next) {
        return this._parent.insertBefore(child, next);
      },
      querySelector: function(selector2) {
        return this._parent.querySelector(selector2);
      },
      querySelectorAll: function(selector2) {
        return this._parent.querySelectorAll(selector2);
      }
    };
    function constant(x) {
      return function() {
        return x;
      };
    }
    function bindIndex(parent, group, enter, update, exit, data) {
      var i = 0, node, groupLength = group.length, dataLength = data.length;
      for (; i < dataLength; ++i) {
        if (node = group[i]) {
          node.__data__ = data[i];
          update[i] = node;
        } else {
          enter[i] = new EnterNode(parent, data[i]);
        }
      }
      for (; i < groupLength; ++i) {
        if (node = group[i]) {
          exit[i] = node;
        }
      }
    }
    function bindKey(parent, group, enter, update, exit, data, key) {
      var i, node, nodeByKeyValue = /* @__PURE__ */ new Map(), groupLength = group.length, dataLength = data.length, keyValues = new Array(groupLength), keyValue;
      for (i = 0; i < groupLength; ++i) {
        if (node = group[i]) {
          keyValues[i] = keyValue = key.call(node, node.__data__, i, group) + "";
          if (nodeByKeyValue.has(keyValue)) {
            exit[i] = node;
          } else {
            nodeByKeyValue.set(keyValue, node);
          }
        }
      }
      for (i = 0; i < dataLength; ++i) {
        keyValue = key.call(parent, data[i], i, data) + "";
        if (node = nodeByKeyValue.get(keyValue)) {
          update[i] = node;
          node.__data__ = data[i];
          nodeByKeyValue.delete(keyValue);
        } else {
          enter[i] = new EnterNode(parent, data[i]);
        }
      }
      for (i = 0; i < groupLength; ++i) {
        if ((node = group[i]) && nodeByKeyValue.get(keyValues[i]) === node) {
          exit[i] = node;
        }
      }
    }
    function datum(node) {
      return node.__data__;
    }
    function selection_data(value2, key) {
      if (!arguments.length) return Array.from(this, datum);
      var bind = key ? bindKey : bindIndex, parents = this._parents, groups = this._groups;
      if (typeof value2 !== "function") value2 = constant(value2);
      for (var m = groups.length, update = new Array(m), enter = new Array(m), exit = new Array(m), j = 0; j < m; ++j) {
        var parent = parents[j], group = groups[j], groupLength = group.length, data = arraylike(value2.call(parent, parent && parent.__data__, j, parents)), dataLength = data.length, enterGroup = enter[j] = new Array(dataLength), updateGroup = update[j] = new Array(dataLength), exitGroup = exit[j] = new Array(groupLength);
        bind(parent, group, enterGroup, updateGroup, exitGroup, data, key);
        for (var i0 = 0, i1 = 0, previous, next; i0 < dataLength; ++i0) {
          if (previous = enterGroup[i0]) {
            if (i0 >= i1) i1 = i0 + 1;
            while (!(next = updateGroup[i1]) && ++i1 < dataLength) ;
            previous._next = next || null;
          }
        }
      }
      update = new Selection(update, parents);
      update._enter = enter;
      update._exit = exit;
      return update;
    }
    function arraylike(data) {
      return typeof data === "object" && "length" in data ? data : Array.from(data);
    }
    function selection_exit() {
      return new Selection(this._exit || this._groups.map(sparse), this._parents);
    }
    function selection_join(onenter, onupdate, onexit) {
      var enter = this.enter(), update = this, exit = this.exit();
      if (typeof onenter === "function") {
        enter = onenter(enter);
        if (enter) enter = enter.selection();
      } else {
        enter = enter.append(onenter + "");
      }
      if (onupdate != null) {
        update = onupdate(update);
        if (update) update = update.selection();
      }
      if (onexit == null) exit.remove();
      else onexit(exit);
      return enter && update ? enter.merge(update).order() : update;
    }
    function selection_merge(context) {
      var selection2 = context.selection ? context.selection() : context;
      for (var groups0 = this._groups, groups1 = selection2._groups, m0 = groups0.length, m1 = groups1.length, m = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m; ++j) {
        for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
          if (node = group0[i] || group1[i]) {
            merge[i] = node;
          }
        }
      }
      for (; j < m0; ++j) {
        merges[j] = groups0[j];
      }
      return new Selection(merges, this._parents);
    }
    function selection_order() {
      for (var groups = this._groups, j = -1, m = groups.length; ++j < m; ) {
        for (var group = groups[j], i = group.length - 1, next = group[i], node; --i >= 0; ) {
          if (node = group[i]) {
            if (next && node.compareDocumentPosition(next) ^ 4) next.parentNode.insertBefore(node, next);
            next = node;
          }
        }
      }
      return this;
    }
    function selection_sort(compare) {
      if (!compare) compare = ascending;
      function compareNode(a, b) {
        return a && b ? compare(a.__data__, b.__data__) : !a - !b;
      }
      for (var groups = this._groups, m = groups.length, sortgroups = new Array(m), j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, sortgroup = sortgroups[j] = new Array(n), node, i = 0; i < n; ++i) {
          if (node = group[i]) {
            sortgroup[i] = node;
          }
        }
        sortgroup.sort(compareNode);
      }
      return new Selection(sortgroups, this._parents).order();
    }
    function ascending(a, b) {
      return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
    }
    function selection_call() {
      var callback = arguments[0];
      arguments[0] = this;
      callback.apply(null, arguments);
      return this;
    }
    function selection_nodes() {
      return Array.from(this);
    }
    function selection_node() {
      for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
        for (var group = groups[j], i = 0, n = group.length; i < n; ++i) {
          var node = group[i];
          if (node) return node;
        }
      }
      return null;
    }
    function selection_size() {
      let size = 0;
      for (const node of this) ++size;
      return size;
    }
    function selection_empty() {
      return !this.node();
    }
    function selection_each(callback) {
      for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
        for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
          if (node = group[i]) callback.call(node, node.__data__, i, group);
        }
      }
      return this;
    }
    function attrRemove(name) {
      return function() {
        this.removeAttribute(name);
      };
    }
    function attrRemoveNS(fullname) {
      return function() {
        this.removeAttributeNS(fullname.space, fullname.local);
      };
    }
    function attrConstant(name, value2) {
      return function() {
        this.setAttribute(name, value2);
      };
    }
    function attrConstantNS(fullname, value2) {
      return function() {
        this.setAttributeNS(fullname.space, fullname.local, value2);
      };
    }
    function attrFunction(name, value2) {
      return function() {
        var v = value2.apply(this, arguments);
        if (v == null) this.removeAttribute(name);
        else this.setAttribute(name, v);
      };
    }
    function attrFunctionNS(fullname, value2) {
      return function() {
        var v = value2.apply(this, arguments);
        if (v == null) this.removeAttributeNS(fullname.space, fullname.local);
        else this.setAttributeNS(fullname.space, fullname.local, v);
      };
    }
    function selection_attr(name, value2) {
      var fullname = namespace(name);
      if (arguments.length < 2) {
        var node = this.node();
        return fullname.local ? node.getAttributeNS(fullname.space, fullname.local) : node.getAttribute(fullname);
      }
      return this.each((value2 == null ? fullname.local ? attrRemoveNS : attrRemove : typeof value2 === "function" ? fullname.local ? attrFunctionNS : attrFunction : fullname.local ? attrConstantNS : attrConstant)(fullname, value2));
    }
    function defaultView(node) {
      return node.ownerDocument && node.ownerDocument.defaultView || node.document && node || node.defaultView;
    }
    function styleRemove(name) {
      return function() {
        this.style.removeProperty(name);
      };
    }
    function styleConstant(name, value2, priority) {
      return function() {
        this.style.setProperty(name, value2, priority);
      };
    }
    function styleFunction(name, value2, priority) {
      return function() {
        var v = value2.apply(this, arguments);
        if (v == null) this.style.removeProperty(name);
        else this.style.setProperty(name, v, priority);
      };
    }
    function selection_style(name, value2, priority) {
      return arguments.length > 1 ? this.each((value2 == null ? styleRemove : typeof value2 === "function" ? styleFunction : styleConstant)(name, value2, priority == null ? "" : priority)) : styleValue(this.node(), name);
    }
    function styleValue(node, name) {
      return node.style.getPropertyValue(name) || defaultView(node).getComputedStyle(node, null).getPropertyValue(name);
    }
    function propertyRemove(name) {
      return function() {
        delete this[name];
      };
    }
    function propertyConstant(name, value2) {
      return function() {
        this[name] = value2;
      };
    }
    function propertyFunction(name, value2) {
      return function() {
        var v = value2.apply(this, arguments);
        if (v == null) delete this[name];
        else this[name] = v;
      };
    }
    function selection_property(name, value2) {
      return arguments.length > 1 ? this.each((value2 == null ? propertyRemove : typeof value2 === "function" ? propertyFunction : propertyConstant)(name, value2)) : this.node()[name];
    }
    function classArray(string2) {
      return string2.trim().split(/^|\s+/);
    }
    function classList(node) {
      return node.classList || new ClassList(node);
    }
    function ClassList(node) {
      this._node = node;
      this._names = classArray(node.getAttribute("class") || "");
    }
    ClassList.prototype = {
      add: function(name) {
        var i = this._names.indexOf(name);
        if (i < 0) {
          this._names.push(name);
          this._node.setAttribute("class", this._names.join(" "));
        }
      },
      remove: function(name) {
        var i = this._names.indexOf(name);
        if (i >= 0) {
          this._names.splice(i, 1);
          this._node.setAttribute("class", this._names.join(" "));
        }
      },
      contains: function(name) {
        return this._names.indexOf(name) >= 0;
      }
    };
    function classedAdd(node, names) {
      var list = classList(node), i = -1, n = names.length;
      while (++i < n) list.add(names[i]);
    }
    function classedRemove(node, names) {
      var list = classList(node), i = -1, n = names.length;
      while (++i < n) list.remove(names[i]);
    }
    function classedTrue(names) {
      return function() {
        classedAdd(this, names);
      };
    }
    function classedFalse(names) {
      return function() {
        classedRemove(this, names);
      };
    }
    function classedFunction(names, value2) {
      return function() {
        (value2.apply(this, arguments) ? classedAdd : classedRemove)(this, names);
      };
    }
    function selection_classed(name, value2) {
      var names = classArray(name + "");
      if (arguments.length < 2) {
        var list = classList(this.node()), i = -1, n = names.length;
        while (++i < n) if (!list.contains(names[i])) return false;
        return true;
      }
      return this.each((typeof value2 === "function" ? classedFunction : value2 ? classedTrue : classedFalse)(names, value2));
    }
    function textRemove() {
      this.textContent = "";
    }
    function textConstant(value2) {
      return function() {
        this.textContent = value2;
      };
    }
    function textFunction(value2) {
      return function() {
        var v = value2.apply(this, arguments);
        this.textContent = v == null ? "" : v;
      };
    }
    function selection_text(value2) {
      return arguments.length ? this.each(value2 == null ? textRemove : (typeof value2 === "function" ? textFunction : textConstant)(value2)) : this.node().textContent;
    }
    function htmlRemove() {
      this.innerHTML = "";
    }
    function htmlConstant(value2) {
      return function() {
        this.innerHTML = value2;
      };
    }
    function htmlFunction(value2) {
      return function() {
        var v = value2.apply(this, arguments);
        this.innerHTML = v == null ? "" : v;
      };
    }
    function selection_html(value2) {
      return arguments.length ? this.each(value2 == null ? htmlRemove : (typeof value2 === "function" ? htmlFunction : htmlConstant)(value2)) : this.node().innerHTML;
    }
    function raise() {
      if (this.nextSibling) this.parentNode.appendChild(this);
    }
    function selection_raise() {
      return this.each(raise);
    }
    function lower() {
      if (this.previousSibling) this.parentNode.insertBefore(this, this.parentNode.firstChild);
    }
    function selection_lower() {
      return this.each(lower);
    }
    function selection_append(name) {
      var create2 = typeof name === "function" ? name : creator(name);
      return this.select(function() {
        return this.appendChild(create2.apply(this, arguments));
      });
    }
    function constantNull() {
      return null;
    }
    function selection_insert(name, before) {
      var create2 = typeof name === "function" ? name : creator(name), select2 = before == null ? constantNull : typeof before === "function" ? before : selector(before);
      return this.select(function() {
        return this.insertBefore(create2.apply(this, arguments), select2.apply(this, arguments) || null);
      });
    }
    function remove() {
      var parent = this.parentNode;
      if (parent) parent.removeChild(this);
    }
    function selection_remove() {
      return this.each(remove);
    }
    function selection_cloneShallow() {
      var clone2 = this.cloneNode(false), parent = this.parentNode;
      return parent ? parent.insertBefore(clone2, this.nextSibling) : clone2;
    }
    function selection_cloneDeep() {
      var clone2 = this.cloneNode(true), parent = this.parentNode;
      return parent ? parent.insertBefore(clone2, this.nextSibling) : clone2;
    }
    function selection_clone(deep) {
      return this.select(deep ? selection_cloneDeep : selection_cloneShallow);
    }
    function selection_datum(value2) {
      return arguments.length ? this.property("__data__", value2) : this.node().__data__;
    }
    function contextListener(listener) {
      return function(event) {
        listener.call(this, event, this.__data__);
      };
    }
    function parseTypenames2(typenames) {
      return typenames.trim().split(/^|\s+/).map(function(t) {
        var name = "", i = t.indexOf(".");
        if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
        return { type: t, name };
      });
    }
    function onRemove(typename) {
      return function() {
        var on = this.__on;
        if (!on) return;
        for (var j = 0, i = -1, m = on.length, o; j < m; ++j) {
          if (o = on[j], (!typename.type || o.type === typename.type) && o.name === typename.name) {
            this.removeEventListener(o.type, o.listener, o.options);
          } else {
            on[++i] = o;
          }
        }
        if (++i) on.length = i;
        else delete this.__on;
      };
    }
    function onAdd(typename, value2, options) {
      return function() {
        var on = this.__on, o, listener = contextListener(value2);
        if (on) for (var j = 0, m = on.length; j < m; ++j) {
          if ((o = on[j]).type === typename.type && o.name === typename.name) {
            this.removeEventListener(o.type, o.listener, o.options);
            this.addEventListener(o.type, o.listener = listener, o.options = options);
            o.value = value2;
            return;
          }
        }
        this.addEventListener(typename.type, listener, options);
        o = { type: typename.type, name: typename.name, value: value2, listener, options };
        if (!on) this.__on = [o];
        else on.push(o);
      };
    }
    function selection_on(typename, value2, options) {
      var typenames = parseTypenames2(typename + ""), i, n = typenames.length, t;
      if (arguments.length < 2) {
        var on = this.node().__on;
        if (on) for (var j = 0, m = on.length, o; j < m; ++j) {
          for (i = 0, o = on[j]; i < n; ++i) {
            if ((t = typenames[i]).type === o.type && t.name === o.name) {
              return o.value;
            }
          }
        }
        return;
      }
      on = value2 ? onAdd : onRemove;
      for (i = 0; i < n; ++i) this.each(on(typenames[i], value2, options));
      return this;
    }
    function dispatchEvent(node, type, params) {
      var window2 = defaultView(node), event = window2.CustomEvent;
      if (typeof event === "function") {
        event = new event(type, params);
      } else {
        event = window2.document.createEvent("Event");
        if (params) event.initEvent(type, params.bubbles, params.cancelable), event.detail = params.detail;
        else event.initEvent(type, false, false);
      }
      node.dispatchEvent(event);
    }
    function dispatchConstant(type, params) {
      return function() {
        return dispatchEvent(this, type, params);
      };
    }
    function dispatchFunction(type, params) {
      return function() {
        return dispatchEvent(this, type, params.apply(this, arguments));
      };
    }
    function selection_dispatch(type, params) {
      return this.each((typeof params === "function" ? dispatchFunction : dispatchConstant)(type, params));
    }
    function* selection_iterator() {
      for (var groups = this._groups, j = 0, m = groups.length; j < m; ++j) {
        for (var group = groups[j], i = 0, n = group.length, node; i < n; ++i) {
          if (node = group[i]) yield node;
        }
      }
    }
    var root = [null];
    function Selection(groups, parents) {
      this._groups = groups;
      this._parents = parents;
    }
    function selection() {
      return new Selection([[document.documentElement]], root);
    }
    function selection_selection() {
      return this;
    }
    Selection.prototype = selection.prototype = {
      constructor: Selection,
      select: selection_select,
      selectAll: selection_selectAll,
      selectChild: selection_selectChild,
      selectChildren: selection_selectChildren,
      filter: selection_filter,
      data: selection_data,
      enter: selection_enter,
      exit: selection_exit,
      join: selection_join,
      merge: selection_merge,
      selection: selection_selection,
      order: selection_order,
      sort: selection_sort,
      call: selection_call,
      nodes: selection_nodes,
      node: selection_node,
      size: selection_size,
      empty: selection_empty,
      each: selection_each,
      attr: selection_attr,
      style: selection_style,
      property: selection_property,
      classed: selection_classed,
      text: selection_text,
      html: selection_html,
      raise: selection_raise,
      lower: selection_lower,
      append: selection_append,
      insert: selection_insert,
      remove: selection_remove,
      clone: selection_clone,
      datum: selection_datum,
      on: selection_on,
      dispatch: selection_dispatch,
      [Symbol.iterator]: selection_iterator
    };
    function select(selector2) {
      return typeof selector2 === "string" ? new Selection([[document.querySelector(selector2)]], [document.documentElement]) : new Selection([[selector2]], root);
    }
    var nextId = 0;
    function local() {
      return new Local();
    }
    function Local() {
      this._ = "@" + (++nextId).toString(36);
    }
    Local.prototype = local.prototype = {
      constructor: Local,
      get: function(node) {
        var id2 = this._;
        while (!(id2 in node)) if (!(node = node.parentNode)) return;
        return node[id2];
      },
      set: function(node, value2) {
        return node[this._] = value2;
      },
      remove: function(node) {
        return this._ in node && delete node[this._];
      },
      toString: function() {
        return this._;
      }
    };
    function sourceEvent(event) {
      let sourceEvent2;
      while (sourceEvent2 = event.sourceEvent) event = sourceEvent2;
      return event;
    }
    function pointer(event, node) {
      event = sourceEvent(event);
      if (node === void 0) node = event.currentTarget;
      if (node) {
        var svg = node.ownerSVGElement || node;
        if (svg.createSVGPoint) {
          var point = svg.createSVGPoint();
          point.x = event.clientX, point.y = event.clientY;
          point = point.matrixTransform(node.getScreenCTM().inverse());
          return [point.x, point.y];
        }
        if (node.getBoundingClientRect) {
          var rect = node.getBoundingClientRect();
          return [event.clientX - rect.left - node.clientLeft, event.clientY - rect.top - node.clientTop];
        }
      }
      return [event.pageX, event.pageY];
    }

    // node_modules/.pnpm/d3-drag@3.0.1/node_modules/d3-drag/dist/d3-drag.mjs
    var nonpassive = { passive: false };
    var nonpassivecapture = { capture: true, passive: false };
    function nopropagation(event) {
      event.stopImmediatePropagation();
    }
    function noevent(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function nodrag(view) {
      var root2 = view.document.documentElement, selection2 = select(view).on("dragstart.drag", noevent, nonpassivecapture);
      if ("onselectstart" in root2) {
        selection2.on("selectstart.drag", noevent, nonpassivecapture);
      } else {
        root2.__noselect = root2.style.MozUserSelect;
        root2.style.MozUserSelect = "none";
      }
    }
    function yesdrag(view, noclick) {
      var root2 = view.document.documentElement, selection2 = select(view).on("dragstart.drag", null);
      if (noclick) {
        selection2.on("click.drag", noevent, nonpassivecapture);
        setTimeout(function() {
          selection2.on("click.drag", null);
        }, 0);
      }
      if ("onselectstart" in root2) {
        selection2.on("selectstart.drag", null);
      } else {
        root2.style.MozUserSelect = root2.__noselect;
        delete root2.__noselect;
      }
    }
    var constant2 = (x) => () => x;
    function DragEvent(type, {
      sourceEvent: sourceEvent2,
      subject,
      target,
      identifier,
      active,
      x,
      y,
      dx,
      dy,
      dispatch: dispatch2
    }) {
      Object.defineProperties(this, {
        type: { value: type, enumerable: true, configurable: true },
        sourceEvent: { value: sourceEvent2, enumerable: true, configurable: true },
        subject: { value: subject, enumerable: true, configurable: true },
        target: { value: target, enumerable: true, configurable: true },
        identifier: { value: identifier, enumerable: true, configurable: true },
        active: { value: active, enumerable: true, configurable: true },
        x: { value: x, enumerable: true, configurable: true },
        y: { value: y, enumerable: true, configurable: true },
        dx: { value: dx, enumerable: true, configurable: true },
        dy: { value: dy, enumerable: true, configurable: true },
        _: { value: dispatch2 }
      });
    }
    DragEvent.prototype.on = function() {
      var value2 = this._.on.apply(this._, arguments);
      return value2 === this._ ? this : value2;
    };
    function defaultFilter(event) {
      return !event.ctrlKey && !event.button;
    }
    function defaultContainer() {
      return this.parentNode;
    }
    function defaultSubject(event, d) {
      return d == null ? { x: event.x, y: event.y } : d;
    }
    function defaultTouchable() {
      return navigator.maxTouchPoints || "ontouchstart" in this;
    }
    function drag() {
      var filter2 = defaultFilter, container = defaultContainer, subject = defaultSubject, touchable = defaultTouchable, gestures = {}, listeners = dispatch("start", "drag", "end"), active = 0, mousedownx, mousedowny, mousemoving, touchending, clickDistance2 = 0;
      function drag2(selection2) {
        selection2.on("mousedown.drag", mousedowned).filter(touchable).on("touchstart.drag", touchstarted).on("touchmove.drag", touchmoved, nonpassive).on("touchend.drag touchcancel.drag", touchended).style("touch-action", "none").style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
      }
      function mousedowned(event, d) {
        if (touchending || !filter2.call(this, event, d)) return;
        var gesture = beforestart(this, container.call(this, event, d), event, d, "mouse");
        if (!gesture) return;
        select(event.view).on("mousemove.drag", mousemoved, nonpassivecapture).on("mouseup.drag", mouseupped, nonpassivecapture);
        nodrag(event.view);
        nopropagation(event);
        mousemoving = false;
        mousedownx = event.clientX;
        mousedowny = event.clientY;
        gesture("start", event);
      }
      function mousemoved(event) {
        noevent(event);
        if (!mousemoving) {
          var dx = event.clientX - mousedownx, dy = event.clientY - mousedowny;
          mousemoving = dx * dx + dy * dy > clickDistance2;
        }
        gestures.mouse("drag", event);
      }
      function mouseupped(event) {
        select(event.view).on("mousemove.drag mouseup.drag", null);
        yesdrag(event.view, mousemoving);
        noevent(event);
        gestures.mouse("end", event);
      }
      function touchstarted(event, d) {
        if (!filter2.call(this, event, d)) return;
        var touches = event.changedTouches, c = container.call(this, event, d), n = touches.length, i, gesture;
        for (i = 0; i < n; ++i) {
          if (gesture = beforestart(this, c, event, d, touches[i].identifier, touches[i])) {
            nopropagation(event);
            gesture("start", event, touches[i]);
          }
        }
      }
      function touchmoved(event) {
        var touches = event.changedTouches, n = touches.length, i, gesture;
        for (i = 0; i < n; ++i) {
          if (gesture = gestures[touches[i].identifier]) {
            noevent(event);
            gesture("drag", event, touches[i]);
          }
        }
      }
      function touchended(event) {
        var touches = event.changedTouches, n = touches.length, i, gesture;
        if (touchending) clearTimeout(touchending);
        touchending = setTimeout(function() {
          touchending = null;
        }, 500);
        for (i = 0; i < n; ++i) {
          if (gesture = gestures[touches[i].identifier]) {
            nopropagation(event);
            gesture("end", event, touches[i]);
          }
        }
      }
      function beforestart(that, container2, event, d, identifier, touch) {
        var dispatch2 = listeners.copy(), p = pointer(touch || event, container2), dx, dy, s;
        if ((s = subject.call(that, new DragEvent("beforestart", {
          sourceEvent: event,
          target: drag2,
          identifier,
          active,
          x: p[0],
          y: p[1],
          dx: 0,
          dy: 0,
          dispatch: dispatch2
        }), d)) == null) return;
        dx = s.x - p[0] || 0;
        dy = s.y - p[1] || 0;
        return function gesture(type, event2, touch2) {
          var p0 = p, n;
          switch (type) {
            case "start":
              gestures[identifier] = gesture, n = active++;
              break;
            case "end":
              delete gestures[identifier], --active;
            // falls through
            case "drag":
              p = pointer(touch2 || event2, container2), n = active;
              break;
          }
          dispatch2.call(
            type,
            that,
            new DragEvent(type, {
              sourceEvent: event2,
              subject: s,
              target: drag2,
              identifier,
              active: n,
              x: p[0] + dx,
              y: p[1] + dy,
              dx: p[0] - p0[0],
              dy: p[1] - p0[1],
              dispatch: dispatch2
            }),
            d
          );
        };
      }
      drag2.filter = function(_) {
        return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant2(!!_), drag2) : filter2;
      };
      drag2.container = function(_) {
        return arguments.length ? (container = typeof _ === "function" ? _ : constant2(_), drag2) : container;
      };
      drag2.subject = function(_) {
        return arguments.length ? (subject = typeof _ === "function" ? _ : constant2(_), drag2) : subject;
      };
      drag2.touchable = function(_) {
        return arguments.length ? (touchable = typeof _ === "function" ? _ : constant2(!!_), drag2) : touchable;
      };
      drag2.on = function() {
        var value2 = listeners.on.apply(listeners, arguments);
        return value2 === listeners ? drag2 : value2;
      };
      drag2.clickDistance = function(_) {
        return arguments.length ? (clickDistance2 = (_ = +_) * _, drag2) : Math.sqrt(clickDistance2);
      };
      return drag2;
    }

    // node_modules/.pnpm/d3-color@3.1.1/node_modules/d3-color/dist/d3-color.mjs
    function define(constructor, factory, prototype) {
      constructor.prototype = factory.prototype = prototype;
      prototype.constructor = constructor;
    }
    function extend(parent, definition) {
      var prototype = Object.create(parent.prototype);
      for (var key in definition) prototype[key] = definition[key];
      return prototype;
    }
    function Color() {
    }
    var darker = 0.7;
    var brighter = 1 / darker;
    var reI = "\\s*([+-]?\\d+)\\s*";
    var reN = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*";
    var reP = "\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*";
    var reHex = /^#([0-9a-f]{3,8})$/;
    var reRgbInteger = new RegExp(`^rgb\\(${reI},${reI},${reI}\\)$`);
    var reRgbPercent = new RegExp(`^rgb\\(${reP},${reP},${reP}\\)$`);
    var reRgbaInteger = new RegExp(`^rgba\\(${reI},${reI},${reI},${reN}\\)$`);
    var reRgbaPercent = new RegExp(`^rgba\\(${reP},${reP},${reP},${reN}\\)$`);
    var reHslPercent = new RegExp(`^hsl\\(${reN},${reP},${reP}\\)$`);
    var reHslaPercent = new RegExp(`^hsla\\(${reN},${reP},${reP},${reN}\\)$`);
    var named = {
      aliceblue: 15792383,
      antiquewhite: 16444375,
      aqua: 65535,
      aquamarine: 8388564,
      azure: 15794175,
      beige: 16119260,
      bisque: 16770244,
      black: 0,
      blanchedalmond: 16772045,
      blue: 255,
      blueviolet: 9055202,
      brown: 10824234,
      burlywood: 14596231,
      cadetblue: 6266528,
      chartreuse: 8388352,
      chocolate: 13789470,
      coral: 16744272,
      cornflowerblue: 6591981,
      cornsilk: 16775388,
      crimson: 14423100,
      cyan: 65535,
      darkblue: 139,
      darkcyan: 35723,
      darkgoldenrod: 12092939,
      darkgray: 11119017,
      darkgreen: 25600,
      darkgrey: 11119017,
      darkkhaki: 12433259,
      darkmagenta: 9109643,
      darkolivegreen: 5597999,
      darkorange: 16747520,
      darkorchid: 10040012,
      darkred: 9109504,
      darksalmon: 15308410,
      darkseagreen: 9419919,
      darkslateblue: 4734347,
      darkslategray: 3100495,
      darkslategrey: 3100495,
      darkturquoise: 52945,
      darkviolet: 9699539,
      deeppink: 16716947,
      deepskyblue: 49151,
      dimgray: 6908265,
      dimgrey: 6908265,
      dodgerblue: 2003199,
      firebrick: 11674146,
      floralwhite: 16775920,
      forestgreen: 2263842,
      fuchsia: 16711935,
      gainsboro: 14474460,
      ghostwhite: 16316671,
      gold: 16766720,
      goldenrod: 14329120,
      gray: 8421504,
      green: 32768,
      greenyellow: 11403055,
      grey: 8421504,
      honeydew: 15794160,
      hotpink: 16738740,
      indianred: 13458524,
      indigo: 4915330,
      ivory: 16777200,
      khaki: 15787660,
      lavender: 15132410,
      lavenderblush: 16773365,
      lawngreen: 8190976,
      lemonchiffon: 16775885,
      lightblue: 11393254,
      lightcoral: 15761536,
      lightcyan: 14745599,
      lightgoldenrodyellow: 16448210,
      lightgray: 13882323,
      lightgreen: 9498256,
      lightgrey: 13882323,
      lightpink: 16758465,
      lightsalmon: 16752762,
      lightseagreen: 2142890,
      lightskyblue: 8900346,
      lightslategray: 7833753,
      lightslategrey: 7833753,
      lightsteelblue: 11584734,
      lightyellow: 16777184,
      lime: 65280,
      limegreen: 3329330,
      linen: 16445670,
      magenta: 16711935,
      maroon: 8388608,
      mediumaquamarine: 6737322,
      mediumblue: 205,
      mediumorchid: 12211667,
      mediumpurple: 9662683,
      mediumseagreen: 3978097,
      mediumslateblue: 8087790,
      mediumspringgreen: 64154,
      mediumturquoise: 4772300,
      mediumvioletred: 13047173,
      midnightblue: 1644912,
      mintcream: 16121850,
      mistyrose: 16770273,
      moccasin: 16770229,
      navajowhite: 16768685,
      navy: 128,
      oldlace: 16643558,
      olive: 8421376,
      olivedrab: 7048739,
      orange: 16753920,
      orangered: 16729344,
      orchid: 14315734,
      palegoldenrod: 15657130,
      palegreen: 10025880,
      paleturquoise: 11529966,
      palevioletred: 14381203,
      papayawhip: 16773077,
      peachpuff: 16767673,
      peru: 13468991,
      pink: 16761035,
      plum: 14524637,
      powderblue: 11591910,
      purple: 8388736,
      rebeccapurple: 6697881,
      red: 16711680,
      rosybrown: 12357519,
      royalblue: 4286945,
      saddlebrown: 9127187,
      salmon: 16416882,
      sandybrown: 16032864,
      seagreen: 3050327,
      seashell: 16774638,
      sienna: 10506797,
      silver: 12632256,
      skyblue: 8900331,
      slateblue: 6970061,
      slategray: 7372944,
      slategrey: 7372944,
      snow: 16775930,
      springgreen: 65407,
      steelblue: 4620980,
      tan: 13808780,
      teal: 32896,
      thistle: 14204888,
      tomato: 16737095,
      turquoise: 4251856,
      violet: 15631086,
      wheat: 16113331,
      white: 16777215,
      whitesmoke: 16119285,
      yellow: 16776960,
      yellowgreen: 10145074
    };
    define(Color, color, {
      copy(channels) {
        return Object.assign(new this.constructor(), this, channels);
      },
      displayable() {
        return this.rgb().displayable();
      },
      hex: color_formatHex,
      // Deprecated! Use color.formatHex.
      formatHex: color_formatHex,
      formatHex8: color_formatHex8,
      formatHsl: color_formatHsl,
      formatRgb: color_formatRgb,
      toString: color_formatRgb
    });
    function color_formatHex() {
      return this.rgb().formatHex();
    }
    function color_formatHex8() {
      return this.rgb().formatHex8();
    }
    function color_formatHsl() {
      return hslConvert(this).formatHsl();
    }
    function color_formatRgb() {
      return this.rgb().formatRgb();
    }
    function color(format) {
      var m, l;
      format = (format + "").trim().toLowerCase();
      return (m = reHex.exec(format)) ? (l = m[1].length, m = parseInt(m[1], 16), l === 6 ? rgbn(m) : l === 3 ? new Rgb(m >> 8 & 15 | m >> 4 & 240, m >> 4 & 15 | m & 240, (m & 15) << 4 | m & 15, 1) : l === 8 ? rgba(m >> 24 & 255, m >> 16 & 255, m >> 8 & 255, (m & 255) / 255) : l === 4 ? rgba(m >> 12 & 15 | m >> 8 & 240, m >> 8 & 15 | m >> 4 & 240, m >> 4 & 15 | m & 240, ((m & 15) << 4 | m & 15) / 255) : null) : (m = reRgbInteger.exec(format)) ? new Rgb(m[1], m[2], m[3], 1) : (m = reRgbPercent.exec(format)) ? new Rgb(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, 1) : (m = reRgbaInteger.exec(format)) ? rgba(m[1], m[2], m[3], m[4]) : (m = reRgbaPercent.exec(format)) ? rgba(m[1] * 255 / 100, m[2] * 255 / 100, m[3] * 255 / 100, m[4]) : (m = reHslPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, 1) : (m = reHslaPercent.exec(format)) ? hsla(m[1], m[2] / 100, m[3] / 100, m[4]) : named.hasOwnProperty(format) ? rgbn(named[format]) : format === "transparent" ? new Rgb(NaN, NaN, NaN, 0) : null;
    }
    function rgbn(n) {
      return new Rgb(n >> 16 & 255, n >> 8 & 255, n & 255, 1);
    }
    function rgba(r, g, b, a) {
      if (a <= 0) r = g = b = NaN;
      return new Rgb(r, g, b, a);
    }
    function rgbConvert(o) {
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Rgb();
      o = o.rgb();
      return new Rgb(o.r, o.g, o.b, o.opacity);
    }
    function rgb(r, g, b, opacity) {
      return arguments.length === 1 ? rgbConvert(r) : new Rgb(r, g, b, opacity == null ? 1 : opacity);
    }
    function Rgb(r, g, b, opacity) {
      this.r = +r;
      this.g = +g;
      this.b = +b;
      this.opacity = +opacity;
    }
    define(Rgb, rgb, extend(Color, {
      brighter(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      darker(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Rgb(this.r * k, this.g * k, this.b * k, this.opacity);
      },
      rgb() {
        return this;
      },
      clamp() {
        return new Rgb(clampi(this.r), clampi(this.g), clampi(this.b), clampa(this.opacity));
      },
      displayable() {
        return -0.5 <= this.r && this.r < 255.5 && (-0.5 <= this.g && this.g < 255.5) && (-0.5 <= this.b && this.b < 255.5) && (0 <= this.opacity && this.opacity <= 1);
      },
      hex: rgb_formatHex,
      // Deprecated! Use color.formatHex.
      formatHex: rgb_formatHex,
      formatHex8: rgb_formatHex8,
      formatRgb: rgb_formatRgb,
      toString: rgb_formatRgb
    }));
    function rgb_formatHex() {
      return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
    }
    function rgb_formatHex8() {
      return `#${hex(this.r)}${hex(this.g)}${hex(this.b)}${hex((isNaN(this.opacity) ? 1 : this.opacity) * 255)}`;
    }
    function rgb_formatRgb() {
      const a = clampa(this.opacity);
      return `${a === 1 ? "rgb(" : "rgba("}${clampi(this.r)}, ${clampi(this.g)}, ${clampi(this.b)}${a === 1 ? ")" : `, ${a})`}`;
    }
    function clampa(opacity) {
      return isNaN(opacity) ? 1 : Math.max(0, Math.min(1, opacity));
    }
    function clampi(value2) {
      return Math.max(0, Math.min(255, Math.round(value2) || 0));
    }
    function hex(value2) {
      value2 = clampi(value2);
      return (value2 < 16 ? "0" : "") + value2.toString(16);
    }
    function hsla(h, s, l, a) {
      if (a <= 0) h = s = l = NaN;
      else if (l <= 0 || l >= 1) h = s = NaN;
      else if (s <= 0) h = NaN;
      return new Hsl(h, s, l, a);
    }
    function hslConvert(o) {
      if (o instanceof Hsl) return new Hsl(o.h, o.s, o.l, o.opacity);
      if (!(o instanceof Color)) o = color(o);
      if (!o) return new Hsl();
      if (o instanceof Hsl) return o;
      o = o.rgb();
      var r = o.r / 255, g = o.g / 255, b = o.b / 255, min = Math.min(r, g, b), max = Math.max(r, g, b), h = NaN, s = max - min, l = (max + min) / 2;
      if (s) {
        if (r === max) h = (g - b) / s + (g < b) * 6;
        else if (g === max) h = (b - r) / s + 2;
        else h = (r - g) / s + 4;
        s /= l < 0.5 ? max + min : 2 - max - min;
        h *= 60;
      } else {
        s = l > 0 && l < 1 ? 0 : h;
      }
      return new Hsl(h, s, l, o.opacity);
    }
    function hsl(h, s, l, opacity) {
      return arguments.length === 1 ? hslConvert(h) : new Hsl(h, s, l, opacity == null ? 1 : opacity);
    }
    function Hsl(h, s, l, opacity) {
      this.h = +h;
      this.s = +s;
      this.l = +l;
      this.opacity = +opacity;
    }
    define(Hsl, hsl, extend(Color, {
      brighter(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      darker(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Hsl(this.h, this.s, this.l * k, this.opacity);
      },
      rgb() {
        var h = this.h % 360 + (this.h < 0) * 360, s = isNaN(h) || isNaN(this.s) ? 0 : this.s, l = this.l, m2 = l + (l < 0.5 ? l : 1 - l) * s, m1 = 2 * l - m2;
        return new Rgb(
          hsl2rgb(h >= 240 ? h - 240 : h + 120, m1, m2),
          hsl2rgb(h, m1, m2),
          hsl2rgb(h < 120 ? h + 240 : h - 120, m1, m2),
          this.opacity
        );
      },
      clamp() {
        return new Hsl(clamph(this.h), clampt(this.s), clampt(this.l), clampa(this.opacity));
      },
      displayable() {
        return (0 <= this.s && this.s <= 1 || isNaN(this.s)) && (0 <= this.l && this.l <= 1) && (0 <= this.opacity && this.opacity <= 1);
      },
      formatHsl() {
        const a = clampa(this.opacity);
        return `${a === 1 ? "hsl(" : "hsla("}${clamph(this.h)}, ${clampt(this.s) * 100}%, ${clampt(this.l) * 100}%${a === 1 ? ")" : `, ${a})`}`;
      }
    }));
    function clamph(value2) {
      value2 = (value2 || 0) % 360;
      return value2 < 0 ? value2 + 360 : value2;
    }
    function clampt(value2) {
      return Math.max(0, Math.min(1, value2 || 0));
    }
    function hsl2rgb(h, m1, m2) {
      return (h < 60 ? m1 + (m2 - m1) * h / 60 : h < 180 ? m2 : h < 240 ? m1 + (m2 - m1) * (240 - h) / 60 : m1) * 255;
    }
    var radians = Math.PI / 180;
    var degrees = 180 / Math.PI;
    var K = 18;
    var Xn = 0.96422;
    var Yn = 1;
    var Zn = 0.82521;
    var t0 = 4 / 29;
    var t1 = 6 / 29;
    var t2 = 3 * t1 * t1;
    var t3 = t1 * t1 * t1;
    function labConvert(o) {
      if (o instanceof Lab) return new Lab(o.l, o.a, o.b, o.opacity);
      if (o instanceof Hcl) return hcl2lab(o);
      if (!(o instanceof Rgb)) o = rgbConvert(o);
      var r = rgb2lrgb(o.r), g = rgb2lrgb(o.g), b = rgb2lrgb(o.b), y = xyz2lab((0.2225045 * r + 0.7168786 * g + 0.0606169 * b) / Yn), x, z;
      if (r === g && g === b) x = z = y;
      else {
        x = xyz2lab((0.4360747 * r + 0.3850649 * g + 0.1430804 * b) / Xn);
        z = xyz2lab((0.0139322 * r + 0.0971045 * g + 0.7141733 * b) / Zn);
      }
      return new Lab(116 * y - 16, 500 * (x - y), 200 * (y - z), o.opacity);
    }
    function lab(l, a, b, opacity) {
      return arguments.length === 1 ? labConvert(l) : new Lab(l, a, b, opacity == null ? 1 : opacity);
    }
    function Lab(l, a, b, opacity) {
      this.l = +l;
      this.a = +a;
      this.b = +b;
      this.opacity = +opacity;
    }
    define(Lab, lab, extend(Color, {
      brighter(k) {
        return new Lab(this.l + K * (k == null ? 1 : k), this.a, this.b, this.opacity);
      },
      darker(k) {
        return new Lab(this.l - K * (k == null ? 1 : k), this.a, this.b, this.opacity);
      },
      rgb() {
        var y = (this.l + 16) / 116, x = isNaN(this.a) ? y : y + this.a / 500, z = isNaN(this.b) ? y : y - this.b / 200;
        x = Xn * lab2xyz(x);
        y = Yn * lab2xyz(y);
        z = Zn * lab2xyz(z);
        return new Rgb(
          lrgb2rgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
          lrgb2rgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
          lrgb2rgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
          this.opacity
        );
      }
    }));
    function xyz2lab(t) {
      return t > t3 ? Math.pow(t, 1 / 3) : t / t2 + t0;
    }
    function lab2xyz(t) {
      return t > t1 ? t * t * t : t2 * (t - t0);
    }
    function lrgb2rgb(x) {
      return 255 * (x <= 31308e-7 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
    }
    function rgb2lrgb(x) {
      return (x /= 255) <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    function hclConvert(o) {
      if (o instanceof Hcl) return new Hcl(o.h, o.c, o.l, o.opacity);
      if (!(o instanceof Lab)) o = labConvert(o);
      if (o.a === 0 && o.b === 0) return new Hcl(NaN, 0 < o.l && o.l < 100 ? 0 : NaN, o.l, o.opacity);
      var h = Math.atan2(o.b, o.a) * degrees;
      return new Hcl(h < 0 ? h + 360 : h, Math.sqrt(o.a * o.a + o.b * o.b), o.l, o.opacity);
    }
    function hcl(h, c, l, opacity) {
      return arguments.length === 1 ? hclConvert(h) : new Hcl(h, c, l, opacity == null ? 1 : opacity);
    }
    function Hcl(h, c, l, opacity) {
      this.h = +h;
      this.c = +c;
      this.l = +l;
      this.opacity = +opacity;
    }
    function hcl2lab(o) {
      if (isNaN(o.h)) return new Lab(o.l, 0, 0, o.opacity);
      var h = o.h * radians;
      return new Lab(o.l, Math.cos(h) * o.c, Math.sin(h) * o.c, o.opacity);
    }
    define(Hcl, hcl, extend(Color, {
      brighter(k) {
        return new Hcl(this.h, this.c, this.l + K * (k == null ? 1 : k), this.opacity);
      },
      darker(k) {
        return new Hcl(this.h, this.c, this.l - K * (k == null ? 1 : k), this.opacity);
      },
      rgb() {
        return hcl2lab(this).rgb();
      }
    }));
    var A = -0.14861;
    var B = 1.78277;
    var C = -0.29227;
    var D = -0.90649;
    var E = 1.97294;
    var ED = E * D;
    var EB = E * B;
    var BC_DA = B * C - D * A;
    function cubehelixConvert(o) {
      if (o instanceof Cubehelix) return new Cubehelix(o.h, o.s, o.l, o.opacity);
      if (!(o instanceof Rgb)) o = rgbConvert(o);
      var r = o.r / 255, g = o.g / 255, b = o.b / 255, l = (BC_DA * b + ED * r - EB * g) / (BC_DA + ED - EB), bl = b - l, k = (E * (g - l) - C * bl) / D, s = Math.sqrt(k * k + bl * bl) / (E * l * (1 - l)), h = s ? Math.atan2(k, bl) * degrees - 120 : NaN;
      return new Cubehelix(h < 0 ? h + 360 : h, s, l, o.opacity);
    }
    function cubehelix(h, s, l, opacity) {
      return arguments.length === 1 ? cubehelixConvert(h) : new Cubehelix(h, s, l, opacity == null ? 1 : opacity);
    }
    function Cubehelix(h, s, l, opacity) {
      this.h = +h;
      this.s = +s;
      this.l = +l;
      this.opacity = +opacity;
    }
    define(Cubehelix, cubehelix, extend(Color, {
      brighter(k) {
        k = k == null ? brighter : Math.pow(brighter, k);
        return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
      },
      darker(k) {
        k = k == null ? darker : Math.pow(darker, k);
        return new Cubehelix(this.h, this.s, this.l * k, this.opacity);
      },
      rgb() {
        var h = isNaN(this.h) ? 0 : (this.h + 120) * radians, l = +this.l, a = isNaN(this.s) ? 0 : this.s * l * (1 - l), cosh2 = Math.cos(h), sinh2 = Math.sin(h);
        return new Rgb(
          255 * (l + a * (A * cosh2 + B * sinh2)),
          255 * (l + a * (C * cosh2 + D * sinh2)),
          255 * (l + a * (E * cosh2)),
          this.opacity
        );
      }
    }));

    // node_modules/.pnpm/d3-interpolate@3.0.2/node_modules/d3-interpolate/dist/d3-interpolate.mjs
    function basis(t12, v0, v1, v2, v3) {
      var t22 = t12 * t12, t32 = t22 * t12;
      return ((1 - 3 * t12 + 3 * t22 - t32) * v0 + (4 - 6 * t22 + 3 * t32) * v1 + (1 + 3 * t12 + 3 * t22 - 3 * t32) * v2 + t32 * v3) / 6;
    }
    function basis$1(values) {
      var n = values.length - 1;
      return function(t) {
        var i = t <= 0 ? t = 0 : t >= 1 ? (t = 1, n - 1) : Math.floor(t * n), v1 = values[i], v2 = values[i + 1], v0 = i > 0 ? values[i - 1] : 2 * v1 - v2, v3 = i < n - 1 ? values[i + 2] : 2 * v2 - v1;
        return basis((t - i / n) * n, v0, v1, v2, v3);
      };
    }
    function basisClosed(values) {
      var n = values.length;
      return function(t) {
        var i = Math.floor(((t %= 1) < 0 ? ++t : t) * n), v0 = values[(i + n - 1) % n], v1 = values[i % n], v2 = values[(i + 1) % n], v3 = values[(i + 2) % n];
        return basis((t - i / n) * n, v0, v1, v2, v3);
      };
    }
    var constant3 = (x) => () => x;
    function linear(a, d) {
      return function(t) {
        return a + t * d;
      };
    }
    function exponential(a, b, y) {
      return a = Math.pow(a, y), b = Math.pow(b, y) - a, y = 1 / y, function(t) {
        return Math.pow(a + t * b, y);
      };
    }
    function hue$1(a, b) {
      var d = b - a;
      return d ? linear(a, d > 180 || d < -180 ? d - 360 * Math.round(d / 360) : d) : constant3(isNaN(a) ? b : a);
    }
    function gamma(y) {
      return (y = +y) === 1 ? nogamma : function(a, b) {
        return b - a ? exponential(a, b, y) : constant3(isNaN(a) ? b : a);
      };
    }
    function nogamma(a, b) {
      var d = b - a;
      return d ? linear(a, d) : constant3(isNaN(a) ? b : a);
    }
    var rgb2 = (function rgbGamma(y) {
      var color2 = gamma(y);
      function rgb3(start2, end) {
        var r = color2((start2 = rgb(start2)).r, (end = rgb(end)).r), g = color2(start2.g, end.g), b = color2(start2.b, end.b), opacity = nogamma(start2.opacity, end.opacity);
        return function(t) {
          start2.r = r(t);
          start2.g = g(t);
          start2.b = b(t);
          start2.opacity = opacity(t);
          return start2 + "";
        };
      }
      rgb3.gamma = rgbGamma;
      return rgb3;
    })(1);
    function rgbSpline(spline) {
      return function(colors) {
        var n = colors.length, r = new Array(n), g = new Array(n), b = new Array(n), i, color2;
        for (i = 0; i < n; ++i) {
          color2 = rgb(colors[i]);
          r[i] = color2.r || 0;
          g[i] = color2.g || 0;
          b[i] = color2.b || 0;
        }
        r = spline(r);
        g = spline(g);
        b = spline(b);
        color2.opacity = 1;
        return function(t) {
          color2.r = r(t);
          color2.g = g(t);
          color2.b = b(t);
          return color2 + "";
        };
      };
    }
    var rgbBasis = rgbSpline(basis$1);
    var rgbBasisClosed = rgbSpline(basisClosed);
    function numberArray(a, b) {
      if (!b) b = [];
      var n = a ? Math.min(b.length, a.length) : 0, c = b.slice(), i;
      return function(t) {
        for (i = 0; i < n; ++i) c[i] = a[i] * (1 - t) + b[i] * t;
        return c;
      };
    }
    function isNumberArray(x) {
      return ArrayBuffer.isView(x) && !(x instanceof DataView);
    }
    function genericArray(a, b) {
      var nb = b ? b.length : 0, na = a ? Math.min(nb, a.length) : 0, x = new Array(na), c = new Array(nb), i;
      for (i = 0; i < na; ++i) x[i] = value(a[i], b[i]);
      for (; i < nb; ++i) c[i] = b[i];
      return function(t) {
        for (i = 0; i < na; ++i) c[i] = x[i](t);
        return c;
      };
    }
    function date(a, b) {
      var d = /* @__PURE__ */ new Date();
      return a = +a, b = +b, function(t) {
        return d.setTime(a * (1 - t) + b * t), d;
      };
    }
    function number(a, b) {
      return a = +a, b = +b, function(t) {
        return a * (1 - t) + b * t;
      };
    }
    function object(a, b) {
      var i = {}, c = {}, k;
      if (a === null || typeof a !== "object") a = {};
      if (b === null || typeof b !== "object") b = {};
      for (k in b) {
        if (k in a) {
          i[k] = value(a[k], b[k]);
        } else {
          c[k] = b[k];
        }
      }
      return function(t) {
        for (k in i) c[k] = i[k](t);
        return c;
      };
    }
    var reA = /[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g;
    var reB = new RegExp(reA.source, "g");
    function zero(b) {
      return function() {
        return b;
      };
    }
    function one(b) {
      return function(t) {
        return b(t) + "";
      };
    }
    function string(a, b) {
      var bi = reA.lastIndex = reB.lastIndex = 0, am, bm, bs, i = -1, s = [], q = [];
      a = a + "", b = b + "";
      while ((am = reA.exec(a)) && (bm = reB.exec(b))) {
        if ((bs = bm.index) > bi) {
          bs = b.slice(bi, bs);
          if (s[i]) s[i] += bs;
          else s[++i] = bs;
        }
        if ((am = am[0]) === (bm = bm[0])) {
          if (s[i]) s[i] += bm;
          else s[++i] = bm;
        } else {
          s[++i] = null;
          q.push({ i, x: number(am, bm) });
        }
        bi = reB.lastIndex;
      }
      if (bi < b.length) {
        bs = b.slice(bi);
        if (s[i]) s[i] += bs;
        else s[++i] = bs;
      }
      return s.length < 2 ? q[0] ? one(q[0].x) : zero(b) : (b = q.length, function(t) {
        for (var i2 = 0, o; i2 < b; ++i2) s[(o = q[i2]).i] = o.x(t);
        return s.join("");
      });
    }
    function value(a, b) {
      var t = typeof b, c;
      return b == null || t === "boolean" ? constant3(b) : (t === "number" ? number : t === "string" ? (c = color(b)) ? (b = c, rgb2) : string : b instanceof color ? rgb2 : b instanceof Date ? date : isNumberArray(b) ? numberArray : Array.isArray(b) ? genericArray : typeof b.valueOf !== "function" && typeof b.toString !== "function" || isNaN(b) ? object : number)(a, b);
    }
    var degrees2 = 180 / Math.PI;
    var identity = {
      translateX: 0,
      translateY: 0,
      rotate: 0,
      skewX: 0,
      scaleX: 1,
      scaleY: 1
    };
    function decompose(a, b, c, d, e, f) {
      var scaleX, scaleY, skewX;
      if (scaleX = Math.sqrt(a * a + b * b)) a /= scaleX, b /= scaleX;
      if (skewX = a * c + b * d) c -= a * skewX, d -= b * skewX;
      if (scaleY = Math.sqrt(c * c + d * d)) c /= scaleY, d /= scaleY, skewX /= scaleY;
      if (a * d < b * c) a = -a, b = -b, skewX = -skewX, scaleX = -scaleX;
      return {
        translateX: e,
        translateY: f,
        rotate: Math.atan2(b, a) * degrees2,
        skewX: Math.atan(skewX) * degrees2,
        scaleX,
        scaleY
      };
    }
    var svgNode;
    function parseCss(value2) {
      const m = new (typeof DOMMatrix === "function" ? DOMMatrix : WebKitCSSMatrix)(value2 + "");
      return m.isIdentity ? identity : decompose(m.a, m.b, m.c, m.d, m.e, m.f);
    }
    function parseSvg(value2) {
      if (value2 == null) return identity;
      if (!svgNode) svgNode = document.createElementNS("http://www.w3.org/2000/svg", "g");
      svgNode.setAttribute("transform", value2);
      if (!(value2 = svgNode.transform.baseVal.consolidate())) return identity;
      value2 = value2.matrix;
      return decompose(value2.a, value2.b, value2.c, value2.d, value2.e, value2.f);
    }
    function interpolateTransform(parse, pxComma, pxParen, degParen) {
      function pop(s) {
        return s.length ? s.pop() + " " : "";
      }
      function translate(xa, ya, xb, yb, s, q) {
        if (xa !== xb || ya !== yb) {
          var i = s.push("translate(", null, pxComma, null, pxParen);
          q.push({ i: i - 4, x: number(xa, xb) }, { i: i - 2, x: number(ya, yb) });
        } else if (xb || yb) {
          s.push("translate(" + xb + pxComma + yb + pxParen);
        }
      }
      function rotate(a, b, s, q) {
        if (a !== b) {
          if (a - b > 180) b += 360;
          else if (b - a > 180) a += 360;
          q.push({ i: s.push(pop(s) + "rotate(", null, degParen) - 2, x: number(a, b) });
        } else if (b) {
          s.push(pop(s) + "rotate(" + b + degParen);
        }
      }
      function skewX(a, b, s, q) {
        if (a !== b) {
          q.push({ i: s.push(pop(s) + "skewX(", null, degParen) - 2, x: number(a, b) });
        } else if (b) {
          s.push(pop(s) + "skewX(" + b + degParen);
        }
      }
      function scale(xa, ya, xb, yb, s, q) {
        if (xa !== xb || ya !== yb) {
          var i = s.push(pop(s) + "scale(", null, ",", null, ")");
          q.push({ i: i - 4, x: number(xa, xb) }, { i: i - 2, x: number(ya, yb) });
        } else if (xb !== 1 || yb !== 1) {
          s.push(pop(s) + "scale(" + xb + "," + yb + ")");
        }
      }
      return function(a, b) {
        var s = [], q = [];
        a = parse(a), b = parse(b);
        translate(a.translateX, a.translateY, b.translateX, b.translateY, s, q);
        rotate(a.rotate, b.rotate, s, q);
        skewX(a.skewX, b.skewX, s, q);
        scale(a.scaleX, a.scaleY, b.scaleX, b.scaleY, s, q);
        a = b = null;
        return function(t) {
          var i = -1, n = q.length, o;
          while (++i < n) s[(o = q[i]).i] = o.x(t);
          return s.join("");
        };
      };
    }
    var interpolateTransformCss = interpolateTransform(parseCss, "px, ", "px)", "deg)");
    var interpolateTransformSvg = interpolateTransform(parseSvg, ", ", ")", ")");
    var epsilon2 = 1e-12;
    function cosh(x) {
      return ((x = Math.exp(x)) + 1 / x) / 2;
    }
    function sinh(x) {
      return ((x = Math.exp(x)) - 1 / x) / 2;
    }
    function tanh(x) {
      return ((x = Math.exp(2 * x)) - 1) / (x + 1);
    }
    var zoom = (function zoomRho(rho, rho2, rho4) {
      function zoom3(p0, p1) {
        var ux0 = p0[0], uy0 = p0[1], w0 = p0[2], ux1 = p1[0], uy1 = p1[1], w1 = p1[2], dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, i, S;
        if (d2 < epsilon2) {
          S = Math.log(w1 / w0) / rho;
          i = function(t) {
            return [
              ux0 + t * dx,
              uy0 + t * dy,
              w0 * Math.exp(rho * t * S)
            ];
          };
        } else {
          var d1 = Math.sqrt(d2), b02 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1), b12 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1), r0 = Math.log(Math.sqrt(b02 * b02 + 1) - b02), r1 = Math.log(Math.sqrt(b12 * b12 + 1) - b12);
          S = (r1 - r0) / rho;
          i = function(t) {
            var s = t * S, coshr0 = cosh(r0), u = w0 / (rho2 * d1) * (coshr0 * tanh(rho * s + r0) - sinh(r0));
            return [
              ux0 + u * dx,
              uy0 + u * dy,
              w0 * coshr0 / cosh(rho * s + r0)
            ];
          };
        }
        i.duration = Math.abs(S) * 1e3 * rho / Math.SQRT2;
        return i;
      }
      zoom3.rho = function(_) {
        var _1 = Math.max(1e-3, +_), _2 = _1 * _1, _4 = _2 * _2;
        return zoomRho(_1, _2, _4);
      };
      return zoom3;
    })(Math.SQRT2, 2, 4);
    function hsl2(hue) {
      return function(start2, end) {
        var h = hue((start2 = hsl(start2)).h, (end = hsl(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
        return function(t) {
          start2.h = h(t);
          start2.s = s(t);
          start2.l = l(t);
          start2.opacity = opacity(t);
          return start2 + "";
        };
      };
    }
    var hsl_default = hsl2(hue$1);
    var hslLong = hsl2(nogamma);
    function hcl2(hue) {
      return function(start2, end) {
        var h = hue((start2 = hcl(start2)).h, (end = hcl(end)).h), c = nogamma(start2.c, end.c), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
        return function(t) {
          start2.h = h(t);
          start2.c = c(t);
          start2.l = l(t);
          start2.opacity = opacity(t);
          return start2 + "";
        };
      };
    }
    var hcl_default = hcl2(hue$1);
    var hclLong = hcl2(nogamma);
    function cubehelix2(hue) {
      return (function cubehelixGamma(y) {
        y = +y;
        function cubehelix3(start2, end) {
          var h = hue((start2 = cubehelix(start2)).h, (end = cubehelix(end)).h), s = nogamma(start2.s, end.s), l = nogamma(start2.l, end.l), opacity = nogamma(start2.opacity, end.opacity);
          return function(t) {
            start2.h = h(t);
            start2.s = s(t);
            start2.l = l(Math.pow(t, y));
            start2.opacity = opacity(t);
            return start2 + "";
          };
        }
        cubehelix3.gamma = cubehelixGamma;
        return cubehelix3;
      })(1);
    }
    var cubehelix_default = cubehelix2(hue$1);
    var cubehelixLong = cubehelix2(nogamma);

    // node_modules/.pnpm/d3-timer@3.0.2/node_modules/d3-timer/dist/d3-timer.mjs
    var frame = 0;
    var timeout$1 = 0;
    var interval$1 = 0;
    var pokeDelay = 1e3;
    var taskHead;
    var taskTail;
    var clockLast = 0;
    var clockNow = 0;
    var clockSkew = 0;
    var clock = typeof performance === "object" && performance.now ? performance : Date;
    var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
      setTimeout(f, 17);
    };
    function now() {
      return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
    }
    function clearNow() {
      clockNow = 0;
    }
    function Timer() {
      this._call = this._time = this._next = null;
    }
    Timer.prototype = timer.prototype = {
      constructor: Timer,
      restart: function(callback, delay, time) {
        if (typeof callback !== "function") throw new TypeError("callback is not a function");
        time = (time == null ? now() : +time) + (delay == null ? 0 : +delay);
        if (!this._next && taskTail !== this) {
          if (taskTail) taskTail._next = this;
          else taskHead = this;
          taskTail = this;
        }
        this._call = callback;
        this._time = time;
        sleep();
      },
      stop: function() {
        if (this._call) {
          this._call = null;
          this._time = Infinity;
          sleep();
        }
      }
    };
    function timer(callback, delay, time) {
      var t = new Timer();
      t.restart(callback, delay, time);
      return t;
    }
    function timerFlush() {
      now();
      ++frame;
      var t = taskHead, e;
      while (t) {
        if ((e = clockNow - t._time) >= 0) t._call.call(void 0, e);
        t = t._next;
      }
      --frame;
    }
    function wake() {
      clockNow = (clockLast = clock.now()) + clockSkew;
      frame = timeout$1 = 0;
      try {
        timerFlush();
      } finally {
        frame = 0;
        nap();
        clockNow = 0;
      }
    }
    function poke() {
      var now2 = clock.now(), delay = now2 - clockLast;
      if (delay > pokeDelay) clockSkew -= delay, clockLast = now2;
    }
    function nap() {
      var t02, t12 = taskHead, t22, time = Infinity;
      while (t12) {
        if (t12._call) {
          if (time > t12._time) time = t12._time;
          t02 = t12, t12 = t12._next;
        } else {
          t22 = t12._next, t12._next = null;
          t12 = t02 ? t02._next = t22 : taskHead = t22;
        }
      }
      taskTail = t02;
      sleep(time);
    }
    function sleep(time) {
      if (frame) return;
      if (timeout$1) timeout$1 = clearTimeout(timeout$1);
      var delay = time - clockNow;
      if (delay > 24) {
        if (time < Infinity) timeout$1 = setTimeout(wake, Math.ceil(time - clock.now() - clockSkew) + 1);
        if (interval$1) interval$1 = clearInterval(interval$1);
      } else {
        if (!interval$1) clockLast = clock.now(), interval$1 = setInterval(poke, pokeDelay);
        frame = 1, setFrame(wake);
      }
    }
    function timeout(callback, delay, time) {
      var t = new Timer();
      delay = delay == null ? 0 : +delay;
      t.restart((elapsed) => {
        t.stop();
        callback(elapsed + delay);
      }, delay, time);
      return t;
    }

    // node_modules/.pnpm/d3-ease@3.0.2/node_modules/d3-ease/dist/d3-ease.mjs
    function cubicInOut(t) {
      return ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
    }
    var exponent = 3;
    var polyIn = (function custom(e) {
      e = +e;
      function polyIn2(t) {
        return Math.pow(t, e);
      }
      polyIn2.exponent = custom;
      return polyIn2;
    })(exponent);
    var polyOut = (function custom2(e) {
      e = +e;
      function polyOut2(t) {
        return 1 - Math.pow(1 - t, e);
      }
      polyOut2.exponent = custom2;
      return polyOut2;
    })(exponent);
    var polyInOut = (function custom3(e) {
      e = +e;
      function polyInOut2(t) {
        return ((t *= 2) <= 1 ? Math.pow(t, e) : 2 - Math.pow(2 - t, e)) / 2;
      }
      polyInOut2.exponent = custom3;
      return polyInOut2;
    })(exponent);
    var pi = Math.PI;
    var halfPi = pi / 2;
    function tpmt(x) {
      return (Math.pow(2, -10 * x) - 9765625e-10) * 1.0009775171065494;
    }
    var b1 = 4 / 11;
    var b2 = 6 / 11;
    var b3 = 8 / 11;
    var b4 = 3 / 4;
    var b5 = 9 / 11;
    var b6 = 10 / 11;
    var b7 = 15 / 16;
    var b8 = 21 / 22;
    var b9 = 63 / 64;
    var b0 = 1 / b1 / b1;
    var overshoot = 1.70158;
    var backIn = (function custom4(s) {
      s = +s;
      function backIn2(t) {
        return (t = +t) * t * (s * (t - 1) + t);
      }
      backIn2.overshoot = custom4;
      return backIn2;
    })(overshoot);
    var backOut = (function custom5(s) {
      s = +s;
      function backOut2(t) {
        return --t * t * ((t + 1) * s + t) + 1;
      }
      backOut2.overshoot = custom5;
      return backOut2;
    })(overshoot);
    var backInOut = (function custom6(s) {
      s = +s;
      function backInOut2(t) {
        return ((t *= 2) < 1 ? t * t * ((s + 1) * t - s) : (t -= 2) * t * ((s + 1) * t + s) + 2) / 2;
      }
      backInOut2.overshoot = custom6;
      return backInOut2;
    })(overshoot);
    var tau = 2 * Math.PI;
    var amplitude = 1;
    var period = 0.3;
    var elasticIn = (function custom7(a, p) {
      var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
      function elasticIn2(t) {
        return a * tpmt(- --t) * Math.sin((s - t) / p);
      }
      elasticIn2.amplitude = function(a2) {
        return custom7(a2, p * tau);
      };
      elasticIn2.period = function(p2) {
        return custom7(a, p2);
      };
      return elasticIn2;
    })(amplitude, period);
    var elasticOut = (function custom8(a, p) {
      var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
      function elasticOut2(t) {
        return 1 - a * tpmt(t = +t) * Math.sin((t + s) / p);
      }
      elasticOut2.amplitude = function(a2) {
        return custom8(a2, p * tau);
      };
      elasticOut2.period = function(p2) {
        return custom8(a, p2);
      };
      return elasticOut2;
    })(amplitude, period);
    var elasticInOut = (function custom9(a, p) {
      var s = Math.asin(1 / (a = Math.max(1, a))) * (p /= tau);
      function elasticInOut2(t) {
        return ((t = t * 2 - 1) < 0 ? a * tpmt(-t) * Math.sin((s - t) / p) : 2 - a * tpmt(t) * Math.sin((s + t) / p)) / 2;
      }
      elasticInOut2.amplitude = function(a2) {
        return custom9(a2, p * tau);
      };
      elasticInOut2.period = function(p2) {
        return custom9(a, p2);
      };
      return elasticInOut2;
    })(amplitude, period);

    // node_modules/.pnpm/d3-transition@3.0.2_d3-selection@3.0.1/node_modules/d3-transition/dist/d3-transition.mjs
    var emptyOn = dispatch("start", "end", "cancel", "interrupt");
    var emptyTween = [];
    var CREATED = 0;
    var SCHEDULED = 1;
    var STARTING = 2;
    var STARTED = 3;
    var RUNNING = 4;
    var ENDING = 5;
    var ENDED = 6;
    function schedule(node, name, id2, index2, group, timing) {
      var schedules = node.__transition;
      if (!schedules) node.__transition = {};
      else if (id2 in schedules) return;
      create(node, id2, {
        name,
        index: index2,
        // For context during callback.
        group,
        // For context during callback.
        on: emptyOn,
        tween: emptyTween,
        time: timing.time,
        delay: timing.delay,
        duration: timing.duration,
        ease: timing.ease,
        timer: null,
        state: CREATED
      });
    }
    function init(node, id2) {
      var schedule2 = get2(node, id2);
      if (schedule2.state > CREATED) throw new Error("too late; already scheduled");
      return schedule2;
    }
    function set2(node, id2) {
      var schedule2 = get2(node, id2);
      if (schedule2.state > STARTED) throw new Error("too late; already running");
      return schedule2;
    }
    function get2(node, id2) {
      var schedule2 = node.__transition;
      if (!schedule2 || !(schedule2 = schedule2[id2])) throw new Error("transition not found");
      return schedule2;
    }
    function create(node, id2, self) {
      var schedules = node.__transition, tween;
      schedules[id2] = self;
      self.timer = timer(schedule2, 0, self.time);
      function schedule2(elapsed) {
        self.state = SCHEDULED;
        self.timer.restart(start2, self.delay, self.time);
        if (self.delay <= elapsed) start2(elapsed - self.delay);
      }
      function start2(elapsed) {
        var i, j, n, o;
        if (self.state !== SCHEDULED) return stop();
        for (i in schedules) {
          o = schedules[i];
          if (o.name !== self.name) continue;
          if (o.state === STARTED) return timeout(start2);
          if (o.state === RUNNING) {
            o.state = ENDED;
            o.timer.stop();
            o.on.call("interrupt", node, node.__data__, o.index, o.group);
            delete schedules[i];
          } else if (+i < id2) {
            o.state = ENDED;
            o.timer.stop();
            o.on.call("cancel", node, node.__data__, o.index, o.group);
            delete schedules[i];
          }
        }
        timeout(function() {
          if (self.state === STARTED) {
            self.state = RUNNING;
            self.timer.restart(tick, self.delay, self.time);
            tick(elapsed);
          }
        });
        self.state = STARTING;
        self.on.call("start", node, node.__data__, self.index, self.group);
        if (self.state !== STARTING) return;
        self.state = STARTED;
        tween = new Array(n = self.tween.length);
        for (i = 0, j = -1; i < n; ++i) {
          if (o = self.tween[i].value.call(node, node.__data__, self.index, self.group)) {
            tween[++j] = o;
          }
        }
        tween.length = j + 1;
      }
      function tick(elapsed) {
        var t = elapsed < self.duration ? self.ease.call(null, elapsed / self.duration) : (self.timer.restart(stop), self.state = ENDING, 1), i = -1, n = tween.length;
        while (++i < n) {
          tween[i].call(node, t);
        }
        if (self.state === ENDING) {
          self.on.call("end", node, node.__data__, self.index, self.group);
          stop();
        }
      }
      function stop() {
        self.state = ENDED;
        self.timer.stop();
        delete schedules[id2];
        for (var i in schedules) return;
        delete node.__transition;
      }
    }
    function interrupt(node, name) {
      var schedules = node.__transition, schedule2, active, empty2 = true, i;
      if (!schedules) return;
      name = name == null ? null : name + "";
      for (i in schedules) {
        if ((schedule2 = schedules[i]).name !== name) {
          empty2 = false;
          continue;
        }
        active = schedule2.state > STARTING && schedule2.state < ENDING;
        schedule2.state = ENDED;
        schedule2.timer.stop();
        schedule2.on.call(active ? "interrupt" : "cancel", node, node.__data__, schedule2.index, schedule2.group);
        delete schedules[i];
      }
      if (empty2) delete node.__transition;
    }
    function selection_interrupt(name) {
      return this.each(function() {
        interrupt(this, name);
      });
    }
    function tweenRemove(id2, name) {
      var tween0, tween1;
      return function() {
        var schedule2 = set2(this, id2), tween = schedule2.tween;
        if (tween !== tween0) {
          tween1 = tween0 = tween;
          for (var i = 0, n = tween1.length; i < n; ++i) {
            if (tween1[i].name === name) {
              tween1 = tween1.slice();
              tween1.splice(i, 1);
              break;
            }
          }
        }
        schedule2.tween = tween1;
      };
    }
    function tweenFunction(id2, name, value2) {
      var tween0, tween1;
      if (typeof value2 !== "function") throw new Error();
      return function() {
        var schedule2 = set2(this, id2), tween = schedule2.tween;
        if (tween !== tween0) {
          tween1 = (tween0 = tween).slice();
          for (var t = { name, value: value2 }, i = 0, n = tween1.length; i < n; ++i) {
            if (tween1[i].name === name) {
              tween1[i] = t;
              break;
            }
          }
          if (i === n) tween1.push(t);
        }
        schedule2.tween = tween1;
      };
    }
    function transition_tween(name, value2) {
      var id2 = this._id;
      name += "";
      if (arguments.length < 2) {
        var tween = get2(this.node(), id2).tween;
        for (var i = 0, n = tween.length, t; i < n; ++i) {
          if ((t = tween[i]).name === name) {
            return t.value;
          }
        }
        return null;
      }
      return this.each((value2 == null ? tweenRemove : tweenFunction)(id2, name, value2));
    }
    function tweenValue(transition2, name, value2) {
      var id2 = transition2._id;
      transition2.each(function() {
        var schedule2 = set2(this, id2);
        (schedule2.value || (schedule2.value = {}))[name] = value2.apply(this, arguments);
      });
      return function(node) {
        return get2(node, id2).value[name];
      };
    }
    function interpolate(a, b) {
      var c;
      return (typeof b === "number" ? number : b instanceof color ? rgb2 : (c = color(b)) ? (b = c, rgb2) : string)(a, b);
    }
    function attrRemove2(name) {
      return function() {
        this.removeAttribute(name);
      };
    }
    function attrRemoveNS2(fullname) {
      return function() {
        this.removeAttributeNS(fullname.space, fullname.local);
      };
    }
    function attrConstant2(name, interpolate2, value1) {
      var string00, string1 = value1 + "", interpolate0;
      return function() {
        var string0 = this.getAttribute(name);
        return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
      };
    }
    function attrConstantNS2(fullname, interpolate2, value1) {
      var string00, string1 = value1 + "", interpolate0;
      return function() {
        var string0 = this.getAttributeNS(fullname.space, fullname.local);
        return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
      };
    }
    function attrFunction2(name, interpolate2, value2) {
      var string00, string10, interpolate0;
      return function() {
        var string0, value1 = value2(this), string1;
        if (value1 == null) return void this.removeAttribute(name);
        string0 = this.getAttribute(name);
        string1 = value1 + "";
        return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
      };
    }
    function attrFunctionNS2(fullname, interpolate2, value2) {
      var string00, string10, interpolate0;
      return function() {
        var string0, value1 = value2(this), string1;
        if (value1 == null) return void this.removeAttributeNS(fullname.space, fullname.local);
        string0 = this.getAttributeNS(fullname.space, fullname.local);
        string1 = value1 + "";
        return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
      };
    }
    function transition_attr(name, value2) {
      var fullname = namespace(name), i = fullname === "transform" ? interpolateTransformSvg : interpolate;
      return this.attrTween(name, typeof value2 === "function" ? (fullname.local ? attrFunctionNS2 : attrFunction2)(fullname, i, tweenValue(this, "attr." + name, value2)) : value2 == null ? (fullname.local ? attrRemoveNS2 : attrRemove2)(fullname) : (fullname.local ? attrConstantNS2 : attrConstant2)(fullname, i, value2));
    }
    function attrInterpolate(name, i) {
      return function(t) {
        this.setAttribute(name, i.call(this, t));
      };
    }
    function attrInterpolateNS(fullname, i) {
      return function(t) {
        this.setAttributeNS(fullname.space, fullname.local, i.call(this, t));
      };
    }
    function attrTweenNS(fullname, value2) {
      var t02, i0;
      function tween() {
        var i = value2.apply(this, arguments);
        if (i !== i0) t02 = (i0 = i) && attrInterpolateNS(fullname, i);
        return t02;
      }
      tween._value = value2;
      return tween;
    }
    function attrTween(name, value2) {
      var t02, i0;
      function tween() {
        var i = value2.apply(this, arguments);
        if (i !== i0) t02 = (i0 = i) && attrInterpolate(name, i);
        return t02;
      }
      tween._value = value2;
      return tween;
    }
    function transition_attrTween(name, value2) {
      var key = "attr." + name;
      if (arguments.length < 2) return (key = this.tween(key)) && key._value;
      if (value2 == null) return this.tween(key, null);
      if (typeof value2 !== "function") throw new Error();
      var fullname = namespace(name);
      return this.tween(key, (fullname.local ? attrTweenNS : attrTween)(fullname, value2));
    }
    function delayFunction(id2, value2) {
      return function() {
        init(this, id2).delay = +value2.apply(this, arguments);
      };
    }
    function delayConstant(id2, value2) {
      return value2 = +value2, function() {
        init(this, id2).delay = value2;
      };
    }
    function transition_delay(value2) {
      var id2 = this._id;
      return arguments.length ? this.each((typeof value2 === "function" ? delayFunction : delayConstant)(id2, value2)) : get2(this.node(), id2).delay;
    }
    function durationFunction(id2, value2) {
      return function() {
        set2(this, id2).duration = +value2.apply(this, arguments);
      };
    }
    function durationConstant(id2, value2) {
      return value2 = +value2, function() {
        set2(this, id2).duration = value2;
      };
    }
    function transition_duration(value2) {
      var id2 = this._id;
      return arguments.length ? this.each((typeof value2 === "function" ? durationFunction : durationConstant)(id2, value2)) : get2(this.node(), id2).duration;
    }
    function easeConstant(id2, value2) {
      if (typeof value2 !== "function") throw new Error();
      return function() {
        set2(this, id2).ease = value2;
      };
    }
    function transition_ease(value2) {
      var id2 = this._id;
      return arguments.length ? this.each(easeConstant(id2, value2)) : get2(this.node(), id2).ease;
    }
    function easeVarying(id2, value2) {
      return function() {
        var v = value2.apply(this, arguments);
        if (typeof v !== "function") throw new Error();
        set2(this, id2).ease = v;
      };
    }
    function transition_easeVarying(value2) {
      if (typeof value2 !== "function") throw new Error();
      return this.each(easeVarying(this._id, value2));
    }
    function transition_filter(match) {
      if (typeof match !== "function") match = matcher(match);
      for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, subgroup = subgroups[j] = [], node, i = 0; i < n; ++i) {
          if ((node = group[i]) && match.call(node, node.__data__, i, group)) {
            subgroup.push(node);
          }
        }
      }
      return new Transition(subgroups, this._parents, this._name, this._id);
    }
    function transition_merge(transition2) {
      if (transition2._id !== this._id) throw new Error();
      for (var groups0 = this._groups, groups1 = transition2._groups, m0 = groups0.length, m1 = groups1.length, m = Math.min(m0, m1), merges = new Array(m0), j = 0; j < m; ++j) {
        for (var group0 = groups0[j], group1 = groups1[j], n = group0.length, merge = merges[j] = new Array(n), node, i = 0; i < n; ++i) {
          if (node = group0[i] || group1[i]) {
            merge[i] = node;
          }
        }
      }
      for (; j < m0; ++j) {
        merges[j] = groups0[j];
      }
      return new Transition(merges, this._parents, this._name, this._id);
    }
    function start(name) {
      return (name + "").trim().split(/^|\s+/).every(function(t) {
        var i = t.indexOf(".");
        if (i >= 0) t = t.slice(0, i);
        return !t || t === "start";
      });
    }
    function onFunction(id2, name, listener) {
      var on0, on1, sit = start(name) ? init : set2;
      return function() {
        var schedule2 = sit(this, id2), on = schedule2.on;
        if (on !== on0) (on1 = (on0 = on).copy()).on(name, listener);
        schedule2.on = on1;
      };
    }
    function transition_on(name, listener) {
      var id2 = this._id;
      return arguments.length < 2 ? get2(this.node(), id2).on.on(name) : this.each(onFunction(id2, name, listener));
    }
    function removeFunction(id2) {
      return function() {
        var parent = this.parentNode;
        for (var i in this.__transition) if (+i !== id2) return;
        if (parent) parent.removeChild(this);
      };
    }
    function transition_remove() {
      return this.on("end.remove", removeFunction(this._id));
    }
    function transition_select(select2) {
      var name = this._name, id2 = this._id;
      if (typeof select2 !== "function") select2 = selector(select2);
      for (var groups = this._groups, m = groups.length, subgroups = new Array(m), j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, subgroup = subgroups[j] = new Array(n), node, subnode, i = 0; i < n; ++i) {
          if ((node = group[i]) && (subnode = select2.call(node, node.__data__, i, group))) {
            if ("__data__" in node) subnode.__data__ = node.__data__;
            subgroup[i] = subnode;
            schedule(subgroup[i], name, id2, i, subgroup, get2(node, id2));
          }
        }
      }
      return new Transition(subgroups, this._parents, name, id2);
    }
    function transition_selectAll(select2) {
      var name = this._name, id2 = this._id;
      if (typeof select2 !== "function") select2 = selectorAll(select2);
      for (var groups = this._groups, m = groups.length, subgroups = [], parents = [], j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
          if (node = group[i]) {
            for (var children2 = select2.call(node, node.__data__, i, group), child, inherit2 = get2(node, id2), k = 0, l = children2.length; k < l; ++k) {
              if (child = children2[k]) {
                schedule(child, name, id2, k, children2, inherit2);
              }
            }
            subgroups.push(children2);
            parents.push(node);
          }
        }
      }
      return new Transition(subgroups, parents, name, id2);
    }
    var Selection2 = selection.prototype.constructor;
    function transition_selection() {
      return new Selection2(this._groups, this._parents);
    }
    function styleNull(name, interpolate2) {
      var string00, string10, interpolate0;
      return function() {
        var string0 = styleValue(this, name), string1 = (this.style.removeProperty(name), styleValue(this, name));
        return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, string10 = string1);
      };
    }
    function styleRemove2(name) {
      return function() {
        this.style.removeProperty(name);
      };
    }
    function styleConstant2(name, interpolate2, value1) {
      var string00, string1 = value1 + "", interpolate0;
      return function() {
        var string0 = styleValue(this, name);
        return string0 === string1 ? null : string0 === string00 ? interpolate0 : interpolate0 = interpolate2(string00 = string0, value1);
      };
    }
    function styleFunction2(name, interpolate2, value2) {
      var string00, string10, interpolate0;
      return function() {
        var string0 = styleValue(this, name), value1 = value2(this), string1 = value1 + "";
        if (value1 == null) string1 = value1 = (this.style.removeProperty(name), styleValue(this, name));
        return string0 === string1 ? null : string0 === string00 && string1 === string10 ? interpolate0 : (string10 = string1, interpolate0 = interpolate2(string00 = string0, value1));
      };
    }
    function styleMaybeRemove(id2, name) {
      var on0, on1, listener0, key = "style." + name, event = "end." + key, remove2;
      return function() {
        var schedule2 = set2(this, id2), on = schedule2.on, listener = schedule2.value[key] == null ? remove2 || (remove2 = styleRemove2(name)) : void 0;
        if (on !== on0 || listener0 !== listener) (on1 = (on0 = on).copy()).on(event, listener0 = listener);
        schedule2.on = on1;
      };
    }
    function transition_style(name, value2, priority) {
      var i = (name += "") === "transform" ? interpolateTransformCss : interpolate;
      return value2 == null ? this.styleTween(name, styleNull(name, i)).on("end.style." + name, styleRemove2(name)) : typeof value2 === "function" ? this.styleTween(name, styleFunction2(name, i, tweenValue(this, "style." + name, value2))).each(styleMaybeRemove(this._id, name)) : this.styleTween(name, styleConstant2(name, i, value2), priority).on("end.style." + name, null);
    }
    function styleInterpolate(name, i, priority) {
      return function(t) {
        this.style.setProperty(name, i.call(this, t), priority);
      };
    }
    function styleTween(name, value2, priority) {
      var t, i0;
      function tween() {
        var i = value2.apply(this, arguments);
        if (i !== i0) t = (i0 = i) && styleInterpolate(name, i, priority);
        return t;
      }
      tween._value = value2;
      return tween;
    }
    function transition_styleTween(name, value2, priority) {
      var key = "style." + (name += "");
      if (arguments.length < 2) return (key = this.tween(key)) && key._value;
      if (value2 == null) return this.tween(key, null);
      if (typeof value2 !== "function") throw new Error();
      return this.tween(key, styleTween(name, value2, priority == null ? "" : priority));
    }
    function textConstant2(value2) {
      return function() {
        this.textContent = value2;
      };
    }
    function textFunction2(value2) {
      return function() {
        var value1 = value2(this);
        this.textContent = value1 == null ? "" : value1;
      };
    }
    function transition_text(value2) {
      return this.tween("text", typeof value2 === "function" ? textFunction2(tweenValue(this, "text", value2)) : textConstant2(value2 == null ? "" : value2 + ""));
    }
    function textInterpolate(i) {
      return function(t) {
        this.textContent = i.call(this, t);
      };
    }
    function textTween(value2) {
      var t02, i0;
      function tween() {
        var i = value2.apply(this, arguments);
        if (i !== i0) t02 = (i0 = i) && textInterpolate(i);
        return t02;
      }
      tween._value = value2;
      return tween;
    }
    function transition_textTween(value2) {
      var key = "text";
      if (arguments.length < 1) return (key = this.tween(key)) && key._value;
      if (value2 == null) return this.tween(key, null);
      if (typeof value2 !== "function") throw new Error();
      return this.tween(key, textTween(value2));
    }
    function transition_transition() {
      var name = this._name, id0 = this._id, id1 = newId();
      for (var groups = this._groups, m = groups.length, j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
          if (node = group[i]) {
            var inherit2 = get2(node, id0);
            schedule(node, name, id1, i, group, {
              time: inherit2.time + inherit2.delay + inherit2.duration,
              delay: 0,
              duration: inherit2.duration,
              ease: inherit2.ease
            });
          }
        }
      }
      return new Transition(groups, this._parents, name, id1);
    }
    function transition_end() {
      var on0, on1, that = this, id2 = that._id, size = that.size();
      return new Promise(function(resolve, reject) {
        var cancel = { value: reject }, end = { value: function() {
          if (--size === 0) resolve();
        } };
        that.each(function() {
          var schedule2 = set2(this, id2), on = schedule2.on;
          if (on !== on0) {
            on1 = (on0 = on).copy();
            on1._.cancel.push(cancel);
            on1._.interrupt.push(cancel);
            on1._.end.push(end);
          }
          schedule2.on = on1;
        });
        if (size === 0) resolve();
      });
    }
    var id = 0;
    function Transition(groups, parents, name, id2) {
      this._groups = groups;
      this._parents = parents;
      this._name = name;
      this._id = id2;
    }
    function transition(name) {
      return selection().transition(name);
    }
    function newId() {
      return ++id;
    }
    var selection_prototype = selection.prototype;
    Transition.prototype = transition.prototype = {
      constructor: Transition,
      select: transition_select,
      selectAll: transition_selectAll,
      selectChild: selection_prototype.selectChild,
      selectChildren: selection_prototype.selectChildren,
      filter: transition_filter,
      merge: transition_merge,
      selection: transition_selection,
      transition: transition_transition,
      call: selection_prototype.call,
      nodes: selection_prototype.nodes,
      node: selection_prototype.node,
      size: selection_prototype.size,
      empty: selection_prototype.empty,
      each: selection_prototype.each,
      on: transition_on,
      attr: transition_attr,
      attrTween: transition_attrTween,
      style: transition_style,
      styleTween: transition_styleTween,
      text: transition_text,
      textTween: transition_textTween,
      remove: transition_remove,
      tween: transition_tween,
      delay: transition_delay,
      duration: transition_duration,
      ease: transition_ease,
      easeVarying: transition_easeVarying,
      end: transition_end,
      [Symbol.iterator]: selection_prototype[Symbol.iterator]
    };
    var defaultTiming = {
      time: null,
      // Set on use.
      delay: 0,
      duration: 250,
      ease: cubicInOut
    };
    function inherit(node, id2) {
      var timing;
      while (!(timing = node.__transition) || !(timing = timing[id2])) {
        if (!(node = node.parentNode)) {
          throw new Error(`transition ${id2} not found`);
        }
      }
      return timing;
    }
    function selection_transition(name) {
      var id2, timing;
      if (name instanceof Transition) {
        id2 = name._id, name = name._name;
      } else {
        id2 = newId(), (timing = defaultTiming).time = now(), name = name == null ? null : name + "";
      }
      for (var groups = this._groups, m = groups.length, j = 0; j < m; ++j) {
        for (var group = groups[j], n = group.length, node, i = 0; i < n; ++i) {
          if (node = group[i]) {
            schedule(node, name, id2, i, group, timing || inherit(node, id2));
          }
        }
      }
      return new Transition(groups, this._parents, name, id2);
    }
    selection.prototype.interrupt = selection_interrupt;
    selection.prototype.transition = selection_transition;

    // node_modules/.pnpm/d3-zoom@3.0.1/node_modules/d3-zoom/dist/d3-zoom.mjs
    var constant4 = (x) => () => x;
    function ZoomEvent(type, {
      sourceEvent: sourceEvent2,
      target,
      transform: transform2,
      dispatch: dispatch2
    }) {
      Object.defineProperties(this, {
        type: { value: type, enumerable: true, configurable: true },
        sourceEvent: { value: sourceEvent2, enumerable: true, configurable: true },
        target: { value: target, enumerable: true, configurable: true },
        transform: { value: transform2, enumerable: true, configurable: true },
        _: { value: dispatch2 }
      });
    }
    function Transform(k, x, y) {
      this.k = k;
      this.x = x;
      this.y = y;
    }
    Transform.prototype = {
      constructor: Transform,
      scale: function(k) {
        return k === 1 ? this : new Transform(this.k * k, this.x, this.y);
      },
      translate: function(x, y) {
        return x === 0 & y === 0 ? this : new Transform(this.k, this.x + this.k * x, this.y + this.k * y);
      },
      apply: function(point) {
        return [point[0] * this.k + this.x, point[1] * this.k + this.y];
      },
      applyX: function(x) {
        return x * this.k + this.x;
      },
      applyY: function(y) {
        return y * this.k + this.y;
      },
      invert: function(location) {
        return [(location[0] - this.x) / this.k, (location[1] - this.y) / this.k];
      },
      invertX: function(x) {
        return (x - this.x) / this.k;
      },
      invertY: function(y) {
        return (y - this.y) / this.k;
      },
      rescaleX: function(x) {
        return x.copy().domain(x.range().map(this.invertX, this).map(x.invert, x));
      },
      rescaleY: function(y) {
        return y.copy().domain(y.range().map(this.invertY, this).map(y.invert, y));
      },
      toString: function() {
        return "translate(" + this.x + "," + this.y + ") scale(" + this.k + ")";
      }
    };
    var identity2 = new Transform(1, 0, 0);
    transform.prototype = Transform.prototype;
    function transform(node) {
      while (!node.__zoom) if (!(node = node.parentNode)) return identity2;
      return node.__zoom;
    }
    function nopropagation2(event) {
      event.stopImmediatePropagation();
    }
    function noevent2(event) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    function defaultFilter2(event) {
      return (!event.ctrlKey || event.type === "wheel") && !event.button;
    }
    function defaultExtent() {
      var e = this;
      if (e instanceof SVGElement) {
        e = e.ownerSVGElement || e;
        if (e.hasAttribute("viewBox")) {
          e = e.viewBox.baseVal;
          return [[e.x, e.y], [e.x + e.width, e.y + e.height]];
        }
        return [[0, 0], [e.width.baseVal.value, e.height.baseVal.value]];
      }
      return [[0, 0], [e.clientWidth, e.clientHeight]];
    }
    function defaultTransform() {
      return this.__zoom || identity2;
    }
    function defaultWheelDelta(event) {
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * (event.ctrlKey ? 10 : 1);
    }
    function defaultTouchable2() {
      return navigator.maxTouchPoints || "ontouchstart" in this;
    }
    function defaultConstrain(transform2, extent, translateExtent) {
      var dx0 = transform2.invertX(extent[0][0]) - translateExtent[0][0], dx1 = transform2.invertX(extent[1][0]) - translateExtent[1][0], dy0 = transform2.invertY(extent[0][1]) - translateExtent[0][1], dy1 = transform2.invertY(extent[1][1]) - translateExtent[1][1];
      return transform2.translate(
        dx1 > dx0 ? (dx0 + dx1) / 2 : Math.min(0, dx0) || Math.max(0, dx1),
        dy1 > dy0 ? (dy0 + dy1) / 2 : Math.min(0, dy0) || Math.max(0, dy1)
      );
    }
    function zoom2() {
      var filter2 = defaultFilter2, extent = defaultExtent, constrain = defaultConstrain, wheelDelta2 = defaultWheelDelta, touchable = defaultTouchable2, scaleExtent = [0, Infinity], translateExtent = [[-Infinity, -Infinity], [Infinity, Infinity]], duration = 250, interpolate2 = zoom, listeners = dispatch("start", "zoom", "end"), touchstarting, touchfirst, touchending, touchDelay = 500, wheelDelay = 150, clickDistance2 = 0, tapDistance = 10;
      function zoom3(selection2) {
        selection2.property("__zoom", defaultTransform).on("wheel.zoom", wheeled, { passive: false }).on("mousedown.zoom", mousedowned).on("dblclick.zoom", dblclicked).filter(touchable).on("touchstart.zoom", touchstarted).on("touchmove.zoom", touchmoved).on("touchend.zoom touchcancel.zoom", touchended).style("-webkit-tap-highlight-color", "rgba(0,0,0,0)");
      }
      zoom3.transform = function(collection, transform2, point, event) {
        var selection2 = collection.selection ? collection.selection() : collection;
        selection2.property("__zoom", defaultTransform);
        if (collection !== selection2) {
          schedule2(collection, transform2, point, event);
        } else {
          selection2.interrupt().each(function() {
            gesture(this, arguments).event(event).start().zoom(null, typeof transform2 === "function" ? transform2.apply(this, arguments) : transform2).end();
          });
        }
      };
      zoom3.scaleBy = function(selection2, k, p, event) {
        zoom3.scaleTo(selection2, function() {
          var k0 = this.__zoom.k, k1 = typeof k === "function" ? k.apply(this, arguments) : k;
          return k0 * k1;
        }, p, event);
      };
      zoom3.scaleTo = function(selection2, k, p, event) {
        zoom3.transform(selection2, function() {
          var e = extent.apply(this, arguments), t02 = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p, p1 = t02.invert(p0), k1 = typeof k === "function" ? k.apply(this, arguments) : k;
          return constrain(translate(scale(t02, k1), p0, p1), e, translateExtent);
        }, p, event);
      };
      zoom3.translateBy = function(selection2, x, y, event) {
        zoom3.transform(selection2, function() {
          return constrain(this.__zoom.translate(
            typeof x === "function" ? x.apply(this, arguments) : x,
            typeof y === "function" ? y.apply(this, arguments) : y
          ), extent.apply(this, arguments), translateExtent);
        }, null, event);
      };
      zoom3.translateTo = function(selection2, x, y, p, event) {
        zoom3.transform(selection2, function() {
          var e = extent.apply(this, arguments), t = this.__zoom, p0 = p == null ? centroid(e) : typeof p === "function" ? p.apply(this, arguments) : p;
          return constrain(identity2.translate(p0[0], p0[1]).scale(t.k).translate(
            typeof x === "function" ? -x.apply(this, arguments) : -x,
            typeof y === "function" ? -y.apply(this, arguments) : -y
          ), e, translateExtent);
        }, p, event);
      };
      function scale(transform2, k) {
        k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], k));
        return k === transform2.k ? transform2 : new Transform(k, transform2.x, transform2.y);
      }
      function translate(transform2, p0, p1) {
        var x = p0[0] - p1[0] * transform2.k, y = p0[1] - p1[1] * transform2.k;
        return x === transform2.x && y === transform2.y ? transform2 : new Transform(transform2.k, x, y);
      }
      function centroid(extent2) {
        return [(+extent2[0][0] + +extent2[1][0]) / 2, (+extent2[0][1] + +extent2[1][1]) / 2];
      }
      function schedule2(transition2, transform2, point, event) {
        transition2.on("start.zoom", function() {
          gesture(this, arguments).event(event).start();
        }).on("interrupt.zoom end.zoom", function() {
          gesture(this, arguments).event(event).end();
        }).tween("zoom", function() {
          var that = this, args = arguments, g = gesture(that, args).event(event), e = extent.apply(that, args), p = point == null ? centroid(e) : typeof point === "function" ? point.apply(that, args) : point, w = Math.max(e[1][0] - e[0][0], e[1][1] - e[0][1]), a = that.__zoom, b = typeof transform2 === "function" ? transform2.apply(that, args) : transform2, i = interpolate2(a.invert(p).concat(w / a.k), b.invert(p).concat(w / b.k));
          return function(t) {
            if (t === 1) t = b;
            else {
              var l = i(t), k = w / l[2];
              t = new Transform(k, p[0] - l[0] * k, p[1] - l[1] * k);
            }
            g.zoom(null, t);
          };
        });
      }
      function gesture(that, args, clean) {
        return !clean && that.__zooming || new Gesture(that, args);
      }
      function Gesture(that, args) {
        this.that = that;
        this.args = args;
        this.active = 0;
        this.sourceEvent = null;
        this.extent = extent.apply(that, args);
        this.taps = 0;
      }
      Gesture.prototype = {
        event: function(event) {
          if (event) this.sourceEvent = event;
          return this;
        },
        start: function() {
          if (++this.active === 1) {
            this.that.__zooming = this;
            this.emit("start");
          }
          return this;
        },
        zoom: function(key, transform2) {
          if (this.mouse && key !== "mouse") this.mouse[1] = transform2.invert(this.mouse[0]);
          if (this.touch0 && key !== "touch") this.touch0[1] = transform2.invert(this.touch0[0]);
          if (this.touch1 && key !== "touch") this.touch1[1] = transform2.invert(this.touch1[0]);
          this.that.__zoom = transform2;
          this.emit("zoom");
          return this;
        },
        end: function() {
          if (--this.active === 0) {
            delete this.that.__zooming;
            this.emit("end");
          }
          return this;
        },
        emit: function(type) {
          var d = select(this.that).datum();
          listeners.call(
            type,
            this.that,
            new ZoomEvent(type, {
              sourceEvent: this.sourceEvent,
              target: zoom3,
              transform: this.that.__zoom,
              dispatch: listeners
            }),
            d
          );
        }
      };
      function wheeled(event, ...args) {
        if (!filter2.apply(this, arguments)) return;
        var g = gesture(this, args).event(event), t = this.__zoom, k = Math.max(scaleExtent[0], Math.min(scaleExtent[1], t.k * Math.pow(2, wheelDelta2.apply(this, arguments)))), p = pointer(event);
        if (g.wheel) {
          if (g.mouse[0][0] !== p[0] || g.mouse[0][1] !== p[1]) {
            g.mouse[1] = t.invert(g.mouse[0] = p);
          }
          clearTimeout(g.wheel);
        } else if (t.k === k) return;
        else {
          g.mouse = [p, t.invert(p)];
          interrupt(this);
          g.start();
        }
        noevent2(event);
        g.wheel = setTimeout(wheelidled, wheelDelay);
        g.zoom("mouse", constrain(translate(scale(t, k), g.mouse[0], g.mouse[1]), g.extent, translateExtent));
        function wheelidled() {
          g.wheel = null;
          g.end();
        }
      }
      function mousedowned(event, ...args) {
        if (touchending || !filter2.apply(this, arguments)) return;
        var currentTarget2 = event.currentTarget, g = gesture(this, args, true).event(event), v = select(event.view).on("mousemove.zoom", mousemoved, true).on("mouseup.zoom", mouseupped, true), p = pointer(event, currentTarget2), x0 = event.clientX, y0 = event.clientY;
        nodrag(event.view);
        nopropagation2(event);
        g.mouse = [p, this.__zoom.invert(p)];
        interrupt(this);
        g.start();
        function mousemoved(event2) {
          noevent2(event2);
          if (!g.moved) {
            var dx = event2.clientX - x0, dy = event2.clientY - y0;
            g.moved = dx * dx + dy * dy > clickDistance2;
          }
          g.event(event2).zoom("mouse", constrain(translate(g.that.__zoom, g.mouse[0] = pointer(event2, currentTarget2), g.mouse[1]), g.extent, translateExtent));
        }
        function mouseupped(event2) {
          v.on("mousemove.zoom mouseup.zoom", null);
          yesdrag(event2.view, g.moved);
          noevent2(event2);
          g.event(event2).end();
        }
      }
      function dblclicked(event, ...args) {
        if (!filter2.apply(this, arguments)) return;
        var t02 = this.__zoom, p0 = pointer(event.changedTouches ? event.changedTouches[0] : event, this), p1 = t02.invert(p0), k1 = t02.k * (event.shiftKey ? 0.5 : 2), t12 = constrain(translate(scale(t02, k1), p0, p1), extent.apply(this, args), translateExtent);
        noevent2(event);
        if (duration > 0) select(this).transition().duration(duration).call(schedule2, t12, p0, event);
        else select(this).call(zoom3.transform, t12, p0, event);
      }
      function touchstarted(event, ...args) {
        if (!filter2.apply(this, arguments)) return;
        var touches = event.touches, n = touches.length, g = gesture(this, args, event.changedTouches.length === n).event(event), started, i, t, p;
        nopropagation2(event);
        for (i = 0; i < n; ++i) {
          t = touches[i], p = pointer(t, this);
          p = [p, this.__zoom.invert(p), t.identifier];
          if (!g.touch0) g.touch0 = p, started = true, g.taps = 1 + !!touchstarting;
          else if (!g.touch1 && g.touch0[2] !== p[2]) g.touch1 = p, g.taps = 0;
        }
        if (touchstarting) touchstarting = clearTimeout(touchstarting);
        if (started) {
          if (g.taps < 2) touchfirst = p[0], touchstarting = setTimeout(function() {
            touchstarting = null;
          }, touchDelay);
          interrupt(this);
          g.start();
        }
      }
      function touchmoved(event, ...args) {
        if (!this.__zooming) return;
        var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t, p, l;
        noevent2(event);
        for (i = 0; i < n; ++i) {
          t = touches[i], p = pointer(t, this);
          if (g.touch0 && g.touch0[2] === t.identifier) g.touch0[0] = p;
          else if (g.touch1 && g.touch1[2] === t.identifier) g.touch1[0] = p;
        }
        t = g.that.__zoom;
        if (g.touch1) {
          var p0 = g.touch0[0], l0 = g.touch0[1], p1 = g.touch1[0], l1 = g.touch1[1], dp = (dp = p1[0] - p0[0]) * dp + (dp = p1[1] - p0[1]) * dp, dl = (dl = l1[0] - l0[0]) * dl + (dl = l1[1] - l0[1]) * dl;
          t = scale(t, Math.sqrt(dp / dl));
          p = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
          l = [(l0[0] + l1[0]) / 2, (l0[1] + l1[1]) / 2];
        } else if (g.touch0) p = g.touch0[0], l = g.touch0[1];
        else return;
        g.zoom("touch", constrain(translate(t, p, l), g.extent, translateExtent));
      }
      function touchended(event, ...args) {
        if (!this.__zooming) return;
        var g = gesture(this, args).event(event), touches = event.changedTouches, n = touches.length, i, t;
        nopropagation2(event);
        if (touchending) clearTimeout(touchending);
        touchending = setTimeout(function() {
          touchending = null;
        }, touchDelay);
        for (i = 0; i < n; ++i) {
          t = touches[i];
          if (g.touch0 && g.touch0[2] === t.identifier) delete g.touch0;
          else if (g.touch1 && g.touch1[2] === t.identifier) delete g.touch1;
        }
        if (g.touch1 && !g.touch0) g.touch0 = g.touch1, delete g.touch1;
        if (g.touch0) g.touch0[1] = this.__zoom.invert(g.touch0[0]);
        else {
          g.end();
          if (g.taps === 2) {
            t = pointer(t, this);
            if (Math.hypot(touchfirst[0] - t[0], touchfirst[1] - t[1]) < tapDistance) {
              var p = select(this).on("dblclick.zoom");
              if (p) p.apply(this, arguments);
            }
          }
        }
      }
      zoom3.wheelDelta = function(_) {
        return arguments.length ? (wheelDelta2 = typeof _ === "function" ? _ : constant4(+_), zoom3) : wheelDelta2;
      };
      zoom3.filter = function(_) {
        return arguments.length ? (filter2 = typeof _ === "function" ? _ : constant4(!!_), zoom3) : filter2;
      };
      zoom3.touchable = function(_) {
        return arguments.length ? (touchable = typeof _ === "function" ? _ : constant4(!!_), zoom3) : touchable;
      };
      zoom3.extent = function(_) {
        return arguments.length ? (extent = typeof _ === "function" ? _ : constant4([[+_[0][0], +_[0][1]], [+_[1][0], +_[1][1]]]), zoom3) : extent;
      };
      zoom3.scaleExtent = function(_) {
        return arguments.length ? (scaleExtent[0] = +_[0], scaleExtent[1] = +_[1], zoom3) : [scaleExtent[0], scaleExtent[1]];
      };
      zoom3.translateExtent = function(_) {
        return arguments.length ? (translateExtent[0][0] = +_[0][0], translateExtent[1][0] = +_[1][0], translateExtent[0][1] = +_[0][1], translateExtent[1][1] = +_[1][1], zoom3) : [[translateExtent[0][0], translateExtent[0][1]], [translateExtent[1][0], translateExtent[1][1]]];
      };
      zoom3.constrain = function(_) {
        return arguments.length ? (constrain = _, zoom3) : constrain;
      };
      zoom3.duration = function(_) {
        return arguments.length ? (duration = +_, zoom3) : duration;
      };
      zoom3.interpolate = function(_) {
        return arguments.length ? (interpolate2 = _, zoom3) : interpolate2;
      };
      zoom3.on = function() {
        var value2 = listeners.on.apply(listeners, arguments);
        return value2 === listeners ? zoom3 : value2;
      };
      zoom3.clickDistance = function(_) {
        return arguments.length ? (clickDistance2 = (_ = +_) * _, zoom3) : Math.sqrt(clickDistance2);
      };
      zoom3.tapDistance = function(_) {
        return arguments.length ? (tapDistance = +_, zoom3) : tapDistance;
      };
      return zoom3;
    }

    // node_modules/.pnpm/@xyflow+system@0.0.84/node_modules/@xyflow/system/dist/esm/index.js
    var errorMessages = {
      error001: (lib = "react") => `Seems like you have not used ${lib === "svelte" ? "SvelteFlowProvider" : "ReactFlowProvider"} as an ancestor. Help: https://${lib}flow.dev/error#001`,
      error002: () => "It looks like you've created a new nodeTypes or edgeTypes object. If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component or memoize them.",
      error003: (nodeType) => `Node type "${nodeType}" not found. Using fallback type "default".`,
      error004: () => "The parent container needs a width and a height to render the graph.",
      error005: () => "Only child nodes can use a parent extent.",
      error006: () => "Can't create edge. An edge needs a source and a target.",
      error007: (id2) => `The old edge with id=${id2} does not exist.`,
      error009: (type) => `Marker type "${type}" doesn't exist.`,
      error008: (handleType, { id: id2, sourceHandle, targetHandle }) => `Couldn't create edge for ${handleType} handle id: "${handleType === "source" ? sourceHandle : targetHandle}", edge id: ${id2}.`,
      error010: () => "Handle: No node id found. Make sure to only use a Handle inside a custom Node.",
      error011: (edgeType) => `Edge type "${edgeType}" not found. Using fallback type "default".`,
      error012: (id2) => `Node with id "${id2}" does not exist, it may have been removed. This can happen when a node is deleted before the "onNodeClick" handler is called.`,
      error013: (lib = "react") => `It seems that you haven't loaded the styles. Please import '@xyflow/${lib}/dist/style.css' or base.css to make sure everything is working properly.`,
      error014: () => "useNodeConnections: No node ID found. Call useNodeConnections inside a custom Node or provide a node ID.",
      error015: () => "It seems that you are trying to drag a node that is not initialized. Please use onNodesChange as explained in the docs.",
      error016: (id2) => `Edge with id "${id2}" does not exist, it may have been removed. This can happen when an edge is deleted before the "onEdgeClick" handler is called.`
    };
    var infiniteExtent = [
      [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
    ];
    var elementSelectionKeys = ["Enter", " ", "Escape"];
    var defaultAriaLabelConfig = {
      "node.a11yDescription.default": "Press enter or space to select a node. Press delete to remove it and escape to cancel.",
      "node.a11yDescription.keyboardDisabled": "Press enter or space to select a node. You can then use the arrow keys to move the node around. Press delete to remove it and escape to cancel.",
      "node.a11yDescription.ariaLiveMessage": ({ direction, x, y }) => `Moved selected node ${direction}. New position, x: ${x}, y: ${y}`,
      "edge.a11yDescription.default": "Press enter or space to select an edge. You can then press delete to remove it or escape to cancel.",
      // Control elements
      "controls.ariaLabel": "Control Panel",
      "controls.zoomIn.ariaLabel": "Zoom In",
      "controls.zoomOut.ariaLabel": "Zoom Out",
      "controls.fitView.ariaLabel": "Fit View",
      "controls.interactive.ariaLabel": "Toggle Interactivity",
      // Mini map
      "minimap.ariaLabel": "Mini Map",
      // Handle
      "handle.ariaLabel": "Handle"
    };
    var ConnectionMode;
    (function(ConnectionMode2) {
      ConnectionMode2["Strict"] = "strict";
      ConnectionMode2["Loose"] = "loose";
    })(ConnectionMode || (ConnectionMode = {}));
    var PanOnScrollMode;
    (function(PanOnScrollMode2) {
      PanOnScrollMode2["Free"] = "free";
      PanOnScrollMode2["Vertical"] = "vertical";
      PanOnScrollMode2["Horizontal"] = "horizontal";
    })(PanOnScrollMode || (PanOnScrollMode = {}));
    var SelectionMode;
    (function(SelectionMode2) {
      SelectionMode2["Partial"] = "partial";
      SelectionMode2["Full"] = "full";
    })(SelectionMode || (SelectionMode = {}));
    var initialConnection = {
      inProgress: false,
      isValid: null,
      from: null,
      fromHandle: null,
      fromPosition: null,
      fromNode: null,
      to: null,
      toHandle: null,
      toPosition: null,
      toNode: null,
      pointer: null
    };
    var ConnectionLineType;
    (function(ConnectionLineType2) {
      ConnectionLineType2["Bezier"] = "default";
      ConnectionLineType2["Straight"] = "straight";
      ConnectionLineType2["Step"] = "step";
      ConnectionLineType2["SmoothStep"] = "smoothstep";
      ConnectionLineType2["SimpleBezier"] = "simplebezier";
    })(ConnectionLineType || (ConnectionLineType = {}));
    var MarkerType;
    (function(MarkerType2) {
      MarkerType2["Arrow"] = "arrow";
      MarkerType2["ArrowClosed"] = "arrowclosed";
    })(MarkerType || (MarkerType = {}));
    var Position;
    (function(Position2) {
      Position2["Left"] = "left";
      Position2["Top"] = "top";
      Position2["Right"] = "right";
      Position2["Bottom"] = "bottom";
    })(Position || (Position = {}));
    var oppositePosition = {
      [Position.Left]: Position.Right,
      [Position.Right]: Position.Left,
      [Position.Top]: Position.Bottom,
      [Position.Bottom]: Position.Top
    };
    var isEdgeBase = (element) => !!element && typeof element === "object" && "id" in element && "source" in element && "target" in element;
    var isNodeBase = (element) => !!element && typeof element === "object" && "id" in element && "position" in element && !("source" in element) && !("target" in element);
    var isInternalNodeBase = (element) => !!element && typeof element === "object" && "id" in element && "internals" in element && !("source" in element) && !("target" in element);
    var getNodePositionWithOrigin = (node, nodeOrigin = [0, 0]) => {
      const { width, height } = getNodeDimensions(node);
      const origin = node.origin ?? nodeOrigin;
      const offsetX = width * origin[0];
      const offsetY = height * origin[1];
      return {
        x: node.position.x - offsetX,
        y: node.position.y - offsetY
      };
    };
    var getNodesBounds = (nodes, params = { nodeOrigin: [0, 0] }) => {
      if (!params.nodeLookup) {
        console.warn("Please use `getNodesBounds` from `useReactFlow`/`useSvelteFlow` hook to ensure correct values for sub flows. If not possible, you have to provide a nodeLookup to support sub flows.");
      }
      if (nodes.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      let hasNode = false;
      const box = nodes.reduce((currBox, nodeOrId) => {
        const isId = typeof nodeOrId === "string";
        let currentNode = !params.nodeLookup && !isId ? nodeOrId : void 0;
        if (params.nodeLookup) {
          currentNode = isId ? params.nodeLookup.get(nodeOrId) : !isInternalNodeBase(nodeOrId) ? params.nodeLookup.get(nodeOrId.id) : nodeOrId;
        }
        if (!currentNode) {
          return currBox;
        }
        hasNode = true;
        return getBoundsOfBoxes(currBox, nodeToBox(currentNode, params.nodeOrigin));
      }, { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity });
      return hasNode ? boxToRect(box) : { x: 0, y: 0, width: 0, height: 0 };
    };
    var getInternalNodesBounds = (nodeLookup, params = {}) => {
      let box = { x: Infinity, y: Infinity, x2: -Infinity, y2: -Infinity };
      let hasVisibleNodes = false;
      nodeLookup.forEach((node) => {
        if (params.filter === void 0 || params.filter(node)) {
          box = getBoundsOfBoxes(box, nodeToBox(node));
          hasVisibleNodes = true;
        }
      });
      return hasVisibleNodes ? boxToRect(box) : { x: 0, y: 0, width: 0, height: 0 };
    };
    var getNodesInside = (nodes, rect, [tx, ty, tScale] = [0, 0, 1], partially = false, excludeNonSelectableNodes = false) => {
      const paneX = (rect.x - tx) / tScale;
      const paneY = (rect.y - ty) / tScale;
      const paneWidth = rect.width / tScale;
      const paneHeight = rect.height / tScale;
      const visibleNodes = [];
      for (const node of nodes.values()) {
        const { measured, selectable = true, hidden = false } = node;
        if (excludeNonSelectableNodes && !selectable || hidden) {
          continue;
        }
        const width = measured.width ?? node.width ?? node.initialWidth ?? 0;
        const height = measured.height ?? node.height ?? node.initialHeight ?? 0;
        const { x, y } = node.internals.positionAbsolute;
        const overlappingArea = getRectsOverlappingArea(paneX, paneY, paneWidth, paneHeight, x, y, width, height);
        const area = width * height;
        const partiallyVisible = partially && overlappingArea > 0;
        const forceInitialRender = !node.internals.handleBounds;
        const isVisible = forceInitialRender || partiallyVisible || overlappingArea >= area;
        if (isVisible || node.dragging) {
          visibleNodes.push(node);
        }
      }
      return visibleNodes;
    };
    var getConnectedEdges = (nodes, edges) => {
      const nodeIds = /* @__PURE__ */ new Set();
      nodes.forEach((node) => {
        nodeIds.add(node.id);
      });
      return edges.filter((edge2) => nodeIds.has(edge2.source) || nodeIds.has(edge2.target));
    };
    function getFitViewNodes(nodeLookup, options) {
      const fitViewNodes = /* @__PURE__ */ new Map();
      const optionNodeIds = options?.nodes ? new Set(options.nodes.map((node) => node.id)) : null;
      nodeLookup.forEach((n) => {
        let isVisible;
        if (options?.includeHiddenNodes) {
          const { width, height } = getNodeDimensions(n);
          isVisible = width > 0 && height > 0;
        } else {
          isVisible = Boolean(n.measured.width && n.measured.height && !n.hidden);
        }
        if (isVisible && (!optionNodeIds || optionNodeIds.has(n.id))) {
          fitViewNodes.set(n.id, n);
        }
      });
      return fitViewNodes;
    }
    async function fitViewport({ nodes, width, height, panZoom, minZoom, maxZoom }, options) {
      if (nodes.size === 0) {
        return true;
      }
      const nodesToFit = getFitViewNodes(nodes, options);
      const bounds = getInternalNodesBounds(nodesToFit);
      const viewport = getViewportForBounds(bounds, width, height, options?.minZoom ?? minZoom, options?.maxZoom ?? maxZoom, options?.padding ?? 0.1);
      await panZoom.setViewport(viewport, {
        duration: options?.duration,
        ease: options?.ease,
        interpolate: options?.interpolate
      });
      return true;
    }
    function calculateNodePosition({ nodeId, nextPosition, nodeLookup, nodeOrigin = [0, 0], nodeExtent, onError }) {
      const node = nodeLookup.get(nodeId);
      const parentNode = node.parentId ? nodeLookup.get(node.parentId) : void 0;
      const { x: parentX, y: parentY } = parentNode ? parentNode.internals.positionAbsolute : { x: 0, y: 0 };
      const origin = node.origin ?? nodeOrigin;
      let extent = node.extent || nodeExtent;
      if (node.extent === "parent" && !node.expandParent) {
        if (!parentNode) {
          onError?.("005", errorMessages["error005"]());
        } else {
          const { width: parentWidth, height: parentHeight } = getNodeDimensions(parentNode);
          if (parentWidth && parentHeight) {
            extent = [
              [parentX, parentY],
              [parentX + parentWidth, parentY + parentHeight]
            ];
          }
        }
      } else if (parentNode && isCoordinateExtent(node.extent)) {
        extent = [
          [node.extent[0][0] + parentX, node.extent[0][1] + parentY],
          [node.extent[1][0] + parentX, node.extent[1][1] + parentY]
        ];
      }
      const positionAbsolute = isCoordinateExtent(extent) ? clampPosition(nextPosition, extent, node.measured) : nextPosition;
      if (node.measured.width === void 0 || node.measured.height === void 0) {
        onError?.("015", errorMessages["error015"]());
      }
      return {
        position: {
          x: positionAbsolute.x - parentX + (node.measured.width ?? 0) * origin[0],
          y: positionAbsolute.y - parentY + (node.measured.height ?? 0) * origin[1]
        },
        positionAbsolute
      };
    }
    async function getElementsToRemove({ nodesToRemove = [], edgesToRemove = [], nodes, edges, onBeforeDelete }) {
      const nodeIds = new Set(nodesToRemove.map((node) => node.id));
      const matchingNodes = [];
      for (const node of nodes) {
        if (node.deletable === false) {
          continue;
        }
        const isIncluded = nodeIds.has(node.id);
        const parentHit = !isIncluded && node.parentId && matchingNodes.find((n) => n.id === node.parentId);
        if (isIncluded || parentHit) {
          matchingNodes.push(node);
        }
      }
      const edgeIds = new Set(edgesToRemove.map((edge2) => edge2.id));
      const deletableEdges = edges.filter((edge2) => edge2.deletable !== false);
      const connectedEdges = getConnectedEdges(matchingNodes, deletableEdges);
      const matchingEdges = connectedEdges;
      for (const edge2 of deletableEdges) {
        const isIncluded = edgeIds.has(edge2.id);
        if (isIncluded && !matchingEdges.find((e) => e.id === edge2.id)) {
          matchingEdges.push(edge2);
        }
      }
      if (!onBeforeDelete) {
        return {
          edges: matchingEdges,
          nodes: matchingNodes
        };
      }
      const onBeforeDeleteResult = await onBeforeDelete({
        nodes: matchingNodes,
        edges: matchingEdges
      });
      if (typeof onBeforeDeleteResult === "boolean") {
        return onBeforeDeleteResult ? { edges: matchingEdges, nodes: matchingNodes } : { edges: [], nodes: [] };
      }
      return onBeforeDeleteResult;
    }
    var clamp = (val, min = 0, max = 1) => Math.min(Math.max(val, min), max);
    var clampPosition = (position = { x: 0, y: 0 }, extent, dimensions) => ({
      x: clamp(position.x, extent[0][0], extent[1][0] - (dimensions?.width ?? 0)),
      y: clamp(position.y, extent[0][1], extent[1][1] - (dimensions?.height ?? 0))
    });
    function clampPositionToParent(childPosition, childDimensions, parent) {
      const { width: parentWidth, height: parentHeight } = getNodeDimensions(parent);
      const { x: parentX, y: parentY } = parent.internals.positionAbsolute;
      return clampPosition(childPosition, [
        [parentX, parentY],
        [parentX + parentWidth, parentY + parentHeight]
      ], childDimensions);
    }
    var calcAutoPanVelocity = (value2, min, max) => {
      if (value2 < min) {
        return clamp(Math.abs(value2 - min), 1, min) / min;
      } else if (value2 > max) {
        return -clamp(Math.abs(value2 - max), 1, min) / min;
      }
      return 0;
    };
    var calcAutoPan = (pos, bounds, speed = 15, distance2 = 40) => {
      const xMovement = calcAutoPanVelocity(pos.x, distance2, bounds.width - distance2) * speed;
      const yMovement = calcAutoPanVelocity(pos.y, distance2, bounds.height - distance2) * speed;
      return [xMovement, yMovement];
    };
    var getBoundsOfBoxes = (box1, box2) => ({
      x: Math.min(box1.x, box2.x),
      y: Math.min(box1.y, box2.y),
      x2: Math.max(box1.x2, box2.x2),
      y2: Math.max(box1.y2, box2.y2)
    });
    var rectToBox = ({ x, y, width, height }) => ({
      x,
      y,
      x2: x + width,
      y2: y + height
    });
    var boxToRect = ({ x, y, x2, y2 }) => ({
      x,
      y,
      width: x2 - x,
      height: y2 - y
    });
    var nodeToRect = (node, nodeOrigin = [0, 0]) => {
      const { x, y } = isInternalNodeBase(node) ? node.internals.positionAbsolute : getNodePositionWithOrigin(node, nodeOrigin);
      return {
        x,
        y,
        width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
        height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0
      };
    };
    var nodeToBox = (node, nodeOrigin = [0, 0]) => {
      const { x, y } = isInternalNodeBase(node) ? node.internals.positionAbsolute : getNodePositionWithOrigin(node, nodeOrigin);
      return {
        x,
        y,
        x2: x + (node.measured?.width ?? node.width ?? node.initialWidth ?? 0),
        y2: y + (node.measured?.height ?? node.height ?? node.initialHeight ?? 0)
      };
    };
    var getBoundsOfRects = (rect1, rect2) => boxToRect(getBoundsOfBoxes(rectToBox(rect1), rectToBox(rect2)));
    var getRectsOverlappingArea = (aX, aY, aWidth, aHeight, bX, bY, bWidth, bHeight) => {
      const xOverlap = Math.max(0, Math.min(aX + aWidth, bX + bWidth) - Math.max(aX, bX));
      const yOverlap = Math.max(0, Math.min(aY + aHeight, bY + bHeight) - Math.max(aY, bY));
      return Math.ceil(xOverlap * yOverlap);
    };
    var getOverlappingArea = (rectA, rectB) => getRectsOverlappingArea(rectA.x, rectA.y, rectA.width, rectA.height, rectB.x, rectB.y, rectB.width, rectB.height);
    var isRectObject = (obj) => isNumeric(obj.width) && isNumeric(obj.height) && isNumeric(obj.x) && isNumeric(obj.y);
    var isNumeric = (n) => !isNaN(n) && isFinite(n);
    var createDevWarn = (lib, helpUrl) => (id2, message) => {
      if (true) {
        console.warn(`[${lib}]: ${message} Help: ${helpUrl}error#${id2}`);
      }
    };
    var snapPosition = (position, snapGrid = [1, 1]) => {
      return {
        x: snapGrid[0] * Math.round(position.x / snapGrid[0]),
        y: snapGrid[1] * Math.round(position.y / snapGrid[1])
      };
    };
    var pointToRendererPoint = ({ x, y }, [tx, ty, tScale], snapToGrid = false, snapGrid = [1, 1]) => {
      const position = {
        x: (x - tx) / tScale,
        y: (y - ty) / tScale
      };
      return snapToGrid ? snapPosition(position, snapGrid) : position;
    };
    var rendererPointToPoint = ({ x, y }, [tx, ty, tScale]) => {
      return {
        x: x * tScale + tx,
        y: y * tScale + ty
      };
    };
    function parsePadding(padding, viewport) {
      if (typeof padding === "number") {
        return Math.floor((viewport - viewport / (1 + padding)) * 0.5);
      }
      if (typeof padding === "string" && padding.endsWith("px")) {
        const paddingValue = parseFloat(padding);
        if (!Number.isNaN(paddingValue)) {
          return Math.floor(paddingValue);
        }
      }
      if (typeof padding === "string" && padding.endsWith("%")) {
        const paddingValue = parseFloat(padding);
        if (!Number.isNaN(paddingValue)) {
          return Math.floor(viewport * paddingValue * 0.01);
        }
      }
      console.error(`The padding value "${padding}" is invalid. Please provide a number or a string with a valid unit (px or %).`);
      return 0;
    }
    function parsePaddings(padding, width, height) {
      if (typeof padding === "string" || typeof padding === "number") {
        const paddingY = parsePadding(padding, height);
        const paddingX = parsePadding(padding, width);
        return {
          top: paddingY,
          right: paddingX,
          bottom: paddingY,
          left: paddingX,
          x: paddingX * 2,
          y: paddingY * 2
        };
      }
      if (typeof padding === "object") {
        const top = parsePadding(padding.top ?? padding.y ?? 0, height);
        const bottom = parsePadding(padding.bottom ?? padding.y ?? 0, height);
        const left = parsePadding(padding.left ?? padding.x ?? 0, width);
        const right = parsePadding(padding.right ?? padding.x ?? 0, width);
        return { top, right, bottom, left, x: left + right, y: top + bottom };
      }
      return { top: 0, right: 0, bottom: 0, left: 0, x: 0, y: 0 };
    }
    function calculateAppliedPaddings(bounds, x, y, zoom3, width, height) {
      const { x: left, y: top } = rendererPointToPoint(bounds, [x, y, zoom3]);
      const { x: boundRight, y: boundBottom } = rendererPointToPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, [x, y, zoom3]);
      const right = width - boundRight;
      const bottom = height - boundBottom;
      return {
        left: Math.floor(left),
        top: Math.floor(top),
        right: Math.floor(right),
        bottom: Math.floor(bottom)
      };
    }
    var getViewportForBounds = (bounds, width, height, minZoom, maxZoom, padding) => {
      const p = parsePaddings(padding, width, height);
      const xZoom = (width - p.x) / bounds.width;
      const yZoom = (height - p.y) / bounds.height;
      const zoom3 = Math.min(xZoom, yZoom);
      const clampedZoom = clamp(zoom3, minZoom, maxZoom);
      const boundsCenterX = bounds.x + bounds.width / 2;
      const boundsCenterY = bounds.y + bounds.height / 2;
      const x = width / 2 - boundsCenterX * clampedZoom;
      const y = height / 2 - boundsCenterY * clampedZoom;
      const newPadding = calculateAppliedPaddings(bounds, x, y, clampedZoom, width, height);
      const offset = {
        left: Math.min(newPadding.left - p.left, 0),
        top: Math.min(newPadding.top - p.top, 0),
        right: Math.min(newPadding.right - p.right, 0),
        bottom: Math.min(newPadding.bottom - p.bottom, 0)
      };
      return {
        x: x - offset.left + offset.right,
        y: y - offset.top + offset.bottom,
        zoom: clampedZoom
      };
    };
    var isMacOs = () => typeof navigator !== "undefined" && navigator?.userAgent?.indexOf("Mac") >= 0;
    function isCoordinateExtent(extent) {
      return extent !== void 0 && extent !== null && extent !== "parent";
    }
    function getNodeDimensions(node) {
      return {
        width: node.measured?.width ?? node.width ?? node.initialWidth ?? 0,
        height: node.measured?.height ?? node.height ?? node.initialHeight ?? 0
      };
    }
    function nodeHasDimensions(node) {
      return (node.measured?.width ?? node.width ?? node.initialWidth) !== void 0 && (node.measured?.height ?? node.height ?? node.initialHeight) !== void 0;
    }
    function evaluateAbsolutePosition(position, dimensions = { width: 0, height: 0 }, parentId, nodeLookup, nodeOrigin) {
      const positionAbsolute = { ...position };
      const parent = nodeLookup.get(parentId);
      if (parent) {
        const origin = parent.origin || nodeOrigin;
        positionAbsolute.x += parent.internals.positionAbsolute.x - (dimensions.width ?? 0) * origin[0];
        positionAbsolute.y += parent.internals.positionAbsolute.y - (dimensions.height ?? 0) * origin[1];
      }
      return positionAbsolute;
    }
    function areSetsEqual(a, b) {
      if (a.size !== b.size) {
        return false;
      }
      for (const item of a) {
        if (!b.has(item)) {
          return false;
        }
      }
      return true;
    }
    function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }
    function mergeAriaLabelConfig(partial) {
      return { ...defaultAriaLabelConfig, ...partial || {} };
    }
    function isAttributionVisible(library) {
      if (typeof document === "undefined")
        return true;
      const pane = document.querySelector(`.${library}-flow__pane`);
      if (!pane || !pane.isConnected)
        return true;
      const paneStyle = getComputedStyle(pane);
      if (paneStyle.display === "none")
        return true;
      if (paneStyle.visibility === "hidden" || paneStyle.visibility === "collapse")
        return true;
      if (paneStyle.opacity === "0")
        return true;
      if (paneStyle.width === "0" && paneStyle.height === "0")
        return true;
      const paneRect = pane.getBoundingClientRect();
      if (paneRect.width === 0 && paneRect.height === 0)
        return true;
      const attr = document.querySelector(`.${library}-flow__attribution`);
      if (!attr || !attr.isConnected)
        return false;
      const style2 = getComputedStyle(attr);
      if (style2.display === "none")
        return false;
      if (style2.visibility === "hidden" || style2.visibility === "collapse")
        return false;
      if (style2.opacity === "0")
        return false;
      const rect = attr.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0)
        return false;
      return true;
    }
    var warningDisplayed = false;
    function handleAttributionWarning(library) {
      if (warningDisplayed || false) {
        return;
      }
      warningDisplayed = true;
      const framework = `${library.charAt(0).toUpperCase() + library.slice(1)} Flow`;
      setTimeout(() => {
        if (!isAttributionVisible(library)) {
          console.warn(`${framework}: It seems like you are hiding the attribution. Please only do this when you are subscribed to ${framework} Pro: https://${library}flow.dev/remove-attr
    %cYou can ignore this warning if you are subscribed.`, "font-style: italic;");
        }
      }, 1e3);
    }
    function getConnectionStatus(isValid) {
      return isValid === null ? null : isValid ? "valid" : "invalid";
    }
    function getPointerPosition(event, { snapGrid = [0, 0], snapToGrid = false, transform: transform2, containerBounds }) {
      const { x, y } = getEventPosition(event);
      const pointerPos = pointToRendererPoint({ x: x - (containerBounds?.left ?? 0), y: y - (containerBounds?.top ?? 0) }, transform2);
      const { x: xSnapped, y: ySnapped } = snapToGrid ? snapPosition(pointerPos, snapGrid) : pointerPos;
      return {
        xSnapped,
        ySnapped,
        ...pointerPos
      };
    }
    var getDimensions = (node) => ({
      width: node.offsetWidth,
      height: node.offsetHeight
    });
    var getHostForElement = (element) => element?.getRootNode?.() || window?.document;
    var inputTags = ["INPUT", "SELECT", "TEXTAREA"];
    function isInputDOMNode(event) {
      const target = event.composedPath?.()?.[0] || event.target;
      if (target?.nodeType !== 1)
        return false;
      const isInput = inputTags.includes(target.nodeName) || target.hasAttribute("contenteditable");
      return isInput || !!target.closest(".nokey");
    }
    var isMouseEvent = (event) => "clientX" in event;
    var getEventPosition = (event, bounds) => {
      const isMouse = isMouseEvent(event);
      const evtX = isMouse ? event.clientX : event.touches?.[0].clientX;
      const evtY = isMouse ? event.clientY : event.touches?.[0].clientY;
      return {
        x: evtX - (bounds?.left ?? 0),
        y: evtY - (bounds?.top ?? 0)
      };
    };
    var getHandleBounds = (type, nodeElement, nodeBounds, zoom3, nodeId) => {
      const handles = nodeElement.querySelectorAll(`.${type}`);
      if (!handles || !handles.length) {
        return null;
      }
      return Array.from(handles).map((handle) => {
        const handleBounds = handle.getBoundingClientRect();
        return {
          id: handle.getAttribute("data-handleid"),
          type,
          nodeId,
          position: handle.getAttribute("data-handlepos"),
          x: (handleBounds.left - nodeBounds.left) / zoom3,
          y: (handleBounds.top - nodeBounds.top) / zoom3,
          ...getDimensions(handle)
        };
      });
    };
    function getBezierEdgeCenter({ sourceX, sourceY, targetX, targetY, sourceControlX, sourceControlY, targetControlX, targetControlY }) {
      const centerX = sourceX * 0.125 + sourceControlX * 0.375 + targetControlX * 0.375 + targetX * 0.125;
      const centerY = sourceY * 0.125 + sourceControlY * 0.375 + targetControlY * 0.375 + targetY * 0.125;
      const offsetX = Math.abs(centerX - sourceX);
      const offsetY = Math.abs(centerY - sourceY);
      return [centerX, centerY, offsetX, offsetY];
    }
    function calculateControlOffset(distance2, curvature) {
      if (distance2 >= 0) {
        return 0.5 * distance2;
      }
      return curvature * 25 * Math.sqrt(-distance2);
    }
    function getControlWithCurvature({ pos, x1, y1, x2, y2, c }) {
      switch (pos) {
        case Position.Left:
          return [x1 - calculateControlOffset(x1 - x2, c), y1];
        case Position.Right:
          return [x1 + calculateControlOffset(x2 - x1, c), y1];
        case Position.Top:
          return [x1, y1 - calculateControlOffset(y1 - y2, c)];
        case Position.Bottom:
          return [x1, y1 + calculateControlOffset(y2 - y1, c)];
      }
    }
    function getBezierPath({ sourceX, sourceY, sourcePosition = Position.Bottom, targetX, targetY, targetPosition = Position.Top, curvature = 0.25 }) {
      const [sourceControlX, sourceControlY] = getControlWithCurvature({
        pos: sourcePosition,
        x1: sourceX,
        y1: sourceY,
        x2: targetX,
        y2: targetY,
        c: curvature
      });
      const [targetControlX, targetControlY] = getControlWithCurvature({
        pos: targetPosition,
        x1: targetX,
        y1: targetY,
        x2: sourceX,
        y2: sourceY,
        c: curvature
      });
      const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourceControlX,
        sourceControlY,
        targetControlX,
        targetControlY
      });
      return [
        `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
        labelX,
        labelY,
        offsetX,
        offsetY
      ];
    }
    function getEdgeCenter({ sourceX, sourceY, targetX, targetY }) {
      const xOffset = Math.abs(targetX - sourceX) / 2;
      const centerX = targetX < sourceX ? targetX + xOffset : targetX - xOffset;
      const yOffset = Math.abs(targetY - sourceY) / 2;
      const centerY = targetY < sourceY ? targetY + yOffset : targetY - yOffset;
      return [centerX, centerY, xOffset, yOffset];
    }
    function getElevatedEdgeZIndex({ sourceNode, targetNode, selected: selected2 = false, zIndex = 0, elevateOnSelect = false, zIndexMode = "basic" }) {
      if (zIndexMode === "manual") {
        return zIndex;
      }
      const edgeZ = elevateOnSelect && selected2 ? zIndex + 1e3 : zIndex;
      const nodeZ = Math.max(sourceNode.parentId || elevateOnSelect && sourceNode.selected ? sourceNode.internals.z : 0, targetNode.parentId || elevateOnSelect && targetNode.selected ? targetNode.internals.z : 0);
      return edgeZ + nodeZ;
    }
    function isEdgeVisible({ sourceNode, targetNode, width, height, transform: transform2 }) {
      const edgeBox = getBoundsOfBoxes(nodeToBox(sourceNode), nodeToBox(targetNode));
      if (edgeBox.x === edgeBox.x2) {
        edgeBox.x2 += 1;
      }
      if (edgeBox.y === edgeBox.y2) {
        edgeBox.y2 += 1;
      }
      const viewRect = {
        x: -transform2[0] / transform2[2],
        y: -transform2[1] / transform2[2],
        width: width / transform2[2],
        height: height / transform2[2]
      };
      return getOverlappingArea(viewRect, boxToRect(edgeBox)) > 0;
    }
    var getEdgeId = ({ source, sourceHandle, target, targetHandle }) => `xy-edge__${source}${sourceHandle || ""}-${target}${targetHandle || ""}`;
    var connectionExists = (edge2, edges) => {
      return edges.some((el) => el.source === edge2.source && el.target === edge2.target && (el.sourceHandle === edge2.sourceHandle || !el.sourceHandle && !edge2.sourceHandle) && (el.targetHandle === edge2.targetHandle || !el.targetHandle && !edge2.targetHandle));
    };
    var addEdge = (edgeParams, edges, options = {}) => {
      if (!edgeParams.source || !edgeParams.target) {
        options.onError?.("006", errorMessages["error006"]());
        return edges;
      }
      const edgeIdGenerator = options.getEdgeId || getEdgeId;
      let edge2;
      if (isEdgeBase(edgeParams)) {
        edge2 = { ...edgeParams };
      } else {
        edge2 = {
          ...edgeParams,
          id: edgeIdGenerator(edgeParams)
        };
      }
      if (connectionExists(edge2, edges)) {
        return edges;
      }
      if (edge2.sourceHandle === null) {
        delete edge2.sourceHandle;
      }
      if (edge2.targetHandle === null) {
        delete edge2.targetHandle;
      }
      return edges.concat(edge2);
    };
    function getStraightPath({ sourceX, sourceY, targetX, targetY }) {
      const [labelX, labelY, offsetX, offsetY] = getEdgeCenter({
        sourceX,
        sourceY,
        targetX,
        targetY
      });
      return [`M ${sourceX},${sourceY}L ${targetX},${targetY}`, labelX, labelY, offsetX, offsetY];
    }
    var handleDirections = {
      [Position.Left]: { x: -1, y: 0 },
      [Position.Right]: { x: 1, y: 0 },
      [Position.Top]: { x: 0, y: -1 },
      [Position.Bottom]: { x: 0, y: 1 }
    };
    var getDirection = ({ source, sourcePosition = Position.Bottom, target }) => {
      if (sourcePosition === Position.Left || sourcePosition === Position.Right) {
        return source.x < target.x ? { x: 1, y: 0 } : { x: -1, y: 0 };
      }
      return source.y < target.y ? { x: 0, y: 1 } : { x: 0, y: -1 };
    };
    var distance = (a, b) => Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
    var isBetween = (a, b, c) => a.x === b.x && b.x === c.x && (b.y - a.y) * (c.y - b.y) >= 0 || a.y === b.y && b.y === c.y && (b.x - a.x) * (c.x - b.x) >= 0;
    function getPoints({ source, sourcePosition = Position.Bottom, target, targetPosition = Position.Top, center, offset, stepPosition }) {
      const sourceDir = handleDirections[sourcePosition];
      const targetDir = handleDirections[targetPosition];
      const sourceGapped = { x: source.x + sourceDir.x * offset, y: source.y + sourceDir.y * offset };
      const targetGapped = { x: target.x + targetDir.x * offset, y: target.y + targetDir.y * offset };
      const dir = getDirection({
        source: sourceGapped,
        sourcePosition,
        target: targetGapped
      });
      const dirAccessor = dir.x !== 0 ? "x" : "y";
      const currDir = dir[dirAccessor];
      let points = [];
      let centerX, centerY;
      const sourceGapOffset = { x: 0, y: 0 };
      const targetGapOffset = { x: 0, y: 0 };
      const [, , defaultOffsetX, defaultOffsetY] = getEdgeCenter({
        sourceX: source.x,
        sourceY: source.y,
        targetX: target.x,
        targetY: target.y
      });
      if (sourceDir[dirAccessor] * targetDir[dirAccessor] === -1) {
        if (dirAccessor === "x") {
          centerX = center.x ?? sourceGapped.x + (targetGapped.x - sourceGapped.x) * stepPosition;
          centerY = center.y ?? (sourceGapped.y + targetGapped.y) / 2;
        } else {
          centerX = center.x ?? (sourceGapped.x + targetGapped.x) / 2;
          centerY = center.y ?? sourceGapped.y + (targetGapped.y - sourceGapped.y) * stepPosition;
        }
        const verticalSplit = [
          { x: centerX, y: sourceGapped.y },
          { x: centerX, y: targetGapped.y }
        ];
        const horizontalSplit = [
          { x: sourceGapped.x, y: centerY },
          { x: targetGapped.x, y: centerY }
        ];
        if (sourceDir[dirAccessor] === currDir) {
          points = dirAccessor === "x" ? verticalSplit : horizontalSplit;
        } else {
          points = dirAccessor === "x" ? horizontalSplit : verticalSplit;
        }
      } else {
        const sourceTarget = [{ x: sourceGapped.x, y: targetGapped.y }];
        const targetSource = [{ x: targetGapped.x, y: sourceGapped.y }];
        if (dirAccessor === "x") {
          points = sourceDir.x === currDir ? targetSource : sourceTarget;
        } else {
          points = sourceDir.y === currDir ? sourceTarget : targetSource;
        }
        if (sourcePosition === targetPosition) {
          const diff = Math.abs(source[dirAccessor] - target[dirAccessor]);
          if (diff <= offset) {
            const gapOffset = Math.min(offset - 1, offset - diff);
            if (sourceDir[dirAccessor] === currDir) {
              sourceGapOffset[dirAccessor] = (sourceGapped[dirAccessor] > source[dirAccessor] ? -1 : 1) * gapOffset;
            } else {
              targetGapOffset[dirAccessor] = (targetGapped[dirAccessor] > target[dirAccessor] ? -1 : 1) * gapOffset;
            }
          }
        }
        if (sourcePosition !== targetPosition) {
          const dirAccessorOpposite = dirAccessor === "x" ? "y" : "x";
          const isSameDir = sourceDir[dirAccessor] === targetDir[dirAccessorOpposite];
          const sourceGtTargetOppo = sourceGapped[dirAccessorOpposite] > targetGapped[dirAccessorOpposite];
          const sourceLtTargetOppo = sourceGapped[dirAccessorOpposite] < targetGapped[dirAccessorOpposite];
          const flipSourceTarget = sourceDir[dirAccessor] === 1 && (!isSameDir && sourceGtTargetOppo || isSameDir && sourceLtTargetOppo) || sourceDir[dirAccessor] !== 1 && (!isSameDir && sourceLtTargetOppo || isSameDir && sourceGtTargetOppo);
          if (flipSourceTarget) {
            points = dirAccessor === "x" ? sourceTarget : targetSource;
          }
        }
        const sourceGapPoint = { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y };
        const targetGapPoint = { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y };
        const maxXDistance = Math.max(Math.abs(sourceGapPoint.x - points[0].x), Math.abs(targetGapPoint.x - points[0].x));
        const maxYDistance = Math.max(Math.abs(sourceGapPoint.y - points[0].y), Math.abs(targetGapPoint.y - points[0].y));
        if (maxXDistance >= maxYDistance) {
          centerX = (sourceGapPoint.x + targetGapPoint.x) / 2;
          centerY = points[0].y;
        } else {
          centerX = points[0].x;
          centerY = (sourceGapPoint.y + targetGapPoint.y) / 2;
        }
      }
      const gappedSource = { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y };
      const gappedTarget = { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y };
      const pathPoints = [];
      for (const point of [source, gappedSource, ...points, gappedTarget, target]) {
        const [a, b] = pathPoints.slice(-2);
        if (b && isBetween(a, b, point)) {
          pathPoints.pop();
        }
        pathPoints.push(point);
      }
      return [pathPoints, centerX, centerY, defaultOffsetX, defaultOffsetY];
    }
    function getBend(a, b, c, size) {
      const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, size);
      const { x, y } = b;
      if (a.x === x && x === c.x || a.y === y && y === c.y) {
        return `L${x} ${y}`;
      }
      if (a.y === y) {
        const xDir2 = a.x < c.x ? -1 : 1;
        const yDir2 = a.y < c.y ? 1 : -1;
        return `L ${x + bendSize * xDir2},${y}Q ${x},${y} ${x},${y + bendSize * yDir2}`;
      }
      const xDir = a.x < c.x ? 1 : -1;
      const yDir = a.y < c.y ? -1 : 1;
      return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`;
    }
    function getSmoothStepPath({ sourceX, sourceY, sourcePosition = Position.Bottom, targetX, targetY, targetPosition = Position.Top, borderRadius = 5, centerX, centerY, offset = 20, stepPosition = 0.5 }) {
      const [points, labelX, labelY, offsetX, offsetY] = getPoints({
        source: { x: sourceX, y: sourceY },
        sourcePosition,
        target: { x: targetX, y: targetY },
        targetPosition,
        center: { x: centerX, y: centerY },
        offset,
        stepPosition
      });
      let path = `M${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length - 1; i++) {
        path += getBend(points[i - 1], points[i], points[i + 1], borderRadius);
      }
      path += `L${points[points.length - 1].x} ${points[points.length - 1].y}`;
      return [path, labelX, labelY, offsetX, offsetY];
    }
    function isNodeInitialized(node) {
      return node && !!(node.internals.handleBounds || node.handles?.length) && !!(node.measured.width || node.width || node.initialWidth);
    }
    function getEdgePosition(params) {
      const { sourceNode, targetNode } = params;
      if (!isNodeInitialized(sourceNode) || !isNodeInitialized(targetNode)) {
        return null;
      }
      const sourceHandleBounds = sourceNode.internals.handleBounds || toHandleBounds(sourceNode.handles);
      const targetHandleBounds = targetNode.internals.handleBounds || toHandleBounds(targetNode.handles);
      const sourceHandle = getHandle$1(sourceHandleBounds?.source ?? [], params.sourceHandle);
      const targetHandle = getHandle$1(
        // when connection type is loose we can define all handles as sources and connect source -> source
        params.connectionMode === ConnectionMode.Strict ? targetHandleBounds?.target ?? [] : (targetHandleBounds?.target ?? []).concat(targetHandleBounds?.source ?? []),
        params.targetHandle
      );
      if (!sourceHandle || !targetHandle) {
        params.onError?.("008", errorMessages["error008"](!sourceHandle ? "source" : "target", {
          id: params.id,
          sourceHandle: params.sourceHandle,
          targetHandle: params.targetHandle
        }));
        return null;
      }
      const sourcePosition = sourceHandle?.position || Position.Bottom;
      const targetPosition = targetHandle?.position || Position.Top;
      const source = getHandlePosition(sourceNode, sourceHandle, sourcePosition);
      const target = getHandlePosition(targetNode, targetHandle, targetPosition);
      return {
        sourceX: source.x,
        sourceY: source.y,
        targetX: target.x,
        targetY: target.y,
        sourcePosition,
        targetPosition
      };
    }
    function toHandleBounds(handles) {
      if (!handles) {
        return null;
      }
      const source = [];
      const target = [];
      for (const handle of handles) {
        handle.width = handle.width ?? 1;
        handle.height = handle.height ?? 1;
        if (handle.type === "source") {
          source.push(handle);
        } else if (handle.type === "target") {
          target.push(handle);
        }
      }
      return {
        source,
        target
      };
    }
    function getHandlePosition(node, handle, fallbackPosition = Position.Left, center = false) {
      const x = (handle?.x ?? 0) + node.internals.positionAbsolute.x;
      const y = (handle?.y ?? 0) + node.internals.positionAbsolute.y;
      const { width, height } = handle ?? getNodeDimensions(node);
      if (center) {
        return { x: x + width / 2, y: y + height / 2 };
      }
      const position = handle?.position ?? fallbackPosition;
      switch (position) {
        case Position.Top:
          return { x: x + width / 2, y };
        case Position.Right:
          return { x: x + width, y: y + height / 2 };
        case Position.Bottom:
          return { x: x + width / 2, y: y + height };
        case Position.Left:
          return { x, y: y + height / 2 };
      }
    }
    function getHandle$1(bounds, handleId) {
      if (!bounds) {
        return null;
      }
      return (!handleId ? bounds[0] : bounds.find((d) => d.id === handleId)) || null;
    }
    function getMarkerId(marker, id2) {
      if (!marker) {
        return "";
      }
      if (typeof marker === "string") {
        return marker;
      }
      const idPrefix = id2 ? `${id2}__` : "";
      return `${idPrefix}${Object.keys(marker).sort().map((key) => `${key}=${marker[key]}`).join("&")}`;
    }
    function createMarkerIds(edges, { id: id2, defaultColor, defaultMarkerStart, defaultMarkerEnd }) {
      const ids = /* @__PURE__ */ new Set();
      return edges.reduce((markers, edge2) => {
        [edge2.markerStart || defaultMarkerStart, edge2.markerEnd || defaultMarkerEnd].forEach((marker) => {
          if (marker && typeof marker === "object") {
            const markerId = getMarkerId(marker, id2);
            if (!ids.has(markerId)) {
              markers.push({ id: markerId, color: marker.color || defaultColor, ...marker });
              ids.add(markerId);
            }
          }
        });
        return markers;
      }, []).sort((a, b) => a.id.localeCompare(b.id));
    }
    var SELECTED_NODE_Z = 1e3;
    var ROOT_PARENT_Z_INCREMENT = 10;
    var defaultOptions = {
      nodeOrigin: [0, 0],
      nodeExtent: infiniteExtent,
      elevateNodesOnSelect: true,
      zIndexMode: "basic",
      defaults: {}
    };
    var adoptUserNodesDefaultOptions = {
      ...defaultOptions,
      checkEquality: true
    };
    function mergeObjects(base, incoming) {
      const result = { ...base };
      for (const key in incoming) {
        if (incoming[key] !== void 0) {
          result[key] = incoming[key];
        }
      }
      return result;
    }
    function updateAbsolutePositions(nodeLookup, parentLookup, options) {
      const _options = mergeObjects(defaultOptions, options);
      for (const node of nodeLookup.values()) {
        if (node.parentId) {
          updateChildNode(node, nodeLookup, parentLookup, _options);
        } else {
          const positionWithOrigin = getNodePositionWithOrigin(node, _options.nodeOrigin);
          const extent = isCoordinateExtent(node.extent) ? node.extent : _options.nodeExtent;
          const clampedPosition = clampPosition(positionWithOrigin, extent, getNodeDimensions(node));
          node.internals.positionAbsolute = clampedPosition;
        }
      }
    }
    function parseHandles(userNode, internalNode) {
      if (!userNode.handles) {
        return !userNode.measured ? void 0 : internalNode?.internals.handleBounds;
      }
      const source = [];
      const target = [];
      for (const handle of userNode.handles) {
        const handleBounds = {
          id: handle.id,
          width: handle.width ?? 1,
          height: handle.height ?? 1,
          nodeId: userNode.id,
          x: handle.x,
          y: handle.y,
          position: handle.position,
          type: handle.type
        };
        if (handle.type === "source") {
          source.push(handleBounds);
        } else if (handle.type === "target") {
          target.push(handleBounds);
        }
      }
      return {
        source,
        target
      };
    }
    function isManualZIndexMode(zIndexMode) {
      return zIndexMode === "manual";
    }
    function adoptUserNodes(nodes, nodeLookup, parentLookup, options = {}) {
      const _options = mergeObjects(adoptUserNodesDefaultOptions, options);
      const rootParentIndex = { i: 0 };
      const tmpLookup = new Map(nodeLookup);
      const selectedNodeZ = _options?.elevateNodesOnSelect && !isManualZIndexMode(_options.zIndexMode) ? SELECTED_NODE_Z : 0;
      let nodesInitialized = nodes.length > 0;
      let hasSelectedNodes = false;
      nodeLookup.clear();
      parentLookup.clear();
      for (const userNode of nodes) {
        let internalNode = tmpLookup.get(userNode.id);
        if (_options.checkEquality && userNode === internalNode?.internals.userNode) {
          nodeLookup.set(userNode.id, internalNode);
        } else {
          const positionWithOrigin = getNodePositionWithOrigin(userNode, _options.nodeOrigin);
          const extent = isCoordinateExtent(userNode.extent) ? userNode.extent : _options.nodeExtent;
          const clampedPosition = clampPosition(positionWithOrigin, extent, getNodeDimensions(userNode));
          internalNode = {
            ..._options.defaults,
            ...userNode,
            measured: {
              width: userNode.measured?.width,
              height: userNode.measured?.height
            },
            internals: {
              positionAbsolute: clampedPosition,
              // if user re-initializes the node or removes `measured` for whatever reason, we reset the handleBounds so that the node gets re-measured
              handleBounds: parseHandles(userNode, internalNode),
              z: calculateZ(userNode, selectedNodeZ, _options.zIndexMode),
              userNode
            }
          };
          nodeLookup.set(userNode.id, internalNode);
        }
        if ((internalNode.measured === void 0 || internalNode.measured.width === void 0 || internalNode.measured.height === void 0) && !internalNode.hidden) {
          nodesInitialized = false;
        }
        if (userNode.parentId) {
          updateChildNode(internalNode, nodeLookup, parentLookup, options, rootParentIndex);
        }
        hasSelectedNodes ||= userNode.selected ?? false;
      }
      return { nodesInitialized, hasSelectedNodes };
    }
    function updateParentLookup(node, parentLookup) {
      if (!node.parentId) {
        return;
      }
      const childNodes = parentLookup.get(node.parentId);
      if (childNodes) {
        childNodes.set(node.id, node);
      } else {
        parentLookup.set(node.parentId, /* @__PURE__ */ new Map([[node.id, node]]));
      }
    }
    function updateChildNode(node, nodeLookup, parentLookup, options, rootParentIndex) {
      const { elevateNodesOnSelect, nodeOrigin, nodeExtent, zIndexMode } = mergeObjects(defaultOptions, options);
      const parentId = node.parentId;
      const parentNode = nodeLookup.get(parentId);
      if (!parentNode) {
        console.warn(`Parent node ${parentId} not found. Please make sure that parent nodes are in front of their child nodes in the nodes array.`);
        return;
      }
      updateParentLookup(node, parentLookup);
      if (rootParentIndex && !parentNode.parentId && parentNode.internals.rootParentIndex === void 0 && zIndexMode === "auto") {
        parentNode.internals.rootParentIndex = ++rootParentIndex.i;
        parentNode.internals.z = parentNode.internals.z + rootParentIndex.i * ROOT_PARENT_Z_INCREMENT;
      }
      if (rootParentIndex && parentNode.internals.rootParentIndex !== void 0) {
        rootParentIndex.i = parentNode.internals.rootParentIndex;
      }
      const selectedNodeZ = elevateNodesOnSelect && !isManualZIndexMode(zIndexMode) ? SELECTED_NODE_Z : 0;
      const { x, y, z } = calculateChildXYZ(node, parentNode, nodeOrigin, nodeExtent, selectedNodeZ, zIndexMode);
      const { positionAbsolute } = node.internals;
      const positionChanged = x !== positionAbsolute.x || y !== positionAbsolute.y;
      if (positionChanged || z !== node.internals.z) {
        nodeLookup.set(node.id, {
          ...node,
          internals: {
            ...node.internals,
            positionAbsolute: positionChanged ? { x, y } : positionAbsolute,
            z
          }
        });
      }
    }
    function calculateZ(node, selectedNodeZ, zIndexMode) {
      const zIndex = isNumeric(node.zIndex) ? node.zIndex : 0;
      if (isManualZIndexMode(zIndexMode)) {
        return zIndex;
      }
      return zIndex + (node.selected ? selectedNodeZ : 0);
    }
    function calculateChildXYZ(childNode, parentNode, nodeOrigin, nodeExtent, selectedNodeZ, zIndexMode) {
      const { x: parentX, y: parentY } = parentNode.internals.positionAbsolute;
      const childDimensions = getNodeDimensions(childNode);
      const positionWithOrigin = getNodePositionWithOrigin(childNode, nodeOrigin);
      const clampedPosition = isCoordinateExtent(childNode.extent) ? clampPosition(positionWithOrigin, childNode.extent, childDimensions) : positionWithOrigin;
      let absolutePosition = clampPosition({ x: parentX + clampedPosition.x, y: parentY + clampedPosition.y }, nodeExtent, childDimensions);
      if (childNode.extent === "parent") {
        absolutePosition = clampPositionToParent(absolutePosition, childDimensions, parentNode);
      }
      const childZ = calculateZ(childNode, selectedNodeZ, zIndexMode);
      const parentZ = parentNode.internals.z ?? 0;
      return {
        x: absolutePosition.x,
        y: absolutePosition.y,
        z: parentZ >= childZ ? parentZ + 1 : childZ
      };
    }
    function handleExpandParent(children2, nodeLookup, parentLookup, nodeOrigin = [0, 0]) {
      const changes = [];
      const parentExpansions = /* @__PURE__ */ new Map();
      for (const child of children2) {
        const parent = nodeLookup.get(child.parentId);
        if (!parent) {
          continue;
        }
        const parentRect = parentExpansions.get(child.parentId)?.expandedRect ?? nodeToRect(parent);
        const expandedRect = getBoundsOfRects(parentRect, child.rect);
        parentExpansions.set(child.parentId, { expandedRect, parent });
      }
      if (parentExpansions.size > 0) {
        parentExpansions.forEach(({ expandedRect, parent }, parentId) => {
          const positionAbsolute = parent.internals.positionAbsolute;
          const dimensions = getNodeDimensions(parent);
          const origin = parent.origin ?? nodeOrigin;
          const xChange = expandedRect.x < positionAbsolute.x ? Math.round(Math.abs(positionAbsolute.x - expandedRect.x)) : 0;
          const yChange = expandedRect.y < positionAbsolute.y ? Math.round(Math.abs(positionAbsolute.y - expandedRect.y)) : 0;
          const newWidth = Math.max(dimensions.width, Math.round(expandedRect.width));
          const newHeight = Math.max(dimensions.height, Math.round(expandedRect.height));
          const widthChange = (newWidth - dimensions.width) * origin[0];
          const heightChange = (newHeight - dimensions.height) * origin[1];
          if (xChange > 0 || yChange > 0 || widthChange || heightChange) {
            changes.push({
              id: parentId,
              type: "position",
              position: {
                x: parent.position.x - xChange + widthChange,
                y: parent.position.y - yChange + heightChange
              }
            });
            parentLookup.get(parentId)?.forEach((childNode) => {
              if (!children2.some((child) => child.id === childNode.id)) {
                changes.push({
                  id: childNode.id,
                  type: "position",
                  position: {
                    x: childNode.position.x + xChange,
                    y: childNode.position.y + yChange
                  }
                });
              }
            });
          }
          if (dimensions.width < expandedRect.width || dimensions.height < expandedRect.height || xChange || yChange) {
            changes.push({
              id: parentId,
              type: "dimensions",
              setAttributes: true,
              dimensions: {
                width: newWidth + (xChange ? origin[0] * xChange - widthChange : 0),
                height: newHeight + (yChange ? origin[1] * yChange - heightChange : 0)
              }
            });
          }
        });
      }
      return changes;
    }
    function updateNodeInternals(updates, nodeLookup, parentLookup, domNode, nodeOrigin, nodeExtent, zIndexMode) {
      const viewportNode = domNode?.querySelector(".xyflow__viewport");
      let updatedInternals = false;
      if (!viewportNode) {
        return { changes: [], updatedInternals };
      }
      const changes = [];
      const style2 = window.getComputedStyle(viewportNode);
      const { m22: zoom3 } = new window.DOMMatrixReadOnly(style2.transform);
      const parentExpandChildren = [];
      for (const update of updates.values()) {
        const node = nodeLookup.get(update.id);
        if (!node) {
          continue;
        }
        if (node.hidden) {
          nodeLookup.set(node.id, {
            ...node,
            internals: {
              ...node.internals,
              handleBounds: void 0
            }
          });
          updatedInternals = true;
          continue;
        }
        const dimensions = getDimensions(update.nodeElement);
        const dimensionChanged = node.measured.width !== dimensions.width || node.measured.height !== dimensions.height;
        const doUpdate = !!(dimensions.width && dimensions.height && (dimensionChanged || !node.internals.handleBounds || update.force));
        if (doUpdate) {
          const nodeBounds = update.nodeElement.getBoundingClientRect();
          const extent = isCoordinateExtent(node.extent) ? node.extent : nodeExtent;
          let { positionAbsolute } = node.internals;
          if (node.parentId && node.extent === "parent") {
            const parentNode = nodeLookup.get(node.parentId);
            if (parentNode) {
              positionAbsolute = clampPositionToParent(positionAbsolute, dimensions, parentNode);
            }
          } else if (extent) {
            positionAbsolute = clampPosition(positionAbsolute, extent, dimensions);
          }
          const newNode = {
            ...node,
            measured: dimensions,
            internals: {
              ...node.internals,
              positionAbsolute,
              handleBounds: {
                source: getHandleBounds("source", update.nodeElement, nodeBounds, zoom3, node.id),
                target: getHandleBounds("target", update.nodeElement, nodeBounds, zoom3, node.id)
              }
            }
          };
          nodeLookup.set(node.id, newNode);
          if (node.parentId) {
            updateChildNode(newNode, nodeLookup, parentLookup, { nodeOrigin, zIndexMode });
          }
          updatedInternals = true;
          if (dimensionChanged) {
            changes.push({
              id: node.id,
              type: "dimensions",
              dimensions
            });
            if (node.expandParent && node.parentId) {
              parentExpandChildren.push({
                id: node.id,
                parentId: node.parentId,
                rect: nodeToRect(newNode, nodeOrigin)
              });
            }
          }
        }
      }
      if (parentExpandChildren.length > 0) {
        const parentExpandChanges = handleExpandParent(parentExpandChildren, nodeLookup, parentLookup, nodeOrigin);
        changes.push(...parentExpandChanges);
      }
      return { changes, updatedInternals };
    }
    async function panBy({ delta, panZoom, transform: transform2, translateExtent, width, height }) {
      if (!panZoom || !delta.x && !delta.y) {
        return false;
      }
      const nextViewport = await panZoom.setViewportConstrained({
        x: transform2[0] + delta.x,
        y: transform2[1] + delta.y,
        zoom: transform2[2]
      }, [
        [0, 0],
        [width, height]
      ], translateExtent);
      const transformChanged = !!nextViewport && (nextViewport.x !== transform2[0] || nextViewport.y !== transform2[1] || nextViewport.k !== transform2[2]);
      return transformChanged;
    }
    function addConnectionToLookup(type, connection, connectionKey, connectionLookup, nodeId, handleId) {
      let key = nodeId;
      const nodeMap = connectionLookup.get(key) || /* @__PURE__ */ new Map();
      connectionLookup.set(key, nodeMap.set(connectionKey, connection));
      key = `${nodeId}-${type}`;
      const typeMap = connectionLookup.get(key) || /* @__PURE__ */ new Map();
      connectionLookup.set(key, typeMap.set(connectionKey, connection));
      if (handleId) {
        key = `${nodeId}-${type}-${handleId}`;
        const handleMap = connectionLookup.get(key) || /* @__PURE__ */ new Map();
        connectionLookup.set(key, handleMap.set(connectionKey, connection));
      }
    }
    function updateConnectionLookup(connectionLookup, edgeLookup, edges) {
      connectionLookup.clear();
      edgeLookup.clear();
      for (const edge2 of edges) {
        const { source: sourceNode, target: targetNode, sourceHandle = null, targetHandle = null } = edge2;
        const connection = { edgeId: edge2.id, source: sourceNode, target: targetNode, sourceHandle, targetHandle };
        const sourceKey = `${sourceNode}-${sourceHandle}--${targetNode}-${targetHandle}`;
        const targetKey = `${targetNode}-${targetHandle}--${sourceNode}-${sourceHandle}`;
        addConnectionToLookup("source", connection, targetKey, connectionLookup, sourceNode, sourceHandle);
        addConnectionToLookup("target", connection, sourceKey, connectionLookup, targetNode, targetHandle);
        edgeLookup.set(edge2.id, edge2);
      }
    }
    function isParentSelected(node, nodeLookup) {
      if (!node.parentId) {
        return false;
      }
      const parentNode = nodeLookup.get(node.parentId);
      if (!parentNode) {
        return false;
      }
      if (parentNode.selected) {
        return true;
      }
      return isParentSelected(parentNode, nodeLookup);
    }
    function hasSelector(target, selector2, domNode) {
      let current = target;
      do {
        if (current?.matches?.(selector2))
          return true;
        if (current === domNode)
          return false;
        current = current?.parentElement;
      } while (current);
      return false;
    }
    function getDragItems(nodeLookup, nodesDraggable, mousePos, nodeId, onlyDragNode) {
      const dragItems = /* @__PURE__ */ new Map();
      for (const [id2, node] of nodeLookup) {
        const isDragged = onlyDragNode ? node.id === nodeId : node.selected || node.id === nodeId;
        if (isDragged && (onlyDragNode || !node.parentId || !isParentSelected(node, nodeLookup)) && (node.draggable || nodesDraggable && typeof node.draggable === "undefined")) {
          const internalNode = nodeLookup.get(id2);
          if (internalNode) {
            dragItems.set(id2, {
              id: id2,
              position: internalNode.position || { x: 0, y: 0 },
              distance: {
                x: mousePos.x - internalNode.internals.positionAbsolute.x,
                y: mousePos.y - internalNode.internals.positionAbsolute.y
              },
              extent: internalNode.extent,
              parentId: internalNode.parentId,
              origin: internalNode.origin,
              expandParent: internalNode.expandParent,
              internals: {
                positionAbsolute: internalNode.internals.positionAbsolute || { x: 0, y: 0 }
              },
              measured: {
                width: internalNode.measured.width ?? 0,
                height: internalNode.measured.height ?? 0
              }
            });
          }
        }
      }
      return dragItems;
    }
    function getEventHandlerParams({ nodeId, dragItems, nodeLookup, dragging = true }) {
      const nodesFromDragItems = [];
      for (const [id2, dragItem] of dragItems) {
        const node2 = nodeLookup.get(id2)?.internals.userNode;
        if (node2) {
          nodesFromDragItems.push({
            ...node2,
            position: dragItem.position,
            dragging
          });
        }
      }
      if (!nodeId) {
        return [nodesFromDragItems[0], nodesFromDragItems];
      }
      const node = nodeLookup.get(nodeId)?.internals.userNode;
      return [
        !node ? nodesFromDragItems[0] : {
          ...node,
          position: dragItems.get(nodeId)?.position || node.position,
          dragging
        },
        nodesFromDragItems
      ];
    }
    function calculateSnapOffset({ dragItems, snapGrid, x, y }) {
      const refDragItem = dragItems.values().next().value;
      if (!refDragItem) {
        return null;
      }
      const refPos = {
        x: x - refDragItem.distance.x,
        y: y - refDragItem.distance.y
      };
      const refPosSnapped = snapPosition(refPos, snapGrid);
      return {
        x: refPosSnapped.x - refPos.x,
        y: refPosSnapped.y - refPos.y
      };
    }
    function XYDrag({ onNodeMouseDown, getStoreItems, onDragStart, onDrag, onDragStop }) {
      let lastPos = { x: null, y: null };
      let autoPanId = 0;
      let dragItems = /* @__PURE__ */ new Map();
      let autoPanStarted = false;
      let mousePosition = { x: 0, y: 0 };
      let containerBounds = null;
      let dragStarted = false;
      let d3Selection = null;
      let abortDrag = false;
      let nodePositionsChanged = false;
      let dragEvent = null;
      function update({ noDragClassName, handleSelector, domNode, isSelectable, nodeId, nodeClickDistance = 0 }) {
        d3Selection = select(domNode);
        function updateNodes({ x, y }) {
          const { nodeLookup, nodeExtent, snapGrid, snapToGrid, nodeOrigin, onNodeDrag, onSelectionDrag, onError, updateNodePositions } = getStoreItems();
          lastPos = { x, y };
          let hasChange = false;
          const isMultiDrag = dragItems.size > 1;
          const nodesBox = isMultiDrag && nodeExtent ? rectToBox(getInternalNodesBounds(dragItems)) : null;
          const multiDragSnapOffset = isMultiDrag && snapToGrid ? calculateSnapOffset({
            dragItems,
            snapGrid,
            x,
            y
          }) : null;
          for (const [id2, dragItem] of dragItems) {
            if (!nodeLookup.has(id2)) {
              continue;
            }
            let nextPosition = { x: x - dragItem.distance.x, y: y - dragItem.distance.y };
            if (snapToGrid) {
              nextPosition = multiDragSnapOffset ? {
                x: Math.round(nextPosition.x + multiDragSnapOffset.x),
                y: Math.round(nextPosition.y + multiDragSnapOffset.y)
              } : snapPosition(nextPosition, snapGrid);
            }
            let adjustedNodeExtent = null;
            if (isMultiDrag && nodeExtent && !dragItem.extent && nodesBox) {
              const { positionAbsolute: positionAbsolute2 } = dragItem.internals;
              const x1 = positionAbsolute2.x - nodesBox.x + nodeExtent[0][0];
              const x2 = positionAbsolute2.x + dragItem.measured.width - nodesBox.x2 + nodeExtent[1][0];
              const y1 = positionAbsolute2.y - nodesBox.y + nodeExtent[0][1];
              const y2 = positionAbsolute2.y + dragItem.measured.height - nodesBox.y2 + nodeExtent[1][1];
              adjustedNodeExtent = [
                [x1, y1],
                [x2, y2]
              ];
            }
            const { position, positionAbsolute } = calculateNodePosition({
              nodeId: id2,
              nextPosition,
              nodeLookup,
              nodeExtent: adjustedNodeExtent ? adjustedNodeExtent : nodeExtent,
              nodeOrigin,
              onError
            });
            hasChange = hasChange || dragItem.position.x !== position.x || dragItem.position.y !== position.y;
            dragItem.position = position;
            dragItem.internals.positionAbsolute = positionAbsolute;
          }
          nodePositionsChanged = nodePositionsChanged || hasChange;
          if (!hasChange) {
            return;
          }
          updateNodePositions(dragItems, true);
          if (dragEvent && (onDrag || onNodeDrag || !nodeId && onSelectionDrag)) {
            const [currentNode, currentNodes] = getEventHandlerParams({
              nodeId,
              dragItems,
              nodeLookup
            });
            onDrag?.(dragEvent, dragItems, currentNode, currentNodes);
            onNodeDrag?.(dragEvent, currentNode, currentNodes);
            if (!nodeId) {
              onSelectionDrag?.(dragEvent, currentNodes);
            }
          }
        }
        async function autoPan() {
          if (!containerBounds) {
            return;
          }
          const { transform: transform2, panBy: panBy2, autoPanSpeed, autoPanOnNodeDrag } = getStoreItems();
          if (!autoPanOnNodeDrag) {
            autoPanStarted = false;
            cancelAnimationFrame(autoPanId);
            return;
          }
          const [xMovement, yMovement] = calcAutoPan(mousePosition, containerBounds, autoPanSpeed);
          if (xMovement !== 0 || yMovement !== 0) {
            lastPos.x = (lastPos.x ?? 0) - xMovement / transform2[2];
            lastPos.y = (lastPos.y ?? 0) - yMovement / transform2[2];
            if (await panBy2({ x: xMovement, y: yMovement })) {
              updateNodes(lastPos);
            }
          }
          autoPanId = requestAnimationFrame(autoPan);
        }
        function startDrag(event) {
          const { nodeLookup, multiSelectionActive, nodesDraggable, transform: transform2, snapGrid, snapToGrid, selectNodesOnDrag, onNodeDragStart, onSelectionDragStart, unselectNodesAndEdges } = getStoreItems();
          dragStarted = true;
          const isUnselectedNodeDrag = !!nodeId && !multiSelectionActive && !nodeLookup.get(nodeId)?.selected;
          if ((!selectNodesOnDrag || !isSelectable) && !multiSelectionActive && nodeId) {
            if (!nodeLookup.get(nodeId)?.selected) {
              unselectNodesAndEdges();
            }
          }
          if (isSelectable && selectNodesOnDrag && nodeId) {
            onNodeMouseDown?.(nodeId);
          }
          const pointerPos = getPointerPosition(event.sourceEvent, { transform: transform2, snapGrid, snapToGrid, containerBounds });
          lastPos = pointerPos;
          dragItems = getDragItems(nodeLookup, nodesDraggable, pointerPos, nodeId, isUnselectedNodeDrag);
          if (dragItems.size > 0 && (onDragStart || onNodeDragStart || !nodeId && onSelectionDragStart)) {
            const [currentNode, currentNodes] = getEventHandlerParams({
              nodeId,
              dragItems,
              nodeLookup
            });
            onDragStart?.(event.sourceEvent, dragItems, currentNode, currentNodes);
            onNodeDragStart?.(event.sourceEvent, currentNode, currentNodes);
            if (!nodeId) {
              onSelectionDragStart?.(event.sourceEvent, currentNodes);
            }
          }
        }
        const d3DragInstance = drag().clickDistance(nodeClickDistance).on("start", (event) => {
          const { domNode: domNode2, nodeDragThreshold, transform: transform2, snapGrid, snapToGrid } = getStoreItems();
          containerBounds = domNode2?.getBoundingClientRect() || null;
          abortDrag = false;
          nodePositionsChanged = false;
          dragEvent = event.sourceEvent;
          if (nodeDragThreshold === 0) {
            startDrag(event);
          }
          const pointerPos = getPointerPosition(event.sourceEvent, { transform: transform2, snapGrid, snapToGrid, containerBounds });
          lastPos = pointerPos;
          mousePosition = getEventPosition(event.sourceEvent, containerBounds);
        }).on("drag", (event) => {
          const { autoPanOnNodeDrag, transform: transform2, snapGrid, snapToGrid, nodeDragThreshold, nodeLookup } = getStoreItems();
          const pointerPos = getPointerPosition(event.sourceEvent, { transform: transform2, snapGrid, snapToGrid, containerBounds });
          dragEvent = event.sourceEvent;
          if (event.sourceEvent.type === "touchmove" && event.sourceEvent.touches.length > 1 || // if user deletes a node while dragging, we need to abort the drag to prevent errors
          nodeId && !nodeLookup.has(nodeId)) {
            abortDrag = true;
          }
          if (abortDrag) {
            return;
          }
          if (!autoPanStarted && autoPanOnNodeDrag && dragStarted) {
            autoPanStarted = true;
            autoPan();
          }
          if (!dragStarted) {
            const currentMousePosition = getEventPosition(event.sourceEvent, containerBounds);
            const x = currentMousePosition.x - mousePosition.x;
            const y = currentMousePosition.y - mousePosition.y;
            const distance2 = Math.sqrt(x * x + y * y);
            if (distance2 > nodeDragThreshold) {
              startDrag(event);
            }
          }
          if ((lastPos.x !== pointerPos.xSnapped || lastPos.y !== pointerPos.ySnapped) && dragItems && dragStarted) {
            mousePosition = getEventPosition(event.sourceEvent, containerBounds);
            updateNodes(pointerPos);
          }
        }).on("end", (event) => {
          if (!dragStarted || abortDrag) {
            if (abortDrag && dragItems.size > 0) {
              getStoreItems().updateNodePositions(dragItems, false);
            }
            return;
          }
          autoPanStarted = false;
          dragStarted = false;
          cancelAnimationFrame(autoPanId);
          if (dragItems.size > 0) {
            const { nodeLookup, updateNodePositions, onNodeDragStop, onSelectionDragStop } = getStoreItems();
            if (nodePositionsChanged) {
              updateNodePositions(dragItems, false);
              nodePositionsChanged = false;
            }
            if (onDragStop || onNodeDragStop || !nodeId && onSelectionDragStop) {
              const [currentNode, currentNodes] = getEventHandlerParams({
                nodeId,
                dragItems,
                nodeLookup,
                dragging: false
              });
              onDragStop?.(event.sourceEvent, dragItems, currentNode, currentNodes);
              onNodeDragStop?.(event.sourceEvent, currentNode, currentNodes);
              if (!nodeId) {
                onSelectionDragStop?.(event.sourceEvent, currentNodes);
              }
            }
          }
        }).filter((event) => {
          const target = event.target;
          const isDraggable = !event.button && (!noDragClassName || !hasSelector(target, `.${noDragClassName}`, domNode)) && (!handleSelector || hasSelector(target, handleSelector, domNode));
          return isDraggable;
        });
        d3Selection.call(d3DragInstance);
      }
      function destroy() {
        d3Selection?.on(".drag", null);
      }
      return {
        update,
        destroy
      };
    }
    function getNodesWithinDistance(position, nodeLookup, distance2) {
      const nodes = [];
      const rect = {
        x: position.x - distance2,
        y: position.y - distance2,
        width: distance2 * 2,
        height: distance2 * 2
      };
      for (const node of nodeLookup.values()) {
        if (getOverlappingArea(rect, nodeToRect(node)) > 0) {
          nodes.push(node);
        }
      }
      return nodes;
    }
    var ADDITIONAL_DISTANCE = 250;
    function getClosestHandle(position, connectionRadius, nodeLookup, fromHandle) {
      let closestHandles = [];
      let minDistance = Infinity;
      const closeNodes = getNodesWithinDistance(position, nodeLookup, connectionRadius + ADDITIONAL_DISTANCE);
      for (const node of closeNodes) {
        const allHandles = [...node.internals.handleBounds?.source ?? [], ...node.internals.handleBounds?.target ?? []];
        for (const handle of allHandles) {
          if (fromHandle.nodeId === handle.nodeId && fromHandle.type === handle.type && fromHandle.id === handle.id) {
            continue;
          }
          const { x, y } = getHandlePosition(node, handle, handle.position, true);
          const distance2 = Math.sqrt(Math.pow(x - position.x, 2) + Math.pow(y - position.y, 2));
          if (distance2 > connectionRadius) {
            continue;
          }
          if (distance2 < minDistance) {
            closestHandles = [{ ...handle, x, y }];
            minDistance = distance2;
          } else if (distance2 === minDistance) {
            closestHandles.push({ ...handle, x, y });
          }
        }
      }
      if (!closestHandles.length) {
        return null;
      }
      if (closestHandles.length > 1) {
        const oppositeHandleType = fromHandle.type === "source" ? "target" : "source";
        return closestHandles.find((handle) => handle.type === oppositeHandleType) ?? closestHandles[0];
      }
      return closestHandles[0];
    }
    function getHandle(nodeId, handleType, handleId, nodeLookup, connectionMode, withAbsolutePosition = false) {
      const node = nodeLookup.get(nodeId);
      if (!node) {
        return null;
      }
      const handles = connectionMode === "strict" ? node.internals.handleBounds?.[handleType] : [...node.internals.handleBounds?.source ?? [], ...node.internals.handleBounds?.target ?? []];
      const handle = (handleId ? handles?.find((h) => h.id === handleId) : handles?.[0]) ?? null;
      return handle && withAbsolutePosition ? { ...handle, ...getHandlePosition(node, handle, handle.position, true) } : handle;
    }
    function getHandleType(edgeUpdaterType, handleDomNode) {
      if (edgeUpdaterType) {
        return edgeUpdaterType;
      } else if (handleDomNode?.classList.contains("target")) {
        return "target";
      } else if (handleDomNode?.classList.contains("source")) {
        return "source";
      }
      return null;
    }
    function isConnectionValid(isInsideConnectionRadius, isHandleValid) {
      let isValid = null;
      if (isHandleValid) {
        isValid = true;
      } else if (isInsideConnectionRadius && !isHandleValid) {
        isValid = false;
      }
      return isValid;
    }
    var alwaysValid = () => true;
    function onPointerDown(event, { connectionMode, connectionRadius, handleId, nodeId, edgeUpdaterType, isTarget, domNode, nodeLookup, lib, autoPanOnConnect, flowId, panBy: panBy2, cancelConnection, onConnectStart, onConnect, onConnectEnd, isValidConnection = alwaysValid, onReconnectEnd, updateConnection, getTransform, getFromHandle, autoPanSpeed, dragThreshold = 1, handleDomNode }) {
      const doc = getHostForElement(event.target);
      let autoPanId = 0;
      let closestHandle;
      const { x, y } = getEventPosition(event);
      const handleType = getHandleType(edgeUpdaterType, handleDomNode);
      const containerBounds = domNode?.getBoundingClientRect();
      let connectionStarted = false;
      if (!containerBounds || !handleType) {
        return;
      }
      const fromHandleInternal = getHandle(nodeId, handleType, handleId, nodeLookup, connectionMode);
      if (!fromHandleInternal) {
        return;
      }
      let position = getEventPosition(event, containerBounds);
      let autoPanStarted = false;
      let connection = null;
      let isValid = false;
      let resultHandleDomNode = null;
      function autoPan() {
        if (!autoPanOnConnect || !containerBounds) {
          return;
        }
        const [x2, y2] = calcAutoPan(position, containerBounds, autoPanSpeed);
        panBy2({ x: x2, y: y2 });
        autoPanId = requestAnimationFrame(autoPan);
      }
      const fromHandle = {
        ...fromHandleInternal,
        nodeId,
        type: handleType,
        position: fromHandleInternal.position
      };
      const fromInternalNode = nodeLookup.get(nodeId);
      const from = getHandlePosition(fromInternalNode, fromHandle, Position.Left, true);
      let previousConnection = {
        inProgress: true,
        isValid: null,
        from,
        fromHandle,
        fromPosition: fromHandle.position,
        fromNode: fromInternalNode,
        to: position,
        toHandle: null,
        toPosition: oppositePosition[fromHandle.position],
        toNode: null,
        pointer: position
      };
      function startConnection() {
        connectionStarted = true;
        updateConnection(previousConnection);
        onConnectStart?.(event, { nodeId, handleId, handleType });
      }
      if (dragThreshold === 0) {
        startConnection();
      }
      function onPointerMove(event2) {
        if (!connectionStarted) {
          const { x: evtX, y: evtY } = getEventPosition(event2);
          const dx = evtX - x;
          const dy = evtY - y;
          const nextConnectionStarted = dx * dx + dy * dy > dragThreshold * dragThreshold;
          if (!nextConnectionStarted) {
            return;
          }
          startConnection();
        }
        if (!getFromHandle() || !fromHandle) {
          onPointerUp(event2);
          return;
        }
        const transform2 = getTransform();
        position = getEventPosition(event2, containerBounds);
        closestHandle = getClosestHandle(pointToRendererPoint(position, transform2, false, [1, 1]), connectionRadius, nodeLookup, fromHandle);
        if (!autoPanStarted) {
          autoPan();
          autoPanStarted = true;
        }
        const result = isValidHandle(event2, {
          handle: closestHandle,
          connectionMode,
          fromNodeId: nodeId,
          fromHandleId: handleId,
          fromType: isTarget ? "target" : "source",
          isValidConnection,
          doc,
          lib,
          flowId,
          nodeLookup
        });
        resultHandleDomNode = result.handleDomNode;
        connection = result.connection;
        isValid = isConnectionValid(!!closestHandle, result.isValid);
        const fromInternalNode2 = nodeLookup.get(nodeId);
        const from2 = fromInternalNode2 ? getHandlePosition(fromInternalNode2, fromHandle, Position.Left, true) : previousConnection.from;
        const newConnection = {
          ...previousConnection,
          from: from2,
          isValid,
          to: result.toHandle && isValid ? rendererPointToPoint({ x: result.toHandle.x, y: result.toHandle.y }, transform2) : position,
          toHandle: result.toHandle,
          toPosition: isValid && result.toHandle ? result.toHandle.position : oppositePosition[fromHandle.position],
          toNode: result.toHandle ? nodeLookup.get(result.toHandle.nodeId) : null,
          pointer: position
        };
        updateConnection(newConnection);
        previousConnection = newConnection;
      }
      function onPointerUp(event2) {
        if ("touches" in event2 && event2.touches.length > 0) {
          return;
        }
        if (connectionStarted) {
          if ((closestHandle || resultHandleDomNode) && connection && isValid) {
            onConnect?.(connection);
          }
          const { inProgress, ...connectionState } = previousConnection;
          const finalConnectionState = {
            ...connectionState,
            toPosition: previousConnection.toHandle ? previousConnection.toPosition : null
          };
          onConnectEnd?.(event2, finalConnectionState);
          if (edgeUpdaterType) {
            onReconnectEnd?.(event2, finalConnectionState);
          }
        }
        cancelConnection();
        cancelAnimationFrame(autoPanId);
        autoPanStarted = false;
        isValid = false;
        connection = null;
        resultHandleDomNode = null;
        doc.removeEventListener("mousemove", onPointerMove);
        doc.removeEventListener("mouseup", onPointerUp);
        doc.removeEventListener("touchmove", onPointerMove);
        doc.removeEventListener("touchend", onPointerUp);
      }
      doc.addEventListener("mousemove", onPointerMove);
      doc.addEventListener("mouseup", onPointerUp);
      doc.addEventListener("touchmove", onPointerMove);
      doc.addEventListener("touchend", onPointerUp);
    }
    function isValidHandle(event, { handle, connectionMode, fromNodeId, fromHandleId, fromType, doc, lib, flowId, isValidConnection = alwaysValid, nodeLookup }) {
      const isTarget = fromType === "target";
      const handleDomNode = handle ? doc.querySelector(`.${lib}-flow__handle[data-id="${flowId}-${handle?.nodeId}-${handle?.id}-${handle?.type}"]`) : null;
      const { x, y } = getEventPosition(event);
      const handleBelow = doc.elementFromPoint(x, y);
      const handleToCheck = handleBelow?.classList.contains(`${lib}-flow__handle`) ? handleBelow : handleDomNode;
      const result = {
        handleDomNode: handleToCheck,
        isValid: false,
        connection: null,
        toHandle: null
      };
      if (handleToCheck) {
        const handleType = getHandleType(void 0, handleToCheck);
        const handleNodeId = handleToCheck.getAttribute("data-nodeid");
        const handleId = handleToCheck.getAttribute("data-handleid");
        const connectable = handleToCheck.classList.contains("connectable");
        const connectableEnd = handleToCheck.classList.contains("connectableend");
        if (!handleNodeId || !handleType) {
          return result;
        }
        const connection = {
          source: isTarget ? handleNodeId : fromNodeId,
          sourceHandle: isTarget ? handleId : fromHandleId,
          target: isTarget ? fromNodeId : handleNodeId,
          targetHandle: isTarget ? fromHandleId : handleId
        };
        result.connection = connection;
        const isConnectable = connectable && connectableEnd;
        const isValid = isConnectable && (connectionMode === ConnectionMode.Strict ? isTarget && handleType === "source" || !isTarget && handleType === "target" : handleNodeId !== fromNodeId || handleId !== fromHandleId);
        result.isValid = isValid && isValidConnection(connection);
        result.toHandle = getHandle(handleNodeId, handleType, handleId, nodeLookup, connectionMode, true);
      }
      return result;
    }
    var XYHandle = {
      onPointerDown,
      isValid: isValidHandle
    };
    function XYMinimap({ domNode, panZoom, getTransform, getViewScale }) {
      const selection2 = select(domNode);
      function update({ translateExtent, width, height, zoomStep = 1, pannable = true, zoomable = true, inversePan = false }) {
        const zoomHandler = (event) => {
          if (event.sourceEvent.type !== "wheel" || !panZoom) {
            return;
          }
          const transform2 = getTransform();
          const factor = event.sourceEvent.ctrlKey && isMacOs() ? 10 : 1;
          const pinchDelta = -event.sourceEvent.deltaY * (event.sourceEvent.deltaMode === 1 ? 0.05 : event.sourceEvent.deltaMode ? 1 : 2e-3) * zoomStep;
          const nextZoom = transform2[2] * Math.pow(2, pinchDelta * factor);
          panZoom.scaleTo(nextZoom);
        };
        let panStart = [0, 0];
        const panStartHandler = (event) => {
          if (event.sourceEvent.type === "mousedown" || event.sourceEvent.type === "touchstart") {
            panStart = [
              event.sourceEvent.clientX ?? event.sourceEvent.touches[0].clientX,
              event.sourceEvent.clientY ?? event.sourceEvent.touches[0].clientY
            ];
          }
        };
        const panHandler = (event) => {
          const transform2 = getTransform();
          if (event.sourceEvent.type !== "mousemove" && event.sourceEvent.type !== "touchmove" || !panZoom) {
            return;
          }
          const panCurrent = [
            event.sourceEvent.clientX ?? event.sourceEvent.touches[0].clientX,
            event.sourceEvent.clientY ?? event.sourceEvent.touches[0].clientY
          ];
          const panDelta = [panCurrent[0] - panStart[0], panCurrent[1] - panStart[1]];
          panStart = panCurrent;
          const moveScale = getViewScale() * Math.max(transform2[2], Math.log(transform2[2])) * (inversePan ? -1 : 1);
          const position = {
            x: transform2[0] - panDelta[0] * moveScale,
            y: transform2[1] - panDelta[1] * moveScale
          };
          const extent = [
            [0, 0],
            [width, height]
          ];
          panZoom.setViewportConstrained({
            x: position.x,
            y: position.y,
            zoom: transform2[2]
          }, extent, translateExtent);
        };
        const zoomAndPanHandler = zoom2().on("start", panStartHandler).on("zoom", pannable ? panHandler : null).on("zoom.wheel", zoomable ? zoomHandler : null);
        selection2.call(zoomAndPanHandler, {});
      }
      function destroy() {
        selection2.on("zoom", null);
      }
      return {
        update,
        destroy,
        pointer
      };
    }
    var transformToViewport = (transform2) => ({
      x: transform2.x,
      y: transform2.y,
      zoom: transform2.k
    });
    var viewportToTransform = ({ x, y, zoom: zoom3 }) => identity2.translate(x, y).scale(zoom3);
    var isWrappedWithClass = (event, className) => event.target.closest(`.${className}`);
    var isRightClickPan = (panOnDrag, usedButton) => usedButton === 2 && Array.isArray(panOnDrag) && panOnDrag.includes(2);
    var defaultEase = (t) => ((t *= 2) <= 1 ? t * t * t : (t -= 2) * t * t + 2) / 2;
    var getD3Transition = (selection2, duration = 0, ease = defaultEase, onEnd = () => {
    }) => {
      const hasDuration = typeof duration === "number" && duration > 0;
      if (!hasDuration) {
        onEnd();
      }
      return hasDuration ? selection2.transition().duration(duration).ease(ease).on("end", onEnd) : selection2;
    };
    var wheelDelta = (event) => {
      const factor = event.ctrlKey && isMacOs() ? 10 : 1;
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 2e-3) * factor;
    };
    function createPanOnScrollHandler({ zoomPanValues, noWheelClassName, d3Selection, d3Zoom, panOnScrollMode, panOnScrollSpeed, zoomOnPinch, onPanZoomStart, onPanZoom, onPanZoomEnd }) {
      return (event) => {
        if (isWrappedWithClass(event, noWheelClassName)) {
          if (event.ctrlKey) {
            event.preventDefault();
          }
          return false;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        const currentZoom = d3Selection.property("__zoom").k || 1;
        if (event.ctrlKey && zoomOnPinch) {
          const point = pointer(event);
          const pinchDelta = wheelDelta(event);
          const zoom3 = currentZoom * Math.pow(2, pinchDelta);
          d3Zoom.scaleTo(d3Selection, zoom3, point, event);
          return;
        }
        const deltaNormalize = event.deltaMode === 1 ? 20 : 1;
        let deltaX = panOnScrollMode === PanOnScrollMode.Vertical ? 0 : event.deltaX * deltaNormalize;
        let deltaY = panOnScrollMode === PanOnScrollMode.Horizontal ? 0 : event.deltaY * deltaNormalize;
        if (!isMacOs() && event.shiftKey && panOnScrollMode !== PanOnScrollMode.Vertical) {
          deltaX = event.deltaY * deltaNormalize;
          deltaY = 0;
        }
        d3Zoom.translateBy(
          d3Selection,
          -(deltaX / currentZoom) * panOnScrollSpeed,
          -(deltaY / currentZoom) * panOnScrollSpeed,
          // @ts-ignore
          { internal: true }
        );
        const nextViewport = transformToViewport(d3Selection.property("__zoom"));
        clearTimeout(zoomPanValues.panScrollTimeout);
        if (!zoomPanValues.isPanScrolling) {
          zoomPanValues.isPanScrolling = true;
          onPanZoomStart?.(event, nextViewport);
        } else {
          onPanZoom?.(event, nextViewport);
        }
        zoomPanValues.panScrollTimeout = setTimeout(() => {
          onPanZoomEnd?.(event, nextViewport);
          zoomPanValues.isPanScrolling = false;
        }, 150);
      };
    }
    function createZoomOnScrollHandler({ noWheelClassName, preventScrolling, d3ZoomHandler }) {
      return function(event, d) {
        const isWheel = event.type === "wheel";
        const preventZoom = !preventScrolling && isWheel && !event.ctrlKey;
        const hasNoWheelClass = isWrappedWithClass(event, noWheelClassName);
        if (event.ctrlKey && isWheel && hasNoWheelClass) {
          event.preventDefault();
        }
        if (preventZoom || hasNoWheelClass) {
          return null;
        }
        event.preventDefault();
        d3ZoomHandler.call(this, event, d);
      };
    }
    function createPanZoomStartHandler({ zoomPanValues, onDraggingChange, onPanZoomStart }) {
      return (event) => {
        if (event.sourceEvent?.internal) {
          return;
        }
        const viewport = transformToViewport(event.transform);
        zoomPanValues.mouseButton = event.sourceEvent?.button || 0;
        zoomPanValues.isZoomingOrPanning = true;
        zoomPanValues.prevViewport = viewport;
        if (event.sourceEvent?.type === "mousedown") {
          onDraggingChange(true);
        }
        if (onPanZoomStart) {
          onPanZoomStart?.(event.sourceEvent, viewport);
        }
      };
    }
    function createPanZoomHandler({ zoomPanValues, panOnDrag, onPaneContextMenu, onTransformChange, onPanZoom }) {
      return (event) => {
        zoomPanValues.usedRightMouseButton = !!(onPaneContextMenu && isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0));
        if (!event.sourceEvent?.sync) {
          onTransformChange([event.transform.x, event.transform.y, event.transform.k]);
        }
        if (onPanZoom && !event.sourceEvent?.internal) {
          onPanZoom?.(event.sourceEvent, transformToViewport(event.transform));
        }
      };
    }
    function createPanZoomEndHandler({ zoomPanValues, panOnDrag, panOnScroll, onDraggingChange, onPanZoomEnd, onPaneContextMenu }) {
      return (event) => {
        if (event.sourceEvent?.internal) {
          return;
        }
        zoomPanValues.isZoomingOrPanning = false;
        if (onPaneContextMenu && isRightClickPan(panOnDrag, zoomPanValues.mouseButton ?? 0) && !zoomPanValues.usedRightMouseButton && event.sourceEvent) {
          onPaneContextMenu(event.sourceEvent);
        }
        zoomPanValues.usedRightMouseButton = false;
        onDraggingChange(false);
        if (onPanZoomEnd) {
          const viewport = transformToViewport(event.transform);
          zoomPanValues.prevViewport = viewport;
          clearTimeout(zoomPanValues.timerId);
          zoomPanValues.timerId = setTimeout(
            () => {
              onPanZoomEnd?.(event.sourceEvent, viewport);
            },
            // we need a setTimeout for panOnScroll to suppress multiple end events fired during scroll
            panOnScroll ? 150 : 0
          );
        }
      };
    }
    function createFilter({ panActivationKeyPressed, zoomActivationKeyPressed, zoomOnScroll, zoomOnPinch, panOnDrag, panOnScroll, zoomOnDoubleClick, userSelectionActive, noWheelClassName, noPanClassName, lib, connectionInProgress }) {
      return (event) => {
        const zoomScroll = zoomActivationKeyPressed || zoomOnScroll;
        const pinchZoom = zoomOnPinch && event.ctrlKey;
        const isWheelEvent = event.type === "wheel";
        if (event.button === 1 && event.type === "mousedown" && (isWrappedWithClass(event, `${lib}-flow__node`) || isWrappedWithClass(event, `${lib}-flow__edge`) || isWrappedWithClass(event, `${lib}-flow__selection`) || isWrappedWithClass(event, `${lib}-flow__nodesselection`))) {
          return true;
        }
        if (!panOnDrag && !zoomScroll && !panOnScroll && !zoomOnDoubleClick && !zoomOnPinch) {
          return false;
        }
        if (userSelectionActive) {
          return false;
        }
        if (connectionInProgress && !isWheelEvent) {
          return false;
        }
        if (isWrappedWithClass(event, noWheelClassName) && isWheelEvent) {
          return false;
        }
        if (isWrappedWithClass(event, noPanClassName) && (!isWheelEvent || panOnScroll && isWheelEvent && !zoomActivationKeyPressed)) {
          return false;
        }
        if (!zoomOnPinch && event.ctrlKey && isWheelEvent) {
          return false;
        }
        if (!zoomOnPinch && event.type === "touchstart" && event.touches?.length > 1) {
          event.preventDefault();
          return false;
        }
        if (!zoomScroll && !panOnScroll && !pinchZoom && isWheelEvent) {
          return false;
        }
        if (!panOnDrag && (event.type === "mousedown" || event.type === "touchstart")) {
          return false;
        }
        if (Array.isArray(panOnDrag) && !panOnDrag.includes(event.button) && event.type === "mousedown") {
          return false;
        }
        const buttonAllowed = Array.isArray(panOnDrag) && panOnDrag.includes(event.button) || !event.button || event.button <= 1;
        return (!event.ctrlKey || isWheelEvent || panActivationKeyPressed) && buttonAllowed;
      };
    }
    function XYPanZoom({ domNode, minZoom, maxZoom, translateExtent, viewport, onPanZoom, onPanZoomStart, onPanZoomEnd, onDraggingChange }) {
      const zoomPanValues = {
        isZoomingOrPanning: false,
        usedRightMouseButton: false,
        prevViewport: {},
        mouseButton: 0,
        timerId: void 0,
        panScrollTimeout: void 0,
        isPanScrolling: false
      };
      const bbox = domNode.getBoundingClientRect();
      let cachedExtent = [
        [0, 0],
        [bbox.width, bbox.height]
      ];
      const extentResizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry?.contentRect) {
          cachedExtent = [
            [0, 0],
            [entry.contentRect.width, entry.contentRect.height]
          ];
        }
      }) : null;
      extentResizeObserver?.observe(domNode);
      const d3ZoomInstance = zoom2().extent(() => cachedExtent).scaleExtent([minZoom, maxZoom]).translateExtent(translateExtent);
      const d3Selection = select(domNode).call(d3ZoomInstance);
      setViewportConstrained({
        x: viewport.x,
        y: viewport.y,
        zoom: clamp(viewport.zoom, minZoom, maxZoom)
      }, [
        [0, 0],
        [bbox.width, bbox.height]
      ], translateExtent);
      const d3ZoomHandler = d3Selection.on("wheel.zoom");
      const d3DblClickZoomHandler = d3Selection.on("dblclick.zoom");
      d3ZoomInstance.wheelDelta(wheelDelta);
      async function setTransform(transform2, options) {
        if (d3Selection) {
          return new Promise((resolve) => {
            d3ZoomInstance?.interpolate(options?.interpolate === "linear" ? value : zoom).transform(getD3Transition(d3Selection, options?.duration, options?.ease, () => resolve(true)), transform2);
          });
        }
        return false;
      }
      function update({ noWheelClassName, noPanClassName, onPaneContextMenu, userSelectionActive, panOnScroll, panOnDrag, panOnScrollMode, panOnScrollSpeed, preventScrolling, zoomOnPinch, zoomOnScroll, zoomOnDoubleClick, panActivationKeyPressed = false, zoomActivationKeyPressed, lib, onTransformChange, connectionInProgress, paneClickDistance, selectionOnDrag }) {
        if (userSelectionActive && !zoomPanValues.isZoomingOrPanning) {
          d3ZoomInstance.on("zoom", null);
        }
        const isPanOnScroll = panOnScroll && !zoomActivationKeyPressed && !userSelectionActive;
        d3ZoomInstance.clickDistance(selectionOnDrag ? Infinity : !isNumeric(paneClickDistance) || paneClickDistance < 0 ? 0 : paneClickDistance);
        const wheelHandler = isPanOnScroll ? createPanOnScrollHandler({
          zoomPanValues,
          noWheelClassName,
          d3Selection,
          d3Zoom: d3ZoomInstance,
          panOnScrollMode,
          panOnScrollSpeed,
          zoomOnPinch,
          onPanZoomStart,
          onPanZoom,
          onPanZoomEnd
        }) : createZoomOnScrollHandler({
          noWheelClassName,
          preventScrolling,
          d3ZoomHandler
        });
        d3Selection.on("wheel.zoom", wheelHandler, { passive: false });
        const startHandler = createPanZoomStartHandler({
          zoomPanValues,
          onDraggingChange,
          onPanZoomStart
        });
        d3ZoomInstance.on("start", startHandler);
        const panZoomHandler = createPanZoomHandler({
          zoomPanValues,
          panOnDrag,
          onPaneContextMenu: !!onPaneContextMenu,
          onPanZoom,
          onTransformChange
        });
        d3ZoomInstance.on("zoom", panZoomHandler);
        const panZoomEndHandler = createPanZoomEndHandler({
          zoomPanValues,
          panOnDrag,
          panOnScroll,
          onPaneContextMenu,
          onPanZoomEnd,
          onDraggingChange
        });
        d3ZoomInstance.on("end", panZoomEndHandler);
        const filter2 = createFilter({
          panActivationKeyPressed,
          zoomActivationKeyPressed,
          panOnDrag,
          zoomOnScroll,
          panOnScroll,
          zoomOnDoubleClick,
          zoomOnPinch,
          userSelectionActive,
          noPanClassName,
          noWheelClassName,
          lib,
          connectionInProgress
        });
        d3ZoomInstance.filter(filter2);
        if (zoomOnDoubleClick) {
          d3Selection.on("dblclick.zoom", d3DblClickZoomHandler);
        } else {
          d3Selection.on("dblclick.zoom", null);
        }
      }
      function destroy() {
        d3ZoomInstance.on("zoom", null);
        extentResizeObserver?.disconnect();
      }
      async function setViewportConstrained(viewport2, extent, translateExtent2) {
        const nextTransform = viewportToTransform(viewport2);
        const contrainedTransform = d3ZoomInstance?.constrain()(nextTransform, extent, translateExtent2);
        if (contrainedTransform) {
          await setTransform(contrainedTransform);
        }
        return contrainedTransform;
      }
      async function setViewport(viewport2, options) {
        const nextTransform = viewportToTransform(viewport2);
        await setTransform(nextTransform, options);
        return nextTransform;
      }
      function syncViewport(viewport2) {
        if (d3Selection) {
          const nextTransform = viewportToTransform(viewport2);
          const currentTransform = d3Selection.property("__zoom");
          if (currentTransform.k !== viewport2.zoom || currentTransform.x !== viewport2.x || currentTransform.y !== viewport2.y) {
            d3ZoomInstance?.transform(d3Selection, nextTransform, null, { sync: true });
          }
        }
      }
      function getViewport() {
        const transform2 = d3Selection ? transform(d3Selection.node()) : { x: 0, y: 0, k: 1 };
        return { x: transform2.x, y: transform2.y, zoom: transform2.k };
      }
      async function scaleTo(zoom3, options) {
        if (d3Selection) {
          return new Promise((resolve) => {
            d3ZoomInstance?.interpolate(options?.interpolate === "linear" ? value : zoom).scaleTo(getD3Transition(d3Selection, options?.duration, options?.ease, () => resolve(true)), zoom3);
          });
        }
        return false;
      }
      async function scaleBy(factor, options) {
        if (d3Selection) {
          return new Promise((resolve) => {
            d3ZoomInstance?.interpolate(options?.interpolate === "linear" ? value : zoom).scaleBy(getD3Transition(d3Selection, options?.duration, options?.ease, () => resolve(true)), factor);
          });
        }
        return false;
      }
      function setScaleExtent(scaleExtent) {
        d3ZoomInstance?.scaleExtent(scaleExtent);
      }
      function setTranslateExtent(translateExtent2) {
        d3ZoomInstance?.translateExtent(translateExtent2);
      }
      function setClickDistance(distance2) {
        const validDistance = !isNumeric(distance2) || distance2 < 0 ? 0 : distance2;
        d3ZoomInstance?.clickDistance(validDistance);
      }
      return {
        update,
        destroy,
        setViewport,
        setViewportConstrained,
        getViewport,
        scaleTo,
        scaleBy,
        setScaleExtent,
        setTranslateExtent,
        syncViewport,
        setClickDistance
      };
    }
    var ResizeControlVariant;
    (function(ResizeControlVariant2) {
      ResizeControlVariant2["Line"] = "line";
      ResizeControlVariant2["Handle"] = "handle";
    })(ResizeControlVariant || (ResizeControlVariant = {}));
    function getResizeDirection({ width, prevWidth, height, prevHeight, affectsX, affectsY }) {
      const deltaWidth = width - prevWidth;
      const deltaHeight = height - prevHeight;
      const direction = [deltaWidth > 0 ? 1 : deltaWidth < 0 ? -1 : 0, deltaHeight > 0 ? 1 : deltaHeight < 0 ? -1 : 0];
      if (deltaWidth && affectsX) {
        direction[0] = direction[0] * -1;
      }
      if (deltaHeight && affectsY) {
        direction[1] = direction[1] * -1;
      }
      return direction;
    }
    function getControlDirection(controlPosition) {
      const isHorizontal = controlPosition.includes("right") || controlPosition.includes("left");
      const isVertical = controlPosition.includes("bottom") || controlPosition.includes("top");
      const affectsX = controlPosition.includes("left");
      const affectsY = controlPosition.includes("top");
      return {
        isHorizontal,
        isVertical,
        affectsX,
        affectsY
      };
    }
    function getLowerExtentClamp(lowerExtent, lowerBound) {
      return Math.max(0, lowerBound - lowerExtent);
    }
    function getUpperExtentClamp(upperExtent, upperBound) {
      return Math.max(0, upperExtent - upperBound);
    }
    function getSizeClamp(size, minSize, maxSize) {
      return Math.max(0, minSize - size, size - maxSize);
    }
    function xor(a, b) {
      return a ? !b : b;
    }
    function getDimensionsAfterResize(startValues, controlDirection, pointerPosition, boundaries, keepAspectRatio, nodeOrigin, extent, childExtent) {
      let { affectsX, affectsY } = controlDirection;
      const { isHorizontal, isVertical } = controlDirection;
      const isDiagonal = isHorizontal && isVertical;
      const { xSnapped, ySnapped } = pointerPosition;
      const { minWidth, maxWidth, minHeight, maxHeight } = boundaries;
      const { x: startX, y: startY, width: startWidth, height: startHeight, aspectRatio } = startValues;
      let distX = Math.floor(isHorizontal ? xSnapped - startValues.pointerX : 0);
      let distY = Math.floor(isVertical ? ySnapped - startValues.pointerY : 0);
      const newWidth = startWidth + (affectsX ? -distX : distX);
      const newHeight = startHeight + (affectsY ? -distY : distY);
      const originOffsetX = -nodeOrigin[0] * startWidth;
      const originOffsetY = -nodeOrigin[1] * startHeight;
      let clampX = getSizeClamp(newWidth, minWidth, maxWidth);
      let clampY = getSizeClamp(newHeight, minHeight, maxHeight);
      if (extent) {
        let xExtentClamp = 0;
        let yExtentClamp = 0;
        if (affectsX && distX < 0) {
          xExtentClamp = getLowerExtentClamp(startX + distX + originOffsetX, extent[0][0]);
        } else if (!affectsX && distX > 0) {
          xExtentClamp = getUpperExtentClamp(startX + newWidth + originOffsetX, extent[1][0]);
        }
        if (affectsY && distY < 0) {
          yExtentClamp = getLowerExtentClamp(startY + distY + originOffsetY, extent[0][1]);
        } else if (!affectsY && distY > 0) {
          yExtentClamp = getUpperExtentClamp(startY + newHeight + originOffsetY, extent[1][1]);
        }
        clampX = Math.max(clampX, xExtentClamp);
        clampY = Math.max(clampY, yExtentClamp);
      }
      if (childExtent) {
        let xExtentClamp = 0;
        let yExtentClamp = 0;
        if (affectsX && distX > 0) {
          xExtentClamp = getUpperExtentClamp(startX + distX, childExtent[0][0]);
        } else if (!affectsX && distX < 0) {
          xExtentClamp = getLowerExtentClamp(startX + newWidth, childExtent[1][0]);
        }
        if (affectsY && distY > 0) {
          yExtentClamp = getUpperExtentClamp(startY + distY, childExtent[0][1]);
        } else if (!affectsY && distY < 0) {
          yExtentClamp = getLowerExtentClamp(startY + newHeight, childExtent[1][1]);
        }
        clampX = Math.max(clampX, xExtentClamp);
        clampY = Math.max(clampY, yExtentClamp);
      }
      if (keepAspectRatio) {
        if (isHorizontal) {
          const aspectHeightClamp = getSizeClamp(newWidth / aspectRatio, minHeight, maxHeight) * aspectRatio;
          clampX = Math.max(clampX, aspectHeightClamp);
          if (extent) {
            let aspectExtentClamp = 0;
            if (!affectsX && !affectsY || affectsX && !affectsY && isDiagonal) {
              aspectExtentClamp = getUpperExtentClamp(startY + originOffsetY + newWidth / aspectRatio, extent[1][1]) * aspectRatio;
            } else {
              aspectExtentClamp = getLowerExtentClamp(startY + originOffsetY + (affectsX ? distX : -distX) / aspectRatio, extent[0][1]) * aspectRatio;
            }
            clampX = Math.max(clampX, aspectExtentClamp);
          }
          if (childExtent) {
            let aspectExtentClamp = 0;
            if (!affectsX && !affectsY || affectsX && !affectsY && isDiagonal) {
              aspectExtentClamp = getLowerExtentClamp(startY + newWidth / aspectRatio, childExtent[1][1]) * aspectRatio;
            } else {
              aspectExtentClamp = getUpperExtentClamp(startY + (affectsX ? distX : -distX) / aspectRatio, childExtent[0][1]) * aspectRatio;
            }
            clampX = Math.max(clampX, aspectExtentClamp);
          }
        }
        if (isVertical) {
          const aspectWidthClamp = getSizeClamp(newHeight * aspectRatio, minWidth, maxWidth) / aspectRatio;
          clampY = Math.max(clampY, aspectWidthClamp);
          if (extent) {
            let aspectExtentClamp = 0;
            if (!affectsX && !affectsY || affectsY && !affectsX && isDiagonal) {
              aspectExtentClamp = getUpperExtentClamp(startX + newHeight * aspectRatio + originOffsetX, extent[1][0]) / aspectRatio;
            } else {
              aspectExtentClamp = getLowerExtentClamp(startX + (affectsY ? distY : -distY) * aspectRatio + originOffsetX, extent[0][0]) / aspectRatio;
            }
            clampY = Math.max(clampY, aspectExtentClamp);
          }
          if (childExtent) {
            let aspectExtentClamp = 0;
            if (!affectsX && !affectsY || affectsY && !affectsX && isDiagonal) {
              aspectExtentClamp = getLowerExtentClamp(startX + newHeight * aspectRatio, childExtent[1][0]) / aspectRatio;
            } else {
              aspectExtentClamp = getUpperExtentClamp(startX + (affectsY ? distY : -distY) * aspectRatio, childExtent[0][0]) / aspectRatio;
            }
            clampY = Math.max(clampY, aspectExtentClamp);
          }
        }
      }
      distY = distY + (distY < 0 ? clampY : -clampY);
      distX = distX + (distX < 0 ? clampX : -clampX);
      if (keepAspectRatio) {
        if (isDiagonal) {
          if (newWidth > newHeight * aspectRatio) {
            distY = (xor(affectsX, affectsY) ? -distX : distX) / aspectRatio;
          } else {
            distX = (xor(affectsX, affectsY) ? -distY : distY) * aspectRatio;
          }
        } else {
          if (isHorizontal) {
            distY = distX / aspectRatio;
            affectsY = affectsX;
          } else {
            distX = distY * aspectRatio;
            affectsX = affectsY;
          }
        }
      }
      const x = affectsX ? startX + distX : startX;
      const y = affectsY ? startY + distY : startY;
      return {
        width: startWidth + (affectsX ? -distX : distX),
        height: startHeight + (affectsY ? -distY : distY),
        x: nodeOrigin[0] * distX * (!affectsX ? 1 : -1) + x,
        y: nodeOrigin[1] * distY * (!affectsY ? 1 : -1) + y
      };
    }
    var initPrevValues = { width: 0, height: 0, x: 0, y: 0 };
    var initStartValues = {
      ...initPrevValues,
      pointerX: 0,
      pointerY: 0,
      aspectRatio: 1
    };
    function nodeToChildExtent(child, parent, nodeOrigin) {
      const x = parent.position.x + child.position.x;
      const y = parent.position.y + child.position.y;
      const width = child.measured.width ?? 0;
      const height = child.measured.height ?? 0;
      const originOffsetX = nodeOrigin[0] * width;
      const originOffsetY = nodeOrigin[1] * height;
      return [
        [x - originOffsetX, y - originOffsetY],
        [x + width - originOffsetX, y + height - originOffsetY]
      ];
    }
    function XYResizer({ domNode, nodeId, getStoreItems, onChange, onEnd }) {
      const selection2 = select(domNode);
      let params = {
        controlDirection: getControlDirection("bottom-right"),
        boundaries: {
          minWidth: 0,
          minHeight: 0,
          maxWidth: Number.MAX_VALUE,
          maxHeight: Number.MAX_VALUE
        },
        resizeDirection: void 0,
        keepAspectRatio: false
      };
      function update({ controlPosition, boundaries, keepAspectRatio, resizeDirection, onResizeStart, onResize, onResizeEnd, shouldResize }) {
        let prevValues = { ...initPrevValues };
        let startValues = { ...initStartValues };
        params = {
          boundaries,
          resizeDirection,
          keepAspectRatio,
          controlDirection: getControlDirection(controlPosition)
        };
        let node = void 0;
        let containerBounds = null;
        let childNodes = [];
        let parentNode = void 0;
        let nodeExtent = void 0;
        let childExtent = void 0;
        const dragHandler = drag().on("start", (event) => {
          const { nodeLookup, transform: transform2, snapGrid, snapToGrid, nodeOrigin, paneDomNode } = getStoreItems();
          node = nodeLookup.get(nodeId);
          if (!node) {
            return;
          }
          containerBounds = paneDomNode?.getBoundingClientRect() ?? null;
          const { xSnapped, ySnapped } = getPointerPosition(event.sourceEvent, {
            transform: transform2,
            snapGrid,
            snapToGrid,
            containerBounds
          });
          prevValues = {
            width: node.measured.width ?? 0,
            height: node.measured.height ?? 0,
            x: node.position.x ?? 0,
            y: node.position.y ?? 0
          };
          startValues = {
            ...prevValues,
            pointerX: xSnapped,
            pointerY: ySnapped,
            aspectRatio: prevValues.width / prevValues.height
          };
          parentNode = void 0;
          nodeExtent = isCoordinateExtent(node.extent) ? node.extent : void 0;
          if (node.parentId && (node.extent === "parent" || node.expandParent)) {
            parentNode = nodeLookup.get(node.parentId);
          }
          if (parentNode && node.extent === "parent") {
            nodeExtent = [
              [0, 0],
              [parentNode.measured.width, parentNode.measured.height]
            ];
          }
          childNodes = [];
          childExtent = void 0;
          for (const [childId, child] of nodeLookup) {
            if (child.parentId === nodeId) {
              childNodes.push({
                id: childId,
                position: { ...child.position },
                extent: child.extent
              });
              if (child.extent === "parent" || child.expandParent) {
                const extent = nodeToChildExtent(child, node, child.origin ?? nodeOrigin);
                if (childExtent) {
                  childExtent = [
                    [Math.min(extent[0][0], childExtent[0][0]), Math.min(extent[0][1], childExtent[0][1])],
                    [Math.max(extent[1][0], childExtent[1][0]), Math.max(extent[1][1], childExtent[1][1])]
                  ];
                } else {
                  childExtent = extent;
                }
              }
            }
          }
          onResizeStart?.(event, { ...prevValues });
        }).on("drag", (event) => {
          const { transform: transform2, snapGrid, snapToGrid, nodeOrigin: storeNodeOrigin } = getStoreItems();
          const pointerPosition = getPointerPosition(event.sourceEvent, {
            transform: transform2,
            snapGrid,
            snapToGrid,
            containerBounds
          });
          const childChanges = [];
          if (!node) {
            return;
          }
          const { x: prevX, y: prevY, width: prevWidth, height: prevHeight } = prevValues;
          const change = {};
          const nodeOrigin = node.origin ?? storeNodeOrigin;
          const { width, height, x, y } = getDimensionsAfterResize(startValues, params.controlDirection, pointerPosition, params.boundaries, params.keepAspectRatio, nodeOrigin, nodeExtent, childExtent);
          const isWidthChange = width !== prevWidth;
          const isHeightChange = height !== prevHeight;
          const isXPosChange = x !== prevX && isWidthChange;
          const isYPosChange = y !== prevY && isHeightChange;
          if (!isXPosChange && !isYPosChange && !isWidthChange && !isHeightChange) {
            return;
          }
          const lastValid = {
            prevValues: { ...prevValues },
            startX: startValues.x,
            startY: startValues.y,
            childNodes: childNodes.map((child) => ({
              ...child,
              position: { ...child.position }
            }))
          };
          if (isXPosChange || isYPosChange || nodeOrigin[0] === 1 || nodeOrigin[1] === 1) {
            change.x = isXPosChange ? x : prevValues.x;
            change.y = isYPosChange ? y : prevValues.y;
            prevValues.x = change.x;
            prevValues.y = change.y;
            if (childNodes.length > 0) {
              const xChange = x - prevX;
              const yChange = y - prevY;
              for (const childNode of childNodes) {
                childNode.position = {
                  x: childNode.position.x - xChange + nodeOrigin[0] * (width - prevWidth),
                  y: childNode.position.y - yChange + nodeOrigin[1] * (height - prevHeight)
                };
                childChanges.push(childNode);
              }
            }
          }
          if (isWidthChange || isHeightChange) {
            change.width = isWidthChange && (!params.resizeDirection || params.resizeDirection === "horizontal") ? width : prevValues.width;
            change.height = isHeightChange && (!params.resizeDirection || params.resizeDirection === "vertical") ? height : prevValues.height;
            prevValues.width = change.width;
            prevValues.height = change.height;
          }
          if (parentNode && node.expandParent) {
            const xLimit = nodeOrigin[0] * (change.width ?? 0);
            if (change.x && change.x < xLimit) {
              prevValues.x = xLimit;
              startValues.x = startValues.x - (change.x - xLimit);
            }
            const yLimit = nodeOrigin[1] * (change.height ?? 0);
            if (change.y && change.y < yLimit) {
              prevValues.y = yLimit;
              startValues.y = startValues.y - (change.y - yLimit);
            }
          }
          const direction = getResizeDirection({
            width: prevValues.width,
            prevWidth,
            height: prevValues.height,
            prevHeight,
            affectsX: params.controlDirection.affectsX,
            affectsY: params.controlDirection.affectsY
          });
          const nextValues = { ...prevValues, direction };
          const callResize = shouldResize?.(event, nextValues);
          if (callResize === false) {
            prevValues = lastValid.prevValues;
            startValues.x = lastValid.startX;
            startValues.y = lastValid.startY;
            childNodes.forEach((child, i) => {
              child.position = lastValid.childNodes[i].position;
            });
            return;
          }
          onResize?.(event, nextValues);
          onChange(change, childChanges);
        }).on("end", (event) => {
          onResizeEnd?.(event, { ...prevValues });
          onEnd?.({ ...prevValues });
        });
        selection2.call(dragHandler);
      }
      function destroy() {
        selection2.on(".drag", null);
      }
      return {
        update,
        destroy
      };
    }

    // node_modules/.pnpm/zustand@4.5.7_@types+react@19.3.0/node_modules/zustand/esm/traditional.mjs
    var import_react = __toESM(require("react"), 1);
    var import_with_selector = __toESM(require_with_selector(), 1);

    // node_modules/.pnpm/zustand@4.5.7_@types+react@19.3.0/node_modules/zustand/esm/vanilla.mjs
    var import_meta = {};
    var createStoreImpl = (createState) => {
      let state;
      const listeners = /* @__PURE__ */ new Set();
      const setState = (partial, replace) => {
        const nextState = typeof partial === "function" ? partial(state) : partial;
        if (!Object.is(nextState, state)) {
          const previousState = state;
          state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
          listeners.forEach((listener) => listener(state, previousState));
        }
      };
      const getState = () => state;
      const getInitialState2 = () => initialState;
      const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      const destroy = () => {
        if ((import_meta.env ? import_meta.env.MODE : void 0) !== "production") {
          console.warn(
            "[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."
          );
        }
        listeners.clear();
      };
      const api = { setState, getState, getInitialState: getInitialState2, subscribe, destroy };
      const initialState = state = createState(setState, getState, api);
      return api;
    };
    var createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;

    // node_modules/.pnpm/zustand@4.5.7_@types+react@19.3.0/node_modules/zustand/esm/traditional.mjs
    var { useDebugValue } = import_react.default;
    var { useSyncExternalStoreWithSelector } = import_with_selector.default;
    var identity3 = (arg) => arg;
    function useStoreWithEqualityFn(api, selector2 = identity3, equalityFn) {
      const slice = useSyncExternalStoreWithSelector(
        api.subscribe,
        api.getState,
        api.getServerState || api.getInitialState,
        selector2,
        equalityFn
      );
      useDebugValue(slice);
      return slice;
    }
    var createWithEqualityFnImpl = (createState, defaultEqualityFn) => {
      const api = createStore(createState);
      const useBoundStoreWithEqualityFn = (selector2, equalityFn = defaultEqualityFn) => useStoreWithEqualityFn(api, selector2, equalityFn);
      Object.assign(useBoundStoreWithEqualityFn, api);
      return useBoundStoreWithEqualityFn;
    };
    var createWithEqualityFn = (createState, defaultEqualityFn) => createState ? createWithEqualityFnImpl(createState, defaultEqualityFn) : createWithEqualityFnImpl;

    // node_modules/.pnpm/zustand@4.5.7_@types+react@19.3.0/node_modules/zustand/esm/shallow.mjs
    function shallow$1(objA, objB) {
      if (Object.is(objA, objB)) {
        return true;
      }
      if (typeof objA !== "object" || objA === null || typeof objB !== "object" || objB === null) {
        return false;
      }
      if (objA instanceof Map && objB instanceof Map) {
        if (objA.size !== objB.size) return false;
        for (const [key, value2] of objA) {
          if (!Object.is(value2, objB.get(key))) {
            return false;
          }
        }
        return true;
      }
      if (objA instanceof Set && objB instanceof Set) {
        if (objA.size !== objB.size) return false;
        for (const value2 of objA) {
          if (!objB.has(value2)) {
            return false;
          }
        }
        return true;
      }
      const keysA = Object.keys(objA);
      if (keysA.length !== Object.keys(objB).length) {
        return false;
      }
      for (const keyA of keysA) {
        if (!Object.prototype.hasOwnProperty.call(objB, keyA) || !Object.is(objA[keyA], objB[keyA])) {
          return false;
        }
      }
      return true;
    }

    // node_modules/.pnpm/@xyflow+react@12.12.1_@type_79c3edc1609b0dbde12434fc5353f6b8/node_modules/@xyflow/react/dist/esm/index.js
    var import_react_dom = require("react-dom");
    var StoreContext = (0, import_react2.createContext)(null);
    var Provider$1 = StoreContext.Provider;
    var zustandErrorMessage = errorMessages["error001"]("react");
    function useStore(selector2, equalityFn) {
      const store = (0, import_react2.useContext)(StoreContext);
      if (store === null) {
        throw new Error(zustandErrorMessage);
      }
      return useStoreWithEqualityFn(store, selector2, equalityFn);
    }
    function useStoreApi() {
      const store = (0, import_react2.useContext)(StoreContext);
      if (store === null) {
        throw new Error(zustandErrorMessage);
      }
      return (0, import_react2.useMemo)(() => ({
        getState: store.getState,
        setState: store.setState,
        subscribe: store.subscribe
      }), [store]);
    }
    var style = { display: "none" };
    var ariaLiveStyle = {
      position: "absolute",
      width: 1,
      height: 1,
      margin: -1,
      border: 0,
      padding: 0,
      overflow: "hidden",
      clip: "rect(0px, 0px, 0px, 0px)",
      clipPath: "inset(100%)"
    };
    var ARIA_NODE_DESC_KEY = "react-flow__node-desc";
    var ARIA_EDGE_DESC_KEY = "react-flow__edge-desc";
    var ARIA_LIVE_MESSAGE = "react-flow__aria-live";
    var ariaLiveSelector = (s) => s.ariaLiveMessage;
    var ariaLabelConfigSelector = (s) => s.ariaLabelConfig;
    function AriaLiveMessage({ rfId }) {
      const ariaLiveMessage = useStore(ariaLiveSelector);
      return (0, import_jsx_runtime.jsx)("div", { id: `${ARIA_LIVE_MESSAGE}-${rfId}`, "aria-live": "assertive", "aria-atomic": "true", style: ariaLiveStyle, children: ariaLiveMessage });
    }
    function A11yDescriptions({ rfId, disableKeyboardA11y }) {
      const ariaLabelConfig = useStore(ariaLabelConfigSelector);
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(0, import_jsx_runtime.jsx)("div", { id: `${ARIA_NODE_DESC_KEY}-${rfId}`, style, children: disableKeyboardA11y ? ariaLabelConfig["node.a11yDescription.default"] : ariaLabelConfig["node.a11yDescription.keyboardDisabled"] }), (0, import_jsx_runtime.jsx)("div", { id: `${ARIA_EDGE_DESC_KEY}-${rfId}`, style, children: ariaLabelConfig["edge.a11yDescription.default"] }), !disableKeyboardA11y && (0, import_jsx_runtime.jsx)(AriaLiveMessage, { rfId })] });
    }
    var Panel = (0, import_react2.forwardRef)(({ position = "top-left", children: children2, className, style: style2, ...rest }, ref) => {
      const positionClasses = `${position}`.split("-");
      return (0, import_jsx_runtime.jsx)("div", { className: cc(["react-flow__panel", className, ...positionClasses]), style: style2, ref, ...rest, children: children2 });
    });
    Panel.displayName = "Panel";
    var link = `https://reactflow.dev${false ? "?utm_source=attribution" : "/attribution"}`;
    function Attribution({ proOptions, position = "bottom-right" }) {
      (0, import_react2.useEffect)(() => {
        if (false) {
          return;
        }
        handleAttributionWarning("react");
      }, []);
      if (proOptions?.hideAttribution) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)(Panel, { position, className: "react-flow__attribution", "data-message": `Please only hide this attribution when you are subscribed to React Flow Pro: ${link}`, children: (0, import_jsx_runtime.jsx)("a", { href: link, target: "_blank", rel: "noopener noreferrer", "aria-label": "React Flow attribution", children: "React Flow" }) });
    }
    var selector$l = (s) => {
      const selectedNodes = [];
      const selectedEdges = [];
      for (const [, node] of s.nodeLookup) {
        if (node.selected) {
          selectedNodes.push(node.internals.userNode);
        }
      }
      for (const [, edge2] of s.edgeLookup) {
        if (edge2.selected) {
          selectedEdges.push(edge2);
        }
      }
      return { selectedNodes, selectedEdges };
    };
    var selectId = (obj) => obj.id;
    function areEqual$1(a, b) {
      return shallow$1(a.selectedNodes.map(selectId), b.selectedNodes.map(selectId)) && shallow$1(a.selectedEdges.map(selectId), b.selectedEdges.map(selectId));
    }
    function SelectionListenerInner({ onSelectionChange }) {
      const store = useStoreApi();
      const { selectedNodes, selectedEdges } = useStore(selector$l, areEqual$1);
      (0, import_react2.useEffect)(() => {
        const params = { nodes: selectedNodes, edges: selectedEdges };
        onSelectionChange?.(params);
        store.getState().onSelectionChangeHandlers.forEach((fn) => fn(params));
      }, [selectedNodes, selectedEdges, onSelectionChange]);
      return null;
    }
    var changeSelector = (s) => !!s.onSelectionChangeHandlers;
    function SelectionListener({ onSelectionChange }) {
      const storeHasSelectionChangeHandlers = useStore(changeSelector);
      if (onSelectionChange || storeHasSelectionChangeHandlers) {
        return (0, import_jsx_runtime.jsx)(SelectionListenerInner, { onSelectionChange });
      }
      return null;
    }
    var defaultNodeOrigin = [0, 0];
    var defaultViewport = { x: 0, y: 0, zoom: 1 };
    var reactFlowFieldsToTrack = [
      "nodes",
      "edges",
      "defaultNodes",
      "defaultEdges",
      "onConnect",
      "onConnectStart",
      "onConnectEnd",
      "onClickConnectStart",
      "onClickConnectEnd",
      "nodesDraggable",
      "autoPanOnNodeFocus",
      "nodesConnectable",
      "nodesFocusable",
      "edgesFocusable",
      "edgesReconnectable",
      "elevateNodesOnSelect",
      "elevateEdgesOnSelect",
      "minZoom",
      "maxZoom",
      "nodeExtent",
      "onNodesChange",
      "onEdgesChange",
      "elementsSelectable",
      "connectionMode",
      "snapGrid",
      "snapToGrid",
      "translateExtent",
      "connectOnClick",
      "defaultEdgeOptions",
      "fitView",
      "fitViewOptions",
      "onNodesDelete",
      "onEdgesDelete",
      "onDelete",
      "onNodeDrag",
      "onNodeDragStart",
      "onNodeDragStop",
      "onSelectionDrag",
      "onSelectionDragStart",
      "onSelectionDragStop",
      "onMoveStart",
      "onMove",
      "onMoveEnd",
      "noPanClassName",
      "nodeOrigin",
      "autoPanOnConnect",
      "autoPanOnNodeDrag",
      "onError",
      "connectionRadius",
      "isValidConnection",
      "selectNodesOnDrag",
      "nodeDragThreshold",
      "connectionDragThreshold",
      "onBeforeDelete",
      "debug",
      "autoPanSpeed",
      "ariaLabelConfig",
      "zIndexMode"
    ];
    var fieldsToTrack = [...reactFlowFieldsToTrack, "rfId"];
    var selector$k = (s) => ({
      setNodes: s.setNodes,
      setEdges: s.setEdges,
      setMinZoom: s.setMinZoom,
      setMaxZoom: s.setMaxZoom,
      setTranslateExtent: s.setTranslateExtent,
      setNodeExtent: s.setNodeExtent,
      reset: s.reset,
      setDefaultNodesAndEdges: s.setDefaultNodesAndEdges
    });
    var initPrevValues2 = {
      /*
       * these are values that are also passed directly to other components
       * than the StoreUpdater. We can reduce the number of setStore calls
       * by setting the same values here as prev fields.
       */
      translateExtent: infiniteExtent,
      nodeOrigin: defaultNodeOrigin,
      minZoom: 0.5,
      maxZoom: 2,
      elementsSelectable: true,
      noPanClassName: "nopan",
      rfId: "1"
    };
    function StoreUpdater(props) {
      const { setNodes, setEdges, setMinZoom, setMaxZoom, setTranslateExtent, setNodeExtent, reset, setDefaultNodesAndEdges } = useStore(selector$k, shallow$1);
      const store = useStoreApi();
      (0, import_react2.useEffect)(() => {
        setDefaultNodesAndEdges(props.defaultNodes, props.defaultEdges);
        return () => {
          previousFields.current = initPrevValues2;
          reset();
        };
      }, []);
      const previousFields = (0, import_react2.useRef)(initPrevValues2);
      (0, import_react2.useEffect)(
        () => {
          for (const fieldName of fieldsToTrack) {
            const fieldValue = props[fieldName];
            const previousFieldValue = previousFields.current[fieldName];
            if (fieldValue === previousFieldValue)
              continue;
            if (typeof props[fieldName] === "undefined")
              continue;
            if (fieldName === "nodes")
              setNodes(fieldValue);
            else if (fieldName === "edges")
              setEdges(fieldValue);
            else if (fieldName === "minZoom")
              setMinZoom(fieldValue);
            else if (fieldName === "maxZoom")
              setMaxZoom(fieldValue);
            else if (fieldName === "translateExtent")
              setTranslateExtent(fieldValue);
            else if (fieldName === "nodeExtent")
              setNodeExtent(fieldValue);
            else if (fieldName === "ariaLabelConfig")
              store.setState({ ariaLabelConfig: mergeAriaLabelConfig(fieldValue) });
            else if (fieldName === "fitView")
              store.setState({ fitViewQueued: fieldValue });
            else if (fieldName === "fitViewOptions")
              store.setState({ fitViewOptions: fieldValue });
            else
              store.setState({ [fieldName]: fieldValue });
          }
          previousFields.current = props;
        },
        // Only re-run the effect if one of the fields we track changes
        fieldsToTrack.map((fieldName) => props[fieldName])
      );
      return null;
    }
    function getMediaQuery() {
      if (typeof window === "undefined" || !window.matchMedia) {
        return null;
      }
      return window.matchMedia("(prefers-color-scheme: dark)");
    }
    function useColorModeClass(colorMode) {
      const [colorModeClass, setColorModeClass] = (0, import_react2.useState)(colorMode === "system" ? null : colorMode);
      (0, import_react2.useEffect)(() => {
        if (colorMode !== "system") {
          setColorModeClass(colorMode);
          return;
        }
        const mediaQuery = getMediaQuery();
        const updateColorModeClass = () => setColorModeClass(mediaQuery?.matches ? "dark" : "light");
        updateColorModeClass();
        mediaQuery?.addEventListener("change", updateColorModeClass);
        return () => {
          mediaQuery?.removeEventListener("change", updateColorModeClass);
        };
      }, [colorMode]);
      return colorModeClass !== null ? colorModeClass : getMediaQuery()?.matches ? "dark" : "light";
    }
    var defaultDoc = typeof document !== "undefined" ? document : null;
    function useKeyPress(keyCode = null, options = { target: defaultDoc, actInsideInputWithModifier: true }) {
      const [keyPressed, setKeyPressed] = (0, import_react2.useState)(false);
      const modifierPressed = (0, import_react2.useRef)(false);
      const pressedKeys = (0, import_react2.useRef)(/* @__PURE__ */ new Set([]));
      const [keyCodes, keysToWatch] = (0, import_react2.useMemo)(() => {
        if (keyCode !== null) {
          const keyCodeArr = Array.isArray(keyCode) ? keyCode : [keyCode];
          const keys = keyCodeArr.filter((kc) => typeof kc === "string").map((kc) => kc.replace(/\+/g, "\n").replace("\n\n", "\n+").split("\n"));
          const keysFlat = keys.reduce((res, item) => res.concat(...item), []);
          return [keys, keysFlat];
        }
        return [[], []];
      }, [keyCode]);
      (0, import_react2.useEffect)(() => {
        const target = options?.target ?? defaultDoc;
        const actInsideInputWithModifier = options?.actInsideInputWithModifier ?? true;
        if (keyCode !== null) {
          const downHandler = (event) => {
            modifierPressed.current = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
            const preventAction = (!modifierPressed.current || modifierPressed.current && !actInsideInputWithModifier) && isInputDOMNode(event);
            if (preventAction) {
              return false;
            }
            const keyOrCode = useKeyOrCode(event.code, keysToWatch);
            pressedKeys.current.add(event[keyOrCode]);
            if (isMatchingKey(keyCodes, pressedKeys.current, false)) {
              const target2 = event.composedPath?.()?.[0] || event.target;
              const isInteractiveElement = target2?.nodeName === "BUTTON" || target2?.nodeName === "A";
              if (options.preventDefault !== false && (modifierPressed.current || !isInteractiveElement)) {
                event.preventDefault();
              }
              setKeyPressed(true);
            }
          };
          const upHandler = (event) => {
            const keyOrCode = useKeyOrCode(event.code, keysToWatch);
            if (isMatchingKey(keyCodes, pressedKeys.current, true)) {
              setKeyPressed(false);
              pressedKeys.current.clear();
            } else {
              pressedKeys.current.delete(event[keyOrCode]);
            }
            if (event.key === "Meta") {
              pressedKeys.current.clear();
            }
            modifierPressed.current = false;
          };
          const resetHandler = () => {
            pressedKeys.current.clear();
            setKeyPressed(false);
          };
          target?.addEventListener("keydown", downHandler);
          target?.addEventListener("keyup", upHandler);
          window.addEventListener("blur", resetHandler);
          window.addEventListener("contextmenu", resetHandler);
          return () => {
            target?.removeEventListener("keydown", downHandler);
            target?.removeEventListener("keyup", upHandler);
            window.removeEventListener("blur", resetHandler);
            window.removeEventListener("contextmenu", resetHandler);
          };
        }
      }, [keyCode, setKeyPressed]);
      return keyPressed;
    }
    function isMatchingKey(keyCodes, pressedKeys, isUp) {
      return keyCodes.filter((keys) => isUp || keys.length === pressedKeys.size).some((keys) => keys.every((k) => pressedKeys.has(k)));
    }
    function useKeyOrCode(eventCode, keysToWatch) {
      return keysToWatch.includes(eventCode) ? "code" : "key";
    }
    var useViewportHelper = () => {
      const store = useStoreApi();
      return (0, import_react2.useMemo)(() => {
        return {
          zoomIn: async (options) => {
            const { panZoom } = store.getState();
            return panZoom ? panZoom.scaleBy(1.2, options) : false;
          },
          zoomOut: async (options) => {
            const { panZoom } = store.getState();
            return panZoom ? panZoom.scaleBy(1 / 1.2, options) : false;
          },
          zoomTo: async (zoomLevel, options) => {
            const { panZoom } = store.getState();
            return panZoom ? panZoom.scaleTo(zoomLevel, options) : false;
          },
          getZoom: () => store.getState().transform[2],
          setViewport: async (viewport, options) => {
            const { transform: [tX, tY, tZoom], panZoom } = store.getState();
            if (!panZoom) {
              return false;
            }
            await panZoom.setViewport({
              x: viewport.x ?? tX,
              y: viewport.y ?? tY,
              zoom: viewport.zoom ?? tZoom
            }, options);
            return true;
          },
          getViewport: () => {
            const [x, y, zoom3] = store.getState().transform;
            return { x, y, zoom: zoom3 };
          },
          setCenter: async (x, y, options) => {
            return store.getState().setCenter(x, y, options);
          },
          fitBounds: async (bounds, options) => {
            const { width, height, minZoom, maxZoom, panZoom } = store.getState();
            const viewport = getViewportForBounds(bounds, width, height, minZoom, maxZoom, options?.padding ?? 0.1);
            if (!panZoom) {
              return false;
            }
            await panZoom.setViewport(viewport, {
              duration: options?.duration,
              ease: options?.ease,
              interpolate: options?.interpolate
            });
            return true;
          },
          screenToFlowPosition: (clientPosition, options = {}) => {
            const { transform: transform2, snapGrid, snapToGrid, domNode } = store.getState();
            if (!domNode) {
              return clientPosition;
            }
            const { x: domX, y: domY } = domNode.getBoundingClientRect();
            const correctedPosition = {
              x: clientPosition.x - domX,
              y: clientPosition.y - domY
            };
            const _snapGrid = options.snapGrid ?? snapGrid;
            const _snapToGrid = options.snapToGrid ?? snapToGrid;
            return pointToRendererPoint(correctedPosition, transform2, _snapToGrid, _snapGrid);
          },
          flowToScreenPosition: (flowPosition) => {
            const { transform: transform2, domNode } = store.getState();
            if (!domNode) {
              return flowPosition;
            }
            const { x: domX, y: domY } = domNode.getBoundingClientRect();
            const rendererPosition = rendererPointToPoint(flowPosition, transform2);
            return {
              x: rendererPosition.x + domX,
              y: rendererPosition.y + domY
            };
          }
        };
      }, []);
    };
    function applyChanges(changes, elements) {
      const updatedElements = [];
      const changesMap = /* @__PURE__ */ new Map();
      const addItemChanges = [];
      for (const change of changes) {
        if (change.type === "add") {
          addItemChanges.push(change);
          continue;
        } else if (change.type === "remove" || change.type === "replace") {
          changesMap.set(change.id, [change]);
        } else {
          const elementChanges = changesMap.get(change.id);
          if (elementChanges) {
            elementChanges.push(change);
          } else {
            changesMap.set(change.id, [change]);
          }
        }
      }
      for (const element of elements) {
        const changes2 = changesMap.get(element.id);
        if (!changes2) {
          updatedElements.push(element);
          continue;
        }
        if (changes2[0].type === "remove") {
          continue;
        }
        if (changes2[0].type === "replace") {
          updatedElements.push({ ...changes2[0].item });
          continue;
        }
        const updatedElement = { ...element };
        for (const change of changes2) {
          applyChange(change, updatedElement);
        }
        updatedElements.push(updatedElement);
      }
      if (addItemChanges.length) {
        addItemChanges.forEach((change) => {
          if (change.index !== void 0) {
            updatedElements.splice(change.index, 0, { ...change.item });
          } else {
            updatedElements.push({ ...change.item });
          }
        });
      }
      return updatedElements;
    }
    function applyChange(change, element) {
      switch (change.type) {
        case "select": {
          element.selected = change.selected;
          break;
        }
        case "position": {
          if (typeof change.position !== "undefined") {
            element.position = change.position;
          }
          if (typeof change.dragging !== "undefined") {
            element.dragging = change.dragging;
          }
          break;
        }
        case "dimensions": {
          if (typeof change.dimensions !== "undefined") {
            element.measured = {
              ...change.dimensions
            };
            if (change.setAttributes) {
              if (change.setAttributes === true || change.setAttributes === "width") {
                element.width = change.dimensions.width;
              }
              if (change.setAttributes === true || change.setAttributes === "height") {
                element.height = change.dimensions.height;
              }
            }
          }
          if (typeof change.resizing === "boolean") {
            element.resizing = change.resizing;
          }
          break;
        }
      }
    }
    function applyNodeChanges(changes, nodes) {
      return applyChanges(changes, nodes);
    }
    function applyEdgeChanges(changes, edges) {
      return applyChanges(changes, edges);
    }
    function createSelectionChange(id2, selected2) {
      return {
        id: id2,
        type: "select",
        selected: selected2
      };
    }
    function getSelectionChanges(items, selectedIds = /* @__PURE__ */ new Set()) {
      const changes = [];
      for (const [id2, item] of items) {
        const willBeSelected = selectedIds.has(id2);
        if (!(item.selected === void 0 && !willBeSelected) && item.selected !== willBeSelected) {
          changes.push(createSelectionChange(item.id, willBeSelected));
        }
      }
      return changes;
    }
    function getElementsDiffChanges({ items = [], lookup }) {
      const changes = [];
      const itemsLookup = new Map(items.map((item) => [item.id, item]));
      for (const [index2, item] of items.entries()) {
        const lookupItem = lookup.get(item.id);
        const storeItem = lookupItem?.internals?.userNode ?? lookupItem;
        if (storeItem !== void 0 && storeItem !== item) {
          changes.push({ id: item.id, item, type: "replace" });
        }
        if (storeItem === void 0) {
          changes.push({ item, type: "add", index: index2 });
        }
      }
      for (const [id2] of lookup) {
        const nextNode = itemsLookup.get(id2);
        if (nextNode === void 0) {
          changes.push({ id: id2, type: "remove" });
        }
      }
      return changes;
    }
    function elementToRemoveChange(item) {
      return {
        id: item.id,
        type: "remove"
      };
    }
    var defaultOnError = createDevWarn("React Flow", "https://reactflow.dev/");
    function addEdge2(edgeParams, edges, options = {}) {
      return addEdge(edgeParams, edges, {
        ...options,
        onError: options.onError ?? defaultOnError
      });
    }
    var isNode = (element) => isNodeBase(element);
    var isEdge = (element) => isEdgeBase(element);
    function fixedForwardRef(render) {
      return (0, import_react2.forwardRef)(render);
    }
    var useIsomorphicLayoutEffect = typeof window !== "undefined" ? import_react2.useLayoutEffect : import_react2.useEffect;
    function useQueue(runQueue) {
      const [serial, setSerial] = (0, import_react2.useState)(BigInt(0));
      const [queue] = (0, import_react2.useState)(() => createQueue(() => setSerial((n) => n + BigInt(1))));
      useIsomorphicLayoutEffect(() => {
        const queueItems = queue.get();
        if (queueItems.length) {
          runQueue(queueItems);
          queue.reset();
        }
      }, [serial]);
      return queue;
    }
    function createQueue(cb) {
      let queue = [];
      return {
        get: () => queue,
        reset: () => {
          queue = [];
        },
        push: (item) => {
          queue.push(item);
          cb();
        }
      };
    }
    var BatchContext = (0, import_react2.createContext)(null);
    function BatchProvider({ children: children2 }) {
      const store = useStoreApi();
      const nodeQueueHandler = (0, import_react2.useCallback)((queueItems) => {
        const { nodes = [], setNodes, hasDefaultNodes, onNodesChange, nodeLookup, fitViewQueued, onNodesChangeMiddlewareMap } = store.getState();
        let next = nodes;
        for (const payload of queueItems) {
          next = typeof payload === "function" ? payload(next) : payload;
        }
        let changes = getElementsDiffChanges({
          items: next,
          lookup: nodeLookup
        });
        for (const middleware of onNodesChangeMiddlewareMap.values()) {
          changes = middleware(changes);
        }
        if (hasDefaultNodes) {
          setNodes(next);
        }
        if (changes.length > 0) {
          onNodesChange?.(changes);
        } else if (fitViewQueued) {
          window.requestAnimationFrame(() => {
            const { fitViewQueued: fitViewQueued2, nodes: nodes2, setNodes: setNodes2 } = store.getState();
            if (fitViewQueued2) {
              setNodes2(nodes2);
            }
          });
        }
      }, []);
      const nodeQueue = useQueue(nodeQueueHandler);
      const edgeQueueHandler = (0, import_react2.useCallback)((queueItems) => {
        const { edges = [], setEdges, hasDefaultEdges, onEdgesChange, edgeLookup } = store.getState();
        let next = edges;
        for (const payload of queueItems) {
          next = typeof payload === "function" ? payload(next) : payload;
        }
        if (hasDefaultEdges) {
          setEdges(next);
        } else if (onEdgesChange) {
          onEdgesChange(getElementsDiffChanges({
            items: next,
            lookup: edgeLookup
          }));
        }
      }, []);
      const edgeQueue = useQueue(edgeQueueHandler);
      const value2 = (0, import_react2.useMemo)(() => ({ nodeQueue, edgeQueue }), []);
      return (0, import_jsx_runtime.jsx)(BatchContext.Provider, { value: value2, children: children2 });
    }
    function useBatchContext() {
      const batchContext = (0, import_react2.useContext)(BatchContext);
      if (!batchContext) {
        throw new Error("useBatchContext must be used within a BatchProvider");
      }
      return batchContext;
    }
    var selector$j = (s) => !!s.panZoom;
    function useReactFlow() {
      const viewportHelper = useViewportHelper();
      const store = useStoreApi();
      const batchContext = useBatchContext();
      const viewportInitialized = useStore(selector$j);
      const generalHelper = (0, import_react2.useMemo)(() => {
        const getInternalNode = (id2) => store.getState().nodeLookup.get(id2);
        const setNodes = (payload) => {
          batchContext.nodeQueue.push(payload);
        };
        const setEdges = (payload) => {
          batchContext.edgeQueue.push(payload);
        };
        const getNodeRect = (node) => {
          const { nodeLookup, nodeOrigin } = store.getState();
          const nodeToUse = isNode(node) ? node : nodeLookup.get(node.id);
          const position = nodeToUse.parentId ? evaluateAbsolutePosition(nodeToUse.position, nodeToUse.measured, nodeToUse.parentId, nodeLookup, nodeOrigin) : nodeToUse.position;
          const nodeWithPosition = {
            ...nodeToUse,
            position,
            width: nodeToUse.measured?.width ?? nodeToUse.width,
            height: nodeToUse.measured?.height ?? nodeToUse.height
          };
          return nodeToRect(nodeWithPosition, nodeToUse.parentId ? void 0 : nodeOrigin);
        };
        const updateNode = (id2, nodeUpdate, options = { replace: false }) => {
          setNodes((prevNodes) => prevNodes.map((node) => {
            if (node.id === id2) {
              const nextNode = typeof nodeUpdate === "function" ? nodeUpdate(node) : nodeUpdate;
              return options.replace && isNode(nextNode) ? nextNode : { ...node, ...nextNode };
            }
            return node;
          }));
        };
        const updateEdge = (id2, edgeUpdate, options = { replace: false }) => {
          setEdges((prevEdges) => prevEdges.map((edge2) => {
            if (edge2.id === id2) {
              const nextEdge = typeof edgeUpdate === "function" ? edgeUpdate(edge2) : edgeUpdate;
              return options.replace && isEdge(nextEdge) ? nextEdge : { ...edge2, ...nextEdge };
            }
            return edge2;
          }));
        };
        return {
          getNodes: () => store.getState().nodes.map((n) => ({ ...n })),
          getNode: (id2) => getInternalNode(id2)?.internals.userNode,
          getInternalNode,
          getEdges: () => {
            const { edges = [] } = store.getState();
            return edges.map((e) => ({ ...e }));
          },
          getEdge: (id2) => store.getState().edgeLookup.get(id2),
          setNodes,
          setEdges,
          addNodes: (payload) => {
            const newNodes = Array.isArray(payload) ? payload : [payload];
            batchContext.nodeQueue.push((nodes) => [...nodes, ...newNodes]);
          },
          addEdges: (payload) => {
            const newEdges = Array.isArray(payload) ? payload : [payload];
            batchContext.edgeQueue.push((edges) => [...edges, ...newEdges]);
          },
          toObject: () => {
            const { nodes = [], edges = [], transform: transform2 } = store.getState();
            const [x, y, zoom3] = transform2;
            return {
              nodes: nodes.map((n) => ({ ...n })),
              edges: edges.map((e) => ({ ...e })),
              viewport: {
                x,
                y,
                zoom: zoom3
              }
            };
          },
          deleteElements: async ({ nodes: nodesToRemove = [], edges: edgesToRemove = [] }) => {
            const { nodes, edges, onNodesDelete, onEdgesDelete, triggerNodeChanges, triggerEdgeChanges, onDelete, onBeforeDelete } = store.getState();
            const { nodes: matchingNodes, edges: matchingEdges } = await getElementsToRemove({
              nodesToRemove,
              edgesToRemove,
              nodes,
              edges,
              onBeforeDelete
            });
            const hasMatchingEdges = matchingEdges.length > 0;
            const hasMatchingNodes = matchingNodes.length > 0;
            if (hasMatchingEdges) {
              const edgeChanges = matchingEdges.map(elementToRemoveChange);
              onEdgesDelete?.(matchingEdges);
              triggerEdgeChanges(edgeChanges);
            }
            if (hasMatchingNodes) {
              const nodeChanges = matchingNodes.map(elementToRemoveChange);
              onNodesDelete?.(matchingNodes);
              triggerNodeChanges(nodeChanges);
            }
            if (hasMatchingNodes || hasMatchingEdges) {
              onDelete?.({ nodes: matchingNodes, edges: matchingEdges });
            }
            return { deletedNodes: matchingNodes, deletedEdges: matchingEdges };
          },
          /**
           * Partial is defined as "the 2 nodes/areas are intersecting partially".
           * If a is contained in b or b is contained in a, they are both
           * considered fully intersecting.
           */
          getIntersectingNodes: (nodeOrRect, partially = true, nodes) => {
            const isRect = isRectObject(nodeOrRect);
            const nodeRect = isRect ? nodeOrRect : getNodeRect(nodeOrRect);
            const hasNodesOption = nodes !== void 0;
            if (!nodeRect) {
              return [];
            }
            const { nodeOrigin } = store.getState();
            return (nodes || store.getState().nodes).filter((n) => {
              const internalNode = store.getState().nodeLookup.get(n.id);
              if (internalNode && !isRect && (n.id === nodeOrRect.id || !internalNode.internals.positionAbsolute)) {
                return false;
              }
              const currNodeRect = nodeToRect(hasNodesOption ? n : internalNode, nodeOrigin);
              const overlappingArea = getOverlappingArea(currNodeRect, nodeRect);
              const partiallyVisible = partially && overlappingArea > 0;
              return partiallyVisible || overlappingArea >= currNodeRect.width * currNodeRect.height || overlappingArea >= nodeRect.width * nodeRect.height;
            });
          },
          isNodeIntersecting: (nodeOrRect, area, partially = true) => {
            const isRect = isRectObject(nodeOrRect);
            const nodeRect = isRect ? nodeOrRect : getNodeRect(nodeOrRect);
            if (!nodeRect) {
              return false;
            }
            const overlappingArea = getOverlappingArea(nodeRect, area);
            const partiallyVisible = partially && overlappingArea > 0;
            return partiallyVisible || overlappingArea >= area.width * area.height || overlappingArea >= nodeRect.width * nodeRect.height;
          },
          updateNode,
          updateNodeData: (id2, dataUpdate, options = { replace: false }) => {
            updateNode(id2, (node) => {
              const nextData = typeof dataUpdate === "function" ? dataUpdate(node) : dataUpdate;
              return options.replace ? { ...node, data: nextData } : { ...node, data: { ...node.data, ...nextData } };
            }, options);
          },
          updateEdge,
          updateEdgeData: (id2, dataUpdate, options = { replace: false }) => {
            updateEdge(id2, (edge2) => {
              const nextData = typeof dataUpdate === "function" ? dataUpdate(edge2) : dataUpdate;
              return options.replace ? { ...edge2, data: nextData } : { ...edge2, data: { ...edge2.data, ...nextData } };
            }, options);
          },
          getNodesBounds: (nodes) => {
            const { nodeLookup, nodeOrigin } = store.getState();
            return getNodesBounds(nodes, { nodeLookup, nodeOrigin });
          },
          getHandleConnections: ({ type, id: id2, nodeId }) => Array.from(store.getState().connectionLookup.get(`${nodeId}-${type}${id2 ? `-${id2}` : ""}`)?.values() ?? []),
          getNodeConnections: ({ type, handleId, nodeId }) => Array.from(store.getState().connectionLookup.get(`${nodeId}${type ? handleId ? `-${type}-${handleId}` : `-${type}` : ""}`)?.values() ?? []),
          fitView: async (options) => {
            const fitViewResolver = store.getState().fitViewResolver ?? withResolvers();
            store.setState({ fitViewQueued: true, fitViewOptions: options, fitViewResolver });
            batchContext.nodeQueue.push((nodes) => [...nodes]);
            return fitViewResolver.promise;
          }
        };
      }, []);
      return (0, import_react2.useMemo)(() => {
        return {
          ...generalHelper,
          ...viewportHelper,
          viewportInitialized
        };
      }, [viewportInitialized]);
    }
    var selected = (item) => item.selected;
    var win$1 = typeof window !== "undefined" ? window : void 0;
    function useGlobalKeyHandler({ deleteKeyCode, multiSelectionKeyCode }) {
      const store = useStoreApi();
      const { deleteElements } = useReactFlow();
      const deleteKeyPressed = useKeyPress(deleteKeyCode, { actInsideInputWithModifier: false });
      const multiSelectionKeyPressed = useKeyPress(multiSelectionKeyCode, { target: win$1 });
      (0, import_react2.useEffect)(() => {
        if (deleteKeyPressed) {
          const { edges, nodes } = store.getState();
          deleteElements({ nodes: nodes.filter(selected), edges: edges.filter(selected) });
          store.setState({ nodesSelectionActive: false });
        }
      }, [deleteKeyPressed]);
      (0, import_react2.useEffect)(() => {
        store.setState({ multiSelectionActive: multiSelectionKeyPressed });
      }, [multiSelectionKeyPressed]);
    }
    function useResizeHandler(domNode) {
      const store = useStoreApi();
      (0, import_react2.useEffect)(() => {
        const updateDimensions = () => {
          if (!domNode.current || !(domNode.current.checkVisibility?.() ?? true)) {
            return false;
          }
          const size = getDimensions(domNode.current);
          if (size.height === 0 || size.width === 0) {
            store.getState().onError?.("004", errorMessages["error004"]());
          }
          store.setState({ width: size.width || 500, height: size.height || 500 });
        };
        if (domNode.current) {
          updateDimensions();
          window.addEventListener("resize", updateDimensions);
          const resizeObserver = new ResizeObserver(() => updateDimensions());
          resizeObserver.observe(domNode.current);
          return () => {
            window.removeEventListener("resize", updateDimensions);
            resizeObserver.disconnect();
          };
        }
      }, []);
    }
    var containerStyle = {
      position: "absolute",
      width: "100%",
      height: "100%",
      top: 0,
      left: 0
    };
    var selector$i = (s) => ({
      userSelectionActive: s.userSelectionActive,
      lib: s.lib,
      connectionInProgress: s.connection.inProgress
    });
    function ZoomPane({ onPaneContextMenu, zoomOnScroll = true, zoomOnPinch = true, panOnScroll = false, panActivationKeyPressed, panOnScrollSpeed = 0.5, panOnScrollMode = PanOnScrollMode.Free, zoomOnDoubleClick = true, panOnDrag = true, defaultViewport: defaultViewport2, translateExtent, minZoom, maxZoom, zoomActivationKeyCode, preventScrolling = true, children: children2, noWheelClassName, noPanClassName, onViewportChange, isControlledViewport, paneClickDistance, selectionOnDrag }) {
      const store = useStoreApi();
      const zoomPane = (0, import_react2.useRef)(null);
      const { userSelectionActive, lib, connectionInProgress } = useStore(selector$i, shallow$1);
      const zoomActivationKeyPressed = useKeyPress(zoomActivationKeyCode);
      const panZoom = (0, import_react2.useRef)();
      useResizeHandler(zoomPane);
      const onTransformChange = (0, import_react2.useCallback)((transform2) => {
        onViewportChange?.({ x: transform2[0], y: transform2[1], zoom: transform2[2] });
        if (!isControlledViewport) {
          store.setState({ transform: transform2 });
        }
      }, [onViewportChange, isControlledViewport]);
      (0, import_react2.useEffect)(() => {
        if (zoomPane.current) {
          panZoom.current = XYPanZoom({
            domNode: zoomPane.current,
            minZoom,
            maxZoom,
            translateExtent,
            viewport: defaultViewport2,
            onDraggingChange: (paneDragging) => store.setState((prevState) => prevState.paneDragging === paneDragging ? prevState : { paneDragging }),
            onPanZoomStart: (event, vp) => {
              const { onViewportChangeStart, onMoveStart } = store.getState();
              onMoveStart?.(event, vp);
              onViewportChangeStart?.(vp);
            },
            onPanZoom: (event, vp) => {
              const { onViewportChange: onViewportChange2, onMove } = store.getState();
              onMove?.(event, vp);
              onViewportChange2?.(vp);
            },
            onPanZoomEnd: (event, vp) => {
              const { onViewportChangeEnd, onMoveEnd } = store.getState();
              onMoveEnd?.(event, vp);
              onViewportChangeEnd?.(vp);
            }
          });
          const { x, y, zoom: zoom3 } = panZoom.current.getViewport();
          store.setState({
            panZoom: panZoom.current,
            transform: [x, y, zoom3],
            domNode: zoomPane.current.closest(".react-flow")
          });
          return () => {
            panZoom.current?.destroy();
          };
        }
      }, []);
      (0, import_react2.useEffect)(() => {
        panZoom.current?.update({
          onPaneContextMenu,
          zoomOnScroll,
          zoomOnPinch,
          panOnScroll,
          panActivationKeyPressed,
          panOnScrollSpeed,
          panOnScrollMode,
          zoomOnDoubleClick,
          panOnDrag,
          zoomActivationKeyPressed,
          preventScrolling,
          noPanClassName,
          userSelectionActive,
          noWheelClassName,
          lib,
          onTransformChange,
          connectionInProgress,
          selectionOnDrag,
          paneClickDistance
        });
      }, [
        onPaneContextMenu,
        zoomOnScroll,
        zoomOnPinch,
        panOnScroll,
        panActivationKeyPressed,
        panOnScrollSpeed,
        panOnScrollMode,
        zoomOnDoubleClick,
        panOnDrag,
        zoomActivationKeyPressed,
        preventScrolling,
        noPanClassName,
        userSelectionActive,
        noWheelClassName,
        lib,
        onTransformChange,
        connectionInProgress,
        selectionOnDrag,
        paneClickDistance
      ]);
      return (0, import_jsx_runtime.jsx)("div", { className: "react-flow__renderer", ref: zoomPane, style: containerStyle, children: children2 });
    }
    var selector$h = (s) => ({
      userSelectionActive: s.userSelectionActive,
      userSelectionRect: s.userSelectionRect
    });
    function UserSelection() {
      const { userSelectionActive, userSelectionRect } = useStore(selector$h, shallow$1);
      const isActive = userSelectionActive && userSelectionRect;
      if (!isActive) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)("div", { className: "react-flow__selection react-flow__container", style: {
        width: userSelectionRect.width,
        height: userSelectionRect.height,
        transform: `translate(${userSelectionRect.x}px, ${userSelectionRect.y}px)`
      } });
    }
    var wrapHandler = (handler, containerRef) => {
      return (event) => {
        if (event.target !== containerRef.current) {
          return;
        }
        handler?.(event);
      };
    };
    var selector$g = (s) => ({
      userSelectionActive: s.userSelectionActive,
      elementsSelectable: s.elementsSelectable,
      dragging: s.paneDragging,
      panBy: s.panBy,
      autoPanSpeed: s.autoPanSpeed
    });
    function Pane({ isSelecting, selectionKeyPressed, selectionMode = SelectionMode.Full, panOnDrag, autoPanOnSelection, paneClickDistance, selectionOnDrag, onSelectionStart, onSelectionEnd, onPaneClick, onPaneContextMenu, onPaneScroll, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, children: children2 }) {
      const autoPanId = (0, import_react2.useRef)(0);
      const store = useStoreApi();
      const { userSelectionActive, elementsSelectable, dragging, panBy: panBy2, autoPanSpeed } = useStore(selector$g, shallow$1);
      const isSelectionEnabled = elementsSelectable && (isSelecting || userSelectionActive);
      const container = (0, import_react2.useRef)(null);
      const containerBounds = (0, import_react2.useRef)();
      const selectedNodeIds = (0, import_react2.useRef)(/* @__PURE__ */ new Set());
      const selectedEdgeIds = (0, import_react2.useRef)(/* @__PURE__ */ new Set());
      const connectionEndedOnPane = (0, import_react2.useRef)(false);
      const selectionInProgress = (0, import_react2.useRef)(false);
      const position = (0, import_react2.useRef)({ x: 0, y: 0 });
      const autoPanStarted = (0, import_react2.useRef)(false);
      const onClick = (event) => {
        if (selectionInProgress.current || connectionEndedOnPane.current || store.getState().connection.inProgress) {
          selectionInProgress.current = false;
          connectionEndedOnPane.current = false;
          return;
        }
        const { connectionClickStartHandle, connection, onClickConnectEnd, resetSelectedElements } = store.getState();
        if (connectionClickStartHandle) {
          const connectionClone = structuredClone(connection);
          delete connectionClone.inProgress;
          connectionClone.toPosition = connectionClone.toHandle ? connectionClone.toHandle.position : null;
          onClickConnectEnd?.(event.nativeEvent, connectionClone);
          store.setState({ connectionClickStartHandle: null });
        }
        onPaneClick?.(event);
        resetSelectedElements();
        store.setState({ nodesSelectionActive: false });
      };
      const onContextMenu = (event) => {
        if (Array.isArray(panOnDrag) && panOnDrag?.includes(2)) {
          event.preventDefault();
          return;
        }
        onPaneContextMenu?.(event);
      };
      const onWheel = onPaneScroll ? (event) => onPaneScroll(event) : void 0;
      const onClickCapture = (event) => {
        if (selectionInProgress.current) {
          event.stopPropagation();
          selectionInProgress.current = false;
        }
      };
      const onPointerDownCapture = (event) => {
        if (event.pointerType === "touch" && panOnDrag !== false && !selectionKeyPressed) {
          return;
        }
        const { domNode, transform: transform2 } = store.getState();
        containerBounds.current = domNode?.getBoundingClientRect();
        if (!containerBounds.current)
          return;
        const eventTargetIsContainer = event.target === container.current;
        const isNoKeyEvent = !eventTargetIsContainer && !!event.target.closest(".nokey");
        const isSelectionActive = selectionOnDrag && eventTargetIsContainer || selectionKeyPressed;
        if (isNoKeyEvent || !isSelecting || !isSelectionActive || event.button !== 0 || !event.isPrimary) {
          return;
        }
        event.target?.setPointerCapture?.(event.pointerId);
        selectionInProgress.current = false;
        const { x, y } = getEventPosition(event.nativeEvent, containerBounds.current);
        const userSelectionStartPosition = pointToRendererPoint({ x, y }, transform2);
        store.setState({
          userSelectionRect: {
            width: 0,
            height: 0,
            startX: userSelectionStartPosition.x,
            startY: userSelectionStartPosition.y,
            x,
            y
          }
        });
        if (!eventTargetIsContainer) {
          event.stopPropagation();
          event.preventDefault();
        }
      };
      function commitUserSelectionRect(mouseX, mouseY) {
        const { userSelectionRect } = store.getState();
        if (!userSelectionRect) {
          return;
        }
        const { transform: transform2, nodeLookup, edgeLookup, connectionLookup, triggerNodeChanges, triggerEdgeChanges, defaultEdgeOptions } = store.getState();
        const userStartPosition = { x: userSelectionRect.startX, y: userSelectionRect.startY };
        const { x: screenStartX, y: screenStartY } = rendererPointToPoint(userStartPosition, transform2);
        const nextUserSelectRect = {
          startX: userStartPosition.x,
          startY: userStartPosition.y,
          x: mouseX < screenStartX ? mouseX : screenStartX,
          y: mouseY < screenStartY ? mouseY : screenStartY,
          width: Math.abs(mouseX - screenStartX),
          height: Math.abs(mouseY - screenStartY)
        };
        const prevSelectedNodeIds = selectedNodeIds.current;
        const prevSelectedEdgeIds = selectedEdgeIds.current;
        selectedNodeIds.current = new Set(getNodesInside(nodeLookup, nextUserSelectRect, transform2, selectionMode === SelectionMode.Partial, true).map((node) => node.id));
        selectedEdgeIds.current = /* @__PURE__ */ new Set();
        const edgesSelectable = defaultEdgeOptions?.selectable ?? true;
        for (const nodeId of selectedNodeIds.current) {
          const connections = connectionLookup.get(nodeId);
          if (!connections)
            continue;
          for (const { edgeId } of connections.values()) {
            const edge2 = edgeLookup.get(edgeId);
            if (edge2 && (edge2.selectable ?? edgesSelectable)) {
              selectedEdgeIds.current.add(edgeId);
            }
          }
        }
        if (!areSetsEqual(prevSelectedNodeIds, selectedNodeIds.current)) {
          const changes = getSelectionChanges(nodeLookup, selectedNodeIds.current);
          triggerNodeChanges(changes);
        }
        if (!areSetsEqual(prevSelectedEdgeIds, selectedEdgeIds.current)) {
          const changes = getSelectionChanges(edgeLookup, selectedEdgeIds.current);
          triggerEdgeChanges(changes);
        }
        store.setState({
          userSelectionRect: nextUserSelectRect,
          userSelectionActive: true,
          nodesSelectionActive: false
        });
      }
      function autoPan() {
        if (!autoPanOnSelection || !containerBounds.current) {
          return;
        }
        const [x, y] = calcAutoPan(position.current, containerBounds.current, autoPanSpeed);
        panBy2({ x, y }).then((panned) => {
          if (!selectionInProgress.current || !panned) {
            autoPanId.current = requestAnimationFrame(autoPan);
            return;
          }
          const { x: mx, y: my } = position.current;
          commitUserSelectionRect(mx, my);
          autoPanId.current = requestAnimationFrame(autoPan);
        });
      }
      const cleanupAutoPan = () => {
        cancelAnimationFrame(autoPanId.current);
        autoPanId.current = 0;
        autoPanStarted.current = false;
      };
      (0, import_react2.useEffect)(() => {
        return () => cleanupAutoPan();
      }, []);
      const onPointerMove = (event) => {
        const { userSelectionRect, transform: transform2, resetSelectedElements } = store.getState();
        if (!containerBounds.current || !userSelectionRect) {
          return;
        }
        const { x: mouseX, y: mouseY } = getEventPosition(event.nativeEvent, containerBounds.current);
        position.current = { x: mouseX, y: mouseY };
        const screenStart = rendererPointToPoint({ x: userSelectionRect.startX, y: userSelectionRect.startY }, transform2);
        if (!selectionInProgress.current) {
          const requiredDistance = selectionKeyPressed ? 0 : paneClickDistance;
          const distance2 = Math.hypot(mouseX - screenStart.x, mouseY - screenStart.y);
          if (distance2 <= requiredDistance) {
            return;
          }
          resetSelectedElements();
          onSelectionStart?.(event);
        }
        selectionInProgress.current = true;
        if (!autoPanStarted.current) {
          autoPan();
          autoPanStarted.current = true;
        }
        commitUserSelectionRect(mouseX, mouseY);
      };
      const onPointerUp = (event) => {
        if (!isSelectionEnabled) {
          if (event.target === container.current && store.getState().connection.inProgress) {
            connectionEndedOnPane.current = true;
          }
          return;
        }
        if (event.button !== 0) {
          return;
        }
        event.target?.releasePointerCapture?.(event.pointerId);
        if (!userSelectionActive && event.target === container.current && store.getState().userSelectionRect) {
          onClick?.(event);
        }
        store.setState({
          userSelectionActive: false,
          userSelectionRect: null
        });
        if (selectionInProgress.current) {
          onSelectionEnd?.(event);
          store.setState({
            nodesSelectionActive: selectedNodeIds.current.size > 0
          });
        }
        cleanupAutoPan();
      };
      const onPointerCancel = (event) => {
        event.target?.releasePointerCapture?.(event.pointerId);
        cleanupAutoPan();
      };
      const draggable = panOnDrag === true || Array.isArray(panOnDrag) && panOnDrag.includes(0);
      return (0, import_jsx_runtime.jsxs)("div", { className: cc(["react-flow__pane", { draggable, dragging, selection: isSelecting }]), onClick: isSelectionEnabled ? void 0 : wrapHandler(onClick, container), onContextMenu: wrapHandler(onContextMenu, container), onWheel: wrapHandler(onWheel, container), onPointerEnter: isSelectionEnabled ? void 0 : onPaneMouseEnter, onPointerMove: isSelectionEnabled ? onPointerMove : onPaneMouseMove, onPointerUp, onPointerCancel: isSelectionEnabled ? onPointerCancel : void 0, onPointerDownCapture: isSelectionEnabled ? onPointerDownCapture : void 0, onClickCapture: isSelectionEnabled ? onClickCapture : void 0, onPointerLeave: onPaneMouseLeave, ref: container, style: containerStyle, children: [children2, (0, import_jsx_runtime.jsx)(UserSelection, {})] });
    }
    function handleNodeClick({ id: id2, store, unselect = false, nodeRef }) {
      const { addSelectedNodes, unselectNodesAndEdges, multiSelectionActive, nodeLookup, onError } = store.getState();
      const node = nodeLookup.get(id2);
      if (!node) {
        onError?.("012", errorMessages["error012"](id2));
        return;
      }
      store.setState({ nodesSelectionActive: false });
      if (!node.selected) {
        addSelectedNodes([id2]);
      } else if (unselect || node.selected && multiSelectionActive) {
        unselectNodesAndEdges({ nodes: [node], edges: [] });
        requestAnimationFrame(() => nodeRef?.current?.blur());
      }
    }
    function useDrag({ nodeRef, disabled = false, noDragClassName, handleSelector, nodeId, isSelectable, nodeClickDistance }) {
      const store = useStoreApi();
      const [dragging, setDragging] = (0, import_react2.useState)(false);
      const xyDrag = (0, import_react2.useRef)();
      (0, import_react2.useEffect)(() => {
        if (disabled) {
          return;
        }
        xyDrag.current = XYDrag({
          getStoreItems: () => store.getState(),
          onNodeMouseDown: (id2) => {
            handleNodeClick({
              id: id2,
              store,
              nodeRef
            });
          },
          onDragStart: () => {
            setDragging(true);
          },
          onDragStop: () => {
            setDragging(false);
          }
        });
        return () => {
          xyDrag.current?.destroy();
          xyDrag.current = void 0;
        };
      }, [disabled, store, nodeRef]);
      (0, import_react2.useEffect)(() => {
        if (disabled || !nodeRef.current || !xyDrag.current) {
          return;
        }
        xyDrag.current.update({
          noDragClassName,
          handleSelector,
          domNode: nodeRef.current,
          isSelectable,
          nodeId,
          nodeClickDistance
        });
      }, [noDragClassName, handleSelector, disabled, isSelectable, nodeRef, nodeId, nodeClickDistance]);
      return dragging;
    }
    var selectedAndDraggable = (nodesDraggable) => (n) => n.selected && (n.draggable || nodesDraggable && typeof n.draggable === "undefined");
    function useMoveSelectedNodes() {
      const store = useStoreApi();
      const moveSelectedNodes = (0, import_react2.useCallback)((params) => {
        const { nodeExtent, snapToGrid, snapGrid, nodesDraggable, onError, updateNodePositions, nodeLookup, nodeOrigin } = store.getState();
        const nodeUpdates = /* @__PURE__ */ new Map();
        const isSelected = selectedAndDraggable(nodesDraggable);
        const xVelo = snapToGrid ? snapGrid[0] : 5;
        const yVelo = snapToGrid ? snapGrid[1] : 5;
        const xDiff = params.direction.x * xVelo * params.factor;
        const yDiff = params.direction.y * yVelo * params.factor;
        for (const [, node] of nodeLookup) {
          if (!isSelected(node)) {
            continue;
          }
          let nextPosition = {
            x: node.internals.positionAbsolute.x + xDiff,
            y: node.internals.positionAbsolute.y + yDiff
          };
          if (snapToGrid) {
            nextPosition = snapPosition(nextPosition, snapGrid);
          }
          const { position, positionAbsolute } = calculateNodePosition({
            nodeId: node.id,
            nextPosition,
            nodeLookup,
            nodeExtent,
            nodeOrigin,
            onError
          });
          node.position = position;
          node.internals.positionAbsolute = positionAbsolute;
          nodeUpdates.set(node.id, node);
        }
        updateNodePositions(nodeUpdates);
      }, []);
      return moveSelectedNodes;
    }
    var NodeIdContext = (0, import_react2.createContext)(null);
    var Provider = NodeIdContext.Provider;
    NodeIdContext.Consumer;
    var useNodeId = () => {
      const nodeId = (0, import_react2.useContext)(NodeIdContext);
      return nodeId;
    };
    var selector$f = (s) => ({
      connectOnClick: s.connectOnClick,
      noPanClassName: s.noPanClassName,
      rfId: s.rfId
    });
    var HandleConfigContext = (0, import_react2.createContext)(null);
    function HandleConfigProvider({ children: children2 }) {
      const config = useStore(selector$f, shallow$1);
      return (0, import_jsx_runtime.jsx)(HandleConfigContext.Provider, { value: config, children: children2 });
    }
    function useHandleConfig() {
      const config = (0, import_react2.useContext)(HandleConfigContext);
      if (!config) {
        throw new Error("useHandleConfig must be used within a HandleConfigProvider");
      }
      return config;
    }
    var idleConnectingState = {
      connectingFrom: false,
      connectingTo: false,
      clickConnecting: false,
      isPossibleEndHandle: true,
      connectionInProcess: false,
      clickConnectionInProcess: false,
      valid: false
    };
    var connectingSelector = (nodeId, handleId, type) => (state) => {
      const { connectionClickStartHandle: clickHandle, connectionMode, connection } = state;
      const { fromHandle, toHandle, isValid } = connection;
      if (!fromHandle && !clickHandle) {
        return idleConnectingState;
      }
      const connectingTo = toHandle?.nodeId === nodeId && toHandle?.id === handleId && toHandle?.type === type;
      return {
        connectingFrom: fromHandle?.nodeId === nodeId && fromHandle?.id === handleId && fromHandle?.type === type,
        connectingTo,
        clickConnecting: clickHandle?.nodeId === nodeId && clickHandle?.id === handleId && clickHandle?.type === type,
        isPossibleEndHandle: connectionMode === ConnectionMode.Strict ? fromHandle?.type !== type : nodeId !== fromHandle?.nodeId || handleId !== fromHandle?.id,
        connectionInProcess: !!fromHandle,
        clickConnectionInProcess: !!clickHandle,
        valid: connectingTo && isValid
      };
    };
    function HandleComponent({ type = "source", position = Position.Top, isValidConnection, isConnectable = true, isConnectableStart = true, isConnectableEnd = true, id: id2, onConnect, children: children2, className, onMouseDown, onTouchStart, ...rest }, ref) {
      const handleId = id2 || null;
      const isTarget = type === "target";
      const store = useStoreApi();
      const nodeId = useNodeId();
      const { connectOnClick, noPanClassName, rfId } = useHandleConfig();
      const { connectingFrom, connectingTo, clickConnecting, isPossibleEndHandle, connectionInProcess, clickConnectionInProcess, valid } = useStore(connectingSelector(nodeId, handleId, type), shallow$1);
      if (!nodeId) {
        store.getState().onError?.("010", errorMessages["error010"]());
      }
      const onConnectExtended = (params) => {
        const { defaultEdgeOptions, onConnect: onConnectAction, hasDefaultEdges } = store.getState();
        const edgeParams = {
          ...defaultEdgeOptions,
          ...params
        };
        if (hasDefaultEdges) {
          const { edges, setEdges, onError } = store.getState();
          setEdges(addEdge2(edgeParams, edges, { onError }));
        }
        onConnectAction?.(edgeParams);
        onConnect?.(edgeParams);
      };
      const onPointerDown2 = (event) => {
        if (!nodeId) {
          return;
        }
        const isMouseTriggered = isMouseEvent(event.nativeEvent);
        if (isConnectableStart && (isMouseTriggered && event.button === 0 || !isMouseTriggered)) {
          const currentStore = store.getState();
          XYHandle.onPointerDown(event.nativeEvent, {
            handleDomNode: event.currentTarget,
            autoPanOnConnect: currentStore.autoPanOnConnect,
            connectionMode: currentStore.connectionMode,
            connectionRadius: currentStore.connectionRadius,
            domNode: currentStore.domNode,
            nodeLookup: currentStore.nodeLookup,
            lib: currentStore.lib,
            isTarget,
            handleId,
            nodeId,
            flowId: currentStore.rfId,
            panBy: currentStore.panBy,
            cancelConnection: currentStore.cancelConnection,
            onConnectStart: currentStore.onConnectStart,
            onConnectEnd: (...args) => store.getState().onConnectEnd?.(...args),
            updateConnection: currentStore.updateConnection,
            onConnect: onConnectExtended,
            isValidConnection: isValidConnection || ((...args) => store.getState().isValidConnection?.(...args) ?? true),
            getTransform: () => store.getState().transform,
            getFromHandle: () => store.getState().connection.fromHandle,
            autoPanSpeed: currentStore.autoPanSpeed,
            dragThreshold: currentStore.connectionDragThreshold
          });
        }
        if (isMouseTriggered) {
          onMouseDown?.(event);
        } else {
          onTouchStart?.(event);
        }
      };
      const onClick = (event) => {
        const { onClickConnectStart, onClickConnectEnd, connectionClickStartHandle, connectionMode, isValidConnection: isValidConnectionStore, lib, rfId: flowId, nodeLookup, connection: connectionState } = store.getState();
        if (!nodeId || !connectionClickStartHandle && !isConnectableStart) {
          return;
        }
        if (!connectionClickStartHandle) {
          onClickConnectStart?.(event.nativeEvent, { nodeId, handleId, handleType: type });
          store.setState({ connectionClickStartHandle: { nodeId, type, id: handleId } });
          return;
        }
        const doc = getHostForElement(event.target);
        const isValidConnectionHandler = isValidConnection || isValidConnectionStore;
        const { connection, isValid } = XYHandle.isValid(event.nativeEvent, {
          handle: {
            nodeId,
            id: handleId,
            type
          },
          connectionMode,
          fromNodeId: connectionClickStartHandle.nodeId,
          fromHandleId: connectionClickStartHandle.id || null,
          fromType: connectionClickStartHandle.type,
          isValidConnection: isValidConnectionHandler,
          flowId,
          doc,
          lib,
          nodeLookup
        });
        if (isValid && connection) {
          onConnectExtended(connection);
        }
        const connectionClone = structuredClone(connectionState);
        delete connectionClone.inProgress;
        connectionClone.toPosition = connectionClone.toHandle ? connectionClone.toHandle.position : null;
        onClickConnectEnd?.(event, connectionClone);
        store.setState({ connectionClickStartHandle: null });
      };
      return (0, import_jsx_runtime.jsx)("div", { "data-handleid": handleId, "data-nodeid": nodeId, "data-handlepos": position, "data-id": `${rfId}-${nodeId}-${handleId}-${type}`, className: cc([
        "react-flow__handle",
        `react-flow__handle-${position}`,
        "nodrag",
        noPanClassName,
        className,
        {
          source: !isTarget,
          target: isTarget,
          connectable: isConnectable,
          connectablestart: isConnectableStart,
          connectableend: isConnectableEnd,
          clickconnecting: clickConnecting,
          connectingfrom: connectingFrom,
          connectingto: connectingTo,
          valid,
          /*
           * shows where you can start a connection from
           * and where you can end it while connecting
           */
          connectionindicator: isConnectable && (!connectionInProcess || isPossibleEndHandle) && (connectionInProcess || clickConnectionInProcess ? isConnectableEnd : isConnectableStart)
        }
      ]), onMouseDown: onPointerDown2, onTouchStart: onPointerDown2, onClick: connectOnClick ? onClick : void 0, ref, ...rest, children: children2 });
    }
    var Handle = (0, import_react2.memo)(fixedForwardRef(HandleComponent));
    function InputNode({ data, isConnectable, sourcePosition = Position.Bottom }) {
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [data?.label, (0, import_jsx_runtime.jsx)(Handle, { type: "source", position: sourcePosition, isConnectable })] });
    }
    function DefaultNode({ data, isConnectable, targetPosition = Position.Top, sourcePosition = Position.Bottom }) {
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(0, import_jsx_runtime.jsx)(Handle, { type: "target", position: targetPosition, isConnectable }), data?.label, (0, import_jsx_runtime.jsx)(Handle, { type: "source", position: sourcePosition, isConnectable })] });
    }
    function GroupNode() {
      return null;
    }
    function OutputNode({ data, isConnectable, targetPosition = Position.Top }) {
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(0, import_jsx_runtime.jsx)(Handle, { type: "target", position: targetPosition, isConnectable }), data?.label] });
    }
    var arrowKeyDiffs = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 }
    };
    var builtinNodeTypes = {
      input: InputNode,
      default: DefaultNode,
      output: OutputNode,
      group: GroupNode
    };
    function getNodeInlineStyleDimensions(node) {
      if (node.internals.handleBounds === void 0) {
        return {
          width: node.width ?? node.initialWidth ?? node.style?.width,
          height: node.height ?? node.initialHeight ?? node.style?.height
        };
      }
      return {
        width: node.width ?? node.style?.width,
        height: node.height ?? node.style?.height
      };
    }
    var selector$e = (s) => {
      const { width, height, x, y } = getInternalNodesBounds(s.nodeLookup, {
        filter: (node) => !!node.selected
      });
      return {
        width: isNumeric(width) ? width : null,
        height: isNumeric(height) ? height : null,
        userSelectionActive: s.userSelectionActive,
        transformString: `translate(${s.transform[0]}px,${s.transform[1]}px) scale(${s.transform[2]}) translate(${x}px,${y}px)`
      };
    };
    function NodesSelection({ onSelectionContextMenu, noPanClassName, disableKeyboardA11y }) {
      const store = useStoreApi();
      const { width, height, transformString, userSelectionActive } = useStore(selector$e, shallow$1);
      const moveSelectedNodes = useMoveSelectedNodes();
      const nodeRef = (0, import_react2.useRef)(null);
      (0, import_react2.useEffect)(() => {
        if (!disableKeyboardA11y) {
          nodeRef.current?.focus({
            preventScroll: true
          });
        }
      }, [disableKeyboardA11y]);
      const shouldRender = !userSelectionActive && width !== null && height !== null;
      useDrag({
        nodeRef,
        disabled: !shouldRender
      });
      if (!shouldRender) {
        return null;
      }
      const onContextMenu = onSelectionContextMenu ? (event) => {
        const selectedNodes = store.getState().nodes.filter((n) => n.selected);
        onSelectionContextMenu(event, selectedNodes);
      } : void 0;
      const onKeyDown = (event) => {
        if (Object.prototype.hasOwnProperty.call(arrowKeyDiffs, event.key)) {
          event.preventDefault();
          moveSelectedNodes({
            direction: arrowKeyDiffs[event.key],
            factor: event.shiftKey ? 4 : 1
          });
        }
      };
      return (0, import_jsx_runtime.jsx)("div", { className: cc(["react-flow__nodesselection", "react-flow__container", noPanClassName]), style: {
        transform: transformString
      }, children: (0, import_jsx_runtime.jsx)("div", { ref: nodeRef, className: "react-flow__nodesselection-rect", onContextMenu, tabIndex: disableKeyboardA11y ? void 0 : -1, onKeyDown: disableKeyboardA11y ? void 0 : onKeyDown, style: {
        width,
        height
      } }) });
    }
    var win = typeof window !== "undefined" ? window : void 0;
    var selector$d = (s) => {
      return { nodesSelectionActive: s.nodesSelectionActive, userSelectionActive: s.userSelectionActive };
    };
    function FlowRendererComponent({ children: children2, onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneContextMenu, onPaneScroll, paneClickDistance, deleteKeyCode, selectionKeyCode, selectionOnDrag, selectionMode, onSelectionStart, onSelectionEnd, multiSelectionKeyCode, panActivationKeyCode, zoomActivationKeyCode, elementsSelectable, zoomOnScroll, zoomOnPinch, panOnScroll: _panOnScroll, panOnScrollSpeed, panOnScrollMode, zoomOnDoubleClick, panOnDrag: _panOnDrag, autoPanOnSelection, defaultViewport: defaultViewport2, translateExtent, minZoom, maxZoom, preventScrolling, onSelectionContextMenu, noWheelClassName, noPanClassName, disableKeyboardA11y, onViewportChange, isControlledViewport }) {
      const { nodesSelectionActive, userSelectionActive } = useStore(selector$d, shallow$1);
      const selectionKeyPressed = useKeyPress(selectionKeyCode, { target: win });
      const panActivationKeyPressed = useKeyPress(panActivationKeyCode, { target: win });
      const panOnDrag = panActivationKeyPressed || _panOnDrag;
      const panOnScroll = panActivationKeyPressed || _panOnScroll;
      const _selectionOnDrag = selectionOnDrag && panOnDrag !== true;
      const isSelecting = selectionKeyPressed || userSelectionActive || _selectionOnDrag;
      useGlobalKeyHandler({ deleteKeyCode, multiSelectionKeyCode });
      return (0, import_jsx_runtime.jsx)(ZoomPane, { onPaneContextMenu, elementsSelectable, zoomOnScroll, zoomOnPinch, panOnScroll, panActivationKeyPressed, panOnScrollSpeed, panOnScrollMode, zoomOnDoubleClick, panOnDrag: !selectionKeyPressed && panOnDrag, defaultViewport: defaultViewport2, translateExtent, minZoom, maxZoom, zoomActivationKeyCode, preventScrolling, noWheelClassName, noPanClassName, onViewportChange, isControlledViewport, paneClickDistance, selectionOnDrag: _selectionOnDrag, children: (0, import_jsx_runtime.jsxs)(Pane, { onSelectionStart, onSelectionEnd, onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneContextMenu, onPaneScroll, panOnDrag, autoPanOnSelection, isSelecting: !!isSelecting, selectionMode, selectionKeyPressed, paneClickDistance, selectionOnDrag: _selectionOnDrag, children: [children2, nodesSelectionActive && (0, import_jsx_runtime.jsx)(NodesSelection, { onSelectionContextMenu, noPanClassName, disableKeyboardA11y })] }) });
    }
    FlowRendererComponent.displayName = "FlowRenderer";
    var FlowRenderer = (0, import_react2.memo)(FlowRendererComponent);
    var selector$c = (onlyRenderVisible) => (s) => {
      return onlyRenderVisible ? getNodesInside(s.nodeLookup, { x: 0, y: 0, width: s.width, height: s.height }, s.transform, true).map((node) => node.id) : Array.from(s.nodeLookup.keys());
    };
    function useVisibleNodeIds(onlyRenderVisible) {
      const nodeIds = useStore((0, import_react2.useCallback)(selector$c(onlyRenderVisible), [onlyRenderVisible]), shallow$1);
      return nodeIds;
    }
    var selector$b = (s) => s.updateNodeInternals;
    function useResizeObserver() {
      const updateNodeInternals2 = useStore(selector$b);
      const [resizeObserver] = (0, import_react2.useState)(() => {
        if (typeof ResizeObserver === "undefined") {
          return null;
        }
        return new ResizeObserver((entries) => {
          const updates = /* @__PURE__ */ new Map();
          entries.forEach((entry) => {
            const id2 = entry.target.getAttribute("data-id");
            updates.set(id2, {
              id: id2,
              nodeElement: entry.target,
              force: true
            });
          });
          updateNodeInternals2(updates);
        });
      });
      (0, import_react2.useEffect)(() => {
        return () => {
          resizeObserver?.disconnect();
        };
      }, [resizeObserver]);
      return resizeObserver;
    }
    function useNodeObserver({ node, nodeType, hasDimensions, resizeObserver }) {
      const store = useStoreApi();
      const nodeRef = (0, import_react2.useRef)(null);
      const observedNode = (0, import_react2.useRef)(null);
      const prevSourcePosition = (0, import_react2.useRef)(node.sourcePosition);
      const prevTargetPosition = (0, import_react2.useRef)(node.targetPosition);
      const prevType = (0, import_react2.useRef)(nodeType);
      const isInitialized = hasDimensions && !!node.internals.handleBounds;
      (0, import_react2.useEffect)(() => {
        if (nodeRef.current && !node.hidden && (!isInitialized || observedNode.current !== nodeRef.current)) {
          if (observedNode.current) {
            resizeObserver?.unobserve(observedNode.current);
          }
          resizeObserver?.observe(nodeRef.current);
          observedNode.current = nodeRef.current;
        }
      }, [isInitialized, node.hidden]);
      (0, import_react2.useEffect)(() => {
        return () => {
          if (observedNode.current) {
            resizeObserver?.unobserve(observedNode.current);
            observedNode.current = null;
          }
        };
      }, []);
      (0, import_react2.useEffect)(() => {
        if (nodeRef.current) {
          const typeChanged = prevType.current !== nodeType;
          const sourcePosChanged = prevSourcePosition.current !== node.sourcePosition;
          const targetPosChanged = prevTargetPosition.current !== node.targetPosition;
          if (typeChanged || sourcePosChanged || targetPosChanged) {
            prevType.current = nodeType;
            prevSourcePosition.current = node.sourcePosition;
            prevTargetPosition.current = node.targetPosition;
            store.getState().updateNodeInternals(/* @__PURE__ */ new Map([[node.id, { id: node.id, nodeElement: nodeRef.current, force: true }]]));
          }
        }
      }, [node.id, nodeType, node.sourcePosition, node.targetPosition]);
      return nodeRef;
    }
    function NodeWrapper({ id: id2, onClick, onMouseEnter, onMouseMove, onMouseLeave, onContextMenu, onDoubleClick, nodesDraggable, elementsSelectable, nodesConnectable, nodesFocusable, resizeObserver, noDragClassName, noPanClassName, disableKeyboardA11y, rfId, nodeTypes, nodeClickDistance, onError }) {
      const { node, internals, isParent } = useStore((s) => {
        const node2 = s.nodeLookup.get(id2);
        const isParent2 = s.parentLookup.has(id2);
        return {
          node: node2,
          internals: node2.internals,
          isParent: isParent2
        };
      }, shallow$1);
      let nodeType = node.type || "default";
      let NodeComponent = nodeTypes?.[nodeType] || builtinNodeTypes[nodeType];
      if (NodeComponent === void 0) {
        onError?.("003", errorMessages["error003"](nodeType));
        nodeType = "default";
        NodeComponent = nodeTypes?.["default"] || builtinNodeTypes.default;
      }
      const isDraggable = !!(node.draggable || nodesDraggable && typeof node.draggable === "undefined");
      const isSelectable = !!(node.selectable || elementsSelectable && typeof node.selectable === "undefined");
      const isConnectable = !!(node.connectable || nodesConnectable && typeof node.connectable === "undefined");
      const isFocusable = !!(node.focusable || nodesFocusable && typeof node.focusable === "undefined");
      const store = useStoreApi();
      const hasDimensions = nodeHasDimensions(node);
      const nodeRef = useNodeObserver({ node, nodeType, hasDimensions, resizeObserver });
      const dragging = useDrag({
        nodeRef,
        disabled: node.hidden || !isDraggable,
        noDragClassName,
        handleSelector: node.dragHandle,
        nodeId: id2,
        isSelectable,
        nodeClickDistance
      });
      const moveSelectedNodes = useMoveSelectedNodes();
      if (node.hidden) {
        return null;
      }
      const nodeDimensions = getNodeDimensions(node);
      const inlineDimensions = getNodeInlineStyleDimensions(node);
      const hasPointerEvents = isSelectable || isDraggable || onClick || onMouseEnter || onMouseMove || onMouseLeave;
      const onMouseEnterHandler = onMouseEnter ? (event) => onMouseEnter(event, { ...internals.userNode }) : void 0;
      const onMouseMoveHandler = onMouseMove ? (event) => onMouseMove(event, { ...internals.userNode }) : void 0;
      const onMouseLeaveHandler = onMouseLeave ? (event) => onMouseLeave(event, { ...internals.userNode }) : void 0;
      const onContextMenuHandler = onContextMenu ? (event) => onContextMenu(event, { ...internals.userNode }) : void 0;
      const onDoubleClickHandler = onDoubleClick ? (event) => onDoubleClick(event, { ...internals.userNode }) : void 0;
      const onSelectNodeHandler = (event) => {
        const { selectNodesOnDrag, nodeDragThreshold } = store.getState();
        if (isSelectable && (!selectNodesOnDrag || !isDraggable || nodeDragThreshold > 0)) {
          handleNodeClick({
            id: id2,
            store,
            nodeRef
          });
        }
        if (onClick) {
          onClick(event, { ...internals.userNode });
        }
      };
      const onKeyDown = (event) => {
        if (isInputDOMNode(event.nativeEvent) || disableKeyboardA11y) {
          return;
        }
        if (elementSelectionKeys.includes(event.key) && isSelectable) {
          const unselect = event.key === "Escape";
          handleNodeClick({
            id: id2,
            store,
            unselect,
            nodeRef
          });
        } else if (isDraggable && node.selected && Object.prototype.hasOwnProperty.call(arrowKeyDiffs, event.key)) {
          event.preventDefault();
          const { ariaLabelConfig } = store.getState();
          store.setState({
            ariaLiveMessage: ariaLabelConfig["node.a11yDescription.ariaLiveMessage"]({
              direction: event.key.replace("Arrow", "").toLowerCase(),
              x: ~~internals.positionAbsolute.x,
              y: ~~internals.positionAbsolute.y
            })
          });
          moveSelectedNodes({
            direction: arrowKeyDiffs[event.key],
            factor: event.shiftKey ? 4 : 1
          });
        }
      };
      const onFocus = () => {
        if (disableKeyboardA11y || !nodeRef.current?.matches(":focus-visible")) {
          return;
        }
        const { transform: transform2, width, height, autoPanOnNodeFocus, setCenter } = store.getState();
        if (!autoPanOnNodeFocus) {
          return;
        }
        const withinViewport = getNodesInside(/* @__PURE__ */ new Map([[id2, node]]), { x: 0, y: 0, width, height }, transform2, true).length > 0;
        if (!withinViewport) {
          setCenter(node.position.x + nodeDimensions.width / 2, node.position.y + nodeDimensions.height / 2, {
            zoom: transform2[2]
          });
        }
      };
      return (0, import_jsx_runtime.jsx)("div", { className: cc([
        "react-flow__node",
        `react-flow__node-${nodeType}`,
        {
          // this is overwritable by passing `nopan` as a class name
          [noPanClassName]: isDraggable
        },
        node.className,
        {
          selected: node.selected,
          selectable: isSelectable,
          parent: isParent,
          draggable: isDraggable,
          dragging
        }
      ]), ref: nodeRef, style: {
        zIndex: internals.z,
        transform: `translate(${internals.positionAbsolute.x}px,${internals.positionAbsolute.y}px)`,
        pointerEvents: hasPointerEvents ? "all" : "none",
        visibility: hasDimensions ? "visible" : "hidden",
        ...node.style,
        ...inlineDimensions
      }, "data-id": id2, "data-testid": `rf__node-${id2}`, onMouseEnter: onMouseEnterHandler, onMouseMove: onMouseMoveHandler, onMouseLeave: onMouseLeaveHandler, onContextMenu: onContextMenuHandler, onClick: onSelectNodeHandler, onDoubleClick: onDoubleClickHandler, onKeyDown: isFocusable ? onKeyDown : void 0, tabIndex: isFocusable ? 0 : void 0, onFocus: isFocusable ? onFocus : void 0, role: node.ariaRole ?? (isFocusable ? "group" : void 0), "aria-roledescription": "node", "aria-describedby": disableKeyboardA11y ? void 0 : `${ARIA_NODE_DESC_KEY}-${rfId}`, "aria-label": node.ariaLabel, ...node.domAttributes, children: (0, import_jsx_runtime.jsx)(Provider, { value: id2, children: (0, import_jsx_runtime.jsx)(NodeComponent, { id: id2, data: node.data, type: nodeType, positionAbsoluteX: internals.positionAbsolute.x, positionAbsoluteY: internals.positionAbsolute.y, selected: node.selected ?? false, selectable: isSelectable, draggable: isDraggable, deletable: node.deletable ?? true, isConnectable, sourcePosition: node.sourcePosition, targetPosition: node.targetPosition, dragging, dragHandle: node.dragHandle, zIndex: internals.z, parentId: node.parentId, ...nodeDimensions }) }) });
    }
    var NodeWrapper$1 = (0, import_react2.memo)(NodeWrapper);
    var selector$a = (s) => ({
      nodesConnectable: s.nodesConnectable,
      nodesFocusable: s.nodesFocusable,
      elementsSelectable: s.elementsSelectable,
      onError: s.onError
    });
    function NodeRendererComponent(props) {
      const { nodesConnectable, nodesFocusable, elementsSelectable, onError } = useStore(selector$a, shallow$1);
      const nodeIds = useVisibleNodeIds(props.onlyRenderVisibleElements);
      const resizeObserver = useResizeObserver();
      return (0, import_jsx_runtime.jsx)("div", { className: "react-flow__nodes", style: containerStyle, children: nodeIds.map((nodeId) => {
        return (
          /*
           * The split of responsibilities between NodeRenderer and
           * NodeComponentWrapper may appear weird. However, it’s designed to
           * minimize the cost of updates when individual nodes change.
           *
           * For example, when you’re dragging a single node, that node gets
           * updated multiple times per second. If `NodeRenderer` were to update
           * every time, it would have to re-run the `nodes.map()` loop every
           * time. This gets pricey with hundreds of nodes, especially if every
           * loop cycle does more than just rendering a JSX element!
           *
           * As a result of this choice, we took the following implementation
           * decisions:
           * - NodeRenderer subscribes *only* to node IDs – and therefore
           *   rerender *only* when visible nodes are added or removed.
           * - NodeRenderer performs all operations the result of which can be
           *   shared between nodes (such as creating the `ResizeObserver`
           *   instance, or subscribing to `selector`). This means extra prop
           *   drilling into `NodeComponentWrapper`, but it means we need to run
           *   these operations only once – instead of once per node.
           * - Any operations that you’d normally write inside `nodes.map` are
           *   moved into `NodeComponentWrapper`. This ensures they are
           *   memorized – so if `NodeRenderer` *has* to rerender, it only
           *   needs to regenerate the list of nodes, nothing else.
           */
          (0, import_jsx_runtime.jsx)(NodeWrapper$1, { id: nodeId, nodeTypes: props.nodeTypes, nodeExtent: props.nodeExtent, onClick: props.onNodeClick, onMouseEnter: props.onNodeMouseEnter, onMouseMove: props.onNodeMouseMove, onMouseLeave: props.onNodeMouseLeave, onContextMenu: props.onNodeContextMenu, onDoubleClick: props.onNodeDoubleClick, noDragClassName: props.noDragClassName, noPanClassName: props.noPanClassName, rfId: props.rfId, disableKeyboardA11y: props.disableKeyboardA11y, resizeObserver, nodesDraggable: props.nodesDraggable ?? true, nodesConnectable, nodesFocusable, elementsSelectable, nodeClickDistance: props.nodeClickDistance, onError }, nodeId)
        );
      }) });
    }
    NodeRendererComponent.displayName = "NodeRenderer";
    var NodeRenderer = (0, import_react2.memo)(NodeRendererComponent);
    function useVisibleEdgeIds(onlyRenderVisible) {
      const edgeIds = useStore((0, import_react2.useCallback)((s) => {
        if (!onlyRenderVisible) {
          return s.edges.map((edge2) => edge2.id);
        }
        const visibleEdgeIds = [];
        if (s.width && s.height) {
          for (const edge2 of s.edges) {
            const sourceNode = s.nodeLookup.get(edge2.source);
            const targetNode = s.nodeLookup.get(edge2.target);
            if (sourceNode && targetNode && isEdgeVisible({
              sourceNode,
              targetNode,
              width: s.width,
              height: s.height,
              transform: s.transform
            })) {
              visibleEdgeIds.push(edge2.id);
            }
          }
        }
        return visibleEdgeIds;
      }, [onlyRenderVisible]), shallow$1);
      return edgeIds;
    }
    var ArrowSymbol = ({ color: color2 = "none", strokeWidth = 1 }) => {
      const style2 = {
        strokeWidth,
        ...color2 && { stroke: color2 }
      };
      return (0, import_jsx_runtime.jsx)("polyline", { className: "arrow", style: style2, strokeLinecap: "round", fill: "none", strokeLinejoin: "round", points: "-5,-4 0,0 -5,4" });
    };
    var ArrowClosedSymbol = ({ color: color2 = "none", strokeWidth = 1 }) => {
      const style2 = {
        strokeWidth,
        ...color2 && { stroke: color2, fill: color2 }
      };
      return (0, import_jsx_runtime.jsx)("polyline", { className: "arrowclosed", style: style2, strokeLinecap: "round", strokeLinejoin: "round", points: "-5,-4 0,0 -5,4 -5,-4" });
    };
    var MarkerSymbols = {
      [MarkerType.Arrow]: ArrowSymbol,
      [MarkerType.ArrowClosed]: ArrowClosedSymbol
    };
    function useMarkerSymbol(type) {
      const store = useStoreApi();
      const symbol = (0, import_react2.useMemo)(() => {
        const symbolExists = Object.prototype.hasOwnProperty.call(MarkerSymbols, type);
        if (!symbolExists) {
          store.getState().onError?.("009", errorMessages["error009"](type));
          return null;
        }
        return MarkerSymbols[type];
      }, [type]);
      return symbol;
    }
    var Marker = ({ id: id2, type, color: color2, width = 12.5, height = 12.5, markerUnits = "strokeWidth", strokeWidth, orient = "auto-start-reverse" }) => {
      const Symbol2 = useMarkerSymbol(type);
      if (!Symbol2) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)("marker", { className: "react-flow__arrowhead", id: id2, markerWidth: `${width}`, markerHeight: `${height}`, viewBox: "-10 -10 20 20", markerUnits, orient, refX: "0", refY: "0", children: (0, import_jsx_runtime.jsx)(Symbol2, { color: color2, strokeWidth }) });
    };
    var MarkerDefinitions = ({ defaultColor, rfId }) => {
      const edges = useStore((s) => s.edges);
      const defaultEdgeOptions = useStore((s) => s.defaultEdgeOptions);
      const markers = (0, import_react2.useMemo)(() => {
        const markers2 = createMarkerIds(edges, {
          id: rfId,
          defaultColor,
          defaultMarkerStart: defaultEdgeOptions?.markerStart,
          defaultMarkerEnd: defaultEdgeOptions?.markerEnd
        });
        return markers2;
      }, [edges, defaultEdgeOptions, rfId, defaultColor]);
      if (!markers.length) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)("svg", { className: "react-flow__marker", "aria-hidden": "true", children: (0, import_jsx_runtime.jsx)("defs", { children: markers.map((marker) => (0, import_jsx_runtime.jsx)(Marker, { id: marker.id, type: marker.type, color: marker.color, width: marker.width, height: marker.height, markerUnits: marker.markerUnits, strokeWidth: marker.strokeWidth, orient: marker.orient }, marker.id)) }) });
    };
    MarkerDefinitions.displayName = "MarkerDefinitions";
    var MarkerDefinitions$1 = (0, import_react2.memo)(MarkerDefinitions);
    function EdgeTextComponent({ x, y, label, labelStyle, labelShowBg = true, labelBgStyle, labelBgPadding = [2, 4], labelBgBorderRadius = 2, children: children2, className, ...rest }) {
      const [edgeTextBbox, setEdgeTextBbox] = (0, import_react2.useState)({ x: 1, y: 0, width: 0, height: 0 });
      const edgeTextClasses = cc(["react-flow__edge-textwrapper", className]);
      const edgeTextRef = (0, import_react2.useRef)(null);
      (0, import_react2.useEffect)(() => {
        if (edgeTextRef.current) {
          const textBbox = edgeTextRef.current.getBBox();
          setEdgeTextBbox({
            x: textBbox.x,
            y: textBbox.y,
            width: textBbox.width,
            height: textBbox.height
          });
        }
      }, [label]);
      if (!label) {
        return null;
      }
      return (0, import_jsx_runtime.jsxs)("g", { transform: `translate(${x - edgeTextBbox.width / 2} ${y - edgeTextBbox.height / 2})`, className: edgeTextClasses, visibility: edgeTextBbox.width ? "visible" : "hidden", ...rest, children: [labelShowBg && (0, import_jsx_runtime.jsx)("rect", { width: edgeTextBbox.width + 2 * labelBgPadding[0], x: -labelBgPadding[0], y: -labelBgPadding[1], height: edgeTextBbox.height + 2 * labelBgPadding[1], className: "react-flow__edge-textbg", style: labelBgStyle, rx: labelBgBorderRadius, ry: labelBgBorderRadius }), (0, import_jsx_runtime.jsx)("text", { className: "react-flow__edge-text", y: edgeTextBbox.height / 2, dy: "0.3em", ref: edgeTextRef, style: labelStyle, children: label }), children2] });
    }
    EdgeTextComponent.displayName = "EdgeText";
    var EdgeText = (0, import_react2.memo)(EdgeTextComponent);
    function BaseEdge({ path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth = 20, ...props }) {
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(0, import_jsx_runtime.jsx)("path", { ...props, d: path, fill: "none", className: cc(["react-flow__edge-path", props.className]) }), interactionWidth ? (0, import_jsx_runtime.jsx)("path", { d: path, fill: "none", strokeOpacity: 0, strokeWidth: interactionWidth, className: "react-flow__edge-interaction" }) : null, label && isNumeric(labelX) && isNumeric(labelY) ? (0, import_jsx_runtime.jsx)(EdgeText, { x: labelX, y: labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius }) : null] });
    }
    function getControl({ pos, x1, y1, x2, y2 }) {
      if (pos === Position.Left || pos === Position.Right) {
        return [0.5 * (x1 + x2), y1];
      }
      return [x1, 0.5 * (y1 + y2)];
    }
    function getSimpleBezierPath({ sourceX, sourceY, sourcePosition = Position.Bottom, targetX, targetY, targetPosition = Position.Top }) {
      const [sourceControlX, sourceControlY] = getControl({
        pos: sourcePosition,
        x1: sourceX,
        y1: sourceY,
        x2: targetX,
        y2: targetY
      });
      const [targetControlX, targetControlY] = getControl({
        pos: targetPosition,
        x1: targetX,
        y1: targetY,
        x2: sourceX,
        y2: sourceY
      });
      const [labelX, labelY, offsetX, offsetY] = getBezierEdgeCenter({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourceControlX,
        sourceControlY,
        targetControlX,
        targetControlY
      });
      return [
        `M${sourceX},${sourceY} C${sourceControlX},${sourceControlY} ${targetControlX},${targetControlY} ${targetX},${targetY}`,
        labelX,
        labelY,
        offsetX,
        offsetY
      ];
    }
    function createSimpleBezierEdge(params) {
      return (0, import_react2.memo)(({ id: id2, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth }) => {
        const [path, labelX, labelY] = getSimpleBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition
        });
        const _id = params.isInternal ? void 0 : id2;
        return (0, import_jsx_runtime.jsx)(BaseEdge, { id: _id, path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth });
      });
    }
    var SimpleBezierEdge = createSimpleBezierEdge({ isInternal: false });
    var SimpleBezierEdgeInternal = createSimpleBezierEdge({ isInternal: true });
    SimpleBezierEdge.displayName = "SimpleBezierEdge";
    SimpleBezierEdgeInternal.displayName = "SimpleBezierEdgeInternal";
    function createSmoothStepEdge(params) {
      return (0, import_react2.memo)(({ id: id2, sourceX, sourceY, targetX, targetY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, sourcePosition = Position.Bottom, targetPosition = Position.Top, markerEnd, markerStart, pathOptions, interactionWidth }) => {
        const [path, labelX, labelY] = getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: pathOptions?.borderRadius,
          offset: pathOptions?.offset,
          stepPosition: pathOptions?.stepPosition
        });
        const _id = params.isInternal ? void 0 : id2;
        return (0, import_jsx_runtime.jsx)(BaseEdge, { id: _id, path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth });
      });
    }
    var SmoothStepEdge = createSmoothStepEdge({ isInternal: false });
    var SmoothStepEdgeInternal = createSmoothStepEdge({ isInternal: true });
    SmoothStepEdge.displayName = "SmoothStepEdge";
    SmoothStepEdgeInternal.displayName = "SmoothStepEdgeInternal";
    function createStepEdge(params) {
      return (0, import_react2.memo)(({ id: id2, ...props }) => {
        const _id = params.isInternal ? void 0 : id2;
        return (0, import_jsx_runtime.jsx)(SmoothStepEdge, { ...props, id: _id, pathOptions: (0, import_react2.useMemo)(() => ({ borderRadius: 0, offset: props.pathOptions?.offset }), [props.pathOptions?.offset]) });
      });
    }
    var StepEdge = createStepEdge({ isInternal: false });
    var StepEdgeInternal = createStepEdge({ isInternal: true });
    StepEdge.displayName = "StepEdge";
    StepEdgeInternal.displayName = "StepEdgeInternal";
    function createStraightEdge(params) {
      return (0, import_react2.memo)(({ id: id2, sourceX, sourceY, targetX, targetY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth }) => {
        const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
        const _id = params.isInternal ? void 0 : id2;
        return (0, import_jsx_runtime.jsx)(BaseEdge, { id: _id, path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth });
      });
    }
    var StraightEdge = createStraightEdge({ isInternal: false });
    var StraightEdgeInternal = createStraightEdge({ isInternal: true });
    StraightEdge.displayName = "StraightEdge";
    StraightEdgeInternal.displayName = "StraightEdgeInternal";
    function createBezierEdge(params) {
      return (0, import_react2.memo)(({ id: id2, sourceX, sourceY, targetX, targetY, sourcePosition = Position.Bottom, targetPosition = Position.Top, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, pathOptions, interactionWidth }) => {
        const [path, labelX, labelY] = getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          curvature: pathOptions?.curvature
        });
        const _id = params.isInternal ? void 0 : id2;
        return (0, import_jsx_runtime.jsx)(BaseEdge, { id: _id, path, labelX, labelY, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style: style2, markerEnd, markerStart, interactionWidth });
      });
    }
    var BezierEdge = createBezierEdge({ isInternal: false });
    var BezierEdgeInternal = createBezierEdge({ isInternal: true });
    BezierEdge.displayName = "BezierEdge";
    BezierEdgeInternal.displayName = "BezierEdgeInternal";
    var builtinEdgeTypes = {
      default: BezierEdgeInternal,
      straight: StraightEdgeInternal,
      step: StepEdgeInternal,
      smoothstep: SmoothStepEdgeInternal,
      simplebezier: SimpleBezierEdgeInternal
    };
    var nullPosition = {
      sourceX: null,
      sourceY: null,
      targetX: null,
      targetY: null,
      sourcePosition: null,
      targetPosition: null,
      zIndex: void 0
    };
    var shiftX = (x, shift, position) => {
      if (position === Position.Left)
        return x - shift;
      if (position === Position.Right)
        return x + shift;
      return x;
    };
    var shiftY = (y, shift, position) => {
      if (position === Position.Top)
        return y - shift;
      if (position === Position.Bottom)
        return y + shift;
      return y;
    };
    var EdgeUpdaterClassName = "react-flow__edgeupdater";
    function EdgeAnchor({ position, centerX, centerY, radius = 10, onMouseDown, onMouseEnter, onMouseOut, type }) {
      return (0, import_jsx_runtime.jsx)("circle", { onMouseDown, onMouseEnter, onMouseOut, className: cc([EdgeUpdaterClassName, `${EdgeUpdaterClassName}-${type}`]), cx: shiftX(centerX, radius, position), cy: shiftY(centerY, radius, position), r: radius, stroke: "transparent", fill: "transparent" });
    }
    function EdgeUpdateAnchors({ isReconnectable, reconnectRadius, edge: edge2, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, onReconnect, onReconnectStart, onReconnectEnd, setReconnecting, setUpdateHover }) {
      const store = useStoreApi();
      const handleEdgeUpdater = (event, oppositeHandle) => {
        if (event.button !== 0) {
          return;
        }
        const { autoPanOnConnect, domNode, connectionMode, connectionRadius, lib, onConnectStart, cancelConnection, nodeLookup, rfId: flowId, panBy: panBy2, updateConnection } = store.getState();
        const isTarget = oppositeHandle.type === "target";
        const _onReconnectEnd = (evt, connectionState) => {
          setReconnecting(false);
          onReconnectEnd?.(evt, edge2, oppositeHandle.type, connectionState);
        };
        const onConnectEdge = (connection) => onReconnect?.(edge2, connection);
        const _onConnectStart = (_event, params) => {
          setReconnecting(true);
          onReconnectStart?.(event, edge2, oppositeHandle.type);
          onConnectStart?.(_event, params);
        };
        XYHandle.onPointerDown(event.nativeEvent, {
          autoPanOnConnect,
          connectionMode,
          connectionRadius,
          domNode,
          handleId: oppositeHandle.id,
          nodeId: oppositeHandle.nodeId,
          nodeLookup,
          isTarget,
          edgeUpdaterType: oppositeHandle.type,
          lib,
          flowId,
          cancelConnection,
          panBy: panBy2,
          isValidConnection: (...args) => store.getState().isValidConnection?.(...args) ?? true,
          onConnect: onConnectEdge,
          onConnectStart: _onConnectStart,
          onConnectEnd: (...args) => store.getState().onConnectEnd?.(...args),
          onReconnectEnd: _onReconnectEnd,
          updateConnection,
          getTransform: () => store.getState().transform,
          getFromHandle: () => store.getState().connection.fromHandle,
          dragThreshold: store.getState().connectionDragThreshold,
          handleDomNode: event.currentTarget
        });
      };
      const onReconnectSourceMouseDown = (event) => handleEdgeUpdater(event, { nodeId: edge2.target, id: edge2.targetHandle ?? null, type: "target" });
      const onReconnectTargetMouseDown = (event) => handleEdgeUpdater(event, { nodeId: edge2.source, id: edge2.sourceHandle ?? null, type: "source" });
      const onReconnectMouseEnter = () => setUpdateHover(true);
      const onReconnectMouseOut = () => setUpdateHover(false);
      return (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(isReconnectable === true || isReconnectable === "source") && (0, import_jsx_runtime.jsx)(EdgeAnchor, { position: sourcePosition, centerX: sourceX, centerY: sourceY, radius: reconnectRadius, onMouseDown: onReconnectSourceMouseDown, onMouseEnter: onReconnectMouseEnter, onMouseOut: onReconnectMouseOut, type: "source" }), (isReconnectable === true || isReconnectable === "target") && (0, import_jsx_runtime.jsx)(EdgeAnchor, { position: targetPosition, centerX: targetX, centerY: targetY, radius: reconnectRadius, onMouseDown: onReconnectTargetMouseDown, onMouseEnter: onReconnectMouseEnter, onMouseOut: onReconnectMouseOut, type: "target" })] });
    }
    function EdgeWrapper({ id: id2, edgesFocusable, edgesReconnectable, elementsSelectable, onClick, onDoubleClick, onContextMenu, onMouseEnter, onMouseMove, onMouseLeave, reconnectRadius, onReconnect, onReconnectStart, onReconnectEnd, rfId, edgeTypes, noPanClassName, onError, disableKeyboardA11y }) {
      let edge2 = useStore((s) => s.edgeLookup.get(id2));
      const defaultEdgeOptions = useStore((s) => s.defaultEdgeOptions);
      edge2 = defaultEdgeOptions ? { ...defaultEdgeOptions, ...edge2 } : edge2;
      let edgeType = edge2.type || "default";
      let EdgeComponent = edgeTypes?.[edgeType] || builtinEdgeTypes[edgeType];
      if (EdgeComponent === void 0) {
        onError?.("011", errorMessages["error011"](edgeType));
        edgeType = "default";
        EdgeComponent = edgeTypes?.["default"] || builtinEdgeTypes.default;
      }
      const isFocusable = !!(edge2.focusable || edgesFocusable && typeof edge2.focusable === "undefined");
      const isReconnectable = typeof onReconnect !== "undefined" && (edge2.reconnectable || edgesReconnectable && typeof edge2.reconnectable === "undefined");
      const isSelectable = !!(edge2.selectable || elementsSelectable && typeof edge2.selectable === "undefined");
      const edgeRef = (0, import_react2.useRef)(null);
      const [updateHover, setUpdateHover] = (0, import_react2.useState)(false);
      const [reconnecting, setReconnecting] = (0, import_react2.useState)(false);
      const store = useStoreApi();
      const { zIndex = edge2.zIndex, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = useStore((0, import_react2.useCallback)((store2) => {
        const sourceNode = store2.nodeLookup.get(edge2.source);
        const targetNode = store2.nodeLookup.get(edge2.target);
        if (!sourceNode || !targetNode) {
          return nullPosition;
        }
        const edgePosition = getEdgePosition({
          id: id2,
          sourceNode,
          targetNode,
          sourceHandle: edge2.sourceHandle || null,
          targetHandle: edge2.targetHandle || null,
          connectionMode: store2.connectionMode,
          onError
        });
        const zIndex2 = getElevatedEdgeZIndex({
          selected: edge2.selected,
          zIndex: edge2.zIndex,
          sourceNode,
          targetNode,
          elevateOnSelect: store2.elevateEdgesOnSelect,
          zIndexMode: store2.zIndexMode
        });
        return {
          ...edgePosition || nullPosition,
          zIndex: zIndex2
        };
      }, [edge2.source, edge2.target, edge2.sourceHandle, edge2.targetHandle, edge2.selected, edge2.zIndex, onError]), shallow$1);
      const markerStartUrl = (0, import_react2.useMemo)(() => edge2.markerStart ? `url('#${getMarkerId(edge2.markerStart, rfId)}')` : void 0, [edge2.markerStart, rfId]);
      const markerEndUrl = (0, import_react2.useMemo)(() => edge2.markerEnd ? `url('#${getMarkerId(edge2.markerEnd, rfId)}')` : void 0, [edge2.markerEnd, rfId]);
      if (edge2.hidden || sourceX === null || sourceY === null || targetX === null || targetY === null) {
        return null;
      }
      const onEdgeClick = (event) => {
        const { addSelectedEdges, unselectNodesAndEdges, multiSelectionActive } = store.getState();
        if (isSelectable) {
          store.setState({ nodesSelectionActive: false });
          if (edge2.selected && multiSelectionActive) {
            unselectNodesAndEdges({ nodes: [], edges: [edge2] });
            edgeRef.current?.blur();
          } else {
            addSelectedEdges([id2]);
          }
        }
        if (onClick) {
          onClick(event, edge2);
        }
      };
      const onEdgeDoubleClick = onDoubleClick ? (event) => {
        onDoubleClick(event, { ...edge2 });
      } : void 0;
      const onEdgeContextMenu = onContextMenu ? (event) => {
        onContextMenu(event, { ...edge2 });
      } : void 0;
      const onEdgeMouseEnter = onMouseEnter ? (event) => {
        onMouseEnter(event, { ...edge2 });
      } : void 0;
      const onEdgeMouseMove = onMouseMove ? (event) => {
        onMouseMove(event, { ...edge2 });
      } : void 0;
      const onEdgeMouseLeave = onMouseLeave ? (event) => {
        onMouseLeave(event, { ...edge2 });
      } : void 0;
      const onKeyDown = (event) => {
        if (!disableKeyboardA11y && elementSelectionKeys.includes(event.key) && isSelectable) {
          const { unselectNodesAndEdges, addSelectedEdges } = store.getState();
          const unselect = event.key === "Escape";
          if (unselect) {
            edgeRef.current?.blur();
            unselectNodesAndEdges({ edges: [edge2] });
          } else {
            addSelectedEdges([id2]);
          }
        }
      };
      return (0, import_jsx_runtime.jsx)("svg", { style: { zIndex }, children: (0, import_jsx_runtime.jsxs)("g", { className: cc([
        "react-flow__edge",
        `react-flow__edge-${edgeType}`,
        edge2.className,
        noPanClassName,
        {
          selected: edge2.selected,
          animated: edge2.animated,
          inactive: !isSelectable && !onClick,
          updating: updateHover,
          selectable: isSelectable
        }
      ]), onClick: onEdgeClick, onDoubleClick: onEdgeDoubleClick, onContextMenu: onEdgeContextMenu, onMouseEnter: onEdgeMouseEnter, onMouseMove: onEdgeMouseMove, onMouseLeave: onEdgeMouseLeave, onKeyDown: isFocusable ? onKeyDown : void 0, tabIndex: isFocusable ? 0 : void 0, role: edge2.ariaRole ?? (isFocusable ? "group" : "img"), "aria-roledescription": "edge", "data-id": id2, "data-testid": `rf__edge-${id2}`, "aria-label": edge2.ariaLabel === null ? void 0 : edge2.ariaLabel || `Edge from ${edge2.source} to ${edge2.target}`, "aria-describedby": isFocusable ? `${ARIA_EDGE_DESC_KEY}-${rfId}` : void 0, ref: edgeRef, ...edge2.domAttributes, children: [!reconnecting && (0, import_jsx_runtime.jsx)(EdgeComponent, { id: id2, source: edge2.source, target: edge2.target, type: edge2.type, selected: edge2.selected, animated: edge2.animated, selectable: isSelectable, deletable: edge2.deletable ?? true, label: edge2.label, labelStyle: edge2.labelStyle, labelShowBg: edge2.labelShowBg, labelBgStyle: edge2.labelBgStyle, labelBgPadding: edge2.labelBgPadding, labelBgBorderRadius: edge2.labelBgBorderRadius, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data: edge2.data, style: edge2.style, sourceHandleId: edge2.sourceHandle, targetHandleId: edge2.targetHandle, markerStart: markerStartUrl, markerEnd: markerEndUrl, pathOptions: "pathOptions" in edge2 ? edge2.pathOptions : void 0, interactionWidth: edge2.interactionWidth }), isReconnectable && (0, import_jsx_runtime.jsx)(EdgeUpdateAnchors, { edge: edge2, isReconnectable, reconnectRadius, onReconnect, onReconnectStart, onReconnectEnd, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, setUpdateHover, setReconnecting })] }) });
    }
    var EdgeWrapper$1 = (0, import_react2.memo)(EdgeWrapper);
    var selector$9 = (s) => ({
      edgesFocusable: s.edgesFocusable,
      edgesReconnectable: s.edgesReconnectable,
      elementsSelectable: s.elementsSelectable,
      connectionMode: s.connectionMode,
      onError: s.onError
    });
    function EdgeRendererComponent({ defaultMarkerColor, onlyRenderVisibleElements, rfId, edgeTypes, noPanClassName, onReconnect, onEdgeContextMenu, onEdgeMouseEnter, onEdgeMouseMove, onEdgeMouseLeave, onEdgeClick, reconnectRadius, onEdgeDoubleClick, onReconnectStart, onReconnectEnd, disableKeyboardA11y }) {
      const { edgesFocusable, edgesReconnectable, elementsSelectable, onError } = useStore(selector$9, shallow$1);
      const edgeIds = useVisibleEdgeIds(onlyRenderVisibleElements);
      return (0, import_jsx_runtime.jsxs)("div", { className: "react-flow__edges", children: [(0, import_jsx_runtime.jsx)(MarkerDefinitions$1, { defaultColor: defaultMarkerColor, rfId }), edgeIds.map((id2) => {
        return (0, import_jsx_runtime.jsx)(EdgeWrapper$1, { id: id2, edgesFocusable, edgesReconnectable, elementsSelectable, noPanClassName, onReconnect, onContextMenu: onEdgeContextMenu, onMouseEnter: onEdgeMouseEnter, onMouseMove: onEdgeMouseMove, onMouseLeave: onEdgeMouseLeave, onClick: onEdgeClick, reconnectRadius, onDoubleClick: onEdgeDoubleClick, onReconnectStart, onReconnectEnd, rfId, onError, edgeTypes, disableKeyboardA11y }, id2);
      })] });
    }
    EdgeRendererComponent.displayName = "EdgeRenderer";
    var EdgeRenderer = (0, import_react2.memo)(EdgeRendererComponent);
    var toTransformString = (transform2) => `translate(${transform2[0]}px,${transform2[1]}px) scale(${transform2[2]})`;
    function Viewport({ children: children2 }) {
      const store = useStoreApi();
      const viewportRef = (0, import_react2.useRef)(null);
      const [initialTransform] = (0, import_react2.useState)(() => store.getState().transform);
      useIsomorphicLayoutEffect(() => {
        let prevTransform = null;
        const applyTransform = () => {
          const transform2 = store.getState().transform;
          if (prevTransform && transform2[0] === prevTransform[0] && transform2[1] === prevTransform[1] && transform2[2] === prevTransform[2]) {
            return;
          }
          prevTransform = transform2;
          if (viewportRef.current) {
            viewportRef.current.style.transform = toTransformString(transform2);
          }
        };
        applyTransform();
        return store.subscribe(applyTransform);
      }, [store]);
      return (0, import_jsx_runtime.jsx)("div", { ref: viewportRef, className: "react-flow__viewport xyflow__viewport react-flow__container", style: { transform: toTransformString(initialTransform) }, children: children2 });
    }
    function useOnInitHandler(onInit) {
      const rfInstance = useReactFlow();
      const isInitialized = (0, import_react2.useRef)(false);
      (0, import_react2.useEffect)(() => {
        if (!isInitialized.current && rfInstance.viewportInitialized && onInit) {
          setTimeout(() => onInit(rfInstance), 1);
          isInitialized.current = true;
        }
      }, [onInit, rfInstance.viewportInitialized]);
    }
    var selector$8 = (state) => state.panZoom?.syncViewport;
    function useViewportSync(viewport) {
      const syncViewport = useStore(selector$8);
      const store = useStoreApi();
      (0, import_react2.useEffect)(() => {
        if (viewport) {
          syncViewport?.(viewport);
          store.setState({ transform: [viewport.x, viewport.y, viewport.zoom] });
        }
      }, [viewport, syncViewport]);
      return null;
    }
    function storeSelector$1(s) {
      return s.connection.inProgress ? { ...s.connection, to: pointToRendererPoint(s.connection.to, s.transform) } : { ...s.connection };
    }
    function getSelector(connectionSelector) {
      if (connectionSelector) {
        const combinedSelector = (s) => {
          const connection = storeSelector$1(s);
          return connectionSelector(connection);
        };
        return combinedSelector;
      }
      return storeSelector$1;
    }
    function useConnection(connectionSelector) {
      const combinedSelector = getSelector(connectionSelector);
      return useStore(combinedSelector, shallow$1);
    }
    var selector$7 = (s) => ({
      nodesConnectable: s.nodesConnectable,
      isValid: s.connection.isValid,
      inProgress: s.connection.inProgress,
      width: s.width,
      height: s.height
    });
    function ConnectionLineWrapper({ containerStyle: containerStyle2, style: style2, type, component }) {
      const { nodesConnectable, width, height, isValid, inProgress } = useStore(selector$7, shallow$1);
      const renderConnection = !!(width && nodesConnectable && inProgress);
      if (!renderConnection) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)("svg", { style: containerStyle2, width, height, className: "react-flow__connectionline react-flow__container", children: (0, import_jsx_runtime.jsx)("g", { className: cc(["react-flow__connection", getConnectionStatus(isValid)]), children: (0, import_jsx_runtime.jsx)(ConnectionLine, { style: style2, type, CustomComponent: component, isValid }) }) });
    }
    var ConnectionLine = ({ style: style2, type = ConnectionLineType.Bezier, CustomComponent, isValid }) => {
      const { inProgress, from, fromNode, fromHandle, fromPosition, to, toNode, toHandle, toPosition, pointer: pointer2 } = useConnection();
      if (!inProgress) {
        return;
      }
      if (CustomComponent) {
        return (0, import_jsx_runtime.jsx)(CustomComponent, { connectionLineType: type, connectionLineStyle: style2, fromNode, fromHandle, fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, fromPosition, toPosition, connectionStatus: getConnectionStatus(isValid), toNode, toHandle, pointer: pointer2 });
      }
      let path = "";
      const pathParams = {
        sourceX: from.x,
        sourceY: from.y,
        sourcePosition: fromPosition,
        targetX: to.x,
        targetY: to.y,
        targetPosition: toPosition
      };
      switch (type) {
        case ConnectionLineType.Bezier:
          [path] = getBezierPath(pathParams);
          break;
        case ConnectionLineType.SimpleBezier:
          [path] = getSimpleBezierPath(pathParams);
          break;
        case ConnectionLineType.Step:
          [path] = getSmoothStepPath({
            ...pathParams,
            borderRadius: 0
          });
          break;
        case ConnectionLineType.SmoothStep:
          [path] = getSmoothStepPath(pathParams);
          break;
        default:
          [path] = getStraightPath(pathParams);
      }
      return (0, import_jsx_runtime.jsx)("path", { d: path, fill: "none", className: "react-flow__connection-path", style: style2 });
    };
    ConnectionLine.displayName = "ConnectionLine";
    var emptyTypes = {};
    function useNodeOrEdgeTypesWarning(nodeOrEdgeTypes = emptyTypes) {
      const typesRef = (0, import_react2.useRef)(nodeOrEdgeTypes);
      const store = useStoreApi();
      (0, import_react2.useEffect)(() => {
        if (true) {
          const usedKeys = /* @__PURE__ */ new Set([...Object.keys(typesRef.current), ...Object.keys(nodeOrEdgeTypes)]);
          for (const key of usedKeys) {
            if (typesRef.current[key] !== nodeOrEdgeTypes[key]) {
              store.getState().onError?.("002", errorMessages["error002"]());
              break;
            }
          }
          typesRef.current = nodeOrEdgeTypes;
        }
      }, [nodeOrEdgeTypes]);
    }
    function useStylesLoadedWarning() {
      const store = useStoreApi();
      const checked = (0, import_react2.useRef)(false);
      (0, import_react2.useEffect)(() => {
        if (true) {
          if (!checked.current) {
            const pane = document.querySelector(".react-flow__pane");
            if (pane && !(window.getComputedStyle(pane).zIndex === "1")) {
              store.getState().onError?.("013", errorMessages["error013"]("react"));
            }
            checked.current = true;
          }
        }
      }, []);
    }
    function GraphViewComponent({ nodeTypes, edgeTypes, onInit, onNodeClick, onEdgeClick, onNodeDoubleClick, onEdgeDoubleClick, onNodeMouseEnter, onNodeMouseMove, onNodeMouseLeave, onNodeContextMenu, onSelectionContextMenu, onSelectionStart, onSelectionEnd, connectionLineType, connectionLineStyle, connectionLineComponent, connectionLineContainerStyle, selectionKeyCode, selectionOnDrag, selectionMode, multiSelectionKeyCode, panActivationKeyCode, zoomActivationKeyCode, deleteKeyCode, onlyRenderVisibleElements, elementsSelectable, defaultViewport: defaultViewport2, translateExtent, minZoom, maxZoom, preventScrolling, defaultMarkerColor, zoomOnScroll, zoomOnPinch, panOnScroll, panOnScrollSpeed, panOnScrollMode, zoomOnDoubleClick, panOnDrag, autoPanOnSelection, onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneScroll, onPaneContextMenu, paneClickDistance, nodeClickDistance, onEdgeContextMenu, onEdgeMouseEnter, onEdgeMouseMove, onEdgeMouseLeave, reconnectRadius, onReconnect, onReconnectStart, onReconnectEnd, noDragClassName, noWheelClassName, noPanClassName, disableKeyboardA11y, nodeExtent, rfId, viewport, onViewportChange, nodesDraggable }) {
      useNodeOrEdgeTypesWarning(nodeTypes);
      useNodeOrEdgeTypesWarning(edgeTypes);
      useStylesLoadedWarning();
      useOnInitHandler(onInit);
      useViewportSync(viewport);
      return (0, import_jsx_runtime.jsx)(FlowRenderer, { onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneContextMenu, onPaneScroll, paneClickDistance, deleteKeyCode, selectionKeyCode, selectionOnDrag, selectionMode, onSelectionStart, onSelectionEnd, multiSelectionKeyCode, panActivationKeyCode, zoomActivationKeyCode, elementsSelectable, zoomOnScroll, zoomOnPinch, zoomOnDoubleClick, panOnScroll, panOnScrollSpeed, panOnScrollMode, panOnDrag, autoPanOnSelection, defaultViewport: defaultViewport2, translateExtent, minZoom, maxZoom, onSelectionContextMenu, preventScrolling, noDragClassName, noWheelClassName, noPanClassName, disableKeyboardA11y, onViewportChange, isControlledViewport: !!viewport, children: (0, import_jsx_runtime.jsxs)(Viewport, { children: [(0, import_jsx_runtime.jsx)(EdgeRenderer, { edgeTypes, onEdgeClick, onEdgeDoubleClick, onReconnect, onReconnectStart, onReconnectEnd, onlyRenderVisibleElements, onEdgeContextMenu, onEdgeMouseEnter, onEdgeMouseMove, onEdgeMouseLeave, reconnectRadius, defaultMarkerColor, noPanClassName, disableKeyboardA11y, rfId }), (0, import_jsx_runtime.jsx)(ConnectionLineWrapper, { style: connectionLineStyle, type: connectionLineType, component: connectionLineComponent, containerStyle: connectionLineContainerStyle }), (0, import_jsx_runtime.jsx)("div", { className: "react-flow__edgelabel-renderer" }), (0, import_jsx_runtime.jsx)(NodeRenderer, { nodeTypes, onNodeClick, onNodeDoubleClick, onNodeMouseEnter, onNodeMouseMove, onNodeMouseLeave, onNodeContextMenu, nodeClickDistance, onlyRenderVisibleElements, noPanClassName, noDragClassName, disableKeyboardA11y, nodeExtent, rfId, nodesDraggable }), (0, import_jsx_runtime.jsx)("div", { className: "react-flow__viewport-portal" })] }) });
    }
    GraphViewComponent.displayName = "GraphView";
    var GraphView = (0, import_react2.memo)(GraphViewComponent);
    var devWarn = createDevWarn("React Flow", "https://reactflow.dev/");
    var getInitialState = ({ nodes, edges, defaultNodes, defaultEdges, width, height, fitView, fitViewOptions, minZoom = 0.5, maxZoom = 2, nodeOrigin, nodeExtent, zIndexMode = "basic" } = {}) => {
      const nodeLookup = /* @__PURE__ */ new Map();
      const parentLookup = /* @__PURE__ */ new Map();
      const connectionLookup = /* @__PURE__ */ new Map();
      const edgeLookup = /* @__PURE__ */ new Map();
      const storeEdges = defaultEdges ?? edges ?? [];
      const storeNodes = defaultNodes ?? nodes ?? [];
      const storeNodeOrigin = nodeOrigin ?? [0, 0];
      const storeNodeExtent = nodeExtent ?? infiniteExtent;
      updateConnectionLookup(connectionLookup, edgeLookup, storeEdges);
      const { nodesInitialized } = adoptUserNodes(storeNodes, nodeLookup, parentLookup, {
        nodeOrigin: storeNodeOrigin,
        nodeExtent: storeNodeExtent,
        zIndexMode
      });
      let transform2 = [0, 0, 1];
      if (fitView && width && height) {
        const bounds = getInternalNodesBounds(nodeLookup, {
          filter: (node) => !!((node.width || node.initialWidth) && (node.height || node.initialHeight))
        });
        const { x, y, zoom: zoom3 } = getViewportForBounds(bounds, width, height, minZoom, maxZoom, fitViewOptions?.padding ?? 0.1);
        transform2 = [x, y, zoom3];
      }
      return {
        rfId: "1",
        width: width ?? 0,
        height: height ?? 0,
        transform: transform2,
        nodes: storeNodes,
        nodesInitialized,
        nodeLookup,
        parentLookup,
        edges: storeEdges,
        edgeLookup,
        connectionLookup,
        onNodesChange: null,
        onEdgesChange: null,
        hasDefaultNodes: defaultNodes !== void 0,
        hasDefaultEdges: defaultEdges !== void 0,
        panZoom: null,
        minZoom,
        maxZoom,
        translateExtent: infiniteExtent,
        nodeExtent: storeNodeExtent,
        nodesSelectionActive: false,
        userSelectionActive: false,
        userSelectionRect: null,
        connectionMode: ConnectionMode.Strict,
        domNode: null,
        paneDragging: false,
        noPanClassName: "nopan",
        nodeOrigin: storeNodeOrigin,
        nodeDragThreshold: 1,
        connectionDragThreshold: 1,
        snapGrid: [15, 15],
        snapToGrid: false,
        nodesDraggable: true,
        nodesConnectable: true,
        nodesFocusable: true,
        edgesFocusable: true,
        edgesReconnectable: true,
        elementsSelectable: true,
        elevateNodesOnSelect: true,
        elevateEdgesOnSelect: true,
        selectNodesOnDrag: true,
        multiSelectionActive: false,
        fitViewQueued: fitView ?? false,
        fitViewOptions,
        fitViewResolver: null,
        connection: { ...initialConnection },
        connectionClickStartHandle: null,
        connectOnClick: true,
        ariaLiveMessage: "",
        autoPanOnConnect: true,
        autoPanOnNodeDrag: true,
        autoPanOnNodeFocus: true,
        autoPanSpeed: 15,
        connectionRadius: 20,
        onError: devWarn,
        isValidConnection: void 0,
        onSelectionChangeHandlers: [],
        lib: "react",
        debug: false,
        ariaLabelConfig: defaultAriaLabelConfig,
        zIndexMode,
        defaultEdgeOptions: void 0,
        onNodesChangeMiddlewareMap: /* @__PURE__ */ new Map(),
        onEdgesChangeMiddlewareMap: /* @__PURE__ */ new Map(),
        onNodesDelete: void 0,
        onEdgesDelete: void 0,
        onDelete: void 0,
        onBeforeDelete: void 0,
        onViewportChangeStart: void 0,
        onViewportChange: void 0,
        onViewportChangeEnd: void 0,
        onNodeDragStart: void 0,
        onNodeDrag: void 0,
        onNodeDragStop: void 0,
        onSelectionDragStart: void 0,
        onSelectionDrag: void 0,
        onSelectionDragStop: void 0,
        onMoveStart: void 0,
        onMove: void 0,
        onMoveEnd: void 0,
        onConnect: void 0,
        onConnectStart: void 0,
        onConnectEnd: void 0,
        onClickConnectStart: void 0,
        onClickConnectEnd: void 0
      };
    };
    var createStore2 = ({ nodes, edges, defaultNodes, defaultEdges, width, height, fitView, fitViewOptions, minZoom, maxZoom, nodeOrigin, nodeExtent, zIndexMode }) => createWithEqualityFn((set3, get3) => {
      async function resolveFitView() {
        const { nodeLookup, panZoom, fitViewOptions: fitViewOptions2, fitViewResolver, width: width2, height: height2, minZoom: minZoom2, maxZoom: maxZoom2 } = get3();
        if (!panZoom) {
          return;
        }
        await fitViewport({
          nodes: nodeLookup,
          width: width2,
          height: height2,
          panZoom,
          minZoom: minZoom2,
          maxZoom: maxZoom2
        }, fitViewOptions2);
        fitViewResolver?.resolve(true);
        set3({ fitViewResolver: null });
      }
      return {
        ...getInitialState({
          nodes,
          edges,
          width,
          height,
          fitView,
          fitViewOptions,
          minZoom,
          maxZoom,
          nodeOrigin,
          nodeExtent,
          defaultNodes,
          defaultEdges,
          zIndexMode
        }),
        setNodes: (nodes2) => {
          const { nodeLookup, parentLookup, nodeOrigin: nodeOrigin2, nodeExtent: nodeExtent2, elevateNodesOnSelect, fitViewQueued, zIndexMode: zIndexMode2, nodesSelectionActive } = get3();
          const { nodesInitialized, hasSelectedNodes } = adoptUserNodes(nodes2, nodeLookup, parentLookup, {
            nodeOrigin: nodeOrigin2,
            nodeExtent: nodeExtent2,
            elevateNodesOnSelect,
            checkEquality: true,
            zIndexMode: zIndexMode2
          });
          const nextNodesSelectionActive = nodesSelectionActive && hasSelectedNodes;
          if (fitViewQueued && nodesInitialized) {
            resolveFitView();
            set3({
              nodes: nodes2,
              nodesInitialized,
              fitViewQueued: false,
              fitViewOptions: void 0,
              nodesSelectionActive: nextNodesSelectionActive
            });
          } else {
            set3({ nodes: nodes2, nodesInitialized, nodesSelectionActive: nextNodesSelectionActive });
          }
        },
        setEdges: (edges2) => {
          const { connectionLookup, edgeLookup } = get3();
          updateConnectionLookup(connectionLookup, edgeLookup, edges2);
          set3({ edges: edges2 });
        },
        setDefaultNodesAndEdges: (nodes2, edges2) => {
          if (nodes2) {
            const { setNodes } = get3();
            setNodes(nodes2);
            set3({ hasDefaultNodes: true });
          }
          if (edges2) {
            const { setEdges } = get3();
            setEdges(edges2);
            set3({ hasDefaultEdges: true });
          }
        },
        /*
         * Every node gets registered at a ResizeObserver. Whenever a node
         * changes its dimensions, this function is called to measure the
         * new dimensions and update the nodes.
         */
        updateNodeInternals: (updates) => {
          const { triggerNodeChanges, nodeLookup, parentLookup, domNode, nodeOrigin: nodeOrigin2, nodeExtent: nodeExtent2, debug, fitViewQueued, zIndexMode: zIndexMode2 } = get3();
          const { changes, updatedInternals } = updateNodeInternals(updates, nodeLookup, parentLookup, domNode, nodeOrigin2, nodeExtent2, zIndexMode2);
          if (!updatedInternals) {
            return;
          }
          updateAbsolutePositions(nodeLookup, parentLookup, { nodeOrigin: nodeOrigin2, nodeExtent: nodeExtent2, zIndexMode: zIndexMode2 });
          if (fitViewQueued) {
            resolveFitView();
            set3({ fitViewQueued: false, fitViewOptions: void 0 });
          } else {
            set3({});
          }
          if (changes?.length > 0) {
            if (debug) {
              console.log("React Flow: trigger node changes", changes);
            }
            triggerNodeChanges?.(changes);
          }
        },
        updateNodePositions: (nodeDragItems, dragging = false) => {
          const parentExpandChildren = [];
          let changes = [];
          const { nodeLookup, triggerNodeChanges, connection, updateConnection, onNodesChangeMiddlewareMap } = get3();
          for (const [id2, dragItem] of nodeDragItems) {
            const node = nodeLookup.get(id2);
            const expandParent = !!(node?.expandParent && node?.parentId && dragItem?.position);
            const change = {
              id: id2,
              type: "position",
              position: expandParent ? {
                x: Math.max(0, dragItem.position.x),
                y: Math.max(0, dragItem.position.y)
              } : dragItem.position,
              dragging
            };
            if (node && connection.inProgress && connection.fromNode.id === node.id) {
              const updatedFrom = getHandlePosition(node, connection.fromHandle, Position.Left, true);
              updateConnection({ ...connection, from: updatedFrom });
            }
            if (expandParent && node.parentId) {
              parentExpandChildren.push({
                id: id2,
                parentId: node.parentId,
                rect: {
                  ...dragItem.internals.positionAbsolute,
                  width: dragItem.measured.width ?? 0,
                  height: dragItem.measured.height ?? 0
                }
              });
            }
            changes.push(change);
          }
          if (parentExpandChildren.length > 0) {
            const { parentLookup, nodeOrigin: nodeOrigin2 } = get3();
            const parentExpandChanges = handleExpandParent(parentExpandChildren, nodeLookup, parentLookup, nodeOrigin2);
            changes.push(...parentExpandChanges);
          }
          for (const middleware of onNodesChangeMiddlewareMap.values()) {
            changes = middleware(changes);
          }
          triggerNodeChanges(changes);
        },
        triggerNodeChanges: (changes) => {
          const { onNodesChange, setNodes, nodes: nodes2, hasDefaultNodes, debug } = get3();
          if (changes?.length) {
            if (hasDefaultNodes) {
              const updatedNodes = applyNodeChanges(changes, nodes2);
              setNodes(updatedNodes);
            }
            if (debug) {
              console.log("React Flow: trigger node changes", changes);
            }
            onNodesChange?.(changes);
          }
        },
        triggerEdgeChanges: (changes) => {
          const { onEdgesChange, setEdges, edges: edges2, hasDefaultEdges, debug } = get3();
          if (changes?.length) {
            if (hasDefaultEdges) {
              const updatedEdges = applyEdgeChanges(changes, edges2);
              setEdges(updatedEdges);
            }
            if (debug) {
              console.log("React Flow: trigger edge changes", changes);
            }
            onEdgesChange?.(changes);
          }
        },
        addSelectedNodes: (selectedNodeIds) => {
          const { multiSelectionActive, edgeLookup, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get3();
          if (multiSelectionActive) {
            const nodeChanges = selectedNodeIds.map((nodeId) => createSelectionChange(nodeId, true));
            triggerNodeChanges(nodeChanges);
            return;
          }
          triggerNodeChanges(getSelectionChanges(nodeLookup, /* @__PURE__ */ new Set([...selectedNodeIds])));
          triggerEdgeChanges(getSelectionChanges(edgeLookup));
        },
        addSelectedEdges: (selectedEdgeIds) => {
          const { multiSelectionActive, edgeLookup, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get3();
          if (multiSelectionActive) {
            const changedEdges = selectedEdgeIds.map((edgeId) => createSelectionChange(edgeId, true));
            triggerEdgeChanges(changedEdges);
            return;
          }
          triggerEdgeChanges(getSelectionChanges(edgeLookup, /* @__PURE__ */ new Set([...selectedEdgeIds])));
          triggerNodeChanges(getSelectionChanges(nodeLookup, /* @__PURE__ */ new Set()));
        },
        unselectNodesAndEdges: ({ nodes: nodes2, edges: edges2 } = {}) => {
          const { edges: storeEdges, nodes: storeNodes, nodeLookup, triggerNodeChanges, triggerEdgeChanges } = get3();
          const nodesToUnselect = nodes2 ? nodes2 : storeNodes;
          const edgesToUnselect = edges2 ? edges2 : storeEdges;
          const nodeChanges = [];
          for (const node of nodesToUnselect) {
            if (!node.selected) {
              continue;
            }
            nodeChanges.push(createSelectionChange(node.id, false));
          }
          const edgeChanges = [];
          for (const edge2 of edgesToUnselect) {
            if (!edge2.selected) {
              continue;
            }
            edgeChanges.push(createSelectionChange(edge2.id, false));
          }
          triggerNodeChanges(nodeChanges);
          triggerEdgeChanges(edgeChanges);
        },
        setMinZoom: (minZoom2) => {
          const { panZoom, maxZoom: maxZoom2 } = get3();
          panZoom?.setScaleExtent([minZoom2, maxZoom2]);
          set3({ minZoom: minZoom2 });
        },
        setMaxZoom: (maxZoom2) => {
          const { panZoom, minZoom: minZoom2 } = get3();
          panZoom?.setScaleExtent([minZoom2, maxZoom2]);
          set3({ maxZoom: maxZoom2 });
        },
        setTranslateExtent: (translateExtent) => {
          get3().panZoom?.setTranslateExtent(translateExtent);
          set3({ translateExtent });
        },
        resetSelectedElements: () => {
          const { edges: edges2, nodes: nodes2, triggerNodeChanges, triggerEdgeChanges, elementsSelectable } = get3();
          if (!elementsSelectable) {
            return;
          }
          const nodeChanges = nodes2.reduce((res, node) => node.selected ? [...res, createSelectionChange(node.id, false)] : res, []);
          const edgeChanges = edges2.reduce((res, edge2) => edge2.selected ? [...res, createSelectionChange(edge2.id, false)] : res, []);
          triggerNodeChanges(nodeChanges);
          triggerEdgeChanges(edgeChanges);
        },
        setNodeExtent: (nextNodeExtent) => {
          const { nodes: nodes2, nodeLookup, parentLookup, nodeOrigin: nodeOrigin2, elevateNodesOnSelect, nodeExtent: nodeExtent2, zIndexMode: zIndexMode2 } = get3();
          if (nextNodeExtent[0][0] === nodeExtent2[0][0] && nextNodeExtent[0][1] === nodeExtent2[0][1] && nextNodeExtent[1][0] === nodeExtent2[1][0] && nextNodeExtent[1][1] === nodeExtent2[1][1]) {
            return;
          }
          adoptUserNodes(nodes2, nodeLookup, parentLookup, {
            nodeOrigin: nodeOrigin2,
            nodeExtent: nextNodeExtent,
            elevateNodesOnSelect,
            checkEquality: false,
            zIndexMode: zIndexMode2
          });
          set3({ nodeExtent: nextNodeExtent });
        },
        panBy: (delta) => {
          const { transform: transform2, width: width2, height: height2, panZoom, translateExtent } = get3();
          return panBy({ delta, panZoom, transform: transform2, translateExtent, width: width2, height: height2 });
        },
        setCenter: async (x, y, options) => {
          const { width: width2, height: height2, maxZoom: maxZoom2, panZoom } = get3();
          if (!panZoom) {
            return false;
          }
          const nextZoom = typeof options?.zoom !== "undefined" ? options.zoom : maxZoom2;
          await panZoom.setViewport({
            x: width2 / 2 - x * nextZoom,
            y: height2 / 2 - y * nextZoom,
            zoom: nextZoom
          }, { duration: options?.duration, ease: options?.ease, interpolate: options?.interpolate });
          return true;
        },
        cancelConnection: () => {
          set3({
            connection: { ...initialConnection }
          });
        },
        updateConnection: (connection) => {
          set3({ connection });
        },
        reset: () => set3({ ...getInitialState() })
      };
    }, Object.is);
    function ReactFlowProvider({ initialNodes: nodes, initialEdges: edges, defaultNodes, defaultEdges, initialWidth: width, initialHeight: height, initialMinZoom: minZoom, initialMaxZoom: maxZoom, initialFitViewOptions: fitViewOptions, fitView, nodeOrigin, nodeExtent, zIndexMode, children: children2 }) {
      const [store] = (0, import_react2.useState)(() => createStore2({
        nodes,
        edges,
        defaultNodes,
        defaultEdges,
        width,
        height,
        fitView,
        minZoom,
        maxZoom,
        fitViewOptions,
        nodeOrigin,
        nodeExtent,
        zIndexMode
      }));
      return (0, import_jsx_runtime.jsx)(Provider$1, { value: store, children: (0, import_jsx_runtime.jsx)(BatchProvider, { children: (0, import_jsx_runtime.jsx)(HandleConfigProvider, { children: children2 }) }) });
    }
    function Wrapper({ children: children2, nodes, edges, defaultNodes, defaultEdges, width, height, fitView, fitViewOptions, minZoom, maxZoom, nodeOrigin, nodeExtent, zIndexMode }) {
      const isWrapped = (0, import_react2.useContext)(StoreContext);
      if (isWrapped) {
        return (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: children2 });
      }
      return (0, import_jsx_runtime.jsx)(ReactFlowProvider, { initialNodes: nodes, initialEdges: edges, defaultNodes, defaultEdges, initialWidth: width, initialHeight: height, fitView, initialFitViewOptions: fitViewOptions, initialMinZoom: minZoom, initialMaxZoom: maxZoom, nodeOrigin, nodeExtent, zIndexMode, children: children2 });
    }
    var wrapperStyle = {
      width: "100%",
      height: "100%",
      overflow: "hidden",
      position: "relative",
      zIndex: 0
    };
    function ReactFlow({ nodes, edges, defaultNodes, defaultEdges, className, nodeTypes, edgeTypes, onNodeClick, onEdgeClick, onInit, onMove, onMoveStart, onMoveEnd, onConnect, onConnectStart, onConnectEnd, onClickConnectStart, onClickConnectEnd, onNodeMouseEnter, onNodeMouseMove, onNodeMouseLeave, onNodeContextMenu, onNodeDoubleClick, onNodeDragStart, onNodeDrag, onNodeDragStop, onNodesDelete, onEdgesDelete, onDelete, onSelectionChange, onSelectionDragStart, onSelectionDrag, onSelectionDragStop, onSelectionContextMenu, onSelectionStart, onSelectionEnd, onBeforeDelete, connectionMode, connectionLineType = ConnectionLineType.Bezier, connectionLineStyle, connectionLineComponent, connectionLineContainerStyle, deleteKeyCode = "Backspace", selectionKeyCode = "Shift", selectionOnDrag = false, selectionMode = SelectionMode.Full, panActivationKeyCode = "Space", multiSelectionKeyCode = isMacOs() ? "Meta" : "Control", zoomActivationKeyCode = isMacOs() ? "Meta" : "Control", snapToGrid, snapGrid, onlyRenderVisibleElements = false, selectNodesOnDrag, nodesDraggable, autoPanOnNodeFocus, nodesConnectable, nodesFocusable, nodeOrigin = defaultNodeOrigin, edgesFocusable, edgesReconnectable, elementsSelectable = true, defaultViewport: defaultViewport$1 = defaultViewport, minZoom = 0.5, maxZoom = 2, translateExtent = infiniteExtent, preventScrolling = true, nodeExtent, defaultMarkerColor = "#b1b1b7", zoomOnScroll = true, zoomOnPinch = true, panOnScroll = false, panOnScrollSpeed = 0.5, panOnScrollMode = PanOnScrollMode.Free, zoomOnDoubleClick = true, panOnDrag = true, onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneScroll, onPaneContextMenu, paneClickDistance = 1, nodeClickDistance = 0, children: children2, onReconnect, onReconnectStart, onReconnectEnd, onEdgeContextMenu, onEdgeDoubleClick, onEdgeMouseEnter, onEdgeMouseMove, onEdgeMouseLeave, reconnectRadius = 10, onNodesChange, onEdgesChange, noDragClassName = "nodrag", noWheelClassName = "nowheel", noPanClassName = "nopan", fitView, fitViewOptions, connectOnClick, attributionPosition, proOptions, defaultEdgeOptions, elevateNodesOnSelect = true, elevateEdgesOnSelect = false, disableKeyboardA11y = false, autoPanOnConnect, autoPanOnNodeDrag, autoPanOnSelection = true, autoPanSpeed, connectionRadius, isValidConnection, onError, style: style2, id: id2, nodeDragThreshold, connectionDragThreshold, viewport, onViewportChange, width, height, colorMode = "light", debug, onScroll, ariaLabelConfig, zIndexMode = "basic", ...rest }, ref) {
      const rfId = id2 || "1";
      const colorModeClassName = useColorModeClass(colorMode);
      const wrapperOnScroll = (0, import_react2.useCallback)((e) => {
        e.currentTarget.scrollTo({ top: 0, left: 0, behavior: "instant" });
        onScroll?.(e);
      }, [onScroll]);
      return (0, import_jsx_runtime.jsx)("div", { "data-testid": "rf__wrapper", ...rest, onScroll: wrapperOnScroll, style: { ...style2, ...wrapperStyle }, ref, className: cc(["react-flow", className, colorModeClassName]), id: id2, role: "application", children: (0, import_jsx_runtime.jsxs)(Wrapper, { nodes, edges, width, height, fitView, fitViewOptions, minZoom, maxZoom, nodeOrigin, nodeExtent, zIndexMode, children: [(0, import_jsx_runtime.jsx)(StoreUpdater, { nodes, edges, defaultNodes, defaultEdges, onConnect, onConnectStart, onConnectEnd, onClickConnectStart, onClickConnectEnd, nodesDraggable, autoPanOnNodeFocus, nodesConnectable, nodesFocusable, edgesFocusable, edgesReconnectable, elementsSelectable, elevateNodesOnSelect, elevateEdgesOnSelect, minZoom, maxZoom, nodeExtent, onNodesChange, onEdgesChange, snapToGrid, snapGrid, connectionMode, translateExtent, connectOnClick, defaultEdgeOptions, fitView, fitViewOptions, onNodesDelete, onEdgesDelete, onDelete, onNodeDragStart, onNodeDrag, onNodeDragStop, onSelectionDrag, onSelectionDragStart, onSelectionDragStop, onMove, onMoveStart, onMoveEnd, noPanClassName, nodeOrigin, rfId, autoPanOnConnect, autoPanOnNodeDrag, autoPanSpeed, onError, connectionRadius, isValidConnection, selectNodesOnDrag, nodeDragThreshold, connectionDragThreshold, onBeforeDelete, debug, ariaLabelConfig, zIndexMode }), (0, import_jsx_runtime.jsx)(GraphView, { onInit, onNodeClick, onEdgeClick, onNodeMouseEnter, onNodeMouseMove, onNodeMouseLeave, onNodeContextMenu, onNodeDoubleClick, nodeTypes, edgeTypes, connectionLineType, connectionLineStyle, connectionLineComponent, connectionLineContainerStyle, selectionKeyCode, selectionOnDrag, selectionMode, deleteKeyCode, multiSelectionKeyCode, panActivationKeyCode, zoomActivationKeyCode, onlyRenderVisibleElements, defaultViewport: defaultViewport$1, translateExtent, minZoom, maxZoom, preventScrolling, zoomOnScroll, zoomOnPinch, zoomOnDoubleClick, panOnScroll, panOnScrollSpeed, panOnScrollMode, panOnDrag, autoPanOnSelection, onPaneClick, onPaneMouseEnter, onPaneMouseMove, onPaneMouseLeave, onPaneScroll, onPaneContextMenu, paneClickDistance, nodeClickDistance, onSelectionContextMenu, onSelectionStart, onSelectionEnd, onReconnect, onReconnectStart, onReconnectEnd, onEdgeContextMenu, onEdgeDoubleClick, onEdgeMouseEnter, onEdgeMouseMove, onEdgeMouseLeave, reconnectRadius, defaultMarkerColor, noDragClassName, noWheelClassName, noPanClassName, rfId, disableKeyboardA11y, nodeExtent, viewport, onViewportChange, nodesDraggable }), (0, import_jsx_runtime.jsx)(SelectionListener, { onSelectionChange }), children2, (0, import_jsx_runtime.jsx)(Attribution, { proOptions, position: attributionPosition }), (0, import_jsx_runtime.jsx)(A11yDescriptions, { rfId, disableKeyboardA11y })] }) });
    }
    var index = fixedForwardRef(ReactFlow);
    var error014 = errorMessages["error014"]();
    function LinePattern({ dimensions, lineWidth, variant, className }) {
      return (0, import_jsx_runtime.jsx)("path", { strokeWidth: lineWidth, d: `M${dimensions[0] / 2} 0 V${dimensions[1]} M0 ${dimensions[1] / 2} H${dimensions[0]}`, className: cc(["react-flow__background-pattern", variant, className]) });
    }
    function DotPattern({ radius, className }) {
      return (0, import_jsx_runtime.jsx)("circle", { cx: radius, cy: radius, r: radius, className: cc(["react-flow__background-pattern", "dots", className]) });
    }
    var BackgroundVariant;
    (function(BackgroundVariant2) {
      BackgroundVariant2["Lines"] = "lines";
      BackgroundVariant2["Dots"] = "dots";
      BackgroundVariant2["Cross"] = "cross";
    })(BackgroundVariant || (BackgroundVariant = {}));
    var defaultSize = {
      [BackgroundVariant.Dots]: 1,
      [BackgroundVariant.Lines]: 1,
      [BackgroundVariant.Cross]: 6
    };
    var selector$3 = (s) => ({ transform: s.transform, patternId: `pattern-${s.rfId}` });
    function BackgroundComponent({
      id: id2,
      variant = BackgroundVariant.Dots,
      // only used for dots and cross
      gap = 20,
      // only used for lines and cross
      size,
      lineWidth = 1,
      offset = 0,
      color: color2,
      bgColor,
      style: style2,
      className,
      patternClassName
    }) {
      const ref = (0, import_react2.useRef)(null);
      const { transform: transform2, patternId } = useStore(selector$3, shallow$1);
      const patternSize = size || defaultSize[variant];
      const isDots = variant === BackgroundVariant.Dots;
      const isCross = variant === BackgroundVariant.Cross;
      const gapXY = Array.isArray(gap) ? gap : [gap, gap];
      const scaledGap = [gapXY[0] * transform2[2] || 1, gapXY[1] * transform2[2] || 1];
      const scaledSize = patternSize * transform2[2];
      const offsetXY = Array.isArray(offset) ? offset : [offset, offset];
      const patternDimensions = isCross ? [scaledSize, scaledSize] : scaledGap;
      const scaledOffset = [
        offsetXY[0] * transform2[2] + patternDimensions[0] / 2,
        offsetXY[1] * transform2[2] + patternDimensions[1] / 2
      ];
      const _patternId = `${patternId}${id2 ? id2 : ""}`;
      return (0, import_jsx_runtime.jsxs)("svg", { className: cc(["react-flow__background", className]), style: {
        ...style2,
        ...containerStyle,
        "--xy-background-color-props": bgColor,
        "--xy-background-pattern-color-props": color2
      }, ref, "data-testid": "rf__background", children: [(0, import_jsx_runtime.jsx)("pattern", { id: _patternId, x: transform2[0] % scaledGap[0], y: transform2[1] % scaledGap[1], width: scaledGap[0], height: scaledGap[1], patternUnits: "userSpaceOnUse", patternTransform: `translate(-${scaledOffset[0]},-${scaledOffset[1]})`, children: isDots ? (0, import_jsx_runtime.jsx)(DotPattern, { radius: scaledSize / 2, className: patternClassName }) : (0, import_jsx_runtime.jsx)(LinePattern, { dimensions: patternDimensions, lineWidth, variant, className: patternClassName }) }), (0, import_jsx_runtime.jsx)("rect", { x: "0", y: "0", width: "100%", height: "100%", fill: `url(#${_patternId})` })] });
    }
    BackgroundComponent.displayName = "Background";
    var Background = (0, import_react2.memo)(BackgroundComponent);
    function PlusIcon() {
      return (0, import_jsx_runtime.jsx)("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 32", children: (0, import_jsx_runtime.jsx)("path", { d: "M32 18.133H18.133V32h-4.266V18.133H0v-4.266h13.867V0h4.266v13.867H32z" }) });
    }
    function MinusIcon() {
      return (0, import_jsx_runtime.jsx)("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 5", children: (0, import_jsx_runtime.jsx)("path", { d: "M0 0h32v4.2H0z" }) });
    }
    function FitViewIcon() {
      return (0, import_jsx_runtime.jsx)("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 32 30", children: (0, import_jsx_runtime.jsx)("path", { d: "M3.692 4.63c0-.53.4-.938.939-.938h5.215V0H4.708C2.13 0 0 2.054 0 4.63v5.216h3.692V4.631zM27.354 0h-5.2v3.692h5.17c.53 0 .984.4.984.939v5.215H32V4.631A4.624 4.624 0 0027.354 0zm.954 24.83c0 .532-.4.94-.939.94h-5.215v3.768h5.215c2.577 0 4.631-2.13 4.631-4.707v-5.139h-3.692v5.139zm-23.677.94c-.531 0-.939-.4-.939-.94v-5.138H0v5.139c0 2.577 2.13 4.707 4.708 4.707h5.138V25.77H4.631z" }) });
    }
    function LockIcon() {
      return (0, import_jsx_runtime.jsx)("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 25 32", children: (0, import_jsx_runtime.jsx)("path", { d: "M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0 8 0 4.571 3.429 4.571 7.619v3.048H3.048A3.056 3.056 0 000 13.714v15.238A3.056 3.056 0 003.048 32h18.285a3.056 3.056 0 003.048-3.048V13.714a3.056 3.056 0 00-3.048-3.047zM12.19 24.533a3.056 3.056 0 01-3.047-3.047 3.056 3.056 0 013.047-3.048 3.056 3.056 0 013.048 3.048 3.056 3.056 0 01-3.048 3.047zm4.724-13.866H7.467V7.619c0-2.59 2.133-4.724 4.723-4.724 2.591 0 4.724 2.133 4.724 4.724v3.048z" }) });
    }
    function UnlockIcon() {
      return (0, import_jsx_runtime.jsx)("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 25 32", children: (0, import_jsx_runtime.jsx)("path", { d: "M21.333 10.667H19.81V7.619C19.81 3.429 16.38 0 12.19 0c-4.114 1.828-1.37 2.133.305 2.438 1.676.305 4.42 2.59 4.42 5.181v3.048H3.047A3.056 3.056 0 000 13.714v15.238A3.056 3.056 0 003.048 32h18.285a3.056 3.056 0 003.048-3.048V13.714a3.056 3.056 0 00-3.048-3.047zM12.19 24.533a3.056 3.056 0 01-3.047-3.047 3.056 3.056 0 013.047-3.048 3.056 3.056 0 013.048 3.048 3.056 3.056 0 01-3.048 3.047z" }) });
    }
    function ControlButton({ children: children2, className, ...rest }) {
      return (0, import_jsx_runtime.jsx)("button", { type: "button", className: cc(["react-flow__controls-button", className]), ...rest, children: children2 });
    }
    var selector$2 = (s) => ({
      isInteractive: s.nodesDraggable || s.nodesConnectable || s.elementsSelectable,
      minZoomReached: s.transform[2] <= s.minZoom,
      maxZoomReached: s.transform[2] >= s.maxZoom,
      ariaLabelConfig: s.ariaLabelConfig
    });
    function ControlsComponent({ style: style2, showZoom = true, showFitView = true, showInteractive = true, fitViewOptions, onZoomIn, onZoomOut, onFitView, onInteractiveChange, className, children: children2, position = "bottom-left", orientation = "vertical", "aria-label": ariaLabel }) {
      const store = useStoreApi();
      const { isInteractive, minZoomReached, maxZoomReached, ariaLabelConfig } = useStore(selector$2, shallow$1);
      const { zoomIn, zoomOut, fitView } = useReactFlow();
      const onZoomInHandler = () => {
        zoomIn();
        onZoomIn?.();
      };
      const onZoomOutHandler = () => {
        zoomOut();
        onZoomOut?.();
      };
      const onFitViewHandler = () => {
        fitView(fitViewOptions);
        onFitView?.();
      };
      const onToggleInteractivity = () => {
        store.setState({
          nodesDraggable: !isInteractive,
          nodesConnectable: !isInteractive,
          elementsSelectable: !isInteractive
        });
        onInteractiveChange?.(!isInteractive);
      };
      const orientationClass = orientation === "horizontal" ? "horizontal" : "vertical";
      return (0, import_jsx_runtime.jsxs)(Panel, { className: cc(["react-flow__controls", orientationClass, className]), position, style: style2, "data-testid": "rf__controls", "aria-label": ariaLabel ?? ariaLabelConfig["controls.ariaLabel"], children: [showZoom && (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(0, import_jsx_runtime.jsx)(ControlButton, { onClick: onZoomInHandler, className: "react-flow__controls-zoomin", title: ariaLabelConfig["controls.zoomIn.ariaLabel"], "aria-label": ariaLabelConfig["controls.zoomIn.ariaLabel"], disabled: maxZoomReached, children: (0, import_jsx_runtime.jsx)(PlusIcon, {}) }), (0, import_jsx_runtime.jsx)(ControlButton, { onClick: onZoomOutHandler, className: "react-flow__controls-zoomout", title: ariaLabelConfig["controls.zoomOut.ariaLabel"], "aria-label": ariaLabelConfig["controls.zoomOut.ariaLabel"], disabled: minZoomReached, children: (0, import_jsx_runtime.jsx)(MinusIcon, {}) })] }), showFitView && (0, import_jsx_runtime.jsx)(ControlButton, { className: "react-flow__controls-fitview", onClick: onFitViewHandler, title: ariaLabelConfig["controls.fitView.ariaLabel"], "aria-label": ariaLabelConfig["controls.fitView.ariaLabel"], children: (0, import_jsx_runtime.jsx)(FitViewIcon, {}) }), showInteractive && (0, import_jsx_runtime.jsx)(ControlButton, { className: "react-flow__controls-interactive", onClick: onToggleInteractivity, title: ariaLabelConfig["controls.interactive.ariaLabel"], "aria-label": ariaLabelConfig["controls.interactive.ariaLabel"], children: isInteractive ? (0, import_jsx_runtime.jsx)(UnlockIcon, {}) : (0, import_jsx_runtime.jsx)(LockIcon, {}) }), children2] });
    }
    ControlsComponent.displayName = "Controls";
    var Controls = (0, import_react2.memo)(ControlsComponent);
    function MiniMapNodeComponent({ id: id2, x, y, width, height, style: style2, color: color2, strokeColor, strokeWidth, className, borderRadius, shapeRendering, selected: selected2, onClick }) {
      const { background, backgroundColor } = style2 || {};
      const fill = color2 || background || backgroundColor;
      return (0, import_jsx_runtime.jsx)("rect", { className: cc(["react-flow__minimap-node", { selected: selected2 }, className]), x, y, rx: borderRadius, ry: borderRadius, width, height, style: {
        fill,
        stroke: strokeColor,
        strokeWidth
      }, shapeRendering, onClick: onClick ? (event) => onClick(event, id2) : void 0 });
    }
    var MiniMapNode = (0, import_react2.memo)(MiniMapNodeComponent);
    var selectorNodeIds = (s) => s.nodes.map((node) => node.id);
    var getAttrFunction = (func) => func instanceof Function ? func : () => func;
    function MiniMapNodes({
      nodeStrokeColor,
      nodeColor,
      nodeClassName = "",
      nodeBorderRadius = 5,
      nodeStrokeWidth,
      /*
       * We need to rename the prop to be `CapitalCase` so that JSX will render it as
       * a component properly.
       */
      nodeComponent: NodeComponent = MiniMapNode,
      onClick
    }) {
      const nodeIds = useStore(selectorNodeIds, shallow$1);
      const nodeColorFunc = getAttrFunction(nodeColor);
      const nodeStrokeColorFunc = getAttrFunction(nodeStrokeColor);
      const nodeClassNameFunc = getAttrFunction(nodeClassName);
      const shapeRendering = typeof window === "undefined" || !!window.chrome ? "crispEdges" : "geometricPrecision";
      return (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: nodeIds.map((nodeId) => (
        /*
         * The split of responsibilities between MiniMapNodes and
         * NodeComponentWrapper may appear weird. However, it’s designed to
         * minimize the cost of updates when individual nodes change.
         *
         * For more details, see a similar commit in `NodeRenderer/index.tsx`.
         */
        (0, import_jsx_runtime.jsx)(NodeComponentWrapper, { id: nodeId, nodeColorFunc, nodeStrokeColorFunc, nodeClassNameFunc, nodeBorderRadius, nodeStrokeWidth, NodeComponent, onClick, shapeRendering }, nodeId)
      )) });
    }
    function NodeComponentWrapperInner({ id: id2, nodeColorFunc, nodeStrokeColorFunc, nodeClassNameFunc, nodeBorderRadius, nodeStrokeWidth, shapeRendering, NodeComponent, onClick }) {
      const { node, x, y, width, height } = useStore((s) => {
        const node2 = s.nodeLookup.get(id2);
        if (!node2) {
          return { node: void 0, x: 0, y: 0, width: 0, height: 0 };
        }
        const userNode = node2.internals.userNode;
        const { x: x2, y: y2 } = node2.internals.positionAbsolute;
        const { width: width2, height: height2 } = getNodeDimensions(userNode);
        return {
          node: userNode,
          x: x2,
          y: y2,
          width: width2,
          height: height2
        };
      }, shallow$1);
      if (!node || node.hidden || !nodeHasDimensions(node)) {
        return null;
      }
      return (0, import_jsx_runtime.jsx)(NodeComponent, { x, y, width, height, style: node.style, selected: !!node.selected, className: nodeClassNameFunc(node), color: nodeColorFunc(node), borderRadius: nodeBorderRadius, strokeColor: nodeStrokeColorFunc(node), strokeWidth: nodeStrokeWidth, shapeRendering, onClick, id: node.id });
    }
    var NodeComponentWrapper = (0, import_react2.memo)(NodeComponentWrapperInner);
    var MiniMapNodes$1 = (0, import_react2.memo)(MiniMapNodes);
    var defaultWidth = 200;
    var defaultHeight = 150;
    var filterHidden = (node) => !node.hidden;
    var selector$1 = (s) => {
      const viewBB = {
        x: -s.transform[0] / s.transform[2],
        y: -s.transform[1] / s.transform[2],
        width: s.width / s.transform[2],
        height: s.height / s.transform[2]
      };
      let hasVisibleNode = false;
      for (const node of s.nodeLookup.values()) {
        if (!node.hidden) {
          hasVisibleNode = true;
          break;
        }
      }
      return {
        viewBB,
        boundingRect: hasVisibleNode ? getBoundsOfRects(getInternalNodesBounds(s.nodeLookup, { filter: filterHidden }), viewBB) : viewBB,
        rfId: s.rfId,
        panZoom: s.panZoom,
        translateExtent: s.translateExtent,
        flowWidth: s.width,
        flowHeight: s.height,
        ariaLabelConfig: s.ariaLabelConfig
      };
    };
    var rectEqual = (a, b) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    var areEqual = (a, b) => rectEqual(a.viewBB, b.viewBB) && rectEqual(a.boundingRect, b.boundingRect) && a.rfId === b.rfId && a.panZoom === b.panZoom && a.translateExtent === b.translateExtent && a.flowWidth === b.flowWidth && a.flowHeight === b.flowHeight && a.ariaLabelConfig === b.ariaLabelConfig;
    var ARIA_LABEL_KEY = "react-flow__minimap-desc";
    function MiniMapComponent({
      style: style2,
      className,
      nodeStrokeColor,
      nodeColor,
      nodeClassName = "",
      nodeBorderRadius = 5,
      nodeStrokeWidth,
      /*
       * We need to rename the prop to be `CapitalCase` so that JSX will render it as
       * a component properly.
       */
      nodeComponent,
      bgColor,
      maskColor,
      maskStrokeColor,
      maskStrokeWidth,
      position = "bottom-right",
      onClick,
      onNodeClick,
      pannable = false,
      zoomable = false,
      ariaLabel,
      inversePan,
      zoomStep = 1,
      offsetScale = 5
    }) {
      const store = useStoreApi();
      const svg = (0, import_react2.useRef)(null);
      const { boundingRect, panZoom, viewBB, rfId, translateExtent, flowWidth, flowHeight, ariaLabelConfig } = useStore(selector$1, areEqual);
      const elementWidth = style2?.width ?? defaultWidth;
      const elementHeight = style2?.height ?? defaultHeight;
      const scaledWidth = boundingRect.width / elementWidth;
      const scaledHeight = boundingRect.height / elementHeight;
      const viewScale = Math.max(scaledWidth, scaledHeight);
      const viewWidth = viewScale * elementWidth;
      const viewHeight = viewScale * elementHeight;
      const offset = offsetScale * viewScale;
      const x = boundingRect.x - (viewWidth - boundingRect.width) / 2 - offset;
      const y = boundingRect.y - (viewHeight - boundingRect.height) / 2 - offset;
      const width = viewWidth + offset * 2;
      const height = viewHeight + offset * 2;
      const labelledBy = `${ARIA_LABEL_KEY}-${rfId}`;
      const viewScaleRef = (0, import_react2.useRef)(0);
      const minimapInstance = (0, import_react2.useRef)();
      viewScaleRef.current = viewScale;
      (0, import_react2.useEffect)(() => {
        const currentPanZoom = store.getState().panZoom;
        if (svg.current && currentPanZoom) {
          minimapInstance.current = XYMinimap({
            domNode: svg.current,
            panZoom: currentPanZoom,
            getTransform: () => store.getState().transform,
            getViewScale: () => viewScaleRef.current
          });
          return () => {
            minimapInstance.current?.destroy();
          };
        }
      }, [panZoom]);
      (0, import_react2.useEffect)(() => {
        minimapInstance.current?.update({
          translateExtent,
          width: flowWidth,
          height: flowHeight,
          inversePan,
          pannable,
          zoomStep,
          zoomable
        });
      }, [pannable, zoomable, inversePan, zoomStep, translateExtent, flowWidth, flowHeight]);
      const onSvgClick = onClick ? (event) => {
        const [x2, y2] = minimapInstance.current?.pointer(event) || [0, 0];
        onClick(event, { x: x2, y: y2 });
      } : void 0;
      const nodeClickHandler = (0, import_react2.useCallback)((event, nodeId) => {
        const node = store.getState().nodeLookup.get(nodeId).internals.userNode;
        onNodeClick?.(event, node);
      }, [onNodeClick]);
      const onSvgNodeClick = onNodeClick ? nodeClickHandler : void 0;
      const _ariaLabel = ariaLabel ?? ariaLabelConfig["minimap.ariaLabel"];
      return (0, import_jsx_runtime.jsx)(Panel, { position, style: {
        ...style2,
        "--xy-minimap-background-color-props": typeof bgColor === "string" ? bgColor : void 0,
        "--xy-minimap-mask-background-color-props": typeof maskColor === "string" ? maskColor : void 0,
        "--xy-minimap-mask-stroke-color-props": typeof maskStrokeColor === "string" ? maskStrokeColor : void 0,
        "--xy-minimap-mask-stroke-width-props": typeof maskStrokeWidth === "number" ? maskStrokeWidth * viewScale : void 0,
        "--xy-minimap-node-background-color-props": typeof nodeColor === "string" ? nodeColor : void 0,
        "--xy-minimap-node-stroke-color-props": typeof nodeStrokeColor === "string" ? nodeStrokeColor : void 0,
        "--xy-minimap-node-stroke-width-props": typeof nodeStrokeWidth === "number" ? nodeStrokeWidth : void 0
      }, className: cc(["react-flow__minimap", className]), "data-testid": "rf__minimap", children: (0, import_jsx_runtime.jsxs)("svg", { width: elementWidth, height: elementHeight, viewBox: `${x} ${y} ${width} ${height}`, className: "react-flow__minimap-svg", role: "img", "aria-labelledby": labelledBy, ref: svg, onClick: onSvgClick, children: [_ariaLabel && (0, import_jsx_runtime.jsx)("title", { id: labelledBy, children: _ariaLabel }), (0, import_jsx_runtime.jsx)(MiniMapNodes$1, { onClick: onSvgNodeClick, nodeColor, nodeStrokeColor, nodeBorderRadius, nodeClassName, nodeStrokeWidth, nodeComponent }), (0, import_jsx_runtime.jsx)("path", { className: "react-flow__minimap-mask", d: `M${x - offset},${y - offset}h${width + offset * 2}v${height + offset * 2}h${-width - offset * 2}z
            M${viewBB.x},${viewBB.y}h${viewBB.width}v${viewBB.height}h${-viewBB.width}z`, fillRule: "evenodd", pointerEvents: "none" })] }) });
    }
    MiniMapComponent.displayName = "MiniMap";
    var MiniMap = (0, import_react2.memo)(MiniMapComponent);
    var scaleSelector = (calculateScale) => (store) => calculateScale ? `${Math.max(1 / store.transform[2], 1)}` : void 0;
    var defaultPositions = {
      [ResizeControlVariant.Line]: "right",
      [ResizeControlVariant.Handle]: "bottom-right"
    };
    function ResizeControl({ nodeId, position, variant = ResizeControlVariant.Handle, className, style: style2 = void 0, children: children2, color: color2, minWidth = 10, minHeight = 10, maxWidth = Number.MAX_VALUE, maxHeight = Number.MAX_VALUE, keepAspectRatio = false, resizeDirection, autoScale = true, shouldResize, onResizeStart, onResize, onResizeEnd }) {
      const contextNodeId = useNodeId();
      const id2 = typeof nodeId === "string" ? nodeId : contextNodeId;
      const store = useStoreApi();
      const resizeControlRef = (0, import_react2.useRef)(null);
      const isHandleControl = variant === ResizeControlVariant.Handle;
      const scale = useStore((0, import_react2.useCallback)(scaleSelector(isHandleControl && autoScale), [isHandleControl, autoScale]), shallow$1);
      const resizer = (0, import_react2.useRef)(null);
      const controlPosition = position ?? defaultPositions[variant];
      (0, import_react2.useEffect)(() => {
        if (!resizeControlRef.current || !id2) {
          return;
        }
        if (!resizer.current) {
          resizer.current = XYResizer({
            domNode: resizeControlRef.current,
            nodeId: id2,
            getStoreItems: () => {
              const { nodeLookup, transform: transform2, snapGrid, snapToGrid, nodeOrigin, domNode } = store.getState();
              return {
                nodeLookup,
                transform: transform2,
                snapGrid,
                snapToGrid,
                nodeOrigin,
                paneDomNode: domNode
              };
            },
            onChange: (change, childChanges) => {
              const { triggerNodeChanges, nodeLookup, parentLookup, nodeOrigin } = store.getState();
              const changes = [];
              const nextPosition = { x: change.x, y: change.y };
              const node = nodeLookup.get(id2);
              if (node && node.expandParent && node.parentId) {
                const origin = node.origin ?? nodeOrigin;
                const width = change.width ?? node.measured.width ?? 0;
                const height = change.height ?? node.measured.height ?? 0;
                const child = {
                  id: node.id,
                  parentId: node.parentId,
                  rect: {
                    width,
                    height,
                    ...evaluateAbsolutePosition({
                      x: change.x ?? node.position.x,
                      y: change.y ?? node.position.y
                    }, { width, height }, node.parentId, nodeLookup, origin)
                  }
                };
                const parentExpandChanges = handleExpandParent([child], nodeLookup, parentLookup, nodeOrigin);
                changes.push(...parentExpandChanges);
                nextPosition.x = change.x ? Math.max(origin[0] * width, change.x) : void 0;
                nextPosition.y = change.y ? Math.max(origin[1] * height, change.y) : void 0;
              }
              if (nextPosition.x !== void 0 && nextPosition.y !== void 0) {
                const positionChange = {
                  id: id2,
                  type: "position",
                  position: { ...nextPosition }
                };
                changes.push(positionChange);
              }
              if (change.width !== void 0 && change.height !== void 0) {
                const setAttributes = !resizeDirection ? true : resizeDirection === "horizontal" ? "width" : "height";
                const dimensionChange = {
                  id: id2,
                  type: "dimensions",
                  resizing: true,
                  setAttributes,
                  dimensions: {
                    width: change.width,
                    height: change.height
                  }
                };
                changes.push(dimensionChange);
              }
              for (const childChange of childChanges) {
                const positionChange = {
                  ...childChange,
                  type: "position"
                };
                changes.push(positionChange);
              }
              triggerNodeChanges(changes);
            },
            onEnd: ({ width, height }) => {
              const dimensionChange = {
                id: id2,
                type: "dimensions",
                resizing: false,
                dimensions: {
                  width,
                  height
                }
              };
              store.getState().triggerNodeChanges([dimensionChange]);
            }
          });
        }
        resizer.current.update({
          controlPosition,
          boundaries: {
            minWidth,
            minHeight,
            maxWidth,
            maxHeight
          },
          keepAspectRatio,
          resizeDirection,
          onResizeStart,
          onResize,
          onResizeEnd,
          shouldResize
        });
        return () => {
          resizer.current?.destroy();
        };
      }, [
        controlPosition,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        keepAspectRatio,
        onResizeStart,
        onResize,
        onResizeEnd,
        shouldResize
      ]);
      const positionClassNames = controlPosition.split("-");
      return (0, import_jsx_runtime.jsx)("div", { className: cc(["react-flow__resize-control", "nodrag", ...positionClassNames, variant, className]), ref: resizeControlRef, style: {
        ...style2,
        scale,
        ...color2 && { [isHandleControl ? "backgroundColor" : "borderColor"]: color2 }
      }, children: children2 });
    }
    var NodeResizeControl = (0, import_react2.memo)(ResizeControl);

    // packages/plugin-workflows/src/client/canvas.tsx
    var import_react4 = require("react");

    // packages/plugin-workflows/src/client/bricks.ts
    var BRICK_MIME = "application/x-dsh-wf-brick";
    var TRIGGER_BRICKS = [
      { value: "turn.stopping", icon: "trigger", hintKey: "design.brick.trigger.turnStopping" },
      { value: "tool.pre-execute", icon: "trigger", hintKey: "design.brick.trigger.toolPreExecute" },
      { value: "tool.result", icon: "trigger", hintKey: "design.brick.trigger.toolResult" },
      { value: "fs.change", icon: "trigger", hintKey: "design.brick.trigger.fsChange" },
      { value: "subagent.end", icon: "trigger", hintKey: "design.brick.trigger.subagentEnd" },
      { value: "review.record", icon: "trigger", hintKey: "design.brick.trigger.reviewRecord" }
    ];
    var STEP_BRICKS = [
      {
        value: "main",
        icon: "agent",
        labelKey: "design.brick.agent",
        hintKey: "design.brick.agent.hint"
      },
      {
        value: "tool",
        icon: "tool",
        labelKey: "design.brick.tool",
        hintKey: "design.brick.tool.hint"
      },
      {
        value: "subagent",
        icon: "subagent",
        labelKey: "design.brick.subagent",
        hintKey: "design.brick.subagent.hint"
      },
      {
        value: "human",
        icon: "human",
        labelKey: "design.brick.human",
        hintKey: "design.brick.human.hint"
      },
      {
        value: "branch",
        icon: "branch",
        labelKey: "design.brick.branch",
        hintKey: "design.brick.branch.hint"
      },
      {
        value: "loop",
        icon: "loop",
        labelKey: "design.brick.loop",
        hintKey: "design.brick.loop.hint"
      }
    ];
    function brickPayload(kind, value2) {
      return `${kind}:${value2}`;
    }
    function parseBrickPayload(payload) {
      const separator = payload.indexOf(":");
      if (separator <= 0 || separator === payload.length - 1) return void 0;
      const kind = payload.slice(0, separator);
      if (kind !== "trigger" && kind !== "step") return void 0;
      const value2 = payload.slice(separator + 1);
      const catalog = kind === "trigger" ? TRIGGER_BRICKS : STEP_BRICKS;
      return catalog.some((brick) => brick.value === value2) ? { kind, value: value2 } : void 0;
    }

    // packages/plugin-workflows/src/client/glyphs.tsx
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime2 = require("react/jsx-runtime");
    var GLYPHS = {
      trigger: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconPlayOutlineRegular, {}),
      agent: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconSparkleRegular, {}),
      tool: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconCodeOutlineRegular, {}),
      subagent: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconUsersOutlineRegular, {}),
      human: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconUserOutlineRegular, {}),
      branch: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconBranchOutlineRegular, {}),
      loop: () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconRefreshOutlineRegular, {})
    };
    function brickGlyph(icon) {
      return GLYPHS[icon]();
    }
    function executorIcon(executor, kind) {
      if (executor === "tool") return "tool";
      if (executor === "subagent") return "subagent";
      if (executor === "human") return "human";
      if (executor === "branch" || kind === "branch") return "branch";
      if (executor === "loop" || kind === "loop") return "loop";
      if (kind === "trigger") return "trigger";
      return "agent";
    }

    // packages/plugin-workflows/src/client/canvas.tsx
    var import_jsx_runtime3 = require("react/jsx-runtime");
    function stateBadge(data) {
      const parts = [];
      if (data.runState !== void 0) parts.push(data.runState);
      if (data.failureClass !== void 0) parts.push(data.failureClass);
      return parts.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-wf-node-badge", "data-run-state": data.runState, children: parts.join(" \xB7 ") });
    }
    function nodeHead(data) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-wf-node-icon", "aria-hidden": "true", children: brickGlyph(executorIcon(data.executor, data.kind)) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-titles", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-title", children: data.title }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-meta", children: data.executor ?? data.kind })
        ] })
      ] });
    }
    function StepHandles(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "target", position: Position.Left, id: "target" }),
        props.kind === "branch" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Right, id: "true", style: { top: "30%" } }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Right, id: "false", style: { top: "70%" } })
        ] }) : props.kind === "loop" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Right, id: "exit" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Bottom, id: "body" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Right, id: "next" })
      ] });
    }
    function nodeBody(data) {
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        nodeHead(data),
        stateBadge(data),
        data.evidence === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "dsh-wf-node-evidence", title: data.evidence.ref, children: [
          data.evidence.kind,
          data.evidence.ref === void 0 ? "" : `: ${data.evidence.ref}`
        ] }),
        (data.violations ?? []).map((reason) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-wf-node-violation", children: reason }, reason))
      ] });
    }
    function TriggerNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node", "data-kind": "trigger", "data-state": data.runState, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-wf-node-icon", "aria-hidden": "true", children: brickGlyph("trigger") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-titles", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-title", children: "Trigger" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-meta", children: data.title })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "source", position: Position.Right, id: "start" })
      ] });
    }
    function StepNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node", "data-kind": "step", "data-state": data.runState, children: [
        nodeBody(data),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StepHandles, { kind: "step" })
      ] });
    }
    function BranchNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node", "data-kind": "branch", "data-state": data.runState, children: [
        nodeBody(data),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StepHandles, { kind: "branch" })
      ] });
    }
    function LoopNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node", "data-kind": "loop", "data-state": data.runState, children: [
        nodeBody(data),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StepHandles, { kind: "loop" })
      ] });
    }
    function HumanNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node", "data-kind": "human", "data-state": data.runState, children: [
        nodeBody(data),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(StepHandles, { kind: "human" })
      ] });
    }
    function EndNodeView(props) {
      const data = props.data;
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node dsh-wf-node-end", "data-kind": "end", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "dsh-wf-node-icon", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconCheckCircleOutlineRegular, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "dsh-wf-node-titles", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-title", children: data.title }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-node-meta", children: "end" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Handle, { type: "target", position: Position.Left, id: "target" })
      ] });
    }
    var CANVAS_NODE_TYPES = {
      trigger: TriggerNodeView,
      step: StepNodeView,
      branch: BranchNodeView,
      loop: LoopNodeView,
      human: HumanNodeView,
      end: EndNodeView
    };
    var CanvasBoundary = class extends import_react4.Component {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      componentDidCatch(error) {
        console.error(
          `workflows: the Design canvas failed to render (${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}); the list editor is showing`
        );
        this.props.onError?.(error);
      }
      render() {
        return this.state.failed ? this.props.fallback : this.props.children;
      }
    };
    function toFlowNodes(nodes, selected2) {
      return nodes.map((node) => ({
        id: node.id,
        type: node.kind,
        position: node.position,
        // React Flow takes its accessible name from ariaLabel, not data.
        ariaLabel: node.title,
        ...selected2 === void 0 ? {} : { selected: selected2 === node.id },
        data: {
          title: node.title,
          kind: node.kind,
          ...node.step === void 0 ? {} : { stepId: node.step.id },
          ...node.step === void 0 ? {} : { executor: node.step.executor },
          ...node.runState === void 0 ? {} : { runState: node.runState },
          ...node.failureClass === void 0 ? {} : { failureClass: node.failureClass },
          ...node.evidence === void 0 ? {} : { evidence: node.evidence },
          ...node.violations === void 0 ? {} : { violations: node.violations }
        }
      }));
    }
    var LABELLED_EDGES = /* @__PURE__ */ new Set(["true", "false", "body", "exit"]);
    function toFlowEdges(edges, nodes = []) {
      const titles = new Map(nodes.map((node) => [node.id, node.title]));
      return edges.map((edge2) => {
        const source = titles.get(edge2.source) ?? edge2.source;
        const target = titles.get(edge2.target) ?? edge2.target;
        return {
          id: edge2.id,
          source: edge2.source,
          target: edge2.target,
          // The node views expose one handle id per edge kind, so the edge must name
          // it; otherwise React Flow attaches every edge to the first source handle.
          sourceHandle: edge2.kind,
          // Distinct outputs between the same nodes must not share an accessible name.
          ariaLabel: `${source} ${edge2.label ?? edge2.kind} ${target}`,
          ...LABELLED_EDGES.has(edge2.kind) && edge2.label !== void 0 ? { label: edge2.label } : {},
          data: { kind: edge2.kind }
        };
      });
    }
    var KNOWN_KINDS = /* @__PURE__ */ new Set(["start", "next", "true", "false", "body", "exit"]);
    function DesignCanvas(props) {
      const flowNodes = toFlowNodes(props.nodes, props.selected);
      const flowEdges = toFlowEdges(props.edges, props.nodes);
      const readOnly = props.readOnly === true;
      const instance = (0, import_react4.useRef)(void 0);
      const onDrop = (event) => {
        const parsed = parseBrickPayload(event.dataTransfer.getData(BRICK_MIME));
        if (parsed === void 0 || parsed.kind !== "step" || props.onDropBrick === void 0) return;
        if (instance.current === void 0) return;
        event.preventDefault();
        props.onDropBrick(
          parsed.value,
          instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
        );
      };
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper is the palette's drop target; the keyboard path is the brick buttons, not this surface.
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "dsh-wf-flow", onDragOver: (event) => event.preventDefault(), onDrop, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          index,
          {
            nodes: flowNodes,
            edges: flowEdges,
            nodeTypes: CANVAS_NODE_TYPES,
            fitView: true,
            fitViewOptions: { padding: 0.25, maxZoom: 1.1 },
            nodesFocusable: true,
            edgesFocusable: true,
            nodesDraggable: !readOnly,
            nodesConnectable: !readOnly,
            onInit: (flow) => {
              instance.current = flow;
            },
            onNodeClick: (_event, node) => props.onSelect(node.id),
            onPaneClick: () => props.onSelect(void 0),
            onNodesChange: (changes) => {
              const selects = changes.filter(
                (change) => change.type === "select" && change.id !== void 0
              );
              if (selects.length === 0) return;
              const selected2 = selects.filter((change) => change.selected === true).at(-1)?.id;
              props.onSelect(selected2);
            },
            onSelectionChange: (selection2) => {
              const first = selection2.nodes?.[0];
              props.onSelect(first?.id);
            },
            onNodeDragStop: readOnly ? void 0 : (_event, node) => props.onMove?.(node.id, node.position),
            onConnect: readOnly ? void 0 : (connection) => {
              if (connection.source === null || connection.target === null) return;
              const handle = connection.sourceHandle;
              props.onConnectNode?.(
                connection.source,
                connection.target,
                handle !== null && KNOWN_KINDS.has(handle) ? handle : "next"
              );
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
                Background,
                {
                  variant: BackgroundVariant.Dots,
                  gap: 18,
                  size: 1.2,
                  color: "var(--dsw-alias-border-l2)"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Controls, { showInteractive: false, "aria-label": "Canvas controls" })
            ]
          },
          props.focusKey
        ) })
      );
    }

    // packages/plugin-workflows/src/client/edges.ts
    var EDGE_LABELS = {
      start: "start",
      next: "next",
      true: "true",
      false: "false",
      body: "body",
      exit: "exit"
    };
    function outputKinds(kind) {
      if (kind === "trigger") return ["start"];
      if (kind === "branch") return ["true", "false"];
      if (kind === "loop") return ["exit"];
      if (kind === "end") return [];
      return ["next"];
    }
    function connectChoices(nodes, sourceId) {
      const source = nodes.find((node) => node.id === sourceId);
      if (source === void 0) return [];
      const targets = nodes.filter((node) => node.id !== sourceId).map((node) => ({ id: node.id, title: node.title }));
      return outputKinds(source.kind).map((kind) => ({
        kind,
        label: EDGE_LABELS[kind],
        targets
      }));
    }
    function currentTarget(edges, source, kind) {
      return edges.find((entry) => entry.source === source && entry.kind === kind)?.target;
    }

    // packages/plugin-workflows/src/client/graph.ts
    var TRIGGER_NODE = "__trigger";
    var END_NODE = "__end";
    var STEP_NODE_PREFIX = "step:";
    function nodeIdOf(stepId) {
      return `${STEP_NODE_PREFIX}${stepId}`;
    }
    function stepIdOfNode(nodeId) {
      return nodeId.startsWith(STEP_NODE_PREFIX) ? nodeId.slice(STEP_NODE_PREFIX.length) : void 0;
    }
    var GraphError = class extends Error {
      path;
      constructor(path, message) {
        super(`${path}: ${message}`);
        this.name = "GraphError";
        this.path = path;
      }
    };
    function nodeKindOf(executor) {
      if (executor === "branch") return "branch";
      if (executor === "loop") return "loop";
      if (executor === "human") return "human";
      return "step";
    }
    function edge(source, target, kind, label) {
      if (target === void 0 || target === "") return void 0;
      const resolved = target === "end" ? END_NODE : nodeIdOf(target);
      return {
        id: `${source}:${kind}`,
        source,
        target: resolved,
        kind,
        ...label === void 0 ? {} : { label }
      };
    }
    function definitionToGraph(definition, positions = {}) {
      const place = (id2, fallback) => {
        const saved = Object.hasOwn(positions, id2) ? positions[id2] : void 0;
        return saved === void 0 ? { x: fallback * 220, y: 0 } : saved;
      };
      const nodes = [
        {
          id: TRIGGER_NODE,
          kind: "trigger",
          title: String(definition.trigger.kind ?? "trigger"),
          index: -1,
          position: place(TRIGGER_NODE, 0)
        }
      ];
      const edges = [];
      const start2 = edge(TRIGGER_NODE, definition.steps[0]?.id, "start", "start");
      if (start2 !== void 0) edges.push(start2);
      let usesEnd = false;
      definition.steps.forEach((step, index2) => {
        const id2 = nodeIdOf(step.id);
        nodes.push({
          id: id2,
          kind: nodeKindOf(step.executor),
          title: step.title,
          step,
          index: index2,
          position: place(step.id, index2 + 1)
        });
        if (step.branch !== void 0) {
          const yes = edge(id2, step.branch.then, "true", "true");
          const no = edge(id2, step.branch.else, "false", "false");
          if (yes !== void 0) edges.push(yes);
          if (no !== void 0) edges.push(no);
          usesEnd ||= step.branch.then === "end" || step.branch.else === "end";
        } else if (step.loop !== void 0) {
          edges.push({
            id: `${id2}:body`,
            source: id2,
            target: id2,
            kind: "body",
            label: "body"
          });
          const exit = edge(id2, step.loop.next, "exit", "exit");
          if (exit !== void 0) edges.push(exit);
          usesEnd ||= step.loop.next === "end";
        } else {
          const next = edge(id2, step.next, "next", "next");
          if (next !== void 0) edges.push(next);
          usesEnd ||= step.next === "end";
        }
      });
      if (usesEnd) {
        nodes.push({
          id: END_NODE,
          kind: "end",
          title: "end",
          index: definition.steps.length,
          position: place(END_NODE, definition.steps.length + 1)
        });
      }
      return { definition, nodes, edges };
    }
    function targetOf(edges, source, kind) {
      return edges.find((entry) => entry.source === source && entry.kind === kind)?.target;
    }
    function withConnection(value2, key, next) {
      const copy = { ...value2 };
      if (next === void 0) delete copy[key];
      else copy[key] = next;
      return copy;
    }
    function graphToDefinition(definition, nodes, edges) {
      const nodeIds = new Set(nodes.map((node) => node.id));
      for (const entry of edges) {
        if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
          throw new GraphError(
            entry.id,
            `the edge "${entry.id}" points outside the graph (${entry.source} -> ${entry.target})`
          );
        }
      }
      for (const node of nodes) {
        if (node.kind === "trigger") {
          if (node.id !== TRIGGER_NODE || node.step !== void 0) {
            throw new GraphError(node.id, "only the synthetic trigger node may have the trigger kind");
          }
        } else if (node.kind === "end") {
          if (node.id !== END_NODE || node.step !== void 0) {
            throw new GraphError(node.id, "only the synthetic end node may have the end kind");
          }
        } else if (node.step === void 0) {
          throw new GraphError(node.id, "the node carries no definition step");
        }
      }
      const stepNodes = nodes.filter((node) => node.kind !== "trigger" && node.kind !== "end").sort((left, right) => left.index - right.index);
      const ids = /* @__PURE__ */ new Set();
      const target = (nodeId, kind) => {
        const value2 = targetOf(edges, nodeId, kind);
        if (value2 === void 0) return void 0;
        if (value2 === END_NODE) return "end";
        const stepId = stepIdOfNode(value2);
        if (stepId === void 0) {
          throw new GraphError(nodeId, `the ${kind} edge points outside the definition steps`);
        }
        return stepId;
      };
      const steps = [];
      for (const node of stepNodes) {
        const stepId = stepIdOfNode(node.id);
        if (node.step === void 0 || stepId === void 0 || node.step.id !== stepId || node.id !== nodeIdOf(node.step.id)) {
          throw new GraphError(node.id, "the node carries no matching definition step");
        }
        if (node.kind !== nodeKindOf(node.step.executor)) {
          throw new GraphError(node.id, "the node kind does not match the step executor");
        }
        if (ids.has(node.step.id)) throw new GraphError(node.id, "the step id is duplicated");
        ids.add(node.step.id);
        const original = node.step;
        let patched;
        if (original.branch !== void 0) {
          const yes = target(node.id, "true");
          const no = target(node.id, "false");
          const branch = withConnection(withConnection(original.branch, "then", yes), "else", no);
          patched = { ...original, branch };
        } else if (original.loop !== void 0) {
          const exit = target(node.id, "exit");
          patched = { ...original, loop: withConnection(original.loop, "next", exit) };
        } else {
          patched = withConnection(original, "next", target(node.id, "next"));
        }
        steps.push(patched);
      }
      const startTarget = targetOf(edges, TRIGGER_NODE, "start");
      if (startTarget !== void 0) {
        if (startTarget === END_NODE) {
          throw new GraphError(TRIGGER_NODE, "the trigger must point at a definition step, not the end");
        }
        const stepId = stepIdOfNode(startTarget);
        if (stepId === void 0) {
          throw new GraphError(TRIGGER_NODE, "the trigger points outside the definition steps");
        }
        const index2 = steps.findIndex((step) => step.id === stepId);
        if (index2 > 0) steps.unshift(...steps.splice(index2, 1));
      }
      return { ...definition, steps };
    }
    function precheckGraph(nodes, edges) {
      const issues = [];
      const stepIds2 = /* @__PURE__ */ new Set();
      for (const node of nodes) {
        if (node.kind === "trigger" || node.kind === "end") {
          const validNode = node.step === void 0 && (node.kind === "trigger" ? node.id === TRIGGER_NODE : node.id === END_NODE);
          if (!validNode) {
            issues.push({
              nodeId: node.id,
              path: `nodes.${node.id}`,
              message: "a synthetic node must not carry a definition step"
            });
          }
          continue;
        }
        const stepId = node.step?.id;
        if (stepId === void 0 || stepIdOfNode(node.id) === void 0) {
          issues.push({ nodeId: node.id, path: `nodes.${node.id}`, message: "the node has no step id" });
          continue;
        }
        if (stepIds2.has(stepId)) {
          issues.push({
            nodeId: node.id,
            path: `steps.${stepId}`,
            message: "the step id is duplicated"
          });
        }
        stepIds2.add(stepId);
      }
      const nodeIds = new Set(nodes.map((node) => node.id));
      const knownKinds = /* @__PURE__ */ new Set(["start", "next", "true", "false", "body", "exit"]);
      for (const entry of edges) {
        if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
          issues.push({
            nodeId: entry.source,
            path: `edges.${entry.id}`,
            message: `the edge "${entry.id}" is dangling (${entry.source} -> ${entry.target})`
          });
        } else if (!knownKinds.has(entry.kind)) {
          issues.push({ nodeId: entry.source, path: `edges.${entry.id}`, message: "unknown edge kind" });
        }
      }
      const outs = (source, kind) => edges.filter((entry) => entry.source === source && entry.kind === kind).length;
      if (outs(TRIGGER_NODE, "start") === 0) {
        issues.push({ nodeId: TRIGGER_NODE, path: "trigger", message: "the trigger has no first step" });
      }
      for (const node of nodes) {
        if (node.kind === "trigger" || node.kind === "end") continue;
        if (node.kind === "branch") {
          if (outs(node.id, "true") !== 1 || outs(node.id, "false") !== 1) {
            issues.push({
              nodeId: node.id,
              path: `steps.${node.id}.branch`,
              message: "the branch needs one true and one false edge"
            });
          }
        } else if (node.kind === "loop") {
          if (outs(node.id, "exit") !== 1) {
            issues.push({
              nodeId: node.id,
              path: `steps.${node.id}.loop.next`,
              message: "the loop needs one exit edge"
            });
          }
        } else if (outs(node.id, "next") !== 1) {
          issues.push({
            nodeId: node.id,
            path: `steps.${node.id}.next`,
            message: "the step needs one next edge (or the end node)"
          });
        }
      }
      return issues.map((issue) => ({ ...issue, kind: "structural" }));
    }
    function autoPositions(nodes, edges) {
      const outgoing = /* @__PURE__ */ new Map();
      const indegree = /* @__PURE__ */ new Map();
      for (const node of nodes) indegree.set(node.id, 0);
      for (const entry of edges) {
        if (entry.kind === "body") continue;
        const list = outgoing.get(entry.source) ?? [];
        list.push(entry);
        outgoing.set(entry.source, list);
        indegree.set(entry.target, (indegree.get(entry.target) ?? 0) + 1);
      }
      const depth = /* @__PURE__ */ new Map();
      const roots = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id).sort();
      for (const root2 of roots) depth.set(root2, 0);
      const ready = [...roots];
      while (ready.length > 0) {
        const current = ready.shift();
        const targets = (outgoing.get(current) ?? []).sort(
          (left, right) => left.target.localeCompare(right.target)
        );
        for (const entry of targets) {
          depth.set(entry.target, Math.max(depth.get(entry.target) ?? 0, (depth.get(current) ?? 0) + 1));
          const remaining = (indegree.get(entry.target) ?? 0) - 1;
          indegree.set(entry.target, remaining);
          if (remaining === 0) {
            ready.push(entry.target);
            ready.sort();
          }
        }
      }
      const columns = /* @__PURE__ */ new Map();
      for (const node of nodes) {
        const column = depth.get(node.id) ?? nodes.length;
        const list = columns.get(column) ?? [];
        list.push(node.id);
        columns.set(column, list);
      }
      const branchParents = /* @__PURE__ */ new Map();
      for (const entry of edges) {
        if (entry.kind !== "true" && entry.kind !== "false" && entry.kind !== "exit") continue;
        const parents = branchParents.get(entry.target) ?? [];
        if (!parents.includes(entry.source)) parents.push(entry.source);
        branchParents.set(entry.target, parents);
      }
      const rows = /* @__PURE__ */ new Map();
      const wantedRow = (id2) => {
        const parents = branchParents.get(id2);
        if (parents === void 0 || parents.length === 0) return void 0;
        let row = 0;
        for (const parent of parents) row = Math.max(row, (rows.get(parent) ?? 0) + 1);
        return row;
      };
      const positions = /* @__PURE__ */ Object.create(null);
      for (const column of [...columns.keys()].sort((left, right) => left - right)) {
        const ids = (columns.get(column) ?? []).sort((left, right) => left.localeCompare(right));
        const constrained = ids.filter((id2) => wantedRow(id2) !== void 0).sort(
          (left, right) => (wantedRow(left) ?? 0) - (wantedRow(right) ?? 0) || left.localeCompare(right)
        );
        const occupied = /* @__PURE__ */ new Set();
        const place = (id2, wanted) => {
          let row = Math.max(0, wanted);
          while (occupied.has(row)) row += 1;
          occupied.add(row);
          rows.set(id2, row);
          positions[id2] = { x: column * 320, y: row * 150 };
        };
        for (const id2 of constrained) {
          place(id2, wantedRow(id2) ?? 0);
        }
        for (const id2 of ids.filter((entry) => wantedRow(entry) === void 0)) {
          place(id2, 0);
        }
      }
      return positions;
    }

    // packages/plugin-workflows/src/client/layout.ts
    var LAYOUT_VERSION = 1;
    function layoutOf(diagram, previous) {
      const positions = Object.assign(
        /* @__PURE__ */ Object.create(null),
        previous?.positions ?? {}
      );
      for (const node of diagram.nodes) {
        if (node.kind === "trigger" || node.kind === "end" || node.step === void 0) continue;
        positions[node.step.id] = { x: node.position.x, y: node.position.y };
      }
      for (const id2 of Object.keys(positions)) {
        if (!diagram.nodes.some((node) => node.step?.id === id2)) delete positions[id2];
      }
      return { v: LAYOUT_VERSION, id: diagram.definition.id, positions };
    }
    function withLayout(diagram, layout) {
      const automatic = autoPositions(diagram.nodes, diagram.edges);
      const nodes = diagram.nodes.map((node) => {
        const stepId = node.step?.id;
        const saved = stepId !== void 0 && layout !== void 0 && Object.hasOwn(layout.positions, stepId) ? layout.positions[stepId] : void 0;
        const fallback = automatic[node.id];
        const position = saved ?? fallback ?? node.position;
        return { ...node, position };
      });
      return { ...diagram, nodes };
    }

    // packages/plugin-workflows/src/client/editor.ts
    var STEP_PREFIX = "step-";
    function clone(value2) {
      return JSON.parse(JSON.stringify(value2));
    }
    function nextFreeId(candidate, taken) {
      if (!taken.has(candidate)) return candidate;
      for (let index2 = 2; ; index2 += 1) {
        const next = `${candidate}-${String(index2)}`;
        if (!taken.has(next)) return next;
      }
    }
    function nextCopyId(candidate, taken) {
      const match = /^(.*)-copy(?:-(\d+))?$/u.exec(candidate);
      const base = match?.[1] ?? candidate;
      const first = match === null ? 1 : match[2] === void 0 ? 2 : Number(match[2]) + 1;
      for (let index2 = first; ; index2 += 1) {
        const id2 = index2 === 1 ? `${base}-copy` : `${base}-copy-${String(index2)}`;
        if (!taken.has(id2)) return id2;
      }
    }
    function copyId(sourceId, taken) {
      return nextCopyId(sourceId, taken);
    }
    function stepIds(definition) {
      return definition.steps.map((step) => step.id);
    }
    function freeStepId(definition) {
      return nextFreeId(
        `${STEP_PREFIX}${String(definition.steps.length + 1)}`,
        new Set(stepIds(definition))
      );
    }
    function blankDefinition(taken) {
      return {
        v: 1,
        id: nextFreeId("new-workflow", taken),
        name: "New workflow",
        version: 1,
        trigger: { kind: "turn.stopping", match: {}, mode: "shadow", dedupe: "turn" },
        settings: {
          allowModelStart: false,
          risk: "low",
          gateOwnership: "own",
          maxBlocks: 3,
          allowIntent: false
        },
        steps: [
          {
            id: `${STEP_PREFIX}1`,
            title: "First step",
            executor: "main",
            prompt: "Describe what this step must do.",
            evidence: { kind: "declaration" },
            nonCritical: true,
            next: "end",
            blockTurnClose: true
          }
        ]
      };
    }
    function copyDefinition(source, taken, name) {
      const copy = clone(source);
      return {
        ...copy,
        id: copyId(source.id, taken),
        name: name ?? `${source.name} copy`,
        version: 1
      };
    }
    function openDocument(document2) {
      const layout = document2.layout?.layout ?? void 0;
      const base = definitionToGraph(document2.definition);
      const diagram = withLayout(base, layout);
      const editor = {
        document: {
          definition: document2.definition,
          revision: document2.revision,
          source: document2.source,
          ...document2.draftName === void 0 ? {} : { draftName: document2.draftName }
        },
        diagram,
        layout: layout ?? layoutOf(diagram),
        layoutRevision: document2.layout?.revision ?? null,
        mode: "canvas",
        dirty: false,
        issues: [],
        status: "clean"
      };
      return editor;
    }
    function openNew(definition) {
      return openDocument({ definition, revision: null, source: "local" });
    }
    function openDraft(name, definition) {
      return openDocument({
        definition: { ...definition, version: 1 },
        revision: null,
        source: "draft",
        draftName: name
      });
    }
    function updateGraph(state, nodes, edges) {
      const issues = precheckGraph(nodes, edges);
      let definition;
      try {
        definition = graphToDefinition(state.document.definition, nodes, edges);
      } catch (error) {
        if (!(error instanceof GraphError)) throw error;
        return {
          ...state,
          dirty: true,
          status: "error",
          issues: [...issues, { nodeId: error.path, path: error.path, message: error.message }],
          message: error.message
        };
      }
      return {
        ...state,
        document: { ...state.document, definition },
        diagram: { definition, nodes, edges },
        issues,
        dirty: true,
        status: "dirty",
        conflict: void 0,
        message: void 0
      };
    }
    function setMode(state, mode) {
      return { ...state, mode };
    }
    function moveStep(state, nodeId, position) {
      return {
        ...state,
        diagram: {
          ...state.diagram,
          nodes: state.diagram.nodes.map((node) => node.id === nodeId ? { ...node, position } : node)
        },
        dirty: true,
        status: "dirty"
      };
    }
    var DEDUPE_BY_TRIGGER = {
      "turn.stopping": ["none", "turn"],
      "tool.pre-execute": ["none", "turn", "callId", "name"],
      "tool.result": ["none", "turn", "callId"],
      "fs.change": ["none", "turn", "path+content-hash"],
      "subagent.end": ["none", "turn"],
      "review.record": ["none", "turn", "path+content-hash"],
      intent: ["none", "turn"]
    };
    var EXECUTOR_FIELDS = ["next", "branch", "loop", "human", "tool", "subagent"];
    function normalizeExecutor(step, executor) {
      const next = { ...step, executor };
      for (const key of EXECUTOR_FIELDS) delete next[key];
      if (executor === "branch") {
        next.branch = { predicate: {}, then: "end", else: "end" };
      } else if (executor === "loop") {
        next.loop = { maxIterations: 3, stop: {}, next: "end" };
      } else {
        next.next = step.next ?? "end";
        if (executor === "human") {
          next.human = { timeoutAction: "block" };
          next.evidence = { kind: "human", answer: "yes" };
          next.prompt ??= "Confirm this step with the user.";
        } else if (executor === "main" || executor === "subagent") {
          next.prompt ??= "Describe what this step must do.";
          if (next.evidence === void 0) {
            next.evidence = { kind: "declaration" };
            next.nonCritical = true;
          }
          if (executor === "subagent") next.subagent = { provider: "spawn", schema: { type: "object" } };
        } else if (executor === "tool") {
          next.tool = { name: "shell", command: "echo ok" };
          if (next.evidence === void 0) {
            next.evidence = { kind: "declaration" };
            next.nonCritical = true;
          }
        }
      }
      return next;
    }
    function rebuildDiagram(state, definition) {
      const graph = definitionToGraph(definition);
      const nodes = graph.nodes.map((node) => {
        const old = state.diagram.nodes.find(
          (entry) => entry.id === node.id || entry.step?.id === node.step?.id
        );
        return old === void 0 ? node : { ...node, position: old.position };
      });
      return updateGraph({ ...state, document: { ...state.document, definition } }, nodes, graph.edges);
    }
    function addStepForExecutor(state, executor) {
      const definition = state.document.definition;
      const id2 = freeStepId(definition);
      const step = normalizeExecutor(
        { id: id2, title: `Step ${String(definition.steps.length + 1)}`, executor: "main" },
        executor
      );
      const nodes = [
        ...state.diagram.nodes,
        {
          id: nodeIdOf(id2),
          kind: nodeKindOf(step.executor),
          title: step.title,
          step,
          index: definition.steps.length,
          position: { x: 240, y: (definition.steps.length + 1) * 120 }
        }
      ];
      const next = updateGraph(state, nodes, state.diagram.edges);
      const tool = step.tool;
      if (tool === void 0) return next;
      const settings = next.document.definition.settings;
      const allowTools = Array.isArray(settings.allowTools) ? settings.allowTools.map(String) : [];
      if (allowTools.includes(tool.name)) return next;
      return patchDefinition(next, {
        settings: { ...settings, allowTools: [...allowTools, tool.name] }
      });
    }
    function setTriggerKind(state, kind) {
      const trigger = state.document.definition.trigger;
      const allowed = DEDUPE_BY_TRIGGER[kind] ?? ["none"];
      const current = typeof trigger.dedupe === "string" ? trigger.dedupe : "turn";
      const dedupe = allowed.includes(current) ? current : allowed[0] ?? "none";
      const next = patchDefinition(state, { trigger: { ...trigger, kind, dedupe } });
      return {
        ...next,
        diagram: {
          ...next.diagram,
          nodes: next.diagram.nodes.map(
            (node) => node.kind === "trigger" ? { ...node, title: kind } : node
          )
        }
      };
    }
    function connectSteps(state, source, target, kind) {
      const nodeIds = new Set(state.diagram.nodes.map((node) => node.id));
      if (!nodeIds.has(target)) return state;
      const edges = state.diagram.edges.filter(
        (entry) => !(entry.source === source && entry.kind === kind)
      );
      const edge2 = {
        id: `${source}:${kind}`,
        source,
        target,
        kind,
        ...kind === "start" || kind === "body" ? {} : { label: kind === "next" ? "next" : kind }
      };
      return updateGraph(state, state.diagram.nodes, [...edges, edge2]);
    }
    function deleteStep(state, id2) {
      const nodes = state.diagram.nodes.filter((node) => node.id !== id2);
      const edges = state.diagram.edges.filter((entry) => entry.source !== id2 && entry.target !== id2);
      return updateGraph(state, nodes, edges);
    }
    function patchStep(state, id2, patch) {
      const node = state.diagram.nodes.find((entry) => entry.id === id2);
      if (node === void 0 || node.step === void 0) return state;
      const current = state.document.definition.steps.find((entry) => entry.id === node.step?.id) ?? node.step;
      if (patch.executor !== void 0 && patch.executor !== current.executor) {
        const step = normalizeExecutor(current, String(patch.executor));
        const definition = {
          ...state.document.definition,
          steps: state.document.definition.steps.map((entry) => entry.id === step.id ? step : entry)
        };
        return rebuildDiagram(state, definition);
      }
      const nodes = state.diagram.nodes.map((entry) => {
        if (entry.id !== id2 || entry.step === void 0) return entry;
        const step = { ...current, ...patch };
        const kind = nodeKindOf(step.executor);
        return { ...entry, kind, step, title: step.title };
      });
      return updateGraph(state, nodes, state.diagram.edges);
    }
    function renameStepId(state, nodeId, nextId2) {
      const node = state.diagram.nodes.find((entry) => entry.id === nodeId);
      if (node?.step === void 0) return state;
      const trimmed = nextId2.trim();
      const oldId = node.step.id;
      if (trimmed === "" || trimmed === "end" || trimmed === oldId) return state;
      if (state.document.definition.steps.some((step) => step.id === trimmed)) return state;
      const steps = state.document.definition.steps.map((step) => {
        const renamed = step.id === oldId ? { ...step, id: trimmed } : step;
        const next = renamed.next === oldId ? trimmed : renamed.next;
        const branch = renamed.branch === void 0 ? void 0 : {
          ...renamed.branch,
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          ...renamed.branch.then === oldId ? { then: trimmed } : {},
          ...renamed.branch.else === oldId ? { else: trimmed } : {}
        };
        const loop = renamed.loop === void 0 ? void 0 : { ...renamed.loop, ...renamed.loop.next === oldId ? { next: trimmed } : {} };
        return {
          ...renamed,
          ...next === void 0 ? {} : { next },
          ...branch === void 0 ? {} : { branch },
          ...loop === void 0 ? {} : { loop }
        };
      });
      const rebuilt = rebuildDiagram(state, { ...state.document.definition, steps });
      return {
        ...rebuilt,
        diagram: {
          ...rebuilt.diagram,
          nodes: rebuilt.diagram.nodes.map(
            (entry) => entry.step?.id === trimmed ? { ...entry, position: node.position } : entry
          )
        }
      };
    }
    function patchDefinition(state, patch) {
      const definition = { ...state.document.definition, ...patch };
      return {
        ...state,
        document: { ...state.document, definition },
        diagram: { ...state.diagram, definition },
        // Host validation feedback is stale once a definition field changes; the
        // structural pre-check still applies.
        issues: state.issues.filter((issue) => issue.kind !== "host"),
        dirty: true,
        status: "dirty"
      };
    }
    function mapHostErrors(errors, definition) {
      return errors.map((entry) => {
        const stepMatch = /^steps\[(\d+)\](?:\.(.*))?$/u.exec(entry.path);
        if (stepMatch === null) return { path: entry.path, message: entry.message, kind: "host" };
        const step = definition.steps[Number(stepMatch[1])];
        return {
          // The canvas addresses a step by its namespaced graph node id.
          ...step === void 0 ? {} : { nodeId: nodeIdOf(step.id) },
          path: entry.path,
          message: entry.message,
          kind: "host"
        };
      });
    }
    function issueLabel(issue) {
      return issue.nodeId === void 0 ? issue.path : `${issue.nodeId}: ${issue.path}`;
    }
    function nextVersion(state) {
      return state.document.revision === null ? 1 : state.document.definition.version + 1;
    }
    function transportFailure(state, label, error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...state,
        status: "error",
        message: `${label}: ${message.slice(0, 200)}`
      };
    }
    function reconcileSave(captured, current, saved) {
      if (current === captured) return saved;
      const definition = {
        ...current.document.definition,
        version: saved.document.definition.version
      };
      const definitionChanged = JSON.stringify(captured.document.definition) !== JSON.stringify(current.document.definition);
      const issues = [
        ...current.issues.filter((issue) => issue.kind !== "host"),
        ...definitionChanged ? [] : saved.issues.filter((issue) => issue.kind === "host")
      ].filter(
        (issue, index2, all) => all.findIndex((other) => other.path === issue.path && other.message === issue.message) === index2
      );
      return {
        ...current,
        document: {
          ...current.document,
          definition,
          revision: saved.document.revision,
          source: saved.document.source
        },
        diagram: { ...current.diagram, definition },
        issues,
        // The layout file, not the current positions, owns the layout revision: a
        // successful save must advance it even when newer positions are still dirty.
        layoutRevision: saved.status === "saved" ? saved.layoutRevision : current.layoutRevision,
        dirty: true,
        status: "dirty",
        // A failed save keeps the conflict so the next-id / save-as-copy actions
        // survive an edit made while the request was in flight.
        conflict: saved.status === "error" ? saved.conflict : void 0,
        message: saved.status === "error" ? saved.message : void 0
      };
    }
    function reconcileCopy(captured, current, saved) {
      if (current === captured) return saved;
      const definitionChanged = JSON.stringify(captured.document.definition) !== JSON.stringify(current.document.definition);
      const issues = [
        ...current.issues.filter((issue) => issue.kind !== "host"),
        ...definitionChanged ? [] : saved.issues.filter((issue) => issue.kind === "host")
      ].filter(
        (issue, index2, all) => all.findIndex((other) => other.path === issue.path && other.message === issue.message) === index2
      );
      return {
        ...current,
        issues,
        dirty: true,
        status: "dirty",
        // A failed copy keeps its conflict so the next-id / save-as-copy recovery
        // stays available even though the newer edits stay in the original draft.
        conflict: saved.status === "error" ? saved.conflict : void 0,
        message: saved.status === "error" ? saved.message : "the copy was saved; the newer edits stay in this draft"
      };
    }
    async function save(state, context) {
      if (state.document.source === "shipped" || state.document.source === "plugin") {
        return {
          ...state,
          status: "error",
          message: "a shipped or plugin definition is read-only; copy it before saving"
        };
      }
      if (state.issues.some((issue) => issue.kind !== "host")) {
        return { ...state, status: "error", message: "fix the highlighted graph issues first" };
      }
      const definition = { ...clone(state.document.definition), version: nextVersion(state) };
      const expected = state.document.revision;
      const saving = {
        ...state,
        dirty: true,
        status: "saving",
        message: void 0,
        conflict: void 0
      };
      let result;
      try {
        result = await context.api.saveDefinition(state.document.definition.id, definition, expected);
      } catch (error) {
        return transportFailure(saving, "the save failed", error);
      }
      if (!result.ok) {
        const failed2 = failure(saving, result);
        if (result.kind !== "conflict" || expected !== null) return failed2;
        const occupied = new Set(context.taken);
        occupied.add(state.document.definition.id);
        return {
          ...failed2,
          conflict: {
            ...failed2.conflict,
            kind: "create",
            nextId: nextCopyId(state.document.definition.id, occupied)
          },
          message: "the id already exists; pick the next free id or save a copy"
        };
      }
      const saved = {
        ...state,
        document: {
          definition,
          revision: result.revision,
          source: "local",
          ...state.document.draftName === void 0 ? {} : { draftName: state.document.draftName }
        },
        diagram: { ...state.diagram, definition },
        dirty: false,
        status: "saved",
        conflict: void 0,
        message: void 0
      };
      return saveLayout(saved, context.api);
    }
    async function saveLayout(state, api) {
      const layout = layoutOf(state.diagram, state.layout);
      let result;
      try {
        result = await api.saveLayout(layout, state.layoutRevision);
      } catch (error) {
        return transportFailure({ ...state, layout, dirty: true }, "the layout save failed", error);
      }
      if (result.ok) {
        return { ...state, layout, layoutRevision: result.revision };
      }
      if (result.kind === "conflict") {
        return {
          ...state,
          layout,
          dirty: true,
          conflict: { kind: "layout", currentRevision: result.revision },
          status: "error",
          message: "the layout changed on disk; reload the layout or save a copy"
        };
      }
      if (result.kind === "invalid") {
        return {
          ...state,
          layout,
          dirty: true,
          issues: [
            ...state.issues,
            ...result.errors.map((entry) => ({ path: entry.path, message: entry.message }))
          ],
          status: "error",
          message: "the layout was refused by the host"
        };
      }
      return {
        ...state,
        layout,
        dirty: true,
        status: "error",
        message: `the layout save failed: ${result.error}`
      };
    }
    function failure(state, result) {
      if (result.kind === "conflict") {
        return {
          ...state,
          status: "error",
          conflict: {
            kind: "update",
            currentRevision: result.revision,
            ...result.runs === void 0 ? {} : { runs: result.runs }
          },
          message: "the definition changed on disk; reload or save a copy"
        };
      }
      if (result.kind === "invalid") {
        return {
          ...state,
          issues: mapHostErrors(result.errors, state.document.definition),
          status: "error",
          message: "the host refused the definition; fix the named fields"
        };
      }
      return { ...state, status: "error", message: result.error };
    }
    async function reload(state, api) {
      try {
        const document2 = await api.read(state.document.definition.id);
        const layout = await api.readLayout(state.document.definition.id);
        const next = openDocument({
          definition: document2.definition,
          revision: document2.revision,
          source: document2.source,
          ...state.document.draftName === void 0 ? {} : { draftName: state.document.draftName },
          layout
        });
        return { ...next, mode: state.mode };
      } catch (error) {
        return {
          ...state,
          status: "error",
          message: `the definition could not be reloaded: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    async function saveAsCopy(state, context, copyName) {
      const definition = copyDefinition(
        state.document.definition,
        context.taken,
        copyName ?? `${state.document.definition.name} copy`
      );
      const diagram = { ...state.diagram, definition };
      const layout = { ...layoutOf(diagram, state.layout), id: definition.id };
      const structural = [
        ...state.issues.filter((issue) => issue.kind !== "host"),
        ...precheckGraph(diagram.nodes, diagram.edges)
      ].filter(
        (issue, index2, all) => all.findIndex((other) => other.path === issue.path && other.message === issue.message) === index2
      );
      const copy = {
        ...state,
        document: { definition, revision: null, source: "local" },
        diagram,
        layout,
        layoutRevision: null,
        issues: structural,
        dirty: true,
        conflict: void 0,
        status: structural.length > 0 ? "error" : "dirty",
        ...structural.length === 0 ? {} : { message: "fix the highlighted graph issues first" }
      };
      return save({ ...copy, mode: state.mode }, context);
    }
    async function deleteDefinition(state, api) {
      const revision = state.document.revision;
      if (revision === null) {
        return {
          state: { ...state, status: "error", message: "the definition was never saved" },
          deleted: false
        };
      }
      const result = await api.deleteDefinition(state.document.definition.id, revision);
      if (result.ok) {
        return { state: { ...state, status: "saved", message: "deleted" }, deleted: true };
      }
      if (result.kind === "conflict") {
        const inUse = (result.runs ?? []).length > 0;
        return {
          state: {
            ...state,
            status: "error",
            conflict: {
              kind: "update",
              currentRevision: result.revision,
              ...result.runs === void 0 ? {} : { runs: result.runs }
            },
            message: inUse ? `an active run references this definition: ${(result.runs ?? []).join(", ")}; finish or cancel it first` : "the definition changed on disk; reload before deleting"
          },
          deleted: false
        };
      }
      return { state: failure(state, result), deleted: false };
    }
    function idsOf(entries) {
      return new Set(entries.map((entry) => entry.id));
    }
    function unsavedChanges(state) {
      return state !== void 0 && state.dirty;
    }
    function leaveEditor(state, confirmDiscard) {
      return !unsavedChanges(state) || confirmDiscard();
    }
    function renameToNextId(state, nextId2) {
      const definition = { ...state.document.definition, id: nextId2 };
      return {
        ...state,
        document: { ...state.document, definition, revision: null },
        diagram: { ...state.diagram, definition },
        layout: { ...state.layout, id: nextId2 },
        layoutRevision: null,
        dirty: true,
        status: "dirty",
        conflict: void 0,
        message: void 0
      };
    }

    // packages/plugin-workflows/src/client/editor-client.ts
    var EDITOR_BASE = "/api/workflows/editor";
    function editorDefinitionsUrl(session) {
      return `${EDITOR_BASE}/definitions?${new URLSearchParams({ session }).toString()}`;
    }
    function editorDefinitionUrl(session, id2) {
      const query = new URLSearchParams({ session });
      if (id2 !== void 0) query.set("id", id2);
      return `${EDITOR_BASE}/definition?${query.toString()}`;
    }
    function editorTemplatesUrl(session) {
      return `${EDITOR_BASE}/templates?${new URLSearchParams({ session }).toString()}`;
    }
    function editorDraftsUrl(session) {
      return `${EDITOR_BASE}/drafts?${new URLSearchParams({ session }).toString()}`;
    }
    function editorDraftUrl(session, name) {
      return `${EDITOR_BASE}/draft?${new URLSearchParams({ session, name }).toString()}`;
    }
    function editorLayoutUrl(session, id2) {
      const query = new URLSearchParams({ session });
      if (id2 !== void 0) query.set("id", id2);
      return `${EDITOR_BASE}/layout?${query.toString()}`;
    }
    async function call(url, init2) {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          ...init2?.body === void 0 ? {} : { "content-type": "application/json" }
        },
        ...init2
      });
      let body;
      try {
        body = await response.json();
      } catch {
        body = { error: `the request failed (${String(response.status)})` };
      }
      return {
        status: response.status,
        body: typeof body === "object" && body !== null ? body : {}
      };
    }
    function text(body, key, fallback) {
      const value2 = body[key];
      return typeof value2 === "string" && value2 !== "" ? value2 : fallback;
    }
    function saveResult(result) {
      if (result.status === 200) {
        return { ok: true, revision: text(result.body, "revision", "") };
      }
      if (result.status === 409) {
        const revision = result.body.revision;
        const runs = Array.isArray(result.body.runs) ? result.body.runs.filter((entry) => typeof entry === "string") : void 0;
        return {
          ok: false,
          kind: "conflict",
          status: result.status,
          revision: typeof revision === "string" ? revision : null,
          ...runs === void 0 ? {} : { runs }
        };
      }
      if (result.status === 400) {
        const errors = Array.isArray(result.body.errors) ? result.body.errors.filter(
          (entry) => typeof entry === "object" && entry !== null && typeof entry.message === "string"
        ) : [{ path: "", message: text(result.body, "error", "the host refused the write") }];
        return { ok: false, kind: "invalid", status: result.status, errors };
      }
      return {
        ok: false,
        kind: "error",
        status: result.status,
        error: text(result.body, "error", `the request failed (${String(result.status)})`)
      };
    }
    function failed(result) {
      return new Error(text(result.body, "error", `the request failed (${String(result.status)})`));
    }
    function fetchEditorApi(session) {
      return {
        async list() {
          const result = await call(editorDefinitionsUrl(session));
          if (result.status !== 200) throw failed(result);
          const definitions = Array.isArray(result.body.definitions) ? result.body.definitions : [];
          const errors = Array.isArray(result.body.errors) ? result.body.errors.filter((entry) => typeof entry === "string") : void 0;
          return { definitions, ...errors === void 0 ? {} : { errors } };
        },
        async templates() {
          const result = await call(editorTemplatesUrl(session));
          if (result.status !== 200) throw failed(result);
          return Array.isArray(result.body.templates) ? result.body.templates : [];
        },
        async drafts() {
          const result = await call(editorDraftsUrl(session));
          if (result.status !== 200) throw failed(result);
          return Array.isArray(result.body.drafts) ? result.body.drafts : [];
        },
        async read(id2) {
          const result = await call(editorDefinitionUrl(session, id2));
          if (result.status !== 200) throw failed(result);
          return result.body;
        },
        async readDraft(name) {
          const result = await call(editorDraftUrl(session, name));
          if (result.status !== 200) throw failed(result);
          return result.body.definition;
        },
        async readLayout(id2) {
          const result = await call(editorLayoutUrl(session, id2));
          if (result.status !== 200) throw failed(result);
          const layout = result.body.layout;
          return {
            layout: typeof layout === "object" && layout !== null ? layout : null,
            revision: typeof result.body.revision === "string" ? result.body.revision : null
          };
        },
        async saveDefinition(id2, definition, expectedRevision) {
          const result = await call(editorDefinitionUrl(session), {
            method: "PUT",
            body: JSON.stringify({ id: id2, definition, expectedRevision })
          });
          return saveResult(result);
        },
        async deleteDefinition(id2, expectedRevision) {
          const result = await call(editorDefinitionUrl(session), {
            method: "DELETE",
            body: JSON.stringify({ id: id2, expectedRevision })
          });
          return saveResult(result);
        },
        async saveLayout(layout, expectedRevision) {
          const result = await call(editorLayoutUrl(session), {
            method: "PUT",
            body: JSON.stringify({ id: layout.id, layout, expectedRevision })
          });
          return saveResult(result);
        },
        async runs(definitionId) {
          const query = new URLSearchParams({
            session,
            source: "workflow",
            definition: definitionId,
            limit: "5"
          });
          const result = await call(`/api/workflows/runs?${query.toString()}`);
          if (result.status !== 200) throw failed(result);
          return Array.isArray(result.body.runs) ? result.body.runs : [];
        }
      };
    }

    // packages/plugin-workflows/src/client/list.tsx
    var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime4 = require("react/jsx-runtime");
    var EXECUTORS = ["main", "subagent", "tool", "branch", "loop", "human"];
    var EVIDENCE_KINDS = ["file", "record", "tool", "check", "human", "all", "declaration"];
    function outputsFor(step) {
      if (step.branch !== void 0) return ["true", "false"];
      if (step.loop !== void 0) return ["exit"];
      return ["next"];
    }
    function evidenceKind(step) {
      const evidence = step.evidence;
      return typeof evidence?.kind === "string" ? evidence.kind : "";
    }
    function graphIdOfStep(state, stepId) {
      return state.diagram.nodes.find((node) => node.step?.id === stepId)?.id ?? "";
    }
    function listConnectionChoices(state, step) {
      const graphId = graphIdOfStep(state, step.id);
      return outputsFor(step).flatMap(
        (kind) => connectChoices(state.diagram.nodes, graphId).filter((choice) => choice.kind === kind).map((choice) => ({ kind, targets: choice.targets }))
      );
    }
    function listRowModel(state, step) {
      const graphId = graphIdOfStep(state, step.id);
      const values = {
        id: step.id,
        title: step.title,
        executor: step.executor,
        prompt: typeof step.prompt === "string" ? step.prompt : "",
        evidenceKind: evidenceKind(step)
      };
      for (const kind of outputsFor(step)) {
        values[`connection:${kind}`] = currentTarget(state.diagram.edges, graphId, kind) ?? "";
      }
      return values;
    }
    function patchListField(graphId, step, field, value2, onPatch) {
      if (field === "title" || field === "prompt" || field === "executor") {
        onPatch(graphId, { [field]: value2 === "" && field === "prompt" ? void 0 : value2 });
        return;
      }
      if (field === "evidenceKind") {
        onPatch(graphId, { evidence: value2 === "" ? void 0 : { kind: value2 } });
        return;
      }
      if (field === "branchPredicate") {
        if (step.branch === void 0) return;
        try {
          onPatch(graphId, { branch: { ...step.branch, predicate: JSON.parse(value2) } });
        } catch {
        }
        return;
      }
      if (field === "loopStop") {
        if (step.loop === void 0) return;
        try {
          onPatch(graphId, { loop: { ...step.loop, stop: JSON.parse(value2) } });
        } catch {
        }
        return;
      }
      if (field === "loopMaxIterations") {
        if (step.loop === void 0) return;
        const iterations = Number(value2);
        if (Number.isSafeInteger(iterations) && iterations > 0) {
          onPatch(graphId, { loop: { ...step.loop, maxIterations: iterations } });
        }
      }
    }
    function ListEditor(props) {
      const steps = props.state.document.definition.steps;
      const trigger = props.state.document.definition.trigger;
      const startTarget = currentTarget(props.state.diagram.edges, TRIGGER_NODE, "start");
      const stepTargets = props.state.diagram.nodes.filter((node) => node.step !== void 0);
      return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "dsh-wf-list-wrap", "data-tab-group": "list", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "dsh-wf-list-trigger", "data-tab-group": "trigger", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h4", { children: "Trigger" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Kind",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "input",
              {
                value: typeof trigger.kind === "string" ? trigger.kind : "",
                "aria-label": "Trigger kind",
                onChange: (event) => props.onDefinitionPatch({ trigger: { ...trigger, kind: event.currentTarget.value } })
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Mode",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "select",
              {
                value: typeof trigger.mode === "string" ? trigger.mode : "shadow",
                "aria-label": "Trigger mode",
                onChange: (event) => props.onDefinitionPatch({ trigger: { ...trigger, mode: event.currentTarget.value } }),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "shadow", children: "shadow" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "active", children: "active" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Dedupe",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "select",
              {
                value: typeof trigger.dedupe === "string" ? trigger.dedupe : "turn",
                "aria-label": "Dedupe policy",
                onChange: (event) => props.onDefinitionPatch({
                  trigger: { ...trigger, dedupe: event.currentTarget.value }
                }),
                children: ["none", "turn", "path+content-hash", "callId", "name"].map((policy) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: policy, children: policy }, policy))
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Start step",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "select",
              {
                value: startTarget ?? "",
                "aria-label": "Start step",
                onChange: (event) => {
                  const target = event.currentTarget.value;
                  if (target !== "") props.onConnect(TRIGGER_NODE, target, "start");
                },
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "(unconnected)" }),
                  stepTargets.map((node) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: node.id, children: [
                    node.title,
                    " (",
                    node.step?.id ?? node.id,
                    ")"
                  ] }, node.id))
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Repeat",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "input",
              {
                type: "checkbox",
                checked: trigger.repeat === true,
                "aria-label": "Trigger repeat",
                onChange: (event) => props.onDefinitionPatch({
                  trigger: { ...trigger, repeat: event.currentTarget.checked }
                })
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Applicability",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "select",
              {
                value: typeof trigger.applicability === "string" ? trigger.applicability : "",
                "aria-label": "Trigger applicability",
                onChange: (event) => props.onDefinitionPatch({
                  trigger: {
                    ...trigger,
                    ...event.currentTarget.value === "" ? { applicability: void 0 } : { applicability: event.currentTarget.value }
                  }
                }),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "(none)" }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "checkpoint-required", children: "checkpoint-required" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
            "Match (JSON)",
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
              "textarea",
              {
                defaultValue: JSON.stringify(trigger.match ?? {}),
                "aria-label": "Trigger match JSON",
                rows: 2,
                onChange: (event) => {
                  try {
                    const match = JSON.parse(event.currentTarget.value);
                    props.onDefinitionPatch({ trigger: { ...trigger, match } });
                  } catch {
                  }
                }
              },
              `match:${props.state.document.definition.id}:${JSON.stringify(trigger.match ?? {})}`
            )
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("table", { className: "dsh-wf-list", "aria-label": "Definition steps", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("tr", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: "Step" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: "Title" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: "Executor" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: "Evidence kind" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: "Connections" }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", {})
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("tbody", { children: steps.map((step) => {
            const values = listRowModel(props.state, step);
            const graphId = graphIdOfStep(props.state, step.id);
            const selected2 = props.selected === graphId;
            return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
              "tr",
              {
                "data-step": step.id,
                "data-selected": selected2 ? "true" : void 0,
                onClick: () => props.onSelect(graphId),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: step.id }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("td", { children: [
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      "input",
                      {
                        value: values.title ?? "",
                        "aria-label": `Title of ${step.id}`,
                        onChange: (event) => patchListField(
                          graphId,
                          step,
                          "title",
                          event.currentTarget.value,
                          props.onPatch
                        )
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                      "input",
                      {
                        value: values.prompt ?? "",
                        "aria-label": `Prompt of ${step.id}`,
                        placeholder: "Prompt",
                        onChange: (event) => patchListField(
                          graphId,
                          step,
                          "prompt",
                          event.currentTarget.value,
                          props.onPatch
                        )
                      }
                    )
                  ] }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    "select",
                    {
                      value: values.executor ?? "main",
                      "aria-label": `Executor of ${step.id}`,
                      onChange: (event) => patchListField(
                        graphId,
                        step,
                        "executor",
                        event.currentTarget.value,
                        props.onPatch
                      ),
                      children: EXECUTORS.map((executor) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: executor, children: executor }, executor))
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                    "select",
                    {
                      value: values.evidenceKind ?? "",
                      "aria-label": `Evidence kind of ${step.id}`,
                      onChange: (event) => patchListField(
                        graphId,
                        step,
                        "evidenceKind",
                        event.currentTarget.value,
                        props.onPatch
                      ),
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "(none)" }),
                        EVIDENCE_KINDS.map((kind) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: kind, children: kind }, kind))
                      ]
                    }
                  ) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: listConnectionChoices(props.state, step).map((choice) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { "data-connection": choice.kind, children: [
                    EDGE_LABELS[choice.kind],
                    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(
                      "select",
                      {
                        value: values[`connection:${choice.kind}`] ?? "",
                        "aria-label": `${EDGE_LABELS[choice.kind]} target of ${step.id}`,
                        onChange: (event) => {
                          const target = event.currentTarget.value;
                          if (target !== "") props.onConnect(graphId, target, choice.kind);
                        },
                        children: [
                          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: "", children: "(unconnected)" }),
                          choice.targets.map((target) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: target.id, children: [
                            target.title,
                            " (",
                            target.id,
                            ")"
                          ] }, target.id))
                        ]
                      }
                    )
                  ] }, choice.kind)) }),
                  /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
                    import_dsh_client_ui_primitives3.Button,
                    {
                      type: "button",
                      variant: "ghost",
                      size: "sm",
                      onClick: () => props.onDelete(graphId),
                      children: "Delete"
                    }
                  ) })
                ]
              },
              step.id
            );
          }) })
        ] })
      ] });
    }

    // packages/plugin-workflows/src/client/overlay.ts
    function evidenceOf(step) {
      if (step.evidenceRef !== void 0) {
        return {
          kind: step.evidenceRef.kind,
          ...step.evidenceRef.ref === void 0 ? {} : { ref: step.evidenceRef.ref },
          ...step.evidenceRef.at === void 0 ? {} : { at: step.evidenceRef.at }
        };
      }
      if (step.evidence === void 0) return void 0;
      return { kind: "evidence", ref: step.evidence };
    }
    function overlayFor(run, definition) {
      const known = new Set(definition.steps.map((step) => step.id));
      const steps = /* @__PURE__ */ Object.create(null);
      const orphans = [];
      const notices = [];
      for (const step of run?.steps ?? []) {
        if (step.synthetic === true) continue;
        if (!known.has(step.id)) {
          orphans.push({
            id: step.id,
            state: step.state,
            ...step.failureClass === void 0 ? {} : { failureClass: step.failureClass },
            ...evidenceOf(step) === void 0 ? {} : { evidence: evidenceOf(step) }
          });
          continue;
        }
        steps[step.id] = {
          id: step.id,
          state: step.state,
          ...step.failureClass === void 0 ? {} : { failureClass: step.failureClass },
          ...evidenceOf(step) === void 0 ? {} : { evidence: evidenceOf(step) },
          ...step.reason === void 0 ? {} : { reason: step.reason },
          violations: []
        };
      }
      for (const violation of run?.violations ?? []) {
        const id2 = violation.stepId;
        if (id2 === void 0) {
          notices.push(violation.reason);
          continue;
        }
        const target = Object.hasOwn(steps, id2) ? steps[id2] : void 0;
        if (target === void 0) {
          notices.push(`step "${id2}": ${violation.reason}`);
          continue;
        }
        steps[id2] = { ...target, violations: [...target.violations, violation.reason] };
      }
      const definitionId = run?.definition?.id ?? "";
      const recordedName = run?.definition?.name;
      const recordedVersion = run?.definition?.version;
      const versionsDiffer = run?.definition !== void 0 && (run.definition.id !== definition.id || run.definition.version !== definition.version || run.definition.name !== definition.name);
      const state = run?.status ?? "no run";
      const summary = run === void 0 ? "No run selected." : `Run ${run.id.slice(0, 24)}: ${state}; recorded definition ${definitionId} version ${String(recordedVersion ?? "?")}${versionsDiffer ? " (differs from the open definition)" : ""}.`;
      return {
        ...run === void 0 ? {} : { run },
        ...recordedName === void 0 ? {} : { recordedName },
        ...recordedVersion === void 0 ? {} : { recordedVersion },
        versionsDiffer,
        steps,
        orphans,
        notices,
        summary
      };
    }
    function withOverlay(nodes, overlay) {
      return nodes.map((node) => {
        if (node.kind === "trigger" || node.kind === "end" || node.step === void 0) return node;
        const step = Object.hasOwn(overlay.steps, node.step.id) ? overlay.steps[node.step.id] : void 0;
        if (step === void 0) return node;
        return {
          ...node,
          runState: step.state,
          ...step.failureClass === void 0 ? {} : { failureClass: step.failureClass },
          ...step.evidence === void 0 ? {} : { evidence: step.evidence },
          ...step.violations.length === 0 ? {} : { violations: step.violations }
        };
      });
    }

    // packages/plugin-workflows/src/client/palette.tsx
    var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime5 = require("react/jsx-runtime");
    function PaletteMenu(props) {
      const items = STEP_BRICKS.map((brick) => ({
        id: brick.value,
        label: paletteLabel(brick.value)
      }));
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        import_dsh_client_ui_primitives4.Menu,
        {
          open: props.open,
          onClose: props.onClose,
          items,
          onSelect: (id2) => {
            props.onClose();
            props.onAdd(id2);
          },
          anchor: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            import_dsh_client_ui_primitives4.Button,
            {
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: props.disabled === true,
              onClick: props.onOpen,
              children: "Add step"
            }
          )
        }
      );
    }

    // packages/plugin-workflows/src/client/properties.tsx
    var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react5 = require("react");
    var import_jsx_runtime6 = require("react/jsx-runtime");
    function parseJsonField(text2) {
      try {
        return { ok: true, value: JSON.parse(text2) };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    }
    function jsonText(value2) {
      return value2 === void 0 ? "" : JSON.stringify(value2);
    }
    function JsonField(props) {
      const committed = jsonText(props.value);
      const [draft, setDraft] = (0, import_react5.useState)(committed);
      const [seen, setSeen] = (0, import_react5.useState)(committed);
      if (seen !== committed) {
        setSeen(committed);
        setDraft(committed);
      }
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "dsh-wf-field", children: [
        props.label,
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "textarea",
          {
            value: draft,
            "aria-label": props.ariaLabel,
            rows: props.rows ?? 2,
            onChange: (event) => {
              const text2 = event.currentTarget.value;
              setDraft(text2);
              if (text2.trim() === "" && props.allowEmpty === true) {
                props.commit(void 0);
                return;
              }
              const parsed = parseJsonField(text2);
              if (parsed.ok) props.commit(parsed.value);
            }
          }
        )
      ] });
    }
    var EXECUTORS2 = ["main", "subagent", "tool", "branch", "loop", "human"];
    var EVIDENCE_KINDS2 = ["file", "record", "tool", "check", "human", "all", "declaration"];
    function Card(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "section",
        {
          className: `dsh-wf-card${props.className === void 0 ? "" : ` ${props.className}`}`,
          "data-group": props.id,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("header", { className: "dsh-wf-card-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h5", { className: "dsh-wf-card-title", children: props.title }),
              props.hint === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dsh-wf-card-hint", children: props.hint })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dsh-wf-card-body", children: props.children })
          ]
        }
      );
    }
    function Field(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dsh-wf-field-label", children: props.label }),
        props.children
      ] });
    }
    function Advanced(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { className: "dsh-wf-advanced", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("summary", { children: props.label }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dsh-wf-advanced-body", children: props.children })
      ] });
    }
    function selectTarget(props, node, kind) {
      const current = currentTarget(props.state.diagram.edges, node.id, kind);
      const choices = connectChoices(props.state.diagram.nodes, node.id).find(
        (choice) => choice.kind === kind
      );
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: EDGE_LABELS[kind], children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "select",
        {
          value: current ?? "",
          "aria-label": EDGE_LABELS[kind],
          onChange: (event) => {
            const target = event.currentTarget.value;
            if (target !== "") props.onConnect(node.id, target, kind);
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: "(unconnected)" }),
            (choices?.targets ?? []).map((target) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("option", { value: target.id, children: [
              target.title,
              " (",
              target.id,
              ")"
            ] }, target.id))
          ]
        }
      ) }, kind);
    }
    function settingsFields(props) {
      const settings = props.state.document.definition.settings;
      const allowTools = Array.isArray(settings.allowTools) ? settings.allowTools.join(", ") : "";
      const patch = (value2) => props.onDefinitionPatch({ settings: value2 });
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-settings", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-field-grid", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Risk", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "select",
            {
              value: typeof settings.risk === "string" ? settings.risk : "low",
              "aria-label": "Risk",
              onChange: (event) => patch({ ...settings, risk: event.currentTarget.value }),
              children: ["low", "medium", "high"].map((risk) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: risk, children: risk }, risk))
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Max blocks", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              type: "number",
              min: 1,
              value: Number(settings.maxBlocks ?? 3),
              "aria-label": "Max blocks",
              onChange: (event) => patch({ ...settings, maxBlocks: Number(event.currentTarget.value) })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Gate ownership", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: typeof settings.gateOwnership === "string" ? settings.gateOwnership : "own",
              "aria-label": "Gate ownership",
              onChange: (event) => patch({ ...settings, gateOwnership: event.currentTarget.value }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "own", children: "own" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "defer", children: "defer" })
              ]
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Allowed tools", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              value: allowTools,
              "aria-label": "Allowed tools",
              placeholder: "shell, subagent",
              onChange: (event) => {
                const names = event.currentTarget.value.split(",").map((name) => name.trim()).filter((name) => name !== "");
                patch({
                  ...settings,
                  // The host rejects an empty allowlist; omit it when unused.
                  ...names.length === 0 ? { allowTools: void 0 } : { allowTools: names }
                });
              }
            }
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-check-list", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            import_dsh_client_ui_primitives5.Checkbox,
            {
              checked: settings.allowModelStart === true,
              onChange: (next) => patch({ ...settings, allowModelStart: next }),
              label: "Allow model start"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            import_dsh_client_ui_primitives5.Checkbox,
            {
              checked: settings.allowIntent === true,
              onChange: (next) => patch({ ...settings, allowIntent: next }),
              label: "Allow intent"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Advanced, { label: "Legacy settings (JSON)", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          JsonField,
          {
            label: "Legacy (JSON)",
            value: settings.legacy,
            ariaLabel: "Settings legacy JSON",
            allowEmpty: true,
            commit: (value2) => patch({ ...settings, legacy: value2 })
          },
          `settings-legacy:${props.state.document.definition.id}`
        ) })
      ] });
    }
    function workflowContent(props) {
      const description = props.state.document.definition.description;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Definition name", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "input",
          {
            value: props.state.document.definition.name,
            "aria-label": "Definition name",
            onChange: (event) => props.onDefinitionPatch({ name: event.currentTarget.value })
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Description", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "textarea",
          {
            value: typeof description === "string" ? description : "",
            "aria-label": "Definition description",
            rows: 3,
            onChange: (event) => props.onDefinitionPatch({
              // Empty sends undefined so a definition without one stays unchanged.
              description: event.currentTarget.value === "" ? void 0 : event.currentTarget.value
            })
          }
        ) })
      ] });
    }
    function workflowSection(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Card, { id: "workflow", title: "Workflow", hint: "Definition", children: workflowContent(props) });
    }
    function workflowDetails(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("details", { className: "dsh-wf-advanced", "data-group": "workflow", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("summary", { children: [
          "Workflow \xB7 ",
          props.state.document.definition.name
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-advanced-body", children: [
          workflowContent(props),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h6", { className: "dsh-wf-subhead", children: "Settings" }),
          settingsFields(props)
        ] })
      ] });
    }
    function stepFields(props, node, step) {
      const branch = step.branch;
      const loop = step.loop;
      const regularConnections = branch === void 0 && loop === void 0;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "step", title: "Step", hint: "What it does", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Title", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              value: step.title,
              "aria-label": "Step title",
              onChange: (event) => props.onPatch(node.id, { title: event.currentTarget.value })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Executor", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "select",
            {
              value: step.executor,
              "aria-label": "Executor",
              onChange: (event) => props.onPatch(node.id, { executor: event.currentTarget.value }),
              children: EXECUTORS2.map((executor) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: executor, children: executor }, executor))
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Prompt", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "textarea",
            {
              value: typeof step.prompt === "string" ? step.prompt : "",
              "aria-label": "Prompt",
              rows: 4,
              onChange: (event) => props.onPatch(node.id, {
                prompt: event.currentTarget.value === "" ? void 0 : event.currentTarget.value
              })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Step id", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              className: "dsh-wf-mono",
              defaultValue: step.id,
              "aria-label": "Step id",
              disabled: props.onRename === void 0,
              onBlur: (event) => props.onRename?.(node.id, event.currentTarget.value)
            },
            `id:${step.id}`
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "behavior", title: "Behavior", hint: "Ownership and flags", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Ownership", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: typeof step.ownership === "string" ? step.ownership : "",
              "aria-label": "Step ownership",
              onChange: (event) => props.onPatch(node.id, {
                ...event.currentTarget.value === "" ? { ownership: void 0 } : { ownership: event.currentTarget.value }
              }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: "(default)" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "own", children: "own" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "defer", children: "defer" })
              ]
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-check-list", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              import_dsh_client_ui_primitives5.Checkbox,
              {
                checked: step.nonCritical === true,
                onChange: (next) => props.onPatch(node.id, { nonCritical: next }),
                label: "Non-critical step"
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              import_dsh_client_ui_primitives5.Checkbox,
              {
                checked: step.blockTurnClose === true,
                onChange: (next) => props.onPatch(node.id, { blockTurnClose: next ? true : void 0 }),
                label: "Blocks turn close"
              }
            )
          ] }),
          step.executor === "human" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Human timeout", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: step.human?.timeoutAction ?? "block",
              "aria-label": "Human timeout action",
              onChange: (event) => props.onPatch(node.id, {
                human: { ...step.human ?? {}, timeoutAction: event.currentTarget.value }
              }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "block", children: "block" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "cancel", children: "cancel" })
              ]
            }
          ) }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "connections", title: "Connections", hint: "Where it goes next", children: [
          regularConnections ? outputKinds(node.kind).map((kind) => selectTarget(props, node, kind)) : null,
          branch === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
            selectTarget(props, node, "true"),
            selectTarget(props, node, "false"),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Advanced, { label: "Branch predicate (JSON)", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Predicate",
                value: branch.predicate,
                ariaLabel: "Branch predicate JSON",
                commit: (value2) => props.onPatch(node.id, { branch: { ...branch, predicate: value2 } })
              },
              `predicate:${node.id}`
            ) })
          ] }),
          loop === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Max iterations", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              "input",
              {
                type: "number",
                min: 1,
                value: loop.maxIterations ?? 1,
                "aria-label": "Max iterations",
                onChange: (event) => props.onPatch(node.id, {
                  loop: { ...loop, maxIterations: Number(event.currentTarget.value) }
                })
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Loop list key", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              "input",
              {
                value: loop.list ?? "",
                "aria-label": "Loop list key",
                onChange: (event) => props.onPatch(node.id, {
                  loop: {
                    ...loop,
                    // An empty list means "no list"; omit it rather than send "".
                    ...event.currentTarget.value === "" ? { list: void 0 } : { list: event.currentTarget.value }
                  }
                })
              }
            ) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Loop cap", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
              "select",
              {
                value: loop.cap ?? "blocked",
                "aria-label": "Loop cap",
                onChange: (event) => props.onPatch(node.id, {
                  loop: { ...loop, cap: event.currentTarget.value }
                }),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "blocked", children: "blocked" }),
                  /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "failed", children: "failed" })
                ]
              }
            ) }),
            selectTarget(props, node, "exit"),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Advanced, { label: "Loop stop (JSON)", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Stop",
                value: loop.stop,
                ariaLabel: "Loop stop JSON",
                commit: (value2) => props.onPatch(node.id, { loop: { ...loop, stop: value2 } })
              },
              `stop:${node.id}`
            ) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "evidence", title: "Evidence", hint: "What proves it ran", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Evidence kind", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: typeof step.evidence?.kind === "string" ? String(step.evidence.kind) : "",
              "aria-label": "Evidence kind",
              onChange: (event) => props.onPatch(node.id, { evidence: { kind: event.currentTarget.value } }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: "(none)" }),
                EVIDENCE_KINDS2.map((kind) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: kind, children: kind }, kind))
              ]
            }
          ) }),
          step.tool === void 0 && step.subagent === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Advanced, { label: "Executor config (JSON)", children: [
            step.tool === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Tool config",
                value: step.tool,
                ariaLabel: "Tool config JSON",
                commit: (value2) => props.onPatch(node.id, { tool: value2 })
              },
              `tool:${node.id}`
            ),
            step.subagent === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Subagent config",
                value: step.subagent,
                ariaLabel: "Subagent config JSON",
                commit: (value2) => props.onPatch(node.id, { subagent: value2 })
              },
              `subagent:${node.id}`
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Advanced, { label: "Raw records (JSON)", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Evidence",
                value: step.evidence,
                ariaLabel: "Evidence JSON",
                rows: 3,
                allowEmpty: true,
                commit: (value2) => props.onPatch(node.id, { evidence: value2 })
              },
              `evidence:${node.id}`
            ),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              JsonField,
              {
                label: "Legacy",
                value: step.legacy,
                ariaLabel: "Step legacy JSON",
                allowEmpty: true,
                commit: (value2) => props.onPatch(node.id, { legacy: value2 })
              },
              `legacy:${node.id}`
            )
          ] })
        ] }),
        workflowDetails(props),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Card, { id: "danger", title: "Danger", className: "dsh-wf-danger-card", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          import_dsh_client_ui_primitives5.Button,
          {
            type: "button",
            variant: "ghost",
            size: "sm",
            className: "dsh-wf-danger",
            onClick: () => props.onDelete(node.id),
            children: "Delete step"
          }
        ) })
      ] });
    }
    function triggerFields(props) {
      const trigger = props.state.document.definition.trigger;
      const match = trigger.match;
      const triggerNode = props.state.diagram.nodes.find((node) => node.kind === "trigger");
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "trigger", title: "Trigger", hint: "What starts the workflow", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Kind", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "input",
            {
              value: typeof trigger.kind === "string" ? trigger.kind : "",
              "aria-label": "Trigger kind",
              onChange: (event) => props.onDefinitionPatch({ trigger: { ...trigger, kind: event.currentTarget.value } })
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Mode", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: typeof trigger.mode === "string" ? trigger.mode : "shadow",
              "aria-label": "Trigger mode",
              onChange: (event) => props.onDefinitionPatch({ trigger: { ...trigger, mode: event.currentTarget.value } }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "shadow", children: "shadow" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "active", children: "active" })
              ]
            }
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(Card, { id: "behavior", title: "Behavior", hint: "Matching and dedupe", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Dedupe", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "select",
            {
              value: typeof trigger.dedupe === "string" ? trigger.dedupe : "turn",
              "aria-label": "Dedupe policy",
              onChange: (event) => props.onDefinitionPatch({
                trigger: { ...trigger, dedupe: event.currentTarget.value }
              }),
              children: ["none", "turn", "path+content-hash", "callId", "name"].map((policy) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: policy, children: policy }, policy))
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Field, { label: "Applicability", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
            "select",
            {
              value: typeof trigger.applicability === "string" ? trigger.applicability : "",
              "aria-label": "Trigger applicability",
              onChange: (event) => props.onDefinitionPatch({
                trigger: {
                  ...trigger,
                  ...event.currentTarget.value === "" ? { applicability: void 0 } : { applicability: event.currentTarget.value }
                }
              }),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: "(none)" }),
                /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "checkpoint-required", children: "checkpoint-required" })
              ]
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "dsh-wf-check-list", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            import_dsh_client_ui_primitives5.Checkbox,
            {
              checked: trigger.repeat === true,
              onChange: (next) => props.onDefinitionPatch({ trigger: { ...trigger, repeat: next } }),
              label: "Repeat on a matching event"
            }
          ) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Advanced, { label: "Match filters (JSON)", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            JsonField,
            {
              label: "Match",
              value: match ?? {},
              ariaLabel: "Trigger match JSON",
              commit: (value2) => props.onDefinitionPatch({ trigger: { ...trigger, match: value2 } })
            },
            `match:${props.state.document.definition.id}`
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Card, { id: "connections", title: "Connections", hint: "Where the first step is", children: triggerNode === void 0 ? null : outputKinds("trigger").map((kind) => selectTarget(props, triggerNode, kind)) }),
        workflowDetails(props)
      ] });
    }
    function PropertyPanel(props) {
      const node = props.state.diagram.nodes.find((entry) => entry.id === props.selected);
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "dsh-wf-properties", "data-tab-group": "properties", "aria-label": "Properties", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("header", { className: "dsh-wf-inspector-title", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "span",
            {
              className: "dsh-wf-inspector-glyph",
              "data-kind": node?.kind ?? "definition",
              "aria-hidden": "true",
              children: node === void 0 ? null : brickGlyph(executorIcon(node.step?.executor, node.kind))
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "dsh-wf-inspector-titles", children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: node === void 0 ? "Workflow" : node.title }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "dsh-wf-muted", children: node === void 0 ? "Definition and settings" : node.step?.id ?? node.kind })
          ] })
        ] }),
        node === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
          workflowSection(props),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Card, { id: "settings", title: "Settings", hint: "Definition-level", children: settingsFields(props) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-wf-hint", children: "Select a node to edit it." })
        ] }) : node.kind === "trigger" ? triggerFields(props) : node.kind === "end" || node.step === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Card, { id: "end", title: "End", hint: "Terminal node", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "dsh-wf-hint", children: "The end node has no fields." }) }),
          workflowDetails(props)
        ] }) : stepFields(props, node, node.step)
      ] });
    }

    // packages/plugin-workflows/src/client/rail.tsx
    var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime7 = require("react/jsx-runtime");
    function defaultDefinitionId(definitions) {
      return definitions[0]?.id;
    }
    function runDotState(status) {
      if (status === "done" || status === "completed") return "done";
      if (status === "running") return "ongoing";
      if (status === "failed") return "error";
      if (status === "blocked" || status === "interrupted" || status === "cancelled") return "warning";
      return "idle";
    }
    function sourceLabel(entry) {
      return entry.plugin === void 0 ? entry.source : `${entry.source}:${entry.plugin}`;
    }
    function TriggerBricks(props) {
      const { t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ul", { className: "dsh-wf-bricks", "data-bricks": "triggers", children: TRIGGER_BRICKS.map((brick) => {
        const current = props.currentTrigger === brick.value;
        return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          import_dsh_client_ui_primitives6.Button,
          {
            type: "button",
            variant: "ghost",
            size: "sm",
            className: "dsh-wf-brick",
            "data-block": brick.value,
            "data-brick-kind": "trigger",
            ...current ? { "data-current": "true" } : {},
            "aria-pressed": current,
            "aria-label": `Set trigger ${brick.value}`,
            title: brick.hintKey === void 0 ? brick.value : t(brick.hintKey),
            disabled: props.disabled === true || props.currentId === void 0,
            onClick: () => props.onTrigger(brick.value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-brick-icon", children: brickGlyph(brick.icon) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-brick-label", children: brick.value })
            ]
          }
        ) }, brick.value);
      }) });
    }
    function StepBricks(props) {
      const { t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ul", { className: "dsh-wf-bricks", "data-bricks": "steps", children: STEP_BRICKS.map((brick) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
        import_dsh_client_ui_primitives6.Button,
        {
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "dsh-wf-brick",
          "data-block": brick.value,
          "data-brick-kind": "step",
          "aria-label": paletteLabel(brick.value),
          title: brick.hintKey === void 0 ? brick.value : t(brick.hintKey),
          draggable: props.disabled !== true && props.currentId !== void 0,
          disabled: props.disabled === true || props.currentId === void 0,
          onDragStart: (event) => {
            event.dataTransfer.setData(BRICK_MIME, brickPayload("step", brick.value));
            event.dataTransfer.effectAllowed = "copy";
          },
          onClick: () => props.onExecutor(brick.value),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-brick-icon", children: brickGlyph(brick.icon) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-brick-label", children: brick.labelKey === void 0 ? brick.value : t(brick.labelKey) })
          ]
        }
      ) }, brick.value)) });
    }
    function WorkflowRail(props) {
      const { t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("aside", { className: "dsh-wf-rail", "data-tab-group": "palette", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "dsh-wf-rail-section", "data-section": "workflow-rail", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "dsh-wf-rail-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { className: "dsh-wf-heading", children: t("design.railWorkflows") }),
            props.onNew === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
              import_dsh_client_ui_primitives6.Button,
              {
                type: "button",
                variant: "toolbar",
                size: "sm",
                "aria-label": t("design.new"),
                title: t("design.new"),
                icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives6.IconPlusOutlineRegular, {}),
                disabled: props.disabled === true,
                onClick: () => props.onNew?.()
              }
            )
          ] }),
          props.definitions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "dsh-wf-muted", children: t("definitions.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("ul", { className: "dsh-wf-library", children: props.definitions.map((entry) => {
            const current = entry.id === props.currentId;
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
              import_dsh_client_ui_primitives6.Button,
              {
                type: "button",
                variant: "toolbar",
                size: "sm",
                className: "dsh-wf-lib-row",
                "data-definition": entry.id,
                "aria-pressed": current,
                ...current ? { "data-selected": "true" } : {},
                disabled: props.disabled === true,
                onClick: () => props.onOpen(entry.id),
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-lib-title", children: entry.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
                    "span",
                    {
                      className: "dsh-wf-lib-desc",
                      "data-description": entry.id,
                      title: entry.description ?? t("design.noDescription"),
                      children: entry.description ?? t("design.noDescription")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-wf-lib-meta", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "dsh-wf-chip", "data-trigger-kind": entry.trigger ?? "", children: entry.trigger === void 0 ? t("overview.unknownKind") : `${t("definitions.trigger")}: ${entry.trigger}` }),
                    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-wf-muted", "data-source": entry.source, children: [
                      "v",
                      String(entry.version),
                      " \xB7 ",
                      sourceLabel(entry),
                      " \xB7 ",
                      String(entry.stepCount),
                      " ",
                      "steps"
                    ] }),
                    current && props.latestRun !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { className: "dsh-wf-lib-run", "data-latest-run": props.latestRun.id, children: [
                      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives6.StateDot, { state: runDotState(props.latestRun.status) }),
                      `${t("overview.latestRun")}: ${props.latestRun.status}`
                    ] }) : null
                  ] })
                ]
              }
            ) }, entry.id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "dsh-wf-rail-section", "data-section": "block-rail", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { className: "dsh-wf-heading", children: t("design.railBlocks") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "dsh-wf-kind", children: t("design.blocksTriggers") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(TriggerBricks, { ...props }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "dsh-wf-kind", children: t("design.blocksSteps") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StepBricks, { ...props })
        ] })
      ] });
    }

    // packages/plugin-workflows/src/client/run-selection.ts
    function activeRun(runs, runId) {
      if (runId === void 0) return runs[0];
      if (runId === "") return void 0;
      return runs.find((run) => run.id === runId);
    }
    function createRunSelection(read) {
      let request = 0;
      return {
        invalidate() {
          request += 1;
        },
        async load(definitionId, onChange) {
          request += 1;
          const token = request;
          onChange([]);
          let next;
          try {
            next = await read(definitionId);
          } catch {
            next = [];
          }
          if (token === request) onChange(next);
        }
      };
    }

    // packages/plugin-workflows/src/client/styles.ts
    var FLOW_CSS = `
    .dsh-wf-page { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; height: 100%; min-height: 0; padding: 12px; overflow: auto; color: var(--dsw-alias-label-primary); }
    .dsh-wf-design { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
    .dsh-wf-design-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .dsh-wf-design-bar select { padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; }
    .dsh-wf-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .dsh-wf-issue { color: var(--dsw-alias-state-error-primary); font: var(--dsw-font-xxs-12); }

    /* Header: one title block, one state line, one action cluster. */
    .dsh-wf-design-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-width: 0; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .dsh-wf-head-main { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; }
    .dsh-wf-head-name { font: var(--dsw-font-s-strong-14); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dsh-wf-head-state { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
    .dsh-wf-dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-dirty-dot[data-dirty="false"] { background: var(--dsw-alias-state-success-primary); }
    .dsh-wf-head-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .dsh-wf-run { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dsh-wf-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); font: var(--dsw-font-xxs-12); }

    /* The three panes: blocks and library, canvas, inspector. */
    .dsh-wf-workbench { position: relative; display: grid; grid-template-columns: 280px 4px minmax(0, 1fr) 4px 360px; gap: 6px; flex: 1; min-height: 0; align-items: stretch; }
    .dsh-wf-workbench[data-layout="drawer"] { grid-template-columns: 280px 4px minmax(0, 1fr); }
    .dsh-wf-workbench[data-mode="list"] { display: flex; flex-direction: column; min-height: 0; gap: 12px; }
    .dsh-wf-splitter { align-self: stretch; border-radius: var(--dsw-radius-sm); cursor: col-resize; background: transparent; transition: background-color 120ms ease; }
    .dsh-wf-splitter:hover, .dsh-wf-splitter:focus-visible { background: var(--dsw-alias-border-l2); }
    .dsh-wf-workbench-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
    .dsh-wf-workbench[data-mode="list"] .dsh-wf-workbench-main { overflow-y: auto; }

    /* Left rail: the library on top, the building blocks below. */
    .dsh-wf-rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; overflow-y: auto; }
    .dsh-wf-rail-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .dsh-wf-rail-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
    .dsh-wf-library { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; min-width: 0; }
    .dsh-wf-lib-row { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; box-sizing: border-box; width: 100%; height: auto; min-height: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); text-align: left; line-height: 1.4; white-space: normal; }
    .dsh-wf-lib-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsh-wf-lib-row[data-selected="true"] { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); box-shadow: inset 3px 0 0 var(--dsw-alias-label-primary); }
    .dsh-wf-lib-title { font: var(--dsw-font-s-strong-14); overflow-wrap: anywhere; }
    .dsh-wf-lib-desc { display: -webkit-box; max-width: 100%; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-lib-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-lib-run { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .dsh-wf-bricks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; list-style: none; margin: 0; padding: 0; }
    .dsh-wf-bricks[data-bricks="triggers"] { grid-template-columns: minmax(0, 1fr); }
    .dsh-wf-brick { display: flex; align-items: center; gap: 6px; box-sizing: border-box; width: 100%; height: auto; min-height: 0; justify-content: flex-start; padding: 5px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); text-align: left; }
    .dsh-wf-brick:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsh-wf-brick[data-current="true"] { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-label-primary); box-shadow: inset 2px 0 0 var(--dsw-alias-state-success-primary); }
    .dsh-wf-brick[data-brick-kind="trigger"] .dsh-wf-brick-label { font-family: var(--dsw-font-mono, monospace); font-size: 11px; }
    .dsh-wf-brick-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
    .dsh-wf-brick-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Canvas surfaces. */
    .dsh-wf-surface-canvas, .dsh-wf-surface-list { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; min-height: 0; }
    .dsh-wf-list-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .dsh-wf-canvas { position: relative; display: flex; flex: 1; min-height: 280px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); overflow: hidden; }
    .dsh-wf-flow { position: absolute; inset: 0; }
    .dsh-wf-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; box-sizing: border-box; padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
    .dsh-wf-blank-canvas { display: flex; align-items: center; justify-content: center; min-height: 320px; }
    .dsh-wf-blank-canvas .dsh-wf-empty { max-width: 360px; }
    .dsh-wf-empty-title { margin: 0; font: var(--dsw-font-xs-13); color: var(--dsw-alias-label-secondary); }

    /* Inspector. */
    .dsh-wf-inspector { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
    .dsh-wf-workbench[data-layout="drawer"] .dsh-wf-inspector { position: absolute; top: 0; right: 0; bottom: 0; z-index: 5; width: min(320px, 88%); }
    .dsh-wf-inspector[data-open="false"] { display: none; }
    .dsh-wf-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }
    .dsh-wf-inspector .dsh-wf-properties { border: none; border-radius: 0; flex: 1; min-height: 0; padding: 12px 14px; }
    .dsh-wf-inspector-title { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .dsh-wf-inspector-glyph { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 26px; height: 26px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
    .dsh-wf-inspector-glyph[data-kind="trigger"] { color: var(--dsw-alias-state-success-primary); }
    .dsh-wf-inspector-glyph[data-kind="branch"], .dsh-wf-inspector-glyph[data-kind="loop"] { color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-inspector-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .dsh-wf-inspector-titles h4 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .dsh-wf-inspector-titles .dsh-wf-muted { font-family: var(--dsw-font-mono, monospace); font-size: 11px; }
    .dsh-wf-group { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .dsh-wf-group:last-of-type { border-bottom: none; }
    .dsh-wf-group-title { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }

    /* Property fields. */
    .dsh-wf-properties { display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); overflow: auto; }
    .dsh-wf-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
    .dsh-wf-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .dsh-wf-card-title { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.06em; text-transform: uppercase; }
    .dsh-wf-card-hint { color: var(--dsw-alias-label-caption); font: var(--dsw-font-xxs-12); }
    .dsh-wf-card-body { display: flex; flex-direction: column; gap: 8px; }
    .dsh-wf-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.4; }
    .dsh-wf-field input, .dsh-wf-field select, .dsh-wf-field textarea { box-sizing: border-box; width: 100%; min-height: 32px; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font-size: 13px; }
    .dsh-wf-field textarea { min-height: 64px; }
    .dsh-wf-field input:focus-visible, .dsh-wf-field select:focus-visible, .dsh-wf-field textarea:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
    .dsh-wf-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
    .dsh-wf-check-list { display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
    .dsh-wf-check-list .checkbox { font-size: 13px; }
    .dsh-wf-advanced { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
    .dsh-wf-advanced > summary { padding: 7px 9px; cursor: pointer; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-advanced[open] > summary { border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .dsh-wf-advanced-body { display: flex; flex-direction: column; gap: 8px; padding: 9px; }
    .dsh-wf-subhead { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.06em; text-transform: uppercase; }
    .dsh-wf-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-danger-card { border-color: var(--dsw-alias-border-l2); }
    .dsh-wf-danger { color: var(--dsw-alias-state-error-primary); }

    /* Canvas node cards. */
    .dsh-wf-node { display: flex; flex-direction: column; gap: 6px; min-width: 200px; max-width: 240px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); text-align: left; }
    .dsh-wf-node[data-kind="trigger"] { border-color: var(--dsw-alias-state-success-primary); }
    .dsh-wf-node[data-kind="branch"], .dsh-wf-node[data-kind="loop"] { border-color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-node[data-state="running"] { border-color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-node[data-state="done"] { border-color: var(--dsw-alias-state-success-primary); }
    .dsh-wf-node[data-state="blocked"], .dsh-wf-node[data-state="failed"] { border-color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-canvas .react-flow__node.selected .dsh-wf-node { border-color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 1px var(--dsw-alias-label-primary); }
    .dsh-wf-node-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
    .dsh-wf-node-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 26px; height: 26px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
    .dsh-wf-node[data-kind="trigger"] .dsh-wf-node-icon { color: var(--dsw-alias-state-success-primary); }
    .dsh-wf-node-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .dsh-wf-node-title { font: var(--dsw-font-xs-13); font-weight: 600; overflow-wrap: anywhere; }
    .dsh-wf-node-meta { color: var(--dsw-alias-label-caption); font-size: 11px; }
    .dsh-wf-node-badge { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); }
    .dsh-wf-node-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .dsh-wf-node-badge[data-run-state="running"] { color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-node-badge[data-run-state="done"] { color: var(--dsw-alias-state-success-primary); }
    .dsh-wf-node-badge[data-run-state="blocked"], .dsh-wf-node-badge[data-run-state="failed"] { color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-node-evidence, .dsh-wf-node-violation { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }
    .dsh-wf-node-evidence { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dsh-wf-node-violation { color: var(--dsw-alias-state-error-primary); }
    .dsh-wf-node-orphan { color: var(--dsw-alias-state-warning-primary); }
    .dsh-wf-node-end { border-style: dashed; }

    /* List editor. */
    .dsh-wf-list-wrap { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .dsh-wf-list-trigger { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px 12px; box-sizing: border-box; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
    .dsh-wf-list-trigger h4 { grid-column: 1 / -1; margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
    .dsh-wf-list-trigger label { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-list-trigger input, .dsh-wf-list-trigger select, .dsh-wf-list-trigger textarea { box-sizing: border-box; width: 100%; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }
    .dsh-wf-list { width: 100%; table-layout: fixed; border-collapse: collapse; font: var(--dsw-font-xxs-12); }
    .dsh-wf-list th { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
    .dsh-wf-list td { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); vertical-align: top; }
    .dsh-wf-list input, .dsh-wf-list select, .dsh-wf-list textarea { box-sizing: border-box; width: 100%; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }

    /* Shared sections and tables. */
    .dsh-wf-section { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; min-width: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
    .dsh-wf-heading { margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
    .dsh-wf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font: var(--dsw-font-xxs-12); }
    .dsh-wf-table th { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
    .dsh-wf-table td { padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
    .dsh-wf-table tr:last-child td { border-bottom: none; }
    .dsh-wf-triggers th:nth-child(1) { width: 20%; }
    .dsh-wf-triggers th:nth-child(2) { width: 13%; }
    .dsh-wf-triggers th:nth-child(3) { width: 27%; }
    .dsh-wf-triggers th:nth-child(4) { width: 10%; }
    .dsh-wf-triggers th:nth-child(5) { width: 30%; }
    .dsh-wf-definitions th:nth-child(1) { width: 18%; }
    .dsh-wf-definitions th:nth-child(2) { width: 28%; }
    .dsh-wf-definitions th:nth-child(3) { width: 14%; }
    .dsh-wf-definitions th:nth-child(4) { width: 8%; }
    .dsh-wf-definitions th:nth-child(5) { width: 32%; }
    .dsh-wf-runs { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; min-width: 0; }
    .dsh-wf-runs li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; font: var(--dsw-font-xxs-12); }
    .dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-kind { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }
    .dsh-wf-subject { font: var(--dsw-font-xs-13); overflow-wrap: anywhere; }
    .dsh-wf-time { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dsh-wf-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
    .dsh-wf-row-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
    .dsh-wf-row-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
    .dsh-wf-chips { display: flex; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }
    .dsh-wf-def-row, .dsh-wf-trigger-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
    .dsh-wf-def-row:last-child, .dsh-wf-trigger-row:last-child { border-bottom: none; }
    .dsh-wf-mono { font-family: var(--dsw-font-mono, monospace); }

    /* The structural React Flow rules (copied from the pinned package's base.css). */
    .dsh-wf-canvas .react-flow { direction: ltr; --xy-background-color-default: transparent; --xy-edge-stroke-default: var(--dsw-alias-label-secondary); --xy-edge-stroke-width-default: 1.5; --xy-edge-stroke-selected-default: var(--dsw-alias-state-success-primary); --xy-connectionline-stroke-default: var(--dsw-alias-label-secondary); --xy-connectionline-stroke-width-default: 1.5; --xy-handle-background-color-default: var(--dsw-alias-label-secondary); --xy-node-border-default: 1px solid var(--dsw-alias-border-l2); --xy-node-border-selected-default: 2px solid var(--dsw-alias-state-success-primary); --xy-selection-background-color-default: var(--dsw-alias-border-l2); --xy-selection-border-default: 1px dashed var(--dsw-alias-label-secondary); background-color: var(--xy-background-color, var(--xy-background-color-default)); position: relative; width: 100%; height: 100%; overflow: hidden; }
    .dsh-wf-canvas .react-flow__container { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }
    .dsh-wf-canvas .react-flow__pane { z-index: 1; cursor: grab; }
    .dsh-wf-canvas .react-flow__pane.dragging { cursor: grabbing; }
    .dsh-wf-canvas .react-flow__viewport { transform-origin: 0 0; z-index: 2; pointer-events: none; }
    .dsh-wf-canvas .react-flow__renderer { z-index: 4; }
    .dsh-wf-canvas .react-flow__node { position: absolute; user-select: none; pointer-events: all; transform-origin: 0 0; box-sizing: border-box; cursor: grab; }
    .dsh-wf-canvas .react-flow__node.dragging { cursor: grabbing; }
    .dsh-wf-canvas .react-flow__handle { position: absolute; pointer-events: none; min-width: 6px; min-height: 6px; width: 6px; height: 6px; background: var(--xy-handle-background-color, var(--xy-handle-background-color-default)); border: 1px solid var(--dsw-alias-bg-base); border-radius: 100%; }
    .dsh-wf-canvas .react-flow__handle-top { top: -4px; left: 50%; transform: translate(-50%, 0); }
    .dsh-wf-canvas .react-flow__handle-bottom { bottom: -4px; left: 50%; transform: translate(-50%, 0); }
    .dsh-wf-canvas .react-flow__handle-left { left: -4px; top: 50%; transform: translate(0, -50%); }
    .dsh-wf-canvas .react-flow__handle-right { right: -4px; top: 50%; transform: translate(0, -50%); }
    .dsh-wf-canvas .react-flow__edges { position: absolute; }
    .dsh-wf-canvas .react-flow__edges svg { overflow: visible; position: absolute; pointer-events: none; }
    .dsh-wf-canvas .react-flow__edge { pointer-events: visibleStroke; }
    .dsh-wf-canvas .react-flow__edge-path { stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default)); stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default)); fill: none; }
    .dsh-wf-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default)); }
    .dsh-wf-canvas .react-flow__edge-text { fill: var(--dsw-alias-label-secondary); font-size: 10px; }
    .dsh-wf-canvas .react-flow__edge-textbg { fill: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-base)); }
    .dsh-wf-canvas .react-flow__connectionline { z-index: 1001; }
    .dsh-wf-canvas .react-flow__connection-path { stroke: var(--xy-connectionline-stroke, var(--xy-connectionline-stroke-default)); stroke-width: var(--xy-connectionline-stroke-width, var(--xy-connectionline-stroke-width-default)); fill: none; }
    .dsh-wf-canvas .react-flow__selection { background: var(--xy-selection-background-color, var(--xy-selection-background-color-default)); border: var(--xy-selection-border, var(--xy-selection-border-default)); }
    .dsh-wf-canvas .react-flow__attribution { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: var(--dsw-alias-label-caption); background: transparent; }
    .dsh-wf-canvas .react-flow__attribution a { color: inherit; }
    .dsh-wf-canvas .react-flow__panel { position: absolute; z-index: 5; margin: 10px; }
    .dsh-wf-canvas .react-flow__panel.bottom { bottom: 0; }
    .dsh-wf-canvas .react-flow__panel.left { left: 0; }
    .dsh-wf-canvas .react-flow__background { position: absolute; inset: 0; z-index: 0; pointer-events: none; background-color: var(--xy-background-color, var(--xy-background-color-default)); }
    .dsh-wf-canvas .react-flow__background-pattern.dots { fill: var(--xy-background-pattern-color, var(--dsw-alias-border-l2)); }
    .dsh-wf-canvas .react-flow__controls { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); }
    .dsh-wf-canvas .react-flow__controls-button { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 4px; border: none; border-bottom: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
    .dsh-wf-canvas .react-flow__controls-button:last-child { border-bottom: none; }
    .dsh-wf-canvas .react-flow__controls-button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
    .dsh-wf-canvas .react-flow__controls-button svg { width: 100%; max-width: 12px; max-height: 12px; fill: currentColor; }
    .dsh-wf-canvas-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font: var(--dsw-font-xxs-12); }
    .dsh-wf-canvas-toolbar label { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
    .dsh-wf-canvas-toolbar select { padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; }
    .dsh-wf-session-canvas { min-height: 320px; }`;

    // packages/plugin-workflows/src/client/design.tsx
    var import_jsx_runtime8 = require("react/jsx-runtime");
    function windowWidth() {
      return typeof window === "undefined" ? 1024 : window.innerWidth;
    }
    function defaultSurface(width) {
      return defaultMode(width ?? windowWidth());
    }
    function canvasFailedState(editor) {
      return setMode(editor, "list");
    }
    function recoverCanvas(editor) {
      return { failed: true, editor: canvasFailedState(editor) };
    }
    function DesignMode(props) {
      const { sessionId, t } = props;
      const api = (0, import_react6.useMemo)(() => fetchEditorApi(sessionId ?? ""), [sessionId]);
      const [library, setLibrary] = (0, import_react6.useState)({
        definitions: [],
        templates: [],
        drafts: []
      });
      const [editor, setEditor] = (0, import_react6.useState)();
      const editorRef = (0, import_react6.useRef)(void 0);
      editorRef.current = editor;
      const [selected2, setSelected] = (0, import_react6.useState)();
      const [runs, setRuns] = (0, import_react6.useState)([]);
      const [runId, setRunId] = (0, import_react6.useState)();
      const [canvasFailed, setCanvasFailed] = (0, import_react6.useState)(false);
      const [connectValue, setConnectValue] = (0, import_react6.useState)();
      const [confirmDelete, setConfirmDelete] = (0, import_react6.useState)(false);
      const [loading, setLoading] = (0, import_react6.useState)(false);
      const [message, setMessage] = (0, import_react6.useState)();
      const [paletteOpen, setPaletteOpen] = (0, import_react6.useState)(false);
      const [menuOpen, setMenuOpen] = (0, import_react6.useState)(false);
      const [detailsOpen, setDetailsOpen] = (0, import_react6.useState)(false);
      const [runMenuOpen, setRunMenuOpen] = (0, import_react6.useState)(false);
      const [paneWidths, setPaneWidths] = (0, import_react6.useState)(() => {
        try {
          return parsePaneWidths(
            typeof window === "undefined" ? null : window.localStorage.getItem(PANE_STORAGE_KEY)
          );
        } catch {
          return { rail: RAIL_WIDTH.default, inspector: INSPECTOR_WIDTH.default };
        }
      });
      const paneWidthsRef = (0, import_react6.useRef)(paneWidths);
      paneWidthsRef.current = paneWidths;
      const dirty = editor?.dirty === true;
      (0, import_react6.useEffect)(() => {
        props.onDirtyChange?.(dirty);
      }, [dirty]);
      const taken = (0, import_react6.useMemo)(() => idsOf(library.definitions), [library]);
      const refreshLibrary = async () => {
        try {
          const [definitions, templates, drafts] = await Promise.all([
            api.list(),
            api.templates(),
            api.drafts()
          ]);
          setLibrary({
            definitions: definitions.definitions,
            templates,
            drafts
          });
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      };
      (0, import_react6.useEffect)(() => {
        void refreshLibrary();
      }, [sessionId]);
      const root2 = (0, import_react6.useRef)(null);
      (0, import_react6.useEffect)(() => {
        const element = root2.current;
        if (element === null || selected2 === void 0) return;
        const onKeyDown = (event) => {
          if (!isConnectShortcut({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            defaultPrevented: event.defaultPrevented,
            isComposing: event.isComposing,
            target: event.target
          })) {
            return;
          }
          event.preventDefault();
          setConnectValue("");
        };
        element.addEventListener("keydown", onKeyDown);
        return () => element.removeEventListener("keydown", onKeyDown);
      }, [selected2]);
      const persistPaneWidths = () => {
        try {
          window.localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(paneWidthsRef.current));
        } catch {
        }
      };
      const paneBounds = (side) => {
        const bounds = side === "rail" ? RAIL_WIDTH : INSPECTOR_WIDTH;
        const total = root2.current?.clientWidth ?? 0;
        const other = side === "rail" ? paneWidthsRef.current.inspector : paneWidthsRef.current.rail;
        const available = total <= 0 ? bounds.max : Math.max(bounds.min, total - other - 360 - 40);
        return { min: bounds.min, max: Math.min(bounds.max, available) };
      };
      const applyPaneWidth = (side, value2) => {
        const next = { ...paneWidthsRef.current, [side]: clampPaneWidth(value2, paneBounds(side)) };
        paneWidthsRef.current = next;
        setPaneWidths(next);
      };
      const dragSplitter = (side) => (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const start2 = paneWidthsRef.current[side];
        const move = (moveEvent) => {
          const delta = moveEvent.clientX - startX;
          applyPaneWidth(side, side === "rail" ? start2 + delta : start2 - delta);
        };
        const finish = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          persistPaneWidths();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish, { once: true });
      };
      const keySplitter = (side) => (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.shiftKey ? 48 : 16;
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const current = paneWidthsRef.current[side];
        applyPaneWidth(
          side,
          side === "rail" ? current + direction * step : current - direction * step
        );
        persistPaneWidths();
      };
      const resetSplitter = (side) => () => {
        applyPaneWidth(side, side === "rail" ? RAIL_WIDTH.default : INSPECTOR_WIDTH.default);
        persistPaneWidths();
      };
      const runSelection = (0, import_react6.useMemo)(
        () => createRunSelection((definitionId) => api.runs(definitionId)),
        [api]
      );
      const loadRuns = async (definitionId) => {
        await runSelection.load(definitionId, (next) => {
          setRuns(next);
          setRunId(next[0]?.id);
        });
      };
      const clearRuns = () => {
        runSelection.invalidate();
        setRuns([]);
        setRunId(void 0);
      };
      const showDocument = (next, options = {}) => {
        setEditor({ ...next, mode: defaultSurface(props.surfaceWidth) });
        setSelected(void 0);
        setDetailsOpen(false);
        setConfirmDelete(false);
        setCanvasFailed(false);
        if (options.keepRuns !== true) clearRuns();
      };
      const open = async (id2) => {
        if (id2 === "") return;
        setLoading(true);
        setMessage(void 0);
        try {
          const [document2, layout] = await Promise.all([api.read(id2), api.readLayout(id2)]);
          const next = openDocument({ ...document2, layout });
          showDocument(next);
          await loadRuns(id2);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const saveCurrent = async () => {
        if (editor === void 0) return;
        setLoading(true);
        setMessage(void 0);
        try {
          const result = await save(editor, { api, taken });
          setEditor((current) => {
            if (current === void 0) return result;
            if (current === editor) return result;
            return reconcileSave(editor, current, result);
          });
          if (result.status === "saved") {
            await refreshLibrary();
            await loadRuns(result.document.definition.id);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const autoOpenTried = (0, import_react6.useRef)(false);
      (0, import_react6.useEffect)(() => {
        if (autoOpenTried.current || editor !== void 0 || loading) return;
        const first = defaultDefinitionId(library.definitions);
        if (first === void 0) return;
        autoOpenTried.current = true;
        void open(first);
      }, [library, editor, loading]);
      const reloadCurrent = async () => {
        if (editor === void 0) return;
        setLoading(true);
        try {
          const result = await reload(editor, api);
          if (editorRef.current !== editor) return;
          setEditor(result);
          await loadRuns(result.document.definition.id);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const removeCurrent = async () => {
        if (editor === void 0) return;
        setLoading(true);
        try {
          const outcome = await deleteDefinition(editor, api);
          setEditor(outcome.deleted ? void 0 : outcome.state);
          setConfirmDelete(false);
          if (outcome.deleted) {
            setSelected(void 0);
            clearRuns();
            await refreshLibrary();
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const startBlank = () => {
        showDocument(openNew(blankDefinition(taken)));
        setMessage(void 0);
      };
      const applyTemplate = (template) => {
        const copy = copyDefinition(template.definition, taken);
        showDocument(openNew(copy));
        setMessage(void 0);
      };
      const startDraft = async (name) => {
        if (name === "") return;
        const before = editorRef.current;
        setLoading(true);
        try {
          const definition = await api.readDraft(name);
          if (editorRef.current !== before) return;
          showDocument(openDraft(name, definition));
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const copyCurrent = async () => {
        if (editor === void 0) return;
        setLoading(true);
        try {
          const result = await saveAsCopy(editor, { api, taken });
          const latest = editorRef.current ?? editor;
          const next = latest === editor ? result : reconcileCopy(editor, latest, result);
          const nextId2 = next.document.definition.id;
          const documentChanged = nextId2 !== editor.document.definition.id;
          if (documentChanged) {
            clearRuns();
          }
          setEditor(next);
          if (documentChanged) {
            await refreshLibrary();
            await loadRuns(nextId2);
          }
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setLoading(false);
        }
      };
      const useNextId = () => {
        if (editor?.conflict?.nextId === void 0) return;
        const nextId2 = editor.conflict.nextId;
        setEditor(renameToNextId(editor, nextId2));
        setMessage(void 0);
        void loadRuns(nextId2);
      };
      const apply2 = (next) => {
        if (next === void 0) return;
        setEditor(next);
        if (next.issues.length === 0 && next.status !== "error") setMessage(void 0);
      };
      const guard = (action) => {
        const confirmed = () => typeof window !== "undefined" && window.confirm(t("design.closeUnsaved"));
        if (!leaveEditor(editor, confirmed)) return;
        action();
      };
      const addExecutor = (executor, position) => {
        if (editor === void 0) return;
        const added = addStepForExecutor(editor, executor);
        const node = added.diagram.nodes.at(-1);
        const placed = position === void 0 || node === void 0 ? added : moveStep(added, node.id, position);
        apply2(placed);
        setSelected(node?.id);
      };
      const chooseTrigger = (kind) => {
        if (editor === void 0) return;
        apply2(setTriggerKind(editor, kind));
        setSelected(TRIGGER_NODE);
      };
      if (sessionId === void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-wf-design", "data-state": "no-session", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-muted", children: t("state.noSession") }) });
      }
      const active = activeRun(runs, runId);
      const overlay = editor === void 0 ? overlayFor(void 0, blankDefinition(/* @__PURE__ */ new Set())) : overlayFor(active, editor.document.definition);
      const surface = editor === void 0 ? defaultSurface(props.surfaceWidth) : resolveSurface(editor.mode, canvasFailed);
      const placement = inspectorPlacement(props.surfaceWidth ?? windowWidth());
      const workbenchStyle = surface === "list" ? {} : {
        gridTemplateColumns: placement === "column" ? `${String(paneWidths.rail)}px 4px minmax(0, 1fr) 4px ${String(paneWidths.inspector)}px` : `${String(paneWidths.rail)}px 4px minmax(0, 1fr)`
      };
      const inspectorOpen = placement === "column" || selected2 !== void 0 || detailsOpen;
      const selectedNode = editor?.diagram.nodes.find((node) => node.id === selected2);
      const choices = editor === void 0 || selected2 === void 0 ? [] : connectChoices(editor.diagram.nodes, selected2).flatMap(
        (choice) => choice.targets.map((target) => ({
          kind: choice.kind,
          target: target.id,
          label: `${EDGE_LABELS[choice.kind]} \u2192 ${target.title}`
        }))
      );
      const issues = editor?.issues ?? [];
      const conflict = editor?.conflict;
      const currentTrigger = editor === void 0 ? void 0 : String(editor.document.definition.trigger.kind ?? "");
      const activeRunEntry = runs.find((run) => run.id === runId);
      const shortRunId = (id2) => {
        const clean = id2.replace(/^workflow:/u, "");
        return clean.length > 22 ? `${clean.slice(0, 12)}\u2026${clean.slice(-6)}` : clean;
      };
      const runLabel = () => activeRunEntry === void 0 ? t("design.noRun") : `${shortRunId(activeRunEntry.id)} \xB7 ${activeRunEntry.status}`;
      const runItems = () => [
        { id: "", label: t("design.noRun") },
        ...runs.map((run) => ({
          id: run.id,
          label: `${shortRunId(run.id)} \xB7 ${run.status}${run.definition === void 0 ? "" : ` \xB7 v${String(run.definition.version)}`}`
        }))
      ];
      const menuItems = () => {
        const items = [{ id: "new", label: t("design.new"), disabled: loading }];
        if (library.templates.length > 0) {
          items.push({
            id: "templates",
            label: t("design.template"),
            disabled: loading,
            submenu: library.templates.map((template) => ({
              id: `template:${template.id}`,
              label: `${template.name} \xB7 ${String(template.stepCount)} steps`,
              disabled: loading
            }))
          });
        }
        if (library.drafts.length > 0) {
          items.push({
            id: "drafts",
            label: t("design.draft"),
            disabled: loading,
            submenu: library.drafts.map((draft) => ({
              id: `draft:${draft.name}`,
              label: `${draft.title} (${draft.name})`,
              disabled: loading
            }))
          });
        }
        items.push({
          id: "reload",
          label: t("design.reload"),
          disabled: editor === void 0 || loading
        });
        items.push({
          id: "surface",
          label: surface === "canvas" ? t("design.listView") : t("design.canvasView"),
          disabled: loading
        });
        items.push({
          id: "delete",
          label: t("design.delete"),
          danger: true,
          disabled: editor?.document.revision === null || loading
        });
        return items;
      };
      const onMenuSelect = (id2) => {
        setMenuOpen(false);
        if (loading) return;
        if (id2 === "new") {
          guard(startBlank);
          return;
        }
        if (id2 === "reload") {
          guard(() => void reloadCurrent());
          return;
        }
        if (id2 === "surface") {
          if (editor !== void 0) setEditor(setMode(editor, surface === "canvas" ? "list" : "canvas"));
          return;
        }
        if (id2 === "delete") {
          setConfirmDelete(true);
          return;
        }
        if (id2.startsWith("template:")) {
          const template = library.templates.find((entry) => entry.id === id2.slice("template:".length));
          if (template !== void 0) guard(() => applyTemplate(template));
          return;
        }
        if (id2.startsWith("draft:")) {
          guard(() => void startDraft(id2.slice("draft:".length)));
        }
      };
      const emptyCanvas = () => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("section", { className: "dsh-wf-canvas dsh-wf-blank-canvas", "data-section": "editor-start", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-empty-title", children: t("design.intro") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          import_dsh_client_ui_primitives7.Button,
          {
            type: "button",
            variant: "primary",
            size: "sm",
            onClick: () => guard(startBlank),
            disabled: loading,
            children: t("design.new")
          }
        )
      ] }) });
      const listSurface = (state) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-surface-list", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-wf-list-bar", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          PaletteMenu,
          {
            open: paletteOpen,
            onOpen: () => setPaletteOpen(true),
            onClose: () => setPaletteOpen(false),
            onAdd: (executor) => addExecutor(executor)
          }
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          ListEditor,
          {
            state,
            ...selected2 === void 0 ? {} : { selected: selected2 },
            onSelect: setSelected,
            onDefinitionPatch: (patch) => apply2(patchDefinition(state, patch)),
            onPatch: (stepId, patch) => apply2(patchStep(state, stepId, patch)),
            onConnect: (source, target, kind) => apply2(connectSteps(state, source, target, kind)),
            onDelete: (stepId) => {
              apply2(deleteStep(state, stepId));
              setSelected(void 0);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
          PropertyPanel,
          {
            state,
            ...selected2 === void 0 ? {} : { selected: selected2 },
            onDefinitionPatch: (patch) => apply2(patchDefinition(state, patch)),
            onPatch: (stepId, patch) => apply2(patchStep(state, stepId, patch)),
            onConnect: (source, target, kind) => apply2(connectSteps(state, source, target, kind)),
            onRename: (nodeId, nextId2) => apply2(renameStepId(state, nodeId, nextId2)),
            onDelete: (stepId) => {
              apply2(deleteStep(state, stepId));
              setSelected(void 0);
            }
          }
        )
      ] });
      const editorBody = () => {
        if (editor === void 0) return emptyCanvas();
        return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-sr-only", "aria-live": "polite", children: summaryText(editor.document.definition, selectedNode?.title, overlay) }),
          fallbackNotice(canvasFailed) === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-issue", role: "status", children: fallbackNotice(canvasFailed) }),
          overlay.notices.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-issue", role: "status", children: overlay.notices.join(" ") }),
          overlay.orphans.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("p", { className: "dsh-wf-muted", "data-orphans": overlay.orphans.length, children: [
            "Orphan run steps (not drawn):",
            " ",
            overlay.orphans.map((orphan) => `${orphan.id} (${orphan.state})`).join(", ")
          ] }),
          surface === "list" ? listSurface(editor) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-wf-surface-canvas", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "dsh-wf-canvas", "data-tab-group": "canvas", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            CanvasBoundary,
            {
              fallback: listSurface(editor),
              onError: () => {
                const recovery = recoverCanvas(editor);
                setCanvasFailed(recovery.failed);
                setEditor(recovery.editor);
              },
              children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                DesignCanvas,
                {
                  nodes: withOverlay(editor.diagram.nodes, overlay),
                  edges: editor.diagram.edges,
                  ...selected2 === void 0 ? {} : { selected: selected2 },
                  focusKey: `${editor.document.definition.id}:${String(editor.document.definition.version)}:${String(editor.diagram.nodes.length)}:${runId ?? ""}`,
                  onSelect: setSelected,
                  onMove: (nodeId, position) => apply2(moveStep(editor, nodeId, position)),
                  onConnectNode: (source, target, kind) => apply2(connectSteps(editor, source, target, kind)),
                  onDropBrick: (executor, position) => addExecutor(executor, position)
                }
              )
            }
          ) }) })
        ] });
      };
      return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-design", "data-state": loading ? "loading" : "ready", ref: root2, children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: FLOW_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-design-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-head-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-wf-head-name", children: editor === void 0 ? t("design.pageTitle") : editor.document.definition.name }),
            editor === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_jsx_runtime8.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.Tag, { tone: "outline", children: currentTrigger === "" ? t("overview.unknownKind") : currentTrigger }),
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.Tag, { tone: "quiet", children: editor.document.source })
            ] })
          ] }),
          editor === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { className: "dsh-wf-head-state", "data-status": editor.status, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "dsh-wf-dirty-dot", "data-dirty": editor.dirty, "aria-hidden": "true" }),
            editor.dirty ? t("design.dirty") : t("design.clean"),
            " \xB7 v",
            String(editor.document.definition.version),
            editor.document.revision === null ? "" : ` \xB7 ${editor.document.revision.slice(0, 8)}`
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-head-actions", children: [
            editor === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              import_dsh_client_ui_primitives7.Menu,
              {
                open: runMenuOpen,
                items: runItems(),
                align: "end",
                selectedId: runId ?? "",
                onSelect: (id2) => {
                  setRunMenuOpen(false);
                  setRunId(id2 === "" ? void 0 : id2);
                },
                onClose: () => setRunMenuOpen(false),
                anchor: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  import_dsh_client_ui_primitives7.Button,
                  {
                    type: "button",
                    variant: "toolbar",
                    size: "sm",
                    className: "dsh-wf-run",
                    icon: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.IconChevronDownOutlineRegular, {}),
                    "aria-label": t("design.run"),
                    "aria-haspopup": "menu",
                    title: runId === void 0 ? t("design.noRun") : `${runId} \xB7 ${String(activeRunEntry?.status ?? "")}`,
                    disabled: runs.length === 0,
                    onClick: () => setRunMenuOpen(true),
                    children: runLabel()
                  }
                )
              }
            ),
            placement === "drawer" && editor !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              import_dsh_client_ui_primitives7.Button,
              {
                type: "button",
                variant: "toolbar",
                size: "sm",
                icon: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.IconSlidersTwoOutlineRegular, {}),
                "aria-label": t("design.details"),
                title: t("design.details"),
                "aria-pressed": detailsOpen,
                onClick: () => setDetailsOpen((open2) => !open2)
              }
            ) : null,
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              import_dsh_client_ui_primitives7.Button,
              {
                type: "button",
                variant: "primary",
                size: "sm",
                onClick: () => void saveCurrent(),
                disabled: editor === void 0 || loading || editor.status === "saving",
                children: t("design.save")
              }
            ),
            editor === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              import_dsh_client_ui_primitives7.Menu,
              {
                open: menuOpen,
                items: menuItems(),
                align: "end",
                onSelect: onMenuSelect,
                onClose: () => setMenuOpen(false),
                anchor: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  import_dsh_client_ui_primitives7.Button,
                  {
                    type: "button",
                    variant: "toolbar",
                    size: "sm",
                    icon: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.IconEllipsisOutlineRegular, {}),
                    "aria-label": t("design.more"),
                    title: t("design.more"),
                    onClick: () => setMenuOpen(true)
                  }
                )
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
              import_dsh_client_ui_primitives7.Button,
              {
                type: "button",
                variant: "ghost",
                size: "sm",
                onClick: () => guard(() => props.onClose?.()),
                children: t("design.close")
              }
            )
          ] })
        ] }),
        confirmDelete && editor !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-confirm", role: "alert", "data-section": "confirm-delete", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
            t("design.deletePrompt"),
            " \xAB",
            editor.document.definition.name,
            "\xBB?"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            import_dsh_client_ui_primitives7.Button,
            {
              type: "button",
              variant: "outline",
              size: "sm",
              onClick: () => void removeCurrent(),
              disabled: loading,
              children: t("design.delete")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives7.Button, { type: "button", variant: "ghost", size: "sm", onClick: () => setConfirmDelete(false), children: t("design.cancel") })
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
          "div",
          {
            className: "dsh-wf-workbench",
            "data-mode": surface,
            "data-layout": placement,
            style: workbenchStyle,
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                WorkflowRail,
                {
                  definitions: library.definitions,
                  ...editor === void 0 ? {} : { currentId: editor.document.definition.id },
                  ...currentTrigger === void 0 ? {} : { currentTrigger },
                  ...editor === void 0 || runs[0] === void 0 ? {} : { latestRun: runs[0] },
                  disabled: loading,
                  t,
                  onNew: () => guard(startBlank),
                  onOpen: (id2) => guard(() => void open(id2)),
                  onTrigger: chooseTrigger,
                  onExecutor: addExecutor
                }
              ),
              surface === "canvas" ? (
                // biome-ignore lint/a11y/useSemanticElements: a resizable splitter has no semantic element; role="separator" with aria-value* is the ARIA pattern.
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "div",
                  {
                    className: "dsh-wf-splitter",
                    role: "separator",
                    "aria-orientation": "vertical",
                    "aria-label": t("design.resizeRail"),
                    "aria-valuemin": RAIL_WIDTH.min,
                    "aria-valuemax": RAIL_WIDTH.max,
                    "aria-valuenow": paneWidths.rail,
                    title: t("design.resizeRail"),
                    tabIndex: 0,
                    "data-splitter": "rail",
                    onPointerDown: dragSplitter("rail"),
                    onKeyDown: keySplitter("rail"),
                    onDoubleClick: resetSplitter("rail")
                  }
                )
              ) : null,
              /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-workbench-main", children: [
                message === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-issue", children: message }),
                conflict === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-design-bar", role: "alert", "data-conflict": conflict.kind, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: editor?.message ?? t("design.conflict") }),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    import_dsh_client_ui_primitives7.Button,
                    {
                      type: "button",
                      variant: "outline",
                      size: "sm",
                      onClick: () => guard(() => void reloadCurrent()),
                      children: t("design.reload")
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                    import_dsh_client_ui_primitives7.Button,
                    {
                      type: "button",
                      variant: "outline",
                      size: "sm",
                      onClick: () => void copyCurrent(),
                      disabled: loading,
                      children: t("design.saveCopy")
                    }
                  ),
                  conflict.nextId === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_dsh_client_ui_primitives7.Button, { type: "button", variant: "outline", size: "sm", onClick: useNextId, children: [
                    t("design.useId"),
                    " ",
                    conflict.nextId
                  ] })
                ] }),
                editor?.message === void 0 || conflict !== void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "dsh-wf-issue", children: editor.message }),
                editorBody()
              ] }),
              surface === "canvas" && placement === "column" ? (
                // biome-ignore lint/a11y/useSemanticElements: a resizable splitter has no semantic element; role="separator" with aria-value* is the ARIA pattern.
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "div",
                  {
                    className: "dsh-wf-splitter",
                    role: "separator",
                    "aria-orientation": "vertical",
                    "aria-label": t("design.resizeInspector"),
                    "aria-valuemin": INSPECTOR_WIDTH.min,
                    "aria-valuemax": INSPECTOR_WIDTH.max,
                    "aria-valuenow": paneWidths.inspector,
                    title: t("design.resizeInspector"),
                    tabIndex: 0,
                    "data-splitter": "inspector",
                    onPointerDown: dragSplitter("inspector"),
                    onKeyDown: keySplitter("inspector"),
                    onDoubleClick: resetSplitter("inspector")
                  }
                )
              ) : null,
              surface === "canvas" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
                "aside",
                {
                  className: "dsh-wf-inspector",
                  "data-open": inspectorOpen ? "true" : "false",
                  "aria-label": t("design.inspector"),
                  children: [
                    placement === "drawer" ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-inspector-head", children: [
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("design.inspector") }),
                      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                        import_dsh_client_ui_primitives7.Button,
                        {
                          type: "button",
                          variant: "ghost",
                          size: "sm",
                          "aria-label": t("design.closeInspector"),
                          onClick: () => {
                            setDetailsOpen(false);
                            setSelected(void 0);
                          },
                          children: "\xD7"
                        }
                      )
                    ] }) : null,
                    editor === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                      PropertyPanel,
                      {
                        state: editor,
                        ...selected2 === void 0 ? {} : { selected: selected2 },
                        onDefinitionPatch: (patch) => apply2(patchDefinition(editor, patch)),
                        onPatch: (stepId, patch) => apply2(patchStep(editor, stepId, patch)),
                        onConnect: (source, target, kind) => apply2(connectSteps(editor, source, target, kind)),
                        onRename: (nodeId, nextId2) => apply2(renameStepId(editor, nodeId, nextId2)),
                        onDelete: (stepId) => {
                          apply2(deleteStep(editor, stepId));
                          setSelected(void 0);
                        }
                      }
                    )
                  ]
                }
              ) : null
            ]
          }
        ),
        connectValue === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "dsh-wf-design-bar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(
            "select",
            {
              "aria-label": "Connection",
              value: connectValue,
              onChange: (event) => setConnectValue(event.currentTarget.value),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "", children: "Choose a connection" }),
                choices.map((choice) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
                  "option",
                  {
                    value: `${choice.kind}:${choice.target}`,
                    children: choice.label
                  },
                  `${choice.kind}:${choice.target}`
                ))
              ]
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            import_dsh_client_ui_primitives7.Button,
            {
              type: "button",
              variant: "outline",
              size: "sm",
              disabled: connectValue === "",
              onClick: () => {
                if (selected2 === void 0 || editor === void 0) return;
                const separator = connectValue.indexOf(":");
                const kind = connectValue.slice(0, separator);
                const target = connectValue.slice(separator + 1);
                apply2(connectSteps(editor, selected2, target, kind));
                setConnectValue(void 0);
              },
              children: "Connect"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
            import_dsh_client_ui_primitives7.Button,
            {
              type: "button",
              variant: "ghost",
              size: "sm",
              onClick: () => setConnectValue(void 0),
              children: "Cancel"
            }
          )
        ] }),
        issues.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ul", { className: "dsh-wf-issue", "data-issues": issues.length, children: issues.map((issue) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("li", { children: [
          issueLabel(issue),
          ": ",
          issue.message
        ] }, `${issue.path}:${issue.message}`)) })
      ] });
    }

    // packages/plugin-workflows/src/client/panel.tsx
    var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");

    // packages/plugin-workflows/src/client/locale.ts
    var EN = {
      "view.label": "Workflows",
      "state.loading": "Reading the workflow journal\u2026",
      "state.refreshing": "Refreshing\u2026",
      "state.refresh": "Refresh",
      "state.error": "The Workflows view could not be loaded.",
      "state.retry": "Retry",
      "state.noSession": "Open a session to see its workflow process.",
      "status.details": "Listener details",
      "health.listener-down": "The recorder listener is down",
      "health.journal-readonly": "The journal is read-only",
      "health.waiting": "Listener healthy, no matching event yet",
      "health.healthy": "Listener healthy and matching events observed",
      "health.listeners": "listeners",
      "health.triggers": "triggers",
      "health.lastEvent": "last event",
      "health.lastCheck": "last check",
      "health.lastError": "last error",
      "segment.label": "Workflows view",
      "segment.workflows": "Workflows",
      "segment.runs": "Runs",
      "runs.title": "Runs",
      "runs.empty": "No run is attributable to this session yet. A run appears here when a workflow starts from this session.",
      "runs.trigger": "trigger",
      "runs.started": "Started",
      "runs.ended": "Ended",
      "runs.duration": "Duration",
      "runs.status": "Status",
      "runs.back": "Back",
      "runs.missing": "This run is no longer recorded.",
      "runs.missingBody": "It was removed or is not attributable to this session.",
      "runs.record": "Record",
      "runs.definition": "Definition",
      "runs.steps": "Steps",
      "runs.step": "Step",
      "runs.state": "State",
      "runs.time": "Time",
      "runs.evidence": "Evidence",
      "runs.issue": "Issue",
      "runs.violations": "Violations",
      "runs.error": "Error",
      "runs.status.running": "running",
      "runs.status.done": "done",
      "runs.status.failed": "failed",
      "runs.status.unknown": "unknown",
      "runs.source.checkpoint": "checkpoint",
      "runs.source.delegation": "delegation",
      "runs.source.review": "review",
      "runs.source.workflow": "workflow",
      "events.empty": "No process event is recorded in this session yet.",
      "events.truncated": "payload truncated",
      "events.evaluations": "Trigger evaluations",
      "events.openRun": "Open run",
      "overview.unknownKind": "unknown trigger",
      "overview.empty": "No workflow definition is installed in this workspace yet.",
      "overview.noWorkflows": "No workflow is bound to this trigger.",
      "overview.unbound": "unbound triggers",
      "overview.firings": "firings",
      "overview.runs": "runs",
      "overview.failed": "failed",
      "overview.running": "running",
      "overview.blocked": "blocked",
      "overview.cancelled": "cancelled",
      "overview.interrupted": "interrupted",
      "overview.statsUnavailable": "run statistics are unavailable",
      "overview.latestRun": "last run",
      "overview.noRuns": "no run yet",
      "overview.iterations": "iterations",
      "overview.cap": "cap",
      "overview.list": "list",
      "overview.latestUnavailable": "some latest runs could not be loaded",
      "workflow.back": "Back to workflows",
      "workflow.noDescription": "No description is recorded for this definition.",
      "workflow.version": "Version",
      "workflow.gateOwnership": "Gate ownership",
      "workflow.trigger": "Trigger",
      "workflow.firings": "Firings",
      "workflow.countsUnavailable": "Firing counts are unavailable.",
      "workflow.architecture": "Architecture",
      "workflow.overlayRun": "Run overlay",
      "workflow.overlayLatest": "Latest run",
      "workflow.overlayDiffers": "The selected run was recorded on another definition version.",
      "workflow.canvasFallback": "The canvas could not render; the ordered step table is showing.",
      "workflow.step": "Step",
      "workflow.executor": "Executor",
      "workflow.next": "next",
      "workflow.then": "then",
      "workflow.else": "else",
      "workflow.loop": "loop",
      "workflow.noSteps": "No step is recorded for this definition.",
      "workflow.runs": "Runs",
      "workflow.noRuns": "No run of this workflow is recorded in this session.",
      "workflow.history": "Evaluation history",
      "workflow.noHistory": "No trigger evaluation of this workflow is recorded in this session.",
      "definitions.heading": "Definitions",
      "definitions.empty": "No definition is installed yet.",
      "definitions.id": "Definition",
      "definitions.trigger": "Trigger",
      "definitions.mode": "Mode",
      "definitions.risk": "Risk",
      "definitions.steps": "Steps",
      "definitions.source": "Source",
      "receipts.heading": "Receipts",
      "receipts.empty": "No authenticated receipt exists yet.",
      "triggers.title": "Triggers",
      "triggers.empty": "No trigger catalog is loaded.",
      "triggers.id": "Trigger",
      "triggers.event": "Event",
      "triggers.filter": "Filter",
      "triggers.mode": "Mode",
      "triggers.last": "Last evaluation",
      "triggers.notEvaluated": "not evaluated yet",
      "reason.would-fire": "would fire",
      "reason.event-mismatch": "event mismatch",
      "reason.filter-mismatch": "filter mismatch",
      "reason.dedupe": "duplicate",
      "reason.disabled": "disabled",
      "reason.not-ready": "not ready",
      "reason.error": "error",
      "reason.run-created": "run created",
      "reason.run-suppressed": "run suppressed",
      "reason.not-applicable": "not applicable",
      "paging.more": "Load more",
      "time.now": "now",
      "time.minutes": "min",
      "time.hours": "h",
      "time.days": "d",
      "time.months": "mo",
      "time.years": "y",
      "time.unknown": "unknown time",
      "design.title": "Design",
      "design.pageTitle": "Workflow design",
      "design.guideTitle": "Workflow design",
      "design.guideDescription": "Edit definitions, inspect triggers, and read the receipts",
      "design.close": "Close",
      "design.new": "New definition",
      "design.open": "Open definition",
      "design.template": "Template\u2026",
      "design.copyTemplate": "Create from template",
      "design.draft": "Draft\u2026",
      "design.openDraft": "Open draft",
      "design.save": "Save",
      "design.reload": "Reload",
      "design.delete": "Delete",
      "design.confirmDelete": "Confirm delete",
      "design.listMode": "List",
      "design.canvasMode": "Canvas",
      "design.more": "More",
      "design.mode": "Editor surface",
      "design.properties": "Properties",
      "design.description": "Description",
      "design.noDescription": "No description",
      "design.railWorkflows": "Workflows",
      "design.railBlocks": "Blocks",
      "design.blocksTriggers": "Trigger kinds",
      "design.blocksSteps": "Step executors",
      "design.diagnostics": "Diagnostics",
      "design.inspector": "Inspector",
      "design.closeInspector": "Close inspector",
      "design.resizeRail": "Resize workflow rail",
      "design.resizeInspector": "Resize inspector",
      "design.details": "Details",
      "design.listView": "List view",
      "design.canvasView": "Canvas view",
      "design.cancel": "Cancel",
      "design.deletePrompt": "Delete workflow",
      "design.brick.agent": "Agent",
      "design.brick.agent.hint": "The main agent does this step.",
      "design.brick.tool": "Tool call",
      "design.brick.tool.hint": "One allowlisted tool call.",
      "design.brick.subagent": "Subagent",
      "design.brick.subagent.hint": "Delegate this step to a child agent.",
      "design.brick.human": "Ask user",
      "design.brick.human.hint": "Wait for the user to answer.",
      "design.brick.branch": "Branch",
      "design.brick.branch.hint": "Choose one of two next steps.",
      "design.brick.loop": "Loop",
      "design.brick.loop.hint": "Repeat a step up to a cap.",
      "design.brick.trigger.turnStopping": "Fires when the turn is about to close.",
      "design.brick.trigger.toolPreExecute": "Fires before a tool call runs.",
      "design.brick.trigger.toolResult": "Fires after a tool call returns.",
      "design.brick.trigger.fsChange": "Fires after a file change.",
      "design.brick.trigger.subagentEnd": "Fires when a subagent finishes.",
      "design.brick.trigger.reviewRecord": "Fires when a review record is written.",
      "design.run": "Run overlay",
      "design.noRun": "No run",
      "design.dirty": "unsaved changes",
      "design.clean": "saved",
      "design.saveCopy": "Save as copy",
      "design.useId": "Use id",
      "design.conflict": "The resource changed on disk.",
      "design.closeUnsaved": "Discard the unsaved changes to this definition?",
      "design.intro": "Build a local definition on the canvas or in the list. Shipped definitions are templates; editing one creates a local copy."
    };
    function reasonLabel(reason, t) {
      const key = `reason.${reason}`;
      const label = t(key);
      return label === key ? reason : label;
    }

    // packages/plugin-workflows/src/client/panel.tsx
    var import_jsx_runtime9 = require("react/jsx-runtime");
    function emptyPageStates() {
      return { runs: void 0, workflowRuns: void 0, history: void 0 };
    }
    function updatePageState(states, kind, value2) {
      return { ...states, [kind]: value2 };
    }
    function pageLoadProps(states, kind, next, t) {
      const page = states?.[kind];
      if (next === void 0 || page?.key !== `${kind}:${next}`) return {};
      if (page.phase === "loading") return { loading: true };
      return { error: page.message ?? t("state.error") };
    }
    var EVENTS_PATH = "/api/workflows/events";
    var RUNS_PATH = "/api/workflows/runs";
    var TRIGGERS_PATH = "/api/workflows/triggers";
    var HEALTH_PATH = "/api/workflows/health";
    var EVIDENCE_PATH = "/api/workflows/evidence";
    var DEFINITIONS_PATH = "/api/workflows/definitions";
    function pageUrl(path, session, cursor, limit, extra) {
      const query = new URLSearchParams({ session });
      if (cursor !== void 0) query.set("cursor", cursor);
      if (limit !== void 0) query.set("limit", String(limit));
      for (const [name, value2] of Object.entries(extra ?? {})) query.set(name, value2);
      return `${path}?${query.toString()}`;
    }
    function eventsUrl(session, cursor, limit) {
      return pageUrl(EVENTS_PATH, session, cursor, limit);
    }
    function runsUrl(session, cursor, limit, options) {
      return pageUrl(RUNS_PATH, session, cursor, limit, {
        ...options?.order === void 0 ? {} : { order: options.order },
        ...options?.run === void 0 ? {} : { run: options.run },
        ...options?.definition === void 0 ? {} : { definition: options.definition },
        ...options?.stats === true ? { stats: "1" } : {}
      });
    }
    function triggersUrl(session) {
      return pageUrl(TRIGGERS_PATH, session);
    }
    function definitionsUrl(session, id2) {
      return pageUrl(
        DEFINITIONS_PATH,
        session,
        void 0,
        void 0,
        id2 === void 0 ? void 0 : { id: id2 }
      );
    }
    function isRecordEvidence(value2) {
      if (!value2.endsWith(".json")) return false;
      return value2.startsWith(".dsh/delegation/") || value2.startsWith(".dsh/work-checkpoints/") || value2.startsWith("openspec/changes/");
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
    var PROJECTED_PREFIXES = ["workflow:", "delegation:", "review:", "checkpoint:", "local-review:"];
    function projectedRunId(runId) {
      return PROJECTED_PREFIXES.some((prefix) => runId.startsWith(prefix)) ? runId : `workflow:${runId}`;
    }
    function formatTime(at, t) {
      if (at === void 0 || Number.isNaN(at) || at <= 0) return t("time.unknown");
      return new Date(at).toLocaleTimeString();
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
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "dsh-wf-section", "data-section": "triggers", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { className: "dsh-wf-heading", children: t("triggers.title") }),
        triggers.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "dsh-wf-muted", children: t("triggers.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("ul", { className: "dsh-wf-rows", children: triggers.map((trigger) => /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("li", { className: "dsh-wf-trigger-row", "data-trigger": trigger.id, children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-wf-row-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-wf-subject", children: trigger.id }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-wf-chip", children: trigger.event }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives8.Tag, { tone: "quiet", children: trigger.mode }),
            trigger.source === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-wf-muted", "data-source": trigger.source, children: trigger.plugin === void 0 ? trigger.source : `${trigger.source}:${trigger.plugin}` }),
            /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-wf-time", children: trigger.last === void 0 ? t("triggers.notEvaluated") : `${reasonLabel(trigger.last.reason, t)} \xB7 ${formatTime(trigger.last.at, t)}` })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "dsh-wf-row-meta", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "dsh-wf-muted dsh-wf-mono", children: filterText(trigger) }) })
        ] }, trigger.id)) })
      ] });
    }
    function LoadingLine(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "dsh-wf-muted", role: "status", children: props.t("state.loading") });
    }
    function ErrorLine(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "dsh-wf-error-block", role: "alert", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: `${props.t("state.error")} ${props.message}` }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives8.Button, { type: "button", variant: "outline", size: "sm", onClick: props.onRetry, children: props.t("state.retry") })
      ] });
    }
    function LoadMore(props) {
      if (props.next === void 0) return null;
      if (props.error !== void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ErrorLine, { message: props.error, t: props.t, onRetry: props.onLoad });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        import_dsh_client_ui_primitives8.Button,
        {
          type: "button",
          variant: "ghost",
          size: "sm",
          className: "dsh-wf-more",
          disabled: props.loading === true,
          onClick: props.onLoad,
          children: props.t("paging.more")
        }
      );
    }

    // packages/plugin-workflows/src/client/workflows.tsx
    var import_jsx_runtime10 = require("react/jsx-runtime");
    function receiptsUrl(sessionId) {
      return `/api/workflows/receipts?session=${encodeURIComponent(sessionId)}`;
    }
    function ReceiptsList(props) {
      const { receipts, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "dsh-wf-section", "data-section": "receipts", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { className: "dsh-wf-heading", children: t("receipts.heading") }),
        receipts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "dsh-wf-muted", children: t("receipts.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("ul", { className: "dsh-wf-runs", children: receipts.map((receipt) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("li", { "data-receipt": receipt.change, children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "dsh-wf-kind", children: receipt.kind }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "dsh-wf-subject", children: receipt.change }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { className: "dsh-wf-summary", children: [
            receipt.digest.slice(0, 8),
            "\u2026"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "dsh-wf-time", children: new Date(receipt.issuedAt).toLocaleString() })
        ] }, `${receipt.kind}:${receipt.change}`)) })
      ] });
    }

    // packages/plugin-workflows/src/client/design-page.tsx
    var import_jsx_runtime11 = require("react/jsx-runtime");
    var fallbackTranslate = (key) => EN[key] ?? key;
    var dirtyByTab = /* @__PURE__ */ new Map();
    function designTabKey(sessionId, tabId) {
      return `${sessionId}:${tabId}`;
    }
    function setDesignDirty(key, dirty) {
      if (dirty) dirtyByTab.set(key, true);
      else dirtyByTab.delete(key);
    }
    function isDesignDirty(key) {
      return dirtyByTab.get(key) === true;
    }
    function closeWithGuard(state, ask) {
      if (!state.dirty) return;
      if (ask()) return;
      throw new Error("the workflow design page has unsaved changes");
    }
    function closeDesignOnTabClose(t, key) {
      closeWithGuard({ dirty: isDesignDirty(key) }, () => window.confirm(t("design.closeUnsaved")));
    }
    function DesignPageBody(props) {
      const { sessionId, t } = props;
      const [width, setWidth] = (0, import_react7.useState)(1024);
      const [sections, setSections] = (0, import_react7.useState)({ triggers: [], receipts: [] });
      const [diagnosticsOpen, setDiagnosticsOpen] = (0, import_react7.useState)(false);
      const [error, setError] = (0, import_react7.useState)();
      const root2 = (0, import_react7.useRef)(null);
      (0, import_react7.useEffect)(() => {
        const element = root2.current;
        if (element === null) return;
        setWidth(element.clientWidth);
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => setWidth(element.clientWidth));
        observer.observe(element);
        return () => observer.disconnect();
      }, []);
      (0, import_react7.useEffect)(() => {
        let current = true;
        setError(void 0);
        void Promise.all([
          requestJson(triggersUrl(sessionId)),
          requestJson(receiptsUrl(sessionId))
        ]).then(
          ([triggers, receipts]) => {
            if (!current) return;
            setSections({ triggers: triggers.triggers, receipts: receipts.receipts });
          },
          (failure2) => {
            if (!current) return;
            setError(failure2 instanceof Error ? failure2.message : String(failure2));
          }
        );
        return () => {
          current = false;
        };
      }, [sessionId]);
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "dsh-wf-page", ref: root2, children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("style", { children: FLOW_CSS }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
          DesignMode,
          {
            sessionId,
            t,
            surfaceWidth: width,
            onClose: props.close,
            onDirtyChange: (dirty) => {
              setDesignDirty(props.dirtyKey, dirty);
            }
          }
        ),
        error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "dsh-wf-issue", role: "alert", children: error }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
          import_dsh_client_ui_primitives9.DisclosureRow,
          {
            icon: null,
            title: t("design.diagnostics"),
            open: diagnosticsOpen,
            expandable: true,
            expandOnRowClick: true,
            onToggle: () => setDiagnosticsOpen((current) => !current),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(TriggersTable, { triggers: sections.triggers, t }),
              /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ReceiptsList, { receipts: sections.receipts, t })
            ]
          }
        )
      ] });
    }
    function DesignPage(props) {
      const { tab } = props.useTabInfo();
      const t = props.t ?? fallbackTranslate;
      const dirtyKey = designTabKey(props.sessionId, tab.id);
      const close = () => {
        setDesignDirty(dirtyKey, false);
        tab.actions.close();
      };
      return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(DesignPageBody, { sessionId: props.sessionId, t, dirtyKey, close });
    }

    // packages/plugin-workflows/src/client/view.tsx
    var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react9 = require("react");

    // packages/plugin-workflows/src/client/overview.tsx
    var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react8 = require("react");

    // packages/plugin-workflows/src/client/run-history.tsx
    var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime12 = require("react/jsx-runtime");
    function runDot(status) {
      if (status === "running") return "ongoing";
      if (status === "done") return "done";
      if (status === "failed") return "error";
      return "idle";
    }
    function healthDot(state) {
      if (state === "healthy") return "done";
      if (state === "waiting") return "ongoing";
      if (state === "journal-readonly") return "warning";
      return "error";
    }
    function relativeLabel(bucket, t) {
      if (bucket === void 0 || bucket.unit === "now") return t("time.now");
      return `${String(bucket.n)}${t(`time.${bucket.unit}`)}`;
    }
    function durationText(startedAt, endedAt) {
      if (endedAt === void 0) return void 0;
      const milliseconds = endedAt - startedAt;
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return void 0;
      const seconds = Math.round(milliseconds / 1e3);
      if (seconds < 60) return `${String(seconds)}s`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
      const hours = Math.floor(minutes / 60);
      return `${String(hours)}h ${String(minutes % 60)}m`;
    }
    function statusDetails(health, t) {
      const parts = [
        `${String(health.listenerCount)} ${t("health.listeners")}`,
        `${String(health.triggerCount)} ${t("health.triggers")}`,
        `${t("health.lastEvent")}: ${formatTime(health.lastEventAt, t)}`,
        `${t("health.lastCheck")}: ${formatTime(health.lastCheckAt, t)}`
      ];
      if (health.lastError !== void 0) parts.push(`${t("health.lastError")}: ${health.lastError}`);
      return parts.join(" \xB7 ");
    }
    function StatusLine(props) {
      const { health, t } = props;
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "dsh-wf-status", "data-state": health.state, children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.StateDot, { state: healthDot(health.state) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-wf-status-text", children: t(`health.${health.state}`) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Tooltip, { label: statusDetails(health, t), children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { type: "button", variant: "ghost", size: "sm", children: t("status.details") }) }),
        props.onRefresh === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
          import_dsh_client_ui_primitives10.Button,
          {
            type: "button",
            variant: "ghost",
            size: "sm",
            disabled: props.refreshing === true,
            onClick: props.onRefresh,
            children: props.refreshing === true ? t("state.refreshing") : t("state.refresh")
          }
        )
      ] });
    }
    function RunRow(props) {
      const { run, t } = props;
      const started = run.startedAt > 0 ? new Date(run.startedAt).toLocaleString() : t("time.unknown");
      const relative = run.startedAt > 0 ? relativeLabel((0, import_dsh_client_ui_primitives10.relativeTime)(run.startedAt, props.now), t) : t("time.unknown");
      const duration = durationText(run.startedAt, run.endedAt);
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("li", { className: "dsh-wf-row", "data-row-key": run.id, "data-status": run.status, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(
        import_dsh_client_ui_primitives10.Button,
        {
          type: "button",
          variant: "toolbar",
          size: "sm",
          className: "dsh-wf-row-button",
          "data-run": run.id,
          onClick: props.onOpen,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.StateDot, { state: runDot(run.status) }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-wf-run-title", children: run.title }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Tag, { tone: "quiet", children: run.trigger === void 0 ? t(`runs.source.${run.source}`) : `${t("runs.trigger")}: ${run.trigger}` }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-wf-run-status", children: t(`runs.status.${run.status}`) }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Tooltip, { label: started, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-wf-time", children: relative }) }),
            duration === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "dsh-wf-time", "data-duration": duration, children: duration })
          ]
        }
      ) });
    }
    function RunList(props) {
      const { runs, t } = props;
      if (runs.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "dsh-wf-muted", "data-section": "runs", "data-state": "empty", children: t("runs.empty") });
      }
      const now2 = props.now ?? Date.now();
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
        import_dsh_client_ui_primitives10.AnimatedRows,
        {
          className: "dsh-wf-rows",
          role: "list",
          label: t("runs.title"),
          rowKeys: runs.map((run) => run.id),
          ready: true,
          resetKey: `runs:${String(runs.length)}`,
          children: runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RunRow, { run, t, now: now2, onOpen: () => props.onOpen?.(run.id) }, run.id))
        }
      );
    }

    // packages/plugin-workflows/src/client/overview.tsx
    var import_jsx_runtime13 = require("react/jsx-runtime");
    function definitionEvaluationId(definitionId) {
      return `definition:${definitionId}`;
    }
    function matchText(match) {
      if (match === void 0) return "\u2014";
      const parts = [];
      for (const [name, value2] of Object.entries(match)) {
        if (value2 === void 0) continue;
        parts.push(`${name}: ${typeof value2 === "string" ? value2 : JSON.stringify(value2)}`);
      }
      return parts.length === 0 ? "\u2014" : parts.join(", ");
    }
    function triggerText(trigger, t) {
      if (trigger === void 0) return t("overview.unknownKind");
      return `${t("definitions.mode")}: ${trigger.mode ?? "\u2014"} \xB7 ${t("triggers.filter")}: ${matchText(trigger.match)}`;
    }
    function triggerCountsFor(triggers, definitionId) {
      return triggers.find((trigger) => trigger.id === definitionEvaluationId(definitionId))?.counts;
    }
    function sumFirings(workflows) {
      if (workflows.length === 0) return void 0;
      let matched = 0;
      let total = 0;
      for (const workflow of workflows) {
        if (workflow.firings === void 0) return void 0;
        matched += workflow.firings.matched;
        total += workflow.firings.total;
      }
      return { matched, total };
    }
    function groupByTrigger(definitions, triggers, stats) {
      const order = [];
      const buckets = /* @__PURE__ */ new Map();
      for (const definition of definitions) {
        const kind = definition.trigger?.kind ?? "";
        const statsEntry = stats === void 0 ? void 0 : Object.hasOwn(stats.definitions, definition.id) ? stats.definitions[definition.id] : {
          completed: 0,
          failed: 0,
          cancelled: 0,
          interrupted: 0,
          running: 0,
          blocked: 0,
          total: 0
        };
        const firings = triggerCountsFor(triggers, definition.id);
        const bucket = {
          definition,
          ...statsEntry === void 0 ? {} : { stats: statsEntry },
          ...firings === void 0 ? {} : { firings }
        };
        const existing = buckets.get(kind);
        if (existing === void 0) {
          order.push(kind);
          buckets.set(kind, [bucket]);
        } else {
          existing.push(bucket);
        }
      }
      for (const trigger of triggers) {
        if (trigger.source === "workflow-definition") continue;
        if (buckets.has(trigger.event)) continue;
        order.push(trigger.event);
        buckets.set(trigger.event, []);
      }
      return order.map((kind) => {
        const workflows = buckets.get(kind) ?? [];
        const firings = sumFirings(workflows);
        return { kind, workflows, ...firings === void 0 ? {} : { firings } };
      });
    }
    function runStatsLabel(stats, t) {
      if (stats === void 0) return t("overview.statsUnavailable");
      const parts = [`${stats.completed} / ${stats.total} ${t("overview.runs")}`];
      parts.push(`${t("overview.failed")} ${stats.failed}`);
      parts.push(`${t("overview.running")} ${stats.running}`);
      if (stats.blocked > 0) parts.push(`${t("overview.blocked")} ${stats.blocked}`);
      parts.push(`${t("overview.cancelled")} ${stats.cancelled}`);
      parts.push(`${t("overview.interrupted")} ${stats.interrupted}`);
      return parts.join(" \xB7 ");
    }
    function latestRunFor(runs, definitionId) {
      return runs.find((run) => run.definition?.id === definitionId);
    }
    function evaluationsFor(event, definitionId) {
      const id2 = definitionEvaluationId(definitionId);
      return (event.triggers ?? []).filter((evaluation) => evaluation.id === id2);
    }
    function architectureChain(steps, t) {
      return (steps ?? []).map((step) => {
        const targets = [];
        if (step.branch !== void 0) {
          if (step.branch.then !== void 0) targets.push({ kind: "then", target: step.branch.then });
          if (step.branch.else !== void 0) targets.push({ kind: "else", target: step.branch.else });
        }
        if (step.loop !== void 0) {
          const details = [];
          if (step.loop.maxIterations !== void 0) {
            details.push(`${String(step.loop.maxIterations)} ${t("overview.iterations")}`);
          }
          if (step.loop.cap !== void 0) details.push(`${t("overview.cap")} ${step.loop.cap}`);
          if (step.loop.list !== void 0) details.push(`${t("overview.list")} ${step.loop.list}`);
          targets.push({
            kind: "loop",
            target: step.loop.next ?? "\u2014",
            ...details.length === 0 ? {} : { detail: details.join(", ") }
          });
        }
        if (step.next !== void 0) targets.push({ kind: "next", target: step.next });
        return { step, targets };
      });
    }
    function chainLabel(kind, t) {
      switch (kind) {
        case "next":
          return t("workflow.next");
        case "then":
          return t("workflow.then");
        case "else":
          return t("workflow.else");
        case "loop":
          return t("workflow.loop");
      }
    }
    function chainTargetsText(row, t) {
      if (row.targets.length === 0) return "\u2014";
      return row.targets.map((target) => {
        const label = chainLabel(target.kind, t);
        return target.detail === void 0 ? `${label}: ${target.target}` : `${label}: ${target.target} (${target.detail})`;
      }).join(" \xB7 ");
    }
    function runStatusLabel(run, t) {
      if (run.status === "running") return t("runs.status.running");
      if (run.status === "done") return t("runs.status.done");
      if (run.status === "failed") return t("runs.status.failed");
      return t("runs.status.unknown");
    }
    function DefinitionHistory(props) {
      const { t } = props;
      const rows = props.events.flatMap((event) => {
        const evaluations = evaluationsFor(event, props.definitionId);
        return evaluations.length === 0 ? [] : [{ event, evaluations }];
      });
      if (rows.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-muted", "data-section": "workflow-history", "data-state": "empty", children: t("workflow.noHistory") });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("ol", { className: "dsh-wf-events", "data-section": "workflow-history", children: rows.map(({ event, evaluations }, index2) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("li", { "data-kind": event.kind, children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-wf-event-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-time", children: formatTime(event.at, t) }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", children: event.kind }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-subject", children: event.subject }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-summary", children: event.summary }),
          event.truncated ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "warning", children: t("events.truncated") }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("ul", { className: "dsh-wf-evaluations", "aria-label": t("events.evaluations"), children: evaluations.map((evaluation) => {
          const runId = evaluation.runId === void 0 ? void 0 : projectedRunId(evaluation.runId);
          return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
            "li",
            {
              "data-trigger": evaluation.id,
              "data-matched": evaluation.matched ? "true" : "false",
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-trigger", children: evaluation.id }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-reason", children: reasonLabel(evaluation.reason, t) }),
                evaluation.path === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: `${t("triggers.filter")}: ${evaluation.path}` }),
                evaluation.filter === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: evaluation.filter }),
                evaluation.detail === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: evaluation.detail }),
                runId === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                  import_dsh_client_ui_primitives11.Button,
                  {
                    type: "button",
                    variant: "ghost",
                    size: "sm",
                    "data-run": runId,
                    onClick: () => props.onOpenRun(runId),
                    children: t("events.openRun")
                  }
                )
              ]
            },
            evaluation.id
          );
        }) })
      ] }, `${String(event.at)}:${String(index2)}`)) });
    }
    function WorkflowRow(props) {
      const { bucket, latest, now: now2, t } = props;
      const definition = bucket.definition;
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("li", { className: "dsh-wf-row", "data-row-key": definition.id, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
        import_dsh_client_ui_primitives11.Button,
        {
          type: "button",
          variant: "toolbar",
          size: "sm",
          className: "dsh-wf-row-button dsh-wf-workflow-row",
          "data-workflow": definition.id,
          onClick: props.onOpen,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: "dsh-wf-card-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-run-title", children: definition.name }),
              definition.version === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", children: `v${String(definition.version)}` }),
              definition.risk === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", children: `${t("definitions.risk")}: ${definition.risk}` }),
              definition.source === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", "data-source": definition.source, children: `${t("definitions.source")}: ${definition.plugin === void 0 ? definition.source : `${definition.source}:${definition.plugin}`}` })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-card-meta", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-summary", children: triggerText(definition.trigger, t) }) }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: "dsh-wf-card-stats", children: [
              bucket.stats === void 0 || bucket.stats.total === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-progress", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                "span",
                {
                  className: "dsh-wf-progress-fill",
                  style: {
                    width: `${String(Math.round(bucket.stats.completed / bucket.stats.total * 100))}%`
                  }
                }
              ) }),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-summary", "data-workflow-stats": definition.id, children: runStatsLabel(bucket.stats, t) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-card-foot", children: latest === void 0 ? bucket.stats === void 0 || bucket.stats.total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: t("overview.noRuns") }) : null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tooltip, { label: `${latest.title} \xB7 ${new Date(latest.startedAt).toLocaleString()}`, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: "dsh-wf-time", "data-latest-run": latest.id, children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.StateDot, { state: runDot(latest.status) }),
              " ",
              `${t("overview.latestRun")}: ${relativeLabel((0, import_dsh_client_ui_primitives11.relativeTime)(latest.startedAt, now2), t)} \xB7 ${runStatusLabel(latest, t)}`
            ] }) }) })
          ]
        }
      ) });
    }
    function WorkflowOverview(props) {
      const { t } = props;
      if (props.definitions.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-muted", "data-section": "workflow-overview", "data-state": "empty", children: t("overview.empty") });
      }
      const now2 = props.now ?? Date.now();
      const groups = groupByTrigger(props.definitions, props.triggers, props.stats);
      const bound = groups.filter((group) => group.workflows.length > 0);
      const unbound = groups.filter((group) => group.workflows.length === 0);
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-wf-overview", "data-section": "workflow-overview", children: [
        bound.map((group) => {
          const label = group.kind === "" ? t("overview.unknownKind") : group.kind;
          return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
            "section",
            {
              className: "dsh-wf-group",
              "data-trigger-kind": group.kind,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-wf-group-head", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { className: "dsh-wf-group-title", children: label }),
                  group.firings === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", children: `${String(group.firings.matched)} / ${String(group.firings.total)} ${t("overview.firings")}` })
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("ul", { className: "dsh-wf-rows", "aria-label": label, children: group.workflows.map((bucket) => {
                  const latest = props.latestRuns === void 0 ? latestRunFor(props.runs, bucket.definition.id) : Object.hasOwn(props.latestRuns, bucket.definition.id) ? props.latestRuns[bucket.definition.id] : void 0;
                  return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                    WorkflowRow,
                    {
                      bucket,
                      ...latest === void 0 ? {} : { latest },
                      now: now2,
                      t,
                      onOpen: () => props.onOpen(bucket.definition.id)
                    },
                    bucket.definition.id
                  );
                }) })
              ]
            },
            group.kind === "" ? "__unknown" : group.kind
          );
        }),
        unbound.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "dsh-wf-unbound", "data-section": "unbound-triggers", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { className: "dsh-wf-group-title", children: t("overview.unbound") }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "dsh-wf-unbound-list", children: unbound.map((group) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
            "span",
            {
              className: "dsh-wf-unbound-row",
              "data-trigger-empty": group.kind,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-summary", children: group.kind === "" ? t("overview.unknownKind") : group.kind }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: t("overview.noWorkflows") })
              ]
            },
            group.kind === "" ? "__unknown" : group.kind
          )) })
        ] })
      ] });
    }
    function Fact(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("dt", { children: props.label }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("dd", { children: props.value })
      ] });
    }
    function workflowCanvasModel(document2, runs, selectedRunId) {
      if (document2.trigger === void 0 || document2.steps === void 0) return void 0;
      const definition = document2;
      const graph = withLayout(definitionToGraph(definition));
      const run = selectedRunId === void 0 ? runs[0] : runs.find((entry) => entry.id === selectedRunId);
      return { graph, overlay: overlayFor(run, definition), ...run === void 0 ? {} : { run } };
    }
    function WorkflowPage(props) {
      const { definitionId, document: document2, t } = props;
      const [overlayRunId, setOverlayRunId] = (0, import_react8.useState)();
      const [canvasSelection, setCanvasSelection] = (0, import_react8.useState)();
      const counts = props.trigger?.counts;
      const risk = document2?.risk ?? document2?.settings?.risk;
      const gateOwnership = document2?.gateOwnership ?? document2?.settings?.gateOwnership;
      const chain = architectureChain(document2?.steps, t);
      const pageRuns = props.runs?.items ?? [];
      const canvas = document2 === void 0 ? void 0 : workflowCanvasModel(document2, pageRuns, overlayRunId);
      return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "dsh-wf-detail", "data-workflow-page": definitionId, children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-wf-detail-bar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { type: "button", variant: "ghost", size: "sm", onClick: props.onBack, children: t("workflow.back") }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h2", { className: "dsh-wf-detail-title", children: document2?.name ?? definitionId }),
          document2?.version === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Tag, { tone: "quiet", children: `v${String(document2.version)}` })
        ] }),
        props.phase === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(LoadingLine, { t }) : props.phase === "error" || document2 === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ErrorLine, { message: props.message ?? "", t, onRetry: props.onRetry }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-description", "data-section": "workflow-description", children: document2.description === void 0 || document2.description.trim() === "" ? t("workflow.noDescription") : document2.description }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("dl", { className: "dsh-wf-facts", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              Fact,
              {
                label: t("workflow.version"),
                value: document2.version === void 0 ? "\u2014" : `v${String(document2.version)}`
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Fact, { label: t("definitions.risk"), value: risk ?? "\u2014" }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(Fact, { label: t("workflow.gateOwnership"), value: gateOwnership ?? "\u2014" }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              Fact,
              {
                label: t("definitions.source"),
                value: document2.source === void 0 ? "\u2014" : document2.plugin === void 0 ? document2.source : `${document2.source}:${document2.plugin}`
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              Fact,
              {
                label: t("workflow.trigger"),
                value: document2.trigger === void 0 ? t("overview.unknownKind") : `${document2.trigger.kind} \xB7 ${t("definitions.mode")}: ${document2.trigger.mode ?? "\u2014"} \xB7 ${t("triggers.filter")}: ${matchText(document2.trigger.match)}`
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              Fact,
              {
                label: t("workflow.firings"),
                value: counts === void 0 ? t("workflow.countsUnavailable") : `${String(counts.matched)} / ${String(counts.total)} ${t("overview.firings")}`
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "dsh-wf-section", "data-section": "workflow-architecture", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { className: "dsh-wf-heading", children: t("workflow.architecture") }),
            canvas === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("style", { children: FLOW_CSS }),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "dsh-wf-canvas-toolbar", children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { children: [
                  t("workflow.overlayRun"),
                  /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(
                    "select",
                    {
                      "aria-label": t("workflow.overlayRun"),
                      value: overlayRunId ?? "",
                      onChange: (event) => setOverlayRunId(
                        event.currentTarget.value === "" ? void 0 : event.currentTarget.value
                      ),
                      disabled: pageRuns.length === 0,
                      children: [
                        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("option", { value: "", children: t("workflow.overlayLatest") }),
                        pageRuns.map((run) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("option", { value: run.id, children: `${run.id} \xB7 ${run.status}` }, run.id))
                      ]
                    }
                  )
                ] }),
                canvas.overlay.versionsDiffer ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-muted", children: t("workflow.overlayDiffers") }) : null
              ] }),
              canvas.overlay.notices.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-issue", role: "status", children: canvas.overlay.notices.join(" ") }),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                "div",
                {
                  className: "dsh-wf-canvas dsh-wf-session-canvas",
                  "data-readonly": "true",
                  "data-tab-group": "workflow-canvas",
                  children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                    CanvasBoundary,
                    {
                      fallback: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-muted", children: t("workflow.canvasFallback") }),
                      children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
                        DesignCanvas,
                        {
                          nodes: withOverlay(canvas.graph.nodes, canvas.overlay),
                          edges: canvas.graph.edges,
                          ...canvasSelection === void 0 ? {} : { selected: canvasSelection },
                          focusKey: `${document2?.id ?? definitionId}:${String(document2?.version ?? 0)}:${canvas.run?.id ?? "none"}`,
                          readOnly: true,
                          onSelect: setCanvasSelection
                        }
                      )
                    }
                  )
                }
              )
            ] }),
            chain.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-muted", children: t("workflow.noSteps") }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("table", { className: "dsh-wf-table", children: [
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("tr", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("th", { children: t("workflow.step") }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("th", { children: t("workflow.executor") }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("th", { children: t("workflow.next") })
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("tbody", { children: chain.map((row) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("tr", { "data-step": row.step.id, children: [
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("td", { children: row.step.title }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("td", { children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "dsh-wf-chip", children: row.step.executor }) }),
                /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("td", { className: "dsh-wf-summary", children: chainTargetsText(row, t) })
              ] }, row.step.id)) })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "dsh-wf-section", "data-section": "workflow-runs", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { className: "dsh-wf-heading", children: t("workflow.runs") }),
            props.runs === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(LoadingLine, { t }) : props.runs.items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "dsh-wf-muted", "data-state": "empty", children: t("workflow.noRuns") }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(RunList, { runs: props.runs.items, t, now: props.now, onOpen: props.onOpenRun }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              LoadMore,
              {
                next: props.runs?.next,
                t,
                onLoad: props.onLoadRuns,
                ...pageLoadProps(props.pageStates, "workflowRuns", props.runs?.next, t)
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "dsh-wf-section", "data-section": "workflow-history", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { className: "dsh-wf-heading", children: t("workflow.history") }),
            props.events === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(LoadingLine, { t }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              DefinitionHistory,
              {
                events: props.events.items,
                definitionId,
                t,
                onOpenRun: props.onOpenRun
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
              LoadMore,
              {
                next: props.events?.next,
                t,
                onLoad: props.onLoadHistory,
                ...pageLoadProps(props.pageStates, "history", props.events?.next, t)
              }
            )
          ] })
        ] })
      ] });
    }

    // packages/plugin-workflows/src/client/run-detail.tsx
    var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_jsx_runtime14 = require("react/jsx-runtime");
    function evidenceCell(step, session) {
      const ref = step.evidenceRef;
      if (ref !== void 0) {
        const raw = ref.ref;
        const name = ref.kind;
        if (raw === void 0) return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { "data-evidence-kind": name, children: name });
        const label = raw.includes("/") ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.PathLabel, { path: raw }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: raw });
        if (session !== void 0 && isRecordEvidence(raw)) {
          return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
            "a",
            {
              href: evidenceUrl(session, raw),
              target: "_blank",
              rel: "noreferrer",
              "data-evidence-kind": name,
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "dsh-wf-evidence-kind", children: name }),
                " ",
                label
              ]
            }
          );
        }
        return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { "data-evidence-kind": name, children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { className: "dsh-wf-evidence-kind", children: name }),
          " ",
          label
        ] });
      }
      if (step.evidence === void 0) return "\u2014";
      if (session === void 0 || !isRecordEvidence(step.evidence)) return step.evidence;
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("a", { href: evidenceUrl(session, step.evidence), target: "_blank", rel: "noreferrer", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.PathLabel, { path: step.evidence }) });
    }
    function Fact2(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("dt", { children: props.label }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("dd", { children: props.value })
      ] });
    }
    function RunDetailPage(props) {
      const { run, t, session } = props;
      const identity4 = run.definition === void 0 ? t(`runs.source.${run.source}`) : `${run.definition.name} \xB7 v${String(run.definition.version)}`;
      const duration = durationText(run.startedAt, run.endedAt);
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "dsh-wf-detail", "data-run-detail": run.id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "dsh-wf-detail-bar", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", variant: "ghost", size: "sm", onClick: props.onBack, children: t("runs.back") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h2", { className: "dsh-wf-detail-title", children: run.title }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
            import_dsh_client_ui_primitives12.Tag,
            {
              tone: run.status === "failed" ? "danger" : run.status === "done" ? "success" : "neutral",
              children: t(`runs.status.${run.status}`)
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("dl", { className: "dsh-wf-facts", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
            Fact2,
            {
              label: t("runs.definition"),
              value: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { "data-run-definition": run.definition?.id ?? run.source, children: identity4 })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Fact2, { label: t("runs.trigger"), value: run.trigger ?? "\u2014" }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Fact2, { label: t("runs.started"), value: formatTime(run.startedAt, t) }),
          run.endedAt === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Fact2, { label: t("runs.ended"), value: formatTime(run.endedAt, t) }),
          duration === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Fact2, { label: t("runs.duration"), value: duration })
        ] }),
        run.record === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "dsh-wf-muted", children: [
          `${t("runs.record")}: `,
          session === void 0 ? run.record : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("a", { href: evidenceUrl(session, run.record), target: "_blank", rel: "noreferrer", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.PathLabel, { path: run.record }) })
        ] }),
        run.error === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "dsh-wf-error", role: "alert", children: run.error }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "dsh-wf-section", "data-section": "steps", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { className: "dsh-wf-heading", children: t("runs.steps") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("table", { className: "dsh-wf-table", children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("tr", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("th", { children: t("runs.step") }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("th", { children: t("runs.state") }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("th", { children: t("runs.time") }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("th", { children: t("runs.evidence") }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("th", { children: t("runs.issue") })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("tbody", { children: run.steps.map((step) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("tr", { "data-step": step.id, "data-state": step.state, children: [
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("td", { children: step.title }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("td", { children: step.state }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("td", { children: step.at === void 0 ? "\u2014" : formatTime(step.at, t) }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("td", { children: evidenceCell(step, session) }),
              /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("td", { children: [
                step.failureClass === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { "data-failure-class": step.failureClass, children: step.failureClass }),
                step.reason === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { className: "dsh-wf-error", children: [
                  " ",
                  step.reason
                ] }),
                step.failureClass === void 0 && step.reason === void 0 ? "\u2014" : null
              ] })
            ] }, step.id)) })
          ] })
        ] }),
        run.violations === void 0 || run.violations.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "dsh-wf-section", "data-section": "violations", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { className: "dsh-wf-heading", children: t("runs.violations") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("ul", { className: "dsh-wf-violations", children: run.violations.map((violation, index2) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("li", { "data-step": violation.stepId, children: [
            violation.stepId === void 0 ? "" : `${violation.stepId}: `,
            violation.reason
          ] }, `${String(violation.at)}:${String(index2)}`)) })
        ] })
      ] });
    }
    function MissingRunPage(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "dsh-wf-detail", "data-state": "missing", role: "status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-wf-detail-bar", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", variant: "ghost", size: "sm", onClick: props.onBack, children: props.t("runs.back") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "dsh-wf-empty-title", children: props.t("runs.missing") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "dsh-wf-muted", children: props.t("runs.missingBody") })
      ] });
    }
    function RunLookupPage(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(
        "section",
        {
          className: "dsh-wf-detail",
          "data-state": props.message === void 0 ? "loading" : "error",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "dsh-wf-detail-bar", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { type: "button", variant: "ghost", size: "sm", onClick: props.onBack, children: props.t("runs.back") }) }),
            props.message === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(LoadingLine, { t: props.t }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ErrorLine, { message: props.message, t: props.t, onRetry: props.onRetry ?? (() => {
            }) })
          ]
        }
      );
    }

    // packages/plugin-workflows/src/client/view.tsx
    var import_jsx_runtime15 = require("react/jsx-runtime");
    var VIEW_CSS = `
    .dsh-wf { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; height: 100%; min-height: 0; padding: 12px; overflow: hidden; color: var(--dsw-alias-label-primary); }
    .dsh-wf-body { display: flex; flex-direction: column; gap: 12px; min-height: 0; flex: 1; }
    .dsh-wf-status { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
    .dsh-wf-status-text { font: var(--dsw-font-s-strong-14); }
    .dsh-wf-segments { flex: none; }
    .dsh-wf-scroll { display: flex; flex-direction: column; gap: 16px; flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; }
    .dsh-wf-rows { display: flex; flex-direction: column; gap: 8px; list-style: none; margin: 0; padding: 0; min-width: 0; }
    .dsh-wf-row { min-width: 0; }
    .dsh-wf-row-button { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; box-sizing: border-box; width: 100%; min-width: 0; height: auto; min-height: 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; line-height: 1.4; white-space: normal; text-align: left; transition: background-color 120ms ease, border-color 120ms ease; }
    .dsh-wf-row-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
    .dsh-wf-run-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--dsw-font-s-strong-14); }
    .dsh-wf-run-status { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
    .dsh-wf-time { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .dsh-wf-subject { font: var(--dsw-font-xs-13); }
    .dsh-wf-summary { color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-detail { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
    .dsh-wf-detail-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .dsh-wf-detail-title { margin: 0; font: var(--dsw-font-m-18); font-weight: 600; overflow-wrap: anywhere; }
    .dsh-wf-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 16px; box-sizing: border-box; margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); font: var(--dsw-font-xs-13); }
    .dsh-wf-facts dt { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-facts dd { margin: 0; overflow-wrap: anywhere; }
    .dsh-wf-description { box-sizing: border-box; margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xs-13); }
    .dsh-wf-section { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; min-width: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
    .dsh-wf-section .dsh-wf-rows { gap: 0; }
    .dsh-wf-section .dsh-wf-rows .dsh-wf-row-button { padding: 8px 0; border: none; border-bottom: 1px solid var(--dsw-alias-border-l2); border-radius: 0; background: transparent; }
    .dsh-wf-section .dsh-wf-rows .dsh-wf-row-button:hover { background: transparent; }
    .dsh-wf-section .dsh-wf-rows .dsh-wf-row:last-child .dsh-wf-row-button { border-bottom: none; }
    .dsh-wf-heading, .dsh-wf-group-title { margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
    .dsh-wf-table { width: 100%; border-collapse: collapse; font: var(--dsw-font-xs-13); }
    .dsh-wf-table th { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
    .dsh-wf-table td { padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
    .dsh-wf-table tr:last-child td { border-bottom: none; }
    .dsh-wf-table td:first-child { font-weight: 600; }
    .dsh-wf-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
    .dsh-wf-evidence-kind { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
    .dsh-wf-empty-title { margin: 0; font: var(--dsw-font-s-strong-14); }
    .dsh-wf-error { margin: 0; color: var(--dsw-alias-state-error-primary); font: var(--dsw-font-xs-13); }
    .dsh-wf-error-block { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
    .dsh-wf-violations { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 2px; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary); }
    .dsh-wf-overview { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .dsh-wf-group { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .dsh-wf-group-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .dsh-wf-workflow-row { flex-wrap: wrap; align-items: stretch; padding: 12px; }
    .dsh-wf-card-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; width: 100%; min-width: 0; }
    .dsh-wf-card-head .dsh-wf-run-title { flex: 0 1 auto; }
    .dsh-wf-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; width: 100%; min-width: 0; }
    .dsh-wf-card-stats { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; }
    .dsh-wf-progress { display: block; width: 96px; height: 4px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); overflow: hidden; flex: none; }
    .dsh-wf-progress-fill { display: block; height: 100%; background: var(--dsw-alias-state-business-primary); }
    .dsh-wf-card-foot { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; width: 100%; min-width: 0; }
    .dsh-wf-unbound { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
    .dsh-wf-unbound-list { display: flex; flex-wrap: wrap; gap: 6px 16px; min-width: 0; }
    .dsh-wf-unbound-row { display: inline-flex; align-items: baseline; gap: 6px; min-width: 0; font: var(--dsw-font-xxs-12); }
    .dsh-wf-events { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .dsh-wf-event-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .dsh-wf-evaluations { list-style: none; margin: 2px 0 0; padding: 0 0 0 12px; display: flex; flex-direction: column; gap: 2px; }
    .dsh-wf-evaluations li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary); }
    .dsh-wf-trigger { color: var(--dsw-alias-label-primary); }
    `;
    function isStaleGeneration(requested, current) {
      return requested !== current;
    }
    function isRow(value2, attribute, id2) {
      return typeof value2 === "object" && value2 !== null && "getAttribute" in value2 && value2.getAttribute(attribute) === id2 && "focus" in value2 && typeof value2.focus === "function";
    }
    function restoreListPosition(host, id2, scrollTop, kind = "run") {
      if (host === null) return;
      host.scrollTop = scrollTop;
      const attribute = kind === "run" ? "data-run" : "data-workflow";
      const rows = host.querySelectorAll(`[${attribute}]`);
      for (let index2 = 0; index2 < rows.length; index2 += 1) {
        const row = rows[index2];
        if (!isRow(row, attribute, id2)) continue;
        row.focus({ preventScroll: true });
        return;
      }
    }
    function sortNewestFirst(runs) {
      return [...runs].sort(
        (left, right) => left.startedAt !== right.startedAt ? right.startedAt - left.startedAt : right.id.localeCompare(left.id)
      );
    }
    function dedupeRuns(runs) {
      const seen = /* @__PURE__ */ new Set();
      const unique = [];
      for (const run of runs) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        unique.push(run);
      }
      return unique;
    }
    function pageOf(body, items) {
      return { items, ...body.next === void 0 ? {} : { next: body.next } };
    }
    async function readRuns(session, pages) {
      const items = [];
      let next;
      for (let index2 = 0; index2 < Math.max(1, pages); index2 += 1) {
        const page = await requestJson(
          runsUrl(session, next, void 0, { order: "newest" })
        );
        items.push(...page.runs ?? []);
        next = page.next;
        if (next === void 0) break;
      }
      return pageOf({ ...next === void 0 ? {} : { next } }, sortNewestFirst(dedupeRuns(items)));
    }
    async function readDefinitions(session) {
      const body = await requestJson(definitionsUrl(session));
      return Array.isArray(body.definitions) ? body.definitions : [];
    }
    async function readTriggers(session) {
      const body = await requestJson(triggersUrl(session));
      return Array.isArray(body.triggers) ? body.triggers : [];
    }
    async function readRunStats(session) {
      const body = await requestJson(
        runsUrl(session, void 0, void 0, { stats: true })
      );
      const definitions = body.stats?.definitions;
      if (definitions === null || definitions === void 0 || typeof definitions !== "object") {
        return void 0;
      }
      return { definitions };
    }
    async function readLatestRuns(session, definitionIds) {
      const failed2 = [];
      const entries = await Promise.all(
        definitionIds.map(async (id2) => {
          try {
            const body = await requestJson(
              runsUrl(session, void 0, void 0, { definition: id2, order: "newest" })
            );
            const run = body.runs?.find((entry) => entry.definition?.id === id2);
            return run === void 0 ? void 0 : [id2, run];
          } catch {
            failed2.push(id2);
            return void 0;
          }
        })
      );
      return {
        latest: Object.fromEntries(
          entries.filter((entry) => entry !== void 0)
        ),
        failed: failed2
      };
    }
    async function readDefinitionDocument(session, definitionId) {
      const body = await requestJson(definitionsUrl(session, definitionId));
      if (body.definition === void 0) throw new Error("the definition document is missing");
      return {
        ...body.definition,
        ...body.source === void 0 ? {} : { source: body.source },
        ...body.plugin === void 0 ? {} : { plugin: body.plugin }
      };
    }
    async function readDefinitionRuns(session, definitionId, pages) {
      const items = [];
      let next;
      for (let index2 = 0; index2 < Math.max(1, pages); index2 += 1) {
        const page = await requestJson(
          runsUrl(session, next, void 0, { definition: definitionId })
        );
        items.push(...page.runs ?? []);
        next = page.next;
        if (next === void 0) break;
      }
      return pageOf({ ...next === void 0 ? {} : { next } }, sortNewestFirst(dedupeRuns(items)));
    }
    async function readDefinitionEvents(session, pages) {
      const items = [];
      let next;
      for (let index2 = 0; index2 < Math.max(1, pages); index2 += 1) {
        const page = await requestJson(
          eventsUrl(session, next)
        );
        items.push(...page.events ?? []);
        next = page.next;
        if (next === void 0) break;
      }
      return pageOf({ ...next === void 0 ? {} : { next } }, items);
    }
    function WorkflowsLoaded(props) {
      const { loaded, t } = props;
      const segment = props.segment ?? "workflows";
      const currentDefinition = props.definition;
      const selectedRun = props.detail ?? loaded.runs.items.find((run) => run.id === props.selected) ?? props.workflow?.runs?.items.find((run) => run.id === props.selected);
      const definitionTrigger = currentDefinition === void 0 ? void 0 : loaded.triggers.find((trigger) => trigger.id === definitionEvaluationId(currentDefinition));
      const empty2 = () => {
      };
      const options = [
        { value: "workflows", label: t("segment.workflows") },
        { value: "runs", label: t("segment.runs") }
      ];
      let body;
      if (props.selected !== void 0) {
        if (props.missing === true) {
          body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(MissingRunPage, { t, onBack: props.onBack ?? empty2 });
        } else if (props.detailError !== void 0) {
          body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            RunLookupPage,
            {
              t,
              message: props.detailError,
              onRetry: props.onRetryDetail ?? empty2,
              onBack: props.onBack ?? empty2
            }
          );
        } else if (selectedRun === void 0) {
          body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RunLookupPage, { t, onBack: props.onBack ?? empty2 });
        } else {
          body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            RunDetailPage,
            {
              run: selectedRun,
              t,
              ...props.sessionId === void 0 ? {} : { session: props.sessionId },
              onBack: props.onBack ?? empty2
            }
          );
        }
      } else if (currentDefinition !== void 0) {
        const workflow = props.workflow ?? { phase: "loading" };
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          WorkflowPage,
          {
            definitionId: currentDefinition,
            phase: workflow.phase,
            ...workflow.document === void 0 ? {} : { document: workflow.document },
            ...definitionTrigger === void 0 ? {} : { trigger: definitionTrigger },
            ...workflow.runs === void 0 ? {} : { runs: workflow.runs },
            ...workflow.events === void 0 ? {} : { events: workflow.events },
            ...workflow.message === void 0 ? {} : { message: workflow.message },
            ...props.now === void 0 ? {} : { now: props.now },
            ...props.pageStates === void 0 ? {} : { pageStates: props.pageStates },
            t,
            onBack: props.onBackWorkflow ?? empty2,
            onOpenRun: props.onOpenWorkflowRun ?? empty2,
            onLoadRuns: props.onLoadWorkflowRuns ?? empty2,
            onLoadHistory: props.onLoadHistory ?? empty2,
            onRetry: props.onRetryWorkflow ?? empty2
          }
        );
      } else if (segment === "workflows") {
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          WorkflowOverview,
          {
            definitions: loaded.definitions,
            triggers: loaded.triggers,
            ...loaded.stats === void 0 ? {} : { stats: loaded.stats },
            ...props.latestRuns === void 0 ? {} : { latestRuns: props.latestRuns },
            runs: loaded.runs.items,
            t,
            ...props.now === void 0 ? {} : { now: props.now },
            onOpen: props.onOpenWorkflow ?? empty2
          }
        );
      } else {
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            RunList,
            {
              runs: loaded.runs.items,
              t,
              ...props.now === void 0 ? {} : { now: props.now },
              ...props.onSelect === void 0 ? {} : { onOpen: props.onSelect }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
            LoadMore,
            {
              next: loaded.runs.next,
              t,
              onLoad: props.onLoadRuns ?? empty2,
              ...props.refreshing === true ? { loading: true } : {},
              ...pageLoadProps(props.pageStates, "runs", loaded.runs.next, t)
            }
          )
        ] });
      }
      const detail = props.selected !== void 0 || currentDefinition !== void 0;
      return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(
        "div",
        {
          className: "dsh-wf-body",
          "data-segment": segment,
          "data-view": props.selected !== void 0 ? "detail" : currentDefinition === void 0 ? "list" : "workflow",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
              StatusLine,
              {
                health: loaded.health,
                t,
                ...props.refreshing === void 0 ? {} : { refreshing: props.refreshing },
                ...props.onRefresh === void 0 ? {} : { onRefresh: props.onRefresh }
              }
            ),
            props.refreshError === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ErrorLine, { message: props.refreshError, t, onRetry: props.onRetryRefresh ?? empty2 }),
            detail ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "dsh-wf-scroll", ref: props.scrollRef, children: body }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
                import_dsh_client_ui_primitives13.SegmentedControl,
                {
                  id: "dsh-wf-segments",
                  value: segment,
                  options,
                  onChange: props.onSegment ?? empty2,
                  label: t("segment.label"),
                  className: "dsh-wf-segments"
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "dsh-wf-scroll", ref: props.scrollRef, children: body })
            ] })
          ]
        }
      );
    }
    function WorkflowsView(props) {
      const { sessionId, t } = props;
      const [state, setState] = (0, import_react9.useState)({ phase: "loading" });
      const [segment, setSegment] = (0, import_react9.useState)("workflows");
      const [definitionId, setDefinitionId] = (0, import_react9.useState)();
      const [workflow, setWorkflow] = (0, import_react9.useState)({ phase: "loading" });
      const [selected2, setSelected] = (0, import_react9.useState)();
      const [detail, setDetail] = (0, import_react9.useState)();
      const [missing, setMissing] = (0, import_react9.useState)(false);
      const [detailError, setDetailError] = (0, import_react9.useState)();
      const [pageStates, setPageStates] = (0, import_react9.useState)(emptyPageStates());
      const loadId = (0, import_react9.useRef)(0);
      const lookupId = (0, import_react9.useRef)(0);
      const workflowToken = (0, import_react9.useRef)(0);
      const workflowRefreshing = (0, import_react9.useRef)(0);
      const runsPages = (0, import_react9.useRef)(1);
      const workflowRunsPages = (0, import_react9.useRef)(1);
      const historyPages = (0, import_react9.useRef)(1);
      const pendingPages = (0, import_react9.useRef)(/* @__PURE__ */ new Set());
      const scrollRef = (0, import_react9.useRef)(null);
      const overviewReturn = (0, import_react9.useRef)(
        void 0
      );
      const detailReturn = (0, import_react9.useRef)(void 0);
      const selectedRef = (0, import_react9.useRef)(void 0);
      selectedRef.current = selected2;
      const definitionRef = (0, import_react9.useRef)(void 0);
      definitionRef.current = definitionId;
      const runOrigin = (0, import_react9.useRef)("runs");
      const knownRun = (0, import_react9.useRef)(void 0);
      const stateRef = (0, import_react9.useRef)(state);
      stateRef.current = state;
      const workflowRef = (0, import_react9.useRef)(workflow);
      workflowRef.current = workflow;
      const messageOf = (error) => error instanceof Error ? error.message : String(error);
      const resolveSelected = (generation, token, session, runId) => {
        setDetailError(void 0);
        const current = () => !isStaleGeneration(generation, loadId.current) && token === lookupId.current && selectedRef.current === runId;
        void requestJson(
          runsUrl(session, void 0, void 0, { run: runId })
        ).then(
          (body2) => {
            if (!current()) return;
            const run = body2.runs?.[0];
            if (run === void 0) {
              setMissing(true);
              setDetail(void 0);
              return;
            }
            setMissing(false);
            knownRun.current = run;
            setDetail(run);
          },
          (error) => {
            if (!current()) return;
            setDetailError(messageOf(error));
          }
        );
      };
      const loadWorkflowPage = (generation, token, id2, mode) => {
        if (sessionId === void 0) return;
        if (mode === "initial") setWorkflow({ phase: "loading" });
        workflowRefreshing.current = mode === "background" ? token : 0;
        const runPages = Math.max(1, workflowRunsPages.current);
        const eventPages = Math.max(1, historyPages.current);
        const current = () => !isStaleGeneration(generation, loadId.current) && token === workflowToken.current && definitionRef.current === id2;
        void Promise.all([
          readDefinitionDocument(sessionId, id2),
          readDefinitionRuns(sessionId, id2, runPages),
          readDefinitionEvents(sessionId, eventPages)
        ]).then(
          ([document2, runs, events]) => {
            if (workflowRefreshing.current === token) workflowRefreshing.current = 0;
            if (!current()) return;
            workflowRunsPages.current = runPages;
            historyPages.current = eventPages;
            setWorkflow({ phase: "ready", document: document2, runs, events });
            const openRun2 = selectedRef.current;
            if (runOrigin.current === "workflow" && openRun2 !== void 0) {
              lookupId.current += 1;
              const fresh = runs.items.find((run) => run.id === openRun2);
              if (fresh !== void 0) {
                knownRun.current = fresh;
                setDetail(fresh);
                setMissing(false);
                setDetailError(void 0);
              } else {
                const lookup = ++lookupId.current;
                resolveSelected(generation, lookup, sessionId, openRun2);
              }
            }
          },
          (error) => {
            if (workflowRefreshing.current === token) workflowRefreshing.current = 0;
            if (!current()) return;
            const message = messageOf(error);
            const loadedPage = workflowRef.current;
            if (mode === "background" && loadedPage.phase === "ready") {
              setState((currentState) => ({ ...currentState, refreshError: message }));
              return;
            }
            setWorkflow({ phase: "error", message });
          }
        );
      };
      const load = (mode) => {
        if (sessionId === void 0) return;
        const generation = ++loadId.current;
        lookupId.current += 1;
        pendingPages.current.clear();
        setPageStates(emptyPageStates());
        if (mode === "initial") setState({ phase: "loading" });
        else setState((current) => ({ ...current, refreshing: true }));
        const runPages = Math.max(1, runsPages.current);
        void Promise.all([
          requestJson(healthUrl(sessionId)),
          readRuns(sessionId, runPages),
          readDefinitions(sessionId),
          readTriggers(sessionId),
          readRunStats(sessionId)
        ]).then(
          async ([health, runs, definitions, triggers, stats]) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            const latestResult = await readLatestRuns(
              sessionId,
              definitions.map((definition) => definition.id)
            );
            if (isStaleGeneration(generation, loadId.current)) return;
            const previousLatest = stateRef.current.loaded?.latestRuns;
            const retained = {};
            if (mode === "background" && previousLatest !== void 0) {
              for (const id2 of latestResult.failed) {
                if (!Object.hasOwn(previousLatest, id2)) continue;
                const retainedRun = previousLatest[id2];
                if (retainedRun !== void 0) retained[id2] = retainedRun;
              }
            }
            const latestRuns = { ...retained, ...latestResult.latest };
            runsPages.current = runPages;
            setState({
              phase: "ready",
              loaded: {
                health,
                runs,
                definitions,
                triggers,
                latestRuns,
                ...stats === void 0 ? {} : { stats }
              },
              ...latestResult.failed.length === 0 ? {} : { refreshError: t("overview.latestUnavailable") }
            });
            const open = selectedRef.current;
            if (open !== void 0) {
              const feed = runs.items.find((run) => run.id === open);
              const workflowCopy = workflowRef.current.runs?.items.find((run) => run.id === open);
              const preferred = runOrigin.current === "workflow" ? workflowCopy ?? feed : feed ?? workflowCopy;
              if (preferred !== void 0) {
                lookupId.current += 1;
                knownRun.current = preferred;
                setDetail(preferred);
                setMissing(false);
                setDetailError(void 0);
              } else {
                const token = ++lookupId.current;
                resolveSelected(generation, token, sessionId, open);
              }
            }
            const openDefinition = definitionRef.current;
            if (openDefinition !== void 0) {
              const token = ++workflowToken.current;
              loadWorkflowPage(generation, token, openDefinition, "background");
            }
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            const message = messageOf(error);
            setState(
              (current) => current.loaded === void 0 ? { phase: "error", message } : { ...current, refreshing: false, refreshError: message }
            );
            const openDefinition = definitionRef.current;
            if (openDefinition !== void 0 && workflowRef.current.phase !== "ready") {
              const token = ++workflowToken.current;
              loadWorkflowPage(generation, token, openDefinition, "initial");
            }
            const openRun2 = selectedRef.current;
            if (openRun2 !== void 0) {
              const token = ++lookupId.current;
              resolveSelected(generation, token, sessionId, openRun2);
            }
          }
        );
      };
      const loadRef = (0, import_react9.useRef)(load);
      loadRef.current = load;
      (0, import_react9.useEffect)(() => {
        definitionRef.current = void 0;
        setDefinitionId(void 0);
        setWorkflow({ phase: "loading" });
        setSelected(void 0);
        setDetail(void 0);
        setMissing(false);
        setDetailError(void 0);
        setPageStates(emptyPageStates());
        pendingPages.current.clear();
        runsPages.current = 1;
        workflowRunsPages.current = 1;
        historyPages.current = 1;
        workflowRefreshing.current = 0;
        knownRun.current = void 0;
        load("initial");
        return () => {
          loadId.current += 1;
          workflowToken.current += 1;
        };
      }, [sessionId]);
      (0, import_react9.useEffect)(() => {
        overviewReturn.current = void 0;
        detailReturn.current = void 0;
      }, [sessionId]);
      (0, import_react9.useEffect)(() => {
        if (typeof document === "undefined") return;
        const onVisible = () => {
          if (document.visibilityState === "visible") loadRef.current("background");
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => document.removeEventListener("visibilitychange", onVisible);
      }, []);
      (0, import_react9.useLayoutEffect)(() => {
        const target = detailReturn.current;
        if (target === void 0) return;
        const onTarget = target.surface === "workflow" ? definitionId !== void 0 && selected2 === void 0 : definitionId === void 0 && selected2 === void 0;
        if (!onTarget) return;
        detailReturn.current = void 0;
        const container = scrollRef.current;
        if (container === null) return;
        restoreListPosition(
          container,
          target.id,
          target.scrollTop,
          target.surface === "overview" ? "workflow" : "run"
        );
      }, [definitionId, selected2]);
      (0, import_react9.useLayoutEffect)(() => {
        if (definitionId !== void 0 || selected2 !== void 0) return;
        const target = overviewReturn.current;
        if (target === void 0) return;
        overviewReturn.current = void 0;
        const container = scrollRef.current;
        if (container === null) return;
        restoreListPosition(container, target.id, target.scrollTop, "workflow");
      }, [definitionId, selected2]);
      if (sessionId === void 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "dsh-wf", "data-state": "no-session", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "dsh-wf-muted", children: t("state.noSession") }) });
      }
      const openWorkflowPage = (id2) => {
        const container = scrollRef.current;
        if (container !== null) {
          overviewReturn.current = { id: id2, scrollTop: container.scrollTop };
        }
        workflowRunsPages.current = 1;
        historyPages.current = 1;
        workflowRefreshing.current = 0;
        pendingPages.current.forEach((key) => {
          if (key.startsWith("workflowRuns:") || key.startsWith("history:"))
            pendingPages.current.delete(key);
        });
        setPageStates((current) => ({ ...current, workflowRuns: void 0, history: void 0 }));
        setDefinitionId(id2);
        setWorkflow({ phase: "loading" });
        setSelected(void 0);
        setDetail(void 0);
        setMissing(false);
        setDetailError(void 0);
        setSegment("workflows");
        const token = ++workflowToken.current;
        loadWorkflowPage(loadId.current, token, id2, "initial");
      };
      const backFromWorkflow = () => {
        workflowToken.current += 1;
        workflowRefreshing.current = 0;
        pendingPages.current.forEach((key) => {
          if (key.startsWith("workflowRuns:") || key.startsWith("history:"))
            pendingPages.current.delete(key);
        });
        setPageStates((current) => ({ ...current, workflowRuns: void 0, history: void 0 }));
        setDefinitionId(void 0);
        setWorkflow({ phase: "loading" });
        setSelected(void 0);
        setDetail(void 0);
        setMissing(false);
        setDetailError(void 0);
      };
      const openRun = (runId, origin) => {
        const container = scrollRef.current;
        if (container !== null) {
          detailReturn.current = { id: runId, scrollTop: container.scrollTop, surface: origin };
        }
        runOrigin.current = origin;
        setSelected(runId);
        setMissing(false);
        setDetail(void 0);
        setDetailError(void 0);
        const listed = origin === "runs" ? stateRef.current.loaded?.runs.items.find((run) => run.id === runId) : workflowRef.current.runs?.items.find((run) => run.id === runId);
        knownRun.current = listed;
        if (listed !== void 0) {
          setDetail(listed);
          return;
        }
        const token = ++lookupId.current;
        resolveSelected(loadId.current, token, sessionId, runId);
      };
      const backFromRun = () => {
        lookupId.current += 1;
        const resolved = detail ?? knownRun.current;
        const confirmedMissing = missing;
        if (resolved !== void 0 && !confirmedMissing) {
          if (runOrigin.current === "runs") {
            const current = stateRef.current;
            const loaded = current.loaded;
            if (loaded !== void 0 && !loaded.runs.items.some((run) => run.id === resolved.id)) {
              setState({
                ...current,
                loaded: {
                  ...loaded,
                  runs: {
                    ...loaded.runs,
                    items: sortNewestFirst([...loaded.runs.items, resolved])
                  }
                }
              });
            }
          } else {
            setWorkflow(
              (current) => current.runs === void 0 || current.runs.items.some((run) => run.id === resolved.id) ? current : {
                ...current,
                runs: {
                  ...current.runs,
                  items: sortNewestFirst([...current.runs.items, resolved])
                }
              }
            );
          }
        }
        knownRun.current = void 0;
        setSelected(void 0);
        setDetail(void 0);
        setMissing(false);
        setDetailError(void 0);
      };
      const retryDetail = () => {
        if (selected2 === void 0) return;
        const token = ++lookupId.current;
        resolveSelected(loadId.current, token, sessionId, selected2);
      };
      const retryWorkflow = () => {
        const id2 = definitionRef.current;
        if (id2 === void 0) return;
        const token = ++workflowToken.current;
        loadWorkflowPage(loadId.current, token, id2, "initial");
      };
      const mergeRuns = () => {
        if (stateRef.current.refreshing === true) return;
        const loaded = state.loaded;
        const next = loaded?.runs.next;
        if (next === void 0) return;
        const key = `runs:${next}`;
        if (pendingPages.current.has(key)) return;
        const generation = loadId.current;
        pendingPages.current.add(key);
        setPageStates((current) => updatePageState(current, "runs", { key, phase: "loading" }));
        void requestJson(
          runsUrl(sessionId, next, void 0, { order: "newest" })
        ).then(
          (page) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            runsPages.current += 1;
            setPageStates((current) => updatePageState(current, "runs", void 0));
            setState((current) => {
              if (current.loaded === void 0) return current;
              return {
                ...current,
                loaded: {
                  ...current.loaded,
                  runs: pageOf(
                    page,
                    sortNewestFirst(dedupeRuns([...current.loaded.runs.items, ...page.runs ?? []]))
                  )
                }
              };
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current)) return;
            pendingPages.current.delete(key);
            setPageStates(
              (current) => updatePageState(current, "runs", { key, phase: "error", message: messageOf(error) })
            );
          }
        );
      };
      const mergeWorkflowRuns = () => {
        if (stateRef.current.refreshing === true || workflowRefreshing.current !== 0) return;
        const id2 = definitionRef.current;
        const next = workflowRef.current.runs?.next;
        if (id2 === void 0 || next === void 0) return;
        const key = `workflowRuns:${next}`;
        if (pendingPages.current.has(key)) return;
        const generation = loadId.current;
        const token = workflowToken.current;
        pendingPages.current.add(key);
        setPageStates((current) => updatePageState(current, "workflowRuns", { key, phase: "loading" }));
        void requestJson(
          runsUrl(sessionId, next, void 0, { definition: id2 })
        ).then(
          (page) => {
            if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return;
            pendingPages.current.delete(key);
            workflowRunsPages.current += 1;
            setPageStates((current) => updatePageState(current, "workflowRuns", void 0));
            setWorkflow((current) => {
              if (current.runs === void 0) return current;
              return {
                ...current,
                runs: pageOf(
                  page,
                  sortNewestFirst(dedupeRuns([...current.runs.items, ...page.runs ?? []]))
                )
              };
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return;
            pendingPages.current.delete(key);
            setPageStates(
              (current) => updatePageState(current, "workflowRuns", {
                key,
                phase: "error",
                message: messageOf(error)
              })
            );
          }
        );
      };
      const mergeHistory = () => {
        if (stateRef.current.refreshing === true || workflowRefreshing.current !== 0) return;
        const id2 = definitionRef.current;
        const next = workflowRef.current.events?.next;
        if (id2 === void 0 || next === void 0) return;
        const key = `history:${next}`;
        if (pendingPages.current.has(key)) return;
        const generation = loadId.current;
        const token = workflowToken.current;
        pendingPages.current.add(key);
        setPageStates((current) => updatePageState(current, "history", { key, phase: "loading" }));
        void requestJson(eventsUrl(sessionId, next)).then(
          (page) => {
            if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return;
            pendingPages.current.delete(key);
            historyPages.current += 1;
            setPageStates((current) => updatePageState(current, "history", void 0));
            setWorkflow((current) => {
              if (current.events === void 0) return current;
              return {
                ...current,
                events: pageOf(page, [...current.events.items, ...page.events ?? []])
              };
            });
          },
          (error) => {
            if (isStaleGeneration(generation, loadId.current) || token !== workflowToken.current) return;
            pendingPages.current.delete(key);
            setPageStates(
              (current) => updatePageState(current, "history", { key, phase: "error", message: messageOf(error) })
            );
          }
        );
      };
      let body;
      if (state.phase === "loading") {
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(LoadingLine, { t });
      } else if (state.phase === "error") {
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ErrorLine, { message: state.message ?? "", t, onRetry: () => load("initial") });
      } else {
        body = /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
          WorkflowsLoaded,
          {
            loaded: state.loaded,
            t,
            sessionId,
            ...state.loaded.latestRuns === void 0 ? { latestRuns: {} } : { latestRuns: state.loaded.latestRuns },
            segment,
            ...definitionId === void 0 ? {} : { definition: definitionId },
            workflow,
            ...selected2 === void 0 ? {} : { selected: selected2 },
            ...detail === void 0 ? {} : { detail },
            ...missing ? { missing: true } : {},
            ...detailError === void 0 ? {} : { detailError },
            ...state.refreshing === true ? { refreshing: true } : {},
            ...state.refreshError === void 0 ? {} : { refreshError: state.refreshError },
            pageStates,
            scrollRef,
            onSegment: setSegment,
            onOpenWorkflow: openWorkflowPage,
            onBackWorkflow: backFromWorkflow,
            onRetryWorkflow: retryWorkflow,
            onOpenWorkflowRun: (runId) => openRun(runId, "workflow"),
            onLoadWorkflowRuns: mergeWorkflowRuns,
            onLoadHistory: mergeHistory,
            onSelect: (runId) => openRun(runId, "runs"),
            onBack: backFromRun,
            onRetryDetail: retryDetail,
            onRefresh: () => load("background"),
            onRetryRefresh: () => load("background"),
            onLoadRuns: mergeRuns
          }
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "dsh-wf", "data-state": state.phase, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("style", { children: VIEW_CSS }),
        body
      ] });
    }

    // packages/plugin-workflows/src/client/index.tsx
    var import_jsx_runtime16 = require("react/jsx-runtime");
    var ENTRY_LIMITATION = "The host exposes no command that opens a conversation view; the Workflows tab is the entry.";
    var inject = ["slots", "locale", "resources"];
    var DESIGN_ID = "@dsh-setup/plugin-workflows/design";
    var DESIGN_KIND = "workflows-design";
    var DESIGN_SERVICES = ["sidebarRight", "sidebarRightTabs", "slots", "locale", "resources"];
    var NS = "dsh-setup-workflows";
    function apply(ctx) {
      try {
        if (ctx.slots === void 0 || ctx.locale === void 0 || ctx.get?.("resources") === void 0) {
          throw new Error("the conversation, slot, locale, or resource services are unavailable");
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
              (props) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
                WorkflowsView,
                {
                  t,
                  ...props.sessionId === void 0 ? {} : { sessionId: props.sessionId }
                }
              )
            )
          )
        );
        if (typeof ctx.inject !== "function") return;
        ctx.inject(DESIGN_SERVICES, (designCtx) => {
          registerDesignPage(designCtx);
        });
      } catch (error) {
        console.error(
          `workflows: Client registration failed (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }
    function registerDesignPage(ctx) {
      try {
        const tabs = ctx.get?.("sidebarRightTabs");
        const sidebarRight = ctx.get?.("sidebarRight");
        const slots = ctx.get?.("slots");
        const locale = ctx.get?.("locale");
        if (tabs === void 0 || sidebarRight === void 0 || slots === void 0 || locale === void 0) {
          return;
        }
        const t = locale.bind(NS);
        ctx.effect(
          () => tabs.register({
            id: DESIGN_ID,
            kind: DESIGN_KIND,
            priority: "extension",
            // Hiding a tab bypasses close handlers; keep the editor's draft mounted.
            keepMounted: true,
            title: () => t("design.pageTitle"),
            guide: [
              {
                id: "design",
                commandId: "workflows.design",
                order: 10,
                title: () => t("design.guideTitle"),
                description: () => t("design.guideDescription")
              }
            ]
          })
        );
        ctx.effect(
          () => slots.inject(
            "sidebar.right.pane.tab",
            () => slots.register(
              { name: "sidebar.right.pane.tab", key: DESIGN_ID, locale: NS },
              (props) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(DesignPage, { ...props })
            )
          )
        );
        ctx.effect(
          () => sidebarRight.registerCloseHandler(DESIGN_KIND, (sessionId, tab) => {
            closeDesignOnTabClose(t, designTabKey(sessionId, tab.id));
          })
        );
      } catch (error) {
        console.error(
          `workflows: the design page could not be registered (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }
    /*! Bundled license information:

    use-sync-external-store/cjs/use-sync-external-store-shim.development.js:
      (**
       * @license React
       * use-sync-external-store-shim.development.js
       *
       * Copyright (c) Meta Platforms, Inc. and affiliates.
       *
       * This source code is licensed under the MIT license found in the
       * LICENSE file in the root directory of this source tree.
       *)

    use-sync-external-store/cjs/use-sync-external-store-shim/with-selector.development.js:
      (**
       * @license React
       * use-sync-external-store-shim/with-selector.development.js
       *
       * Copyright (c) Meta Platforms, Inc. and affiliates.
       *
       * This source code is licensed under the MIT license found in the
       * LICENSE file in the root directory of this source tree.
       *)
    */
    return module.exports;
  },
});
