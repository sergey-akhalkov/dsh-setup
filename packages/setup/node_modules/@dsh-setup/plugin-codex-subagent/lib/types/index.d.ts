/**
 * Forked installed-CLI Codex subagent provider for `@dsh-setup/plugin-codex-subagent`.
 *
 * Vendored from `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3 (MIT, Copyright
 * (c) 2026 DeepSeek) and patched locally: installed-CLI discovery through
 * `codexPath` or PATH, `codex --version` validation, Windows shim handling,
 * read-only/workspace-write provider instances, and the status tool. See
 * `NOTICE` and `README.md` in this package.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import type { CodexPermissionMode, CodexSandboxMode } from './run.js'

export declare const name = '@dsh-setup/plugin-codex-subagent'
export declare const inject: string[]
/** Discovery failure with an actionable message naming `codexPath` and the status tool. */
export declare class CodexCliError extends Error {}
/** Deployment-owned installed-CLI, model, environment, and process-release settings. */
export interface Config {
  /** Installed Codex path or command name; omitted to resolve `codex` on PATH. */
  codexPath?: string
  /** Native Codex model fixed for both instances; omitted to inherit Codex settings. */
  model?: string
  /** Explicit environment entries layered over the subprocess seam's scrub. */
  env?: Record<string, string>
  /** Grace in milliseconds between app-server managed-range termination tiers. */
  disposeGraceMs?: number
}
export declare const Config: z<Config>
/** Where the resolved executable came from. */
export type CodexDiscoverySource = 'config' | 'PATH'
/** One resolved installed-Codex identity. */
export interface CodexCliInfo {
  readonly path: string
  readonly version: string
  readonly source: CodexDiscoverySource
}
/** Inputs shared by discovery and the status tool. */
export interface CodexResolveOptions {
  readonly codexPath?: string
  readonly env?: Record<string, string>
  readonly cwd: string
  readonly graceMs?: number
  readonly signal?: AbortSignal
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
}
/** Status-tool value; `path`/`version`/`source` are absent when discovery failed. */
export interface CodexSubagentStatus {
  readonly found: boolean
  readonly path?: string
  readonly version?: string
  readonly source?: CodexDiscoverySource
  readonly snippet: string
  readonly error?: string
}
export declare function discoverCodexPath(
  codexPath: string | undefined,
  env: Record<string, string | undefined>,
  platform?: string,
): { path?: string; source: CodexDiscoverySource }
export declare function parseCodexVersion(output: string): string | undefined
export declare function codexSpawnArgv(
  executable: string,
  args: readonly string[],
  platform?: string,
  env?: Record<string, string | undefined>,
): string[]
export declare function resolveCodexCli(options: CodexResolveOptions): Promise<CodexCliInfo>
export declare function codexSubagentStatus(
  options: CodexResolveOptions,
): Promise<CodexSubagentStatus>
/**
 * Register both Codex provider instances and the status tool.
 * @param ctx - context carrying shared subagent, subprocess, and tools services.
 * @param config - optional installed-CLI path, model, child environment, and disposal grace.
 */
export declare function apply(ctx: Context, config?: Config): void
export type { CodexPermissionMode, CodexSandboxMode }
