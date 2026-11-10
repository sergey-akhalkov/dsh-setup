import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { DesignMode } from './design.tsx'
import {
  EN,
  requestJson,
  type Translate,
  TriggersTable,
  type TriggerView,
  triggersUrl,
} from './panel.tsx'
import { FLOW_CSS } from './styles.ts'
import {
  DefinitionsTable,
  type DefinitionView,
  definitionsUrl,
  ReceiptsList,
  type ReceiptView,
  receiptsUrl,
} from './workflows.tsx'

/**
 * The `Workflow design` right-sidebar page: the editor, then the workspace's
 * definitions, trigger catalog, and receipts. Read-only sections never write;
 * the editor keeps its existing save contract.
 */

const fallbackTranslate: Translate = (key) => EN[key] ?? key

interface TabActions {
  close(): void
}

export interface TabInfo {
  readonly tab: { readonly id: string; readonly actions: TabActions }
}

export interface DesignPageProps {
  readonly sessionId: string
  readonly t?: Translate
  readonly useTabInfo: () => TabInfo
  readonly storage?: unknown
  readonly handoff?: unknown
  readonly useResource?: unknown
}

export interface DesignPageBodyProps {
  readonly sessionId: string
  readonly t: Translate
  /** This tab occurrence's dirty entry; two pages never share one. */
  readonly dirtyKey: string
  close(): void
}

/**
 * The dirty flag per tab occurrence. The sidebar close handler runs outside
 * React and may fire for any page, so each page publishes under its own key
 * and the handler consults only the closing tab's entry.
 */
const dirtyByTab = new Map<string, boolean>()

/** One page occurrence's map key: its session plus its tab id. */
export function designTabKey(sessionId: string, tabId: string): string {
  return `${sessionId}:${tabId}`
}

export function setDesignDirty(key: string, dirty: boolean): void {
  if (dirty) dirtyByTab.set(key, true)
  else dirtyByTab.delete(key)
}

export function isDesignDirty(key: string): boolean {
  return dirtyByTab.get(key) === true
}

/** Whether an explicit tab close must ask first. */
export interface EditorCloseState {
  dirty: boolean
}

/**
 * Ask before an explicit tab close discards a dirty draft. A thrown handler
 * preserves the tab (the shipped close seam), so a declined prompt keeps it.
 */
export function closeWithGuard(state: EditorCloseState, ask: () => boolean): void {
  if (!state.dirty) return
  if (ask()) return
  throw new Error('the workflow design page has unsaved changes')
}

/** The close handler registered for one closing design tab. */
export function closeDesignOnTabClose(t: Translate, key: string): void {
  closeWithGuard({ dirty: isDesignDirty(key) }, () => window.confirm(t('design.closeUnsaved')))
}

interface Sections {
  readonly definitions: readonly DefinitionView[]
  readonly triggers: readonly TriggerView[]
  readonly receipts: readonly ReceiptView[]
}

/**
 * The page body: measure the panel (narrow opens the list), load the read-only
 * workspace state, and hand the editor its close and dirty callbacks.
 */
export function DesignPageBody(props: DesignPageBodyProps): ReactNode {
  const { sessionId, t } = props
  const [width, setWidth] = useState(1024)
  const [sections, setSections] = useState<Sections>({
    definitions: [],
    triggers: [],
    receipts: [],
  })
  const [error, setError] = useState<string>()
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = root.current
    if (element === null) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let current = true
    setError(undefined)
    void Promise.all([
      requestJson<{ definitions: DefinitionView[] }>(definitionsUrl(sessionId)),
      requestJson<{ triggers: TriggerView[] }>(triggersUrl(sessionId)),
      requestJson<{ receipts: ReceiptView[] }>(receiptsUrl(sessionId)),
    ]).then(
      ([definitions, triggers, receipts]) => {
        if (!current) return
        setSections({
          definitions: definitions.definitions,
          triggers: triggers.triggers,
          receipts: receipts.receipts,
        })
      },
      (failure: unknown) => {
        if (!current) return
        setError(failure instanceof Error ? failure.message : String(failure))
      },
    )
    return () => {
      current = false
    }
  }, [sessionId])

  return (
    <div className="dsh-wf-page" ref={root}>
      <style>{FLOW_CSS}</style>
      <DesignMode
        sessionId={sessionId}
        t={t}
        surfaceWidth={width}
        onClose={props.close}
        onDirtyChange={(dirty) => {
          setDesignDirty(props.dirtyKey, dirty)
        }}
      />
      {error === undefined ? null : (
        <p className="dsh-wf-issue" role="alert">
          {error}
        </p>
      )}
      <DefinitionsTable definitions={sections.definitions} t={t} />
      <TriggersTable triggers={sections.triggers} t={t} />
      <ReceiptsList receipts={sections.receipts} t={t} />
    </div>
  )
}

/** The framework wrapper: the tab's close control and the resolved copy. */
export function DesignPage(props: DesignPageProps): ReactNode {
  const { tab } = props.useTabInfo()
  const t = props.t ?? fallbackTranslate
  const dirtyKey = designTabKey(props.sessionId, tab.id)
  const close = (): void => {
    // The editor asked before calling this; the tab close must not ask again.
    setDesignDirty(dirtyKey, false)
    tab.actions.close()
  }
  return <DesignPageBody sessionId={props.sessionId} t={t} dirtyKey={dirtyKey} close={close} />
}
