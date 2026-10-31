import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-goal-continuity';
/** Services the supervisor and the checkpoint tool need. */
export const inject = ['agents', 'goals', 'tools'];
/** Id of the setup-declared reviewer preset; the composition fragment repeats it. */
const REVIEWER_PRESET_ID = 'goal-reviewer';
/** Documented block-review defaults; the composition fragment repeats them. */
export const DEFAULT_BLOCK_REVIEW_CONFIG = Object.freeze({
    enabled: true,
    reviewQuestions: true,
    provider: 'spawn',
    model: 'deepseek-flash',
    reasoningEffort: 'max',
    reviewerPreset: REVIEWER_PRESET_ID,
    blockedAfterConsecutiveRounds: 3,
    timeoutMs: 300_000,
    maxReviewsPerGoal: 3,
    onReviewError: 'deny',
    onUnavailable: 'allow',
    onExhausted: 'deny',
});
/** Documented work-checkpoint defaults; the composition fragment repeats them. */
export const DEFAULT_CHECKPOINT_CONFIG = Object.freeze({
    enabled: true,
    minToolCalls: 4,
    requireWrite: true,
    maxBlocks: 3,
    enforceParallel: true,
    maxMessageChars: 1200,
    stepInterval: 40,
});
/** Documented defaults; the composition fragment repeats them for the generated patch. */
export const DEFAULT_CONFIG = Object.freeze({
    enabled: true,
    resumeAfterRestart: false,
    resumeAfterUserStop: 'non-goal',
    maxSessionResumes: 20,
    roundExtension: 1000,
    maxRoundExtensions: 2,
    hardMaxGoalRounds: 5000,
    blockReview: DEFAULT_BLOCK_REVIEW_CONFIG,
    checkpoint: DEFAULT_CHECKPOINT_CONFIG,
});
/** Bound for one notice summary, matching the harness context-summary bound. */
const CONTEXT_SUMMARY_MAX_CHARS = 120;
/** Bound for the model-facing notice text. */
const NOTICE_TEXT_MAX_CHARS = 600;
/** Bound for one durable block reason. */
const BLOCK_MESSAGE_MAX_CHARS = 400;
/** Integer fields and their accepted inclusive range. */
const INTEGER_RANGES = {
    maxSessionResumes: [0, 1000],
    roundExtension: [1, 1_000_000],
    maxRoundExtensions: [0, 100],
    hardMaxGoalRounds: [1, 1_000_000],
};
/** Render one field diagnostic that names the field and its accepted range. */
function fieldError(field, requirement) {
    return new Error(`goal-continuity: \`${field}\` ${requirement}`);
}
/** Integer block-review fields and their accepted inclusive range. */
const BLOCK_REVIEW_INTEGER_RANGES = {
    blockedAfterConsecutiveRounds: [1, 1000],
    timeoutMs: [50, 3_600_000],
    maxReviewsPerGoal: [0, 100],
};
/** Validate one nested block-review policy and apply the documented defaults. */
function resolveBlockReview(raw) {
    const input = raw === undefined ? {} : raw;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw fieldError('blockReview', 'must be an object');
    }
    const record = input;
    for (const key of Object.keys(record)) {
        if (!Object.hasOwn(DEFAULT_BLOCK_REVIEW_CONFIG, key)) {
            throw new Error(`goal-continuity: unknown config field "blockReview.${key}"`);
        }
    }
    const boolean = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_BLOCK_REVIEW_CONFIG[field];
        if (typeof value !== 'boolean')
            throw fieldError(`blockReview.${field}`, 'must be a boolean');
        return value;
    };
    const text = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_BLOCK_REVIEW_CONFIG[field];
        if (typeof value !== 'string' || value.trim() === '') {
            throw fieldError(`blockReview.${field}`, 'must be a non-empty string');
        }
        return value;
    };
    const integer = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_BLOCK_REVIEW_CONFIG[field];
        const [min, max] = BLOCK_REVIEW_INTEGER_RANGES[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
            throw fieldError(`blockReview.${field}`, `must be an integer between ${min} and ${max}`);
        }
        return value;
    };
    const policy = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_BLOCK_REVIEW_CONFIG[field];
        if (value !== 'deny' && value !== 'allow') {
            throw fieldError(`blockReview.${field}`, 'must be "deny" or "allow"');
        }
        return value;
    };
    return Object.freeze({
        enabled: boolean('enabled'),
        reviewQuestions: boolean('reviewQuestions'),
        provider: text('provider'),
        model: text('model'),
        reasoningEffort: text('reasoningEffort'),
        reviewerPreset: text('reviewerPreset'),
        blockedAfterConsecutiveRounds: integer('blockedAfterConsecutiveRounds'),
        timeoutMs: integer('timeoutMs'),
        maxReviewsPerGoal: integer('maxReviewsPerGoal'),
        onReviewError: policy('onReviewError'),
        onUnavailable: policy('onUnavailable'),
        onExhausted: policy('onExhausted'),
    });
}
/** Integer work-checkpoint fields and their accepted inclusive range. */
const CHECKPOINT_INTEGER_RANGES = {
    minToolCalls: [1, 1000],
    maxBlocks: [0, 100],
    maxMessageChars: [200, 20_000],
    stepInterval: [1, 1000],
};
/** Warn once when a profile still carries the removed speed-review section. */
let legacySpeedReviewWarned = false;
function warnLegacySpeedReview() {
    if (legacySpeedReviewWarned)
        return;
    legacySpeedReviewWarned = true;
    console.warn('goal-continuity: `speedReview` is deprecated and ignored; the speed review no longer runs. Remove the section.');
}
/** Validate one nested work-checkpoint policy and apply the documented defaults. */
function resolveCheckpoint(raw) {
    const input = raw === undefined ? {} : raw;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw fieldError('checkpoint', 'must be an object');
    }
    const record = input;
    for (const key of Object.keys(record)) {
        if (!Object.hasOwn(DEFAULT_CHECKPOINT_CONFIG, key)) {
            throw new Error(`goal-continuity: unknown config field "checkpoint.${key}"`);
        }
    }
    const boolean = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CHECKPOINT_CONFIG[field];
        if (typeof value !== 'boolean')
            throw fieldError(`checkpoint.${field}`, 'must be a boolean');
        return value;
    };
    const integer = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CHECKPOINT_CONFIG[field];
        const [min, max] = CHECKPOINT_INTEGER_RANGES[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
            throw fieldError(`checkpoint.${field}`, `must be an integer between ${min} and ${max}`);
        }
        return value;
    };
    return Object.freeze({
        enabled: boolean('enabled'),
        minToolCalls: integer('minToolCalls'),
        requireWrite: boolean('requireWrite'),
        maxBlocks: integer('maxBlocks'),
        enforceParallel: boolean('enforceParallel'),
        maxMessageChars: integer('maxMessageChars'),
        stepInterval: integer('stepInterval'),
    });
}
/**
 * Validate the row configuration fail-loud and apply the documented defaults.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its allowed range.
 */
export function resolveConfig(raw) {
    const input = raw === undefined ? {} : raw;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error('goal-continuity: config must be an object');
    }
    const record = input;
    for (const key of Object.keys(record)) {
        if (key === 'speedReview')
            continue;
        if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
            throw new Error(`goal-continuity: unknown config field "${key}"`);
        }
    }
    if (record.speedReview !== undefined) {
        if (!isRecord(record.speedReview)) {
            throw fieldError('speedReview', 'must be an object (deprecated; remove the section)');
        }
        warnLegacySpeedReview();
    }
    const boolean = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CONFIG[field];
        if (typeof value !== 'boolean')
            throw fieldError(field, 'must be a boolean');
        return value;
    };
    const integer = (field) => {
        const value = record[field];
        if (value === undefined)
            return DEFAULT_CONFIG[field];
        const [min, max] = INTEGER_RANGES[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
            throw fieldError(field, `must be an integer between ${min} and ${max}`);
        }
        return value;
    };
    const rawResumeAfterUserStop = record.resumeAfterUserStop;
    const resumeAfterUserStop = rawResumeAfterUserStop === undefined
        ? DEFAULT_CONFIG.resumeAfterUserStop
        : rawResumeAfterUserStop;
    if (resumeAfterUserStop !== 'non-goal' && resumeAfterUserStop !== 'never') {
        throw fieldError('resumeAfterUserStop', 'must be "non-goal" or "never"');
    }
    return Object.freeze({
        enabled: boolean('enabled'),
        resumeAfterRestart: boolean('resumeAfterRestart'),
        resumeAfterUserStop,
        maxSessionResumes: integer('maxSessionResumes'),
        roundExtension: integer('roundExtension'),
        maxRoundExtensions: integer('maxRoundExtensions'),
        hardMaxGoalRounds: integer('hardMaxGoalRounds'),
        blockReview: resolveBlockReview(record.blockReview),
        checkpoint: resolveCheckpoint(record.checkpoint),
    });
}
/** Shell outcomes kept per session; older entries are dropped. */
const MAX_SHELL_OUTCOMES = 32;
/** Start the step counter of a turn; in-memory state resets on a new turn. */
function beginStepTurn(state, turn) {
    if (state.stepTurn === turn)
        return;
    state.stepTurn = turn;
    state.steps = 0;
    state.checkpointStep = undefined;
    state.steerStep = 0;
}
/** Only a root session is supervised; forks and subagents are left untouched. */
function isRootAgent(agent) {
    const header = agent.session.header;
    return (header.origin !== 'subagent' &&
        (header.delegationDepth ?? 0) === 0 &&
        header.parentSession === undefined);
}
/** Classify one hook cancellation by its machine-readable reason prefix. */
function hookCause(reason) {
    if (reason.kind !== 'aborted' || reason.reason.kind !== 'hook')
        return undefined;
    if (reason.reason.reason.startsWith('loop-guard:reset:'))
        return 'reset';
    if (reason.reason.reason.startsWith('loop-guard:final:'))
        return 'final';
    return 'unknown';
}
/** Whether a cause is a specific signal that outranks a generic disarm. */
function isSpecificCause(cause) {
    return cause !== 'in-process-disarm' && cause !== 'restart';
}
/** Human-readable cause used by notices and block reasons. */
function causeLabel(cause) {
    switch (cause) {
        case 'reset':
            return 'a recoverable loop-guard reset';
        case 'non-goal-stop':
            return 'your Stop on a turn that was not a goal round';
        case 'restart':
            return 'a session restart';
        case 'in-process-disarm':
            return 'an in-process disarm';
        case 'goal-round-stop':
            return 'your Stop during a goal round';
        case 'user-stop-never':
            return 'your Stop on a turn that was not a goal round';
        case 'user-pause':
            return 'your pause';
        case 'user-clear':
            return 'your clear';
        case 'user-complete':
            return 'completion';
        case 'model-reported':
            return 'a model-reported blocker';
        case 'final-hook':
            return 'the loop-guard final stop';
        case 'unknown-hook':
            return 'an unrecognized hook cancellation';
        case 'max-tokens':
            return 'the token limit';
        case 'agent-error':
            return 'an agent error';
        case 'parent-stop':
            return 'a parent cancellation';
        case 'round-limit':
            return 'the round limit';
    }
}
/** Bound one string without splitting a multi-byte code point. */
function bound(text, max) {
    if (text.length <= max)
        return text;
    return `${text.slice(0, Math.max(0, max - 1))}…`;
}
/** Exact current ref for one goal view. */
function goalRef(goal) {
    return { id: goal.id, revision: goal.revision };
}
/** Whether a rejected mutation is a compare-and-set stale reference. */
function isStale(error) {
    return (typeof error === 'object' &&
        error !== null &&
        error.code === 'GOAL_STALE_REVISION');
}
/** Build one frozen, bounded, non-waking notice. */
function createNotice(text, summary, max = NOTICE_TEXT_MAX_CHARS) {
    return Object.freeze({
        id: randomUUID(),
        role: 'user',
        content: Object.freeze([{ type: 'text', text: bound(text, max) }]),
        source: Object.freeze({
            kind: 'goal-continuity',
            form: 'notice',
            summary: bound(summary, CONTEXT_SUMMARY_MAX_CHARS),
        }),
    });
}
/** Deliver one non-waking notice; a disposed agent fails open. */
function deliverNotice(agent, text, summary, max) {
    try {
        agent.inject(createNotice(text, summary, max));
    }
    catch {
        // A disposed agent simply receives no notice.
    }
}
/**
 * Independent block review: one of two bounded model calls in this plugin. It
 * reviews one proposed `blocked` update and returns a tool-call decision; it
 * never starts, continues, or cancels a turn and never mutates the goal.
 */
