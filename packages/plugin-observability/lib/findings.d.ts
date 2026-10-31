import type { EpisodeWork } from './metrics.js';
/**
 * Attention findings: derivations over the episode metadata that say when a run
 * went the wrong way even though every plugin loaded. The first rule is the
 * serial long run, because activity alone is mistaken for value.
 */
/** Steps above which a single episode is a long run. */
export declare const SERIAL_RUN_STEPS = 40;
/** Active minutes above which a single episode is a long run. */
export declare const SERIAL_RUN_MINUTES = 20;
/** One derived attention item. */
export interface Finding {
    readonly id: string;
    /** Findings are problems by construction; this is the only severity today. */
    readonly severity: 'attention';
    readonly title: string;
    /** Counts, times, and ids only; never message text or tool arguments. */
    readonly evidence: string;
    readonly episodeIds: readonly string[];
    readonly nextAction: string;
}
/** One episode's parallel width over its joined children. */
export declare function episodeParallelWidth(entry: EpisodeWork): number;
/**
 * A long episode whose child sessions never overlapped. A run with overlapping
 * children is not reported, and an empty window reports nothing.
 */
export declare function serialRunFindings(work: readonly EpisodeWork[]): Finding[];
