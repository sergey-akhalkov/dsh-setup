import { createHash } from 'node:crypto';
import { ExportError, messageOf } from './export-errors.js';
/** Version of the exporter's own metadata files, not of the Hindsight archive. */
export const METADATA_SCHEMA_VERSION = 1;
/** The transfer archive schema version this exporter understands. */
export const TRANSFER_SCHEMA_VERSION = 1;
/** Managed tree layout inside the export repository. */
export const BANKS_DIR = 'banks';
/** Per-bank metadata: original bank id, counts, scope, and per-file checksums. */
export const BANK_METADATA_FILE = 'export.json';
/** Repository index: every bank snapshot and the hash of the snapshot content. */
export const INDEX_FILE = 'index.json';
/** Hex SHA-256 of a byte sequence. */
export function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function sha256Text(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
/**
 * Reversible encoding of a bank id into one Windows-safe path segment.
 * Colons, slashes, spaces, and dots are percent-encoded, so the result has no
 * separator, no trailing dot or space, and no reserved device name.
 */
export function sanitizeBankId(bankId) {
    let encoded = '';
    for (const byte of Buffer.from(bankId, 'utf8')) {
        const character = String.fromCharCode(byte);
        encoded += /[A-Za-z0-9_-]/.test(character)
            ? character
            : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return encoded;
}
/** Inverse of {@link sanitizeBankId}; restore reads the id from metadata instead. */
export function unsanitizeBankId(encoded) {
    const bytes = [];
    for (let index = 0; index < encoded.length; index += 1) {
        const character = encoded[index] ?? '';
        if (character !== '%') {
            bytes.push(character.charCodeAt(0));
            continue;
        }
        const hex = encoded.slice(index + 1, index + 3);
        if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
            throw new ExportError('archive', `"${encoded}" is not a sanitized bank id`);
        }
        bytes.push(Number.parseInt(hex, 16));
        index += 2;
    }
    return Buffer.from(bytes).toString('utf8');
}
/**
 * The one folder a bank occupies. The id hash breaks the collisions a
 * case-insensitive filesystem would otherwise create between distinct bank ids.
 */
export function bankFolderName(bankId) {
    return `${sanitizeBankId(bankId)}-${sha256Text(bankId).slice(0, 8)}`;
}
function scopedPath(path, scope) {
    if (!scope.includeHistory && (path === 'history' || path.startsWith('history/')))
        return false;
    if (!scope.includeAttachments &&
        (path === 'attachments.json' || path === 'blobs' || path.startsWith('blobs/'))) {
        return false;
    }
    return true;
}
/**
 * Drop the archive sections the row did not enable. Attachments ride with the
 * data section on the wire, so this filter is what keeps the default export
 * free of attachment bytes.
 */
export function applyArchiveScope(entries, scope) {
    const scoped = new Map();
    for (const [path, bytes] of entries) {
        if (scopedPath(path, scope))
            scoped.set(path, bytes);
    }
    return scoped;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJsonFile(entries, path) {
    const bytes = entries.get(path);
    if (bytes === undefined)
        throw new ExportError('archive', `archive is missing ${path}`);
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    catch (error) {
        throw new ExportError('archive', `${path} is not valid JSON: ${messageOf(error)}`, {
            cause: error,
        });
    }
}
function count(record, key) {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
function hasSection(entries, prefix) {
    for (const path of entries.keys()) {
        if (path.startsWith(prefix))
            return true;
    }
    return false;
}
/** Build one bank folder: the scoped verbatim entries plus `export.json`. */
export function buildBankFiles(options) {
    const files = applyArchiveScope(options.entries, options.scope);
    const manifest = parseJsonFile(files, 'manifest.json');
    if (!isRecord(manifest))
        throw new ExportError('archive', 'manifest.json is not an object');
    if (manifest.schema_version !== TRANSFER_SCHEMA_VERSION) {
        throw new ExportError('archive', `unsupported transfer schema version ${String(manifest.schema_version)}`);
    }
    if (manifest.archive_type !== 'bank') {
        throw new ExportError('archive', `manifest.json is not a whole-bank archive`);
    }
    if (manifest.source_bank_id !== options.bankId) {
        throw new ExportError('archive', `archive names bank "${String(manifest.source_bank_id)}", expected "${options.bankId}"`);
    }
    const checksums = {};
    for (const path of [...files.keys()].sort()) {
        const bytes = files.get(path);
        if (bytes !== undefined)
            checksums[path] = sha256Hex(bytes);
    }
    const metadata = {
        schema_version: METADATA_SCHEMA_VERSION,
        bank_id: options.bankId,
        exported_at: options.exportedAt,
        operation_id: options.operationId,
        archive_schema_version: TRANSFER_SCHEMA_VERSION,
        archive_type: 'bank',
        counts: {
            documents: count(manifest, 'document_count'),
            facts: count(manifest, 'fact_count'),
            observations: count(manifest, 'observation_count'),
            mentalModels: count(manifest, 'mental_model_count'),
            knowledgePages: count(manifest, 'knowledge_page_count'),
            directives: count(manifest, 'directive_count'),
            webhooks: count(manifest, 'webhook_count'),
            attachments: count(manifest, 'attachment_count'),
        },
        includes_history: hasSection(files, 'history/'),
        includes_attachments: files.has('attachments.json'),
        checksums,
    };
    const withMetadata = new Map(files);
    withMetadata.set(BANK_METADATA_FILE, new TextEncoder().encode(JSON.stringify(metadata, null, 2)));
    return { files: withMetadata, metadata };
}
/** Serialize `index.json` in a stable order: banks sorted by id. */
export function buildRepositoryIndex(updatedAt, contentHash, entries) {
    const index = {
        schema_version: METADATA_SCHEMA_VERSION,
        updated_at: updatedAt,
        content_hash: contentHash,
        banks: [...entries].sort((left, right) => left.bank_id.localeCompare(right.bank_id)),
    };
    return new TextEncoder().encode(JSON.stringify(index, null, 2));
}
/** Read `index.json`; missing or invalid content means no usable previous snapshot. */
export function parseRepositoryIndex(bytes) {
    try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (!isRecord(parsed) || parsed.schema_version !== METADATA_SCHEMA_VERSION)
            return undefined;
        if (typeof parsed.content_hash !== 'string' || !Array.isArray(parsed.banks))
            return undefined;
        return parsed;
    }
    catch {
        return undefined;
    }
}
/** Read a stored bank's metadata; a missing or foreign file is an archive error. */
export function parseBankMetadata(bytes) {
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
    }
    catch (error) {
        throw new ExportError('archive', `${BANK_METADATA_FILE} is not valid JSON: ${messageOf(error)}`, {
            cause: error,
        });
    }
    if (!isRecord(parsed) || typeof parsed.bank_id !== 'string') {
        throw new ExportError('archive', `${BANK_METADATA_FILE} has no bank id`);
    }
    if (parsed.schema_version !== METADATA_SCHEMA_VERSION) {
        throw new ExportError('archive', `${BANK_METADATA_FILE} has an unsupported schema version`);
    }
    if (!isRecord(parsed.checksums)) {
        throw new ExportError('archive', `${BANK_METADATA_FILE} has no checksums`);
    }
    return parsed;
}
