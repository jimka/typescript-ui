// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * Tagged union describing how a glyph is rendered.
 *
 * @remarks
 * - `kind: "svg"` entries supply a `viewBox` and an SVG `<path>` `d` attribute.
 *   The path data is mounted once into a shared hidden `<svg>` sprite and each
 *   Glyph instance references it via `<svg><use href="#..."/></svg>` so the
 *   path string is not duplicated in the DOM.
 * - `kind: "char"` entries carry a single Unicode character rendered inside a
 *   `<span>`; the character follows the inherited text colour.
 */
export type GlyphDef =
    | { kind: "svg",  viewBox: string; path: string }
    | { kind: "char", char: string };

/**
 * Curated registry of named glyphs.
 *
 * @remarks
 * Internal to the `component/display` bucket. Add a glyph by adding a property
 * to this frozen object; consumers reference glyphs by name through the
 * `Glyph` component.
 *
 * @internal
 */
export const Glyphs: Readonly<Record<string, GlyphDef>> = Object.freeze({
    times: {
        kind:    "svg",
        viewBox: "0 0 352 512",
        path:    "M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z"
    },
    "arrow-right": { kind: "char", char: "▶" },
    "arrow-down":  { kind: "char", char: "▼" }
});

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Prefix applied to every `<symbol>` id inside the sprite. A consumer-supplied
 * registry name `"times"` becomes the id `"ts-glyph-times"`, which is what
 * `<use href="#ts-glyph-times"/>` references.
 */
export const GLYPH_SYMBOL_ID_PREFIX = "ts-glyph-";

let spriteMounted: boolean = false;

/**
 * Ensures the document carries a single hidden `<svg>` sprite containing one
 * `<symbol>` per SVG-mode registry entry. Idempotent — subsequent calls are
 * no-ops.
 *
 * @remarks
 * Called lazily by the first SVG-mode `Glyph` to construct its element. The
 * sprite is mounted on `document.body`, hidden via inline style, and marked
 * `aria-hidden`. Each symbol's id is `GLYPH_SYMBOL_ID_PREFIX + name`, so a
 * Glyph instance only needs `<svg><use href="#ts-glyph-<name>"/></svg>` to
 * reuse the shared path data.
 *
 * @internal
 */
export function ensureGlyphSprite(): void {
    if (spriteMounted) {
        return;
    }

    const sprite = document.createElementNS(SVG_NS, "svg");
    sprite.setAttribute("aria-hidden", "true");
    sprite.setAttribute("focusable", "false");
    sprite.style.position = "absolute";
    sprite.style.width    = "0";
    sprite.style.height   = "0";
    sprite.style.overflow = "hidden";

    for (const name in Glyphs) {
        const def = Glyphs[name];
        if (def.kind !== "svg") {
            continue;
        }

        const symbol = document.createElementNS(SVG_NS, "symbol");
        symbol.setAttribute("id", GLYPH_SYMBOL_ID_PREFIX + name);
        symbol.setAttribute("viewBox", def.viewBox);

        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", def.path);
        symbol.appendChild(path);

        sprite.appendChild(symbol);
    }

    document.body.appendChild(sprite);

    spriteMounted = true;
}
