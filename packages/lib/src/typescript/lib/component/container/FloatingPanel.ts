// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Panel, PanelOptions } from "~/core/Panel.js";
import { AnchorConstraints } from "~/layout/AnchorConstraints.js";
import { Insets } from "~/primitive/Insets.js";
import { callable } from "~/core/Callable.js";

/** Which corner of the host's inner box a {@link FloatingPanel} pins itself to. */
export type FloatingPanelCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * Construction-time options for {@link FloatingPanel}.
 *
 * @category Containers
 */
export interface FloatingPanelOptions extends PanelOptions {
    /** Which corner of the host's inner box to pin to. Default `"top-right"`. */
    corner?: FloatingPanelCorner;

    /** Pixel distance from the two corner edges. Default `12`. */
    margin?: number;
}

/** Corner a `FloatingPanel` pins to when the caller doesn't specify one. */
const DEFAULT_CORNER: FloatingPanelCorner = "top-right";

/**
 * Default pixel margin between a `FloatingPanel` and the two edges of its
 * pinned corner — mirrors `DiagramView`'s own `CONTROLS_MARGIN`, the
 * hand-rolled precedent this class formalizes.
 */
const DEFAULT_MARGIN = 12;

const _defaultFloatingPanelOptions: Partial<FloatingPanelOptions> = {
    insets: new Insets(0, 0, 0, 0),
    corner: DEFAULT_CORNER,
    margin: DEFAULT_MARGIN,
};

/**
 * A `Panel` that pins itself to one corner of its host's inner box, via an
 * owned {@link AnchorConstraints} instance.
 *
 * Exposed through {@link FloatingPanel.getAnchorConstraints}, this formalizes
 * the corner-pinning technique `DiagramView` used by hand for its zoom/fit/
 * reset control cluster: a consumer whose own layout manager is `Anchor`
 * adds a `FloatingPanel` the same way — `host.addComponent(panel,
 * panel.getAnchorConstraints())`.
 *
 * `FloatingPanel` does not install `Anchor` on its host and does not touch
 * the host's other children. It carries no default background, border, or
 * shadow, and defaults to zero insets, so wrapping an existing bare cluster
 * in one changes nothing visible until a consumer styles it.
 *
 * @category Containers
 */
class FloatingPanel<TOptions extends FloatingPanelOptions = FloatingPanelOptions> extends Panel<TOptions> {

    private readonly _anchorConstraints: AnchorConstraints = new AnchorConstraints();

    constructor(options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(options, { ..._defaultFloatingPanelOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>);

        this.applyCornerAndMargin();
    }

    /**
     * Dispatches `corner` / `margin`; every other option is inherited from `Panel`.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This panel, for method chaining.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        if (options.corner !== undefined) {
            this._options.corner = options.corner;
        }

        if (options.margin !== undefined) {
            this._options.margin = options.margin;
        }

        return this;
    }

    /**
     * Which corner this panel currently pins to.
     *
     * @returns The cached corner, or the class default when never set.
     */
    getCorner(): FloatingPanelCorner {
        return this._options.corner ?? this._defaultOptions.corner ?? DEFAULT_CORNER;
    }

    /**
     * Re-pins this panel to a different corner of its host's inner box.
     * Idempotent: a repeat call with the unchanged corner writes nothing.
     *
     * @param value - The corner to pin to.
     *
     * @returns This panel, for method chaining.
     */
    setCorner(value: FloatingPanelCorner): this {
        if (this.getCorner() === value) {
            return this;
        }

        this._options.corner = value;
        this.applyCornerAndMargin();
        this.getParentComponent()?.scheduleLayout();

        return this;
    }

    /**
     * The pixel margin between this panel and the two edges of its pinned corner.
     *
     * @returns The cached margin, or the class default when never set.
     */
    getMargin(): number {
        return this._options.margin ?? this._defaultOptions.margin ?? DEFAULT_MARGIN;
    }

    /**
     * Changes the pixel margin between this panel and the two edges of its
     * pinned corner. Idempotent: a repeat call with the unchanged margin
     * writes nothing.
     *
     * @param value - The new margin, in pixels.
     *
     * @returns This panel, for method chaining.
     */
    setMargin(value: number): this {
        if (this.getMargin() === value) {
            return this;
        }

        this._options.margin = value;
        this.applyCornerAndMargin();
        this.getParentComponent()?.scheduleLayout();

        return this;
    }

    /**
     * The `AnchorConstraints` instance this panel owns and keeps in sync with
     * {@link getCorner} / {@link getMargin}. Pass it as the second argument to
     * the host's `addComponent` call: `host.addComponent(panel,
     * panel.getAnchorConstraints())`.
     *
     * @returns This panel's owned constraints instance.
     */
    getAnchorConstraints(): AnchorConstraints {
        return this._anchorConstraints;
    }

    /**
     * Resolves the current corner/margin into the two edge offsets `Anchor`
     * reads, clearing the other two edges so a corner change doesn't leave a
     * stale offset behind on the constraints instance this panel owns for its
     * whole lifetime.
     */
    private applyCornerAndMargin(): void {
        const corner = this.getCorner();
        const margin = this.getMargin();

        this._anchorConstraints.top    = undefined;
        this._anchorConstraints.bottom = undefined;
        this._anchorConstraints.left   = undefined;
        this._anchorConstraints.right  = undefined;

        if (corner === "top-left" || corner === "top-right") {
            this._anchorConstraints.top = margin;
        } else {
            this._anchorConstraints.bottom = margin;
        }

        if (corner === "top-left" || corner === "bottom-left") {
            this._anchorConstraints.left = margin;
        } else {
            this._anchorConstraints.right = margin;
        }
    }
}

const FloatingPanelCallable = callable(FloatingPanel);
type FloatingPanelCallable = FloatingPanel;
export {
    FloatingPanel         as _FloatingPanel,
    FloatingPanelCallable as FloatingPanel,
};
