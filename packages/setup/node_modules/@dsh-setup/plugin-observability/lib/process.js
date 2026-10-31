import { distribution, parallelWidth } from './metrics.js';
/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint';
/** Whether a worker's span is alive anywhere inside the window. */
function intersects(start, end, window) {
    if (start === end)
        return start >= window.from && start < window.to;
    return start < window.to && end > window.from;
}
/** A worker's observed span; a single recorded instant counts at that instant. */
function observedSpan(start, end, window) {
    if (!intersects(start, end, window))
        return undefined;
    if (start === end)
        return { from: start, to: Math.min(start + 1, window.to) };
    return { from: Math.max(start, window.from), to: Math.min(end, window.to) };
}
/**
 * A valid reflection per episode, with the steps since the previous valid one.
 * A malformed call is not a reflection: it neither becomes a marker nor resets
 * the cadence, so the next gap covers the steps it pretended to account for.
 */
function reflectionMarkers(records, episodeId, window) {
    const ordered = [...records].sort((left, right) => left.time - right.time || left.seq - right.seq);
    const markers = [];
    let steps = 0;
    for (const record of ordered) {
        if (record.eventType === 'step/start') {
            steps += 1;
            continue;
        }
        if (record.eventType !== 'tool/call' || record.tool !== CHECKPOINT_TOOL)
            continue;
        if (record.checkpointOutcome === undefined)
            continue;
        if (record.time >= window.from && record.time < window.to) {
            markers.push({
                time: record.time,
                episodeId,
                outcome: record.checkpointOutcome,
                stepsSince: steps,
            });
        }
        steps = 0;
    }
    return markers;
}
/**
 * Burst starts: an episode's first worker activation while no other worker was
 * active. Its burst size is every worker joined to that episode. A worker that
 * starts while one is still running belongs to the burst already underway.
 */
