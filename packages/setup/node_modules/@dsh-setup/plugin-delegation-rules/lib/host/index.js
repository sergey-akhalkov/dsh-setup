import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile, } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVAL_MARKER_FILE, approvalSummaryLine, CHANGE_PATTERN, computeApprovalCoverage, DIGEST_PATTERN, formatApprovalGapLines, isReviewFinding, laneOfTask, normalizeCheckboxes, normalizeTaskText, parsePortableTaskReviewRecord, parseReviewApprovalMarker, parseTaskLanes, parseTasksText, portableTaskRecordDisplayPath, portableTaskRecordPath, REVIEWS_DIRECTORY, recognizeArchiveCommands, shellSegments, TASK_ID_PATTERN, unparseableCheckedLines, } from '../shared/approval.js';
/**
 * Delegation-rules plugin: a model-agnostic engine where rules, targets,
 * instructions, result contracts, and gate policies are configuration. The
 * Host registers the `delegate`, `task_progress`, and `delegation_status`
 * tools, one on-demand skill, and the `agent/turn-stopping` gate. It has no
 * always-on prompt section and no runtime dependency on any other DSH or
 * `@dsh-setup` package.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-delegation-rules';
/** Services the registrations depend on. */
export const inject = ['tools', 'subagents', 'skills', 'workingDirectory'];
/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'delegation-rules';
/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-delegation-rules';
/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600;
const assetsDirectory = fileURLToPath(new URL('../../assets/delegation-rules', import.meta.url));
/**
 * Catalog text; a test keeps it identical to the asset frontmatter. Kept short
 * because the tool descriptions plus this line share the model-facing budget.
 */
export const skillDescription = 'Delegation rules: authored triggers, targets, result contracts, and the task-by-task review workflow. Load when authoring or debugging delegation rules, when a gate steers, when reviewing a completed task or spec, or when consulting, researching, or patching through a delegated model.';
/**
 * Tool descriptions are model-facing policy: they are the only delegation
 * guidance present without opening the skill. A budget test pins their size.
 */
export const toolDescriptions = {
    delegate: 'Run one configured delegation rule through its target. Manual tasks: `research` answers a question with evidence and sources; `advisor` gives a manual second opinion from the strong target on one decision; pass the exact question, constraints, and decisive evidence, and use it only for expensive-to-reverse, cross-module, security/data-integrity, or repeated-failure decisions - never routine edits, syntax, lookups, or locally verifiable facts, and at most three times per session; `blocker` consults on a stuck plan when the failure-streak hint appears; `bug-fix` runs a write target in an isolated git worktree and returns the diff and test report (never auto-merged). Gate rules: `spec-review` reviews the whole active OpenSpec change before implementation; `task-review` reviews the next checked task without a PASS/ERROR record; `integration-review` is the optional whole-worktree check. The engine validates the rule, starts the configured DSH subagent provider, parses the contract result, and writes a digest-bound record under `.dsh/delegation`; a review PASS needs zero P0/P1 findings, FINDINGS/ERROR are reported but do not pass a strict gate, and a matching PASS is reused without another run. The `answer` contract writes no gate record. Only a matching record satisfies the turn-stopping gate: a text claim does not. A missing or incompatible target is reported with the target id, provider name, and next action.',
    task_progress: 'Record an explicit in-progress or blocked note for one unchecked task, with the reason and the current worktree digest. Use it when a task spans turns instead of ticking `tasks.md`: it runs no model and costs nothing. The note lets a code-changing turn close only while the worktree still matches it; after any further change it is stale and a fresh note or the tick plus `delegate` task review is required. A checked task never accepts a note, and a note never counts as a task-review PASS.',
    delegation_status: "Report registered DSH subagent providers and capabilities, configured delegation targets and rules, each active change's involvement by this session (created, spec changed, checked tasks), per-change task/progress-note state, review record state (matching, stale, missing, malformed), and missing-target diagnostics with the next action. It never attributes a change. Use it when a `delegate` call reports a target problem or before configuring rules.",
};
/** JSON output contract shared by the three tools: one rendered text result. */
const TOOL_OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/** Media type of a gate steering message; attributed to the gate, not the user. */
const GATE_SOURCE_KIND = 'delegation-rules';
const DELEGATION_DIR = '.dsh/delegation';
/** Disposable task-review checkouts and their scratch indexes. */
const SNAPSHOT_DIR = `${DELEGATION_DIR}/snapshots`;
const SCRATCH_DIR = `${DELEGATION_DIR}/scratch`;
const SNAPSHOT_LEASE_MS = 5 * 60_000;
const SNAPSHOT_REFRESH_MS = 30_000;
const SNAPSHOT_SWEEP_MS = 10 * 60_000;
const SNAPSHOT_NO_LEASE_GRACE_MS = 10 * 60_000;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * Tool calls that start a parallel worker. The set is deliberately broad: the
 * lane-boundary rule measures that parallel work happened in the turn, not
 * which lane it covered.
 */
const WORKER_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow']);
const DEFAULT_TIMEOUTS = { review: 600_000, answer: 300_000, patch: 1_800_000 };
const DEFAULT_FAILURE_STREAK = 3;
const MAX_ANSWER_CHARS = 12_000;
const MAX_FINDING_CHARS = 2_000;
const MAX_ERROR_CHARS = 4_000;
const MAX_REASON_CHARS = 2_000;
class DelegationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DelegationError';
    }
}
function fail(message) {
    throw new DelegationError(message);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireNonEmpty(value, at) {
    if (typeof value !== 'string' || value.trim() === '') {
        fail(`${at} must be a non-empty string; add a value`);
    }
    return value;
}
function unknownKeys(record, allowed) {
    return Object.keys(record).filter((key) => !allowed.has(key));
}
const TRIGGERS = new Set([
    'manual',
    'spec-ready',
    'spec-task-ready',
    'implementation-work',
    'lane-boundary',
    'implementation-complete',
    'failure-streak',
]);
const CONTRACTS = new Set(['review', 'answer', 'patch', 'note']);
const GATES = new Set(['strict', 'soft', 'none']);
const RULE_KEYS = new Set([
    'id',
    'when',
    'to',
    'instruction',
    'contract',
    'gate',
    'phase',
    'scope',
    'threshold',
    'isolation',
]);
const TARGET_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'agentOptions', 'write']);
const AGENT_OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens']);
const TIMEOUT_KEYS = new Set(['review', 'answer', 'patch']);
/**
 * Validate one row configuration. Configuration mistakes fail the row with the
 * rule/target id and a next action; a missing provider is deliberately not a
 * validation error, so the profile composes without the target installed.
 */
