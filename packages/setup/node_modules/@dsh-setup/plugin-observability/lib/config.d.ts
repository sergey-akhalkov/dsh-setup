import { type Hypothesis } from './hypotheses.js';
import { type Row } from './rows.js';
/**
 * The plugin configuration: declarative rows, the episode boundaries, the
 * comparison minimum, and the inert hypothesis list. A configuration patch
 * replaces the whole `config` object, so a profile that overrides rows must
 * restate every field it declares.
 */
/** The default idle gap: no event for this long ends an episode. */
export declare const DEFAULT_IDLE_GAP_MINUTES = 30;
/** The default minimum episodes per side of a comparison. */
export declare const DEFAULT_MIN_EPISODES = 10;
/** The validated configuration. */
export interface PluginConfig {
    readonly rows: readonly Row[];
    readonly idleGapMinutes: number;
    readonly minEpisodes: number;
    readonly hypotheses: readonly Hypothesis[];
}
/**
 * Validate the whole plugin configuration. An absent configuration is valid:
 * the built-in rows, the default episode boundaries, and no hypotheses.
 */
export declare function parseConfig(raw: unknown): PluginConfig;
