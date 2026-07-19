// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import type { Edge } from "~/primitive/Edge.js";
import { Position } from "~/primitive/Position.js";
import { callable } from "~/core/Callable.js";
import { LayerManager } from "~/core/LayerManager.js";
import { DOM } from "~/core/DOM.js";

/**
 * One of the five drop zones a dock gesture resolves the cursor into: the four
 * edge bands plus the central remainder.
 *
 * @category Layouts
 */
export type DropZone = Edge | "center";

/**
 * Fraction of a region's main/cross extent that counts as an edge band — a
 * quarter, the canonical VS Code / GoldenLayout dock affordance ratio. A
 * fractional band (rather than a fixed pixel inset) keeps small regions usable:
 * a thin region would otherwise be all-edge. Exported because two collaborators
 * must agree on it — `DockRegion`'s hit-test (`computeZone`) and this overlay's
 * band geometry must resolve the same rectangle for a given zone, so the
 * highlight covers exactly the region the drop will occupy. It lives here, in
 * the `core` overlay that paints the band, because `DockRegion` is in `layout`
 * and `core` may not import from `layout`.
 */
export const EDGE_BAND_FRACTION = 0.25;

/**
 * The single positioned rectangle a {@link DropZoneOverlay} lights up over the
 * band the cursor resolves to. A nested overlay class (the
 * {@link DropZoneOverlay} analogue of `Tab`'s selection indicator) so its
 * geometry setters — protected on {@link Component} — are driven from within,
 * through {@link placeBand}, rather than reached into from the parent.
 */
class DropZoneHighlight extends Component {

    // Cached validity so the colour swap in {@link setValid} is a no-op on a
    // repeat call with the same state — the band is re-placed every drag frame.
    private _valid: boolean = true;

    /** Builds the highlight rect, hidden until {@link placeBand} positions it. */
    constructor() {
        super();

        this.setPosition(Position.ABSOLUTE);
        this.setPointerEvents("none");
        this.setBackgroundColor("var(--ts-ui-drag-dropzone-active-bg)");
        this.setVisible(false);
    }

    /**
     * Positions the rect over a band and shows it.
     *
     * @param x - Left offset within the overlay, in px.
     * @param y - Top offset within the overlay, in px.
     * @param width - Band width, in px.
     * @param height - Band height, in px.
     */
    placeBand(x: number, y: number, width: number, height: number): void {
        this.setX(x);
        this.setY(y);
        this.setWidth(width);
        this.setHeight(height);
        this.setVisible(true);
    }

    /**
     * Swaps the band colour between the active (valid) and invalid drop tokens —
     * the band itself carries the drop's validity now that the whole-target tint
     * is suppressed for dock regions. Idempotent on repeat calls.
     *
     * @param valid - `true` for the active blue band, `false` for the red one.
     */
    setValid(valid: boolean): void {
        if (this._valid === valid) {
            return;
        }

        this._valid = valid;

        this.setBackgroundColor(valid
            ? "var(--ts-ui-drag-dropzone-active-bg)"
            : "var(--ts-ui-drag-dropzone-invalid-bg)");
    }

    /** Hides the rect (no zone highlighted). */
    hide(): void {
        this.setVisible(false);
    }
}

/**
 * Z-order shared with [`DragFeedback`](/api/overlay/classes/DragFeedback) and
 * [`ReorderIndicator`](/api/overlay/classes/ReorderIndicator): just **below** the
 * lowest {@link LayerManager} band (the {@link Window} band) so this drop-zone
 * affordance — drawn over app content that establishes no isolating stacking
 * context — never paints over a floating window, while still sitting above the
 * target's own content. The drag ghost sits above all three at the root.
 */
const Z_INDEX = LayerManager.Band.Window - 1;

/**
 * Overlay that marks a region as a dock target during an active drag and
 * highlights the band the cursor currently resolves to. The root is a faint
 * full-bleed tint (the "this region accepts a dock" affordance); a single
 * nested rectangle — moved per zone rather than five persistent children —
 * lights up the edge band (or the central remainder) the drop would occupy.
 *
 * Owned by [`DockRegion`](/api/layout/classes/DockRegion) — application code
 * does not instantiate this directly. It composes with the manager's own
 * [`DragFeedback`](/api/overlay/classes/DragFeedback): the tint reports drop
 * *validity*, this overlay reports drop *position*.
 *
 * @category Core
 */
class DropZoneOverlay extends Component {

    // Single positioned rectangle, re-placed per zone (Internal Structure: one
    // nested child, not five persistent band elements). Created as a field so it
    // exists by the time the constructor body configures it.
    private _highlight: DropZoneHighlight = new DropZoneHighlight();

