# Tasks

## 1. Card statuses

- [x] 1.1 Replace the `ReviewUnit` text tone with a `ReviewDot` state and map every review state to it
- [x] 1.2 Reword the whole-spec, task, and integration units into the `AI … review` family and give the not-run state its remedy tooltip
- [x] 1.3 Derive `tasks reviewed N/M` as a status unit with its own dot and the missing-task tooltip
- [x] 1.4 Render every review status as a dot plus a neutral label and drop the coloured-text CSS
- [x] 1.5 Use one 12px gap in the facts row and remove the fixed phase column

## 2. Verification

- [x] 2.1 Update and extend the panel tests for the labels, the dot states, and the coverage rule
- [x] 2.2 Rebuild `lib/client.js` and regenerate the vendored setup copy
- [ ] 2.3 Check the card in the Web dev host at 640px and at the narrowest sidebar width
