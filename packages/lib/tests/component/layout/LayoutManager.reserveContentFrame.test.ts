// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `LayoutManager.reserveContentFrame`'s early return on a host that scrolls on
 * neither axis. Such a host clears any frame it has and keeps none, so the walk
 * that reads every child's committed geometry only to discard the result is
 * wasted; the frame is reserved for a scroll-enabled host, which takes the
 * unchanged path. Case E4 of `plans/implemented/layout-size-read-economy.md`.
 *
 * Modelled on `LayoutManager.resolveBounds.test.ts`'s `CONFIG` bag and rendered
 * `Container` host.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { VBox } from '~/layout/VBox';
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

/** The host's box — taller and wider than the stack, so nothing clamps or overflows on its own. */
const HOST_WIDTH  = 400;
const HOST_HEIGHT = 300;

/** Each leaf's preferred size; the two stack to a 100x40 content extent. */
const LEAF_WIDTH  = 100;
const LEAF_HEIGHT = 20;

/** The stacked leaves' far edge, which a scrolling host reserves as its frame. */
const CONTENT_WIDTH  = LEAF_WIDTH;
const CONTENT_HEIGHT = LEAF_HEIGHT * 2;

interface Scene {
    host: Container;
    box:  VBox;
    a:    Component;
    b:    Component;
}

/**
 * A rendered, inset-free host stacking two leaves, laid out once so every
 * child's geometry is committed.
 *
 * @returns The host, its manager and the two leaves.
 */
function makeScene(): Scene {
    const box  = new VBox({ spacing: 0 });
    const host = new Container({ layoutManager: box });
    const a    = new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } });
    const b    = new Component({ preferredSize: { width: LEAF_WIDTH, height: LEAF_HEIGHT } });

    host.getElement(true);
    host.clearInsets();
    host.setWidth(HOST_WIDTH);
    host.setHeight(HOST_HEIGHT);

    host.addComponent(a);
    host.addComponent(b);
    host.doLayout();

    return { host, box, a, b };
}

describe('LayoutManager.reserveContentFrame skips the child walk on a non-scrolling host', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('E4a: a host that scrolls on neither axis clears its frame without reading a child', () => {
        installTestDOM(CONFIG);

        const { host, box, a } = makeScene();

        expect(a.getY()).toBe(0);

        const laidOut    = vi.spyOn(host, 'getLaidOutComponents');
        const translateX = vi.spyOn(a, 'getTranslateX');
        const clear      = vi.spyOn(host, 'clearContentFrame');
        const set        = vi.spyOn(host, 'setContentFrame');

        (box as any).reserveContentFrame();

        expect(laidOut).toHaveBeenCalledTimes(0);
        expect(translateX).toHaveBeenCalledTimes(0);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledTimes(0);
    });

    it('E4b: a scroll-enabled host still walks its children and sizes the frame to them', () => {
        installTestDOM(CONFIG);

        const { host, box } = makeScene();

        box.setOverflowing(false, true);

        const laidOut = vi.spyOn(host, 'getLaidOutComponents');
        const set     = vi.spyOn(host, 'setContentFrame');

        (box as any).reserveContentFrame();

        expect(laidOut).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledTimes(1);
        expect(set).toHaveBeenCalledWith(CONTENT_WIDTH, CONTENT_HEIGHT);
    });
});
