import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button, Menu, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

type ElevationState = 'administrator' | 'standard' | 'unknown'

interface HostStatus {
  platform: string
  elevated: ElevationState
  desktop: boolean
  restart: boolean
}

type Translate = (key: string) => string

interface ComposerInput {
  readonly draft: string
  readonly draftRev: number
  readonly attachmentIds: readonly unknown[]
  readonly occurrences: readonly unknown[]
  readonly phase: string
}

type UseInput = (selector: (state: ComposerInput) => ComposerInput) => ComposerInput

const EMPTY_INPUT: ComposerInput = {
  draft: '',
  draftRev: 0,
  attachmentIds: [],
  occurrences: [],
  phase: 'plain',
}

interface ClientContext {
  slots: {
    inject: (key: string, callback: () => () => void) => () => void
    register: (
      options: { name: string; id: string; order?: number },
      component: (props: { inputActions?: InputActions; useInput?: UseInput }) => ReactNode,
    ) => () => void
  }
  locale: {
    register: (namespace: string, locale: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => Translate
  }
}

export const inject = ['slots', 'locale']

const NS = 'dsh-setup-admin-indicator'
const STATUS_PATH = '/plugins/dsh-setup-admin-indicator/status'
const SHORTCUT_PATH = '/plugins/dsh-setup-admin-indicator/shortcut'

type ActionFetch = (
  input: string,
  init: { method: string; credentials: 'same-origin'; headers: { accept: string } },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/** Execute the fixed authenticated shortcut action. */
export async function runAction(
  fetcher: ActionFetch = fetch,
): Promise<{ ok: boolean; text: string }> {
  try {
    const response = await fetcher(SHORTCUT_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    const body = (await response.json().catch(() => undefined)) as
      | { ok?: unknown; text?: unknown; error?: unknown }
      | undefined
    if (!response.ok) {
      return {
        ok: false,
        text:
          typeof body?.error === 'string'
            ? body.error
            : `The action failed (${String(response.status)}).`,
      }
    }
    if (body?.ok !== true) {
      return {
        ok: false,
        text: typeof body?.text === 'string' ? body.text : 'The action was refused.',
      }
    }
    return { ok: true, text: typeof body?.text === 'string' ? body.text : 'Done.' }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) }
  }
}

const EN: Record<string, string> = {
  'label.administrator': 'Administrator',
  'label.standard': 'Standard User',
  'tooltip.admin': 'Administrator: DSH and all tools are running elevated',
  'tooltip.standard': 'Standard User: DSH is not running as administrator',
  'menu.admin.title': 'Administrator',
  'menu.standard.title': 'Standard User',
  'menu.admin.body': 'DSH and every session, tool, and terminal run with administrator rights.',
  'menu.standard.body':
    'DSH is not elevated. Restart it elevated to run with administrator rights.',
  'menu.standard.bodyShortcut':
    'DSH is not elevated. Create an admin desktop shortcut to launch it elevated.',
  'menu.create': 'Create admin desktop shortcut',
  'menu.unsupported': 'These actions can only be used from the Desktop app.',
  'menu.alreadyAdmin': 'Already running as administrator.',
  'menu.restart': 'Restart DSH as Administrator',
  'menu.restartWarning':
    'This closes DSH and starts an elevated instance. The current session ends.',
  'menu.restartConfirm': 'Restart',
  'menu.restartCancel': 'Cancel',
  'menu.clearDraft': 'Clear the composer draft, references, and attachments to use these actions.',
  'modal.close': 'Close',
}

/** Never replace a draft, reference, or attachment the owner did not send. */
export function canRunAction(input: ComposerInput): boolean {
  return (
    input.draft.trim() === '' &&
    input.attachmentIds.length === 0 &&
    input.occurrences.length === 0 &&
    input.phase === 'plain'
  )
}

/** Submit one fixed slash command after rechecking the latest composer snapshot. */
export function submitCommand(
  actions: InputActions | undefined,
  command: string,
  input: ComposerInput,
): boolean {
  if (actions === undefined || !canRunAction(input)) return false
  if (actions.captureInsertion().draftRev !== input.draftRev) return false
  actions.setDraft(command)
  queueMicrotask(() => actions.submit())
  return true
}

/** One menu decision; the restart branch opens the confirmation before submitting. */
export type MenuAction = 'shortcut' | 'restart' | 'none'

export function menuAction(
  id: string,
  actions: InputActions | undefined,
  input: ComposerInput,
): MenuAction {
  if (actions === undefined || !canRunAction(input)) return 'none'
  if (id === 'shortcut') {
    return submitCommand(actions, '/admin-shortcut', input) ? 'shortcut' : 'none'
  }
  if (id === 'restart') return 'restart'
  return 'none'
}

export function confirmRestart(actions: InputActions | undefined, input: ComposerInput): boolean {
  return submitCommand(actions, '/admin-restart confirm', input)
}

export function apply(ctx: ClientContext): void {
  // Fail open: a broken badge must never turn into a failed web boot that
  // forces the owner to disable every third-party plugin.
  try {
    ctx.locale.register(NS, 'en', EN)
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register({ name: 'conversation.input.left', id: NS, order: 50 }, (props = {}) => (
        <AdminIndicator t={t} inputActions={props.inputActions} useInput={props.useInput} />
      )),
    )
  } catch (error) {
    console.error('admin indicator: Client registration failed', error)
  }
}

