import { Button, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { paletteLabel } from './a11y.ts'
import type { NodeKind } from './graph.ts'

/** The trigger-first palette: add a step, a branch, a loop, or a human step. */
export const PALETTE_KINDS: readonly NodeKind[] = ['step', 'branch', 'loop', 'human']

export interface PaletteMenuProps {
  /** Owner-controlled disclosure state; the page keeps the menu closed by default. */
  readonly open: boolean
  readonly disabled?: boolean
  onOpen(): void
  onClose(): void
  onAdd(kind: NodeKind): void
}

/**
 * The narrow-panel palette: one `Add step` menu instead of a column, so the
 * editor keeps its width in the right-sidebar page.
 */
export function PaletteMenu(props: PaletteMenuProps): ReactNode {
  const items: MenuEntry[] = PALETTE_KINDS.map((kind) => ({ id: kind, label: paletteLabel(kind) }))
  return (
    <Menu
      open={props.open}
      onClose={props.onClose}
      items={items}
      onSelect={(id) => {
        props.onClose()
        props.onAdd(id as NodeKind)
      }}
      anchor={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled === true}
          onClick={props.onOpen}
        >
          {'Add step'}
        </Button>
      }
    />
  )
}
