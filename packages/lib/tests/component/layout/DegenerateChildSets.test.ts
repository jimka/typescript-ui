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
// `## Expected Behaviour` tables (G1-G4, B1-B9, C1-C7), plus C8-C10, which that
// plan's Implementation Notes add for the removals that are the midpoint of a
// `moveComponent` or `replaceComponent` rather than a departure.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Grid } from '~/layout/Grid';
import { HBox } from '~/layout/HBox';
import { VBox } from '~/layout/VBox';
import { Card } from '~/layout/Card';
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

describe('Card — the visible child is removed', () => {
    it('C1: promotes the first remaining child and sizes to it', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();

        expect(card.getVisibleComponent()).toBe(first);

        const firstLayout = vi.spyOn(first, 'doLayout');

        container.removeComponent(first);
        container.doLayout();

        expect(card.getVisibleComponent()).toBe(second);
        expect(second.isDisplayed()).toBe(true);
        expect(firstLayout).not.toHaveBeenCalled();
        expect(card.getPreferredSize()).toEqual({ width: 60, height: 30 });
    });

    it('C2: writes no display state to the child that left', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();

        const firstDisplayed = vi.spyOn(first, 'setDisplayed');

        container.removeComponent(first);
        container.doLayout();

        // Whatever displayed state the removal found, the card leaves alone:
        // the child has left `getComponents()`, so `syncVisible` cannot reach
        // it, and a re-homing caller keeps the child it detached. Here that
        // means the child the card was showing is still displayed; a removed
        // *inactive* child stays undisplayed for the caller to re-display, the
        // case `docs/concepts/performance.md` documents.
        expect(firstDisplayed).not.toHaveBeenCalled();
        expect(first.isDisplayed()).toBe(true);
    });

    it('C3: reports nothing visible once its only child is removed', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const only = new Component({ preferredSize: { width: 40, height: 20 } });

        container.addComponent(only);
        container.doLayout();
        container.removeComponent(only);

        expect(card.getVisibleComponent()).toBeNull();
        expect(card.getPreferredSize()).toBeNull();
        expect(() => container.doLayout()).not.toThrow();
    });

    it('C4: removing a non-visible sibling writes no display state at all', () => {
        installTestDOM(CONFIG);

        const spare  = new Component({ preferredSize: { width: 40, height: 20 } });
        const shown  = new Component({ preferredSize: { width: 60, height: 30 } });
        const card = new Card({ visibleComponentId: shown.getId() });
        const container = hostWith(300, 200, card);

        container.addComponent(spare);
        container.addComponent(shown);
        container.doLayout();

        const spareDisplayed = vi.spyOn(spare, 'setDisplayed');

        container.removeComponent(spare);

        expect(card.getVisibleComponent()).toBe(shown);
        expect(shown.isDisplayed()).toBe(true);
        expect(spareDisplayed).not.toHaveBeenCalled();
    });

    it('C5: survives losing every child at once', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);

        container.addComponent(new Component({ preferredSize: { width: 40, height: 20 } }));
        container.addComponent(new Component({ preferredSize: { width: 60, height: 30 } }));
        container.doLayout();

        container.removeAllComponents();

        expect(card.getVisibleComponent()).toBeNull();
        expect(() => container.doLayout()).not.toThrow();
    });

    it('C6: a manager that does not implement the hook is unaffected', () => {
        installTestDOM(CONFIG);

        const container = hostWith(400, 100, new HBox());
        const doomed    = new Component({ preferredSize: { width: 30, height: 10 } });
        const survivor  = new Component({ preferredSize: { width: 50, height: 20 } });

        container.addComponent(doomed);
        container.addComponent(survivor);
        container.doLayout();

        expect(() => container.removeComponent(doomed)).not.toThrow();

        container.doLayout();

        expect(survivor.getWidth()).toBe(50);
        // `commitBounds` moves a same-size child by translate rather than by
        // rewriting `left`, so the visual origin is position plus translate.
        expect(survivor.getX() + survivor.getTranslateX()).toBe(0);
    });

    it('C7: drops the scroll restore parked for a child that is then removed', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();
        card.setVisibleComponentId(second.getId());

        const secondRestore = vi.spyOn(second, 'restoreSubtreeScroll');

        container.removeComponent(second);
        container.doLayout();

        expect(secondRestore).not.toHaveBeenCalled();
        expect(first.isDisplayed()).toBe(true);

        const inner = container.getInnerSize()!;

        expect(first.getWidth()).toBe(inner.width);
        expect(first.getHeight()).toBe(inner.height);
    });

    it('C8: an intra-container reorder leaves exactly one child displayed', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();

        // moveComponent is built on removeComponent + insertComponent, so the
        // removal here is the midpoint of an atomic move, not a departure.
        container.moveComponent(first, 1);
        container.doLayout();

        const displayed = container.getComponents().filter((c) => c.isDisplayed());

        expect(displayed).toEqual([card.getVisibleComponent()]);
        // With no visibleComponentId set the resolution rule is "the first
        // child", which the reorder has made `second`.
        expect(card.getVisibleComponent()).toBe(container.getComponents()[0]);
    });

    it('C9: a replaced visible child hands the slot to its replacement alone', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });
        const fresh  = new Component({ preferredSize: { width: 50, height: 25 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();

        // replaceComponent composes the same two mutators, so this is the same
        // transient removal as C8 with a different component coming back.
        container.replaceComponent(first, fresh);
        container.doLayout();

        const displayed = container.getComponents().filter((c) => c.isDisplayed());

        expect(card.getVisibleComponent()).toBe(fresh);
        expect(displayed).toEqual([fresh]);
    });

    it('C10: moving the visible child out promotes a sibling and keeps the mover shown', () => {
        installTestDOM(CONFIG);

        const card = new Card();
        const container = hostWith(300, 200, card);
        const destination = hostWith(300, 200, new HBox());
        const first  = new Component({ preferredSize: { width: 40, height: 20 } });
        const second = new Component({ preferredSize: { width: 60, height: 30 } });

        container.addComponent(first);
        container.addComponent(second);
        container.doLayout();

        destination.moveComponent(first);
        container.doLayout();
        destination.doLayout();

        expect(card.getVisibleComponent()).toBe(second);
        expect(container.getComponents().filter((c) => c.isDisplayed())).toEqual([second]);
        // A real departure: the card never wrote to the child, so it arrives at
        // its new home still displayed.
        expect(first.isDisplayed()).toBe(true);
    });
});
