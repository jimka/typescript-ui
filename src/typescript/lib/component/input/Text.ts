// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { ThemeManager } from "~/core/Theme.js";
import { Util } from "~/core/Util.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link Text}.
 *
 * @category Components
 */
export interface TextOptions extends ComponentOptions {
    tag?:            string;
    text?:           string;
    textAlign?:      string;
    textShadow?:     string;
    fontFamily?:     string;
    fontSize?:       number | string;
    fontWeight?:     string;
    fontStyle?:      string;
    fontVariant?:    string;
    fontStretch?:    string;
    fontKerning?:    string;
    fontSizeAdjust?: string;
    lineHeight?:     number | string;
    textOverflow?:   string;
    whiteSpace?:     string;
    /**
     * When `true` (default), the text is single-line + clipped + ellipsised
     * when its rendered width is below its natural width, and `minSize.width`
     * is capped at `100` so parent layouts can shrink the text past its
     * natural width.
     *
     * When `false`, no ellipsis is applied and `minSize.width` reports the
     * full natural width — the text refuses to be squeezed, forcing the
     * parent to widen (used by [`Button`](/api/component/button/classes/Button)
     * for the label so the button grows to fit its text instead of clipping).
     */
    truncate?:       boolean;
}

/**
 * Module-level class defaults forwarded to `super` via the options bag so the
 * `applyOptions` cascade dispatches each setter once with the final value.
 *
 * `fontFamily` and `lineHeight` are intentionally **omitted**:
 *
 * - `fontFamily` must remain a getter-fallback only. Routing it through
 *   `setFontFamily(...)` would write the literal `var(--ts-ui-font-family, …)`
 *   onto every Text's CSS rule, blocking a parent's `font-family` override
 *   from cascading through.
 * - `lineHeight` is theme-derived (`readThemeLineHeightPx()`), so the value
 *   isn't known at module load. It is resolved lazily on first
 *   `calculateSize()` (post-attach), keeping construction JS-only per
 *   ARCHITECTURE.md "Defer DOM work to render time".
 */
const _defaultTextOptions: Partial<TextOptions> = {
    tag:            "span",
    textAlign:      "left",
    fontKerning:    "auto",
    fontSize:       14,
    fontSizeAdjust: "none",
    fontStretch:    "normal",
    fontStyle:      "normal",
    fontVariant:    "normal",
    fontWeight:     "normal",
    truncate:       true,
};

// Upper bound for the auto-derived `minSize.width` from text measurement —
// short labels report their full measured width (so they're never truncated
// when the container has room), longer text caps here so the parent layout
// always has room to shrink the Text below its natural width.
const TEXT_AUTO_MIN_WIDTH_CAP_PX = 100;

// Default theme-tracking line-height rule: the control's own font size plus the
// `--ts-ui-line-padding` leading, so the line box scales per font size. `1em`
// resolves against the element's own font-size at both render and measure time.
// `2px` is the shipped `--ts-ui-line-padding` default, used only if the var is
// absent. A control overrides this with an explicit px via `setLineHeight`.
const ADDITIVE_LINE_HEIGHT_RULE = "calc(1em + var(--ts-ui-line-padding, 2px))";

/**
 * A text-displaying component with comprehensive font and layout controls.
 *
 * Uses an off-screen probe element to measure text dimensions and automatically
 * updates the preferred size whenever the text or a font property changes.
 *
 * `Text` subscribes to {@link ThemeManager} on construction so it re-measures itself
 * on every theme change. Components that create `Text` instances dynamically and
 * remove them from the page should call `text.dispose()` to detach the listener.
 *
 * @category Components
 */
class Text<TOptions extends TextOptions = TextOptions> extends Component<TOptions> {

    private _hasExplicitPreferredSize: boolean = false;
    private _fontSizeCSSVar : string | null = "--ts-ui-font-size";
    private _fontSizeCSSRule: string | null = "var(--ts-ui-font-size, 14px)";
    private readonly _unsubscribeTheme: () => void;
    private _lineHeightCSSVar : string | null = null;
    private _lineHeightCSSRule: string | null = ADDITIVE_LINE_HEIGHT_RULE;
    private _measuredBaseline: number | null = null;
    private _measuredMinSize: Size | null = null;
    private _autoMeasure: boolean = true;
    private _measurementDirty: boolean = true;
    private _wordBreak: string | null = null;
    private _lineClamp: number | null = null;
    private _textOverflow: string | null = null;
    private _truncate: boolean = true;

