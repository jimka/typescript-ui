// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * `LayoutManager.commitBounds`'s size-stable position fast path: when a
 * child's committed `[width, height]` don't change between two `doLayout`
 * passes, the position move is written as a compositor-only `transform`
 * (via {@link Component.setTranslate}) instead of `left`/`top`. Built on
 * `HBox`, the simplest manager that routes every child through
 * `commitPlacements` → `commitBounds`.
 *
 * Follows the `getX() + getTranslateX()` idiom from
 * `content-box-containment.test.ts`'s `rect()` helper and
 * `Scrollbar.test.ts`'s "static X/Y pinned, translate carries the move"
 * precedent for asserting the true visual position.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Container } from '~/core/Container';
import { Component } from '~/core/Component';
import { HBox } from '~/layout/HBox';
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

/**
 * Builds a Container hosting an HBox, sized and inset-cleared so cell origins
 * start at (0,0). The host MUST be a Container (clampsToContentSize() === false)
 * and have a materialised element, or doLayout() early-returns / collapses.
 */
function hostHBox(width: number, height: number, hbox: HBox): Container {
    const host = new Container({ layoutManager: hbox });

    host.getElement(true);
    host.setWidth(width);
    host.setHeight(height);
    host.clearInsets();

    return host;
}

describe('LayoutManager.commitBounds size-stable position fast path', () => {
    afterEach(() => DOM.reset());

    it('position-only move: size unchanged drives the move via translate, static X/Y frozen', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout();

        const initialX = b.getX();
        expect(b.getWidth()).toBe(100);

        // Widen `a` so `b` is displaced to the right with no size change of its own.
        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout();

        const delta = 30; // 80 - 50
        expect(b.getWidth()).toBe(100);                            // size unchanged
        expect(b.getX()).toBe(initialX);                           // static X frozen — no real setX
        expect(b.getTranslateX()).toBe(delta);                     // move carried as translate
        expect(b.getX() + b.getTranslateX()).toBe(initialX + delta); // true visual position
    });

    it('first-ever placement always takes the slow path (cached size starts NaN)', () => {
        installTestDOM(CONFIG);

        const host = hostHBox(300, 24, new HBox());
        const child = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(child);
        host.doLayout();

        expect(child.getX()).toBe(0);            // real left written
        expect(child.getTranslateX()).toBe(0);    // no translate on first placement
        expect(child.getWillChange()).toBeNull(); // slow path never promotes the layer
    });

    it('a no-op relayout after a prior fast-path move folds the translate back and demotes will-change once, then writes nothing', () => {
        const sink = installTestDOM(CONFIG) as RecordingDOMSink;

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // slow path (first placement)

        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout(); // fast path engages: b moves via translate, will-change promotes

        const truePosition = b.getX() + b.getTranslateX();
        const handle = b.getElement();

        host.doLayout(); // identical target: the move already landed, nothing left to do

        // A commit whose target already equals the true visual position takes
        // the slow path so it can fold the translate back and demote
        // will-change — a redundant relayout must not leave a component
        // permanently promoted to its own compositor layer (the bug this
        // guards: idle CPU roughly tripled on a real demo page because ~70%
        // of its components ended up stuck with `will-change: transform`
        // after just one incidental extra layout pass).
        expect(b.getX()).toBe(truePosition);
        expect(b.getTranslateX()).toBe(0);
        expect(b.getWillChange()).toBeNull();

        const writesBefore = sink.writes.length;

        host.doLayout(); // now genuinely nothing to do: every setter's value already matches

        const newWrites = sink.writes.slice(writesBefore).filter(w => w.op === 'apply' && w.args[0] === handle);
        for (const write of newWrites) {
            expect((write.args[1] as { style?: Record<string, string | null> }).style).toEqual({});
        }
    });

    it('a sibling resize that does not move a static component never promotes it', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });
        const c = new Component({ preferredSize: { width: 60, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.addComponent(c);
        host.doLayout();

        // `host` relaying out again with nobody's props changed is the shape
        // of an incidental cascade (a parent-level doLayout that reaches a
        // subtree whose bounds are already settled) — none of it should ever
        // touch `c`, since its target position never changes.
        host.doLayout();
        host.doLayout();

        expect(c.getTranslateX()).toBe(0);
        expect(c.getWillChange()).toBeNull();
    });

    it('a size change resets a prior fast-path translate back to (0,0) and writes real left', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // slow path

        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout(); // fast path: b picks up a nonzero translate
        expect(b.getTranslateX()).toBeGreaterThan(0);

        b.setPreferredSize({ width: 120, height: 16 }); // size change
        host.doLayout(); // slow path: folds the translate back to zero

        expect(b.getTranslateX()).toBe(0);
        expect(b.getTranslateY()).toBe(0);
        expect(b.getWidth()).toBe(120);
        expect(b.getX()).toBe(80 + hbox.getComponentSpacing()); // real left write
    });

    it('a configured CSS transition blocks the fast path even when size is unchanged', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });
        b.setTransition('left 200ms ease, width 200ms ease');

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // slow path (first placement)

        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout(); // size unchanged, but transition configured -> slow path

        expect(b.getTranslateX()).toBe(0);
        expect(b.getX()).toBe(80 + hbox.getComponentSpacing()); // real left, not translate
    });

    // The boundary of the finite-position gate added by
    // plans/implemented/nan-sentinel-dom-writes.md: every case in this file
    // places a child whose position the manager itself wrote, so the gate's
    // precondition holds and the fast path must behave exactly as before. The
    // never-positioned case the gate exists for lives in `Absolute.test.ts`,
    // the manager that actually produces it.
    it('a child whose position is a real number still takes the fast path when a sibling resize displaces it', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // slow path writes b's real left/top

        expect(Number.isFinite(b.getX())).toBe(true);
        expect(Number.isFinite(b.getY())).toBe(true);

        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout();

        const delta = 30; // 80 - 50
        expect(b.getTranslateX()).toBe(delta);
        expect(b.getWillChange()).toBe('transform');
    });

    // The one case where the finite-position gate changes where a box is
    // painted rather than only suppressing a write the browser discarded: a
    // child sized out of band before its first placement. Its size already
    // matches the manager's target, so `sizeUnchanged` is true on the very
    // first commit while `getX()`/`getY()` still hold the "never assigned"
    // sentinel — the shape that used to take the fast path and receive nothing
    // but an invalid `translate3d(NaNpx,NaNpx,0)`, leaving it at its static
    // position with `left`/`top` never written and `getX()` never assigned.
    // See the plan's Implementation Notes and the changelog's Fixed entry,
    // which both state this move outright.
    it('places a child that was sized out of band before its first placement, instead of leaving it unpositioned forever', () => {
        installTestDOM(CONFIG);

        // Learn exactly what this HBox assigns, so the real case below can be
        // pre-sized to match and so reach `sizeUnchanged` on its first commit.
        const probeHost  = hostHBox(400, 24, new HBox());
        const probeChild = new Component({ preferredSize: { width: 50, height: 16 } });

        probeHost.addComponent(probeChild);
        probeHost.doLayout();

        const assigned = {
            x:      probeChild.getX(),
            y:      probeChild.getY(),
            width:  probeChild.getWidth(),
            height: probeChild.getHeight(),
        };

        const host  = hostHBox(400, 24, new HBox());
        const child = new Component({ preferredSize: { width: 50, height: 16 } });

        host.addComponent(child);
        child.setWidth(assigned.width);
        child.setHeight(assigned.height);

        expect(Number.isNaN(child.getX())).toBe(true);   // sized, never positioned

        host.doLayout();

        expect(child.getX()).toBe(assigned.x);
        expect(child.getY()).toBe(assigned.y);
        expect(child.getTranslateX()).toBe(0);
        expect(child.getWillChange()).toBeNull();
    });

    it('will-change is "transform" only while the fast path is engaged, reverting to null on the next slow-path run', () => {
        installTestDOM(CONFIG);

        const hbox = new HBox();
        const host = hostHBox(400, 24, hbox);
        const a = new Component({ preferredSize: { width: 50, height: 16 } });
        const b = new Component({ preferredSize: { width: 100, height: 16 } });

        host.addComponent(a);
        host.addComponent(b);
        host.doLayout(); // slow path
        expect(b.getWillChange()).toBeNull();

        a.setPreferredSize({ width: 80, height: 16 });
        host.doLayout(); // fast path
        expect(b.getWillChange()).toBe('transform');

        b.setPreferredSize({ width: 120, height: 16 }); // size change -> slow path
        host.doLayout();
        expect(b.getWillChange()).toBeNull();
    });
});
