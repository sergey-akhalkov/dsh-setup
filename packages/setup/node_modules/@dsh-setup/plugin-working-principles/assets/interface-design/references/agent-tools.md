# Agent-facing reference

Use this when the interface is a tool definition, a skill, a prompt section, or a model-facing
workflow. The body's first-time test and five costs still apply; the user is a model deciding
whether and how to call.

## Tool definitions

- The name says the action and the object; a model should not have to infer it from the body.
- The description states the job, the moment to use it, and the result; it describes behavior, not
  internals.
- Parameter rules live with the parameter: defaults, allowed ranges, required partners, and when to
  set it. If a rule changes with configuration, it probably belongs to a parameter.
- A fact has one home: not in both the tool description and the system-prompt section, and not in
  two tools' rules.
- Drop rules the model will learn from the result — a missing file already fails to read.
- Count the first-turn prompt before and after; a definition that grows without a measured reason
  is suspect.

## Skill definitions

- The description is the trigger. It names the situations that load the skill and the boundary
  ("not for..."), not a summary of the topic.
- The body carries the procedure, the decision rules, and the anti-patterns; detail goes into
  reference files that load only when read.
- One skill, one trigger. A pack of overlapping skills makes the model choose, which is the cost
  this design removes.
- The skill name is stable and descriptive; the catalog is discovery, not documentation.
- Keep the always-on contribution tiny and measured; every step pays for it.

## Context and outputs

- Open with the purpose, the actions, and the limits; let detail arrive when it is needed.
- Keep the result small and local: a little surrounding context, an explicit note about what was
  left out, and a route to the rest.
- Locality: a reply with the few messages before it, or a result with the lines that explain the
  number.
- Do not dump a whole log or document to avoid a second call; that is the expensive way to save
  context.
- The test is total effort, not saved tokens: a shorter answer that forces another search or a
  wrong call costs more.

## Failures

- A failure names the cause and the next action; the model should not have to guess.
- Do not claim the effect from a successful call; read the state.
- A skipped, stale, or partial check is unverified, not passing.
- A denied or unavailable dependency says so once, with the fallback; it does not become a retry
  loop.

## Review checklist

- [ ] The tool or skill can be chosen correctly from its name and description alone.
- [ ] Parameter rules live on the parameters; each fact appears once.
- [ ] The body is a procedure, not a topic summary; detail is in references.
- [ ] The output is bounded, local, and marks what it omitted.
- [ ] The failure names the cause and the next action.
- [ ] The always-on contribution is measured and justified.
