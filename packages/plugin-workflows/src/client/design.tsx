import {
  Button,
  IconEllipsisOutlineRegular,
  IconSlidersTwoOutlineRegular,
  Menu,
  type MenuItem,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultMode,
  fallbackNotice,
  inspectorPlacement,
  isConnectShortcut,
  resolveSurface,
  summaryText,
} from './a11y.ts'
import { CanvasBoundary, DesignCanvas } from './canvas.tsx'
import { connectChoices, EDGE_LABELS } from './edges.ts'
import {
  addStepForExecutor,
  blankDefinition,
  connectSteps,
  copyDefinition,
  type DraftEntry,
  deleteDefinition,
  deleteStep,
  type EditorListEntry,
  type EditorState,
  idsOf,
  issueLabel,
  leaveEditor,
  moveStep,
  openDocument,
  openDraft,
  openNew,
  patchDefinition,
  patchStep,
  reconcileCopy,
  reconcileSave,
  reload,
  renameStepId,
  renameToNextId,
  save,
  saveAsCopy,
  setMode,
  setTriggerKind,
  type TemplateEntry,
} from './editor.ts'
import { fetchEditorApi } from './editor-client.ts'
import { type EdgeKind, TRIGGER_NODE } from './graph.ts'
import { ListEditor } from './list.tsx'
import { overlayFor, withOverlay } from './overlay.ts'
import { PaletteMenu } from './palette.tsx'
import type { RunView, Translate } from './panel.tsx'
import { PropertyPanel } from './properties.tsx'
import { defaultDefinitionId, WorkflowRail } from './rail.tsx'
import { activeRun, createRunSelection } from './run-selection.ts'
import { FLOW_CSS } from './styles.ts'

/**
 * The Design mode container. It owns fetching, the editor state machine, the
 * run selector, and the error/list fallback; the palette, canvas, inspector,
 * and list are presentational pieces over the same state and save path.
 */

interface Library {
  readonly definitions: readonly EditorListEntry[]
  readonly templates: readonly TemplateEntry[]
  readonly drafts: readonly DraftEntry[]
}

interface DesignModeProps {
  readonly sessionId?: string
  readonly t: Translate
  /** The panel's measured width; absent falls back to the window width. */
  readonly surfaceWidth?: number
  readonly onClose?: () => void
  readonly onDirtyChange?: (dirty: boolean) => void
}

function windowWidth(): number {
  return typeof window === 'undefined' ? 1024 : window.innerWidth
}

/** The panel's measured width decides the opening surface; below it, the list. */
export function defaultSurface(width?: number): 'canvas' | 'list' {
  return defaultMode(width ?? windowWidth())
}

/**
 * The recovery action a canvas render failure takes: the editor switches to
 * the list surface and keeps the definition editable. Exported so the fallback
 * wiring is covered without a DOM renderer.
 */
export function canvasFailedState(editor: EditorState): EditorState {
  return setMode(editor, 'list')
}

/** The production recovery for a canvas render failure: keep editing in List. */
export function recoverCanvas(editor: EditorState): {
  readonly failed: true
  readonly editor: EditorState
} {
  return { failed: true, editor: canvasFailedState(editor) }
}

