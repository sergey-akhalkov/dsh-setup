import { type Definition, type LegacySignalState } from './definitions.js';
import { type NumberedTaskLine } from './tasks.js';
/**
 * The release-bound retirement parity: the tracked report, its template
 * hashes, the verify settings contract, and the legacy decisions the owned
 * workflow gates reproduce. A definition may flip to `own` only when the
 * shipped report covers its template and every gate case passed.
 */
export declare const PARITY_CHANGE = "retire-legacy-gates";
export declare const PARITY_REPORT_NAME = "retire-legacy-gates.json";
export interface ParitySettingsEntry {
    readonly type: string;
    readonly cases: readonly unknown[];
}
export interface ParityGateEntry {
    readonly cases: number;
    readonly mismatches: number;
    readonly status: string;
}
export interface ParityRetainedEntry {
    readonly cases: number;
    readonly replayed: number;
    readonly status: string;
}
export interface ParityReport {
    readonly v: 1;
    readonly change: string;
    readonly at: string;
    /** Hash of the retained executable baseline the report was built from. */
    readonly baseline: string;
    readonly templates: Readonly<Record<string, string>>;
    readonly settings: Readonly<Record<string, ParitySettingsEntry>>;
    readonly gates: Readonly<Record<string, ParityGateEntry>>;
    readonly retained: Readonly<Record<string, ParityRetainedEntry>>;
    readonly mismatches: readonly string[];
}
/**
 * The parity-bound template: trigger, steps, evidence shape, gate ownership,
 * and the settings schema. Profile-provided verify values are excluded.
 */
export declare function templateHash(definition: Definition): string;
/**
 * The report binds the five retirement ids whenever effectively owned, plus any
 * definition that effectively owns a retirement review signal through a step of
 * its own: the contributed change-intake runs the spec-review decision itself,
 * so it needs that signal's certification. An enabled legacy signal resolves
 * the matching definition or step to defer, so a rollback is not bound and the
 * legacy owner executes instead.
 */
export declare function reportBoundDefinitions(definitions: readonly Definition[], legacy?: LegacySignalState): Definition[];
/** The assets/parity directory, resolving from src and from lib. */
export declare function parityAssetDirectory(): string;
export declare function shippedParityReportPath(): string;
/** Read and shape-check the tracked report. */
export declare function readParityReport(file?: string): {
    report?: ParityReport;
    error?: string;
};
/** The rollback switch a refused definition names. */
export declare function legacySwitchFor(plugin: string, signal: string): string;
/** A retired gate certified by the report's replayed retained cases. */
export type RetainedGate = 'spec-review' | 'integration-review' | 'task-progress' | 'lane-assignment';
/**
 * The runtime certification of one retired gate: a recorded mismatch, an absent
 * case table, or a replay that did not complete is a failure. A missing or
 * changed evaluator surfaces as such an entry, so the gate is never certified
 * from a stale table. Returns one line naming the cause and the rollback.
 */
export declare function retiredGateIssue(report: ParityReport | undefined, reportError: string | undefined, reportPath: string, group: RetainedGate): string | undefined;
/** Every issue that blocks one `own` definition from loading, with its id. */
export interface ParityLoadResult {
    readonly issues: readonly string[];
    readonly refused: ReadonlySet<string>;
}
/**
 * Every parity issue that blocks one effectively owned definition from loading,
 * with its id. The profile's legacy signal state resolves a rolled-back
 * definition or step to defer, so it is none of parity's business.
 */
export declare function parityLoadIssues(definitions: readonly Definition[], report: ParityReport | undefined, reportPath: string, reportError: string | undefined, legacy?: LegacySignalState): ParityLoadResult;
/** The profile's verify settings: validated values outside the template hash. */
export interface VerifySettings {
    readonly commands: readonly string[];
    readonly maxBlocks: number;
}
export declare const DEFAULT_VERIFY_SETTINGS: VerifySettings;
/** Validate `workflows.verify` fail-loud with the field and its accepted shape. */
export declare function resolveVerifySettings(raw: unknown): VerifySettings;
/** Apply the validated profile values to the shipped verify definition. */
export declare function withVerifySettings(definition: Definition, settings: VerifySettings): Definition;
export interface TaskLine {
    readonly id: string;
    readonly number: string;
    readonly text: string;
}
/** Checked numbered tasks from a tasks.md body. */
export declare function checkedTaskLines(markdown: string): TaskLine[];
interface PortableApproval {
    readonly rule?: unknown;
    readonly change?: unknown;
    readonly taskId?: unknown;
    readonly verdict?: unknown;
    readonly target?: {
        readonly provider?: unknown;
        readonly model?: unknown;
    };
}
export declare function readPortableApproval(workspace: string, change: string, taskId: string): PortableApproval | undefined;
/** The marker's reviewer binding, its archive-gate settings, or its error. */
export interface ReviewApprovalBinding {
    readonly provider?: string;
    readonly model?: string;
    readonly invalid?: string;
    /** Whether the marker turns portable task approvals on for its archive gate. */
    readonly archiveGate?: boolean;
    /** The task-scoped review rule the marker binds. */
    readonly taskRule?: string;
}
/** The marker-pinned reviewer and archive-gate settings, or an error when the marker is invalid. */
export declare function reviewerBinding(workspace: string): ReviewApprovalBinding | undefined;
/** One review unit: a level-2 section covering every checked task in it, or a single task. */
export interface ReviewUnit {
    /** The section key and title of a section unit; absent for a per-task unit. */
    readonly section?: {
        readonly key: string;
        readonly title: string;
    };
    /** Every checked task the unit covers, in file order. */
    readonly covered: readonly NumberedTaskLine[];
    /** The covered checked tasks without a matching PASS/ERROR record, in file order. */
    readonly missing: readonly NumberedTaskLine[];
}
/** One open task-review run the review-unit text may point at. */
export interface ReviewUnitRun {
    readonly id: string;
    readonly change: string;
    readonly context: Readonly<Record<string, unknown>>;
}
export interface ReviewUnitTextOptions {
    /** The rule the start action names; default the shipped `task-review`. */
    readonly rule?: string;
    /** Open task-review runs; a run covering the unit is pointed at instead of a start. */
    readonly openRuns?: readonly ReviewUnitRun[];
}
/**
 * The one-line review unit: the section key and the missing task numbers (or the
 * single task) and the start action that covers them — or the open runs that
 * already cover them (or part of them). Shared by the turn-close steer and the
 * status summary.
 */
