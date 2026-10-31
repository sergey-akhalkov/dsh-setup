import { parallelWidth } from './metrics.js';
/**
 * Attention findings: derivations over the episode metadata that say when a run
 * went the wrong way even though every plugin loaded. The first rule is the
 * serial long run, because activity alone is mistaken for value.
 */
/** Steps above which a single episode is a long run. */
export const SERIAL_RUN_STEPS = 40;
/** Active minutes above which a single episode is a long run. */
export const SERIAL_RUN_MINUTES = 20;
/** One episode's parallel width over its joined children. */
export function episodeParallelWidth(entry) {
    return parallelWidth(entry.children);
}
/**
 * A long episode whose child sessions never overlapped. A run with overlapping
 * children is not reported, and an empty window reports nothing.
 */
export function serialRunFindings(work) {
    const serial = work.filter((entry) => (entry.steps >= SERIAL_RUN_STEPS || entry.activeMs >= SERIAL_RUN_MINUTES * 60_000) &&
        episodeParallelWidth(entry) <= 1);
    if (serial.length === 0)
        return [];
    const longest = serial.reduce((best, entry) => (entry.steps > best.steps ? entry : best));
    const minutes = Math.round(longest.activeMs / 60_000);
    const width = episodeParallelWidth(longest);
    return [
        {
            id: 'serial-long-run',
            severity: 'attention',
            title: 'A long run carried the work on one stream',
            evidence: `${String(serial.length)} long episode${serial.length === 1 ? '' : 's'} ran with a parallel width of at most one; the longest (${longest.episode.id}) recorded ${String(longest.steps)} steps, ${String(minutes)} active minutes, and a width of ${String(width)}.`,
            episodeIds: serial.map((entry) => entry.episode.id),
            nextAction: 'Name two to four independent streams and their files, or record why the work must stay serial; a long single stream is not evidence that the task had one lane.',
        },
    ];
}
