// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Util } from "~/core/Util.js";
import type { TextMetrics } from "~/core/Util.js";
import { Size } from "~/primitive/Size.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";

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
 * `lineHeight` is intentionally **omitted**: it is theme-derived
 * (`readThemeLineHeightPx()`), so its getter falls back to that resolver
 * directly rather than a value seeded here.
 *
 * `fontFamily` is a pure getter-fallback despite living in this bag:
 * `_defaultOptions.fontFamily` is consulted by `getFontFamily()`, but is
 * never dispatched through `setFontFamily(...)` — this is what lets an
 * instance with no override skip its `#id` write entirely and resolve
 * `font-family` from `.Text`'s class rule instead, which a higher- or
 * equal-specificity consumer selector can still beat.
 */
const _defaultTextOptions: Partial<TextOptions> = {
    tag:            "span",
    textAlign:      "left",
    fontFamily:     "var(--ts-ui-font-family, system-ui, sans-serif)",
    fontKerning:    "auto",
    fontSize:       14,
    fontSizeAdjust: "none",
    fontStretch:    "normal",
    fontStyle:      "normal",
    fontVariant:    "normal",
    fontWeight:     "normal",
    truncate:       true,
};

/**
 * Registry of `WeakRef<Text>` for every live instance, walked by the batched
 * measurement below so one DOM flush can serve every stale Text at once.
 * `WeakRef` keeps an undisposed Text collectable; dead references are pruned
 * as the walk finds them. Mirrors `Glyph.ts`'s animated-instance registry.
 */
const _measurableRefs: Set<WeakRef<Text>> = new Set();

// Guards against a nested batch: the wrap-aware re-measure inside
// `applyNaturalMetrics` probes the DOM again, and must not restart the walk.
let _batching = false;

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

// Default theme-tracking font-size rule, bound to the base `--ts-ui-font-size`
// var with a 14px fallback. Shared between `_fontSizeCSSRule`'s field
// initializer and `getClassStyleDefaults()` so the two can never drift apart.
const DEFAULT_FONT_SIZE_RULE = "var(--ts-ui-font-size, 14px)";

/**
 * A text-displaying component with comprehensive font and layout controls.
 *
 * Uses an off-screen probe element to measure text dimensions and automatically
 * updates the preferred size whenever the text or a font property changes.
 *
 * @category Components
 */
class Text<TOptions extends TextOptions = TextOptions> extends Component<TOptions> {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md. `_defaultTextOptions`
    // carries no non-font `StyleBag` field (no class in this file
    // defaults `cursor`/`userSelect`/etc.; `SelectableText`/`Link` set those
    // per-subclass instead), so this class's own contribution is the `font`
    // sub-bag alone — the same values `getClassStyleDefaults()` below
    // resolves, kept as one source so the two can never drift apart (the
    // hierarchy walk's static resolution and the per-instance override must
    // agree for every participating class — see the plan's Internal
    // Structure).
    protected static readonly ownClassStyleDefaults: StyleBag = {
        font: {
            fontFamily:     _defaultTextOptions.fontFamily     ?? null,
            fontKerning:    _defaultTextOptions.fontKerning    ?? null,
            fontSize:       DEFAULT_FONT_SIZE_RULE,
            fontSizeAdjust: _defaultTextOptions.fontSizeAdjust ?? null,
            fontStretch:    _defaultTextOptions.fontStretch    ?? null,
            fontStyle:      _defaultTextOptions.fontStyle      ?? null,
            fontVariant:    _defaultTextOptions.fontVariant    ?? null,
            fontWeight:     _defaultTextOptions.fontWeight     ?? null,
            textAlign:      _defaultTextOptions.textAlign      ?? null,
            textShadow:     _defaultTextOptions.textShadow     ?? null,
            lineHeight:     ADDITIVE_LINE_HEIGHT_RULE,
            textOverflow:   (_defaultTextOptions.truncate ?? true) ? "ellipsis" : null,
        },
    };

    private _hasExplicitPreferredSize: boolean = false;
    private _fontSizeCSSVar : string | null = "--ts-ui-font-size";
    private _fontSizeCSSRule: string | null = DEFAULT_FONT_SIZE_RULE;
    private _lineHeightCSSVar : string | null = null;
    private _lineHeightCSSRule: string | null = ADDITIVE_LINE_HEIGHT_RULE;
    private _measuredBaseline: number | null = null;
    private _measuredMinSize: Size | null = null;
    private _autoMeasure: boolean = true;
    private _measurementDirty: boolean = true;
    // The `Util.textMetricsGeneration()` value as of the last `calculateSize`,
    // so a theme change (which bumps the generation) is noticed lazily by
    // `needsMeasure()` without Text holding its own theme subscription. `-1`
    // never matches a real generation, so an unmeasured Text is always due.
    private _measuredGeneration: number = -1;
    private _wordBreak: string | null = null;
    private _lineClamp: number | null = null;
    // Registered in the constructor, dropped in destructor(). Held so teardown
    // can remove this exact entry rather than searching the set.
    private readonly _measureRef: WeakRef<Text> = new WeakRef(this);

