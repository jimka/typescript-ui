// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { callable } from "~/core/Callable.js";
import { ensureGlyphSprite, GLYPH_SYMBOL_ID_PREFIX, Glyphs, GlyphDef } from "~/component/display/Glyphs.js";

/**
 * Construction-time options for {@link Glyph}.
 *
 * @category Components
 */
export interface GlyphOptions extends ComponentOptions {

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
}

/**
 * A small icon rendered from the internal `Glyphs` registry.
 *
 * @remarks
 * Each registry entry is either an SVG or a single Unicode character. SVG
 * entries are rendered as `<svg><use href="#…"/></svg>` against a hidden
 * sprite mounted once into `document.body`, so the path data lives in the
 * DOM exactly once regardless of how many Glyph instances reference it.
 * Unicode entries render as `<span>`. Both forms render with `currentColor`,
 * so a `Glyph` inherits the surrounding text colour for free. The underlying
 * root tag is decided once at construction from the entry's `kind` and
 * cannot be changed afterwards — to swap glyph, discard the instance and
 * create a new one.
 *
 * Pass any registry name to the constructor; unknown names throw at
 * construction. The default preferred size is 16×16.
 *
 * @example
 * ```typescript
 * panel.addComponent(new Glyph("times"));
 * panel.addComponent(new Glyph("arrow-right"));
 * ```
 *
 * @category Components
 */
class Glyph extends Component {

    private _name:       string;
    private _def:        GlyphDef;
    private _lineHeight: string | null = null;
    private _textAlign:  string | null = null;

    /**
     * Constructs a Glyph for the registry entry with the given name.
     *
     * @param name - Registry key. Must be present in `Glyphs`.
     * @param options - Optional component options bag.
     */
    constructor(name: string, options?: GlyphOptions) {
        const def = Glyphs[name];
        if (!def) {
            throw new Error("Unknown glyph: " + name);
        }

        super({ tag: def.kind === "svg" ? "svg" : "span" });

        this._name = name;
        this._def  = def;

        this.setPreferredSize(16, 16);

        if (def.kind === "char") {
            this.setLineHeight("1");
            this.setTextAlign("center");
        }

        if (this.constructor === Glyph && options) {
            this.applyOptions(options);
        }
    }

    /**
     * Returns the registry name this Glyph was constructed with.
     *
     * @returns The registry key supplied to the constructor.
     */
    getName(): string {
        return this._name;
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
        return this._lineHeight;
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
        this._lineHeight = typeof value === "number" ? value + "px" : value;
        this.setElementCSSRule("lineHeight", this._lineHeight);

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
        return this._textAlign;
    }

    /**
     * Overrides the CSS `text-align` of this Glyph's root element.
     *
     * @param value - A CSS `text-align` keyword such as `"left"`, `"center"`,
     *                `"right"`, `"start"`, or `"end"`.
     * @returns This Glyph, for method chaining.
     */
    setTextAlign(value: string): this {
        this._textAlign = value;
        this.setElementCSSRule("textAlign", this._textAlign);

        return this;
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

        if (options.lineHeight !== undefined) {
            this.setLineHeight(options.lineHeight);
        }

        if (options.textAlign !== undefined) {
            this.setTextAlign(options.textAlign);
        }

        return this;
    }

    /**
     * Creates the root element, using the SVG namespace when the registry
     * entry is an SVG definition. SVG instances reference a shared sprite
     * symbol rather than inlining the path data.
     *
     * @returns The root element for this Glyph (HTML `<span>` or SVG `<svg>`).
     */
    protected createRootElement(): HTMLElement {
        if (this._def.kind === "svg") {
            ensureGlyphSprite();

            const svgNs = "http://www.w3.org/2000/svg";
            const svg = document.createElementNS(svgNs, "svg");
            svg.setAttribute("fill", "currentColor");
            svg.setAttribute("aria-hidden", "true");
            svg.setAttribute("focusable", "false");

            const use = document.createElementNS(svgNs, "use");
            use.setAttribute("href", "#" + GLYPH_SYMBOL_ID_PREFIX + this._name);
            svg.appendChild(use);

            return svg as unknown as HTMLElement;
        }

        return super.createRootElement();
    }

    /**
     * Populates the rendered element. For char-mode glyphs the character is
     * written into the span's text content; SVG-mode element children are
     * created by `createRootElement`.
     *
     * @returns The rendered root element.
     */
    protected render(): HTMLElement {
        const element = super.render();

        if (this._def.kind === "char") {
            element.textContent = this._def.char;
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
