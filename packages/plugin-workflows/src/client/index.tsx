import type { ReactNode } from 'react'
import { EN } from './panel.tsx'
import { WorkflowsView } from './view.tsx'

/**
 * Workflows Client half: one Conversation view. The host exposes no command
 * that opens a conversation view, so the tab is the entry point.
 */

export const ENTRY_LIMITATION =
  'The host exposes no command that opens a conversation view; the Workflows tab is the entry.'

/** The Client services the view needs; a host without them stays inert. */
export const inject = ['slots', 'locale', 'resources']

const NS = 'dsh-setup-workflows'

interface ClientContext {
  effect: (callback: () => () => void) => () => void
  get?: (name: string) => unknown
  slots?: {
    inject: (key: string, callback: () => () => void) => () => void
    register: (
      options: { name: string; id: string; order?: number; label?: string | (() => string) },
      component: (props: { readonly sessionId?: string }) => ReactNode,
    ) => () => void
  }
  locale?: {
    register: (namespace: string, locale: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => (key: string) => string
  }
}

/** Register the Workflows conversation view beside Chat, Trajectory, and Observability. */
export function apply(ctx: ClientContext): void {
  try {
    if (
      ctx.slots === undefined ||
      ctx.locale === undefined ||
      ctx.get?.('resources') === undefined
    ) {
      throw new Error('the conversation, slot, locale, or resource services are unavailable')
    }
    const slots = ctx.slots
    const locale = ctx.locale
    ctx.effect(() => locale.register(NS, 'en', EN))
    const t = locale.bind(NS)
    ctx.effect(() =>
      slots.inject('conversation.view', () =>
        slots.register(
          { name: 'conversation.view', id: 'workflows', order: 30, label: () => t('view.label') },
          (props) => (
            <WorkflowsView
              t={t}
              {...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })}
            />
          ),
        ),
      ),
    )
  } catch (error) {
    console.error(
      `workflows: Client registration failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}
