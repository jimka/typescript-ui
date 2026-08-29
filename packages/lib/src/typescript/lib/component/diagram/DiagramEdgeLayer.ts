// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// One `<svg>` Component drawing the diagram's edges as `<path>` elements with a
// shared arrowhead `<marker>`. Follows the Glyph SVG-through-the-seam pattern:
// the root `<svg>` and every leaf child are created via `DOM.sink.createElementNS`
// and tracked with `trackHandle`, never raw DOM. The layer's root stays
// non-interactive (`pointer-events: none`) so node clicks fall through to the
// node components; each drawn edge additionally gets an invisible wide hit
// path that opts itself back into pointer events, so hovering/pressing an edge
// is possible without making the layer as a whole interactive.

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { ElkEdgeSection, ElkPoint } from "~/component/diagram/ElkLayoutEngine.js";
import type { DiagramEdgeMarker, DiagramEdgeStyle } from "~/component/diagram/DiagramModel.js";
import { computeResidentIds } from "~/component/diagram/DiagramResidency.js";
import type { DiagramRect } from "~/component/diagram/DiagramResidency.js";
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
 * Stroke width (px, unscaled graph units) of an edge's invisible hit path —
 * ±6px either side of the 1.5px visible hairline. A hairline is far too thin
 * to aim at, and this is deliberately wider than ELK's default 10px
 * `elk.spacing.edgeEdge`, so a bundle of parallel routes reports as a bundle
 * rather than forcing the user to land on exactly one of them.
 */
const EDGE_HIT_WIDTH = 12;

/** Half the hit width: the distance from a route within which it answers `edgesNear`. */
const EDGE_HIT_TOLERANCE = EDGE_HIT_WIDTH / 2;

/**
 * Opacity of the group holding every edge outside a non-empty emphasis set. A
 * 1.5px hairline has almost no area, so it still reads as a full line at
 * ChartLegend's `HIDDEN_OPACITY` (`0.4`), a strength tuned for a filled legend
 * swatch — dimmed enough there is not dimmed enough for a stroke. `0.15` over
 * the default light canvas resolves to a pale, still-traceable grey while
 * leaving the emphasised edges clearly what the eye lands on.
 *
 * Carried by the dimmed *group* rather than each dimmed edge, because routes
 * overlap by design: fan-in and fan-out bundles share a junction stub, so two
 * or more dimmed paths coincide there. Per-element alpha composites at each
 * overlap — two paths at `0.15` resolve to `0.28`, three to `0.39` — so a
 * bundle read as emphasised precisely where it was densest. Group opacity
 * composites the group's whole rendering once, so an overlap looks the same as
 * a single line.
 */
const DIMMED_EDGE_OPACITY = "0.15";

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
 * How far, in unscaled graph units, the longest end marker reaches back along
 * an edge from the point it attaches to. Every marker anchors its vertex at
 * `x = width` (via `refX`) and opens toward `x = 0`, so a marker's `width` *is*
 * its reach, and this is the widest of them all.
 *
 * Exported because a consumer that rewrites edge routes needs it: anything
 * placed on the route within this distance of an endpoint lands underneath the
 * marker glyph rather than beside it. SQLAdmin's junction stubs use it as the
 * floor for how far from a node a bundle may branch.
 *
 * @category Components
 */
export const EDGE_MARKER_EXTENT: number =
    Math.max(ARROW_SIZE, ...Object.values(MARKER_GEOMETRY).map(geometry => geometry.width));

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
 * The point used to place an edge's optional label: the halfway point *along the
 * routed polyline* (start → bend points → end), measured by arc length. This
 * stays visually centred on the edge even when it bends — a bend point can sit
 * far off centre and drag the label toward one endpoint.
 *
 * @param sections - The edge's routed sections.
 * @returns The label anchor point.
 */
function labelPoint(sections: ElkEdgeSection[]): ElkPoint {
    const section = sections[0];

    if (!section) {
        return { x: 0, y: 0 };
    }

    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

    return midpointAlong(points);
}

/**
 * The point half the total length along a polyline, interpolated within the
 * segment that straddles the midpoint.
 *
 * @param points - The polyline vertices, in order (length >= 1).
 * @returns The arc-length midpoint.
 */
