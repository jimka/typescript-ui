// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DOM, type Handle } from "~/core/DOM.js";

/**
 * The library's built-in mark: the framework's `Border` layout drawn literally
 * as a north bar, a west sidebar and a centre pane on a rounded plate.
 *
 * Geometry, on a 32-unit viewBox so every dimension is a whole number and each
 * unit is half a pixel in a 16px browser tab: the plate is the full 32×32 with
 * a 6-unit corner radius, and clips the three regions so they inherit its
 * rounded corners. The north bar is `0,0 32×10` (full width, as `Border` docks
 * north); the west sidebar `0,12 10×20`; the centre pane `12,12 20×20`. The
 * 2-unit gaps between them are the field showing through — the regions carry
 * no stroke, so nothing in the mark is thinner than a solid 10-unit block.
 *
 * Colours are fixed rather than read from the active theme, and the SVG carries
 * its own `prefers-color-scheme` rule so the mark suits light *and* dark
 * browser chrome without any framework wiring. Light mode is plain black on
 * white — the highest-contrast pairing, which is what holds the 1px gaps
 * together once a browser downsamples the mark to tab size. The dark palette is
 * lifted from `DarkTheme`: `#505050` is its `button.border` and `#78AAF0` its
 * `input.focusRing`, the framework's accent hue.
 *
 * Declared with single quotes because the string is full of double quotes.
 *
 * @internal Exported for the encoding round-trip test only; not part of the
 * public API (the `core` barrel does not re-export it).
 */
export const MARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.pane{fill:#FFFFFF}.region{fill:#000000}@media(prefers-color-scheme:dark){.pane{fill:#505050}.region{fill:#78AAF0}}</style><clipPath id="plate"><rect width="32" height="32" rx="6"/></clipPath><g clip-path="url(#plate)"><rect class="pane" width="32" height="32"/><rect class="region" width="32" height="10"/><rect class="region" y="12" width="10" height="20"/><rect class="region" x="12" y="12" width="20" height="20"/></g></svg>';

/**
 * The library's built-in mark as a ready-to-use `data:` URI — what
 * {@link Favicon.install} writes when no other icon is supplied.
 *
 * Encoded with `encodeURIComponent` rather than a hand-written escape list.
 * Getting that list wrong fails silently: an unescaped `#` would truncate the
 * URI at `url(#plate)`, dropping the clip path and rendering a blank tab icon
 * with no error anywhere.
 *
 * @category Core
 */
export const DEFAULT_FAVICON = `data:image/svg+xml,${encodeURIComponent(MARK_SVG)}`;

/**
 * Matches `rel="icon"` and `rel="shortcut icon"` — `~=` is the
 * whitespace-separated word match, so a `rel` of `"shortcut icon"` contains the
 * word `icon` and matches. `apple-touch-icon` and `mask-icon` are single words
 * and deliberately do not: neither sets the browser-tab icon, so a page
 * carrying only one of them still has no tab icon worth preserving.
 */
const ICON_LINK_SELECTOR = 'link[rel~="icon"]';

/**
 * Installs the browser-tab icon by appending a `<link rel="icon">` to `<head>`.
 *
 * Apps do not normally call this: `Body.init` installs {@link DEFAULT_FAVICON}
 * on mount, and the `favicon` option on that call is the ordinary way to supply
 * a different one or to suppress injection. Call it directly only when mounting
 * without `Body.init`.
 *
 * An icon the document already declares always wins — see {@link Favicon.install}.
 *
 * @category Core
 */
export class Favicon {

    /**
     * The link this class injected, or `null` when it has not injected one.
     * Held so a later install swaps the `href` instead of stacking a second
     * `<link>` — the browser would honour the last one, but the page would
     * accumulate a link per call.
     */
    private static _link: Handle | null = null;

    /**
     * Appends a `<link rel="icon">` to `<head>`, unless the document already
     * declares an icon link of its own — an app's `<link rel="icon">` written
     * in its `index.html` is never replaced. Module scripts run after the
     * document is parsed, so such a link is always visible by the time this
     * runs.
     *
     * Calling it again replaces the `href` on the link it previously injected
     * rather than appending a second one.
     *
     * @param href - The icon URL or `data:` URI. Defaults to the library's
     *   built-in mark.
     *
     * @returns `true` when the icon was installed, `false` when the document's
     *   own icon link was left in place.
     */
    static install(href: string = DEFAULT_FAVICON): boolean {
        if (Favicon._link !== null) {
            DOM.sink.apply(Favicon._link, { setAttr: { href } });

            return true;
        }

        const head = DOM.source.getHead();

        if (DOM.source.querySelector(head, ICON_LINK_SELECTOR) !== null) {
            return false;
        }

        const link = DOM.sink.createElement("link");

        DOM.sink.apply(link, { setAttr: { rel: "icon", href } });
        DOM.sink.appendChild(head, link);

        Favicon._link = link;

        return true;
    }

    /**
     * Forgets the injected link, so the next {@link Favicon.install} appends a
     * fresh one instead of writing through the handle it is holding.
     *
     * @internal Test-only. A handle minted before `DOM.reset()` does not
     * resolve against the registry that replaces it, so a suite that resets the
     * DOM between cases must reset this too.
     */
    static _reset(): void {
        Favicon._link = null;
    }
}
