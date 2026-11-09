import type { Definition } from './definitions.js';
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
export interface ParityReport {
    readonly v: 1;
    readonly change: string;
    readonly at: string;
    readonly templates: Readonly<Record<string, string>>;
    readonly settings: Readonly<Record<string, ParitySettingsEntry>>;
    readonly gates: Readonly<Record<string, ParityGateEntry>>;
    readonly retained: Readonly<Record<string, {
        readonly cases: number;
        readonly status: string;
    }>>;
    readonly mismatches: readonly string[];
}
/**
 * The parity-bound template: trigger, steps, evidence shape, gate ownership,
 * and the settings schema. Profile-provided verify values are excluded.
 */
export declare function templateHash(definition: Definition): string;
/** The report binds these ids whenever owned, independent of settings.legacy. */
export declare function reportBoundDefinitions(definitions: readonly Definition[]): Definition[];
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
/** Every issue that blocks one `own` definition from loading, with its id. */
export interface ParityLoadResult {
    readonly issues: readonly string[];
    readonly refused: ReadonlySet<string>;
}
export declare function parityLoadIssues(definitions: readonly Definition[], report: ParityReport | undefined, reportPath: string, reportError: string | undefined): ParityLoadResult;
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
export interface TaskReviewCoverage {
    readonly ok: boolean;
    /** One line per checked task without a valid portable PASS. */
    readonly gaps: readonly string[];
}
/**
 * The owned completion/archive coverage: every checked task needs a portable
 * `reviews/<taskId>.json` PASS for the strict `task-review` rule and the
 * marker's reviewer when one is declared.
 */
export declare function taskReviewCoverage(workspace: string, change: string): TaskReviewCoverage;
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
}
/**
 * The owned checkpoint rules beyond the tool's own validation: a `continue`
 * checkpoint must carry its declared remedy evidence, and a bottleneck that
 * reached the configured age needs a route change.
 */
export declare function checkpointCloseIssue(input: {
    readonly record: CheckpointCloseRecord | undefined;
    readonly checkpointId: string;
    readonly observations: readonly CheckpointObservation[];
    readonly bottleneckAge: number;
}): string | undefined;
/** The completion branch: applies only when the task list is fully checked. */
export declare function taskReviewCompletion(workspace: string, change: string): {
    readonly ok: boolean;
    readonly text?: string;
} | undefined;
/** Read the retro checkpoint record's own fields; a missing record defers to the step evidence. */
export declare function readCheckpointRecord(workspace: string, checkpointPath: string): CheckpointCloseRecord | undefined;
/** The owned checkpoint remedy/age issue for a close, when a record exists. */
export declare function checkpointGateIssue(workspace: string, checkpointPath: string, observations: readonly CheckpointObservation[], bottleneckAge: number): {
    readonly text: string;
} | undefined;
