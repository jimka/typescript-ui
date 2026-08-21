// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Animation } from "~/core/Animation.js";
import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { callable } from "~/core/Callable.js";
import { Size } from "~/primitive/Size.js";
import {
    ensureGlyphSprite,
    ensureGlyphSymbolMounted,
    GLYPH_SYMBOL_ID_PREFIX,
    GlyphDef,
    lookupGlyph,
    NamedGlyphDef,
    registerGlyph,
    unregisterGlyph,
} from "~/component/display/Glyphs.js";

/**
 * Named animation kinds supported by {@link Glyph.setAnimated}.
 *
 * - `spin` — continuous 360 degree rotate. Loading and refresh affordances.
 * - `pulse` — 8-step rotate. Mechanical, faux-loading tick.
 * - `beat` — transform-scale pulse. Notification dots and attention nudges.
 *
 * Mirrors FontAwesome's `fa-spin` / `fa-pulse` / `fa-beat` vocabulary.
 *
 * @category Components
 */
export type GlyphAnimation = "spin" | "pulse" | "beat";

/**
 * CSS class prefix shared by all three animation rules. The full class name
 * is `ts-ui-glyph-<kind>` (e.g. `ts-ui-glyph-spin`).
 */
const CLASS_PREFIX = "ts-ui-glyph-";

/**
 * Registry of `WeakRef<Glyph>` for currently-animated instances. A single
 * module-level `matchMedia` listener walks this set on OS preference changes
 * and re-applies the class to match. `WeakRef` lets the GC collect unrooted
 * glyphs without an explicit deregister-on-disposal step.
 */
const _animatedRefs: Set<WeakRef<Glyph>> = new Set();

let _keyframesInjected = false;

/**
 * Injects the three `@keyframes` blocks and matching class rules on first
 * use. Idempotent — guarded by the module-level `_keyframesInjected` flag.
 */
