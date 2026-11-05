import type { Context } from '@deepseek-ai/cordis';
/**
 * OpenSpec plugin: registers the six generated core skills from a pinned
 * upstream release as on-demand catalog entries in the profile's global skill
 * layer. The skill bodies load from the vendored assets only when invoked.
 *
 * The OpenSpec CLI is a machine prerequisite, not a bundle dependency: this
 * module never installs, downloads, or fetches it. The Web-only change-list
 * route runs the documented CLI on demand for the `/openspec-apply` picker;
 * the adapter note carried by every loaded skill states the prerequisite and
 * the project-local root/cleanup rules at the point of use, and the
 * task-lifecycle skills also carry the plugin-owned task-lane guidance.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-openspec";
/** Service the registration depends on. */
export declare const inject: string[];
/** Refuse a lock that no longer contains every skill the guidance targets. */
export declare function assertGuidanceTargets(skills: ReadonlyArray<{
    name: string;
}>): void;
/** Register the pinned skill set from the committed lock. */
export declare function apply(ctx: Context): void;
/** Read-only route the Client picker asks for the session workspace's change list. */
export declare const CHANGES_ROUTE = "/plugins/dsh-setup-openspec/changes";
/**
 * Register the workspace-scoped, read-only change list route when the Web Host
 * services exist. The request carries only a session id; the workspace comes
 * from that live session, never from the request.
 */
export declare function registerChangeRoute(ctx: Context): void;
