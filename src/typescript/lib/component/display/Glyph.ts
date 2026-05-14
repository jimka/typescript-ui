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

    private _name: string;
    private _def:  GlyphDef;

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
            this.setElementCSSRule("lineHeight", "1");
            this.setElementCSSRule("textAlign", "center");
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
