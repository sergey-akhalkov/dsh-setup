import { CHANGE_NAME } from './command-parse.js'
import { type EvidenceCheck, type EvidenceContext, verifyEvidence } from './evidence.js'
import type { HumanQuestionService } from './executors.js'
import type { HostAuth } from './host-auth.js'
import { issueAdoptionReceipt, type WorkflowReceipt } from './receipts.js'

/**
 * Adoption of a change that predates the workflow engine. Only the
 * user-started `/workflows adopt <name>` path reaches this module: it verifies
 * the existing artifacts and the current whole-spec PASS record, asks the user,
 * and writes the host-authenticated receipt without recreating the directory
 * and without calling `openspec new change`.
 */

export interface AdoptionInput {
  readonly workspace: string
  readonly change: string
  readonly auth: HostAuth
  /** Only the user-started command passes true; the model path is refused. */
  readonly userStarted: boolean
  readonly questions?: HumanQuestionService
  readonly now?: number
}

export type AdoptionResult =
  | { readonly ok: true; readonly receipt: WorkflowReceipt }
  | { readonly ok: false; readonly reason: string }

function evidenceContext(workspace: string, change: string): EvidenceContext {
  return { workspace, values: { name: change } }
}

/**
 * Verify the four change artifacts and the current whole-spec `PASS` record.
 * Returns the verified spec digest when the change is adoptable.
 */
export async function verifyAdoptionEvidence(
  workspace: string,
  change: string,
): Promise<
  { readonly ok: true; readonly digest: string } | { readonly ok: false; readonly reason: string }
> {
  if (!CHANGE_NAME.test(change)) {
    return { ok: false, reason: `"${change}" is not a valid change name` }
  }
  const context = evidenceContext(workspace, change)
  const files: EvidenceCheck = await verifyEvidence(
    {
      kind: 'all',
      items: [
        { kind: 'file', path: 'openspec/changes/{name}/proposal.md' },
        { kind: 'file', path: 'openspec/changes/{name}/design.md' },
        { kind: 'file', path: 'openspec/changes/{name}/tasks.md' },
        { kind: 'file', path: 'openspec/changes/{name}/specs/**/spec.md', glob: true },
      ],
    },
    context,
  )
  if (!files.ok) {
    return {
      ok: false,
      reason: `the change cannot be adopted: ${files.failure.reason} at ${files.failure.item ?? 'the change'} (${files.failure.detail})`,
    }
  }
  const record: EvidenceCheck = await verifyEvidence(
    {
      kind: 'record',
      rule: 'spec-review',
      change: '{name}',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
      path: '.dsh/delegation/spec-review/{name}/spec.json',
    },
    context,
  )
  if (!record.ok) {
    return {
      ok: false,
      reason: `the change cannot be adopted: ${record.failure.reason} (${record.failure.detail})`,
    }
  }
  const digest = record.evidence.digest
  if (digest === undefined) {
    return { ok: false, reason: 'the whole-spec PASS record carries no digest' }
  }
  return { ok: true, digest }
}

/**
 * Adopt one existing change. The receipt is written only after the artifacts
 * and the current PASS record verify and the user answers yes.
 */
export async function adoptChange(input: AdoptionInput): Promise<AdoptionResult> {
  if (!input.userStarted) {
    return {
      ok: false,
      reason: 'adoption is user-started only; the model cannot invoke it',
    }
  }
  const verified = await verifyAdoptionEvidence(input.workspace, input.change)
  if (!verified.ok) return verified
  if (input.questions === undefined) {
    return {
      ok: false,
      reason: 'adoption needs a direct user confirmation, but the question service is unavailable',
    }
  }
  const asked = await input.questions.ask({
    question: `Adopt the existing change "${input.change}"? Its whole-spec review PASS is current.`,
    accepted: ['yes'],
    timeoutAction: 'cancel',
  })
  if (asked.timedOut === true) {
    return { ok: false, reason: 'the adoption question timed out; no receipt was written' }
  }
  if ((asked.answer ?? '').trim().toLowerCase() !== 'yes') {
    return { ok: false, reason: 'the user did not confirm; no receipt was written' }
  }
  // The workspace may have changed while the question was open; only re-verified
  // evidence with the same digest may be signed.
  const reconfirmed = await verifyAdoptionEvidence(input.workspace, input.change)
  if (!reconfirmed.ok) {
    return {
      ok: false,
      reason: `the change changed while the confirmation was pending; no receipt was written (${reconfirmed.reason})`,
    }
  }
  if (reconfirmed.digest !== verified.digest) {
    return {
      ok: false,
      reason:
        'the change or its whole-spec record changed while the confirmation was pending; no receipt was written',
    }
  }
  const receipt = await issueAdoptionReceipt(
    input.workspace,
    input.change,
    reconfirmed.digest,
    input.auth,
    input.now,
  )
  return { ok: true, receipt }
}