    // `NoInfer` on `options` keeps a partial options literal from narrowing
    // TOptions to just the keys it carries: `new Text("x", { fontWeight: "600" })`
    // must stay a `Text<TextOptions>` (assignable to Component), not a
    // `Text<{ fontWeight: string }>` (whose narrowed option type is not). Subclasses
    // still fix TOptions through `extends Text<MyOptions>`, not argument inference.
    constructor(text?: String, options?: NoInfer<TOptions>, subclassDefaults?: Partial<TOptions>) {
        super(
            options,
            { ..._defaultTextOptions, ...(subclassDefaults ?? {}) } as Partial<TOptions>,
        );

        this.clearInsets();

        // `fontSize`/`lineHeight` are dispatched here, in the constructor
        // body, rather than from `applyOptions` (see the comment there) —
        // this class's own field initializers just above (`_fontSizeCSSVar`/
        // `_fontSizeCSSRule`/`_lineHeightCSSVar`/`_lineHeightCSSRule`) have
        // already run by this point, so `setFontSize`/`setLineHeight` writing
        // those fields here is the value that sticks, per
        // CODE_CONVENTIONS.md's "Fields written during the `super()` cascade
        // must use `declare`" — deferred-dispatch half of that rule.
        if (options?.fontSize !== undefined) {
            this.setFontSize(options.fontSize);
        }

        if (options?.lineHeight !== undefined) {
            this.setLineHeight(options.lineHeight);
        } else {
            // No explicit override: this instance stays in `setLineHeight`'s
            // default var-bound/theme-tracking mode (`_lineHeightCSSRule`'s
            // own field initializer, above, already reflects that), but
            // nothing has told the instance layer yet — `setLineHeight`'s
            // var-bound branch is the only other writer, and it never runs
            // for an instance that never calls it. Establishing it here
            // (matching the class tier's own default 1:1) is what lets
            // `flushStyleBag` queue the harmless matching-null removal a
            // materialised `#id` rule needs to stay comprehensive (see
            // Expected Behaviour and `TextClassStyleHoisting.test.ts`'s
            // Legend row) — the same "always assert something" guarantee
            // `applySubclassStyles`'s retired lineHeight branch gave
            // unconditionally, now scoped to just this one case.
            this.writeStyle({ font: { lineHeight: this._lineHeightCSSRule } });
        }

        // Positional `text` constructor argument: write to the bag only when
        // the caller didn't also pass `options.text` (which would have been
        // dispatched via super's applyOptions cascade and should win).
        if (text !== undefined && this._options.text === undefined) {
            this.setText(text);
        }

        // Off-screen text measurement is deferred until the first
        // getPreferredSize / getBaseline call so construction stays JS-only
        // (no forced layout from `DOM.source.measureText`).
        this._measurementDirty = true;

        _measurableRefs.add(this._measureRef);
    }

    /**
     * Deregisters this instance from the batched-measurement registry before
     * the rest of the teardown runs.
     */
    protected destructor(): void {
        _measurableRefs.delete(this._measureRef);
        super.destructor();
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

        // Dispatch only caller-supplied values. Class-level font defaults (e.g.
        // the 14px size, a subclass's bold weight) are resolved lazily by the
        // font getters' `_defaultOptions` fallback, which `applyStyle` re-reads
        // at render — so they never enter `_options`.
        //
        // `fontSize`/`lineHeight` are deliberately NOT dispatched here, unlike
        // every other option in this method — see CODE_CONVENTIONS.md's
        // "Fields written during the `super()` cascade must use `declare`".
        // `setFontSize`/`setLineHeight` write `_fontSizeCSSVar`/
        // `_fontSizeCSSRule`/`_lineHeightCSSVar`/`_lineHeightCSSRule`, which
        // this class's own field initializers (real var-binding defaults, not
        // `declare`-able) would silently revert if the setter ran during this
        // cascade. The constructor body dispatches both, once, after those
        // field initializers have already run.
        if (options.text !== undefined) {
            this.setText(options.text);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.textShadow !== undefined) {
            this.setTextShadow(options.textShadow);
        }

        if (options.fontFamily !== undefined) {
            this.setFontFamily(options.fontFamily);
        }

        if (options.fontWeight !== undefined) {
            this.setFontWeight(options.fontWeight);
        }

        if (options.fontStyle !== undefined) {
            this.setFontStyle(options.fontStyle);
        }

        if (options.fontVariant !== undefined) {
            this.setFontVariant(options.fontVariant);
        }

        if (options.fontStretch !== undefined) {
            this.setFontStretch(options.fontStretch);
        }

        if (options.fontKerning !== undefined) {
            this.setFontKerning(options.fontKerning);
        }

        if (options.fontSizeAdjust !== undefined) {
            this.setFontSizeAdjust(options.fontSizeAdjust);
        }

        if (options.textOverflow !== undefined) {
            this.setTextOverflow(options.textOverflow);
        }

        if (options.whiteSpace !== undefined) {
            this.setWhiteSpace(options.whiteSpace);
        }

        // Unlike every option above, this can't be gated on `options.truncate
        // !== undefined`: `setTruncate` also drives `whiteSpace`/`overflow`,
        // and those two — unlike `textOverflow` (see `getTextOverflow`,
        // folded into `applyStyle` below) — have no truncate-aware fallback
        // in their own render-time recompute (Component's `applyMiscInlineStyles`
        // / `applyOverflowStyles` only ever see a value once a setter has
        // actually run). So the resolved value — explicit or default — must
        // always dispatch, or a default-truncating Text never gets this CSS.
        this.setTruncate(options.truncate ?? this._defaultOptions.truncate!);

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
        // `_options.fontSize` is the resolved px the bound var evaluates to —
        // `setFontSize`/`onThemeChange` populate it through the probe-backed
        // `resolveBoundFontSizePx`, so it is correct even pre-attach (a calc()
        // token included). No element read here: a parent reads this at
        // construction, before this Text's own element is styled.
        const fs = (this._options.fontSize as number | undefined) ?? (this._defaultOptions.fontSize as number | undefined) ?? 14;

        if (this._lineHeightCSSVar) {
            const raw    = DOM.source.getThemeVar(this._lineHeightCSSVar);
            const parsed = parseFloat(raw);

            if (!isNaN(parsed)) {
                return parsed;
            }
        }

        return Util.lineHeightPx({ fontSizePx: fs });
    }

