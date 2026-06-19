// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";

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
 * A {@link GlyphDef} carrying its own registry name. Glyph modules generated
 * from third-party icon sets export values of this shape so they can be
 * registered in a single call to `Glyph.register(...)`.
 */
export type NamedGlyphDef = GlyphDef & { name: string };

/**
 * Mutable registry of named glyphs, populated via `registerGlyph` /
 * `Glyph.register`. Starts empty — consumers register the glyphs they need.
 *
 * @internal
 */
const _glyphs: Map<string, GlyphDef> = new Map();

// Built-in Unicode-triangle glyphs registered eagerly. Prefixed `unicode-` so
// user code can register its own `arrow-up` / `arrow-down` SVG glyphs without
// overwriting these — built-in chrome like Scrollbar's end-cap buttons
// references the prefixed names directly and stays immune to user overrides.
// Char-mode entries are tiny (no sprite, no path data) so the always-on cost
// is negligible; the triangles inherit the surrounding text colour via
// `currentColor`, so a single foreground-colour write themes them.
_glyphs.set("unicode-arrow-up",    { kind: "char", char: "▲" });
_glyphs.set("unicode-arrow-down",  { kind: "char", char: "▼" });
_glyphs.set("unicode-arrow-left",  { kind: "char", char: "◀" });
_glyphs.set("unicode-arrow-right", { kind: "char", char: "▶" });

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Prefix applied to every `<symbol>` id inside the sprite. A consumer-supplied
 * registry name `"xmark"` becomes the id `"ts-glyph-xmark"`, which is what
 * `<use href="#ts-glyph-xmark"/>` references.
 */
export const GLYPH_SYMBOL_ID_PREFIX = "ts-glyph-";

let _spriteMounted: boolean        = false;
let _spriteElement: Handle | null = null;

/**
 * Registers a glyph by name. If the glyph is SVG-mode and the sprite is
 * already mounted, the corresponding `<symbol>` is appended immediately so
 * Glyphs constructed after this call can reference it.
 *
 * @internal
 */
export function registerGlyph(def: NamedGlyphDef): void {
    _glyphs.set(def.name, def);

    if (def.kind === "svg" && _spriteMounted) {
        _addSymbolToSprite(def.name, def);
    }
}

/**
 * Removes a glyph from the registry by name. If the glyph was SVG-mode and
 * the sprite is mounted, its `<symbol>` is removed from the DOM as well.
 *
 * @internal
 */
export function unregisterGlyph(name: string): void {
    const def = _glyphs.get(name);
    _glyphs.delete(name);

    if (def && def.kind === "svg" && _spriteMounted) {
        _removeSymbolFromSprite(name);
    }
}

/**
 * Looks up a glyph definition by registry name.
 *
 * @returns The registered {@link GlyphDef}, or `undefined` if not registered.
 *
 * @internal
 */
export function lookupGlyph(name: string): GlyphDef | undefined {
    return _glyphs.get(name);
}

/**
 * Ensures the document carries a single hidden `<svg>` sprite that hosts the
 * `<symbol>` elements for every SVG-mode glyph. Idempotent — subsequent calls
 * are no-ops. The sprite starts empty; entries are appended incrementally
 * either by {@link registerGlyph} (after the sprite is mounted) or by
 * {@link ensureGlyphSymbolMounted} (when a Glyph instance is constructed).
 *
 * @internal
 */
export function ensureGlyphSprite(): void {
    if (_spriteMounted) {
        return;
    }

    const sprite = DOM.sink.createElementNS(SVG_NS, "svg");
    // `sprite` is a raw off-screen SVG element mounted directly on document.body,
    // not a Component, so the Component style setters don't apply here.
    DOM.sink.apply(sprite, {
        setAttr: { "aria-hidden": "true", focusable: "false" },
        style: { position: "absolute", width: "0", height: "0", overflow: "hidden" },
    });

    DOM.sink.appendChild(DOM.source.getBody(), sprite);

    _spriteElement = sprite;
    _spriteMounted = true;
}

/**
 * Ensures the sprite carries a `<symbol>` for the named SVG-mode glyph,
 * appending it on demand for glyphs registered before the sprite was mounted.
 * Idempotent.
 *
 * @internal
 */
export function ensureGlyphSymbolMounted(name: string): void {
    if (!_spriteMounted) {
        return;
    }

    const def = _glyphs.get(name);
    if (def && def.kind === "svg") {
        _addSymbolToSprite(name, def);
    }
}

/**
 * Appends a `<symbol>` for the given SVG-mode glyph to the sprite. Idempotent:
 * a no-op when a `<symbol>` with the same id already exists.
 *
 * @internal
 */
function _addSymbolToSprite(name: string, def: GlyphDef): void {
    if (!_spriteElement || def.kind !== "svg") {
        return;
    }

    const id = GLYPH_SYMBOL_ID_PREFIX + name;
    if (DOM.source.querySelector(_spriteElement, `#${CSS.escape(id)}`)) {
        return;
    }

    const symbol = DOM.sink.createElementNS(SVG_NS, "symbol");
    DOM.sink.apply(symbol, { setAttr: { id: id, viewBox: def.viewBox } });

    const path = DOM.sink.createElementNS(SVG_NS, "path");
    DOM.sink.apply(path, { setAttr: { d: def.path } });
    DOM.sink.appendChild(symbol, path);

    DOM.sink.appendChild(_spriteElement, symbol);
}

/**
 * Removes the `<symbol>` for the given glyph name from the sprite, if present.
 *
 * @internal
 */
function _removeSymbolFromSprite(name: string): void {
    if (!_spriteElement) {
        return;
    }

    const id = GLYPH_SYMBOL_ID_PREFIX + name;
    const symbol = DOM.source.querySelector(_spriteElement, `#${CSS.escape(id)}`);
    if (symbol) {
        // Release the symbol's retained `<path>` child too — releasing only the
        // symbol would pin the detached path handle in the registry. Queried
        // before removal so it resolves to its canonical retained handle.
        const path = DOM.source.querySelector(symbol, "path");

        DOM.sink.removeChild(_spriteElement, symbol);
        DOM.sink.release(symbol);

        if (path) {
            DOM.sink.release(path);
        }
    }
}
