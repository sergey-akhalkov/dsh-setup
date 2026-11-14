# Spec Delta

## REMOVED Requirements

### Requirement: Lesson store

**Reason**: The local lesson store never held a lesson: only the 50-entry finding history exists in this workspace, and no lesson was proposed, accepted, or applied since the feature shipped.

**Migration**: Use Hindsight (`hindsight_ingest_document`, knowledge pages) for durable lessons; the local `.dsh/review-learning/` scratch can be deleted.

### Requirement: Lesson lifecycle

**Reason**: The propose/accept/reject/apply lifecycle had no user-facing use and its approval path duplicated the Hindsight knowledge workflow.

**Migration**: Capture a durable lesson with Hindsight; a review finding stays visible in the review record.

### Requirement: Deterministic retro report

**Reason**: `review_retro` duplicated what Hindsight's knowledge search answers, and no retro report produced a lesson.

**Migration**: Use `hindsight_reflect` or `hindsight_search_knowledge_pages` for repeated-finding analysis, and read the review records directly for the raw findings.

### Requirement: Repeat-finding metric

**Reason**: The repeat metric existed to feed the removed retro report and had no other consumer.

**Migration**: Analyze review records with a shell query when the repeat rate matters; records keep each finding's class and title.

### Requirement: Lesson injection

**Reason**: No accepted lesson ever existed, so injection never added a section; without learning it has no input.

**Migration**: Keep recurring review guidance in the review instruction assets (`review-task.md`, `review-spec.md`, `review-integration.md`).

### Requirement: Manual interface and opt-out

**Reason**: The `review_lesson` and `review_retro` tools and the `/review-retro` command are removed with the capability.

**Migration**: Use the Hindsight tools for durable notes; no configuration switch is needed because the tools no longer exist.

### Requirement: Trust boundaries

**Reason**: The trust rules protected stored lesson text that no longer exists.

**Migration**: The remaining review-record trust rules in `delegation-rules` still treat target output as untrusted data.

### Requirement: Lesson revisioning

**Reason**: Revisioning existed only for stored lessons.

**Migration**: Hindsight supersedes an outdated page by ingesting a newer document.

### Requirement: Lesson capacity

**Reason**: Capacity bounds existed only for the removed store.

**Migration**: None; the store is gone.

### Requirement: Finding history

**Reason**: The finding history existed to preserve findings for the removed retro report; review records already keep the findings that matter.

**Migration**: Read `.dsh/delegation/<rule>/<change>/` records for findings; the history file stays on disk as unused scratch.

### Requirement: Finding history failure boundary

**Reason**: The append-failure boundary protected the removed history file.

**Migration**: None; review publication no longer appends a history entry.
