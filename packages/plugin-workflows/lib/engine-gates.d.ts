import type { Definition } from './definitions.js';
import { type ToolCallObservation } from './evidence.js';
import { type LaneParityLane } from './gates.js';
import { type GitRunner } from './git.js';
import { type ReviewUnit, type ReviewUnitTextOptions } from './parity.js';
export type { ReviewUnit };
/**
 * The engine-owned gates: work progress, lane assignment, and goal completion.
 * Their decisions are the parity tables (`evaluateProgressParity`,
 * `evaluateLaneParity`), shared with the tracked parity report; this module only
 * gathers the evidence each decision needs. The host owns these gates; only the
 * checkpoint and verification definitions keep a legacy source.
 */
export interface GateEvidence {
    readonly workspace: string;
    readonly change: string;
    /** The session's observed tool calls, bounded by the host. */
    readonly calls: readonly ToolCallObservation[];
    readonly turn?: number;
    readonly runGit?: GitRunner;
    /** The turn's newly checked task ids the host retained beyond its bounded buffer. */
    readonly retainedTicks?: readonly string[];
}
export interface GateDecision {
    readonly decision: 'allow' | 'refuse';
    /** One line naming the refusal cause. */
    readonly reason: string;
    /** The ready-to-paste remedy a steer prints; present on a refusal. */
    readonly steer?: string;
}
/** The active change names; the archive collection is not an active change. */
export declare function activeChangeNames(workspace: string): Promise<Set<string>>;
/** The archived change names. `openspec archive` writes `<date>-<name>`, a supported manual move `<name>`. */
export declare function archivedChangeNames(workspace: string): Promise<Set<string>>;
/** Whether the turn wrote a non-documentation file. */
export declare function codeChangedThisTurn(calls: readonly ToolCallObservation[], workspace: string, turn: number | undefined): boolean;
/**
 * The checked task ids one successful canonical `tasks.md` write newly ticks,
 * attributed to its change.
 */
export declare function taskTicksOf(workspace: string, call: ToolCallObservation): {
    readonly change: string;
    readonly taskIds: string[];
} | undefined;
/** The task ids one turn's canonical `tasks.md` writes newly checked. */
export declare function newlyCheckedTaskIds(calls: readonly ToolCallObservation[], workspace: string, change: string, turn: number | undefined): string[];
/**
 * Whether one task has a matching task-review PASS/ERROR record in the
 * workflow store. The review step's own evidence accepts either verdict; only
 * the review units below require a PASS.
 */
export declare function taskReviewEvidence(workspace: string, change: string, taskId: string): Promise<boolean>;
/**
 * The lane-first review units of one change: every checked task in a resolvable
 * level-2 section without a current PASS is one unit covering every checked task
 * of that section. A task outside any section, or in a section the start path
 * cannot resolve, keeps its per-task unit. Only `PASS` is coverage, so a
 * `FINDINGS` or `ERROR` record keeps the unit due. Undefined when the plan is
 * unreadable.
 */
export declare function reviewUnits(workspace: string, change: string): Promise<ReviewUnit[] | undefined>;
/**
 * The one-line lane unit: the section key with its covered and missing task
 * numbers (or the single task), the live runs that already cover it, and the
 * start action that covers the rest. Lane-first: only a PASS clears a unit, so
 * the text names a PASS where the review step's own evidence accepts ERROR too.
 * The completion coverage keeps its portable-approval formatter in parity.ts.
 */
export declare function reviewUnitText(change: string, unit: ReviewUnit, options?: ReviewUnitTextOptions): string;
/**
 * The compact status form of one due unit: every due lane fits the delivered
 * status budget, so the title is omitted and the covered/missing task numbers
 * stay. Built from the same coverage as `reviewUnitText`.
 */
export declare function reviewUnitSummary(change: string, unit: ReviewUnit, options?: ReviewUnitTextOptions): string;
/**
 * The selected unit of one task-review run, rendered for an intermediate close:
 * a run whose review step is still open names its section and missing tasks
 * even while unchecked tasks remain (the completion coverage only speaks once
 * every task is checked).
 */
export declare function reviewRunSteer(workspace: string, change: string, context: Readonly<Record<string, unknown>>, options?: ReviewUnitTextOptions): Promise<string | undefined>;
export interface ProgressGateInput extends GateEvidence {
    readonly codeChanged: boolean;
}
/**
 * The owned work-progress gate: a code-changing turn needs a newly checked and
 * reviewed task that is still checked, or a note whose digest matches the
 * current worktree. A stale note, a note for a completed task, and a note from
 * another path refuse.
 */
export declare function evaluateOwnedProgressGate(input: ProgressGateInput): Promise<GateDecision>;
/** The change and lane number one worker-start argument tree tags. */
export interface LaneTag {
    readonly change: string;
    readonly n: number;
}
/**
 * The first lane tag in a worker start's arguments. The tag is searched in
 * decoded argument strings, so a tag that starts a new line still matches.
 */
export declare function laneTagOf(argumentsValue: Readonly<Record<string, unknown>>): LaneTag | undefined;
/** The lane tag of a successful worker start, or undefined for any other tool call. */
export declare function workerLaneTag(name: string, ok: boolean, argumentsValue: Readonly<Record<string, unknown>>): LaneTag | undefined;
/** How one lane was satisfied for the session: a tagged worker or a serial note. */
export type LaneDecision = 'assigned' | 'serial';
/**
 * Forget decisions for lanes that disappeared, lost their tasks, or completed.
 * A completed or removed lane also drops its own session's persisted serial
 * note, even when the decision map is empty as it is after a host reload, so
 * reopening the lane needs fresh evidence instead of the old note. A renamed
 * lane is a new title and therefore a new, unassigned lane. An unreadable plan
 * keeps the decisions: the gate already fails open there.
 */
export declare function pruneLaneDecisions(workspace: string, change: string, decisions: Map<string, LaneDecision>, note: {
    readonly session: string;
}): Promise<void>;
export interface LaneGateInput extends GateEvidence {
    readonly codeChanged: boolean;
    /** The calling session; its own lane decisions and session-bound notes decide. */
    readonly session: string;
    /**
     * The session's satisfied lanes for this change, kept beyond the bounded tool
     * buffer and the single latest note; the host records them as they happen. A
     * tagged worker start records the lane title captured at start time, never a
     * numeric tag resolved against a later plan.
     */
    readonly decisions?: ReadonlyMap<string, LaneDecision>;
}
export interface LaneGateDecision extends GateDecision {
    readonly lanes?: readonly LaneParityLane[];
}
/**
 * The owned lane-assignment gate. A serial note naming a task in a lane decides
 * only that lane, only for the session that wrote it, and only while the note
 * still names the current lane title. Every other unassigned lane stays
 * reported. The gate fails open on an unreadable plan, a plan without level-2
 * headings, and a lane without owned paths (the shared parity table enforces
 * the last one).
 */
export declare function evaluateOwnedLaneGate(input: LaneGateInput): Promise<LaneGateDecision>;
export interface GoalGuardInput {
    readonly workspace: string;
    readonly definitions: readonly Definition[];
    readonly exec: {
        readonly name: string;
        readonly arguments?: unknown;
    };
}
/**
 * The goal-complete guard: completing a goal is refused while an active change
 * has a checked task without a portable task-review PASS. The check is the same
 * portable-approval coverage the archive gate uses.
 */
export declare function goalCompletionRefusal(input: GoalGuardInput): Promise<string | undefined>;
