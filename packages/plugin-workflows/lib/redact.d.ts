/**
 * Redaction for the journal. Key-based redaction removes a secret-named object
 * field; a payload whose free text carries a secret key, an auth credential, or
 * a private-key block is untrusted as a whole and is replaced by one marker.
 * Replacing the whole summary is deliberate: a parser miss can lose text, never
 * leak a credential.
 */
/** The marker a key-based field or a whole untrusted payload becomes. */
export declare const REDACTED = "[REDACTED]";
/** The marker a summary carrying any credential shape becomes. */
export declare const REDACTED_PAYLOAD = "[REDACTED PAYLOAD]";
/**
 * Whether free text carries any credential shape at all. Raw key/value pairs,
 * auth credentials, and PEM blocks are checked directly; a line that looks like
 * JSON is decoded so an escaped key or multiply serialized document is
 * inspected, and an unparseable structured line is untrusted.
 */
export declare function containsSecretShape(text: string): boolean;
/**
 * Replace credential-shaped spans in free text with a readable marker. Exported
 * for direct text callers and tests; journal payloads use the whole-payload
 * marker instead.
 */
export declare function redactText(text: string): string;
/** Redact one journal payload string. */
export declare function redactPayload(text: string): string;
/**
 * Recursively redact an object or array: a secret-named key keeps its name and
 * hides its value, and a string carrying a credential shape becomes the payload
 * marker. Nesting and cycles are bounded.
 */
export declare function redactValue(value: unknown, depth?: number, seen?: WeakSet<object>): unknown;
