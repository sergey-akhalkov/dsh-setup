import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_MODULE_FAILURE_NOTE,
  defaultMode,
  fallbackIsClientOnly,
  fallbackNotice,
  isAddKey,
  isConnectKey,
  isConnectShortcut,
  NARROW_WIDTH,
  paletteLabel,
  resolveSurface,
  summaryText,
  TAB_ORDER,
} from '../src/client/a11y.ts'
import { connectChoices, EDGE_LABELS } from '../src/client/edges.ts'
import { addStep, blankDefinition, connectSteps, openNew, save } from '../src/client/editor.ts'
import { END_NODE, type GraphDefinition, nodeIdOf } from '../src/client/graph.ts'
import { overlayFor } from '../src/client/overlay.ts'
import {
  call,
  elements,
  fire,
  jsx,
  loadClientModules,
  packageDir,
  shallowRender,
} from './client-harness.ts'

const ui = loadClientModules(['canvas.tsx', 'palette.tsx', 'list.tsx', 'design.tsx'])

const DEFINITION = JSON.parse(
  readFileSync(
    join(packageDir, '..', 'plugin-openspec', 'assets', 'workflows', 'change-intake.json'),
    'utf8',
  ),
) as GraphDefinition

describe('mode and fallback', () => {
  it('defaults to the list below the breakpoint and keeps the canvas available', () => {
    expect(NARROW_WIDTH).toBe(720)
    expect(defaultMode(600)).toBe('list')
    expect(defaultMode(1200)).toBe('canvas')
    // The width picks the initial mode; an explicit canvas choice at 600px is
    // honored, and only a canvas render failure forces the list.
    expect(resolveSurface('canvas', false)).toBe('canvas')
    expect(resolveSurface('list', false)).toBe('list')
    expect(resolveSurface('canvas', true)).toBe('list')
    expect(fallbackNotice(true)).toContain('list editor is showing')
    expect(fallbackNotice(false)).toBeUndefined()
  })

  it('renders the list editor when a throwing canvas child is caught', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = openNew(blankDefinition(new Set(['new-workflow'])))
    const patches: string[] = []
    const onError = vi.fn()
    const ThrowingCanvas = (): never => {
      throw new Error('React Flow failed to render')
    }
    const tree = jsx(ui.CanvasBoundary as never, {
      onError,
      children: jsx(ThrowingCanvas, {}),
      fallback: jsx(ui.ListEditor as never, {
        state,
        onSelect: () => {},
        onDefinitionPatch: () => {},
        onPatch: (id: string) => patches.push(id),
        onConnect: () => {},
        onDelete: () => {},
      }),
    })
    const rendered = shallowRender(tree)
    const renderedElements = elements(rendered)
    const title = renderedElements.find(
      (element) => element.type === 'input' && element.props['aria-label'] === 'Title of step-1',
    )
    expect(title).toBeDefined()
    fire(title, 'onChange', 'Edited in the fallback')
    expect(patches).toEqual([nodeIdOf('step-1')])
    expect(onError).toHaveBeenCalledTimes(1)
    expect((ui.canvasFailedState as (state: unknown) => { mode: string })(state).mode).toBe('list')
    errors.mockRestore()
  })

  it('renders the list when the canvas render throws, with a bounded notice', () => {
    // The fallback is client-only: it neither calls the host nor reads/writes runs.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const state = openNew(blankDefinition(new Set(['fallback-demo'])))
    const boundary = new (
      ui.CanvasBoundary as unknown as new (
        props: Record<string, unknown>,
      ) => {
        state: Record<string, unknown>
        render: () => unknown
        componentDidCatch: (error: unknown) => void
      }
    )({ fallback: 'list-editor', onError: () => {} })
    expect(boundary.render()).toBeUndefined()
    const derived = (
      ui.CanvasBoundary as unknown as { getDerivedStateFromError: () => Record<string, unknown> }
    ).getDerivedStateFromError()
    boundary.state = { ...boundary.state, ...derived }
    expect(boundary.render()).toBe('list-editor')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onError = vi.fn(() => {
      const recovery = (
        ui.recoverCanvas as (editor: unknown) => { failed: boolean; editor: { mode: string } }
      )(state)
      expect(recovery.failed).toBe(true)
      expect(recovery.editor.mode).toBe('list')
    })
    const watching = new (
      ui.CanvasBoundary as unknown as new (
        props: Record<string, unknown>,
      ) => {
        componentDidCatch: (error: unknown) => void
      }
    )({
      fallback: 'list-editor',
      onError,
    })
    watching.componentDidCatch(new Error('React Flow failed'))
    expect(onError).toHaveBeenCalledTimes(1)
    errors.mockRestore()
    expect(fallbackIsClientOnly()).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    // The fallback is a client-only state; a module evaluation failure happens
    // before render and is reported by the Harness loader instead.
    expect(CLIENT_MODULE_FAILURE_NOTE).toContain('Harness loader')
  })
})

