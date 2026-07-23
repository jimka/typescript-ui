// A TabBar strip that mixes closeable and non-closeable tabs in one shared
// cell (fill / equal-collapsed / fixed) must give every tab's label the same
// clearance. Before the fix, only closeable tabs reserved the close-button
// gutter out of the shared cell, so their label ran shorter than a
// non-closeable neighbour's — loudest with rotated text on a west/east strip.
import { describe, it, expect, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { TabButton } from '~/component/button/TabButton';
import { ThemeManager } from '~/core/Theme';
import { Tab } from '~/layout/Tab';
import type { TabOptions } from '~/layout/Tab';
import { Component } from '~/core/Component';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Container } from '~/core/Container';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A LayoutConstraints marking the entry closeable. */
function closeable(): LayoutConstraints {
    const c = new LayoutConstraints();

    c.closeable = true;

    return c;
}

/** The private surface of `TabBar._entries` this test reads geometry off of. */
type EntryButton = TabButton & { _content: { getWidth(): number; getHeight(): number; getPreferredSize(): { width: number; height: number } | null } };
type BarEntries = Array<{ id: string; button: EntryButton }>;

/** Reaches `TabBar._entries`, the same private surface the sibling glyph-centring test casts through. */
function entries(bar: TabBar): BarEntries {
    return (bar as unknown as { _entries: BarEntries })._entries;
}

/** Builds a `Tab`-managed strip, sized and laid out, with the given tab labels/closeability. */
function hostTab(options: TabOptions, width: number, height: number, tabs: Array<{ name: string; closeable: boolean }>): { host: Container; bar: TabBar } {
    const tab  = new Tab(options);
    const host = new Container({ layoutManager: tab });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    for (const t of tabs) {
        const child = new Component({ preferredSize: { width: 50, height: 50 } });

        child.getElement(true);
        host.addComponent(child, t.closeable ? closeable() : undefined);
    }

    // `name` isn't a LayoutConstraints field the addComponent path threads
    // through here (Tab derives the label from constraints.name, the
    // component's own name, or its id) — the strip cells only need distinct
    // ids, not distinct visible text, since every assertion below compares
    // closeable vs. non-closeable geometry for the *same* label.
    host.doLayout();

    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return { host, bar };
}

describe('tab closeable-label squeeze in shared-cell modes', () => {
    afterEach(() => DOM.reset());

    it('gives closeable and non-closeable tabs the same reading-flow inset (mechanism, vertical-cw)', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-cw" },
            600, 400,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const expected = scale.tabClose + scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getBottom()).toBe(expected);
        expect(plainEntry.button.getInsets().getBottom()).toBe(expected);

        host.dispose();
    });

    it('gives a closeable and a non-closeable tab equal label clearance in a shared cell (west, vertical-cw, equal)', () => {
        installTestDOM(CONFIG);

        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-cw" },
            600, 70,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);

        expect(closeableEntry.button._content.getHeight()).toBe(plainEntry.button._content.getHeight());

        host.dispose();
    });

    it('reserves the top inset (not the bottom) for vertical-ccw, equally for both tabs', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-ccw" },
            600, 70,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const withReserve = scale.tabClose + scale.tabButtonInset * 2;
        const withoutReserve = scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getTop()).toBe(withReserve);
        expect(plainEntry.button.getInsets().getTop()).toBe(withReserve);
        expect(closeableEntry.button.getInsets().getBottom()).toBe(withoutReserve);
        expect(plainEntry.button.getInsets().getBottom()).toBe(withoutReserve);

        host.dispose();
    });

    it('gives equal label width for upright north-side text sharing a fill-mode cell', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "fill", side: "north" },
            200, 60,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const expected = scale.tabClose + scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getRight()).toBe(expected);
        expect(plainEntry.button.getInsets().getRight()).toBe(expected);
        expect(closeableEntry.button._content.getWidth()).toBe(plainEntry.button._content.getWidth());

        host.dispose();
    });

    it('reserves nothing on any tab when the strip has no closeable tab', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-cw" },
            600, 400,
            [{ name: "a", closeable: false }, { name: "b", closeable: false }],
        );

        const [firstEntry, secondEntry] = entries(bar);
        const withoutReserve = scale.tabButtonInset * 2;

        expect(firstEntry.button.getInsets().getBottom()).toBe(withoutReserve);
        expect(secondEntry.button.getInsets().getBottom()).toBe(withoutReserve);

        host.dispose();
    });

    it('leaves both labels at their natural extent in a roomy content-mode strip', () => {
        installTestDOM(CONFIG);

        const { host, bar } = hostTab(
            { widthMode: "content", side: "west", orientation: "vertical-cw" },
            600, 800,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);

        const closeablePreferred = closeableEntry.button._content.getPreferredSize();
        const plainPreferred     = plainEntry.button._content.getPreferredSize();

        // Guard the preferred size explicitly: a null here is a setup failure and
        // should read as one, not silently become `undefined` inside the compare.
        expect(closeablePreferred).not.toBeNull();
        expect(plainPreferred).not.toBeNull();

        expect(closeableEntry.button._content.getHeight()).toBe(closeablePreferred!.height);
        expect(plainEntry.button._content.getHeight()).toBe(plainPreferred!.height);

        host.dispose();
    });
});
