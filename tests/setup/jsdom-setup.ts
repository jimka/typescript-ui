/**
 * Global Vitest setup. Runs for every test file regardless of environment, so
 * it self-guards: under the default `node` environment there is no `window` and
 * it does nothing. Under the `jsdom` environment it polyfills `matchMedia`,
 * which jsdom omits but framework code (Glyph, Animation) consults.
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
