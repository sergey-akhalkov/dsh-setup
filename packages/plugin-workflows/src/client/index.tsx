import type { ReactNode } from 'react'
import {
  closeDesignOnTabClose,
  DesignPage,
  type DesignPageProps,
  designTabKey,
} from './design-page.tsx'
import { EN } from './panel.tsx'
import { WorkflowsView } from './view.tsx'

/**
 * Workflows Client half: one Conversation view (the session's runs and journal)
 * and, when the right-sidebar services exist, one `Workflow design` page opened
 * from its guide card. The host exposes no command that opens a client view, so
 * the tab and the card are the entries.
 */

export const ENTRY_LIMITATION =
  'The host exposes no command that opens a conversation view; the Workflows tab is the entry.'

/** The Client services the view needs; a host without them stays inert. */
export const inject = ['slots', 'locale', 'resources']

/** The design page's tab type id, kind, and required services. */
export const DESIGN_ID = '@dsh-setup/plugin-workflows/design'
export const DESIGN_KIND = 'workflows-design'
export const DESIGN_SERVICES = ['sidebarRight', 'sidebarRightTabs', 'slots', 'locale', 'resources']

const NS = 'dsh-setup-workflows'

interface GuideEntry {
  readonly id: string
  readonly commandId: string
  readonly order: number
  readonly title: () => string
  readonly description?: () => string
}

interface TabDefinition {
  readonly id: string
  readonly kind: string
  readonly patterns?: readonly string[]
  readonly priority?: string
  readonly canOpen?: (address: string) => boolean
  readonly title: (address: string) => string
  readonly guide?: readonly GuideEntry[]
  /** Retain the body across hide/collapse so an unsaved editor draft survives. */
  readonly keepMounted?: boolean
}

interface TabsFace {
  register(definition: TabDefinition): () => void
}

interface SidebarRightFace {
  registerCloseHandler(
    kind: string,
    handler: (sessionId: string, tab: { readonly id: string }) => void,
  ): () => void
}

interface LocaleFace {
  register(namespace: string, locale: string, dictionary: Record<string, string>): () => void
  bind(namespace: string): (key: string) => string
}

interface SlotsFace {
  inject(key: string, callback: () => () => void): () => void
  register<TProps>(
    options: Record<string, unknown>,
    component: (props: TProps) => ReactNode,
  ): () => void
}

interface ClientContext {
  effect: (callback: () => () => void) => () => void
  get?: (name: string) => unknown
  inject?: (deps: readonly string[], callback: (ctx: ClientContext) => void) => () => void
  slots?: SlotsFace
  locale?: LocaleFace
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
          (props: { readonly sessionId?: string }) => (
            <WorkflowsView
              t={t}
              {...(props.sessionId === undefined ? {} : { sessionId: props.sessionId })}
            />
          ),
        ),
      ),
    )
    // A host without the right-sidebar services keeps the session view only.
    if (typeof ctx.inject !== 'function') return
    ctx.inject(DESIGN_SERVICES, (designCtx) => {
      registerDesignPage(designCtx)
    })
  } catch (error) {
    console.error(
      `workflows: Client registration failed (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}

/**
 * Register the design page's tab type, Start card, body, and close handler.
 * Returns silently when the right-sidebar services are absent.
 */
export function registerDesignPage(ctx: ClientContext): void {
  try {
    const tabs = ctx.get?.('sidebarRightTabs') as TabsFace | undefined
    const sidebarRight = ctx.get?.('sidebarRight') as SidebarRightFace | undefined
    const slots = ctx.get?.('slots') as SlotsFace | undefined
    const locale = ctx.get?.('locale') as LocaleFace | undefined
    if (
      tabs === undefined ||
      sidebarRight === undefined ||
      slots === undefined ||
      locale === undefined
    ) {
      return
    }
    const t = locale.bind(NS)
    ctx.effect(() =>
      tabs.register({
        id: DESIGN_ID,
        kind: DESIGN_KIND,
        priority: 'extension',
        // Hiding a tab bypasses close handlers; keep the editor's draft mounted.
        keepMounted: true,
        title: () => t('design.pageTitle'),
        guide: [
          {
            id: 'design',
            commandId: 'workflows.design',
            order: 10,
            title: () => t('design.guideTitle'),
            description: () => t('design.guideDescription'),
          },
        ],
      }),
    )
    ctx.effect(() =>
      slots.inject('sidebar.right.pane.tab', () =>
        slots.register(
          { name: 'sidebar.right.pane.tab', key: DESIGN_ID, locale: NS },
          (props: DesignPageProps) => <DesignPage {...props} />,
        ),
      ),
    )
    ctx.effect(() =>
      sidebarRight.registerCloseHandler(DESIGN_KIND, (sessionId, tab) => {
        closeDesignOnTabClose(t, designTabKey(sessionId, tab.id))
      }),
    )
  } catch (error) {
    console.error(
      `workflows: the design page could not be registered (${error instanceof Error ? error.message : String(error)})`,
    )
  }
}
