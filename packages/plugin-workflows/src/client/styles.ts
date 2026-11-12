/**
 * The Design mode's stylesheet string. React Flow's structural rules are
 * copied locally and every colour is mapped to a shipped theme token, so no
 * global stylesheet or CDN link is injected; the block renders inside the view.
 */

export const FLOW_CSS = `
.dsh-wf-page { display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; height: 100%; min-height: 0; padding: 12px; overflow: auto; color: var(--dsw-alias-label-primary); }
.dsh-wf-design { display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0; }
.dsh-wf-design-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-wf-design-bar select { padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; cursor: pointer; }
.dsh-wf-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.dsh-wf-issue { color: var(--dsw-alias-state-error-primary); font: var(--dsw-font-xxs-12); }

/* Header: one title block, one state line, one action cluster. */
.dsh-wf-design-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-width: 0; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-wf-head-main { display: flex; align-items: center; gap: 8px; flex: 1 1 220px; min-width: 0; }
.dsh-wf-head-name { font: var(--dsw-font-s-strong-14); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-wf-head-state { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); white-space: nowrap; }
.dsh-wf-dirty-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-warning-primary); }
.dsh-wf-dirty-dot[data-dirty="false"] { background: var(--dsw-alias-state-success-primary); }
.dsh-wf-head-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.dsh-wf-run { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-wf-confirm { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); font: var(--dsw-font-xxs-12); }

/* The three panes: blocks and library, canvas, inspector. */
.dsh-wf-workbench { position: relative; display: grid; grid-template-columns: 280px 4px minmax(0, 1fr) 4px 360px; gap: 6px; flex: 1; min-height: 0; align-items: stretch; }
.dsh-wf-workbench[data-layout="drawer"] { grid-template-columns: 280px 4px minmax(0, 1fr); }
.dsh-wf-workbench[data-mode="list"] { display: flex; flex-direction: column; min-height: 0; gap: 12px; }
.dsh-wf-splitter { align-self: stretch; border-radius: var(--dsw-radius-sm); cursor: col-resize; background: transparent; transition: background-color 120ms ease; }
.dsh-wf-splitter:hover, .dsh-wf-splitter:focus-visible { background: var(--dsw-alias-border-l2); }
.dsh-wf-workbench-main { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.dsh-wf-workbench[data-mode="list"] .dsh-wf-workbench-main { overflow-y: auto; }

/* Left rail: the library on top, the building blocks below. */
.dsh-wf-rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; overflow-y: auto; }
.dsh-wf-rail-section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dsh-wf-rail-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.dsh-wf-library { display: flex; flex-direction: column; gap: 6px; list-style: none; margin: 0; padding: 0; min-width: 0; }
.dsh-wf-lib-row { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; box-sizing: border-box; width: 100%; height: auto; min-height: 0; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); text-align: left; line-height: 1.4; white-space: normal; }
.dsh-wf-lib-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-wf-lib-row[data-selected="true"] { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); box-shadow: inset 3px 0 0 var(--dsw-alias-label-primary); }
.dsh-wf-lib-title { font: var(--dsw-font-s-strong-14); overflow-wrap: anywhere; }
.dsh-wf-lib-desc { display: -webkit-box; max-width: 100%; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.dsh-wf-lib-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.dsh-wf-lib-run { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.dsh-wf-bricks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; list-style: none; margin: 0; padding: 0; }
.dsh-wf-bricks[data-bricks="triggers"] { grid-template-columns: minmax(0, 1fr); }
.dsh-wf-brick { display: flex; align-items: center; gap: 6px; box-sizing: border-box; width: 100%; height: auto; min-height: 0; justify-content: flex-start; padding: 5px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); text-align: left; }
.dsh-wf-brick:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-wf-brick[data-current="true"] { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-label-primary); box-shadow: inset 2px 0 0 var(--dsw-alias-state-success-primary); }
.dsh-wf-brick[data-brick-kind="trigger"] .dsh-wf-brick-label { font-family: var(--dsw-font-mono, monospace); font-size: 11px; }
.dsh-wf-brick-icon { display: inline-flex; flex: none; color: var(--dsw-alias-label-tertiary); }
.dsh-wf-brick-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Canvas surfaces. */
.dsh-wf-surface-canvas, .dsh-wf-surface-list { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; min-height: 0; }
.dsh-wf-list-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.dsh-wf-canvas { position: relative; display: flex; flex: 1; min-height: 280px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); overflow: hidden; }
.dsh-wf-flow { position: absolute; inset: 0; }
.dsh-wf-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; box-sizing: border-box; padding: 12px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.dsh-wf-blank-canvas { display: flex; align-items: center; justify-content: center; min-height: 320px; }
.dsh-wf-blank-canvas .dsh-wf-empty { max-width: 360px; }
.dsh-wf-empty-title { margin: 0; font: var(--dsw-font-xs-13); color: var(--dsw-alias-label-secondary); }

/* Inspector. */
.dsh-wf-inspector { display: flex; flex-direction: column; min-width: 0; min-height: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.dsh-wf-workbench[data-layout="drawer"] .dsh-wf-inspector { position: absolute; top: 0; right: 0; bottom: 0; z-index: 5; width: min(320px, 88%); }
.dsh-wf-inspector[data-open="false"] { display: none; }
.dsh-wf-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }
.dsh-wf-inspector .dsh-wf-properties { border: none; border-radius: 0; flex: 1; min-height: 0; padding: 12px 14px; }
.dsh-wf-inspector-title { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-wf-inspector-glyph { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 26px; height: 26px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.dsh-wf-inspector-glyph[data-kind="trigger"] { color: var(--dsw-alias-state-success-primary); }
.dsh-wf-inspector-glyph[data-kind="branch"], .dsh-wf-inspector-glyph[data-kind="loop"] { color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-inspector-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-wf-inspector-titles h4 { margin: 0; font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
.dsh-wf-inspector-titles .dsh-wf-muted { font-family: var(--dsw-font-mono, monospace); font-size: 11px; }
.dsh-wf-group { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-wf-group:last-of-type { border-bottom: none; }
.dsh-wf-group-title { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; }

/* Property fields. */
.dsh-wf-properties { display: flex; flex-direction: column; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); overflow: auto; }
.dsh-wf-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-base); }
.dsh-wf-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dsh-wf-card-title { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.06em; text-transform: uppercase; }
.dsh-wf-card-hint { color: var(--dsw-alias-label-caption); font: var(--dsw-font-xxs-12); }
.dsh-wf-card-body { display: flex; flex-direction: column; gap: 8px; }
.dsh-wf-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); line-height: 1.4; }
.dsh-wf-field input, .dsh-wf-field select, .dsh-wf-field textarea { box-sizing: border-box; width: 100%; min-height: 32px; padding: 6px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font-size: 13px; }
.dsh-wf-field textarea { min-height: 64px; }
.dsh-wf-field input:focus-visible, .dsh-wf-field select:focus-visible, .dsh-wf-field textarea:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.dsh-wf-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; }
.dsh-wf-check-list { display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
.dsh-wf-check-list .checkbox { font-size: 13px; }
.dsh-wf-advanced { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
.dsh-wf-advanced > summary { padding: 7px 9px; cursor: pointer; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-wf-advanced[open] > summary { border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-wf-advanced-body { display: flex; flex-direction: column; gap: 8px; padding: 9px; }
.dsh-wf-subhead { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.06em; text-transform: uppercase; }
.dsh-wf-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxs-12); }
.dsh-wf-danger-card { border-color: var(--dsw-alias-border-l2); }
.dsh-wf-danger { color: var(--dsw-alias-state-error-primary); }

/* Canvas node cards. */
.dsh-wf-node { display: flex; flex-direction: column; gap: 6px; min-width: 200px; max-width: 240px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: var(--dsw-font-xxs-12); text-align: left; }
.dsh-wf-node[data-kind="trigger"] { border-color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node[data-kind="branch"], .dsh-wf-node[data-kind="loop"] { border-color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-node[data-state="running"] { border-color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-node[data-state="done"] { border-color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node[data-state="blocked"], .dsh-wf-node[data-state="failed"] { border-color: var(--dsw-alias-state-error-primary); }
.dsh-wf-canvas .react-flow__node.selected .dsh-wf-node { border-color: var(--dsw-alias-label-primary); box-shadow: 0 0 0 1px var(--dsw-alias-label-primary); }
.dsh-wf-node-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.dsh-wf-node-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 26px; height: 26px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.dsh-wf-node[data-kind="trigger"] .dsh-wf-node-icon { color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node-titles { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.dsh-wf-node-title { font: var(--dsw-font-xs-13); font-weight: 600; overflow-wrap: anywhere; }
.dsh-wf-node-meta { color: var(--dsw-alias-label-caption); font-size: 11px; }
.dsh-wf-node-badge { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-node-badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.dsh-wf-node-badge[data-run-state="running"] { color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-node-badge[data-run-state="done"] { color: var(--dsw-alias-state-success-primary); }
.dsh-wf-node-badge[data-run-state="blocked"], .dsh-wf-node-badge[data-run-state="failed"] { color: var(--dsw-alias-state-error-primary); }
.dsh-wf-node-evidence, .dsh-wf-node-violation { display: block; margin-top: 2px; font-size: 11px; color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; }
.dsh-wf-node-evidence { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-wf-node-violation { color: var(--dsw-alias-state-error-primary); }
.dsh-wf-node-orphan { color: var(--dsw-alias-state-warning-primary); }
.dsh-wf-node-end { border-style: dashed; }

/* List editor. */
.dsh-wf-list-wrap { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dsh-wf-list-trigger { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px 12px; box-sizing: border-box; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.dsh-wf-list-trigger h4 { grid-column: 1 / -1; margin: 0; font: var(--dsw-font-xxxs-strong-11); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dsh-wf-list-trigger label { display: flex; flex-direction: column; gap: 4px; min-width: 0; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-xxs-12); }
.dsh-wf-list-trigger input, .dsh-wf-list-trigger select, .dsh-wf-list-trigger textarea { box-sizing: border-box; width: 100%; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }
.dsh-wf-list { width: 100%; table-layout: fixed; border-collapse: collapse; font: var(--dsw-font-xxs-12); }
.dsh-wf-list th { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-xxxs-strong-11); letter-spacing: 0.04em; text-transform: uppercase; font-weight: 600; text-align: left; }
.dsh-wf-list td { padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l2); vertical-align: top; }
.dsh-wf-list input, .dsh-wf-list select, .dsh-wf-list textarea { box-sizing: border-box; width: 100%; padding: 3px 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; }

/* Shared sections and tables. */
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
.dsh-wf-row-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
.dsh-wf-row-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px 8px; min-width: 0; }
.dsh-wf-chips { display: flex; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }
.dsh-wf-def-row, .dsh-wf-trigger-row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-wf-def-row:last-child, .dsh-wf-trigger-row:last-child { border-bottom: none; }
.dsh-wf-mono { font-family: var(--dsw-font-mono, monospace); }

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
.dsh-wf-canvas .react-flow__panel { position: absolute; z-index: 5; margin: 10px; }
.dsh-wf-canvas .react-flow__panel.bottom { bottom: 0; }
.dsh-wf-canvas .react-flow__panel.left { left: 0; }
.dsh-wf-canvas .react-flow__background { position: absolute; inset: 0; z-index: 0; pointer-events: none; background-color: var(--xy-background-color, var(--xy-background-color-default)); }
.dsh-wf-canvas .react-flow__background-pattern.dots { fill: var(--xy-background-pattern-color, var(--dsw-alias-border-l2)); }
.dsh-wf-canvas .react-flow__controls { display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); }
.dsh-wf-canvas .react-flow__controls-button { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 4px; border: none; border-bottom: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsh-wf-canvas .react-flow__controls-button:last-child { border-bottom: none; }
.dsh-wf-canvas .react-flow__controls-button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-wf-canvas .react-flow__controls-button svg { width: 100%; max-width: 12px; max-height: 12px; fill: currentColor; }
.dsh-wf-canvas-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font: var(--dsw-font-xxs-12); }
.dsh-wf-canvas-toolbar label { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.dsh-wf-canvas-toolbar select { padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; }
.dsh-wf-session-canvas { min-height: 320px; }`
