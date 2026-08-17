// CollapseSupport's `captureRect`/`commitRect` read and write a collapse/
// restore participant's geometry around the coordinated JS animation that
// drives `Split.setPaneCollapsed`/`Border.setRegionCollapsed`. A participant
// `LayoutManager.commitBounds` last placed via its size-stable position fast
// path has its true position riding on `getTranslateX`/`getTranslateY` while
// `getX`/`getY` report the pre-move value — this suite pins that a bystander
// participant entering a collapse in that state keeps its true position and
// does not end up with a stale leftover translate.
//
// `animateLayout` lands its participants on the captured `start` rect
// synchronously before ever scheduling a frame (see its own doc comment), and
// the offline test DOM's `requestAnimationFrame` swallows its callback (never
// invokes it — see TestDOM's own comment on why fallback timers, not rAF,
// drive animations offline), so a component's geometry is permanently stuck
// at that synchronous `start` landing in this harness. That landing is
// exactly where the bug lives — `captureRect`'s `start` snapshot must fold a
// pre-existing translate in, and `commitRect`'s write must reset it — so it
// is fully exercised without needing to reach (unreachable, offline) the
// animation's `end` state.
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { Split } from '~/layout/Split';
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

describe('CollapseSupport translate-fold correctness', () => {
    afterEach(() => DOM.reset());

    it('folds a bystander pane\'s incoming translate into the collapse landing and resets it', () => {
        installTestDOM(CONFIG);

        const split     = new Split({ orientation: 'horizontal' });
        const container = new Container({ layoutManager: split });

        container.getElement(true);
        container.setWidth(400);
        container.setHeight(300);
        container.clearInsets();

        for (let i = 0; i < 3; i += 1) {
            const pane = new Component({ preferredSize: { width: 50, height: 50 } });
            pane.getElement(true);
            container.addComponent(pane);
        }

        container.doLayout();

        const panes = container.getComponents();

        // Pane 2 enters the collapse already mid-fast-path: a prior
        // commitBounds call left its real left/top stale and its true
        // position riding on translate. Collapsing pane 0 (not pane 2) keeps
        // the toggled pane and the bystander distinct — `paneServingGutter`
        // only allows collapsing a pane with a later sibling under the
        // default collapse direction, so pane 0 is the only valid toggle
        // target here and pane 2 is an uninvolved bystander.
        const bystander = panes[2];
        const dx = 7, dy = -3;
        bystander.setTranslate(dx, dy);

        const trueXBefore = bystander.getX() + dx;
        const trueYBefore = bystander.getY() + dy;

        split.setPaneCollapsed(0, true);

        // The landing must preserve the true (translate-folded) position —
        // not silently drop the translate and snap back to the stale
        // pre-move `left`/`top` — and must not leave the translate dangling
        // to double-offset the now-resolved position.
        expect(bystander.getX()).toBe(trueXBefore);
        expect(bystander.getY()).toBe(trueYBefore);
        expect(bystander.getTranslateX()).toBe(0);
        expect(bystander.getTranslateY()).toBe(0);

        container.dispose();
    });
});
