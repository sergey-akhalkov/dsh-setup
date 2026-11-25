/** Configurable question foreground wait: derive the timed ask-user row of every preset. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
export const name = '@dsh-setup/plugin-question-timeout';
/**
 * The profile services read here. Without this declaration the row activates before the Host
 * config editor is up, finds no editor, and leaves every preset untimed.
 */
export const inject = ['configEditor', 'profileContext'];
const ASK_TOOL = 'tool-ask-user';
const PRESET_PREFIX = 'preset-';
const DEFAULT_TIMEOUT = 300;
const FILE = '.dsh-setup-question-timeout.json';
const LOGGER = 'dsh-setup-question-timeout';
/** Resolve options with their documented defaults. */
export function resolveOptions(config = {}) {
    const timeout = config.timeout;
    return {
        timed: config.timed ?? true,
        timeout: Number.isInteger(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT,
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Stable content hash of one preset config. */
export function configHash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Read the settings file; a missing or unreadable file yields the shipped defaults. */
export function readSettings(directory) {
    try {
        const parsed = JSON.parse(readFileSync(join(directory, FILE), 'utf8'));
        return isRecord(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
/** The exact file content a settings value serializes to. */
export function serializeSettings(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}
/** Replace the settings file atomically; a failed write leaves the previous record intact. */
export function writeSettings(directory, value) {
    const target = join(directory, FILE);
    const temporary = `${target}.tmp`;
    try {
        writeFileSync(temporary, serializeSettings(value));
        renameSync(temporary, target);
        return true;
    }
    catch {
        try {
            rmSync(temporary, { force: true });
        }
        catch {
            // Nothing left to clean up.
        }
        // The caller decides whether an edit may proceed without a durable record.
        return false;
    }
}
/** The child list with the ask-user row set for the options, or undefined when it has no such row. */
export function timedPlugins(plugins, options) {
    if (!Array.isArray(plugins))
        return undefined;
    const found = plugins.some((row) => isRecord(row) && row.id === ASK_TOOL);
    if (!found)
        return undefined;
    if (!options.timed)
        return plugins;
    return plugins.map((row) => {
        if (!isRecord(row) || row.id !== ASK_TOOL)
            return row;
        return { ...row, config: { mode: 'timed', timeout: options.timeout } };
    });
}
/**
 * The declaration the plugin wants: the installed one with the ask row timed, or the installed one
 * unchanged when timed is off. Returns undefined when the declaration carries no question row.
 */
export function derivedConfig(inherited, options) {
    const plugins = timedPlugins(inherited.plugins, options);
    return plugins === undefined ? undefined : { ...inherited, plugins };
}
/** Whether the plugin may rewrite the config a preset currently shows. */
export function owned(current, inherited, managed, id) {
    if (Object.keys(current).length === 0)
        return true;
    if (isDeepStrictEqual(current, inherited))
        return true;
    const hash = configHash(current);
    const record = managed[id];
    return record?.wrote === hash || record?.from === hash;
}
/** Whether the settings already reached the state the options ask for. */
function settled(snapshot, inherited, options) {
    const derived = derivedConfig(inherited, options);
    if (derived === undefined)
        return Object.keys(snapshot).length === 0;
    return (isDeepStrictEqual(derived, snapshot) ||
        (Object.keys(snapshot).length === 0 && isDeepStrictEqual(derived, inherited)));
}
/**
 * Derive the timed row of every preset through the Host config editor. Ownership for the exact
 * configuration is persisted before that configuration leaves the callback, so an interrupted or
 * rejected profile write re-derives instead of adopting a stale row or treating the plugin's own
 * override as foreign.
 */
export async function derive(editor, options, settings, persist, logger, cancelled) {
    const managed = { ...settings.managed };
    for (const configuration of editor.configuration()) {
        if (cancelled?.())
            return;
        const id = configuration.entry.options.id;
        if (!id.startsWith(PRESET_PREFIX))
            continue;
        const derived = derivedConfig(configuration.inherited, options);
        if (derived === undefined && managed[id] === undefined)
            continue;
        const snapshot = configuration.override;
        if (!owned(snapshot, configuration.inherited, managed, id)) {
            logger?.info?.(`preset ${id} keeps its own profile override`);
            continue;
        }
        if (settled(snapshot, configuration.inherited, options))
            continue;
        const previous = managed[id];
        let wrote;
        let aborted = false;
        const revert = () => {
            if (previous === undefined)
                delete managed[id];
            else
                managed[id] = previous;
        };
        try {
            await editor.edit(configuration.entry, (current, inherited) => {
                if (cancelled?.()) {
                    aborted = true;
                    return current;
                }
                if (!owned(current, inherited, managed, id)) {
                    aborted = true;
                    return current;
                }
                const next = derivedConfig(inherited, options) ?? inherited;
                managed[id] = { wrote: configHash(next), from: configHash(current) };
                if (!persist(managed, options)) {
                    revert();
                    aborted = true;
                    return current;
                }
                wrote = next;
                return next;
            });
        }
        catch (error) {
            revert();
            persist(managed, options);
            logger?.warn?.(`preset ${id}: ${error.message}`);
            continue;
        }
        if (aborted) {
            logger?.info?.(`preset ${id} keeps its own profile override`);
            continue;
        }
        if (wrote === undefined) {
            revert();
            persist(managed, options);
            logger?.info?.(`preset ${id} keeps its own profile override`);
            continue;
        }
        if (derived === undefined || isDeepStrictEqual(wrote, configuration.inherited)) {
            delete managed[id];
            persist(managed, options);
        }
    }
}
/** Read options from the row config overlaid by the settings file. */
export function optionsFrom(settings, config = {}) {
    return resolveOptions({
        timed: settings.timed ?? config.timed,
        timeout: settings.timeout ?? config.timeout,
    });
}
/** Derive the timed row of every preset and follow the settings file for later changes. */
export function apply(ctx, config = {}) {
    const logger = ctx.logger?.(LOGGER);
    const editor = ctx.get('configEditor');
    if (editor === undefined) {
        logger?.warn('configEditor is unavailable; preset rows are left untouched');
        return;
    }
    const directory = ctx.get('profileContext')?.dir;
    if (directory === undefined) {
        logger?.warn('the profile directory is unavailable; preset rows are left untouched');
        return;
    }
    const hmr = ctx.get('hmr');
    // Outside the HMR transaction that may have activated this row: its async context sticks to
    // timers and made the editor refuse a nested transaction during a dev reload.
    const outside = (callback) => hmr?.executing?.exit === undefined ? callback() : hmr.executing.exit(callback);
    const file = join(directory, FILE);
    if (!existsSync(file)) {
        writeSettings(directory, optionsFrom(readSettings(directory), config));
    }
    let lastWritten;
    let active = true;
    const persist = (managed, applied) => {
        if (!active)
            return false;
        const current = readSettings(directory);
        const resolved = optionsFrom(current, config);
        const value = {
            timed: current.timed ?? resolved.timed,
            timeout: current.timeout ?? resolved.timeout,
            managed,
        };
        const written = serializeSettings(value);
        const ok = writeSettings(directory, value);
        if (ok) {
            lastWritten = written;
            // A save that landed while this run was in flight is not applied yet.
            if (resolved.timed !== applied.timed || resolved.timeout !== applied.timeout)
                stale = true;
        }
        return ok;
    };
    let running = false;
    let again = false;
    let stale = false;
    const run = async () => {
        if (running) {
            again = true;
            return;
        }
        running = true;
        try {
            const settings = readSettings(directory);
            await derive(editor, optionsFrom(settings, config), settings, persist, logger, () => !active);
        }
        catch (error) {
            logger?.warn(`preset rows were not updated: ${error.message}`);
        }
        finally {
            running = false;
            if (active && (again || stale)) {
                again = false;
                stale = false;
                void run();
            }
        }
    };
    let timer;
    const schedule = () => {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            outside(() => void run());
        }, 0);
    };
    ctx.effect(() => {
        schedule();
        const watcher = watch(directory, { persistent: false }, (_event, filename) => {
            if (filename !== FILE)
                return;
            // Our own ownership write is not a user save: re-running on it would loop a failed edit.
            if (lastWritten !== undefined) {
                try {
                    if (readFileSync(join(directory, FILE), 'utf8') === lastWritten)
                        return;
                }
                catch {
                    // A vanished file still deserves a run.
                }
            }
            schedule();
        });
        return () => {
            active = false;
            watcher.close();
            if (timer !== undefined)
                clearTimeout(timer);
        };
    }, 'question-timeout: settings file');
}
