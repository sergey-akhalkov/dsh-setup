import { Button, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { paletteLabel } from './a11y.ts'
import { STEP_BRICKS } from './bricks.ts'

export interface PaletteMenuProps {
  /** Owner-controlled disclosure state; the page keeps the menu closed by default. */
  readonly open: boolean
  readonly disabled?: boolean
  onOpen(): void
  onClose(): void
  onAdd(executor: string): void
}

/**
 * The narrow-panel palette: one `Add step` menu instead of a column, so the
 * editor keeps its width in the right-sidebar page. It offers the same
 * executor blocks as the wide rail.
 */
export function PaletteMenu(props: PaletteMenuProps): ReactNode {
  const items: MenuEntry[] = STEP_BRICKS.map((brick) => ({
    id: brick.value,
    label: paletteLabel(brick.value),
  }))
  return (
    <Menu
      open={props.open}
      onClose={props.onClose}
      items={items}
      onSelect={(id) => {
        props.onClose()
        props.onAdd(id)
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
