/**
* MIT fork of `@deepseek-ai/dsh-subagent-codex` 0.2.1-rc.3 (Copyright (c)
* 2026 DeepSeek) for `@dsh-setup/plugin-codex-subagent`. Local patch: resolve
* Codex from `codexPath`, then the pinned bundled `@openai/codex` platform
* binary, then `codex` on `PATH`, validate it with `codex --version`, pass fixed
* Serena MCP `-c` overrides and the target model/reasoning effort to the 0.164
* app-server, spawn Windows shims through ComSpec, register read-only and
* workspace-write providers, and expose `codex_subagent_status`. The app-server
* protocol adapter, lifecycle, cancellation, and teardown code are retained
* from upstream. See NOTICE and README.md in this package.
*/
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { NO_START_CAPABILITIES, assertPositiveFinite, assertUsableCwd, settleRunResult, subprocessRunHandle } from "@deepseek-ai/dsh-subagent";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { randomUUID } from "node:crypto";
import { accessSync, constants as fsConstants, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
//#region lib/types/resolve.js
/**
* Bundled/installed Codex discovery, version validation, Serena MCP config,
* login guidance, and Windows command-line handling. This region is the fork's
* local patch: upstream resolved only its own `@openai/codex` wrapper and had no
* Serena, login, or target-option mapping.
*
* The resolved executable path is trusted local configuration, never model
* input. It is always its own argv entry; the delegation prompt never touches a
* command line and reaches the app-server through stdin.
*/
/** Cap for the `codex --version` probe; a hanging shim must not stall a run. */
const CODEX_VERSION_TIMEOUT_MS = 1e4;
/** Point at the supported remedies in every discovery/validation failure. */
const CODEX_PATH_HINT = "set the `codexPath` config key on the `dsh-setup-codex-subagent` row, reinstall the `@openai/codex` dependency, or run the `codex_subagent_status` tool for the resolved source and a paste-ready snippet";
/** Package-local diagnostic prefix shared with the retained upstream code. */
const CODEX_ERROR_PREFIX = "subagent-codex: ";
/** Pinned bundled Codex npm package; its platform optional dependency ships the binary. */
const BUNDLED_CODEX_PACKAGE = "@openai/codex";
/** Fixed Codex home display; the child deliberately keeps the user's real `~/.codex`. */
const CODEX_HOME_DISPLAY = "~/.codex";
/** Serena MCP server command from `packages/plugin-serena/cordis.fragment.yml`. */
const SERENA_MCP_COMMAND = "uvx";
/** Pinned Serena arguments from the same row, including the vscode context. */
const SERENA_MCP_ARGS = [
	"--from",
	"serena-agent==1.7.0",
	"serena",
	"start-mcp-server",
	"--context=vscode",
	"--enable-web-dashboard=false",
	// No GUI log window on a fatal error inside the Harness process.
	"--enable-gui-log-window=false"
];
/**
* Per-run Serena arguments: the exact run working directory is the project.
* `--project` is used instead of `--project-from-cwd` because the latter resolves
* the nearest ancestor with `.git`/`.serena`, which would activate an ancestor
* project for a nested run cwd and could rewrite its checkout `.serena`.
* @param cwd - the run's exact working directory.
* @returns the pinned Serena arguments for this run.
*/
function serenaArgsFor(cwd) {
	return [
		...SERENA_MCP_ARGS,
		"--project",
		cwd
	];
}
/** Throwaway Serena home config file name used for each run. */
const SERENA_CONFIG_FILENAME = "serena_config.yml";
/**
* Build the minimal per-run Serena configuration. Empty
* `trusted_project_path_patterns` keeps `--project` activation from running an
* inherited activation_command; `projects: []` is required by Serena's loader;
* `project_serena_folder_location` points at the throwaway home so project data
* never falls back to (and rewrites) the checkout `.serena`.
* @param home - throwaway Serena home for this run.
* @returns the YAML config text.
*/
function serenaConfigContent(home) {
	return [
		"projects: []",
		"trusted_project_path_patterns: []",
		`project_serena_folder_location: ${JSON.stringify(`${home.replaceAll("\\", "/")}/projects/$projectFolderName`)}`,
		""
	].join("\n");
}
/**
* Create a throwaway Serena home for one run so project activation never uses
* the user's `~/.serena` config, runs its trusted activation hooks, or writes
* project data into the session checkout. The configured project data folder is
* precreated so Serena does not fall back to an existing checkout `.serena`.
* @param cwd - the run's working directory, whose basename names the project.
* @returns the temporary home directory containing the minimal config.
*/
function createSerenaHome(cwd) {
	const home = mkdtempSync(join(tmpdir(), "dsh-serena-home-"));
	try {
		mkdirSync(join(home, "projects", basename(cwd)), {
			recursive: true
		});
		writeFileSync(join(home, SERENA_CONFIG_FILENAME), serenaConfigContent(home), {
			encoding: "utf8",
			mode: 384
		});
	} catch (error) {
		rmSync(home, {
			recursive: true,
			force: true
		});
		throw error;
	}
	return home;
}
/**
* Best-effort removal of one run's throwaway Serena home.
* @param home - temporary home created for the run, when it exists.
*/
function removeSerenaHome(home) {
	if (home === void 0) return;
	try {
		rmSync(home, {
			recursive: true,
			force: true
		});
	} catch {}
}
/** Local scratch file mapping review keys to Codex thread ids. */
const REVIEW_THREAD_STATE_FILE = "codex-review-threads.json";
/**
* Local scratch path for review thread ids, inside the delegation state.
* @param cwd - review working directory.
* @returns the state file path.
*/
function reviewThreadStatePath(cwd) {
	return join(cwd, ".dsh", "delegation", REVIEW_THREAD_STATE_FILE);
}
/**
* Read valid review-thread entries. A missing, corrupt, or foreign file is
* treated as empty so a review starts a fresh thread instead of failing.
* @param cwd - review working directory.
* @returns the valid entries.
*/
function readReviewThreads(cwd) {
	try {
		const parsed = JSON.parse(readFileSync(reviewThreadStatePath(cwd), "utf8"));
		if (parsed === null || typeof parsed !== "object" || !Array.isArray(parsed.threads)) return [];
		return parsed.threads.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.key === "string" && entry.key.length > 0 && typeof entry.threadId === "string" && entry.threadId.length > 0 && typeof entry.cwd === "string" && typeof entry.sandbox === "string");
	} catch {
		return [];
	}
}
/**
* Find a reusable thread for one review key, confined to the same cwd and
* sandbox. A mismatched entry is ignored so a key cannot cross confinement.
* @param cwd - review working directory.
* @param reviewKey - change + task/phase key supplied by the engine.
* @param sandbox - fixed provider sandbox.
* @returns the persisted thread id, when reusable.
*/
function findReviewThread(cwd, reviewKey, sandbox) {
	const entry = readReviewThreads(cwd).find((candidate) => candidate.key === reviewKey);
	return entry === void 0 || entry.cwd !== cwd || entry.sandbox !== sandbox ? void 0 : entry.threadId;
}
let reviewThreadStateTail = Promise.resolve();
/**
* Persist one review key's thread id under the delegation state. Writes are
* serialized and merged with concurrent keys; failure is best-effort and never
* fails the review.
* @param cwd - review working directory.
* @param reviewKey - change + task/phase key supplied by the engine.
* @param threadId - started thread id.
* @param sandbox - fixed provider sandbox.
* @returns a promise settling after the write attempt.
*/
function rememberReviewThread(cwd, reviewKey, threadId, sandbox) {
	const write = reviewThreadStateTail.then(() => {
		const threads = readReviewThreads(cwd).filter((entry) => entry.key !== reviewKey);
		threads.push({
			key: reviewKey,
			threadId,
			cwd,
			sandbox
		});
		const path = reviewThreadStatePath(cwd);
		mkdirSync(dirname(path), { recursive: true });
		const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify({
				version: 1,
				threads
			}, null, 2)}\n`, {
				encoding: "utf8",
				mode: 384
			});
			renameSync(temporary, path);
		} finally {
			try {
				rmSync(temporary, { force: true });
			} catch {}
		}
	});
	reviewThreadStateTail = write.catch(() => {});
	return write.catch(() => {});
}
/**
* Fixed Codex `-c` overrides for Serena. Values never come from model input and
* the user's `~/.codex/config.toml` is never rewritten. `enabled=true` wins over
* an inherited `enabled=false`, and `required=true` makes a missing Serena
* runtime fail the run instead of silently dropping its tools; the timeouts
* mirror the Serena row's first-call allowance. The per-run args are added by
* `codexAppServerArgs`.
*/
const SERENA_CONFIG_OVERRIDES = [
	"-c",
	`mcp_servers.serena.command=${SERENA_MCP_COMMAND}`,
	"-c",
	"mcp_servers.serena.enabled=true",
	"-c",
	"mcp_servers.serena.required=true",
	"-c",
	"mcp_servers.serena.startup_timeout_sec=120",
	"-c",
	"mcp_servers.serena.tool_timeout_sec=120"
];
/** Official `@openai/codex` platform package names by Rust target triple. */
const PLATFORM_PACKAGE_BY_TARGET = {
	"x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
	"aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
	"x86_64-apple-darwin": "@openai/codex-darwin-x64",
	"aarch64-apple-darwin": "@openai/codex-darwin-arm64",
	"x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
	"aarch64-pc-windows-msvc": "@openai/codex-win32-arm64"
};
/** Discovery or validation failure with a model-safe, actionable message. */
var CodexCliError = class extends Error {
	constructor(message) {
		super(`${CODEX_ERROR_PREFIX}${message}`);
		this.name = "CodexCliError";
	}
};
/** Extension ordering used when scanning PATH for a Windows command shim. */
const WINDOWS_COMMAND_EXTENSIONS = [
	".com",
	".exe",
	".bat",
	".cmd"
];
function isFile(path) {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}
function isExecutableFile(path) {
	if (!isFile(path)) return false;
	if (process.platform !== "win32") try {
		accessSync(path, fsConstants.X_OK);
	} catch {
		return false;
	}
	return true;
}
/**
* Map one Node platform/arch pair to the official Codex Rust target triple.
* @param platform - `process.platform` value.
* @param arch - `process.arch` value.
* @returns the target triple, or undefined for an unsupported combination.
*/
function codexTargetTriple(platform, arch) {
	if (platform === "linux" || platform === "android") {
		if (arch === "x64") return "x86_64-unknown-linux-musl";
		if (arch === "arm64") return "aarch64-unknown-linux-musl";
		return void 0;
	}
	if (platform === "darwin") {
		if (arch === "x64") return "x86_64-apple-darwin";
		if (arch === "arm64") return "aarch64-apple-darwin";
		return void 0;
	}
	if (platform === "win32") {
		if (arch === "x64") return "x86_64-pc-windows-msvc";
		if (arch === "arm64") return "aarch64-pc-windows-msvc";
		return void 0;
	}
	return void 0;
}
/**
* Resolve the pinned `@openai/codex` platform binary installed with this
* package. It follows the official wrapper's layout: the platform optional
* dependency's `vendor/<triple>/bin/codex{,.exe}`, with the main package's
* `vendor/` as the documented fallback. Never throws and never returns a
* package-local wrapper script: a missing platform binary is simply unresolved.
* @returns the bundled executable path and/or the installed package version.
*/
function bundledCodexInfo() {
	try {
		const requireFromHere = createRequire(import.meta.url);
		const manifestPath = requireFromHere.resolve(`${BUNDLED_CODEX_PACKAGE}/package.json`);
		const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
		const target = codexTargetTriple(process.platform, process.arch);
		if (target === void 0) return { version };
		const platformPackage = PLATFORM_PACKAGE_BY_TARGET[target];
		let vendorRoot;
		try {
			vendorRoot = join(dirname(createRequire(manifestPath).resolve(`${platformPackage}/package.json`)), "vendor");
		} catch {
			vendorRoot = join(dirname(manifestPath), "vendor");
		}
		const executable = join(vendorRoot, target, "bin", process.platform === "win32" ? "codex.exe" : "codex");
		return isFile(executable) ? {
			path: executable,
			version
		} : { version };
	} catch {
		return {};
	}
}
function windowsExtensions(env) {
	const configured = (env.PATHEXT ?? "").split(";").map((extension) => extension.trim().toLowerCase()).filter((extension) => WINDOWS_COMMAND_EXTENSIONS.includes(extension));
	return configured.length > 0 ? configured : WINDOWS_COMMAND_EXTENSIONS;
}
/**
* Find a command on PATH with platform-correct candidate names.
* @param command - bare command name (never a path).
* @param env - child environment carrying PATH/PATHEXT.
* @param platform - target platform, injectable for tests.
* @returns the first resolvable absolute-or-PATH-relative file path.
*/
function findOnPath(command, env, platform = process.platform) {
	const pathValue = env.PATH ?? env.Path ?? "";
	const directories = pathValue.split(platform === "win32" ? ";" : ":").filter((directory) => directory.length > 0);
	if (platform === "win32") {
		const extensions = windowsExtensions(env);
		for (const directory of directories) for (const extension of extensions) {
			const candidate = join(directory, `${command}${extension}`);
			if (isFile(candidate)) return candidate;
		}
		return void 0;
	}
	for (const directory of directories) {
		const candidate = join(directory, command);
		if (isExecutableFile(candidate)) return candidate;
	}
	return void 0;
}
/**
* Apply the discovery order: explicit `codexPath` (absolute path, relative
* path, or command name), then the pinned bundled platform binary, then `codex`
* on PATH. A configured path is never silently replaced by another source.
* @param codexPath - the row's `codexPath` config, when set.
* @param env - child environment carrying PATH/PATHEXT.
* @param platform - target platform, injectable for tests.
* @param bundled - resolved bundled package info; pass `{}` to simulate an
* uninstalled package.
* @returns the path and its source (`config`, `bundled`, or `PATH`); path is
* absent when discovery failed.
*/
function discoverCodexPath(codexPath, env, platform = process.platform, bundled = bundledCodexInfo()) {
	if (codexPath !== void 0) {
		const namesPath = isAbsolute(codexPath) || codexPath.includes("/") || codexPath.includes("\\");
		if (namesPath) return {
			path: codexPath,
			source: "config"
		};
		const found = findOnPath(codexPath, env, platform);
		return found === void 0 ? { source: "config" } : {
			path: found,
			source: "config"
		};
	}
	if (bundled.path !== void 0) return {
		path: bundled.path,
		source: "bundled"
	};
	const found = findOnPath("codex", env, platform);
	return found === void 0 ? { source: "PATH" } : {
		path: found,
		source: "PATH"
	};
}
/**
* Extract the CLI version from `codex --version` (`codex-cli 0.164.0`).
* @param output - combined command output.
* @returns the semantic version token, or undefined when none is present.
*/
function parseCodexVersion(output) {
	return /\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/u.exec(output)?.[0];
}
/**
* Environment variable holding the quoted path of the temporary CMD wrapper.
* Reaching cmd through this variable keeps the wrapper path out of Node's
* ambiguous argv quoting; the value is quoted because the temp path may contain
* spaces or metacharacters.
*/
const CODEX_SHIM_WRAPPER_ENV = "CODEX_SHIM_WRAPPER";
/** Environment variable carrying the shim path into the ASCII batch wrapper. */
const CODEX_SHIM_EXECUTABLE_ENV = "CODEX_SHIM_EXECUTABLE";
/** Prefix for the per-argument environment variables read by the wrapper. */
const CODEX_SHIM_ARG_ENV_PREFIX = "CODEX_SHIM_ARG_";
/**
* Whether one executable needs the Windows command interpreter.
* @param executable - resolved CLI path.
* @param platform - target platform.
* @returns true for a `.cmd`/`.bat` shim on Windows.
*/
function isWindowsCommandShim(executable, platform = process.platform) {
	return platform === "win32" && [
		".cmd",
		".bat"
	].includes(extname(executable).toLowerCase());
}
/**
* Encode one value for insertion inside a quoted batch token. The batch wrapper
* itself stays ASCII and reads the value from the environment, so CMD's code
* page never decodes a Unicode path. Inside the quoted token CMD must keep
* metacharacters inert while the child's CRT argv parser recovers the exact
* text: each `"` becomes `""` (CMD-safe and CRT literal quote), and backslash
* runs immediately before a quote or at the end are doubled (CRT would
* otherwise consume one). Percent signs need no batch escape here: CMD expands
* `%NAME%` in one pass and does not rescan the inserted value. A line break
* cannot be represented in a batch line, so it is rejected.
* @param value - raw argument text.
* @returns the encoded value without outer quotes.
*/
function encodeBatchValue(value) {
	if (/[\r\n]/u.test(value)) throw new Error("cannot pass a CMD shim argument containing a line break");
	let encoded = "";
	for (let index = 0; index < value.length;) {
		const character = value[index];
		if (character === "\"") {
			encoded += "\"\"";
			index += 1;
			continue;
		}
		if (character === "\\") {
			let end = index;
			while (end < value.length && value[end] === "\\") end += 1;
			const run = value.slice(index, end);
			encoded += end === value.length || value[end] === "\"" ? run + run : run;
			index = end;
			continue;
		}
		encoded += character;
		index += 1;
	}
	return encoded;
}
/**
* Create an ASCII-only temporary batch wrapper. The shim path and every argument
* arrive through Unicode-preserving environment variables, so a non-ASCII
* workspace path is not decoded using the console code page.
* @param argCount - number of argument placeholders to expand.
* @returns the wrapper path, its environment, and a best-effort cleanup.
*/
function createShimWrapper(argCount) {
	const directory = mkdtempSync(join(tmpdir(), "dsh-codex-shim-"));
	const wrapper = join(directory, "run.cmd");
	const command = [`"%${CODEX_SHIM_EXECUTABLE_ENV}%"`, ...Array.from({ length: argCount }, (_, index) => `"%${CODEX_SHIM_ARG_ENV_PREFIX}${index}%"`)].join(" ");
	try {
		writeFileSync(wrapper, [
			"@echo off",
			command,
			""
		].join("\r\n"), {
			encoding: "ascii",
			mode: 384
		});
	} catch (error) {
		rmSync(directory, {
			recursive: true,
			force: true
		});
		throw error;
	}
	return {
		wrapper,
		cleanup: () => {
			try {
				rmSync(directory, {
					recursive: true,
					force: true
				});
			} catch {}
		}
	};
}
/**
* Build the spawn argv, environment, and cleanup for one Codex command. A
* Windows `.cmd`/`.bat` shim runs through an ASCII batch wrapper invoked by
* ComSpec; the Unicode shim path and arguments travel in the environment, so
* arbitrary workspace paths cannot inject commands, truncate arguments, or be
* corrupted by the console code page. An `.exe` is started directly. The prompt
* is never part of this argv.
* @param executable - resolved CLI path.
* @param args - fixed Codex subcommand arguments.
* @param options - target platform and environment supplying ComSpec.
* @returns the spawn argv, extra environment, and wrapper cleanup.
*/
function codexSpawnPlan(executable, args, options = {}) {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	if (!isWindowsCommandShim(executable, platform)) return {
		argv: [executable, ...args],
		env: {},
		cleanup: () => {}
	};
	const executableValue = encodeBatchValue(executable);
	const argValues = args.map((arg) => encodeBatchValue(arg));
	const { wrapper, cleanup } = createShimWrapper(argValues.length);
	const shimEnvironment = {
		[CODEX_SHIM_WRAPPER_ENV]: `"${wrapper}"`,
		[CODEX_SHIM_EXECUTABLE_ENV]: executableValue
	};
	for (const [index, arg] of argValues.entries()) shimEnvironment[`${CODEX_SHIM_ARG_ENV_PREFIX}${index}`] = arg;
	return {
		argv: [
			env.ComSpec ?? "cmd.exe",
			"/d",
			"/v:off",
			"/c",
			`%${CODEX_SHIM_WRAPPER_ENV}%`
		],
		env: shimEnvironment,
		cleanup
	};
}
/**
* Serena tools disabled for both provider instances: the mutating tools plus
* `activate_project`, whose trusted activation hook runs a shell outside the
* Codex sandbox. Names come from the pinned `serena-agent==1.7.0` vscode context
* (verified against the installed server). Serena's MCP server runs outside the
* Codex sandbox, so an inherited `approval_mode = "approve"` or activation hook
* could otherwise edit files or leave the isolated patch worktree; Codex writes
* must stay inside its sandbox.
*/
const SERENA_DISABLED_TOOLS = [
	"replace_content",
	"replace_in_files",
	"replace_symbol_body",
	"insert_after_symbol",
	"insert_before_symbol",
	"rename_symbol",
	"safe_delete_symbol",
	"write_memory",
	"edit_memory",
	"delete_memory",
	"rename_memory",
	"activate_project"
];
/** Fixed overrides that remove those tools from both provider instances. */
const SERENA_DISABLED_TOOLS_OVERRIDES = [
	"-c",
	`mcp_servers.serena.disabled_tools=${JSON.stringify(SERENA_DISABLED_TOOLS)}`
];
/**
* Fixed app-server arguments (without the executable) for one run.
* @param cwd - run working directory, also pinned as the Serena server cwd and project.
* @param serenaHome - per-run throwaway Serena home for the MCP child.
* @returns the `codex app-server --stdio` argument list.
*/
function codexAppServerArgs(cwd, serenaHome) {
	return [
		"app-server",
		"--stdio",
		...SERENA_CONFIG_OVERRIDES,
		"-c",
		`mcp_servers.serena.args=${JSON.stringify(serenaArgsFor(cwd))}`,
		"-c",
		`mcp_servers.serena.cwd=${JSON.stringify(cwd)}`,
		"-c",
		`mcp_servers.serena.env.SERENA_HOME=${JSON.stringify(serenaHome.replaceAll("\\", "/"))}`,
		...SERENA_DISABLED_TOOLS_OVERRIDES
	];
}
/**
* Paste-ready login command for one resolved CLI.
* @param executable - resolved CLI path, or undefined when discovery failed.
* @returns a shell-usable `<cli> login` command.
*/
function codexLoginCommand(executable) {
	const command = executable ?? "codex";
	return `${/\s/u.test(command) ? `"${command}"` : command} login`;
}
/**
* Authentication next action appended to a 401 diagnostic.
* @param executable - resolved CLI path.
* @returns the model-facing retry instruction.
*/
function codexLoginHint(executable) {
	return `Codex is not authenticated; run \`${codexLoginCommand(executable)}\` once (it writes ${CODEX_HOME_DISPLAY}) and retry`;
}
/**
* Render the Serena MCP command line for status output. The project is the run
* working directory, shown as a placeholder because status is not a run.
* @returns the command followed by its pinned arguments.
*/
function serenaCommandLine() {
	return [
		SERENA_MCP_COMMAND,
		...SERENA_MCP_ARGS,
		"--project",
		"<run working directory>"
	].join(" ");
}
function streamText(stream) {
	return new Promise((resolve, reject) => {
		if (stream === void 0) {
			resolve("");
			return;
		}
		let text = "";
		stream.on("data", (chunk) => {
			text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		});
		stream.once("error", reject);
		stream.once("end", () => resolve(text));
		stream.once("close", () => resolve(text));
	});
}
/**
* Run `codex --version` against one resolved executable and return its version.
* @param executable - resolved CLI path.
* @param spawn - subprocess service spawn operation.
* @param spec - cwd, duration-bounding signal, and environment overrides.
* @returns the parsed version string.
*/
async function runCodexVersion(executable, spawn, spec) {
	const args = ["--version"];
	let plan;
	let child;
	try {
		plan = codexSpawnPlan(executable, args, {
			env: {
				...process.env,
				...spec.env
			}
		});
		child = spawn({
			argv: plan.argv,
			cwd: spec.cwd,
			stdio: {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe"
			},
			graceMs: spec.graceMs ?? 3e3,
			env: {
				...spec.env,
				...plan.env
			},
			signal: spec.signal
		});
	} catch (error) {
		plan?.cleanup();
		throw new CodexCliError(`could not start "${executable}" for \`--version\`: ${error instanceof Error ? error.message : String(error)}; ${CODEX_PATH_HINT}`);
	}
	try {
		const [outcome, output, errors] = await Promise.all([
			child.done,
			streamText(child.stdout),
			streamText(child.stderr)
		]);
		if (outcome.exitCode !== 0) throw new CodexCliError(`"${executable}" failed \`--version\` with ${outcome.signal === null ? `exit code ${String(outcome.exitCode)}` : `signal ${outcome.signal}`}${errors.trim().length > 0 ? `: ${errors.trim()}` : ""}; ${CODEX_PATH_HINT}`);
		const version = parseCodexVersion(output);
		if (version === void 0) throw new CodexCliError(`"${executable}" did not report a version from \`--version\`${output.trim().length > 0 ? ` (output: ${JSON.stringify(output.trim().slice(0, 200))})` : ""}; ${CODEX_PATH_HINT}`);
		return version;
	} finally {
		plan.cleanup();
	}
}
/**
* Resolve and validate the bundled or installed Codex CLI.
* @param options - configured path, environment, spawn seam, cwd, grace,
* cancellation signal, and an optional bundled-info override for tests.
* @returns the resolved path, version, source (`config`, `bundled`, or `PATH`),
* and the installed bundled package version when known.
*/
async function resolveCodexCli(options) {
	const env = options.env ?? {};
	const bundled = options.bundled === void 0 ? bundledCodexInfo() : options.bundled;
	const discovered = discoverCodexPath(options.codexPath, {
		...process.env,
		...env
	}, process.platform, bundled);
	if (discovered.path === void 0) {
		const cause = options.codexPath === void 0 ? "no `codexPath` is configured, the bundled `@openai/codex` platform binary is not installed, and no `codex` command was found on PATH" : `\`codexPath\` ${JSON.stringify(options.codexPath)} was not found${options.codexPath.includes("/") || options.codexPath.includes("\\") || isAbsolute(options.codexPath) ? "" : " on PATH"}`;
		throw new CodexCliError(`Codex CLI not found: ${cause}; ${CODEX_PATH_HINT}`);
	}
	if (!isExecutableFile(discovered.path)) throw new CodexCliError(`resolved Codex CLI ${JSON.stringify(discovered.path)} is not an executable file; ${CODEX_PATH_HINT}`);
	const signal = options.signal === void 0 ? AbortSignal.timeout(CODEX_VERSION_TIMEOUT_MS) : AbortSignal.any([options.signal, AbortSignal.timeout(CODEX_VERSION_TIMEOUT_MS)]);
	return {
		path: discovered.path,
		version: await runCodexVersion(discovered.path, options.spawn, {
			cwd: options.cwd,
			env,
			graceMs: options.graceMs,
			signal
		}),
		source: discovered.source,
		bundledVersion: bundled.version
	};
}
/**
* Render the paste-ready profile row override that pins the resolved CLI.
* @param path - resolved path, or undefined when discovery failed.
* @returns one YAML row override for the profile's `cordis.patch.yml`.
*/
function codexPathSnippet(path) {
	return [
		"- id: dsh-setup-codex-subagent",
		"  config:",
		`    codexPath: ${path === void 0 ? "<absolute path to the installed codex executable>" : JSON.stringify(path)}`
	].join("\n");
}
/**
* Resolve the CLI and build the status-tool value without writing anything.
* @param options - configured path, environment, spawn seam, cwd, signal, and
* optional bundled-info override.
* @returns the reported fields (found, or error plus snippet), bundled version,
* Serena config summary, and login command.
*/
async function codexSubagentStatus(options) {
	const bundled = options.bundled === void 0 ? bundledCodexInfo() : options.bundled;
	const common = {
		bundledVersion: bundled.version,
		serena: serenaCommandLine(),
		codexHome: CODEX_HOME_DISPLAY
	};
	try {
		const resolved = await resolveCodexCli({
			...options,
			bundled
		});
		return {
			...common,
			found: true,
			path: resolved.path,
			version: resolved.version,
			source: resolved.source,
			loginCommand: codexLoginCommand(resolved.path),
			snippet: codexPathSnippet(resolved.path)
		};
	} catch (error) {
		return {
			...common,
			found: false,
			loginCommand: codexLoginCommand(void 0),
			snippet: codexPathSnippet(void 0),
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
function renderCodexSubagentStatus(report) {
	const sourceLabel = report.source === "config" ? "codexPath config" : report.source === "bundled" ? "bundled @openai/codex" : "PATH";
	const bundledLine = `bundled @openai/codex: ${report.bundledVersion === void 0 ? "not installed" : report.bundledVersion}`;
	const serenaLine = `Serena MCP (fixed): ${report.serena}`;
	const loginLines = [
		`Codex home: ${report.codexHome} (used as-is; never rewritten)`,
		`login: \`${report.loginCommand}\``
	];
	if (report.found) return [
		`Codex CLI ${report.version} (${sourceLabel})`,
		`path: ${report.path}`,
		bundledLine,
		serenaLine,
		...loginLines,
		"",
		"To pin this CLI, override the row in the profile's cordis.patch.yml (the status tool writes nothing):",
		"```yaml",
		report.snippet,
		"```"
	].join("\n");
	return [
		`Codex CLI unavailable: ${report.error}`,
		bundledLine,
		serenaLine,
		...loginLines,
		"",
		"Fix the bundled dependency, an explicit `codexPath`, or PATH, then re-run this tool. Paste-ready row override:",
		"```yaml",
		report.snippet,
		"```"
	].join("\n");
}
//#endregion
//#region lib/types/wire.js
/**
* Minimal Codex app-server protocol adapter, retained from upstream (written
* against 0.153.4 and verified against the installed 0.164.0). The shared
* JSON-RPC transport owns framing and request correlation; this module owns
* only the product methods, current thread/turn association, unattended
* approval responses, and terminal-answer selection.
*
* @module @deepseek-ai/dsh-subagent-codex/wire
*/
const THREAD_PERMISSION_PARAMS = {
	never: { approvalPolicy: "never" },
	"approve-for-me": {
		approvalPolicy: "on-request",
		approvalsReviewer: "auto_review",
		sandbox: "workspace-write"
	},
	"dangerously-bypass-approvals-and-sandbox": {
		approvalPolicy: "never",
		sandbox: "danger-full-access"
	}
};
function object(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`subagent-codex: app-server returned invalid ${label}`);
	return value;
}
function string(value, label) {
	if (typeof value !== "string" || value.length === 0) throw new Error(`subagent-codex: app-server returned invalid ${label}`);
	return value;
}
function unattendedDecision(params) {
	const available = params.availableDecisions;
	if (available === void 0 || available === null) return "decline";
	if (Array.isArray(available)) {
		if (available.includes("cancel")) return "cancel";
		if (available.includes("decline")) return "decline";
	}
	throw new Error("subagent-codex: app-server offered no unattended approval decision");
}
function numericHttpStatus(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535 ? value : void 0;
}
function objectFailureInfo(value) {
	const keys = Object.keys(value);
	const category = keys[0];
	if (keys.length !== 1 || category === void 0) return { category: "unknown" };
	const detail = value[category];
	if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return { category: "unknown" };
	const fields = detail;
	switch (category) {
		case "httpConnectionFailed":
		case "responseStreamConnectionFailed":
		case "responseStreamDisconnected":
		case "responseTooManyFailedAttempts": {
			const httpStatus = numericHttpStatus(fields.httpStatusCode);
			return httpStatus === void 0 ? { category: "transport" } : {
				category: "transport",
				httpStatus
			};
		}
		case "activeTurnNotSteerable": return { category: "product-error" };
		default: return { category: "unknown" };
	}
}
function failureInfo(turn) {
	if (turn.status !== "failed") return { category: "unknown" };
	const error = turn.error;
	if (error === null || typeof error !== "object" || Array.isArray(error)) return { category: "unknown" };
	const info = error.codexErrorInfo;
	if (typeof info === "string") switch (info) {
		case "contextWindowExceeded": return {
			category: "limit",
			maxTokens: true
		};
		case "sessionBudgetExceeded":
		case "usageLimitExceeded": return { category: "limit" };
		case "serverOverloaded":
		case "internalServerError": return { category: "service" };
		case "cyberPolicy":
		case "misalignmentPolicyViolation":
		case "unauthorized": return { category: "access-policy" };
		case "badRequest":
		case "threadRollbackFailed":
		case "other": return { category: "product-error" };
		case "sandboxError": return {
			category: "access-policy",
			sandboxFailure: true
		};
		default: return { category: "unknown" };
	}
	return info !== null && typeof info === "object" && !Array.isArray(info) ? objectFailureInfo(info) : { category: "unknown" };
}
function unattendedDiagnostic(mode, request, decision, reason) {
	return `Codex unattended decision (mode: ${mode}; request: ${request}; decision: ${decision}): ${reason}`;
}
function thrown$1(value) {
	/* v8 ignore next -- typed protocol and stream failures reject with Error. */
	return value instanceof Error ? value : new Error(String(value));
}
function abortError(signal) {
	return signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error(`subagent-codex: app-server request aborted: ${String(signal.reason)}`);
}
async function raceAbort(pending, signal) {
	if (signal.aborted) {
		pending.catch(() => {});
		throw abortError(signal);
	}
	let rejectAbort;
	const aborted = new Promise((_resolve, reject) => {
		rejectAbort = reject;
	});
	const onAbort = () => {
		rejectAbort(abortError(signal));
	};
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([pending, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
/**
* One app-server connection and its single ephemeral thread/turn.
*
* The class deliberately exposes no generic request surface. Supporting
* another product method must first become part of the provider contract.
*/
var CodexAppServerWire = class {
	input;
	permissionMode;
	model;
	sandbox;
	reasoningEffort;
	transport;
	fatal = Promise.withResolvers();
	threadId;
	turnId;
	pendingTurnId;
	turnCompleted;
	earlyTurnNotifications = [];
	lastFinalAnswer;
	lastPartialAnswer;
	lastUnphasedAnswer;
	diagnostic;
	failure;
	diagnosticOrder = 0;
	observationOrder = 0;
	pendingDiagnostic;
	inputEnded = false;
	terminalObserved = false;
	closed = false;
	constructor(input, output, permissionMode, model, sandbox, reasoningEffort) {
		this.input = input;
		this.permissionMode = permissionMode;
		this.model = model;
		this.sandbox = sandbox;
		this.reasoningEffort = reasoningEffort;
		this.transport = new JsonRpcLineTransport(input, output);
		this.fatal.promise.catch(() => {});
		this.transport.onRequest((method, params) => this.handleServerRequest(method, params));
		this.transport.onNotification((method, params) => {
			try {
				this.handleNotification(method, params);
			} catch (error) {
				this.fail(thrown$1(error));
			}
		});
		this.input.on("error", this.onInputError);
		this.input.on("end", this.onInputEnd);
		output.on("error", this.onOutputError);
	}
	/** Start reading app-server frames. */
	start() {
		this.transport.start();
	}
	/**
	* Whether protocol output ended before a terminal turn notification.
	* @returns `true` only for an early protocol close without a terminal turn.
	*/
	endedBeforeTerminal() {
		return this.inputEnded && !this.terminalObserved;
	}
	/**
	* Perform the required app-server initialize/initialized handshake.
	* @param signal - unpublished-start cancellation.
	*/
	async initialize(signal) {
		object(await this.guarded(this.transport.request("initialize", {
			clientInfo: {
				name: "deepseek-harness",
				title: "DeepSeek Harness",
				version: "0.0.1"
			},
			capabilities: {
				experimentalApi: false,
				requestAttestation: false
			}
		}, signal), signal), "initialize response");
		this.transport.notify("initialized");
		await this.guarded(this.transport.flush(), signal);
	}
	/**
	* Create a thread for the run and retain its identity. A review thread is
	* persistent so its id can be resumed by a later review of the same key.
	* @param cwd - selected child working directory.
	* @param signal - unpublished-start cancellation.
	* @param ephemeral - whether the thread is private to this run.
	* @returns the created thread id.
	*/
	async startThread(cwd, signal, ephemeral = true) {
		const thread = object(object(await this.guarded(this.transport.request("thread/start", {
			cwd,
			ephemeral,
			...this.model === void 0 ? {} : { model: this.model },
			...this.reasoningEffort === void 0 ? {} : { config: { model_reasoning_effort: this.reasoningEffort } },
			...THREAD_PERMISSION_PARAMS[this.permissionMode],
			...this.sandbox === void 0 ? {} : { sandbox: this.sandbox }
		}, signal), signal), "thread/start response").thread, "thread/start thread");
		const id = string(thread.id, "thread/start thread id");
		if (thread.ephemeral !== ephemeral) throw new Error(`subagent-codex: app-server did not create ${ephemeral ? "an ephemeral" : "a persistent"} thread`);
		this.threadId = id;
		return id;
	}
	/**
	* Resume a persisted review thread under this run's cwd, sandbox, model, and
	* effort. The resumed thread keeps the fixed Serena/MCP policy of this child.
	* @param threadId - persisted thread id.
	* @param cwd - selected child working directory.
	* @param signal - unpublished-start cancellation.
	* @returns the resumed thread id.
	*/
	async resumeThread(threadId, cwd, signal) {
		const thread = object(object(await this.guarded(this.transport.request("thread/resume", {
			threadId,
			cwd,
			...this.model === void 0 ? {} : { model: this.model },
			...this.reasoningEffort === void 0 ? {} : { config: { model_reasoning_effort: this.reasoningEffort } },
			...THREAD_PERMISSION_PARAMS[this.permissionMode],
			...this.sandbox === void 0 ? {} : { sandbox: this.sandbox }
		}, signal), signal), "thread/resume response").thread, "thread/resume thread");
		const id = string(thread.id, "thread/resume thread id");
		if (id !== threadId) throw new Error("subagent-codex: app-server resumed another thread");
		this.threadId = id;
		return id;
	}
	/**
	* Submit the one text-only task and wait for this thread/turn's authoritative
	* terminal notification.
	* @param texts - already validated task text blocks.
	* @param signal - local cancellation for the published run.
	* @returns the shared subagent result.
	*/
	async runTurn(texts, signal) {
		const completion = Promise.withResolvers();
		this.turnCompleted = completion;
		const threadId = this.threadId;
		try {
			const turn = object(object(await this.guarded(this.transport.request("turn/start", {
				threadId,
				input: texts.map((text) => ({
					type: "text",
					text,
					text_elements: []
				}))
			}, signal), signal), "turn/start response").turn, "turn/start turn");
			this.commitTurnId(string(turn.id, "turn/start turn id"));
		} catch (error) {
			this.recordFailure({
				stage: "turn-start",
				category: "unknown"
			});
			throw error;
		}
		let completed;
		let terminal;
		try {
			completed = await this.guarded(completion.promise, signal);
			terminal = object(completed.params.turn, "turn/completed turn");
		} catch (error) {
			this.recordFailure({
				stage: "turn",
				category: "unknown"
			});
			throw error;
		}
		const status = terminal.status;
		if (status !== "completed") {
			const parsed = failureInfo(terminal);
			this.recordFailure(parsed.httpStatus === void 0 ? {
				stage: "turn",
				category: parsed.category
			} : {
				stage: "turn",
				category: parsed.category,
				httpStatus: parsed.httpStatus
			});
			if (parsed.sandboxFailure) this.recordDiagnostic("sandbox execution", "failed", "Codex reported a sandbox failure", completed.order);
			if (parsed.maxTokens) return {
				output: this.collectOutput(),
				stopReason: "max-tokens"
			};
			const detail = status === "failed" ? `: ${parsed.category}` : "";
			throw new Error(`subagent-codex: Codex turn ended with status ${String(status)}${detail}`);
		}
		const output = this.collectOutput();
		if (output.length === 0) {
			this.recordFailure({
				stage: "turn",
				category: "invalid-result"
			});
			throw new Error("subagent-codex: Codex completed without an answer");
		}
		return {
			output,
			stopReason: "completed"
		};
	}
	/**
	* Best-effort remote cancellation. Local settlement and process teardown
	* remain authoritative when the child no longer accepts protocol requests.
	*/
	interrupt() {
		if (this.threadId === void 0 || this.turnId === void 0 || this.closed) return;
		this.transport.request("turn/interrupt", {
			threadId: this.threadId,
			turnId: this.turnId
		}).catch(() => {});
	}
	/**
	* The best non-commentary answer observed so far, preserving exact bytes:
	* the latest `final_answer`, else the latest `partial_answer`, else the
	* latest nullable-phase message.
	* @returns the selected text block, if any.
	*/
	collectOutput() {
		const selected = this.lastFinalAnswer ?? this.lastPartialAnswer ?? this.lastUnphasedAnswer;
		return selected !== void 0 && selected.trim().length > 0 ? [{
			type: "text",
			text: selected
		}] : [];
	}
	/**
	* The latest safe unattended permission fact observed for this run.
	* @returns provider-authored diagnostic text, when one was observed.
	*/
	collectDiagnostic() {
		return this.diagnostic;
	}
	/**
	* The structured failure fact observed for this published turn.
	* Call only after a non-completed return or rejection from {@link runTurn}.
	* @returns the fixed stage/category pair and optional HTTP status.
	*/
	collectFailure() {
		return this.failure;
	}
	/** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
	close() {
		if (this.closed) return;
		this.closed = true;
		this.input.off("end", this.onInputEnd);
		this.transport.close();
	}
	async guarded(pending, signal) {
		return raceAbort(Promise.race([this.fatal.promise, pending]), signal);
	}
	fail(error) {
		this.fatal.reject(error);
	}
	onInputError = (error) => {
		this.fail(error);
	};
	onOutputError = (error) => {
		this.fail(error);
	};
	onInputEnd = () => {
		this.inputEnded = true;
		this.fail(/* @__PURE__ */ new Error("subagent-codex: app-server protocol stream closed"));
	};
	observePendingTurnId(id) {
		if (this.turnCompleted === void 0) throw new Error("subagent-codex: app-server referenced a turn before turn/start");
		if (this.pendingTurnId !== void 0 && this.pendingTurnId !== id) throw new Error("subagent-codex: app-server referenced conflicting turns");
		this.pendingTurnId = id;
	}
	commitTurnId(id) {
		if (this.pendingTurnId !== void 0 && this.pendingTurnId !== id) throw new Error("subagent-codex: turn/start response did not match the active turn");
		this.turnId = id;
		const pendingDiagnostic = this.pendingDiagnostic;
		this.pendingDiagnostic = void 0;
		if (pendingDiagnostic !== void 0) this.recordDiagnostic(pendingDiagnostic.request, pendingDiagnostic.decision, pendingDiagnostic.reason, pendingDiagnostic.order);
		const notifications = this.earlyTurnNotifications.splice(0);
		for (const notification of notifications) this.handleNotification(notification.method, notification.params, notification.order);
	}
	/**
	* Validate the request's thread and turn association.
	* @returns `true` when the matching turn is still provisional, so the caller
	* defers its diagnostic until `commitTurnId()`.
	*/
	validateRunIds(params, nullableTurn = false) {
		if (params.threadId !== this.threadId) throw new Error("subagent-codex: app-server request referenced another thread");
		if (nullableTurn && params.turnId === null) return false;
		const id = string(params.turnId, "server request turn id");
		if (this.turnId === void 0) {
			this.observePendingTurnId(id);
			return true;
		}
		if (id !== this.turnId) throw new Error("subagent-codex: app-server request referenced another turn");
		return false;
	}
	recordRequestDiagnostic(provisional, request, decision, reason) {
		const order = this.nextObservationOrder();
		if (provisional) {
			this.pendingDiagnostic = {
				order,
				request,
				decision,
				reason
			};
			return;
		}
		this.recordDiagnostic(request, decision, reason, order);
	}
	recordDiagnostic(request, decision, reason, order = this.nextObservationOrder()) {
		if (order < this.diagnosticOrder) return;
		this.diagnosticOrder = order;
		this.diagnostic = unattendedDiagnostic(this.permissionMode, request, decision, reason);
	}
	recordFailure(facts) {
		this.failure = facts;
	}
	nextObservationOrder() {
		this.observationOrder += 1;
		return this.observationOrder;
	}
	recordDeclinedItem(item, order) {
		if (item.type === "commandExecution" && item.status === "declined") {
			this.recordDiagnostic("command execution", "declined", "Codex declined the command under the selected permission mode", order);
			return true;
		}
		if (item.type === "fileChange" && item.status === "declined") {
			this.recordDiagnostic("file change", "declined", "Codex declined the file change under the selected permission mode", order);
			return true;
		}
		return false;
	}
	handleServerRequest(method, params) {
		try {
			switch (method) {
				case "item/commandExecution/requestApproval": {
					const provisional = this.validateRunIds(params);
					const decision = unattendedDecision(params);
					this.recordRequestDiagnostic(provisional, "command approval", decision === "cancel" ? "cancelled" : "declined", "the provider does not grant interactive approval");
					return Promise.resolve({ decision });
				}
				case "item/fileChange/requestApproval": {
					const provisional = this.validateRunIds(params);
					const decision = unattendedDecision(params);
					this.recordRequestDiagnostic(provisional, "file approval", decision === "cancel" ? "cancelled" : "declined", "the provider does not grant interactive approval");
					return Promise.resolve({ decision });
				}
				case "item/permissions/requestApproval":
					this.recordRequestDiagnostic(this.validateRunIds(params), "permission grant", "denied", "the provider grants no additional turn permissions");
					return Promise.resolve({
						permissions: {},
						scope: "turn"
					});
				case "item/tool/requestUserInput":
					this.recordRequestDiagnostic(this.validateRunIds(params), "user input", "empty response", "the provider does not collect interactive answers");
					return Promise.resolve({ answers: {} });
				case "mcpServer/elicitation/request":
					this.recordRequestDiagnostic(this.validateRunIds(params, true), "MCP elicitation", "declined", "the provider does not collect interactive MCP input");
					return Promise.resolve({
						action: "decline",
						content: null,
						_meta: null
					});
				default: throw new Error(`subagent-codex: unsupported app-server request ${JSON.stringify(method)}`);
			}
		} catch (error) {
			const normalized = thrown$1(error);
			this.fail(normalized);
			return Promise.reject(normalized);
		}
	}
	handleNotification(method, params, order) {
		if (method === "turn/started") {
			if (string(params.threadId, "turn/started thread id") !== this.threadId) return;
			const turn = object(params.turn, "turn/started turn");
			if (this.turnCompleted !== void 0 && this.turnId === void 0) this.observePendingTurnId(string(turn.id, "turn/started turn id"));
			return;
		}
		if (method === "item/completed") {
			if (string(params.threadId, "item/completed thread id") !== this.threadId) return;
			const id = string(params.turnId, "item/completed turn id");
			if (this.turnId === void 0) {
				if (this.turnCompleted !== void 0) {
					this.observePendingTurnId(id);
					this.earlyTurnNotifications.push({
						method,
						params,
						order: this.nextObservationOrder()
					});
				}
				return;
			}
			if (id !== this.turnId) return;
			const item = object(params.item, "item/completed item");
			if (this.recordDeclinedItem(item, order)) return;
			if (item.type !== "agentMessage") return;
			const text = typeof item.text === "string" ? item.text : (() => {
				throw new Error("subagent-codex: app-server returned an invalid agent message");
			})();
			if (item.phase === "final_answer") this.lastFinalAnswer = text;
			else if (item.phase === "partial_answer") this.lastPartialAnswer = text;
			else if (item.phase === null) this.lastUnphasedAnswer = text;
			else if (item.phase !== "commentary") throw new Error(`subagent-codex: app-server returned an unknown agent message phase ${JSON.stringify(item.phase)}`);
			return;
		}
		if (method !== "turn/completed") return;
		if (string(params.threadId, "turn/completed thread id") !== this.threadId) return;
		const turn = object(params.turn, "turn/completed turn");
		const id = string(turn.id, "turn/completed turn id");
		const turnCompleted = this.turnCompleted;
		if (turnCompleted === void 0) return;
		if (this.turnId === void 0) {
			this.observePendingTurnId(id);
			this.earlyTurnNotifications.push({
				method,
				params,
				order: this.nextObservationOrder()
			});
			return;
		}
		if (id !== this.turnId) return;
		this.terminalObserved = true;
		if (![
			"completed",
			"interrupted",
			"failed"
		].includes(String(turn.status))) throw new Error(`subagent-codex: app-server returned invalid terminal turn status ${String(turn.status)}`);
		turnCompleted.resolve({
			params,
			order: order ?? this.nextObservationOrder()
		});
	}
};
//#endregion
//#region lib/types/run.js
/**
* One-shot Codex child lifecycle: spawn the real app-server through the
* subprocess seam, publish only after initialization and ephemeral thread
* creation, flatten post-publication failures, and dispose to whole-range
* quiescence.
*
* @module @deepseek-ai/dsh-subagent-codex/run
*/
/** Default POSIX grace between subprocess termination tiers. */
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
/** Native non-interactive Codex modes mapped to official `thread/start` fields. */
const CODEX_PERMISSION_MODES = [
	"never",
	"approve-for-me",
	"dangerously-bypass-approvals-and-sandbox"
];
/** Safe default for unattended Codex runs. */
const DEFAULT_CODEX_PERMISSION_MODE = "never";
/** Sandbox fixed per provider instance; never requested per run. */
const CODEX_SANDBOX_MODES = [
	"read-only",
	"workspace-write"
];
function failureDiagnostic(facts) {
	const fields = [
		"product: Codex",
		...facts.codexVersion === void 0 ? [] : [`codex: ${facts.codexVersion}`],
		`stage: ${facts.stage}`,
		`category: ${facts.category}`
	];
	if (facts.httpStatus !== void 0) fields.push(`HTTP status: ${facts.httpStatus}`);
	if (facts.serenaFailure === true) fields.push("serena: required MCP server unavailable (install `uvx`, allow `serena-agent==1.7.0`, then retry)");
	const processFields = [["exit code", facts.outcome?.exitCode], ["signal", facts.outcome?.signal]];
	for (const [label, value] of processFields) if (value !== null && value !== void 0) fields.push(`${label}: ${value}`);
	return `Product subagent failure (${fields.join("; ")})`;
}
var CodexRunFailure = class extends Error {
	facts;
	constructor(facts, cause) {
		super(`subagent-codex: ${failureDiagnostic(facts)}`, cause === void 0 ? void 0 : { cause });
		this.facts = facts;
		this.name = "CodexRunFailure";
	}
};
/**
* Hide an unpublished Host failure behind fixed safe startup facts.
* @param cause Original Host failure retained for internal diagnostics.
* @param codexVersion - installed CLI version included in the diagnostic.
* @returns A startup failure whose message contains only fixed safe facts.
*/
function codexStartupFailure(cause, codexVersion) {
	return new CodexRunFailure({
		stage: "initialize",
		category: "unknown",
		codexVersion
	}, cause);
}
function thrown(value) {
	/* v8 ignore next -- typed subprocess/wire failures reject with Error. */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Whether a startup failure is the required Serena MCP server, so the
* diagnostic can name the fixed next action instead of only a category.
* @param error - thrown startup failure.
* @returns true when its message names Serena.
*/
function isSerenaFailure(error) {
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
	const text = error instanceof Error ? `${error.message} ${cause}` : String(error);
	return /serena/iu.test(text);
}
/**
* Validate and preserve the one-shot task before crossing the process boundary.
* @param prompt - task content accepted from the shared subagent service.
* @returns the exact non-empty text block sequence.
*/
function textTask(prompt) {
	if (prompt.length === 0) throw new Error("subagent-codex: the one-shot task must contain only text blocks");
	const texts = [];
	for (const block of prompt) {
		if (block.type !== "text") throw new Error("subagent-codex: the one-shot task must contain only text blocks");
		texts.push(block.text);
	}
	if (texts.every((text) => text.trim().length === 0)) throw new Error("subagent-codex: the one-shot task must not be empty");
	return texts;
}
/**
* Extract the delegation engine's stable review key from the prompt. The engine
* emits one line `- Review key: review:<change>:task:<taskId>` (or `whole:<phase>`)
* for every review; the prompt is the contract because the start request shape
* is unchanged. Multiple different keys in one prompt are rejected rather than
* guessing which conversation to resume.
* @param prompt - task content accepted from the shared subagent service.
* @returns the review key, or undefined when the prompt is not a review.
*/
function reviewKeyFromPrompt(prompt) {
	const text = prompt.map((block) => block !== null && typeof block === "object" && typeof block.text === "string" ? block.text : "").join("\n");
	const keys = [];
	for (const line of text.split(/\r?\n/u)) {
		const match = /^- Review key: (review:[^\r\n]+?)\s*$/u.exec(line);
		if (match !== null) keys.push(match[1]);
	}
	const unique = [...new Set(keys)];
	if (unique.length > 1) throw new Error(`${CODEX_ERROR_PREFIX}prompt contains conflicting review keys`);
	return unique[0];
}
/**
* Close the private wire, terminate the managed range, and wait for the
* subprocess owner to prove it is quiescent.
* @param wire - private app-server protocol connection.
* @param child - shared-service handle that owns the managed range.
* @param codexVersion - installed CLI version included in a teardown failure.
*/
async function disposeCodexChild(wire, child, codexVersion) {
	wire.close();
	let outcome;
	child.done.then((value) => {
		outcome = value;
	}, () => {});
	try {
		child.stdin?.end();
	} catch {}
	child.terminate();
	try {
		await child.waitForExit();
	} catch (error) {
		throw new CodexRunFailure({
			stage: "teardown",
			category: "unknown",
			outcome,
			codexVersion
		}, thrown(error));
	}
	await child.done.catch(() => {});
}
/**
* Start the real `codex app-server --stdio` child and publish its one-shot run.
* @param request - resolved shared subagent request.
* @param spec - Workspace, environment, process service, and diagnostic policy.
* @returns the published run after initialization and ephemeral thread creation.
*/
async function startCodexRun(request, spec) {
	const texts = textTask(request.prompt);
	if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
	let serenaHome;
	try {
		serenaHome = createSerenaHome(spec.cwd);
	} catch (error) {
		throw new CodexRunFailure({
			stage: "initialize",
			category: "unknown",
			codexVersion: spec.codexVersion
		}, thrown(error));
	}
	let child;
	let shimCleanup = () => {};
	try {
		const appServerArgs = codexAppServerArgs(spec.cwd, serenaHome);
		const plan = codexSpawnPlan(spec.codexPath, appServerArgs);
		shimCleanup = plan.cleanup;
		child = spec.spawn({
			argv: plan.argv,
			cwd: spec.cwd,
			stdio: {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe"
			},
			graceMs: spec.disposeGraceMs,
			env: {
				...spec.env,
				...plan.env,
				CODEX_HOME: void 0,
				SERENA_HOME: serenaHome
			}
		});
	} catch (error) {
		shimCleanup();
		removeSerenaHome(serenaHome);
		throw new CodexRunFailure({
			stage: "initialize",
			category: "unknown",
			codexVersion: spec.codexVersion
		}, thrown(error));
	}
	const wire = new CodexAppServerWire(child.stdout, child.stdin, spec.permissionMode, spec.model, spec.sandbox, spec.reasoningEffort);
	const onStderr = (chunk) => {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		try {
			writeFileSync(process.stderr.fd, bytes);
		} catch {}
	};
	const onStderrError = () => {};
	child.stderr?.on("data", onStderr);
	child.stderr?.on("error", onStderrError);
	const disposeProcess = async () => {
		try {
			await disposeCodexChild(wire, child, spec.codexVersion);
			await new Promise((resolve) => {
				setImmediate(resolve);
			});
		} finally {
			child.stderr?.off("data", onStderr);
			child.stderr?.off("error", onStderrError);
			removeSerenaHome(serenaHome);
			shimCleanup();
		}
	};
	let processFailureFacts;
	const processFailure = child.done.then((outcome) => {
		processFailureFacts = {
			stage: "process",
			category: "process",
			outcome,
			codexVersion: spec.codexVersion
		};
		throw new CodexRunFailure(processFailureFacts);
	}, (error) => {
		processFailureFacts = {
			stage: "process",
			category: "unknown",
			codexVersion: spec.codexVersion
		};
		throw new CodexRunFailure(processFailureFacts, thrown(error));
	});
	processFailure.catch(() => {});
	const runAbort = new AbortController();
	const requestCancel = () => {
		if (runAbort.signal.aborted) return;
		runAbort.abort(/* @__PURE__ */ new Error("subagent-codex: run cancelled locally"));
		wire.interrupt();
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	const reviewKey = spec.reviewKey;
	let threadId;
	let threadReuse;
	let startupStage = "initialize";
	try {
		wire.start();
		await Promise.race([wire.initialize(request.signal), processFailure]);
		startupStage = "thread-start";
		if (reviewKey === void 0) threadId = await Promise.race([wire.startThread(spec.cwd, request.signal), processFailure]);
		else {
			const savedThreadId = findReviewThread(spec.cwd, reviewKey, spec.sandbox);
			let resumed = false;
			if (savedThreadId !== void 0) try {
				threadId = await Promise.race([wire.resumeThread(savedThreadId, spec.cwd, request.signal), processFailure]);
				resumed = true;
			} catch (error) {
				if (error instanceof CodexRunFailure || request.signal.aborted || runAbort.signal.aborted) throw error;
				// A missing or unusable persisted thread falls back to a fresh one.
			}
			if (!resumed) {
				threadId = await Promise.race([wire.startThread(spec.cwd, request.signal, false), processFailure]);
				await rememberReviewThread(spec.cwd, reviewKey, threadId, spec.sandbox);
			}
			threadReuse = resumed ? "resumed" : "created";
		}
	} catch (error) {
		request.signal.removeEventListener("abort", onAbort);
		const cancelledBeforeCleanup = runAbort.signal.aborted;
		if (!(error instanceof CodexRunFailure) && !cancelledBeforeCleanup) await new Promise((resolve) => {
			setImmediate(resolve);
		});
		const failure = new CodexRunFailure({
			stage: startupStage,
			category: "unknown",
			outcome: error instanceof CodexRunFailure ? error.facts.outcome : processFailureFacts?.outcome,
			codexVersion: spec.codexVersion,
			...isSerenaFailure(error) ? { serenaFailure: true } : {}
		}, thrown(error));
		try {
			await disposeProcess();
		} catch (disposeError) {
			const cleanupFailure = thrown(disposeError);
			throw new AggregateError([failure, cleanupFailure], `${failure.message}; ${cleanupFailure.message}`);
		}
		if (cancelledBeforeCleanup) throw new Error("subagent-codex: request was aborted before run publication");
		try {
			request.signal.throwIfAborted();
		} catch {
			throw new Error("subagent-codex: request was aborted before run publication");
		}
		throw failure;
	}
	const reviewMeta = reviewKey === void 0 ? {} : {
		threadId,
		threadReuse
	};
	const collectOutput = () => wire.collectOutput();
	let diagnostic;
	const recordFailureDiagnostic = (facts) => {
		const failure = failureDiagnostic({
			...facts,
			codexVersion: spec.codexVersion
		});
		const login = facts.httpStatus === 401 ? codexLoginHint(spec.codexPath) : void 0;
		const permission = wire.collectDiagnostic();
		diagnostic = [
			failure,
			...login === void 0 ? [] : [login],
			...permission === void 0 ? [] : [permission]
		].join("\n");
		return diagnostic;
	};
	const withProcessOutcome = (facts) => {
		const outcome = processFailureFacts?.outcome;
		return {
			...facts,
			...outcome === void 0 ? {} : { outcome },
			codexVersion: spec.codexVersion
		};
	};
	const publishedProcessFailure = processFailure.catch(async (error) => {
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		throw error;
	});
	const result = settleRunResult({
		attempt: async () => {
			try {
				const terminal = await Promise.race([wire.runTurn(texts, runAbort.signal), publishedProcessFailure]);
				if (terminal.stopReason === "completed") return {
					...terminal,
					...reviewMeta
				};
				await new Promise((resolve) => {
					setImmediate(resolve);
				});
				const facts = withProcessOutcome(wire.collectFailure());
				return {
					...terminal,
					diagnostic: recordFailureDiagnostic(facts),
					...reviewMeta
				};
			} catch (error) {
				await new Promise((resolve) => {
					setImmediate(resolve);
				});
				const endedBeforeTerminal = wire.endedBeforeTerminal();
				if (endedBeforeTerminal && processFailureFacts === void 0 && !runAbort.signal.aborted) try {
					if (await child.waitForExit(AbortSignal.timeout(Math.ceil(spec.disposeGraceMs)))) await child.done;
				} catch {}
				const facts = error instanceof CodexRunFailure ? error.facts : endedBeforeTerminal && processFailureFacts !== void 0 ? processFailureFacts : withProcessOutcome(wire.collectFailure());
				recordFailureDiagnostic(facts);
				throw error instanceof CodexRunFailure ? error : new CodexRunFailure(withProcessOutcome(facts), thrown(error));
			}
		},
		collectOutput,
		collectDiagnostic: () => diagnostic,
		cancelled: () => runAbort.signal.aborted,
		onError: spec.onError,
		signal: request.signal,
		onAbort
	});
	return subprocessRunHandle({
		id: brandString(randomUUID()),
		result,
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown: disposeProcess
	});
}
//#endregion
//#region lib/types/index.js
/**
* Forked Codex subagent plugin. Registers the bundled/installed-CLI read-only
* `codex-subagent` and workspace-write `codex-subagent-write` providers plus
* the `codex_subagent_status` tool. The official `codex` provider may coexist
* because the fork never uses that registry name.
*
* @module @dsh-setup/plugin-codex-subagent
*/
const name = "@dsh-setup/plugin-codex-subagent";
const inject = ["subagents", "subprocess", "tools"];
/** Read-only provider instance for review/answer rules. */
const READ_ONLY_PROVIDER_NAME = "codex-subagent";
/** Workspace-write provider instance for isolated patch rules. */
const WRITE_PROVIDER_NAME = "codex-subagent-write";
const READ_ONLY_SANDBOX = "read-only";
const WORKSPACE_WRITE_SANDBOX = "workspace-write";
/** Target options this provider can map to the Codex app-server. */
const CODEX_TARGET_OPTIONS = new Set([
	"model",
	"reasoningEffort",
	"reviewKey"
]);
const Config = z.object({
	codexPath: z.string().min(1),
	model: z.string().min(1),
	reasoningEffort: z.string().min(1),
	env: z.dict(z.string()).default({}),
	disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
});
/** Merge row config with defaults; the Codex options stay optional. */
function resolvePluginConfig(config = {}) {
	return {
		...config.codexPath === void 0 ? {} : { codexPath: config.codexPath },
		...config.model === void 0 ? {} : { model: config.model },
		...config.reasoningEffort === void 0 ? {} : { reasoningEffort: config.reasoningEffort },
		env: config.env ?? {},
		disposeGraceMs: config.disposeGraceMs ?? DEFAULT_DISPOSE_GRACE_MS
	};
}
/**
* Validate the DSH start request's target options and merge them over the row
* defaults. Codex supports `model`, `reasoningEffort`, and the review
* conversation key; anything else is rejected before a process starts instead
* of being silently ignored.
* @param request - DSH subagent start request.
* @param config - resolved row config carrying optional defaults.
* @returns the effective model, reasoning effort, and review key.
*/
function codexAgentOptions(request, config) {
	const options = request.agentOptions;
	if (options !== void 0) for (const [key, value] of Object.entries(options)) {
		if (value === void 0) continue;
		if (!CODEX_TARGET_OPTIONS.has(key)) throw new Error(`${CODEX_ERROR_PREFIX}unsupported Codex target option "${key}": the Codex providers support only model, reasoningEffort, and reviewKey`);
	}
	const model = options?.model ?? config.model;
	if (model !== void 0 && (typeof model !== "string" || model.length === 0)) throw new Error(`${CODEX_ERROR_PREFIX}target model must be a non-empty string`);
	const reasoningEffort = options?.reasoningEffort ?? config.reasoningEffort;
	if (reasoningEffort !== void 0 && (typeof reasoningEffort !== "string" || reasoningEffort.length === 0)) throw new Error(`${CODEX_ERROR_PREFIX}target reasoningEffort must be a non-empty string`);
	const reviewKey = options?.reviewKey;
	if (reviewKey !== void 0 && (typeof reviewKey !== "string" || reviewKey.length === 0)) throw new Error(`${CODEX_ERROR_PREFIX}target reviewKey must be a non-empty string`);
	return {
		...model === void 0 ? {} : { model },
		...reasoningEffort === void 0 ? {} : { reasoningEffort },
		...reviewKey === void 0 ? {} : { reviewKey }
	};
}
var CodexProvider = class {
	name;
	ctx;
	config;
	sandbox;
	capabilities = {
		...NO_START_CAPABILITIES,
		agentOptions: true
	};
	inheritsParentContext = false;
	constructor(name, ctx, config, sandbox) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
		this.sandbox = sandbox;
	}
	async start(request) {
		let cwd;
		try {
			cwd = assertUsableCwd("subagent-codex", "child cwd", request.cwd);
		} catch (error) {
			if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
			throw codexStartupFailure(error);
		}
		const target = codexAgentOptions(request, this.config);
		const promptReviewKey = reviewKeyFromPrompt(request.prompt);
		if (target.reviewKey !== void 0 && promptReviewKey !== void 0 && target.reviewKey !== promptReviewKey) throw new Error(`${CODEX_ERROR_PREFIX}prompt review key does not match the target reviewKey`);
		const reviewKey = target.reviewKey ?? promptReviewKey;
		let codex;
		try {
			codex = await resolveCodexCli({
				codexPath: this.config.codexPath,
				env: this.config.env,
				cwd,
				graceMs: this.config.disposeGraceMs,
				signal: request.signal,
				spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec)
			});
		} catch (error) {
			if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
			throw error;
		}
		if (request.signal.aborted) throw new Error("subagent-codex: request was aborted before app-server startup");
		return startCodexRun(request, {
			cwd,
			codexPath: codex.path,
			codexVersion: codex.version,
			sandbox: this.sandbox,
			...target,
			...reviewKey === void 0 ? {} : { reviewKey },
			permissionMode: "never",
			env: this.config.env,
			disposeGraceMs: this.config.disposeGraceMs,
			spawn: (spawnSpec) => this.ctx.subprocess.spawn(spawnSpec),
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`subagent-codex "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
/**
* Build the read-only status tool. It resolves the same CLI as a run and
* reports source, bundled version, Serena config, login command, and a
* paste-ready row override; it never writes the profile or `~/.codex`.
* @param ctx - context carrying the subprocess service.
* @param config - resolved row config (path, environment, grace).
* @returns the registry-ready tool definition.
*/
function codexStatusTool(ctx, config) {
	return defineTool({
		name: "codex_subagent_status",
		description: "Report the Codex CLI used by codex-subagent and codex-subagent-write: resolved path, version, discovery source (codexPath config, bundled @openai/codex, or PATH), bundled version, fixed Serena MCP config, Codex home, login command, and a paste-ready codexPath row snippet. Read-only; it never edits the profile or ~/.codex.",
		parameters: {},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					found: { type: "boolean" },
					path: { type: "string" },
					version: { type: "string" },
					source: { type: "string" },
					bundledVersion: { type: "string" },
					serena: { type: "string" },
					loginCommand: { type: "string" },
					codexHome: { type: "string" },
					snippet: { type: "string" },
					error: { type: "string" }
				}
			},
			render(_args, report) {
				return [{
					type: "text",
					text: renderCodexSubagentStatus(report)
				}];
			}
		},
		async execute(_args, exec) {
			return codexSubagentStatus({
				codexPath: config.codexPath,
				env: config.env,
				cwd: process.cwd(),
				graceMs: config.disposeGraceMs,
				signal: exec.signal,
				spawn: (spawnSpec) => ctx.subprocess.spawn(spawnSpec)
			});
		}
	});
}
/**
* Register both Codex provider instances and the status tool.
* @param ctx - context carrying shared subagent, subprocess, and tools services.
* @param config - optional CLI path, model, reasoning effort, child environment, and disposal grace.
*/
function apply(ctx, config = {}) {
	const resolved = resolvePluginConfig(config);
	assertPositiveFinite("subagent-codex", "disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) throw new Error(`subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
	ctx.subagents.registerProvider(new CodexProvider(READ_ONLY_PROVIDER_NAME, ctx, resolved, READ_ONLY_SANDBOX));
	ctx.subagents.registerProvider(new CodexProvider(WRITE_PROVIDER_NAME, ctx, resolved, WORKSPACE_WRITE_SANDBOX));
	ctx.tools.register(codexStatusTool(ctx, resolved));
}
//#endregion
export { BUNDLED_CODEX_PACKAGE, CODEX_PERMISSION_MODES, CODEX_SANDBOX_MODES, CodexCliError, Config, DEFAULT_CODEX_PERMISSION_MODE, DEFAULT_DISPOSE_GRACE_MS, SERENA_CONFIG_FILENAME, SERENA_CONFIG_OVERRIDES, SERENA_DISABLED_TOOLS, SERENA_DISABLED_TOOLS_OVERRIDES, SERENA_MCP_ARGS, SERENA_MCP_COMMAND, apply, bundledCodexInfo, codexAppServerArgs, codexLoginCommand, codexSpawnPlan, codexSubagentStatus, codexTargetTriple, createSerenaHome, discoverCodexPath, inject, name, parseCodexVersion, resolveCodexCli, serenaArgsFor, serenaCommandLine };

