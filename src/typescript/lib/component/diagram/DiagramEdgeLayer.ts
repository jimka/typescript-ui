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
import type { ElkEdgeSection, ElkPoint } from "~/component/diagram/ElkLayoutEngine.js";
import type { DiagramEdgeMarker, DiagramEdgeStyle } from "~/component/diagram/DiagramModel.js";
import { callable } from "~/core/Callable.js";

/** SVG namespace URI. */
const SVG_NS = "http://www.w3.org/2000/svg";

/** Themed stroke for edge paths and the arrowhead. */
const EDGE_STROKE = "var(--ts-ui-diagram-edge, var(--ts-ui-border-color, rgb(120, 120, 120)))";

/** Edge path stroke width in pixels — a hairline that reads at any zoom. */
const EDGE_STROKE_WIDTH = "1.5";

/** Font size (px) of an edge's mid-route label. */
const LABEL_FONT_SIZE = "12";

/**
 * Background colour and width (px) of the halo drawn behind an edge label. The
 * label text is painted `stroke`-then-`fill` (`paint-order`), so this
 * background-coloured stroke masks the edge line running under the glyphs — the
 * label reads clearly instead of being crossed out by the edge.
 */
const LABEL_HALO       = "var(--ts-ui-diagram-bg, var(--ts-ui-panel-bg, rgb(255, 255, 255)))";
const LABEL_HALO_WIDTH = "4";

/** Arrowhead marker box size in user units (matches the `refX`/`refY` below). */
const ARROW_SIZE = 8;

/** Dash pattern applied when an edge's `style.dashed` is set. */
const DASH_ARRAY = "6 4";

/**
 * Non-`"arrow"` crow's-foot marker kinds this layer pre-defines in `<defs>`.
 * Kept as a literal array (rather than deriving from {@link DiagramEdgeMarker})
 * so `createRootElement` can iterate it directly.
 */
const CROWS_FOOT_MARKERS: readonly Exclude<DiagramEdgeMarker, "arrow">[] =
    ["one", "zeroOrOne", "oneOrMany", "zeroOrMany"];

/**
 * One crow's-foot marker's geometry: its `<marker>` box (`width`/`height`),
 * the point within that box the edge vertex anchors to (`refX`/`refY`), and
 * its child shapes as bare SVG element specs. Every marker uses
 * `orient="auto-start-reverse"`, so the same definition auto-flips when used
 * at `marker-start` and reads unreversed at `marker-end`.
 */
interface MarkerGeometry {
    width:  number;
    height: number;
    refX:   number;
    refY:   number;
    /** Child shapes, each a bare tag name plus its SVG attributes. */
    parts: Array<{ tag: "path" | "circle"; attrs: Record<string, string> }>;
}

/**
 * Geometry table for the four crow's-foot markers. Coordinates are chosen so
 * every marker's "attach" edge sits at `x = width` (the vertex, via `refX`)
 * and its "open" edge sits toward `x = 0` (away from the node) — exact pixels
 * are a manual visual-tuning step, not a correctness concern (see the
 * fk-diagram-cardinality-and-index-coverage plan).
 */
const MARKER_GEOMETRY: Record<Exclude<DiagramEdgeMarker, "arrow">, MarkerGeometry> = {
    // "one and only one": two perpendicular bars across the line.
    one: {
        width: 12, height: 12, refX: 12, refY: 6,
        parts: [{ tag: "path", attrs: { d: "M 4 0 L 4 12 M 8 0 L 8 12" } }],
    },
    // "zero or one": one perpendicular bar plus a small inboard circle.
    zeroOrOne: {
        width: 16, height: 12, refX: 16, refY: 6,
        parts: [
            { tag: "path", attrs: { d: "M 12 0 L 12 12" } },
            { tag: "circle", attrs: { cx: "6", cy: "6", r: "4" } },
        ],
    },
    // "one or many": a three-prong crow's foot plus one perpendicular bar just inboard of it.
    oneOrMany: {
        width: 16, height: 12, refX: 16, refY: 6,
        parts: [
            { tag: "path", attrs: { d: "M 0 6 L 12 0 M 0 6 L 12 6 M 0 6 L 12 12" } },
            { tag: "path", attrs: { d: "M 14 0 L 14 12" } },
        ],
    },
    // "zero or many": a three-prong crow's foot plus a small inboard circle.
    zeroOrMany: {
        width: 18, height: 12, refX: 18, refY: 6,
        parts: [
            { tag: "path", attrs: { d: "M 6 6 L 18 0 M 6 6 L 18 6 M 6 6 L 18 12" } },
            { tag: "circle", attrs: { cx: "3", cy: "6", r: "3" } },
        ],
    },
};

