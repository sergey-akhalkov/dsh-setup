import { isRange, RANGES } from './aggregate.js';
import { SessionCache } from './cache.js';
import { readSessions } from './reader.js';
import { buildReport } from './report.js';
import { parseRows } from './rows.js';
/** Observability: signal counts derived from the session event logs. */
export const name = '@dsh-setup/plugin-observability';
/** Services the report route reads through. */
export const inject = ['sessionQuery', 'tools', 'webServer', 'connection'];
/** Read-only report route used by the view. */
export const REPORT_PATH = '/plugins/dsh-setup-observability/report';
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
    const records = await readSessions({ query: ctx.sessionQuery, range, now, sessionId, cache });
    const registry = new Set(ctx.tools.schemas().map((schema) => schema.name));
    return buildReport({ range, now, records, configured, registry });
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
