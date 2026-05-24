// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { Legend } from "~/component/container/Legend.js";
import { BorderStyle } from "~/primitive/BorderStyle.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

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
 * super arg. Any field the caller omits falls back to one of these values;
 * `applyOptions`' `{ ...this._defaultOptions, ...options }` merge keeps the
 * defaults intact across subsequent re-invocations of `applyOptions`.
 */
const _defaultFieldSetOptions: Partial<FieldSetOptions> = {
    tag:           "fieldset",
    border:        { style: BorderStyle.GROOVE, width: 1, color: "var(--ts-ui-border-color, black)" },
    padding:       new Insets(15, 3, 3, 3),
    insets:        new Insets(5, 5, 15, 5),
    preferredSize: { width: 200, height: 200 },
};

/**
 * A fieldset component with an embedded legend title.
 *
 * Renders a `<fieldset>` element and prepends a Legend child for the group title.
 *
 * @category Components
 */
class FieldSet extends Component {

    private _legend: Legend = new Legend();

    constructor(title: string = "", options?: FieldSetOptions, subclassDefaults?: Partial<FieldSetOptions>) {
        super(options, { ..._defaultFieldSetOptions, ...(subclassDefaults ?? {}) });

        this._legend.setText(title);
    }

    /**
     * Applies a {@link FieldSetOptions} bag, dispatching the legend title text
     * after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: FieldSetOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as FieldSetOptions;

        if (opts.legend !== undefined) {
            this.setTitle(opts.legend);
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
        const baseMin   = super.getMinSize();
        const legendMin = this._legend.getMinSize();
        if (!legendMin) {
            return baseMin;
        }

        const perim   = this.getPerimiterSize();
        const padding = this.getPadding();
        const padW    = padding ? padding.getLeft() + padding.getRight() : 0;
        const chromeW = perim.left + perim.right + padW;

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
     * Renders the fieldset element and appends the legend as its first child.
     *
     * @returns The created HTMLFieldSetElement with the legend prepended.
     */
    render() {
        let element = super.render();

        element.appendChild(this._legend.getElement(true));

        return element;
    }
}

const FieldSetCallable = callable(FieldSet);
type FieldSetCallable = FieldSet;
export {
    FieldSet         as _FieldSet,
    FieldSetCallable as FieldSet
};
