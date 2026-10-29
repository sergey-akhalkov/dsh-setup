# API and signature reference

Use this when the interface is a function, type, module, or wire contract. The body's first-time
test and five costs still apply; this file is the detail.

## The signature is a UI

- Required parameters are the decisions the caller must make. Every optional parameter is a
  decision the interface failed to make.
- Defaults do the right thing for the common case; an option nobody asked for is scope, not design.
- One obvious way: if two functions do the same job, one should not exist.
- A boolean that switches behavior is a smell; split the function or name the choice.
- Keep values in the form the platform already gives them; do not add a type conversion layer for
  symmetry.

## Names

- Verb and noun from the domain: `renderBundlePatch`, `resolveExportRemote`, `readPonytailLock`.
- Units in the name: `timeoutMs`, `maxBytes`, `retryCount`.
- No `data`, `info`, `options`, `handle`, or `process` as the whole meaning.
- The name says what the caller gets, not how it is computed.
- One term per concept; a second word for the same thing is a second interface.

## Types and invariants

- Make illegal states unrepresentable: a union of valid shapes beats a bag of optional fields.
- Validate at the trust boundary; do not make the caller re-check what the interface already knows.
- Parse, do not validate repeatedly: turn unknown input into a typed value once.
- Keep errors in the type system; a silent `undefined` is a failure the caller cannot see.
- Preserve data on the way out; a failure leaves the state safe.

## Errors

- A named, typed failure with the cause and the next action.
- The error message is API: it names the input, the constraint, and the fix.
- Do not wrap an error until you add information; a bare rethrow loses the cause.
- Do not use an exception for an expected outcome the caller must handle; return a result.
- Keep error codes stable once released.

## Least surprise

- A `get` does not write; a `close` is idempotent; a `parse` does not fetch.
- Effects are local and visible at the call site; no action at a distance.
- Do not mutate an input the caller still owns; return a new value or document the mutation.
- Order-independent arguments and flags where possible.
- Hidden I/O, hidden global state, and hidden time are the usual surprises.

## Stability

- A released name, flag, field, error, or output shape is an interface; keep it.
- Prefer additive changes; deprecate with a warning and a replacement, then remove.
- Hyrum's law: with enough callers, every observable behavior becomes a contract.
- Changing human output is cheaper than changing machine output; keep `--json`/`--plain` stable.

## Code as interface

- A deep module has a simple interface and hides its complexity; the caller should not need the
  implementation.
- The call site reads like the intent. If the reader must open three files, the interface is the
  problem.
- Names, types, and tests are the documentation; comments explain why.
- One obvious way through the code; deletion beats a new wrapper or option.
- Fail fast at the boundary; keep the failure close to the cause.

## Review checklist

- [ ] The signature has only the parameters the caller must decide.
- [ ] Defaults and names make the common call correct without reading the body.
- [ ] Illegal states are unrepresentable or rejected at the boundary.
- [ ] Errors are typed, named, and name the next action.
- [ ] The call site reads like the intent; no hidden I/O or action at a distance.
- [ ] Released behavior stays compatible; deprecation has a path.
