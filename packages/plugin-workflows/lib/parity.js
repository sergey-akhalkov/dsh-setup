import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * The release-bound retirement parity: the tracked report, its template
 * hashes, the verify settings contract, and the legacy decisions the owned
 * workflow gates reproduce. A definition may flip to `own` only when the
 * shipped report covers its template and every gate case passed.
 */
export const PARITY_CHANGE = 'retire-legacy-gates';
export const PARITY_REPORT_NAME = 'retire-legacy-gates.json';
/** Deterministic JSON: sorted object keys, so a template hash is order-free. */
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (typeof value === 'object' && value !== null) {
        const record = value;
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
/**
 * The parity-bound template: trigger, steps, evidence shape, gate ownership,
 * and the settings schema. Profile-provided verify values are excluded.
 */
export function templateHash(definition) {
    const settings = definition.settings;
    const template = {
        trigger: definition.trigger,
        steps: definition.steps,
        settings: {
            allowModelStart: settings.allowModelStart,
            risk: settings.risk,
            gateOwnership: settings.gateOwnership,
            // The verify definition's maxBlocks is a validated profile setting, not
            // template content; two profiles with different caps share one report.
            ...(definition.id === 'verify' ? {} : { maxBlocks: settings.maxBlocks }),
            allowIntent: settings.allowIntent,
            ...(settings.allowTools === undefined ? {} : { allowTools: settings.allowTools }),
            ...(settings.legacy === undefined ? {} : { legacy: settings.legacy }),
        },
    };
    return `sha256-${createHash('sha256').update(canonical(template)).digest('hex')}`;
}
/** Definitions that declare a legacy signal are report-bound when `own`. */
/** The three retirement definitions, bound by id even if editable metadata is removed. */
const RETIREMENT_BINDINGS = {
    retro: { plugin: 'goal-continuity', signal: 'work_checkpoint' },
    'task-review': { plugin: 'delegation-rules', signal: 'task-review' },
    verify: { plugin: 'verification-gate', signal: 'verification-gate' },
};
/** The report binds these ids whenever owned, independent of settings.legacy. */
export function reportBoundDefinitions(definitions) {
    return definitions.filter((definition) => definition.settings.gateOwnership === 'own' &&
        RETIREMENT_BINDINGS[definition.id] !== undefined);
}
/** The rollback switch for one retirement definition id. */
function retirementSwitch(definitionId) {
    const binding = RETIREMENT_BINDINGS[definitionId];
    return binding === undefined
        ? 'enable the legacy gate'
        : legacySwitchFor(binding.plugin, binding.signal);
}
/** The assets/parity directory, resolving from src and from lib. */
export function parityAssetDirectory() {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [resolve(here, '../assets/parity'), resolve(here, '../../assets/parity')];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
export function shippedParityReportPath() {
    return join(parityAssetDirectory(), PARITY_REPORT_NAME);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function settingsEntries(value) {
    if (!isRecord(value))
        return undefined;
    const entries = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry) || typeof entry.type !== 'string' || !Array.isArray(entry.cases)) {
            return undefined;
        }
        entries[key] = { type: entry.type, cases: entry.cases };
    }
    return entries;
}
function gateEntries(value) {
    if (!isRecord(value))
        return undefined;
    const entries = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!isRecord(entry) ||
            typeof entry.cases !== 'number' ||
            typeof entry.mismatches !== 'number' ||
            typeof entry.status !== 'string') {
            return undefined;
        }
        entries[key] = {
            cases: entry.cases,
            mismatches: entry.mismatches,
            status: entry.status,
        };
    }
    return entries;
}
/** Read and shape-check the tracked report. */
export function readParityReport(file = shippedParityReportPath()) {
    let raw;
    try {
        raw = readFileSync(file, 'utf8');
    }
    catch {
        return { error: `the parity report "${file}" is missing or unreadable` };
    }
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch (error) {
        return {
            error: `the parity report "${file}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    if (!isRecord(value))
        return { error: 'the parity report must be a JSON object' };
    const templates = value.templates;
    if (!isRecord(templates) ||
        !Object.values(templates).every((entry) => typeof entry === 'string')) {
        return { error: 'the parity report must map each template id to its hash' };
    }
    const settings = settingsEntries(value.settings);
    const gates = gateEntries(value.gates);
    if (settings === undefined || gates === undefined) {
        return { error: 'the parity report settings and gates sections are malformed' };
    }
    const retained = value.retained;
    if (!isRecord(retained))
        return { error: 'the parity report must carry the retained cases' };
    if (!Array.isArray(value.mismatches)) {
        return { error: 'the parity report mismatches must be a list' };
    }
    return {
        report: {
            v: 1,
            change: String(value.change ?? ''),
            at: String(value.at ?? ''),
            templates: templates,
            settings,
            gates,
            retained: retained,
            mismatches: value.mismatches,
        },
    };
}
/** The rollback switch a refused definition names. */
export function legacySwitchFor(plugin, signal) {
    if (plugin === 'delegation-rules')
        return 'delegation.gates.workflowOwned: true';
    if (plugin === 'goal-continuity')
        return 'checkpoint.automation: true';
    if (plugin === 'verification-gate')
        return 'enable the verification-gate row';
    return `enable "${plugin}/${signal}"`;
}
/** The report gate key for one definition id. */
function gateKeyOf(definitionId) {
    if (definitionId === 'retro')
        return 'checkpoint';
    if (definitionId === 'verify')
        return 'verification';
    return definitionId;
}
export function parityLoadIssues(definitions, report, reportPath, reportError) {
    const bound = reportBoundDefinitions(definitions);
    const issues = [];
    const refused = new Set();
    if (bound.length === 0)
        return { issues, refused };
    if (report === undefined) {
        for (const definition of bound) {
            refused.add(definition.id);
            const rollback = retirementSwitch(definition.id);
            issues.push(`workflow definition "${definition.id}": set ${rollback} to fall back to the legacy gate; the parity report is missing at "${reportPath}" (${reportError ?? 'no report'})`);
        }
        return { issues, refused };
    }
    const verifyIsBound = bound.some((definition) => definition.id === 'verify');
    for (const definition of bound) {
        const rollback = retirementSwitch(definition.id);
        const expected = report.templates[definition.id];
        const actual = templateHash(definition);
        if (expected === undefined) {
            refused.add(definition.id);
            issues.push(`workflow definition "${definition.id}": the parity report does not cover its template hash (actual ${actual}); set ${rollback} or run pnpm workflows:parity`);
            continue;
        }
        if (expected !== actual) {
            refused.add(definition.id);
            issues.push(`workflow definition "${definition.id}": template hash ${actual} does not match the report's ${expected}; set ${rollback} or run pnpm workflows:parity`);
            continue;
        }
        const gate = report.gates[gateKeyOf(definition.id)];
        if (gate === undefined || gate.status !== 'pass' || gate.mismatches !== 0) {
            refused.add(definition.id);
            issues.push(`workflow definition "${definition.id}": the parity gate is not pass (${gate?.status ?? 'missing'}); set ${rollback} or fix the parity cases`);
        }
    }
    // A deferred verify is not report-bound: the settings matrix gates only the
    // own definition, so the documented rollback (defer + enabled row) loads.
    if (verifyIsBound && !verifySettingsMatrixValid(report.settings)) {
        refused.add('verify');
        issues.push(`workflow definition "verify": set ${legacySwitchFor('verification-gate', 'verification-gate')} or run pnpm workflows:parity; the report settings matrix must list at least two non-empty command lists and a positive safe maxBlocks above 128`);
    }
    return { issues, refused };
}
/** The tracked settings matrix must mirror the validated verify settings. */
function verifySettingsMatrixValid(settings) {
    const commands = settings['verify.commands'];
    const caps = settings['verify.maxBlocks'];
    const validCommands = commands?.type === 'non-empty string list' &&
        commands.cases.length >= 2 &&
        commands.cases.every((entry) => Array.isArray(entry) &&
            entry.length > 0 &&
            entry.every((command) => typeof command === 'string' && command.trim() !== ''));
    const validCaps = caps?.type === 'positive safe integer' &&
        caps.cases.length >= 2 &&
        caps.cases.every((entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0) &&
        caps.cases.some((entry) => typeof entry === 'number' && entry > 128);
    return validCommands && validCaps;
}
export const DEFAULT_VERIFY_SETTINGS = Object.freeze({
    commands: Object.freeze([]),
    maxBlocks: 8,
});
/** Validate `workflows.verify` fail-loud with the field and its accepted shape. */
export function resolveVerifySettings(raw) {
    if (raw === undefined)
        return DEFAULT_VERIFY_SETTINGS;
    if (!isRecord(raw)) {
        throw new Error('workflows verify settings must be an object: { commands?: string[], maxBlocks?: number }');
    }
    for (const key of Object.keys(raw)) {
        if (key !== 'commands' && key !== 'maxBlocks') {
            throw new Error(`workflows verify has an unknown field "${key}"; use commands or maxBlocks`);
        }
    }
    let commands = DEFAULT_VERIFY_SETTINGS.commands;
    if (raw.commands !== undefined) {
        if (!Array.isArray(raw.commands)) {
            throw new Error('workflows verify.commands must be a list of non-empty commands');
        }
        const values = [];
        for (const entry of raw.commands) {
            if (typeof entry !== 'string' || entry.trim() === '') {
                throw new Error('workflows verify.commands must contain only non-empty strings');
            }
            values.push(entry.trim());
        }
        commands = Object.freeze(values);
    }
    let maxBlocks = DEFAULT_VERIFY_SETTINGS.maxBlocks;
    if (raw.maxBlocks !== undefined) {
        if (typeof raw.maxBlocks !== 'number' ||
            !Number.isSafeInteger(raw.maxBlocks) ||
            raw.maxBlocks < 1) {
            throw new Error('workflows verify.maxBlocks must be a positive safe integer');
        }
        maxBlocks = raw.maxBlocks;
    }
    return { commands, maxBlocks };
}
/** Apply the validated profile values to the shipped verify definition. */
export function withVerifySettings(definition, settings) {
    if (definition.id !== 'verify')
        return definition;
    return {
        ...definition,
        settings: { ...definition.settings, maxBlocks: settings.maxBlocks },
    };
}
/** Checked numbered tasks from a tasks.md body. */
export function checkedTaskLines(markdown) {
    const tasks = [];
    for (const match of markdown.matchAll(/^\s*-\s*\[[xX]\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
        const text = (match[2] ?? '').replace(/\s+/gu, ' ').trim();
        tasks.push({
            id: createHash('sha256').update(text).digest('hex').slice(0, 16),
            number: match[1] ?? '',
            text,
        });
    }
    return tasks;
}
const PORTABLE_KEYS = new Set([
    'rule',
    'change',
    'scope',
    'taskId',
    'digest',
    'worktreeDigest',
    'verdict',
    'findings',
    'target',
    'time',
]);
const PORTABLE_TARGET_KEYS = new Set(['provider', 'model', 'reasoningEffort']);
function hasMachinePath(value) {
    return /(?:^[A-Za-z]:[\\/]|^\/(?:Users|home|root)\/|^~[\\/])/u.test(value);
}
/**
 * The committed portable schema; unknown fields (session, runId, phase) and an
 * invalid optional worktreeDigest can never approve a completion or archive.
 */
function strictPortableApprovalError(record) {
    for (const key of Object.keys(record)) {
        if (!PORTABLE_KEYS.has(key))
            return `unsupported field "${key}"`;
    }
    if (record.scope !== 'task')
        return 'scope must be "task"';
    if (typeof record.rule !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.rule)) {
        return 'rule must be a kebab-case rule id';
    }
    if (typeof record.change !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(record.change)) {
        return 'change must be a change directory name';
    }
    if (typeof record.taskId !== 'string' || !/^[0-9a-f]{16}$/u.test(record.taskId)) {
        return 'taskId must be 16 lowercase hex characters';
    }
    if (typeof record.digest !== 'string' || !/^[0-9a-f]{64}$/u.test(record.digest)) {
        return 'digest must be 64 hex characters';
    }
    if (record.worktreeDigest !== undefined &&
        (typeof record.worktreeDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(record.worktreeDigest))) {
        return 'worktreeDigest must be 64 hex characters when present';
    }
    if (record.verdict !== 'PASS')
        return 'a portable approval must be a PASS';
    if (!Array.isArray(record.findings) || record.findings.length !== 0) {
        return 'a portable approval must have zero findings';
    }
    if (!isRecord(record.target))
        return 'target must be an object';
    for (const key of Object.keys(record.target)) {
        if (!PORTABLE_TARGET_KEYS.has(key))
            return `unsupported target field "${key}"`;
    }
    for (const field of ['provider', 'model', 'reasoningEffort']) {
        const value = record.target[field];
        if (value === undefined && field !== 'provider')
            continue;
        if (typeof value !== 'string' || value.trim() === '' || hasMachinePath(value)) {
            return `target.${field} must be a clean non-empty string`;
        }
    }
    if (typeof record.time !== 'string' || record.time.trim() === '' || hasMachinePath(record.time)) {
        return 'time must be a clean non-empty string';
    }
    return undefined;
}
function readPortableApproval(workspace, change, taskId) {
    try {
        const raw = JSON.parse(readFileSync(join(workspace, 'openspec', 'changes', change, 'reviews', `${taskId}.json`), 'utf8'));
        if (!isRecord(raw))
            return undefined;
        return strictPortableApprovalError(raw) === undefined ? raw : undefined;
    }
    catch {
        return undefined;
    }
}
/** The marker-pinned reviewer, or an error when the marker exists but is invalid. */
export function reviewerBinding(workspace) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(join(workspace, 'openspec', 'review-approval.json'), 'utf8'));
    }
    catch (error) {
        // An absent marker means no binding; an unreadable or malformed marker is
        // a configuration error that must not silently drop the binding.
        return error.code === 'ENOENT'
            ? undefined
            : { invalid: 'openspec/review-approval.json is unreadable or not valid JSON' };
    }
    if (!isRecord(raw))
        return { invalid: 'openspec/review-approval.json is not a JSON object' };
    if (raw.version !== 1)
        return { invalid: 'review-approval.json version must be 1' };
    if (typeof raw.archiveGate !== 'boolean') {
        return { invalid: 'review-approval.json archiveGate must be a boolean' };
    }
    if (typeof raw.taskRule !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(raw.taskRule)) {
        return { invalid: 'review-approval.json taskRule must be a kebab-case rule id' };
    }
    const provider = raw.reviewerProvider;
    const model = raw.reviewerModel;
    if (provider !== undefined && (typeof provider !== 'string' || provider.trim() === '')) {
        return { invalid: 'reviewerProvider must be a non-empty string' };
    }
    if (model !== undefined && (typeof model !== 'string' || model.trim() === '')) {
        return { invalid: 'reviewerModel must be a non-empty string' };
    }
    if (provider === undefined && model === undefined)
        return undefined;
    return {
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
    };
}
/**
 * The owned completion/archive coverage: every checked task needs a portable
 * `reviews/<taskId>.json` PASS for the strict `task-review` rule and the
 * marker's reviewer when one is declared.
 */
