import { parseArchiveCommand } from './command-parse.js';
const MAX_TEXT = 1200;
function bounded(text) {
    return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}
function confirmed(asked) {
    return asked.timedOut !== true && (asked.answer ?? '').trim().toLowerCase() === 'yes';
}
async function confirm(host, question) {
    if (host.questions === undefined)
        return false;
    try {
        return confirmed(await host.questions.ask({ question, accepted: ['yes'], timeoutAction: 'cancel' }));
    }
    catch {
        return false;
    }
}
/**
 * Run one `/workflows` command line. Installation and adoption ask the user
 * first; a non-affirmative answer writes nothing.
 */
export async function runWorkflowCommand(input, host) {
    const trimmed = input.trim();
    const [verb, ...rest] = trimmed.split(/\s+/u);
    const action = (verb ?? '').toLowerCase();
    if (action === '' || action === '/workflows') {
        return { kind: 'view', text: host.openView() };
    }
    if (action === 'status') {
        return { kind: 'result', text: bounded(await host.status()) };
    }
    if (action === 'run') {
        const id = rest[0];
        if (id === undefined || rest.length !== 1) {
            return { kind: 'error', text: 'usage: /workflows run <definitionId>' };
        }
        try {
            const started = await host.run(id);
            return { kind: 'result', text: `run ${started.runId} started at step "${started.firstStep}"` };
        }
        catch (error) {
            return {
                kind: 'error',
                text: bounded(String(error instanceof Error ? error.message : error)),
            };
        }
    }
    if (action === 'resume') {
        const runId = rest[0];
        if (runId === undefined || rest.length !== 1) {
            return { kind: 'error', text: 'usage: /workflows resume <runId>' };
        }
        try {
            const resumed = await host.resume(runId);
            return { kind: 'result', text: `run ${runId} resumed at step "${resumed.stepId}"` };
        }
        catch (error) {
            return {
                kind: 'error',
                text: bounded(String(error instanceof Error ? error.message : error)),
            };
        }
    }
    if (action === 'install') {
        const path = rest[0];
        if (path === undefined || rest.length !== 1) {
            return { kind: 'error', text: 'usage: /workflows install <path>' };
        }
        if (!(await confirm(host, `Install and approve the definition at "${path}"?`))) {
            return { kind: 'error', text: 'installation was not confirmed; nothing was installed' };
        }
        try {
            const installed = await host.install(path);
            return { kind: 'result', text: `definition "${installed.id}" installed and approved` };
        }
        catch (error) {
            return {
                kind: 'error',
                text: bounded(String(error instanceof Error ? error.message : error)),
            };
        }
    }
    if (action === 'adopt') {
        const name = rest[0];
        if (name === undefined || rest.length !== 1) {
            return { kind: 'error', text: 'usage: /workflows adopt <name>' };
        }
        try {
            const adopted = await host.adopt(name);
            return adopted.ok
                ? { kind: 'result', text: `change "${name}" adopted` }
                : { kind: 'error', text: bounded(adopted.reason ?? 'the adoption was refused') };
        }
        catch (error) {
            return {
                kind: 'error',
                text: bounded(String(error instanceof Error ? error.message : error)),
            };
        }
    }
    return {
        kind: 'error',
        text: 'usage: /workflows [run <id> | resume <runId> | install <path> | adopt <name> | status]',
    };
}
/** A display-only archive parse seam used by the archive gate tests. */
export function isArchiveMove(command) {
    return parseArchiveCommand(command)?.kind === 'archive';
}
