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
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade dispatches each present setter once with the final value. `gap`
 * is included even though its setter touches `getLayoutManager()`: it is
 * pure-bag-written by `applyOptions` and dispatched after the HBox is built.
 * `layoutManager` is *not* listed because each instance needs its own fresh
 * HBox — sharing one instance across components would corrupt layout state.
 */
const _defaultIconTextOptions: Partial<IconTextOptions> = {
    gap:    2,
    insets: new Insets(0, 0, 0, 0),
};

/**
 * A small composite pairing a leading [`Glyph`](/api/component/display/classes/Glyph)
 * with a trailing standalone [`Text`](/api/component/input/classes/Text), laid out
 * horizontally with a configurable gap (default 2).
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
class IconText extends Component<IconTextOptions> {

    private _glyph!: Glyph;
    private _text!:  Text;

    /**
     * Constructs an `IconText` pairing the named glyph with the given label text.
     *
     * @param glyph - Registry glyph name. Must be present in the internal `Glyphs` registry.
     * @param text - Label text shown to the right of the glyph.
     * @param options - Optional configuration bag (gap override, common Component fields).
     */
    constructor(glyph: string, text: string, options?: IconTextOptions) {
        // The HBox sits in the defaults bag (under user options) so a caller
        // that wants a different layoutManager can still override it.
        super(options, {
            ..._defaultIconTextOptions,
            layoutManager: new HBox(),
        });

        this._glyph = new Glyph(glyph);
        this._text  = new Text(text);

        this.addComponent(this._glyph);
        this.addComponent(this._text);

        // Late-built state: `gap` and `glyph`/`text` setters reach into
        // children that didn't exist during `super`'s cascade. Dispatch from
        // `_options` now that the row is built.
        if (this._options.gap !== undefined) {
            (this.getLayoutManager() as HBox).setComponentSpacing(this._options.gap);
        }
        if (this._options.glyph !== undefined) {
            this.setGlyph(this._options.glyph);
        }
        if (this._options.text !== undefined) {
            this.setText(this._options.text);
        }
    }

    /**
     * Applies an {@link IconTextOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; the gap/glyph/text fields are written pure
     * to `_options` here and dispatched from the constructor body once children
     * exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: IconTextOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as IconTextOptions;

        if (opts.gap   !== undefined) this._options.gap   = opts.gap;
        if (opts.glyph !== undefined) this._options.glyph = opts.glyph;
        if (opts.text  !== undefined) this._options.text  = opts.text;

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
        this._options.gap = px;
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
