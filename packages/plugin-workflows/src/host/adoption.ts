import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import { type EvidenceCheck, type EvidenceContext, verifyEvidence } from './evidence.js'
import type { HumanQuestionService } from './executors.js'
import type { HostAuth } from './host-auth.js'
import { issueAdoptionReceipt, type WorkflowReceipt } from './receipts.js'

/**
 * Adoption of a change that predates the workflow engine. The user-started
 * `/workflows adopt <name>` command and the model-facing `workflows` tool action
 * `adopt` both reach this module: it verifies the existing artifacts and the
 * current whole-spec PASS record, asks the user through the host question
 * service, and writes the host-authenticated receipt without recreating the
 * directory and without calling `openspec new change`. The interactive user
 * answer is the authorization; the model cannot supply it.
 */

export interface AdoptionInput {
  readonly workspace: string
  readonly change: string
  readonly auth: HostAuth
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
 * The first linked path beneath the change directory, if any. The evidence
 * reader follows an artifact link inside the workspace while the spec digest
 * skips links, so a link could change the adopted content without changing the
 * digest; adoption requires real files only.
 */
async function linkedChangePath(workspace: string, change: string): Promise<string | undefined> {
  const root = join(workspace, 'openspec', 'changes', change)
  for (const relative of [
    join('openspec', 'changes', change),
    join('openspec', 'changes'),
    'openspec',
  ]) {
    const absolute = join(workspace, relative)
    const info = await lstat(absolute).catch(() => undefined)
    if (info?.isSymbolicLink() === true) return relative
  }
  const stack = [root]
  while (stack.length > 0) {
    const directory = stack.pop()
    if (directory === undefined) break
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const info = await lstat(absolute).catch(() => undefined)
      if (info === undefined) continue
      if (info.isSymbolicLink()) return absolute.slice(workspace.length + 1)
      if (info.isDirectory()) stack.push(absolute)
    }
  }
  return undefined
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
  const linked = await linkedChangePath(workspace, change)
  if (linked !== undefined) {
    return {
      ok: false,
      reason: `the change cannot be adopted: "${linked}" is a symbolic link; adoption requires real files`,
    }
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
