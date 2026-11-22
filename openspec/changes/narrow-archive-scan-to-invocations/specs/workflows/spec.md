# Spec Delta

## MODIFIED Requirements

### Requirement: Pre-execute archive gate

The engine SHALL refuse `openspec archive <change>` while a required review or spec-review step is open, no authenticated completed `change-intake` run or authenticated receipt exists, the current whole-spec `PASS` record is missing or stale, or the task list is complete and non-empty and the current `integration-review` `PASS` is missing or stale. A receipt MUST verify its host HMAC; a forged or unsigned receipt MUST NOT satisfy the gate. The refusal SHALL name the run, step, and missing evidence. It MUST allow the archive when the evidence is present and MUST NOT treat a text claim as evidence. When the parser cannot read a shell command as exactly one documented archive invocation or archive move, the engine SHALL refuse the call with the existing "could not be parsed safely" reason instead of allowing it when the command names an archive invocation or an archive move; a command that names no archive SHALL NOT be refused by this rule. The value of a `-m`/`--message` option of a `git commit` command or a `--body` option of a `gh pr create` command is prose data: the engine MUST NOT read an archive mention inside that value as an invocation or move, and SHALL NOT refuse a command whose only archive mention is such a value. The exemption is scoped to those verified pairs: an option value on another subcommand or executable, a global option before the subcommand, a git alias prefix, a command wrapper, or a positional argument a shell evaluates is not data. A single readable command whose executable is `openspec` and whose subcommand is a known non-archive action (for example `validate`, `status`, `show`, `list`, `instructions`, or `new`) is not an archive invocation and SHALL NOT be refused by this rule. Both exemptions cover literal data only: an executable position or archive subcommand, a command wrapper or substitution that evaluates text, a parenthesized or other evaluated subexpression, a command that places an option or another token before the subcommand, an unknown subcommand, a value the scan cannot delimit (unquoted, unterminated, escaped, or carrying a substitution), or any shell control keeps the existing textual rule. A quoted or commented mention outside these data positions is refused rather than interpreted.

#### Scenario: Archive is refused

- **WHEN** a required review step is open for the change
- **THEN** the archive is refused with the run, step, and missing evidence

#### Scenario: No intake run

- **WHEN** no completed `change-intake` run or authenticated receipt exists for the change
- **THEN** the archive is refused with the missing intake run and its next step

#### Scenario: Stale review blocks archive

- **WHEN** the whole-spec record's digest does not match the current change artifacts
- **THEN** the archive is refused with the stale record and the next review action

#### Scenario: Stale integration review blocks archive

- **WHEN** the task list is complete and non-empty and the integration record is missing or its worktree digest is stale
- **THEN** the archive is refused with the stale integration review and the next review action

#### Scenario: Adopted change archives

- **WHEN** a pre-existing change has a valid host-authenticated adoption receipt
- **THEN** the archive gate accepts the receipt and does not require a recreated directory

#### Scenario: Receipt survives pruning

- **WHEN** the run history is pruned after a successful intake and the current whole-spec `PASS` record exists
- **THEN** the valid authenticated receipt still lets the archive gate accept the completed intake

#### Scenario: Archive is allowed

- **WHEN** every required step has verified evidence
- **THEN** the archive is allowed

#### Scenario: Text claim is refused

- **WHEN** the model claims the review passed without a PASS record
- **THEN** the archive remains refused

#### Scenario: Separator cannot hide an unparsed archive

- **WHEN** a shell command contains `openspec archive <change>` after a `;`, `&&`, `||`, newline, or `cd` compound command and the parser cannot read it as one documented invocation
- **THEN** the call is refused with the "could not be parsed safely" reason and the command does not run

#### Scenario: Quoted or compound archive move is refused

- **WHEN** a command moves a change into the archive with a quoted destination or another command after the destination, such as `git status; git mv openspec/changes/auth "openspec/changes/archive"` or `cd .; mv openspec/changes/auth openspec/changes/archive; pwd`
- **THEN** the call is refused with the "could not be parsed safely" reason and the move does not run

#### Scenario: A quoted or commented mention is refused

- **WHEN** a command contains an archive invocation or archive move only inside quoted text that is not a `-m`, `--message`, or `--body` value, or inside a comment
- **THEN** the call is refused with the "could not be parsed safely" reason rather than interpreted

#### Scenario: A commit message is data

- **WHEN** a `git commit` command's `-m`, `--message`, or `--body` value names `openspec` and `archive`, as in `git commit -m "openspec/changes/auth: the archive gate reads"`, and no executable position names an archive action
- **THEN** the archive gate does not refuse the call and the commit runs

#### Scenario: The documented archive form stays gated

- **WHEN** the model runs the documented `openspec archive <change>` form without the required evidence
- **THEN** the archive is still refused with the run, step, and missing evidence, exactly as before this change

#### Scenario: An evaluated message value is not data

- **WHEN** a `git commit -m` value contains a command substitution such as `$(openspec archive auth)`
- **THEN** the call is refused with the "could not be parsed safely" reason and the command does not run

#### Scenario: A wrapper's positional argument is not data

- **WHEN** a message option on a non-allowlisted wrapper, such as `bash -c 'eval "$1"' --message "openspec archive auth"`, passes the archive mention as a positional argument the wrapper evaluates
- **THEN** the value is not masked, the call is refused with the "could not be parsed safely" reason, and the command does not run

#### Scenario: A git alias is not a verified pair

- **WHEN** a `git` command begins with a `-c` alias prefix and an arbitrary subcommand, such as `git -c alias.review='!bash -c' review -m 'openspec archive auth'`
- **THEN** no mask is applied, the call is refused with the "could not be parsed safely" reason, and the alias does not run

#### Scenario: An escaped quote does not start a data mask

- **WHEN** a `git commit -m` value contains an escaped quote and a following command substitution, such as `git commit -m "a \" -m '$(openspec archive auth)' \" b"`
- **THEN** the uncertain quote boundary abandons the mask, the substitution stays scanned, and the call is refused with the "could not be parsed safely" reason

#### Scenario: A parenthesized subexpression is not a non-archive command

- **WHEN** a command places an archive invocation in a parenthesized subexpression of an allowed OpenSpec command, such as `openspec validate (openspec archive auth)`
- **THEN** the predicate rejects the command, the call is refused with the "could not be parsed safely" reason, and the subexpression does not run

#### Scenario: Prose data does not hide an executable archive

- **WHEN** a command contains a `git commit -m` value naming `openspec` and `archive` and, after a shell separator, places `openspec archive <change>` in the executable position
- **THEN** the message value is data, but the call is refused because the executable invocation is still gated, and the command does not run

#### Scenario: A readable non-archive OpenSpec command is allowed

- **WHEN** a change name contains the word `archive` and the model runs one readable command such as `openspec validate narrow-archive-scan-to-invocations --strict`, `openspec status --change <name>`, or `openspec instructions archive --change <name>`
- **THEN** the command is not an archive invocation and is allowed to run

#### Scenario: A non-archive OpenSpec exemption cannot hide an archive

- **WHEN** a command places `archive` in the OpenSpec subcommand position, such as `openspec "archive" auth`, or places an option or another command before it, such as `openspec --store team archive auth`, or adds a shell control
- **THEN** the call is refused with the "could not be parsed safely" reason, or, when one documented archive form is readable, by the archive evidence gate

#### Scenario: Benign compound command is not an archive

- **WHEN** a compound shell command names no archive invocation or archive move
- **THEN** the archive gate does not refuse it and the call proceeds