    // Cached current zone and validity so a per-mousemove `setHighlight` with an
    // unchanged zone *and* validity is a no-op — `onDragOver` fires every frame,
    // and re-placing or re-colouring the rect each frame would be needless DOM
    // churn.
    private _zone: DropZone | null = null;
    private _valid: boolean = true;

    /**
     * Constructs a dock-zone overlay. The overlay is not attached until
     * {@link attachTo} is called.
     */
    constructor() {
        super();

        this.setPosition(Position.ABSOLUTE);
        this.setZIndex(Z_INDEX);
        this.setPointerEvents("none");
        this.setBackgroundColor("var(--ts-ui-drag-dropzone-bg)");
        this.setBorder({ border: "1px solid var(--ts-ui-drag-dropzone-border)" });
    }

    /**
     * Sizes this overlay to cover `region` and appends it (and its highlight
     * rect) into the region's element. Idempotent — safe to call on every
     * `onDragOver` while the cursor stays inside the region.
     *
     * @param region - The dock target whose body the overlay should cover.
     */
    attachTo(region: Component): void {
        const myEl = this.getElement(true)!;

        this.setX(0);
        this.setY(0);
        this.setWidth(region.getWidth());
        this.setHeight(region.getHeight());

        const regionEl = region.getElement(true)!;
        if (DOM.source.getParentElement(myEl) !== regionEl) {
            DOM.sink.appendChild(regionEl, myEl);
        }

        const highlightEl = this._highlight.getElement(true)!;
        if (DOM.source.getParentElement(highlightEl) !== myEl) {
            DOM.sink.appendChild(myEl, highlightEl);
        }
    }

    /**
     * Highlights the band corresponding to `zone`, or clears the highlight when
     * `null`. The lit rectangle is the edge band (an `EDGE_BAND_FRACTION`
     * slice against the relevant axis) for an edge zone, or the central
     * remainder for `"center"` — matching the rectangle the drop would occupy.
     * The band is drawn in the active (blue) colour when `valid`, or the invalid
     * (red) colour when not — so an illegal drop is marked on the exact zone it
     * would occupy rather than tinting the whole target. A repeat call with the
     * current zone *and* validity is a no-op.
     *
     * @param zone - The zone to highlight, or `null` to hide the highlight.
     * @param valid - Whether the drop on this zone is legal (defaults to `true`).
     */
    setHighlight(zone: DropZone | null, valid: boolean = true): void {
        if (zone === this._zone && valid === this._valid) {
            return;
        }

        this._zone  = zone;
        this._valid = valid;

        if (zone === null) {
            this._highlight.hide();

            return;
        }

        this._highlight.setValid(valid);

        const w = this.getWidth();
        const h = this.getHeight();
        const f = EDGE_BAND_FRACTION;

        let x = 0, y = 0, bw = w, bh = h;

        switch (zone) {
            case "top":    x = 0;           y = 0;           bw = w;               bh = h * f;           break;
            case "bottom": x = 0;           y = h * (1 - f); bw = w;               bh = h * f;           break;
            case "left":   x = 0;           y = 0;           bw = w * f;           bh = h;               break;
            case "right":  x = w * (1 - f); y = 0;           bw = w * f;           bh = h;               break;
            case "center": x = w * f;       y = h * f;       bw = w * (1 - 2 * f); bh = h * (1 - 2 * f); break;
        }

        this._highlight.placeBand(x, y, bw, bh);
    }

    /**
     * Lights up the **entire** region as a single drop zone, leaving no edge
     * bands. For a target with only one possible outcome — an empty dock, where
     * any drop simply becomes the sole region — so the feedback reads as one
     * solid blue area rather than {@link setHighlight}`("center")`'s inset square
     * that implies splittable edges. Cheap to call per `onDragOver`: the underlying
     * geometry setters short-circuit once placed.
     */
    highlightFull(): void {
        this._zone  = null;
        this._valid = true;

        this._highlight.setValid(true);
        this._highlight.placeBand(0, 0, this.getWidth(), this.getHeight());
    }

    /**
     * Removes the overlay element from the DOM and resets the cached zone so a
     * later re-attach starts with no highlight.
     */
    detach(): void {
        this._zone  = null;
        this._valid = true;
        this.removeElement();
    }
}

const DropZoneOverlayCallable = callable(DropZoneOverlay);
type DropZoneOverlayCallable = DropZoneOverlay;
export {
    DropZoneOverlay         as _DropZoneOverlay,
    DropZoneOverlayCallable as DropZoneOverlay,
};
