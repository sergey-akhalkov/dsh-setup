import { Button, DisclosureRow, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  defaultMode,
  fallbackNotice,
  isConnectShortcut,
  resolveSurface,
  summaryText,
} from './a11y.ts'
import { CanvasBoundary, DesignCanvas } from './canvas.tsx'
import { connectChoices, EDGE_LABELS } from './edges.ts'
import {
  addStep,
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
  type TemplateEntry,
} from './editor.ts'
import { fetchEditorApi } from './editor-client.ts'
import type { EdgeKind, NodeKind } from './graph.ts'
import { ListEditor } from './list.tsx'
import { overlayFor, withOverlay } from './overlay.ts'
import { PaletteMenu } from './palette.tsx'
import type { RunView, Translate } from './panel.tsx'
import { PropertyPanel } from './properties.tsx'
import { activeRun, createRunSelection } from './run-selection.ts'
import { FLOW_CSS } from './styles.ts'

/**
 * The Design mode container. It owns fetching, the editor state machine, the
 * run selector, and the error/list fallback; the palette, canvas, properties,
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
  const [templateName, setTemplateName] = useState('')
  const [draftName, setDraftName] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(true)

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

  const open = async (id: string): Promise<void> => {
    if (id === '') return
    setLoading(true)
    setMessage(undefined)
    try {
      const [document, layout] = await Promise.all([api.read(id), api.readLayout(id)])
      const next = openDocument({ ...document, layout })
      setEditor({ ...next, mode: defaultSurface(props.surfaceWidth) })
      setSelected(undefined)
      setConfirmDelete(false)
      setCanvasFailed(false)
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

  const reloadCurrent = async (): Promise<void> => {
    if (editor === undefined) return
    setLoading(true)
    try {
      const result = await reload(editor, api)
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
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
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
    const next = openNew(blankDefinition(taken))
    setEditor({ ...next, mode: defaultSurface(props.surfaceWidth) })
    setSelected(undefined)
    clearRuns()
    setCanvasFailed(false)
    setMessage(undefined)
  }

  const takeTemplate = (): void => {
    const template = library.templates.find((entry) => entry.id === templateName)
    if (template === undefined) return
    const copy = copyDefinition(template.definition, taken)
    setEditor({ ...openNew(copy), mode: defaultSurface(props.surfaceWidth) })
    setSelected(undefined)
    clearRuns()
    setCanvasFailed(false)
  }

  const startDraft = async (): Promise<void> => {
    if (draftName === '') return
    setLoading(true)
    try {
      const definition = await api.readDraft(draftName)
      setEditor({ ...openDraft(draftName, definition), mode: defaultSurface(props.surfaceWidth) })
      setSelected(undefined)
      clearRuns()
      setCanvasFailed(false)
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

  /** Add one step from the page's `Add step` menu. */
  const addFromPalette = (kind: NodeKind): void => {
    if (editor === undefined) return
    const next = addStep(editor, kind)
    apply(next)
    setSelected(next.diagram.nodes.at(-1)?.id)
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
  const surface = editor === undefined ? 'list' : resolveSurface(editor.mode, canvasFailed)
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

  const body = (): ReactNode => {
    if (editor === undefined) {
      return (
        <section className="dsh-wf-section" data-section="editor-library">
          <p className="dsh-wf-muted">{t('design.intro')}</p>
          <ul className="dsh-wf-runs">
            {library.definitions.map((entry) => (
              <li key={entry.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => guard(() => void open(entry.id))}
                >
                  {entry.name} ({entry.id}) v{entry.version} · {entry.source} ·{' '}
                  {String(entry.stepCount)} steps
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )
    }
    return (
      <>
        <p className="dsh-wf-summary" aria-live="polite">
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
        <div className="dsh-wf-design-body" data-mode={surface}>
          {surface === 'list' ? (
            <ListEditor
              state={editor}
              {...(selected === undefined ? {} : { selected })}
              onSelect={setSelected}
              onDefinitionPatch={(patch) => apply(patchDefinition(editor, patch))}
              onPatch={(stepId, patch) => apply(patchStep(editor, stepId, patch))}
              onConnect={(source, target, kind) =>
                apply(connectSteps(editor, source, target, kind))
              }
              onDelete={(stepId) => {
                apply(deleteStep(editor, stepId))
                setSelected(undefined)
              }}
            />
          ) : (
            <div className="dsh-wf-canvas" data-tab-group="canvas">
              <CanvasBoundary
                fallback={
                  <ListEditor
                    state={editor}
                    {...(selected === undefined ? {} : { selected })}
                    onSelect={setSelected}
                    onDefinitionPatch={(patch) => apply(patchDefinition(editor, patch))}
                    onPatch={(stepId, patch) => apply(patchStep(editor, stepId, patch))}
                    onConnect={(source, target, kind) =>
                      apply(connectSteps(editor, source, target, kind))
                    }
                    onDelete={(stepId) => {
                      apply(deleteStep(editor, stepId))
                      setSelected(undefined)
                    }}
                  />
                }
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
                />
              </CanvasBoundary>
            </div>
          )}
          <DisclosureRow
            icon={null}
            title={t('design.properties')}
            open={propertiesOpen}
            expandable
            expandOnRowClick
            onToggle={() => setPropertiesOpen((current) => !current)}
          >
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
          </DisclosureRow>
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
                if (selected === undefined) return
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
      </>
    )
  }

  return (
    <div className="dsh-wf-design" data-state={loading ? 'loading' : 'ready'} ref={root}>
      <style>{FLOW_CSS}</style>
      <div className="dsh-wf-design-bar">
        <strong>{t('design.title')}</strong>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(() => props.onClose?.())}
        >
          {t('design.close')}
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(startBlank)}
          disabled={loading}
        >
          {t('design.new')}
        </Button>
        <select
          aria-label={t('design.open')}
          value={editor?.document.definition.id ?? ''}
          onChange={(event) => guard(() => void open(event.currentTarget.value))}
          disabled={loading}
        >
          <option value="">{t('design.open')}</option>
          {library.definitions.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.id}) · {entry.source}
            </option>
          ))}
        </select>
        <select
          aria-label={t('design.template')}
          value={templateName}
          onChange={(event) => setTemplateName(event.currentTarget.value)}
          disabled={loading}
        >
          <option value="">{t('design.template')}</option>
          {library.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} · {String(template.stepCount)} steps
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(takeTemplate)}
          disabled={templateName === '' || loading}
        >
          {t('design.copyTemplate')}
        </Button>
        <select
          aria-label={t('design.draft')}
          value={draftName}
          onChange={(event) => setDraftName(event.currentTarget.value)}
          disabled={loading}
        >
          <option value="">{t('design.draft')}</option>
          {library.drafts.map((draft) => (
            <option key={draft.name} value={draft.name}>
              {draft.title} ({draft.name}) · {String(draft.stepCount)} steps
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(() => void startDraft())}
          disabled={draftName === '' || loading}
        >
          {t('design.openDraft')}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void saveCurrent()}
          disabled={editor === undefined || loading || editor.status === 'saving'}
        >
          {t('design.save')}
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(() => void reloadCurrent())}
          disabled={editor === undefined || loading}
        >
          {t('design.reload')}
        </Button>
        <Button
          type="button"
          variant="toolbar"
          size="sm"
          onClick={() => guard(() => void removeCurrent())}
          disabled={editor === undefined || editor.document.revision === null || loading}
        >
          {confirmDelete ? t('design.confirmDelete') : t('design.delete')}
        </Button>
        <SegmentedControl
          id="dsh-wf-surface"
          value={surface}
          options={[
            { value: 'list', label: t('design.listMode') },
            { value: 'canvas', label: t('design.canvasMode') },
          ]}
          onChange={(next) => {
            if (editor === undefined) return
            setEditor(setMode(editor, next))
          }}
          label={t('design.mode')}
        />
        <PaletteMenu
          open={paletteOpen}
          onOpen={() => setPaletteOpen(true)}
          onClose={() => setPaletteOpen(false)}
          onAdd={addFromPalette}
          {...(editor === undefined ? { disabled: true } : {})}
        />
        <select
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
        <span className="dsh-wf-muted" data-status={editor?.status ?? 'none'}>
          {editor === undefined
            ? ''
            : `${editor.dirty ? t('design.dirty') : t('design.clean')} · v${String(editor.document.definition.version)}${editor.document.revision === null ? '' : ` · ${editor.document.revision.slice(0, 8)}`}`}
        </span>
      </div>
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
      {body()}
    </div>
  )
}
