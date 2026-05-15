// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// SVG path data for individual entries below is sourced from third-party
// icon sets under their own licenses. See the project NOTICE file at the
// repository root for full attribution and license texts.
//
// Font Awesome Free (CC BY 4.0, https://fontawesome.com/license/free):
//   - angle-left           -> fontawesome/svgs/solid/angle-left.svg
//   - angle-right          -> fontawesome/svgs/solid/angle-right.svg
//   - angles-left          -> fontawesome/svgs/solid/angle-double-left.svg
//   - angles-right         -> fontawesome/svgs/solid/angle-double-right.svg
//   - ban                  -> fontawesome/svgs/solid/ban.svg
//   - check-circle         -> fontawesome/svgs/solid/check-circle.svg
//   - chevron-down         -> fontawesome/svgs/solid/chevron-down.svg
//   - chevron-up           -> fontawesome/svgs/solid/chevron-up.svg
//   - circle-exclamation   -> fontawesome/svgs/solid/exclamation-circle.svg
//   - eye                  -> fontawesome/svgs/solid/eye.svg
//   - file                 -> fontawesome/svgs/solid/file.svg
//   - info-circle          -> fontawesome/svgs/solid/info-circle.svg
//   - minus                -> fontawesome/svgs/solid/minus.svg
//   - pen-to-square        -> fontawesome/svgs/solid/edit.svg
//   - plus                 -> fontawesome/svgs/solid/plus.svg
//   - sync                 -> fontawesome/svgs/solid/sync.svg
//   - times                -> fontawesome/svgs/solid/times.svg
//   - triangle-exclamation -> fontawesome/svgs/solid/exclamation-triangle.svg
//   - window               -> fontawesome/svgs/solid/window-maximize.svg

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
    "angle-left": {
        kind:    "svg",
        viewBox: "0 0 256 512",
        path:    "M31.7 239l136-136c9.4-9.4 24.6-9.4 33.9 0l22.6 22.6c9.4 9.4 9.4 24.6 0 33.9L127.9 256l96.4 96.4c9.4 9.4 9.4 24.6 0 33.9L201.7 409c-9.4 9.4-24.6 9.4-33.9 0l-136-136c-9.5-9.4-9.5-24.6-.1-34z"
    },
    "angle-right": {
        kind:    "svg",
        viewBox: "0 0 256 512",
        path:    "M224.3 273l-136 136c-9.4 9.4-24.6 9.4-33.9 0l-22.6-22.6c-9.4-9.4-9.4-24.6 0-33.9l96.4-96.4-96.4-96.4c-9.4-9.4-9.4-24.6 0-33.9L54.3 103c9.4-9.4 24.6-9.4 33.9 0l136 136c9.5 9.4 9.5 24.6.1 34z"
    },
    "angles-left": {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M223.7 239l136-136c9.4-9.4 24.6-9.4 33.9 0l22.6 22.6c9.4 9.4 9.4 24.6 0 33.9L319.9 256l96.4 96.4c9.4 9.4 9.4 24.6 0 33.9L393.7 409c-9.4 9.4-24.6 9.4-33.9 0l-136-136c-9.5-9.4-9.5-24.6-.1-34zm-192 34l136 136c9.4 9.4 24.6 9.4 33.9 0l22.6-22.6c9.4-9.4 9.4-24.6 0-33.9L127.9 256l96.4-96.4c9.4-9.4 9.4-24.6 0-33.9L201.7 103c-9.4-9.4-24.6-9.4-33.9 0l-136 136c-9.5 9.4-9.5 24.6-.1 34z"
    },
    "angles-right": {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M224.3 273l-136 136c-9.4 9.4-24.6 9.4-33.9 0l-22.6-22.6c-9.4-9.4-9.4-24.6 0-33.9l96.4-96.4-96.4-96.4c-9.4-9.4-9.4-24.6 0-33.9L54.3 103c9.4-9.4 24.6-9.4 33.9 0l136 136c9.5 9.4 9.5 24.6.1 34zm192-34l-136-136c-9.4-9.4-24.6-9.4-33.9 0l-22.6 22.6c-9.4 9.4-9.4 24.6 0 33.9l96.4 96.4-96.4 96.4c-9.4 9.4-9.4 24.6 0 33.9l22.6 22.6c9.4 9.4 24.6 9.4 33.9 0l136-136c9.4-9.3 9.4-24.5 0-33.9z"
    },
    "arrow-down":  { kind: "char", char: "▼" },
    "arrow-right": { kind: "char", char: "▶" },
    ban: {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M256 8C119 8 8 119 8 256s111 248 248 248 248-111 248-248S393 8 256 8zm130.7 378.7c-69.8 69.8-179.9 74.3-255 14L370.7 131.7c60.3 75 55.8 185.2-14 255zM141.3 125.3c69.8-69.8 179.9-74.3 255-14L125.3 396.3c-60.3-75-55.8-185.2 16-271z"
    },
    "check-circle": {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M504 256c0 136.967-111.033 248-248 248S8 392.967 8 256 119.033 8 256 8s248 111.033 248 248zM227.314 387.314l184-184c6.248-6.248 6.248-16.379 0-22.627l-22.627-22.627c-6.248-6.249-16.379-6.249-22.627 0L216 308.118l-70.059-70.059c-6.248-6.248-16.379-6.248-22.627 0l-22.627 22.627c-6.248 6.248-6.248 16.379 0 22.627l104 104c6.248 6.249 16.379 6.249 22.627.001z"
    },
    "chevron-down": {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M207.029 381.476L12.686 187.132c-9.373-9.373-9.373-24.569 0-33.941l22.667-22.667c9.357-9.357 24.522-9.375 33.901-.04L224 284.505l154.745-154.021c9.379-9.335 24.544-9.317 33.901.04l22.667 22.667c9.373 9.373 9.373 24.569 0 33.941L240.971 381.476c-9.373 9.372-24.569 9.372-33.942 0z"
    },
    "chevron-up": {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M240.971 130.524l194.343 194.343c9.373 9.373 9.373 24.569 0 33.941l-22.667 22.667c-9.357 9.357-24.522 9.375-33.901.04L224 227.495 69.255 381.516c-9.379 9.335-24.544 9.317-33.901-.04l-22.667-22.667c-9.373-9.373-9.373-24.569 0-33.941L207.03 130.525c9.372-9.373 24.568-9.373 33.941-.001z"
    },
    "circle-exclamation": {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M504 256c0 136.997-111.043 248-248 248S8 392.997 8 256C8 119.083 119.043 8 256 8s248 111.083 248 248zM256 338c-25.405 0-46 20.595-46 46s20.595 46 46 46 46-20.595 46-46-20.595-46-46-46zm-43.673-165.346l7.418 136c.347 6.364 5.609 11.346 11.982 11.346h48.546c6.373 0 11.635-4.982 11.982-11.346l7.418-136c.375-6.874-5.098-12.654-11.982-12.654h-63.383c-6.884 0-12.356 5.78-11.981 12.654z"
    },
    eye: {
        kind:    "svg",
        viewBox: "0 0 576 512",
        path:    "M572.52 241.4C518.29 135.59 410.93 64 288 64S57.68 135.64 3.48 241.41a32.35 32.35 0 0 0 0 29.19C57.71 376.41 165.07 448 288 448s230.32-71.64 284.52-177.41a32.35 32.35 0 0 0 0-29.19zM288 400a144 144 0 1 1 144-144 143.93 143.93 0 0 1-144 144zm0-240a95.31 95.31 0 0 0-25.31 3.79 47.85 47.85 0 0 1-66.9 66.9A95.78 95.78 0 1 0 288 160z"
    },
    file: {
        kind:    "svg",
        viewBox: "0 0 384 512",
        path:    "M224 136V0H24C10.7 0 0 10.7 0 24v464c0 13.3 10.7 24 24 24h336c13.3 0 24-10.7 24-24V160H248c-13.2 0-24-10.8-24-24zm160-14.1v6.1H256V0h6.1c6.4 0 12.5 2.5 17 7l97.9 98c4.5 4.5 7 10.6 7 16.9z"
    },
    "info-circle": {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M256 8C119.043 8 8 119.083 8 256c0 136.997 111.043 248 248 248s248-111.003 248-248C504 119.083 392.957 8 256 8zm0 110c23.196 0 42 18.804 42 42s-18.804 42-42 42-42-18.804-42-42 18.804-42 42-42zm56 254c0 6.627-5.373 12-12 12h-88c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h12v-64h-12c-6.627 0-12-5.373-12-12v-24c0-6.627 5.373-12 12-12h64c6.627 0 12 5.373 12 12v100h12c6.627 0 12 5.373 12 12v24z"
    },
    minus: {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M416 208H32c-17.67 0-32 14.33-32 32v32c0 17.67 14.33 32 32 32h384c17.67 0 32-14.33 32-32v-32c0-17.67-14.33-32-32-32z"
    },
    "pen-to-square": {
        kind:    "svg",
        viewBox: "0 0 576 512",
        path:    "M402.6 83.2l90.2 90.2c3.8 3.8 3.8 10 0 13.8L274.4 405.6l-92.8 10.3c-12.4 1.4-22.9-9.1-21.5-21.5l10.3-92.8L388.8 83.2c3.8-3.8 10-3.8 13.8 0zm162-22.9l-48.8-48.8c-15.2-15.2-39.9-15.2-55.2 0l-35.4 35.4c-3.8 3.8-3.8 10 0 13.8l90.2 90.2c3.8 3.8 10 3.8 13.8 0l35.4-35.4c15.2-15.3 15.2-40 0-55.2zM384 346.2V448H64V128h229.8c3.2 0 6.2-1.3 8.5-3.5l40-40c7.6-7.6 2.2-20.5-8.5-20.5H48C21.5 64 0 85.5 0 112v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V306.2c0-10.7-12.9-16-20.5-8.5l-40 40c-2.2 2.3-3.5 5.3-3.5 8.5z"
    },
    plus: {
        kind:    "svg",
        viewBox: "0 0 448 512",
        path:    "M416 208H272V64c0-17.67-14.33-32-32-32h-32c-17.67 0-32 14.33-32 32v144H32c-17.67 0-32 14.33-32 32v32c0 17.67 14.33 32 32 32h144v144c0 17.67 14.33 32 32 32h32c17.67 0 32-14.33 32-32V304h144c17.67 0 32-14.33 32-32v-32c0-17.67-14.33-32-32-32z"
    },
    sync: {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M440.65 12.57l4 82.77A247.16 247.16 0 0 0 255.83 8C134.73 8 33.91 94.92 12.29 209.82A12 12 0 0 0 24.09 224h49.05a12 12 0 0 0 11.67-9.26 175.91 175.91 0 0 1 317-56.94l-101.46-4.86a12 12 0 0 0-12.57 12v47.41a12 12 0 0 0 12 12H500a12 12 0 0 0 12-12V12a12 12 0 0 0-12-12h-47.37a12 12 0 0 0-11.98 12.57zM255.83 432a175.61 175.61 0 0 1-146-77.8l101.8 4.87a12 12 0 0 0 12.57-12v-47.4a12 12 0 0 0-12-12H12a12 12 0 0 0-12 12V500a12 12 0 0 0 12 12h47.35a12 12 0 0 0 12-12.6l-4.15-82.57A247.17 247.17 0 0 0 255.83 504c121.11 0 221.93-86.92 243.55-201.82a12 12 0 0 0-11.8-14.18h-49.05a12 12 0 0 0-11.67 9.26A175.86 175.86 0 0 1 255.83 432z"
    },
    times: {
        kind:    "svg",
        viewBox: "0 0 352 512",
        path:    "M242.72 256l100.07-100.07c12.28-12.28 12.28-32.19 0-44.48l-22.24-22.24c-12.28-12.28-32.19-12.28-44.48 0L176 189.28 75.93 89.21c-12.28-12.28-32.19-12.28-44.48 0L9.21 111.45c-12.28 12.28-12.28 32.19 0 44.48L109.28 256 9.21 356.07c-12.28 12.28-12.28 32.19 0 44.48l22.24 22.24c12.28 12.28 32.2 12.28 44.48 0L176 322.72l100.07 100.07c12.28 12.28 32.2 12.28 44.48 0l22.24-22.24c12.28-12.28 12.28-32.19 0-44.48L242.72 256z"
    },
    "triangle-exclamation": {
        kind:    "svg",
        viewBox: "0 0 576 512",
        path:    "M569.517 440.013C587.975 472.007 564.806 512 527.94 512H48.054c-36.937 0-59.999-40.055-41.577-71.987L246.423 23.985c18.467-32.009 64.72-31.951 83.154 0l239.94 416.028zM288 354c-25.405 0-46 20.595-46 46s20.595 46 46 46 46-20.595 46-46-20.595-46-46-46zm-43.673-165.346l7.418 136c.347 6.364 5.609 11.346 11.982 11.346h48.546c6.373 0 11.635-4.982 11.982-11.346l7.418-136c.375-6.874-5.098-12.654-11.982-12.654h-63.383c-6.884 0-12.356 5.78-11.981 12.654z"
    },
    window: {
        kind:    "svg",
        viewBox: "0 0 512 512",
        path:    "M464 32H48C21.49 32 0 53.49 0 80v352c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V80c0-26.51-21.49-48-48-48zm-16 416H64c-8.84 0-16-7.16-16-16V192h416v240c0 8.84-7.16 16-16 16z"
    }
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
