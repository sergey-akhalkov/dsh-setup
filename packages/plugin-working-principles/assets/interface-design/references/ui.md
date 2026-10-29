# UI reference

Use this when the interface is a client control or screen. The body's first-time test and five
costs still apply; this file is the detail.

## The house system

- Primitives: `Button`, `Menu`, `Modal`, `Toast` from `@deepseek-ai/dsh-client-ui-primitives`.
- Tokens: `--dsw-*` variables for color, radius, focus, and state. A hard-coded color or radius is a
  new design system.
- Slots: register through `ctx.slots.inject` and `ctx.slots.register`; confirm the slot name and
  props against the running Harness with `cordis_inspect_query` (Client `Slots`) before relying on
  them.
- Text: register the namespace with `ctx.locale.register` and read it through `ctx.locale.bind`.
- Test: use the client test harness; a component that cannot be rendered in a test is not
  integrated.
- Reference: `packages/plugin-admin-indicator/src/client/index.tsx` for a composer control with a
  menu, modal, toast, narrow-width collapse, accessible name, and fail-open registration.

## The ten lenses

Adapted from Krug's usability review; use them as questions, not a score sheet.

1. Self-evidence — can someone new tell what this control is for without an explanatory label?
2. Scanning — can the eye find the important parts within a couple of seconds?
3. Hierarchy — does on-screen size and weight match what matters most?
4. Economy — is any label or sentence doing no work?
5. Navigation — can the user say where they are and what they can reach from here?
6. Trunk test — arriving cold, can they name the product, the screen, and the available actions?
7. Landing clarity — after five seconds, can they describe the purpose of this screen?
8. Affordances — does everything clickable or editable also look that way?
9. Narrow — at a narrow width, are targets reachable and labels still readable?
10. Goodwill — does the screen spend the user's time and trust carefully?

## States

Every control or screen designs these before it is done:

- first run or empty, with the next action
- loading, with what is happening and how to leave
- success, with what changed and what is next
- error, with the cause, the next action, and a retry
- disabled, with why and what enables it
- partial, with what is missing and whether it matters
- narrow width, with the collapse, the label, and the accessible name
- keyboard-only, with focus order, focus ring, and escape

## Accessibility

- An accessible name for every control; an icon-only control also has a visible tooltip.
- Focus order follows reading order; focus is visible; Escape closes a menu or modal.
- Contrast and reduced motion are part of the design, not a later audit.
- Text is not the only carrier of state: pair color with an icon or a label.

## Copy

- Sentence case, active voice, the user's words, no internal jargon.
- The action label says what happens ("Create shortcut"), not "Submit".
- Error copy: what failed, why, what to do next, and the exact command or control.
- Empty copy: what would be here and the one action that creates it.

## The visual contract

Write the look and the states into the spec as scenarios, as
`openspec/specs/admin-indicator/spec.md` does: native-styled buttons with icon and hover, focus, and
disabled treatment; a narrow-width collapse that keeps the accessible name; a fail-open
registration. A design that lives only in a chat or a mock can regress silently.

## Review checklist

- [ ] The nearest existing control was reused before a new one was invented.
- [ ] One primary action; secondary and destructive actions are separated.
- [ ] Every state above exists, including narrow and keyboard.
- [ ] Accessible names, focus ring, contrast, and reduced motion are handled.
- [ ] Copy names the action, the cause, and the next step.
- [ ] The visual contract is a spec scenario.
- [ ] The component renders in the client test and fails open if registration throws.
