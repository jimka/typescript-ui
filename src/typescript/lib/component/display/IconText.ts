// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { HBox } from "~/layout/HBox.js";
import { Insets } from "~/primitive/Insets.js";
import { Text } from "~/component/input/Text.js";
import { Glyph } from "~/component/display/Glyph.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link IconText}.
 *
 * @category Components
 */
export interface IconTextOptions extends ComponentOptions {
    glyph?: string;
    text?:  string;
    gap?:   number;
}

/**
 * A small composite pairing a leading [`Glyph`](/api/component/display/classes/Glyph)
 * with a trailing standalone [`Text`](/api/component/input/classes/Text), laid out
 * horizontally with a configurable gap (default 0).
 *
 * For form-control labels that need to be associated with an input element, use
 * [`IconLabel`](/api/component/display/classes/IconLabel) instead — its trailing
 * text is a real `<label for="…">`.
 *
 * @example
 * ```typescript
 * import { IconText } from '@jimka/typescript-ui/component/display';
 *
 * panel.addComponent(new IconText('times', 'Close'));
 * ```
 *
 * @category Components
 */
class IconText extends Component {

    private _glyph: Glyph;
    private _text:  Text;
    private _gap:   number = 0;

    /**
     * Constructs an `IconText` pairing the named glyph with the given label text.
     *
     * @param glyph - Registry glyph name. Must be present in the internal `Glyphs` registry.
     * @param text - Label text shown to the right of the glyph.
     * @param options - Optional configuration bag (gap override, common Component fields).
     */
    constructor(glyph: string, text: string, options?: IconTextOptions) {
        super();

        this.setLayoutManager(new HBox({ spacing: this._gap }));
        this.setInsets(new Insets(0, 0, 0, 0));

        this._glyph = new Glyph(glyph);
        this._text  = new Text(text);

        this.addComponent(this._glyph);
        this.addComponent(this._text);

        if (this.constructor === IconText && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies an {@link IconTextOptions} bag, dispatching the glyph name, label
     * text, and gap after inherited Component fields.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: IconTextOptions): this {
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
        this._text.setText(text);

        return this;
    }

    /**
     * Sets the pixel gap between the glyph and the text.
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
     * Returns the trailing text component.
     *
     * @returns The [`Text`](/api/component/input/classes/Text) instance.
     */
    getTextComponent(): Text {
        return this._text;
    }
}

const IconTextCallable = callable(IconText);
type IconTextCallable = IconText;
export {
    IconText         as _IconText,
    IconTextCallable as IconText
};