    /**
     * Returns the DOM element handle.
     *
     * @param createIfMissing - Optional. When true, renders the element if it does not yet exist.
     *
     * @returns The component's element handle.
     */
    getElement(createIfMissing: boolean = false): Handle | undefined {
        return super.getElement(createIfMissing);
    }

    /**
     * Resolves the bound font-size var to a px number. A simple var (e.g. the
     * `--ts-ui-font-size` base) parses straight off the document root; a relative
     * font token's var holds a `calc(...)` that `getPropertyValue` returns
     * unevaluated (so `parseFloat` reads `NaN`), so it falls back to a
     * cascade-evaluating probe via `DOM.source.resolveFontSizePx`. The probe path
     * works **pre-attach** — before this component's own element is styled —
     * which is when a parent (e.g. a `Header`) first reads the line-box size.
     *
     * @returns The resolved font size in px, or `null` when no var is bound (an
     *   explicit numeric size was set instead) — callers keep the cached number.
     */
    private resolveBoundFontSizePx(): number | null {
        if (!this._fontSizeCSSVar) return null;   // explicit px size — no var bound

        return Util.boundFontSizePx(this._fontSizeCSSVar, this._fontSizeCSSRule);
    }

    /**
     * Sets the preferred size from an explicit caller, locking it against automatic recalculation.
     *
     * @param size - The preferred size in pixels.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(size: Size): this {
        this._hasExplicitPreferredSize = true;
        super.setPreferredSize(size);

        return this;
    }

    /**
     * Updates the preferred size from a measurement only when no explicit size has been set.
     */
    private setCalculatedSize(width: number, height: number): void {
        if (!this._hasExplicitPreferredSize) {
            super.setPreferredSize({ width: width, height: height });
        }
    }

    /**
     * Folds a natural (single-line) measurement into preferred size, baseline and
     * minimum floor, and marks this Text measured. The tail of the old
     * `calculateSize` body, shared by the solo and batched paths.
     *
     * @param natural - The natural (single-line) measurement to fold in.
     */
    private applyNaturalMetrics(natural: TextMetrics): void {
        this._measurementDirty   = false;
        this._measuredGeneration = Util.textMetricsGeneration();

        const text = this._options.text!.toString();

        // Floor the reported minimum height to one line so a single-line label
        // is never squeezed below its line box (the measured height is 0 for
        // empty text and unset before the first probe).
        const minLineHeight = Math.ceil(this.getLineHeight() ?? this.readThemeLineHeightPx());

        // Natural (single-line) measurement establishes the preferred WIDTH
        // and the baseline; the height then follows the box's current width,
        // growing when a wrapping run has been laid out narrower than natural.
        const height = this.measuredHeight(text, natural.width, natural.height);

        this._measuredBaseline = natural.baseline;
        this.setCalculatedSize(natural.width, height);
        // Store the measured floor as per-instance derived state (like
        // `_measuredBaseline`), kept out of `_defaultOptions`, which holds
        // the class-level Text defaults rather than per-instance
        // measurements. `getMinSize` folds this into the inherited min.
        // When truncation is disabled, report the full natural width so the
        // parent layout widens to fit instead of squeezing the text;
        // otherwise cap it so the parent can shrink the text past its
        // natural width.
        const autoMinWidth = this.isTruncate()
            ? Math.min(natural.width, TEXT_AUTO_MIN_WIDTH_CAP_PX)
            : natural.width;
        this._measuredMinSize = {
            width:  autoMinWidth,
            height: Math.max(height, minLineHeight),
        };
    }

    /** Whether this Text would issue its own natural-measurement probe now. */
    private wantsBatchedMeasure(): boolean {
        return this._autoMeasure && this.needsMeasure() && !!this._options.text;
    }

