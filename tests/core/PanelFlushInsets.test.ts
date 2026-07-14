// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

//
// Offline coverage for Panel's `flush` construction option — a
// construction-time default selector that seeds zero content insets for
// rail-style containers instead of the standard (4, 4, 4, 4) default. See
// plans/implemented/rail-container-zero-insets.md.
//
import { describe, it, expect, afterEach } from 'vitest';
import { _Panel } from '~/core/Panel';
import { Insets } from '~/primitive/Insets';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Border } from '~/layout/Border';
import { Fit } from '~/layout/Fit';
import { LayoutConstraints } from '~/layout/LayoutConstraints';
import { Placement } from '~/primitive/Placement';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Asserts an Insets reports the given (top, right, bottom, left) values. */
function expectInsets(insets: Insets, top: number, right: number, bottom: number, left: number): void {
    expect(insets.getTop()).toBe(top);
    expect(insets.getRight()).toBe(right);
    expect(insets.getBottom()).toBe(bottom);
    expect(insets.getLeft()).toBe(left);
}

describe('Panel — flush construction option', () => {
    it('flush: true zeroes the default insets', () => {
        const panel = new _Panel({ flush: true });
        expectInsets(panel.getInsets(), 0, 0, 0, 0);
        expectInsets(panel.getContentInsets(), 0, 0, 0, 0);
    });

    it('flush omitted keeps the 4px default', () => {
        const panel = new _Panel();
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });

    it('flush: false keeps the 4px default', () => {
        const panel = new _Panel({ flush: false });
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });

    it('an explicit insets wins over flush: true', () => {
        const panel = new _Panel({ flush: true, insets: new Insets(2, 2, 2, 2) });
        expectInsets(panel.getInsets(), 2, 2, 2, 2);
    });

    it('an explicit insets wins without flush too', () => {
        const panel = new _Panel({ insets: new Insets(1, 1, 1, 1) });
        expectInsets(panel.getInsets(), 1, 1, 1, 1);
    });

    it('does not mutate the shared default insets', () => {
        new _Panel({ flush: true });
        const panel = new _Panel();
        expectInsets(panel.getInsets(), 4, 4, 4, 4);
    });
});

describe('Panel — flush rail composes with a Border-hosted layout', () => {
    afterEach(() => DOM.reset());

    it('a flush rail reports its child\'s bare preferred width and holds it across a sibling collapse/expand', () => {
        installTestDOM(CONFIG);

        const border = new Border();
        const host   = new Container({ layoutManager: border });
        host.getElement(true);
        host.setWidth(400);
        host.setHeight(300);
        host.clearInsets();

        // A rail whose own width is *derived* from its content (a Fit layout
        // manager reporting the child's preferred size plus the rail's own
        // perimeter) — the shape a real activity rail takes, as opposed to a
        // rail with an explicit fixed preferredSize (which insets can't
        // perturb regardless of `flush`). Without `flush` this would report
        // 40 + 4 + 4 = 48; `flush: true` keeps it at the child's bare 40.
        const rail  = new _Panel({ flush: true, layoutManager: new Fit() });
        const child = new Component({ preferredSize: { width: 40, height: 20 } });
        rail.addComponent(child);

        const north = new Component({ preferredSize: { width: 0, height: 30 } });

        host.addComponent(rail, Object.assign(new LayoutConstraints(), { placement: Placement.WEST }));
        host.addComponent(north, Object.assign(new LayoutConstraints(), { placement: Placement.NORTH, collapsible: true }));

        host.doLayout();
        expect(rail.getWidth()).toBe(40);

        // Collapsing/restoring the unrelated NORTH region must not perturb the
        // WEST rail's width — the regression the removed sqladmin
        // `setInsets(0,0,0,0)` workaround guarded against.
        border.setRegionCollapsed(Placement.NORTH, true);
        expect(rail.getWidth()).toBe(40);

        border.setRegionCollapsed(Placement.NORTH, false);
        expect(rail.getWidth()).toBe(40);
    });
});
