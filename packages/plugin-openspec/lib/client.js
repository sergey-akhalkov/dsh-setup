window.__ModuleLoader__.load({
  id: "@dsh-setup/plugin-openspec",
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

    // packages/plugin-openspec/src/client/index.tsx
    var index_exports = {};
    __export(index_exports, {
      CHANGES_PATH: () => CHANGES_PATH,
      CapabilityBody: () => CapabilityBody,
      CapabilityView: () => CapabilityView,
      ChangeBody: () => ChangeBody,
      ChangeListObservation: () => ChangeListObservation,
      ChangeView: () => ChangeView,
      FileWatch: () => FileWatch,
      InlineText: () => InlineText,
      OpenSpecTab: () => OpenSpecTab,
      PANEL_CSS: () => PANEL_CSS,
      ProgressBar: () => ProgressBar,
      RequirementList: () => RequirementList,
      RootBody: () => RootBody,
      RootView: () => RootView,
      TaskChecklist: () => TaskChecklist,
      apply: () => apply,
      createHandoff: () => createHandoff,
      inject: () => inject,
      registerPanel: () => registerPanel,
      scenarioSteps: () => scenarioSteps
    });
    module.exports = __toCommonJS(index_exports);
    var primitives2 = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
    var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var import_react = require("react");

    // packages/plugin-openspec/src/client/panel.ts
    var primitives = __toESM(require("@deepseek-ai/dsh-client-ui-primitives"), 1);
    var CHANGES_PATH = "api/plugins/dsh-setup-openspec/changes";
    var CHANGE_PATH = "api/plugins/dsh-setup-openspec/change";
    var LIVE_REVIEWS_PATH = "api/workflows/reviews/live";
    var SPECS_PATH = "api/plugins/dsh-setup-openspec/specs";
    var ARCHIVE_PATH = "api/plugins/dsh-setup-openspec/archive";
    var OPENSPEC_ID = "@dsh-setup/plugin-openspec/panel";
    var OPENSPEC_KIND = "openspec";
    var ROOT_ADDRESS = "sidebar://openspec";
    var SPECS_ADDRESS = "dsh-resource://openspec/specs";
    var EXPLORE_DRAFT = "/openspec-explore ";
    var PROPOSE_DRAFT = "/openspec-propose ";
    function applyDraft(name) {
      return `/openspec-apply-change ${name}`;
    }
    var CHANGE_SEGMENT = "dsh-resource://openspec/change/";
    var ARCHIVED_CHANGE_SEGMENT = "dsh-resource://openspec/archive-change/";
    var CAPABILITY_SEGMENT = "dsh-resource://openspec/spec/";
    function changeAddress(name, artifact) {
      return `${CHANGE_SEGMENT}${encodeURIComponent(name)}${artifact === void 0 ? "" : `/${artifact}`}`;
    }
    function archivedChangeAddress(name, artifact) {
      return `${ARCHIVED_CHANGE_SEGMENT}${encodeURIComponent(name)}${artifact === void 0 ? "" : `/${artifact}`}`;
    }
    function isArtifactKind(value) {
      return ARTIFACT_KINDS.includes(value);
    }
    function changeSegment(address, prefix) {
      if (!address.startsWith(prefix)) return void 0;
      const rest = address.slice(prefix.length);
      if (rest === "" || rest.includes("?") || rest.includes("#")) return void 0;
      const parts = rest.split("/");
      if (parts.length > 2) return void 0;
      let name;
      try {
        name = decodeURIComponent(parts[0] ?? "");
      } catch {
        return void 0;
      }
      if (name === "") return void 0;
      const encodedArtifact = parts[1];
      if (encodedArtifact === void 0) return { name };
      let artifact;
      try {
        artifact = decodeURIComponent(encodedArtifact);
      } catch {
        return void 0;
      }
      if (!isArtifactKind(artifact)) return void 0;
      return { name, artifact };
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
      const archived = changeSegment(address, ARCHIVED_CHANGE_SEGMENT);
      if (archived !== void 0) {
        return {
          view: "change",
          name: archived.name,
          archived: true,
          ...archived.artifact === void 0 ? {} : { artifact: archived.artifact }
        };
      }
      const change = changeSegment(address, CHANGE_SEGMENT);
      if (change !== void 0) return { view: "change", ...change };
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
    function changeListWatchAddresses(sessionId, rows) {
      return rows.filter((row) => row.archived !== true).flatMap(
        (row) => changeWatchPaths(row.name, row.deltaCapabilities ?? []).map(
          (path) => fileAddress(sessionId, path)
        )
      );
    }
    function derivePhase(row) {
      if (row.archived === true) return "archived";
      if (row.status === "no-tasks") return "planning";
      if (row.status === "complete") return "complete";
      const total = row.totalTasks ?? 0;
      if (total <= 0) return "planning";
      const done = Math.min(Math.max(row.completedTasks ?? 0, 0), total);
      if (done >= total) return "complete";
      if (done === 0) return "ready-to-apply";
      return "applying";
    }
    function phaseOf(row) {
      return row.phase ?? derivePhase(row);
    }
    function isComplete(change) {
      if (change.totalTasks > 0) return change.completedTasks >= change.totalTasks;
      return change.phase === "complete";
    }
    function phaseTone(phase) {
      if (phase === "planning") return "warning";
      if (phase === "complete") return "success";
      if (phase === "archived") return "quiet";
      return "info";
    }
    function relativeLabel(modified, now = /* @__PURE__ */ new Date()) {
      if (modified === null || modified === void 0) return null;
      const at = new Date(modified).getTime();
      if (Number.isNaN(at)) return null;
      const { unit, n } = primitives.relativeTime(at, now.getTime());
      if (unit === "now") return "just now";
      const suffix = {
        minutes: "m",
        hours: "h",
        days: "d",
        months: "mo",
        years: "y"
      };
      return `${String(n)}${suffix[unit]} ago`;
    }
    function reviewIdentity(entry) {
      return `${entry.runId}\0${entry.change}\0${entry.definition}\0${entry.unit}`;
    }
    function settledReviews(previous, next) {
      const current = new Set(next.map((entry) => reviewIdentity(entry)));
      return previous.filter((entry) => !current.has(reviewIdentity(entry)));
    }
    function decodeLiveReviewEntries(body) {
      if (!isRecord(body) || !Array.isArray(body.live)) return void 0;
      const entries = [];
      for (const value of body.live) {
        if (!isRecord(value)) return void 0;
        const session = value.session;
        const runId = value.runId;
        const change = value.change;
        const definition = value.definition;
        const unit = value.unit;
        const state = value.state;
        const attempt = value.attempt;
        const since = value.since;
        if (typeof session !== "string" || session === "" || typeof runId !== "string" || runId === "" || typeof change !== "string" || change === "" || typeof definition !== "string" || definition === "" || unit !== "spec" && unit !== "tasks" && unit !== "integration" || state !== "starting" && state !== "live" && state !== "waiting" || typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 1 || typeof since !== "string" || since === "") {
          return void 0;
        }
        const label = summaryText(value.label);
        entries.push({
          session,
          runId,
          change,
          definition,
          unit,
          ...label === null ? {} : { label },
          state,
          attempt,
          since
        });
      }
      return entries;
    }
    function reviewSpecUnit(spec, t, now) {
      if (spec === null) {
        return {
          label: t("review.specMissing"),
          dot: "warning",
          tooltip: t("review.missingSpecTooltip")
        };
      }
      if (spec.verdict === "PASS" && spec.current) {
        const relative = relativeLabel(spec.at, now);
        const reviewer = spec.model === void 0 ? spec.reviewer : `${spec.reviewer} (${spec.model})`;
        return {
          label: t("review.specPass"),
          dot: "done",
          tooltip: `${t("review.passTooltip")} ${reviewer}${relative === null ? "" : ` \xB7 ${relative}`}`
        };
      }
      if (!spec.current) {
        return { label: t("review.specOutdated"), dot: "warning", tooltip: t("review.staleTooltip") };
      }
      if (spec.verdict === "FINDINGS") {
        return {
          label: `${t("review.specFindings")}: ${String(spec.findings)} ${t("review.findings")}`,
          dot: "error"
        };
      }
      return { label: t("review.specError"), dot: "error" };
    }
    function reviewLiveUnit(entry, t, now) {
      if (entry.state === "waiting") {
        return {
          label: t("review.waiting"),
          dot: "ongoing",
          tooltip: t("review.waitTooltip")
        };
      }
      const relative = relativeLabel(entry.since, now);
      const tooltip = `${entry.definition} - ${t("review.liveTooltip")}${relative === null ? "" : ` ${relative}`}`;
      if (entry.unit === "tasks") {
        return {
          label: `${t("review.tasksUnit")}${entry.label === void 0 ? "" : ` \xB7 ${entry.label}`}`,
          dot: "ongoing",
          tooltip,
          spinning: true
        };
      }
      if (entry.unit === "integration") {
        return {
          label: `${t("review.integrationUnit")} ${String(entry.attempt)}`,
          dot: "ongoing",
          tooltip,
          spinning: true
        };
      }
      return {
        label: `${t("review.running")} ${String(entry.attempt)}`,
        dot: "ongoing",
        tooltip,
        spinning: true
      };
    }
    function changeProgress(row) {
      const total = row.totalTasks;
      const tasks = row.review?.tasks;
      if (total <= 0 || tasks === null || tasks === void 0) return null;
      const implemented = Math.min(Math.max(row.completedTasks, 0), total);
      const reviewed = Math.min(Math.max(tasks.passed, 0), total);
      const complete = implemented === total && reviewed === total;
      const partial = Math.min(99, Math.round((implemented + reviewed) / (total * 2) * 100));
      return {
        percent: complete ? 100 : partial,
        implemented,
        reviewed,
        total,
        missing: tasks.missing
      };
    }
    function reviewUnits(review, live, t, now = /* @__PURE__ */ new Date()) {
      const liveOf = (unit) => live?.find((entry) => entry.unit === unit);
      const units = [];
      const specLive = liveOf("spec");
      if (specLive !== void 0) units.push(reviewLiveUnit(specLive, t, now));
      else if (review !== void 0) units.push(reviewSpecUnit(review.spec, t, now));
      const tasksLive = liveOf("tasks");
      if (tasksLive !== void 0) units.push(reviewLiveUnit(tasksLive, t, now));
      const integrationLive = liveOf("integration");
      if (integrationLive !== void 0) units.push(reviewLiveUnit(integrationLive, t, now));
      return units;
    }
    function isoDate(value) {
      if (value === null || value === void 0) return null;
      const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value);
      if (direct?.[1] !== void 0) return direct[1];
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
    }
    function two(value) {
      return String(value).padStart(2, "0");
    }
    function summaryText(value) {
      return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
    }
    function matchesQuery(query, ...values) {
      const needle = query.trim().toLowerCase();
      if (needle === "") return true;
      return values.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
    }
    function sortChanges(rows) {
      return [...rows].sort(
        (left, right) => Number(left.status === "complete") - Number(right.status === "complete")
      );
    }
    function sortArchived(rows) {
      return [...rows].sort(
        (left, right) => (right.archivedAt ?? "").localeCompare(left.archivedAt ?? "")
      );
    }
    function sortHistory(entries) {
      return [...entries].sort((left, right) => right.date.localeCompare(left.date));
    }
    var TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d{1,9}[.)])\s*\[(?:\s*([^\]\s]?)\s*\](?![([])|\s+\])\s*(.*)/;
    function parseTaskLines(content) {
      const tasks = [];
      for (const line of content.split(/\r?\n/)) {
        const match = TASK_LINE_PATTERN.exec(line);
        if (match === null) continue;
        tasks.push({
          done: (match[1] ?? "").toLowerCase() === "x",
          description: (match[2] ?? "").trim()
        });
      }
      return tasks;
    }
    function parseTaskGroups(content) {
      const groups = [];
      let current;
      const open = (title) => {
        const group = { title, tasks: [] };
        groups.push(group);
        return group;
      };
      for (const line of content.split(/\r?\n/)) {
        const heading = /^##\s+(.+)$/.exec(line);
        if (heading !== null) {
          current = open((heading[1] ?? "").trim());
          continue;
        }
        const match = TASK_LINE_PATTERN.exec(line);
        if (match === null) continue;
        if (current === void 0) current = open("");
        current.tasks.push({
          done: (match[1] ?? "").toLowerCase() === "x",
          description: (match[2] ?? "").trim()
        });
      }
      return groups;
    }
    var ROOT_SEGMENTS = ["changes", "specs", "archive"];
    function segmentStorageKey(sessionId) {
      return `dsh-setup-openspec-panel.root-segment.${sessionId}`;
    }
    function isRootSegment(value) {
      return value === "changes" || value === "specs" || value === "archive";
    }
    function readSegment(storage, sessionId) {
      if (storage === void 0) return void 0;
      try {
        const value = storage.getItem(segmentStorageKey(sessionId));
        return isRootSegment(value) ? value : void 0;
      } catch {
        return void 0;
      }
    }
    function writeSegment(storage, sessionId, segment) {
      if (storage === void 0) return;
      try {
        storage.setItem(segmentStorageKey(sessionId), segment);
      } catch {
      }
    }
    function initialRootSegment(explicit, stored) {
      return explicit === "specs" ? "specs" : stored ?? "changes";
    }
    function defaultSegmentStorage() {
      try {
        return typeof globalThis.sessionStorage === "undefined" ? void 0 : globalThis.sessionStorage;
      } catch {
        return void 0;
      }
    }
    var ARTIFACT_KINDS = ["proposal", "design", "specs", "tasks"];
    function hasArtifact(change, kind) {
      if (kind === "specs") return (change.deltas?.length ?? 0) > 0 || change.specs.length > 0;
      if (kind === "tasks")
        return change.artifacts.tasks !== null || (change.taskFiles?.length ?? 0) > 0;
      return change.artifacts[kind] !== null;
    }
    function deltaCapabilities(deltas) {
      return [...new Set(deltas.map((delta) => delta.capability))];
    }
    function initialArtifact(change) {
      return ARTIFACT_KINDS.find((kind) => hasArtifact(change, kind)) ?? "proposal";
    }
    var LOADING = { phase: "loading" };
    function isRecord(value) {
      return typeof value === "object" && value !== null && !Array.isArray(value);
    }
    function integer(value) {
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : void 0;
    }
    function stringOrNull(value) {
      return typeof value === "string" ? value : null;
    }
    function decodePresence(value) {
      if (!isRecord(value)) return { proposal: false, design: false, tasks: false, specs: 0 };
      return {
        proposal: value.proposal === true,
        design: value.design === true,
        tasks: value.tasks === true,
        specs: integer(value.specs) ?? 0
      };
    }
    var COMMIT_PAGE = /^https?:\/\/[^\s"'<>]+$/;
    function decodeCommit(value) {
      if (!isRecord(value) || typeof value.short !== "string" || value.short.trim() === "") return null;
      const url = typeof value.url === "string" && COMMIT_PAGE.test(value.url) ? value.url : void 0;
      return {
        short: value.short,
        at: typeof value.at === "string" ? value.at : "",
        subject: typeof value.subject === "string" ? value.subject : "",
        ...url === void 0 ? {} : { url }
      };
    }
    function decodePhase(value) {
      return value === "planning" || value === "ready-to-apply" || value === "applying" || value === "complete" || value === "archived" ? value : void 0;
    }
    var REVIEW_VERDICTS = /* @__PURE__ */ new Set(["PASS", "FINDINGS", "ERROR"]);
    function decodeReviewSpec(value) {
      if (!isRecord(value)) return null;
      if (typeof value.verdict !== "string" || !REVIEW_VERDICTS.has(value.verdict)) return null;
      if (typeof value.reviewer !== "string" || value.reviewer === "") return null;
      const findings = integer(value.findings);
      if (findings === void 0) return null;
      return {
        verdict: value.verdict,
        current: value.current === true,
        at: typeof value.at === "string" ? value.at : "",
        findings,
        reviewer: value.reviewer,
        ...typeof value.model === "string" && value.model !== "" ? { model: value.model } : {}
      };
    }
    function decodeReviewTasks(value) {
      if (!isRecord(value)) return null;
      const checked = integer(value.checked);
      const passed = integer(value.passed);
      if (checked === void 0 || passed === void 0) return null;
      const missing = Array.isArray(value.missing) ? value.missing.filter((entry) => typeof entry === "string") : [];
      return {
        checked,
        passed,
        missing,
        ...typeof value.at === "string" ? { at: value.at } : {}
      };
    }
    function decodeReview(value) {
      if (!isRecord(value)) return void 0;
      const rawSpec = value.spec;
      const rawTasks = value.tasks;
      const spec = rawSpec === null || rawSpec === void 0 ? null : decodeReviewSpec(rawSpec);
      if (rawSpec !== null && rawSpec !== void 0 && spec === null) return void 0;
      const tasks = rawTasks === null || rawTasks === void 0 ? null : decodeReviewTasks(rawTasks);
      if (rawTasks !== null && rawTasks !== void 0 && tasks === null) return void 0;
      return { spec, tasks };
    }
    function decodeDeltaCapabilities(value) {
      if (value === void 0) return void 0;
      if (!Array.isArray(value)) return [];
      return value.filter((entry) => typeof entry === "string" && entry.trim() !== "");
    }
    function decodeChangeRow(value) {
      if (!isRecord(value) || typeof value.name !== "string" || value.name.trim() === "")
        return void 0;
      const completedTasks = integer(value.completedTasks) ?? 0;
      const totalTasks = integer(value.totalTasks) ?? 0;
      const phase = decodePhase(value.phase);
      const deltaCapabilities2 = decodeDeltaCapabilities(value.deltaCapabilities);
      const review = value.review === void 0 ? void 0 : decodeReview(value.review);
      return {
        name: value.name,
        completedTasks,
        totalTasks,
        status: typeof value.status === "string" ? value.status : "no-tasks",
        presence: decodePresence(value.presence),
        ...phase === void 0 ? {} : { phase },
        ...typeof value.archived === "boolean" ? { archived: value.archived } : {},
        ...value.archivedAt === void 0 ? {} : { archivedAt: stringOrNull(value.archivedAt) },
        ...value.summary === void 0 ? {} : { summary: summaryText(value.summary) },
        ...value.why === void 0 ? {} : { why: summaryText(value.why) },
        ...value.requirementCount === void 0 ? {} : { requirementCount: integer(value.requirementCount) ?? 0 },
        ...deltaCapabilities2 === void 0 ? {} : { deltaCapabilities: deltaCapabilities2 },
        ...value.modified === void 0 ? {} : { modified: stringOrNull(value.modified) },
        ...value.commit === void 0 ? {} : { commit: decodeCommit(value.commit) },
        ...review === void 0 ? {} : { review }
      };
    }
    function decodeChangeRows(value) {
      if (!Array.isArray(value)) return void 0;
      const rows = [];
      for (const entry of value) {
        const row = decodeChangeRow(entry);
        if (row === void 0) return void 0;
        rows.push(row);
      }
      return rows;
    }
    function decodeCounts(value, changes, archived) {
      const record = isRecord(value) ? value : void 0;
      return {
        active: integer(record?.active) ?? changes.length,
        archived: integer(record?.archived) ?? archived.length,
        capabilities: integer(record?.capabilities) ?? 0
      };
    }
    function decodeChangeList(body) {
      const changes = decodeChangeRows(body.changes);
      if (changes === void 0) return void 0;
      const archived = body.archived === void 0 ? [] : decodeChangeRows(body.archived);
      if (archived === void 0) return void 0;
      return {
        changes,
        archived,
        counts: decodeCounts(body.counts, changes, archived),
        ...body.reviewAvailable === true ? { reviewAvailable: true } : {}
      };
    }
    function decodeRequirementScenario(value) {
      if (!isRecord(value) || typeof value.name !== "string") return void 0;
      return { name: value.name, rawText: typeof value.rawText === "string" ? value.rawText : "" };
    }
    function decodeRequirement(value) {
      if (!isRecord(value) || typeof value.name !== "string") return void 0;
      const scenarios = [];
      if (Array.isArray(value.scenarios)) {
        for (const entry of value.scenarios) {
          const scenario = decodeRequirementScenario(entry);
          if (scenario !== void 0) scenarios.push(scenario);
        }
      }
      return { name: value.name, text: typeof value.text === "string" ? value.text : "", scenarios };
    }
    function decodeRequirements(value) {
      if (value === void 0) return [];
      if (!Array.isArray(value)) return void 0;
      const requirements = [];
      for (const entry of value) {
        const requirement = decodeRequirement(entry);
        if (requirement === void 0) return void 0;
        requirements.push(requirement);
      }
      return requirements;
    }
    function decodeOperation(value) {
      return value === "ADDED" || value === "MODIFIED" || value === "REMOVED" || value === "RENAMED" ? value : void 0;
    }
    function decodeRename(value) {
      if (!isRecord(value) || typeof value.from !== "string" || typeof value.to !== "string")
        return void 0;
      return { from: value.from, to: value.to };
    }
    function decodeDelta(value) {
      if (!isRecord(value) || typeof value.capability !== "string") return void 0;
      const operation = decodeOperation(value.operation);
      if (operation === void 0) return void 0;
      const requirements = decodeRequirements(value.requirements);
      if (requirements === void 0) return void 0;
      const rename = decodeRename(value.rename);
      return {
        capability: value.capability,
        operation,
        requirements,
        ...rename === void 0 ? {} : { rename }
      };
    }
    function decodeDeltas(value) {
      if (value === void 0) return [];
      if (!Array.isArray(value)) return void 0;
      const deltas = [];
      for (const entry of value) {
        const delta = decodeDelta(entry);
        if (delta === void 0) return void 0;
        deltas.push(delta);
      }
      return deltas;
    }
    function decodeDeltaSpecs(value) {
      if (value === void 0) return [];
      if (!Array.isArray(value)) return void 0;
      const specs = [];
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.capability !== "string") return void 0;
        specs.push({
          capability: entry.capability,
          body: typeof entry.body === "string" ? entry.body : "",
          modified: typeof entry.modified === "string" ? entry.modified : ""
        });
      }
      return specs;
    }
    function decodeArtifacts(value) {
      if (!isRecord(value)) return void 0;
      const field = (key) => {
        const raw = value[key];
        if (raw === void 0 || raw === null) return null;
        return typeof raw === "string" ? raw : void 0;
      };
      const proposal = field("proposal");
      const design = field("design");
      const tasks = field("tasks");
      if (proposal === void 0 || design === void 0 || tasks === void 0) return void 0;
      return { proposal, design, tasks };
    }
    function decodeTaskFiles(value) {
      if (value === void 0) return [];
      if (!Array.isArray(value)) return void 0;
      const files = [];
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.body !== "string")
          return void 0;
        files.push({ path: entry.path, body: entry.body });
      }
      return files;
    }
    function decodeChangeDetail(value) {
      if (!isRecord(value) || typeof value.name !== "string") return void 0;
      const artifacts = decodeArtifacts(value.artifacts);
      const specs = decodeDeltaSpecs(value.specs);
      const deltas = decodeDeltas(value.deltas);
      const taskFiles = decodeTaskFiles(value.taskFiles);
      if (artifacts === void 0 || specs === void 0 || deltas === void 0 || taskFiles === void 0)
        return void 0;
      const phase = decodePhase(value.phase);
      return {
        name: value.name,
        status: typeof value.status === "string" ? value.status : "no-tasks",
        completedTasks: integer(value.completedTasks) ?? 0,
        totalTasks: integer(value.totalTasks) ?? 0,
        artifacts,
        specs,
        modified: stringOrNull(value.modified),
        deltas,
        ...taskFiles.length === 0 ? {} : { taskFiles },
        ...value.presence === void 0 ? {} : { presence: decodePresence(value.presence) },
        ...phase === void 0 ? {} : { phase },
        ...typeof value.archived === "boolean" ? { archived: value.archived } : {},
        ...value.archivedAt === void 0 ? {} : { archivedAt: stringOrNull(value.archivedAt) },
        ...value.summary === void 0 ? {} : { summary: summaryText(value.summary) },
        ...value.commit === void 0 ? {} : { commit: decodeCommit(value.commit) }
      };
    }
    function decodeHistoryEntry(value) {
      if (!isRecord(value) || typeof value.name !== "string" || typeof value.date !== "string")
        return void 0;
      return {
        name: value.name,
        date: value.date,
        completedTasks: integer(value.completedTasks) ?? 0,
        totalTasks: integer(value.totalTasks) ?? 0,
        commit: decodeCommit(value.commit)
      };
    }
    function decodeHistory(value) {
      if (value === void 0) return [];
      if (!Array.isArray(value)) return void 0;
      const history = [];
      for (const entry of value) {
        const decoded = decodeHistoryEntry(entry);
        if (decoded === void 0) return void 0;
        history.push(decoded);
      }
      return history;
    }
    function decodeCapabilityRows(value) {
      if (!Array.isArray(value)) return void 0;
      const rows = [];
      for (const entry of value) {
        if (!isRecord(entry) || typeof entry.id !== "string") return void 0;
        const lastChange = decodeHistoryEntry(entry.lastChange);
        rows.push({
          id: entry.id,
          requirementCount: integer(entry.requirementCount) ?? 0,
          ...entry.purpose === void 0 ? {} : { purpose: summaryText(entry.purpose) ?? void 0 },
          ...entry.modified === void 0 ? {} : { modified: stringOrNull(entry.modified) },
          ...entry.lastChange === void 0 || entry.lastChange === null ? {} : { lastChange },
          ...entry.commit === void 0 ? {} : { commit: decodeCommit(entry.commit) }
        });
      }
      return rows;
    }
    function decodeCapabilityDetail(value) {
      if (!isRecord(value) || typeof value.id !== "string") return void 0;
      const requirements = decodeRequirements(value.requirements);
      const history = decodeHistory(value.history);
      if (requirements === void 0 || history === void 0) return void 0;
      const capability = {
        id: value.id,
        requirementCount: integer(value.requirementCount) ?? 0,
        body: typeof value.body === "string" ? value.body : "",
        modified: typeof value.modified === "string" ? value.modified : "",
        requirements,
        history
      };
      return {
        ...capability,
        ...value.purpose === void 0 ? {} : { purpose: summaryText(value.purpose) ?? void 0 },
        ...value.commit === void 0 ? {} : { commit: decodeCommit(value.commit) }
      };
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
    async function requestChangeList(sessionId) {
      return request(
        `${CHANGES_PATH}?session=${encodeURIComponent(sessionId)}`,
        "The OpenSpec change list request failed",
        "The OpenSpec change list response was not understood.",
        decodeChangeList
      );
    }
    async function requestChange(sessionId, name, archived = false) {
      return request(
        `${CHANGE_PATH}?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}${archived ? "&archived=1" : ""}`,
        "The OpenSpec change request failed",
        "The OpenSpec change response was not understood.",
        (body) => decodeChangeDetail(body.change)
      );
    }
    async function requestCapabilities(sessionId) {
      return request(
        `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}`,
        "The OpenSpec capability list request failed",
        "The OpenSpec capability list response was not understood.",
        (body) => decodeCapabilityRows(body.capabilities)
      );
    }
    async function requestCapability(sessionId, id) {
      return request(
        `${SPECS_PATH}?session=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}`,
        "The OpenSpec capability request failed",
        "The OpenSpec capability response was not understood.",
        (body) => decodeCapabilityDetail(body.capability)
      );
    }
    async function requestLiveReviews(sessionId) {
      const response = await fetch(`${LIVE_REVIEWS_PATH}?session=${encodeURIComponent(sessionId)}`, {
        headers: { accept: "application/json" },
        credentials: "same-origin"
      });
      if (response.status === 404) return void 0;
      if (!response.ok) {
        throw new Error(`The live review request failed (${String(response.status)}).`);
      }
      const body = await response.json();
      const entries = decodeLiveReviewEntries(body);
      if (entries === void 0) throw new Error("The live review response was not understood.");
      return entries;
    }
    async function requestArchive(sessionId, name) {
      const response = await fetch(ARCHIVE_PATH, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ session: sessionId, name })
      });
      const body = await response.json().catch(() => void 0);
      if (!response.ok) {
        const error = isRecord(body) && typeof body.error === "string" ? body.error : void 0;
        throw new Error(error ?? `The OpenSpec archive request failed (${String(response.status)}).`);
      }
      if (!isRecord(body) || body.ok !== true) {
        throw new Error("The OpenSpec archive response was not understood.");
      }
      if (body.name === void 0) return void 0;
      if (typeof body.name !== "string" || body.name === "") {
        throw new Error("The OpenSpec archive response was not understood.");
      }
      return body.name;
    }

    // packages/plugin-openspec/src/client/index.tsx
    var import_jsx_runtime = require("react/jsx-runtime");
    var inject = ["commandUi", "sessions", "conversation"];
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
            options: async (session) => optionsOf((await requestChangeList(session.sessionId)).changes),
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
      "guide.description": "Browse OpenSpec changes, archive, and capability specs",
      "segment.label": "OpenSpec view",
      "segment.changes": "Changes",
      "segment.specs": "Specs",
      "segment.archive": "Archive",
      "root.explore": "Explore",
      "root.propose": "Propose",
      "root.exploreBody": "Outline a change before proposing it.",
      "root.proposeBody": "Write a new change proposal.",
      "actions.seeArchive": "See all archive",
      "group.inProgress": "In progress",
      "group.complete": "Complete",
      "group.recentlyArchived": "Recently archived",
      "state.loading": "Loading\u2026",
      "state.refreshing": "Updating\u2026",
      "state.retry": "Retry",
      "specs.emptyTitle": "No accepted specs yet",
      "specs.emptyBody": "Archive a completed change to add one.",
      "specs.archive": "Open archive",
      "specs.filterLabel": "Filter capabilities",
      "specs.filterPlaceholder": "Search capabilities\u2026",
      "specs.noMatch": "No capabilities match this filter.",
      "specs.orderNewest": "Newest first",
      "specs.orderOldest": "Oldest first",
      "specs.req": "req",
      "specs.acceptedVia": "Accepted via",
      "archive.emptyTitle": "Nothing archived yet",
      "archive.emptyBody": "Complete a change and archive it to keep its history here.",
      "archive.filterLabel": "Filter archived changes",
      "archive.filterPlaceholder": "Search archive\u2026",
      "archive.noMatch": "No archived changes match this filter.",
      "presence.proposal": "proposal",
      "presence.design": "design",
      "presence.spec": "spec",
      "presence.specs": "specs",
      "presence.tasks": "tasks",
      "phase.planning": "planning",
      "phase.ready-to-apply": "ready to apply",
      "phase.applying": "applying",
      "phase.complete": "complete",
      "phase.archived": "archived",
      "change.apply": "Apply change",
      "change.applyShort": "Apply",
      "change.archive": "Archive",
      "change.archiving": "Archiving\u2026",
      "change.archiveRefused": "Archive refused",
      "change.applyComplete": "the change is complete",
      "change.archiveIncomplete": "every task must be complete before archiving",
      "change.tasks": "tasks",
      "change.implemented": "implemented",
      "change.reviewed": "reviewed",
      "change.artifactLabel": "Change artifacts",
      "change.deltas": "delta specs",
      "change.updated": "updated",
      "change.tasksNotWritten": "tasks not written yet",
      "change.unparsedTasks": "tasks not parsed from the file.",
      "artifact.proposal": "Why",
      "artifact.design": "Design",
      "artifact.specs": "Specs",
      "artifact.tasks": "Tasks",
      "artifact.notWritten": "Not written yet.",
      "capability.requirements": "requirements",
      "capability.scenarios": "scenarios",
      "capability.accepted": "Accepted",
      "capability.via": "via",
      "capability.openAccepted": "Open accepted spec",
      "capability.sections": "Capability sections",
      "capability.requirementsTab": "Requirements",
      "capability.historyTab": "History",
      "capability.historyEmpty": "No archived change produced this capability.",
      "requirements.filterLabel": "Filter requirements",
      "requirements.filterPlaceholder": "Search requirements\u2026",
      "requirements.noMatch": "No requirements match this filter.",
      "delta.from": "from",
      "delta.to": "to",
      "scenario.label": "Scenario:",
      "scenario.when": "WHEN",
      "scenario.then": "THEN",
      "scenario.and": "AND",
      "scenario.but": "BUT",
      "markdown.copy": "Copy",
      "markdown.copied": "Copied",
      "markdown.footnotes": "Footnotes",
      "review.specPass": "AI spec review passed",
      "review.specOutdated": "AI spec review outdated",
      "review.specFindings": "AI spec review",
      "review.findings": "findings",
      "review.specError": "AI spec review failed",
      "review.specMissing": "AI spec review not run",
      "review.running": "AI spec review running \xB7",
      "review.tasksUnit": "AI task review",
      "review.integrationUnit": "AI code review \xB7",
      "review.waiting": "Waiting for the AI reviewer",
      "review.passTooltip": "AI spec review of the plan \xB7",
      "review.staleTooltip": "The PASS is stale: the change artifacts changed after it",
      "review.missingTooltip": "No AI review yet for tasks",
      "review.missingSpecTooltip": "Starts when the turn ends, or ask the agent to start it. Archive needs it",
      "review.liveTooltip": "Started",
      "review.waitTooltip": "Waiting for the AI reviewer to start"
    };
    var fallbackTranslate = (key) => EN[key] ?? key;
    var alwaysOpenSession = (select) => select({ openState: "open" });
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
    async function archiveChange(sessionId, name, open) {
      const archived = await requestArchive(sessionId, name);
      if (archived !== void 0) open(archivedChangeAddress(archived));
    }
    function OpenSpecTab(props) {
      const { tab } = props.useTabInfo();
      const target = openSpecTarget(tab.navigation.address);
      const t = props.t ?? fallbackTranslate;
      const sessionOpen = (props.useSession ?? alwaysOpenSession)(
        (snapshot) => snapshot.openState === "open"
      );
      if (target === void 0) return null;
      if (!sessionOpen) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: PANEL_CSS }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-panel", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: loadingLine(t) }) })
        ] });
      }
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
            open,
            storage: props.storage,
            useResource: props.useResource
          }
        );
      } else if (target.view === "change") {
        body = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ChangeBody,
          {
            tab,
            name: target.name,
            archived: target.archived === true,
            initialArtifact: target.artifact,
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
            open,
            useResource: props.useResource
          }
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: PANEL_CSS }),
        body
      ] });
    }
    function useRead(read) {
      const [state, setState] = (0, import_react.useState)(LOADING);
      const [refreshing, setRefreshing] = (0, import_react.useState)(false);
      const sequence = (0, import_react.useRef)(0);
      const reload = () => {
        const current = sequence.current + 1;
        sequence.current = current;
        if (state.phase === "ready") setRefreshing(true);
        else setState(LOADING);
        read().then(
          (value) => {
            if (sequence.current !== current) return;
            setState({ phase: "ready", value });
            setRefreshing(false);
          },
          (error) => {
            if (sequence.current !== current) return;
            setState({
              phase: "error",
              message: error instanceof Error ? error.message : String(error)
            });
            setRefreshing(false);
          }
        );
      };
      return { state, refreshing, reload };
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
    var LIVE_REVIEW_POLL_MS = 4e3;
    function useLiveReviews(sessionId, active, onSettled) {
      const [live, setLive] = (0, import_react.useState)({});
      const settled = (0, import_react.useRef)(onSettled);
      settled.current = onSettled;
      const observed = (0, import_react.useRef)({
        sessionId,
        entries: []
      });
      (0, import_react.useEffect)(() => {
        if (!active) return void 0;
        let stopped = false;
        let timer;
        const poll = async () => {
          try {
            const entries = await requestLiveReviews(sessionId);
            if (stopped) return;
            if (entries === void 0) {
              stopped = true;
              setLive({});
              observed.current = { sessionId, entries: [] };
              return;
            }
            const byChange = /* @__PURE__ */ Object.create(null);
            for (const entry of entries) {
              const current = byChange[entry.change];
              if (current === void 0) byChange[entry.change] = [entry];
              else current.push(entry);
            }
            setLive(byChange);
            const previous = observed.current.sessionId === sessionId ? observed.current.entries : [];
            const done = settledReviews(previous, entries);
            observed.current = { sessionId, entries };
            if (done.length > 0) settled.current();
          } catch {
          } finally {
            if (!stopped) timer = setTimeout(() => void poll(), LIVE_REVIEW_POLL_MS);
          }
        };
        void poll();
        return () => {
          stopped = true;
          if (timer !== void 0) clearTimeout(timer);
        };
      }, [sessionId, active]);
      return live;
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
    function ChangeListObservation(props) {
      const notify = useLiveReload(props.reload);
      const observation = useObservation(notify);
      const addresses = changeListWatchAddresses(props.sessionId, props.rows);
      observation.add(addresses);
      return addresses.map((address) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        FileWatch,
        {
          address,
          useResource: props.useResource,
          settle: observation.settle,
          change: observation.change
        },
        address
      ));
    }
    function RootBody(props) {
      const { tab, initialSegment, sessionId, t, draft, open } = props;
      const storage = props.storage ?? defaultSegmentStorage();
      const start = initialRootSegment(initialSegment, readSegment(storage, sessionId));
      const [segment, setSegment] = (0, import_react.useState)(start);
      const [specOrder, setSpecOrder] = (0, import_react.useState)("newest");
      const [specQuery, setSpecQuery] = (0, import_react.useState)("");
      const [archiveQuery, setArchiveQuery] = (0, import_react.useState)("");
      const changes = useRead(() => requestChangeList(sessionId));
      const capabilities = useRead(() => requestCapabilities(sessionId));
      const settleReload = useLiveReload(() => changes.reload());
      const enginePresent = changes.state.phase === "ready" && (changes.state.value.reviewAvailable === true || changes.state.value.changes.some((row) => row.archived !== true && row.review !== void 0));
      const live = useLiveReviews(
        sessionId,
        segment === "changes" && tab.visible && enginePresent,
        settleReload
      );
      const liveReviews = enginePresent ? live : {};
      const knownRows = (0, import_react.useRef)([]);
      if (changes.state.phase === "ready") knownRows.current = changes.state.value.changes;
      const useResource = props.useResource ?? noResource;
      const started = (0, import_react.useRef)({ specs: false });
      const loadSpecs = () => {
        started.current.specs = true;
        capabilities.reload();
      };
      (0, import_react.useEffect)(() => {
        writeSegment(storage, sessionId, start);
        changes.reload();
        if (start === "specs") loadSpecs();
      }, []);
      useTabRefresh(tab, () => {
        if (segment === "specs") capabilities.reload();
        else changes.reload();
      });
      const choose = (next) => {
        setSegment(next);
        writeSegment(storage, sessionId, next);
        if (next === "specs" && !started.current.specs) loadSpecs();
      };
      const [archiveState, setArchiveState] = (0, import_react.useState)({ busy: false });
      const archive = (name) => {
        if (archiveState.busy) return;
        setArchiveState({ name, busy: true });
        archiveChange(sessionId, name, open).then(
          () => {
            setArchiveState({ busy: false });
            changes.reload();
          },
          (error) => setArchiveState({
            name,
            busy: false,
            reason: error instanceof Error ? error.message : String(error)
          })
        );
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        segment === "changes" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          ChangeListObservation,
          {
            sessionId,
            rows: knownRows.current,
            useResource,
            reload: changes.reload
          }
        ) : null,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          RootView,
          {
            segment,
            changes: changes.state,
            capabilities: capabilities.state,
            live: liveReviews,
            refreshing: segment === "specs" ? capabilities.refreshing : changes.refreshing,
            specQuery,
            archiveQuery,
            t,
            onSegment: choose,
            onSpecQuery: setSpecQuery,
            onArchiveQuery: setArchiveQuery,
            specOrder,
            onSpecOrder: setSpecOrder,
            onRetry: () => {
              if (segment === "specs") loadSpecs();
              else changes.reload();
            },
            onOpenChange: (name, archived) => open(archived ? archivedChangeAddress(name) : changeAddress(name)),
            onOpenArtifact: (name, archived, artifact) => open(archived ? archivedChangeAddress(name, artifact) : changeAddress(name, artifact)),
            onOpenCapability: (id) => open(capabilityAddress(id)),
            onExplore: () => draft(EXPLORE_DRAFT),
            onPropose: () => draft(PROPOSE_DRAFT),
            onSeeArchive: () => choose("archive"),
            onApply: (name) => draft(applyDraft(name)),
            onArchiveChange: archive,
            archiveState
          }
        )
      ] });
    }
    function ChangeBody(props) {
      const { tab, name, sessionId, t, draft } = props;
      const archived = props.archived === true;
      const read = useRead(() => requestChange(sessionId, name, archived));
      const [artifact, setArtifact] = (0, import_react.useState)(props.initialArtifact);
      const [delta, setDelta] = (0, import_react.useState)(void 0);
      const [requirementQuery, setRequirementQuery] = (0, import_react.useState)("");
      const [archiveState, setArchiveState] = (0, import_react.useState)({
        busy: false
      });
      const archive = () => {
        if (archiveState.busy) return;
        setArchiveState({ busy: true });
        archiveChange(sessionId, name, props.open).then(
          // Clear busy after success or refusal so the action stays usable.
          () => setArchiveState({ busy: false }),
          (error) => setArchiveState({
            busy: false,
            reason: error instanceof Error ? error.message : String(error)
          })
        );
      };
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
        for (const entry of read.state.value.deltas ?? []) knownDeltas.current.add(entry.capability);
      }
      const addresses = archived ? [] : changeWatchPaths(name, [...knownDeltas.current]).map((path) => fileAddress(sessionId, path));
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
            refreshing: read.refreshing,
            artifact: artifact ?? initialArtifact(change),
            delta: delta ?? capabilityList(change)[0],
            requirementQuery,
            t,
            labels,
            onArtifact: setArtifact,
            onDelta: setDelta,
            onRequirementQuery: setRequirementQuery,
            onApply: () => draft(applyDraft(change.name)),
            onArchive: archive,
            archiving: archiveState.busy,
            ...archiveState.reason === void 0 ? {} : { archiveReason: archiveState.reason },
            onOpenCapability: (id) => props.open(capabilityAddress(id))
          }
        ))
      ] });
    }
    function CapabilityBody(props) {
      const { tab, id, sessionId, t, open } = props;
      const read = useRead(() => requestCapability(sessionId, id));
      const [section, setSection] = (0, import_react.useState)("requirements");
      const [requirementQuery, setRequirementQuery] = (0, import_react.useState)("");
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
        readContent(read.state, t, read.reload, (capability) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          CapabilityView,
          {
            capability,
            refreshing: read.refreshing,
            requirementQuery,
            t,
            labels,
            section,
            onSection: setSection,
            onRequirementQuery: setRequirementQuery,
            onOpenArchived: (name) => open(archivedChangeAddress(name))
          }
        ))
      ] });
    }
    function readContent(state, t, retry, ready) {
      if (state.phase === "loading") {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-panel", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: loadingLine(t) }) });
      }
      if (state.phase === "error") {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-panel", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: errorState({ message: state.message, t, onRetry: retry }) }) });
      }
      return ready(state.value);
    }
    function loadingLine(t) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", role: "status", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.TextShimmer, { active: true, children: t("state.loading") }) });
    }
    function Spinner() {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-spinner", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconLoadingOutlineRegular, { size: 12 }) });
    }
    function refreshingSpinner(t) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-refreshing", role: "status", "aria-label": t("state.refreshing"), children: Spinner() });
    }
    function errorState(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-error", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconWarningTriangleOutlineRegular, { size: 14 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: props.message }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", onClick: props.onRetry, children: props.t("state.retry") })
      ] });
    }
    function RootView(props) {
      const { t } = props;
      const list = props.changes.phase === "ready" ? props.changes.value : void 0;
      const capabilityRows = props.capabilities.phase === "ready" ? props.capabilities.value : void 0;
      const capabilityTotal = capabilityRows?.length ?? list?.counts.capabilities;
      const labels = {
        changes: t("segment.changes"),
        specs: t("segment.specs"),
        archive: t("segment.archive")
      };
      const totals = {
        changes: list?.counts.active,
        specs: capabilityTotal,
        archive: list?.counts.archived
      };
      const options = ROOT_SEGMENTS.map((value) => ({
        value,
        label: totals[value] === void 0 ? labels[value] : `${labels[value]} ${String(totals[value])}`
      }));
      let body;
      if (props.segment === "changes") {
        body = readContent(props.changes, t, props.onRetry, (response) => changesBody(response, props));
      } else if (props.segment === "specs") {
        body = readContent(props.capabilities, t, props.onRetry, (rows) => specsBody(rows, props, list));
      } else {
        body = readContent(
          props.changes,
          t,
          props.onRetry,
          (response) => archiveBody(response.archived, props)
        );
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", { className: "dsh-openspec-root-header", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-actions", children: [
          ActionCard({
            icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconBrowseOutlineRegular, { size: 14 }),
            title: t("root.explore"),
            body: t("root.exploreBody"),
            onClick: props.onExplore
          }),
          ActionCard({
            icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconPlusOutlineRegular, { size: 14 }),
            title: t("root.propose"),
            body: t("root.proposeBody"),
            onClick: props.onPropose
          })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: "dsh-openspec-root",
            value: props.segment,
            options,
            onChange: props.onSegment,
            label: t("segment.label"),
            className: "dsh-openspec-segments"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-scroll", children: body })
      ] });
    }
    function changesBody(response, props) {
      const active = sortChanges(response.changes).filter((row) => phaseOf(row) !== "archived");
      if (active.length === 0) return changesEmpty(response, props);
      const inProgress = active.filter((row) => phaseOf(row) !== "complete");
      const complete = active.filter((row) => phaseOf(row) === "complete");
      const busy = props.refreshing === true;
      const archiveFacts = (name) => {
        const state = props.archiveState;
        const mine = state?.name === name;
        return {
          archiving: mine && state.busy === true,
          ...mine && state.reason !== void 0 ? { archiveReason: state.reason } : {}
        };
      };
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
        inProgress.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-openspec-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-group-label", children: [
            props.t("group.inProgress"),
            busy ? refreshingSpinner(props.t) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: inProgress.map(
            (row) => ChangeCard({
              row,
              t: props.t,
              now: props.now,
              live: props.live?.[row.name],
              onOpen: (name) => props.onOpenChange(name, false),
              onOpenArtifact: (kind) => props.onOpenArtifact(row.name, false, kind),
              onApply: () => props.onApply(row.name)
            })
          ) })
        ] }) : null,
        complete.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-openspec-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-group-label", children: [
            props.t("group.complete"),
            busy && inProgress.length === 0 ? refreshingSpinner(props.t) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: complete.map(
            (row) => ChangeCard({
              row,
              t: props.t,
              now: props.now,
              live: props.live?.[row.name],
              onOpen: (name) => props.onOpenChange(name, false),
              onOpenArtifact: (kind) => props.onOpenArtifact(row.name, false, kind),
              onArchive: () => props.onArchiveChange(row.name),
              ...archiveFacts(row.name)
            })
          ) })
        ] }) : null
      ] });
    }
    function changesEmpty(response, props) {
      const recent = sortArchived(response.archived).slice(0, 3);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-section", children: recent.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-openspec-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-group-label", children: props.t("group.recentlyArchived") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: recent.map(
          (row) => ChangeCard({
            row,
            t: props.t,
            now: props.now,
            archived: true,
            onOpen: (name) => props.onOpenChange(name, true),
            onOpenArtifact: (kind) => props.onOpenArtifact(row.name, true, kind)
          })
        ) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "ghost", size: "sm", onClick: props.onSeeArchive, children: props.t("actions.seeArchive") })
      ] }) : null });
    }
    function ActionCard(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsh-openspec-action-card", onClick: props.onClick, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-action-head", children: [
          props.icon,
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-action-title", children: props.title })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-action-body", children: props.body })
      ] });
    }
    function specsBody(rows, props, list) {
      if (rows.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-empty-title", children: props.t("specs.emptyTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-meta", children: props.t("specs.emptyBody") }),
          (list?.counts.archived ?? 0) > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", onClick: props.onSeeArchive, children: props.t("specs.archive") }) : null
        ] });
      }
      const visible = sortCapabilities(
        rows.filter((row) => matchesQuery(props.specQuery, row.id, row.purpose)),
        props.specOrder
      );
      const nextOrder = props.specOrder === "newest" ? "oldest" : "newest";
      const sortLabel = props.t(nextOrder === "newest" ? "specs.orderNewest" : "specs.orderOldest");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-filter-row", children: [
          FilterField({
            label: props.t("specs.filterLabel"),
            placeholder: props.t("specs.filterPlaceholder"),
            value: props.specQuery,
            onChange: props.onSpecQuery
          }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_dsh_client_ui_primitives.Button,
            {
              type: "button",
              variant: "ghost",
              size: "sm",
              className: "dsh-openspec-sort",
              "aria-label": sortLabel,
              title: sortLabel,
              icon: nextOrder === "newest" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconChevronDownOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconChevronUpOutlineRegular, { size: 14 }),
              onClick: () => props.onSpecOrder(nextOrder)
            }
          ),
          props.refreshing === true ? refreshingSpinner(props.t) : null
        ] }),
        visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("specs.noMatch") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: visible.map(
          (row) => CapabilityCard({
            row,
            t: props.t,
            now: props.now,
            onOpen: props.onOpenCapability
          })
        ) })
      ] });
    }
    function archiveBody(rows, props) {
      if (rows.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-empty-title", children: props.t("archive.emptyTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-meta", children: props.t("archive.emptyBody") })
        ] });
      }
      const visible = sortArchived(rows).filter(
        (row) => matchesQuery(props.archiveQuery, row.name, row.summary)
      );
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-filter-row", children: [
          FilterField({
            label: props.t("archive.filterLabel"),
            placeholder: props.t("archive.filterPlaceholder"),
            value: props.archiveQuery,
            onChange: props.onArchiveQuery
          }),
          props.refreshing === true ? refreshingSpinner(props.t) : null
        ] }),
        visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("archive.noMatch") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: visible.map(
          (row) => ChangeCard({
            row,
            t: props.t,
            now: props.now,
            archived: true,
            onOpen: (name) => props.onOpenChange(name, true)
          })
        ) })
      ] });
    }
    function capabilityDate(row) {
      const accepted = row.lastChange?.date;
      if (accepted !== void 0 && accepted !== null && accepted !== "") return accepted;
      return isoDate(row.modified) ?? "";
    }
    function sortCapabilities(rows, order) {
      return [...rows].sort((left, right) => {
        const leftDate = capabilityDate(left);
        const rightDate = capabilityDate(right);
        if (leftDate === rightDate) return left.id.localeCompare(right.id);
        if (leftDate === "") return 1;
        if (rightDate === "") return -1;
        return order === "newest" ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate);
      });
    }
    function FilterField(props) {
      const id = `dsh-openspec-filter-${props.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-openspec-filter", htmlFor: id, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-filter-label", children: props.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          primitives2.Input,
          {
            id,
            type: "search",
            value: props.value,
            placeholder: props.placeholder,
            icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconSearchOutlineRegular, { size: 14 }),
            onChange: (event) => props.onChange(event.target.value)
          }
        )
      ] });
    }
    function ChangeCard(props) {
      if (props.archived === true || props.row.archived === true) return archivedChangeCard(props);
      return activeChangeCard(props);
    }
    function activeChangeCard(props) {
      const { row, t } = props;
      const phase = phaseOf(row);
      const complete = isComplete(row);
      const updated = relativeLabel(row.modified, props.now);
      const units = reviewUnits(row.review, props.live, t, props.now);
      const progress = changeProgress(row);
      const purpose = summaryText(row.why ?? row.summary) === null ? null : row.why ?? row.summary;
      return (
        // biome-ignore lint/a11y/useSemanticElements: the card's own buttons cannot nest inside a <button>; the row keeps Enter/Space.
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "div",
          {
            role: "button",
            tabIndex: 0,
            className: `dsh-openspec-change-row${progress === null ? "" : " dsh-openspec-change-row-progress"}`,
            onClick: () => props.onOpen(row.name),
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              props.onOpen(row.name);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-gutter", children: progress === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "span",
                  {
                    className: `dsh-openspec-change-count${row.totalTasks > 0 ? "" : " dsh-openspec-change-count-none"}`,
                    children: row.totalTasks > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                      String(row.completedTasks),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-count-total", children: `/${String(row.totalTasks)}` })
                    ] }) : "\u2014"
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-gutter-label", children: t("change.tasks") })
              ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "span",
                  {
                    className: "dsh-openspec-change-percent",
                    title: `${String(progress.implemented)}/${String(progress.total)} ${t("change.implemented")} \xB7 ${String(progress.reviewed)}/${String(progress.total)} ${t("change.reviewed")}`,
                    children: [
                      String(progress.percent),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-percent-unit", children: "%" })
                    ]
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-gutter-line", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "span",
                    {
                      className: "dsh-openspec-change-state",
                      "data-state": progress.implemented === progress.total ? "done" : "active"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: `${String(progress.implemented)}/${String(progress.total)}` }),
                  " ",
                  t("change.implemented")
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
                  "span",
                  {
                    className: "dsh-openspec-change-gutter-line",
                    title: progress.missing.length === 0 ? void 0 : `${t("review.missingTooltip")} ${progress.missing.join(", ")}`,
                    children: [
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                        "span",
                        {
                          className: "dsh-openspec-change-state",
                          "data-state": progress.reviewed === progress.total ? "done" : "active"
                        }
                      ),
                      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: `${String(progress.reviewed)}/${String(progress.total)}` }),
                      " ",
                      t("change.reviewed")
                    ]
                  }
                )
              ] }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-body", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-card-head", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: row.name }),
                  updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-count", children: updated })
                ] }),
                purpose === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  "span",
                  {
                    className: "dsh-openspec-purpose dsh-openspec-purpose-clamp dsh-openspec-purpose-two",
                    title: purpose,
                    children: purpose
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-facts", children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-phase", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-dot", "data-phase": phase, "aria-hidden": "true" }),
                    t(`phase.${phase}`)
                  ] }),
                  row.totalTasks > 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("change.tasksNotWritten") }),
                  units.map((unit, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-verdict", children: [
                    unit.spinning === true ? Spinner() : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-state", "data-state": unit.dot }),
                    unit.tooltip === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-verdict-label", children: unit.label }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.Tooltip, { label: `${unit.label} - ${unit.tooltip}`, portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-change-verdict-label", children: unit.label }) })
                  ] }, `${unit.label}-${String(index)}`))
                ] }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-nav", children: [
                  changeNav({ row, t, onOpenArtifact: props.onOpenArtifact }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-change-actions", children: [
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: "dsh-openspec-change-action",
                        disabled: complete || props.onApply === void 0,
                        ...complete ? { title: t("change.applyComplete") } : {},
                        onClick: (event) => {
                          event.stopPropagation();
                          props.onApply?.();
                        },
                        children: t("change.applyShort")
                      }
                    ),
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                      "button",
                      {
                        type: "button",
                        className: "dsh-openspec-change-action",
                        disabled: !complete || props.archiving === true,
                        ...complete ? {} : { title: t("change.archiveIncomplete") },
                        onClick: (event) => {
                          event.stopPropagation();
                          props.onArchive?.();
                        },
                        children: props.archiving === true ? t("change.archiving") : t("change.archive")
                      }
                    )
                  ] })
                ] }),
                props.archiveReason === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-action-refusal", role: "alert", children: `${t("change.archiveRefused")}: ${props.archiveReason}` })
              ] })
            ]
          }
        )
      );
    }
    function archivedChangeCard(props) {
      const { row, t } = props;
      const updated = relativeLabel(row.modified, props.now);
      const purpose = row.why ?? row.summary;
      return (
        // biome-ignore lint/a11y/useSemanticElements: the card's own buttons cannot nest inside a <button>; the row keeps Enter/Space.
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "div",
          {
            role: "button",
            tabIndex: 0,
            className: "dsh-openspec-card dsh-openspec-card-archived",
            onClick: () => props.onOpen(row.name),
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              props.onOpen(row.name);
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-card-head", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconCheckCircleOutlineRegular, { size: 14 }),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: row.name }),
                updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-count", children: `${t("change.updated")} ${updated}` })
              ] }),
              summaryText(purpose) === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.Tooltip, { label: purpose ?? "", portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-purpose dsh-openspec-purpose-clamp", children: purpose }) }),
              row.totalTasks > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-progress", children: ProgressBar({ done: row.completedTasks, total: row.totalTasks, t }) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-meta", children: t("change.tasksNotWritten") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-labels", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: phaseTone("archived"), children: t("phase.archived") }) }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-meta", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-tags", children: presenceFacts(
                  row.presence,
                  t,
                  { requirements: row.requirementCount ?? 0 },
                  props.onOpenArtifact
                ) }),
                row.commit === void 0 || row.commit === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-tail", children: CommitFactView({ commit: row.commit }) })
              ] })
            ]
          }
        )
      );
    }
    function changeNav(props) {
      const presence = props.row.presence;
      const facts = [];
      if (presence.proposal) facts.push({ kind: "proposal", label: props.t("presence.proposal") });
      if (presence.design) facts.push({ kind: "design", label: props.t("presence.design") });
      if (presence.specs > 0) {
        const requirements = props.row.requirementCount ?? 0;
        const specs = props.t("presence.specs");
        facts.push({
          kind: "specs",
          label: requirements > 0 ? `${specs} ${String(requirements)}` : specs,
          ...requirements > 0 ? { title: `${String(requirements)} ${props.t("capability.requirements")}` } : {}
        });
      }
      if (presence.tasks) {
        const tasks = props.t("presence.tasks");
        const total = props.row.totalTasks;
        facts.push({ kind: "tasks", label: total > 0 ? `${tasks} ${String(total)}` : tasks });
      }
      return facts.map((fact) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "button",
        {
          type: "button",
          className: "dsh-openspec-change-nav-item",
          disabled: props.onOpenArtifact === void 0,
          ...fact.title === void 0 ? {} : { title: fact.title },
          onClick: (event) => {
            event.stopPropagation();
            props.onOpenArtifact?.(fact.kind);
          },
          children: fact.label
        },
        fact.kind
      ));
    }
    function CapabilityCard(props) {
      const provenance = props.row.lastChange;
      const commit = props.row.commit ?? provenance?.commit ?? null;
      const updated = relativeLabel(props.row.modified, props.now);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", className: "dsh-openspec-card", onClick: () => props.onOpen(props.row.id), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-card-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: props.row.id }),
          updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-count", children: `${props.t("change.updated")} ${updated}` })
        ] }),
        summaryText(props.row.purpose) === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.Tooltip, { label: props.row.purpose ?? "", portal: true, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-purpose dsh-openspec-purpose-clamp dsh-openspec-purpose-one", children: props.row.purpose }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-artifact-count", children: `${String(props.row.requirementCount)} ${props.t("specs.req")}` }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-tags", children: provenance === void 0 || provenance === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${props.t("specs.acceptedVia")} ${provenance.name}` }) }),
          commit === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-tail", children: CommitFactView({ commit }) })
        ] })
      ] });
    }
    function ProgressBar(props) {
      const ratio = props.total <= 0 ? 0 : Math.min(1, props.done / props.total);
      const bar = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "span",
        {
          className: "dsh-openspec-progress",
          role: "progressbar",
          "aria-valuemin": 0,
          "aria-valuemax": props.total,
          "aria-valuenow": props.done,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-progress-track", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-progress-fill", style: { width: `${String(ratio * 100)}%` } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-progress-label", children: props.label ?? `${String(props.done)}/${String(props.total)} ${props.t("change.tasks")}` })
          ]
        }
      );
      return props.tooltip === void 0 ? bar : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.Tooltip, { label: props.tooltip, portal: true, children: bar });
    }
    function CommitFactView(props) {
      const href = props.commit.url;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-commit", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-commit-ref", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconBranchOutlineRegular, { size: 14 }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            primitives2.Tooltip,
            {
              label: props.commit.subject === "" ? props.commit.short : props.commit.subject,
              portal: true,
              children: href === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: props.commit.short }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "a",
                {
                  className: "dsh-openspec-commit-link",
                  href,
                  target: "_blank",
                  rel: "noreferrer",
                  onClick: (event) => event.stopPropagation(),
                  children: props.commit.short
                }
              )
            }
          )
        ] }),
        props.commit.at === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-meta", children: props.commit.at.slice(0, 10) })
      ] });
    }
    function presenceFacts(presence, t, counts, onOpen) {
      if (presence === void 0) return [];
      const facts = [];
      if (presence.proposal) facts.push({ kind: "proposal", label: t("presence.proposal") });
      if (presence.design) facts.push({ kind: "design", label: t("presence.design") });
      if (presence.specs > 0) {
        facts.push({
          kind: "specs",
          label: presence.specs === 1 ? t("presence.spec") : t("presence.specs"),
          ...counts.requirements > 0 ? { suffix: `${String(counts.requirements)} ${t("specs.req")}` } : {}
        });
      }
      if (presence.tasks) facts.push({ kind: "tasks", label: t("presence.tasks") });
      return facts.map((fact) => {
        const tag = /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", className: "dsh-openspec-artifact-tag", children: [
          fact.label,
          fact.suffix === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-artifact-count", children: fact.suffix })
        ] });
        if (onOpen === void 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: tag }, fact.kind);
        return (
          // biome-ignore lint/a11y/useSemanticElements: an artifact tag is a card-internal link; the row stays the primary activation.
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "span",
            {
              role: "button",
              tabIndex: 0,
              className: "dsh-openspec-artifact-link",
              onClick: (event) => {
                event.stopPropagation();
                onOpen(fact.kind);
              },
              onKeyDown: (event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onOpen(fact.kind);
              },
              children: tag
            },
            fact.kind
          )
        );
      });
    }
    function ChangeView(props) {
      const { change, artifact, delta, t, labels } = props;
      const archived = change.archived === true;
      const phase = archived ? "archived" : phaseOf(change);
      const complete = !archived && isComplete(change);
      const deltas = change.deltas ?? [];
      const baseId = `dsh-openspec-artifacts-${archived ? "archived" : "active"}-${encodeURIComponent(change.name)}`;
      const options = ARTIFACT_KINDS.map((kind) => {
        const available = hasArtifact(change, kind);
        const label = artifactLabel(kind, change, t);
        return {
          value: kind,
          label: available ? label : `${label} (${t("artifact.notWritten")})`,
          disabled: !available,
          ...available ? {} : { title: t("artifact.notWritten") }
        };
      });
      const updated = relativeLabel(change.modified, props.now);
      const archivedOn = isoDate(change.archivedAt);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-openspec-detail-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "dsh-openspec-detail-title", children: change.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: phaseTone(phase), children: t(`phase.${phase}`) }),
            archivedOn === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: archivedOn }),
            props.refreshing === true ? refreshingSpinner(t) : null
          ] }),
          summaryText(change.summary) === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-purpose", children: change.summary }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-progress-row", children: [
            change.totalTasks > 0 ? ProgressBar({ done: change.completedTasks, total: change.totalTasks, t }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-meta", children: t("change.tasksNotWritten") }),
            archived ? null : complete ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                type: "button",
                variant: "outline",
                size: "sm",
                disabled: props.archiving === true,
                onClick: props.onArchive,
                children: props.archiving === true ? t("change.archiving") : t("change.archive")
              }
            ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { type: "button", variant: "outline", size: "sm", onClick: props.onApply, children: t("change.apply") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-meta", children: [
            updated === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: `${t("change.updated")} ${updated}` }),
            change.commit === void 0 || change.commit === null ? null : CommitFactView({ commit: change.commit })
          ] }),
          props.archiveReason === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-action-refusal", role: "alert", children: `${t("change.archiveRefused")}: ${props.archiveReason}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: baseId,
            value: artifact,
            options,
            onChange: (kind) => {
              if (!hasArtifact(change, kind)) return;
              props.onArtifact(kind);
            },
            label: t("change.artifactLabel")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "dsh-openspec-scroll",
            id: `${baseId}-${artifact}-panel`,
            role: "tabpanel",
            "aria-labelledby": `${baseId}-${artifact}`,
            children: artifactBody(change, artifact, delta, deltas, t, labels, props)
          }
        )
      ] });
    }
    function capabilityList(change) {
      return [
        .../* @__PURE__ */ new Set([
          ...(change.deltas ?? []).map((entry) => entry.capability),
          ...change.specs.map((spec) => spec.capability)
        ])
      ];
    }
    function artifactLabel(kind, change, t) {
      if (kind !== "specs") return t(`artifact.${kind}`);
      return `${t("artifact.specs")} (${String(capabilityList(change).length)})`;
    }
    function artifactBody(change, artifact, delta, deltas, t, labels, props) {
      if (artifact === "specs") {
        if (capabilityList(change).length === 0) {
          return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: t("artifact.notWritten") });
        }
        return DeltaView({
          deltas,
          specs: change.specs,
          selected: delta,
          query: props.requirementQuery,
          t,
          labels,
          onDelta: props.onDelta,
          onRequirementQuery: props.onRequirementQuery,
          onOpenCapability: props.onOpenCapability
        });
      }
      if (artifact === "tasks") {
        return TaskChecklist({
          content: change.artifacts.tasks,
          files: change.taskFiles,
          completedTasks: change.completedTasks,
          totalTasks: change.totalTasks,
          t
        });
      }
      const body = change.artifacts[artifact];
      if (body === null) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: t("artifact.notWritten") });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: body, labels }) });
    }
    function DeltaView(props) {
      const capabilities = [
        .../* @__PURE__ */ new Set([...deltaCapabilities(props.deltas), ...props.specs.map((spec) => spec.capability)])
      ];
      const current = capabilities.find((entry) => entry === props.selected) ?? capabilities[0];
      if (current === void 0) return null;
      const groups = props.deltas.filter((entry) => entry.capability === current);
      const raw = props.specs.find((spec) => spec.capability === current);
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
        capabilities.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-deltas", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-group-label", children: `${String(capabilities.length)} ${props.t("change.deltas")}` }),
          capabilities.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Pill, { active: entry === current, onClick: () => props.onDelta(entry), children: entry }, entry))
        ] }) : null,
        groups.length === 0 ? raw === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("artifact.notWritten") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-delta-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: current }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                type: "button",
                variant: "outline",
                size: "sm",
                icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconRightUpOutlineRegular, { size: 14 }),
                onClick: () => props.onOpenCapability(current),
                children: props.t("capability.openAccepted")
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: raw.body, labels: props.labels }) })
        ] }) : groups.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-delta-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: operationTone(entry.operation), children: entry.operation }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: entry.capability }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_dsh_client_ui_primitives.Button,
              {
                type: "button",
                variant: "outline",
                size: "sm",
                icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(primitives2.IconRightUpOutlineRegular, { size: 14 }),
                onClick: () => props.onOpenCapability(entry.capability),
                children: props.t("capability.openAccepted")
              }
            )
          ] }),
          entry.rename === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-rename", children: `${props.t("delta.from")} ${entry.rename.from} \u2192 ${props.t("delta.to")} ${entry.rename.to}` }),
          RequirementList({
            requirements: entry.requirements,
            query: props.query,
            t: props.t,
            onQuery: props.onRequirementQuery
          })
        ] }, `${entry.capability}-${entry.operation}`))
      ] });
    }
    function operationTone(operation) {
      if (operation === "ADDED") return "info";
      if (operation === "REMOVED") return "danger";
      if (operation === "RENAMED") return "warning";
      return "neutral";
    }
    function RequirementList(props) {
      const filterable = props.requirements.length > 12;
      const visible = filterable ? props.requirements.filter(
        (requirement) => matchesQuery(props.query, requirement.name, requirement.text)
      ) : props.requirements;
      if (props.requirements.length === 0) return null;
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
        filterable ? FilterField({
          label: props.t("requirements.filterLabel"),
          placeholder: props.t("requirements.filterPlaceholder"),
          value: props.query,
          onChange: props.onQuery
        }) : null,
        visible.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("requirements.noMatch") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: visible.map((requirement) => RequirementCard({ requirement, t: props.t })) })
      ] });
    }
    function RequirementCard(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: "dsh-openspec-requirement", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "dsh-openspec-requirement-title", children: props.requirement.name }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-requirement-text", children: InlineText({ text: props.requirement.text }) }),
        props.requirement.scenarios.map((scenario) => ScenarioBlock({ scenario, t: props.t }))
      ] });
    }
    function scenarioSteps(rawText) {
      const steps = [];
      for (const rawLine of rawText.split("\n")) {
        const line = rawLine.trim();
        if (line === "") continue;
        const body = line.replace(/^[-*+]\s+/, "");
        const match = /^(?:\*\*)?(WHEN|THEN|AND|BUT)(?:\*\*)?\s*(.*)$/.exec(body);
        if (match === null) {
          steps.push({ label: "", text: body });
        } else {
          steps.push({ label: match[1] ?? "", text: match[2] ?? "" });
        }
      }
      return steps;
    }
    function ScenarioBlock(props) {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-scenario", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-scenario-name", children: `${props.t("scenario.label")} ${props.scenario.name}` }),
        scenarioSteps(props.scenario.rawText).map((step, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-step", children: [
          step.label === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-step-tag", children: props.t(`scenario.${step.label.toLowerCase()}`) }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: InlineText({ text: step.text }) })
        ] }, `${step.label}-${String(index)}`))
      ] });
    }
    var INLINE_PATTERN = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    var CODE_SLOT = /\uE000(\d+)\uE000/g;
    var KEYWORDS = /* @__PURE__ */ new Set(["SHALL", "MUST", "MUST NOT"]);
    var KEYWORD_PATTERN = /\b(MUST NOT|SHALL|MUST)\b/;
    function InlineText(props) {
      const codes = [];
      const masked = props.text.replace(/`([^`]+)`/g, (_whole, code) => {
        codes.push(code);
        return `\uE000${String(codes.length - 1)}\uE000`;
      });
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: inlineNodes(masked, codes) });
    }
    function inlineNodes(text, codes) {
      const nodes = [];
      let last = 0;
      let key = 0;
      for (const match of text.matchAll(INLINE_PATTERN)) {
        const index = match.index ?? 0;
        if (index > last) nodes.push(...plainNodes(text.slice(last, index), codes, key++));
        const strong = match[1];
        const emphasis = match[2];
        const label = match[3];
        const href = match[4];
        if (strong !== void 0) {
          nodes.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: inlineNodes(strong, codes) }, `strong-${String(key)}`));
        } else if (emphasis !== void 0) {
          nodes.push(/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: inlineNodes(emphasis, codes) }, `em-${String(key)}`));
        } else if (label !== void 0 && href !== void 0) {
          nodes.push(
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href, target: "_blank", rel: "noreferrer", children: inlineNodes(label, codes) }, `link-${String(key)}`)
          );
        }
        key += 1;
        last = index + match[0].length;
      }
      if (last < text.length) nodes.push(...plainNodes(text.slice(last), codes, key));
      return nodes;
    }
    function plainNodes(text, codes, keyBase) {
      const nodes = [];
      let last = 0;
      let key = keyBase;
      for (const match of text.matchAll(CODE_SLOT)) {
        const index = match.index ?? 0;
        if (index > last) {
          for (const node of keywordNodes(text.slice(last, index), key)) nodes.push(node);
          key += 1;
        }
        const code = codes[Number(match[1])] ?? "";
        nodes.push(
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { className: "dsh-openspec-code", children: code }, `code-${String(key)}`)
        );
        key += 1;
        last = index + match[0].length;
      }
      if (last < text.length) {
        for (const node of keywordNodes(text.slice(last), key)) nodes.push(node);
      }
      return nodes;
    }
    function keywordNodes(text, keyBase) {
      const parts = text.split(KEYWORD_PATTERN);
      const nodes = [];
      for (const part of parts) {
        if (part === "") continue;
        if (KEYWORDS.has(part)) {
          nodes.push(
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-keyword", children: part }, `kw-${String(keyBase)}-${part}`)
          );
        } else {
          nodes.push(part);
        }
        keyBase += 1;
      }
      return nodes;
    }
    function TaskChecklist(props) {
      const sources = props.files !== void 0 && props.files.length > 0 ? props.files : props.content === null ? [] : [{ path: "", body: props.content }];
      if (sources.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("artifact.notWritten") });
      }
      const groups = sources.flatMap((file) => parseTaskGroups(file.body)).filter((group) => group.tasks.length > 0);
      const parsed = sources.flatMap((file) => parseTaskLines(file.body));
      const remainder = props.totalTasks - parsed.length;
      if (groups.length === 0 && props.totalTasks === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("change.tasksNotWritten") });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-section", children: [
        remainder === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-meta", children: `${String(Math.abs(remainder))} ${props.t("change.unparsedTasks")}` }),
        groups.map((group, index) => {
          const done = group.tasks.filter((task) => task.done).length;
          return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-openspec-task-group", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dsh-openspec-task-group-head", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-group-label", children: group.title === "" ? props.t("change.tasks") : group.title }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-meta", children: `${String(done)}/${String(group.tasks.length)}` })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-list", children: group.tasks.map((task, taskIndex) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "span",
              {
                className: `dsh-openspec-task${task.done ? " dsh-openspec-task-done" : ""}`,
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    import_dsh_client_ui_primitives.StateDot,
                    {
                      state: task.done ? "done" : "idle",
                      appearance: "step",
                      size: 14,
                      className: "dsh-openspec-task-dot"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: InlineText({ text: task.description }) })
                ]
              },
              `${task.description}-${String(taskIndex)}`
            )) })
          ] }, `${group.title}-${String(index)}`);
        })
      ] });
    }
    function CapabilityView(props) {
      const { capability, t, labels } = props;
      const section = props.section ?? "requirements";
      const requirements = capability.requirements ?? [];
      const history = sortHistory(capability.history ?? []);
      const requirementCount = capability.requirementCount > 0 ? capability.requirementCount : requirements.length;
      const scenarioCount = requirements.reduce(
        (sum, requirement) => sum + requirement.scenarios.length,
        0
      );
      const producer = history[0];
      const accepted = isoDate(capability.modified);
      const baseId = `dsh-openspec-capability-${encodeURIComponent(capability.id)}`;
      const options = [
        {
          value: "requirements",
          label: `${t("capability.requirementsTab")} (${String(requirementCount)})`
        },
        { value: "history", label: `${t("capability.historyTab")} (${String(history.length)})` }
      ];
      return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "dsh-openspec-detail-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-card-head", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "dsh-openspec-detail-title", children: capability.id }),
            props.refreshing === true ? refreshingSpinner(t) : null
          ] }),
          summaryText(capability.purpose) === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-purpose", children: capability.purpose }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-openspec-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: `${String(requirementCount)} ${t("capability.requirements")}` }),
            scenarioCount === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: `${String(scenarioCount)} ${t("capability.scenarios")}` }),
            accepted === null ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", children: `${t("capability.accepted")} ${accepted}` }),
            producer === void 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tag, { tone: "quiet", className: "dsh-openspec-producer", children: `${t("capability.via")} ${producer.name}` }),
            capability.commit === void 0 || capability.commit === null ? null : CommitFactView({ commit: capability.commit })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_dsh_client_ui_primitives.SegmentedControl,
          {
            id: baseId,
            value: section,
            options,
            onChange: props.onSection,
            label: t("capability.sections")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "dsh-openspec-scroll",
            id: `${baseId}-${section}-panel`,
            role: "tabpanel",
            "aria-labelledby": `${baseId}-${section}`,
            children: section === "history" ? HistoryList({ history, t, onOpenArchived: props.onOpenArchived }) : requirements.length > 0 ? RequirementList({
              requirements,
              query: props.requirementQuery,
              t,
              onQuery: props.onRequirementQuery
            }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-body", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: capability.body, labels }) })
          }
        )
      ] });
    }
    function HistoryList(props) {
      const history = props.history ?? [];
      if (history.length === 0) {
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-openspec-state", children: props.t("capability.historyEmpty") });
      }
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-openspec-list", children: history.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "dsh-openspec-history-row",
          onClick: () => props.onOpenArchived(entry.name),
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-history-date", children: isoDate(entry.date) ?? entry.date }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-title", children: entry.name }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-openspec-card-count", children: `${String(entry.completedTasks)}/${String(entry.totalTasks)}` }),
            entry.commit === null ? null : CommitFactView({ commit: entry.commit })
          ]
        },
        entry.name
      )) });
    }
    var PANEL_CSS = `
    .dsh-openspec-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-sizing: border-box;
      min-width: 0;
      min-height: 0;
      height: 100%;
      padding: 12px;
      overflow: hidden;
      color: var(--dsw-alias-label-primary);
    }
    .dsh-openspec-root-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-detail-title {
      margin: 0;
      font: var(--dsw-font-m-18);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-segments {
      min-width: 0;
    }
    .dsh-openspec-scroll {
      display: flex;
      flex-direction: column;
      gap: 16px;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }
    .dsh-openspec-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-group-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: var(--dsw-font-xxxs-strong-11);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-refreshing {
      display: inline-flex;
      align-items: center;
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-spinner {
      display: inline-flex;
      flex: none;
      align-items: center;
      animation: dsh-openspec-spin 900ms linear infinite;
    }
    @keyframes dsh-openspec-spin {
      to {
        transform: rotate(360deg);
      }
    }
    .dsh-openspec-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .dsh-openspec-card:hover {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    .dsh-openspec-card-archived {
      opacity: 0.8;
    }
    .dsh-openspec-card-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .dsh-openspec-card-title {
      font: var(--dsw-font-s-strong-14);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-card-count {
      margin-left: auto;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap;
    }
    .dsh-openspec-card-tail {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
      margin-left: auto;
    }
    .dsh-openspec-card-tail .dsh-openspec-card-count {
      margin-left: 0;
    }
    .dsh-openspec-purpose {
      margin: 0;
      font: var(--dsw-font-xs-13);
      color: var(--dsw-alias-label-secondary);
      overflow-wrap: anywhere;
    }
    /* Cards clamp to three lines; detail headers keep the full purpose. */
    .dsh-openspec-purpose-clamp {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 3;
      overflow: hidden;
    }
    .dsh-openspec-purpose-one {
      -webkit-line-clamp: 1;
    }
    .dsh-openspec-purpose-two {
      -webkit-line-clamp: 2;
    }
    .dsh-openspec-producer {
      max-width: 100%;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
    }
    .dsh-openspec-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      min-width: 0;
    }
    .dsh-openspec-card-labels {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-artifact-link {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .dsh-openspec-artifact-tag {
      gap: 4px;
    }
    .dsh-openspec-artifact-link:hover {
      filter: brightness(1.2);
    }
    .dsh-openspec-artifact-count {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap;
    }
    .dsh-openspec-progress {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    /* Two bars side by side; each label stays under its own track and wraps alone. */
    .dsh-openspec-card-progress {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      min-width: 0;
    }
    .dsh-openspec-card-progress .dsh-openspec-progress {
      flex: 1 1 120px;
    }
    .dsh-openspec-progress-row .dsh-openspec-progress {
      flex: 1 1 120px;
    }
    .dsh-openspec-progress-track {
      display: block;
      height: 4px;
      border-radius: var(--dsw-radius-sm);
      background: var(--dsw-alias-bg-module-platform);
      overflow: hidden;
    }
    .dsh-openspec-progress-fill {
      display: block;
      height: 100%;
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-openspec-progress-label {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-progress-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-change-row {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr);
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      color: inherit;
      cursor: pointer;
      overflow: hidden;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .dsh-openspec-change-row:hover {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    /* The numeric margin: one count per row, aligned down the whole list. */
    .dsh-openspec-change-gutter {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 4px;
      min-width: 0;
      padding: 10px;
    }
    /* A reviewed row states readiness: one percent over the two counts it is made of. */
    .dsh-openspec-change-row-progress {
      grid-template-columns: 132px minmax(0, 1fr);
    }
    .dsh-openspec-change-percent {
      align-self: center;
      font-size: 26px;
      line-height: 28px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dsh-openspec-change-percent-unit {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
      margin-left: 1px;
    }
    .dsh-openspec-change-gutter-line {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
      white-space: nowrap;
    }
    .dsh-openspec-change-gutter-line b {
      font: var(--dsw-font-xxs-strong-12);
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-openspec-change-count {
      font: var(--dsw-font-s-strong-14);
      font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-primary);
      white-space: nowrap;
    }
    .dsh-openspec-change-count-total,
    .dsh-openspec-change-count-none {
      font-weight: 400;
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-change-gutter-label {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-change-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 8px 12px;
      border-left: 1px solid var(--dsw-alias-border-l1);
    }
    /* A static dot: the phase is a state, not an activity, so it never animates. */
    .dsh-openspec-change-dot {
      flex: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-change-dot[data-phase='planning'] {
      background: var(--dsw-alias-state-warn-primary);
    }
    .dsh-openspec-change-dot[data-phase='ready-to-apply'],
    .dsh-openspec-change-dot[data-phase='applying'] {
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-openspec-change-dot[data-phase='complete'] {
      background: var(--dsw-alias-state-success-primary);
    }
    .dsh-openspec-change-facts {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px 12px;
      min-width: 0;
      font: var(--dsw-font-xxs-12);
      font-variant-numeric: tabular-nums;
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-change-phase {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    /* A review unit stays one item: the label truncates, its tooltip carries the full text. */
    .dsh-openspec-change-verdict {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      max-width: 100%;
    }
    .dsh-openspec-change-verdict-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* A status dot: one shape and one colour vocabulary for the phase and every review state. */
    .dsh-openspec-change-state {
      flex: none;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-change-state[data-state='done'] {
      background: var(--dsw-alias-state-success-primary);
    }
    /* In progress, not a problem: the informational token the phase dot already uses. */
    .dsh-openspec-change-state[data-state='active'] {
      background: var(--dsw-alias-state-business-primary);
    }
    .dsh-openspec-change-state[data-state='warning'] {
      background: var(--dsw-alias-state-warn-primary);
    }
    .dsh-openspec-change-state[data-state='error'] {
      background: var(--dsw-alias-state-error-primary);
    }
    /* Artifact entries and actions are one navigation row: text buttons, hover fill. */
    .dsh-openspec-change-nav {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      min-width: 0;
    }
    .dsh-openspec-change-nav-item,
    .dsh-openspec-change-action {
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 5px;
      border: 0;
      border-radius: var(--dsw-radius-sm);
      background: none;
      color: var(--dsw-alias-label-tertiary);
      font: var(--dsw-font-xxs-12);
      white-space: nowrap;
      cursor: pointer;
    }
    .dsh-openspec-change-nav-item:hover,
    .dsh-openspec-change-action:not(:disabled):hover {
      background: var(--dsw-alias-interactive-bg-hover);
      color: var(--dsw-alias-label-primary);
    }
    .dsh-openspec-change-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: auto;
      min-width: 0;
    }
    .dsh-openspec-change-action {
      font: var(--dsw-font-xxs-strong-12);
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-openspec-change-action:disabled {
      color: var(--dsw-alias-label-caption);
      cursor: not-allowed;
    }
    .dsh-openspec-change-body .dsh-openspec-action-refusal {
      flex: none;
    }
    .dsh-openspec-action-refusal {
      flex: 1 1 160px;
      min-width: 0;
      margin: 0;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-state-error-primary);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-commit {
      display: inline-flex;
      align-items: center;
      /* The date is a peer fact: two 8px tag paddings plus the tag row's 10px gap. */
      gap: 26px;
      min-width: 0;
    }
    .dsh-openspec-commit-ref {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .dsh-openspec-commit-ref > span,
    .dsh-openspec-commit-ref > a {
      overflow-wrap: anywhere;
    }
    .dsh-openspec-commit-link {
      color: inherit;
      text-decoration: none;
    }
    .dsh-openspec-commit-link:hover {
      text-decoration: underline;
    }
    .dsh-openspec-state {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 12px;
      color: var(--dsw-alias-label-tertiary);
      font: var(--dsw-font-xs-13);
    }
    .dsh-openspec-error {
      display: flex;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      color: var(--dsw-alias-state-error-primary);
    }
    .dsh-openspec-error p {
      flex: 1 1 160px;
      margin: 0;
      color: var(--dsw-alias-label-primary);
      font: var(--dsw-font-xs-13);
    }
    .dsh-openspec-empty-title {
      margin: 0;
      font: var(--dsw-font-s-strong-14);
    }
    .dsh-openspec-action-card {
      display: flex;
      flex-direction: column;
      flex: 1 1 160px;
      gap: 4px;
      box-sizing: border-box;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 120ms ease, border-color 120ms ease;
    }
    .dsh-openspec-action-card:hover {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    .dsh-openspec-action-head {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dsh-openspec-action-title {
      font: var(--dsw-font-s-strong-14);
    }
    .dsh-openspec-action-body {
      font: var(--dsw-font-xs-13);
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-openspec-filter {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .dsh-openspec-filter-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-filter-row .dsh-openspec-filter {
      flex: 1;
    }
    .dsh-openspec-filter-label {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-detail-header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-body {
      box-sizing: border-box;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      overflow-x: auto;
    }
    .dsh-openspec-deltas {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }
    .dsh-openspec-delta-head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-width: 0;
    }
    .dsh-openspec-rename {
      margin: 0;
      font: var(--dsw-font-xs-13);
      color: var(--dsw-alias-label-secondary);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-requirement {
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      min-width: 0;
      padding: 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
    }
    .dsh-openspec-requirement-title {
      margin: 0;
      font: var(--dsw-font-s-strong-14);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-requirement-text {
      margin: 0;
      font: var(--dsw-font-xs-13);
      color: var(--dsw-alias-label-secondary);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-keyword {
      color: var(--dsw-alias-state-business-primary);
    }
    .dsh-openspec-code {
      font: var(--dsw-font-markdown-code);
      padding: 0 4px;
      border-radius: var(--dsw-radius-sm);
      background: var(--dsw-alias-bg-module-platform);
    }
    .dsh-openspec-scenario {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 0 4px 8px;
      border-left: 2px solid var(--dsw-alias-state-business-primary);
    }
    .dsh-openspec-scenario-name {
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-secondary);
    }
    .dsh-openspec-step {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font: var(--dsw-font-xs-13);
      color: var(--dsw-alias-label-secondary);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-step-tag {
      flex: none;
      font: var(--dsw-font-xxxs-strong-11);
      letter-spacing: 0.04em;
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-task-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .dsh-openspec-task-group-head {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dsh-openspec-task {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      font: var(--dsw-font-xs-13);
      overflow-wrap: anywhere;
    }
    .dsh-openspec-task-dot {
      margin-top: 2px;
    }
    .dsh-openspec-task-done {
      color: var(--dsw-alias-label-tertiary);
    }
    .dsh-openspec-history-row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      padding: 8px 12px;
      border: 1px solid var(--dsw-alias-border-l2);
      border-radius: var(--dsw-radius-md);
      background: var(--dsw-alias-bg-layer-1);
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background-color 120ms ease;
    }
    .dsh-openspec-history-row:hover {
      background: var(--dsw-alias-interactive-bg-hover);
    }
    .dsh-openspec-history-date {
      flex: none;
      min-width: 84px;
      font: var(--dsw-font-xxs-12);
      color: var(--dsw-alias-label-tertiary);
    }
    @media (prefers-reduced-motion: reduce) {
      .dsh-openspec-card,
      .dsh-openspec-change-row,
      .dsh-openspec-action-card,
      .dsh-openspec-history-row {
        transition: none;
      }
      .dsh-openspec-spinner {
        animation: none;
      }
    }
    `;
    return module.exports;
  },
});
