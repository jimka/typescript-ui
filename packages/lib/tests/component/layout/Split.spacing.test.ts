// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for Split's `spacing` option: the configurable pane gap that
// replaced the old fixed 4px `GUTTER_SIZE` reserve. Split out from
// Split.gutterHitBox.test.ts, which covers the gutter *element*'s own fixed
// 10px geometry — this file covers the *gap* the option reserves between
// panes, independently of the gutter box.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
import { SplitGutter } from '~/component/container/SplitGutter';
import { COLLAPSE_STRIP_SIZE } from '~/layout/CollapseSupport';
import { Insets } from '~/primitive/Insets';
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

describe('Split spacing option', () => {
    afterEach(() => DOM.reset());

    it('marks the layout pass as owed and reaches the next pass', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);

        expect(host.isLayoutDirty()).toBe(false);

        split.setComponentSpacing(8);
        expect(host.isLayoutDirty()).toBe(true);

        host.doLayout();
        const [leadingPane, nextPane] = host.getLaidOutComponents();

        expect(nextPane.getX() - (leadingPane.getX() + leadingPane.getWidth())).toBe(8);
    });

    it('keeps the option and its accessors in agreement', () => {
        expect(new Split({ spacing: 7 }).getComponentSpacing()).toBe(7);
        expect(new Split().setComponentSpacing(3).getComponentSpacing()).toBe(3);
        expect(new Split().getComponentSpacing()).toBe(0);
    });

    it('returns a collapsed pane to the exact 10px divider on restore (horizontal)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'horizontal' }), 2);
        const gutter = gutters(split)[0];

        split.setPaneCollapsedImmediate(0, true);
        host.doLayout();
        expect(gutter.getWidth()).toBe(COLLAPSE_STRIP_SIZE);

        split.setPaneCollapsedImmediate(0, false);
        host.doLayout();
        expect(gutter.getWidth()).toBe(GUTTER_HIT_SIZE);
    });

    it('returns a collapsed pane to the exact 10px divider on restore (vertical)', () => {
        installTestDOM(CONFIG);

        const { host, split } = hostSplit(new Split({ orientation: 'vertical' }), 2);
        const gutter = gutters(split)[0];

        split.setPaneCollapsedImmediate(0, true);
        host.doLayout();
        expect(gutter.getHeight()).toBe(COLLAPSE_STRIP_SIZE);

        split.setPaneCollapsedImmediate(0, false);
        host.doLayout();
        expect(gutter.getHeight()).toBe(GUTTER_HIT_SIZE);
    });

    it("contributes the same pane and gutter geometry whether or not a neighbour paints a background", () => {
        installTestDOM(CONFIG);

        const insets = new Insets(4, 4, 4, 4);

        const unpaintedSplit = new Split({ orientation: 'horizontal' });
        const { host: unpaintedHost } = hostSplitWithInsetPanes(unpaintedSplit, insets, false);
        const [unpaintedA, unpaintedB] = unpaintedHost.getLaidOutComponents();

        const paintedSplit = new Split({ orientation: 'horizontal' });
        const { host: paintedHost } = hostSplitWithInsetPanes(paintedSplit, insets, true);
        const [paintedA, paintedB] = paintedHost.getLaidOutComponents();

        expect({ x: unpaintedA.getX(), width: unpaintedA.getWidth() })
            .toEqual({ x: paintedA.getX(), width: paintedA.getWidth() });
        expect({ x: unpaintedB.getX(), width: unpaintedB.getWidth() })
            .toEqual({ x: paintedB.getX(), width: paintedB.getWidth() });

        const unpaintedGutter = gutters(unpaintedSplit)[0];
        const paintedGutter   = gutters(paintedSplit)[0];

        expect({ x: unpaintedGutter.getX(), width: unpaintedGutter.getWidth() })
            .toEqual({ x: paintedGutter.getX(), width: paintedGutter.getWidth() });

        expect(unpaintedA.getBackgroundColor()).toBeNull();
        expect(paintedA.getBackgroundColor()).not.toBeNull();
    });
});

/** Two panes carrying `insets`, one pair painting a background and one not. */
function hostSplitWithInsetPanes(split: Split, insets: Insets, painted: boolean): { host: Container } {
    const host = new Container({ layoutManager: split });

    host.getElement(true);
    host.setWidth(400);
    host.setHeight(300);

    for (let i = 0; i < 2; i += 1) {
        host.addComponent(new Component({
            preferredSize:   { width: 50, height: 50 },
            insets,
            ...(painted ? { backgroundColor: 'red' } : {}),
        }));
    }

    host.doLayout();

    return { host };
}
