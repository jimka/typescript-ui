// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// One `<svg>` Component drawing a diagram's low-zoom simplified nodes as
// plain `<rect>` boxes — one per node, standing in for the node component
// `DiagramView` stops mounting once level-of-detail simplification engages.
// Follows the same SVG-through-the-seam pattern as `DiagramEdgeLayer`: the
// root `<svg>` and every leaf `<rect>` are created via
// `DOM.sink.createElementNS` and tracked with `trackHandle`, never raw DOM.
// The layer's root stays non-interactive (`pointer-events: none`) —
// `DiagramView.nodeIdAtGraphPoint` resolves a click geometrically against the
// laid-out boxes instead of hit-testing an element.

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { DiagramRect } from "~/component/diagram/DiagramResidency.js";
import {
    DIAGRAM_NODE_BACKGROUND_COLOR,
    DIAGRAM_NODE_BORDER_COLOR,
    DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR,
    DIAGRAM_NODE_SELECTED_BORDER_COLOR,
} from "~/component/diagram/DiagramNode.js";
import { DIAGRAM_GROUP_BACKGROUND_COLOR, DIAGRAM_GROUP_BORDER_COLOR } from "~/component/diagram/DiagramGroupNode.js";
import { callable } from "~/core/Callable.js";

/** SVG namespace URI. */
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Corner radius (SVG user units) of a simplified rect — the unitless twin of
 * the 4px `borderRadius` both `DiagramNode` and `DiagramGroupNode` declare,
 * so a simplified node keeps the silhouette of the component it stands in for.
 */
const RECT_RADIUS = "4";

/** Stroke width of a simplified rect, matching the 1px border both renderers declare. */
const RECT_STROKE_WIDTH = "1";

/**
 * Opacity of a node component outside a non-empty node-emphasis set. Higher
 * than `DiagramEdgeLayer`'s `DIMMED_EDGE_OPACITY` (`0.15`) because perceived
 * presence scales with area, not just alpha: a `TableCardNode`-sized box with
 * a border and text rows still reads at `0.15`, whereas a 1.5px hairline
 * needs the lower number to recede. `0.35` keeps a dimmed card's shape and
 * label legible while clearly receding behind the emphasised ones.
 *
 * @internal
 */
export const DIMMED_NODE_OPACITY = 0.35;

/**
 * The SVG low-zoom node layer for a
 * [`DiagramView`](/api/component/diagram/classes/DiagramView). Owns exactly
 * one `<svg>` element and draws one `<rect>` per node id it is given, in
 * place of the node component `DiagramView` stops mounting once
 * level-of-detail simplification engages. Never re-exported from the package
 * entry point — this is framework-internal wiring, not a documented component.
 */
class DiagramNodeLayer extends Component<ComponentOptions> {

    /** The rects to draw, keyed by node id. Compared by identity in `setNodes`. */
    private _rects: Map<string, DiagramRect> = new Map();

    /** Ids of `_rects` that are compound containers rather than leaves. */
    private _containerIds: ReadonlySet<string> = new Set();

    /** The rect drawn per node id, in paint order: containers first, then leaves. */
    private _drawn: Map<string, Handle> = new Map();

    /** The currently selected leaf id, or `null`. A container never paints selected. */
    private _selected: string | null = null;

    /** Ids of the emphasised nodes; every other drawn rect dims. */
    private _emphasis: ReadonlySet<string> = new Set();

    /**
     * @param options - Optional construction-time options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        super(options, subclassDefaults);

        // Non-interactive overlay: nothing hit-tests against a rect —
        // `DiagramView.nodeIdAtGraphPoint` resolves clicks geometrically
        // against the laid-out boxes instead (mirrors `DiagramEdgeLayer`'s
        // own reasoning for its root).
        this.setPointerEvents("none");

        // Inherits the viewport's live grab/grabbing cursor rather than
        // promising one of its own — a press over a simplified node still
        // pans (mirrors `DiagramEdgeLayer`'s own reasoning for its root).
        this.setCursor("inherit");

        // A marker or halo'd label reaching past the graph bounds must not
        // clip at the layer edge.
        this.setOverflow("visible");
    }

    /**
     * Creates the root `<svg>` element.
     *
     * @returns The root `<svg>` handle.
     */
    protected createRootElement(): Handle {
        return DOM.sink.createElementNS(SVG_NS, "svg");
    }

    /**
     * Renders the root element and draws the cached rects.
     *
     * @returns The rendered root element.
     */
    protected render(): Handle {
        const element = super.render();

        this.redraw();

        return element;
    }

    /**
     * Replaces the drawn rects. A no-op when both `rects` and `containerIds`
     * are identical (`===`) to what this layer already holds — exact rather
     * than approximate, because `DiagramView` never mutates either map in
     * place (see the plan's `[^identity]` note): a pan or a zoom that changes
     * neither costs zero DOM writes.
     *
     * @param rects - The boxes to draw, keyed by node id.
     * @param containerIds - Ids of `rects` that are compound containers.
     *
     * @returns This layer, for method chaining.
     *
     * @internal Framework wiring between `DiagramView` and its node layer; application code does not call this.
     */
    setNodes(rects: Map<string, DiagramRect>, containerIds: ReadonlySet<string>): this {
        if (rects === this._rects && containerIds === this._containerIds) {
            return this;
        }

        this._rects = rects;
        this._containerIds = containerIds;

        if (this.getElement()) {
            this.redraw();
        } else {
            this.onFirstLayout(() => this.redraw());
        }

        return this;
    }