/**
 * A single routed edge: its identity, the ELK sections describing its
 * polyline route (start point, optional bend points, end point), and its
 * optional visual style (joined in from the model by
 * [`DiagramView.applyLayout`](/api/component/diagram/classes/DiagramView)).
 */
export interface DiagramEdgeRoute {
    id:       string;
    sections: ElkEdgeSection[];
    /** Optional cardinality/dependency style. Absent = today's plain arrow-ended edge. */
    style?: DiagramEdgeStyle;
}

/**
 * The midpoint used to place an edge's optional label: the middle bend point
 * when the route has an odd bend count centred on one, else the midpoint of
 * the first section's start/end points. A simple, deterministic placement —
 * exact label layout is a manual visual-tuning step.
 *
 * @param sections - The edge's routed sections.
 * @returns The label anchor point.
 */
function labelPoint(sections: ElkEdgeSection[]): ElkPoint {
    const section = sections[0];
    const bends   = section?.bendPoints ?? [];

    if (bends.length > 0) {
        return bends[Math.floor((bends.length - 1) / 2)];
    }

    if (!section) {
        return { x: 0, y: 0 };
    }

    return {
        x: (section.startPoint.x + section.endPoint.x) / 2,
        y: (section.startPoint.y + section.endPoint.y) / 2,
    };
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

    /** Handles of the currently-drawn `<path>`/`<text>` children, released on rebuild. */
    private _pathHandles: Handle[] = [];

    /** Per-instance arrowhead marker id, referenced by each plain edge's `marker-end`. */
    private readonly _markerId: string;

    /** Per-instance crow's-foot marker ids, keyed by marker kind. */
    private readonly _crowsFootMarkerIds: Record<Exclude<DiagramEdgeMarker, "arrow">, string>;

    constructor(options?: ComponentOptions) {
        super(options);

        this._markerId = `${this.getId()}-arrow`;
        this._crowsFootMarkerIds = Object.fromEntries(
            CROWS_FOOT_MARKERS.map(kind => [kind, `${this.getId()}-${kind}`]),
        ) as Record<Exclude<DiagramEdgeMarker, "arrow">, string>;

        // Non-interactive overlay: clicks must reach the node components beneath.
        this.setPointerEvents("none");
    }

    /**
     * Resolves a marker kind to its namespaced `url(#…)` reference, or
     * `undefined` when the kind is absent (no marker on that end).
     *
     * @param kind - The requested marker kind, if any.
     * @returns The `url(#id)` reference, or `undefined`.
     */
    private markerUrl(kind: DiagramEdgeMarker | undefined): string | undefined {
        if (!kind) {
            return undefined;
        }

        const id = kind === "arrow" ? this._markerId : this._crowsFootMarkerIds[kind];

        return `url(#${id})`;
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
     * Creates the root `<svg>` with the arrowhead marker plus one `<marker>` per
     * crow's-foot kind in a shared `<defs>`. Every marker and its child shapes
     * are seam-created leaf children tracked for release.
     *
     * @returns The root `<svg>` handle.
     */
    protected createRootElement(): Handle {
        const svg  = DOM.sink.createElementNS(SVG_NS, "svg");
        const defs = DOM.sink.createElementNS(SVG_NS, "defs");

        this.createArrowMarker(defs);

        for (const kind of CROWS_FOOT_MARKERS) {
            this.createCrowsFootMarker(defs, kind);
        }

        DOM.sink.appendChild(svg, defs);
        this.trackHandle(defs);

        return svg;
    }

    /**
     * Defines the existing default arrowhead `<marker>` into `defs`. Unchanged
     * from before crow's-foot markers existed — `orient="auto"` since it is
     * only ever used at `marker-end`.
     *
     * @param defs - The `<defs>` element to append into.
     */
    private createArrowMarker(defs: Handle): void {
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

        this.trackHandle(marker);
        this.trackHandle(arrow);
    }

    /**
     * Defines one crow's-foot `<marker>` into `defs` from its
     * {@link MARKER_GEOMETRY} entry. `orient="auto-start-reverse"` lets the same
     * definition serve both `marker-start` (auto-flipped) and `marker-end`
     * (unreversed).
     *
     * @param defs - The `<defs>` element to append into.
     * @param kind - Which crow's-foot marker to define.
     */
    private createCrowsFootMarker(defs: Handle, kind: Exclude<DiagramEdgeMarker, "arrow">): void {
        const geometry = MARKER_GEOMETRY[kind];
        const marker   = DOM.sink.createElementNS(SVG_NS, "marker");

        DOM.sink.apply(marker, { setAttr: {
            id:           this._crowsFootMarkerIds[kind],
            markerWidth:  String(geometry.width),
            markerHeight: String(geometry.height),
            refX:         String(geometry.refX),
            refY:         String(geometry.refY),
            orient:       "auto-start-reverse",
            markerUnits:  "userSpaceOnUse",
        } });

        DOM.sink.appendChild(defs, marker);
        this.trackHandle(marker);

        for (const part of geometry.parts) {
            const shape = DOM.sink.createElementNS(SVG_NS, part.tag);

            DOM.sink.apply(shape, { setAttr: {
                ...part.attrs,
                fill:   "none",
                stroke: EDGE_STROKE,
            } });

            DOM.sink.appendChild(marker, shape);
            this.trackHandle(shape);
        }
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

            const path  = DOM.sink.createElementNS(SVG_NS, "path");
            const style = edge.style;

            // No style: today's back-compat behaviour — a plain arrow at the end,
            // no start marker. With a style, each end draws only the marker (if
            // any) the style names; an edge can carry cardinality with no
            // marker-end at all.
            const markerEnd   = style ? this.markerUrl(style.endMarker) : this.markerUrl("arrow");
            const markerStart = style ? this.markerUrl(style.startMarker) : undefined;

            const attrs: Record<string, string> = {
                d,
                fill:           "none",
                stroke:         style?.stroke ?? EDGE_STROKE,
                "stroke-width": EDGE_STROKE_WIDTH,
            };

            if (markerEnd) {
                attrs["marker-end"] = markerEnd;
            }

            if (markerStart) {
                attrs["marker-start"] = markerStart;
            }

            if (style?.dashed) {
                attrs["stroke-dasharray"] = DASH_ARRAY;
            }

            DOM.sink.apply(path, { setAttr: attrs });

            DOM.sink.appendChild(svg, path);
            this.trackHandle(path);
            this._pathHandles.push(path);

            if (style?.label) {
                this.drawLabel(svg, edge, style.label);
            }
        }
    }

    /**
     * Draws one edge's optional mid-route label as a `<text>` element.
     *
     * @param svg - The root `<svg>` handle to append into.
     * @param edge - The edge route the label belongs to (for its anchor point).
     * @param label - The label text.
     */
    private drawLabel(svg: Handle, edge: DiagramEdgeRoute, label: string): void {
        const point = labelPoint(edge.sections);
        const text  = DOM.sink.createElementNS(SVG_NS, "text");

        DOM.sink.apply(text, {
            setAttr: {
                x:                String(point.x),
                y:                String(point.y),
                fill:             EDGE_STROKE,
                // Background-coloured halo painted first, so the edge line under the
                // glyphs is masked and the label reads clearly (not crossed out).
                stroke:           LABEL_HALO,
                "stroke-width":   LABEL_HALO_WIDTH,
                "stroke-linejoin": "round",
                "paint-order":    "stroke",
                "font-size":      LABEL_FONT_SIZE,
                "text-anchor":    "middle",
                "dominant-baseline": "central",
            },
            text: label,
        });

        DOM.sink.appendChild(svg, text);
        this.trackHandle(text);
        this._pathHandles.push(text);
    }
}

const DiagramEdgeLayerCallable = callable(DiagramEdgeLayer);
type DiagramEdgeLayerCallable = DiagramEdgeLayer;
export {
    DiagramEdgeLayer         as _DiagramEdgeLayer,
    DiagramEdgeLayerCallable as DiagramEdgeLayer,
};
