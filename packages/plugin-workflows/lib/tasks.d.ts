/**
 * Task identity for the deferred task-review workflow. The delegation engine
 * derives a stable id from the whitespace-normalized task text; these helpers
 * compute the same id locally so the engine can name the task a `tasks.md`
 * change just checked without a new event field.
 */
/** Stable 16-hex id of one numbered task's text. */
export declare function taskIdOf(text: string): string;
/** The checked `- [x] N.N text` task ids, in file order. */
export declare function checkedTaskIds(markdown: string): string[];
/** The checked task ids of one change, or undefined when its tasks.md is unreadable. */
export declare function checkedTaskIdsOf(workspace: string, change: string): string[] | undefined;
/** True only while the task is checked in the live tasks.md. */
export declare function isTaskChecked(workspace: string, change: string, taskId: string): boolean;
export interface NumberedTask {
    readonly id: string;
    readonly number: string;
    readonly text: string;
}
/** One numbered task by its stable id, checked or not. */
export declare function findTaskOf(markdown: string, taskId: string): NumberedTask | undefined;
/** One numbered task of one change, or undefined when tasks.md is unreadable. */
export declare function taskOf(workspace: string, change: string, taskId: string): NumberedTask | undefined;
/** One numbered task line with its checkbox state. */
export interface NumberedTaskLine extends NumberedTask {
    readonly checked: boolean;
}
/** Every numbered task in file order, checked or not. */
export declare function numberedTasks(markdown: string): NumberedTaskLine[];
/** One level-2 lane heading: its title, owned paths, and unchecked tasks. */
export interface TaskLaneView {
    readonly n: number;
    readonly title: string;
    readonly owned: readonly string[];
    readonly unchecked: readonly string[];
    readonly checked: readonly string[];
    readonly serial: boolean;
}
/**
 * Parse the level-2 headings as lanes. A heading's backticked path-like tokens
 * are its owned paths; the numbered tasks until the next level-2 heading belong
 * to it. A title carrying "serial" is the plan's tail and never parallel work.
 */
export declare function taskLanes(markdown: string): TaskLaneView[];
/** One `tasks.md` level-2 section with its numbered tasks and checked coverage. */
export interface TaskSection {
    readonly key: string;
    readonly title: string;
    readonly tasks: readonly NumberedTaskLine[];
    readonly covered: readonly NumberedTaskLine[];
    readonly unchecked: readonly NumberedTaskLine[];
}
/**
 * The stable 16-hex record id a section run's evidence path names in place of a
 * task id. It is not a task id: the section record covers several tasks.
 */
export declare function sectionRecordId(key: string): string;
/**
 * Resolve a section selector against the level-2 task groups: the heading
 * number (`1`), its wildcard form (`1.x`), the normalized or bare title, or
 * `untitled`. Every rejection names the available sections.
 */
export declare function resolveTaskSection(markdown: string, wanted: string, change: string): TaskSection;
/**
 * Re-resolve one section by key and prove its submitted covered ids are still
 * checked; a changed set or checkbox needs a fresh review, never a widened one.
 */
export declare function sectionCoverage(markdown: string, key: string, taskIds: readonly string[]): {
    readonly section: TaskSection;
    readonly covered: NumberedTaskLine[];
} | {
    readonly error: string;
};
