//
// Coverage for the demo app's content pane: the three things only the demo app
// can get wrong about Card's keyed-child surface — registering a factory with
// no key at all, keying it by something other than its slug, and handing Card a
// slug it does not have.
//
// Everything about *how* a keyed page behaves — build-once across repeated
// selection, switching's display and undisplay arms, an unbuilt slot's size, an
// async or throwing factory, a duplicate key — belongs to
// tests/component/layout/Card.deferred.test.ts and is deliberately not
// restated here. A second copy would only drift, and this file's three stubs
// would be the weaker one left standing.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Card } from '~/layout/Card';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { DemoSectionDeck } from '../../../src/typescript/DemoSectionDeck.js';
import type { DemoSection } from '../../../src/typescript/demoSections.js';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Label and slug are separate parameters on purpose: every case registers at
// least one section whose label differs from its slug, which is what makes a
// `key: section.label` mix-up observable.
function stubSection(label: string, slug: string, built: string[], panels: Map<string, Component>): DemoSection {
    return {
        label,
        slug,
        factory: () => {
            built.push(slug);

            const panel = new Component({ preferredSize: { width: 10, height: 10 } });

            panels.set(slug, panel);

            return panel;
        },
    };
}

// The deck keeps its Card private; the cases read the selection off the
// manager, the same cast TabPanel.getTab uses for its own Tab.
function cardOf(deck: DemoSectionDeck): Card {
    return deck.getLayoutManager() as Card;
}

// The three stubs every case registers. Their labels and slugs deliberately
// differ, so a deck keyed by label fails the slug lookups and passes the label
// ones — which is what lets cases 3 and 4 pin the direction of the mapping
// rather than merely that one of the two spellings works.
function threeStubs(built: string[], panels: Map<string, Component>): DemoSection[] {
    return [
        stubSection("Property Grid", "property-grid", built, panels),
        stubSection("MD Editor",     "md-editor",     built, panels),
        stubSection("Misc.",         "misc",          built, panels),
    ];
}

// A deck with an element, as Card.test.ts's own hostCard helper gives its
// container: the deck is the Card's container, and the child a build appends
// needs an element to be appended to.
function hostedDeck(built: string[], panels: Map<string, Component>): DemoSectionDeck {
    const deck = new DemoSectionDeck(threeStubs(built, panels));

    deck.getElement(true);
    deck.setWidth(400);
    deck.setHeight(300);

    return deck;
}

describe('DemoSectionDeck', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('registers every section as an unbuilt keyed page (case 2)', () => {
        installTestDOM(CONFIG);

        const built:  string[]              = [];
        const panels: Map<string, Component> = new Map();
        const deck                           = hostedDeck(built, panels);

        expect(built).toEqual([]);
        expect(deck.getComponents()).toEqual([]);
        // The arm that separates "registered, unbuilt" from "never registered":
        // on its own the empty-getComponents assertion above would also pass
        // for a constructor that registered nothing at all.
        expect(cardOf(deck).hasKey("property-grid")).toBe(true);
        expect(cardOf(deck).hasKey("md-editor")).toBe(true);
        expect(cardOf(deck).hasKey("misc")).toBe(true);
    });

    it('show builds exactly the requested page and makes it visible (case 3)', () => {
        installTestDOM(CONFIG);

        const built:  string[]               = [];
        const panels: Map<string, Component> = new Map();
        const deck                           = hostedDeck(built, panels);

        expect(deck.show("md-editor")).toBe(true);

        // The exact array, not membership: a registration that keyed every
        // section identically would build the wrong one and still pass a
        // `toContain`.
        expect(built).toEqual(["md-editor"]);
        expect(deck.getComponents()).toHaveLength(1);
        expect(cardOf(deck).getVisibleComponent()).toBe(panels.get("md-editor"));
        expect(cardOf(deck).getVisibleKey()).toBe("md-editor");
    });

    it('a section is reachable by slug and not by label (case 4)', () => {
        installTestDOM(CONFIG);

        const built:  string[]               = [];
        const panels: Map<string, Component> = new Map();
        const deck                           = hostedDeck(built, panels);

        expect(deck.show("property-grid")).toBe(true);
        expect(built).toEqual(["property-grid"]);
        expect(cardOf(deck).getVisibleComponent()).toBe(panels.get("property-grid"));

        // The other arm, on a fresh deck so the first show cannot mask it: a
        // deck keyed by label would pass this and fail the slug arm above.
        const labelBuilt:  string[]               = [];
        const labelPanels: Map<string, Component> = new Map();
        const labelDeck                           = hostedDeck(labelBuilt, labelPanels);

        expect(labelDeck.show("Property Grid")).toBe(false);
        expect(labelBuilt).toEqual([]);
        expect(labelDeck.getComponents()).toEqual([]);
        expect(cardOf(labelDeck).getVisibleKey()).toBe(null);
    });

    it('an unknown slug is declined and leaves the card untouched (case 5)', () => {
        installTestDOM(CONFIG);

        const built:  string[]               = [];
        const panels: Map<string, Component> = new Map();
        const deck                           = hostedDeck(built, panels);

        expect(deck.show("misc")).toBe(true);
        expect(deck.show("nope")).toBe(false);

        expect(built).toEqual(["misc"]);
        expect(deck.getComponents()).toHaveLength(1);
        // The load-bearing assertion: dropping the hasKey pre-flight leaves
        // `built` and `getComponents()` both unchanged — the unknown key is
        // stored, resolves nothing, and falls the card back to its first live
        // child — so only the stored selection exposes it.
        expect(cardOf(deck).getVisibleKey()).toBe("misc");
    });
});
