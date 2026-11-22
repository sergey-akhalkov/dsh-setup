import type { Context } from '@deepseek-ai/cordis';
import type { SkillProvider } from '@deepseek-ai/dsh-skill';
/**
 * English catalog entry for the pinned third-party `huashu-design` skill.
 *
 * The upstream package is Chinese-only: the description in its SKILL.md
 * frontmatter is the catalog line, and its trigger words are Chinese, so an
 * English or Russian request does not route to it. This provider supplies an
 * English description and English trigger words, and loads the installed
 * upstream body unchanged with a separate English working-language directive
 * appended.
 *
 * It ships no upstream bytes. The package is read from the profile at runtime,
 * and the entry disappears when that package is absent, so the installer's
 * pinned fetch stays the only source of the skill.
 */
export declare const name = "@dsh-setup/plugin-huashu-design";
export declare const inject: string[];
/**
 * English description mirroring the upstream v3.5.0 frontmatter: its scope and
 * its trigger words. Keep it in step with the pinned upstream version.
 */
export declare const DESCRIPTION = "Huashu Design \u2014 HTML-native design work: high-fidelity prototypes, slide decks, animation and video, infographics, and expert design review. Every new design first drafts three directions for the user to choose (a named style or brand is no exemption), then executes the chosen one. Triggers: build a prototype, app prototype, mini-program, App Store artwork or store screenshots, deck, slides, animation, design style, review this design, build an HTML page, UI mockup, export MP4 or GIF, make it look good. Not for production web apps or systems that need a backend.";
/** Appended after the upstream body, which stays exactly as written. */
export declare const ADAPTER_NOTE: string;
/**
 * The installed upstream package directory, or undefined when the profile does
 * not have it. Resolution starts from this module, which is enough for a profile
 * that copied the setup in; a profile that links a checkout keeps this module
 * outside its own tree, so the profile directory — and then the Harness home and
 * profile name — are tried as anchors too.
 */
export declare function resolveUpstreamDirectory(env?: NodeJS.ProcessEnv): string | undefined;
/** Drop the upstream YAML frontmatter: this provider supplies its own metadata. */
export declare function stripFrontmatter(text: string): string;
/** Build the provider for one installed upstream directory. */
export declare function createSkillProvider(directory: string): SkillProvider;
/** Register the catalog entry; it lists nothing until the upstream package is installed. */
export declare function apply(ctx: Context): void;
