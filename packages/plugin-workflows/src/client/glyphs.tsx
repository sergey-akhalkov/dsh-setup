import {
  IconBranchOutlineRegular,
  IconCodeOutlineRegular,
  IconPlayOutlineRegular,
  IconRefreshOutlineRegular,
  IconSparkleRegular,
  IconUserOutlineRegular,
  IconUsersOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { BrickIcon } from './bricks.ts'

/**
 * The shipped glyph for one block family. The palette, the canvas nodes, and
 * the inspector share it, so one executor looks the same everywhere.
 */
const GLYPHS: Readonly<Record<BrickIcon, () => ReactNode>> = {
  trigger: () => <IconPlayOutlineRegular />,
  agent: () => <IconSparkleRegular />,
  tool: () => <IconCodeOutlineRegular />,
  subagent: () => <IconUsersOutlineRegular />,
  human: () => <IconUserOutlineRegular />,
  branch: () => <IconBranchOutlineRegular />,
  loop: () => <IconRefreshOutlineRegular />,
}

export function brickGlyph(icon: BrickIcon): ReactNode {
  return GLYPHS[icon]()
}

/**
 * The icon family of one canvas node: its executor when it has one, otherwise
 * its node kind. A tool step and a main step are both `step` nodes, so the
 * executor decides the glyph.
 */
export function executorIcon(executor: string | undefined, kind: string): BrickIcon {
  if (executor === 'tool') return 'tool'
  if (executor === 'subagent') return 'subagent'
  if (executor === 'human') return 'human'
  if (executor === 'branch' || kind === 'branch') return 'branch'
  if (executor === 'loop' || kind === 'loop') return 'loop'
  if (kind === 'trigger') return 'trigger'
  return 'agent'
}
