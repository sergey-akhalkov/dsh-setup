import { type GitRunner } from './git.js';
/**
 * The trigger condition's bounded context. It carries the event, the change's
 * tasks and lanes, the current whole-spec and task records with their digests,
 * the current spec and worktree digests, and the session's involvement — no
 * prose, no run state, and no machine path. The predicate itself is JSONLogic.
 */
export interface ConditionEvent {
    readonly kind: string;
    readonly tool?: string;
    readonly command?: string;
    readonly path?: string;
}
export interface ConditionTaskView {
    readonly id: string;
    readonly number: string;
    readonly text: string;
    readonly checked: boolean;
}
export interface ConditionLaneView {
    readonly n: number;
    readonly title: string;
    readonly owned: readonly string[];
    readonly unchecked: readonly string[];
}
export interface ConditionContext {
    readonly event: ConditionEvent;
    readonly change: {
        readonly name: string;
        readonly tasks: {
            readonly checked: readonly string[];
            readonly unchecked: readonly string[];
            readonly items: readonly ConditionTaskView[];
        };
        readonly lanes: readonly ConditionLaneView[];
    };
    readonly records: {
        readonly spec?: {
            readonly verdict: string;
            readonly digest: string;
            readonly current: boolean;
            readonly pass: boolean;
        };
        readonly tasks: Readonly<Record<string, {
            readonly verdict: string;
            readonly digest: string;
        }>>;
    };
    readonly digests: {
        readonly spec?: string;
        readonly worktree?: string;
    };
    readonly session: {
        readonly involved: boolean;
        readonly changedSpec: boolean;
        readonly completed: boolean;
    };
}
export interface ConditionContextInput {
    readonly workspace: string;
    readonly change?: string;
    readonly event: ConditionEvent;
    /** The git seam; absent leaves the worktree digest unavailable. */
    readonly runGit?: GitRunner;
    /** Whether this session is attributed to the change. */
    readonly involved?: boolean;
    /** Whether this turn changed the change artifacts. */
    readonly changedSpec?: boolean;
    /** Whether this turn completed the tracked work. */
    readonly completed?: boolean;
}
/** Build the one bounded context every condition for this event evaluates over. */
export declare function buildConditionContext(input: ConditionContextInput): Promise<ConditionContext>;
/**
 * Whether any predicate reads `digests.worktree`. The worktree digest runs git,
 * so a close whose conditional definitions never read it skips that cost.
 */
export declare function conditionNeedsWorktree(condition: Readonly<Record<string, unknown>> | undefined): boolean;
/** Evaluate one definition's condition over the built context; false starts no run. */
export declare function evaluateCondition(condition: Readonly<Record<string, unknown>> | undefined, context: ConditionContext): boolean;
/** Every condition-bearing definition's decision for one event context. */
export declare function evaluateConditions(definitions: readonly {
    readonly id: string;
    readonly trigger: {
        readonly condition?: Readonly<Record<string, unknown>>;
    };
}[], context: ConditionContext): Map<string, boolean>;
