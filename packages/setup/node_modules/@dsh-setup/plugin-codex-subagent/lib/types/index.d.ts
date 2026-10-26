/**
 * Forked bundled/installed-Codex subagent provider for `@dsh-setup/plugin-codex-subagent`.
 *
 * Vendored from `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3 (MIT, Copyright
 * (c) 2026 DeepSeek) and patched locally: resolution from `codexPath`, then the
 * pinned bundled `@openai/codex` platform binary, then PATH; `codex --version`
 * validation; fixed Serena MCP `-c` overrides; target model/reasoning-effort
 * mapping; Windows shim handling; read-only/workspace-write provider instances;
 * and the status tool. See `NOTICE` and `README.md` in this package.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import type { CodexPermissionMode, CodexSandboxMode } from './run.js'

export declare const name = '@dsh-setup/plugin-codex-subagent'
export declare const inject: string[]
/** Discovery failure with an actionable message naming `codexPath` and the status tool. */
export declare class CodexCliError extends Error {}
/** Deployment-owned CLI, model, effort, environment, and process-release settings. */
export interface Config {
  /** Installed Codex path or command name; omitted to use the bundled binary, then PATH. */
  codexPath?: string
  /** Default native Codex model for both instances; a target may override it. */
  model?: string
  /** Default Codex reasoning effort; a target may override it. */
  reasoningEffort?: string
  /** Explicit environment entries layered over the subprocess seam's scrub. */
  env?: Record<string, string>
  /** Grace in milliseconds between app-server managed-range termination tiers. */
  disposeGraceMs?: number
}
export declare const Config: z<Config>
/** Where the resolved executable came from. */
export type CodexDiscoverySource = 'config' | 'bundled' | 'PATH'
/** One resolved Codex identity. */
export interface CodexCliInfo {
  readonly path: string
  readonly version: string
  readonly source: CodexDiscoverySource
  /** Installed `@openai/codex` package version, when the dependency resolves. */
  readonly bundledVersion?: string
}
/** Bundled-package resolution result (path absent when the platform binary is missing). */
export interface BundledCodexInfo {
  readonly path?: string
  readonly version?: string
}
/** Inputs shared by discovery and the status tool. */
export interface CodexResolveOptions {
  readonly codexPath?: string
  readonly env?: Record<string, string>
  readonly cwd: string
  readonly graceMs?: number
  readonly signal?: AbortSignal
  readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle
  /** Test seam: pass `{}` to simulate an absent bundled package. */
  readonly bundled?: BundledCodexInfo
}
/** Status-tool value; `path`/`version`/`source` are absent when discovery failed. */
export interface CodexSubagentStatus {
  readonly found: boolean
  readonly path?: string
  readonly version?: string
  readonly source?: CodexDiscoverySource
  readonly bundledVersion?: string
  /** Fixed Serena MCP command line passed to the app-server. */
  readonly serena: string
  /** Paste-ready login command for the resolved CLI (or `codex login`). */
  readonly loginCommand: string
  /** Codex home used as-is; never rewritten. */
  readonly codexHome: string
  readonly snippet: string
  readonly error?: string
}
/** Pinned Serena MCP command and base arguments from the Serena adapter row. */
export declare const SERENA_MCP_COMMAND: string
export declare const SERENA_MCP_ARGS: readonly string[]
/** Per-run Serena arguments with `--project` set to the exact run cwd. */
export declare function serenaArgsFor(cwd: string): string[]
/** Fixed `-c` overrides appended to the app-server argv. */
export declare const SERENA_CONFIG_OVERRIDES: readonly string[]
/** Serena tools disabled for both provider instances (mutation + activation). */
export declare const SERENA_DISABLED_TOOLS: readonly string[]
/** Fixed `-c` override that removes those tools from the child. */
export declare const SERENA_DISABLED_TOOLS_OVERRIDES: readonly string[]
/** Throwaway per-run Serena home config file name. */
export declare const SERENA_CONFIG_FILENAME: string
/**
 * Create a throwaway Serena home for one run, precreating the configured
 * project data folder for the run's working directory.
 */
export declare function createSerenaHome(cwd: string): string
/** Pinned bundled npm package name. */
export declare const BUNDLED_CODEX_PACKAGE: string
export declare function codexTargetTriple(platform: string, arch: string): string | undefined
export declare function bundledCodexInfo(): BundledCodexInfo
export declare function discoverCodexPath(
  codexPath: string | undefined,
  env: Record<string, string | undefined>,
  platform?: string,
  bundled?: BundledCodexInfo,
): { path?: string; source: CodexDiscoverySource }
export declare function parseCodexVersion(output: string): string | undefined
/** Build one spawn argv/env/cleanup; a Windows CMD shim uses a batch wrapper. */
export declare function codexSpawnPlan(
  executable: string,
  args: readonly string[],
  options?: {
    platform?: string
    env?: Record<string, string | undefined>
  },
): {
  argv: string[]
  env: Record<string, string>
  cleanup: () => void
}
/** Fixed `codex app-server --stdio` argument list (without the executable). */
export declare function codexAppServerArgs(cwd: string, serenaHome: string): string[]
/** Paste-ready `<cli> login` command for a resolved executable. */
export declare function codexLoginCommand(executable?: string): string
/** Render the fixed Serena MCP command line. */
export declare function serenaCommandLine(): string
export declare function resolveCodexCli(options: CodexResolveOptions): Promise<CodexCliInfo>
export declare function codexSubagentStatus(
  options: CodexResolveOptions,
): Promise<CodexSubagentStatus>
/**
 * Register both Codex provider instances and the status tool.
 * @param ctx - context carrying shared subagent, subprocess, and tools services.
 * @param config - optional CLI path, model, effort, child environment, and disposal grace.
 */
export declare function apply(ctx: Context, config?: Config): void
export type { CodexPermissionMode, CodexSandboxMode }
