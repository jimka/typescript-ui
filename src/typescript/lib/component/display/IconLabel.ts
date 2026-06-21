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
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade dispatches each present setter once with the final value.
 * `layoutManager` is *not* listed — each instance needs its own fresh HBox.
 * `gap`/`glyph`/`text`/`forId` are late-built state (their setters reach into
 * children) and are written pure by `applyOptions`, then dispatched from the
 * constructor body once the row exists.
 */
const _defaultIconLabelOptions: Partial<IconLabelOptions> = {
    gap:    2,
    insets: new Insets(0, 0, 0, 0),
};

/**
 * A small composite pairing a leading [`Glyph`](/api/component/display/classes/Glyph)
 * with a trailing [`Label`](/api/component/input/classes/Label), laid out
 * horizontally with a configurable gap (default 2).
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
class IconLabel extends Component<IconLabelOptions> {

    private _glyph!: Glyph;
    private _label!: Label;

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
        super(options, _defaultIconLabelOptions);

        // Per-instance layout manager seeded with the merged `_options.gap`
        // so a consumer override (or the default) flows into the HBox spacing.
        this.setLayoutManager(new HBox({ spacing: this._options.gap }));

        // Build children with the effective values up front so the late-built
        // dispatch below has nothing to overwrite. The bag-written values
        // from the cascade take precedence over the positional arguments.
        // `setGlyph` would rebuild the inner Glyph, and `setText`/`setForId`
        // would push the same value into the Label a second time — so we
        // resolve the effective value here once.
        const effectiveGlyph = this._options.glyph ?? glyph;
        const effectiveText  = this._options.text  ?? text;
        const effectiveForId = this._options.forId ?? forId;

        this._glyph = new Glyph(effectiveGlyph);
        this._label = new Label(effectiveText, effectiveForId);

        this.addComponent(this._glyph);
        this.addComponent(this._label);

        // Late-built state: bag-written by `applyOptions`. Only `gap` needs
        // post-construction dispatch — the HBox's spacing was seeded from
        // the bag at construction, but a later cascade-time write to
        // `_options.gap` (consumer override) needs to push into the HBox.
        if (this._options.gap !== undefined) {
            (this.getLayoutManager() as HBox).setComponentSpacing(this._options.gap);
        }
    }

    /**
     * Applies an {@link IconLabelOptions} bag. Inherited Component fields
     * cascade through `super.applyOptions`; the gap/glyph/text/forId fields
     * are written pure to `_options` here and dispatched from the constructor
     * body once children exist.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: IconLabelOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as IconLabelOptions;

        if (opts.gap   !== undefined) this._options.gap   = opts.gap;
        if (opts.glyph !== undefined) this._options.glyph = opts.glyph;
        if (opts.text  !== undefined) this._options.text  = opts.text;
        if (opts.forId !== undefined) this._options.forId = opts.forId;

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
