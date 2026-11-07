import type { ReactNode } from 'react'

/** The one Conversation view this package contributes. */
export const inject = ['slots', 'locale']

const NS = 'dsh-setup-workflows'

/** View copy, registered into the Client locale registry. */
export const EN: Record<string, string> = {
  'view.label': 'Workflows',
}

interface ClientContext {
  effect: (callback: () => () => void) => () => void
  slots: {
    inject: (key: string, callback: () => () => void) => () => void
    register: (
      options: { name: string; id: string; order?: number; label?: string | (() => string) },
      component: (props: { readonly sessionId?: string }) => ReactNode,
    ) => () => void
  }
  locale: {
    register: (namespace: string, locale: string, dictionary: Record<string, string>) => () => void
    bind: (namespace: string) => (key: string) => string
  }
}

/** Register the Workflows conversation view beside Chat, Trajectory, and Observability. */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, 'en', EN))
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        { name: 'conversation.view', id: 'workflows', order: 30, label: () => t('view.label') },
        () => null,
      ),
    )
  } catch (error) {
    console.error('workflows: Client registration failed', error)
  }
}