    /**
     * Sets the selected leaf id, repainting only the outgoing and incoming
     * rects. A container id is accepted but never paints selected — it has
     * no `setSelected` visual, mirroring `DiagramGroupNode`.
     *
     * @param id - The node id to select, or `null` to clear.
     *
     * @returns This layer, for method chaining.
     *
     * @internal
     */
    setSelected(id: string | null): this {
        const previous = this._selected;

        this._selected = id;

        if (previous !== null) {
            this.repaint(previous);
        }

        if (id !== null) {
            this.repaint(id);
        }

        return this;
    }

    /**
     * Sets the emphasised node ids, repainting every drawn rect's opacity.
     *
     * @param ids - The node ids to emphasise; an empty set clears emphasis.
     *
     * @returns This layer, for method chaining.
     *
     * @internal
     */
    setEmphasis(ids: ReadonlySet<string>): this {
        this._emphasis = ids;

        for (const id of this._drawn.keys()) {
            this.repaint(id);
        }

        return this;
    }

    /**
     * Releases every previously-drawn rect, then draws every id in
     * `_containerIds` first and every other id second, so document order
     * puts container washes behind leaf boxes. No-op before the element
     * exists — `setNodes` defers to the first connected layout, and `render`
     * performs the first draw.
     */
    private redraw(): void {
        const root = this.getElement();

        if (!root) {
            return;
        }

        for (const handle of this._drawn.values()) {
            this.releaseDrawnRect(root, handle);
        }

        this._drawn.clear();

        for (const [id, rect] of this._rects) {
            if (this._containerIds.has(id)) {
                this.drawRect(root, id, rect);
            }
        }

        for (const [id, rect] of this._rects) {
            if (!this._containerIds.has(id)) {
                this.drawRect(root, id, rect);
            }
        }
    }

    /**
     * Creates one `<rect>` through the seam, applies its attributes, appends
     * it to the root, and tracks the handle.
     *
     * @param root - The root `<svg>` handle to append into.
     * @param id - The node id the rect stands in for.
     * @param rect - The node's laid-out box.
     */
    private drawRect(root: Handle, id: string, rect: DiagramRect): void {
        const el = DOM.sink.createElementNS(SVG_NS, "rect");

        DOM.sink.apply(el, { setAttr: this.rectAttrs(id, rect) });
        DOM.sink.appendChild(root, el);
        this.trackHandle(el);

        this._drawn.set(id, el);
    }

    /**
     * Releases one previously-drawn rect from the root and from the
     * tracked-handle set.
     *
     * @param root - The root `<svg>` handle the rect was appended into.
     * @param handle - The rect's handle.
     */
    private releaseDrawnRect(root: Handle, handle: Handle): void {
        DOM.sink.removeChild(root, handle);
        this.untrackHandle(handle);
        DOM.sink.release(handle);
    }

    /**
     * Re-applies `id`'s current attributes to its already-drawn rect. A
     * no-op when `id` has never been drawn — `setSelected`/`setEmphasis` may
     * be called for a graph not yet drawn (state applied before a draw
     * survives it, since `rectAttrs` reads `_selected`/`_emphasis` at draw
     * time too).
     *
     * @param id - The node id to repaint.
     */
    private repaint(id: string): void {
        const handle = this._drawn.get(id);
        const rect = this._rects.get(id);

        if (handle === undefined || rect === undefined) {
            return;
        }

        // Attribute removals apply before sets (see `ElementPatch`'s own
        // ordering doc), so an unconditional `opacity` removal followed by
        // `rectAttrs`' conditional re-set is what lets a rect go from dimmed
        // back to resting — `rectAttrs` simply omits the key when it no
        // longer applies.
        DOM.sink.apply(handle, { removeAttr: ["opacity"], setAttr: this.rectAttrs(id, rect) });
    }

    /**
     * The attribute bag for `id`'s rect: its box, corner radius, stroke
     * width, and the fill/stroke/opacity the paint-order table in the plan's
     * Architecture Decisions describes — a container ignores selection and
     * always carries the group colours; a leaf carries the node colours,
     * swapped to the selected pair when `id` is the selected leaf; either
     * carries `opacity` when a non-empty emphasis set excludes `id`.
     *
     * @param id - The node id.
     * @param rect - The node's laid-out box.
     * @returns The attribute bag to apply to the rect.
     */
    private rectAttrs(id: string, rect: DiagramRect): Record<string, string> {
        const container = this._containerIds.has(id);
        const selected  = !container && this._selected === id;

        const fill = container
            ? DIAGRAM_GROUP_BACKGROUND_COLOR
            : (selected ? DIAGRAM_NODE_SELECTED_BACKGROUND_COLOR : DIAGRAM_NODE_BACKGROUND_COLOR);
        const stroke = container
            ? DIAGRAM_GROUP_BORDER_COLOR
            : (selected ? DIAGRAM_NODE_SELECTED_BORDER_COLOR : DIAGRAM_NODE_BORDER_COLOR);

        const attrs: Record<string, string> = {
            x:      String(rect.x),
            y:      String(rect.y),
            width:  String(rect.width),
            height: String(rect.height),
            rx:     RECT_RADIUS,
            fill,
            stroke,
            "stroke-width": RECT_STROKE_WIDTH,
        };

        if (this._emphasis.size > 0 && !this._emphasis.has(id)) {
            attrs.opacity = String(DIMMED_NODE_OPACITY);
        }

        return attrs;
    }
}

const DiagramNodeLayerCallable = callable(DiagramNodeLayer);
type DiagramNodeLayerCallable = DiagramNodeLayer;
export {
    DiagramNodeLayer         as _DiagramNodeLayer,
    DiagramNodeLayerCallable as DiagramNodeLayer,
};
