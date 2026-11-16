import type { Definition } from './definitions.js';
import { type ToolCallObservation } from './evidence.js';
import { type LaneParityLane } from './gates.js';
import { type GitRunner } from './git.js';
import { type NoteOwner } from './notes.js';
/**
 * The engine-owned gates: work progress, lane assignment, and goal completion.
 * Their decisions are the parity tables (`evaluateProgressParity`,
 * `evaluateLaneParity`), shared with the tracked parity report; this module only
 * gathers the evidence each decision needs. Ownership is resolved by the host:
 * a gate is called only while its legacy switch is false.
 */
/** The active review owner whose record store supplies task-review evidence. */
export type ReviewOwner = 'workflows' | 'legacy';
export interface GateEvidence {
    readonly workspace: string;
    readonly change: string;
    /** The session's observed tool calls, bounded by the host. */
    readonly calls: readonly ToolCallObservation[];
    readonly turn?: number;
    readonly runGit?: GitRunner;
}
export interface GateDecision {
    readonly decision: 'allow' | 'refuse';
    /** One line naming the refusal cause. */
    readonly reason: string;
    /** The ready-to-paste remedy a steer prints; present on a refusal. */
    readonly steer?: string;
}
/** Whether the turn wrote a non-documentation file. */
export declare function codeChangedThisTurn(calls: readonly ToolCallObservation[], workspace: string, turn: number | undefined): boolean;
/** The task ids one turn's canonical `tasks.md` writes newly checked. */
export declare function newlyCheckedTaskIds(calls: readonly ToolCallObservation[], workspace: string, change: string, turn: number | undefined): string[];
/**
 * Whether one task has a matching task-review PASS/ERROR record in the active
 * review owner's store. The native record is a superset of the legacy one, so
 * one predicate covers both; a record that changed its reviewed inputs or
 * failed internally never approves.
 */
export declare function taskReviewEvidence(workspace: string, change: string, taskId: string, owner: ReviewOwner): Promise<boolean>;
export interface ProgressGateInput extends GateEvidence {
    readonly codeChanged: boolean;
    readonly noteOwner: NoteOwner;
    readonly reviewOwner: ReviewOwner;
}
/**
 * The owned work-progress gate: a code-changing turn needs a newly checked and
 * reviewed task or a note whose digest matches the current worktree. A stale
 * note, a note for a completed task, and a note from another path refuse.
 */
export declare function evaluateOwnedProgressGate(input: ProgressGateInput): Promise<GateDecision>;
/** The change and lane number one worker-start argument tree tags. */
export interface LaneTag {
    readonly change: string;
    readonly n: number;
}
/** The first lane tag in a worker start's arguments; the tag is plain argument text. */
export declare function laneTagOf(argumentsValue: Readonly<Record<string, unknown>>): LaneTag | undefined;
/** The lane tag of a successful worker start, or undefined for any other tool call. */
export declare function workerLaneTag(name: string, ok: boolean, argumentsValue: Readonly<Record<string, unknown>>): LaneTag | undefined;
/** The lane titles covered by a successful tagged worker start in this session. */
export declare function taggedLaneTitles(calls: readonly ToolCallObservation[], change: string, lanes: readonly {
    readonly n: number;
    readonly title: string;
}[]): string[];
/** How one lane was satisfied for the session: a tagged worker or a serial note. */
export type LaneDecision = 'assigned' | 'serial';
/**
 * Forget decisions for lanes that disappeared, lost their tasks, or completed.
 * A renamed lane is a new title and therefore a new, unassigned lane. An
 * unreadable plan keeps the decisions: the gate already fails open there.
 */
export declare function pruneLaneDecisions(workspace: string, change: string, decisions: Map<string, LaneDecision>): Promise<void>;
export interface LaneGateInput extends GateEvidence {
    readonly codeChanged: boolean;
    readonly noteOwner: NoteOwner;
    /**
     * The session's satisfied lanes for this change, kept beyond the bounded tool
     * buffer and the single latest note; the host records them as they happen.
     */
    readonly decisions?: ReadonlyMap<string, LaneDecision>;
}
export interface LaneGateDecision extends GateDecision {
    readonly lanes?: readonly LaneParityLane[];
}
/**
 * The owned lane-assignment gate. A serial note naming a task in a lane decides
 * only that lane; every other unassigned lane stays reported. The gate fails
 * open on an unreadable plan, a plan without level-2 headings, and a lane
 * without owned paths (the shared parity table enforces the last one).
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