export function validateConfig(raw) {
    if (raw === undefined || raw === null)
        raw = {};
    if (!isRecord(raw))
        fail('configuration must be a mapping');
    const unknownTop = unknownKeys(raw, new Set(['targets', 'rules', 'timeouts', 'failureStreak']));
    if (unknownTop.length > 0) {
        fail(`unknown configuration field(s) ${unknownTop.join(', ')}; use targets, rules, timeouts, or failureStreak`);
    }
    const targetsRaw = raw.targets ?? {};
    if (!isRecord(targetsRaw))
        fail('targets must be a mapping of target id to target');
    const targets = new Map();
    for (const [id, value] of Object.entries(targetsRaw)) {
        if (!ID_PATTERN.test(id)) {
            fail(`target "${id}" is not kebab-case; use lower-case letters, digits, and single dashes`);
        }
        if (!isRecord(value))
            fail(`target "${id}" must be a mapping; add a provider (and optional model)`);
        const unknown = unknownKeys(value, TARGET_KEYS);
        if (unknown.length > 0)
            fail(`target "${id}": unknown field(s) ${unknown.join(', ')}`);
        const provider = requireNonEmpty(value.provider, `target "${id}".provider (a registered ctx.subagents provider name)`);
        const target = { provider };
        if (value.model !== undefined)
            target.model = requireNonEmpty(value.model, `target "${id}".model`);
        if (value.reasoningEffort !== undefined) {
            target.reasoningEffort = requireNonEmpty(value.reasoningEffort, `target "${id}".reasoningEffort`);
        }
        if (value.write !== undefined) {
            if (typeof value.write !== 'boolean')
                fail(`target "${id}".write must be true or false`);
            target.write = value.write;
        }
        if (value.agentOptions !== undefined) {
            if (!isRecord(value.agentOptions))
                fail(`target "${id}".agentOptions must be a mapping`);
            const options = {};
            for (const [key, option] of Object.entries(value.agentOptions)) {
                if (!AGENT_OPTION_KEYS.has(key)) {
                    fail(`target "${id}".agentOptions: unknown option "${key}"; use provider, model, reasoningEffort, or maxTokens`);
                }
                if (key === 'maxTokens') {
                    if (typeof option !== 'number' || !Number.isSafeInteger(option) || option <= 0) {
                        fail(`target "${id}".agentOptions.maxTokens must be a positive integer`);
                    }
                    options.maxTokens = option;
                }
                else {
                    const text = requireNonEmpty(option, `target "${id}".agentOptions.${key}`);
                    if (key === 'provider')
                        options.provider = text;
                    else if (key === 'model')
                        options.model = text;
                    else
                        options.reasoningEffort = text;
                }
            }
            target.agentOptions = options;
        }
        targets.set(id, target);
    }
    const rulesRaw = raw.rules ?? [];
    if (!Array.isArray(rulesRaw))
        fail('rules must be a list');
    const rules = [];
    const seenRules = new Set();
    rulesRaw.forEach((value, index) => {
        const rule = validateRule(value, index, targets);
        if (seenRules.has(rule.id)) {
            fail(`duplicate rule id "${rule.id}"; every rule id must be unique`);
        }
        seenRules.add(rule.id);
        rules.push(rule);
    });
    const strictScopes = new Map();
    for (const rule of rules) {
        if (rule.contract !== 'review' || rule.gate !== 'strict')
            continue;
        const key = `${rule.when}|${rule.scope ?? ''}|${rule.phase ?? ''}`;
        const existing = strictScopes.get(key);
        if (existing !== undefined) {
            fail(`rules "${existing}" and "${rule.id}" both gate the same digest scope as strict; keep one strict rule per trigger/scope/phase or lower one gate`);
        }
        strictScopes.set(key, rule.id);
    }
    const timeouts = { ...DEFAULT_TIMEOUTS };
    const timeoutsRaw = raw.timeouts;
    if (timeoutsRaw !== undefined) {
        if (!isRecord(timeoutsRaw))
            fail('timeouts must be a mapping of contract to milliseconds');
        for (const key of unknownKeys(timeoutsRaw, TIMEOUT_KEYS)) {
            fail(`timeouts: unknown contract "${key}"; use review, answer, or patch`);
        }
        for (const key of ['review', 'answer', 'patch']) {
            const value = timeoutsRaw[key];
            if (value === undefined)
                continue;
            if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
                fail(`timeouts.${key} must be a positive integer number of milliseconds`);
            }
            timeouts[key] = value;
        }
    }
    let failureStreak = DEFAULT_FAILURE_STREAK;
    if (raw.failureStreak !== undefined) {
        if (typeof raw.failureStreak !== 'number' ||
            !Number.isSafeInteger(raw.failureStreak) ||
            raw.failureStreak <= 0) {
            fail('failureStreak must be a positive integer; use it as the default failure-streak threshold');
        }
        failureStreak = raw.failureStreak;
    }
    return { targets, rules, timeouts, failureStreak };
}
function validateRule(raw, index, targets) {
    const at = `rule #${index + 1}`;
    if (!isRecord(raw))
        fail(`${at} must be a mapping`);
    const unknown = unknownKeys(raw, RULE_KEYS);
    if (unknown.length > 0)
        fail(`${at}: unknown field(s) ${unknown.join(', ')}`);
    const id = requireNonEmpty(raw.id, `${at}.id`);
    if (!ID_PATTERN.test(id))
        fail(`rule "${id}" is not kebab-case; use lower-case letters, digits, and single dashes`);
    const where = `rule "${id}"`;
    const when = raw.when;
    if (typeof when !== 'string' || !TRIGGERS.has(when)) {
        fail(`${where}: unknown trigger ${JSON.stringify(when)}; use manual, spec-ready, spec-task-ready, implementation-work, lane-boundary, implementation-complete, or failure-streak`);
    }
    const contract = raw.contract;
    if (typeof contract !== 'string' || !CONTRACTS.has(contract)) {
        fail(`${where}: unknown contract ${JSON.stringify(contract)}; use review, answer, patch, or note`);
    }
    const gate = raw.gate;
    if (typeof gate !== 'string' || !GATES.has(gate)) {
        fail(`${where}: unknown gate ${JSON.stringify(gate)}; use strict, soft, or none`);
    }
    const rule = {
        id,
        when: when,
        contract: contract,
        gate: gate,
    };
    if (when === 'spec-ready') {
        if (contract !== 'review' || raw.scope !== 'whole') {
            fail(`${where}: spec-ready drives a whole-spec review; set contract: review and scope: whole`);
        }
    }
    else if (when === 'spec-task-ready') {
        if (contract !== 'review' || raw.scope !== 'task') {
            fail(`${where}: spec-task-ready drives a task-scoped review; set contract: review and scope: task`);
        }
    }
    else if (when === 'implementation-work') {
        if (contract !== 'note') {
            fail(`${where}: implementation-work is satisfied only by a task progress note; set contract: note`);
        }
    }
    else if (when === 'lane-boundary') {
        if (contract !== 'note') {
            fail(`${where}: lane-boundary is satisfied only by a task progress note; set contract: note`);
        }
    }
    else if (when === 'implementation-complete') {
        if (contract !== 'review' || raw.scope !== 'whole') {
            fail(`${where}: implementation-complete drives a whole-worktree review; set contract: review and scope: whole`);
        }
    }
    else if (when === 'failure-streak') {
        if (contract !== 'answer' && contract !== 'patch') {
            fail(`${where}: a failure streak needs a consultation; set contract: answer or patch`);
        }
        if (gate === 'strict') {
            fail(`${where}: a ${contract} rule writes no gate record; use gate: soft or none`);
        }
    }
    else if (contract === 'note') {
        fail(`${where}: manual rules cannot use the note contract; use task_progress directly`);
    }
    if (contract === 'note') {
        for (const forbidden of [
            'to',
            'instruction',
            'phase',
            'scope',
            'isolation',
            'threshold',
        ]) {
            if (raw[forbidden] !== undefined)
                fail(`${where}: a note rule takes no "${forbidden}"`);
        }
        if (raw.when !== 'implementation-work' && raw.when !== 'lane-boundary') {
            fail(`${where}: only the implementation-work and lane-boundary triggers use a note rule`);
        }
    }
    else {
        const to = requireNonEmpty(raw.to, `${where}.to (a configured target id)`);
        if (!targets.has(to)) {
            fail(`${where}: target "${to}" is not configured; add targets.${to} or point the rule at a configured target`);
        }
        rule.to = to;
        if (contract === 'review' || contract === 'answer' || contract === 'patch') {
            const instruction = requireNonEmpty(raw.instruction, `${where}.instruction (bundled:<name> or inline text)`);
            rule.instruction = instruction;
            if (instruction.startsWith('bundled:')) {
                const asset = instruction.slice('bundled:'.length);
                if (!ID_PATTERN.test(asset)) {
                    fail(`${where}: bundled instruction "${asset}" is not kebab-case; use bundled:review-spec-style names`);
                }
                if (!existsSync(join(assetsDirectory, `${asset}.md`))) {
                    fail(`${where}: bundled instruction "${asset}" does not exist; use one of the bundled assets`);
                }
            }
        }
    }
    if (contract === 'review') {
        if (raw.scope !== 'whole' && raw.scope !== 'task') {
            fail(`${where}: a review rule needs scope: whole or scope: task`);
        }
        rule.scope = raw.scope;
        if (raw.scope === 'whole') {
            const phase = requireNonEmpty(raw.phase, `${where}.phase (the record key for the whole-scope review)`);
            if (!ID_PATTERN.test(phase)) {
                fail(`${where}: phase "${phase}" is not kebab-case; it names the record file`);
            }
            rule.phase = phase;
        }
        else if (raw.phase !== undefined) {
            fail(`${where}: a task-scoped review has no phase; its record is keyed by the task id`);
        }
    }
    else if (raw.scope !== undefined || raw.phase !== undefined) {
        fail(`${where}: only a review rule takes phase/scope`);
    }
    if (contract === 'patch') {
        if (raw.isolation !== 'worktree') {
            fail(`${where}: a patch rule must declare isolation: worktree so the diff is never auto-applied`);
        }
        rule.isolation = 'worktree';
        const target = targets.get(rule.to ?? '');
        if (target?.write !== true) {
            fail(`${where}: target "${rule.to}" is not declared write-capable; set targets.${rule.to}.write: true only when that provider may modify files`);
        }
    }
    else if (raw.isolation !== undefined) {
        fail(`${where}: isolation belongs only to a patch rule`);
    }
    if (raw.threshold !== undefined) {
        if (when !== 'failure-streak')
            fail(`${where}: threshold belongs only to a failure-streak rule`);
        if (typeof raw.threshold !== 'number' ||
            !Number.isSafeInteger(raw.threshold) ||
            raw.threshold <= 0) {
            fail(`${where}: threshold must be a positive integer`);
        }
        rule.threshold = raw.threshold;
    }
    if (when === 'manual' && gate !== 'none') {
        fail(`${where}: a manual rule has no automatic condition; set gate: none`);
    }
    return rule;
}
/** Fixed-argument git runner. The shell is never used, so no input is interpolated. */
export function defaultGit(args, cwd, signal, env, stdin) {
    return new Promise((done, failed) => {
        const child = spawn('git', [...args], {
            cwd,
            signal,
            windowsHide: true,
            ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
        });
        const chunks = [];
        let stderr = '';
        let stdinFailure;
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => {
            if (stderr.length < 2_000)
                stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            failed(new DelegationError(`git ${args[0] ?? 'command'} failed: ${error.message}`));
        });
        child.on('close', (code) => {
            if (code === 0) {
                if (stdinFailure === undefined) {
                    done(Buffer.concat(chunks));
                    return;
                }
                failed(new DelegationError(`git ${args[0] ?? 'command'} could not receive stdin: ${stdinFailure.message}`));
                return;
            }
            const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300);
            failed(new DelegationError(`git ${args[0] ?? 'command'} failed (exit ${code ?? 'unknown'})${detail ? `: ${detail}` : ''}`));
        });
        // Close stdin so a command that reads it (update-index --stdin) gets EOF.
        // Keep any write failure: a zero exit must not hide undelivered input.
        child.stdin.on('error', (error) => {
            stdinFailure = error;
        });
        child.stdin.end(stdin);
    });
}
function hashParts(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(part);
        hash.update('\0');
    }
    return hash.digest('hex');
}
async function readTasks(changeDir) {
    return parseTasksText(await readFile(join(changeDir, 'tasks.md'), 'utf8'));
}
async function statSafe(path) {
    try {
        const info = await stat(path);
        if (info.isFile())
            return 'file';
        if (info.isDirectory())
            return 'directory';
        return undefined;
    }
    catch {
        return undefined;
    }
}
async function listDirectory(path) {
    try {
        return (await readdir(path, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
/** Nearest ancestor that contains `openspec/changes`, from a possibly nested cwd. */
async function findOpenSpecRoot(cwd) {
    let current = resolve(cwd);
    for (;;) {
        if ((await statSafe(join(current, 'openspec', 'changes'))) === 'directory') {
            return join(current, 'openspec');
        }
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
/** Synchronous workspace-root lookup for event-time write evidence. */
function findOpenSpecRootSync(cwd) {
    let current = resolve(cwd);
    for (;;) {
        try {
            if (statSync(join(current, 'openspec', 'changes')).isDirectory()) {
                return join(current, 'openspec');
            }
        }
        catch {
            // Keep walking up.
        }
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
async function readChange(openspecRoot, changeName) {
    if (!CHANGE_PATTERN.test(changeName))
        return undefined;
    const dir = join(openspecRoot, 'changes', changeName);
    if ((await statSafe(dir)) !== 'directory')
        return undefined;
    const reviewReady = await isReviewReady(dir);
    return { name: changeName, dir, reviewReady };
}
async function isReviewReady(dir) {
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
        if ((await statSafe(join(dir, file))) !== 'file')
            return false;
    }
    const specs = await listDirectory(join(dir, 'specs'));
    if (specs.length === 0)
        return false;
    for (const spec of specs) {
        if ((await statSafe(join(dir, 'specs', spec, 'spec.md'))) === 'file')
            return true;
    }
    return false;
}
/** Active changes only: `archive/` and non-change directories are ignored. */
async function listActiveChanges(openspecRoot) {
    const names = await listDirectory(join(openspecRoot, 'changes'));
    const changes = [];
    for (const name of names.sort()) {
        if (name === 'archive' || !CHANGE_PATTERN.test(name))
            continue;
        const change = await readChange(openspecRoot, name);
        if (change !== undefined)
            changes.push(change);
    }
    return changes;
}
/** Resolve the requested change, or the only active one, with an actionable error. */
async function openChange(cwd, requested) {
    const openspecRoot = await findOpenSpecRoot(cwd);
    if (openspecRoot === undefined) {
        fail('no openspec/changes directory was found from the session working directory; run the rule from an OpenSpec repository root');
    }
    if (requested !== undefined) {
        if (!CHANGE_PATTERN.test(requested)) {
            fail(`change "${requested}" is not a plain change name; pass the directory name under openspec/changes`);
        }
        const change = await readChange(openspecRoot, requested);
        if (change === undefined) {
            const names = (await listActiveChanges(openspecRoot)).map((entry) => entry.name);
            fail(`change "${requested}" was not found under openspec/changes; active changes: ${names.join(', ') || '(none)'}`);
        }
        return { change, openspecRoot };
    }
    const changes = await listActiveChanges(openspecRoot);
    if (changes.length === 0)
        fail('no active OpenSpec change was found under openspec/changes; create or resume a change first');
    if (changes.length > 1) {
        fail(`multiple active OpenSpec changes (${changes.map((entry) => entry.name).join(', ')}); pass change: to choose one`);
    }
    return { change: changes[0], openspecRoot };
}
/** Hash every change artifact, normalizing `tasks.md` checkbox state. */
export async function specDigest(changeDir, signal) {
    const files = [];
    async function walk(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (signal?.aborted === true)
                fail('spec digest was cancelled');
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                // The portable approval directory is not a change artifact.
                if (relative(changeDir, path).split(sep).join('/') === REVIEWS_DIRECTORY)
                    continue;
                await walk(path);
            }
            else if (entry.isFile())
                files.push(path);
        }
    }
    try {
        await walk(changeDir);
    }
    catch (error) {
        fail(`could not read the change directory for the spec digest: ${errorMessage(error)}`);
    }
    files.sort();
    const parts = ['change-artifacts-v1'];
    for (const file of files) {
        const name = relative(changeDir, file).split(sep).join('/');
        if (name === '.openspec.yaml')
            continue;
        let content = await readFile(file, 'utf8');
        if (name === 'tasks.md')
            content = content.replace(/^(\s*-\s*)\[[xX]\]/gm, '$1[ ]');
        parts.push(name, content);
    }
    return hashParts(parts);
}
/** Path entries and diff bytes, ignoring delegation state and scratch files. */
function ignoredForDigest(path) {
    return path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/');
}
/** Files that count as implementation work rather than documentation/plan state. */
function isImplementationPath(path) {
    if (ignoredForDigest(path))
        return false;
    if (path === 'docs' || path.startsWith('docs/'))
        return false;
    if (path === 'openspec' || path.startsWith('openspec/'))
        return false;
    if (path === 'market' || path.startsWith('market/'))
        return false;
    return !/\.(?:md|mdx)$/i.test(path);
}
function parseStatus(raw) {
    const entries = [];
    const tokens = raw.toString('utf8').split('\0');
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.length < 4)
            continue;
        const code = token.slice(0, 2);
        const path = token.slice(3);
        entries.push({ code, path });
        if (code.startsWith('R') || code.startsWith('C'))
            index += 1;
    }
    return entries;
}
async function repositoryRoot(cwd, services, signal) {
    try {
        const raw = (await services.runGit(['rev-parse', '--show-toplevel'], cwd, signal))
            .toString('utf8')
            .trim();
        return raw === '' ? cwd : resolve(raw);
    }
    catch {
        return cwd;
    }
}
async function worktreeDigest(cwd, services, signal) {
    const root = await repositoryRoot(cwd, services, signal);
    const status = await services.runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal);
    const entries = parseStatus(status);
    const visible = entries.filter((entry) => !ignoredForDigest(entry.path));
    const parts = ['worktree-v1'];
    for (const entry of visible.sort((left, right) => left.path.localeCompare(right.path))) {
        parts.push(`${entry.code} ${entry.path}`);
        if (entry.code === '??') {
            try {
                parts.push(await readFile(resolve(root, entry.path)));
            }
            catch {
                parts.push('[unreadable]');
            }
        }
    }
    parts.push(await services.runGit(['diff', '--binary', 'HEAD'], cwd, signal));
    return hashParts(parts);
}
/**
 * Build the disposable task-review snapshot from the exact review input set.
 * Returns undefined when it cannot be built safely; the caller reviews the live
 * worktree with the mutation guard instead.
 */
export async function createReviewSnapshot(cwd, change, runId, runGit, signal, 
/** Test seam: runs after the change directory is frozen, before its digest. */
afterCopy) {
    await sweepReviewSnapshots(cwd, runGit);
    const services = { runGit };
    const root = await repositoryRoot(cwd, services, signal);
    const relChange = relative(root, change.dir).split(sep).join('/');
    if (relChange === '' ||
        relChange === '.' ||
        relChange === '..' ||
        relChange.startsWith('../') ||
        isAbsolute(relChange)) {
        return undefined;
    }
    // A lexical path is not enough: a symlinked or junctioned change directory can
    // resolve outside the repository, and copying the link would keep the snapshot
    // pointing at live files.
    try {
        const canonicalRel = relative(await realpath(root), await realpath(change.dir));
        if (canonicalRel === '' ||
            canonicalRel === '.' ||
            canonicalRel === '..' ||
            canonicalRel.startsWith(`..${sep}`) ||
            isAbsolute(canonicalRel)) {
            return undefined;
        }
    }
    catch {
        return undefined;
    }
    try {
        // A tracked or unignored .dsh would put the checkout inside the reviewed tree.
        // The directory must exist for a directory-only ignore rule to match.
        await mkdir(resolve(cwd, SCRATCH_DIR), { recursive: true });
        await runGit(['check-ignore', '-q', '--no-index', '.dsh'], cwd, signal);
    }
    catch {
        return undefined;
    }
    try {
        if ((await runGit(['ls-files', '-u'], root, signal)).toString('utf8').trim() !== '') {
            return undefined;
        }
    }
    catch {
        return undefined;
    }
    const worktree = resolve(cwd, SNAPSHOT_DIR, runId);
    const scratch = resolve(cwd, SCRATCH_DIR, `${runId}.index`);
    const env = { GIT_INDEX_FILE: scratch };
    try {
        const listed = (await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, signal)).toString('utf8');
        const paths = [];
        for (const path of listed.split('\0')) {
            if (path === '' || ignoredForDigest(path))
                continue;
            if (path === relChange || path.startsWith(`${relChange}/`))
                continue;
            try {
                await lstat(resolve(root, path));
            }
            catch {
                // A tracked path deleted from the worktree is what a live review sees.
                continue;
            }
            paths.push(path);
        }
        await mkdir(dirname(scratch), { recursive: true });
        await mkdir(dirname(worktree), { recursive: true });
        if (paths.length > 0) {
            await runGit(['update-index', '--add', '-z', '--stdin'], root, signal, env, `${paths.join('\0')}\0`);
        }
        const tree = (await runGit(['write-tree'], root, signal, env)).toString('utf8').trim();
        let parent;
        try {
            parent = (await runGit(['rev-parse', '--verify', 'HEAD'], root, signal))
                .toString('utf8')
                .trim();
        }
        catch {
            parent = undefined;
        }
        const commit = (await runGit([
            '-c',
            'user.name=dsh-delegation',
            '-c',
            'user.email=delegation@localhost',
            'commit-tree',
            tree,
            ...(parent === undefined ? [] : ['-p', parent]),
            '-m',
            'delegation: reviewed snapshot',
        ], root, signal))
            .toString('utf8')
            .trim();
        // The lease is written before the checkout exists, so a crash cannot leave
        // an unowned worktree; the sweep preserves a valid lease without a directory.
        await startSnapshotLease(cwd, runId);
        await runGit(['worktree', 'add', '--detach', worktree, commit], root, signal);
        const frozenChange = resolve(worktree, relChange);
        await mkdir(dirname(frozenChange), { recursive: true });
        await cp(change.dir, frozenChange, { recursive: true, force: true, dereference: true });
        if (afterCopy !== undefined)
            await afterCopy();
        const frozenSpec = await specDigest(frozenChange, signal);
        return { tree, commit, worktree, changeDir: frozenChange, specDigest: frozenSpec };
    }
    catch {
        await discardReviewSnapshot(cwd, runId, runGit);
        return undefined;
    }
}
const snapshotLeases = new Map();
/** Last per-workspace sweep time, for the throttle. */
const snapshotSweeps = new Map();
function snapshotKey(cwd, runId) {
    return `${resolve(cwd, SNAPSHOT_DIR)}\u0000${runId}`;
}
function snapshotLeasePath(cwd, runId) {
    return `${resolve(cwd, SNAPSHOT_DIR, runId)}.lease`;
}
async function readSnapshotLease(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        return typeof value.expiresAt === 'number' ? value.expiresAt : undefined;
    }
    catch {
        return undefined;
    }
}
async function writeSnapshotLease(cwd, runId) {
    await writeJsonAtomic(snapshotLeasePath(cwd, runId), {
        runId,
        expiresAt: Date.now() + SNAPSHOT_LEASE_MS,
    });
}
/**
 * Write the initial lease and start renewing it. The initial write is awaited,
 * so a lease exists before the worktree it protects is created.
 */
export async function startSnapshotLease(cwd, runId, refreshMs = SNAPSHOT_REFRESH_MS) {
    const state = { stopped: false, writes: writeSnapshotLease(cwd, runId) };
    const timer = setInterval(() => {
        if (state.stopped)
            return;
        state.writes = state.writes.then(() => writeSnapshotLease(cwd, runId)).catch(() => undefined);
    }, refreshMs);
    timer.unref();
    state.timer = timer;
    snapshotLeases.set(snapshotKey(cwd, runId), state);
    await state.writes;
}
/** Stop renewal and await any in-flight write, so none lands after cleanup. */
export async function stopSnapshotLease(cwd, runId) {
    const key = snapshotKey(cwd, runId);
    const state = snapshotLeases.get(key);
    if (state === undefined)
        return;
    state.stopped = true;
    if (state.timer !== undefined)
        clearInterval(state.timer);
    snapshotLeases.delete(key);
    await state.writes.catch(() => undefined);
}
/**
 * Remove snapshots no live run owns. Ownership is the lease, never age or the
 * configured review timeout; a lease-less directory is given a grace period.
 * Orphaned leases before creation, scratch indexes, and stale worktree metadata
 * are also retried here. Runs at most once per throttle window and never throws.
 */
