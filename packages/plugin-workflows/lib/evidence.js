import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
import { globMatches } from './evaluate.js';
import { isInside } from './fs-change.js';
import { readPortableApproval, reviewerBinding, taskReviewCoverage } from './parity.js';
import { checkpointRecordError, localRecordError, portableRecordError } from './projection.js';
import { reviewInputTree } from './review-snapshot.js';
/** A validated checkpoint record path a host-computed context value may carry. */
const CHECKPOINT_PATH = /^\.dsh\/work-checkpoints\/[a-f0-9]{16}\/[0-9]+\.json$/u;
/** A portable review task id a host-computed context value may carry. */
const TASK_ID = /^[a-f0-9]{16}$/u;
/** An evidence-path interpolation value: a validated identifier, task id, or checkpoint path. */
function validContextValue(value) {
    return CHANGE_NAME.test(value) || CHECKPOINT_PATH.test(value) || TASK_ID.test(value);
}
/** An evidence-path interpolation value: a validated identifier. */
function interpolate(value, context, item) {
    const replaced = value.replaceAll(/\{([a-zA-Z][a-zA-Z0-9-]*)\}/gu, (_match, key) => {
        const entry = context.values[key];
        return typeof entry === 'string' ? entry : '\u0000';
    });
    if (replaced.includes('\u0000')) {
        return {
            ok: false,
            failure: {
                reason: 'invalid-context',
                ...(item === undefined ? {} : { item }),
                detail: `evidence path "${value}" names a context value the run does not carry`,
            },
        };
    }
    for (const match of value.matchAll(/\{([a-zA-Z][a-zA-Z0-9-]*)\}/gu)) {
        const key = match[1] ?? '';
        const entry = context.values[key];
        if (typeof entry !== 'string' || !validContextValue(entry)) {
            return {
                ok: false,
                failure: {
                    reason: 'invalid-context',
                    ...(item === undefined ? {} : { item }),
                    detail: `evidence context "${key}" is not a validated value`,
                },
            };
        }
    }
    return { ok: true, evidence: { kind: 'file', path: replaced } };
}
/** Interpolate every placeholder in a free-form string with a validated value. */
export function resolveEvidenceText(value, context, item) {
    const checked = interpolate(value, context, item);
    if (!checked.ok)
        return checked;
    return { ok: true, text: checked.evidence.path ?? value };
}
function deepSubset(expected, actual) {
    if (expected === actual)
        return true;
    if (typeof expected !== 'object' || expected === null)
        return false;
    if (typeof actual !== 'object' || actual === null)
        return false;
    if (Array.isArray(expected) !== Array.isArray(actual))
        return false;
    if (Array.isArray(expected)) {
        const actualList = actual;
        return (expected.length === actualList.length &&
            expected.every((entry, index) => deepSubset(entry, actualList[index])));
    }
    const expectedRecord = expected;
    const actualRecord = actual;
    return Object.keys(expectedRecord).every((key) => key in actualRecord && deepSubset(expectedRecord[key], actualRecord[key]));
}
function failure(reason, detail, path, item) {
    return {
        ok: false,
        failure: {
            reason,
            detail,
            ...(path === undefined ? {} : { path }),
            ...(item === undefined ? {} : { item }),
        },
    };
}
/** Whether a workspace-relative path is safe by components before resolution. */
function safeRelativePath(path, item) {
    if (path.trim() === '') {
        return failure('invalid-evidence', 'the file path is empty', path, item);
    }
    if (isAbsolute(path) || /^[A-Za-z]:[\\/]/u.test(path)) {
        return failure('path-escape', `file path "${path}" is absolute`, path, item);
    }
    const segments = path.replaceAll('\\', '/').split('/');
    if (segments.some((segment) => segment === '..')) {
        return failure('path-escape', `file path "${path}" escapes the workspace`, path, item);
    }
    return undefined;
}
/** Canonical containment: the target and every existing ancestor stay inside. */
async function canonicalContained(root, target) {
    let current = target;
    for (;;) {
        try {
            const real = await realpath(current);
            return isInside(root, real);
        }
        catch {
            const parent = join(current, '..');
            if (parent === current)
                return false;
            current = parent;
        }
    }
}
async function fileCheck(evidence, context, item) {
    const interpolated = interpolate(evidence.path, context, item);
    if (!interpolated.ok)
        return interpolated;
    const path = interpolated.evidence.path ?? evidence.path;
    const structural = safeRelativePath(path, item);
    if (structural !== undefined)
        return structural;
    let root;
    try {
        root = await realpath(context.workspace);
    }
    catch {
        return failure('path-escape', 'the workspace is not readable', path, item);
    }
    if (evidence.glob === true) {
        const normalized = path
            .replaceAll('\\', '/')
            .split('/')
            .filter((segment) => segment !== '' && segment !== '.')
            .join('/');
        const matchPath = normalized === '' ? path : normalized;
        const expansion = await expandGlob(root, matchPath);
        if (expansion.failure !== undefined) {
            return failure(expansion.failure.reason, expansion.failure.detail, expansion.failure.path ?? matchPath, item);
        }
        const matches = expansion.matches;
        if (matches.length === 0) {
            return failure('no-match', `no file matches "${matchPath}"`, matchPath, item);
        }
        let total = 0;
        for (const match of matches) {
            const target = join(root, match);
            if (!(await canonicalContained(root, target))) {
                return failure('path-escape', `"${match}" resolves outside the workspace`, match, item);
            }
            const info = await stat(target).catch(() => undefined);
            if (info === undefined || !info.isFile()) {
                return failure('missing-file', `"${match}" is not a readable file`, match, item);
            }
            if (info.size === 0)
                return failure('empty-file', `"${match}" is empty`, match, item);
            if (evidence.minBytes !== undefined && info.size < evidence.minBytes) {
                return failure('too-small', `"${match}" is ${String(info.size)} bytes; at least ${String(evidence.minBytes)} are required`, match, item);
            }
            total += info.size;
        }
        return {
            ok: true,
            evidence: {
                kind: 'file',
                path: matchPath,
                bytes: total,
                detail: `${String(matches.length)} file(s)`,
            },
        };
    }
    const target = join(root, path);
    if (!(await canonicalContained(root, target))) {
        return failure('path-escape', `"${path}" resolves outside the workspace`, path, item);
    }
    const info = await stat(target).catch(() => undefined);
    if (info === undefined)
        return failure('missing-file', `"${path}" does not exist`, path, item);
    if (!info.isFile())
        return failure('missing-file', `"${path}" is not a file`, path, item);
    if (info.size === 0)
        return failure('empty-file', `"${path}" is empty`, path, item);
    if (evidence.minBytes !== undefined && info.size < evidence.minBytes) {
        return failure('too-small', `"${path}" is ${String(info.size)} bytes; at least ${String(evidence.minBytes)} are required`, path, item);
    }
    return { ok: true, evidence: { kind: 'file', path, bytes: info.size } };
}
const SPEC_DELTA = 'openspec/changes/{name}/specs/**/spec.md';
const SPEC_MARKER = 'openspec/changes/{name}/.openspec.yaml';
/**
 * A change is eligible when it ships a delta spec or declares `skip_specs: true`;
 * a refusal names both, so a spec-less change without the marker is actionable.
 */
