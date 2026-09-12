// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Hit-box geometry for a movable SplitGutter's widened grab area, split out
// from Split.test.ts, which scopes to pane ratio/collapse STATE and treats
// deeper gutter geometry as a Non-Goal (see that file's header comment).
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { SplitGutter } from '~/component/container/SplitGutter';
import { COLLAPSE_STRIP_SIZE } from '~/layout/CollapseSupport';
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

function hostSplit(split: Split, paneCount: number): { host: Container; split: Split } {
    const host = new Container({ layoutManager: split });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);

    for (let i = 0; i < paneCount; i += 1) {
        host.addComponent(new Component({ preferredSize: { width: 50, height: 50 } }));
    }

    host.doLayout();

    return { host, split };
}

/** `_gutters` is non-public; every gutter-geometry probe goes through here. */
function gutters(split: Split): SplitGutter[] {
    return (split as unknown as { _gutters: SplitGutter[] })._gutters;
}

describe('SplitGutter hit-box widening', () => {
    afterEach(() => DOM.reset());

    it('widens a movable horizontal gutter past the 4px divider, centred on the pane boundary', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];

        // The boundary line is the midpoint of the untouched gap between the
        // two panes (their own reported edges), not a hardcoded overhang or
        // gutter-size literal — this is invariant whether or not the box is
        // widened, so it also equals where the plain 4px divider used to sit.
        const boundary = (leadingPane.getX() + leadingPane.getWidth() + nextPane.getX()) / 2;

        expect(gutter.getWidth()).toBeGreaterThan(4);
        expect(gutter.getX() + gutter.getWidth() / 2).toBeCloseTo(boundary, 5);
    });

    it('widens a movable vertical gutter the same way on y/height, leaving crossSize (width) alone', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'vertical' }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];
        const boundary = (leadingPane.getY() + leadingPane.getHeight() + nextPane.getY()) / 2;

        expect(gutter.getHeight()).toBeGreaterThan(4);
        expect(gutter.getY() + gutter.getHeight() / 2).toBeCloseTo(boundary, 5);
        expect(gutter.getWidth()).toBe(leadingPane.getWidth());
    });

    it('reports exactly 4px (GUTTER_SIZE) with no overhang once locked via setMovable(false)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        gutter.setMovable(false);
        host.doLayout();

        expect(gutter.getWidth()).toBe(4);
    });

    it("keeps a collapsed pane's serving gutter at exactly COLLAPSE_STRIP_SIZE regardless of isMovable()", () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        split.setPaneCollapsedImmediate(0, true);
        host.doLayout();

        expect(gutter.isMovable()).toBe(true);
        expect(gutter.getWidth()).toBe(COLLAPSE_STRIP_SIZE);
    });

    it('shrinks a movable gutter back to 4px on the very next layout after a live lock — no stale widened box', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        expect(gutter.getWidth()).toBeGreaterThan(4);

        gutter.setMovable(false);
        host.scheduleLayout();
        host.doLayout();

        expect(gutter.getWidth()).toBe(4);
    });
});
