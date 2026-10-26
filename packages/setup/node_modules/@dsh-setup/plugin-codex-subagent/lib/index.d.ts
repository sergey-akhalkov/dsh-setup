/**
 * Local re-export of the fork's vendored declarations.
 *
 * The declarations live under `lib/types/` because the runtime is a vendored
 * upstream build rather than compiler output from a `src/` project in this
 * repository. A maintainer rebasing the fork regenerates them from upstream and
 * re-applies the recorded local changes.
 */
export * from './types/index.js'