    constructor(text?: String, options?: TOptions, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultTextOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        // Carve-out fallbacks — see `_defaultTextOptions` for why these two
        // don't ride the merge-defaults cascade. Both are consulted by their
        // getters as a fallback when `_options.X` is undefined.
        //
        // Note: the cascade-driven `setFontSize(14)` clobbers `fontSizeCSSVar`
        // and `fontSizeCSSRule` to null, but Text's field initializers (which
        // run after super returns) restore both to their var-binding values —
        // so theme reactivity is preserved by the DOM `var(...)` binding even
        // though the cascade temporarily writes a literal.
        //
        // `_defaultOptions.lineHeight` is resolved lazily on first
        // `calculateSize()` (post-attach) — see ARCHITECTURE.md "Defer DOM
        // work to render time".
        this._defaultOptions.fontFamily = "var(--ts-ui-font-family, system-ui, sans-serif)";

        this.clearInsets();
        this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);

        this._unsubscribeTheme = ThemeManager.onThemeChange(() => {
            if (this._fontSizeCSSVar) {
                const raw    = getComputedStyle(document.documentElement)
                                   .getPropertyValue(this._fontSizeCSSVar)
                                   .trim();
                const parsed = parseFloat(raw);

                if (!isNaN(parsed)) {
                    // Route to `_options` so the post-cascade explicit value
                    // (set by `setFontSize(14)` during applyOptions) is
                    // overwritten on theme change. Writing to `_defaultOptions`
                    // here would be shadowed by `_options.fontSize = 14` in
                    // the `getFontSize` fallback, breaking re-flow.
                    this._options.fontSize = parsed as TOptions["fontSize"];
                }
            }

            if (this._lineHeightCSSVar) {
                this._defaultOptions.lineHeight = this.readThemeLineHeightPx();
            }

            this.calculateSize();
        });

        // Positional `text` constructor argument: write to the bag only when
        // the caller didn't also pass `options.text` (which would have been
        // dispatched via super's applyOptions cascade and should win).
        if (text !== undefined && this._options.text === undefined) {
            this.setText(text);
        }