async function specCheck(_evidence, context, item) {
    const delta = await fileCheck({ kind: 'file', path: SPEC_DELTA, glob: true }, context, item);
    if (delta.ok)
        return delta;
    // Only a missing delta falls through to the marker; an unsafe or unreadable
    // glob stays the failure instead of being masked as a spec-less change.
    if (delta.failure.reason !== 'no-match')
        return delta;
    const markerPath = await resolveEvidenceText(SPEC_MARKER, context, item);
    if (!markerPath.ok)
        return markerPath;
    const root = await realpath(context.workspace).catch(() => undefined);
    if (root === undefined) {
        return failure('path-escape', 'the workspace is not readable', markerPath.text, item);
    }
    const text = await readFile(join(root, markerPath.text), 'utf8').catch(() => undefined);
    if (text !== undefined && SKIP_SPECS.test(text)) {
        return {
            ok: true,
            evidence: {
                kind: 'file',
                path: markerPath.text,
                bytes: text.length,
                detail: 'skip_specs: true',
            },
        };
    }
    return failure('no-match', 'the change has neither a specs/**/spec.md file nor a top-level skip_specs: true in .openspec.yaml', markerPath.text, item);
}
/**
 * Expand a segment glob under the workspace. A traversal that hits the depth or
 * entry limit, or meets an escaping symlink, fails instead of approving the
 * partial result it happened to see.
 */
