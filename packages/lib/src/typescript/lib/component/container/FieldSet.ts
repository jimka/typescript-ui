// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import { Legend } from "~/component/container/Legend.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import type { StyleTrait } from "~/core/ClassStyleRules.js";
import { INPUT_CHROME_TRAIT } from "~/core/StyleTraits.js";

/**
 * Construction-time options for {@link FieldSet}.
 *
 * @category Components
 */
export interface FieldSetOptions extends ComponentOptions {
    legend?: string;
}

/**
 * Subclass defaults layered into `Component._defaultOptions` via the second
 * super arg. Any field the caller omits falls back to one of these values via
 * the getters / `applyStyle`, which consult `_defaultOptions` directly — the
 * default is never dispatched into `_options`.
 */
const _defaultFieldSetOptions: Partial<FieldSetOptions> = {
    tag:           "fieldset",
    // Intrinsic chrome carried as insets, not CSS padding. Top (5) is the gap
    // above content; the legend's own reserved height is added separately in
    // getPerimeterSize so it counts toward the box height without also pushing
    // the child origin (a <fieldset> already offsets its absolutely positioned
    // children below the legend). Sides/bottom (8) are the inner gutter.
    insets:        new Insets(5, 8, 8, 8),
    preferredSize: { width: 200, height: 200 },
    minSize:       { width: 100, height: 100 },
};

/**
 * A fieldset component with an embedded legend title.
 *
 * Renders a `<fieldset>` element and prepends a Legend child for the group title.
 *
 * @category Components
 */
class FieldSet extends Component {

    // Shares the border/borderRadius pair with TextInput, AbstractPickerField,
    // and ComboBox via one generated CSS rule — see
    // plans/cross-class-style-groups.md. `FieldSet` has no `ownClassStyleDefaults`
    // of its own, and declaring this alone does not make its chain participate
    // in the hierarchy cascade (`chainParticipates` only reads `ownClassStyleDefaults`).
    protected static readonly ownStyleTraits: readonly StyleTrait[] = [INPUT_CHROME_TRAIT];

    /** Legend clearance (px) used before the legend element can be measured. */
    private static readonly LEGEND_CLEARANCE_FALLBACK = 16;

    private _legend: Legend = new Legend();

    /** Cached measured legend height; null until a positive measurement lands. */
    private _legendClearance: number | null = null;

    constructor(title: string = "", options?: FieldSetOptions, subclassDefaults?: Partial<FieldSetOptions>) {
        super(options, { ..._defaultFieldSetOptions, ...(subclassDefaults ?? {}) });

        this._legend.setText(title);
        this._legend.setDisplayed(title !== "");
    }

    /**
     * Applies a {@link FieldSetOptions} bag, dispatching the legend title text
     * after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FieldSetOptions): this {
        super.applyOptions(options);

        if (options.legend !== undefined) {
            this.setTitle(options.legend);
        }

        return this;
    }

    /**
     * Returns the fieldset legend title text.
     *
     * @returns The current legend text string.
     */
    getTitle() {
        return this._legend.getText();
    }

    /**
     * Sets the fieldset legend title text.
     *
     * @param title - The text to display in the legend.
     */
    setTitle(title: string) : this {
        this._legend.setText(title);
        this._legend.setDisplayed(title !== "");
        this.clampLegendWidth();

        return this;
    }

    /**
     * Clamps the legend's `max-width` to the fieldset's current inner width so
     * a long title ellipsises inside the border notch instead of spilling out.
     * The legend already carries `overflow:hidden; text-overflow:ellipsis;
     * white-space:nowrap` (from `Text`'s `truncate:true`), so a `max-width` is
     * the only missing piece for the ellipsis to engage.
     *
     * @returns This component, for method chaining.
     *
     * @remarks No-op until the first layout pass commits a width — `getWidth()`
     * returns 0 on a detached / unsized fieldset. `doLayout()` re-runs the
     * clamp once a width exists.
     */
    private clampLegendWidth(): this {
        if (this.getTitle() === "") {
            return this;
        }

        const width = this.getWidth();
        if (width <= 0) {
            return this;
        }

        const perim   = this.getPerimeterSize();
        const chromeW = perim.left + perim.right;
        const innerW  = Math.max(0, width - chromeW);

        this._legend.setMaxSize({ width: innerW, height: Number.MAX_VALUE });

        return this;
    }