function ShieldIcon({ administrator }: { administrator: boolean }): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5 13 3.2v4.1c0 3.4-2.1 5.8-5 7.2-2.9-1.4-5-3.8-5-7.2V3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {administrator ? (
        <path
          d="m5.4 7.6 1.8 1.8 3.4-3.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  )
}

function ShortcutIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="9"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5.5 14h5M8 11.5V14M8 5v4M6 7h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function RestartIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M13 8a5 5 0 1 1-1.4-3.5M13 2.5V5h-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CancelIcon(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="m4.5 4.5 7 7M11.5 4.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function AdminIndicator({
  t,
  inputActions,
  useInput,
}: {
  t: Translate
  inputActions?: InputActions
  useInput?: UseInput
}): ReactNode {
  const [status, setStatus] = useState<HostStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ key: number; text: string; success: boolean } | null>(null)
  const toastSeq = useRef(0)
  const input = (useInput ?? (() => EMPTY_INPUT))((state) => state)
  const liveAttachments = useRef(new Set(input.attachmentIds))
  // The rendered snapshot is authoritative for removals and successful sends;
  // the wrapper below only covers adds that happen before the next render.
  liveAttachments.current = new Set(input.attachmentIds)

  useEffect(() => {
    let active = true
    fetch(STATUS_PATH, {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
      .then((response) => (response.ok ? (response.json() as Promise<HostStatus>) : null))
      .then((value) => {
        if (!active || value === null || value.platform !== 'win32') return
        if (value.elevated !== 'administrator' && value.elevated !== 'standard') return
        setStatus(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Attachment adds do not bump draftRev, so track the public attachment
  // mutations and recheck them when an action is invoked.
  useEffect(() => {
    if (inputActions === undefined) return
    const add = inputActions.addAttachments
    const remove = inputActions.removeAttachment
    const prune = inputActions.pruneAttachments
    inputActions.addAttachments = (ids) => {
      for (const id of ids) liveAttachments.current.add(id)
      return add(ids)
    }
    inputActions.removeAttachment = (id) => {
      liveAttachments.current.delete(id)
      remove(id)
    }
    inputActions.pruneAttachments = (ids) => {
      const keep = new Set<unknown>(ids)
      for (const id of [...liveAttachments.current]) {
        if (!keep.has(id)) liveAttachments.current.delete(id)
      }
      prune(ids)
    }
    return () => {
      inputActions.addAttachments = add
      inputActions.removeAttachment = remove
      inputActions.pruneAttachments = prune
    }
  }, [inputActions])

  if (status === null) return null

  const administrator = status.elevated === 'administrator'
  const restartEnabled = status.restart === true
  const label = administrator ? t('tooltip.admin') : t('tooltip.standard')
  const canAct = inputActions !== undefined && canRunAction(input)
  const currentInput = (): ComposerInput => ({
    ...input,
    attachmentIds: [...liveAttachments.current],
  })

  const restart = (): void => {
    if (!canAct || !restartEnabled) return
    setConfirmOpen(false)
    confirmRestart(inputActions, currentInput())
  }

  const createShortcut = async (): Promise<void> => {
    setBusy(true)
    const outcome = await runAction()
    setBusy(false)
    toastSeq.current += 1
    setToast({ key: toastSeq.current, text: outcome.text, success: outcome.ok })
  }

  const items: MenuEntry[] = [
    {
      type: 'label',
      id: 'state',
      text: t(administrator ? 'menu.admin.title' : 'menu.standard.title'),
    },
    {
      type: 'label',
      id: 'explanation',
      text: t(
        administrator
          ? 'menu.admin.body'
          : restartEnabled
            ? 'menu.standard.body'
            : 'menu.standard.bodyShortcut',
      ),
    },
    { type: 'separator', id: 'actions' },
  ]
  if (!status.desktop) {
    items.push({ type: 'label', id: 'unsupported', text: t('menu.unsupported') })
  } else {
    items.push({
      id: 'shortcut',
      label: t('menu.create'),
      icon: <ShortcutIcon />,
      disabled: busy,
    })
    if (administrator) {
      items.push({ type: 'label', id: 'already-admin', text: t('menu.alreadyAdmin') })
    } else if (restartEnabled) {
      items.push({
        id: 'restart',
        label: t('menu.restart'),
        icon: <RestartIcon />,
        disabled: !canAct,
      })
    }
    if (restartEnabled && !canAct) {
      items.push({ type: 'label', id: 'draft-note', text: t('menu.clearDraft') })
    }
  }

  const onSelect = (id: string): void => {
    if (id === 'shortcut') {
      void createShortcut()
      return
    }
    if (restartEnabled && menuAction(id, inputActions, currentInput()) === 'restart') {
      setConfirmOpen(true)
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        onSelect={onSelect}
        side="top"
        align="start"
        portal
        autoFocus
        anchor={
          <button
            type="button"
            className="dsh-admin-indicator"
            data-state={status.elevated}
            aria-label={label}
            title={label}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <ShieldIcon administrator={administrator} />
            <span className="dsh-admin-indicator-label">
              {administrator ? t('label.administrator') : t('label.standard')}
            </span>
          </button>
        }
      />
      {toast !== null ? (
        <Toast
          key={toast.key}
          text={toast.text}
          tone={toast.success ? 'success' : undefined}
          onDone={() => setToast(null)}
        />
      ) : null}
      {restartEnabled ? (
        <Modal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          title={t('menu.restart')}
          closeLabel={t('modal.close')}
          description={t('menu.restartWarning')}
          footer={
            <>
              <Button
                type="button"
                variant="ghost"
                icon={<CancelIcon />}
                onClick={() => setConfirmOpen(false)}
              >
                {t('menu.restartCancel')}
              </Button>
              <Button
                type="button"
                variant="primary"
                icon={<RestartIcon />}
                disabled={!canAct}
                onClick={restart}
              >
                {t('menu.restartConfirm')}
              </Button>
            </>
          }
        />
      ) : null}
    </>
  )
}

const CSS = `
.dsh-admin-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 220px;
  height: 28px;
  padding: 0 4px 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.dsh-admin-indicator:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-admin-indicator:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}
.dsh-admin-indicator[data-state="administrator"] {
  color: var(--dsw-alias-brand-primary);
}
.dsh-admin-indicator svg {
  flex: none;
}
.dsh-admin-indicator-label {
  min-width: 0;
  overflow: hidden;
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@container (width <= 460px) {
  .dsh-admin-indicator-label {
    display: none;
  }
}
@media (max-width: 460px) {
  .dsh-admin-indicator-label {
    display: none;
  }
}
`