export function DesignMode(props: DesignModeProps): ReactNode {
  const { sessionId, t } = props
  const api = useMemo(() => fetchEditorApi(sessionId ?? ''), [sessionId])
  const [library, setLibrary] = useState<Library>({
    definitions: [],
    templates: [],
    drafts: [],
  })
  const [editor, setEditor] = useState<EditorState>()
  const editorRef = useRef<EditorState | undefined>(undefined)
  editorRef.current = editor
  const [selected, setSelected] = useState<string>()
  const [runs, setRuns] = useState<readonly RunView[]>([])
  const [runId, setRunId] = useState<string>()
  const [canvasFailed, setCanvasFailed] = useState(false)
  const [connectValue, setConnectValue] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string>()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const dirty = editor?.dirty === true
  useEffect(() => {
    props.onDirtyChange?.(dirty)
  }, [dirty])

  const taken = useMemo(() => idsOf(library.definitions), [library])

  const refreshLibrary = async (): Promise<void> => {
    try {
      const [definitions, templates, drafts] = await Promise.all([
        api.list(),
        api.templates(),
        api.drafts(),
      ])
      setLibrary({
        definitions: definitions.definitions,
        templates,
        drafts,
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    void refreshLibrary()
    // The view is created once per session; a later session id remounts it.
  }, [sessionId])

  // Keyboard connect: with a node selected, `C` opens the labelled target list.
  // The listener is scoped to this editor's root: a hidden retained editor must
  // never receive the visible editor's key events.
  const root = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const element = root.current
    if (element === null || selected === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !isConnectShortcut({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.isComposing,
          target: event.target as HTMLElement | null,
        })
      ) {
        return
      }
      event.preventDefault()
      setConnectValue('')
    }
    element.addEventListener('keydown', onKeyDown)
    return () => element.removeEventListener('keydown', onKeyDown)
  }, [selected])

  const runSelection = useMemo(
    () => createRunSelection((definitionId: string) => api.runs(definitionId)),
    [api],
  )

  const loadRuns = async (definitionId: string): Promise<void> => {
    await runSelection.load(definitionId, (next) => {
      setRuns(next)
      setRunId(next[0]?.id)
    })
  }

  /** Drop the runs of the previous document, including any in-flight response. */
  const clearRuns = (): void => {
    runSelection.invalidate()
    setRuns([])
    setRunId(undefined)
  }

  /** A freshly opened document starts with no selection and no open drawer. */
  const showDocument = (next: EditorState, options: { readonly keepRuns?: boolean } = {}): void => {
    setEditor({ ...next, mode: defaultSurface(props.surfaceWidth) })
    setSelected(undefined)
    setDetailsOpen(false)
    setConfirmDelete(false)
    setCanvasFailed(false)
    if (options.keepRuns !== true) clearRuns()
  }

  const open = async (id: string): Promise<void> => {
    if (id === '') return
    setLoading(true)
    setMessage(undefined)
    try {
      const [document, layout] = await Promise.all([api.read(id), api.readLayout(id)])
      const next = openDocument({ ...document, layout })
      showDocument(next)
      await loadRuns(id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const saveCurrent = async (): Promise<void> => {
    if (editor === undefined) return
    setLoading(true)
    setMessage(undefined)
    try {
      const result = await save(editor, { api, taken })
      setEditor((current) => {
        if (current === undefined) return result
        if (current === editor) return result
        // An edit landed while the save was in flight: keep it and the draft.
        return reconcileSave(editor, current, result)
      })
      if (result.status === 'saved') {
        await refreshLibrary()
        await loadRuns(result.document.definition.id)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  // The page opens on the first installed workflow. A failed open is reported
  // and never retried automatically; the rail stays the explicit picker.
  const autoOpenTried = useRef(false)
  useEffect(() => {
    if (autoOpenTried.current || editor !== undefined || loading) return
    const first = defaultDefinitionId(library.definitions)
    if (first === undefined) return
    autoOpenTried.current = true
    void open(first)
  }, [library, editor, loading])

  const reloadCurrent = async (): Promise<void> => {
    if (editor === undefined) return
    setLoading(true)
    try {
      const result = await reload(editor, api)
      // A newer edit or document landed while the reload was in flight: it wins.
      if (editorRef.current !== editor) return
      setEditor(result)
      await loadRuns(result.document.definition.id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const removeCurrent = async (): Promise<void> => {
    if (editor === undefined) return
    setLoading(true)
    try {
      const outcome = await deleteDefinition(editor, api)
      setEditor(outcome.deleted ? undefined : outcome.state)
      setConfirmDelete(false)
      if (outcome.deleted) {
        setSelected(undefined)
        clearRuns()
        await refreshLibrary()
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const startBlank = (): void => {
    showDocument(openNew(blankDefinition(taken)))
    setMessage(undefined)
  }

  const applyTemplate = (template: TemplateEntry): void => {
    const copy = copyDefinition(template.definition, taken)
    showDocument(openNew(copy))
    setMessage(undefined)
  }

  const startDraft = async (name: string): Promise<void> => {
    if (name === '') return
    const before = editorRef.current
    setLoading(true)
    try {
      const definition = await api.readDraft(name)
      // The user edited while the draft loaded: never discard that work.
      if (editorRef.current !== before) return
      showDocument(openDraft(name, definition))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const copyCurrent = async (): Promise<void> => {
    if (editor === undefined) return
    setLoading(true)
    try {
      const result = await saveAsCopy(editor, { api, taken })
      // Reconcile against the latest state first: an edit during the request
      // keeps the original document, so its runs must stay selected.
      const latest = editorRef.current ?? editor
      const next = latest === editor ? result : reconcileCopy(editor, latest, result)
      const nextId = next.document.definition.id
      const documentChanged = nextId !== editor.document.definition.id
      if (documentChanged) {
        clearRuns()
      }
      setEditor(next)
      if (documentChanged) {
        await refreshLibrary()
        await loadRuns(nextId)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  const useNextId = (): void => {
    if (editor?.conflict?.nextId === undefined) return
    const nextId = editor.conflict.nextId
    setEditor(renameToNextId(editor, nextId))
    setMessage(undefined)
    // The renamed document is a different definition: never keep the old runs.
    void loadRuns(nextId)
  }

  const apply = (next: EditorState | undefined): void => {
    if (next === undefined) return
    setEditor(next)
    if (next.issues.length === 0 && next.status !== 'error') setMessage(undefined)
  }

  /** An action that replaces the open document warns before discarding edits. */
  const guard = (action: () => void): void => {
    const confirmed = (): boolean =>
      typeof window !== 'undefined' && window.confirm(t('design.closeUnsaved'))
    if (!leaveEditor(editor, confirmed)) return
    action()
  }

  /**
   * Add one step from the block palette; the editor builds its executor shape.
   * A drop also carries the flow position, so the node lands where it was dropped.
   */
  const addExecutor = (executor: string, position?: { x: number; y: number }): void => {
    if (editor === undefined) return
    const added = addStepForExecutor(editor, executor)
    const node = added.diagram.nodes.at(-1)
    const placed =
      position === undefined || node === undefined ? added : moveStep(added, node.id, position)
    apply(placed)
    setSelected(node?.id)
  }

  /** A trigger block patches `trigger.kind` and selects the trigger node. */
  const chooseTrigger = (kind: string): void => {
    if (editor === undefined) return
    apply(setTriggerKind(editor, kind))
    setSelected(TRIGGER_NODE)
  }

  if (sessionId === undefined) {
    return (
      <div className="dsh-wf-design" data-state="no-session">
        <p className="dsh-wf-muted">{t('state.noSession')}</p>
      </div>
    )
  }

  const active = activeRun(runs, runId)
  const overlay =
    editor === undefined
      ? overlayFor(undefined, blankDefinition(new Set()))
      : overlayFor(active, editor.document.definition)
  const surface =
    editor === undefined
      ? defaultSurface(props.surfaceWidth)
      : resolveSurface(editor.mode, canvasFailed)
  const placement = inspectorPlacement(props.surfaceWidth ?? windowWidth())
  const inspectorOpen = placement === 'column' || selected !== undefined || detailsOpen
  const selectedNode = editor?.diagram.nodes.find((node) => node.id === selected)
  const choices =
    editor === undefined || selected === undefined
      ? []
      : connectChoices(editor.diagram.nodes, selected).flatMap((choice) =>
          choice.targets.map((target) => ({
            kind: choice.kind,
            target: target.id,
            label: `${EDGE_LABELS[choice.kind]} → ${target.title}`,
          })),
        )
  const issues = editor?.issues ?? []
  const conflict = editor?.conflict
  const currentTrigger =
    editor === undefined ? undefined : String(editor.document.definition.trigger.kind ?? '')

  const menuItems = (): MenuItem[] => {
    // Every item replaces or writes the document; a request already in flight
    // would otherwise land on the document the user chose in the meantime.
    const items: MenuItem[] = [{ id: 'new', label: t('design.new'), disabled: loading }]
    if (library.templates.length > 0) {
      items.push({
        id: 'templates',
        label: t('design.template'),
        disabled: loading,
        submenu: library.templates.map((template) => ({
          id: `template:${template.id}`,
          label: `${template.name} · ${String(template.stepCount)} steps`,
          disabled: loading,
        })),
      })
    }
    if (library.drafts.length > 0) {
      items.push({
        id: 'drafts',
        label: t('design.draft'),
        disabled: loading,
        submenu: library.drafts.map((draft) => ({
          id: `draft:${draft.name}`,
          label: `${draft.title} (${draft.name})`,
          disabled: loading,
        })),
      })
    }
    items.push({
      id: 'reload',
      label: t('design.reload'),
      disabled: editor === undefined || loading,
    })
    items.push({
      id: 'surface',
      label: surface === 'canvas' ? t('design.listView') : t('design.canvasView'),
      disabled: loading,
    })
    items.push({
      id: 'delete',
      label: t('design.delete'),
      danger: true,
      disabled: editor?.document.revision === null || loading,
    })
    return items
  }

  const onMenuSelect = (id: string): void => {
    setMenuOpen(false)
    if (loading) return
    if (id === 'new') {
      guard(startBlank)
      return
    }
    if (id === 'reload') {
      guard(() => void reloadCurrent())
      return
    }
    if (id === 'surface') {
      if (editor !== undefined) setEditor(setMode(editor, surface === 'canvas' ? 'list' : 'canvas'))
      return
    }
    if (id === 'delete') {
      setConfirmDelete(true)
      return
    }
    if (id.startsWith('template:')) {
      const template = library.templates.find((entry) => entry.id === id.slice('template:'.length))
      if (template !== undefined) guard(() => applyTemplate(template))
      return
    }
    if (id.startsWith('draft:')) {
      // Opening a draft replaces the open document, so it asks like every other
      // replacement action before the draft is read.
      guard(() => void startDraft(id.slice('draft:'.length)))
    }
  }

  const emptyCanvas = (): ReactNode => (
    <section className="dsh-wf-canvas dsh-wf-blank-canvas" data-section="editor-start">
      <div className="dsh-wf-empty">
        <p className="dsh-wf-empty-title">{t('design.intro')}</p>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => guard(startBlank)}
          disabled={loading}
        >
          {t('design.new')}
        </Button>
      </div>
    </section>
  )

  const listSurface = (state: EditorState): ReactNode => (
    <div className="dsh-wf-surface-list">
      <div className="dsh-wf-list-bar">
        <PaletteMenu
          open={paletteOpen}
          onOpen={() => setPaletteOpen(true)}
          onClose={() => setPaletteOpen(false)}
          onAdd={(executor) => addExecutor(executor)}
        />
      </div>
      <ListEditor
        state={state}
        {...(selected === undefined ? {} : { selected })}
        onSelect={setSelected}
        onDefinitionPatch={(patch) => apply(patchDefinition(state, patch))}
        onPatch={(stepId, patch) => apply(patchStep(state, stepId, patch))}
        onConnect={(source, target, kind) => apply(connectSteps(state, source, target, kind))}
        onDelete={(stepId) => {
          apply(deleteStep(state, stepId))
          setSelected(undefined)
        }}
      />
      <PropertyPanel
        state={state}
        {...(selected === undefined ? {} : { selected })}
        onDefinitionPatch={(patch) => apply(patchDefinition(state, patch))}
        onPatch={(stepId, patch) => apply(patchStep(state, stepId, patch))}
        onConnect={(source, target, kind) => apply(connectSteps(state, source, target, kind))}
        onRename={(nodeId, nextId) => apply(renameStepId(state, nodeId, nextId))}
        onDelete={(stepId) => {
          apply(deleteStep(state, stepId))
          setSelected(undefined)
        }}
      />
    </div>
  )

  const editorBody = (): ReactNode => {
    if (editor === undefined) return emptyCanvas()
    return (
      <>
        <p className="dsh-wf-sr-only" aria-live="polite">
          {summaryText(editor.document.definition, selectedNode?.title, overlay)}
        </p>
        {fallbackNotice(canvasFailed) === undefined ? null : (
          <p className="dsh-wf-issue" role="status">
            {fallbackNotice(canvasFailed)}
          </p>
        )}
        {overlay.notices.length === 0 ? null : (
          <p className="dsh-wf-issue" role="status">
            {overlay.notices.join(' ')}
          </p>
        )}
        {overlay.orphans.length === 0 ? null : (
          <p className="dsh-wf-muted" data-orphans={overlay.orphans.length}>
            Orphan run steps (not drawn):{' '}
            {overlay.orphans.map((orphan) => `${orphan.id} (${orphan.state})`).join(', ')}
          </p>
        )}
        {surface === 'list' ? (
          listSurface(editor)
        ) : (
          <div className="dsh-wf-surface-canvas">
            <div className="dsh-wf-canvas" data-tab-group="canvas">
              <CanvasBoundary
                fallback={listSurface(editor)}
                onError={() => {
                  const recovery = recoverCanvas(editor)
                  setCanvasFailed(recovery.failed)
                  setEditor(recovery.editor)
                }}
              >
                <DesignCanvas
                  nodes={withOverlay(editor.diagram.nodes, overlay)}
                  edges={editor.diagram.edges}
                  {...(selected === undefined ? {} : { selected })}
                  focusKey={`${editor.document.definition.id}:${String(editor.document.definition.version)}:${String(editor.diagram.nodes.length)}:${runId ?? ''}`}
                  onSelect={setSelected}
                  onMove={(nodeId, position) => apply(moveStep(editor, nodeId, position))}
                  onConnectNode={(source, target, kind) =>
                    apply(connectSteps(editor, source, target, kind))
                  }
                  onDropBrick={(executor, position) => addExecutor(executor, position)}
                />
              </CanvasBoundary>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="dsh-wf-design" data-state={loading ? 'loading' : 'ready'} ref={root}>
      <style>{FLOW_CSS}</style>
      <div className="dsh-wf-design-head">
        <div className="dsh-wf-head-main">
          <span className="dsh-wf-head-name">
            {editor === undefined ? t('design.pageTitle') : editor.document.definition.name}
          </span>
          {editor === undefined ? null : (
            <>
              <Tag tone="outline">
                {currentTrigger === '' ? t('overview.unknownKind') : currentTrigger}
              </Tag>
              <Tag tone="quiet">{editor.document.source}</Tag>
            </>
          )}
        </div>
        {editor === undefined ? null : (
          <span className="dsh-wf-head-state" data-status={editor.status}>
            <span className="dsh-wf-dirty-dot" data-dirty={editor.dirty} aria-hidden="true" />
            {editor.dirty ? t('design.dirty') : t('design.clean')} · v
            {String(editor.document.definition.version)}
            {editor.document.revision === null ? '' : ` · ${editor.document.revision.slice(0, 8)}`}
          </span>
        )}
        <div className="dsh-wf-head-actions">
          {editor === undefined ? null : (
            <select
              className="dsh-wf-run"
              aria-label={t('design.run')}
              value={runId ?? ''}
              onChange={(event) => setRunId(event.currentTarget.value)}
              disabled={runs.length === 0}
            >
              <option value="">{t('design.noRun')}</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.id} · {run.status}
                  {run.definition === undefined ? '' : ` · v${String(run.definition.version)}`}
                </option>
              ))}
            </select>
          )}
          {placement === 'drawer' && editor !== undefined ? (
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              icon={<IconSlidersTwoOutlineRegular />}
              aria-label={t('design.details')}
              title={t('design.details')}
              aria-pressed={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            />
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void saveCurrent()}
            disabled={editor === undefined || loading || editor.status === 'saving'}
          >
            {t('design.save')}
          </Button>
          {editor === undefined ? null : (
            <Menu
              open={menuOpen}
              items={menuItems()}
              align="end"
              onSelect={onMenuSelect}
              onClose={() => setMenuOpen(false)}
              anchor={
                <Button
                  type="button"
                  variant="toolbar"
                  size="sm"
                  icon={<IconEllipsisOutlineRegular />}
                  aria-label={t('design.more')}
                  title={t('design.more')}
                  onClick={() => setMenuOpen(true)}
                />
              }
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => guard(() => props.onClose?.())}
          >
            {t('design.close')}
          </Button>
        </div>
      </div>
      {confirmDelete && editor !== undefined ? (
        <div className="dsh-wf-confirm" role="alert" data-section="confirm-delete">
          <span>
            {t('design.deletePrompt')} «{editor.document.definition.name}»?
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void removeCurrent()}
            disabled={loading}
          >
            {t('design.delete')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
            {t('design.cancel')}
          </Button>
        </div>
      ) : null}
      <div className="dsh-wf-workbench" data-mode={surface} data-layout={placement}>
        <WorkflowRail
          definitions={library.definitions}
          {...(editor === undefined ? {} : { currentId: editor.document.definition.id })}
          {...(currentTrigger === undefined ? {} : { currentTrigger })}
          {...(editor === undefined || runs[0] === undefined ? {} : { latestRun: runs[0] })}
          disabled={loading}
          t={t}
          onNew={() => guard(startBlank)}
          onOpen={(id) => guard(() => void open(id))}
          onTrigger={chooseTrigger}
          onExecutor={addExecutor}
        />
        <div className="dsh-wf-workbench-main">
          {message === undefined ? null : <p className="dsh-wf-issue">{message}</p>}
          {conflict === undefined ? null : (
            <div className="dsh-wf-design-bar" role="alert" data-conflict={conflict.kind}>
              <span>{editor?.message ?? t('design.conflict')}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => guard(() => void reloadCurrent())}
              >
                {t('design.reload')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyCurrent()}
                disabled={loading}
              >
                {t('design.saveCopy')}
              </Button>
              {conflict.nextId === undefined ? null : (
                <Button type="button" variant="outline" size="sm" onClick={useNextId}>
                  {t('design.useId')} {conflict.nextId}
                </Button>
              )}
            </div>
          )}
          {editor?.message === undefined || conflict !== undefined ? null : (
            <p className="dsh-wf-issue">{editor.message}</p>
          )}
          {editorBody()}
        </div>
        {surface === 'canvas' ? (
          <aside
            className="dsh-wf-inspector"
            data-open={inspectorOpen ? 'true' : 'false'}
            aria-label={t('design.inspector')}
          >
            {placement === 'drawer' ? (
              <div className="dsh-wf-inspector-head">
                <span>{t('design.inspector')}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('design.closeInspector')}
                  onClick={() => {
                    setDetailsOpen(false)
                    setSelected(undefined)
                  }}
                >
                  ×
                </Button>
              </div>
            ) : null}
            {editor === undefined ? null : (
              <PropertyPanel
                state={editor}
                {...(selected === undefined ? {} : { selected })}
                onDefinitionPatch={(patch) => apply(patchDefinition(editor, patch))}
                onPatch={(stepId, patch) => apply(patchStep(editor, stepId, patch))}
                onConnect={(source, target, kind) =>
                  apply(connectSteps(editor, source, target, kind))
                }
                onRename={(nodeId, nextId) => apply(renameStepId(editor, nodeId, nextId))}
                onDelete={(stepId) => {
                  apply(deleteStep(editor, stepId))
                  setSelected(undefined)
                }}
              />
            )}
          </aside>
        ) : null}
      </div>
      {connectValue === undefined ? null : (
        <div className="dsh-wf-design-bar">
          <select
            aria-label="Connection"
            value={connectValue}
            onChange={(event) => setConnectValue(event.currentTarget.value)}
          >
            <option value="">Choose a connection</option>
            {choices.map((choice) => (
              <option
                key={`${choice.kind}:${choice.target}`}
                value={`${choice.kind}:${choice.target}`}
              >
                {choice.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={connectValue === ''}
            onClick={() => {
              if (selected === undefined || editor === undefined) return
              const separator = connectValue.indexOf(':')
              const kind = connectValue.slice(0, separator) as EdgeKind
              const target = connectValue.slice(separator + 1)
              apply(connectSteps(editor, selected, target, kind))
              setConnectValue(undefined)
            }}
          >
            Connect
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConnectValue(undefined)}
          >
            Cancel
          </Button>
        </div>
      )}
      {issues.length === 0 ? null : (
        <ul className="dsh-wf-issue" data-issues={issues.length}>
          {issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              {issueLabel(issue)}: {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