export async function expandGlob(root, pattern) {
    const segments = pattern.replaceAll('\\', '/').split('/');
    const found = [];
    let failure;
    let limitHit = false;
    const fail = (reason, detail, path) => {
        if (failure === undefined)
            failure = { reason, detail, ...(path === undefined ? {} : { path }) };
    };
    const checkLink = async (candidate) => {
        const target = join(root, candidate);
        if (!(await canonicalContained(root, target))) {
            fail('path-escape', `"${candidate}" resolves outside the workspace`, candidate);
            return 'none';
        }
        const info = await stat(target).catch(() => undefined);
        if (info?.isFile() === true)
            return 'file';
        if (info?.isDirectory() === true)
            return 'dir';
        return 'none';
    };
    const collectAll = async (directory, depth) => {
        if (failure !== undefined)
            return;
        if (found.length >= 200 || depth > 12) {
            limitHit = true;
            return;
        }
        const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => undefined);
        if (entries === undefined) {
            fail('unreadable', `the glob could not read "${directory === '' ? '.' : directory}"`);
            return;
        }
        for (const entry of entries) {
            const candidate = directory === '' ? entry.name : `${directory}/${entry.name}`;
            if (entry.isFile()) {
                found.push(candidate);
                if (found.length >= 200)
                    limitHit = true;
            }
            else if (entry.isDirectory()) {
                await collectAll(candidate, depth + 1);
            }
            else if (entry.isSymbolicLink()) {
                const kind = await checkLink(candidate);
                if (kind === 'file')
                    found.push(candidate);
                else if (kind === 'dir')
                    await collectAll(candidate, depth + 1);
            }
            if (failure !== undefined || limitHit)
                return;
        }
    };
    const walk = async (directory, index, depth) => {
        if (failure !== undefined)
            return;
        if (found.length >= 200 || depth > 12) {
            limitHit = true;
            return;
        }
        const segment = segments[index];
        if (segment === undefined)
            return;
        if (segment === '**') {
            if (index === segments.length - 1) {
                await collectAll(directory, depth);
                return;
            }
            // `**` matches zero or more segments; try each deeper directory and the tail.
            await walk(directory, index + 1, depth + 1);
            const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => undefined);
            if (entries === undefined) {
                fail('unreadable', `the glob could not read "${directory === '' ? '.' : directory}"`);
                return;
            }
            for (const entry of entries) {
                const candidate = directory === '' ? entry.name : `${directory}/${entry.name}`;
                if (entry.isDirectory()) {
                    await walk(candidate, index, depth + 1);
                }
                else if (entry.isSymbolicLink() && (await checkLink(candidate)) === 'dir') {
                    await walk(candidate, index, depth + 1);
                }
                if (failure !== undefined)
                    return;
            }
            return;
        }
        const last = index === segments.length - 1;
        const entries = await readdir(join(root, directory), { withFileTypes: true }).catch(() => undefined);
        if (entries === undefined) {
            fail('unreadable', `the glob could not read "${directory === '' ? '.' : directory}"`);
            return;
        }
        for (const entry of entries) {
            if (!globMatches(segment, entry.name))
                continue;
            const candidate = directory === '' ? entry.name : `${directory}/${entry.name}`;
            if (last) {
                if (entry.isFile()) {
                    found.push(candidate);
                }
                else if (entry.isSymbolicLink() && (await checkLink(candidate)) === 'file') {
                    found.push(candidate);
                }
            }
            else if (entry.isDirectory()) {
                await walk(candidate, index + 1, depth + 1);
            }
            else if (entry.isSymbolicLink() && (await checkLink(candidate)) === 'dir') {
                await walk(candidate, index + 1, depth + 1);
            }
            if (failure !== undefined || found.length >= 200) {
                if (found.length >= 200)
                    limitHit = true;
                return;
            }
        }
    };
    const literal = segments.every((segment) => !/[*?]/u.test(segment));
    if (literal) {
        const info = await stat(join(root, pattern)).catch(() => undefined);
        return { matches: info?.isFile() === true ? [pattern] : [] };
    }
    await walk('', 0, 0);
    if (failure !== undefined)
        return { matches: [], failure };
    if (limitHit) {
        return {
            matches: found.sort(),
            failure: {
                reason: 'limit-exceeded',
                detail: 'the glob search hit its traversal limit before it could decide',
                path: pattern,
            },
        };
    }
    return { matches: found.sort() };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hashParts(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(part);
        hash.update('\0');
    }
    return hash.digest('hex');
}
/**
 * The normalized `skip_specs: true` declaration OpenSpec honors for a change
 * without delta specs. A top-level boolean line is enough for the digest and
 * the eligibility check.
 * shortcut: line-level read, not a YAML parse; upgrade with the CLI's own reader
 * if OpenSpec starts accepting other spellings.
 */
const SKIP_SPECS = /^skip_specs[ \t]*:[ \t]*(?:true|True|TRUE)[ \t]*(?:#.*)?\r?$/mu;
/** Whether the change's `.openspec.yaml` declares `skip_specs: true`. */
export async function declaresSkipSpecs(changeDir) {
    const text = await readFile(join(changeDir, '.openspec.yaml'), 'utf8').catch(() => undefined);
    return text !== undefined && SKIP_SPECS.test(text);
}
/**
 * The change artifact digest: it hashes every file under the change directory
 * (except the portable `reviews/` directory), normalizing `tasks.md` checkbox
 * state and binding the effective `skip_specs` declaration, so adding, changing,
 * or removing the marker invalidates a review record.
 */
export async function specDigest(changeDir) {
    const files = [];
    const walk = async (directory) => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (relative(changeDir, path).split(sep).join('/') === 'reviews')
                    continue;
                await walk(path);
            }
            else if (entry.isFile()) {
                files.push(path);
            }
        }
    };
    await walk(changeDir);
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
    if (await declaresSkipSpecs(changeDir))
        parts.push('skip_specs: true');
    return hashParts(parts);
}
/** The current digest of one change, or undefined when it does not exist. */
export async function currentSpecDigest(workspace, change) {
    if (!CHANGE_NAME.test(change))
        return undefined;
    try {
        const root = await realpath(workspace);
        const changeDir = await realpath(join(root, 'openspec', 'changes', change));
        if (!isInside(root, changeDir))
            return undefined;
        return await specDigest(changeDir);
    }
    catch {
        return undefined;
    }
}
/**
 * The per-scope review digest. A task review binds the frozen snapshot; a whole
 * review binds the worktree when its evidence declares the worktree digest, so
 * a code-only edit invalidates a previous whole-worktree PASS.
 */
export function reviewDigest(input) {
    if (input.scope === 'task') {
        return hashParts([
            'task-review-snapshot-v2',
            input.tree ?? '',
            input.artifactDigest ?? input.specDigest,
        ]);
    }
    return input.tree === undefined
        ? input.specDigest
        : hashParts(['whole-review-worktree-v1', input.specDigest, input.tree]);
}
function mismatch(detail, path, item) {
    return failure('record-mismatch', detail, path, item);
}
/**
 * Resolve the record path a step reads. A record contract without an explicit
 * path derives the workflows record store. The committed approval path is
 * independent of this store and never rewritten.
 */