    /**
     * Returns the minimum size, augmented to include the legend's measured
     * width so the legend never spills out of the border notch. The legend is
     * rendered statically by the browser (it's not in the framework layout
     * tree), so `super.getMinSize()` from the layout manager doesn't see it.
     *
     * @returns The minimum `{width, height}`, ensuring the legend's text fits.
     */
    getMinSize(): Size | null {
        if (this.getTitle() === "") {
            return super.getMinSize();
        }

        const baseMin   = super.getMinSize();
        const legendMin = this._legend.getMinSize();
        if (!legendMin) {
            return baseMin;
        }

        const perim   = this.getPerimeterSize();
        const chromeW = perim.left + perim.right;

        const fieldsetW = legendMin.width + chromeW;
        if (!baseMin) {
            return { width: fieldsetW, height: 0 };
        }

        return {
            width:  Math.max(baseMin.width, fieldsetW),
            height: baseMin.height,
        };
    }

    /**
     * Augments the top perimeter with the legend's reserved vertical space.
     *
     * A `<fieldset>` reserves room for its `<legend>` at the top of its content
     * box automatically: absolutely positioned children begin below the legend
     * regardless of the framework's insets, and the browser supplies that
     * offset itself. {@link getInnerSize} must account for the same space or
     * the bottom row overflows the border, so this adds the legend's height to
     * the `top` perimeter. The child origin is deliberately left untouched —
     * the content-inset origin derives from insets alone, and the browser
     * already provides the matching downward offset, so adding it to the
     * origin too would double-count it.
     *
     * The legend is browser-rendered chrome, not a framework-layout child, so
     * its height is read from the element and cached. The measurement slightly
     * over-reserves when the legend is raised into the border notch, which errs
     * toward extra bottom space rather than clipping. Before the element can be
     * measured a constant fallback is used and not cached, so the real height
     * supersedes it on the first connected pass.
     *
     * @returns The base perimeter with the legend clearance added to `top`.
     */
    getPerimeterSize() {
        const perim = super.getPerimeterSize();

        perim.top += this.legendClearance();

        return perim;
    }

    /**
     * Returns the legend's reserved top clearance in pixels: the measured
     * legend height once it is connected and laid out (cached after the first
     * positive measurement), or {@link LEGEND_CLEARANCE_FALLBACK} until then.
     *
     * @returns The legend clearance in pixels.
     */
    private legendClearance(): number {
        if (this.getTitle() === "") {
            return 0;
        }

        if (this._legendClearance != null) {
            return this._legendClearance;
        }

        // A modelled (no-browser) source has no native `<legend>` box to
        // measure, so short-circuit to the fallback rather than reading
        // `offsetHeight`, which is 0 or unavailable offline.
        if (DOM.source.isModelled()) {
            return FieldSet.LEGEND_CLEARANCE_FALLBACK;
        }

        const element = this._legend.getElement();

        if (element && DOM.source.isConnected(element)) {
            const offsetHeight = DOM.source.getOffsetSize(element).offsetHeight;

            if (offsetHeight > 0) {
                this._legendClearance = offsetHeight;

                return this._legendClearance;
            }
        }

        return FieldSet.LEGEND_CLEARANCE_FALLBACK;
    }

    /**
     * Lays out the fieldset, then re-clamps the legend to the freshly committed
     * inner width so the title ellipsis tracks fieldset resizes. The clamp runs
     * post-layout because `getWidth()` only reports a real width once the layout
     * pass has committed one.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();
        this.clampLegendWidth();

        return this;
    }

    /**
     * Renders the fieldset element and appends the legend as its first child.
     *
     * @returns The created HTMLFieldSetElement with the legend prepended.
     */
    render() {
        let element = super.render();

        DOM.sink.appendChild(element, this._legend.getElement(true)!);

        return element;
    }

    /**
     * Disposes the legend, then runs the inherited teardown. `_legend` is
     * raw-appended rather than registered, so the base destructor's
     * recursion over `_components` cannot reach it.
     */
    protected destructor(): void {
        this._legend.dispose();

        super.destructor();
    }
}

const FieldSetCallable = callable(FieldSet);
type FieldSetCallable = FieldSet;
export {
    FieldSet         as _FieldSet,
    FieldSetCallable as FieldSet
};