export async function sweepReviewSnapshots(cwd, runGit, now = Date.now()) {
    const dir = resolve(cwd, SNAPSHOT_DIR);
    if (now - (snapshotSweeps.get(dir) ?? 0) < SNAPSHOT_SWEEP_MS)
        return;
    snapshotSweeps.set(dir, now);
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        entries = [];
    }
    for (const entry of entries) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            const runId = entry.name;
            const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            if (expiresAt === undefined) {
                try {
                    if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                        continue;
                }
                catch {
                    continue;
                }
            }
            await discardReviewSnapshot(cwd, runId, runGit);
            continue;
        }
        if (entry.name.endsWith('.tmp') && entry.name.includes('.lease.')) {
            // An abandoned atomic-write temporary of a lease.
            const runId = entry.name.slice(0, entry.name.indexOf('.lease.'));
            const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            const path = resolve(dir, entry.name);
            try {
                if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                    continue;
            }
            catch {
                continue;
            }
            try {
                await unlink(path);
            }
            catch {
                // Missing is fine.
            }
            continue;
        }
        if (entry.name.endsWith('.lease')) {
            const runId = entry.name.slice(0, -'.lease'.length);
            if (existsSync(resolve(dir, runId)))
                continue;
            // A valid lease without a directory is a run between lease and creation.
            const expiresAt = await readSnapshotLease(path);
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            try {
                await unlink(path);
            }
            catch {
                // Missing is fine.
            }
        }
    }
    // A failed settlement removal can leave only the scratch index behind.
    let scratchEntries = [];
    try {
        scratchEntries = await readdir(resolve(cwd, SCRATCH_DIR), { withFileTypes: true });
    }
    catch {
        scratchEntries = [];
    }
    for (const entry of scratchEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.index'))
            continue;
        const runId = entry.name.slice(0, -'.index'.length);
        const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
        if (expiresAt !== undefined && expiresAt > now)
            continue;
        const path = resolve(cwd, SCRATCH_DIR, entry.name);
        try {
            if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                continue;
        }
        catch {
            continue;
        }
        try {
            await unlink(path);
        }
        catch {
            // Retried by a later sweep.
        }
    }
    // Prune whenever the throttle allows, even when nothing was removed: a failed
    // prune must not wait for another directory removal to be retried.
    try {
        await runGit(['worktree', 'prune'], cwd);
    }
    catch {
        // Pruning is best effort.
    }
}
/** Remove one snapshot checkout, its lease, and its scratch index; best effort. */
export async function discardReviewSnapshot(cwd, runId, runGit, 
/** Test seam: the filesystem remover, so a failed removal can be injected. */
remove = (path) => rm(path, { recursive: true, force: true })) {
    await stopSnapshotLease(cwd, runId);
    const worktree = resolve(cwd, SNAPSHOT_DIR, runId);
    try {
        await runGit(['worktree', 'remove', '--force', worktree], cwd);
    }
    catch {
        // Not a registered worktree, already gone, or not a Git checkout.
    }
    for (const path of [worktree, resolve(cwd, SCRATCH_DIR, `${runId}.index`), `${worktree}.lease`]) {
        try {
            await remove(path);
        }
        catch {
            // Scratch leftovers are retried by the sweep.
        }
    }
}
async function implementationFingerprint(cwd, services, signal) {
    const root = await repositoryRoot(cwd, services, signal);
    const status = await services.runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal);
    const entries = parseStatus(status).filter((entry) => isImplementationPath(entry.path));
    const parts = ['implementation-v1'];
    for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
        parts.push(`${entry.code} ${entry.path}`);
        try {
            parts.push(await readFile(resolve(root, entry.path)));
        }
        catch {
            parts.push('[deleted]');
        }
    }
    return hashParts(parts);
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function captureSnapshot(cwd, changes, services, signal) {
    const snapshot = { changes: [] };
    try {
        snapshot.digest = await worktreeDigest(cwd, services, signal);
    }
    catch (error) {
        snapshot.digestError = errorMessage(error);
    }
    try {
        snapshot.implementationFingerprint = await implementationFingerprint(cwd, services, signal);
    }
    catch {
        snapshot.implementationFingerprint = undefined;
    }
    for (const change of changes) {
        const entry = { name: change.name, tasks: [] };
        // The artifact digest is independent of task parsing: a change whose
        // tasks.md is missing still has a digest, so a later write is detectable.
        try {
            entry.specDigest = await specDigest(change.dir, signal);
        }
        catch (error) {
            entry.error = `change artifacts are unreadable (${errorMessage(error)})`;
        }
        try {
            entry.tasks = await readTasks(change.dir);
        }
        catch (error) {
            // A change artifact problem stays per-change; it is not a worktree git failure.
            entry.error = `tasks.md is missing or unreadable (${errorMessage(error)})`;
        }
        snapshot.changes.push(entry);
    }
    return snapshot;
}
function sanitizeText(text, maximum = MAX_FINDING_CHARS) {
    const redacted = text
        .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, '[path]')
        .replace(/\\\\[^\s"'`)]+/g, '[path]')
        .replace(/(?:^|\s)\/(?:Users|home)\/[^\s"'`)]+/g, ' [path]')
        .replace(/\b(?:sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/g, '[secret]')
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[secret]');
    return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1)}…`;
}
function relativePath(cwd, path) {
    return relative(cwd, path).split(sep).join('/');
}
function recordPath(cwd, rule, change, taskId) {
    if (rule.scope === 'task') {
        if (taskId === undefined || !TASK_ID_PATTERN.test(taskId)) {
            fail(`rule "${rule.id}": a task-scoped record needs a stable task id`);
        }
        return join(cwd, DELEGATION_DIR, rule.id, change, 'tasks', `${taskId}.json`);
    }
    if (rule.phase === undefined)
        fail(`rule "${rule.id}": a whole-scope record needs a phase`);
    return join(cwd, DELEGATION_DIR, rule.id, change, `${rule.phase}.json`);
}
function notePath(cwd, change) {
    return join(cwd, DELEGATION_DIR, 'task-progress', `${change}.json`);
}
function currentThread(agent) {
    return String(agent.session.id);
}
function sessionsDirectory(workspaceRoot) {
    return join(workspaceRoot, DELEGATION_DIR, 'sessions');
}
function involvementFile(workspaceRoot, session) {
    // Hashed file name: no path characters and no Windows device-name collisions.
    const name = createHash('sha256').update(session).digest('hex').slice(0, 16);
    return join(sessionsDirectory(workspaceRoot), `${name}.json`);
}
function emptyInvolvement(session) {
    return { session, changes: Object.create(null) };
}
function freshEntry() {
    return { created: false, specChanged: false, tasks: [], completed: false };
}
function parseInvolvement(value, session) {
    if (!isRecord(value) || value.session !== session || !isRecord(value.changes))
        return undefined;
    const involvement = emptyInvolvement(session);
    for (const [name, raw] of Object.entries(value.changes)) {
        if (!CHANGE_PATTERN.test(name) || !isRecord(raw))
            return undefined;
        if (typeof raw.created !== 'boolean' ||
            typeof raw.specChanged !== 'boolean' ||
            typeof raw.completed !== 'boolean' ||
            !Array.isArray(raw.tasks) ||
            !raw.tasks.every((task) => typeof task === 'string' && TASK_ID_PATTERN.test(task))) {
            return undefined;
        }
        involvement.changes[name] = {
            created: raw.created,
            specChanged: raw.specChanged,
            tasks: [...raw.tasks],
            completed: raw.completed,
        };
    }
    return involvement;
}
/** Missing state is empty; malformed state is empty plus a status warning, never a failure. */
async function readInvolvement(workspaceRoot, session) {
    const file = involvementFile(workspaceRoot, session);
    let raw;
    try {
        raw = await readFile(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { involvement: emptyInvolvement(session) };
        }
        return {
            involvement: emptyInvolvement(session),
            warning: `session involvement at ${relativePath(workspaceRoot, file)} is unreadable (${errorMessage(error)}); treating it as empty`,
        };
    }
    try {
        const parsed = parseInvolvement(JSON.parse(raw), session);
        if (parsed !== undefined)
            return { involvement: parsed };
    }
    catch {
        // Fall through to the malformed warning.
    }
    return {
        involvement: emptyInvolvement(session),
        warning: `session involvement at ${relativePath(workspaceRoot, file)} is malformed; treating it as empty (delete it to reset)`,
    };
}
async function writeInvolvement(workspaceRoot, involvement) {
    await writeJsonAtomic(involvementFile(workspaceRoot, involvement.session), involvement);
}
/** Serialize one session's read-modify-write involvement updates in this process. */
const involvementWrites = new Map();
async function withInvolvementLock(workspaceRoot, session, task) {
    const key = `${workspaceRoot}\u0000${session}`;
    const previous = involvementWrites.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
        release = resolve;
    });
    const queued = previous.then(() => current);
    involvementWrites.set(key, queued);
    await previous;
    try {
        return await task();
    }
    finally {
        release();
        if (involvementWrites.get(key) === queued)
            involvementWrites.delete(key);
    }
}
function involvementEntry(involvement, change) {
    let entry = involvement.changes[change];
    if (entry === undefined) {
        entry = freshEntry();
        involvement.changes[change] = entry;
    }
    return entry;
}
function involvementSummary(entry, checkedTasks) {
    const parts = [];
    if (entry.created)
        parts.push('created');
    if (entry.specChanged)
        parts.push('spec changed');
    parts.push(`${checkedTasks} checked task(s)`);
    return parts.join(' / ');
}
function freshEvidence() {
    return { creation: false, outsideTasks: false, taskWrites: [], opaqueTaskWrite: false };
}
/** Resolve `openspec/changes/<change>/<file>` from an absolute or relative path. */
function changeFromEvidencePath(path) {
    const normalized = path.replaceAll('\\', '/');
    const marker = 'openspec/changes/';
    const index = normalized.lastIndexOf(marker);
    if (index < 0)
        return undefined;
    if (index > 0 && normalized[index - 1] !== '/')
        return undefined;
    const rest = normalized.slice(index + marker.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1)
        return undefined;
    const change = rest.slice(0, slash);
    if (!CHANGE_PATTERN.test(change) || change === 'archive')
        return undefined;
    return { change, file: rest.slice(slash + 1) };
}
/** Resolve a write path only when it lands inside this workspace's active change. */
function evidenceTarget(workspaceCwd, executionCwd, rawPath) {
    const path = rawPath.trim();
    if (path === '')
        return undefined;
    const target = changeFromEvidencePath(path);
    if (target === undefined)
        return undefined;
    const openspecRoot = findOpenSpecRootSync(workspaceCwd);
    if (openspecRoot === undefined)
        return undefined;
    const activeDir = resolve(openspecRoot, 'changes', target.change);
    try {
        if (!statSync(activeDir).isDirectory())
            return undefined;
    }
    catch {
        return undefined;
    }
    const absolute = resolve(executionCwd, path);
    const rel = relative(activeDir, absolute);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel))
        return undefined;
    return target;
}
const CONTROL_COMMANDS = new Set([
    'if',
    'else',
    'elseif',
    'for',
    'foreach',
    'while',
    'do',
    'switch',
    'try',
    'catch',
    'finally',
    'function',
    'filter',
    'begin',
    'process',
    'end',
    'return',
    'throw',
    'exit',
    'param',
    'using',
    'class',
    'enum',
    'trap',
]);
const SIMPLE_REJECT = new Set(['{', '}', '(', ')']);
const WRITE_VERBS = new Set([
    'set-content',
    'add-content',
    'out-file',
    'copy-item',
    'move-item',
    'new-item',
    'rename-item',
    'remove-item',
    'cp',
    'mv',
    'rm',
    'touch',
    'tee',
]);
const VALUE_OPTIONS = new Set([
    '-value',
    '-encoding',
    '-itemtype',
    '-type',
    '-name',
    '-newname',
    '-path',
    '-literalpath',
    '-filepath',
    '-destination',
    '-filter',
    '-include',
    '-exclude',
    '-erroraction',
]);
/**
 * One explicit simple command form, or undefined for compound/control syntax.
 * Splitting a compound command would let a skipped branch attribute writes.
 */
function simpleCommand(command) {
    const segments = shellSegments(command);
    if (segments.length !== 1)
        return undefined;
    const tokens = segments[0]?.tokens ?? [];
    if (tokens.length === 0)
        return undefined;
    if (tokens[0].quoted)
        return undefined;
    if (CONTROL_COMMANDS.has(tokens[0].value.toLowerCase()))
        return undefined;
    // PowerShell preview switches never perform the write they name.
    if (tokens.some((token) => !token.quoted && /^-(?:whatif|wi|wh|what|whati)(?::|$)/iu.test(token.value))) {
        return undefined;
    }
    if (tokens.some((token) => SIMPLE_REJECT.has(token.value)))
        return undefined;
    return [...tokens];
}
/** Skip option values so the returned tokens are positional arguments only. */
function positionalTokens(args) {
    const tokens = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg.startsWith('-')) {
            if (VALUE_OPTIONS.has(arg.toLowerCase()))
                index += 1;
            continue;
        }
        tokens.push(arg);
    }
    return tokens;
}
function namedArgument(args, names) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index].toLowerCase();
        for (const name of names) {
            if (arg === name)
                return args[index + 1];
            if (arg.startsWith(`${name}:`))
                return args[index].slice(name.length + 1);
        }
    }
    return undefined;
}
function writeDestination(verb, args) {
    const positional = positionalTokens(args);
    if (/^(?:copy-item|move-item|cp|mv)$/u.test(verb)) {
        return namedArgument(args, ['-destination']) ?? positional[positional.length - 1];
    }
    return namedArgument(args, ['-path', '-literalpath', '-filepath']) ?? positional[0];
}
/** Only actual destinations inside this workspace; ambiguous forms stay unattributed. */
function shellWriteTargets(workspaceCwd, executionCwd, tokens) {
    const targets = [];
    for (let index = 0; index < tokens.length - 1; index += 1) {
        const token = tokens[index];
        if (token.quoted || (token.value !== '>' && token.value !== '>>'))
            continue;
        const target = evidenceTarget(workspaceCwd, executionCwd, tokens[index + 1].value);
        if (target !== undefined)
            targets.push(target);
    }
    const verb = (tokens[0].value ?? '').toLowerCase();
    if (!WRITE_VERBS.has(verb))
        return targets;
    const destination = writeDestination(verb, tokens.slice(1).map((token) => token.value));
    const target = destination === undefined ? undefined : evidenceTarget(workspaceCwd, executionCwd, destination);
    if (target !== undefined)
        targets.push(target);
    return targets;
}
// shortcut: shell evidence watches only one explicit simple command; quoted
// examples, comments, argument text, control/compound syntax, quoted
// operators, ambiguous option positions, and cross-workspace paths stay
// unattributed and need task_progress or an explicit review/patch delegate.
function recordWriteEvidence(state, agentId, cwd, exec, result) {
    if (result.isError)
        return;
    const args = isRecord(exec.arguments) ? exec.arguments : {};
    const value = isRecord(result.value) ? result.value : undefined;
    if (exec.name === 'edit' || exec.name === 'write') {
        const canonical = typeof value?.path === 'string' ? value.path : undefined;
        const argumentPath = typeof args.file_path === 'string' ? args.file_path : undefined;
        const path = canonical ?? (argumentPath === undefined ? undefined : resolve(cwd, argumentPath));
        if (path === undefined)
            return;
        const target = evidenceTarget(cwd, cwd, path);
        if (target === undefined)
            return;
        const evidence = state.evidenceFor(agentId, target.change);
        if (target.file === 'tasks.md') {
            if (value !== undefined &&
                (value.before === null || typeof value.before === 'string') &&
                typeof value.after === 'string') {
                evidence.taskWrites.push({ before: value.before, after: value.after });
            }
            else {
                evidence.opaqueTaskWrite = true;
            }
        }
        else {
            evidence.outsideTasks = true;
        }
        return;
    }
    if (exec.name !== 'pwsh' && exec.name !== 'bash')
        return;
    const command = typeof args.command === 'string' ? args.command : undefined;
    if (command === undefined)
        return;
    // The installed shell tool reports ordinary command failures as a successful
    // tool call with a nonzero exit; a failed command wrote nothing attributable.
    if (value === undefined || value.exitCode !== 0)
        return;
    const workspaceRoot = findOpenSpecRootSync(cwd);
    const reportedCwd = typeof value.cwd === 'string' ? value.cwd : undefined;
    const executionCwd = reportedCwd !== undefined
        ? resolve(cwd, reportedCwd)
        : typeof args.workdir === 'string'
            ? resolve(cwd, args.workdir)
            : cwd;
    const tokens = simpleCommand(command);
    const executionRoot = findOpenSpecRootSync(executionCwd);
    if (tokens !== undefined) {
        if (workspaceRoot !== undefined &&
            executionRoot === workspaceRoot &&
            tokens[0].value.toLowerCase() === 'openspec' &&
            tokens[1]?.value.toLowerCase() === 'new' &&
            tokens[2]?.value.toLowerCase() === 'change') {
            const change = tokens[3]?.value ?? '';
            if (CHANGE_PATTERN.test(change))
                state.evidenceFor(agentId, change).creation = true;
        }
        for (const target of shellWriteTargets(cwd, executionCwd, tokens)) {
            const evidence = state.evidenceFor(agentId, target.change);
            if (target.file === 'tasks.md')
                evidence.opaqueTaskWrite = true;
            else
                evidence.outsideTasks = true;
        }
    }
}
/**
 * Attribute this turn's evidence. The snapshot baseline identifies a newly
 * created change and the current list; per-write canonical contents identify
 * checkbox transitions and substantive edits.
 */
function applyTurnEvidence(involvement, evidence, baseline, current) {
    let changed = false;
    for (const [name, changeEvidence] of evidence) {
        const currentChange = current.changes.find((entry) => entry.name === name);
        if (currentChange === undefined)
            continue;
        const previous = JSON.stringify(involvement.changes[name]);
        const entry = involvementEntry(involvement, name);
        const existed = baseline.changes.some((change) => change.name === name);
        if (!existed && changeEvidence.creation) {
            entry.created = true;
            entry.specChanged = true;
        }
        else if (changeEvidence.outsideTasks) {
            entry.specChanged = true;
        }
        let writeCompletedList = false;
        for (const write of changeEvidence.taskWrites) {
            const beforeText = write.before ?? '';
            if (normalizeCheckboxes(write.after) !== normalizeCheckboxes(beforeText)) {
                entry.specChanged = true;
            }
            const checkedBefore = new Set(parseTasksText(beforeText)
                .filter((task) => task.checked)
                .map((task) => task.id));
            const afterTasks = parseTasksText(write.after);
            let addedInWrite = false;
            for (const task of afterTasks) {
                if (!task.checked || checkedBefore.has(task.id))
                    continue;
                if (!entry.tasks.includes(task.id))
                    entry.tasks.push(task.id);
                addedInWrite = true;
            }
            if (addedInWrite && afterTasks.length > 0 && afterTasks.every((task) => task.checked)) {
                writeCompletedList = true;
            }
        }
        if (writeCompletedList &&
            currentChange.tasks.length > 0 &&
            currentChange.tasks.every((task) => task.checked)) {
            entry.completed = true;
        }
        if (JSON.stringify(involvement.changes[name]) !== previous)
            changed = true;
    }
    return changed;
}
async function writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await rename(temporary, path);
    }
    finally {
        // A failed write or rename must not leave the temporary file behind.
        await unlink(temporary).catch(() => undefined);
    }
}
function runsDirectory(workspaceRoot) {
    return join(workspaceRoot, DELEGATION_DIR, 'runs');
}
function runFilePath(workspaceRoot, runId) {
    return join(runsDirectory(workspaceRoot), `${runId}.json`);
}
function reviewConversationKey(change, task, rule) {
    return task !== undefined
        ? `${change}\u0000task\u0000${task.id}`
        : `${change}\u0000whole\u0000${rule.phase ?? 'review'}`;
}
function reviewIdentity(rule, change, task) {
    return `${rule.id}\u0000${change}\u0000${task?.id ?? rule.phase ?? 'whole'}`;
}
/** Human/provider-readable key marker; a provider may resume one conversation per key. */
function reviewKeyForPrompt(change, task, rule) {
    return task !== undefined
        ? `review:${change}:task:${task.id}`
        : `review:${change}:whole:${rule.phase ?? 'review'}`;
}
function isRunState(value) {
    return (value === 'queued' ||
        value === 'running' ||
        value === 'completed' ||
        value === 'failed' ||
        value === 'discarded');
}
function parseRunFile(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.id !== 'string' ||
        value.id === '' ||
        typeof value.rule !== 'string' ||
        typeof value.change !== 'string' ||
        typeof value.key !== 'string' ||
        typeof value.identity !== 'string' ||
        !isRunState(value.state) ||
        typeof value.record !== 'string' ||
        typeof value.startedAt !== 'string') {
        return undefined;
    }
    if (value.taskId !== undefined && typeof value.taskId !== 'string')
        return undefined;
    if (value.detail !== undefined && typeof value.detail !== 'string')
        return undefined;
    return value;
}
/** Recent review runs for one workspace, newest first; unreadable run files are ignored. */
async function listRunFiles(workspaceRoot) {
    let names;
    try {
        names = await readdir(runsDirectory(workspaceRoot));
    }
    catch {
        return [];
    }
    const runs = [];
    for (const name of names) {
        if (!name.endsWith('.json'))
            continue;
        try {
            const run = parseRunFile(JSON.parse(await readFile(join(runsDirectory(workspaceRoot), name), 'utf8')));
            if (run !== undefined)
                runs.push(run);
        }
        catch {
            // A stale/partial run file is scratch; ignore it in the status view.
        }
    }
    return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 30);
}
/** One owned review completion lost to an already-authoritative record. */
class DiscardedRun extends DelegationError {
    constructor(message) {
        super(message);
        this.name = 'DiscardedRun';
    }
}
const CHANGE_INPUT_EXCLUDES = new Set(['.openspec.yaml', REVIEWS_DIRECTORY]);
/** Stat signature (size + nanosecond mtime/ctime) for one reviewed path. */
async function inputStat(path) {
    try {
        const info = await stat(path, { bigint: true });
        return `${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    }
    catch {
        // A deleted tracked file is a changed input, not an unreadable workspace.
        return '[missing]';
    }
}
/** Stat signature of every file under a walked root. */
async function inputSignature(root, excludes) {
    const entries = new Map();
    async function walk(directory, prefix) {
        let dirents;
        try {
            dirents = await readdir(directory, { withFileTypes: true });
        }
        catch (error) {
            fail(`could not read reviewed inputs under ${prefix === '' ? '.' : prefix}: ${errorMessage(error)}`);
        }
        for (const entry of dirents) {
            // Exclusions are change-root entries: a nested `reviews/` or
            // `.openspec.yaml` is a normal artifact and stays reviewed.
            if (prefix === '' && excludes.has(entry.name))
                continue;
            const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                await walk(absolute, name);
                continue;
            }
            if (!entry.isFile())
                continue;
            entries.set(absolute, await inputStat(absolute));
        }
    }
    await walk(root, '');
    return { root, entries };
}
/** The git-visible worktree file set the worktree digest covers. */
async function gitInputSignature(root, services, signal) {
    let raw;
    try {
        raw = await services.runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, signal);
    }
    catch (error) {
        fail(`could not list the reviewed worktree inputs: ${errorMessage(error)}`);
    }
    const entries = new Map();
    for (const path of raw.toString('utf8').split('\0')) {
        // Keep the digest's two scratch exclusions; everything else git exposes is reviewed.
        if (path === '' || ignoredForDigest(path))
            continue;
        const absolute = resolve(root, path);
        entries.set(absolute, await inputStat(absolute));
    }
    return { root, entries };
}
/** Whole-spec reviews track the change artifacts; code reviews track the worktree. */
async function reviewedInputs(cwd, rule, change, services, signal) {
    if (rule.scope === 'whole' && rule.when !== 'implementation-complete') {
        return inputSignature(change.dir, CHANGE_INPUT_EXCLUDES);
    }
    const root = await repositoryRoot(cwd, services.git, signal);
    const signature = await gitInputSignature(root, services.git, signal);
    if (rule.scope !== 'task')
        return signature;
    // A task digest also hashes the change artifacts, so they are guarded regardless of git.
    for (const [path, value] of (await inputSignature(change.dir, CHANGE_INPUT_EXCLUDES)).entries) {
        signature.entries.set(path, value);
    }
    return signature;
}
/** Paths whose reviewed input changed (added, removed, or stat/content mutation). */
function changedInputPaths(signature, current) {
    const changed = new Set();
    for (const [path, value] of signature.entries) {
        if (current.entries.get(path) !== value)
            changed.add(relativePath(signature.root, path));
    }
    for (const path of current.entries.keys()) {
        if (!signature.entries.has(path))
            changed.add(relativePath(signature.root, path));
    }
    return [...changed].sort();
}
/**
 * Publish lock per record: only one completion can decide the authoritative
 * record. A stale lock from a crashed run is broken after 30s.
 */
