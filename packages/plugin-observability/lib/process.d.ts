import type { Distribution, EpisodeWork, Window } from './metrics.js';
/**
 * The process timeline: when workers were spawned, how many ran at once, when a
 * decomposition burst began, when the agent reflected, and the step rate under
 * them. Derived only from recorded session metadata: times, counts, ids, and an
 * outcome word. No message text, tool arguments, goal objectives, or checkpoint
 * list text is kept.
 */
/** One joined worker session's span, clipped to the observed window. */
export interface WorkerSpan {
    readonly sessionId: string;
    readonly episodeId: string;
    readonly from: number;
    readonly to: number;
}
/** One step of the worker-concurrency series; `active` holds until the next point. */
export interface ConcurrencyPoint {
    readonly time: number;
    readonly active: number;
}
/**
 * One bucket of the step-rate strip, aligned by index with the report's bucket
 * labels. The session range carries `0`/`0` bounds because its buckets are time
 * slices, not calendar buckets.
 */
export interface StepBucket {
    readonly from: number;
    readonly to: number;
    readonly steps: number;
}
/** The first worker activation of an episode while no other worker was active. */
export interface DecompositionMarker {
    readonly time: number;
    readonly episodeId: string;
    /** Workers joined to the episode, not only the ones active at this instant. */
    readonly workers: number;
}
/** A `work_checkpoint` call whose outcome word parsed. */
export interface ReflectionMarker {
    readonly time: number;
    readonly episodeId: string;
    readonly outcome: string;
    /** Steps since the previous reflection, or since the episode start. */
    readonly stepsSince: number;
}
/** The window's process counts, distributions, and coverage. */
export interface ProcessSummary {
    readonly episodes: number;
    /** Distinct joined child sessions alive in the window. */
    readonly workers: number;
    readonly episodesWithWorker: number;
    /** Worker activations inside the window; a span that began earlier is not one. */
    readonly activations: number;
    readonly maxConcurrency: number;
    /** Per episode with a worker: first worker activation minus episode start. */
    readonly timeToFirstWorker: Distribution;
    readonly reflections: number;
    /** Steps since the previous valid reflection, or since the episode start. */
    readonly stepsBetweenReflections: Distribution;
    /** Reflections over episodes; absent when the window holds no episode. */
    readonly reflectionsPerEpisode?: number;
    /** Episodes with at least one valid reflection over all episodes; absent when empty. */
    readonly reflectionCoverage?: number;
    /** False means no decomposition was observed, never that one was skipped. */
    readonly decompositionObserved: boolean;
}
/** One side of the before-and-after comparison. */
export interface ProcessSide {
    readonly summary: ProcessSummary;
}
/** The intervention comparison; either a configured date or the report's baseline. */
export interface ProcessComparison {
    readonly basis: 'intervention date' | 'previous equal window' | 'previous completed session';
    /** Epoch milliseconds of the date the panel prints, when one was used. */
    readonly interventionAt?: number;
    readonly before: ProcessSide;
    readonly after: ProcessSide;
    readonly status: 'association' | 'insufficient';
    readonly label: 'association, not proof' | 'insufficient data';
    readonly minEpisodes: number;
}
/** The whole process section of the report. */
export interface ProcessTimelineData {
    readonly from: number;
    readonly to: number;
    readonly workers: readonly WorkerSpan[];
    readonly concurrency: readonly ConcurrencyPoint[];
    readonly decomposition: readonly DecompositionMarker[];
    readonly reflections: readonly ReflectionMarker[];
    /** Steps per report bucket, aligned by index with the report's bucket labels. */
    readonly stepRate: readonly StepBucket[];
    readonly summary: ProcessSummary;
    /** Absent when no intervention date is configured and the report has no baseline. */
    readonly comparison?: ProcessComparison;
}
/** The window's process summary; exported for the report's baseline side. */
export declare function processSummary(work: readonly EpisodeWork[], window: Window): ProcessSummary;
/** What the process timeline needs: the window's episodes and its step-rate series. */
export interface BuildProcessOptions {
    /** Episodes overlapping the observed window; `work` is clipped by it. */
    readonly work: readonly EpisodeWork[];
    readonly window: Window;
    /** Steps per report bucket, aligned by index with the report's bucket labels. */
    readonly stepRate: readonly StepBucket[];
    readonly minEpisodes: number;
    /** Epoch milliseconds of the configured intervention date, when set. */
    readonly interventionAt?: number;
    /** The report's baseline, when the reader resolved one. */
    readonly baseline?: {
        readonly kind: 'previous equal window' | 'previous completed session';
        readonly summary: ProcessSummary;
    };
}
/** Build the window's process timeline, summary, and comparison. */
export declare function buildProcessTimeline(options: BuildProcessOptions): ProcessTimelineData;
