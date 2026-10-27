import { createStatusCache, detectElevation, isDesktopExecutable, isDesktopHost, } from './elevation.js';
import { restartAsAdministrator } from './restart.js';
import { createDesktopShortcut, isAuthorizedStatusRequest, SHORTCUT_NAME } from './shortcut.js';
/** Windows administrator indicator for the Desktop app. */
export const name = '@dsh-setup/plugin-admin-indicator';
/** The status route is served by the Web host; the shortcut is an authenticated POST. */
export const inject = ['webServer', 'commands', 'connection'];
/** Read-only elevation status used by the composer indicator. */
export const STATUS_PATH = '/plugins/dsh-setup-admin-indicator/status';
/** Authenticated shortcut action used by the composer menu. */
export const SHORTCUT_PATH = '/plugins/dsh-setup-admin-indicator/shortcut';
/** Authenticated session command that creates the administrator shortcut. */
export const SHORTCUT_COMMAND = 'admin-shortcut';
/** Authenticated session command that restarts DSH elevated. */
export const RESTART_COMMAND = 'admin-restart';
export const DEFAULT_CONFIG = Object.freeze({ restart: false });
/** Apply the documented default; reject a mistyped flag instead of guessing. */
export function resolveConfig(raw) {
    if (raw === undefined)
        return DEFAULT_CONFIG;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('admin-indicator: config must be an object');
    }
    const restart = raw.restart;
    if (restart !== undefined && typeof restart !== 'boolean') {
        throw new Error('admin-indicator: `restart` must be a boolean');
    }
    return { restart: restart === true };
}
function writeJson(res, status, value) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
}
function statusBody(elevated, restart) {
    return {
        platform: process.platform,
        elevated,
        desktop: isDesktopExecutable(process.execPath, process.platform) && isDesktopHost(process.argv),
        restart,
    };
}
/** Create the fixed shortcut from an authenticated session command. */
async function createShortcut() {
    if (!isDesktopHost(process.argv)) {
        return {
            kind: 'error',
            text: 'This action is available only from the DeepSeek Harness Desktop app.',
        };
    }
    try {
        await createDesktopShortcut(process.execPath, process.platform);
        return { kind: 'success', text: `Created the ${SHORTCUT_NAME} shortcut on the Desktop.` };
    }
    catch (error) {
        console.error('admin indicator: administrator shortcut creation failed', error);
        return { kind: 'error', text: 'The desktop shortcut could not be created.' };
    }
}
/** Restart DSH elevated from an authenticated session command. */
async function restartAsAdmin(rawInput, elevated) {
    if (rawInput.trim().toLowerCase() !== 'confirm') {
        return {
            kind: 'error',
            text: 'The administrator restart closes DSH. Run /admin-restart confirm to proceed.',
        };
    }
    if (elevated === 'administrator') {
        return { kind: 'error', text: 'DSH is already running as administrator.' };
    }
    if (elevated !== 'standard') {
        return {
            kind: 'error',
            text: 'The administrator state is unknown; restart DSH and try again.',
        };
    }
    if (!isDesktopHost(process.argv)) {
        return {
            kind: 'error',
            text: 'This action is available only from the DeepSeek Harness Desktop app.',
        };
    }
    try {
        await restartAsAdministrator(process.execPath, process.platform);
        return { kind: 'success', text: 'Restarting DSH as administrator…' };
    }
    catch (error) {
        console.error('admin indicator: administrator restart failed', error);
        return { kind: 'error', text: 'DSH could not restart as administrator.' };
    }
}
function isAuthorized(req, origin) {
    return isAuthorizedStatusRequest(req.headers.origin, req.headers.cookie, origin);
}
/** Register the read-only status endpoint, authenticated shortcut, and session commands. */
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const currentStatus = createStatusCache(detectElevation);
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: STATUS_PATH,
        handler: async (req, res) => {
            if (req.method !== 'GET') {
                res.writeHead(405, { allow: 'GET' });
                res.end();
                return;
            }
            if (!isAuthorized(req, ctx.webServer.getOrigin())) {
                writeJson(res, 403, { error: 'Forbidden' });
                return;
            }
            const elevated = await currentStatus().catch(() => 'unknown');
            writeJson(res, 200, statusBody(elevated, config.restart));
        },
    }));
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: SHORTCUT_PATH,
        handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.writeHead(405, { allow: 'POST' });
                res.end();
                return;
            }
            const rejection = ctx.connection.requestRejection({ headers: req.headers });
            if (rejection !== undefined) {
                writeJson(res, rejection, {
                    error: rejection === 401 ? 'Unauthorized' : 'Forbidden',
                });
                return;
            }
            const result = await createShortcut();
            writeJson(res, 200, { ok: result.kind === 'success', text: result.text });
        },
    }));
    ctx.effect(() => ctx.commands.register({
        definitionId: '@dsh-setup/plugin-admin-indicator/shortcut',
        name: SHORTCUT_COMMAND,
        description: 'Create the DeepSeek Harness (Administrator) desktop shortcut',
        handler: async () => createShortcut(),
    }));
    if (config.restart) {
        ctx.effect(() => ctx.commands.register({
            definitionId: '@dsh-setup/plugin-admin-indicator/restart',
            name: RESTART_COMMAND,
            description: 'Restart DeepSeek Harness as administrator',
            input: { hint: 'confirm' },
            handler: async (invocation) => restartAsAdmin(invocation.rawInput, await currentStatus()),
        }));
    }
}
