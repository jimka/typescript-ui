// A tab's close ✕ must sit centred in its own hit box.
//
// The glyph is half the button (8px in a 16px box), so centring means an inset
// of 4px on both axes.
//
// SCOPE WARNING: these pin the contract, but they do NOT reproduce the reported
// live failure, where tabs present at the strip's first layout keep the glyph at
// (0,0) while a tab added later centres correctly. That was confirmed in a real
// browser and does not occur under the modelled sink — live, the close button's
// own getWidth() is NaN during an early layout pass and the glyph gets pinned to
// 0,0; offline it is already sized, so every path here centres. Treat a green
// run as "the contract still holds offline", not as coverage of that bug.
import { describe, it, expect, afterEach } from 'vitest';
import { TabBar } from '~/component/container/TabBar';
import { Tab } from '~/layout/Tab';
import { Component } from '~/core/Component';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Container } from '~/core/Container';
import { Fit } from '~/layout/Fit';
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

/** Hosts the bar in a sized container and runs a real layout pass. */
function hostBar(bar: TabBar): Container {
    const host = new Container({ layoutManager: new Fit() });

    host.getElement(true);
    host.setWidth(600);
    host.setHeight(400);
    host.clearInsets();
    host.addComponent(bar);
    host.doLayout();

    return host;
}

/** The offset of the close glyph inside its close button, per entry id. */
function glyphOffset(bar: TabBar, id: string): { x: number; y: number; box: number; glyph: number } | null {
    // `_entries` is private; reached by cast, the same way Split/Accordion
    // tests drive their private drag handlers.
    const entries = (bar as unknown as { _entries: Array<{ id: string; button: { getCloseButton(): { getGlyph(): { getX(): number; getY(): number; getWidth(): number } | null; getWidth(): number } | null } }> })._entries;
    const button  = entries.find(e => e.id === id)?.button ?? null;
    const close   = button?.getCloseButton() ?? null;
    const glyph  = close?.getGlyph() ?? null;

    if (!close || !glyph) {
        return null;
    }

    return { x: glyph.getX(), y: glyph.getY(), box: close.getWidth(), glyph: glyph.getWidth() };
}

describe('tab close-glyph centring', () => {
    afterEach(() => DOM.reset());

    it('centres the glyph when the strip is driven by a Tab layout manager', () => {
        installTestDOM(CONFIG);

        const tab  = new Tab();
        const host = new Container({ layoutManager: tab });

        host.getElement(true);
        host.setWidth(600);
        host.setHeight(400);
        host.clearInsets();

        for (const name of ['Alpha', 'Beta']) {
            const child = new Component({ preferredSize: { width: 50, height: 50 } });

            child.getElement(true);
            host.addComponent(child, closeable());
        }

        host.doLayout();

        const bar = (tab as unknown as { _bar: TabBar })._bar;
        const ids = (bar as unknown as { _entries: Array<{ id: string }> })._entries.map(e => e.id);
        const off = glyphOffset(bar, ids[1]);

        expect(off).not.toBeNull();

        const expected = Math.round((off!.box - off!.glyph) / 2);

        expect({ x: off!.x, y: off!.y }).toEqual({ x: expected, y: expected });

        host.dispose();
    });

    it('centres the glyph on a tab that was present at the first layout', () => {
        installTestDOM(CONFIG);

        const bar = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());

        const host = hostBar(bar);
        const off  = glyphOffset(bar, 'a');

        expect(off).not.toBeNull();

        // Centred means (box - glyph) / 2 on both axes — derived from the
        // contract, not sampled from what the layout currently emits.
        const expected = Math.round((off!.box - off!.glyph) / 2);

        expect({ x: off!.x, y: off!.y }).toEqual({ x: expected, y: expected });

        host.dispose();
    });

    it('centres the glyph identically on a tab added after the first layout', () => {
        installTestDOM(CONFIG);

        const bar  = new TabBar();

        bar.createBarEntry('a', 'Alpha', closeable());

        const host = hostBar(bar);

        bar.createBarEntry('b', 'Beta', closeable());
        host.doLayout();

        const first = glyphOffset(bar, 'a');
        const later = glyphOffset(bar, 'b');

        expect(first).not.toBeNull();
        expect(later).not.toBeNull();

        // The reported bug: these two disagreed, the later-added tab being the
        // correct one.
        expect({ x: first!.x, y: first!.y }).toEqual({ x: later!.x, y: later!.y });

        host.dispose();
    });
});
