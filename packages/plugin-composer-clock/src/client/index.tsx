// Client half of @dsh-setup/plugin-composer-clock.
//
// The plugin object runs in the browser module table: `apply` registers into
// the conversation composer dock and `inject` waits for the Client slot
// service. `dsh.client.inject` in package.json orders this package after the
// conversation Client package, which declares the slot.
//
// Non-baseline runtime imports belong in `dsh.client.external` in package.json;
// React and its runtime are provided by the module table and are never bundled.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ReactNode } from 'react'

export const inject = ['slots']

/** Render a compact local time label that inherits the host theme. */
function ComposerClock(): ReactNode {
  const now = new Date()
  const time = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return (
    <span
      style={{
        alignSelf: 'flex-end',
        fontSize: '11px',
        fontVariantNumeric: 'tabular-nums',
        opacity: 0.55,
        padding: '0 2px',
      }}
      title={now.toLocaleDateString()}
    >
      {time}
    </span>
  )
}

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      { name: 'conversation.composer.dock', id: 'dsh-setup-composer-clock', order: 50 },
      ComposerClock,
    ),
  )
}