function midpointAlong(points: ElkPoint[]): ElkPoint {
    const segmentLength = (a: ElkPoint, b: ElkPoint): number => Math.hypot(b.x - a.x, b.y - a.y);

    let total = 0;

    for (let i = 1; i < points.length; i++) {
        total += segmentLength(points[i - 1], points[i]);
    }

    let remaining = total / 2;

    for (let i = 1; i < points.length; i++) {
        const length = segmentLength(points[i - 1], points[i]);

        if (length >= remaining) {
            const t = length === 0 ? 0 : remaining / length;

            return {
                x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
                y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
            };
        }

        remaining -= length;
    }

    return points[points.length - 1];
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
 * The shortest distance from point `(px, py)` to the line segment `(ax, ay)`–
 * `(bx, by)`, via the standard clamped projection onto the segment.
 *
 * @param px - Point x.
 * @param py - Point y.
 * @param ax - Segment start x.
 * @param ay - Segment start y.
 * @param bx - Segment end x.
 * @param by - Segment end y.
 * @returns The shortest distance from the point to the segment.
 */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return Math.hypot(px - ax, py - ay);
    }

    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));

    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The shortest distance from point `(x, y)` to a routed edge's polyline —
 * the minimum over every segment of every section, walking the same
 * start/bend/end points {@link labelPoint} does.
 *
 * @param sections - The edge's routed sections.
 * @param x - Point x in unscaled graph coordinates.
 * @param y - Point y in unscaled graph coordinates.
 * @returns The shortest distance to the route, or `Infinity` when it has no drawable segments.
 */
function distanceToRoute(sections: ElkEdgeSection[], x: number, y: number): number {
    let min = Infinity;

    for (const section of sections) {
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

        for (let i = 1; i < points.length; i++) {
            min = Math.min(min, distanceToSegment(x, y, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y));
        }
    }

    return min;
}

/**
 * How far outside its own polyline an edge paints, in unscaled graph units.
 * Three things reach past the bare line — the end markers, the 12px-wide
 * invisible hit stroke, and the label's halo — and the widest end marker's
 * own reach covers all three, so a route's box is grown by this much on
 * every side before it is tested against the residency rect. Without it an
 * edge whose route stops just outside the rect could still have a marker or
 * label glyph reaching into it.
 */
const EDGE_BOUNDS_PADDING = EDGE_MARKER_EXTENT;

/**
 * The box an edge's drawing occupies, padded for markers, hit stroke, and
 * label: the smallest rectangle containing every point on the routed
 * polyline — start point, bend points, end point of every section, walking
 * the same points {@link distanceToRoute} does — grown by
 * {@link EDGE_BOUNDS_PADDING} on each of the four sides.
 *
 * @param sections - The edge's routed sections.
 * @returns The edge's box, or `null` when the route has no points.
 *
 * @internal
 */
export function routeBounds(sections: ElkEdgeSection[]): DiagramRect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const section of sections) {
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

        for (const point of points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    }

    if (minX === Infinity) {
        return null;
    }

    return {
        x:      minX - EDGE_BOUNDS_PADDING,
        y:      minY - EDGE_BOUNDS_PADDING,
        width:  maxX - minX + 2 * EDGE_BOUNDS_PADDING,
        height: maxY - minY + 2 * EDGE_BOUNDS_PADDING,
    };
}

/** The elements drawn for one edge, so it can be hit-tested and released. */
interface DrawnEdge {
    id:    string;
    route: DiagramEdgeRoute;
    /** The visible stroked path. */
    path:  Handle;
    /** The invisible wide path that takes pointer events. */
    hit:   Handle;
    /** The mid-route label, when the edge carries one. */
    label: Handle | null;
    /** The group the three elements above were appended into, so they can be removed from it. */
    group: Handle;
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

    /** Everything currently drawn, released and rebuilt by `rebuildPaths`. */
    private _drawn: DrawnEdge[] = [];

    /**
     * Box per edge id, rebuilt by `setEdges` from each route. An edge whose
     * route has no points has no entry, which `computeResidentIds` treats as
     * always admitted — and `drawEdge` skips it anyway for having no path data.
     */
    private _edgeRects: Map<string, DiagramRect> = new Map();

    /**
     * The rectangle an edge's box must reach to be drawn, in unscaled graph
     * coordinates, or `null` when nothing has told this layer where the
     * viewport is — in which case every edge is drawn.
     */
    private _residency: DiagramRect | null = null;

    /** The admitted edge ids, or `null` when `_residency` is `null` (every edge is admitted). */
    private _residentIds: Set<string> | null = null;

    /**
     * The currently emphasised edge ids. Runtime interaction state (not a
     * `ComponentOptions` field — see ARCHITECTURE.md's rule that transient,
     * framework-managed state stays off the options bag). Cleared by `setEdges`.
     */
    private _edgeEmphasis: Set<string> = new Set();

