/**
 * Global Vitest setup. Runs for every test file regardless of environment, so
 * it self-guards: under the default `node` environment there is no `window` and
 * it does nothing. Under the `jsdom` environment it polyfills `matchMedia`
 * (consulted by Glyph and Animation) and `CSS.escape` (consulted by Glyph
 * sprite mounting), both of which jsdom omits.
 */
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

// jsdom does not provide the `CSS` interface object, so `CSS.escape` (consulted
// by Glyph sprite mounting when it builds an `#id` selector) throws. Polyfill
// just the `escape` helper with a conservative escape: every character that is
// not an ASCII letter, digit, hyphen, or underscore is backslash-escaped. That
// is a superset of the WHATWG CSS.escape rules and is ample for the simple
// glyph-symbol ids the framework generates.
if (typeof globalThis !== 'undefined' && typeof (globalThis as { CSS?: unknown }).CSS === 'undefined') {
    (globalThis as { CSS?: { escape(value: string): string } }).CSS = {
        escape(value: string): string {
            return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
        },
    };
}
