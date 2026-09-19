import { Panel } from '@jimka/typescript-ui/core';
import { Button } from '@jimka/typescript-ui/component/button';
import { DiagramView } from '@jimka/typescript-ui/component/diagram';
import { ToolBar } from '@jimka/typescript-ui/component/menubar';
import { Border } from '@jimka/typescript-ui/layout';
import { Placement } from '@jimka/typescript-ui/primitive';
import { diagramTree } from '../builders/data.js';
import { elementFor, requireElement } from '../builders/dom.js';
import type { HarnessTools } from '../harness/types.js';
import type { PanelBuild } from '../panels.js';

/** The panel's id, for errors. */
const PANEL = 'diagram-graph';

/** ELK's layered algorithm, left to right: `DiagramPanel`'s layout. */
const LAYOUT_OPTIONS: Record<string, string> = { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' };

/** The view's zoom, held rather than fitted, so how many nodes are mounted depends on the viewport alone. */
const VIEW_ZOOM = 1;

export const description = 'DiagramView of an ELK-layered three-way tree of n nodes (default 400) at zoom 1, under a toolbar of zoom buttons, as DiagramPanel is. Reproduces slice 27 F27.2 (a click on the canvas looks up every node): getElementById + contains = 2n + 2 per click; F27.1 (a pan move writes a stylesheet rule): 1 setRuleStyles per pan unit; and F27.3 (a zoom notch recomputes edge residency): 1 setResidency@DiagramEdgeLayer per wheel unit.';

/** 400 nodes: slice 27's graph. */
export const defaultScale = 400;

/** A click on the empty canvas behind the nodes, which looks up every node. */
export const defaultDrive = 'click';

/** The view the toolbar's handlers drive: the mounted panel's. A page mounts one panel. */
let toolbarView: DiagramView | null = null;

/** The Zoom In button's handler. */
function zoomInView(): void {
    toolbarView?.zoomIn();
}

/** The Zoom Out button's handler. */
function zoomOutView(): void {
    toolbarView?.zoomOut();
}

/** The Fit button's handler. */
function fitView(): void {
    toolbarView?.zoomToFit();
}

/** The Reset button's handler. */
function resetView(): void {
    toolbarView?.resetView();
}

/**
 * Builds a `DiagramView` of `diagramTree(n)` under a toolbar of four zoom
 * buttons.
 *
 * @param n - Nodes.
 * @returns The border panel as root, target of `resize`; the view, target of `passes`; and an asynchronous `afterMount` that waits for the layout, then gives `click`, `pan` and `wheel` the node layer and `hover` the view.
 */
export function build(n: number): PanelBuild {
    const view = DiagramView({ data: diagramTree(n), fitOnLoad: false, zoom: VIEW_ZOOM, layoutOptions: LAYOUT_OPTIONS });

    const toolBar = ToolBar({
        components: [
            Button({ text: 'Zoom In', listeners: { action: zoomInView } }),
            Button({ text: 'Zoom Out', listeners: { action: zoomOutView } }),
            Button({ text: 'Fit', listeners: { action: fitView } }),
            Button({ text: 'Reset', listeners: { action: resetView } }),
        ],
    });

    const root = Panel({
        layoutManager: Border(),
        components: [
            { component: toolBar, constraints: { placement: Placement.NORTH } },
            { component: view, constraints: { placement: Placement.CENTER } },
        ],
    });

    toolbarView = view;

    return {
        root,
        targets: { resize: root, passes: view },
        afterMount: async (tools: HarnessTools): Promise<Record<string, unknown>> => {
            // ELK lays the graph out asynchronously; a census taken before it
            // lands would measure an empty view.
            await view.whenLaidOut();

            const viewElement = elementFor(tools, view, PANEL);
            // The empty canvas behind the nodes.
            const layer = requireElement(viewElement, '.DiagramNodeLayer', PANEL);

            return {
                click: { elements: [layer] },
                pan: { element: layer, axis: 'x' },
                wheel: layer,
                hover: { element: viewElement, axis: 'x' },
            };
        },
        geometry: { view },
        describe: () => ({
            nodes: n,
            // The nodes attached now: only those near the viewport are mounted,
            // so this depends on the screen. It is a lower bound on the nodes a
            // click scans with `contains`, never that count: unmounting only
            // detaches the element, and the node component keeps it cached, so
            // a node residency has dropped is still scanned. See the plan's M16.
            nodeElements: document.getElementById(view.getId())?.querySelectorAll('.DiagramNode').length ?? 0,
        }),
        installWork: (tools: HarnessTools): string[] => {
            const edgeLayer = tools.findComponent('DiagramEdgeLayer');

            return [edgeLayer ? tools.countMethod(edgeLayer, 'setResidency') : 'no DiagramEdgeLayer component'];
        },
    };
}
