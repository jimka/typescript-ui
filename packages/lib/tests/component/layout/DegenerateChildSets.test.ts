// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// Coverage for layout managers handed a degenerate child set — one that has
// gone empty, or one a child has just left. Both are ordinary at runtime:
// `getLaidOutComponents()` filters on `isDisplayed()`, so undisplaying the last
// visible child (an inactive tab page, a collapsed pane) leaves a container
// with children reporting none, and `removeComponent` can take away the very
// child a manager parked a reference to.
//
// Cases are numbered to match `plans/implemented/layout-flush-degenerate-inputs.md`'s
// `## Expected Behaviour` tables (G1-G4, B1-B9, C1-C7).
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Grid } from '~/layout/Grid';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { Insets } from '~/primitive/Insets';
import type { LayoutManager } from '~/layout/LayoutManager';
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

afterEach(() => DOM.reset());

/**
 * Builds a Container hosting `manager`, rendered, sized and inset-cleared so
 * its perimeter is zero on both axes — every size report below is then the
 * manager's own contribution with nothing added. Mirrors `Grid.test.ts`'s
 * `hostGrid`, widened to any manager.
 */
function hostWith(width: number, height: number, manager: LayoutManager): Container {
    const container = new Container({ layoutManager: manager });

    container.getElement(true);
    container.setWidth(width);
    container.setHeight(height);
    container.clearInsets();

    return container;
}

describe('Grid — no laid-out children', () => {
    it('G1: an empty auto grid has no tracks and reports the host perimeter', () => {
        installTestDOM(CONFIG);

        const grid = new Grid();
        const container = hostWith(300, 200, grid);

        expect(grid.getColRowCount()).toEqual({ width: 0, height: 0 });
        expect(grid.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(grid.getMinSize()).toEqual({ width: 0, height: 0 });
        expect(grid.getMaxSize()).toEqual({ width: 0, height: 0 });
        expect(() => container.doLayout()).not.toThrow();
    });

    it('G2: an auto grid whose only child was undisplayed behaves exactly as an empty one', () => {
        installTestDOM(CONFIG);

        const grid = new Grid();
        const container = hostWith(300, 200, grid);
        const child = new Component({ preferredSize: { width: 40, height: 20 } });

        container.addComponent(child);
        child.setDisplayed(false);

        expect(grid.getColRowCount()).toEqual({ width: 0, height: 0 });
        expect(grid.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(grid.getMinSize()).toEqual({ width: 0, height: 0 });
        expect(grid.getMaxSize()).toEqual({ width: 0, height: 0 });
        expect(() => container.doLayout()).not.toThrow();
    });

    it('G3: an explicitly-columned empty grid reports no stray spacing gap', () => {
        installTestDOM(CONFIG);

        const grid = new Grid({ columns: 2 });
        const container = hostWith(300, 200, grid);

        expect(grid.getColRowCount()).toEqual({ width: 0, height: 0 });
        expect(grid.getPreferredSize()!.width).toBe(0);
    });

    it('G4: a populated auto grid still infers its square track counts', () => {
        installTestDOM(CONFIG);

        const grid = new Grid();
        const container = hostWith(300, 200, grid);

        for (let i = 0; i < 9; i += 1) {
            container.addComponent(new Component({ preferredSize: { width: 10, height: 10 } }));
        }

        expect(grid.getColRowCount()).toEqual({ width: 3, height: 3 });
    });
});

describe('HBox / VBox — no laid-out children', () => {
    it('B1: an empty HBox reports the host perimeter on both axes', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();

        hostWith(300, 200, hbox);

        expect(hbox.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(hbox.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('B2: an empty VBox reports a zero width, not the unbounded sentinel', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox();

        hostWith(300, 200, vbox);

        expect(vbox.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(vbox.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('B3: "equal" mode reports the same for an empty HBox and an empty VBox', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox({ mode: 'equal' });
        const vbox = new VBox({ mode: 'equal' });

        hostWith(300, 200, hbox);
        hostWith(300, 200, vbox);

        expect(hbox.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(hbox.getMinSize()).toEqual({ width: 0, height: 0 });
        expect(vbox.getPreferredSize()).toEqual({ width: 0, height: 0 });
        expect(vbox.getMinSize()).toEqual({ width: 0, height: 0 });
    });

    it('B4: an empty VBox in an inset host reports exactly that perimeter', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox();
        const container = hostWith(300, 200, vbox);

        // 4 px on every side: the smallest perimeter that still distinguishes
        // "the insets are added back" from "the report happens to be zero".
        container.setInsets(new Insets(4, 4, 4, 4));

        expect(vbox.getPreferredSize()).toEqual({ width: 8, height: 8 });
        expect(vbox.getMinSize()).toEqual({ width: 8, height: 8 });
    });

    it('B5: a populated HBox still sums its children and the gaps between them', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const container = hostWith(400, 100, hbox);

        for (let i = 0; i < 3; i += 1) {
            container.addComponent(new Component({ preferredSize: { width: 30, height: 20 } }));
        }

        expect(hbox.getPreferredSize()!.width).toBe(100);
    });

    it('B6: a populated "equal" VBox still sizes every cell to the tallest child', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox({ mode: 'equal' });
        const container = hostWith(400, 200, vbox);

        container.addComponent(new Component({ preferredSize: { width: 40, height: 20 } }));
        container.addComponent(new Component({ preferredSize: { width: 40, height: 30 } }));

        expect(vbox.getPreferredSize()!.height).toBe(65);
    });

    it('B7: an empty nested container takes no width from its siblings', () => {
        installTestDOM(CONFIG);

        const container = hostWith(400, 100, new HBox());
        const leading  = new Component({ preferredSize: { width: 50, height: 20 } });
        const empty    = new Container({ layoutManager: new VBox() });
        const trailing = new Component({ preferredSize: { width: 50, height: 20 } });

        empty.clearInsets();
        container.addComponent(leading);
        container.addComponent(empty);
        container.addComponent(trailing);
        container.doLayout();

        expect(leading.getWidth()).toBe(50);
        expect(trailing.getWidth()).toBe(50);
        expect(empty.getWidth()).toBe(0);
    });

    it('B8: a nested container emptied at runtime leaves its siblings alone', () => {
        installTestDOM(CONFIG);

        const container = hostWith(400, 100, new HBox());
        const leading  = new Component({ preferredSize: { width: 50, height: 20 } });
        const emptied  = new Container({ layoutManager: new VBox() });
        const trailing = new Component({ preferredSize: { width: 50, height: 20 } });
        const doomed   = new Component({ preferredSize: { width: 30, height: 10 } });

        emptied.clearInsets();
        emptied.addComponent(doomed);
        container.addComponent(leading);
        container.addComponent(emptied);
        container.addComponent(trailing);
        container.doLayout();

        emptied.removeComponent(doomed);
        container.doLayout();

        expect(leading.getWidth()).toBe(50);
        expect(trailing.getWidth()).toBe(50);
    });

    it('B9: a populated VBox still reports its widest child across the cross axis', () => {
        installTestDOM(CONFIG);

        const vbox = new VBox();
        const container = hostWith(400, 200, vbox);

        container.addComponent(new Component({ preferredSize: { width: 20, height: 10 } }));
        container.addComponent(new Component({ preferredSize: { width: 40, height: 10 } }));

        expect(vbox.getPreferredSize()!.width).toBe(40);
    });
});