export declare function reviewUnitText(change: string, unit: ReviewUnit, options?: ReviewUnitTextOptions): string;
export interface TaskReviewCoverage {
    readonly ok: boolean;
    /** One line per missing review unit. */
    readonly gaps: readonly string[];
}
/**
 * The portable completion/archive coverage: every checked task needs a portable
 * PASS for the given task-scoped rule (default the shipped `task-review`) and
 * the marker's reviewer when one is declared. A section with two or more checked
 * tasks without a portable PASS is one section gap; a single missing task keeps
 * its own line.
 */
export declare function taskReviewCoverage(workspace: string, change: string, rule?: string, options?: ReviewUnitTextOptions): TaskReviewCoverage;
export interface CheckpointCloseRecord {
    readonly checkpoint?: unknown;
    readonly outcome?: unknown;
    readonly lanes?: unknown;
    readonly bottleneck?: {
        readonly id?: unknown;
        readonly owner?: unknown;
        readonly action?: unknown;
        readonly blockingLanes?: unknown;
        readonly targets?: unknown;
    };
    readonly bottleneckAge?: unknown;
    readonly bottleneckChanged?: unknown;
}
export interface CheckpointObservation {
    readonly toolName: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly ok: boolean;
    readonly at?: number;
    /** The tool result text; used to tell a started worker from a cached answer. */
    readonly detail?: string;
    /** Observation order, so calls after the checkpoint are unambiguous. */
    readonly seq?: number;
}
/**
 * The owned checkpoint rules beyond the tool's own validation: freshness, a
 * computed parallel plan needing a tagged worker, a `continue` remedy executed
 * after the checkpoint, and an aged bottleneck. Every call is judged against
 * the observations the host already recorded.
 */
export declare function checkpointCloseIssue(input: {
    readonly record: CheckpointCloseRecord | undefined;
    readonly checkpointId: string;
    readonly observations: readonly CheckpointObservation[];
    readonly bottleneckAge: number;
    /** False when the latest checkpoint is at or beyond the step interval. */
    readonly fresh?: boolean;
    /** The time of the successful checkpoint call; only later calls count. */
    readonly checkpointAt?: number;
    /** Whether any worker-start tool is visible; absent means visible. */
    readonly workerVisible?: boolean;
    /** Whether the parallel-action gate is enabled; absent means enabled. */
    readonly enforceParallel?: boolean;
    /** The workspace absolute/relative paths resolve against. */
    readonly workspace?: string;
    /** The validated tool arguments (unredacted), preferred over the record. */
    readonly checkpointArguments?: Readonly<Record<string, unknown>>;
    /** Observation order of the successful checkpoint, for exact later-call ordering. */
    readonly checkpointSeq?: number;
}): string | undefined;
/** The completion branch: applies only when the task list is fully checked. */
export declare function taskReviewCompletion(workspace: string, change: string, options?: ReviewUnitTextOptions): {
    readonly ok: boolean;
    readonly text?: string;
} | undefined;
/** Read the retro checkpoint record's own fields; a missing record defers to the step evidence. */
export declare function readCheckpointRecord(workspace: string, checkpointPath: string): CheckpointCloseRecord | undefined;
/** The owned checkpoint remedy/age issue for a close, when a record exists. */
export declare function checkpointGateIssue(workspace: string, checkpointPath: string, observations: readonly CheckpointObservation[], bottleneckAge: number, options?: {
    readonly fresh?: boolean;
    readonly checkpointAt?: number;
    readonly workerVisible?: boolean;
    readonly enforceParallel?: boolean;
}): {
    readonly text: string;
} | undefined;
export {};
