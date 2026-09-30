import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { Favicon, DEFAULT_FAVICON, MARK_SVG } from '~/core/Favicon';
import { DOM, type Handle } from '~/core/DOM';
import { installTestDOM, setQuerySelectorResult, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The selector `Favicon` queries with; duplicated here because there is no compile-time link. */
const ICON_LINK_SELECTOR = 'link[rel~="icon"]';

/** The `setAttr` map of an `apply` write, or undefined for any other write. */
function setAttr(write: { op: string; args: unknown[] }): Record<string, string> | undefined {
    return write.op === 'apply'
        ? (write.args[1] as { setAttr?: Record<string, string> }).setAttr
        : undefined;
}

/** Counts the `<link>` elements the sink was asked to create. */
function linkCreations(sink: RecordingDOMSink): number {
    return sink.writes.filter(w => w.op === 'createElement' && w.args[0] === 'link').length;
}

/**
 * The handle of the link the `rel="icon"` write targeted, or undefined when no
 * icon link was installed.
 */
function iconLink(sink: RecordingDOMSink): Handle | undefined {
    return sink.writes.find(w => setAttr(w)?.rel === 'icon')?.args[0] as Handle | undefined;
}

/**
 * Every `href` written to the installed icon link, oldest first. Anchored to
 * that link's handle, so it picks up the `href`-only write a re-install makes
 * without matching an `href` written to any other element.
 *
 * Reads `sink.writes` directly rather than asserting that a call did not
 * throw: the op log says which link received which `href`, which is the
 * contract, while a throw-or-not assertion cannot tell a fresh link from an
 * `href` swapped onto an existing one.
 *
 * @param sink - The recording sink for the current test.
 * @returns The `href` of every write to the icon link, oldest first.
 */
function iconWrites(sink: RecordingDOMSink): string[] {
    const link = iconLink(sink);

    if (link === undefined) {
        return [];
    }

    return sink.writes
        .filter(w => w.args[0] === link)
        .map(w => setAttr(w)?.href)
        .filter((href): href is string => href !== undefined);
}

/** Seeds the document as already declaring its own icon link. */
function seedExistingIconLink(): void {
    setQuerySelectorResult(ICON_LINK_SELECTOR, DOM.sink.createElement('link'));
}

describe('Favicon', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('injects the built-in mark when the document declares no icon link', () => {
        const sink = installTestDOM(CONFIG);

        Body.init({});

        expect(linkCreations(sink)).toBe(1);
        expect(iconWrites(sink)).toEqual([DEFAULT_FAVICON]);

        // The link is appended to <head>, not left detached. The modelled
        // source mints a fresh handle per getHead() call, so the parent is
        // identified by its tag rather than by handle identity.
        const append = sink.writes.find(w => w.op === 'appendChild' && w.args[1] === iconLink(sink));

        expect(append).toBeDefined();
        expect(DOM.source.getTagName(append!.args[0] as Handle)).toBe('HEAD');
    });

    it('does not inject when the document already declares an icon link', () => {
        const sink = installTestDOM(CONFIG);

        seedExistingIconLink();

        Body.init({});

        expect(iconWrites(sink)).toEqual([]);
        expect(linkCreations(sink)).toBe(1);   // only the seeded one
        expect(Favicon.install()).toBe(false);
    });

    it('honours a URL override', async () => {
        const sink = installTestDOM(CONFIG);

        const body = await Body.init({ favicon: '/brand.svg' });

        expect(iconWrites(sink)).toEqual(['/brand.svg']);
        expect(body.getFavicon()).toBe('/brand.svg');
    });

    it('honours the suppress value', async () => {
        const sink = installTestDOM(CONFIG);

        const body = await Body.init({ favicon: false });

        expect(iconWrites(sink)).toEqual([]);
        expect(linkCreations(sink)).toBe(0);
        expect(body.getFavicon()).toBe(false);
    });

    it('lets the document link win over an explicit override', () => {
        const sink = installTestDOM(CONFIG);

        seedExistingIconLink();

        Body.init({ favicon: '/brand.svg' });

        expect(iconWrites(sink)).toEqual([]);
    });

    it('encodes the built-in mark so no character breaks the data URI', () => {
        installTestDOM(CONFIG);

        expect(DEFAULT_FAVICON.startsWith('data:image/svg+xml,')).toBe(true);

        const encoded = DEFAULT_FAVICON.slice('data:image/svg+xml,'.length);

        // An unescaped '#' would truncate the URI at the fragment, dropping the
        // clip path and rendering an empty tab icon.
        expect(encoded).not.toMatch(/[#<>"]/);
        expect(decodeURIComponent(encoded)).toBe(MARK_SVG);
        expect(MARK_SVG).toContain('url(#plate)');
    });

    it('swaps the href on a second install instead of adding a second link', () => {
        const sink = installTestDOM(CONFIG);

        Favicon.install('/a.svg');
        Favicon.install('/b.svg');

        expect(linkCreations(sink)).toBe(1);
        expect(iconWrites(sink)).toEqual(['/a.svg', '/b.svg']);
    });

    it('F1. appends a fresh link after the sink is replaced', () => {
        const first = installTestDOM(CONFIG);

        Favicon.install('/a.svg');

        const second = installTestDOM(CONFIG);

        Favicon.install('/b.svg');

        // One link per sink, and the second sink saw only its own href: the
        // second install appended rather than swapping the href on a handle the
        // replacement sink never minted, which is what its table throws on.
        expect(linkCreations(first)).toBe(1);
        expect(linkCreations(second)).toBe(1);
        expect(iconWrites(second)).toEqual(['/b.svg']);
    });

    it('F2. keeps the injected link when only the source is swapped', () => {
        const sink = installTestDOM(CONFIG);

        Favicon.install('/a.svg');

        DOM.install({ source: Object.create(DOM.source) as typeof DOM.source });

        Favicon.install('/c.svg');

        // This case does not pin the reset — it is green either side of it. It
        // pins the symmetric arm: the swap that must *not* drop the cache. Every
        // handle the installed sink minted stays valid when a source spy goes in
        // over it, so the second install swaps the href on the link already
        // there instead of stacking a second one.
        expect(linkCreations(sink)).toBe(1);
        expect(iconWrites(sink)).toEqual(['/a.svg', '/c.svg']);
    });
});
