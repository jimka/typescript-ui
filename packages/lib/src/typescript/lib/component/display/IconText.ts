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
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(
        glyph:             string,
        text:              string,
        options?:          IconTextOptions,
        subclassDefaults?: Partial<IconTextOptions>,
    ) {
        // The HBox sits in the defaults bag (under user options) so a caller
        // that wants a different layoutManager can still override it.
        super(options, {
            ..._defaultIconTextOptions,
            layoutManager: new HBox(),
            ...(subclassDefaults ?? {}),
        });

        // Build children with the effective values up front so nothing has to
        // be overwritten afterwards. The bag-written values from the cascade
        // take precedence over the positional arguments; resolving them here
        // is what keeps a bag `glyph` from building a second Glyph, and
        // mirrors `IconLabel`'s own constructor.
        this._glyph = new Glyph(this._options.glyph ?? glyph);
        this._text  = new Text(this._options.text ?? text);

        this.addComponent(this._glyph);
        this.addComponent(this._text);

        // Late-built state: the `gap` setter reaches into a layout manager that
        // didn't exist during `super`'s cascade. Dispatch from `_options` now
        // that the row is built, always applying the effective value (caller
        // override, else the class default) since the HBox is seeded without
        // spacing.
        (this.getLayoutManager() as HBox).setComponentSpacing(this.getGap());
    }

    /**
     * Applies an {@link IconTextOptions} bag. Inherited Component fields cascade
     * through `super.applyOptions`; the gap/glyph/text fields are written pure
     * to `_options` here, and the constructor body reads them back once the row
     * is built — `glyph` and `text` as the children's effective values, `gap`
     * as a dispatch into the HBox.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: IconTextOptions): this {
        super.applyOptions(options);

        if (options.gap   !== undefined) this._options.gap   = options.gap;
        if (options.glyph !== undefined) this._options.glyph = options.glyph;
        if (options.text  !== undefined) this._options.text  = options.text;

        return this;
    }

    /**
     * Changes the leading glyph to the given registry name, in place.
     *
     * @param name - Registry glyph name. Must be present in the internal registry.
     *
     * @returns This component, for method chaining.
     */
    setGlyph(name: string): this {
        this._glyph.setGlyphName(name);

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
     * Returns the effective gap between the glyph and the text — the
     * caller/setter value, else the class default (2).
     *
     * @returns The gap in pixels.
     */
    getGap(): number {
        return (this._options.gap ?? this._defaultOptions.gap)!;
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