export function taskReviewCoverage(workspace, change) {
    let markdown;
    try {
        markdown = readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
    }
    catch {
        return {
            ok: false,
            gaps: [`openspec/changes/${change}/tasks.md is missing or unreadable`],
        };
    }
    const reviewer = reviewerBinding(workspace);
    if (reviewer?.invalid !== undefined) {
        return {
            ok: false,
            gaps: [`${reviewer.invalid}; fix openspec/review-approval.json before completing`],
        };
    }
    const gaps = [];
    // A checked line the task parser cannot read is an unapproved checked task,
    // not an absent one; refuse the completion instead of silently skipping it.
    for (const line of markdown.split('\n')) {
        if (/^\s*[-*+]\s*\[[xX]\]/u.test(line) &&
            !/^\s*-\s*\[[xX]\]\s+\d+(?:\.\d+)*\s+\S/u.test(line)) {
            gaps.push(`checked task line "${line.trim()}" is not a numbered task; fix tasks.md so its review can be matched`);
        }
    }
    for (const task of checkedTaskLines(markdown)) {
        const record = readPortableApproval(workspace, change, task.id);
        const mismatch = [];
        if (record === undefined)
            mismatch.push('no portable PASS record');
        else {
            if (record.rule !== 'task-review')
                mismatch.push(`rule "${String(record.rule)}"`);
            if (record.change !== change)
                mismatch.push(`change "${String(record.change)}"`);
            if (record.taskId !== task.id)
                mismatch.push(`task id "${String(record.taskId)}"`);
            if (record.verdict !== 'PASS')
                mismatch.push(`verdict ${String(record.verdict)}`);
            const target = record.target ?? {};
            if (reviewer?.provider !== undefined && target.provider !== reviewer.provider) {
                mismatch.push(`target provider "${String(target.provider)}"`);
            }
            if (reviewer?.model !== undefined && target.model !== reviewer.model) {
                mismatch.push(`target model "${String(target.model)}"`);
            }
        }
        if (mismatch.length > 0) {
            gaps.push(`checked task "${task.number} ${task.text}" (${task.id}) has no portable task-review PASS (${mismatch.join(', ')}); run delegate(rule: "task-review", change: "${change}", task: "${task.id}")`);
        }
    }
    return { ok: gaps.length === 0, gaps };
}
function stringList(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === 'string')
        : [];
}
function argumentStrings(value) {
    if (typeof value === 'string')
        return [value];
    if (Array.isArray(value))
        return value.flatMap(argumentStrings);
    if (isRecord(value))
        return Object.values(value).flatMap(argumentStrings);
    return [];
}
function mentions(value, wanted) {
    return argumentStrings(value).some((text) => text.includes(wanted));
}
function normalizePath(value) {
    const parts = [];
    for (const part of value.replaceAll('\\', '/').split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..') {
            parts.pop();
        }
        else {
            parts.push(part);
        }
    }
    return parts.join('/');
}
/** A destination matches a target when it is the target or lies beneath it. */
function targetMatches(targets, destination) {
    const path = normalizePath(destination);
    return targets.some((target) => {
        const wanted = normalizePath(target);
        return wanted === '' || path === wanted || path.startsWith(`${wanted}/`);
    });
}
function delegateStarted(detail) {
    if (detail === undefined)
        return false;
    if (detail.trimEnd().endsWith('(no gate record: this answer does not satisfy a strict review rule)')) {
        return true;
    }
    const first = detail.split(/\r?\n/u)[0] ?? '';
    if (/^rule "[^"]+" review (?:already pending|queued)$/u.test(first))
        return false;
    return !/^rule "[^"]+" (?:PASS|FINDINGS|ERROR) \(reused record /u.test(first);
}
const WORKER_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow']);
function isWorkerStart(entry) {
    if (entry.toolName === 'delegate')
        return delegateStarted(entry.detail);
    return WORKER_TOOLS.has(entry.toolName);
}
function taggedWorkerStart(later, checkpointId, bottleneckId) {
    return later.some((entry) => {
        if (!isWorkerStart(entry))
            return false;
        if (!mentions(entry.arguments, checkpointId))
            return false;
        return bottleneckId === undefined || mentions(entry.arguments, bottleneckId);
    });
}
function lanesOf(record) {
    if (!Array.isArray(record.lanes))
        return [];
    return record.lanes.filter(isRecord).map((lane) => ({
        id: typeof lane.id === 'string' ? lane.id : '',
        owner: typeof lane.owner === 'string' ? lane.owner : '',
        scope: typeof lane.scope === 'string'
            ? [lane.scope]
            : Array.isArray(lane.scope)
                ? stringList(lane.scope)
                : [],
        state: typeof lane.state === 'string' ? lane.state : 'running',
        blockedBy: stringList(lane.blockedBy),
    }));
}
function runnableLanes(lanes) {
    const byId = new Map(lanes.map((lane) => [lane.id, lane]));
    return lanes.filter((lane) => {
        if (lane.state === 'done' || lane.state === 'blocked')
            return false;
        return !lane.blockedBy.some((id) => byId.get(id)?.state !== 'done');
    });
}
function scopeOverlaps(left, right) {
    const parts = (value) => normalizePath(value).split('/').filter(Boolean);
    return left.some((a) => right.some((b) => {
        const x = parts(a);
        const y = parts(b);
        // The repository root contains every scope, including a '.' entry.
        if (x.length === 0 || y.length === 0)
            return true;
        const min = Math.min(x.length, y.length);
        return x.slice(0, min).every((part, index) => part === y[index]);
    }));
}
function parallelPlan(record) {
    const runnable = runnableLanes(lanesOf(record));
    for (let i = 0; i < runnable.length; i += 1) {
        for (let j = i + 1; j < runnable.length; j += 1) {
            const left = runnable[i];
            const right = runnable[j];
            if (left.owner !== right.owner && !scopeOverlaps(left.scope, right.scope))
                return true;
        }
    }
    return false;
}
/**
 * The owned checkpoint rules beyond the tool's own validation: freshness, a
 * computed parallel plan needing a tagged worker, a `continue` remedy executed
 * after the checkpoint, and an aged bottleneck. Every call is judged against
 * the observations the host already recorded.
 */
