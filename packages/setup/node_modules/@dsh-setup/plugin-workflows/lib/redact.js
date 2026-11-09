/**
 * Redaction for the journal. Key-based redaction removes a secret-named object
 * field; a payload whose free text carries a secret key, an auth credential, or
 * a private-key block is untrusted as a whole and is replaced by one marker.
 * Replacing the whole summary is deliberate: a parser miss can lose text, never
 * leak a credential.
 */
/** Object keys that always hide their value. */
const SECRET_KEY = /^(?:authorization|proxy-authorization|token|api[_-]?key|apikey|password|secret|cookie)$/iu;
/** A secret key followed by a value, quoted or bare, anywhere in free text. */
const SECRET_KEY_VALUE = /\b(?:authorization|proxy-authorization|token|api[_-]?key|apikey|password|secret|cookie)\b\s*\\?["']?\s*[:=]/iu;
/** An auth scheme followed by a credential, outside a key-value pair. */
const AUTH_CREDENTIAL = /\b(?:Bearer|Basic|Digest|Negotiate|Token)\s+[A-Za-z0-9._~+/=-]+/iu;
/** A PEM private-key block, complete or truncated. */
const PRIVATE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu;
/** A JSON unicode escape can hide any key or value; treat it as untrusted. */
const UNICODE_ESCAPE = /\\u[0-9a-f]{4}/iu;
/** An escaped JSON document after prose still carries `\"` or `\x` escapes. */
const ESCAPED_STRUCTURE = /\\(?:["/]|u[0-9a-f]{4}|x[0-9a-f]{2})/iu;
/** Percent or HTML entity encoding can hide a key after a prose prefix. */
const WEB_ENCODING = /%[0-9a-f]{2}|&#(?:x[0-9a-f]+|\d+);|&[a-z][a-z0-9]+;/iu;
/** The marker a key-based field or a whole untrusted payload becomes. */
export const REDACTED = '[REDACTED]';
/** The marker a summary carrying any credential shape becomes. */
export const REDACTED_PAYLOAD = '[REDACTED PAYLOAD]';
/** The raw, undecoded credential shapes. */
function hasRawSecretShape(text) {
    return SECRET_KEY_VALUE.test(text) || AUTH_CREDENTIAL.test(text) || PRIVATE_KEY.test(text);
}
/** Whether one decoded JSON value contains a secret key or nested JSON text. */
function scanDecoded(value, depth) {
    if (typeof value === 'string') {
        if (hasRawSecretShape(value) || UNICODE_ESCAPE.test(value))
            return true;
        const trimmed = value.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
            // Nested JSON text: decode it, or refuse it once the bound is reached.
            if (depth >= 8)
                return true;
            try {
                return scanDecoded(JSON.parse(trimmed), depth + 1);
            }
            catch {
                return true;
            }
        }
        return false;
    }
    if (Array.isArray(value)) {
        return value.some((entry) => scanDecoded(entry, depth + 1));
    }
    if (value !== null && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
            if (SECRET_KEY.test(key) || scanDecoded(entry, depth + 1))
                return true;
        }
    }
    return false;
}
/**
 * Whether free text carries any credential shape at all. Raw key/value pairs,
 * auth credentials, and PEM blocks are checked directly; a line that looks like
 * JSON is decoded so an escaped key or multiply serialized document is
 * inspected, and an unparseable structured line is untrusted.
 */
export function containsSecretShape(text) {
    if (hasRawSecretShape(text) ||
        UNICODE_ESCAPE.test(text) ||
        ESCAPED_STRUCTURE.test(text) ||
        WEB_ENCODING.test(text)) {
        return true;
    }
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"'))
            continue;
        try {
            if (scanDecoded(JSON.parse(trimmed), 0))
                return true;
        }
        catch {
            return true;
        }
    }
    return false;
}
/**
 * Replace credential-shaped spans in free text with a readable marker. Exported
 * for direct text callers and tests; journal payloads use the whole-payload
 * marker instead.
 */
export function redactText(text) {
    return text
        .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu, '[REDACTED PRIVATE KEY]')
        .replace(/\b(authorization|proxy-authorization|cookie)\b(\s*[:=]\s*)[^\n]*/giu, `$1$2${REDACTED}`)
        .replace(/\b(authorization|proxy-authorization|token|api[_-]?key|apikey|password|secret|cookie)\b(["']?)(\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|(?:Basic|Bearer|Digest|Negotiate|Token)\s+[A-Za-z0-9._~+/=-]+|[^\s,;{}]+)/giu, (_match, key, quote, separator) => {
        const value = quote === '' ? REDACTED : `${quote}${REDACTED}${quote}`;
        return `${key}${quote}${separator}${value}`;
    })
        .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${REDACTED}`)
        .replace(/\b(Basic|Digest|Negotiate|Token)\s+[A-Za-z0-9._~+/=-]+/giu, `$1 ${REDACTED}`);
}
/** Redact one journal payload string. */
export function redactPayload(text) {
    return containsSecretShape(text) ? REDACTED_PAYLOAD : text;
}
/**
 * Recursively redact an object or array: a secret-named key keeps its name and
 * hides its value, and a string carrying a credential shape becomes the payload
 * marker. Nesting and cycles are bounded.
 */
export function redactValue(value, depth = 0, seen = new WeakSet()) {
    if (typeof value === 'string')
        return redactPayload(value);
    if (value === null || typeof value !== 'object')
        return value;
    if (depth >= 8 || seen.has(value))
        return REDACTED;
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((entry) => redactValue(entry, depth + 1, seen));
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        output[key] = SECRET_KEY.test(key) ? REDACTED : redactValue(entry, depth + 1, seen);
    }
    return output;
}
