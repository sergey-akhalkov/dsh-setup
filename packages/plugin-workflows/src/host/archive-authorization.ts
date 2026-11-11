import { verifyAdoptionEvidence } from './adoption.js'
import type { Definition } from './definitions.js'
import { type EvidenceCheck, verifyEvidence } from './evidence.js'
import { type ArchiveGateDecision, evaluateArchiveGate } from './gates.js'
import type { HostAuth } from './host-auth.js'
import { taskReviewCoverage } from './parity.js'
import { issueAdoptionReceipt, listReceipts } from './receipts.js'
import { hasTamperedRuns, listAuthenticatedRuns } from './runs.js'

/**
 * The one archive decision for the agent pre-execute gate. The user-clicked
 * service does not call it: the click is the final authorization.
 */

export interface ArchiveEvidenceDeps {
  /** The host key; absent means no authenticated run or receipt can count. */
  readonly auth?: HostAuth
  /** The installed definitions, for the shipped task-review ownership. */
  readonly definitions: readonly Definition[]
}

/** The archive gate's decision with the evidence already read. */
export async function decideArchiveAuthorization(
  workspace: string,
  change: string,
  deps: ArchiveEvidenceDeps,
): Promise<ArchiveGateDecision> {
  const specRecord: EvidenceCheck = await verifyEvidence(
    {
      kind: 'record',
      rule: 'spec-review',
      change,
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
    },
    { workspace, values: { name: change } },
  )
  const taskReviewOwned = deps.definitions.some(
    (definition) => definition.id === 'task-review' && definition.settings.gateOwnership === 'own',
  )
  const coverage = taskReviewOwned ? taskReviewCoverage(workspace, change) : undefined
  return evaluateArchiveGate({
    change,
    tamperedRuns: deps.auth === undefined ? false : await hasTamperedRuns(workspace, deps.auth),
    runs: deps.auth === undefined ? [] : await listAuthenticatedRuns(workspace, deps.auth),
    receipts: deps.auth === undefined ? [] : await listReceipts(workspace, deps.auth),
    specRecord,
    ...(coverage === undefined
      ? {}
      : {
          taskReview: {
            ok: coverage.ok,
            ...(coverage.gaps.length === 0 ? {} : { text: coverage.gaps.join('; ') }),
          },
        }),
  })
}

/** The host service a feature plugin reads as `workflowsArchiveGate`. */
export interface WorkflowsArchiveGateService {
  authorizeAndCheck(
    workspace: string,
    change: string,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
}

export type ArchiveAuthorizationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

function bounded(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 300)
}

/**
 * The click is the final authorization: verify the change artifacts and the
 * current whole-spec PASS, then write the host-signed adoption receipt for the
 * click. The agent command path still applies the full archive gate, but a stuck
 * review run or a pending task approval can no longer block the user's explicit
 * click.
 */
export async function authorizeUserArchive(
  workspace: string,
  change: string,
  auth: HostAuth,
  now?: number,
): Promise<ArchiveAuthorizationResult> {
  const verified = await verifyAdoptionEvidence(workspace, change)
  if (!verified.ok) return verified
  try {
    await issueAdoptionReceipt(workspace, change, verified.digest, auth, now)
  } catch (error) {
    return {
      ok: false,
      reason: `the archive authorization receipt could not be written: ${bounded(error)}`,
    }
  }
  return { ok: true }
}