function ensureGlyphKeyframes(): void {
    if (_keyframesInjected) {
        return;
    }

    _keyframesInjected = true;

    StyleRule.ensureKeyframes("ts-ui-glyph-spin",
        "from { transform: rotate(0deg); } to { transform: rotate(360deg); }");

    StyleRule.ensureKeyframes("ts-ui-glyph-pulse",
        "0%, 12.5%   { transform: rotate(0deg); }   " +
        "12.5%, 25%  { transform: rotate(45deg); }  " +
        "25%, 37.5%  { transform: rotate(90deg); }  " +
        "37.5%, 50%  { transform: rotate(135deg); } " +
        "50%, 62.5%  { transform: rotate(180deg); } " +
        "62.5%, 75%  { transform: rotate(225deg); } " +
        "75%, 87.5%  { transform: rotate(270deg); } " +
        "87.5%, 100% { transform: rotate(315deg); }");

    StyleRule.ensureKeyframes("ts-ui-glyph-beat",
        "0%, 90% { transform: scale(1); } 45% { transform: scale(1.25); }");

    new StyleRule({
        scope:  "class",
        name:   CLASS_PREFIX + "spin",
        styles: {
            animation: "ts-ui-glyph-spin var(--ts-ui-glyph-spin-duration, 2000ms) linear infinite",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   CLASS_PREFIX + "pulse",
        styles: {
            animation: "ts-ui-glyph-pulse var(--ts-ui-glyph-pulse-duration, 1000ms) steps(8) infinite",
        },
    });

    new StyleRule({
        scope:  "class",
        name:   CLASS_PREFIX + "beat",
        styles: {
            animation: "ts-ui-glyph-beat var(--ts-ui-glyph-beat-duration, 1000ms) ease-in-out infinite",
        },
    });
}

/**
 * Module-level listener that re-evaluates every animated glyph when the OS
 * `prefers-reduced-motion` preference flips. Dead `WeakRef`s are pruned.
 */
function _onReducedMotionChange(): void {
    for (const ref of Array.from(_animatedRefs)) {
        const glyph = ref.deref();
        if (!glyph) {
            _animatedRefs.delete(ref);
            continue;
        }

        glyph._syncReducedMotion();
    }
}

// The seam's `matchMedia` degrades to an inert result off-browser, so this
// module-level registration needs no environment guard of its own.
DOM.source.matchMedia("(prefers-reduced-motion: reduce)").addChangeListener(_onReducedMotionChange);

/**
 * Construction-time options for {@link Glyph}.
 *
 * @category Components
 */
export interface GlyphOptions extends ComponentOptions {

    /**
     * CSS `font-size` override in pixels. Only meaningful for char-mode
     * glyphs (SVG glyphs paint via `<use>` and ignore font-size). Useful when
     * the inherited font-size produces a line-box taller than the glyph's
     * element box and the Unicode character overflows or gets clipped.
     */
    fontSize?: number;

    /**
     * CSS `line-height` override. A number is interpreted as pixels (e.g.
     * `24` → `"24px"`); a string is used verbatim (e.g. `"1"` for the
     * unitless font-size multiplier used by char-mode glyphs).
     */
    lineHeight?: number | string;

    /**
     * CSS `text-align` keyword (e.g. `"left"`, `"center"`, `"right"`).
     * Char-mode glyphs default to `"center"`; SVG-mode glyphs leave this
     * unset.
     */
    textAlign?: string;

    /**
     * Optional animation kind to play on this glyph from construction.
     */
    animation?: GlyphAnimation;

    /**
     * Optional override (ms) for the active animation's duration. Wins over
     * the theme-token default while non-zero. Ignored when `animation` is
     * unset.
     */
    animationDuration?: number;
}

/**
 * User-overridable defaults forwarded to `super` via the options bag. The
 * cascade dispatches each present setter once with the final value. Only
 * defaults that apply unconditionally for every Glyph kind live here — the
 * char-only `lineHeight`/`textAlign` defaults stay in the constructor body
 * because they depend on the per-instance `def.kind`.
 */
// The size Glyph.applyOptions's re-pin always lands on when nothing
// overrides preferredSize. Declared once and reused for minSize/maxSize
// too, so the three fields below can never drift apart.
const GLYPH_DEFAULT_SIZE = { width: 16, height: 16 };

const _defaultGlyphOptions: Partial<GlyphOptions> = {
    preferredSize: GLYPH_DEFAULT_SIZE as GlyphOptions["preferredSize"],
    minSize:       GLYPH_DEFAULT_SIZE as GlyphOptions["minSize"],
    maxSize:       GLYPH_DEFAULT_SIZE as GlyphOptions["maxSize"],

    // Always an HTML element, both kinds. An SVG entry paints through an inner
    // `<svg>` rather than being one: Blink refuses to run a transform animation
    // on an SVG element on the compositor, so an `<svg>` root would force a
    // full-document Layerize pass on every frame the glyph animates.
    tag: "span",
};

/**
 * A small icon rendered from the internal `Glyphs` registry.
 *
 * @remarks
 * Each registry entry is either an SVG or a single Unicode character. The root
 * element is a `<span>` either way. An SVG entry hangs an inner
 * `<svg><use href="#…"/></svg>` inside that root, pointing at a hidden sprite
 * mounted once into `document.body`, so the path data lives in the DOM exactly
 * once regardless of how many Glyph instances reference it. A Unicode entry
 * writes its character into the root directly. Both forms render with
 * `currentColor`, so a `Glyph` inherits the surrounding text colour for free.
 * The registry name is fixed at construction and cannot be changed afterwards —
 * to swap glyph, discard the instance and create a new one.
 *
 * Pass any registry name to the constructor; unknown names throw at
 * construction. The default preferred size is 16×16.
 *
 * @example
 * ```typescript
 * import { xmark } from "~/glyphs/solid/xmark.js";
 * import { arrow_right } from "~/glyphs/solid/arrow_right.js";
 *
 * Glyph.register(xmark, arrow_right);
 *
 * panel.addComponent(new Glyph("xmark"));
 * panel.addComponent(new Glyph("arrow-right"));
 * ```
 *
 * @category Components
 */
class Glyph extends Component<GlyphOptions> {

    private _name:                   string;
    private _def:                    GlyphDef;
    declare private _glyphAnimation:         GlyphAnimation | null;
    declare private _glyphAnimationDuration: number;
    declare private _animatedRef:            WeakRef<Glyph> | null;

    /**
     * Registers one or more glyph definitions so they can be instantiated by
     * name. Pass the named exports from `~/glyphs/<style>/<name>.js` modules.
     *
     * @param defs - One or more {@link NamedGlyphDef} values to register.
     */
    static register(...defs: NamedGlyphDef[]): void {
        for (const def of defs) {
            registerGlyph(def);
        }
    }

    /**
     * Removes a previously registered glyph by name.
     *
     * @param name - Registry key to unregister.
     */
    static unregister(name: string): void {
        unregisterGlyph(name);
    }

    /**
     * Constructs a Glyph for the registry entry with the given name.
     *
     * @param name - Registry key. Must have been registered via {@link Glyph.register}.
     * @param options - Optional component options bag.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(name: string, options?: GlyphOptions, subclassDefaults?: Partial<GlyphOptions>) {
        const def = lookupGlyph(name);
        if (!def) {
            throw new Error("Unknown glyph: " + name);
        }

        // Hand the class defaults to Component via the subclass-defaults arg so
        // they land in `_defaultOptions`. Component's super-time cascade applies
        // them; user `options` win because `applyOptions` merges
        // `{...defaults, ...options}` at dispatch time.
        super(options, {
            ..._defaultGlyphOptions,
            ...(subclassDefaults ?? {}),
        });

        this._name = name;
        this._def  = def;

        // Char-mode glyphs need a line-height and text-align that SVG glyphs
        // should not get. Keep these guards in the constructor body since they
        // depend on per-instance `def.kind` rather than a static default.
        if (def.kind === "char") {
            if (this._options.lineHeight === undefined) {
                this.setLineHeight("1");
            }

            if (this._options.textAlign === undefined) {
                this.setTextAlign("center");
            }
        }
    }

    /**
     * Sets the preferred size and pins minSize/maxSize to the same value so
     * the glyph stays rigid in flexible layouts — HBox's shrink-on-overflow
     * logic and any grow path see equal min/pref/max and leave the glyph at
     * its configured size. Callers can still override the lock by calling
     * `setMinSize` / `setMaxSize` explicitly after this method.
     *
     * @param size - The preferred size in pixels.
     *
     * @returns This component, for method chaining.
     */
    setPreferredSize(size: Size): this {
        super.setPreferredSize(size);
        super.setMinSize(size);
        super.setMaxSize(size);

        return this;
    }

    /**
     * Returns a baseline near the bottom edge so the glyph participates in
     * baseline alignment — sitting with its ink roughly on the surrounding text
     * baseline when placed next to labels — instead of being vertically centred
     * in the row. The anchor is 4px above the bottom edge (vs 2px on the
     * bar-shaped controls), which drops a square icon slightly lower so its ink
     * lands on the text baseline rather than floating above it.
     *
     * @returns The preferred height minus 4, or `null` before a size is set.
     */
    getBaseline(): number | null {
        const size = this.getPreferredSize();

        return size ? size.height - 3 : null;
    }

    /**
     * Returns the registry name this Glyph was constructed with. Named
     * `getGlyphName` rather than `getName` so it does not shadow
     * [`Component.getName`](/api/core/classes/Component#getname), whose
     * intrinsic `name` is a display label with a different meaning.
     *
     * @returns The registry key supplied to the constructor.
     */
    getGlyphName(): string {
        return this._name;
    }

    /**
     * Returns the explicit CSS `font-size` override (in pixels) written by
     * this Glyph, or `null` when no override has been written (the element
     * inherits the parent's font-size).
     *
     * @returns The cached font-size in pixels, or null.
     */
    getFontSize(): number | null {
        return this._options.fontSize ?? null;
    }

    /**
     * Overrides the CSS `font-size` of this Glyph's root element. Useful when
     * the ambient inherited font-size produces a line-box taller than the
     * glyph's `preferredSize`, causing the Unicode character to overflow or
     * get clipped by the element's `overflow: hidden`. No-op visually for
     * SVG glyphs (which size via `viewBox`), but the rule is written regardless.
     *
     * @param value - The new font-size in pixels.
     * @returns This Glyph, for method chaining.
     */
    setFontSize(value: number): this {
        this._options.fontSize = value;
        this.setElementCSSRule("fontSize", value + "px");

        return this;
    }

    /**
     * Returns the current CSS `line-height` value written by this Glyph, or
     * `null` if no rule has been written (the element inherits the parent's
     * line-height).
     *
     * @returns The cached line-height CSS value (e.g. `"1"`, `"24px"`), or null.
     *
     * @remarks
     * Char-mode glyphs construct with `"1"`; SVG-mode glyphs default to null.
     * Use this getter rather than reading `element.style.lineHeight` to avoid
     * a forced style read.
     */
    getLineHeight(): string | null {
        const value = this._options.lineHeight;
        if (value === undefined) {
            return null;
        }

        return typeof value === "number" ? value + "px" : value;
    }

    /**
     * Overrides the CSS `line-height` of this Glyph's root element.
     *
     * @param value - Pixel number (e.g. `24` → `"24px"`) or a raw CSS
     *                line-height value (e.g. `"1"` for the unitless
     *                font-size multiplier used by char-mode glyphs).
     * @returns This Glyph, for method chaining.
     *
     * @remarks
     * Char-mode glyphs construct with `line-height: 1`, which keeps Unicode
     * characters like `▲` / `▼` snug against the top of their box. When a
     * Glyph is sized larger than its natural char height and needs to
     * vertically centre within that box, callers can match the line-height to
     * the element height to push the line-box to the middle. No-op visually
     * for SVG glyphs (which size via `viewBox`), but the rule is written
     * regardless.
     */
    setLineHeight(value: number | string): this {
        this._options.lineHeight = value;
        this.setElementCSSRule("lineHeight", typeof value === "number" ? value + "px" : value);

        return this;
    }

    /**
     * Returns the current CSS `text-align` value written by this Glyph, or
     * `null` if no rule has been written (the element inherits the parent's
     * text-align).
     *
     * @returns The cached text-align CSS value (e.g. `"center"`), or null.
     *
     * @remarks
     * Char-mode glyphs construct with `"center"` to keep the Unicode
     * character horizontally centred within its element box; SVG-mode glyphs
     * default to null. Use this getter rather than reading
     * `element.style.textAlign` to avoid a forced style read.
     */
    getTextAlign(): string | null {
        return this._options.textAlign ?? null;
    }

    /**
     * Overrides the CSS `text-align` of this Glyph's root element.
     *
     * @param value - A CSS `text-align` keyword such as `"left"`, `"center"`,
     *                `"right"`, `"start"`, or `"end"`.
     * @returns This Glyph, for method chaining.
     */
    setTextAlign(value: string): this {
        this._options.textAlign = value;
        this.setElementCSSRule("textAlign", value);

        return this;
    }

    /**
     * Returns the currently-playing animation kind, or `null` when none is
     * active.
     *
     * @returns The active {@link GlyphAnimation}, or `null`.
     */
    getAnimated(): GlyphAnimation | null {
        return this._glyphAnimation;
    }

    /**
     * Starts the named animation, or stops the current one when `kind` is
     * `null`. No-op when the requested kind already matches the current one.
     *
     * @param kind - A {@link GlyphAnimation} value or `null` to stop.
     * @returns This Glyph, for method chaining.
     *
     * @remarks
     * Adds the corresponding `ts-ui-glyph-<kind>` class to the root element,
     * which is an HTML `<span>` for every glyph kind so the browser can run the
     * `transform` keyframes on its compositor thread.
     * Honours [`Animation.isReducedMotion`](/api/core/namespaces/Animation/functions/isReducedMotion):
     * when reduced-motion is on, the class is not mounted but the requested
     * kind is cached and a module-level listener re-applies it should the OS
     * preference flip back.
     *
     * No `will-change` hint is set. The hint exists to pre-create a compositor
     * layer so the first frame of motion does not pay for the promotion, which
     * an infinite animation amortises to nothing — and glyphs are numerous
     * enough that hinting each one would push a page past the threshold where
     * browsers start ignoring the hint outright.
     *
     * Differs from the inherited `Component.setAnimation(value: string)`:
     * this is a typed-enum surface that toggles a pre-registered class rule;
     * the inherited setter accepts a raw CSS shorthand and writes a
     * per-component `#id { animation: … }` rule.
     *
     * @example
     * ```typescript
     * const g = new Glyph("xmark");
     * g.setAnimated("spin");
     * g.setAnimated(null); // stop
     * ```
     */
    setAnimated(kind: GlyphAnimation | null): this {
        if (this._glyphAnimation === kind) {
            return this;
        }

        const prev = this._glyphAnimation;
        this._glyphAnimation = kind;

        const el = this.getElement();

        if (el && prev) {
            DOM.sink.apply(el, { removeClass: [CLASS_PREFIX + prev] });
        }

        if (kind === null) {
            this.setElementCSSRule("animationDuration", null);

            if (this._animatedRef) {
                _animatedRefs.delete(this._animatedRef);
                this._animatedRef = null;
            }

            return this;
        }

        ensureGlyphKeyframes();

        if (!this._animatedRef) {
            this._animatedRef = new WeakRef(this);
            _animatedRefs.add(this._animatedRef);
        }

        if (!Animation.isReducedMotion() && el) {
            DOM.sink.apply(el, { addClass: [CLASS_PREFIX + kind] });
        }

        if (this._glyphAnimationDuration > 0) {
            this.setElementCSSRule("animationDuration", this._glyphAnimationDuration + "ms");
        }

        return this;
    }

    /**
     * Stops the current animation. Equivalent to `setAnimated(null)`.
     *
     * @returns This Glyph, for method chaining.
     */
    clearAnimated(): this {
        return this.setAnimated(null);
    }

    /**
     * Pauses this glyph's animation while it is not effectively visible, and
     * resumes it when it is shown again.
     *
     * The inherited implementation pauses only when
     * {@link Component.getAnimation} is non-null — that is, when the animation
     * was written into the component's own `#uuid` rule by
     * `Component.setAnimation`. A Glyph instead animates from a shared
     * `ts-ui-glyph-<kind>` class rule (one rule for every glyph of that kind,
     * rather than one per instance), so `getAnimation()` is always null here and
     * the base check cannot see the animation. Without this override an animated
     * glyph keeps consuming a compositor frame on every display refresh for as
     * long as the page lives, even on a hidden tab.
     *
     * @param effective - The component's new effective-visibility state.
     */
    protected onEffectiveVisibilityChange(effective: boolean): void {
        super.onEffectiveVisibilityChange(effective);

        // Loose comparison: `_glyphAnimation` is a `declare` field, so it has no
        // runtime initializer and reads as `undefined` — not its declared `null`
        // — on a glyph that was never animated. A strict `!== null` would treat
        // that as "animated" and park a play-state on every unanimated glyph.
        if (this._glyphAnimation != null) {
            this.setAnimationPlayState(effective ? null : "paused");
        }
    }

    /**
     * Returns the override duration (ms) set via {@link setAnimationDuration},
     * or `0` when no override is active. Read the active CSS custom property
     * (`--ts-ui-glyph-<kind>-duration`) for the live value when no override
     * is set.
     *
     * @returns The override duration in ms, or `0`.
     */
    getAnimationDuration(): number {
        return this._glyphAnimationDuration;
    }

    /**
     * Overrides the active animation's duration. Pass `0` to clear the
     * override and fall back to the theme-token default. No visible effect
     * when no animation is currently set, but the override is cached and
     * will apply on the next {@link setAnimated} call.
     *
     * @param ms - Duration in milliseconds, or `0` to clear.
     * @returns This Glyph, for method chaining.
     */
    setAnimationDuration(ms: number): this {
        this._glyphAnimationDuration = ms;

        // Loose comparison: `_glyphAnimation` is a `declare` field with no
        // runtime initializer, so it reads `undefined` — not its declared
        // `null` — on a glyph that was never animated. A strict `!== null`
        // treats that as "animated" and writes an orphan duration, which
        // `applyOptions` triggers whenever `animationDuration` is supplied
        // without `animation` (duration is dispatched first).
        if (this._glyphAnimation != null && !Animation.isReducedMotion()) {
            this.setElementCSSRule("animationDuration", ms > 0 ? ms + "ms" : null);
        }

        return this;
    }

    /**
     * Re-applies (or removes) the animation class to match the current
     * `prefers-reduced-motion` state. Called by the module-level listener
     * when the OS preference flips. Internal; not part of the public API.
     */
    _syncReducedMotion(): void {
        const kind = this._glyphAnimation;
        if (!kind) {
            return;
        }

        const element  = this.getElement(true)!;
        const className = CLASS_PREFIX + kind;

        if (Animation.isReducedMotion()) {
            DOM.sink.apply(element, { removeClass: [className] });
            this.setElementCSSRule("animationDuration", null);
        } else {
            DOM.sink.apply(element, { addClass: [className] });

            if (this._glyphAnimationDuration > 0) {
                this.setElementCSSRule("animationDuration", this._glyphAnimationDuration + "ms");
            }
        }
    }

    /**
     * Applies a {@link GlyphOptions} bag by dispatching each present field to
     * its corresponding setter.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This Glyph, for method chaining.
     */
    protected applyOptions(options: GlyphOptions): this {
        super.applyOptions(options);

        if (options.fontSize !== undefined) {
            this.setFontSize(options.fontSize);
        }

        if (options.lineHeight !== undefined) {
            this.setLineHeight(options.lineHeight);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        if (options.animationDuration !== undefined) {
            this.setAnimationDuration(options.animationDuration);
        }

        // Re-pin minSize / maxSize to the current preferred size so the glyph
        // stays rigid in flexible layouts. The inherited cascade has just
        // overwritten the pin from `setPreferredSize` with Component's `{0,0}`
        // minSize / `{MAX,MAX}` maxSize defaults; restore it here, but honour
        // an explicit `options.minSize` / `options.maxSize` from the caller.
        const pref = this.getPreferredSizeConstraint();
        if (pref) {
            if (options.minSize === undefined) {
                this.setMinSize({ width: pref.width, height: pref.height });
            }

            if (options.maxSize === undefined) {
                this.setMaxSize({ width: pref.width, height: pref.height });
            }
        }

        if (options.animation !== undefined) {
            this.setAnimated(options.animation);
        }

        return this;
    }

    /**
     * Creates the root element — always the inherited HTML `<span>`. An SVG
     * registry entry hangs a tracked `<svg><use/></svg>` inside it, referencing
     * a shared sprite symbol rather than inlining the path data.
     *
     * The `<svg>` is a child rather than the root so the animation class lands
     * on an HTML element: Blink will not run a transform animation on an SVG
     * element on the compositor, and an uncomposited glyph animation re-runs a
     * full-document `Layerize` pass every frame. Mirrors
     * {@link AbstractChart.createRootElement}'s raw-SVG-through-the-sink shape.
     *
     * @returns The root `<span>` element for this Glyph.
     */
    protected createRootElement(): Handle {
        const root = super.createRootElement();

        if (this._def.kind !== "svg") {
            return root;
        }

        ensureGlyphSprite();
        ensureGlyphSymbolMounted(this._name);

        const svgNs = "http://www.w3.org/2000/svg";
        const svg = DOM.sink.createElementNS(svgNs, "svg");

        // Fill the root's box. A replaced `<svg>` with no intrinsic size falls
        // back to the user agent's 300x150, which the root's `overflow: hidden`
        // would then clip; the percentages resolve against the inline width and
        // height `render` writes on the root.
        DOM.sink.apply(svg, {
            style:   { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", display: "block" },
            setAttr: { fill: "currentColor", "aria-hidden": "true", focusable: "false" },
        });

        const use = DOM.sink.createElementNS(svgNs, "use");
        DOM.sink.apply(use, { setAttr: { href: "#" + GLYPH_SYMBOL_ID_PREFIX + this._name } });
        DOM.sink.appendChild(svg, use);
        DOM.sink.appendChild(root, svg);

        // Track both raw children so they are released with the glyph (the root
        // is tracked by Component.render). Released on destructor or GC.
        this.trackHandle(svg);
        this.trackHandle(use);

        return root;
    }

    /**
     * Populates the rendered element. For char-mode glyphs the character is
     * written into the span's text content; SVG-mode element children are
     * created by `createRootElement`.
     *
     * Applies `preferredSize` as inline width/height so SVG glyphs appended
     * raw via `glyph.getElement(true)` outside a framework layout don't fall
     * back to the user-agent's 300×150 default replaced-element size.
     *
     * @returns The rendered root element.
     */
    protected render(): Handle {
        const element = super.render();

        if (this._def.kind === "char") {
            DOM.sink.apply(element, { text: this._def.char });
        }

        if (this._glyphAnimation && !Animation.isReducedMotion()) {
            DOM.sink.apply(element, { addClass: [CLASS_PREFIX + this._glyphAnimation] });
        }

        const preferredSize = this._options.preferredSize;
        if (preferredSize) {
            this.setElementStyle("width",  preferredSize.width  + "px");
            this.setElementStyle("height", preferredSize.height + "px");
        }

        return element;
    }
}

const GlyphCallable = callable(Glyph);
type GlyphCallable = Glyph;
export {
    Glyph         as _Glyph,
    GlyphCallable as Glyph
};
