/**
 * The Design mode's stylesheet string. React Flow's structural rules are
 * copied locally and every colour is mapped to a shipped theme token, so no
 * global stylesheet or CDN link is injected; the block renders inside the view.
 */

export const FLOW_CSS = `
.dsh-wf-page { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; height: 100%; min-height: 0; padding: 12px; overflow: auto; color: var(--dsw-alias-label-primary); }
.dsh-wf-design { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.dsh-wf-design-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-wf-design-bar select { padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; }
.dsh-wf-design-body { display: flex; flex-direction: column; gap: 8px; min-height: 320px; }
.dsh-wf-properties h4 { margin: 0 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-canvas { position: relative; min-height: 420px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); overflow: hidden; }
.dsh-wf-summary { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-properties { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); overflow: auto; }
.dsh-wf-properties label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-properties input, .dsh-wf-properties select, .dsh-wf-properties textarea { padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }
.dsh-wf-properties .dsh-wf-row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.dsh-wf-issue { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh-wf-node { min-width: 140px; max-width: 210px; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-base)); color: var(--dsw-alias-label-primary); font-size: 12px; text-align: left; }
.dsh-wf-node[data-kind="trigger"] { border-color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node[data-state="running"] { border-color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-node[data-state="done"] { border-color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node[data-state="blocked"], .dsh-wf-node[data-state="failed"] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-wf-node-title { font-weight: 600; }
.dsh-wf-node-meta { color: var(--dsw-alias-label-caption); font-size: 11px; }
.dsh-wf-node-badge { display: inline-block; margin-top: 2px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-node-evidence, .dsh-wf-node-violation { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }
.dsh-wf-node-violation { color: var(--dsw-alias-state-error-primary); }
.dsh-wf-node-orphan { color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-list { width: 100%; border-collapse: collapse; }
.dsh-wf-list th, .dsh-wf-list td { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
.dsh-wf-list input, .dsh-wf-list select, .dsh-wf-list textarea { width: 100%; padding: 2px 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }

/* The structural React Flow rules (copied from the pinned package's base.css). */
.dsh-wf-canvas .react-flow { direction: ltr; --xy-background-color-default: transparent; --xy-edge-stroke-default: var(--dsw-alias-label-secondary); --xy-edge-stroke-width-default: 1.5; --xy-edge-stroke-selected-default: var(--dsw-alias-state-success-primary); --xy-connectionline-stroke-default: var(--dsw-alias-label-secondary); --xy-connectionline-stroke-width-default: 1.5; --xy-handle-background-color-default: var(--dsw-alias-label-secondary); --xy-node-border-default: 1px solid var(--dsw-alias-border-l2); --xy-node-border-selected-default: 2px solid var(--dsw-alias-state-success-primary); --xy-selection-background-color-default: var(--dsw-alias-border-l2); --xy-selection-border-default: 1px dashed var(--dsw-alias-label-secondary); background-color: var(--xy-background-color, var(--xy-background-color-default)); position: relative; width: 100%; height: 100%; overflow: hidden; }
.dsh-wf-canvas .react-flow__container { position: absolute; width: 100%; height: 100%; top: 0; left: 0; }
.dsh-wf-canvas .react-flow__pane { z-index: 1; cursor: grab; }
.dsh-wf-canvas .react-flow__pane.dragging { cursor: grabbing; }
.dsh-wf-canvas .react-flow__viewport { transform-origin: 0 0; z-index: 2; pointer-events: none; }
.dsh-wf-canvas .react-flow__renderer { z-index: 4; }
.dsh-wf-canvas .react-flow__node { position: absolute; user-select: none; pointer-events: all; transform-origin: 0 0; box-sizing: border-box; cursor: grab; }
.dsh-wf-canvas .react-flow__node.dragging { cursor: grabbing; }
.dsh-wf-canvas .react-flow__handle { position: absolute; pointer-events: none; min-width: 6px; min-height: 6px; width: 6px; height: 6px; background: var(--xy-handle-background-color, var(--xy-handle-background-color-default)); border: 1px solid var(--dsw-alias-bg-base); border-radius: 100%; }
.dsh-wf-canvas .react-flow__handle-top { top: -4px; left: 50%; transform: translate(-50%, 0); }
.dsh-wf-canvas .react-flow__handle-bottom { bottom: -4px; left: 50%; transform: translate(-50%, 0); }
.dsh-wf-canvas .react-flow__handle-left { left: -4px; top: 50%; transform: translate(0, -50%); }
.dsh-wf-canvas .react-flow__handle-right { right: -4px; top: 50%; transform: translate(0, -50%); }
.dsh-wf-canvas .react-flow__edges { position: absolute; }
.dsh-wf-canvas .react-flow__edges svg { overflow: visible; position: absolute; pointer-events: none; }
.dsh-wf-canvas .react-flow__edge { pointer-events: visibleStroke; }
.dsh-wf-canvas .react-flow__edge-path { stroke: var(--xy-edge-stroke, var(--xy-edge-stroke-default)); stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default)); fill: none; }
.dsh-wf-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: var(--xy-edge-stroke-selected, var(--xy-edge-stroke-selected-default)); }
.dsh-wf-canvas .react-flow__edge-text { fill: var(--dsw-alias-label-secondary); font-size: 10px; }
.dsh-wf-canvas .react-flow__edge-textbg { fill: var(--dsw-alias-bg-l1, var(--dsw-alias-bg-base)); }
.dsh-wf-canvas .react-flow__connectionline { z-index: 1001; }
.dsh-wf-canvas .react-flow__connection-path { stroke: var(--xy-connectionline-stroke, var(--xy-connectionline-stroke-default)); stroke-width: var(--xy-connectionline-stroke-width, var(--xy-connectionline-stroke-width-default)); fill: none; }
.dsh-wf-canvas .react-flow__selection { background: var(--xy-selection-background-color, var(--xy-selection-background-color-default)); border: var(--xy-selection-border, var(--xy-selection-border-default)); }
.dsh-wf-canvas .react-flow__attribution { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: var(--dsw-alias-label-caption); background: transparent; }
.dsh-wf-canvas .react-flow__attribution a { color: inherit; }
.dsh-wf-section { display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; min-width: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.dsh-wf-heading { margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dsh-wf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font: var(--dsw-font-xxs-12); }
.dsh-wf-table th { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
.dsh-wf-table td { padding: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.dsh-wf-table tr:last-child td { border-bottom: none; }
.dsh-wf-triggers th:nth-child(1) { width: 20%; }
.dsh-wf-triggers th:nth-child(2) { width: 13%; }
.dsh-wf-triggers th:nth-child(3) { width: 27%; }
.dsh-wf-triggers th:nth-child(4) { width: 10%; }
.dsh-wf-triggers th:nth-child(5) { width: 30%; }
.dsh-wf-definitions th:nth-child(1) { width: 18%; }
.dsh-wf-definitions th:nth-child(2) { width: 28%; }
.dsh-wf-definitions th:nth-child(3) { width: 14%; }
.dsh-wf-definitions th:nth-child(4) { width: 8%; }
.dsh-wf-definitions th:nth-child(5) { width: 32%; }
.dsh-wf-runs { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; min-width: 0; }
.dsh-wf-runs li { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; min-width: 0; font: var(--dsw-font-xxs-12); }
.dsh-wf-muted { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.dsh-wf-kind { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }
.dsh-wf-subject { font: var(--dsw-font-xs-13); overflow-wrap: anywhere; }
.dsh-wf-time { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); font-variant-numeric: tabular-nums; white-space: nowrap; }
.dsh-wf-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
.dsh-wf-list-wrap { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dsh-wf-list-trigger { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px 12px; box-sizing: border-box; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.dsh-wf-list-trigger h4 { grid-column: 1 / -1; margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dsh-wf-list-trigger label { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-wf-list-trigger input, .dsh-wf-list-trigger select, .dsh-wf-list-trigger textarea { box-sizing: border-box; width: 100%; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }
.dsh-wf-list { width: 100%; table-layout: fixed; border-collapse: collapse; font: var(--dsw-font-xxs-12); }
.dsh-wf-list th { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
.dsh-wf-list td { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); vertical-align: top; }
.dsh-wf-list input, .dsh-wf-list select, .dsh-wf-list textarea { box-sizing: border-box; width: 100%; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }`
