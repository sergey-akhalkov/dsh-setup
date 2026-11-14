/**
 * A bounded JSONLogic validator over plain data. It is data, not code: only a
 * small operator set is accepted, an unknown operator or malformed rule throws,
 * and the recursion depth is capped. It lives apart from the evaluator so a
 * definition trigger's `condition` can be validated at load without importing
 * the executor module.
 */
/** Validate the whole rule tree, operand counts included, before any evaluation. */
export declare function validateJsonLogic(rule: unknown, depth?: number): void;