        // Off-screen text measurement is deferred until the first
        // getPreferredSize / getBaseline call so construction stays JS-only
        // (no forced layout from `Util.measureTextMetrics`).
        this._measurementDirty = true;
    }

    /**
     * Applies a {@link TextOptions} bag to this component, dispatching font and
     * text properties to their corresponding setters after the inherited
     * Component fields have been applied.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: TOptions): this {
        super.applyOptions(options);

        // Merge with `_defaultOptions` so the cascade dispatches subclass
        // defaults (e.g. Header's bold weight) alongside caller values.
        const opts = { ...this._defaultOptions, ...options } as TOptions;

        if (opts.text !== undefined) {
            this.setText(opts.text);
        }

        if (opts.textAlign !== undefined) {
            this.setTextAlign(opts.textAlign);
        }

        if (opts.textShadow !== undefined) {
            this.setTextShadow(opts.textShadow);
        }

        if (opts.fontFamily !== undefined) {
            this.setFontFamily(opts.fontFamily);
        }

        if (opts.fontSize !== undefined) {
            this.setFontSize(opts.fontSize);
        }

        if (opts.fontWeight !== undefined) {
            this.setFontWeight(opts.fontWeight);
        }

        if (opts.fontStyle !== undefined) {
            this.setFontStyle(opts.fontStyle);
        }

        if (opts.fontVariant !== undefined) {
            this.setFontVariant(opts.fontVariant);
        }

        if (opts.fontStretch !== undefined) {
            this.setFontStretch(opts.fontStretch);
        }

        if (opts.fontKerning !== undefined) {
            this.setFontKerning(opts.fontKerning);
        }

        if (opts.fontSizeAdjust !== undefined) {
            this.setFontSizeAdjust(opts.fontSizeAdjust);
        }

        if (opts.lineHeight !== undefined) {
            this.setLineHeight(opts.lineHeight);
        }

        if (opts.textOverflow !== undefined) {
            this.setTextOverflow(opts.textOverflow);
        }

        if (opts.whiteSpace !== undefined) {
            this.setWhiteSpace(opts.whiteSpace);
        }

        if (opts.truncate !== undefined) {
            this.setTruncate(opts.truncate);
        }

        return this;
    }

    /**
     * Resolves this `Text`'s line box height in pixels under the additive
     * leading model.
     *
     * @returns `Util.lineHeightPx(fontSize)` — the control's own font size plus
     * the `--ts-ui-line-padding` leading — for the default theme-tracking case.
     * A legacy custom line-height var binding resolves that var as a fixed line
     * box instead, falling back to the additive value when it is unparseable.
     *
     * @remarks `_options.fontSize` is always a resolved px number here (a CSS
     * var passed to `setFontSize` is resolved and stored as a number), so the
     * leading scales with the control's actual font size — a 12px button title
     * and a 14px label get proportionate line boxes from the one token. This is
     * the same arithmetic `Util.lineHeightPx` applies for input box heights, so
     * a `Text` measures and renders at the line height a sibling input expects.
     */
    private readThemeLineHeightPx(): number {
        const fs = (this._options.fontSize as number | undefined) ?? (this._defaultOptions.fontSize as number | undefined) ?? 14;

        if (this._lineHeightCSSVar) {
            const raw    = getComputedStyle(document.documentElement)
                               .getPropertyValue(this._lineHeightCSSVar)
                               .trim();
            const parsed = parseFloat(raw);

            if (!isNaN(parsed)) {
                return parsed;
            }
        }

        return Util.lineHeightPx({ fontSizePx: fs });
    }

    /**
     * Returns the DOM element cast to HTMLElement.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's HTMLElement.
     */
    getElement(createIfMissing: boolean = false): HTMLElement {
        return super.getElement(createIfMissing) as HTMLElement;
    }

    /**
     * Sets the preferred size from an explicit caller, locking it against automatic recalculation.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(width: number, height: number): this {
        this._hasExplicitPreferredSize = true;
        super.setPreferredSize(width, height);

        return this;
    }

    /**
     * Updates the preferred size from a measurement only when no explicit size has been set.
     */
    private setCalculatedSize(width: number, height: number): void {
        if (!this._hasExplicitPreferredSize) {
            super.setPreferredSize(width, height);
        }
    }

    /**
     * Measures the text using an off-screen probe element and sets the preferred size.
     *
     * @remarks Creates a temporary fixed-positioned invisible `<span>`, appends it to the body
     * to obtain its bounding rect, then removes it. Sets preferred size to (0, 0) when no text is set.
     * No-op when {@link setAutoMeasure} is `false` — the parent layout is expected to size this Text.
     */
    private calculateSize(): void {
        this._measurementDirty = false;

        // First-read deferral: populate the default line-height the first
        // time we measure, when the component is attached and
        // `getComputedStyle` is safe. Subsequent reads come through the
        // `ThemeManager.onThemeChange` callback above. Placed before the
        // `_autoMeasure` gate so non-measuring `Text` instances still get
        // a resolved value populated for `getLineHeight()` callers.
        if (this._defaultOptions.lineHeight === undefined) {
            this._defaultOptions.lineHeight = this.readThemeLineHeightPx();
        }

        if (!this._autoMeasure) {
            return;
        }

        // Floor the reported minimum height to one line so a single-line label
        // is never squeezed below its line box (the measured height is 0 for
        // empty text and unset before the first probe).
        const lineHeightPx  = this.getLineHeight() ?? this.readThemeLineHeightPx();
        const minLineHeight = Math.ceil(lineHeightPx);

        const text = this._options.text;
        if (text) {
            const fontSize   = this.getFontSize();
            const lineHeight = this.getLineHeight();

            const { width, height, baseline } = Util.measureTextMetrics(text.toString(), {
                fontFamily : this.getFontFamily()  ?? undefined,
                fontSize   : this._fontSizeCSSRule ?? (fontSize !== null ? `${fontSize}px` : undefined),
                fontWeight : this.getFontWeight()  ?? undefined,
                fontStyle  : this.getFontStyle()   ?? undefined,
                fontVariant: this.getFontVariant() ?? undefined,
                fontStretch: this.getFontStretch() ?? undefined,
                lineHeight : this._lineHeightCSSRule ?? (lineHeight !== null ? `${lineHeight}px` : undefined)
            });

            this._measuredBaseline = baseline;
            this.setCalculatedSize(width, height);
            // Store the measured floor as per-instance derived state (like
            // `_measuredBaseline`), kept out of `_defaultOptions`, which holds
            // the class-level Text defaults rather than per-instance
            // measurements. `getMinSize` folds this into the inherited min.
            // When truncation is disabled, report the full natural width so the
            // parent layout widens to fit instead of squeezing the text;
            // otherwise cap it so the parent can shrink the text past its
            // natural width.
            const autoMinWidth = this._truncate
                ? Math.min(width, TEXT_AUTO_MIN_WIDTH_CAP_PX)
                : width;
            this._measuredMinSize = {
                width:  autoMinWidth,
                height: Math.max(height, minLineHeight),
            };
        } else {
            // No glyphs means no baseline — report null so HBox doesn't try
            // to baseline-align surrounding components against an empty box.
            // Reserve no line height either: an empty Text (e.g. the label slot
            // of an icon-only button) must collapse so it doesn't inflate the
            // container and knock the icon off-centre. The one-line floor only
            // applies once there is text to keep on its line.
            this._measuredBaseline = null;
            this.setCalculatedSize(0, 0);
            this._measuredMinSize = { width: 0, height: 0 };
        }
    }

    /**
     * Forces a one-off text measurement that ignores {@link setAutoMeasure}.
     * Use when the caller has opted out of auto-measure but needs an up-to-date
     * preferred size after a programmatic text change.
     */
    measure(): void {
        const wasAuto = this._autoMeasure;
        this._autoMeasure = true;
        this.calculateSize();
        this._autoMeasure = wasAuto;
    }

    /**
     * Returns the visual baseline of the rendered text, accounting for any
     * border, padding, or framework insets on this component.
     *
     * @returns The baseline offset from the component's outer top, in pixels,
     * or `null` when no text has been measured yet.
     *
     * @remarks Forces a measurement when the cached value is stale — the
     * off-screen probe is deferred from construction so first-call timing
     * shifts to whoever asks for a size first (usually `doLayout`).
     */
    getBaseline(): number | null {
        if (this._measurementDirty) {
            this.calculateSize();
        }

        return this.wrapInnerBaseline(this._measuredBaseline);
    }

    /**
     * Returns the preferred size, lazily measuring the text on the first call.
     *
     * @returns The preferred Size, or `null` per the inherited contract.
     *
     * @remarks Construction no longer eagerly probes `document.body` for text
     * dimensions; the first reader of the preferred size pays the measurement
     * cost. After attach this is `doLayout`, so the probe happens at layout
     * time rather than construction time.
     */
    getPreferredSize() {
        if (this._measurementDirty) {
            this.calculateSize();
        }

        return super.getPreferredSize();
    }

    /**
     * Returns the effective minimum size, folding the measured one-line height
     * floor (from `calculateSize`) into the inherited component/layout minimum.
     *
     * @returns The minimum `{width, height}`, never shorter than one line of
     * text, or `null` only when neither a measurement nor an inherited minimum
     * exists.
     *
     * @remarks Only the **height** floor participates in the hard minimum —
     * text cannot render below its line box without clipping. The measured
     * width is deliberately *not* folded in: surfacing each label's natural
     * width as a hard minimum would stop parent layouts (e.g. an equal-mode tab
     * bar) from compressing short labels to fit, which is why `Text.minSize`
     * has historically reported a zero width. The floor is per-instance derived
     * state held in `_measuredMinSize`, not a class default, so it lives outside
     * `_defaultOptions`. An explicit caller `setMinSize` taller than the floor
     * still wins via `Math.max`; a value shorter than one line is lifted to it.
     */
    getMinSize(): Size | null {
        if (this._measurementDirty) {
            this.calculateSize();
        }

        const measured = this._measuredMinSize;
        const base     = super.getMinSize();

        if (!measured) {
            return base;
        }

        if (!base) {
            return { width: 0, height: measured.height };
        }

        return {
            width:  base.width,
            height: Math.max(base.height, measured.height),
        };
    }

    /**
     * Returns the current text content, or an empty string if none is set.
     *
     * @returns The current text string, or "" if no text is set.
     */
    getText() {
        return this._options.text || "";
    }

    /**
     * Sets the text content, recalculates the preferred size, and updates the DOM element.
     *
     * @param text - The new text to display.
     *
     * @returns This component, for method chaining.
     */
    setText(text: String): this {
        this._options.text = (text || "") as TOptions["text"];

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        let element = this.getElement();
        if (!element) {
            return this;
        }

        element.textContent = text.valueOf();

        return this;
    }

    /**
     * Enables or disables automatic text measurement on `setText`.
     *
     * @param enabled - When `false`, `setText` skips the off-screen probe and
     *                  leaves preferred size and baseline unchanged. Use only when
     *                  the parent layout (e.g. [`Fit`](/api/layout/classes/Fit)) sizes this Text from
     *                  the container, so the measured preferred size is unused.
     *
     * @returns This component, for method chaining.
     */
    setAutoMeasure(enabled: boolean): this {
        this._autoMeasure = enabled;

        return this;
    }

    /**
     * Returns the current CSS text-align value.
     *
     * @returns The CSS text-align string, or null if not set.
     */
    getTextAlign() {
        return this._options.textAlign ?? this._defaultOptions.textAlign ?? null;
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right").
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string): this {
        this._options.textAlign = align;

        this.setElementCSSRule("textAlign", align);

        return this;
    }

    /**
     * Returns the CSS text-shadow value.
     *
     * @returns The CSS text-shadow string, or null if not set.
     */
    getTextShadow() {
        return this._options.textShadow ?? null;
    }

    /**
     * Sets the CSS text-shadow and updates the component's CSS rule.
     *
     * @param shadow - A CSS text-shadow value.
     *
     * @returns This component, for method chaining.
     */
    setTextShadow(shadow: string): this {
        this._options.textShadow = shadow;

        this.setElementCSSRule("textShadow", shadow);

        return this;
    }

    /**
     * Removes the text-shadow CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearTextShadow(): this {
        if (this._options.textShadow === undefined) {
            return this;
        }

        this._options.textShadow = undefined;
        this.setElementCSSRule("textShadow", null);

        return this;
    }

    /**
     * Returns the CSS font-family value.
     *
     * @returns The CSS font-family string, or null if not set.
     */
    getFontFamily() {
        return this._options.fontFamily ?? this._defaultOptions.fontFamily ?? null;
    }

    /**
     * Sets the CSS font-family, updates the rule, and recalculates preferred size.
     *
     * @param value - The CSS font-family string (e.g. "sans-serif", "'Arial', sans-serif").
     *
     * @returns This component, for method chaining.
     */
    setFontFamily(value: string): this {
        this._options.fontFamily = value;

        this.setElementCSSRule("fontFamily", value);

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the CSS font-kerning value.
     *
     * @returns The CSS font-kerning string, or null if not set.
     */
    getFontKerning() {
        return this._options.fontKerning ?? this._defaultOptions.fontKerning ?? null;
    }

    /**
     * Sets the CSS font-kerning and updates the component's CSS rule.
     *
     * @param value - A CSS font-kerning value (e.g. "auto", "normal", "none").
     *
     * @returns This component, for method chaining.
     */
    setFontKerning(value: string): this {
        this._options.fontKerning = value;

        this.setElementCSSRule("fontKerning", value);

        return this;
    }

    /**
     * Returns the font size in pixels.
     *
     * @returns The font size as a number, or null if not set.
     */
    getFontSize() {
        return (this._options.fontSize as number | undefined) ?? (this._defaultOptions.fontSize as number | undefined) ?? null;
    }

    /**
     * Sets the font size. Pass a number for an explicit pixel value, or a CSS variable name
     * (e.g. `"--ts-ui-header-font-size"`) to bind to a theme token.
     *
     * @param value - Pixel size as a number, or a CSS custom property name as a string.
     *
     * @returns This component, for method chaining.
     */
    setFontSize(value: number | string): this {
        if (typeof value === 'number') {
            this._options.fontSize = value as TOptions["fontSize"];
            this._fontSizeCSSVar    = null;
            this._fontSizeCSSRule   = null;
            this.setElementCSSRule("fontSize", value + "px");
        } else {
            const raw    = getComputedStyle(document.documentElement).getPropertyValue(value).trim();
            const parsed = parseFloat(raw);

            if (!isNaN(parsed)) {
                this._options.fontSize = parsed as TOptions["fontSize"];
            }

            const resolved       = this.getFontSize() ?? 14;
            this._fontSizeCSSVar  = value;
            this._fontSizeCSSRule = `var(${value}, ${resolved}px)`;
            this.setElementCSSRule("fontSize", this._fontSizeCSSRule);
        }

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the CSS font-size-adjust value.
     *
     * @returns The CSS font-size-adjust string, or null if not set.
     */
    getFontSizeAdjust() {
        return this._options.fontSizeAdjust ?? this._defaultOptions.fontSizeAdjust ?? null;
    }

    /**
     * Sets the CSS font-size-adjust and updates the component's CSS rule.
     *
     * @param value - A CSS font-size-adjust value.
     *
     * @returns This component, for method chaining.
     */
    setFontSizeAdjust(value: string): this {
        this._options.fontSizeAdjust = value;

        this.setElementCSSRule("fontSizeAdjust", value);

        return this;
    }

    /**
     * Returns the CSS font-stretch value.
     *
     * @returns The CSS font-stretch string, or null if not set.
     */
    getFontStretch() {
        return this._options.fontStretch ?? this._defaultOptions.fontStretch ?? null;
    }

    /**
     * Sets the CSS font-stretch and updates the component's CSS rule.
     *
     * @param value - A CSS font-stretch value (e.g. "normal", "condensed", "expanded").
     *
     * @returns This component, for method chaining.
     */
    setFontStretch(value: string): this {
        this._options.fontStretch = value;

        this.setElementCSSRule("fontStretch", value);

        return this;
    }

    /**
     * Returns the CSS font-style value (e.g. "normal", "italic").
     *
     * @returns The CSS font-style string, or null if not set.
     */
    getFontStyle() {
        return this._options.fontStyle ?? this._defaultOptions.fontStyle ?? null;
    }

    /**
     * Sets the CSS font-style and updates the component's CSS rule.
     *
     * @param value - A CSS font-style value (e.g. "normal", "italic", "oblique").
     *
     * @returns This component, for method chaining.
     */
    setFontStyle(value: string): this {
        this._options.fontStyle = value;

        this.setElementCSSRule("fontStyle", value);

        return this;
    }

    /**
     * Returns the CSS font-variant value.
     *
     * @returns The CSS font-variant string, or null if not set.
     */
    getFontVariant() {
        return this._options.fontVariant ?? this._defaultOptions.fontVariant ?? null;
    }

    /**
     * Sets the CSS font-variant and updates the component's CSS rule.
     *
     * @param value - A CSS font-variant value (e.g. "normal", "small-caps").
     *
     * @returns This component, for method chaining.
     */
    setFontVariant(value: string): this {
        this._options.fontVariant = value;

        this.setElementCSSRule("fontVariant", value);

        return this;
    }

    /**
     * Returns the CSS font-weight value.
     *
     * @returns The CSS font-weight string, or null if not set.
     */
    getFontWeight() {
        return this._options.fontWeight ?? this._defaultOptions.fontWeight ?? null;
    }

    /**
     * Sets the CSS font-weight, updates the rule, and recalculates preferred size.
     *
     * @param value - A CSS font-weight value (e.g. "normal", "bold", "700").
     *
     * @returns This component, for method chaining.
     */
    setFontWeight(value: string): this {
        this._options.fontWeight = value;

        this.setElementCSSRule("fontWeight", value);

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the line height in pixels, or null if not set.
     *
     * @returns The line height as a number, or null if not set.
     */
    getLineHeight() {
        return (this._options.lineHeight as number | undefined) ?? (this._defaultOptions.lineHeight as number | undefined) ?? null;
    }

    /**
     * Sets the line height. Pass a number for an explicit fixed pixel value
     * (which stops tracking the theme — this is the per-control override of the
     * additive default), or a CSS variable name to bind the line box to a
     * custom token, resolved as a fixed line box for measurement.
     *
     * @param value - Pixel value as a number, or a CSS custom property name as a string.
     *
     * @returns This component, for method chaining.
     */
    setLineHeight(value: number | string): this {
        if (typeof value === 'number') {
            this._options.lineHeight = value as TOptions["lineHeight"];
            this._lineHeightCSSVar    = null;
            this._lineHeightCSSRule   = null;
            this.setElementCSSRule("lineHeight", value + "px");
        } else {
            this._lineHeightCSSVar    = value;
            this._lineHeightCSSRule   = `var(${value}, ${ADDITIVE_LINE_HEIGHT_RULE})`;
            this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
            this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);
        }

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Sets the line-height equal to the given pixel height so a single-line
     * text sits vertically centred in a fixed-height inline box.
     *
     * @param px - Pixel value matching the container's height, or `null` to
     *             revert to the theme's additive line box (font size +
     *             `--ts-ui-line-padding`).
     *
     * @returns This component, for method chaining.
     *
     * @example
     * ```typescript
     * const label = new Text("File");
     * label.centerInHeight(28);
     * ```
     */
    centerInHeight(px: number | null): this {
        if (px === null) {
            this._lineHeightCSSVar   = null;
            this._lineHeightCSSRule  = ADDITIVE_LINE_HEIGHT_RULE;
            this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
            this.setElementCSSRule("lineHeight", this._lineHeightCSSRule);

            this._measurementDirty = true;
            (this.getParentComponent() ?? this).scheduleLayout();

            return this;
        }

        return this.setLineHeight(px);
    }

    /**
     * Returns the CSS text-overflow value last passed to {@link setTextOverflow},
     * or `null` if not set.
     *
     * @returns The text-overflow string, or null.
     */
    getTextOverflow(): string | null {
        return this._textOverflow;
    }

    /**
     * Sets the CSS text-overflow property and updates the component's CSS rule.
     *
     * @param value - A CSS text-overflow value (e.g. "clip", "ellipsis").
     *
     * @returns This component, for method chaining.
     */
    setTextOverflow(value: string): this {
        this._textOverflow = value;

        this.setElementCSSRule("textOverflow", value);

        return this;
    }

    /**
     * Removes the text-overflow CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearTextOverflow(): this {
        if (this._textOverflow === null) {
            return this;
        }

        this._textOverflow = null;
        this.setElementCSSRule("textOverflow", null);

        return this;
    }

    /**
     * Returns whether single-line truncation + ellipsis is enabled (default `true`).
     *
     * @returns `true` when the text clips with "…" once narrower than its
     *   natural width; `false` when the text refuses to shrink past its
     *   natural width.
     */
    isTruncate(): boolean {
        return this._truncate;
    }

    /**
     * Toggles single-line truncation mode. When `true`, the text renders as
     * single-line + `overflow: hidden` + `text-overflow: ellipsis` and reports
     * `minSize.width = Math.min(natural, 100)`. When `false`, those CSS
     * properties are cleared and the text reports its full natural width as
     * `minSize.width` so parent layouts widen to fit instead of clipping.
     *
     * @param value - `true` to enable ellipsised truncation, `false` to
     *   disable (the text expands to its natural width).
     *
     * @returns This component, for method chaining.
     */
    setTruncate(value: boolean): this {
        this._truncate = value;

        if (value) {
            this.setWhiteSpace("nowrap");
            this.setOverflow("hidden");
            this.setTextOverflow("ellipsis");
        } else {
            this.setElementCSSRule("whiteSpace",   null);
            this.setOverflow("visible");
            this.setElementCSSRule("textOverflow", null);
            this._textOverflow = null;
        }

        // The auto-min cap depends on `_truncate`; re-measure so the parent
        // layout sees the new floor on the next layout pass.
        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the current CSS `word-break` value, or null if not set.
     *
     * @returns The word-break string, or null.
     */
    getWordBreak(): string | null {
        return this._wordBreak;
    }

    /**
     * Sets the CSS `word-break` property on the component's CSS rule.
     *
     * @param value - A CSS word-break value (e.g. "break-word", "normal", "keep-all").
     *
     * @returns This component, for method chaining.
     */
    setWordBreak(value: string): this {
        if (this._wordBreak === value) {
            return this;
        }

        this._wordBreak = value;
        this.setElementCSSRule("wordBreak", value);

        return this;
    }

    /**
     * Returns the current line-clamp line count, or null if no clamp is applied.
     *
     * @returns The maximum line count, or null.
     */
    getLineClamp(): number | null {
        return this._lineClamp;
    }

    /**
     * Clamps the rendered text to a maximum line count via CSS line-clamp.
     *
     * Writes `display: -webkit-box`, `-webkit-box-orient: vertical`,
     * `-webkit-line-clamp`, `overflow: hidden`, and `text-overflow: ellipsis`
     * in a single call. Use {@link clearLineClamp} to remove the clamp.
     *
     * @param lines - The maximum number of lines to display before the ellipsis.
     *
     * @returns This component, for method chaining.
     */
    setLineClamp(lines: number): this {
        if (this._lineClamp === lines) {
            return this;
        }

        this._lineClamp = lines;
        this.setElementCSSRules({
            display: "-webkit-box",
            webkitBoxOrient: "vertical",
            webkitLineClamp: String(lines),
            overflow: "hidden",
            textOverflow: "ellipsis"
        });

        return this;
    }

    /**
     * Removes the line-clamp styling previously applied by {@link setLineClamp}.
     *
     * @returns This component, for method chaining.
     */
    clearLineClamp(): this {
        if (this._lineClamp === null) {
            return this;
        }

        this._lineClamp = null;
        this.setElementCSSRules({
            display: null,
            webkitBoxOrient: null,
            webkitLineClamp: null,
            overflow: null,
            textOverflow: null
        });

        return this;
    }

    /**
     * Applies all text-specific style properties to the element's CSS rule in addition to base styles.
     *
     * @param element - The HTMLElement to apply styles to.
     */
    applyStyle(element: HTMLElement): this {
        super.applyStyle(element);

        const fontSize   = this.getFontSize();
        const lineHeight = this.getLineHeight();

        this.setElementCSSRules({
            fontFamily:     this.getFontFamily()    ?? '',
            textAlign:      this.getTextAlign()     ?? '',
            textShadow:     this.getTextShadow()    ?? '',
            fontKerning:    this.getFontKerning()   ?? '',
            fontSize:       this._fontSizeCSSRule    ?? (fontSize !== null ? `${fontSize}px` : ''),
            fontSizeAdjust: this.getFontSizeAdjust() ?? '',
            fontStretch:    this.getFontStretch()   ?? '',
            fontStyle:      this.getFontStyle()     ?? '',
            fontVariant:    this.getFontVariant()   ?? '',
            fontWeight:     this.getFontWeight()    ?? '',
            lineHeight:     this._lineHeightCSSRule  ?? (lineHeight !== null ? `${lineHeight}px` : '')
        });

        return this;
    }

    /**
     * Removes the theme-change listener. Call when the component is permanently removed.
     */
    dispose() {
        this._unsubscribeTheme();
    }

    /**
     * Renders the element and sets its text content.
     *
     * @returns The created element with textContent initialised.
     */
    protected render() {
        let element = super.render();

        element.textContent = this.getText().valueOf();

        return element;
    }
}

const TextCallable = callable(Text);
type TextCallable<TOptions extends TextOptions = TextOptions> = Text<TOptions>;
export {
    Text         as _Text,
    TextCallable as Text
};
