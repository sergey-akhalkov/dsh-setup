/**
 * The bounded condition schema. A trigger's `condition` is JSONLogic over a
 * closed context: the event, the change's tasks and lanes, the current records
 * and digests, and the session's involvement. A path outside that vocabulary
 * fails the definition load with its field.
 */
export declare const CONDITION_ROOTS: readonly ["event", "change", "records", "digests", "session"];
export type ConditionRoot = (typeof CONDITION_ROOTS)[number];
/** Validate a trigger condition at load: JSONLogic only, closed context paths. */
export declare function validateCondition(rule: unknown, field?: string): void;
