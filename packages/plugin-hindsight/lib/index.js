import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { apply as applyHindsight } from '@vectorize-io/hindsight-coding-agents/dsh';
export { applyArchiveScope, BANK_METADATA_FILE, BANKS_DIR, bankFolderName, buildBankFiles, buildRepositoryIndex, INDEX_FILE, METADATA_SCHEMA_VERSION, parseBankMetadata, parseRepositoryIndex, sanitizeBankId, sha256Hex, TRANSFER_SCHEMA_VERSION, unsanitizeBankId, } from './export-archive.js';
export { TransferClient } from './export-client.js';
export { DEFAULT_EXPORT_CONFIG, EXPORT_CONFIG_FILE, isForbiddenExportDir, machineExportConfigPath, readMachineExportConfig, resolveExportConfig, } from './export-config.js';
export { ExportError, messageOf } from './export-errors.js';
export { bootstrapRepository, commitSnapshot, currentBranch, EXPORT_GIT_IDENTITY, EXPORT_GITIGNORE, gitOutput, hasCommits, } from './export-git.js';
export { acquireSnapshotLock, DEFAULT_LOCK_STALE_MS, LOCK_FILE, normalizedContentHash, PENDING_FILE, recoverPendingSnapshot, STAGING_DIR, writeSnapshot, } from './export-snapshot.js';
export { packArchive, unpackArchive } from './export-zip.js';
/**
 * Hindsight memory plugin: delegates the whole memory lifecycle (seeding,
 * recall, injection, retention, native tools, companion skill) to the official
 * native DSH plugin. This module supplies the setup's local-server defaults,
 * only when the machine has not set them already, and starts the installed
 * local daemon if it is missing.
 */
/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-hindsight';
/** The official plugin binds the agent lifecycle events. */
export const inject = ['agents'];
/** Whether a URL addresses the machine itself. */
export function isLoopbackUrl(apiUrl) {
    if (apiUrl === undefined)
        return false;
    try {
        const host = new URL(apiUrl).hostname;
        return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
    }
    catch {
        return false;
    }
}
/** Whether a URL is the managed hindsight-embed default profile endpoint. */
export function isManagedEndpoint(apiUrl) {
    if (apiUrl === undefined)
        return false;
    try {
        const url = new URL(apiUrl);
        return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '8888';
    }
    catch {
        return false;
    }
}
/** Upstream's environment fallback for the disabled switch. */
function environmentDisabled() {
    const value = process.env.HINDSIGHT_DISABLED;
    if (value === undefined)
        return false;
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}
/** A path or bank override makes the Host-wide connection unknowable for autostart. */
function hasScopedConnectionOverrides(machine) {
    const harness = machine.harnesses?.dsh;
    const paths = { ...(machine.paths ?? {}), ...(harness?.paths ?? {}) };
    const banks = { ...(machine.banks ?? {}), ...(harness?.banks ?? {}) };
    const scoped = [...Object.values(paths), ...Object.values(banks)];
    return scoped.some((entry) => entry.serverMode !== undefined ||
        entry.apiUrl !== undefined ||
        entry.disabled !== undefined ||
        entry.autostart !== undefined);
}
/** Read the upstream's machine-local connection file; invalid or missing means no overrides. */
function readMachineConfig() {
    const path = process.env.HINDSIGHT_CONFIG ?? join(homedir(), '.hindsight', 'coding-agent.json');
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
/**
 * Autostart only for an explicitly local self-hosted connection, unless the
 * row or machine-local config disables it. The upstream file wins over the
 * environment and the row.
 */
export function shouldAutostart(config, machine = readMachineConfig()) {
    if (hasScopedConnectionOverrides(machine))
        return false;
    const harness = machine.harnesses?.dsh;
    if (config.autostart === false || (harness?.autostart ?? machine.autostart) === false) {
        return false;
    }
    if ((harness?.disabled ?? machine.disabled ?? environmentDisabled()) === true)
        return false;
    const serverMode = harness?.serverMode ??
        machine.serverMode ??
        process.env.HINDSIGHT_SERVER_MODE ??
        config.serverMode;
    if (serverMode !== 'self-hosted')
        return false;
    const apiUrl = harness?.apiUrl ?? machine.apiUrl ?? process.env.HINDSIGHT_API_URL ?? config.apiUrl;
    return isManagedEndpoint(apiUrl);
}
/** The user-level tool installed by setup-hindsight.ps1, or the PATH command. */
function embedCommand() {
    const executable = process.platform === 'win32' ? 'hindsight-embed.exe' : 'hindsight-embed';
    const local = join(homedir(), '.local', 'bin', executable);
    return existsSync(local) ? local : 'hindsight-embed';
}
function resolvedApiUrl(config, machine) {
    return (machine.harnesses?.dsh?.apiUrl ??
        machine.apiUrl ??
        process.env.HINDSIGHT_API_URL ??
        config.apiUrl ??
        '');
}
/**
 * Probe the local endpoint and, only when it is down, spawn the installed
 * daemon start detached. Every failure is ignored: the upstream plugin already
 * fails open, and the session must never wait for this.
 */
async function startLocalDaemon(config) {
    try {
        const machine = readMachineConfig();
        if (!shouldAutostart(config, machine))
            return;
        const apiUrl = resolvedApiUrl(config, machine);
        try {
            const health = await fetch(new URL('/health', apiUrl), {
                signal: AbortSignal.timeout(1500),
            });
            if (health.ok)
                return;
        }
        catch {
            // Unhealthy or unreachable: attempt a detached start below.
        }
        const env = { ...process.env, HINDSIGHT_EMBED_PROFILE: 'default' };
        const cert = join(homedir(), '.hindsight', 'windows-certs.pem');
        if (existsSync(cert)) {
            env.SSL_CERT_FILE = cert;
            env.REQUESTS_CA_BUNDLE = cert;
        }
        const child = spawn(embedCommand(), ['daemon', 'start'], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env,
        });
        child.on('error', () => undefined);
        child.unref();
    }
    catch {
        // Fail open: a missing tool, config, or detached process must not affect the Host.
    }
}
/**
 * Apply the row's connection defaults as environment fallbacks, then start the
 * official plugin. The upstream config file wins over these values, and an
 * explicit environment variable is never overwritten.
 */
export function apply(ctx, config = {}) {
    if (config.serverMode)
        process.env.HINDSIGHT_SERVER_MODE ??= config.serverMode;
    if (config.apiUrl)
        process.env.HINDSIGHT_API_URL ??= config.apiUrl;
    void startLocalDaemon(config);
    applyHindsight(ctx);
}