    /**
     * Measures `initiator` together with every other stale Text in one DOM flush.
     * A `private static` (rather than a module function) so it can read the other
     * instances' private `measureOptions()` and `_options`.
     *
     * @param initiator - The `Text` whose own measurement triggered the batch.
     */
    private static batchMeasure(initiator: Text): void {
        if (_batching) {
            return;
        }

        const pending: Text[] = [initiator];

        for (const ref of Array.from(_measurableRefs)) {
            const candidate = ref.deref();

            if (!candidate) {
                _measurableRefs.delete(ref);
                continue;
            }

            if (candidate !== initiator && candidate.wantsBatchedMeasure()) {
                pending.push(candidate);
            }
        }

        // Only the initiator is stale — batching would cost a wrapper element
        // to save nothing. Fall through to its own single probe.
        if (pending.length < 2) {
            return;
        }

        _batching = true;

        try {
            // Build every request before issuing the call — a `measureOptions()`
            // that resolves a bound font-size var can itself probe the DOM, and
            // those probes must all land before the batched read, not between
            // its rectangle reads.
            const metrics = DOM.source.measureTexts(
                pending.map(participant => ({
                    text:    participant._options.text!.toString(),
                    options: participant.measureOptions(),
                })),
            );

            pending.forEach((participant, i) => participant.applyNaturalMetrics(metrics[i]));
        } finally {
            _batching = false;
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
        if (this.wantsBatchedMeasure()) {
            Text.batchMeasure(this);

            // The batch measured this Text — it is no longer stale, and
            // `applyNaturalMetrics` already wrote every derived field.
            if (!this.needsMeasure()) {
                return;
            }
        }

        this._measurementDirty    = false;
        this._measuredGeneration  = Util.textMetricsGeneration();

        if (!this._autoMeasure) {
            return;
        }

        const text = this._options.text;
        if (text) {
            this.applyNaturalMetrics(DOM.source.measureText(text.toString(), this.measureOptions()));
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
     * Whether the cached measurement is stale — either because something
     * marked it dirty (a text/font change) or because the active theme's
     * text metrics have moved on since the last measurement.
     *
     * @returns `true` when the next size/baseline read should re-measure.
     *
     * @remarks Replaces a per-instance `ThemeManager` subscription: instead of
     * every `Text` re-measuring eagerly on each theme change, it compares its
     * own `_measuredGeneration` against `Util.textMetricsGeneration()` lazily,
     * the next time a caller actually asks for a size.
     */
    private needsMeasure(): boolean {
        return this._measurementDirty || this._measuredGeneration !== Util.textMetricsGeneration();
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
        if (this.needsMeasure()) {
            this.calculateSize();
        }

        return this.wrapInnerBaseline(this._measuredBaseline);
    }

    /**
     * Builds the font/line-height option bag for a {@link DOM.measureText} probe
     * from this Text's resolved styling. Shared by the natural (single-line)
     * measurement and the wrap-aware height re-measurement in
     * {@link measuredHeight}, which adds a `maxWidth`.
     *
     * @returns The measure options (font family/size/weight/style/variant/stretch
     *   and line height), each `undefined` when unset so the probe's own default
     *   applies.
     */
    private measureOptions() {
        const fontSize   = this.getFontSize();
        const lineHeight = this.getLineHeight();

        return {
            fontFamily : this.getFontFamily()  ?? undefined,
            fontSize   : this._fontSizeCSSRule ?? (fontSize !== null ? `${fontSize}px` : undefined),
            fontWeight : this.getFontWeight()  ?? undefined,
            fontStyle  : this.getFontStyle()   ?? undefined,
            fontVariant: this.getFontVariant() ?? undefined,
            fontStretch: this.getFontStretch() ?? undefined,
            lineHeight : this._lineHeightCSSRule ?? (lineHeight !== null ? `${lineHeight}px` : undefined),
        };
    }

    /**
     * Whether this Text wraps onto multiple lines — i.e. its `white-space` is a
     * wrapping value rather than `nowrap`/`pre`. Only a wrapping Text's height
     * depends on the width it is given.
     *
     * @returns `true` when the text soft-wraps at its box width.
     */
    private isWrapping(): boolean {
        const ws = this.getWhiteSpace();

        return ws === "normal" || ws === "pre-wrap" || ws === "pre-line" || ws === "break-spaces";
    }

    /**
     * The height the text needs given its current laid-out width.
     *
     * A `nowrap` label — or one not yet given a width, or in a vertical writing
     * mode — is width-independent, so its natural single-line height stands. A
     * wrapping label whose box is narrower than its natural run re-measures at
     * the current inner width (its own border/insets removed): the extra lines
     * make it taller. The re-measure uses the same line-height as the render, so
     * the reported height matches what is drawn — line-height is the per-line
     * unit the whole calculation stacks.
     *
     * @param text - The text run being measured.
     * @param naturalWidth - The natural single-line width (nowrap), the wrap threshold.
     * @param naturalHeight - The natural single-line height, used when it does not wrap.
     * @returns The height (px) at the current width; floored at one line.
     */
    private measuredHeight(text: string, naturalWidth: number, naturalHeight: number): number {
        if (!this.isWrapping() || this.isVerticalWritingMode()) {
            return naturalHeight;
        }

        const width = this.getWidth();

        if (Number.isNaN(width)) {
            return naturalHeight;
        }

        const perimeter  = this.getPerimeterSize();
        const innerWidth = width - perimeter.left - perimeter.right;

        // Wide enough for the whole run on one line → no wrapping; keep the exact
        // single-line height and skip a redundant probe.
        if (innerWidth >= naturalWidth) {
            return naturalHeight;
        }

        const wrapped       = DOM.source.measureText(text, { ...this.measureOptions(), maxWidth: innerWidth });
        const minLineHeight = Math.ceil(this.getLineHeight() ?? this.readThemeLineHeightPx());

        return Math.max(wrapped.height, minLineHeight);
    }

    /**
     * Sets the laid-out width and, for a wrapping Text, re-measures at the new
     * width so its preferred height tracks the number of wrapped lines.
     *
     * A wrapping run's height depends on the width it is given, but the
     * preferred-size protocol resolves heights bottom-up before widths are
     * assigned top-down — so the height is only knowable once the box has a
     * width. Re-measuring here updates the preferred height, and
     * `Component.setPreferredSize` fires the ancestor notify, so the parent
     * re-lays-out one pass later at the taller height (the box's own min height
     * also rises, so the current pass already reserves the room rather than
     * clipping). A `nowrap` label's height is width-independent, so its width
     * changes need no re-measure. Idempotent once the width settles: an
     * unchanged width re-measures to the same height and the notify is suppressed.
     *
     * @param width - The new outer width in pixels.
     * @returns This component, for chaining.
     */
    override setWidth(width: number): this {
        const previous = this.getWidth();

        super.setWidth(width);

        if (this.isWrapping() && this.getWidth() !== previous) {
            this._measurementDirty = true;
            // Re-measure now (at the new width) so the updated preferred height
            // propagates before the next layout pass reads it.
            this.calculateSize();
        }

        return this;
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
        if (this.needsMeasure()) {
            this.calculateSize();
        }

        const size = super.getPreferredSize();

        // `measureTextMetrics` always measures the run horizontally. A vertical
        // writing mode rotates it onto the block axis, so the natural text length
        // becomes the height and the line box becomes the width — swap to report
        // the on-screen extents.
        if (size && this.isVerticalWritingMode()) {
            return { width: size.height, height: size.width };
        }

        return size;
    }

    /**
     * Whether the active {@link Component.setWritingMode | writing mode} rotates
     * the text run onto the block (vertical) axis, so the measured horizontal
     * extents must be swapped to describe the on-screen size.
     *
     * @returns `true` for a `vertical-*` or `sideways-*` writing mode.
     */
    private isVerticalWritingMode(): boolean {
        const mode = this.getWritingMode();

        return mode !== null && (mode.startsWith("vertical") || mode.startsWith("sideways"));
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
        if (this.needsMeasure()) {
            this.calculateSize();
        }

        const measured = this._measuredMinSize;
        const base     = super.getMinSize();

        if (!measured) {
            return base;
        }

        // Vertical writing mode: the one-line floor guards the line *thickness*,
        // which is now the width rather than the height (the length runs down the
        // block axis and stays freely compressible).
        if (this.isVerticalWritingMode()) {
            if (!base) {
                return { width: measured.height, height: 0 };
            }

            return {
                width:  Math.max(base.width, measured.height),
                height: base.height,
            };
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
     *
     * @remarks The layout schedule is skipped while {@link setAutoMeasure} is
     * `false`: `calculateSize` returns before touching the preferred size, the
     * minimum size, or the baseline in that mode, so the new text cannot move
     * anything the parent's layout reads and the scheduled pass would recompute
     * an identical rectangle. That case is the whole pooled-row rebind path —
     * every cell/list/tree renderer's `Text` opts out of auto-measure — where
     * one scroll tick would otherwise queue a next-frame layout for every
     * renderer it rebinds. See `CellRenderer.setValue`'s contract: "an
     * implementation that only writes text needs no layout". A renderer that
     * *does* need one (it swapped a child) lays itself out, and a caller that
     * needs a fresh measurement calls {@link measure}.
     */
    setText(text: String): this {
        this._options.text = (text || "") as TOptions["text"];

        this._measurementDirty = true;

        if (this._autoMeasure) {
            (this.getParentComponent() ?? this).scheduleLayout();
        }

        let element = this.getElement();
        if (!element) {
            return this;
        }

        DOM.sink.apply(element, { text: text.valueOf() });

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
        return this.resolveFontValue('textAlign');
    }

    /**
     * Sets the CSS text-align and updates the component's CSS rule.
     *
     * @param align - A CSS text-align value (e.g. "left", "center", "right").
     *
     * @returns This component, for method chaining.
     */
    setTextAlign(align: string): this {
        this.writeStyle({ font: { textAlign: align } });

        return this;
    }

    /**
     * Returns the CSS text-shadow value.
     *
     * @returns The CSS text-shadow string, or null if not set.
     */
    getTextShadow() {
        return this.resolveFontValue('textShadow');
    }

    /**
     * Sets the CSS text-shadow and updates the component's CSS rule.
     *
     * @param shadow - A CSS text-shadow value.
     *
     * @returns This component, for method chaining.
     */
    setTextShadow(shadow: string): this {
        this.writeStyle({ font: { textShadow: shadow } });

        return this;
    }

    /**
     * Removes the text-shadow CSS property from the component's CSS rule.
     *
     * @returns This component, for method chaining.
     */
    clearTextShadow(): this {
        if (this.instanceLayer().authored.font?.textShadow === undefined) {
            return this;
        }

        this.writeStyle({ font: { textShadow: null } });

        return this;
    }

    /**
     * Returns the CSS font-family value.
     *
     * @returns The CSS font-family string, or null if not set.
     */
    getFontFamily() {
        return this.resolveFontValue('fontFamily');
    }

    /**
     * Sets the CSS font-family, updates the rule, and recalculates preferred size.
     *
     * @param value - The CSS font-family string (e.g. "sans-serif", "'Arial', sans-serif").
     *
     * @returns This component, for method chaining.
     */
    setFontFamily(value: string): this {
        this.writeStyle({ font: { fontFamily: value } });

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
        return this.resolveFontValue('fontKerning');
    }

    /**
     * Sets the CSS font-kerning and updates the component's CSS rule.
     *
     * @param value - A CSS font-kerning value (e.g. "auto", "normal", "none").
     *
     * @returns This component, for method chaining.
     */
    setFontKerning(value: string): this {
        this.writeStyle({ font: { fontKerning: value } });

        return this;
    }

    /**
     * Returns the font size in pixels.
     *
     * @returns The font size as a number, or null if not set.
     *
     * @remarks When a CSS var is bound (the default), this re-resolves it
     * through `Util`'s theme-invalidated cache — so it tracks a theme change
     * live — rather than the caller/class fallback, which is a stale snapshot
     * of the last-resolved value.
     */
    getFontSize() {
        if (this._fontSizeCSSVar) {
            const resolved = this.resolveBoundFontSizePx();

            if (resolved !== null) {
                return resolved;
            }
        }

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
            this.writeStyle({ font: { fontSize: value + "px" } });
        } else {
            const fallbackPx      = (this.getFontSize() as number | undefined) ?? 14;
            this._fontSizeCSSVar  = value;
            this._fontSizeCSSRule = `var(${value}, ${fallbackPx}px)`;
            this.writeStyle({ font: { fontSize: this._fontSizeCSSRule } });

            // Cache the resolved px so line-box/baseline math has the real size
            // even pre-attach — resolveBoundFontSizePx probes the cascade for a
            // calc()-valued token rather than parseFloat-ing its raw var string.
            const resolved = this.resolveBoundFontSizePx();
            if (resolved !== null) {
                this._options.fontSize = resolved as TOptions["fontSize"];
            }
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
        return this.resolveFontValue('fontSizeAdjust');
    }

    /**
     * Sets the CSS font-size-adjust and updates the component's CSS rule.
     *
     * @param value - A CSS font-size-adjust value.
     *
     * @returns This component, for method chaining.
     */
    setFontSizeAdjust(value: string): this {
        this.writeStyle({ font: { fontSizeAdjust: value } });

        return this;
    }

    /**
     * Returns the CSS font-stretch value.
     *
     * @returns The CSS font-stretch string, or null if not set.
     */
    getFontStretch() {
        return this.resolveFontValue('fontStretch');
    }

    /**
     * Sets the CSS font-stretch and updates the component's CSS rule.
     *
     * @param value - A CSS font-stretch value (e.g. "normal", "condensed", "expanded").
     *
     * @returns This component, for method chaining.
     */
    setFontStretch(value: string): this {
        this.writeStyle({ font: { fontStretch: value } });

        return this;
    }

    /**
     * Returns the CSS font-style value (e.g. "normal", "italic").
     *
     * @returns The CSS font-style string, or null if not set.
     */
    getFontStyle() {
        return this.resolveFontValue('fontStyle');
    }

    /**
     * Sets the CSS font-style, updates the rule, and recalculates preferred size.
     *
     * @param value - A CSS font-style value (e.g. "normal", "italic", "oblique").
     *
     * @returns This component, for method chaining.
     */
    setFontStyle(value: string): this {
        this.writeStyle({ font: { fontStyle: value } });

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the CSS font-variant value.
     *
     * @returns The CSS font-variant string, or null if not set.
     */
    getFontVariant() {
        return this.resolveFontValue('fontVariant');
    }

    /**
     * Sets the CSS font-variant and updates the component's CSS rule.
     *
     * @param value - A CSS font-variant value (e.g. "normal", "small-caps").
     *
     * @returns This component, for method chaining.
     */
    setFontVariant(value: string): this {
        this.writeStyle({ font: { fontVariant: value } });

        return this;
    }

    /**
     * Returns the CSS font-weight value.
     *
     * @returns The CSS font-weight string, or null if not set.
     */
    getFontWeight() {
        return this.resolveFontValue('fontWeight');
    }

    /**
     * Sets the CSS font-weight, updates the rule, and recalculates preferred size.
     *
     * @param value - A CSS font-weight value (e.g. "normal", "bold", "700").
     *
     * @returns This component, for method chaining.
     */
    setFontWeight(value: string): this {
        this.writeStyle({ font: { fontWeight: value } });

        this._measurementDirty = true;
        (this.getParentComponent() ?? this).scheduleLayout();

        return this;
    }

    /**
     * Returns the line height in pixels.
     *
     * @returns The caller/setter value when one was set; otherwise the
     *   resolved additive line box (font size plus the theme's line padding).
     */
    getLineHeight() {
        return (this._options.lineHeight as number | undefined) ?? (this._defaultOptions.lineHeight as number | undefined) ?? this.readThemeLineHeightPx();
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
            // Idempotent re-apply: a no-op numeric line-height must not re-arm
            // the layout flush. CellRenderer.doLayout syncs the Text child's
            // line-height to the cell height on every pass; without this guard
            // that unconditional scheduleLayout below re-dirtied the renderer
            // each frame, spinning a silent CPU-pinning relayout loop. Only skip
            // when already in pure-numeric mode with the same value (the initial
            // additive-rule state has a non-null _lineHeightCSSRule, so the first
            // apply still runs). Mirrors the framework's "unchanged value → early
            // return before scheduleLayout" idiom (Card.setVisibleComponentId).
            if (this._options.lineHeight === value && this._lineHeightCSSVar === null && this._lineHeightCSSRule === null) {
                return this;
            }

            // A non-null _lineHeightCSSRule here means this call is entering
            // numeric-pixel mode from a mode whose own writes left a real
            // `font.lineHeight` declaration on the instance layer (CSS-var/
            // theme mode). That declaration's own #id write outranks the
            // shared `.ClassName.lh*` rule `setValueStyleState` below points
            // this instance at (a per-instance declaration always beats a
            // shared class-tier one), so it must be cleared, or #id's now-
            // orphaned real value keeps outranking it. Once already in
            // numeric mode (_lineHeightCSSRule already null), the instance
            // layer never carries a real lineHeight declaration to begin
            // with — never written there in the first place, precisely so a
            // same-mode value change (e.g. a row-height resize, the hot path
            // this whole mechanism exists for) needs no extra write here.
            const wasReconciledMode = this._lineHeightCSSRule !== null;

            this._options.lineHeight = value as TOptions["lineHeight"];
            this._lineHeightCSSVar    = null;
            this._lineHeightCSSRule   = null;

            if (wasReconciledMode) {
                this.writeStyle({ font: { lineHeight: null } });
            }

            this.setValueStyleState("lh", value + "px", { font: { lineHeight: value + "px" } });
        } else {
            this.clearValueStyleState("lh");
            this._lineHeightCSSVar    = value;
            this._lineHeightCSSRule   = `var(${value}, ${ADDITIVE_LINE_HEIGHT_RULE})`;
            this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
            this.writeStyle({ font: { lineHeight: this._lineHeightCSSRule } });
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
            this.clearValueStyleState("lh");
            this._lineHeightCSSVar   = null;
            this._lineHeightCSSRule  = ADDITIVE_LINE_HEIGHT_RULE;
            this._options.lineHeight = this.readThemeLineHeightPx() as TOptions["lineHeight"];
            this.writeStyle({ font: { lineHeight: this._lineHeightCSSRule } });

            this._measurementDirty = true;
            (this.getParentComponent() ?? this).scheduleLayout();

            return this;
        }

        return this.setLineHeight(px);
    }

    /**
     * Returns the effective CSS text-overflow value: an explicit override
     * from {@link setTextOverflow} (or the `textOverflow` constructor
     * option), or — when neither was given — the value implied by
     * {@link isTruncate}'s resolved default ("ellipsis" when truncating,
     * `null` otherwise). `setTruncate` (below) dispatches one of
     * {@link setTextOverflow}/{@link clearTextOverflow} unconditionally on
     * every call — including from `applyOptions`'s own unconditional
     * dispatch, which every construction reaches — so the instance layer
     * always carries a resolved value by the time this getter runs.
     *
     * @returns The text-overflow string, or null.
     */
    getTextOverflow(): string | null {
        return this.resolveFontValue('textOverflow');
    }

    /**
     * Sets the CSS text-overflow property and updates the component's CSS rule.
     *
     * @param value - A CSS text-overflow value (e.g. "clip", "ellipsis").
     *
     * @returns This component, for method chaining.
     */
    setTextOverflow(value: string): this {
        this.writeStyle({ font: { textOverflow: value } });

        return this;
    }

    /**
     * Reverts a per-instance `text-overflow` override to the value
     * {@link isTruncate} implies.
     *
     * @returns This component, for method chaining.
     *
     * @remarks When truncating, the resolved value ("ellipsis") is also the
     * class-tier default, so the plain `writeStyle` below is enough —
     * `flushStyleBag` turns the match into a harmless `null` removal itself.
     *
     * When not truncating, `getTextOverflow()`'s getter-facing `null` and
     * the CSS this instance needs diverge: `.Text`'s class rule carries a
     * non-null `text-overflow: ellipsis` for every current class (see
     * `Text.ownClassStyleDefaults`), so an *absent* `#id` declaration would
     * stop competing with the class rule rather than beating it, silently
     * resurfacing "ellipsis" instead of "no ellipsis" — the CSS initial
     * value `"clip"` is what actually wins. `writeStyle`'s generic
     * instance-vs-lower-layer dedup can't make that substitution on its
     * own, so the correction is written explicitly here too — needed for a
     * call reached with an element already attached, where `writeStyle`'s
     * own immediate flush (this same call) is the only flush that runs;
     * `applySubclassStyles`'s per-render hook covers the same correction
     * for a *pre*-render call, whose own flush is deferred to whatever
     * later render first materialises `#id`.
     */
    clearTextOverflow(): this {
        const truncating = this.isTruncate();

        this.writeStyle({ font: { textOverflow: truncating ? "ellipsis" : null } });

        if (!truncating) {
            this.writeGuardedCSSRule("textOverflow", this.matchesLowerTier("textOverflow", "clip") ? null : "clip");
        }

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
        return this._options.truncate ?? this._defaultOptions.truncate ?? true;
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
        this._options.truncate = value as TOptions["truncate"];

        if (value) {
            this.setWhiteSpace("nowrap");
            this.setOverflow("hidden");
            this.setTextOverflow("ellipsis");
        } else {
            this.setElementCSSRule("whiteSpace", null);
            this.setOverflow("visible");
            this.clearTextOverflow();
        }

        // The auto-min cap depends on the resolved truncate value; re-measure
        // so the parent layout sees the new floor on the next layout pass.
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
     *
     * @remarks `textOverflow` writes the resolved value (substituting `"clip"`
     * for `null`) rather than `null`, the same cascade hazard {@link clearTextOverflow}
     * and `applyStyle`'s own `textOverflow` write guard against: `.Text`'s
     * class rule carries a non-null `text-overflow: ellipsis`, so removing the
     * `#id` declaration would stop competing with the class rule rather than
     * beating it.
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
            textOverflow: this.getTextOverflow() ?? "clip"
        });

        return this;
    }

    /**
     * Supplies the class-level font/text defaults `ClassStyleRules.ts` cannot
     * see in `_defaultOptions`: `fontSize`/`lineHeight` resolve through private
     * derived fields (`_fontSizeCSSRule`, `_lineHeightCSSRule`), not the raw
     * numeric options, and `textOverflow` is pre-resolved from `truncate` here
     * rather than inside the generic resolver. Prefers `ownClassStyleDefaults`
     * off `this.constructor` (virtual dispatch) over the literal `Text`
     * class, so a subclass whose own bag is a *complete* font bag (e.g.
     * `NumberRendererText`, which spreads `Text.ownClassStyleDefaults.font`
     * and overrides just `textAlign`) is reflected here — `resolveFontValue`'s
     * pre-render "virtual layer" fallback (see `styleLayers`) reads straight
     * from this method's return value, with no hierarchy walk of its own the
     * way the CSS-rule side (`ensureClassStyleRule`, keyed off the `ctor`
     * argument `applyStyle` passes directly) already had. Falls back to
     * `Text`'s own bag for a subclass whose `ownClassStyleDefaults` carries
     * no `font` key at all (e.g. `SelectableText`, which only adds
     * `cursor`/`userSelect`) — `Text`'s complete font bag is what such a
     * subclass relies on inheriting.
     */
    protected getClassStyleDefaults(): StyleBag {
        return {
            ...super.getClassStyleDefaults(),
            font: (this.constructor as typeof Text).ownClassStyleDefaults.font ?? Text.ownClassStyleDefaults.font,
        };
    }

    /**
     * Re-asserts `textOverflow`'s CSS declaration on every render —
     * `flushStyleBag`'s generic per-key handling (which the other eleven
     * font/text properties fully rely on) always writes the *authored*
     * value it finds on the instance layer, but `textOverflow` is the one
     * property whose authored, getter-facing value (`null`, from
     * {@link clearTextOverflow} when not truncating) diverges from the CSS
     * declaration this instance actually needs (the CSS initial value
     * `"clip"`, not a bare removal — see `clearTextOverflow`'s own
     * comment). Running from this hook, not the setter itself, guarantees
     * the correction reaches `#id` regardless of how many renders separate
     * a pre-render `clearTextOverflow()` call (typically from `setTruncate`,
     * during construction) from the first one — `flushStyleBag`'s own
     * generic write for this same key, queued earlier in the same
     * `applyStyle` pass, would otherwise survive to `#id` untouched.
     */
    protected applySubclassStyles(): void {
        super.applySubclassStyles();

        const textOverflow = this.getTextOverflow() ?? "clip";
        this.writeGuardedCSSRule("textOverflow", this.matchesLowerTier("textOverflow", textOverflow) ? null : textOverflow);
    }

    /**
     * Renders the element and sets its text content. Also re-applies a
     * pending numeric-pixel value-class token for a `setLineHeight(px)` call
     * made before the element existed — mirrors `CheckboxBox.render()`'s
     * re-assert (see
     * plans/implemented/checkbox-radio-delegate-state-style-defaults.md).
     *
     * @returns The created element with textContent initialised.
     */
    protected render() {
        let element = super.render();

        DOM.sink.apply(element, { text: this.getText().valueOf() });

        const lineHeightToken = this.getValueStyleToken("lh");
        if (lineHeightToken) {
            DOM.sink.apply(element, { addClass: [lineHeightToken] });
        }

        return element;
    }
}

/** Empties the measurement registry. For the test harness only. @internal */
function _resetTextMeasurementRegistry(): void { _measurableRefs.clear(); }

/** Number of registered instances; for tests only. @internal */
function _textMeasurementRegistrySize(): number { return _measurableRefs.size; }

const TextCallable = callable(Text);
type TextCallable<TOptions extends TextOptions = TextOptions> = Text<TOptions>;
export {
    Text         as _Text,
    TextCallable as Text,
    _resetTextMeasurementRegistry,
    _textMeasurementRegistrySize,
};