/** Read-only tools the reviewer preset mounts and the child-scope allowlist admits. */
const REVIEWER_TOOLS = Object.freeze(['read', 'grep', 'glob']);
/** Local workspace state: goal-scoped review records and the grant ledger. */
const BLOCK_REVIEW_DIR = join('.dsh', 'goal-continuity', 'block-review');
const GRANTS_PATH = join('.dsh', 'goal-continuity', 'grants.json');
/** Bounds for the evidence bundle and the model-facing strings. */
const MAX_TOOL_ARGUMENT_CHARS = 400;
const MAX_TOOL_RESULT_CHARS = 500;
const MAX_TOOL_CALLS_PER_ROUND = 8;
const EVIDENCE_ROUNDS = 3;
const MAX_EVIDENCE_USER_MESSAGES = 5;
const MAX_USER_MESSAGE_CHARS = 800;
const MAX_RUNTIME_POLICY_CHARS = 600;
const MAX_INSTRUCTIONS_CHARS = 6000;
const MAX_GRANTS_CHARS = 4000;
const MAX_REVIEW_PROMPT_CHARS = 24_000;
const MAX_VERDICT_EVIDENCE = 5;
const MAX_VERDICT_EVIDENCE_CHARS = 300;
const MAX_REVIEW_ACTION_CHARS = 400;
const MAX_DENY_REASON_CHARS = 1200;
const MAX_SUBJECT_CHARS = 2000;
/** Visible error codes: a denial names its cause and the record. */
const REJECTED_CODE = 'GOAL_BLOCK_REVIEW_REJECTED';
const QUESTION_REJECTED_CODE = 'GOAL_QUESTION_REVIEW_REJECTED';
const UNAVAILABLE_CODE = 'GOAL_BLOCK_REVIEW_UNAVAILABLE';
const REVIEW_ERROR_CODE = 'GOAL_BLOCK_REVIEW_ERROR';
const EXHAUSTED_CODE = 'GOAL_BLOCK_REVIEW_EXHAUSTED';
/** The reviewer's read-only preset id, selected only by this gate. */
const REVIEW_LABEL = 'goal-block-review';
/** Scope-restriction failures are configuration problems, not review errors. */
const SCOPE_FAILURE_PREFIX = 'goal-continuity: reviewer scope restriction failed';
/** Bundled reviewer instructions; resolved beside `lib/index.js`, read lazily. */
const assetsDirectory = fileURLToPath(new URL('../assets', import.meta.url));
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** One line of failure detail, bounded for a record or a notice. */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Read one optional service without failing the host when it is not mounted. */
function optionalService(ctx, name) {
    try {
        return ctx.get(name);
    }
    catch {
        return undefined;
    }
}
/** Read the current goal without letting a goal-domain failure reach the gate. */
function readCurrentGoal(ctx, agent) {
    try {
        return ctx.goals.get(agent);
    }
    catch {
        return undefined;
    }
}
/** Text of one model-facing message. */
function messageText(message) {
    return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}
