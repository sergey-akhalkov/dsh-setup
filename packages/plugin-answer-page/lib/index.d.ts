import type { Context } from '@deepseek-ai/cordis';
/**
 * Answer-page plugin: registers the pinned answer-me-with-html skill as one
 * on-demand catalog entry. The vendored skill directory is the resource base,
 * so the body's `${CLAUDE_SKILL_DIR}/scripts/am.mjs` resolves to the vendored
 * renderer. There is no always-on section, no tool, and no Client half.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-answer-page";
/** Service the registration depends on. */
export declare const inject: string[];
/** One vendored file's provenance entry. */
export interface AnswerPageFileRecord {
    path: string;
    bytes: number;
    sha256: string;
}
/**
 * Fail loudly when a vendored file no longer matches its provenance record.
 * Exported so the offline provenance test can prove a corrupted byte fails.
 */
export declare function assertVendoredBytes(record: AnswerPageFileRecord, content: Uint8Array): void;
/**
 * Register the pinned skill from one package directory. The lock shape, pin,
 * required records, and the bytes of every lock-listed vendored file are
 * checked here, so a tampered renderer fails the plugin load; the skill body is
 * re-checked when it is loaded. Exported so the provider lifecycle test can
 * drive a fixture package without touching the shipped assets.
 */
export declare function registerAnswerPage(ctx: Context, directory: string): void;
/** Register the skill from the package the built module ships in. */
export declare function apply(ctx: Context): void;
