/**
 * The deterministic shell command parser for the two OpenSpec actions the
 * workflow gates enforce. It accepts only the three documented invocation
 * forms and a single validated change name; a compound command, extra token,
 * shell control character, or unparseable name is not matched. The archive gate
 * and the file watcher are the backstop for a bypass, not this parser.
 */
import { posix, win32 } from 'node:path';
import { NAME_CAPTURE } from './definitions.js';
import { globMatches, segmentGlobMatches } from './evaluate.js';
/** A change name as the interpolation and draft path rules require it. */
export const CHANGE_NAME = /^[a-z0-9][a-z0-9-]*$/u;
/** Shell control characters that make a compound or redirected command. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: a newline or control byte is a compound command
const CONTROL = /[\u0000-\u001f`;&|><]/u;
/** Whether the command carries a shell control, quote escape, or substitution. */
function isCompound(trimmed) {
    return (trimmed === '' ||
        CONTROL.test(trimmed) ||
        trimmed.includes(String.fromCharCode(92)) ||
        trimmed.includes('$'));
}
/** Strip one allowed invocation prefix. */
function stripPrefix(command) {
    const match = /^(?:(?:rtk\s+)|(?:pnpm\s+exec\s+))?(openspec\s+.*)$/u.exec(command);
    if (match === null)
        return undefined;
    return match[1];
}
/** Remove one symmetric quote pair, or fail when the token is not quoted. */
function unquote(token) {
    if (token.length < 2)
        return undefined;
    const first = token[0];
    if (first !== '"' && first !== "'")
        return undefined;
    if (token.at(-1) !== first)
        return undefined;
    const inner = token.slice(1, -1);
    if (inner.includes(first) || /["']/u.test(inner))
        return undefined;
    return inner;
}
/** A non-empty validated change name token. */
function nameOf(token) {
    if (token === undefined)
        return undefined;
    const unquoted = unquote(token);
    const name = unquoted ?? token;
    return CHANGE_NAME.test(name) ? name : undefined;
}
/**
 * Parse one shell command. Returns undefined for anything that is not exactly
 * one documented, unquoted-name `openspec new change` or `openspec archive`.
 */
export function parseOpenspecCommand(command) {
    const trimmed = command.trim();
    if (isCompound(trimmed))
        return undefined;
    const rest = stripPrefix(trimmed);
    if (rest === undefined)
        return undefined;
    const tokens = rest.split(/\s+/u);
    if (tokens[0] !== 'openspec')
        return undefined;
    if (tokens[1] === 'new' && tokens[2] === 'change' && tokens.length === 4) {
        const name = nameOf(tokens[3]);
        return name === undefined ? undefined : { kind: 'create-change', name };
    }
    if (tokens[1] === 'archive' && tokens.length >= 3) {
        const operands = [];
        for (let index = 2; index < tokens.length; index += 1) {
            const token = tokens[index] ?? '';
            if (token === '--store' || token === '-s') {
                index += 1;
                continue;
            }
            if (token.startsWith('-'))
                continue;
            operands.push(token);
        }
        if (operands.length !== 1)
            return undefined;
        const rawName = operands[0];
        const change = nameOf(process.platform === 'win32' && rawName !== undefined ? rawName.toLowerCase() : rawName);
        return change === undefined ? undefined : { kind: 'archive', change };
    }
    return undefined;
}
/* ------------------------------------------------------------------ */
/* content-agnostic trigger matching                                   */
/* ------------------------------------------------------------------ */
/**
 * Normalize one command for a `match.command` template: trim, collapse
 * whitespace, and strip one documented `rtk` or `pnpm exec` invocation prefix.
 * A compound command, a shell control, a backslash, or a substitution returns
 * undefined and never matches; the archive gate re-parses its own exceptions.
 */
export function normalizeCommand(command) {
    // A horizontal tab separates shell tokens exactly like a space; a newline or
    // another control character still makes the command compound.
    const trimmed = command.replaceAll('\t', ' ').trim();
    if (isCompound(trimmed))
        return undefined;
    const withoutPrefix = trimmed.replace(/^(?:(?:rtk)|(?:pnpm\s+exec))\s+/u, '');
    return withoutPrefix.replace(/\s+/gu, ' ').trim();
}
/**
 * Match one normalized command against a `match.command` template. A template
 * with `{name}` matches its literal prefix and suffix and captures one
 * unquoted, validated change name; a template without a capture is compared
 * literally and behaves as before.
 */
export function matchCommandTemplate(template, command) {
    const normalized = normalizeCommand(command);
    if (normalized === undefined)
        return undefined;
    const collapsed = template.replace(/\s+/gu, ' ').trim();
    const at = collapsed.indexOf(NAME_CAPTURE);
    if (at < 0)
        return normalized === collapsed ? {} : undefined;
    // Keep the literal separators: a capture is one complete token between them,
    // so `openspec new changeauth` cannot match `openspec new change {name}`.
    const prefix = collapsed.slice(0, at);
    const suffix = collapsed.slice(at + NAME_CAPTURE.length);
    if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix))
        return undefined;
    if (normalized.length < prefix.length + suffix.length)
        return undefined;
    const middle = normalized.slice(prefix.length, normalized.length - suffix.length);
    const name = nameOf(middle);
    return name === undefined ? undefined : { capture: name };
}
/**
 * Match one workspace path against a `match.path` glob. The single `{name}`
 * segment captures one validated change name; every other segment keeps the
 * existing glob syntax.
 */
