import type { ReactNode } from 'react'
import { isAddKey, paletteLabel } from './a11y.ts'
import type { NodeKind } from './graph.ts'

/** The trigger-first palette: add a step, a branch, a loop, or a human step. */
export const PALETTE_KINDS: readonly NodeKind[] = ['step', 'branch', 'loop', 'human']

export interface PaletteProps {
  readonly onAdd: (kind: NodeKind) => void
  readonly disabled?: boolean
  readonly kinds?: readonly NodeKind[]
}

export function Palette(props: PaletteProps): ReactNode {
  const kinds = props.kinds ?? PALETTE_KINDS
  return (
    <aside className="dsh-wf-palette" data-tab-group="palette" aria-label="Step palette">
      <h4>Palette</h4>
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          data-kind={kind}
          aria-label={paletteLabel(kind)}
          disabled={props.disabled === true}
          onClick={() => props.onAdd(kind)}
          onKeyDown={(event) => {
            if (!isAddKey(event.key)) return
            event.preventDefault()
            props.onAdd(kind)
          }}
        >
          {paletteLabel(kind)}
        </button>
      ))}
    </aside>
  )
}
