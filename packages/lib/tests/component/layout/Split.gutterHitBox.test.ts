// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Hit-box geometry for SplitGutter's fixed 10px overhang element, split out
// from Split.test.ts, which scopes to pane ratio/collapse STATE and treats
// deeper gutter geometry as a Non-Goal (see that file's header comment).
// The element reserves no main-axis space of its own — the reserved gap
// between panes is `Split`'s own configurable `spacing`, covered separately
// in Split.spacing.test.ts.
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

/** The gutter element's fixed main-axis thickness: 2 × GUTTER_HIT_OVERHANG. */
const GUTTER_HIT_SIZE = 10;

/** Half the fixed hit size — how far the element straddles into each neighbour. */
const GUTTER_HIT_OVERHANG = 5;

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

describe('SplitGutter hit-box geometry', () => {
    afterEach(() => DOM.reset());

    it('defaults spacing to 0, so panes touch at the boundary', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();

        expect(split.getComponentSpacing()).toBe(0);
        expect(leadingPane.getX() + leadingPane.getWidth()).toBe(nextPane.getX());
        expect(leadingPane.getWidth() + nextPane.getWidth()).toBe(host.getInnerSize()!.width);
    });

    it('sizes a movable horizontal gutter to exactly 10px, straddling the pane boundary 5px into each neighbour', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];
        const boundary = (leadingPane.getX() + leadingPane.getWidth() + nextPane.getX()) / 2;

        expect(gutter.getWidth()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getX()).toBe(boundary - GUTTER_HIT_OVERHANG);
        expect(gutter.getX() + gutter.getWidth()).toBe(boundary + GUTTER_HIT_OVERHANG);
        expect(gutter.getHeight()).toBe(leadingPane.getHeight());
    });

    it('sizes a movable vertical gutter the same way on y/height, leaving crossSize (width) alone', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'vertical' }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];
        const boundary = (leadingPane.getY() + leadingPane.getHeight() + nextPane.getY()) / 2;

        expect(gutter.getHeight()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getY()).toBe(boundary - GUTTER_HIT_OVERHANG);
        expect(gutter.getY() + gutter.getHeight()).toBe(boundary + GUTTER_HIT_OVERHANG);
        expect(gutter.getWidth()).toBe(leadingPane.getWidth());
    });

    it('reaches a configured gap without growing the gutter element (horizontal)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal', spacing: 12 }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];
        const boundary = leadingPane.getX() + leadingPane.getWidth();

        expect(nextPane.getX() - boundary).toBe(12);
        expect(gutter.getWidth()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getX()).toBe(boundary + 6 - GUTTER_HIT_OVERHANG);
    });

    it('reaches a configured gap without growing the gutter element (vertical)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'vertical', spacing: 12 }), 2);
        const [leadingPane, nextPane] = host.getLaidOutComponents();
        const gutter = gutters(split)[0];
        const boundary = leadingPane.getY() + leadingPane.getHeight();

        expect(nextPane.getY() - boundary).toBe(12);
        expect(gutter.getHeight()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getY()).toBe(boundary + 6 - GUTTER_HIT_OVERHANG);
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

    it('keeps its 10px box and drops pointer events once locked via setMovable(false)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        gutter.setMovable(false);
        host.doLayout();

        expect(gutter.getWidth()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getPointerEvents()).toBe('none');
    });

    it('clears the locked pointer-events override, keeping the same 10px box, once unlocked via setMovable(true)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        gutter.setMovable(false);
        host.doLayout();

        gutter.setMovable(true);
        host.doLayout();

        expect(gutter.getWidth()).toBe(GUTTER_HIT_SIZE);
        expect(gutter.getPointerEvents()).toBeNull();
    });

    it('carries a z-index of exactly 1', () => {
        installTestDOM(CONFIG);

        const { split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        expect(gutter.getZIndex()).toBe(1);
    });

    it('drops pointer events from construction when built non-movable, as every Border gutter is', () => {
        const gutter = new SplitGutter('horizontal', { movable: false });

        expect(gutter.getPointerEvents()).toBe('none');
    });

    it('leaves pointer events unset from construction when left movable (the Split default), so a viewport drag suppression rule still reaches it', () => {
        const gutter = new SplitGutter('horizontal');

        expect(gutter.getPointerEvents()).toBeNull();
    });
});
