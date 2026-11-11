import { verifyAdoptionEvidence } from './adoption.js';
import { verifyEvidence } from './evidence.js';
import { evaluateArchiveGate } from './gates.js';
import { reviewerBinding, taskReviewCoverage } from './parity.js';
import { issueAdoptionReceipt, listReceipts } from './receipts.js';
import { hasTamperedRuns, listAuthenticatedRuns } from './runs.js';
/** The archive gate's decision with the evidence already read. */
export async function decideArchiveAuthorization(workspace, change, deps) {
    const specRecord = await verifyEvidence({
        kind: 'record',
        rule: 'spec-review',
        change,
        phase: 'spec',
        scope: 'whole',
        verdict: 'PASS',
        digest: 'current',
    }, { workspace, values: { name: change } });
    const taskReviewOwned = deps.definitions.some((definition) => definition.id === 'task-review' && definition.settings.gateOwnership === 'own');
    // While the shipped rule is deferred, the legacy archive gate still guards
    // the agent path; a click runs the CLI directly, so the marker's enabled
    // portable rule must be enforced here instead.
    const clickedRule = deps.clickedTaskReview !== undefined && 'rule' in deps.clickedTaskReview
        ? deps.clickedTaskReview.rule
        : undefined;
    const markerInvalid = !taskReviewOwned && deps.clickedTaskReview !== undefined && 'invalid' in deps.clickedTaskReview
        ? deps.clickedTaskReview.invalid
        : undefined;
    const rule = taskReviewOwned ? 'task-review' : clickedRule;
    const coverage = rule === undefined ? undefined : taskReviewCoverage(workspace, change, rule);
    return evaluateArchiveGate({
        change,
        tamperedRuns: deps.auth === undefined ? false : await hasTamperedRuns(workspace, deps.auth),
        runs: deps.auth === undefined ? [] : await listAuthenticatedRuns(workspace, deps.auth),
        receipts: deps.auth === undefined ? [] : await listReceipts(workspace, deps.auth),
        specRecord,
        ...(coverage === undefined && markerInvalid === undefined
            ? {}
            : {
                taskReview: coverage === undefined
                    ? { ok: false, text: markerInvalid }
                    : {
                        ok: coverage.ok,
                        ...(coverage.gaps.length === 0 ? {} : { text: coverage.gaps.join('; ') }),
                    },
            }),
    });
}
function bounded(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 300);
}
/**
 * The portable-approval rule the click must enforce while the legacy archive
 * gate owns task approvals: the workspace marker's enabled rule. A malformed
 * marker is a refusal, not an off switch.
 */
function clickedTaskReview(workspace) {
    const binding = reviewerBinding(workspace);
    if (binding?.invalid !== undefined)
        return { invalid: binding.invalid };
    if (binding?.archiveGate !== true)
        return undefined;
    return { rule: binding.taskRule ?? 'task-review' };
}
/**
 * The click is the authorization: verify the change artifacts and the current
 * whole-spec PASS, write the host-signed adoption receipt for the click, then
 * apply the same decision the agent archive path applies.
 */
export async function authorizeUserArchive(workspace, change, auth, definitions, now) {
    const verified = await verifyAdoptionEvidence(workspace, change);
    if (!verified.ok)
        return verified;
    try {
        await issueAdoptionReceipt(workspace, change, verified.digest, auth, now);
    }
    catch (error) {
        return {
            ok: false,
            reason: `the archive authorization receipt could not be written: ${bounded(error)}`,
        };
    }
    const clicked = clickedTaskReview(workspace);
    const decision = await decideArchiveAuthorization(workspace, change, {
        auth,
        definitions,
        ...(clicked === undefined ? {} : { clickedTaskReview: clicked }),
    });
    return decision.kind === 'allow' ? { ok: true } : { ok: false, reason: decision.reason };
}
