// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { Label } from "~/component/input/Label.js";
import { Glyph } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link IconLabel}.
 *
 * @category Components
 */
export interface IconLabelOptions extends ComponentOptions {
    glyph?: string;
    text?:  string;
    forId?: string;
    gap?:   number;
}

/**
 * A small composite pairing a leading [`Glyph`](/api/component/display/classes/Glyph)
 * with a trailing [`Label`](/api/component/input/classes/Label), laid out
 * horizontally with a configurable gap (default 0).
 *
 * Use this when the icon belongs to a form control: the inner element is a
 * real `<label for="…">`, so the browser still focuses the associated input
 * when the label text is clicked. For icon-with-text that has no form-control
 * association, use [`IconText`](/api/component/display/classes/IconText) instead.
 *
 * @example
 * ```typescript
 * import { IconLabel } from '@jimka/typescript-ui/component/display';
 * import { TextField } from '@jimka/typescript-ui/component/input';
 *
 * const field = new TextField();
 * panel.addComponent(new IconLabel('times', 'Email:', field.getId()));
 * panel.addComponent(field);
 * ```
 *
 * @category Components
 */
class IconLabel extends Component {

    private _glyph: Glyph;
    private _label: Label;
    private _gap:   number = 0;

    /**
     * Constructs an `IconLabel` pairing the named glyph with a `<label for="…">`.
     *
     * @param glyph - Registry glyph name. Must be present in the internal `Glyphs` registry.
     * @param text - Label text shown to the right of the glyph.
     * @param forId - Element id of the form control this label is associated with.
     *                Must be non-empty; mirrors [`Label`](/api/component/input/classes/Label)'s constructor contract.
     * @param options - Optional configuration bag (gap override, common Component fields).
     */
    constructor(glyph: string, text: string, forId: string, options?: IconLabelOptions) {
        super();

        this.setLayoutManager(new HBox({ spacing: this._gap }));
        this.setInsets(new Insets(0, 0, 0, 0));

        this._glyph = new Glyph(glyph);
        this._label = new Label(text, forId);

        this.addComponent(this._glyph);
        this.addComponent(this._label);

        if (this.constructor === IconLabel && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link IconLabelOptions} bag, dispatching the glyph name,
     * label text, `forId` association, and gap after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: IconLabelOptions): this {
        super.applyOptions(options);

        if (options.gap !== undefined) {
            this.setGap(options.gap);
        }

        if (options.glyph !== undefined) {
            this.setGlyph(options.glyph);
        }

        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.forId !== undefined) {
            this.setForId(options.forId);
        }

        return this;
    }

    /**
     * Replaces the leading glyph with a fresh instance for the given registry name.
     *
     * @param name - Registry glyph name. Must be present in the internal registry.
     *
     * @returns This component, for method chaining.
     */
    setGlyph(name: string): this {
        this.removeComponent(this._glyph);

        this._glyph = new Glyph(name);
        this.insertComponent(this._glyph, 0);

        return this;
    }

    /**
     * Updates the trailing label text.
     *
     * @param text - The new label string.
     *
     * @returns This component, for method chaining.
     */
    setText(text: string): this {
        this._label.setText(text);

        return this;
    }

    /**
     * Updates the trailing label's `for` association.
     *
     * @param id - Element id of the form control this label should be associated with.
     *
     * @returns This component, for method chaining.
     */
    setForId(id: string): this {
        this._label.setForId(id);

        return this;
    }

    /**
     * Sets the pixel gap between the glyph and the label.
     *
     * @param px - Gap in pixels.
     *
     * @returns This component, for method chaining.
     */
    setGap(px: number): this {
        this._gap = px;
        (this.getLayoutManager() as HBox).setComponentSpacing(px);

        return this;
    }

    /**
     * Returns the leading glyph component.
     *
     * @returns The [`Glyph`](/api/component/display/classes/Glyph) instance.
     */
    getGlyphComponent(): Glyph {
        return this._glyph;
    }

    /**
     * Returns the trailing label component.
     *
     * @returns The [`Label`](/api/component/input/classes/Label) instance.
     */
    getLabelComponent(): Label {
        return this._label;
    }
}

const IconLabelCallable = callable(IconLabel);
type IconLabelCallable = IconLabel;
export {
    IconLabel         as _IconLabel,
    IconLabelCallable as IconLabel
};
