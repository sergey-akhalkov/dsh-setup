import { HypothesisConfigError, parseHypotheses } from './hypotheses.js';
import { RowConfigError, readRows } from './rows.js';
/**
 * The plugin configuration: declarative rows, the episode boundaries, the
 * comparison minimum, and the inert hypothesis list. A configuration patch
 * replaces the whole `config` object, so a profile that overrides rows must
 * restate every field it declares.
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
        return {
            rows: readRows(raw.rows ?? []),
            idleGapMinutes: positive(raw.idleGapMinutes, 'config.idleGapMinutes', DEFAULT_IDLE_GAP_MINUTES),
            minEpisodes: positiveInteger(raw.minEpisodes, 'config.minEpisodes', DEFAULT_MIN_EPISODES),
            hypotheses: parseHypotheses(raw.hypotheses),
        };
    }
    catch (error) {
        // Both error classes already carry the config prefix; keep one type at the boundary.
        if (error instanceof HypothesisConfigError)
            throw new RowConfigError(error.message.slice('observability config: '.length));
        throw error;
    }
}
