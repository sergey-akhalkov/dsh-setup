import { HypothesisConfigError, parseHypotheses } from './hypotheses.js';
import { RowConfigError, readRows } from './rows.js';
/**
 * The plugin configuration: declarative rows, the episode boundaries, the
 * comparison minimum, the inert hypothesis list, and the optional process
 * intervention date. A configuration patch replaces the whole `config` object,
 * so a profile that overrides rows must restate every field it declares.
 */
/** The default idle gap: no event for this long ends an episode. */
export const DEFAULT_IDLE_GAP_MINUTES = 30;
/** The default minimum episodes per side of a comparison. */
export const DEFAULT_MIN_EPISODES = 10;
const CONFIG_FIELDS = new Set([
    'rows',
    'idleGapMinutes',
    'minEpisodes',
    'hypotheses',
    'interventionAt',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value, at, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RowConfigError(`${at} must be a positive number`);
    }
    return value;
}
function positiveInteger(value, at, fallback) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
        throw new RowConfigError(`${at} must be a positive integer`);
    }
    return value;
}
/** ISO 8601 date or date-time with an optional zone; `Date.parse` still supplies the instant. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:[Zz]|[+-]\d{2}:\d{2})?)?$/;
/** Whether a four-digit year, month, and day name a real calendar day. */
function isCalendarDay(year, month, day) {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day);
}
/**
 * An optional ISO date-time. Syntax and the calendar day are checked before
 * `Date.parse`, which would otherwise roll an impossible day into the next month
 * and accept non-ISO formats such as `10/11/2026`.
 */
function isoDate(value, at) {
    if (value === undefined)
        return undefined;
    const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
    if (match !== null) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const hour = match[4] === undefined ? 0 : Number(match[4]);
        const minute = match[5] === undefined ? 0 : Number(match[5]);
        const second = match[6] === undefined ? 0 : Number(match[6]);
        const time = Date.parse(value);
        if (!Number.isNaN(time) &&
            isCalendarDay(year, month, day) &&
            hour <= 23 &&
            minute <= 59 &&
            second <= 59) {
            return time;
        }
    }
    throw new RowConfigError(`${at} must be an ISO 8601 date-time; received ${JSON.stringify(value)}`);
}
/**
 * Validate the whole plugin configuration. An absent configuration is valid:
 * the built-in rows, the default episode boundaries, and no hypotheses.
 */
export function parseConfig(raw) {
    if (raw === undefined || raw === null) {
        return {
            rows: [],
            idleGapMinutes: DEFAULT_IDLE_GAP_MINUTES,
            minEpisodes: DEFAULT_MIN_EPISODES,
            hypotheses: [],
        };
    }
    if (!isRecord(raw))
        throw new RowConfigError('config must be a mapping');
    for (const key of Object.keys(raw)) {
        if (!CONFIG_FIELDS.has(key))
            throw new RowConfigError(`config: unknown field "${key}"`);
    }
    try {
        const interventionAt = isoDate(raw.interventionAt, 'config.interventionAt');
        return {
            rows: readRows(raw.rows ?? []),
            idleGapMinutes: positive(raw.idleGapMinutes, 'config.idleGapMinutes', DEFAULT_IDLE_GAP_MINUTES),
            minEpisodes: positiveInteger(raw.minEpisodes, 'config.minEpisodes', DEFAULT_MIN_EPISODES),
            hypotheses: parseHypotheses(raw.hypotheses),
            ...(interventionAt === undefined ? {} : { interventionAt }),
        };
    }
    catch (error) {
        // Both error classes already carry the config prefix; keep one type at the boundary.
        if (error instanceof HypothesisConfigError)
            throw new RowConfigError(error.message.slice('observability config: '.length));
        throw error;
    }
}
