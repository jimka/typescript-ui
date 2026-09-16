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