function decompositionMarkers(work, window) {
    const candidates = [];
    for (const entry of work) {
        const children = [...entry.episode.children].sort((left, right) => left.start - right.start || left.sessionId.localeCompare(right.sessionId));
        children.forEach((child, index) => {
            candidates.push({
                time: child.start,
                end: child.end,
                episodeId: entry.episode.id,
                sessionId: child.sessionId,
                workers: children.length,
                first: index === 0,
            });
        });
    }
    candidates.sort((left, right) => left.time - right.time ||
        left.episodeId.localeCompare(right.episodeId) ||
        left.sessionId.localeCompare(right.sessionId));
    const started = [];
    const markers = [];
    for (const candidate of candidates) {
        // Only a worker that started strictly earlier is already active: two
        // episodes whose first workers start at the same instant after idle are
        // both burst starts, while the concurrency series still shows both at once.
        const busy = started.some((other) => other.time < candidate.time &&
            (other.end > other.time ? other.end > candidate.time : other.time + 1 > candidate.time));
        if (candidate.first && !busy && candidate.time >= window.from && candidate.time < window.to) {
            markers.push({
                time: candidate.time,
                episodeId: candidate.episodeId,
                workers: candidate.workers,
            });
        }
        started.push(candidate);
    }
    return markers;
}
/** The window's worker spans, markers, and the values the summary distributes. */
function processFacts(work, window) {
    const spans = [];
    const reflections = [];
    const timeToFirstWorker = [];
    let episodesWithWorker = 0;
    let activations = 0;
    for (const entry of work) {
        const episode = entry.episode;
        const children = episode.children;
        const active = children.filter((child) => intersects(child.start, child.end, window));
        if (active.length > 0) {
            episodesWithWorker += 1;
            const first = children.reduce((earliest, child) => Math.min(earliest, child.start), Number.POSITIVE_INFINITY);
            timeToFirstWorker.push(first - episode.start);
        }
        for (const child of active) {
            const span = observedSpan(child.start, child.end, window);
            if (span === undefined)
                continue;
            spans.push({
                sessionId: child.sessionId,
                episodeId: episode.id,
                from: span.from,
                to: span.to,
            });
            if (child.start >= window.from && child.start < window.to)
                activations += 1;
        }
        reflections.push(...reflectionMarkers(episode.records, episode.id, window));
    }
    spans.sort((left, right) => left.from - right.from || left.sessionId.localeCompare(right.sessionId));
    reflections.sort((left, right) => left.time - right.time || left.episodeId.localeCompare(right.episodeId));
    return {
        spans,
        decomposition: decompositionMarkers(work, window),
        reflections,
        episodes: work.length,
        episodesWithWorker,
        activations,
        timeToFirstWorker,
    };
}
/** The summary of the facts, with an absent average left absent rather than zero. */
function summaryOf(facts) {
    const workers = new Set(facts.spans.map((span) => span.sessionId)).size;
    const reflected = new Set(facts.reflections.map((marker) => marker.episodeId)).size;
    return {
        episodes: facts.episodes,
        workers,
        episodesWithWorker: facts.episodesWithWorker,
        activations: facts.activations,
        maxConcurrency: parallelWidth(facts.spans.map((span) => ({ start: span.from, end: span.to }))),
        timeToFirstWorker: distribution(facts.timeToFirstWorker),
        reflections: facts.reflections.length,
        stepsBetweenReflections: distribution(facts.reflections.map((marker) => marker.stepsSince)),
        ...(facts.episodes === 0
            ? {}
            : {
                reflectionsPerEpisode: facts.reflections.length / facts.episodes,
                reflectionCoverage: reflected / facts.episodes,
            }),
        decompositionObserved: workers > 0,
    };
}
/** The worker-concurrency step series, anchored at the window start. */
function concurrencySeries(spans, window) {
    if (spans.length === 0)
        return [];
    const changes = new Map();
    const add = (time, delta) => {
        changes.set(time, (changes.get(time) ?? 0) + delta);
    };
    for (const span of spans) {
        add(span.from, 1);
        add(span.to, -1);
    }
    const times = [...changes.keys()].sort((left, right) => left - right);
    const points = [];
    let active = 0;
    for (const time of times) {
        if (points.length === 0 && time > window.from)
            points.push({ time: window.from, active: 0 });
        active += changes.get(time) ?? 0;
        points.push({ time, active });
    }
    return points;
}
/** The window's process summary; exported for the report's baseline side. */
export function processSummary(work, window) {
    return summaryOf(processFacts(work, window));
}
function comparisonOf(basis, interventionAt, before, after, minEpisodes) {
    // Either side below the minimum reads insufficient, never an improvement.
    const insufficient = before.episodes < minEpisodes || after.episodes < minEpisodes;
    return {
        basis,
        ...(interventionAt === undefined ? {} : { interventionAt }),
        before: { summary: before },
        after: { summary: after },
        status: insufficient ? 'insufficient' : 'association',
        label: insufficient ? 'insufficient data' : 'association, not proof',
        minEpisodes,
    };
}
/** Split the window's episodes at the configured date, or compare with the baseline. */
function comparisonFor(options, current) {
    const interventionAt = options.interventionAt;
    if (interventionAt !== undefined) {
        const before = processSummary(options.work.filter((entry) => entry.episode.start < interventionAt), options.window);
        const after = processSummary(options.work.filter((entry) => entry.episode.start >= interventionAt), options.window);
        return comparisonOf('intervention date', interventionAt, before, after, options.minEpisodes);
    }
    if (options.baseline === undefined)
        return undefined;
    return comparisonOf(options.baseline.kind, undefined, options.baseline.summary, current, options.minEpisodes);
}
/** Build the window's process timeline, summary, and comparison. */
export function buildProcessTimeline(options) {
    const facts = processFacts(options.work, options.window);
    const summary = summaryOf(facts);
    const comparison = comparisonFor(options, summary);
    return {
        from: options.window.from,
        to: options.window.to,
        workers: facts.spans.map((span) => ({
            sessionId: span.sessionId,
            episodeId: span.episodeId,
            from: span.from,
            to: span.to,
        })),
        concurrency: concurrencySeries(facts.spans, options.window),
        decomposition: facts.decomposition,
        reflections: facts.reflections,
        stepRate: options.stepRate,
        summary,
        ...(comparison === undefined ? {} : { comparison }),
    };
}
