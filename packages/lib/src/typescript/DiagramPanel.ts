// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { callable, Panel }   from '@jimka/typescript-ui/core';
import { Border }            from '@jimka/typescript-ui/layout';
import { Placement }         from '@jimka/typescript-ui/primitive';
import { Button }            from '@jimka/typescript-ui/component/button';
import { ToolBar }           from '@jimka/typescript-ui/component/menubar';
import { Text }              from '@jimka/typescript-ui/component/input';
import { Spacer }            from '@jimka/typescript-ui/component/container';
import { Glyph }             from '@jimka/typescript-ui/component/display';
import { DiagramView }       from '@jimka/typescript-ui/component/diagram';
import type { DiagramData, DiagramNodeData } from '@jimka/typescript-ui/component/diagram';
import { circle_play }       from '@jimka/typescript-ui/glyphs/solid/circle_play';
import { gears }             from '@jimka/typescript-ui/glyphs/solid/gears';
import { database }          from '@jimka/typescript-ui/glyphs/solid/database';
import { code_branch }       from '@jimka/typescript-ui/glyphs/solid/code_branch';
import { flag_checkered }    from '@jimka/typescript-ui/glyphs/solid/flag_checkered';

// The demo's nodes render glyphs; register them at module load.
Glyph.register(circle_play, gears, database, code_branch, flag_checkered);

/** Multiplicative zoom step per toolbar button press. */
const ZOOM_STEP = 1.25;

const SAMPLE: DiagramData = {
    nodes: [
        { id: 'start', label: 'Start', glyph: 'circle-play' },
        // A compound container: 'process' and 'branch' render inside a titled
        // "Pipeline" box (the default DiagramGroupNode) rather than as bare
        // nodes, showcasing DiagramNodeData.children. Edges below still target
        // 'process'/'branch' directly — a leaf's id is unaffected by grouping.
        {
            id: 'pipeline', label: 'Pipeline',
            children: [
                { id: 'process', label: 'Process',  glyph: 'gears'       },
                { id: 'branch',  label: 'Validate', glyph: 'code-branch' },
            ],
        },
        { id: 'store', label: 'Database', glyph: 'database'       },
        { id: 'done',  label: 'Done',     glyph: 'flag-checkered' },
    ],
    edges: [
        { id: 'e1', source: 'start',   target: 'process' },
        // "one and only one" both ends, e.g. an FK backed by a unique NOT NULL
        // column — one crow's-foot marker kind out of the set this edge showcases.
        { id: 'e2', source: 'process', target: 'store', style: { startMarker: 'one', endMarker: 'one' } },
        // Optional-many: a process can validate zero or many times.
        { id: 'e3', source: 'process', target: 'branch', style: { startMarker: 'zeroOrMany', endMarker: 'one' } },
        // Mandatory-many with a themed dashed stroke and a mid-edge label.
        { id: 'e4', source: 'branch',  target: 'done', style: { startMarker: 'oneOrMany', endMarker: 'one', dashed: true, label: 'ON DELETE CASCADE' } },
        { id: 'e5', source: 'store',   target: 'done'    },
    ],
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
};

/**
 * Demo panel showcasing the
 * [`DiagramView`](/api/component/diagram/classes/DiagramView): a read-only
 * automatic-layout graph laid out by ELK, with themed nodes, an SVG edge layer,
 * pan (drag / trackpad), wheel zoom, and node selection. A few sample edges
 * carry a `style` (crow's-foot cardinality markers, a dashed stroke, and a
 * mid-edge label) to showcase `DiagramEdgeData.style`; plain edges keep the
 * default single arrowhead. The "Process"/"Validate" nodes sit inside a
 * "Pipeline" compound container (`DiagramNodeData.children`), showcasing the
 * default `DiagramGroupNode` container renderer alongside plain leaf nodes.
 *
 * A `Border` layout puts a toolbar (zoom in / out / fit-to-view) at the top and
 * the diagram in the centre; a status line reflects the selected node emitted by
 * the view's `"selection"` event.
 */
class DiagramPanel extends Panel {

    constructor() {
        super({ layoutManager: new Border() });

        const view   = new DiagramView({ data: SAMPLE });
        const status = new Text('Click a node to select it. Drag to pan, wheel to zoom.');

        view.on('selection', (nodes: DiagramNodeData[]) => {
            status.setText(nodes.length > 0 ? `Selected: ${nodes[0].label ?? nodes[0].id}` : 'Selection cleared.');
        });

        const zoomIn  = new Button('Zoom In');
        const zoomOut = new Button('Zoom Out');
        const fit     = new Button('Fit');

        zoomIn.on('action',  () => { view.setZoom(view.getZoom() * ZOOM_STEP); });
        zoomOut.on('action', () => { view.setZoom(view.getZoom() / ZOOM_STEP); });
        fit.on('action',     () => { view.zoomToFit(); });

        const bar = new ToolBar();

        bar.addComponents(zoomIn, zoomOut, fit, Spacer.flex(), status);

        this.addComponent(bar,  { placement: Placement.NORTH });
        this.addComponent(view, { placement: Placement.CENTER });
    }
}

const DiagramPanelCallable = callable(DiagramPanel);
type DiagramPanelCallable = DiagramPanel;
export {
    DiagramPanel         as _DiagramPanel,
    DiagramPanelCallable as DiagramPanel,
};
