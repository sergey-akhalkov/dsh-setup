/**
 * One-shot Codex child lifecycle: spawn the installed CLI's app-server through
 * the subprocess seam, publish only after initialization and ephemeral thread
 * creation, flatten post-publication failures, and dispose to whole-range
 * quiescence.
 *
 * Vendored from `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3 and patched for
 * installed-CLI resolution; the lifecycle itself is retained upstream code.
 *
 * @module @dsh-setup/plugin-codex-subagent/run
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { type SubagentRun, type SubagentStartRequest, type SubagentStopReason } from '@deepseek-ai/dsh-subagent'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { CodexAppServerWire } from './wire.js'
/** Default POSIX grace between subprocess termination tiers. */
export declare const DEFAULT_DISPOSE_GRACE_MS = 3000
/** Profile-selectable non-interactive Codex permission mode. */
export type CodexPermissionMode = 'never' | 'approve-for-me' | 'dangerously-bypass-approvals-and-sandbox'
/** Sandbox fixed per provider instance. */
export type CodexSandboxMode = 'read-only' | 'workspace-write'
/** Native non-interactive Codex modes mapped to official `thread/start` fields. */
export declare const CODEX_PERMISSION_MODES: readonly [
  'never',
  'approve-for-me',
  'dangerously-bypass-approvals-and-sandbox',
]
/** Sandbox modes the fork fixes per provider instance. */
export declare const CODEX_SANDBOX_MODES: readonly ['read-only', 'workspace-write']
/** Safe default for unattended Codex runs. */
export declare const DEFAULT_CODEX_PERMISSION_MODE: CodexPermissionMode
/**
 * Hide an unpublished Host failure behind fixed safe startup facts.
 * @param cause Original Host failure retained for internal diagnostics.
 * @param codexVersion - installed CLI version included in the diagnostic.
 * @returns A startup failure whose message contains only fixed safe facts.
 */
export declare function codexStartupFailure(cause: unknown, codexVersion?: string): Error
/**
 * Fixed app-server command for one resolved installed CLI.
 * @param codexPath - resolved installed Codex executable.
 * @returns the spawn argv for `codex app-server --stdio`.
 */
export declare function codexAppServerArgv(codexPath: string): string[]
/** Fully resolved inputs for one Codex app-server run. */
export interface CodexRunSpec {
  /** Selected child working directory, also supplied to `thread/start`. */
  readonly cwd: string
  /** Resolved installed Codex executable. */
  readonly codexPath: string
  /** Recorded `codex --version` value, included in failure diagnostics. */
  readonly codexVersion: string
  /** Sandbox fixed for this provider instance. */
  readonly sandbox: CodexSandboxMode
  /** Profile-selected native model; omitted to preserve Codex settings. */
  readonly model?: string
  /** Profile-selected native non-interactive permission mode. */
  readonly permissionMode: CodexPermissionMode
  /** Explicit deployment/test environment layered after the shared scrub. */
  readonly env: Record<string, string>
  /** Subprocess termination grace passed to the shared managed-range owner. */
  readonly disposeGraceMs: number
  /** Shared subprocess service spawn operation. */
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Diagnostic sink for a post-publication error flattened into a result. */
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}
/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
export declare function textTask(prompt: readonly ContentBlock[]): string[]
/**
 * Close the private wire, terminate the managed range, and wait for the
 * subprocess owner to prove it is quiescent.
 * @param wire - private app-server protocol connection.
 * @param child - shared-service handle that owns the managed range.
 * @param codexVersion - installed CLI version included in a teardown failure.
 */
export declare function disposeCodexChild(
  wire: CodexAppServerWire,
  child: SubprocessHandle,
  codexVersion: string,
): Promise<void>
/**
 * Start the installed `codex app-server --stdio` child and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after initialization and ephemeral thread creation.
 */
export declare function startCodexRun(
  request: SubagentStartRequest,
  spec: CodexRunSpec,
): Promise<SubagentRun>
