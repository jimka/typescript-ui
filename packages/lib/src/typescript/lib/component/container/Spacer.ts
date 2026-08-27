// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { Handle } from "~/core/DOM.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Spacer}.
 *
 * @category Components
 */
export interface SpacerOptions extends ComponentOptions {
    /** Fixed preferred width in pixels. Defaults to `0`. */
    width?: number;

    /** Fixed preferred height in pixels. Defaults to `width` (or `0`). */
    height?: number;

    /**
     * When `true`, the spacer absorbs remaining row/column space inside an
     * [`HBox`](/api/layout/classes/HBox) or [`VBox`](/api/layout/classes/VBox)
     * parent via the `weight` layout constraint. Defaults to `false`.
     */
    flex?: boolean;

    /**
     * Flex weight, used when `flex` is `true`. Defaults to `1`. Multiple flex
     * spacers in the same row/column share the leftover space proportionally
     * to their weights.
     */
    flexWeight?: number;
}

/**
 * A deliberately invisible leaf {@link Component} whose only job is to take up
 * space inside a layout. Two modes:
 *
 * - **Fixed** — advertises a hard `(width, height)` preferred size via the
 *   inherited `setPreferredSize`. Use `new Spacer(16)` for a 16-pixel square
 *   gap, or `new Spacer(16, 0)` for a 16-pixel horizontal gap.
 * - **Flex** — absorbs the row/column's leftover space by writing a `weight`
 *   entry into the parent's [`LayoutConstraints`](/api/layout/classes/LayoutConstraints).
 *   Meaningful only inside an [`HBox`](/api/layout/classes/HBox) or
 *   [`VBox`](/api/layout/classes/VBox); other layout managers ignore `weight`
 *   and the spacer falls back to its `(0, 0)` preferred size.
 *
 * The element carries `aria-hidden="true"`, a transparent background, and
 * `pointer-events: none` so it never intercepts hover or click events and
 * never appears in the accessibility tree.
 *
 * @example
 * ```typescript
 * new HBox().getContainer()
 *     .add(Button("A"), Spacer(16), Button("B"), Spacer.flex(), Button("C"));
 * ```
 *
 * @category Components
 */
class Spacer extends Component<SpacerOptions> {

    private _flex:       boolean = false;
    private _flexWeight: number  = 1;

    /**
     * Constructs a fixed-size spacer.
     *
     * @param width  - Preferred width in pixels.
     * @param height - Optional. Preferred height in pixels. Defaults to `width`.
     */
    constructor(width: number, height?: number);

    /**
     * Constructs a spacer from an options bag — use for the flex variant.
     *
     * @param options - Optional. {@link SpacerOptions} bag.
     */
    constructor(options?: SpacerOptions);

    constructor(arg1?: number | SpacerOptions, arg2?: number) {
        super(undefined, { backgroundColor: "transparent" });

        let opts: SpacerOptions;
        if (typeof arg1 === "number") {
            opts = { width: arg1, height: arg2 ?? arg1 };
        } else {
            opts = arg1 ?? {};
        }

        // Invisible by design — no chrome, no hit-testing, no a11y noise.
        this.setBackgroundColor("transparent");
        this.setPointerEvents("none");
        this.getAria().setHidden(true);

        this.applyOptions(opts);
    }

    /**
     * Factory for the absorb-rest variant. Equivalent to
     * `new Spacer({ flex: true, flexWeight: weight })`.
     *
     * @param weight - Optional. Flex weight; defaults to `1`.
     *
     * @returns A new flex `Spacer`.
     */
    static flex(weight: number = 1): Spacer {
        return new Spacer({ flex: true, flexWeight: weight });
    }

    /**
     * Returns whether this spacer is in flex (absorb-rest) mode.
     *
     * @returns The cached flex flag.
     */
    isFlex(): boolean {
        return this._flex;
    }

    /**
     * Toggles flex mode. When a parent is already attached, the stored
     * [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) on the
     * parent's layout manager are updated immediately.
     *
     * @param value - `true` to enable flex (weight-based) sizing.
     *
     * @returns This component, for method chaining.
     */
    setFlex(value: boolean): this {
        if (this._flex === value) {
            return this;
        }

        this._flex = value;

        this.syncFlexConstraints();

        return this;
    }

    /**
     * Returns the flex weight used in flex mode.
     *
     * @returns The cached flex weight (defaults to `1`).
     */
    getFlexWeight(): number {
        return this._flexWeight;
    }

    /**
     * Sets the flex weight. Only meaningful when `isFlex()` is `true`.
     * Multiple flex spacers in the same row/column share leftover space
     * proportionally to their weights.
     *
     * @param weight - The new flex weight.
     *
     * @returns This component, for method chaining.
     */
    setFlexWeight(weight: number): this {
        if (this._flexWeight === weight) {
            return this;
        }

        this._flexWeight = weight;

        if (this._flex) {
            this.syncFlexConstraints();
        }

        return this;
    }

    /**
     * Writes `_flex` / `_flexWeight` into the parent's
     * [`LayoutConstraints`](/api/layout/classes/LayoutConstraints) map.
     *
     * @remarks Silently no-ops when no parent or no layout manager is
     * attached; `init()` re-runs the sync once the spacer is rendered as a
     * child of a parent that owns a layout manager.
     */
    private syncFlexConstraints(): void {
        const parent = this.getParentComponent();
        if (!parent) {
            return;
        }

        const lm = parent.getLayoutManager();
        if (!lm) {
            return;
        }

        if (this._flex) {
            const existing = lm.getLayoutConstraints(this);
            const constraints = existing ?? new LayoutConstraints();
            constraints.weight = this._flexWeight;
            lm.setLayoutConstraints(this, constraints);
        } else {
            const existing = lm.getLayoutConstraints(this);
            if (existing && existing.weight !== undefined) {
                existing.weight = undefined;
                lm.setLayoutConstraints(this, existing);
            }
        }
    }

    /**
     * Applies a {@link SpacerOptions} bag. The `width` / `height` keys are
     * Spacer-specific sugar over the inherited `preferredSize` option; both
     * route through `setPreferredSize`.
     *
     * @param options - The options to apply.
     *
     * @returns This component, for method chaining.
     */
    protected applyOptions(options: SpacerOptions): this {
        super.applyOptions(options);

        if (options.width !== undefined || options.height !== undefined) {
            const w = options.width  ?? 0;
            const h = options.height ?? w;
            this.setPreferredSize({ width: w, height: h });
        }

        if (options.flexWeight !== undefined) {
            this.setFlexWeight(options.flexWeight);
        }

        if (options.flex !== undefined) {
            this.setFlex(options.flex);
        }

        return this;
    }

    /**
     * Initialises the element. Overridden so a flex spacer installs its
     * `weight` constraint on the parent's layout manager the first time it
     * is realised in the DOM — the parent has set `_parent` and rendered
     * the child by this point, so the layout manager is reachable.
     *
     * @param element - Optional. The element being initialised.
     *
     * @returns This component, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        if (this._flex) {
            this.syncFlexConstraints();
        }

        return this;
    }
}

const SpacerCallable = callable(Spacer);
type SpacerCallable = Spacer;
export {
    Spacer         as _Spacer,
    SpacerCallable as Spacer
};
