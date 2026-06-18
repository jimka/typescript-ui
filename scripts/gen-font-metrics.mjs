// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * One-shot generator for the baked font-metrics table consumed offline by
 * `tests/dom/TestDOM.ts`'s `ModelledDOMSource`.
 *
 * The table must be produced in a REAL browser engine so the ascent / descent /
 * cap-top and per-character advance widths match what the framework's
 * production `Util.measureFontMetrics` / `Util.measureTextMetrics` measure at
 * runtime (canvas `measureText` against the same engine). Node has no font
 * rasteriser, so this script is written to run inside a browser context — the
 * Canvas 2D `measureText` API is the only dependency.
 *
 * Run it one of two ways:
 *   1. Paste `buildTable(...)` into the browser console on the app dev page
 *      (`npm run dev`) and save the logged JSON.
 *   2. Drive it with Playwright/Puppeteer: `page.evaluate(buildTable, config)`
 *      then write the result to `tests/dom/font-metrics.<font>.json`.
 *
 * Pin ONE deterministic, bundled font so the table is reproducible across
 * machines (the repo ships Manrope; pick the font the offline tests assert
 * against). Assertions tolerate ±1px to absorb sub-pixel rounding.
 */

/** The characters whose advance widths are baked. Extend as tests need. */
const DEFAULT_CHARS = ' abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-';

/**
 * Measures one font at one size, returning a baked entry. Runs in a browser:
 * `ctx` is a `CanvasRenderingContext2D`.
 *
 * @param {CanvasRenderingContext2D} ctx - A 2D canvas context.
 * @param {string} family - The CSS font-family.
 * @param {string} size - The CSS font-size (e.g. "14px").
 * @param {string} weight - The CSS font-weight (e.g. "normal").
 * @param {string} style - The CSS font-style (e.g. "normal").
 * @param {string} chars - The characters to bake advance widths for.
 * @returns The baked `{ ascent, descent, capTop, advance }` entry.
 */
export function measureFont(ctx, family, size, weight, style, chars) {
    ctx.font = `${style} ${weight} ${size} ${family}`;

    const m          = ctx.measureText('X');
    const hasFontBox = typeof m.fontBoundingBoxAscent === 'number';
    const ascent     = hasFontBox ? m.fontBoundingBoxAscent  : m.actualBoundingBoxAscent;
    const descent    = hasFontBox ? m.fontBoundingBoxDescent : m.actualBoundingBoxDescent;

    const advance = {};
    for (const ch of chars) {
        advance[ch] = ctx.measureText(ch).width;
    }

    return { ascent, descent, capTop: m.actualBoundingBoxAscent, advance };
}

/**
 * Builds a full {@link FontMetricsTable} for the given fonts × sizes. Run in a
 * browser context (needs `document` / Canvas 2D).
 *
 * @param {Array<{family: string, size: string, weight?: string, style?: string}>} fonts - Fonts to bake.
 * @param {string} chars - Characters to bake advance widths for.
 * @returns A `{ fonts: { "<family>|<size>|<weight>|<style>": entry } }` table.
 */
export function buildTable(fonts, chars = DEFAULT_CHARS) {
    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');
    const out    = { fonts: {} };

    for (const f of fonts) {
        const weight = f.weight ?? 'normal';
        const style  = f.style ?? 'normal';
        const key    = `${f.family}|${f.size}|${weight}|${style}`;

        out.fonts[key] = measureFont(ctx, f.family, f.size, weight, style, chars);
    }

    return out;
}
