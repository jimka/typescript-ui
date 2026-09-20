import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Absolute } from '~/layout/Absolute';
import { DOM } from '~/core/DOM';
import { installTestDOM, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

function hostAbsolute(width: number, height: number): Container {
    const host = new Container({ layoutManager: new Absolute() });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('Absolute', () => {
    afterEach(() => DOM.reset());

    it('doLayout() does not throw without a container', () => {
        expect(() => new Absolute().doLayout()).not.toThrow();
    });

    it('passes each child through at its own position and preferred size', () => {
        installTestDOM(CONFIG);

        const host = hostAbsolute(300, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child);
        child.setX(17);
        child.setY(33);

        host.doLayout();

        // Contract: Absolute copies inputs through, bypassing the cell clamp.
        expect(child.getX()).toBe(17);
        expect(child.getY()).toBe(33);
        expect(child.getWidth()).toBe(40);
        expect(child.getHeight()).toBe(25);
    });

    it('commits a child larger than the container at its full preferred size', () => {
        installTestDOM(CONFIG);

        const host = hostAbsolute(100, 100);
        const child = new Component({ preferredSize: { width: 500, height: 400 } });

        host.addComponent(child);
        child.setX(0);
        child.setY(0);

        host.doLayout();

        // No clamp: oversized children keep their full size so a scroll host can scroll them.
        expect(child.getWidth()).toBe(500);
        expect(child.getHeight()).toBe(400);
    });
});

// plans/implemented/nan-sentinel-dom-writes.md. `Absolute` reads each child's
// own `getX()`/`getY()` as its target, so a child nobody ever positioned is
// committed at the "never assigned" NaN seed those accessors still hold. That
// made `LayoutManager.commitBounds`' `positionUnchanged` false forever, so its
// size-stable fast path engaged on every settled pass, writing
// `transform: translate3d(NaNpx,NaNpx,0)` and pinning `will-change: transform`
// on a layer nothing ever demoted. The browser discards a NaN declaration, so
// the rendered result was correct throughout — only the writes show the bug,
// which is why these cases assert on what reached the sink and on the cached
// hints rather than on geometry.
describe('Absolute — a child no layout manager ever positioned', () => {
    afterEach(() => DOM.reset());

    // Three passes, because the fast path can only engage from the second: the
    // first commit is a size change (the cached size starts NaN too), and the
    // third is what shows an engaged fast path never releasing itself.
    const SETTLED_PASSES = 3;

    /** A rendered host holding one sized-but-never-positioned child. */
    function unpositionedChild(): { host: Container; child: Component } {
        const host  = hostAbsolute(300, 200);
        const child = new Component({ preferredSize: { width: 40, height: 25 } });

        host.addComponent(child);

        return { host, child };
    }

    /** The `transform` values written to `handle`'s inline style in `writes`, in order. */
    function transformWrites(writes: RecordingDOMSink['writes'], handle: unknown): Array<string | null> {
        return writes
            .filter(w => w.op === 'apply' && w.args[0] === handle)
            .map(w => (w.args[1] as { style?: Record<string, string | null> }).style)
            .filter((style): style is Record<string, string | null> => style !== undefined && 'transform' in style)
            .map(style => style.transform);
    }

    it('writes no transform declaration across three settled passes', () => {
        const sink = installTestDOM(CONFIG);

        const { host, child } = unpositionedChild();
        const handle = child.getElement();

        // A child with no element would make setTranslate early-return for an
        // unrelated reason, leaving this case vacuous.
        expect(handle).toBeTruthy();

        const start = sink.writes.length;

        for (let pass = 0; pass < SETTLED_PASSES; pass++) {
            host.doLayout();
        }

        expect(transformWrites(sink.writes.slice(start), handle)).toEqual([]);
    });

    it('leaves will-change unset and the translate cache at zero after every pass', () => {
        installTestDOM(CONFIG);

        const { host, child } = unpositionedChild();

        for (let pass = 0; pass < SETTLED_PASSES; pass++) {
            host.doLayout();

            expect(child.getWillChange()).toBeNull();
            expect(child.getTranslateX()).toBe(0);
            expect(child.getTranslateY()).toBe(0);
        }
    });

    it('still reports an unset position afterwards — the gate must not invent one', () => {
        installTestDOM(CONFIG);

        const { host, child } = unpositionedChild();

        for (let pass = 0; pass < SETTLED_PASSES; pass++) {
            host.doLayout();
        }

        // Committing such a child at (0,0) would move it off its static
        // position, which is the geometry change this fix must not make.
        expect(Number.isNaN(child.getX())).toBe(true);
        expect(Number.isNaN(child.getY())).toBe(true);
    });
});
