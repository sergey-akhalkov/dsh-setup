import { type TestableRow } from './builtins.js';
import type { Distribution, EpisodeWork } from './metrics.js';
/** The bin index of an episode's tool-call count. */
export declare function toolBin(calls: number): number;
/** The local Monday-start key of a time, so a week cell is stable. */
export declare function weekStart(time: number): number;
/** One cohort's outcome metrics; a p50/p90 pair per metric. */
export interface CohortMetrics {
    readonly n: number;
    /** Verified completions over completed episodes; absent when none completed. */
    readonly verifiedShare?: number;
    readonly tokens: Distribution;
    readonly activeMinutes: Distribution;
    readonly stepsPerHumanMessage: Distribution;
}
/** Treated minus control for each comparable outcome; absent when either side is absent. */
export interface OutcomeDeltas {
    readonly verifiedShare?: number;
    readonly tokensP50?: number;
    readonly activeMinutesP50?: number;
    readonly stepsPerHumanMessageP50?: number;
}
/** One signal row's scorecard. */
export interface Scorecard {
    readonly rowId: string;
    readonly label: string;
    /** The declared business goal, rendered as data. */
    readonly goal?: string;
    /** Whether the row declares an eligibility predicate. */
    readonly eligibilityDeclared: boolean;
    /** Episodes matching the eligibility predicate, or every episode without one. */
    readonly eligible: number;
    /** Fired and eligible episodes. */
    readonly fired: number;
    /** Fired episodes outside the eligibility predicate; never in activation. */
    readonly firedOutside: number;
    /** Fired and eligible over eligible; absent when no episode was eligible. */
    readonly activation?: number;
    /** Treated episodes with a recorded failure over treated episodes. */
    readonly errorRate?: number;
    readonly treated: CohortMetrics;
    readonly control: CohortMetrics;
    /** Treated minus control, preserving unavailable values as absent. */
    readonly deltas: OutcomeDeltas;
    /** Whether the comparison found a matched control for every treated episode. */
    readonly matched: boolean;
    /** Whether a size bin had to be compared across weeks. */
    readonly weekRelaxed: boolean;
    /** Either side below the configured minimum. */
    readonly insufficient: boolean;
    readonly association: 'association, not proof';
}
/** One scorecard per configured signal row. */
export declare function scorecards(rows: readonly TestableRow[], work: readonly EpisodeWork[], minEpisodes: number): Scorecard[];