describe('summary and keyboard', () => {
  it('summarises the trigger, step count, selection, and run state', () => {
    const overlay = overlayFor(
      {
        id: 'workflow:run-1',
        source: 'workflow',
        title: 'run',
        attribution: 'local',
        startedAt: 1,
        status: 'failed',
        steps: [{ id: 'requirements', title: 'requirements', state: 'blocked' }],
      },
      DEFINITION,
    )
    const base = summaryText(DEFINITION, undefined, overlay)
    expect(base).toContain('Trigger tool.pre-execute')
    expect(base).toContain(`${String(DEFINITION.steps.length)} steps`)
    expect(base).toContain('run failed')
    expect(summaryText(DEFINITION, 'Requirements')).toContain('Selected: Requirements')
    expect(summaryText(DEFINITION)).toContain('no run selected')
  })

  it('recognises the keyboard add and connect keys', () => {
    expect(isAddKey('Enter')).toBe(true)
    expect(isAddKey(' ')).toBe(true)
    expect(isAddKey('a')).toBe(false)
    expect(isConnectKey('c')).toBe(true)
    expect(isConnectKey('C')).toBe(true)
    expect(isConnectKey('Enter')).toBe(false)
    // The window-level shortcut never steals text entry, copying, composition,
    // or a key another handler already consumed.
    expect(isConnectShortcut({ key: 'c', target: { tagName: 'INPUT' } })).toBe(false)
    expect(isConnectShortcut({ key: 'C', target: { tagName: 'TEXTAREA' } })).toBe(false)
    expect(isConnectShortcut({ key: 'c', ctrlKey: true, target: { tagName: 'TEXTAREA' } })).toBe(
      false,
    )
    expect(
      isConnectShortcut({
        key: 'c',
        target: { tagName: 'DIV', isContentEditable: true },
      }),
    ).toBe(false)
    expect(isConnectShortcut({ key: 'c', isComposing: true })).toBe(false)
    expect(isConnectShortcut({ key: 'c', defaultPrevented: true })).toBe(false)
    expect(isConnectShortcut({ key: 'c', target: { tagName: 'CANVAS' } })).toBe(true)
    expect(paletteLabel('step')).toBe('Add step')
    expect(paletteLabel('branch')).toBe('Add branch')
    expect(TAB_ORDER).toEqual(['palette', 'canvas', 'properties'])
    // The design page passes the panel's measured width, not the window's.
    const surfaceOf = ui.defaultSurface as (width?: number) => string
    expect(surfaceOf(600)).toBe('list')
    expect(surfaceOf(719)).toBe('list')
    expect(surfaceOf(720)).toBe('canvas')
    expect(surfaceOf(900)).toBe('canvas')
  })

  it('creates a two-step definition with the keyboard add and connect list only', async () => {
    const kinds: string[] = []
    const palette = call(ui, 'PaletteMenu', {
      open: true,
      onOpen: () => {},
      onClose: () => {},
      onAdd: (kind: string) => kinds.push(kind),
    })
    const menu = elements(palette).find((element) => element.type === 'menu')
    // The menu item choice reports the kind; the container applies it.
    ;(menu?.props.onSelect as (id: string) => void)?.('step')
    expect(kinds).toEqual(['step'])
    let state = openNew(blankDefinition(new Set(['new-workflow'])))
    state = addStep(state, 'step')
    const choices = connectChoices(state.diagram.nodes, nodeIdOf('step-1')).find(
      (choice) => choice.kind === 'next',
    )
    expect(choices?.targets.map((target) => target.id)).toEqual(
      expect.arrayContaining([nodeIdOf('step-2'), END_NODE]),
    )
    expect(EDGE_LABELS.next).toBe('next')
    // Keyboard connect: choose the labelled target, then connect.
    state = connectSteps(state, nodeIdOf('step-1'), nodeIdOf('step-2'), 'next')
    state = connectSteps(state, nodeIdOf('step-2'), END_NODE, 'next')
    expect(state.issues).toEqual([])
    const saved = await save(
      { ...state, document: { ...state.document, revision: 'rev-1' } },
      {
        api: {
          list: async () => ({ definitions: [] }),
          templates: async () => [],
          drafts: async () => [],
          read: async () => ({
            definition: state.document.definition,
            revision: 'rev-1',
            source: 'local',
          }),
          readDraft: async () => state.document.definition,
          readLayout: async () => ({ layout: null, revision: null }),
          saveDefinition: async () => ({ ok: true, revision: 'rev-2' }),
          deleteDefinition: async () => ({ ok: true, revision: 'rev-2' }),
          saveLayout: async () => ({ ok: true, revision: 'layout-1' }),
          runs: async () => [],
        },
        taken: new Set(['new-workflow', 'step-1', 'step-2']),
      },
    )
    expect(saved.status).toBe('saved')
    expect(saved.document.definition.steps).toHaveLength(2)
  })
})
