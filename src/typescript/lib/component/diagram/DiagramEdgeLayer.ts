// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// One `<svg>` Component drawing the diagram's edges as `<path>` elements with a
// shared arrowhead `<marker>`. Follows the Glyph SVG-through-the-seam pattern:
// the root `<svg>` and every leaf child are created via `DOM.sink.createElementNS`
// and tracked with `trackHandle`, never raw DOM. The layer is non-interactive
// (`pointer-events: none`) so node clicks fall through to the node components.

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { ElkEdgeSection } from "~/component/diagram/ElkLayoutEngine.js";
import { callable } from "~/core/Callable.js";

/** SVG namespace URI. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** Themed stroke for edge paths and the arrowhead. */
const EDGE_STROKE = "var(--ts-ui-diagram-edge, var(--ts-ui-border-color, rgb(120, 120, 120)))";

/** Edge path stroke width in pixels — a hairline that reads at any zoom. */
const EDGE_STROKE_WIDTH = "1.5";

/** Arrowhead marker box size in user units (matches the `refX`/`refY` below). */
const ARROW_SIZE = 8;

/**
 * A single routed edge: its identity plus the ELK sections describing its
 * polyline route (start point, optional bend points, end point).
 */
export interface DiagramEdgeRoute {
    id:       string;
    sections: ElkEdgeSection[];
}

/**
 * Serialises an edge's ELK sections into an SVG path `d` string. Each section
 * starts with a move to its `startPoint`, threads any `bendPoints`, and lines to
 * its `endPoint`.
 *
 * @param sections - The edge's routed sections.
 * @returns The SVG path data, or an empty string when there is nothing to draw.
 */
function buildPathData(sections: ElkEdgeSection[]): string {
    const parts: string[] = [];

    for (const section of sections) {
        parts.push(`M ${section.startPoint.x} ${section.startPoint.y}`);

        for (const bend of section.bendPoints ?? []) {
            parts.push(`L ${bend.x} ${bend.y}`);
        }

        parts.push(`L ${section.endPoint.x} ${section.endPoint.y}`);
    }

    return parts.join(" ");
}

/**
 * The SVG edge layer for a [`DiagramView`](/api/component/diagram/classes/DiagramView).
 * Owns exactly one `<svg>` element and rebuilds its `<path>` children from ELK
 * edge routes whenever the diagram re-lays-out.
 *
 * @category Components
 */
class DiagramEdgeLayer extends Component<ComponentOptions> {

    /** Cached edge routes, redrawn at render time and on every `setEdges`. */
    private _edges: DiagramEdgeRoute[] = [];

    /** Handles of the currently-drawn `<path>` children, released on rebuild. */
    private _pathHandles: Handle[] = [];

    /** Per-instance arrowhead marker id, referenced by each path's `marker-end`. */
    private readonly _markerId: string;

    constructor(options?: ComponentOptions) {
        super(options);

        this._markerId = `${this.getId()}-arrow`;

        // Non-interactive overlay: clicks must reach the node components beneath.
        this.setPointerEvents("none");
    }

    /**
     * Replaces the drawn edges and rebuilds the path children.
     *
     * @param edges - The routed edges to draw.
     *
     * @returns This layer, for method chaining.
     */
    setEdges(edges: DiagramEdgeRoute[]): this {
        this._edges = edges;
        this.rebuildPaths();

        return this;
    }

    /**
     * Creates the root `<svg>` with its arrowhead `<marker>` in a `<defs>`. The
     * marker and its `<path>` are seam-created leaf children tracked for release.
     *
     * @returns The root `<svg>` handle.
     */
    protected createRootElement(): Handle {
        const svg = DOM.sink.createElementNS(SVG_NS, "svg");

        const defs   = DOM.sink.createElementNS(SVG_NS, "defs");
        const marker = DOM.sink.createElementNS(SVG_NS, "marker");

        DOM.sink.apply(marker, { setAttr: {
            id:           this._markerId,
            markerWidth:  String(ARROW_SIZE),
            markerHeight: String(ARROW_SIZE),
            refX:         String(ARROW_SIZE),
            refY:         String(ARROW_SIZE / 2),
            orient:       "auto",
            markerUnits:  "userSpaceOnUse",
        } });

        const arrow = DOM.sink.createElementNS(SVG_NS, "path");
        DOM.sink.apply(arrow, { setAttr: {
            d:    `M 0 0 L ${ARROW_SIZE} ${ARROW_SIZE / 2} L 0 ${ARROW_SIZE} z`,
            fill: EDGE_STROKE,
        } });

        DOM.sink.appendChild(marker, arrow);
        DOM.sink.appendChild(defs, marker);
        DOM.sink.appendChild(svg, defs);

        this.trackHandle(defs);
        this.trackHandle(marker);
        this.trackHandle(arrow);

        return svg;
    }

    /**
     * Renders the root element and draws the cached edges.
     *
     * @returns The rendered root element.
     */
    protected render(): Handle {
        const element = super.render();

        this.rebuildPaths();

        return element;
    }

    /**
     * Clears the previously-drawn paths and rebuilds them from the cached edge
     * routes. No-op before the element exists — `render` performs the first draw.
     */
    private rebuildPaths(): void {
        const svg = this.getElement();

        if (!svg) {
            return;
        }

        for (const handle of this._pathHandles) {
            DOM.sink.removeChild(svg, handle);
            this.untrackHandle(handle);
            DOM.sink.release(handle);
        }

        this._pathHandles = [];

        for (const edge of this._edges) {
            const d = buildPathData(edge.sections);

            if (!d) {
                continue;
            }

            const path = DOM.sink.createElementNS(SVG_NS, "path");

            DOM.sink.apply(path, { setAttr: {
                d,
                fill:            "none",
                stroke:          EDGE_STROKE,
                "stroke-width":  EDGE_STROKE_WIDTH,
                "marker-end":    `url(#${this._markerId})`,
            } });

            DOM.sink.appendChild(svg, path);
            this.trackHandle(path);
            this._pathHandles.push(path);
        }
    }
}

const DiagramEdgeLayerCallable = callable(DiagramEdgeLayer);
type DiagramEdgeLayerCallable = DiagramEdgeLayer;
export {
    DiagramEdgeLayer         as _DiagramEdgeLayer,
    DiagramEdgeLayerCallable as DiagramEdgeLayer,
};
