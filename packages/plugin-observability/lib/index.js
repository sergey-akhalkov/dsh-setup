import { isRange, RANGES } from './aggregate.js';
import { SessionCache } from './cache.js';
import { readSessions, readSessionTitles } from './reader.js';
import { attachSessionTitles, buildReport } from './report.js';
import { configuredArgumentFields, parseRows } from './rows.js';
/** Observability: signal counts derived from the session event logs. */
export const name = '@dsh-setup/plugin-observability';
/** Services the report route reads through. */
export const inject = ['sessionQuery', 'tools', 'webServer', 'connection'];
/** Read-only report route used by the view. */
export const REPORT_PATH = '/plugins/dsh-setup-observability/report';
/** Read an optional service without declaring it a load requirement. */
function optionalService(ctx, name) {
    try {
        const reflect = ctx.reflect;
        return reflect?.get(name) ?? undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Observe the live registries once per report. A missing service, a throwing
 * assembly, or an incomplete catalog is unknown, never absence.
 */
async function readReadiness(ctx) {
    const sources = {
        skillsComplete: false,
    };
    const systemPrompt = optionalService(ctx, 'systemPrompt');
    if (systemPrompt !== undefined) {
        try {
            const assembly = await systemPrompt.assemble();
            sources.sections = new Set(assembly.sections.map((section) => section.name));
        }
        catch {
            // Readiness unknown; a false alarm is worse than an unknown.
        }
    }
    const skills = optionalService(ctx, 'skills');
    if (skills !== undefined) {
        try {
            const snapshot = await skills.snapshot();
            sources.skills = new Set(snapshot.skills.map((entry) => entry.name));
            sources.skillsComplete = snapshot.complete === true;
        }
        catch {
            // Readiness unknown.
        }
    }
    return sources;
}
function writeJson(res, status, value) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
}
function requestUrl(req) {
    return new URL(req.url ?? REPORT_PATH, 'http://localhost');
}
/** Compute one report for a validated range. */
export async function computeReport(ctx, range, sessionId, now, cache, configured) {
    const records = await readSessions({
        query: ctx.sessionQuery,
        range,
        now,
        sessionId,
        cache,
        argumentFields: configuredArgumentFields(configured),
    });
    const registry = new Set(ctx.tools.schemas().map((schema) => schema.name));
    const readiness = await readReadiness(ctx);
    const report = buildReport({ range, now, records, configured, registry, readiness });
    const failureSessions = [...new Set(report.failures.map((failure) => failure.sessionId))];
    const titles = await readSessionTitles(ctx.sessionQuery, failureSessions);
    return attachSessionTitles(report, titles);
}
/** Register the read-only report route. */
export function apply(ctx, rawConfig) {
    const configured = parseRows(rawConfig);
    const cache = new SessionCache();
    ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: REPORT_PATH,
        handler: async (req, res) => {
            if (req.method !== 'GET') {
                res.writeHead(405, { allow: 'GET' });
                res.end();
                return;
            }
            const rejection = ctx.connection.requestRejection({ headers: req.headers });
            if (rejection !== undefined) {
                writeJson(res, rejection, { error: rejection === 401 ? 'Unauthorized' : 'Forbidden' });
                return;
            }
            const url = requestUrl(req);
            const range = url.searchParams.get('range');
            if (!isRange(range)) {
                writeJson(res, 400, {
                    error: `range must be one of: ${RANGES.join(', ')}`,
                });
                return;
            }
            const session = url.searchParams.get('session');
            const now = Date.now();
            try {
                const report = await computeReport(ctx, range, session === null || session === '' ? undefined : session, now, cache, configured);
                writeJson(res, 200, report);
            }
            catch (error) {
                console.error('observability: report computation failed', error);
                writeJson(res, 500, { error: 'The report could not be computed.' });
            }
        },
    }));
}