async function recordCheck(evidence, context, item) {
    const rule = resolveEvidenceText(evidence.rule, context, item);
    if (!rule.ok)
        return rule;
    const change = evidence.change === undefined ? undefined : resolveEvidenceText(evidence.change, context, item);
    if (change !== undefined && !change.ok)
        return change;
    const derived = change === undefined
        ? undefined
        : `.dsh/workflows/records/${rule.text}/${change.text}/${evidence.phase ?? 'spec'}.json`;
    const path = evidence.path === undefined
        ? derived === undefined
            ? undefined
            : { ok: true, text: derived }
        : resolveEvidenceText(evidence.path, context, item);
    if (path === undefined || !path.ok) {
        return failure('invalid-evidence', 'record evidence needs a path, or a rule and change', undefined, item);
    }
    const read = await readWorkspaceFile(context.workspace, path.text);
    if (read === undefined) {
        return failure('missing-file', `the record "${path.text}" is missing or escapes the workspace`, path.text, item);
    }
    let record;
    try {
        record = JSON.parse(read.text);
    }
    catch {
        return mismatch(`the record "${path.text}" is not valid JSON`, path.text, item);
    }
    if (!isRecord(record))
        return mismatch(`the record "${path.text}" is not an object`, path.text, item);
    if (evidence.source === 'checkpoint') {
        const invalid = checkpointRecordError(record);
        if (invalid !== undefined) {
            return mismatch(`the record "${path.text}" is invalid: ${invalid}`, path.text, item);
        }
        if (evidence.verdict !== 'recorded' && record.outcome !== evidence.verdict) {
            return mismatch(`the checkpoint outcome "${String(record.outcome)}" is not "${evidence.verdict}"`, path.text, item);
        }
        return {
            ok: true,
            evidence: {
                kind: 'record',
                path: path.text,
                detail: `checkpoint turn ${String(record.turn)} (${String(record.outcome)})`,
            },
        };
    }
    const portable = path.text.replaceAll('\\', '/').includes('/reviews/');
    const invalidRecord = portable ? portableRecordError(record) : localRecordError(record);
    if (invalidRecord !== undefined) {
        return mismatch(`the record is invalid: ${invalidRecord}`, path.text, item);
    }
    const phase = evidence.phase === undefined ? undefined : resolveEvidenceText(evidence.phase, context, item);
    if (phase !== undefined && !phase.ok)
        return phase;
    const scope = evidence.scope === undefined ? undefined : resolveEvidenceText(evidence.scope, context, item);
    if (scope !== undefined && !scope.ok)
        return scope;
    const task = evidence.task === undefined ? undefined : resolveEvidenceText(evidence.task, context, item);
    if (task !== undefined && !task.ok)
        return task;
    if (record.rule !== evidence.rule) {
        return mismatch(`the record rule is not "${evidence.rule}"`, path.text, item);
    }
    if (change !== undefined && record.change !== change.text) {
        return mismatch(`the record change is not "${change.text}"`, path.text, item);
    }
    if (phase !== undefined && record.phase !== phase.text) {
        return mismatch(`the record phase is not "${phase.text}"`, path.text, item);
    }
    if (scope !== undefined) {
        if (scope.text === 'whole' && record.scope === 'task') {
            return mismatch('a task-scoped record is not whole-spec evidence', path.text, item);
        }
        if (record.scope !== scope.text) {
            return mismatch(`the record scope is not "${scope.text}"`, path.text, item);
        }
    }
    if (task !== undefined && record.taskId !== task.text) {
        return mismatch(`the record task is not "${task.text}"`, path.text, item);
    }
    // A section record binds the submitted checked-task set: the section key
    // keeps the path stable, so a changed coverage must not reuse the old verdict.
    if (record.section !== undefined && Array.isArray(record.taskIds)) {
        const submitted = Array.isArray(context.values.taskIds)
            ? context.values.taskIds.filter((entry) => typeof entry === 'string')
            : undefined;
        const covered = record.taskIds.filter((entry) => typeof entry === 'string');
        if (submitted === undefined || submitted.join('\u0000') !== covered.join('\u0000')) {
            return mismatch('the section record covers a different checked task set', path.text, item);
        }
    }
    const accepted = evidence.verdicts !== undefined
        ? evidence.verdicts
        : evidence.verdict === undefined
            ? []
            : [evidence.verdict];
    if (accepted.length === 0 || !accepted.includes(String(record.verdict))) {
        return mismatch(`the record verdict "${String(record.verdict)}" is not one of: ${accepted.join(', ')}`, path.text, item);
    }
    // The marker's reviewer binding applies to intermediate PASS and ERROR
    // records too, for the marker-selected task rule as well as the default.
    const binding = reviewerBinding(context.workspace);
    const taskRule = binding?.taskRule ?? 'task-review';
    if (record.rule === taskRule) {
        if (binding?.invalid !== undefined) {
            return mismatch(`${binding.invalid}; fix openspec/review-approval.json`, path.text, item);
        }
        const target = (record.target ?? {});
        if (binding?.provider !== undefined && target.provider !== binding.provider) {
            return mismatch(`the record target provider "${String(target.provider)}" is not the bound "${binding.provider}"`, path.text, item);
        }
        if (binding?.model !== undefined && target.model !== binding.model) {
            return mismatch(`the record target model "${String(target.model)}" is not the bound "${binding.model}"`, path.text, item);
        }
    }
    // An explicit task start also refuses to reuse a local PASS whose portable
    // approval is missing or rejected; the executor must re-review it.
    if (context.values.explicitReview === true &&
        record.verdict === 'PASS' &&
        record.scope === 'task' &&
        typeof record.taskId === 'string') {
        const approvalChange = change?.text ?? (typeof record.change === 'string' ? record.change : undefined);
        const approval = approvalChange === undefined
            ? undefined
            : readPortableApproval(context.workspace, approvalChange, record.taskId);
        const approvalTarget = (approval?.target ?? {});
        const recordTarget = (record.target ?? {});
        const matching = approval !== undefined &&
            approval.rule === record.rule &&
            approval.change === approvalChange &&
            approval.taskId === record.taskId &&
            approval.verdict === 'PASS' &&
            (binding?.provider === undefined || approvalTarget.provider === binding.provider) &&
            (binding?.model === undefined || approvalTarget.model === binding.model) &&
            (binding?.provider === undefined || recordTarget.provider === binding.provider) &&
            (binding?.model === undefined || recordTarget.model === binding.model);
        if (!matching) {
            return mismatch('an explicit task review start needs the matching portable approval; dispatch a new review', path.text, item);
        }
    }
    // An explicit review start reopens an earlier ERROR so a retry can dispatch a
    // new reviewer; an automatic close may still reuse the ERROR as evidence.
    if (record.verdict === 'ERROR' &&
        context.values.explicitReview === true &&
        record.runId !== context.runId) {
        return mismatch('an explicit review start reopens this ERROR; dispatch a new review instead of reusing the record', path.text, item);
    }
    // Legacy ERROR exclusions: a queue fault or a discarded-input verdict is not
    // a usable review; finish the writes and re-run.
    if (evidence.rule === 'task-review' && record.verdict === 'ERROR') {
        const failureClass = record.failureClass;
        const error = record.error;
        const discarded = failureClass === 'reviewed-inputs-changed' ||
            (typeof error === 'string' &&
                (error.startsWith('queue-internal-error') || error.includes('reviewed inputs changed')));
        if (discarded) {
            return mismatch('the ERROR record discarded its verdict (the reviewed inputs moved or the queue failed); finish the writes and re-run the review', path.text, item);
        }
    }
    if (evidence.digest === 'current' || evidence.digest === 'current-worktree') {
        if (change === undefined) {
            return mismatch('a current digest needs a change name', path.text, item);
        }
        const worktreeBound = evidence.digest === 'current-worktree';
        if (worktreeBound && context.runGit === undefined) {
            return mismatch('a current worktree digest needs the host git runner; the record cannot be verified here', path.text, item);
        }
        const current = await currentSpecDigest(context.workspace, change.text);
        const tree = worktreeBound && context.runGit !== undefined
            ? await reviewInputTree(context.workspace, { dir: join(context.workspace, 'openspec', 'changes', change.text) }, context.runGit, AbortSignal.timeout(60_000)).catch(() => undefined)
            : undefined;
        const currentDigest = current === undefined || (worktreeBound && tree === undefined)
            ? undefined
            : reviewDigest({
                scope: 'whole',
                specDigest: current,
                ...(tree === undefined ? {} : { tree }),
            });
        if (currentDigest === undefined || record.digest !== currentDigest) {
            return mismatch(worktreeBound
                ? 'the whole-worktree record is stale for the current worktree or change artifacts'
                : 'the whole-spec record is stale for the current change artifacts', path.text, item);
        }
    }
    else if (evidence.digest !== undefined && record.digest !== evidence.digest) {
        return mismatch(`the record digest is not "${evidence.digest}"`, path.text, item);
    }
    return {
        ok: true,
        evidence: {
            kind: 'record',
            path: path.text,
            ...(typeof record.digest === 'string' ? { digest: record.digest } : {}),
            detail: `record ${evidence.rule} ${accepted.join('|')}`,
        },
    };
}
/** The logical `shell` tool maps to the host's registered foreground shell. */
export function hostToolName(name) {
    if (name !== 'shell')
        return name;
    return process.platform === 'win32' ? 'pwsh' : 'bash';
}
/** Whether an observed tool is the declared tool; `shell` matches the host shell. */
export function toolNameMatches(declared, observed) {
    return declared === observed || (declared === 'shell' && observed === hostToolName('shell'));
}
function toolCheck(evidence, context, item) {
    let command;
    if (evidence.command !== undefined) {
        const checked = resolveEvidenceText(evidence.command, context, item);
        if (!checked.ok)
            return checked;
        command = checked.text;
    }
    let args;
    if (evidence.args !== undefined) {
        args = {};
        for (const [key, value] of Object.entries(evidence.args)) {
            if (typeof value === 'string') {
                const checked = resolveEvidenceText(value, context, item);
                if (!checked.ok)
                    return checked;
                args[key] = checked.text;
            }
            else {
                args[key] = value;
            }
        }
    }
    const call = (context.toolCalls ?? []).find((candidate) => candidate.ok &&
        toolNameMatches(evidence.name, candidate.name) &&
        (command === undefined || candidate.arguments.command === command) &&
        (args === undefined || deepSubset(args, candidate.arguments)));
    if (call === undefined) {
        return failure('no-call', `no completed "${evidence.name}" call matches the declared arguments`, undefined, item);
    }
    return { ok: true, evidence: { kind: 'tool', callId: call.callId, detail: evidence.name } };
}
/** Whether a recorded working directory names the workspace root. */
export function sameCheckDirectory(left, right) {
    const norm = (value) => value.replaceAll('\\', '/').replace(/\/+$/u, '');
    const a = norm(left);
    const b = norm(right);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
/** True when a write target is planning scratch or documentation, not code. */
export function ignoredWrite(path) {
    const normalized = path.replaceAll('\\', '/');
    if (/\.md$/iu.test(normalized))
        return true;
    return /(?:^|\/)(?:\.dsh|\.tmp|node_modules|openspec)\//iu.test(normalized);
}
/** When the turn last wrote a non-documentation file, from its tool calls. */
export function lastCodeWriteAt(calls, workspace) {
    let last;
    for (const call of calls) {
        if (!call.ok || call.at === undefined)
            continue;
        if (call.name !== 'edit' && call.name !== 'write')
            continue;
        const raw = call.arguments.file_path ?? call.arguments.path;
        if (typeof raw !== 'string' || raw.trim() === '')
            continue;
        const resolved = workspace === undefined ? raw : resolve(workspace, raw);
        if (ignoredWrite(resolved))
            continue;
        if (last === undefined || call.at > last)
            last = call.at;
    }
    return last;
}
/** The legacy command matcher: the invocation matches a configured command
 * directly, or after removing one leading rtk wrapper from the invocation. */
export function commandMatches(configured, invocation) {
    const command = invocation.trim();
    return configured === command || configured === command.replace(/^rtk\s+/u, '');
}
function shownCommands(commands) {
    const limited = commands
        .slice(0, 3)
        .map((command) => `"${command.length > 120 ? `${command.slice(0, 120)}…` : command}"`)
        .join(' or ');
    return commands.length > 3 ? `${limited} (+${String(commands.length - 3)} more)` : limited;
}
function checkFailure(detail, item) {
    return failure('check-failed', detail, undefined, item);
}
/**
 * The owned verification check: a configured command must have completed
 * successfully after the turn's last code write. No code write or no
 * configured command keeps the step inert, exactly like the legacy gate.
 */
function verifyCheck(context, item) {
    const commands = context.checkCommands ?? [];
    if (commands.length === 0) {
        return {
            ok: true,
            evidence: {
                kind: 'check',
                callId: 'no-command',
                at: 0,
                detail: 'no configured verification command; the verify definition is inert',
            },
        };
    }
    const lastWrite = context.lastWriteAt;
    if (lastWrite === undefined) {
        return {
            ok: true,
            evidence: {
                kind: 'check',
                callId: 'no-code-write',
                at: 0,
                detail: 'no code write in this turn',
            },
        };
    }
    const accepted = commands;
    const results = (context.shellResults ?? []).filter((candidate) => candidate.foreground &&
        accepted.some((configured) => commandMatches(configured, candidate.command)) &&
        (candidate.cwd === undefined || sameCheckDirectory(candidate.cwd, context.workspace)));
    // A persisted successful check survives buffer eviction; a later failed
    // attempt does not re-dirty the turn (legacy semantics).
    if (context.lastCheckAt !== undefined && context.lastCheckAt > lastWrite) {
        return {
            ok: true,
            evidence: {
                kind: 'check',
                callId: 'persisted-check',
                at: context.lastCheckAt,
                detail: 'a configured check succeeded after the last write',
            },
        };
    }
    const afterWrite = results.filter((candidate) => candidate.at > lastWrite);
    const shown = shownCommands(commands);
    const target = context.lastWritePath === undefined
        ? ''
        : ` (last write: ${context.lastWritePath.slice(0, 120)})`;
    if (afterWrite.length === 0) {
        return checkFailure(`no configured verification command completed after the last code write${target}; run ${shown}`, item);
    }
    // The legacy gate clears the obligation on a successful check, and a later
    // failed attempt does not re-dirty the turn; keep that parity.
    const successful = afterWrite
        .filter((candidate) => candidate.ok !== false &&
        candidate.exitCode === 0 &&
        candidate.timedOut !== true &&
        candidate.aborted !== true &&
        candidate.signal === undefined &&
        candidate.sandboxDenied !== true)
        .reduce((last, candidate) => (last === undefined || candidate.at >= last.at ? candidate : last), undefined);
    const latest = afterWrite.reduce((last, candidate) => candidate.at >= last.at ? candidate : last);
    if (successful === undefined) {
        if (latest.aborted === true)
            return checkFailure(`"${latest.command}" was cancelled`, item);
        if (latest.timedOut === true)
            return checkFailure(`"${latest.command}" timed out`, item);
        if (latest.signal !== undefined) {
            return checkFailure(`"${latest.command}" was stopped by ${latest.signal}`, item);
        }
        if (latest.sandboxDenied === true) {
            return checkFailure(`"${latest.command}" was refused by the sandbox`, item);
        }
        return checkFailure(latest.exitCode === 0
            ? `"${latest.command}" did not complete successfully`
            : `"${latest.command}" exited ${String(latest.exitCode)}; a zero exit is required`, item);
    }
    return {
        ok: true,
        evidence: {
            kind: 'check',
            callId: successful.callId,
            at: successful.at,
            detail: successful.command,
        },
    };
}
function checkResult(evidence, context, item) {
    if (evidence.source === 'verify-settings')
        return verifyCheck(context, item);
    if (evidence.source === 'task-review-coverage') {
        const change = context.values.name;
        if (typeof change !== 'string') {
            return checkFailure('the completion coverage check has no change name', item);
        }
        // An intermediate close (unchecked tasks remain) defers completion
        // coverage; only the final checked list needs portable approvals.
        const tasksMarkdown = (() => {
            try {
                return readFileSync(join(context.workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
            }
            catch {
                return undefined;
            }
        })();
        if (tasksMarkdown !== undefined && /^\s*-\s*\[ \]\s+\d+(?:\.\d+)*\s+\S/mu.test(tasksMarkdown)) {
            return {
                ok: true,
                evidence: {
                    kind: 'check',
                    callId: 'task-review-intermediate',
                    at: Date.now(),
                    detail: 'unchecked tasks remain; completion coverage is deferred',
                },
            };
        }
        const coverage = taskReviewCoverage(context.workspace, change);
        if (!coverage.ok)
            return checkFailure(coverage.gaps.join('; '), item);
        return {
            ok: true,
            evidence: {
                kind: 'check',
                callId: 'task-review-coverage',
                at: Date.now(),
                detail: 'every checked task has a portable task-review PASS',
            },
        };
    }
    const command = resolveEvidenceText(evidence.command ?? '', context, item);
    if (!command.ok)
        return command;
    const startedAt = context.stepStartedAt;
    if (startedAt === undefined || !Number.isFinite(startedAt)) {
        return failure('check-failed', 'the check cannot be verified without the step start time', undefined, item);
    }
    const results = (context.shellResults ?? []).filter((candidate) => candidate.foreground &&
        candidate.command === command.text &&
        // A validation run in another project never satisfies this workspace.
        (candidate.cwd === undefined || sameCheckDirectory(candidate.cwd, context.workspace)));
    const afterStart = results.filter((candidate) => candidate.at >= startedAt);
    if (afterStart.length === 0) {
        return failure('check-failed', results.length === 0
            ? `no completed foreground result for "${command.text}"`
            : `"${command.text}" has no qualifying result after the step start`, undefined, item);
    }
    // The latest attempt decides: a later failure must not be hidden by an
    // earlier success, while a retry that now succeeds still passes.
    const latest = afterStart.reduce((last, candidate) => candidate.at >= last.at ? candidate : last);
    if (latest.ok === false) {
        return failure('check-failed', `"${command.text}" did not complete successfully (aborted, sandbox-denied, or failed)`, undefined, item);
    }
    if (latest.timedOut === true) {
        return failure('check-failed', `"${command.text}" timed out`, undefined, item);
    }
    if (latest.signal !== undefined) {
        return failure('check-failed', `"${command.text}" was stopped by ${latest.signal}`, undefined, item);
    }
    if (latest.sandboxDenied === true) {
        return failure('check-failed', `"${command.text}" was refused by the sandbox`, undefined, item);
    }
    if (latest.exitCode !== 0) {
        return failure('check-failed', `"${command.text}" exited ${String(latest.exitCode)}; a zero exit is required`, undefined, item);
    }
    return {
        ok: true,
        evidence: {
            kind: 'check',
            callId: latest.callId,
            at: latest.at,
            detail: command.text,
        },
    };
}
function humanResult(evidence, context, item) {
    const accepted = (Array.isArray(evidence.answer) ? evidence.answer : [evidence.answer]).map((answer) => answer.trim().toLowerCase());
    const answers = context.answers ?? [];
    if (answers.length === 0) {
        return failure('no-answer', 'no user answer was recorded for this step', undefined, item);
    }
    const matched = answers.find((entry) => accepted.includes(entry.answer.trim().toLowerCase()));
    if (matched === undefined) {
        const last = answers.at(-1)?.answer ?? '';
        return failure('rejected-answer', `the recorded answer "${last}" is not one of: ${accepted.join(', ')}`, undefined, item);
    }
    return {
        ok: true,
        evidence: {
            kind: 'human',
            answer: matched.answer,
            ...(matched.at === undefined ? {} : { at: matched.at }),
        },
    };
}
/** Resolve every workspace-relative path an evidence contract will check. */
export function collectEvidencePaths(value, context, item) {
    switch (value.kind) {
        case 'file': {
            const resolved = interpolate(value.path, context, item);
            return resolved.ok ? [resolved.evidence.path ?? value.path] : [value.path];
        }
        case 'spec': {
            const paths = [];
            for (const pattern of [SPEC_DELTA, SPEC_MARKER]) {
                const resolved = interpolate(pattern, context, item);
                paths.push(resolved.ok ? (resolved.evidence.path ?? pattern) : pattern);
            }
            return paths;
        }
        case 'all':
            return value.items.flatMap((child, index) => collectEvidencePaths(child, context, item === undefined ? `items[${String(index)}]` : `${item}.items[${String(index)}]`));
        case 'record': {
            if (value.path !== undefined) {
                const resolved = interpolate(value.path, context, item);
                return [resolved.ok ? (resolved.evidence.path ?? value.path) : value.path];
            }
            const rule = resolveEvidenceText(value.rule, context, item);
            if (!rule.ok)
                return [];
            const change = value.change === undefined ? undefined : resolveEvidenceText(value.change, context, item);
            if (change !== undefined && !change.ok)
                return [];
            return change === undefined
                ? []
                : [`.dsh/workflows/records/${rule.text}/${change.text}/${value.phase ?? 'spec'}.json`];
        }
        default:
            return [];
    }
}
/** A bounded one-line description of an evidence contract for the steer. */
function describeArgs(args, context) {
    const resolved = {};
    for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
            const checked = resolveEvidenceText(value, context, undefined);
            resolved[key] = checked.ok ? checked.text : value;
        }
        else {
            resolved[key] = value;
        }
    }
    return resolved;
}
export function describeEvidence(value, context) {
    switch (value.kind) {
        case 'file': {
            const [path] = collectEvidencePaths(value, context);
            const suffix = [
                value.minBytes === undefined ? '' : `min ${String(value.minBytes)} bytes`,
                value.glob === true ? 'glob' : '',
            ]
                .filter((entry) => entry !== '')
                .join(', ');
            return `file ${path ?? value.path}${suffix === '' ? '' : ` (${suffix})`}`;
        }
        case 'spec': {
            const [delta, marker] = collectEvidencePaths(value, context);
            return `a specs/**/spec.md delta at ${delta ?? 'openspec/changes/{name}/specs/**/spec.md'} or skip_specs: true in ${marker ?? 'openspec/changes/{name}/.openspec.yaml'}`;
        }
        case 'all':
            return `all of: ${value.items.map((item) => describeEvidence(item, context)).join('; ')}`;
        case 'record': {
            const [path] = collectEvidencePaths(value, context);
            const show = (text) => {
                if (text === undefined)
                    return undefined;
                const resolved = resolveEvidenceText(text, context, undefined);
                return resolved.ok ? resolved.text : text;
            };
            const constraints = [
                `rule=${show(value.rule) ?? value.rule}`,
                `verdict=${value.verdict ?? (value.verdicts ?? []).join('|')}`,
                show(value.change) === undefined ? '' : `change=${String(show(value.change))}`,
                show(value.phase) === undefined ? '' : `phase=${String(show(value.phase))}`,
                show(value.scope) === undefined ? '' : `scope=${String(show(value.scope))}`,
                show(value.task) === undefined ? '' : `task=${String(show(value.task))}`,
                value.digest === undefined ? '' : `digest=${value.digest}`,
            ].filter((entry) => entry !== '');
            return `record ${constraints.join(' ')}${path === undefined ? '' : ` at ${path}`}`;
        }
        case 'tool': {
            const command = value.command === undefined
                ? undefined
                : resolveEvidenceText(value.command, context, undefined);
            const args = value.args === undefined ? '' : ` args ${JSON.stringify(describeArgs(value.args, context))}`;
            return `completed tool call ${value.name}${command === undefined ? '' : ` "${command.ok ? command.text : value.command}"`}${args}`;
        }
        case 'check': {
            if (value.source === 'verify-settings') {
                return `a configured verify command (${shownCommands(context.checkCommands ?? []) || 'inert'}) exits 0 after the last code write${context.lastWritePath === undefined ? '' : ` (last write: ${context.lastWritePath.slice(0, 120)})`}`;
            }
            const command = resolveEvidenceText(value.command ?? '', context, undefined);
            return `foreground command "${command.ok ? command.text : value.command}" exits 0`;
        }
        case 'human':
            return `user answer ${Array.isArray(value.answer) ? value.answer.join(' or ') : value.answer}`;
        case 'declaration':
            return 'self-declared completion (non-critical only)';
    }
}
/** Verify one evidence contract; an `all` returns the first failing item. */
export async function verifyEvidence(value, context, item) {
    switch (value.kind) {
        case 'file':
            return fileCheck(value, context, item);
        case 'spec':
            return specCheck(value, context, item);
        case 'record':
            return recordCheck(value, context, item);
        case 'tool':
            return toolCheck(value, context, item);
        case 'check':
            return checkResult(value, context, item);
        case 'human':
            return humanResult(value, context, item);
        case 'declaration':
            if (context.nonCriticalStep !== true) {
                return failure('invalid-evidence', 'a declaration never satisfies a critical step', undefined, item);
            }
            return { ok: true, evidence: { kind: 'declaration', detail: 'self-declared' } };
        case 'all': {
            const items = value.items;
            if (items.length === 0) {
                return failure('invalid-evidence', 'an all contract needs at least one item', undefined, item);
            }
            for (const [index, child] of items.entries()) {
                const childItem = item === undefined ? `items[${String(index)}]` : `${item}.items[${String(index)}]`;
                const checked = await verifyEvidence(child, context, childItem);
                if (!checked.ok)
                    return checked;
            }
            return {
                ok: true,
                evidence: { kind: 'all', detail: `${String(items.length)} item(s) verified` },
            };
        }
        default: {
            const unknown = value;
            return failure('unsupported', `evidence kind "${String(unknown.kind)}" is not verified`, undefined, item);
        }
    }
}
/** Read a file only when it stays inside the workspace; undefined otherwise. */
export async function readWorkspaceFile(workspace, path) {
    const structural = safeRelativePath(path, undefined);
    if (structural !== undefined)
        return undefined;
    try {
        const root = await realpath(workspace);
        const target = await realpath(join(root, path));
        if (!isInside(root, target))
            return undefined;
        const info = await stat(target);
        if (!info.isFile() || info.size > 256 * 1024)
            return undefined;
        const text = await readFile(target, 'utf8');
        return { text, bytes: info.size };
    }
    catch {
        return undefined;
    }
}
/** The workspace-relative display path; never an absolute machine path. */
export function workspaceRelative(workspace, path) {
    return relative(workspace, path).replaceAll('\\', '/');
}