export function matchPathTemplate(pattern, path) {
    if (!pattern.includes(NAME_CAPTURE)) {
        return globMatches(pattern, path) ? {} : undefined;
    }
    const patternSegments = pattern.split('/');
    const pathSegments = path.split('/');
    let capture;
    const walk = (patternIndex, pathIndex) => {
        if (patternIndex === patternSegments.length)
            return pathIndex === pathSegments.length;
        const segment = patternSegments[patternIndex];
        if (segment === '**') {
            for (let index = pathIndex; index <= pathSegments.length; index += 1) {
                if (walk(patternIndex + 1, index))
                    return true;
            }
            return false;
        }
        if (pathIndex >= pathSegments.length)
            return false;
        const value = pathSegments[pathIndex] ?? '';
        if (segment === NAME_CAPTURE) {
            if (capture !== undefined || !CHANGE_NAME.test(value))
                return false;
            const previous = capture;
            capture = value;
            if (walk(patternIndex + 1, pathIndex + 1))
                return true;
            capture = previous;
            return false;
        }
        return segmentGlobMatches(segment ?? '', value) && walk(patternIndex + 1, pathIndex + 1);
    };
    return walk(0, 0) ? (capture === undefined ? {} : { capture }) : undefined;
}
/** The archive directory a move must target. */
export const ARCHIVE_DIR = 'openspec/changes/archive';
function unquotedPath(token) {
    if (token === undefined)
        return undefined;
    const withoutQuotes = token.replace(/^['"]|['"]$/gu, '').replaceAll('\\', '/');
    const absolute = withoutQuotes.startsWith('/');
    const parts = withoutQuotes.split('/').filter((part) => part !== '' && part !== '.');
    return `${absolute ? '/' : ''}${parts.join('/')}`;
}
function pathKey(path) {
    return process.platform === 'win32' ? path.toLowerCase() : path;
}
function changeUnderChanges(path) {
    const match = /^openspec\/changes\/([^/]+)$/u.exec(pathKey(path));
    const name = match?.[1];
    return name !== undefined && CHANGE_NAME.test(name) ? name : undefined;
}
function targetsArchive(destination) {
    const key = pathKey(destination);
    if (key === ARCHIVE_DIR)
        return true;
    return new RegExp(`^${ARCHIVE_DIR}/[^/]+$`, 'u').test(key);
}
function normalizeAbsolute(path) {
    const resolved = /^[A-Za-z]:\//u.test(path)
        ? win32.normalize(path).replaceAll('\\', '/')
        : posix.normalize(path);
    return resolved.startsWith('./') ? resolved.slice(2) : resolved;
}
function workspaceRelative(path, workspace, base) {
    if (workspace === undefined)
        return path;
    const normalized = path.replaceAll('\\', '/');
    const root = normalizeAbsolute(workspace.replaceAll('\\', '/').replace(/\/+$/u, ''));
    const baseRoot = normalizeAbsolute((base ?? workspace).replaceAll('\\', '/').replace(/\/+$/u, ''));
    const absolute = normalizeAbsolute(/^[A-Za-z]:\//u.test(normalized) || normalized.startsWith('/')
        ? normalized
        : `${baseRoot}/${normalized}`);
    const fold = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (fold(absolute) === fold(root))
        return '';
    if (fold(absolute).startsWith(`${fold(root)}/`))
        return absolute.slice(root.length + 1);
    return undefined;
}
function archiveMove(source, destination, form, workspace, base) {
    const relativeSource = source === undefined ? undefined : workspaceRelative(source, workspace, base);
    const relativeDestination = destination === undefined ? undefined : workspaceRelative(destination, workspace, base);
    const name = relativeSource === undefined ? undefined : changeUnderChanges(relativeSource);
    if (name === undefined ||
        relativeDestination === undefined ||
        !targetsArchive(relativeDestination)) {
        return undefined;
    }
    return { kind: 'archive', change: name, form };
}
/**
 * Parse an archive action: the documented `openspec archive <name>` form, or a
 * move of `openspec/changes/<name>` into `openspec/changes/archive/` through
 * `mv`, PowerShell `Move-Item`, or `git mv`. A compound command, another
 * destination, or an unparseable name is not an archive.
 */
function tokenize(command) {
    const tokens = [];
    let current = '';
    let quote;
    for (const char of command) {
        if (quote !== undefined) {
            if (char === quote)
                quote = undefined;
            else
                current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/u.test(char)) {
            if (current !== '') {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (quote !== undefined)
        return undefined;
    if (current !== '')
        tokens.push(current);
    return tokens;
}
function parameter(token) {
    const lower = token.toLowerCase();
    if (!lower.startsWith('-'))
        return { name: lower };
    const colon = lower.indexOf(':');
    const equals = lower.indexOf('=');
    const index = colon >= 0 ? colon : equals;
    if (index < 0)
        return { name: lower };
    return { name: lower.slice(0, index), inline: token.slice(index + 1) };
}
function parseMoveOperands(tokens, start, workspace, base, form) {
    const switches = new Set([
        '-f',
        '--force',
        '-v',
        '--verbose',
        '-verbose',
        '-n',
        '--no-clobber',
        '-i',
        '--interactive',
        '-u',
        '--update',
        '-k',
        '--keep-going',
        '-force',
        '-whatif',
        '-confirm',
        '-passthru',
        '-debug',
    ]);
    const valueParameters = new Set([
        '-ea',
        '-erroraction',
        '-wa',
        '-infa',
        '-ev',
        '-wv',
        '-ov',
        '-ob',
        '-pv',
        '-include',
        '-exclude',
        '-filter',
        '-pssession',
        '-certificate',
        '-credential',
        '-throttlelimit',
        '-fromsession',
        '-tosession',
        '-warningaction',
        '-informationaction',
        '-errorvariable',
        '-warningvariable',
        '-outvariable',
        '-outbuffer',
        '-pipelinevariable',
    ]);
    const destinationNames = new Set(['-t', '--target-directory', '-destination', '-dest', '-target']);
    const sourceNames = new Set(['-literalpath', '-lp', '-path', '-pspath']);
    const positional = [];
    let source;
    let destination;
    for (let index = start; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        if (token === '--')
            continue;
        const { name, inline } = parameter(token);
        if (destinationNames.has(name)) {
            destination = inline ?? tokens[index + 1];
            if (destination === undefined)
                return undefined;
            if (inline === undefined)
                index += 1;
            continue;
        }
        if (sourceNames.has(name)) {
            source = inline ?? tokens[index + 1];
            if (source === undefined)
                return undefined;
            if (inline === undefined)
                index += 1;
            continue;
        }
        if (valueParameters.has(name)) {
            if (inline === undefined) {
                if (tokens[index + 1] === undefined)
                    return undefined;
                index += 1;
            }
            continue;
        }
        if (name.startsWith('-')) {
            if (switches.has(name))
                continue;
            return undefined;
        }
        positional.push(token);
    }
    if (destination === undefined)
        destination = positional.pop();
    if (source === undefined)
        source = positional.shift();
    const sources = [
        ...(source === undefined ? [] : source.includes(',') ? source.split(',') : [source]),
        ...positional,
    ].filter((entry) => entry !== undefined && entry !== '');
    if (sources.length === 0 || destination === undefined)
        return undefined;
    if (sources.length > 1) {
        const relativeDestination = workspaceRelative(unquotedPath(destination) ?? '', workspace, base);
        return relativeDestination !== undefined && targetsArchive(relativeDestination)
            ? { kind: 'archive', change: '', form, multipleSources: true }
            : undefined;
    }
    return archiveMove(unquotedPath(sources[0]), unquotedPath(destination), form, workspace, base);
}
export function parseArchiveCommand(command, workspace, workdir) {
    const moveWorkspace = workdir ?? workspace;
    const trimmed = command.trim();
    // Moves carry Windows paths, so a backslash is data here; control characters are not.
    if (trimmed === '' || CONTROL.test(trimmed))
        return undefined;
    const openspec = parseOpenspecCommand(trimmed);
    if (openspec?.kind === 'archive') {
        return { kind: 'archive', change: openspec.change, form: 'openspec' };
    }
    const tokens = tokenize(trimmed);
    if (tokens === undefined)
        return undefined;
    const commandName = (tokens[0] ?? '').toLowerCase();
    const mvIndex = commandName === 'git' && (tokens[1] ?? '').toLowerCase() === 'mv'
        ? 2
        : commandName === 'mv'
            ? 1
            : 0;
    if (mvIndex > 0) {
        return parseMoveOperands(tokens, mvIndex, workspace, moveWorkspace, mvIndex === 2 ? 'git' : 'mv');
    }
    if (/^move-item$/iu.test(tokens[0] ?? '')) {
        return parseMoveOperands(tokens, 1, workspace, moveWorkspace, 'Move-Item');
    }
    return undefined;
}