    /**
     * The `<g>` holding every edge outside a non-empty emphasis set, carrying
     * {@link DIMMED_EDGE_OPACITY}. Painted before `_normalLayer`, so an
     * emphasised edge always draws over a dimmed one it crosses. Created by
     * `createRootElement`, so it exists before any draw.
     */
    private _dimLayer!: Handle;

    /** The `<g>` holding every edge drawn at full strength. Painted over `_dimLayer`. */
    private _normalLayer!: Handle;

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

        // Every Component stamps ComponentDefaults' "default" cursor into its
        // own rule; left at that, a hit path inheriting from this `<svg>`
        // would resolve to an arrow regardless of what it declares itself.
        // Inheriting through to the view root's live grab/grabbing write is
        // what lets an edge press pan the canvas honestly.
        this.setCursor("inherit");

        // A marker or halo'd label reaching past the graph bounds must not
        // clip at the layer edge.
        this.setOverflow("visible");
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
     * Replaces the drawn edges and rebuilds the path children. Clears any
     * active edge emphasis first, so the freshly-drawn set always starts
     * undimmed — a re-layout that swaps in a new graph is not the graph the
     * emphasis was computed against.
     *
     * Routes routinely arrive before this layer has an element: a diagram built
     * inside a dock tab runs its whole ELK layout while the tab is still
     * detached (the app awaits
     * [`DiagramView.whenLaidOut`](/api/component/diagram/classes/DiagramView)
     * before mounting, so the layout *always* lands first), and `rebuildPaths`
     * cannot draw without one. `render` only performs the first draw when it is
     * what creates the element, which is not the case here — so without the
     * deferral below the sole draw for those routes is silently lost and the
     * diagram shows nodes with no edges until some later `setEdges` happens to
     * find an element. {@link Component.onFirstLayout} exists for exactly this
     * "content built before the host attaches it" case.
     *
     * Also rebuilds the per-edge box cache from the new routes and re-derives
     * which edges the standing residency rect admits, so a graph swap culls
     * correctly against whichever rectangle `DiagramView` last pushed.
     *
     * @param edges - The routed edges to draw.
     *
     * @returns This layer, for method chaining.
     */
    setEdges(edges: DiagramEdgeRoute[]): this {
        this._edges = edges;
        this._edgeEmphasis = new Set();

        this._edgeRects = new Map();

        for (const edge of edges) {
            const bounds = routeBounds(edge.sections);

            if (bounds) {
                this._edgeRects.set(edge.id, bounds);
            }
        }

        this.recomputeResidentEdges();

        if (this.getElement()) {
            this.rebuildPaths();
        } else {
            this.onFirstLayout(() => this.rebuildPaths());
        }

        return this;
    }

    /**
     * Sets the emphasised edge ids. While the set is non-empty every edge NOT
     * in it is drawn at a reduced opacity; the emphasised edges keep their
     * normal weight. `null` or an empty array clears the emphasis. Ids naming
     * no drawn edge are kept but have no effect.
     *
     * @param ids - The edge ids to emphasise, or null to clear.
     *
     * @returns This layer, for method chaining.
     */
    setEdgeEmphasis(ids: readonly string[] | null): this {
        this._edgeEmphasis = new Set(ids ?? []);

        // A full redraw rather than a restyle in place: which of the two groups
        // an edge belongs to is decided at draw time, and redrawing is what
        // moves it. Cheap enough to do on a click — a redraw of a 1000-edge
        // graph's paths measures around 20ms, against the seconds ELK itself
        // takes — and it reuses the release/rebuild path already covered by
        // tests instead of relying on appendChild's move semantics through the
        // DOM seam.
        this.rebuildPaths();

        return this;
    }

    /**
     * The currently emphasised edge ids.
     *
     * @returns A copy of the emphasised id array; empty when nothing is emphasised.
     */
    getEdgeEmphasis(): string[] {
        return [...this._edgeEmphasis];
    }

    /**
     * Resolves a raw DOM event target to the edge whose invisible hit path it
     * is. Answers only for the edges this layer is currently drawing, which
     * on a large graph is those near the visible area.
     *
     * @param target - The raw DOM event target.
     * @returns The edge id, or null when the target is not an edge hit path.
     */
    edgeIdAt(target: EventTarget | null): string | null {
        if (target === null) {
            return null;
        }

        const handle = DOM.source.intern(target);

        return this._drawn.find(d => d.hit === handle)?.id ?? null;
    }