export function checkpointCloseIssue(input) {
    const record = input.record;
    if (record === undefined)
        return undefined;
    const later = input.observations.filter((entry) => entry.ok &&
        (input.checkpointAt === undefined ||
            (entry.at !== undefined && entry.at > input.checkpointAt)));
    const stale = input.fresh === false;
    const outcome = typeof record.outcome === 'string' ? record.outcome : '';
    if (outcome !== 'continue') {
        return stale
            ? 'the checkpoint is older than the configured step interval; call work_checkpoint again before the close'
            : undefined;
    }
    const workerVisible = input.workerVisible !== false;
    if (!stale &&
        input.enforceParallel !== false &&
        workerVisible &&
        parallelPlan(record) &&
        !taggedWorkerStart(later, input.checkpointId)) {
        return `the checkpoint has parallel runnable lanes; start one tagged worker whose arguments name "${input.checkpointId}", or amend the plan in a new work_checkpoint`;
    }
    const bottleneck = record.bottleneck;
    if (bottleneck === undefined) {
        return 'the checkpoint is a continue plan without a bottleneck; call work_checkpoint with lanes, a bottleneck, and its remedy before the close';
    }
    const id = typeof bottleneck.id === 'string' ? bottleneck.id : '';
    const owner = typeof bottleneck.owner === 'string' ? bottleneck.owner : '';
    const action = typeof bottleneck.action === 'string' ? bottleneck.action : '';
    if (id === '') {
        return 'the checkpoint bottleneck has no id; refresh work_checkpoint with a named bottleneck';
    }
    if (action === 'worker_start') {
        if (!taggedWorkerStart(later, input.checkpointId, id)) {
            return `execute the bottleneck remedy: start a tagged worker that names checkpoint "${input.checkpointId}" and bottleneck "${id}", or record a route change in a new work_checkpoint`;
        }
    }
    else if (action === 'lead_action') {
        const workerOwned = owner !== 'lead' && workerVisible;
        if (workerOwned) {
            return `bottleneck "${id}" is owned by "${owner}"; use worker_start with a call carrying "${input.checkpointId}" and "${id}", or user_decision with ask_user_question; lead_action is refused when the bottleneck owner is not "lead"`;
        }
        const targets = stringList(bottleneck.targets);
        const matched = later.some((entry) => (entry.toolName === 'edit' || entry.toolName === 'write') &&
            [entry.arguments.path, entry.arguments.file_path].some((value) => typeof value === 'string' && targetMatches(targets, value)));
        if (!matched) {
            return `execute the bottleneck remedy: write one of the declared targets of bottleneck "${id}" before the close`;
        }
    }
    else if (action === 'user_decision') {
        if (!later.some((entry) => entry.toolName === 'ask_user_question')) {
            return `bottleneck "${id}" needs a user decision; ask the user before the close`;
        }
    }
    else {
        return `bottleneck "${id}" has an unknown action "${action}"; use worker_start, lead_action, or user_decision`;
    }
    const age = typeof record.bottleneckAge === 'number' ? record.bottleneckAge : 0;
    if (age >= input.bottleneckAge &&
        record.bottleneckChanged !== true &&
        action !== 'user_decision') {
        return `bottleneck "${id}" survived ${String(age)} consecutive checkpoints; change the owner, the blocking lane, or ask the user for a decision before the close`;
    }
    if (stale) {
        return 'the checkpoint is older than the configured step interval; call work_checkpoint again before the close';
    }
    return undefined;
}
/** The completion branch: applies only when the task list is fully checked. */
export function taskReviewCompletion(workspace, change) {
    let markdown;
    try {
        markdown = readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
    }
    catch {
        return undefined;
    }
    if (/^\s*-\s*\[ \]\s+\d+(?:\.\d+)*\s+\S/mu.test(markdown))
        return undefined;
    const coverage = taskReviewCoverage(workspace, change);
    return {
        ok: coverage.ok,
        ...(coverage.gaps.length === 0
            ? {}
            : {
                text: `completion of change "${change}" requires a portable task-review PASS for every checked task: ${coverage.gaps.join('; ')}`,
            }),
    };
}
/** Read the retro checkpoint record's own fields; a missing record defers to the step evidence. */
export function readCheckpointRecord(workspace, checkpointPath) {
    try {
        const raw = JSON.parse(readFileSync(join(workspace, checkpointPath), 'utf8'));
        return isRecord(raw) ? raw : undefined;
    }
    catch {
        return undefined;
    }
}
/** The owned checkpoint remedy/age issue for a close, when a record exists. */
export function checkpointGateIssue(workspace, checkpointPath, observations, bottleneckAge, options = {}) {
    const record = readCheckpointRecord(workspace, checkpointPath);
    if (record === undefined)
        return undefined;
    const checkpoint = typeof record.checkpoint === 'string'
        ? record.checkpoint
        : '';
    const issue = checkpointCloseIssue({
        record,
        checkpointId: checkpoint,
        observations,
        bottleneckAge,
        ...options,
    });
    return issue === undefined ? undefined : { text: issue };
}
