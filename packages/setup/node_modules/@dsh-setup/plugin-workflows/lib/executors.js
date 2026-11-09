import { randomUUID } from 'node:crypto';
import { CHANGE_NAME } from './command-parse.js';
import { resultSchemaShapeError, } from './definitions.js';
import { hostToolName, resolveEvidenceText, toolNameMatches, } from './evidence.js';
import { requestStep, setRunStatus, settleStep } from './runs.js';
import { renderMainSteer } from './steer.js';
/**
 * The `main` executor. It steers the root agent and never completes a step
 * itself: only a passing evidence check settles the step, so a model's text
 * claim cannot close it. A re-request happens only on a later turn stop and is
 * bounded by the step's attempt cap.
 */
export const DEFAULT_MAIN_ATTEMPTS = 3;
/** The largest human question the host will ask. */
export const MAX_HUMAN_PROMPT = 2000;
/** How long a human question may stay open before the declared action applies. */
export const HUMAN_QUESTION_TIMEOUT_MS = 15 * 60_000;
/**
 * Adapt the DSH question service to the single-question confirm shape the
 * executors use. A stable id echoes the answer; timeout and cancellation map to
 * the declared action.
 */
export function adaptUserQuestions(raw, timeoutMs = HUMAN_QUESTION_TIMEOUT_MS) {
    let counter = 0;
    return {
        ask: async (request) => {
            counter += 1;
            const id = `workflows-${String(counter)}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const aborted = new Promise((_resolve, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('workflows-question-timeout')), { once: true });
            });
            try {
                const answered = await Promise.race([
                    raw.ask({
                        questions: [
                            {
                                id,
                                question: request.question,
                                options: request.accepted.map((label) => ({ label })),
                                multiSelect: false,
                            },
                        ],
                        signal: controller.signal,
                    }),
                    aborted,
                ]);
                const item = answered.answers.find((entry) => entry.id === id);
                if (item === undefined)
                    return {};
                const custom = item.custom?.trim() ?? '';
                if (custom !== '')
                    return { answer: custom };
                const selected = item.selected?.[0]?.trim() ?? '';
                return selected === '' ? {} : { answer: selected };
            }
            catch (error) {
                const code = typeof error === 'object' && error !== null && 'code' in error
                    ? String(error.code)
                    : '';
                if (controller.signal.aborted || code === 'ASK_TIMED_OUT')
                    return { timedOut: true };
                if (code === 'ASK_ABORTED' ||
                    code === 'ASK_CANCELLED' ||
                    (error instanceof Error && error.name === 'AbortError')) {
                    return { cancelled: true };
                }
                throw error;
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
/**
 * Request one main step for this turn stop. The same turn never steers twice;
 * the attempt cap ends the re-requests with a visible reason.
 */
export function requestMainStep(input) {
    const current = input.run.steps.find((step) => step.id === input.step.id);
    if (current === undefined) {
        return { steered: false, run: input.run, reason: `the run has no step "${input.step.id}"` };
    }
    if (current.state !== 'open' && current.state !== 'blocked') {
        return { steered: false, run: input.run, reason: `the step is already ${current.state}` };
    }
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAIN_ATTEMPTS;
    if ((current.attempts ?? 0) >= maxAttempts) {
        return {
            steered: false,
            run: input.run,
            reason: `step "${input.step.id}" reached its ${String(maxAttempts)}-request bound`,
        };
    }
    // A contract that cannot fit the bounded steer is refused before the step is
    // requested, so the run never holds an open step no steer can describe.
    let text;
    try {
        text = renderMainSteer({
            run: input.run,
            definition: input.definition,
            step: input.step,
            evidenceContext: input.evidenceContext,
        });
    }
    catch (error) {
        return {
            steered: false,
            run: input.run,
            reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
        };
    }
    const requested = requestStep(input.run, input.step.id, input.now);
    const run = {
        ...requested,
        steps: requested.steps.map((step) => step.id === input.step.id ? { ...step, lastTurn: input.turn } : step),
    };
    input.agent.steer(text);
    return { steered: true, run, text };
}
/**
 * Apply the verifier's result to a main step. A failed check leaves the step
 * exactly as it was; only a passing check settles it as done.
 */
export function settleMainStep(run, stepId, check, now = Date.now()) {
    if (!check.ok)
        return run;
    return settleStep(run, stepId, 'done', { at: now, evidence: check.evidence });
}
/** Resolve a dotted `var` path against the plain JSONLogic data. */
function lookup(data, path) {
    if (path === '')
        return data;
    let current = data;
    for (const key of path.split('.')) {
        if (current === null || current === undefined)
            return undefined;
        current = current[key];
    }
    return current;
}
function numeric(entry) {
    if (typeof entry === 'number')
        return entry;
    return typeof entry === 'string' ? Number.parseFloat(entry) : Number.NaN;
}
function lessThan(left, right) {
    return left < right;
}
function greaterThan(left, right) {
    return left > right;
}
function lessOrEqual(left, right) {
    return left <= right;
}
function greaterOrEqual(left, right) {
    return left >= right;
}
function truthy(value) {
    if (Array.isArray(value))
        return value.length > 0;
    return Boolean(value);
}
function operands(args) {
    return Array.isArray(args) ? args : [args];
}
/**
 * A bounded JSONLogic evaluator over plain data. It is data, not code: only a
 * small operator set is accepted, an unknown operator or malformed rule throws,
 * and the recursion depth is capped.
 */
/** Validate the whole rule tree, operand counts included, before any evaluation. */
export function validateJsonLogic(rule, depth = 0) {
    if (depth > 32)
        throw new Error('invalid JSONLogic: nesting is too deep');
    if (rule === null || typeof rule !== 'object')
        return;
    if (Array.isArray(rule)) {
        for (const entry of rule)
            validateJsonLogic(entry, depth + 1);
        return;
    }
    const keys = Object.keys(rule);
    if (keys.length !== 1)
        throw new Error('invalid JSONLogic: an operator object has one key');
    const operator = keys[0] ?? '';
    const args = operands(rule[operator]);
    const expect = (min, max) => {
        if (args.length < min || (max !== undefined && args.length > max)) {
            throw new Error(`invalid JSONLogic: "${operator}" expects ${max === undefined ? `at least ${String(min)}` : `${String(min)} to ${String(max)}`} operand(s)`);
        }
    };
    switch (operator) {
        case 'var':
            expect(1, 2);
            break;
        case '==':
        case '!=':
        case '===':
        case '!==':
        case 'in':
            expect(2, 2);
            break;
        case '<':
        case '<=':
        case '>':
        case '>=':
            expect(2, 3);
            break;
        case 'and':
        case 'or':
            expect(1);
            break;
        case '!':
            expect(1, 1);
            break;
        case '!!':
            expect(1, 1);
            break;
        case '+':
        case '*':
        case 'cat':
        case 'min':
        case 'max':
            expect(1);
            break;
        case '-':
            expect(1, 2);
            break;
        case '/':
            expect(2);
            break;
        case '%':
            expect(2, 2);
            break;
        case 'missing':
            expect(1);
            break;
        case 'some':
        case 'all':
        case 'none':
        case 'missing_some':
            expect(2, 2);
            break;
        case 'substr':
            expect(2, 3);
            break;
        case 'map':
        case 'filter':
            expect(2, 2);
            break;
        case 'reduce':
            expect(2, 3);
            break;
        case 'merge':
            expect(1);
            break;
        case 'if':
            expect(2);
            break;
        default:
            throw new Error(`invalid JSONLogic: unknown operator "${operator}"`);
    }
    for (const entry of args)
        validateJsonLogic(entry, depth + 1);
}
export function evaluateJsonLogic(rule, data, depth = 0) {
    if (depth > 32)
        throw new Error('invalid JSONLogic: nesting is too deep');
    if (depth === 0)
        validateJsonLogic(rule);
    if (rule === null || typeof rule !== 'object')
        return rule;
    if (Array.isArray(rule))
        return rule.map((entry) => evaluateJsonLogic(entry, data, depth + 1));
    const keys = Object.keys(rule);
    if (keys.length !== 1)
        throw new Error('invalid JSONLogic: an operator object has one key');
    const operator = keys[0] ?? '';
    const raw = rule[operator];
    const args = operands(raw);
    const value = (entry) => evaluateJsonLogic(entry, data, depth + 1);
    switch (operator) {
        case 'var': {
            const rawPath = typeof args[0] === 'string' || typeof args[0] === 'number'
                ? args[0]
                : args[0] === undefined
                    ? ''
                    : value(args[0]);
            const path = typeof rawPath === 'string' ? rawPath : typeof rawPath === 'number' ? String(rawPath) : '';
            const found = lookup(data, path);
            if (found !== undefined)
                return found;
            return args.length > 1 ? value(args[1]) : null;
        }
        case '==':
            // biome-ignore lint/suspicious/noDoubleEquals: JSONLogic equality is loose
            return value(args[0]) == value(args[1]);
        case '!=':
            // biome-ignore lint/suspicious/noDoubleEquals: JSONLogic equality is loose
            return value(args[0]) != value(args[1]);
        case '===':
            return value(args[0]) === value(args[1]);
        case '!==':
            return value(args[0]) !== value(args[1]);
        case '>': {
            const first = value(args[0]);
            const second = value(args[1]);
            if (args.length >= 3) {
                const third = value(args[2]);
                return greaterThan(first, second) && greaterThan(second, third);
            }
            return greaterThan(first, second);
        }
        case '>=': {
            const first = value(args[0]);
            const second = value(args[1]);
            if (args.length >= 3) {
                const third = value(args[2]);
                return greaterOrEqual(first, second) && greaterOrEqual(second, third);
            }
            return greaterOrEqual(first, second);
        }
        case '<': {
            const first = value(args[0]);
            const second = value(args[1]);
            if (args.length >= 3) {
                const third = value(args[2]);
                return lessThan(first, second) && lessThan(second, third);
            }
            return lessThan(first, second);
        }
        case '<=': {
            const first = value(args[0]);
            const second = value(args[1]);
            if (args.length >= 3) {
                const third = value(args[2]);
                return lessOrEqual(first, second) && lessOrEqual(second, third);
            }
            return lessOrEqual(first, second);
        }
        case 'and': {
            let last = true;
            for (const entry of args) {
                last = value(entry);
                if (!truthy(last))
                    return last;
            }
            return last;
        }
        case 'or': {
            let last = false;
            for (const entry of args) {
                last = value(entry);
                if (truthy(last))
                    return last;
            }
            return last;
        }
        case '!':
            return !truthy(value(args[0]));
        case '!!':
            return truthy(value(args[0]));
        case '+':
            return args.reduce((total, entry) => total + numeric(value(entry)), 0);
        case '-':
            return args.length === 1
                ? -Number(value(args[0]))
                : args
                    .slice(1)
                    .reduce((total, entry) => total - Number(value(entry)), Number(value(args[0])));
        case '*':
            return args.reduce((total, entry) => total * numeric(value(entry)), 1);
        case '/':
            return args
                .slice(1)
                .reduce((total, entry) => total / Number(value(entry)), Number(value(args[0])));
        case '%':
            return Number(value(args[0])) % Number(value(args[1]));
        case 'min':
            return Math.min(...args.map((entry) => Number(value(entry))));
        case 'max':
            return Math.max(...args.map((entry) => Number(value(entry))));
        case 'cat':
            return args.map((entry) => String(value(entry) ?? '')).join('');
        case 'missing': {
            const names = args.flatMap((entry) => {
                const evaluated = value(entry);
                return Array.isArray(evaluated) ? evaluated.map(String) : [String(evaluated)];
            });
            return names.filter((name) => {
                const found = lookup(data, name);
                return found === undefined || found === null || found === '';
            });
        }
        case 'in': {
            const needle = value(args[0]);
            const haystack = value(args[1]);
            if (Array.isArray(haystack))
                return haystack.includes(needle);
            if (typeof haystack === 'string') {
                return typeof needle === 'string' ? haystack.includes(needle) : false;
            }
            return false;
        }
        case 'some':
        case 'all':
        case 'none': {
            const collection = value(args[0]);
            const items = Array.isArray(collection) ? collection : [];
            const predicate = args[1];
            const results = items.map((entry) => truthy(evaluateJsonLogic(predicate, entry, depth + 1)));
            if (operator === 'some')
                return results.some(Boolean);
            if (operator === 'all')
                return results.length > 0 && results.every(Boolean);
            return !results.some(Boolean);
        }
        case 'substr': {
            const text = String(value(args[0]));
            const start = Number(value(args[1]));
            if (args.length < 3)
                return text.substr(start);
            const length = Number(value(args[2]));
            return length < 0
                ? text.slice(start, Math.max(start, text.length + length))
                : text.substr(start, length);
        }
        case 'map': {
            const collection = value(args[0]);
            return (Array.isArray(collection) ? collection : []).map((entry) => evaluateJsonLogic(args[1], entry, depth + 1));
        }
        case 'filter': {
            const collection = value(args[0]);
            return (Array.isArray(collection) ? collection : []).filter((entry) => truthy(evaluateJsonLogic(args[1], entry, depth + 1)));
        }
        case 'reduce': {
            const collection = value(args[0]);
            let accumulator = args.length >= 3 ? value(args[2]) : undefined;
            for (const entry of Array.isArray(collection) ? collection : []) {
                accumulator = evaluateJsonLogic(args[1], { current: entry, accumulator }, depth + 1);
            }
            return accumulator;
        }
        case 'merge':
            return args.flatMap((entry) => {
                const evaluated = value(entry);
                return Array.isArray(evaluated) ? evaluated : [evaluated];
            });
        case 'missing_some': {
            const minimum = Number(value(args[0]));
            const collection = value(args[1]);
            const names = (Array.isArray(collection) ? collection : []).map(String);
            const missing = names.filter((name) => {
                const found = lookup(data, name);
                return found === undefined || found === null || found === '';
            });
            return names.length - missing.length >= minimum ? [] : missing;
        }
        case 'if': {
            for (let index = 0; index + 1 < args.length; index += 2) {
                if (truthy(value(args[index])))
                    return value(args[index + 1]);
            }
            return args.length % 2 === 1 ? value(args[args.length - 1]) : null;
        }
        default:
            throw new Error(`invalid JSONLogic: unknown operator "${operator}"`);
    }
}
function outgoingTargets(step) {
    const targets = [];
    if (step.next !== undefined && step.next !== 'end')
        targets.push(step.next);
    if (step.branch !== undefined) {
        if (step.branch.then !== 'end')
            targets.push(step.branch.then);
        if (step.branch.else !== 'end' && step.branch.else !== step.branch.then) {
            targets.push(step.branch.else);
        }
    }
    if (step.loop !== undefined && step.loop.next !== 'end')
        targets.push(step.loop.next);
    return targets;
}
function selectedPath(start, definition) {
    const path = [];
    const seen = new Set();
    let current = start;
    while (current !== undefined && current !== 'end' && !seen.has(current)) {
        seen.add(current);
        const found = definition.steps.find((entry) => entry.id === current);
        if (found === undefined)
            break;
        path.push(current);
        current = outgoingTargets(found)[0];
    }
    return path;
}
function reachableSteps(start, definition) {
    const seen = new Set();
    const queue = [start];
    while (queue.length > 0) {
        const id = queue.shift();
        if (id === undefined || id === 'end' || seen.has(id))
            continue;
        seen.add(id);
        const found = definition.steps.find((entry) => entry.id === id);
        if (found === undefined)
            continue;
        for (const next of outgoingTargets(found))
            queue.push(next);
    }
    return seen;
}
/** Evaluate a branch predicate and settle the step with the chosen edge. */
export function runBranchStep(input) {
    const spec = input.step.branch;
    if (spec === undefined) {
        return {
            run: setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: 'the branch step declares no branch',
            }), 'failed', input.now),
        };
    }
    try {
        validateJsonLogic(spec.predicate);
        const chosen = truthy(evaluateJsonLogic(spec.predicate, {
            context: input.values,
            steps: input.run.steps,
            evidence: input.run.steps.map((step) => step.evidence ?? null),
            trigger: input.run.trigger,
        }))
            ? spec.then
            : spec.else;
        let run = settleStep(input.run, input.step.id, 'done', { at: input.now });
        const skipped = chosen === spec.then ? spec.else : spec.then;
        if (skipped !== chosen && skipped !== input.step.id) {
            const selected = reachableSteps(chosen, input.definition);
            const rejected = new Set();
            const queue = [skipped];
            while (queue.length > 0) {
                const id = queue.shift();
                if (id === undefined || id === 'end' || id === chosen)
                    continue;
                if (selected.has(id) || rejected.has(id))
                    continue;
                rejected.add(id);
                const found = input.definition.steps.find((entry) => entry.id === id);
                if (found === undefined)
                    continue;
                for (const next of outgoingTargets(found))
                    queue.push(next);
            }
            for (const id of rejected) {
                if (run.steps.some((entry) => entry.id === id && entry.state === 'open')) {
                    run = settleStep(run, id, 'cancelled', {
                        at: input.now,
                        reason: 'not selected by the branch',
                    });
                }
            }
        }
        return {
            run: {
                ...run,
                nextStep: chosen === 'end' ? undefined : chosen,
                branchPath: chosen === 'end' ? [] : selectedPath(chosen, input.definition),
            },
            next: chosen,
        };
    }
    catch (error) {
        return {
            run: setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
            }), 'failed', input.now),
        };
    }
}
/** Iterate until the stop predicate holds or the declared cap is reached. */
export function runLoopStep(input) {
    const spec = input.step.loop;
    if (spec === undefined) {
        return {
            run: setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: 'the loop step declares no loop',
            }), 'failed', input.now),
        };
    }
    const source = spec.list === undefined ? undefined : input.values[spec.list];
    const iterations = Math.min(spec.maxIterations, Array.isArray(source) ? Math.max(1, source.length) : spec.maxIterations);
    try {
        validateJsonLogic(spec.stop);
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            const stop = truthy(evaluateJsonLogic(spec.stop, {
                context: input.values,
                steps: input.run.steps,
                evidence: input.run.steps.map((step) => step.evidence ?? null),
                trigger: input.run.trigger,
                iteration,
                item: Array.isArray(source) ? source[iteration] : undefined,
            }));
            if (stop) {
                const settled = settleStep(input.run, input.step.id, 'done', { at: input.now });
                return {
                    run: {
                        ...settled,
                        nextStep: spec.next === 'end' ? undefined : spec.next,
                        branchPath: spec.next === 'end' ? [] : selectedPath(spec.next, input.definition),
                    },
                    next: spec.next,
                };
            }
        }
    }
    catch (error) {
        return {
            run: setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
            }), 'failed', input.now),
        };
    }
    const cap = spec.cap ?? 'blocked';
    return {
        run: setRunStatus(settleStep(input.run, input.step.id, cap, {
            at: input.now,
            reason: `the loop reached its ${String(spec.maxIterations)}-iteration cap`,
        }), cap, input.now),
    };
}
/** Ask the user; only the declared answer completes the step. */
export async function runHumanStep(input) {
    const evidence = input.step.evidence;
    if (evidence === undefined || evidence.kind !== 'human') {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: 'the human step declares no accepted answer',
        }), 'failed', input.now);
    }
    const accepted = (Array.isArray(evidence.answer) ? evidence.answer : [evidence.answer]).map((answer) => answer.trim().toLowerCase());
    const prompt = resolveEvidenceText(input.step.prompt ?? '', input.evidenceContext);
    if (!prompt.ok) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `the question could not be resolved: ${prompt.failure.detail}`,
        }), 'failed', input.now);
    }
    if (prompt.text.length > MAX_HUMAN_PROMPT) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `the question is longer than ${String(MAX_HUMAN_PROMPT)} characters`,
        }), 'failed', input.now);
    }
    const timeoutAction = input.step.human?.timeoutAction ?? 'block';
    let asked;
    try {
        asked = await input.questions.ask({
            question: prompt.text,
            accepted,
            timeoutAction,
        });
    }
    catch (error) {
        const reason = `the question could not be asked: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`;
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', { at: input.now, reason }), 'failed', input.now);
    }
    if (asked.timedOut === true || asked.cancelled === true) {
        const state = timeoutAction === 'cancel' ? 'cancelled' : 'blocked';
        const reason = asked.timedOut === true ? 'the user question timed out' : 'the user question was cancelled';
        return setRunStatus(settleStep(input.run, input.step.id, state, { at: input.now, reason }), state, input.now);
    }
    const answer = asked.answer?.trim() ?? '';
    if (accepted.includes(answer.toLowerCase())) {
        return settleStep(input.run, input.step.id, 'done', {
            at: input.now,
            evidence: { kind: 'human', answer },
        });
    }
    return setRunStatus(settleStep(input.run, input.step.id, 'blocked', {
        at: input.now,
        reason: `the user answer "${answer.slice(0, 200)}" is not one of: ${accepted.join(', ')}`,
    }), 'blocked', input.now);
}
/** The host-owned call ids one run may dispatch; a model call is never owned. */
export class OwnedCalls {
    ids = new Set();
    add(callId) {
        this.ids.add(callId);
    }
    has(callId) {
        return this.ids.has(callId);
    }
    list() {
        return [...this.ids];
    }
}
function resolveToolValue(value, context) {
    if (typeof value === 'string') {
        for (const match of value.matchAll(/\{([a-zA-Z][a-zA-Z0-9-]*)\}/gu)) {
            if (match[1] !== 'name') {
                return {
                    ok: false,
                    detail: `unsupported placeholder "{${match[1] ?? ''}}" in a tool call`,
                };
            }
            const entry = context.values.name;
            if (typeof entry !== 'string' || !CHANGE_NAME.test(entry)) {
                return { ok: false, detail: `the name value "${String(entry)}" is not a change name` };
            }
        }
        const resolved = resolveEvidenceText(value, context);
        if (!resolved.ok)
            return { ok: false, detail: resolved.failure.detail };
        return { ok: true, value: resolved.text };
    }
    if (Array.isArray(value)) {
        const resolved = [];
        for (const entry of value) {
            const checked = resolveToolValue(entry, context);
            if (!checked.ok)
                return checked;
            resolved.push(checked.value);
        }
        return { ok: true, value: resolved };
    }
    if (typeof value === 'object' && value !== null) {
        const resolved = {};
        for (const [key, entry] of Object.entries(value)) {
            const checked = resolveToolValue(entry, context);
            if (!checked.ok)
                return checked;
            resolved[key] = checked.value;
        }
        return { ok: true, value: resolved };
    }
    return { ok: true, value };
}
function interpolateArguments(value, context) {
    const args = {};
    for (const [key, entry] of Object.entries(value)) {
        const resolved = resolveToolValue(entry, context);
        if (!resolved.ok)
            return { ok: false, detail: resolved.detail };
        args[key] = resolved.value;
    }
    return { ok: true, args };
}
/** The bounded host-generated call id; the owned set is registered before dispatch. */
export function newOwnedCallId(run, step) {
    return `owned-${run.id}-${step.id}-${randomUUID()}`;
}
/**
 * Run one tool step: allowlist, validated interpolation, an owned call id
 * registered before dispatch, and a step settled only by the dispatch result.
 */
export async function runToolStep(input) {
    const spec = input.step.tool;
    if (spec === undefined) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: 'the tool step declares no tool',
        }), 'failed', input.now);
    }
    const allowTools = input.definition.settings.allowTools ?? [];
    const hostName = hostToolName(spec.name);
    if (!allowTools.some((entry) => toolNameMatches(entry, spec.name) || toolNameMatches(entry, hostName))) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `tool "${spec.name}" is not on the definition allowlist`,
        }), 'failed', input.now);
    }
    const rawArguments = {};
    if (spec.command !== undefined) {
        const resolved = resolveToolValue(spec.command, input.evidenceContext);
        if (!resolved.ok) {
            return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: `the fixed command could not be resolved: ${resolved.detail}`,
            }), 'failed', input.now);
        }
        rawArguments.command = resolved.value;
    }
    if (spec.args !== undefined) {
        const resolved = interpolateArguments(spec.args, input.evidenceContext);
        if (!resolved.ok) {
            return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: `the tool arguments could not be resolved: ${resolved.detail}`,
            }), 'failed', input.now);
        }
        Object.assign(rawArguments, resolved.args);
    }
    const callId = newOwnedCallId(input.run, input.step);
    input.owned.add(callId);
    let outcome;
    try {
        outcome = await input.runner.call({ callId, name: hostName, arguments: rawArguments }, input.signal);
    }
    catch (error) {
        const reason = `the tool call failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`;
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason,
            evidence: { kind: 'tool', callId, detail: 'the tool call failed' },
        }), 'failed', input.now);
    }
    if (!outcome.ok) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `the tool call failed${outcome.error === undefined ? '' : `: ${outcome.error.slice(0, 200)}`}`,
            evidence: { kind: 'tool', callId, detail: 'the tool call failed' },
        }), 'failed', input.now);
    }
    return settleStep(input.run, input.step.id, 'done', {
        at: input.now,
        evidence: { kind: 'tool', callId, detail: `${spec.name} ok` },
    });
}
function typeOf(value) {
    if (value === null)
        return 'null';
    if (Array.isArray(value))
        return 'array';
    return typeof value;
}
/** Validate one value against the supported schema subset; returns an error. */
function jsonEqual(left, right) {
    if (Object.is(left, right))
        return true;
    const leftArray = Array.isArray(left);
    const rightArray = Array.isArray(right);
    if (leftArray !== rightArray)
        return false;
    if (leftArray && rightArray) {
        return (left.length === right.length && left.every((entry, index) => jsonEqual(entry, right[index])));
    }
    if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
        const leftRecord = left;
        const rightRecord = right;
        const keys = Object.keys(leftRecord);
        return (keys.length === Object.keys(rightRecord).length &&
            keys.every((key) => Object.hasOwn(rightRecord, key) && jsonEqual(leftRecord[key], rightRecord[key])));
    }
    return false;
}
export function validateResultSchema(schema, value, depth = 0) {
    if (depth > 8)
        return 'the result schema nests too deeply';
    const expected = schema.type;
    if (expected !== undefined) {
        const allowed = Array.isArray(expected) ? expected.map(String) : [String(expected)];
        const actual = typeOf(value);
        const match = allowed.some((entry) => entry === actual || (entry === 'integer' && actual === 'number' && Number.isInteger(value)));
        if (!match)
            return `expected ${allowed.join(' or ')}, got ${actual}`;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(entry, value))) {
        const shown = schema.enum.map((entry) => {
            try {
                return JSON.stringify(entry) ?? String(entry);
            }
            catch {
                return Object.prototype.toString.call(entry);
            }
        });
        return `the value is not one of: ${shown.join(', ')}`;
    }
    if (Object.hasOwn(schema, 'const') && !jsonEqual(schema.const, value)) {
        return 'the value does not match the declared const';
    }
    if (Array.isArray(schema.required) && typeOf(value) === 'object') {
        const record = value;
        for (const key of schema.required) {
            if (typeof key !== 'string' || !Object.hasOwn(record, key))
                return `missing required field "${String(key)}"`;
        }
    }
    if (typeOf(value) === 'object') {
        const record = value;
        const properties = schema.properties !== undefined &&
            typeof schema.properties === 'object' &&
            schema.properties !== null
            ? schema.properties
            : {};
        for (const [key, child] of Object.entries(properties)) {
            if (!Object.hasOwn(record, key) || typeof child !== 'object' || child === null)
                continue;
            const error = validateResultSchema(child, record[key], depth + 1);
            if (error !== undefined)
                return `${key}: ${error}`;
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(record)) {
                if (!Object.hasOwn(properties, key))
                    return `unexpected field "${key}"`;
            }
        }
    }
    if (schema.items !== undefined && Array.isArray(value)) {
        if (typeof schema.items !== 'object' || schema.items === null) {
            return 'the schema items are not an object';
        }
        for (const [index, entry] of value.entries()) {
            const error = validateResultSchema(schema.items, entry, depth + 1);
            if (error !== undefined)
                return `[${String(index)}]: ${error}`;
        }
    }
    return undefined;
}
/**
 * Run one subagent step: build the prompt, start exactly one child, validate
 * its result, and settle the step. A non-completion or schema mismatch marks
 * the step failed; there is no fallback to the main executor.
 */
export async function runSubagentStep(input) {
    const spec = input.step.subagent;
    if (spec === undefined || spec.schema === undefined) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: 'the subagent step has no provider or result schema',
        }), 'failed', input.now);
    }
    const shapeError = resultSchemaShapeError(spec.schema);
    if (shapeError !== undefined) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `the result schema is unsupported: ${shapeError}`,
        }), 'failed', input.now);
    }
    const promptText = resolveEvidenceText(input.step.prompt ?? '', input.evidenceContext);
    if (!promptText.ok) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: `the prompt could not be resolved: ${promptText.failure.detail}`,
        }), 'failed', input.now);
    }
    let result;
    try {
        result = await input.runner.run({
            provider: spec.provider,
            prompt: promptText.text,
            ...(spec.schema === undefined ? {} : { schema: spec.schema }),
            ...(spec.model === undefined ? {} : { model: spec.model }),
            ...(spec.reasoningEffort === undefined ? {} : { reasoningEffort: spec.reasoningEffort }),
        }, input.signal);
    }
    catch (error) {
        const reason = `the child could not run: ${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`;
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', { at: input.now, reason }), 'failed', input.now);
    }
    if (!result.completed) {
        const reason = `the child did not complete${result.error === undefined ? '' : `: ${result.error.slice(0, 200)}`}`;
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason,
            evidence: {
                kind: 'subagent',
                callId: result.childId,
                detail: 'the child did not complete',
            },
        }), 'failed', input.now);
    }
    if (result.result === undefined) {
        return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
            at: input.now,
            reason: 'the child completed without a result',
            evidence: {
                kind: 'subagent',
                callId: result.childId,
                detail: 'the child completed without a result',
            },
        }), 'failed', input.now);
    }
    if (spec.schema !== undefined) {
        const mismatch = validateResultSchema(spec.schema, result.result);
        if (mismatch !== undefined) {
            return setRunStatus(settleStep(input.run, input.step.id, 'failed', {
                at: input.now,
                reason: `the child result does not match the schema: ${mismatch.slice(0, 200)}`,
                failureClass: 'invalid-result',
                evidence: {
                    kind: 'subagent',
                    callId: result.childId,
                    detail: 'the child result did not match the schema',
                },
            }), 'failed', input.now);
        }
    }
    const settled = settleStep(input.run, input.step.id, 'done', {
        at: input.now,
        evidence: {
            kind: 'subagent',
            callId: result.childId,
            detail: 'schema-validated child result',
            result: result.result,
        },
    });
    return settled;
}