/** The session's committed events, or an empty list when the log is unavailable. */
function sessionEvents(agent) {
    try {
        return agent.session.snapshotEvents();
    }
    catch {
        return [];
    }
}
/** The current workspace directory, with the session header as the fallback. */
function workspaceFor(ctx, agent) {
    const service = optionalService(ctx, 'workingDirectory');
    if (service !== undefined) {
        try {
            return service.get(agent.session);
        }
        catch {
            // Fall through to the durable header.
        }
    }
    return agent.session.header.cwd ?? process.cwd();
}
/** True when a quoted value looks like an absolute machine path. */
function quotedPathShape(body) {
    const unescaped = body.replaceAll('\\\\', '\\');
    const slashUnc = body.startsWith('//') && body.split('/').filter((part) => part !== '').length >= 2;
    const backslashUnc = /^\\\\[^\\]+\\.+/u.test(body) || /^\\\\[^\\]+\\.+/u.test(unescaped);
    return (slashUnc ||
        backslashUnc ||
        body.startsWith('/') ||
        /^[A-Za-z]:[\\/]/u.test(body) ||
        /^[A-Za-z]:[\\/]/u.test(unescaped));
}
/** Replace machine paths and obvious credentials before any evidence leaves the workspace. */
function redact(text, workspace) {
    let output = text;
    for (const candidate of [workspace, workspace.replaceAll('\\', '/')]) {
        if (candidate !== '')
            output = output.split(candidate).join('[workspace]');
    }
    return (output
        // Credentials first: a path rule consumes the rest of the line and can
        // remove the closing quote a quoted credential pattern needs. A quoted
        // JSON key that names a credential is redacted whatever its prefix
        // (access_token, client_secret, X-Api-Key, ...).
        .replace(/"([^"\\]*(?:secret|token|key|password|passwd|credential)[^"\\]*)("\s*:\s*)"(?:[^"\\]|\\.)*"/giu, (_match, key, separator) => `"${key}"${separator}"[redacted]"`)
        // The same rule for a JSON block nested inside a command argument, where
        // the inner quotes arrive escaped as \" .
        .replace(/\\"([^"\\]*(?:secret|token|key|password|passwd|credential)[^"\\]*)\\"\s*:\s*\\"(?:[^"\\]|\\.)*?\\"/giu, (_match, key) => `\\"${key}\\" : \\"[redacted]\\"`)
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
        // Scheme-prefixed authorization values (Basic, Digest, Token, ...).
        .replace(/\bAuthorization\s*:\s*[A-Za-z]+\s+[^\s,;]+/giu, 'Authorization: [redacted]')
        // Credentials embedded in a URL's authority (https://user:pass@host).
        .replace(/(?<=\/\/)[^\s/"@<>]+@/gu, '[redacted]@')
        // The closing delimiter must match the opening one, so a value may contain
        // the other quote (for example a double-quoted "don't-SECRET").
        .replace(/\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|api[_-]?key|token|password|passwd|secret)\\?["']?\s*[:=]\s*)(\\?)"(?:[^"\\]|\\.)*\\?"/giu, '$1[redacted]')
        .replace(/\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|api[_-]?key|token|password|passwd|secret)\\?["']?\s*[:=]\s*)(\\?)'(?:[^'\\]|\\.)*\\?'/giu, '$1[redacted]')
        .replace(/\b((?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|api[_-]?key|token|password|passwd|secret))\b\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
        // A credential flag followed by a space-separated value, quoted or not
        // (--token VALUE, --api-key "VALUE", --client-secret 'VALUE').
        .replace(/(\s--?[A-Za-z0-9_-]*(?:token|secret|password|passwd|key)[A-Za-z0-9_-]*\s+)(\\?"(?:[^"\\]|\\.)*\\?"|'[^']*'|\S+)/giu, '$1[redacted]')
        .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu, '[redacted private key]')
        // Last resort for any quoting depth: a credential-like key followed by
        // ':' or '=' redacts the rest of its value span, so a nested or escaped
        // JSON block cannot smuggle a secret past the structured rules.
        .replace(/\b([A-Za-z0-9_-]*(?:secret|token|password|passwd|credential|key|auth)[A-Za-z0-9_-]*)\b[^\r\n]{0,60}?[:=][^\r\n]*/giu, '$1=[redacted]')
        // A quoted absolute path (slash UNC, backslash UNC, single-slash POSIX,
        // or drive) is redacted whole; the body may contain spaces, the other
        // quote and any Unicode character, so a double-quoted "Team's
        // PRIVATE_ACCOUNT" path cannot leak its suffix. Both the raw and the
        // JSON-unescaped backslash forms are recognized. A quoted scheme URL
        // starts with a letter and is skipped.
        .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, (quoted) => {
        const body = quoted.slice(1, -1);
        return quotedPathShape(body) ? `${quoted[0]}[path]${quoted[0]}` : quoted;
    })
        // A quoted value inside a command string is delimited by JSON escapes.
        .replace(/\\"((?:[^"\\]|\\.)*?)\\"/gu, (match, body) => quotedPathShape(body) ? '\\"[path]\\"' : match)
        // A single-quoted path inside a JSON-encoded command string.
        .replace(/'((?:[^'\\]|\\.)*)'/gu, (match, body) => quotedPathShape(body) ? "'[path]'" : match)
        // An unquoted absolute-path start redacts the rest of the line before a
        // specific rule can stop halfway and leave a suffix, so a share,
        // directory, or file name with a space, a quote or Unicode cannot leak.
        // The lookbehind keeps scheme URLs, relative segments and ratios out.
        .replace(/(?<![A-Za-z0-9.:\\/])(?:[A-Za-z]:[\\/]|\/\/|\\\\|\/)[^\r\n]{2,}/gu, '[path]')
        // A POSIX path glued to a status prefix (ENOENT:/data/...) keeps its
        // colon, while a scheme URL's // right after the colon is skipped.
        .replace(/(?<=[A-Za-z]):\/(?!\/)[^\r\n]{2,}/gu, ':[path]')
        // A drive path needs a non-word boundary before the letter, so a URL's
        // scheme (https://) is not mistaken for one. It runs to the closing quote
        // or the line end so a directory with a space cannot leak its suffix.
        .replace(/(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n"']*/gu, '[path]')
        // Slash-form UNC: //server/share/... needs a boundary that a URL's // has
        // not; it runs to the closing quote or the line end, so Unicode segments
        // and spaces are covered.
        .replace(/(?<![A-Za-z0-9.:])\/\/[^\r\n"']+/gu, '[path]')
        // Backslash UNC up to the closing quote or the line end, so a share with
        // spaces cannot leak its suffix.
        .replace(/\\\\[^\r\n"']+/gu, '[path]')
        .replace(/\/(?:home|Users|tmp|var|etc|opt|srv|mnt|root|private|Volumes)\/[^\s"'`<>|\r\n]*/gu, '[path]')
        // Bounded general absolute POSIX path; the lookbehind keeps URLs, //UNC,
        // relative segments, ratios, and drive paths out of it. A negated class
        // keeps Unicode segments inside the match.
        .replace(/(?<![A-Za-z0-9.:/])(?:\/[^\s"'`<>|\r\n]{1,120}){2,8}\/?/gu, '[path]'));
}
/** Read a bounded text file; a missing file is a named absence, not an error. */
function readBoundedFile(path, max) {
    try {
        return readFileSync(path, 'utf8').slice(0, max);
    }
    catch {
        return '(missing)';
    }
}
/** The current open turn's direct user messages and whether this is the exact goal round. */
function openTurn(agent, goal) {
    const events = sessionEvents(agent);
    let start = 0;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        if (events[index]?.type === 'turn/start') {
            start = index;
            break;
        }
    }
    const directMessages = [];
    let goalRound = false;
    for (let index = start; index < events.length; index += 1) {
        const event = events[index];
        if (event === undefined || event.type !== 'user/message')
            continue;
        const source = event.data.source;
        if (source.kind === 'user') {
            directMessages.push(bound(messageText(event.data), MAX_USER_MESSAGE_CHARS));
        }
        else if (source.kind === 'goal' &&
            source.goalId === goal.id &&
            source.revision === goal.revision &&
            source.round === goal.roundsStarted) {
            goalRound = true;
        }
    }
    return { directMessages: directMessages.slice(-3), goalRound };
}
/** Bounded explicit block-request vocabulary; anything else is reviewed. */
const EXPLICIT_BLOCK_PATTERNS = [
    /\b(?:please\s+)?(?:mark|report|declare|call|set)\s+(?:(?:the|this|it|my|our)\s+)*(?:goal\s+)?(?:as\s+)?(?:blocked|a blocker)\b/iu,
    /\b(?:the|this)\s+goal\s+(?:is|should be|can be)\s+(?:marked\s+)?(?:blocked|a blocker)\b/iu,
    /\byou\s+(?:can|may|should)\s+(?:mark|report|declare)\s+(?:it|the goal)\s+(?:as\s+)?blocked\b/iu,
    /\b(?:block|stop)\s+(?:the|this)\s+goal\b/iu,
];
/**
 * A negated, conditional, or quoted block phrase is not a request to block:
 * those turns are reviewed, so only an affirmative unconditional request bypasses.
 */
const NON_AFFIRMATIVE_BLOCK_REQUEST = /\b(?:not|never|no|none|unless|if|except|without|avoid|instead|don'?t|doesn'?t|didn'?t|shouldn'?t|mustn'?t|won'?t|can'?t|cannot)\b/iu;
const QUOTED_SEGMENT = /"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’|`[^`]*`/gu;
/** Whether the open turn explicitly requested the block (a bounded text check). */
function explicitBlockRequest(messages) {
    return messages.some((message) => {
        const text = message.replace(QUOTED_SEGMENT, ' ');
        return (!NON_AFFIRMATIVE_BLOCK_REQUEST.test(text) &&
            EXPLICIT_BLOCK_PATTERNS.some((pattern) => pattern.test(text)));
    });
}
/** Format one tool result's text blocks. */
function toolResultText(event) {
    return event.data.message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('\n');
}
/** The runtime permission policy from one runtime-context snapshot message. */
function runtimePolicyFrom(message, workspace) {
    const source = message.source;
    if (source.form === 'snapshot' && Array.isArray(source.sections)) {
        const parts = source.sections
            .filter((section) => /sandbox|permission|policy|approval|file/iu.test(`${section.name ?? ''} ${section.text ?? ''}`))
            .map((section) => section.text ?? '')
            .filter((text) => text !== '');
        if (parts.length > 0) {
            return bound(redact(parts.join('\n'), workspace), MAX_RUNTIME_POLICY_CHARS);
        }
    }
    return bound(redact(messageText(message), workspace), MAX_RUNTIME_POLICY_CHARS);
}
/** Build the bounded, redacted evidence bundle from the session log and workspace files. */
function buildEvidence(agent, goal, subject, workspace) {
    const events = sessionEvents(agent);
    const buckets = new Map();
    const called = new Map();
    let round;
    const userMessages = [];
    let runtimePolicy = '(not found)';
    for (const event of events) {
        if (event.type === 'turn/start') {
            round = undefined;
            continue;
        }
        if (event.type === 'user/message') {
            const source = event.data.source;
            const sourceKind = source.kind;
            if (sourceKind === 'runtime-context') {
                runtimePolicy = runtimePolicyFrom(event.data, workspace);
                continue;
            }
            if (source.kind === 'goal') {
                if (source.goalId !== goal.id) {
                    round = undefined;
                    continue;
                }
                round = source.round;
                if (!buckets.has(round))
                    buckets.set(round, []);
                continue;
            }
            if (source.kind === 'user') {
                round = undefined;
                userMessages.push(bound(redact(messageText(event.data), workspace), MAX_USER_MESSAGE_CHARS));
            }
            continue;
        }
        if (event.type === 'tool/call' && round !== undefined) {
            const calls = buckets.get(round);
            if (calls !== undefined) {
                const call = {
                    name: bound(event.data.name, 80),
                    arguments: bound(redact(event.data.arguments, workspace), MAX_TOOL_ARGUMENT_CHARS),
                    result: '',
                };
                calls.push(call);
                called.set(event.data.callId, call);
            }
            continue;
        }
        if (event.type === 'tool/result') {
            const call = called.get(event.data.message.toolCallId);
            if (call !== undefined && call.result === '') {
                call.result = bound(redact(toolResultText(event), workspace), MAX_TOOL_RESULT_CHARS);
            }
        }
    }
    const rounds = [...buckets.entries()]
        .filter(([number]) => number <= goal.roundsStarted)
        .sort(([left], [right]) => left - right)
        .slice(-EVIDENCE_ROUNDS)
        .map(([number, calls]) => ({
        round: number,
        calls: calls.slice(-MAX_TOOL_CALLS_PER_ROUND),
    }));
    return {
        objective: bound(redact(goal.objective, workspace), 2000),
        subject: bound(redact(subject, workspace), MAX_SUBJECT_CHARS),
        rounds,
        userMessages: userMessages.slice(-MAX_EVIDENCE_USER_MESSAGES),
        runtimePolicy,
        workspaceInstructions: redact(readBoundedFile(join(workspace, 'AGENTS.md'), MAX_INSTRUCTIONS_CHARS), workspace),
        grants: redact(readBoundedFile(join(workspace, GRANTS_PATH), MAX_GRANTS_CHARS), workspace),
    };
}
/** SHA-256 over the objective, the subject kind and text, and the redacted evidence bundle. */
function evidenceDigest(objective, subjectKind, subject, evidence) {
    return createHash('sha256')
        .update(JSON.stringify({
        objective,
        subjectKind,
        subject,
        rounds: evidence.rounds,
        userMessages: evidence.userMessages,
        runtimePolicy: evidence.runtimePolicy,
        workspaceInstructions: evidence.workspaceInstructions,
        grants: evidence.grants,
    }))
        .digest('hex');
}
/** The JSON-normalized, bounded, redacted call arguments a question review judges. */
function questionSubject(argumentsValue, workspace) {
    return bound(redact(JSON.stringify(argumentsValue) ?? '', workspace), MAX_SUBJECT_CHARS);
}
/** One filesystem-safe goal directory name. */
function goalDirectoryName(goalId) {
    const safe = goalId.replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, 80);
    return safe === '' ? createHash('sha256').update(goalId).digest('hex').slice(0, 16) : safe;
}
/** Goal-scoped record directory under the workspace's local state. */
function recordDirectory(workspace, goalId) {
    return join(workspace, BLOCK_REVIEW_DIR, goalDirectoryName(goalId));
}
/** The digest-addressed record path for one proposal. */
function recordPathFor(workspace, goalId, digest) {
    return join(recordDirectory(workspace, goalId), `${digest}.json`);
}
/** The workspace-relative record path shown in model-facing text (never an absolute path). */
function displayRecordPath(workspace, goalId, digest) {
    const path = recordPathFor(workspace, goalId, digest);
    return path.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '');
}
/** Read one record object; an absent or malformed file is no record. */
function readRecordFile(path) {
    try {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        if (!isRecord(value) || value.version !== 1)
            return undefined;
        return value;
    }
    catch {
        return undefined;
    }
}
/** A stored reviewed verdict for this exact proposal, if one exists. */
function cachedVerdict(workspace, goalId, digest) {
    const record = readRecordFile(recordPathFor(workspace, goalId, digest));
    if (record === undefined || record.digest !== digest)
        return undefined;
    if (record.verified !== true)
        return undefined;
    const evidence = Array.isArray(record.evidence)
        ? record.evidence.filter((item) => typeof item === 'string')
        : [];
    if (record.verdict === 'blocker') {
        if (typeof record.userAction !== 'string' || record.userAction === '')
            return undefined;
        return { verdict: 'blocker', userAction: record.userAction, evidence };
    }
    if (record.verdict === 'not-blocker') {
        if (typeof record.nextStep !== 'string' || record.nextStep === '')
            return undefined;
        return { verdict: 'not-blocker', nextStep: record.nextStep, evidence };
    }
    return undefined;
}
/**
 * One file per started review, so the per-goal bound counts attempts rather than
 * digest records; a repeated failure cannot overwrite its way back into budget.
 */
function attemptsDirectory(workspace, goalId) {
    return join(recordDirectory(workspace, goalId), 'attempts');
}
/** Count the reviews this goal has actually started; policy records do not count. */
async function countReviewAttempts(workspace, goalId) {
    try {
        return (await readdir(attemptsDirectory(workspace, goalId))).length;
    }
    catch {
        return 0;
    }
}
/** Charge one started review against the goal's bounded model-call budget. */
async function recordReviewAttempt(workspace, goalId) {
    const directory = attemptsDirectory(workspace, goalId);
    try {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${Date.now()}-${randomUUID()}`), '1', 'utf8');
    }
    catch {
        // Audit state is best-effort; the tool decision is already determined.
    }
}
/** Write one local record atomically; the gate never fails a session on an audit write. */
async function writeRecord(path, record) {
    try {
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await rename(temporary, path);
        return true;
    }
    catch {
        // Audit state is best-effort: the tool decision is already determined.
        return false;
    }
}
/** Parse exactly one fenced JSON block; anything else is a review error. */
function singleFencedJson(text) {
    const blocks = [];
    const fence = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/gu;
    for (const match of text.matchAll(fence))
        blocks.push(match[1] ?? '');
    if (blocks.length === 0)
        throw new Error('the reviewer returned no fenced JSON verdict');
    if (blocks.length > 1) {
        throw new Error(`the reviewer returned ${blocks.length} fenced blocks; exactly one verdict is required`);
    }
    try {
        return JSON.parse(blocks[0]);
    }
    catch (error) {
        throw new Error(`the fenced verdict is not valid JSON: ${errorMessage(error)}`);
    }
}
/** Parse exactly one strict verdict; anything else is a review error. */
function parseVerdict(text, workspace) {
    const value = singleFencedJson(text);
    if (!isRecord(value))
        throw new Error('the fenced verdict must be a JSON object');
    const allowed = new Set(['verdict', 'userAction', 'nextStep', 'evidence', 'confidence']);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            throw new Error(`the verdict has unknown field "${key}"`);
    }
    const nonEmpty = (field, raw) => {
        if (typeof raw !== 'string' || raw.trim() === '') {
            throw new Error(`the verdict "${field}" must be a non-empty string`);
        }
        return bound(redact(raw.trim(), workspace), MAX_REVIEW_ACTION_CHARS);
    };
    const optionalEvidence = (raw) => {
        if (raw === undefined)
            return [];
        if (!Array.isArray(raw))
            throw new Error('the verdict "evidence" must be a list');
        if (raw.length > MAX_VERDICT_EVIDENCE) {
            throw new Error(`the verdict "evidence" must list at most ${MAX_VERDICT_EVIDENCE} items`);
        }
        return raw.map((item) => {
            if (typeof item !== 'string' || item.trim() === '') {
                throw new Error('every verdict evidence item must be a non-empty string');
            }
            return bound(redact(item.trim(), workspace), MAX_VERDICT_EVIDENCE_CHARS);
        });
    };
    const evidence = optionalEvidence(value.evidence);
    const confidence = value.confidence === undefined ? undefined : nonEmpty('confidence', value.confidence);
    if (value.verdict === 'blocker') {
        if (value.nextStep !== undefined && value.nextStep !== null) {
            throw new Error('a blocker verdict cannot also carry a nextStep');
        }
        return {
            verdict: 'blocker',
            userAction: nonEmpty('userAction', value.userAction),
            evidence,
            ...(confidence === undefined ? {} : { confidence }),
        };
    }
    if (value.verdict === 'not-blocker') {
        if (value.userAction !== undefined && value.userAction !== null) {
            throw new Error('a not-blocker verdict cannot also carry a userAction');
        }
        return {
            verdict: 'not-blocker',
            nextStep: nonEmpty('nextStep', value.nextStep),
            evidence,
            ...(confidence === undefined ? {} : { confidence }),
        };
    }
    throw new Error('the verdict must be "blocker" or "not-blocker"');
}
/** The bundled reviewer instructions; a missing asset is a review error. */
let reviewerInstructions;
function loadReviewerInstructions() {
    if (reviewerInstructions === undefined) {
        reviewerInstructions = readFileSync(join(assetsDirectory, 'blocker-review.md'), 'utf8').trim();
    }
    return reviewerInstructions;
}
/** Render the bounded reviewer prompt: required evidence first, tool history within the rest. */
function composeReviewPrompt(evidence, workspace, goal, subjectKind) {
    const header = [
        loadReviewerInstructions(),
        '',
        '## Review evidence',
        '',
        `- Workspace (read-only): ${bound(workspace, 260)}`,
        `- Objective: ${evidence.objective}`,
        `- Rounds started: ${goal.roundsStarted} of ${goal.maxGoalRounds}`,
        `- ${subjectKind === 'question' ? 'Proposed question' : 'Block reason'}: ${evidence.subject}`,
        '',
        '### Last goal rounds',
        '',
    ].join('\n');
    const rounds = [];
    if (evidence.rounds.length === 0)
        rounds.push('(no goal-round tool activity recorded)');
    for (const round of evidence.rounds) {
        rounds.push('', `Round ${round.round}:`);
        if (round.calls.length === 0)
            rounds.push('- (no tool calls)');
        for (const call of round.calls) {
            rounds.push(`- ${call.name} ${call.arguments}`);
            if (call.result !== '')
                rounds.push(`  result: ${call.result}`);
        }
    }
    const tail = [
        '',
        '### User messages (most recent last)',
        ...(evidence.userMessages.length === 0
            ? ['(none recorded)']
            : evidence.userMessages.flatMap((message) => ['', message])),
        '',
        '### Runtime permission policy',
        '',
        evidence.runtimePolicy,
        '',
        '### Workspace instructions (AGENTS.md)',
        '',
        evidence.workspaceInstructions,
        '',
        '### Standing grants (.dsh/goal-continuity/grants.json)',
        '',
        evidence.grants,
        '',
        'Return exactly one fenced JSON block in the schema the instructions require.',
    ].join('\n');
    // Reserve the permission and grant evidence before spending space on tool history.
    const room = MAX_REVIEW_PROMPT_CHARS - header.length - tail.length;
    const history = room > 0 ? bound(rounds.join('\n'), room) : '';
    return `${header}${history}${tail}`;
}
/** Output text of one settled subagent run. */
function outputText(output) {
    const blocks = [];
    for (const block of output) {
        if (block.type === 'text' && typeof block.text === 'string')
            blocks.push(block.text);
    }
    return blocks.join('\n').trim();
}
/** Await one promise with a wall-clock bound and caller cancellation. */
async function awaitBounded(promise, timeoutMs, signal) {
    let timer;
    let abort;
    try {
        return await Promise.race([
            promise.then((value) => ({ kind: 'value', value }), (error) => ({ kind: 'threw', error })),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
            }),
            new Promise((resolve) => {
                abort = () => resolve({ kind: 'aborted' });
                if (signal.aborted)
                    abort();
                else
                    signal.addEventListener('abort', abort, { once: true });
            }),
        ]);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
        if (abort !== undefined)
            signal.removeEventListener('abort', abort);
    }
}
/** Await one review with a wall-clock bound and caller cancellation. */
async function awaitReview(activation, timeoutMs, signal) {
    const settled = await awaitBounded(activation.result, timeoutMs, signal);
    if (settled.kind === 'value')
        return { kind: 'result', value: settled.value };
    return settled;
}
/** Start and settle one fresh-context read-only reviewer child. */
async function runReviewChild(ctx, agent, workspace, prompt, policy, signal) {
    const target = {
        provider: policy.provider,
        model: policy.model,
        reasoningEffort: policy.reasoningEffort,
        preset: policy.reviewerPreset,
    };
    const subagents = optionalService(ctx, 'subagents');
    if (subagents === undefined) {
        return { kind: 'unavailable', detail: 'the subagent service is not mounted' };
    }
    let provider;
    try {
        provider = subagents.getProvider(policy.provider);
    }
    catch (error) {
        return {
            kind: 'unavailable',
            detail: `the provider registry failed: ${errorMessage(error)}`,
        };
    }
    if (provider === undefined) {
        let registered = [];
        try {
            registered = subagents.list();
        }
        catch {
            // Keep the diagnostic after the provider lookup.
        }
        return {
            kind: 'unavailable',
            detail: `provider "${policy.provider}" is not registered (registered: ${registered.join(', ') || 'none'})`,
        };
    }
    if (provider.capabilities?.agentPreset !== true) {
        return {
            kind: 'unavailable',
            detail: `provider "${provider.name}" does not support an independent agent preset`,
        };
    }
    if (provider.inheritsParentContext === true) {
        return {
            kind: 'unavailable',
            detail: `provider "${provider.name}" inherits the parent context; the reviewer needs a fresh context`,
        };
    }
    const agentOptions = {};
    if (provider.capabilities.agentOptions === true) {
        agentOptions.model = policy.model;
        agentOptions.reasoningEffort = policy.reasoningEffort;
    }
    // The deadline covers child startup as well as the child's result: a stalled
    // provider must not hold the review forever.
    const controller = new AbortController();
    let callerAborted = false;
    const onCallerAbort = () => {
        callerAborted = true;
        controller.abort();
    };
    if (signal.aborted)
        onCallerAbort();
    else
        signal.addEventListener('abort', onCallerAbort, { once: true });
    const deadline = setTimeout(() => controller.abort(), policy.timeoutMs);
    const reviewStartedAt = Date.now();
    let activation;
    try {
        const starting = subagents.startActivation({
            provider: provider.name,
            label: policy.label,
            request: {
                prompt: [{ type: 'text', text: prompt }],
                parent: agent,
                cwd: workspace,
                agentPreset: policy.reviewerPreset,
                ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
            },
            signal: controller.signal,
            delivery: 'caller',
        });
        const started = await awaitBounded(starting, policy.timeoutMs, controller.signal);
        if (started.kind === 'timeout' || started.kind === 'aborted') {
            // The provider may still return an activation; dispose it when it does.
            void starting.then((late) => late.dispose()).catch(() => undefined);
            return callerAborted
                ? { kind: 'error', detail: 'the review was cancelled', started: false }
                : {
                    kind: 'error',
                    detail: `the review did not finish within ${policy.timeoutMs} ms`,
                    started: false,
                };
        }
        if (started.kind === 'threw') {
            const message = errorMessage(started.error);
            if (message.startsWith(SCOPE_FAILURE_PREFIX))
                return { kind: 'unavailable', detail: message };
            // A missing or disabled preset is a configuration problem; the manager's
            // mount diagnostic names it, so follow the unavailable policy.
            if (/agent preset|agentPreset|preset/iu.test(message)) {
                return { kind: 'unavailable', detail: message };
            }
            return { kind: 'error', detail: `the reviewer could not start: ${message}`, started: false };
        }
        activation = started.value;
        const remaining = Math.max(0, policy.timeoutMs - (Date.now() - reviewStartedAt));
        const settled = await awaitReview(activation, remaining, controller.signal);
        if (settled.kind === 'timeout') {
            return {
                kind: 'error',
                detail: `the review did not finish within ${policy.timeoutMs} ms`,
                started: true,
            };
        }
        if (settled.kind === 'aborted') {
            return callerAborted
                ? { kind: 'error', detail: 'the review was cancelled', started: true }
                : {
                    kind: 'error',
                    detail: `the review did not finish within ${policy.timeoutMs} ms`,
                    started: true,
                };
        }
        if (settled.kind === 'threw') {
            return {
                kind: 'error',
                detail: `the review failed: ${errorMessage(settled.error)}`,
                started: true,
            };
        }
        if (settled.value.stopReason !== 'completed') {
            const diagnostic = settled.value.diagnostic === undefined ? '' : `: ${settled.value.diagnostic}`;
            return {
                kind: 'error',
                detail: `the reviewer stopped with "${settled.value.stopReason}"${diagnostic}`,
                started: true,
            };
        }
        return { kind: 'text', text: outputText(settled.value.output), target };
    }
    finally {
        clearTimeout(deadline);
        signal.removeEventListener('abort', onCallerAbort);
        // Disposal is cleanup, not part of the bounded review: a stalled dispose
        // must not keep the timeout outcome from being recorded.
        if (activation !== undefined)
            void activation.dispose().catch(() => undefined);
    }
}
/** Start and settle the block reviewer and parse its strict verdict. */
async function runReview(ctx, agent, workspace, prompt, config, signal) {
    const outcome = await runReviewChild(ctx, agent, workspace, prompt, {
        provider: config.provider,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        reviewerPreset: config.reviewerPreset,
        timeoutMs: config.timeoutMs,
        label: REVIEW_LABEL,
    }, signal);
    if (outcome.kind !== 'text')
        return outcome;
    try {
        return {
            kind: 'reviewed',
            verdict: parseVerdict(outcome.text, workspace),
            target: outcome.target,
        };
    }
    catch (error) {
        return {
            kind: 'error',
            detail: `the reviewer verdict is invalid: ${errorMessage(error)}`,
            started: true,
        };
    }
}
/** Deny with the reviewer's next action and a visible code. */
function denyWith(reason, code, name = 'goal-block-review') {
    return {
        kind: 'deny',
        reason: bound(reason, MAX_DENY_REASON_CHARS),
        info: { name, code },
    };
}
/** The tool decision for one strict verdict; a verified block gets a notice. */
function verdictDecision(agent, verdict, reused, recordPath, subjectKind) {
    if (verdict.verdict === 'not-blocker') {
        if (subjectKind === 'question') {
            return denyWith(`The independent question review rejected this question: ${verdict.nextStep} The goal stays active. Do that next step now and record the assumption in your next work_checkpoint; do not ask the user for this decision. Record: ${recordPath}.`, QUESTION_REJECTED_CODE, 'goal-question-review');
        }
        return denyWith(`The independent block review rejected this goal block: ${verdict.nextStep} The goal stays active. Do that next step now; do not ask the user for permission this review already covers. Record: ${recordPath}.`, REJECTED_CODE);
    }
    // An allowed question simply reaches the user; only a block needs the notice.
    if (subjectKind === 'question')
        return undefined;
    deliverNotice(agent, `Block review ${reused ? '(cached) ' : ''}confirmed a user-only blocker. The closing message must name exactly this user action: ${verdict.userAction}. Record: ${recordPath}.`, 'goal-continuity: block review confirmed a blocker');
    return undefined;
}
/** Record one policy decision without pretending it is a review verdict. */
async function recordPolicy(agent, workspace, goal, digest, subjectKind, verdict, policy, detail, target, reviewed, evidence) {
    await writeRecord(recordPathFor(workspace, goal.id, digest), {
        version: 1,
        goal: goal.id,
        revision: goal.revision,
        objective: bound(redact(goal.objective, workspace), 500),
        digest,
        subject: subjectKind,
        subjectText: evidence?.subject ?? '',
        verdict,
        verified: false,
        reviewed,
        evidence: [],
        evidenceSummary: {
            rounds: evidence?.rounds.length ?? 0,
            toolCalls: evidence?.rounds.reduce((total, round) => total + round.calls.length, 0) ?? 0,
            userMessages: evidence?.userMessages.length ?? 0,
            runtimePolicy: bound(evidence?.runtimePolicy ?? '', 200),
            grantsPresent: evidence !== undefined && evidence.grants !== '(missing)',
            instructionsChars: evidence?.workspaceInstructions.length ?? 0,
        },
        target,
        policy,
        detail: bound(redact(detail, workspace), 1000),
        time: new Date().toISOString(),
        session: agent.session.id,
    });
    return displayRecordPath(workspace, goal.id, digest);
}
/** Visible notice for a policy-allowed unverified proposal. */
function notifyUnverified(agent, subjectKind, record, policy, detail) {
    const text = subjectKind === 'question'
        ? `Question review allowed this question UNVERIFIED (${policy}: ${bound(detail, 300)}). Record: ${record}. The question will reach the user without a confirmed user-only answer.`
        : `Block review allowed this goal block UNVERIFIED (${policy}: ${bound(detail, 300)}). Record: ${record}. The goal will block without a confirmed user-only action.`;
    deliverNotice(agent, text, `goal-continuity: unverified ${subjectKind} allowed (${policy})`);
}
/** Install the shared reviewer child-scope allowlist used by both reviews. */
function installReviewerScope(ctx, reviewerPreset) {
    ctx.on('agent/created', ({ agent }) => {
        if (agent.session.header.origin !== 'subagent')
            return undefined;
        if (agent.session.header.agentPreset !== reviewerPreset)
            return undefined;
        try {
            const tools = agent.ctx.tools;
            if (typeof tools?.restrict !== 'function') {
                throw new Error('the reviewer child scope has no tools service');
            }
            const dispose = tools.restrict({ allow: [...REVIEWER_TOOLS] });
            if (typeof dispose !== 'function') {
                throw new Error('the child-scope restriction returned no disposer');
            }
        }
        catch (error) {
            // Fail creation: the child must not run a single step without the allowlist.
            throw new Error(`${SCOPE_FAILURE_PREFIX}: ${errorMessage(error)}`);
        }
        return undefined;
    });
}
/** Install the block-review pre-execute gate. */
function installBlockReview(ctx, config) {
    if (!config.enabled)
        return;
    ctx.on('tools/pre-execute', async (exec, next) => {
        try {
            return await decide(exec, next);
        }
        catch {
            // An unexpected gate failure must not mask every tool call in the session.
            return next();
        }
    });
    async function decide(exec, next) {
        const agent = exec.agent;
        if (agent === undefined || !isRootAgent(agent))
            return next();
        const subjectKind = exec.name === 'update_goal'
            ? 'block'
            : exec.name === 'ask_user_question'
                ? 'question'
                : undefined;
        if (subjectKind === undefined)
            return next();
        const goal = readCurrentGoal(ctx, agent);
        if (goal === undefined || goal.phase !== 'active')
            return next();
        const turn = openTurn(agent, goal);
        const workspace = workspaceFor(ctx, agent);
        let subject;
        if (subjectKind === 'question') {
            // Only a goal round is supervised; a direct-human turn is not a pause.
            if (!config.reviewQuestions || !turn.goalRound)
                return next();
            subject = questionSubject(exec.arguments, workspace);
        }
        else {
            const args = exec.arguments;
            if (!isRecord(args) || args.action !== 'blocked')
                return next();
            if (args.goal_id !== goal.id || args.revision !== goal.revision)
                return next();
            const blockReason = typeof args.blocked_reason === 'string' ? args.blocked_reason : '';
            if (blockReason.trim() === '')
                return next();
            if (explicitBlockRequest(turn.directMessages))
                return next();
            if (turn.goalRound && goal.roundsStarted < config.blockedAfterConsecutiveRounds)
                return next();
            subject = blockReason;
        }
        const label = subjectKind === 'question' ? 'Question review' : 'Block review';
        const denialName = subjectKind === 'question' ? 'goal-question-review' : 'goal-block-review';
        const evidence = buildEvidence(agent, goal, subject, workspace);
        const digest = evidenceDigest(goal.objective, subjectKind, subject, evidence);
        const record = displayRecordPath(workspace, goal.id, digest);
        const cached = cachedVerdict(workspace, goal.id, digest);
        if (cached !== undefined) {
            return verdictDecision(agent, cached, true, record, subjectKind) ?? next();
        }
        const target = {
            provider: config.provider,
            model: config.model,
            reasoningEffort: config.reasoningEffort,
            preset: config.reviewerPreset,
        };
        const reviewed = await countReviewAttempts(workspace, goal.id);
        if (reviewed >= config.maxReviewsPerGoal) {
            const detail = `the per-goal review budget (${config.maxReviewsPerGoal}) is exhausted`;
            const written = await recordPolicy(agent, workspace, goal, digest, subjectKind, 'exhausted', 'onExhausted', detail, target, false, evidence);
            if (config.onExhausted === 'allow') {
                notifyUnverified(agent, subjectKind, written, 'onExhausted', detail);
                return next();
            }
            return denyWith(`${label} rejected this proposal: ${detail}. The goal stays active. Continue the objective with another authorized route, or record why only the user can proceed; raising maxReviewsPerGoal allows another review. Record: ${record}.`, EXHAUSTED_CODE, denialName);
        }
        let prompt;
        try {
            prompt = composeReviewPrompt(evidence, workspace, goal, subjectKind);
        }
        catch (error) {
            const detail = `the reviewer prompt could not be built: ${errorMessage(error)}`;
            const written = await recordPolicy(agent, workspace, goal, digest, subjectKind, 'review-error', 'onReviewError', detail, target, false, evidence);
            if (config.onReviewError === 'allow') {
                notifyUnverified(agent, subjectKind, written, 'onReviewError', detail);
                return next();
            }
            return denyWith(`${label} could not run (${detail}) and onReviewError is "deny". The goal stays active. Fix the review target or set blockReview.onReviewError to "allow". Record: ${record}.`, REVIEW_ERROR_CODE, denialName);
        }
        const outcome = await runReview(ctx, agent, workspace, prompt, config, exec.signal);
        // Charge a review that actually started; an unavailable target spends no model call.
        if (outcome.kind === 'reviewed' || (outcome.kind === 'error' && outcome.started)) {
            await recordReviewAttempt(workspace, goal.id);
        }
        if (outcome.kind === 'unavailable') {
            const detail = redact(outcome.detail, workspace);
            const written = await recordPolicy(agent, workspace, goal, digest, subjectKind, 'unavailable', 'onUnavailable', detail, target, false, evidence);
            if (config.onUnavailable === 'allow') {
                notifyUnverified(agent, subjectKind, written, 'onUnavailable', detail);
                return next();
            }
            return denyWith(`${label} is unavailable (${detail}) and onUnavailable is "deny". The goal stays active. Fix the reviewer provider or preset, or set blockReview.onUnavailable to "allow". Record: ${record}.`, UNAVAILABLE_CODE, denialName);
        }
        if (outcome.kind === 'error') {
            const detail = redact(outcome.detail, workspace);
            const written = await recordPolicy(agent, workspace, goal, digest, subjectKind, 'review-error', 'onReviewError', detail, target, outcome.started, evidence);
            if (config.onReviewError === 'allow') {
                notifyUnverified(agent, subjectKind, written, 'onReviewError', detail);
                return next();
            }
            return denyWith(`${label} failed (${detail}) and onReviewError is "deny". The goal stays active. Fix the reviewer target or set blockReview.onReviewError to "allow". Record: ${record}.`, REVIEW_ERROR_CODE, denialName);
        }
        const calls = evidence.rounds.reduce((total, round) => total + round.calls.length, 0);
        await writeRecord(recordPathFor(workspace, goal.id, digest), {
            version: 1,
            goal: goal.id,
            revision: goal.revision,
            objective: bound(redact(goal.objective, workspace), 500),
            digest,
            subject: subjectKind,
            subjectText: evidence.subject,
            verdict: outcome.verdict.verdict,
            verified: true,
            reviewed: true,
            ...(outcome.verdict.userAction === undefined
                ? {}
                : { userAction: outcome.verdict.userAction }),
            ...(outcome.verdict.nextStep === undefined ? {} : { nextStep: outcome.verdict.nextStep }),
            evidence: outcome.verdict.evidence,
            evidenceSummary: {
                rounds: evidence.rounds.length,
                toolCalls: calls,
                userMessages: evidence.userMessages.length,
                runtimePolicy: bound(evidence.runtimePolicy, 200),
                grantsPresent: evidence.grants !== '(missing)',
                instructionsChars: evidence.workspaceInstructions.length,
            },
            target: outcome.target,
            time: new Date().toISOString(),
            session: agent.session.id,
        });
        const decision = verdictDecision(agent, outcome.verdict, false, record, subjectKind);
        return decision ?? next();
    }
}
/**
 * Work checkpoints: one structured decision recorded at a substantial root turn
 * close. Detection reads the tool results the supervisor already observes; the
 * close gate steers, but never starts, continues, or cancels a turn, and never
 * changes the goal.
 */
/** Tool names that count as worker starts for the trigger and the parallel gate. */
const WORKER_START_TOOLS = Object.freeze([
    'subagent',
    'subagent_fork',
    'spawn_teammate',
    'workflow',
    'delegate',
]);
/** Tool names whose successful result is a write for the trigger. */
const WRITE_TOOLS = Object.freeze(['edit', 'write']);
/** Tool names whose arguments carry one shell command. */
const SHELL_TOOLS = Object.freeze(['pwsh', 'bash', 'terminal_send']);
/**
 * Classify a shell tool's structured result. Only the canonical foreground
 * shape with a clean exit proves success; any other shape is unreadable and
 * must never be presented as success.
 */
function shellOutcomeOf(result) {
    if (result.isError === true)
        return 'failure';
    const value = isRecord(result.value) ? result.value : undefined;
    if (value === undefined || value.kind !== 'foreground')
        return 'unreadable';
    const exitCode = value.exitCode;
    const signal = value.signal;
    if ((typeof exitCode !== 'number' && exitCode !== null) ||
        (typeof signal !== 'string' && signal !== null)) {
        return 'unreadable';
    }
    if (typeof value.timedOut !== 'boolean' || typeof value.aborted !== 'boolean')
        return 'unreadable';
    let denied = false;
    let runnerFailed = false;
    if (value.sandbox !== undefined) {
        if (!isRecord(value.sandbox) || typeof value.sandbox.denied !== 'boolean')
            return 'unreadable';
        denied = value.sandbox.denied;
        runnerFailed = value.sandbox.runnerFailed === true;
    }
    const clean = exitCode === 0 &&
        signal === null &&
        value.timedOut === false &&
        value.aborted === false &&
        !denied &&
        !runnerFailed;
    return clean ? 'success' : 'failure';
}
/** The tool the model calls to record its decision. */
const CHECKPOINT_TOOL = 'work_checkpoint';
/** Local checkpoint records; machine-local scratch and never a tracked file. */
const WORK_CHECKPOINT_DIR = join('.dsh', 'work-checkpoints');
/** Bounds for the record fields, the observed evidence, and the request. */
const MAX_CHECKPOINT_ITEMS = 8;
const MAX_CHECKPOINT_ITEM_CHARS = 240;
const MAX_CHECKPOINT_NEXT_CHARS = 400;
const MAX_CHECKPOINT_SERIAL_CHARS = 400;
const MAX_CHECKPOINT_BOTTLENECK_CHARS = 400;
const MAX_CHECKPOINT_SPEEDUP_CHARS = 240;
const MAX_CHECKPOINT_PATHS = 5;
const MAX_CHECKPOINT_PATH_CHARS = 120;
const MAX_CHECKPOINT_SUMMARY_CHARS = 900;
/** Whether a registered tool is visible to this agent; an absent registry is absent capability. */
function toolVisible(ctx, agent, name) {
    const tools = optionalService(ctx, 'tools');
    if (tools === undefined)
        return false;
    try {
        return tools.get(name, agent) !== undefined;
    }
    catch {
        return false;
    }
}
/** Whether a delegate result's first line reports a started run rather than reuse. */
function delegateStarted(resultText) {
    // Answer-contract results always ran a target and END with this trailer; a
    // cached record may quote it inside its evidence, which proves nothing.
    if (resultText
        .trimEnd()
        .endsWith('(no gate record: this answer does not satisfy a strict review rule)')) {
        return true;
    }
    const first = resultText.split(/\r?\n/u)[0] ?? '';
    if (/^rule "[^"]+" review (?:already pending|queued)$/u.test(first))
        return false;
    // Only the engine's own cached-record envelope is a reuse; worker answers may
    // contain the words "reused record" without being one.
    return !/^rule "[^"]+" (?:PASS|FINDINGS|ERROR) \(reused record /u.test(first);
}
/** The stable id one turn's checkpoint carries; a parallel worker tags its arguments with it. */
function checkpointIdFor(sessionId, turn) {
    const digest = createHash('sha256').update(`${sessionId}:${turn}`).digest('hex').slice(0, 8);
    return `checkpoint-${turn}-${digest}`;
}
/** The hashed session directory under the workspace's local state. */
function checkpointDirectory(workspace, sessionId) {
    return join(workspace, WORK_CHECKPOINT_DIR, createHash('sha256').update(sessionId).digest('hex').slice(0, 16));
}
/** The one record path for one turn; a repeated call replaces the same record. */
function checkpointPathFor(workspace, sessionId, turn) {
    return join(checkpointDirectory(workspace, sessionId), `${turn}.json`);
}
/** The workspace-relative path shown in model-facing text (never an absolute path). */
function displayCheckpointPath(workspace, path) {
    return path.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '');
}
/** The turn number of the last opened turn, or undefined when none is open. */
function openTurnNumber(agent) {
    const events = sessionEvents(agent);
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'turn/start')
            return event.data.turn;
    }
    return undefined;
}
/** The bounded, redacted command one shell tool's arguments carry. */
function shellCommandOf(argumentsText, workspace) {
    try {
        const args = JSON.parse(argumentsText);
        if (isRecord(args)) {
            const command = typeof args.command === 'string' ? args.command : args.text;
            if (typeof command === 'string') {
                return bound(redact(command, workspace), MAX_CHECKPOINT_PATH_CHARS);
            }
        }
    }
    catch {
        // A malformed argument string carries no command.
    }
    return '(unknown command)';
}
/** The `file_path` one write tool's arguments carry. */
function writtenPathOf(argumentsText) {
    try {
        const args = JSON.parse(argumentsText);
        if (isRecord(args) && typeof args.file_path === 'string')
            return args.file_path;
    }
    catch {
        // A malformed argument string carries no path.
    }
    return undefined;
}
/** Collect one turn's observed tool evidence from the committed session log. */
function checkpointEvidence(agent, turn, workspace, shellOutcomes) {
    const events = sessionEvents(agent);
    let start = 0;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'turn/start' && event.data.turn === turn) {
            start = index;
            break;
        }
    }
    const calls = new Map();
    let toolCalls = 0;
    let lastTool;
    const written = [];
    const workers = [];
    let shell;
    let failedTool;
    let checkpoint;
    for (let index = start; index < events.length; index += 1) {
        const event = events[index];
        if (event?.type === 'tool/call') {
            toolCalls += 1;
            lastTool = event.data.name;
            calls.set(event.data.callId, {
                index,
                name: event.data.name,
                arguments: event.data.arguments,
                resultText: '',
            });
            if (SHELL_TOOLS.includes(event.data.name)) {
                shell = {
                    index,
                    tool: event.data.name,
                    command: shellCommandOf(event.data.arguments, workspace),
                    outcome: shellOutcomes?.get(String(event.data.callId)),
                };
            }
            continue;
        }
        if (event?.type !== 'tool/result')
            continue;
        const call = calls.get(event.data.message.toolCallId);
        if (call === undefined)
            continue;
        const failed = event.data.message.isError === true;
        call.result = failed ? 'failure' : 'success';
        call.resultText = toolResultText(event);
        if (shell?.index === call.index) {
            shell = { ...shell, outcome: failed ? 'failure' : shell.outcome };
        }
        if (failed) {
            failedTool = call.name;
            continue;
        }
        if (WRITE_TOOLS.includes(call.name)) {
            const path = writtenPathOf(call.arguments);
            if (path !== undefined)
                written.push(path);
        }
        if (WORKER_START_TOOLS.includes(call.name) &&
            (call.name !== 'delegate' || delegateStarted(call.resultText))) {
            workers.push(call.name);
        }
        if (call.name === CHECKPOINT_TOOL)
            checkpoint = { index: call.index, arguments: call.arguments };
    }
    return { toolCalls, written, workers, shell, failedTool, lastTool, checkpoint, calls };
}
/** The decision one successful checkpoint carries, when it is readable. */
function checkpointDecision(evidence) {
    const checkpoint = evidence.checkpoint;
    if (checkpoint === undefined)
        return undefined;
    try {
        const args = JSON.parse(checkpoint.arguments);
        if (!isRecord(args))
            return undefined;
        if (args.outcome !== 'done' && args.outcome !== 'continue')
            return undefined;
        return { outcome: args.outcome, parallel: args.parallel === true };
    }
    catch {
        return undefined;
    }
}
/** Whether a successful worker start after the checkpoint carries its id. */
function taggedWorkerStarted(evidence, id) {
    const checkpoint = evidence.checkpoint;
    if (checkpoint === undefined)
        return false;
    for (const call of evidence.calls.values()) {
        if (call.index <= checkpoint.index || call.result !== 'success')
            continue;
        if (!WORKER_START_TOOLS.includes(call.name))
            continue;
        if (!call.arguments.includes(id))
            continue;
        // A delegate can answer from a cached record without starting a target.
        if (call.name === 'delegate' && !delegateStarted(call.resultText))
            continue;
        return true;
    }
    return false;
}
/** Whether any registered tool can start a worker for this agent. */
function workerToolVisible(ctx, agent) {
    return WORKER_START_TOOLS.some((name) => toolVisible(ctx, agent, name));
}
/** Whether the close needs a checkpoint for this turn; freshness is checked first. */
function checkpointRequired(evidence, config) {
    if (evidence.toolCalls < config.minToolCalls)
        return false;
    if (evidence.lastTool === 'ask_user_question')
        return false;
    if (config.requireWrite && evidence.written.length === 0 && evidence.workers.length === 0) {
        return false;
    }
    return true;
}
/** The bounded checkpoint request naming the evidence and the decision questions. */
function composeCheckpointRequest(evidence, workspace, max, step) {
    const paths = evidence.written
        .slice(0, MAX_CHECKPOINT_PATHS)
        .map((path) => bound(redact(path, workspace), MAX_CHECKPOINT_PATH_CHARS));
    const more = evidence.written.length - paths.length;
    const pathText = evidence.written.length === 0
        ? 'none'
        : `${paths.join(', ')}${more > 0 ? ` (+${more} more)` : ''}`;
    const shellState = evidence.shell === undefined
        ? 'none'
        : evidence.shell.outcome === 'success'
            ? 'ok'
            : evidence.shell.outcome === 'failure'
                ? 'failed'
                : evidence.shell.outcome === 'unreadable'
                    ? 'exit state unreadable'
                    : 'pending';
    const shellText = evidence.shell === undefined ? 'none' : `${evidence.shell.tool} \`${evidence.shell.command}\``;
    const workerText = evidence.workers.length === 0 ? 'none' : evidence.workers.join(', ');
    // The questions and the event locator survive any maxMessageChars: only the
    // evidence body is bounded, never the tail.
    const head = 'Work checkpoint required (goal-continuity).';
    const tail = 'work_checkpoint: done|continue, verified, remaining, parallel or serialReason, bottleneck, next. Done? verified? remaining? lanes? bottleneck? next action?';
    const evidenceLines = [
        ...(step === undefined ? [] : [`- Steps: ${step.step} of ${step.interval}`]),
        `- Tool calls: ${evidence.toolCalls}`,
        `- Written paths: ${pathText}`,
        `- Last shell: ${shellText}`,
        `- Last shell exit: ${shellState}`,
        ...(evidence.failedTool === undefined ? [] : [`- Last failed tool: ${evidence.failedTool}`]),
        `- Worker starts: ${workerText}`,
    ];
    const budget = max - head.length - tail.length - 2;
    const body = budget <= 0 ? '' : bound(redact(evidenceLines.join('\n'), workspace), budget);
    return body === '' ? redact(`${head}\n${tail}`, workspace) : `${head}\n${body}\n${tail}`;
}
/** The bounded parallel-gate steer naming the checkpoint id and both escapes. */
function composeParallelRequest(id, max) {
    return bound(`Work checkpoint ${id} declares parallel remaining work (goal-continuity). Start a worker whose call arguments contain ${id}, or amend the checkpoint with work_checkpoint: outcome "continue", parallel false, and a non-empty serialReason.`, max);
}
/** One optional non-empty bounded text field, redacted before it is stored. */
function checkpointText(raw, field, max, workspace) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'string' || raw.trim() === '') {
        throw new Error(`work_checkpoint.${field} must be a non-empty string`);
    }
    return bound(redact(raw.trim(), workspace), max);
}
/** One bounded list of non-empty redacted strings. */
function checkpointList(raw, field, workspace) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw)) {
        throw new Error(`work_checkpoint.${field} must be a list of non-empty strings`);
    }
    if (raw.length > MAX_CHECKPOINT_ITEMS) {
        throw new Error(`work_checkpoint.${field} must list at most ${MAX_CHECKPOINT_ITEMS} items`);
    }
    return raw.map((item) => {
        if (typeof item !== 'string' || item.trim() === '') {
            throw new Error(`work_checkpoint.${field} must be a list of non-empty strings`);
        }
        return bound(redact(item.trim(), workspace), MAX_CHECKPOINT_ITEM_CHARS);
    });
}
/** Validate one `work_checkpoint` argument object; every rejection names its field. */
function parseCheckpointInput(raw, workspace) {
    if (!isRecord(raw))
        throw new Error('work_checkpoint arguments must be an object');
    const allowed = new Set([
        'outcome',
        'verified',
        'remaining',
        'parallel',
        'serialReason',
        'bottleneck',
        'next',
        'speedup',
    ]);
    for (const key of Object.keys(raw)) {
        if (!allowed.has(key))
            throw new Error(`work_checkpoint: unknown field "${key}"`);
    }
    if (raw.outcome !== 'done' && raw.outcome !== 'continue') {
        throw new Error('work_checkpoint.outcome must be "done" or "continue"');
    }
    if (raw.parallel !== undefined && typeof raw.parallel !== 'boolean') {
        throw new Error('work_checkpoint.parallel must be a boolean');
    }
    const parallel = raw.parallel === true;
    const next = checkpointText(raw.next, 'next', MAX_CHECKPOINT_NEXT_CHARS, workspace);
    if (next === undefined)
        throw new Error('work_checkpoint.next must be a non-empty string');
    const serialReason = checkpointText(raw.serialReason, 'serialReason', MAX_CHECKPOINT_SERIAL_CHARS, workspace);
    if (raw.outcome === 'continue' && !parallel && serialReason === undefined) {
        throw new Error('work_checkpoint.serialReason is required when outcome is "continue" and parallel is false');
    }
    const bottleneck = checkpointText(raw.bottleneck, 'bottleneck', MAX_CHECKPOINT_BOTTLENECK_CHARS, workspace);
    if (raw.outcome === 'continue' && bottleneck === undefined) {
        throw new Error('work_checkpoint.bottleneck is required when outcome is "continue"');
    }
    const speedup = checkpointText(raw.speedup, 'speedup', MAX_CHECKPOINT_SPEEDUP_CHARS, workspace);
    return {
        outcome: raw.outcome,
        verified: checkpointList(raw.verified, 'verified', workspace),
        remaining: checkpointList(raw.remaining, 'remaining', workspace),
        parallel,
        ...(serialReason === undefined ? {} : { serialReason }),
        ...(bottleneck === undefined ? {} : { bottleneck }),
        next,
        ...(speedup === undefined ? {} : { speedup }),
    };
}
/** Output schema shared by the one tool: one rendered text result. */
const CHECKPOINT_OUTPUT_SCHEMA = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
};
/** Register the checkpoint tool; a host without a tool registry keeps running. */
function installCheckpointTool(ctx, stateFor) {
    const tools = optionalService(ctx, 'tools');
    if (tools === undefined || typeof tools.register !== 'function')
        return;
    tools.register({
        name: CHECKPOINT_TOOL,
        description: 'Record the work checkpoint decision at a substantial pause: outcome done or continue, verified facts, remaining items, parallel lanes or a serial reason, the current bottleneck (required for continue), the next action, and an optional speedup. The turn-close gate requires one successful call per substantial turn.',
        parameters: {
            type: 'object',
            properties: {
                outcome: {
                    type: 'string',
                    enum: ['done', 'continue'],
                    description: 'Whether the work is done or continues.',
                },
                verified: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Verified facts for this checkpoint.',
                },
                remaining: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Remaining work items.',
                },
                parallel: {
                    type: 'boolean',
                    description: 'Whether the remaining work has independent lanes; false needs a serialReason when outcome is continue.',
                },
                serialReason: {
                    type: 'string',
                    description: 'Why the remaining work must stay serial; required for continue with parallel false.',
                },
                bottleneck: {
                    type: 'string',
                    description: 'The current bottleneck and the next action that removes it; required for continue.',
                },
                next: { type: 'string', description: 'The immediate next action.' },
                speedup: { type: 'string', description: 'Optional speedup for the next turn.' },
            },
            required: ['outcome', 'next'],
            additionalProperties: false,
        },
        output: {
            schema: CHECKPOINT_OUTPUT_SCHEMA,
            render: (_args, value) => {
                const text = isRecord(value) && typeof value.text === 'string' ? value.text : '';
                return [{ type: 'text', text }];
            },
        },
        execute: async (args, exec) => {
            const agent = exec.agent;
            if (agent === undefined)
                throw new Error('work_checkpoint requires a calling agent');
            const workspace = workspaceFor(ctx, agent);
            const input = parseCheckpointInput(args, workspace);
            const turn = openTurnNumber(agent);
            if (turn === undefined)
                throw new Error('work_checkpoint: no open turn to record');
            const state = stateFor(agent);
            beginStepTurn(state, turn);
            state.checkpointStep = state.steps;
            const id = checkpointIdFor(agent.session.id, turn);
            const path = checkpointPathFor(workspace, agent.session.id, turn);
            const display = displayCheckpointPath(workspace, path);
            // Reuse the same record path for a repeated call in the turn.
            const written = await writeRecord(path, {
                version: 1,
                checkpoint: id,
                turn,
                outcome: input.outcome,
                verified: input.verified,
                remaining: input.remaining,
                parallel: input.parallel,
                ...(input.serialReason === undefined ? {} : { serialReason: input.serialReason }),
                ...(input.bottleneck === undefined ? {} : { bottleneck: input.bottleneck }),
                next: input.next,
                ...(input.speedup === undefined ? {} : { speedup: input.speedup }),
                time: new Date().toISOString(),
                // The persisted copy is bounded and redacted like every decision field;
                // the record path already hashed the original id.
                session: bound(redact(agent.session.id, workspace), MAX_CHECKPOINT_ITEM_CHARS),
            });
            const decision = `${input.outcome}; ${input.parallel ? 'parallel' : 'serial'}; ${input.verified.length} verified, ${input.remaining.length} remaining; bottleneck: ${input.bottleneck ?? 'none'}; next: ${input.next}`;
            const text = written
                ? `Work checkpoint ${id} recorded at ${display}. ${decision}`
                : `Work checkpoint ${id} could not write its local record at ${display}; the close gate still counts this checkpoint. ${decision}`;
            const output = { text: bound(text, MAX_CHECKPOINT_SUMMARY_CHARS) };
            return output;
        },
    });
}
/** Install the periodic mid-turn checkpoint trigger and the turn-close gates. */
function installCheckpointGate(ctx, config, stateFor) {
    // A running root turn gets one request at each step interval, never a wake.
    ctx.on('agent/pre-step', (payload, next) => {
        try {
            evaluateStep(payload.agent, payload.turn);
        }
        catch {
            // An observer never fails a step.
        }
        return next();
    });
    // The committed log does not carry a shell result's structured exit state, so
    // observe it live and let the turn-close evidence read it back by call id.
    ctx.on('tools/result', (exec, result) => {
        try {
            if (exec.agent === undefined || !SHELL_TOOLS.includes(exec.name))
                return;
            const state = stateFor(exec.agent);
            if (state.shellOutcomes.size >= MAX_SHELL_OUTCOMES) {
                const oldest = state.shellOutcomes.keys().next();
                if (oldest.done !== true)
                    state.shellOutcomes.delete(oldest.value);
            }
            state.shellOutcomes.set(String(exec.callId), shellOutcomeOf(result));
        }
        catch {
            // Observation must never affect the turn.
        }
    });
    ctx.on('agent/turn-stopping', async (payload) => {
        try {
            evaluate(payload.agent, payload.turn);
        }
        catch {
            // Fail open: an internal state error must never fail a turn.
        }
    });
    /** Steer one non-waking message; a disposed agent cannot be steered. */
    function steer(agent, text, summary) {
        try {
            agent.steer(createNotice(text, summary, config.maxMessageChars));
        }
        catch {
            // A disposed agent cannot be steered; the turn is already over.
        }
    }
    /** Whether the latest checkpoint is younger than one step interval. */
    function freshCheckpoint(evidence, state) {
        // A checkpoint this process never observed at a known step cannot be proven
        // fresh; the close asks for one it can verify instead of trusting an age.
        if (evidence.checkpoint === undefined || state.checkpointStep === undefined)
            return false;
        return state.steps - state.checkpointStep < config.stepInterval;
    }
    /** One pre-step boundary: count it and steer at the interval, never at a wake. */
    function evaluateStep(agent, turn) {
        if (!isRootAgent(agent))
            return;
        const state = stateFor(agent);
        beginStepTurn(state, turn);
        state.steps += 1;
        // Anchored to the turn start, the latest checkpoint, or the last steer, so
        // an ignored request repeats only once per interval.
        const since = Math.max(state.checkpointStep ?? 0, state.steerStep);
        if (state.steps - since < config.stepInterval)
            return;
        const workspace = workspaceFor(ctx, agent);
        const evidence = checkpointEvidence(agent, turn, workspace, state.shellOutcomes);
        if (evidence.lastTool === 'ask_user_question')
            return;
        if (config.requireWrite && evidence.written.length === 0 && evidence.workers.length === 0) {
            return;
        }
        state.steerStep = state.steps;
        steer(agent, composeCheckpointRequest(evidence, workspace, config.maxMessageChars, {
            step: state.steps,
            interval: config.stepInterval,
        }), 'goal-continuity: periodic work checkpoint');
    }
    /** One close decision: steer one more step, or allow the close. */
    function evaluate(agent, turn) {
        if (!isRootAgent(agent))
            return;
        const state = stateFor(agent);
        const budget = state.checkpointTurn;
        if (budget === undefined || budget.turn !== turn || budget.unchecked)
            return;
        const workspace = workspaceFor(ctx, agent);
        const evidence = checkpointEvidence(agent, turn, workspace, state.shellOutcomes);
        if (freshCheckpoint(evidence, state)) {
            const decision = checkpointDecision(evidence);
            // A logged successful call is a checkpoint even if its arguments are
            // unreadable; only a readable parallel decision still gates the close.
            if (decision === undefined)
                return;
            if (!config.enforceParallel || decision.outcome === 'done' || !decision.parallel)
                return;
            const id = checkpointIdFor(agent.session.id, turn);
            if (taggedWorkerStarted(evidence, id))
                return;
            if (!workerToolVisible(ctx, agent))
                return;
            refuse(agent, budget, composeParallelRequest(id, config.maxMessageChars), `goal-continuity: work checkpoint ${id} needs a parallel worker`, id);
            return;
        }
        if (!checkpointRequired(evidence, config))
            return;
        refuse(agent, budget, composeCheckpointRequest(evidence, workspace, config.maxMessageChars), 'goal-continuity: work checkpoint required');
    }
    /** Steer once per refusal, then allow the close with one UNCHECKED notice. */
    function refuse(agent, budget, text, summary, id) {
        if (budget.refusals >= config.maxBlocks) {
            budget.unchecked = true;
            const detail = id === undefined
                ? 'this turn closed without a successful work_checkpoint after the refusal cap'
                : `this turn closed without a tagged worker start for ${id} after the refusal cap`;
            deliverNotice(agent, `Work checkpoint UNCHECKED: ${detail} (${config.maxBlocks} refusals). This is not a pass; the next substantial turn must still checkpoint its work.`, 'goal-continuity: work checkpoint UNCHECKED');
            return;
        }
        budget.refusals += 1;
        steer(agent, text, summary);
    }
}
/**
 * Keep the reviewer preset out of the human mode roster. The Web client builds
 * its picker from `agentPresets/list`, while the gate starts the reviewer
 * through the registry's `retain`/`resolve` path, so filtering this one Remote
 * projection hides the mode without touching the mounted composition.
 *
 * shortcut: this wraps the registry's dynamic Remote method; upgrade when DSH
 * ships a hidden-preset flag. A changed dispatch only reveals the preset again.
 */
function installReviewerPresetHiding(ctx) {
    ctx.inject(['agentPresets'], (scope) => {
        const service = scope.get('agentPresets');
        const original = service?.remoteExportList;
        if (service === undefined || typeof original !== 'function')
            return;
        service.remoteExportList = async function () {
            const roster = await original.call(this);
            return {
                ...roster,
                presets: roster.presets.filter((preset) => preset.id !== REVIEWER_PRESET_ID),
            };
        };
        scope.effect(() => () => {
            service.remoteExportList = original;
        });
    });
}
/**
 * Install the continuity supervisor, the block-review gate, and the work
 * checkpoint. The configuration is validated at load, so a bad profile fails
 * loudly; supervision itself fails open and both gates fail open.
 */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    if (!resolved.enabled)
        return;
    if (resolved.blockReview.enabled) {
        installReviewerScope(ctx, resolved.blockReview.reviewerPreset);
    }
    installBlockReview(ctx, resolved.blockReview);
    installReviewerPresetHiding(ctx);
    const mountedAt = Date.now();
    const states = new WeakMap();
    if (resolved.checkpoint.enabled) {
        installCheckpointTool(ctx, stateFor);
        installCheckpointGate(ctx, resolved.checkpoint, stateFor);
    }
    function stateFor(agent) {
        let state = states.get(agent);
        if (state === undefined) {
            state = {
                turn: null,
                goalRound: false,
                resumes: 0,
                extensions: new Map(),
                suppression: null,
                restartPending: false,
                observed: false,
                pending: false,
                cause: null,
                refusal: null,
                checkpointTurn: undefined,
                stepTurn: undefined,
                steps: 0,
                checkpointStep: undefined,
                steerStep: 0,
                shellOutcomes: new Map(),
            };
            states.set(agent, state);
        }
        return state;
    }
    /** Read the current goal without letting a goal-domain failure reach the session. */
    function readGoal(agent) {
        try {
            return ctx.goals.get(agent);
        }
        catch {
            return undefined;
        }
    }
    /** Queue one reconciliation after the current dispatch settles. */
    function schedule(agent, state, cause) {
        if (cause !== undefined && (isSpecificCause(cause) || state.cause === null)) {
            state.cause = cause;
        }
        if (state.pending)
            return;
        state.pending = true;
        queueMicrotask(() => {
            state.pending = false;
            if (states.get(agent) !== state)
                return;
            const next = state.cause;
            state.cause = null;
            try {
                reconcile(agent, state, next);
            }
            catch {
                // Fail open: supervision must never fail a session.
            }
        });
    }
    /** Disarm an armed active goal before the driver's idle pause can see it. */
    function preventPause(agent) {
        const goal = readGoal(agent);
        if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed')
            return;
        try {
            ctx.goals.disarm(agent);
        }
        catch {
            // Fail open: a rejected disarm leaves the driver's pause in place.
        }
    }
    /** Resume once, retrying once on a stale revision. */
    function resumeWithRetry(agent, goal) {
        try {
            return ctx.goals.resume(agent, goalRef(goal));
        }
        catch (error) {
            if (!isStale(error))
                return undefined;
            const current = readGoal(agent);
            if (current === undefined)
                return undefined;
            if (current.phase === 'active') {
                if (current.activation !== 'disarmed')
                    return undefined;
            }
            else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
                return undefined;
            }
            if (current.roundsStarted >= current.maxGoalRounds)
                return undefined;
            try {
                return ctx.goals.resume(agent, goalRef(current));
            }
            catch {
                return undefined;
            }
        }
    }
    /** Resume and deliver exactly one notice, or report why no resume happened. */
    function resumeAndNotify(agent, state, goal, cause, extension) {
        if (state.resumes >= resolved.maxSessionResumes)
            return 'exhausted';
        const resumed = resumeWithRetry(agent, goal);
        if (resumed === undefined)
            return 'failed';
        state.resumes += 1;
        const remaining = resolved.maxSessionResumes - state.resumes;
        const action = extension === undefined
            ? `resumed the goal after ${causeLabel(cause)}`
            : `extended the round cap from ${extension.from} to ${extension.to} (extension ${extension.used} of ${resolved.maxRoundExtensions}) and resumed the goal after ${causeLabel(cause)}`;
        deliverNotice(agent, `Goal continuity ${action}. Automatic resume ${state.resumes} of ${resolved.maxSessionResumes} for this session; ${remaining} remain. Next: continue the current objective.`, `goal-continuity: ${extension === undefined ? 'resumed' : 'extended and resumed'} after ${causeLabel(cause)}`);
        return 'resumed';
    }
    /** Edit the round cap, retrying once on a stale revision. */
    function editCap(agent, goal, expected) {
        const attempt = (current) => {
            if (current.roundsStarted < current.maxGoalRounds)
                return { kind: 'resumable', goal: current };
            const cap = current.maxGoalRounds + resolved.roundExtension;
            if (cap > resolved.hardMaxGoalRounds)
                return { kind: 'unavailable' };
            try {
                return {
                    kind: 'edited',
                    goal: ctx.goals.edit(agent, goalRef(current), { maxGoalRounds: cap }),
                };
            }
            catch {
                return { kind: 'failed' };
            }
        };
        if (goal.roundsStarted < goal.maxGoalRounds)
            return { kind: 'resumable', goal };
        const cap = goal.maxGoalRounds + resolved.roundExtension;
        if (cap > resolved.hardMaxGoalRounds)
            return { kind: 'unavailable' };
        try {
            return { kind: 'edited', goal: ctx.goals.edit(agent, goalRef(goal), { maxGoalRounds: cap }) };
        }
        catch (error) {
            if (!isStale(error))
                return { kind: 'failed' };
            const current = readGoal(agent);
            if (current === undefined)
                return { kind: 'failed' };
            if (expected === 'active') {
                if (current.phase !== 'active' || current.activation !== 'disarmed') {
                    return { kind: 'failed' };
                }
            }
            else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
                return { kind: 'failed' };
            }
            return attempt(current);
        }
    }
    /** Explain a resume that failed after an automatic cap decision. */
    function notifyResumeFailure(agent, goal, from) {
        const action = from === undefined
            ? 'could not resume the goal automatically'
            : `extended the round cap from ${from} to ${goal.maxGoalRounds} but could not resume the goal automatically`;
        deliverNotice(agent, `Goal continuity ${action}. Next: review the goal and resume with /goal resume.`, 'goal-continuity: resume failed');
    }
    /** Record a terminal refusal: block an active goal where allowed, keep a native block. */
    function terminate(agent, state, goal, cause, detail, nextAction) {
        const refusal = `${goal.id}:${goal.revision}`;
        if (goal.phase === 'blocked' && state.refusal === refusal)
            return;
        const remaining = resolved.maxSessionResumes - state.resumes;
        const budget = `Automatic resumes used ${state.resumes} of ${resolved.maxSessionResumes} for this session (${remaining} remain).`;
        const message = bound(`Goal continuity stopped automatic continuation after ${causeLabel(cause)}: ${detail}. ${budget} Next: ${nextAction}.`, BLOCK_MESSAGE_MAX_CHARS);
        if (goal.phase === 'active') {
            try {
                ctx.goals.block(agent, goalRef(goal), { code: 'continuity-stopped', message });
            }
            catch (error) {
                if (!isStale(error))
                    return;
                const current = readGoal(agent);
                if (current === undefined || current.phase !== 'active')
                    return;
                try {
                    ctx.goals.block(agent, goalRef(current), { code: 'continuity-stopped', message });
                }
                catch {
                    return;
                }
            }
        }
        else if (goal.phase !== 'blocked') {
            // A user pause or completion is preserved and is not explained by a notice.
            return;
        }
        if (goal.phase === 'blocked')
            state.refusal = refusal;
        deliverNotice(agent, message, `goal-continuity: stopped after ${causeLabel(cause)}`);
    }
    /** Refuse an automatic resume whose session budget is spent. */
    function stopForBudget(agent, state, goal, cause) {
        terminate(agent, state, goal, cause, 'the automatic resume budget is exhausted', 'resume manually with /goal resume after fixing the blocker, or pause with /goal pause');
    }
    /** Extend until the cap covers the admitted rounds, or stop visibly. */
    function extendToCapacity(agent, state, goal, expected, cause) {
        const from = goal.maxGoalRounds;
        let current = goal;
        let used = state.extensions.get(goal.id) ?? 0;
        let extended = 0;
        while (current.roundsStarted >= current.maxGoalRounds) {
            if (used >= resolved.maxRoundExtensions) {
                terminate(agent, state, current, cause, `the round cap (${current.maxGoalRounds}) still does not cover the ${current.roundsStarted} rounds already started after ${used} of ${resolved.maxRoundExtensions} extensions`, 'raise the goal round cap with the goal tool, then resume with /goal resume');
                return undefined;
            }
            const cap = editCap(agent, current, expected);
            if (cap.kind === 'failed') {
                if (extended > 0) {
                    terminate(agent, state, current, cause, `the round cap was extended from ${from} to ${current.maxGoalRounds} but a further extension failed`, 'review the goal and resume with /goal resume');
                }
                else {
                    notifyResumeFailure(agent, current);
                }
                return undefined;
            }
            if (cap.kind === 'unavailable') {
                terminate(agent, state, current, cause, `the round cap (${current.maxGoalRounds}) is exhausted and the hard cap (${resolved.hardMaxGoalRounds}) leaves no extension room`, 'raise the goal round cap with the goal tool, then resume with /goal resume');
                return undefined;
            }
            if (cap.kind === 'resumable') {
                current = cap.goal;
                break;
            }
            used += 1;
            extended += 1;
            state.extensions.set(goal.id, used);
            current = cap.goal;
        }
        return { goal: current, from, used, extended };
    }
    /** Extend the cap of an active goal at its limit, then resume, or refuse visibly. */
    function continueAtCap(agent, state, goal, cause) {
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, cause);
            return;
        }
        if (goal.roundsStarted < goal.maxGoalRounds) {
            const result = resumeAndNotify(agent, state, goal, cause);
            if (result === 'exhausted')
                stopForBudget(agent, state, goal, cause);
            else if (result === 'failed')
                notifyResumeFailure(agent, goal);
            return;
        }
        const outcome = extendToCapacity(agent, state, goal, 'active', cause);
        if (outcome === undefined)
            return;
        const result = resumeAndNotify(agent, state, outcome.goal, cause, outcome.extended > 0
            ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
            : undefined);
        if (result === 'exhausted')
            stopForBudget(agent, state, outcome.goal, cause);
        else if (result === 'failed') {
            if (outcome.extended > 0) {
                terminate(agent, state, outcome.goal, cause, `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`, 'review the goal and resume with /goal resume');
            }
            else {
                notifyResumeFailure(agent, outcome.goal);
            }
        }
    }
    /** Extend a goal blocked at the round limit, or keep the native block and explain. */
    function extendBlocked(agent, state, goal) {
        if (state.suppression !== null) {
            if (state.suppression.terminal) {
                terminate(agent, state, goal, state.suppression.cause, state.suppression.detail, 'resume manually with /goal resume after fixing the blocker');
            }
            return;
        }
        if (goal.roundsStarted < goal.maxGoalRounds) {
            // A previous extension is already in place; resume without extending again.
            const result = resumeAndNotify(agent, state, goal, 'round-limit');
            if (result === 'exhausted')
                stopForBudget(agent, state, goal, 'round-limit');
            else if (result === 'failed')
                notifyResumeFailure(agent, goal);
            return;
        }
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, 'round-limit');
            return;
        }
        const outcome = extendToCapacity(agent, state, goal, 'blocked', 'round-limit');
        if (outcome === undefined)
            return;
        const result = resumeAndNotify(agent, state, outcome.goal, 'round-limit', outcome.extended > 0
            ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
            : undefined);
        if (result === 'exhausted')
            stopForBudget(agent, state, outcome.goal, 'round-limit');
        else if (result === 'failed') {
            if (outcome.extended > 0) {
                terminate(agent, state, outcome.goal, 'round-limit', `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`, 'review the goal and resume with /goal resume');
            }
            else {
                notifyResumeFailure(agent, outcome.goal);
            }
        }
    }
    /** One deferred decision for one settled agent. */
    function reconcile(agent, state, cause) {
        if (!isRootAgent(agent))
            return;
        const restart = state.restartPending;
        state.restartPending = false;
        const goal = readGoal(agent);
        if (goal === undefined)
            return;
        if (goal.phase === 'blocked') {
            if (goal.blockedReason?.code === 'round-limit')
                extendBlocked(agent, state, goal);
            return;
        }
        if (goal.phase !== 'active')
            return;
        if (state.suppression?.terminal === true) {
            terminate(agent, state, goal, state.suppression.cause, state.suppression.detail, 'resume manually with /goal resume after fixing the blocker, or pause with /goal pause');
            return;
        }
        if (goal.activation !== 'disarmed')
            return;
        if (restart && !resolved.resumeAfterRestart)
            return;
        if (state.suppression !== null)
            return;
        const named = cause ?? 'in-process-disarm';
        if (state.resumes >= resolved.maxSessionResumes) {
            stopForBudget(agent, state, goal, named);
            return;
        }
        if (goal.roundsStarted >= goal.maxGoalRounds) {
            continueAtCap(agent, state, goal, named);
            return;
        }
        resumeAndNotify(agent, state, goal, named);
    }
    /** Track a root agent's first observation and defer its restart decision. */
    function observeAgent(agent) {
        if (!isRootAgent(agent))
            return;
        const state = stateFor(agent);
        const createdAt = agent.session.header.createdAt;
        state.restartPending = Number.isSafeInteger(createdAt) ? createdAt < mountedAt : !state.observed;
        state.observed = true;
        schedule(agent, state, 'restart');
    }
    function handleTurnEnd(agent, state, reason) {
        const goalRound = state.goalRound;
        state.goalRound = false;
        state.checkpointTurn = undefined;
        const hook = hookCause(reason);
        if (hook !== undefined) {
            const cause = hook === 'reset' ? 'reset' : hook === 'final' ? 'final-hook' : 'unknown-hook';
            if (hook !== 'reset') {
                state.suppression = {
                    cause,
                    terminal: true,
                    detail: hook === 'final' ? 'the loop guard final stop' : 'an unrecognized hook cancellation',
                };
            }
            if (goalRound)
                preventPause(agent);
            schedule(agent, state, cause);
            return;
        }
        if (reason.kind === 'aborted') {
            if (reason.reason.kind === 'user') {
                if (goalRound) {
                    state.suppression = {
                        cause: 'goal-round-stop',
                        terminal: false,
                        detail: 'your Stop during a goal round',
                    };
                    schedule(agent, state, 'goal-round-stop');
                }
                else if (resolved.resumeAfterUserStop === 'never') {
                    state.suppression = {
                        cause: 'user-stop-never',
                        terminal: false,
                        detail: 'your Stop on a turn that was not a goal round',
                    };
                    const goal = readGoal(agent);
                    if (goal !== undefined && goal.phase === 'active') {
                        deliverNotice(agent, 'Goal continuity suppressed automatic continuation after your Stop on a turn that was not a goal round. Next: send a message to clear the suppression, or pause the goal with /goal pause to stop it explicitly.', 'goal-continuity: suppressed after user Stop');
                    }
                    schedule(agent, state, 'user-stop-never');
                }
                else {
                    schedule(agent, state, 'non-goal-stop');
                }
                return;
            }
            state.suppression = {
                cause: 'parent-stop',
                terminal: false,
                detail: 'the turn was cancelled by its parent',
            };
            return;
        }
        if (reason.kind === 'completed') {
            schedule(agent, state);
            return;
        }
        if (reason.kind === 'max-tokens') {
            state.suppression = {
                cause: 'max-tokens',
                terminal: true,
                detail: 'the turn reached the token limit',
            };
            schedule(agent, state, 'max-tokens');
            return;
        }
        if (reason.kind === 'error') {
            state.suppression = {
                cause: 'agent-error',
                terminal: true,
                detail: 'the turn failed with an error',
            };
            schedule(agent, state, 'agent-error');
        }
    }
    function handleSessionEvent(session, event) {
        const agent = ctx.agents.get(session.id);
        if (agent === undefined || agent.session !== session || !isRootAgent(agent))
            return;
        const state = states.get(agent);
        if (state === undefined)
            return;
        switch (event.type) {
            case 'turn/start':
                state.turn = event.data.turn;
                state.goalRound = false;
                state.checkpointTurn = { turn: event.data.turn, refusals: 0, unchecked: false };
                beginStepTurn(state, event.data.turn);
                return;
            case 'user/message':
                if (event.data.source.kind === 'goal') {
                    state.goalRound = true;
                }
                else if (event.data.source.kind === 'user') {
                    state.suppression = null;
                    state.cause = null;
                }
                return;
            case 'turn/end':
                handleTurnEnd(agent, state, event.data.reason);
                return;
            default:
                return;
        }
    }
    for (const agent of ctx.agents.list())
        observeAgent(agent);
    ctx.on('session/event', (session, event) => {
        try {
            handleSessionEvent(session, event);
        }
        catch {
            // Fail open: supervision must never fail a session.
        }
    });
    ctx.on('goal/activation-changed', (payload) => {
        try {
            if (payload.goal === undefined || payload.goal.activation !== 'disarmed')
                return;
            const agent = ctx.agents.get(payload.sessionId);
            if (agent === undefined || agent.session.id !== payload.sessionId || !isRootAgent(agent)) {
                return;
            }
            const state = states.get(agent);
            if (state !== undefined)
                schedule(agent, state, 'in-process-disarm');
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('goal/changed', ({ agent, change }) => {
        try {
            if (!isRootAgent(agent))
                return;
            const state = states.get(agent);
            if (state === undefined)
                return;
            if (change.operation === 'pause') {
                state.suppression = { cause: 'user-pause', terminal: false, detail: 'the goal is paused' };
                return;
            }
            if (change.operation === 'complete') {
                state.suppression = {
                    cause: 'user-complete',
                    terminal: false,
                    detail: 'the goal is complete',
                };
                return;
            }
            if (change.operation === 'clear') {
                state.suppression = { cause: 'user-clear', terminal: false, detail: 'the goal was cleared' };
                state.extensions.clear();
                return;
            }
            if (change.operation === 'block') {
                if (change.goal?.blockedReason?.code === 'round-limit') {
                    schedule(agent, state, 'round-limit');
                }
                else if (change.goal?.blockedReason?.code === 'model-reported') {
                    state.suppression = {
                        cause: 'model-reported',
                        terminal: false,
                        detail: 'the model reported a blocker',
                    };
                }
            }
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('agent/error', ({ agent }) => {
        try {
            if (!isRootAgent(agent))
                return;
            const state = states.get(agent);
            if (state === undefined)
                return;
            state.suppression = {
                cause: 'agent-error',
                terminal: true,
                detail: 'an agent error stopped the session',
            };
            schedule(agent, state, 'agent-error');
        }
        catch {
            // Fail open.
        }
    });
    ctx.on('agent/created', ({ agent }) => {
        observeAgent(agent);
        return undefined;
    });
    ctx.on('agent/disposed', ({ agent }) => {
        states.delete(agent);
    });
}