    /**
     * Every drawn edge whose route passes within the hit tolerance of a point,
     * in draw order. Several edges answer here wherever their routes overlap —
     * which is what makes a merged trunk answerable. Answers only for the
     * edges this layer is currently drawing, which on a large graph is those
     * near the visible area.
     *
     * @param x - Point x in unscaled graph coordinates.
     * @param y - Point y in unscaled graph coordinates.
     * @returns The routes within tolerance; empty when none is.
     */
    edgesNear(x: number, y: number): DiagramEdgeRoute[] {
        return this._drawn
            .filter(drawn => distanceToRoute(drawn.route.sections, x, y) <= EDGE_HIT_TOLERANCE)
            .map(drawn => drawn.route);
    }

    /**
     * Which group one edge draws into: the dimmed group when an emphasis set is
     * active and this edge is not in it, the full-strength group otherwise.
     *
     * @param id - The edge id.
     * @returns The group handle to append the edge's elements into.
     */
    private groupFor(id: string): Handle {
        if (this._edgeEmphasis.size === 0 || this._edgeEmphasis.has(id)) {
            return this._normalLayer;
        }

        return this._dimLayer;
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

        this._dimLayer    = this.createEdgeGroup(svg, DIMMED_EDGE_OPACITY);
        this._normalLayer = this.createEdgeGroup(svg, null);

        return svg;
    }

    /**
     * Creates one of the two persistent edge groups as a child of the root
     * `<svg>`. Append order is paint order, so the caller creates the dimmed
     * group first.
     *
     * @param svg - The root `<svg>` handle to append the group into.
     * @param opacity - The group's opacity, or null to leave it at full strength.
     *
     * @returns The `<g>` handle.
     */
    private createEdgeGroup(svg: Handle, opacity: string | null): Handle {
        const group = DOM.sink.createElementNS(SVG_NS, "g");

        if (opacity !== null) {
            DOM.sink.apply(group, { setAttr: { opacity } });
        }

        DOM.sink.appendChild(svg, group);
        this.trackHandle(group);

        return group;
    }

    /**
     * Defines the default arrowhead `<marker>` into `defs`. `orient="auto-start-
     * reverse"` so the one definition serves both `marker-end` (unreversed, the
     * common case) and `marker-start` (auto-flipped to point back out of the
     * source node) — e.g. a data-flow edge that draws its arrow at the source end.
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
            orient:       "auto-start-reverse",
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
     * Clears the previously-drawn paths and rebuilds the admitted subset from
     * the cached edge routes. No-op before the element exists — `render`
     * performs the first draw.
     */
    private rebuildPaths(): void {
        const svg = this.getElement();

        if (!svg) {
            return;
        }

        for (const drawn of this._drawn) {
            this.releaseDrawnEdge(drawn);
        }

        this._drawn = [];

        this.updateDrawnEdges();
    }

    /**
     * Draws one edge's path data, hit path, visible path, and optional label
     * into its emphasis group.
     *
     * @param edge - The routed edge to draw.
     * @returns The drawn edge record, or `null` when the route has no path data.
     */
    private drawEdge(edge: DiagramEdgeRoute): DrawnEdge | null {
        const d = buildPathData(edge.sections);

        if (!d) {
            return null;
        }

        const group = this.groupFor(edge.id);
        const hit   = this.drawHitPath(group, d);
        const path  = this.drawVisiblePath(group, edge, d);
        const style = edge.style;
        let label: Handle | null = null;

        if (style?.label) {
            label = this.drawLabel(group, edge, style.label);
        }

        return { id: edge.id, route: edge, path, hit, label, group };
    }

    /** Recomputes the admitted-id set from the standing residency rect and the current routes. */
    private recomputeResidentEdges(): void {
        this._residentIds = this._residency === null
            ? null
            : computeResidentIds(this._edges.map(edge => edge.id), this._edgeRects, this._residency);
    }

    /**
     * Whether `id` is admitted by the standing residency rect.
     *
     * @param id - The edge id to test.
     * @returns Whether the edge should be drawn.
     */
    private isResident(id: string): boolean {
        return this._residentIds === null || this._residentIds.has(id);
    }

