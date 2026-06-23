/**
 * Global Vitest setup. Runs for every test file regardless of environment, so
 * it self-guards: under the default `node` environment there is no `window` and
 * it does nothing. Under the `jsdom` environment it polyfills `matchMedia` and
 * `CSS.escape`, which jsdom omits but framework code (Glyph, Animation, the
 * Glyphs sprite) consults.
 */
if (typeof window !== 'undefined'
    && typeof (globalThis as { CSS?: { escape?: unknown } }).CSS?.escape !== 'function') {
    // The Glyphs sprite calls `CSS.escape(id)` when checking the mounted sprite
    // for an existing `<symbol>`. jsdom does not expose the CSS namespace, so
    // provide a minimal `escape` that backslash-quotes every character outside
    // the `[a-zA-Z0-9_-]` set — enough for the ASCII `ts-glyph-<name>` ids the
    // sprite queries with. Guarding on `CSS.escape` specifically (not the whole
    // namespace) so a future jsdom that ships a partial `CSS` still gets the
    // shim rather than silently throwing on the missing method.
    const cssNs = ((globalThis as { CSS?: { escape?: (value: string) => string } }).CSS ??= {});
    cssNs.escape = (value: string): string =>
        String(value).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string): MediaQueryList => ({
        matches        : false,
        media          : query,
        onchange       : null,
        addListener    : (): void => {},
        removeListener : (): void => {},
        addEventListener    : (): void => {},
        removeEventListener : (): void => {},
        dispatchEvent  : (): boolean => false,
    }) as MediaQueryList;
}
