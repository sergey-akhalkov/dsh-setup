import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
/** Documented defaults: on, every five minutes, no history, no attachments. */
export const DEFAULT_EXPORT_CONFIG = Object.freeze({
    enabled: true,
    intervalMinutes: 5,
    autoCommit: true,
    autoPush: true,
    includeHistory: false,
    includeAttachments: false,
    importOnEmpty: false,
});
/** Name of the machine-local export file inside the Harness home. */
export const EXPORT_CONFIG_FILE = 'hindsight-export.json';
/** The Harness home; a throwaway `DSH_HOME` keeps tests off the live profile. */
export function dshHome() {
    return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/** Path of the machine-local file; `HINDSIGHT_EXPORT_CONFIG` overrides it like the upstream config. */
export function machineExportConfigPath() {
    return process.env.HINDSIGHT_EXPORT_CONFIG ?? join(dshHome(), EXPORT_CONFIG_FILE);
}
/** Read the machine-local file; invalid or missing content means no overrides. */
export function readMachineExportConfig(path = machineExportConfigPath()) {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            return {};
        return parsed;
    }
    catch {
        return {};
    }
}
function pickBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function pickMinutes(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : DEFAULT_EXPORT_CONFIG.intervalMinutes;
}
function pickText(value) {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
/** The machine-local file outranks the row, which outranks the defaults. */
export function resolveExportConfig(config = {}, machine = readMachineExportConfig(), home = homedir()) {
    const dir = pickText(machine.dir) ?? pickText(config.dir) ?? join(home, 'hindsight-export');
    return {
        enabled: pickBoolean(machine.enabled, pickBoolean(config.enabled, DEFAULT_EXPORT_CONFIG.enabled)),
        dir: resolve(dir),
        remote: pickText(machine.remote),
        intervalMinutes: pickMinutes(machine.intervalMinutes ?? config.intervalMinutes),
        autoCommit: pickBoolean(machine.autoCommit, pickBoolean(config.autoCommit, DEFAULT_EXPORT_CONFIG.autoCommit)),
        autoPush: pickBoolean(machine.autoPush, pickBoolean(config.autoPush, DEFAULT_EXPORT_CONFIG.autoPush)),
        includeHistory: pickBoolean(machine.includeHistory, pickBoolean(config.includeHistory, DEFAULT_EXPORT_CONFIG.includeHistory)),
        includeAttachments: pickBoolean(machine.includeAttachments, pickBoolean(config.includeAttachments, DEFAULT_EXPORT_CONFIG.includeAttachments)),
        importOnEmpty: pickBoolean(machine.importOnEmpty, pickBoolean(config.importOnEmpty, DEFAULT_EXPORT_CONFIG.importOnEmpty)),
    };
}
function normalized(path) {
    const absolute = resolve(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}
/**
 * Whether a directory sits inside the Harness home or the Hindsight database
 * root. Both were wiped together once, so an export there proves nothing.
 */
export function isForbiddenExportDir(dir, home = homedir()) {
    const target = normalized(dir);
    const roots = [process.env.DSH_HOME ?? join(home, '.dsh'), join(home, '.pg0')];
    return roots.some((root) => {
        const prefix = normalized(root);
        return target === prefix || target.startsWith(prefix + sep);
    });
}