async function acquirePublishLock(recordPath) {
    const lock = `${recordPath}.publish`;
    await mkdir(dirname(lock), { recursive: true });
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            await writeFile(lock, '1', { encoding: 'utf8', flag: 'wx' });
            return async () => {
                await unlink(lock).catch(() => undefined);
            };
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                throw error;
        }
        try {
            const info = await stat(lock);
            if (Date.now() - info.mtimeMs > 30_000) {
                await unlink(lock).catch(() => undefined);
                continue;
            }
        }
        catch {
            // The lock vanished between EEXIST and stat; retry the exclusive create.
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    fail(`could not acquire the review publish lock at ${lock}; another completion is stuck or the workspace is read-only`);
}
function checkedTaskList(tasks) {
    return tasks
        .filter((task) => task.checked)
        .map((task) => `${task.id} "${task.number} ${task.text}"`)
        .join(', ');
}
/** Resolve an explicit task id/text for one task-scoped review. */
function resolveTaskArgument(change, tasks, wanted) {
    const normalized = normalizeTaskText(wanted);
    const match = tasks.find((task) => task.id === wanted ||
        normalizeTaskText(task.text) === normalized ||
        normalizeTaskText(`${task.number} ${task.text}`) === normalized);
    if (match === undefined) {
        fail(`task "${wanted}" was not found in change "${change.name}"; allowed checked tasks: ${checkedTaskList(tasks) || '(none)'}`);
    }
    if (!match.checked) {
        fail(`task "${match.number} ${match.text}" is not checked in change "${change.name}"; only checked tasks can be reviewed. Allowed checked tasks: ${checkedTaskList(tasks) || '(none)'}`);
    }
    return match;
}
function parseRecord(value) {
    if (!isRecord(value))
        return undefined;
    if (typeof value.rule !== 'string' ||
        typeof value.change !== 'string' ||
        typeof value.phase !== 'string' ||
        (value.scope !== 'whole' && value.scope !== 'task') ||
        typeof value.digest !== 'string' ||
        !DIGEST_PATTERN.test(value.digest) ||
        (value.verdict !== 'PASS' && value.verdict !== 'FINDINGS' && value.verdict !== 'ERROR') ||
        !Array.isArray(value.findings) ||
        !value.findings.every(isReviewFinding) ||
        !isRecord(value.target) ||
        typeof value.target.provider !== 'string' ||
        typeof value.time !== 'string') {
        return undefined;
    }
    if (value.taskId !== undefined && typeof value.taskId !== 'string')
        return undefined;
    if (value.scope === 'task' && typeof value.taskId !== 'string')
        return undefined;
    if (value.target.model !== undefined && typeof value.target.model !== 'string')
        return undefined;
    if (value.target.reasoningEffort !== undefined &&
        typeof value.target.reasoningEffort !== 'string') {
        return undefined;
    }
    if (value.worktreeDigest !== undefined && typeof value.worktreeDigest !== 'string')
        return undefined;
    if (value.session !== undefined && (typeof value.session !== 'string' || value.session === '')) {
        return undefined;
    }
    if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId === '')) {
        return undefined;
    }
    if (value.error !== undefined && typeof value.error !== 'string')
        return undefined;
    return value;
}
async function inspectRecord(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { kind: 'missing' };
        return { kind: 'malformed', error: errorMessage(error) };
    }
    try {
        const record = parseRecord(JSON.parse(raw));
        if (record === undefined)
            return { kind: 'malformed', error: 'record shape is invalid' };
        return { kind: 'record', record };
    }
    catch (error) {
        return { kind: 'malformed', error: errorMessage(error) };
    }
}
/** A record at the computed path must still identify the rule/change/task it claims. */
function recordIdentifies(record, rule, change, taskId) {
    if (record.rule !== rule.id || record.change !== change)
        return false;
    if (record.scope !== (rule.scope ?? 'whole'))
        return false;
    return rule.scope !== 'task' || record.taskId === taskId;
}
/** A gate match: PASS/ERROR only, identified, with an optional current-digest check. */
function recordSatisfies(state, change, scope, digest, taskId) {
    if (state.kind !== 'record')
        return false;
    const record = state.record;
    if (record.change !== change || record.scope !== scope)
        return false;
    if (record.verdict !== 'PASS' && record.verdict !== 'ERROR')
        return false;
    if (scope === 'task' && record.taskId !== taskId)
        return false;
    return digest === undefined || record.digest === digest;
}
async function inspectNote(cwd, change) {
    let raw;
    try {
        raw = await readFile(notePath(cwd, change), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { kind: 'missing' };
        return { kind: 'malformed' };
    }
    try {
        const value = JSON.parse(raw);
        if (!isRecord(value))
            return { kind: 'malformed' };
        if (typeof value.taskId !== 'string' ||
            !TASK_ID_PATTERN.test(value.taskId) ||
            (value.status !== 'in-progress' && value.status !== 'blocked') ||
            typeof value.reason !== 'string' ||
            typeof value.worktreeDigest !== 'string' ||
            !/^[0-9a-f]{64}$/.test(value.worktreeDigest) ||
            typeof value.time !== 'string') {
            return { kind: 'malformed' };
        }
        return { kind: 'note', note: value };
    }
    catch {
        return { kind: 'malformed' };
    }
}
/** The task-review rule whose portable PASS is the approval. */
async function approvalRuleId(config, openspecRoot) {
    const path = join(openspecRoot, APPROVAL_MARKER_FILE);
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            return { error: `${APPROVAL_MARKER_FILE} is unreadable: ${errorMessage(error)}` };
        }
    }
    let marker;
    if (raw !== undefined) {
        try {
            const parsed = parseReviewApprovalMarker(JSON.parse(raw));
            if (parsed.marker === undefined) {
                return { error: `${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}` };
            }
            marker = parsed.marker;
        }
        catch (error) {
            return { error: `${APPROVAL_MARKER_FILE} is not valid JSON: ${errorMessage(error)}` };
        }
    }
    if (marker !== undefined) {
        const rule = config.rules.find((entry) => entry.id === marker?.taskRule);
        if (rule === undefined) {
            return { error: `marker taskRule "${marker.taskRule}" is not a configured rule` };
        }
        if (rule.contract !== 'review' || rule.scope !== 'task') {
            return { error: `marker taskRule "${rule.id}" is not a task-scoped review rule` };
        }
        if (rule.gate !== 'strict') {
            return { error: `marker taskRule "${rule.id}" is not a strict rule` };
        }
        return { id: rule.id };
    }
    const taskRules = config.rules.filter((rule) => rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task');
    const strict = taskRules.find((rule) => rule.gate === 'strict');
    if (strict !== undefined)
        return { id: strict.id };
    const fallback = taskRules[0];
    return fallback === undefined
        ? { error: 'no task-scoped review rule is configured' }
        : { id: fallback.id };
}
async function inspectPortableRecord(changeDir, taskId) {
    let raw;
    try {
        raw = await readFile(portableTaskRecordPath(changeDir, taskId), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { kind: 'missing' };
        return { kind: 'malformed', error: errorMessage(error) };
    }
    try {
        const parsed = parsePortableTaskReviewRecord(JSON.parse(raw));
        return parsed.record === undefined
            ? { kind: 'malformed', error: parsed.error ?? 'record shape is invalid' }
            : { kind: 'record', record: parsed.record };
    }
    catch (error) {
        return { kind: 'malformed', error: errorMessage(error) };
    }
}
/** PASS-only coverage over every checked task, independent of session attribution. */
async function changeApproval(config, change, openspecRoot, tasks) {
    const rule = await approvalRuleId(config, openspecRoot);
    if ('error' in rule)
        return rule;
    let markdown;
    try {
        markdown = await readFile(join(change.dir, 'tasks.md'), 'utf8');
    }
    catch (error) {
        return { error: `change "${change.name}" has no readable tasks.md: ${errorMessage(error)}` };
    }
    const coverage = await computeApprovalCoverage({
        change: change.name,
        rule: rule.id,
        tasks,
        unparseable: unparseableCheckedLines(markdown),
        recordPath: (taskId) => portableTaskRecordDisplayPath(`openspec/changes/${change.name}`, taskId),
        inspect: (taskId) => inspectPortableRecord(change.dir, taskId),
    });
    return { coverage };
}
/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
function parseVerdict(text, expectedDigest) {
    const blocks = [];
    const fence = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g;
    for (const match of text.matchAll(fence)) {
        blocks.push(match[1] ?? '');
    }
    if (blocks.length === 0)
        fail('the target returned no fenced JSON verdict; the review needs exactly one block');
    if (blocks.length > 1)
        fail(`the target returned ${blocks.length} fenced blocks; exactly one JSON verdict is required`);
    let value;
    try {
        value = JSON.parse(blocks[0]);
    }
    catch (error) {
        fail(`the fenced verdict is not valid JSON: ${errorMessage(error)}`);
    }
    if (!isRecord(value))
        fail('the fenced verdict must be a JSON object');
    if (value.digest !== expectedDigest) {
        fail('the verdict digest does not match the reviewed digest; re-run the review on the current artifacts');
    }
    const verdict = value.verdict;
    if (verdict !== 'PASS' && verdict !== 'FINDINGS')
        fail('the verdict must be "PASS" or "FINDINGS"');
    const findingsRaw = value.findings ?? [];
    if (!Array.isArray(findingsRaw))
        fail('the verdict findings must be a list');
    const findings = findingsRaw.map((finding, index) => {
        if (!isRecord(finding))
            fail(`finding #${index + 1} must be an object`);
        if (finding.severity !== 'P0' && finding.severity !== 'P1') {
            fail(`finding #${index + 1} severity must be "P0" or "P1"`);
        }
        return {
            severity: finding.severity,
            title: sanitizeText(requireNonEmpty(finding.title, `finding #${index + 1}.title`)),
            evidence: sanitizeText(requireNonEmpty(finding.evidence, `finding #${index + 1}.evidence`)),
            fix: sanitizeText(requireNonEmpty(finding.fix, `finding #${index + 1}.fix`)),
        };
    });
    if (verdict === 'PASS' && findings.length > 0)
        fail('verdict PASS requires zero P0/P1 findings');
    if (verdict === 'FINDINGS' && findings.length === 0)
        fail('verdict FINDINGS requires at least one P0/P1 finding');
    return { verdict, findings };
}
/** The steering message shape: role user, attributed to this gate. */
function gateMessage(text) {
    const content = Object.freeze([Object.freeze({ type: 'text', text })]);
    const message = Object.freeze({
        id: randomUUID(),
        role: 'user',
        content,
        source: Object.freeze({ kind: GATE_SOURCE_KIND }),
    });
    return message;
}
/** Per-agent failure streak, consultation, steering, snapshots, and write evidence. */
class DelegationState {
    agents = new Map();
    of(agentId) {
        let state = this.agents.get(agentId);
        if (state === undefined) {
            state = {
                failures: 0,
                epoch: 0,
                consultedEpoch: -1,
                steered: new Set(),
                turn: -1,
                evidence: new Map(),
                workerStarted: false,
            };
            this.agents.set(agentId, state);
        }
        return state;
    }
    recordToolResult(agentId, isError) {
        const state = this.of(agentId);
        if (isError) {
            state.failures += 1;
            return;
        }
        if (state.failures > 0) {
            state.failures = 0;
            state.epoch += 1;
        }
    }
    beginTurn(agentId, turn) {
        const state = this.of(agentId);
        if (state.turn === turn)
            return false;
        state.turn = turn;
        state.failures = 0;
        state.epoch += 1;
        state.steered.clear();
        state.baseline = undefined;
        state.evidence = new Map();
        state.workerStarted = false;
        return true;
    }
    evidenceFor(agentId, change) {
        const evidence = this.of(agentId).evidence;
        let entry = evidence.get(change);
        if (entry === undefined) {
            entry = freshEvidence();
            evidence.set(change, entry);
        }
        return entry;
    }
    evidenceOf(agentId) {
        return this.of(agentId).evidence;
    }
    failuresOf(agentId) {
        return this.of(agentId).failures;
    }
    markWorkerStarted(agentId) {
        this.of(agentId).workerStarted = true;
    }
    hasWorkerStart(agentId) {
        return this.of(agentId).workerStarted;
    }
    markConsulted(agentId) {
        const state = this.of(agentId);
        state.consultedEpoch = state.epoch;
    }
    consulted(agentId) {
        const state = this.of(agentId);
        return state.consultedEpoch === state.epoch;
    }
    epochOf(agentId) {
        return this.of(agentId).epoch;
    }
    markSteered(agentId, key) {
        this.of(agentId).steered.add(key);
    }
    wasSteered(agentId, key) {
        return this.of(agentId).steered.has(key);
    }
    setBaseline(agentId, snapshot) {
        this.of(agentId).baseline = snapshot;
    }
    baselineOf(agentId, turn) {
        const state = this.of(agentId);
        if (state.baseline !== undefined && state.turn === turn)
            return state.baseline;
        return state.lastSnapshot;
    }
    /** The pre-step snapshot for this turn only; no fallback, because attribution needs a baseline. */
    turnBaselineOf(agentId, turn) {
        const state = this.of(agentId);
        return state.turn === turn ? state.baseline : undefined;
    }
    rememberSnapshot(agentId, snapshot) {
        this.of(agentId).lastSnapshot = snapshot;
    }
}
function readAsset(asset) {
    try {
        return readFileSync(join(assetsDirectory, `${asset}.md`), 'utf8');
    }
    catch (error) {
        fail(`bundled instruction "${asset}" could not be read: ${errorMessage(error)}`);
    }
}
function instructionText(rule) {
    const instruction = rule.instruction;
    if (instruction === undefined)
        fail(`rule "${rule.id}" has no instruction`);
    if (instruction.startsWith('bundled:'))
        return readAsset(instruction.slice('bundled:'.length));
    return instruction;
}
function targetLabel(target) {
    const model = target.model ?? target.agentOptions?.model;
    const effort = target.reasoningEffort ?? target.agentOptions?.reasoningEffort;
    return `${target.provider}${model === undefined ? '' : `/${model}`}${effort === undefined ? '' : `@${effort}`}`;
}
/** The target identity kept in a record: the selection, never a machine path. */
function targetIdentity(provider, model, reasoningEffort) {
    return {
        provider,
        ...(model === undefined ? {} : { model }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    };
}
function targetLabelFromIdentity(identity) {
    return `${identity.provider}${identity.model === undefined ? '' : `/${identity.model}`}${identity.reasoningEffort === undefined ? '' : `@${identity.reasoningEffort}`}`;
}
function resolveAgentOptions(target) {
    const options = {};
    if (target.agentOptions !== undefined) {
        if (target.agentOptions.provider !== undefined)
            options.provider = target.agentOptions.provider;
        if (target.agentOptions.model !== undefined)
            options.model = target.agentOptions.model;
        if (target.agentOptions.reasoningEffort !== undefined) {
            options.reasoningEffort = target.agentOptions
                .reasoningEffort;
        }
        if (target.agentOptions.maxTokens !== undefined)
            options.maxTokens = target.agentOptions.maxTokens;
    }
    if (target.model !== undefined)
        options.model = target.model;
    if (target.reasoningEffort !== undefined) {
        options.reasoningEffort = target.reasoningEffort;
    }
    return Object.keys(options).length === 0 ? undefined : options;
}
function outputText(result) {
    const blocks = [];
    for (const block of result.output) {
        if (block.type === 'text')
            blocks.push(block.text);
    }
    return blocks.join('\n').trim();
}
/** Validate the target and start it; the caller decides whether to await its result. */
async function startTarget(services, request) {
    const { rule, target, agent, signal } = request;
    const provider = services.subagents.getProvider(target.provider);
    if (provider === undefined) {
        const registered = services.subagents.list();
        fail(`rule "${rule.id}": target "${rule.to}" names provider "${target.provider}", which is not registered; install or enable that provider, or point the rule's target at one of: ${registered.join(', ') || '(none registered)'}`);
    }
    const agentOptions = resolveAgentOptions(target);
    if (agentOptions !== undefined && provider.capabilities.agentOptions !== true) {
        fail(`rule "${rule.id}": target "${rule.to}" requests model/agent options, but provider "${provider.name}" does not support them; remove model/reasoningEffort/agentOptions from the target or choose a provider with agentOptions support`);
    }
    const prompt = [{ type: 'text', text: request.prompt }];
    let activation;
    try {
        activation = await services.subagents.startActivation({
            provider: provider.name,
            label: `delegation:${rule.id}`,
            request: {
                prompt,
                parent: agent,
                cwd: request.cwd,
                ...(agentOptions === undefined ? {} : { agentOptions }),
            },
            signal,
            delivery: 'caller',
        });
    }
    catch (error) {
        fail(`rule "${rule.id}": target "${rule.to}" on provider "${provider.name}" could not start: ${errorMessage(error)}; check targets.${rule.to} options against provider "${provider.name}", or run delegation_status for the next action`);
    }
    const model = target.model ?? agentOptions?.model;
    const reasoningEffort = target.reasoningEffort ?? agentOptions?.reasoningEffort;
    return {
        activation,
        rule,
        target,
        provider: provider.name,
        ...(model === undefined ? {} : { model }),
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        timeoutMs: services.timeoutsFor(rule),
    };
}
/** Await one started target, dispose it, and normalize the terminal result. */
async function finishTarget(started) {
    const { rule, target } = started;
    let timer;
    let result;
    try {
        result = await Promise.race([
            started.activation.result,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new DelegationError(`rule "${rule.id}": target "${targetLabel(target)}" did not finish within ${started.timeoutMs} ms; widen timeouts.${rule.contract} or narrow the task`));
                }, started.timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        await started.activation.dispose().catch(() => undefined);
    }
    if (result.stopReason !== 'completed') {
        const diagnostic = result.diagnostic === undefined ? '' : `: ${sanitizeText(result.diagnostic, MAX_ERROR_CHARS)}`;
        fail(`rule "${rule.id}": target "${targetLabel(target)}" stopped with "${result.stopReason}"${diagnostic}`);
    }
    const text = outputText(result);
    if (text === '')
        fail(`rule "${rule.id}": target "${targetLabel(target)}" returned no text output`);
    return {
        text,
        provider: started.provider,
        ...(started.model === undefined ? {} : { model: started.model }),
        ...(started.reasoningEffort === undefined ? {} : { reasoningEffort: started.reasoningEffort }),
    };
}
async function runTarget(services, request) {
    return finishTarget(await startTarget(services, request));
}
function reviewPrompt(rule, change, digest, task, context, objective, snapshot = false) {
    const lines = [
        instructionText(rule).trimEnd(),
        '',
        '## Delegated review',
        '',
        `- Rule: ${rule.id}`,
        `- Change: ${change.name}`,
        `- Scope: ${rule.scope ?? 'whole'}`,
    ];
    if (task !== undefined)
        lines.push(`- Task: ${task.number} ${task.text}`);
    lines.push(`- Review key: ${reviewKeyForPrompt(change.name, task, rule)}`);
    lines.push(`- Digest: ${digest}`);
    if (snapshot) {
        lines.push('- Reviewed state: frozen worktree snapshot taken when the review started; later writes are not in it.');
    }
    if (context !== undefined && context.trim() !== '')
        lines.push('', '## Context', '', context.trim());
    if (objective !== undefined && objective.trim() !== '')
        lines.push('', '## Objective', '', objective.trim());
    lines.push('', 'Return exactly one fenced JSON block whose `digest` is the value above, `verdict` is `PASS` or `FINDINGS`, and `findings` lists only P0/P1 items with title, evidence, and fix. Prose outside that block is ignored.');
    return lines.join('\n');
}
function answerPrompt(rule, change, context, objective) {
    const lines = [instructionText(rule).trimEnd(), '', '## Delegated answer', ''];
    if (change !== undefined)
        lines.push(`- Change: ${change.name}`);
    lines.push(`- Rule: ${rule.id}`);
    if (context !== undefined && context.trim() !== '')
        lines.push('', '## Context', '', context.trim());
    if (objective !== undefined && objective.trim() !== '')
        lines.push('', '## Objective', '', objective.trim());
    lines.push('', 'Answer within a bounded response. Name evidence and, for research, sources with dates. Do not modify files.');
    return lines.join('\n');
}
function patchPrompt(rule, context, objective) {
    const lines = [
        instructionText(rule).trimEnd(),
        '',
        '## Isolated patch run',
        '',
        `- Rule: ${rule.id}`,
        `- Objective: ${objective}`,
    ];
    if (context !== undefined && context.trim() !== '')
        lines.push('', '## Context', '', context.trim());
    lines.push('', 'Work only inside this worktree. Run the relevant checks, report the root cause, changed files, commands, and results. Never touch the session worktree and never merge.');
    return lines.join('\n');
}
function formatRecord(cwd, path, record, reused) {
    const head = reused ? 'reused record' : 'wrote record';
    const findings = record.findings.map((finding) => `- ${finding.severity} ${finding.title}\n  evidence: ${finding.evidence}\n  fix: ${finding.fix}`);
    const lines = [
        `rule "${record.rule}" ${record.verdict} (${head} ${relativePath(cwd, path)})`,
        `change: ${record.change}`,
        `digest: ${record.digest}`,
    ];
    if (record.taskId !== undefined)
        lines.push(`task id: ${record.taskId}`);
    if (record.error !== undefined)
        lines.push(`error: ${record.error}`);
    lines.push(`target: ${targetLabelFromIdentity(record.target)}`);
    if (record.session !== undefined)
        lines.push(`session: ${record.session}`);
    lines.push('');
    lines.push(record.verdict === 'PASS'
        ? '0 P0/P1 findings. The gate accepts this record while its digest still matches.'
        : record.verdict === 'FINDINGS'
            ? `${record.findings.length} blocking finding(s):\n${findings.join('\n')}\n\nA FINDINGS record does not satisfy a strict gate; fix the findings and re-run the rule.`
            : 'The run failed and wrote an ERROR record. The gate accepts it with the failure visible; a later run retries after the cause is fixed.');
    return lines.join('\n');
}
/** The engine behind the three tools: validation, target runs, records, status. */
class DelegationEngine {
    config;
    services;
    runs = new Map();
    runIdentities = new Map();
    runKeyHeads = new Map();
    runQueues = new Map();
    constructor(config, services) {
        this.config = config;
        this.services = services;
    }
    rule(ruleId) {
        const rule = this.config.rules.find((entry) => entry.id === ruleId);
        if (rule === undefined) {
            const ids = this.config.rules.map((entry) => entry.id);
            fail(`unknown rule "${ruleId}"; configured rules: ${ids.join(', ') || '(none configured)'}`);
        }
        return rule;
    }
    target(rule) {
        const target = this.config.targets.get(rule.to ?? '');
        if (target === undefined) {
            fail(`rule "${rule.id}": target "${rule.to}" is not configured; add targets.${rule.to} or change the rule`);
        }
        return target;
    }
    requireAgent(context) {
        if (context.agent === undefined) {
            fail('this tool needs a calling agent; run it from an agent turn, not a host startup');
        }
        return context.agent;
    }
    now() {
        return this.services.now().toISOString();
    }
    async runDelegate(args, context) {
        const rule = this.rule(args.rule);
        if (rule.contract === 'note') {
            fail(`rule "${rule.id}" is the task-progress note; use task_progress(task, status, reason) instead of delegate`);
        }
        if (args.task !== undefined && rule.contract !== 'review') {
            fail(`rule "${rule.id}" is a ${rule.contract} rule; task is only valid for a task-scoped review`);
        }
        const agent = this.requireAgent(context);
        const cwd = this.services.workingDirectory.get(agent.session);
        const opened = rule.contract === 'review' || args.change !== undefined
            ? await openChange(cwd, args.change)
            : undefined;
        const change = opened?.change;
        const workspaceRoot = opened === undefined ? undefined : dirname(opened.openspecRoot);
        if (rule.contract === 'answer') {
            this.services.state.markConsulted(String(agent.id));
            const result = await runTarget(this.services, {
                rule,
                target: this.target(rule),
                prompt: answerPrompt(rule, change, args.context, args.objective),
                agent,
                cwd,
                signal: context.signal,
            });
            return `${result.text.slice(0, MAX_ANSWER_CHARS)}${result.text.length > MAX_ANSWER_CHARS ? '\n[answer truncated]' : ''}\n\n(no gate record: this answer does not satisfy a strict review rule)`;
        }
        if (rule.contract === 'patch') {
            if (args.objective === undefined || args.objective.trim() === '') {
                fail(`rule "${rule.id}": a patch rule needs objective: to name the bug to fix`);
            }
            if (change !== undefined && workspaceRoot !== undefined) {
                await this.attributeChange(workspaceRoot, agent, change.name);
            }
            return this.runPatch(rule, args, agent, cwd, context.signal);
        }
        if (change === undefined || workspaceRoot === undefined) {
            fail(`rule "${rule.id}": a review needs an active OpenSpec change`);
        }
        if (rule.scope === 'whole' && !change.reviewReady) {
            fail(`change "${change.name}" is not review-ready; a whole-scope review needs proposal.md, design.md, tasks.md, and at least one specs/*/spec.md`);
        }
        return this.startReview(rule, change, agent, cwd, workspaceRoot, args);
    }
    /** An explicit task_progress/review/patch call opts this session into the change. */
    async attributeChange(workspaceRoot, agent, change, taskId) {
        await withInvolvementLock(workspaceRoot, currentThread(agent), async () => {
            const { involvement } = await readInvolvement(workspaceRoot, currentThread(agent));
            const existed = involvement.changes[change] !== undefined;
            const entry = involvementEntry(involvement, change);
            let changed = !existed;
            if (taskId !== undefined && !entry.tasks.includes(taskId)) {
                entry.tasks.push(taskId);
                changed = true;
            }
            if (changed)
                await writeInvolvement(workspaceRoot, involvement);
        });
    }
    createRun(workspaceRoot, rule, change, task, agent, cwd, args) {
        const id = `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const path = recordPath(cwd, rule, change.name, task?.id);
        const key = `${workspaceRoot}\u0000${reviewConversationKey(change.name, task, rule)}`;
        const file = {
            id,
            rule: rule.id,
            change: change.name,
            ...(task === undefined ? {} : { taskId: task.id }),
            key,
            identity: `${workspaceRoot}\u0000${reviewIdentity(rule, change.name, task)}`,
            state: 'running',
            record: relativePath(workspaceRoot, path),
            startedAt: this.now(),
        };
        return {
            file,
            workspaceRoot,
            recordPath: path,
            context: {
                rule,
                change,
                ...(task === undefined ? {} : { task }),
                agent,
                cwd,
                args,
                signal: new AbortController().signal,
            },
        };
    }
    /** Validate, start, and return the run handle without waiting for the verdict. */
    async startReview(rule, change, agent, cwd, workspaceRoot, args) {
        const tasks = await readTasks(change.dir);
        let task;
        if (args.task !== undefined) {
            if (rule.scope !== 'task') {
                fail(`rule "${rule.id}" reviews the whole scope; omit task (only a task-scoped review accepts one)`);
            }
            task = resolveTaskArgument(change, tasks, args.task);
        }
        else if (rule.scope === 'task') {
            task = await this.nextTaskForReview(change, tasks, cwd);
        }
        // Explicit review: any session may run it; the call attributes the change,
        // and a task-scoped review also attributes the selected checked task.
        await this.attributeChange(workspaceRoot, agent, change.name, task?.id);
        const run = this.createRun(workspaceRoot, rule, change, task, agent, cwd, args);
        const pending = this.runIdentities.get(run.file.identity);
        if (pending !== undefined)
            return this.runHandleText(pending, 'duplicate');
        this.runs.set(run.file.id, run);
        this.runIdentities.set(run.file.identity, run);
        const head = this.runKeyHeads.get(run.file.key);
        if (head !== undefined) {
            const queue = this.runQueues.get(run.file.key) ?? [];
            queue.push(run);
            this.runQueues.set(run.file.key, queue);
            await this.markRun(run, 'queued', `queued behind run ${head.file.id}`);
            return this.runHandleText(run, 'queued');
        }
        this.runKeyHeads.set(run.file.key, run);
        const outcome = await this.beginReviewRun(run);
        return outcome.reusedText ?? this.runHandleText(run, 'running');
    }
    /** Prepare immutable digest/inputs and start the target; cleanup is owned here. */
    async beginReviewRun(run) {
        let prepared;
        try {
            const tasks = await readTasks(run.context.change.dir);
            const task = run.context.task;
            if (task !== undefined) {
                const current = tasks.find((entry) => entry.id === task.id);
                if (current === undefined || !current.checked) {
                    fail(`task "${task.number} ${task.text}" is no longer a checked task in change "${run.context.change.name}"; start a fresh review`);
                }
                run.context.task = current;
            }
            prepared = await this.prepareReview(run);
            const existing = await inspectRecord(prepared.path);
            run.existingFingerprint =
                existing.kind === 'record' ? JSON.stringify(existing.record) : undefined;
            if (existing.kind === 'record' &&
                recordIdentifies(existing.record, run.context.rule, run.context.change.name, run.context.task?.id)) {
                const record = existing.record;
                const reusable = record.verdict === 'PASS' ||
                    (record.verdict === 'FINDINGS' && record.digest === prepared.digest);
                const current = run.context.rule.scope === 'task' ? true : record.digest === prepared.digest;
                if (reusable && current) {
                    await this.discardSnapshot(run);
                    await this.markRun(run, 'completed', 'reused record');
                    this.freeRun(run);
                    await this.startNextRun(run.file.key);
                    return {
                        reusedText: formatRecord(run.context.cwd, prepared.path, record, true),
                    };
                }
            }
            const started = await startTarget(this.services, {
                rule: run.context.rule,
                target: this.target(run.context.rule),
                prompt: reviewPrompt(run.context.rule, run.context.change, prepared.digest, run.context.task, run.context.args.context, run.context.args.objective, prepared.snapshotTree !== undefined),
                agent: run.context.agent,
                cwd: prepared.reviewCwd ?? run.context.cwd,
                signal: run.context.signal,
            });
            await this.markRun(run, 'running', prepared.snapshotTree === undefined
                ? 'live worktree'
                : `snapshot ${prepared.snapshotTree.slice(0, 8)}`);
            void this.completeReviewRun(run, started, prepared);
            return {};
        }
        catch (error) {
            await this.failRun(run, error, prepared);
            throw error;
        }
    }
    async prepareReview(run) {
        const { rule, change, cwd, signal } = run.context;
        const path = recordPath(cwd, rule, change.name, run.context.task?.id);
        if (rule.scope === 'task') {
            const task = run.context.task;
            if (task === undefined)
                fail(`rule "${rule.id}": a task-scoped review needs a task`);
            const snapshot = await createReviewSnapshot(cwd, change, run.file.id, this.services.git.runGit, signal);
            if (snapshot !== undefined) {
                run.snapshot = snapshot;
                const frozen = (await readTasks(snapshot.changeDir)).find((entry) => entry.id === task.id);
                if (frozen === undefined) {
                    fail(`task "${task.number} ${task.text}" changed while the review snapshot was prepared in change "${change.name}"; re-run the review`);
                }
                if (!frozen.checked) {
                    fail(`task "${frozen.number} ${frozen.text}" is not checked in the frozen snapshot of change "${change.name}"; re-run the review`);
                }
                return {
                    digest: hashParts([
                        'task-review-v2',
                        frozen.id,
                        frozen.text,
                        snapshot.specDigest,
                        snapshot.tree,
                    ]),
                    worktreeDigest: hashParts(['task-review-snapshot-v1', snapshot.tree]),
                    path,
                    reviewCwd: snapshot.worktree,
                    snapshotTree: snapshot.tree,
                };
            }
            // Fallback: review the live worktree under the mutation guard. Track the
            // inputs before hashing them, so a change between the two is caught.
            const signature = await reviewedInputs(cwd, rule, change, this.services, signal);
            const worktree = await worktreeDigest(cwd, this.services.git, signal);
            return {
                digest: hashParts([
                    'task-review-v1',
                    task.id,
                    task.text,
                    await specDigest(change.dir, signal),
                    worktree,
                ]),
                worktreeDigest: worktree,
                path,
                signature,
            };
        }
        // Track the inputs before hashing them: any later mutation, including
        // edit-read-restore, invalidates the verdict via the completion check.
        const signature = await reviewedInputs(cwd, rule, change, this.services, signal);
        let digest;
        let worktree;
        if (rule.when === 'implementation-complete') {
            worktree = await worktreeDigest(cwd, this.services.git, signal);
            digest = worktree;
        }
        else {
            digest = await specDigest(change.dir, signal);
        }
        return {
            digest,
            ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
            path,
            signature,
        };
    }
    /** Background completion: verdict + mutation guard + authoritative publish. */
    async completeReviewRun(run, started, prepared) {
        try {
            const result = await finishTarget(started);
            const parsed = parseVerdict(result.text, prepared.digest);
            if (prepared.signature !== undefined) {
                const current = await reviewedInputs(run.context.cwd, run.context.rule, run.context.change, this.services, run.context.signal);
                const changed = changedInputPaths(prepared.signature, current);
                if (changed.length > 0) {
                    const sample = changed.slice(0, 5).join(', ');
                    fail(`reviewed inputs changed during the run (${changed.length} changed: ${sample}${changed.length > 5 ? ', …' : ''}); a write inside the reviewed scope happened during the run — finish the writes, then re-run the review`);
                }
            }
            await this.publishRecord(run, {
                digest: prepared.digest,
                ...(prepared.worktreeDigest === undefined
                    ? {}
                    : { worktreeDigest: prepared.worktreeDigest }),
                verdict: parsed.verdict,
                findings: parsed.findings,
                target: targetIdentity(result.provider, result.model, result.reasoningEffort),
            });
            await this.markRun(run, 'completed', parsed.verdict === 'FINDINGS' ? `${parsed.findings.length} finding(s)` : undefined);
        }
        catch (error) {
            if (error instanceof DiscardedRun) {
                await this.markRun(run, 'discarded', error.message);
            }
            else {
                try {
                    await this.publishRecord(run, {
                        digest: prepared.digest,
                        ...(prepared.worktreeDigest === undefined
                            ? {}
                            : { worktreeDigest: prepared.worktreeDigest }),
                        verdict: 'ERROR',
                        findings: [],
                        target: targetIdentity(started.provider, started.model, started.reasoningEffort),
                        error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
                    });
                    await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS));
                }
                catch (publishError) {
                    if (publishError instanceof DiscardedRun) {
                        await this.markRun(run, 'discarded', publishError.message);
                    }
                    else {
                        await this.markRun(run, 'failed', sanitizeText(errorMessage(publishError), MAX_ERROR_CHARS));
                    }
                }
            }
        }
        finally {
            await this.discardSnapshot(run);
            this.freeRun(run);
            await this.startNextRun(run.file.key);
        }
    }
    /** Write a record under the publish lock; a newer writer wins and this run is discarded. */
    async publishRecord(run, fields) {
        const release = await acquirePublishLock(run.recordPath);
        try {
            const current = await inspectRecord(run.recordPath);
            if (current.kind === 'record' && current.record.runId !== run.file.id) {
                if (JSON.stringify(current.record) !== run.existingFingerprint) {
                    throw new DiscardedRun(`a newer review record already exists at ${run.file.record}; this completion was discarded`);
                }
            }
            const record = {
                rule: run.context.rule.id,
                change: run.context.change.name,
                phase: run.context.rule.phase ?? 'task',
                scope: run.context.rule.scope ?? 'whole',
                ...(run.context.task === undefined ? {} : { taskId: run.context.task.id }),
                digest: fields.digest,
                ...(fields.worktreeDigest === undefined ? {} : { worktreeDigest: fields.worktreeDigest }),
                verdict: fields.verdict,
                findings: fields.findings,
                target: fields.target,
                session: currentThread(run.context.agent),
                runId: run.file.id,
                time: this.now(),
                ...(fields.error === undefined ? {} : { error: fields.error }),
            };
            if (record.scope === 'task' && record.verdict === 'PASS' && record.taskId !== undefined) {
                // The portable approval is committed with the change; write it before
                // the local PASS so a failed write can never publish an approval.
                const path = portableTaskRecordPath(run.context.change.dir, record.taskId);
                const portable = {
                    rule: record.rule,
                    change: record.change,
                    scope: 'task',
                    taskId: record.taskId,
                    digest: record.digest,
                    ...(record.worktreeDigest === undefined ? {} : { worktreeDigest: record.worktreeDigest }),
                    verdict: 'PASS',
                    findings: [],
                    target: record.target,
                    time: record.time,
                };
                try {
                    await writeJsonAtomic(path, portable);
                }
                catch (error) {
                    fail(`could not write the portable approval record at ${relativePath(run.context.cwd, path)}: ${errorMessage(error)}; no PASS record was published`);
                }
            }
            await writeJsonAtomic(run.recordPath, record);
            return record;
        }
        finally {
            await release();
        }
    }
    /** Best-effort failure path: write a visible ERROR record when inputs were prepared. */
    async failRun(run, error, prepared) {
        try {
            if (error instanceof DiscardedRun) {
                await this.markRun(run, 'discarded', error.message);
            }
            else if (prepared !== undefined) {
                try {
                    const target = this.config.targets.get(run.context.rule.to ?? '');
                    await this.publishRecord(run, {
                        digest: prepared.digest,
                        ...(prepared.worktreeDigest === undefined
                            ? {}
                            : { worktreeDigest: prepared.worktreeDigest }),
                        verdict: 'ERROR',
                        findings: [],
                        target: target === undefined
                            ? { provider: run.context.rule.to ?? 'unknown' }
                            : targetIdentity(target.provider, target.model ?? target.agentOptions?.model, target.reasoningEffort ?? target.agentOptions?.reasoningEffort),
                        error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
                    });
                    await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS));
                }
                catch (publishError) {
                    if (publishError instanceof DiscardedRun) {
                        await this.markRun(run, 'discarded', publishError.message);
                    }
                    else {
                        await this.markRun(run, 'failed', sanitizeText(errorMessage(publishError), MAX_ERROR_CHARS));
                    }
                }
            }
            else {
                await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS));
            }
        }
        finally {
            await this.discardSnapshot(run);
            this.freeRun(run);
            await this.startNextRun(run.file.key).catch(() => undefined);
        }
    }
    /** Remove one finished run's disposable checkout; never changes the verdict. */
    async discardSnapshot(run) {
        if (run.snapshot === undefined)
            return;
        run.snapshot = undefined;
        await discardReviewSnapshot(run.context.cwd, run.file.id, this.services.git.runGit);
    }
    async markRun(run, state, detail) {
        run.file.state = state;
        if (detail === undefined)
            delete run.file.detail;
        else
            run.file.detail = detail;
        try {
            await writeJsonAtomic(runFilePath(run.workspaceRoot, run.file.id), run.file);
        }
        catch {
            // Run state is local scratch; a write failure must not break the background run.
        }
    }
    freeRun(run) {
        this.runs.delete(run.file.id);
        this.runIdentities.delete(run.file.identity);
        const state = run.file.state;
        if (state === 'queued' || state === 'running')
            return;
        try {
            this.services.onRunSettled?.(run.file.id, state);
        }
        catch {
            // The observer is a test seam; it must not change run cleanup.
        }
    }
    async startNextRun(key) {
        const queue = this.runQueues.get(key);
        const next = queue?.shift();
        if (queue !== undefined && queue.length === 0)
            this.runQueues.delete(key);
        if (next === undefined) {
            this.runKeyHeads.delete(key);
            return;
        }
        this.runKeyHeads.set(key, next);
        try {
            await this.beginReviewRun(next);
        }
        catch {
            // beginReviewRun already cleaned up and surfaced a failed run file.
        }
    }
    runHandleText(run, mode) {
        const label = mode === 'duplicate' ? 'already pending' : mode === 'queued' ? 'queued' : 'started';
        const lines = [
            `rule "${run.file.rule}" review ${label}`,
            `run: ${run.file.id}`,
            `state: ${run.file.state}`,
            `change: ${run.file.change}`,
        ];
        if (run.file.taskId !== undefined)
            lines.push(`task id: ${run.file.taskId}`);
        lines.push(`record: ${run.file.record}`);
        if (mode === 'queued') {
            const head = this.runKeyHeads.get(run.file.key);
            if (head !== undefined)
                lines.push(`queued behind: ${head.file.id}`);
        }
        lines.push('', mode === 'duplicate'
            ? 'Returned the existing run; no second target was started. The turn can continue.'
            : 'The run continues in the background; the turn can continue. Poll delegation_status or read the record path when it completes.');
        return lines.join('\n');
    }
    /** Active run for one identity, used by the gate to avoid duplicate steers. */
    pendingReview(workspaceRoot, ruleId, change, taskId) {
        for (const run of this.runs.values()) {
            if (run.workspaceRoot !== workspaceRoot ||
                run.file.rule !== ruleId ||
                run.file.change !== change ||
                (run.context.task?.id ?? undefined) !== taskId) {
                continue;
            }
            if (run.file.state === 'queued' || run.file.state === 'running') {
                return { id: run.file.id, state: run.file.state, record: run.file.record };
            }
        }
        return undefined;
    }
    async nextTaskForReview(change, tasks, cwd) {
        const checked = tasks.filter((task) => task.checked);
        if (checked.length === 0) {
            fail(`change "${change.name}" has no checked task; tick the completed task in tasks.md, then run its review`);
        }
        for (const task of checked) {
            if (!(await this.taskHasReview(change, cwd, task.id)))
                return task;
        }
        // Every checked task is already reviewed: return the last one so the caller
        // reuses its matching PASS/ERROR record instead of running the target again.
        return checked[checked.length - 1];
    }
    taskReviewRules() {
        return this.config.rules.filter((rule) => rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task');
    }
    async taskHasReview(change, cwd, taskId) {
        for (const rule of this.taskReviewRules()) {
            const state = await inspectRecord(recordPath(cwd, rule, change.name, taskId));
            if (recordSatisfies(state, change.name, 'task', undefined, taskId))
                return true;
        }
        return false;
    }
    /** PASS-only approval over every checked task, independent of session attribution. */
    async changeApproval(change, openspecRoot, tasks) {
        return changeApproval(this.config, change, openspecRoot, tasks);
    }
    async runPatch(rule, args, agent, cwd, signal) {
        const target = this.target(rule);
        if (target.write !== true) {
            fail(`rule "${rule.id}": target "${rule.to}" is not declared write-capable; a patch rule never silently escalates`);
        }
        const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
        const worktree = join(cwd, DELEGATION_DIR, 'worktrees', runId);
        await this.services.git.runGit(['worktree', 'add', '--detach', worktree, 'HEAD'], cwd, signal);
        const result = await runTarget(this.services, {
            rule,
            target,
            prompt: patchPrompt(rule, args.context, args.objective ?? ''),
            agent,
            cwd: worktree,
            signal,
        });
        const status = (await this.services.git.runGit(['-C', worktree, 'status', '--porcelain=v1'], cwd, signal))
            .toString('utf8')
            .trim();
        let diff = '';
        try {
            diff = (await this.services.git.runGit(['-C', worktree, 'diff', '--binary', 'HEAD'], cwd, signal))
                .toString('utf8')
                .trim();
        }
        catch {
            diff = '[diff unavailable]';
        }
        const changed = status === '' ? '(no changed files reported)' : status;
        return [
            `patch "${rule.id}" completed in isolated worktree ${relativePath(cwd, worktree)}`,
            '',
            'Changed files:',
            changed,
            '',
            `Diff${diff.length > 40_000 ? ' (truncated)' : ''}:`,
            diff.length === 0 ? '(empty)' : diff.slice(0, 40_000),
            '',
            'Target report:',
            result.text.slice(0, MAX_ANSWER_CHARS),
            '',
            'Nothing was applied to the session worktree. Review the diff and merge manually.',
        ].join('\n');
    }
    async taskProgress(args, context) {
        const agent = this.requireAgent(context);
        const cwd = this.services.workingDirectory.get(agent.session);
        const openspecRoot = await findOpenSpecRoot(cwd);
        if (openspecRoot === undefined) {
            fail('no openspec/changes directory was found from the session working directory; task progress notes belong to an OpenSpec change');
        }
        const workspaceRoot = dirname(openspecRoot);
        const wanted = args.task.trim();
        if (wanted === '')
            fail('task_progress needs task: the task text from tasks.md (or a task id)');
        const matches = [];
        for (const change of await listActiveChanges(openspecRoot)) {
            let tasks;
            try {
                tasks = await readTasks(change.dir);
            }
            catch {
                // An unrelated change with no readable tasks.md must not block this note.
                continue;
            }
            for (const task of tasks) {
                const fullText = normalizeTaskText(`${task.number} ${task.text}`);
                if (task.id === wanted ||
                    normalizeTaskText(task.text) === normalizeTaskText(wanted) ||
                    fullText === normalizeTaskText(wanted)) {
                    matches.push({ change, task });
                }
            }
        }
        if (matches.length === 0) {
            fail('task_progress: the task was not found in any active change; pass the full task text from tasks.md or its 16-character task id');
        }
        if (matches.length > 1) {
            const changes = [...new Set(matches.map((match) => match.change.name))];
            fail(`task_progress: the task text matches more than one active change (${changes.join(', ')}); tick or note the task only in the change you are implementing`);
        }
        const match = matches[0];
        if (match.task.checked) {
            fail(`task_progress: task "${match.task.number} ${match.task.text}" is checked; a completed task needs its task-review PASS/ERROR, not a progress note`);
        }
        // An explicit note opts this session into the change; it is valid in any session.
        await this.attributeChange(workspaceRoot, agent, match.change.name);
        const digest = await worktreeDigest(cwd, this.services.git, context.signal);
        const note = {
            taskId: match.task.id,
            status: args.status,
            reason: sanitizeText(args.reason.trim() === '' ? args.status : args.reason, MAX_REASON_CHARS),
            worktreeDigest: digest,
            time: this.now(),
        };
        const path = notePath(cwd, match.change.name);
        await writeJsonAtomic(path, note);
        return [
            `progress note written for change "${match.change.name}" (${relativePath(cwd, path)})`,
            `task: ${match.task.number} ${match.task.text}`,
            `task id: ${note.taskId}`,
            `status: ${note.status}`,
            `worktree digest: ${digest}`,
            '',
            'No model was run. This note lets a code-changing turn close only while the worktree matches that digest; after any further change it is stale, and the next turn must refresh it or tick the task and run its task review.',
        ].join('\n');
    }
    async delegationStatus(context) {
        const agent = this.requireAgent(context);
        const cwd = this.services.workingDirectory.get(agent.session);
        const thread = currentThread(agent);
        const providers = this.services.subagents.list();
        const lines = ['Delegation status', '', 'Registered subagent providers:'];
        if (providers.length === 0)
            lines.push('- (none)');
        for (const providerName of providers) {
            const provider = this.services.subagents.getProvider(providerName);
            if (provider === undefined)
                continue;
            const capabilities = provider.capabilities;
            const flags = [
                capabilities.agentOptions ? 'agentOptions' : '',
                capabilities.outputSchema ? 'outputSchema' : '',
                capabilities.depthLimit ? 'depthLimit' : '',
                capabilities.agentPreset ? 'agentPreset' : '',
            ].filter((flag) => flag !== '');
            lines.push(`- ${provider.name}: ${flags.join(', ') || 'no optional capabilities'}; inheritsParentContext=${provider.inheritsParentContext}`);
        }
        lines.push('', 'Configured targets:');
        if (this.config.targets.size === 0)
            lines.push('- (none configured)');
        for (const [id, target] of this.config.targets) {
            const provider = this.services.subagents.getProvider(target.provider);
            const availability = provider === undefined
                ? `MISSING provider "${target.provider}" (install/enable it, or repoint targets.${id})`
                : 'available';
            const options = resolveAgentOptions(target);
            const model = options?.model;
            const effort = options?.reasoningEffort;
            const capabilityProblem = options !== undefined &&
                provider !== undefined &&
                provider.capabilities.agentOptions !== true
                ? '; provider does not support model/reasoningEffort/agentOptions'
                : '';
            lines.push(`- ${id}: provider=${target.provider}${model === undefined ? '' : ` model=${model}`}${effort === undefined ? '' : ` reasoningEffort=${effort}`}${target.write === true ? ' write=true' : ''} (${availability}${capabilityProblem})`);
        }
        lines.push('', 'Configured rules:');
        if (this.config.rules.length === 0)
            lines.push('- (none configured; delegate reports no rules)');
        for (const rule of this.config.rules) {
            lines.push(`- ${rule.id}: when=${rule.when} contract=${rule.contract} gate=${rule.gate}${rule.to === undefined ? '' : ` to=${rule.to}`}${rule.scope === undefined ? '' : ` scope=${rule.scope}`}${rule.phase === undefined ? '' : ` phase=${rule.phase}`}`);
        }
        const openspecRoot = await findOpenSpecRoot(cwd);
        lines.push('', 'OpenSpec changes and records:');
        if (openspecRoot === undefined) {
            lines.push('- no openspec/changes directory was found from the session working directory');
        }
        else {
            const changes = await listActiveChanges(openspecRoot);
            if (changes.length === 0)
                lines.push('- no active change');
            const workspaceRoot = dirname(openspecRoot);
            const involvementRead = await readInvolvement(workspaceRoot, thread);
            if (involvementRead.warning !== undefined) {
                lines.push(`- session involvement: ${involvementRead.warning}`);
            }
            for (const change of changes) {
                const entry = involvementRead.involvement.changes[change.name];
                lines.push(`- ${change.name} (${change.reviewReady ? 'review-ready' : 'not review-ready'})`);
                let tasks;
                try {
                    tasks = await readTasks(change.dir);
                }
                catch (error) {
                    lines.push(`  tasks: unreadable (${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)})`);
                }
                const attributedChecked = entry === undefined
                    ? 0
                    : tasks === undefined
                        ? entry.tasks.length
                        : tasks.filter((task) => task.checked && entry.tasks.includes(task.id)).length;
                lines.push(`  this session: ${entry === undefined ? 'not involved' : involvementSummary(entry, attributedChecked)}`);
                if (tasks === undefined)
                    continue;
                const checked = tasks.filter((task) => task.checked);
                lines.push(`  tasks: ${checked.length}/${tasks.length} checked`);
                for (const rule of this.config.rules) {
                    if (rule.contract !== 'review')
                        continue;
                    if (rule.scope === 'task')
                        continue;
                    if (rule.phase === undefined)
                        continue;
                    const path = recordPath(cwd, rule, change.name);
                    const state = await inspectRecord(path);
                    let detail;
                    if (state.kind === 'missing')
                        detail = 'missing';
                    else if (state.kind === 'malformed')
                        detail = `malformed (${state.error})`;
                    else {
                        const fresh = rule.when === 'implementation-complete'
                            ? await this.recordMatchesCurrentWorktree(cwd, state.record, context.signal)
                            : (await specDigest(change.dir, context.signal)) === state.record.digest;
                        detail = `${state.record.verdict} (${fresh ? 'matching current digest' : 'stale'})`;
                    }
                    lines.push(`  ${rule.id}: ${detail} at ${relativePath(cwd, path)}`);
                }
                for (const rule of this.taskReviewRules()) {
                    const reviewed = new Set();
                    for (const task of checked) {
                        const path = recordPath(cwd, rule, change.name, task.id);
                        const state = await inspectRecord(path);
                        if (state.kind === 'record' &&
                            (state.record.verdict === 'PASS' || state.record.verdict === 'ERROR')) {
                            reviewed.add(task.id);
                        }
                    }
                    lines.push(`  ${rule.id}: ${reviewed.size}/${checked.length} checked task(s) with a PASS/ERROR record`);
                }
                const approval = await this.changeApproval(change, openspecRoot, tasks);
                if ('error' in approval) {
                    lines.push(`  task approval: unavailable (${sanitizeText(approval.error, MAX_ERROR_CHARS)})`);
                }
                else {
                    const coverage = approval.coverage;
                    lines.push(`  task approval: ${approvalSummaryLine(coverage)}`);
                    for (const gap of formatApprovalGapLines(coverage))
                        lines.push(`  ${gap}`);
                }
                const note = await inspectNote(cwd, change.name);
                if (note.kind === 'note') {
                    let digest;
                    try {
                        digest = await worktreeDigest(cwd, this.services.git, context.signal);
                    }
                    catch {
                        digest = undefined;
                    }
                    const task = tasks.find((entry) => entry.id === note.note.taskId);
                    const fresh = digest !== undefined && digest === note.note.worktreeDigest;
                    const completed = task === undefined || task.checked;
                    lines.push(`  progress note: ${note.note.status}${task === undefined ? ' (task not found)' : ` for "${task.text}"`} - ${fresh && !completed ? 'active' : fresh ? 'stale (task completed)' : 'stale (worktree changed)'} at ${relativePath(cwd, notePath(cwd, change.name))}`);
                }
                else if (note.kind === 'malformed') {
                    lines.push(`  progress note: malformed at ${relativePath(cwd, notePath(cwd, change.name))}`);
                }
                else {
                    lines.push('  progress note: none');
                }
            }
            const runs = await listRunFiles(workspaceRoot);
            lines.push('', 'Review runs:');
            if (runs.length === 0)
                lines.push('- none');
            for (const run of runs) {
                lines.push(`- run ${run.id}: rule=${run.rule} change=${run.change}${run.taskId === undefined ? '' : ` task=${run.taskId}`} state=${run.state} record=${run.record}${run.detail === undefined ? '' : ` detail="${run.detail}"`}`);
            }
        }
        return lines.join('\n');
    }
    async recordMatchesCurrentWorktree(cwd, record, signal) {
        try {
            return (await worktreeDigest(cwd, this.services.git, signal)) === record.digest;
        }
        catch {
            return false;
        }
    }
}
/** Per-turn steering once for a soft issue, keyed by rule/digest/task. */
function softIssue(deps, agentId, key, ruleId, text, call) {
    if (deps.state.wasSteered(agentId, key))
        return undefined;
    deps.state.markSteered(agentId, key);
    return { ruleId, text, call, soft: true };
}
/** Group a change's task plan into lanes; an unreadable plan fails open. */
async function readTaskLanes(changeDir) {
    try {
        return parseTaskLanes(await readFile(join(changeDir, 'tasks.md'), 'utf8'));
    }
    catch {
        return [];
    }
}
/** An argument value safe to print inside a double-quoted suggested call. */
function quotedArg(text) {
    return text.replace(/"/gu, "'");
}
/** One ready-to-paste worker call that takes a remaining lane in its own worktree. */
function laneWorkerCall(changeName, lane, index) {
    const worktree = `wt-${changeName}-${index + 1}`;
    const branch = `lane-${changeName}-${index + 1}`;
    const heading = `the heading '${lane.title}'`;
    const prompt = `Implement the unchecked tasks under ${heading} in openspec/changes/${changeName}/tasks.md. ` +
        `Work in your own worktree: resolve the repository root with git rev-parse --show-toplevel, ` +
        `then from that root run git worktree add ../${worktree} -b ${branch} ` +
        '(pick another suffix if that path already exists; the worktree must be a sibling of the ' +
        'repository, never inside it), then run pnpm install --frozen-lockfile inside it. ' +
        `Read that change's proposal.md, design.md, and spec deltas first. ` +
        `Work only inside ${lane.owns.join(', ')}. ` +
        `Do not tick tasks.md; report the branch ${branch}, the files changed, and the commands you ran.`;
    return `subagent(description: "${quotedArg(`Lane: ${lane.title}`.slice(0, 80))}", prompt: "${quotedArg(prompt)}")`;
}
/**
 * Evaluate every gated rule and steer the agent once when something is unmet.
 * This function never starts a target and returns no value; the caller (the
 * `agent/turn-stopping` listener) contains every failure.
 */
async function evaluateGate(deps, agent, turn, signal) {
    if (agent.session.header.origin === 'subagent')
        return;
    const agentId = String(agent.id);
    const thread = currentThread(agent);
    const cwd = deps.services.workingDirectory.get(agent.session);
    const openspecRoot = await findOpenSpecRoot(cwd);
    const workspaceRoot = openspecRoot === undefined ? undefined : dirname(openspecRoot);
    const changes = openspecRoot === undefined ? [] : await listActiveChanges(openspecRoot);
    // All active changes are snapshotted so a new or newly edited change is
    // detectable; only the session's involved changes are evaluated.
    const current = await captureSnapshot(cwd, changes, deps.services.git, signal);
    const baseline = deps.state.baselineOf(agentId, turn);
    const turnBaseline = deps.state.turnBaselineOf(agentId, turn);
    const involvement = workspaceRoot === undefined
        ? emptyInvolvement(thread)
        : await withInvolvementLock(workspaceRoot, thread, async () => {
            const read = await readInvolvement(workspaceRoot, thread);
            if (turnBaseline !== undefined) {
                const evidence = deps.state.evidenceOf(agentId);
                if (evidence.size > 0 &&
                    applyTurnEvidence(read.involvement, evidence, turnBaseline, current)) {
                    await writeInvolvement(workspaceRoot, read.involvement);
                }
            }
            return read.involvement;
        });
    const involved = changes.filter((change) => involvement.changes[change.name] !== undefined);
    const issues = [];
    const digestShort = (digest) => digest === undefined ? '(unavailable)' : digest.slice(0, 12);
    const digestFailure = () => current.digestError;
    const pushStrict = (ruleId, text, call) => {
        issues.push({ ruleId, text, call, soft: false });
    };
    const pushSoft = (key, ruleId, text, call) => {
        const issue = softIssue(deps, agentId, key, ruleId, text, call);
        if (issue !== undefined)
            issues.push(issue);
    };
    const noMatchDetail = (state, expectedDigest, path) => {
        const record = relativePath(cwd, path);
        if (state.kind !== 'record')
            return `no PASS/ERROR record at ${record}`;
        if (state.record.verdict === 'FINDINGS') {
            return `its FINDINGS record at ${record} is unresolved; fix the findings and re-review`;
        }
        return `${state.record.verdict} record at ${record} is stale (recorded ${digestShort(state.record.digest)}, current ${digestShort(expectedDigest)})`;
    };
    const pendingFor = (ruleId, changeName, taskId) => workspaceRoot === undefined
        ? undefined
        : deps.services.pendingReview?.(workspaceRoot, ruleId, changeName, taskId);
    if (openspecRoot !== undefined) {
        for (const change of involved) {
            const entry = involvement.changes[change.name];
            const changeSnapshot = current.changes.find((entry) => entry.name === change.name);
            const tasks = changeSnapshot?.tasks ?? [];
            const changeSpecDigest = changeSnapshot?.specDigest;
            if (changeSnapshot?.error !== undefined) {
                pushSoft(`change-artifacts:${change.name}`, 'change-artifacts', `change "${change.name}" (session ${thread}) ${changeSnapshot.error}; repair that change's artifacts or archive the change so its gated reviews can be evaluated.`, `repair openspec/changes/${change.name} (or archive the change)`);
                continue;
            }
            for (const rule of deps.config.rules) {
                if (rule.when === 'spec-ready' &&
                    rule.contract === 'review' &&
                    rule.scope === 'whole' &&
                    rule.gate !== 'none' &&
                    (entry.created || entry.specChanged)) {
                    if (!change.reviewReady)
                        continue;
                    const path = recordPath(cwd, rule, change.name);
                    const state = await inspectRecord(path);
                    const matching = recordSatisfies(state, change.name, 'whole', changeSpecDigest);
                    if (matching)
                        continue;
                    const pending = pendingFor(rule.id, change.name);
                    const detail = pending === undefined
                        ? noMatchDetail(state, changeSpecDigest, path)
                        : `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`;
                    const text = `rule "${rule.id}": whole-spec review of change "${change.name}" is required for spec digest ${digestShort(changeSpecDigest)} (${detail}).`;
                    const call = pending === undefined
                        ? `delegate(rule: "${rule.id}", change: "${change.name}")`
                        : `delegation_status (run ${pending.id})`;
                    if (rule.gate === 'strict')
                        pushStrict(rule.id, text, call);
                    else
                        pushSoft(`spec-review:${rule.id}:${change.name}:${changeSpecDigest ?? 'none'}`, rule.id, text, call);
                }
                if (rule.when === 'implementation-complete' &&
                    rule.contract === 'review' &&
                    rule.scope === 'whole' &&
                    rule.gate !== 'none' &&
                    entry.completed &&
                    tasks.length > 0 &&
                    tasks.every((task) => task.checked)) {
                    const path = recordPath(cwd, rule, change.name);
                    const state = await inspectRecord(path);
                    const matching = recordSatisfies(state, change.name, 'whole', current.digest);
                    if (matching)
                        continue;
                    const pending = pendingFor(rule.id, change.name);
                    const detail = pending === undefined
                        ? noMatchDetail(state, current.digest, path)
                        : `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`;
                    const text = `rule "${rule.id}": integration review of change "${change.name}" is ${rule.gate === 'soft' ? 'suggested' : 'required'} for worktree digest ${digestShort(current.digest)} (${detail}).`;
                    const call = pending === undefined
                        ? `delegate(rule: "${rule.id}", change: "${change.name}")`
                        : `delegation_status (run ${pending.id})`;
                    if (rule.gate === 'strict')
                        pushStrict(rule.id, text, call);
                    else
                        pushSoft(`integration:${rule.id}:${change.name}:${current.digest ?? 'none'}`, rule.id, text, call);
                }
            }
            const taskRules = deps.config.rules.filter((rule) => rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task');
            const strictTaskRule = taskRules.find((rule) => rule.gate === 'strict');
            const softTaskRule = taskRules.find((rule) => rule.gate === 'soft');
            // Only the checked tasks this session attributed are in its review scope.
            for (const task of tasks.filter((task) => task.checked && entry.tasks.includes(task.id))) {
                let satisfied = false;
                let findingsOnly = false;
                for (const rule of taskRules) {
                    const state = await inspectRecord(recordPath(cwd, rule, change.name, task.id));
                    if (recordSatisfies(state, change.name, 'task', undefined, task.id)) {
                        satisfied = true;
                        break;
                    }
                    if (state.kind === 'record' && state.record.verdict === 'FINDINGS')
                        findingsOnly = true;
                }
                if (satisfied)
                    continue;
                const ruleId = (strictTaskRule ?? softTaskRule)?.id ?? 'task-review';
                const pending = pendingFor(ruleId, change.name, task.id);
                const detail = pending !== undefined
                    ? `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
                    : findingsOnly
                        ? 'its review record has unresolved findings'
                        : 'it has no task-review PASS/ERROR record';
                const text = `rule "${ruleId}": checked task "${task.number} ${task.text}" in change "${change.name}" requires its task-scoped review; ${detail}.`;
                const call = pending === undefined
                    ? `delegate(rule: "${ruleId}", change: "${change.name}", task: "${task.id}")`
                    : `delegation_status (run ${pending.id})`;
                if (strictTaskRule !== undefined)
                    pushStrict(ruleId, text, call);
                else if (softTaskRule !== undefined) {
                    pushSoft(`task-review:${change.name}:${task.id}`, ruleId, text, call);
                }
            }
            // The completing session must obtain an approval for every checked task,
            // not only the tasks its own tick attributed.
            if (entry.completed &&
                taskRules.length > 0 &&
                tasks.length > 0 &&
                tasks.every((task) => task.checked)) {
                const approval = await changeApproval(deps.config, change, openspecRoot, tasks);
                if ('error' in approval) {
                    pushStrict((strictTaskRule ?? softTaskRule)?.id ?? 'task-review', `completion of change "${change.name}" requires a portable task-review PASS for every checked task, but the approval could not be evaluated: ${approval.error}`, `repair openspec/changes/${change.name} (or ${APPROVAL_MARKER_FILE}) and run the task reviews`);
                }
                else {
                    for (const line of approval.coverage.unparseable) {
                        pushStrict(approval.coverage.rule, `completion of change "${change.name}" cannot be approved: checked line ${line.line} "${line.text}" is not a numbered task`, `fix the checked line in openspec/changes/${change.name}/tasks.md`);
                    }
                    for (const task of approval.coverage.tasks) {
                        if (task.state === 'pass')
                            continue;
                        const ruleId = approval.coverage.rule;
                        const pending = pendingFor(ruleId, change.name, task.id);
                        const detail = pending !== undefined
                            ? `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
                            : (task.detail ?? 'it has no portable PASS record');
                        const text = `rule "${ruleId}": the task list of change "${change.name}" is fully checked, so completion requires a portable task-review PASS for checked task "${task.number} ${task.text}"; ${detail}.`;
                        const call = pending === undefined
                            ? `delegate(rule: "${ruleId}", change: "${change.name}", task: "${task.id}")`
                            : `delegation_status (run ${pending.id})`;
                        if (strictTaskRule !== undefined)
                            pushStrict(ruleId, text, call);
                        else if (softTaskRule !== undefined) {
                            pushSoft(`completion:${change.name}:${task.id}`, ruleId, text, call);
                        }
                    }
                }
            }
            const workRules = deps.config.rules.filter((rule) => rule.when === 'implementation-work' && rule.contract === 'note');
            if (workRules.length > 0) {
                const base = baseline?.changes.find((entry) => entry.name === change.name);
                const baseChecked = new Set((base?.tasks ?? []).filter((task) => task.checked).map((task) => task.id));
                const newlyChecked = tasks.filter((task) => task.checked && entry.tasks.includes(task.id) && !baseChecked.has(task.id));
                const ownChecked = tasks.filter((task) => task.checked && entry.tasks.includes(task.id));
                const reviewedOwn = new Set();
                for (const task of ownChecked) {
                    for (const rule of taskRules) {
                        const state = await inspectRecord(recordPath(cwd, rule, change.name, task.id));
                        if (recordSatisfies(state, change.name, 'task', undefined, task.id)) {
                            reviewedOwn.add(task.id);
                            break;
                        }
                    }
                }
                const tickedReviewed = newlyChecked.some((task) => reviewedOwn.has(task.id));
                let matchingNote = false;
                const note = await inspectNote(cwd, change.name);
                if (note.kind === 'note' && current.digest !== undefined) {
                    const task = tasks.find((entry) => entry.id === note.note.taskId);
                    matchingNote =
                        note.note.worktreeDigest === current.digest && task !== undefined && !task.checked;
                }
                const changed = baseline !== undefined &&
                    baseline.implementationFingerprint !== undefined &&
                    current.implementationFingerprint !== undefined &&
                    baseline.implementationFingerprint !== current.implementationFingerprint;
                if (changed && !tickedReviewed && !matchingNote) {
                    const nextTask = tasks.find((task) => !task.checked);
                    const taskReviewRule = strictTaskRule ?? softTaskRule;
                    const ownReviewTarget = ownChecked.find((task) => !reviewedOwn.has(task.id));
                    const what = nextTask === undefined
                        ? ownReviewTarget === undefined
                            ? 'the task list is fully checked and this session has no unreviewed task; add a task for follow-up work or archive the change'
                            : `review task "${ownReviewTarget.number} ${ownReviewTarget.text}"`
                        : taskReviewRule === undefined
                            ? `tick the completed task, or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
                            : `tick the completed task and run delegate(rule: "${taskReviewRule.id}"), or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`;
                    const ruleId = workRules.find((rule) => rule.gate === 'strict')?.id ??
                        workRules[0]?.id ??
                        'task-progress';
                    const text = `rule "${ruleId}": this turn changed implementation files in change "${change.name}" without a newly checked-and-reviewed task and without a matching progress note for worktree digest ${digestShort(current.digest)}; ${what}.`;
                    const call = nextTask === undefined && taskReviewRule !== undefined && ownReviewTarget !== undefined
                        ? `delegate(rule: "${taskReviewRule.id}", change: "${change.name}", task: "${ownReviewTarget.id}")`
                        : nextTask === undefined
                            ? 'delegation_status: no unchecked or unreviewed session task remains; add a task for follow-up work or archive the change'
                            : `task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`;
                    if (workRules.some((rule) => rule.gate === 'strict'))
                        pushStrict(ruleId, text, call);
                    else
                        pushSoft(`implementation-work:${change.name}:${current.implementationFingerprint ?? 'none'}`, ruleId, text, call);
                }
            }
            // A completed lane is a decision point: fan out the lanes that remain, or
            // record the serial decision. Everything here fails open.
            const laneRules = deps.config.rules.filter((rule) => rule.when === 'lane-boundary' && rule.contract === 'note' && rule.gate !== 'none');
            if (laneRules.length > 0 && !deps.state.hasWorkerStart(agentId)) {
                // Lane completion comes from this session's own canonical write pair, so
                // another session's final tick can never gate this one.
                const evidence = deps.state.evidenceOf(agentId).get(change.name);
                const completions = [];
                for (const write of evidence?.taskWrites ?? []) {
                    const before = parseTaskLanes(write.before ?? '');
                    for (const lane of parseTaskLanes(write.after)) {
                        if (lane.tasks.length === 0)
                            continue;
                        if (!lane.tasks.every((task) => task.checked))
                            continue;
                        // A matching before-write lane with an unchecked task is the only
                        // evidence that this write completed the lane; a renamed or newly
                        // supplied lane has no such evidence and fails open. A deletion that
                        // leaves the lane checked carries no checked-off transition, so it is
                        // not a completion either.
                        const previous = before.find((entry) => entry.title === lane.title);
                        if (previous === undefined)
                            continue;
                        const uncheckedBefore = new Set(previous.tasks.filter((task) => !task.checked).map((task) => task.id));
                        const completedTask = lane.tasks.some((task) => task.checked && uncheckedBefore.has(task.id));
                        if (!completedTask)
                            continue;
                        completions.push({ title: lane.title, taskIds: lane.tasks.map((task) => task.id) });
                    }
                }
                if (completions.length > 0) {
                    const lanes = await readTaskLanes(change.dir);
                    // A completion only stands while the current plan still holds the lane
                    // complete and every task that carried it; a removed or reopened task
                    // invalidates the evidence instead of gating the turn.
                    const completedTitles = new Set(completions
                        .filter(({ title, taskIds }) => {
                        const lane = lanes.find((entry) => entry.title === title);
                        return (lane !== undefined &&
                            lane.tasks.length > 0 &&
                            lane.tasks.every((task) => task.checked) &&
                            taskIds.every((id) => lane.tasks.some((task) => task.id === id)));
                    })
                        .map(({ title }) => title));
                    const firstTitle = [...completedTitles][0];
                    if (firstTitle !== undefined) {
                        // Any remaining unchecked lane without owned paths means the plan does
                        // not follow the lane convention, so the whole boundary fails open.
                        const candidates = lanes.filter((lane) => !/serial/iu.test(lane.title) &&
                            !completedTitles.has(lane.title) &&
                            lane.tasks.some((task) => !task.checked));
                        const remaining = candidates.filter((lane) => lane.owns.length > 0);
                        if (remaining.length > 0 && remaining.length === candidates.length) {
                            const note = await inspectNote(cwd, change.name);
                            const noteTask = note.kind === 'note' ? note.note.taskId : undefined;
                            const escaped = noteTask !== undefined &&
                                current.digest !== undefined &&
                                note.kind === 'note' &&
                                note.note.worktreeDigest === current.digest &&
                                laneOfTask(remaining, noteTask) !== undefined;
                            if (!escaped) {
                                const ruleId = laneRules.find((rule) => rule.gate === 'strict')?.id ??
                                    laneRules[0]?.id ??
                                    'lane-fanout';
                                const titles = remaining.map((lane) => `"${lane.title}"`).join(', ');
                                const next = remaining[0]?.tasks.find((task) => !task.checked);
                                const call = [
                                    'commit the current worktree first, because a new checkout only sees commits;',
                                    'the :/ and :(top) pathspecs keep both commands anchored to the repository root:',
                                    `  git add -A :/; git add -f ":(top)openspec/changes/${change.name}"; git commit -m "lane checkpoint before fan-out"`,
                                    'start one worker per lane (they run in parallel):',
                                    ...remaining.map((lane, index) => `  ${laneWorkerCall(change.name, lane, index)}`),
                                    'or record the serial decision:',
                                    next === undefined
                                        ? '  delegation_status'
                                        : `  task_progress(task: "${next.number} ${next.text}", status: "in-progress", reason: "why this lane stays serial")`,
                                ].join('\n');
                                const text = `rule "${ruleId}": lane "${firstTitle}" is complete and ${remaining.length} other lane(s) still have unchecked tasks (${titles}); this turn started no parallel worker in change "${change.name}".`;
                                if (laneRules.some((rule) => rule.gate === 'strict'))
                                    pushStrict(ruleId, text, call);
                                else
                                    pushSoft(`lane-boundary:${change.name}:${firstTitle}`, ruleId, text, call);
                            }
                        }
                    }
                }
            }
        }
    }
    if (openspecRoot !== undefined && current.digestError !== undefined && involved.length > 0) {
        pushStrict('digest', `the worktree digest could not be computed (${current.digestError}); fix the git workspace failure so gated rules can be evaluated.`, 'git status --porcelain=v1 -z --untracked-files=all');
    }
    for (const rule of deps.config.rules) {
        if (rule.when !== 'failure-streak' || rule.gate === 'none')
            continue;
        const threshold = rule.threshold ?? deps.config.failureStreak;
        const failures = deps.state.failuresOf(agentId);
        if (failures < threshold || deps.state.consulted(agentId))
            continue;
        const text = `rule "${rule.id}": ${failures} consecutive failed tool calls with no consultation attempt for this streak; consult before retrying the same approach again.`;
        const call = `delegate(rule: "${rule.id}", context: "${failures} consecutive tool failures; here are the failing calls and the current plan")`;
        if (rule.gate === 'strict')
            pushStrict(rule.id, text, call);
        else
            pushSoft(`failure-streak:${rule.id}:${deps.state.epochOf(agentId)}`, rule.id, text, call);
    }
    deps.state.rememberSnapshot(agentId, current);
    if (issues.length === 0)
        return;
    const lines = [
        'Delegation gate (delegation-rules) is not satisfied; this turn needs another step.',
        '',
    ];
    issues.forEach((issue, index) => {
        lines.push(`${index + 1}. ${issue.soft ? 'Soft hint' : 'Required'} - ${issue.text}`);
        lines.push(`   Run: ${issue.call}`);
    });
    lines.push('', 'Only a matching record (or a fresh task_progress note) satisfies the gate; a text claim does not.');
    const digestNote = digestFailure();
    if (digestNote !== undefined)
        lines.push(`Digest failure: ${digestNote}`);
    agent.steer(gateMessage(lines.join('\n')));
}
/** The shell command a tool execution runs, if it is one the guard understands. */
function archiveShellInvocation(exec) {
    const args = isRecord(exec.arguments) ? exec.arguments : {};
    if (exec.name === 'terminal_send') {
        return typeof args.text === 'string' ? { command: args.text } : undefined;
    }
    if (exec.name !== 'pwsh' && exec.name !== 'bash')
        return undefined;
    if (typeof args.command !== 'string')
        return undefined;
    return typeof args.workdir === 'string'
        ? { command: args.command, cwd: args.workdir }
        : { command: args.command };
}
function archiveDenial(reason) {
    return { kind: 'deny', reason };
}
/**
 * The opt-in archive gate: refuses the documented archive forms before they
 * run when a checked task lacks a portable task-review PASS. It applies to
 * subagents too; only the turn-stopping gate skips them.
 */
async function archiveGateDecision(deps, exec) {
    if (exec.agent === undefined)
        return undefined;
    const invocation = archiveShellInvocation(exec);
    if (invocation === undefined)
        return undefined;
    const sessionCwd = deps.services.workingDirectory.get(exec.agent.session);
    const executionCwd = invocation.cwd === undefined ? sessionCwd : resolve(sessionCwd, invocation.cwd);
    const intents = recognizeArchiveCommands(invocation.command, executionCwd);
    if (intents.length === 0)
        return undefined;
    const openspecRoot = findOpenSpecRootSync(executionCwd);
    if (openspecRoot === undefined)
        return undefined;
    const markerPath = join(openspecRoot, APPROVAL_MARKER_FILE);
    let raw;
    try {
        raw = await readFile(markerPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return undefined;
        return archiveDenial(`archive refused: the approval marker at ${relativePath(sessionCwd, markerPath)} is unreadable (${errorMessage(error)}); nothing was archived.`);
    }
    let marker;
    try {
        const parsed = parseReviewApprovalMarker(JSON.parse(raw));
        if (parsed.marker === undefined) {
            return archiveDenial(`archive refused: ${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}; nothing was archived.`);
        }
        marker = parsed.marker;
    }
    catch (error) {
        return archiveDenial(`archive refused: ${APPROVAL_MARKER_FILE} is not valid JSON (${errorMessage(error)}); nothing was archived.`);
    }
    if (!marker.archiveGate)
        return undefined;
    const rule = deps.config.rules.find((entry) => entry.id === marker.taskRule);
    if (rule === undefined) {
        return archiveDenial(`archive refused: marker taskRule "${marker.taskRule}" is not a configured rule; add it or fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`);
    }
    if (rule.contract !== 'review' || rule.scope !== 'task') {
        return archiveDenial(`archive refused: marker taskRule "${rule.id}" is not a task-scoped review rule; fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`);
    }
    if (rule.gate !== 'strict') {
        return archiveDenial(`archive refused: marker taskRule "${rule.id}" is not a strict rule; fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`);
    }
    const gaps = [];
    for (const intent of intents) {
        const change = await readChange(openspecRoot, intent.change);
        if (change === undefined)
            continue;
        let tasks;
        try {
            tasks = await readTasks(change.dir);
        }
        catch (error) {
            return archiveDenial(`archive refused: change "${change.name}" has no readable tasks.md (${errorMessage(error)}); nothing was archived.`);
        }
        const approval = await changeApproval(deps.config, change, openspecRoot, tasks);
        if ('error' in approval) {
            return archiveDenial(`archive refused: change "${change.name}": ${approval.error}; nothing was archived.`);
        }
        if (approval.coverage.archiveReady)
            continue;
        gaps.push(`archive refused: change "${change.name}" is not approval-complete (${approvalSummaryLine(approval.coverage)}).`, ...formatApprovalGapLines(approval.coverage).map((line) => `  ${line}`));
    }
    if (gaps.length === 0)
        return undefined;
    gaps.push('Nothing was archived: the change remains active. Fix the lines above, run the exact delegate calls, then archive again.', 'Full audit: pnpm reviews:check --all');
    return archiveDenial(gaps.join('\n'));
}
function attachGate({ ctx, deps }) {
    ctx.on('agent/pre-step', async (payload, next) => {
        const decision = await next();
        try {
            if (payload.agent.session.header.origin === 'subagent')
                return decision;
            const agentId = String(payload.agent.id);
            if (!deps.state.beginTurn(agentId, payload.turn))
                return decision;
            const cwd = deps.services.workingDirectory.get(payload.agent.session);
            const root = await findOpenSpecRoot(cwd);
            const changes = root === undefined ? [] : await listActiveChanges(root);
            deps.state.setBaseline(agentId, await captureSnapshot(cwd, changes, deps.services.git, payload.signal));
        }
        catch {
            // A pre-step observer never fails the step.
        }
        return decision;
    });
    ctx.on('tools/result', (exec, result) => {
        try {
            if (exec.agent !== undefined) {
                const agentId = String(exec.agent.id);
                deps.state.recordToolResult(agentId, result.isError);
                const cwd = deps.services.workingDirectory.get(exec.agent.session);
                recordWriteEvidence(deps.state, agentId, cwd, exec, result);
                if (!result.isError && WORKER_TOOLS.has(exec.name)) {
                    deps.state.markWorkerStarted(agentId);
                }
            }
        }
        catch {
            // Observability never breaks tool dispatch.
        }
        return undefined;
    });
    ctx.on('agent/turn-stopping', async (payload) => {
        try {
            await evaluateGate(deps, payload.agent, payload.turn, payload.signal);
        }
        catch (error) {
            try {
                payload.agent.steer(gateMessage(`Delegation gate (delegation-rules) could not evaluate this turn: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}. Fix the workspace or plugin configuration; disabling the row is the explicit opt-out.`));
            }
            catch {
                // The gate never throws into the turn.
            }
        }
    });
    // Archive guard: deny the documented archive forms before any effect. It
    // applies to subagents too, unlike the turn-stopping gate.
    ctx.on('tools/pre-execute', async (exec, next) => {
        try {
            const decision = await archiveGateDecision(deps, exec);
            if (decision !== undefined)
                return decision;
        }
        catch (error) {
            return archiveDenial(`archive refused: the delegation-rules archive gate could not evaluate this command (${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}); nothing was archived.`);
        }
        return await next();
    });
}
function toolOutput(value) {
    return { text: value };
}
function renderOutput(value) {
    const text = isRecord(value) && typeof value.text === 'string' ? value.text : String(value);
    return [{ type: 'text', text }];
}
/** The `note` contract runs no target, so it borrows the answer timeout. */
function timeoutForContract(timeouts, contract) {
    return contract === 'note' ? timeouts.answer : timeouts[contract];
}
function buildToolDefinitions(engine, config) {
    const ruleIds = config.rules.map((rule) => rule.id);
    const output = {
        schema: TOOL_OUTPUT_SCHEMA,
        render: (_args, value) => renderOutput(value),
    };
    return [
        {
            name: 'delegate',
            description: toolDescriptions.delegate,
            parameters: {
                type: 'object',
                properties: {
                    rule: {
                        type: 'string',
                        enum: ruleIds,
                        description: 'One configured rule id; the enum lists every rule the engine knows.',
                    },
                    change: {
                        type: 'string',
                        description: 'Active OpenSpec change directory name; defaults to the only active change.',
                    },
                    task: {
                        type: 'string',
                        description: 'Task-scoped review only: the checked task id (or its task text) to review. Omit to let the engine pick the next checked task.',
                    },
                    context: {
                        type: 'string',
                        description: 'Facts the target needs: for the advisor, the exact question, constraints, and decisive evidence; otherwise failing output, relevant files, constraints.',
                    },
                    objective: {
                        type: 'string',
                        description: 'The concrete goal; required for the patch contract.',
                    },
                },
                required: ['rule'],
                additionalProperties: false,
            },
            output,
            execute: async (args, exec) => {
                const parsed = parseDelegateArgs(args);
                const agent = exec.agent;
                return toolOutput(await engine.runDelegate(parsed, { agent, signal: exec.signal }));
            },
        },
        {
            name: 'task_progress',
            description: toolDescriptions.task_progress,
            parameters: {
                type: 'object',
                properties: {
                    task: {
                        type: 'string',
                        description: 'Full task text from tasks.md, or its 16-character task id.',
                    },
                    status: {
                        type: 'string',
                        enum: ['in-progress', 'blocked'],
                        description: 'Explicit state of the unchecked task.',
                    },
                    reason: {
                        type: 'string',
                        description: 'Why the task spans turns or is blocked; recorded with the worktree digest.',
                    },
                },
                required: ['task', 'status', 'reason'],
                additionalProperties: false,
            },
            output,
            execute: async (args, exec) => {
                const parsed = parseProgressArgs(args);
                const agent = exec.agent;
                return toolOutput(await engine.taskProgress(parsed, { agent, signal: exec.signal }));
            },
        },
        {
            name: 'delegation_status',
            description: toolDescriptions.delegation_status,
            parameters: { type: 'object', properties: {}, additionalProperties: false },
            output,
            execute: async (_args, exec) => {
                const agent = exec.agent;
                return toolOutput(await engine.delegationStatus({ agent, signal: exec.signal }));
            },
        },
    ];
}
function parseDelegateArgs(args) {
    if (!isRecord(args))
        fail('delegate arguments must be an object');
    const rule = requireNonEmpty(args.rule, 'delegate.rule');
    const result = { rule };
    if (args.change !== undefined)
        result.change = requireNonEmpty(args.change, 'delegate.change');
    if (args.task !== undefined)
        result.task = requireNonEmpty(args.task, 'delegate.task');
    if (args.context !== undefined) {
        if (typeof args.context !== 'string')
            fail('delegate.context must be a string');
        result.context = args.context;
    }
    if (args.objective !== undefined) {
        if (typeof args.objective !== 'string')
            fail('delegate.objective must be a string');
        result.objective = args.objective;
    }
    return result;
}
function parseProgressArgs(args) {
    if (!isRecord(args))
        fail('task_progress arguments must be an object');
    const task = requireNonEmpty(args.task, 'task_progress.task');
    if (args.status !== 'in-progress' && args.status !== 'blocked') {
        fail('task_progress.status must be "in-progress" or "blocked"');
    }
    if (typeof args.reason !== 'string' || args.reason.trim() === '') {
        fail('task_progress.reason must be a non-empty string');
    }
    return { task, status: args.status, reason: args.reason };
}
function skillAdapterNote() {
    return [
        '',
        '',
        '---',
        '',
        'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-delegation-rules as first-party guidance for this Harness; it is not pinned upstream text. The engine has no provider dependency; the default targets are only data.',
    ].join('\n');
}
function createSkillProvider(note) {
    const invocation = { modelInvocable: true, userInvocable: true };
    const candidate = {
        name: SKILL_NAME,
        description: skillDescription,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: { kind: 'directory', path: assetsDirectory.replaceAll('\\', '/') },
        rank: BUNDLED_SKILL_RANK,
        locator: join(assetsDirectory, 'SKILL.md'),
    };
    return {
        name: PROVIDER_NAME,
        list: () => Promise.resolve([candidate]),
        async get(loaded, options) {
            if (loaded.name !== SKILL_NAME)
                return undefined;
            const body = await readFile(join(assetsDirectory, 'SKILL.md'), {
                encoding: 'utf8',
                signal: options.signal,
            });
            return {
                name: SKILL_NAME,
                description: skillDescription,
                invocation,
                provider: PROVIDER_NAME,
                source: 'bundled',
                resourceBase: candidate.resourceBase,
                content: `${body}${note}`,
            };
        },
    };
}
/**
 * Register the three tools, the on-demand skill, and the turn-stopping gate.
 * A missing subagent provider is not fatal here: it is diagnosed by the tools
 * and `delegation_status`, so the profile composes without that provider.
 */
export function apply(ctx, config = {}, options = {}) {
    const validated = validateConfig(config);
    const state = new DelegationState();
    const services = {
        subagents: ctx.subagents,
        workingDirectory: ctx.workingDirectory,
        state,
        git: { runGit: options.runGit ?? defaultGit },
        now: options.now ?? (() => new Date()),
        timeoutsFor: (rule) => timeoutForContract(validated.timeouts, rule.contract),
        ...(options.onRunSettled === undefined ? {} : { onRunSettled: options.onRunSettled }),
    };
    const engine = new DelegationEngine(validated, services);
    services.pendingReview = (workspaceRoot, ruleId, change, taskId) => engine.pendingReview(workspaceRoot, ruleId, change, taskId);
    for (const definition of buildToolDefinitions(engine, validated)) {
        ctx.tools.register(definition);
    }
    ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()));
    attachGate({ ctx, deps: { config: validated, state, services } });
}
