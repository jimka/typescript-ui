// The close-button gutter is reserved per tab, not strip-wide: only a tab that
// actually has a close button gives up the gutter. A non-closeable tab keeps
// its whole box, so label justification (setTextAlign) has the full width to
// work with — reserving the gutter on non-closeable tabs (as an earlier
// strip-wide fix did) stole exactly that space and broke justification.
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
type EntryButton = TabButton & { _content: { getX(): number; getTranslateX(): number; getWidth(): number } };
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

    host.doLayout();

    const bar = (tab as unknown as { _bar: TabBar })._bar;

    return { host, bar };
}

describe('tab close-button reserve is per-tab', () => {
    afterEach(() => DOM.reset());

    it('reserves the right gutter on a closeable tab but not a non-closeable neighbour (north upright)', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "fill", side: "north" },
            600, 60,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const withReserve    = scale.tabClose + scale.tabButtonInset * 2;
        const withoutReserve = scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getRight()).toBe(withReserve);
        // The non-closeable tab reserves nothing: its label keeps the full width.
        expect(plainEntry.button.getInsets().getRight()).toBe(withoutReserve);

        host.dispose();
    });

    it('reserves the bottom gutter on a closeable tab but not a non-closeable neighbour (west, vertical-cw)', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-cw" },
            600, 70,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const withReserve    = scale.tabClose + scale.tabButtonInset * 2;
        const withoutReserve = scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getBottom()).toBe(withReserve);
        expect(plainEntry.button.getInsets().getBottom()).toBe(withoutReserve);

        host.dispose();
    });

    it('reserves the top gutter on a closeable tab but not a non-closeable neighbour (west, vertical-ccw)', () => {
        installTestDOM(CONFIG);

        const scale = ThemeManager.getResolvedScale();
        const { host, bar } = hostTab(
            { widthMode: "equal", side: "west", orientation: "vertical-ccw" },
            600, 70,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const [closeableEntry, plainEntry] = entries(bar);
        const withReserve    = scale.tabClose + scale.tabButtonInset * 2;
        const withoutReserve = scale.tabButtonInset * 2;

        expect(closeableEntry.button.getInsets().getTop()).toBe(withReserve);
        expect(plainEntry.button.getInsets().getTop()).toBe(withoutReserve);

        host.dispose();
    });

    it('a non-closeable tab justifies its label across the full width, even beside a closeable tab', () => {
        installTestDOM(CONFIG);

        // A wide fill-mode cell leaves free space for justification to move the
        // label; the closeable sibling must not shrink the non-closeable tab's
        // justify range (the regression this fix addresses).
        const { host, bar } = hostTab(
            { widthMode: "fill", side: "north" },
            600, 60,
            [{ name: "a", closeable: true }, { name: "b", closeable: false }],
        );

        const plain = entries(bar)[1].button;

        // A same-size text-align flip re-anchors `_content` at a new x with no
        // width change, so LayoutManager.commitBounds's size-stable position
        // fast path drives the move via translate — `getX()` alone would keep
        // reporting the pre-move (frozen) value; fold the translate back in.
        bar.setTextAlign('start');
        host.doLayout();
        const startRight = plain._content.getX() + plain._content.getTranslateX() + plain._content.getWidth();

        bar.setTextAlign('end');
        host.doLayout();
        const endRight = plain._content.getX() + plain._content.getTranslateX() + plain._content.getWidth();

        // End-justify pushes the label's trailing edge further right than
        // start-justify does; a phantom close reserve would have clamped both to
        // the same inset-bounded box.
        expect(endRight).toBeGreaterThan(startRight);

        host.dispose();
    });
});
