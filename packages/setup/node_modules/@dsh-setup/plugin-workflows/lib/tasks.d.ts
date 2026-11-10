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
