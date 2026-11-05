/**
 * OpenSpec apply picker: `/openspec-apply` opens DSH's native `popupSelect`
 * shell with the session workspace's unfinished changes. A pick writes the
 * literal `/openspec-apply-change <name>` into the composer draft and never
 * submits, so the ordinary skill-invocation path runs when the user sends it.
 *
 * The shell owns search, keyboard handling, the empty state, the error strip,
 * and styling; this module supplies option data and the selection handler only.
 *
 * shortcut: the structural commandUi / sessions / conversation faces below are
 * copied from DSH 0.2.1-rc.5; re-verify them when the supported DSH version
 * moves. A host without the command service registers nothing.
 */

/**
 * Document-relative form of the Host route that lists the session workspace's
 * changes. It stays relative so the desktop shell page and the Web page address
 * the same `/api` Fetch route.
 */
export const CHANGES_PATH = 'api/plugins/dsh-setup-openspec/changes'

/** Client services the picker needs; a host without them stays inert. */
export const inject = ['commandUi', 'sessions', 'conversation']

interface SessionLike {
  readonly sessionId: string
}

interface AgentContextLike {
  readonly remote: unknown
}

interface PopupOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

interface PopupSpec {
  readonly kind: 'popupSelect'
  options(session: SessionLike): Promise<PopupOption[]>
  onSelect(option: PopupOption, session: SessionLike): Promise<void>
}

interface CommandContribution {
  readonly name: string
  readonly label: () => string
  readonly description: () => string
  readonly available: (session: SessionLike) => boolean
  readonly ui: PopupSpec
}

interface CommandUi {
  register(contribution: CommandContribution): () => void
}

interface Sessions {
  scope(id: string): AgentContextLike | undefined
}

interface Conversation {
  readonly input: {
    for(actx: AgentContextLike): { setDraft(text: string): void }
  }
}

interface ClientContext {
  get(name: string): unknown
  effect(callback: () => () => void): () => void
}

/** One row of the Host route's response. */
interface ChangeRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: string
}

async function requestChanges(sessionId: string): Promise<ChangeRow[]> {
  const response = await fetch(`${CHANGES_PATH}?session=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined
    throw new Error(
      typeof body?.error === 'string'
        ? body.error
        : `The OpenSpec change list request failed (${String(response.status)}).`,
    )
  }
  const body = (await response.json()) as { changes?: unknown }
  if (!Array.isArray(body.changes)) {
    throw new Error('The OpenSpec change list response was not understood.')
  }
  return body.changes as ChangeRow[]
}

/** The picker lists unfinished changes only; a fully closed root stays empty. */
function optionsOf(changes: readonly ChangeRow[]): PopupOption[] {
  return changes
    .filter((change) => change.status !== 'complete')
    .map((change) => ({
      id: change.name,
      label: change.name,
      detail: `${String(change.completedTasks)}/${String(change.totalTasks)}`,
    }))
}

export function apply(ctx: ClientContext): void {
  const commands = ctx.get('commandUi') as CommandUi | undefined
  const sessions = ctx.get('sessions') as Sessions | undefined
  const conversation = ctx.get('conversation') as Conversation | undefined
  if (commands === undefined || sessions === undefined || conversation === undefined) return

  ctx.effect(() =>
    commands.register({
      name: 'openspec-apply',
      label: () => 'OpenSpec: apply a change',
      description: () =>
        'Pick an unfinished OpenSpec change and fill the apply-change command line',
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: async (session) => optionsOf(await requestChanges(session.sessionId)),
        onSelect: async (option, session) => {
          const actx = sessions.scope(session.sessionId)
          if (actx === undefined) {
            throw new Error('The session is not open, so the command line was not filled.')
          }
          conversation.input.for(actx).setDraft(`/openspec-apply-change ${option.id}`)
        },
      },
    }),
  )
}