    /**
     * Reconciles `_drawn` against `_edges` and the standing residency rect by
     * difference: an already-drawn edge that stays admitted is left alone, a
     * newly-admitted edge is drawn, and anything drawn that is no longer
     * admitted is released. No-op before the element exists.
     */
    private updateDrawnEdges(): void {
        if (!this.getElement()) {
            return;
        }

        const previous = new Map(this._drawn.map(drawn => [drawn.id, drawn]));
        const next: DrawnEdge[] = [];

        for (const edge of this._edges) {
            if (!this.isResident(edge.id)) {
                continue;
            }

            const already = previous.get(edge.id);

            if (already) {
                previous.delete(edge.id);
                next.push(already);

                continue;
            }

            const drawn = this.drawEdge(edge);

            if (drawn) {
                next.push(drawn);
            }
        }

        for (const drawn of previous.values()) {
            this.releaseDrawnEdge(drawn);
        }

        this._drawn = next;
    }

    /**
     * Sets the rectangle, in unscaled graph coordinates, an edge's box must
     * reach to be drawn, and reconciles the drawn set against it. `null`
     * draws every edge — the state a layer starts in and stays in when never
     * told where the viewport is.
     *
     * @param rect - The residency rectangle, or `null` to draw every edge.
     *
     * @returns This layer, for method chaining.
     *
     * @internal Framework wiring between `DiagramView` and its edge layer; application code does not call this.
     */
    setResidency(rect: DiagramRect | null): this {
        this._residency = rect;
        this.recomputeResidentEdges();
        this.updateDrawnEdges();

        return this;
    }

    /**
     * Draws one edge's invisible wide hit path: same `d` as the visible path,
     * transparent stroke, and the only element in the layer that opts back
     * into pointer events (`pointer-events: stroke`) — the root `<svg>` stays
     * inert. Appended before the visible path.
     *
     * @param group - The edge group handle to append into.
     * @param d - The edge's path data (shared with the visible path).
     * @returns The hit path's handle.
     */
    private drawHitPath(group: Handle, d: string): Handle {
        const hit = DOM.sink.createElementNS(SVG_NS, "path");

        DOM.sink.apply(hit, { setAttr: {
            d,
            fill:             "none",
            stroke:           "transparent",
            "stroke-width":   String(EDGE_HIT_WIDTH),
            "pointer-events": "stroke",
            // Dragging an edge pans the canvas like empty canvas does, so the
            // hit path takes the viewport's own live grab/grabbing cursor by
            // inheriting rather than promising a cursor of its own.
            cursor: "inherit",
        } });

        DOM.sink.appendChild(group, hit);
        this.trackHandle(hit);

        return hit;
    }

    /**
     * Draws one edge's visible stroked path, carrying its markers and dash. The
     * edge's emphasis state is not written here — it is the group the path is
     * appended into (see {@link DIMMED_EDGE_OPACITY}).
     *
     * @param group - The edge group handle to append into.
     * @param edge - The routed edge to draw.
     * @param d - The edge's path data.
     * @returns The visible path's handle.
     */
    private drawVisiblePath(group: Handle, edge: DiagramEdgeRoute, d: string): Handle {
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

        DOM.sink.appendChild(group, path);
        this.trackHandle(path);

        return path;
    }

    /**
     * Releases one previously-drawn edge's elements (hit path, visible path,
     * and optional label) from the group they were appended into and from the
     * tracked-handle set.
     *
     * @param drawn - The drawn edge record to release.
     */
    private releaseDrawnEdge(drawn: DrawnEdge): void {
        const handles = [drawn.hit, drawn.path, ...(drawn.label ? [drawn.label] : [])];

        for (const handle of handles) {
            DOM.sink.removeChild(drawn.group, handle);
            this.untrackHandle(handle);
            DOM.sink.release(handle);
        }
    }

    /**
     * Draws one edge's optional mid-route label as a `<text>` element.
     *
     * @param group - The edge group handle to append into, which also carries
     *   the label's emphasis state (see {@link DIMMED_EDGE_OPACITY}).
     * @param edge - The edge route the label belongs to (for its anchor point).
     * @param label - The label text.
     * @returns The label's handle.
     */
    private drawLabel(group: Handle, edge: DiagramEdgeRoute, label: string): Handle {
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

        DOM.sink.appendChild(group, text);
        this.trackHandle(text);

        return text;
    }
}

const DiagramEdgeLayerCallable = callable(DiagramEdgeLayer);
type DiagramEdgeLayerCallable = DiagramEdgeLayer;
export {
    DiagramEdgeLayer         as _DiagramEdgeLayer,
    DiagramEdgeLayerCallable as DiagramEdgeLayer,
};
