// Pins the effective-visibility standardization mechanism: the public
// `isEffectivelyVisible()` query, the rAF-coalesced subtree walk that fires
// `onEffectiveVisibilityChange` and auto-pauses per-node CSS animations, the
// synchronous `Component.flushEffectiveVisibility()` drain (the offline
// harness's `requestAnimationFrame` drops its callback, so tests must call
// this to observe a coalesced flush), and the `setVisible` idempotency guard.
// Case numbers below refer to the plan's `## Expected Behaviour` list.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component } from '~/core/Component';
import { Canvas } from '~/component/display/Canvas';
import { DOM } from '~/core/DOM';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reads the protected hook off an arbitrary component for spying. */
function hookTarget(c: Component): { onEffectiveVisibilityChange(effective: boolean): void } {
    return c as unknown as { onEffectiveVisibilityChange(effective: boolean): void };
}

describe('Component.isEffectivelyVisible (case 1)', () => {
    it('is public and true with no hidden ancestor', () => {
        const c = new Component({});

        expect(c.isEffectivelyVisible()).toBe(true);
    });

    it('is false when this component is explicitly hidden', () => {
        const c = new Component({});

        c.setVisible(false);

        expect(c.isEffectivelyVisible()).toBe(false);
    });

    it('is false when an ancestor is explicitly hidden', () => {
        const parent = new Component({});
        const child = new Component({});

        parent.addComponent(child);
        parent.setVisible(false);

        expect(child.isEffectivelyVisible()).toBe(false);
    });

    it('is false when this component is undisplayed', () => {
        const c = new Component({});

        c.setDisplayed(false);

        expect(c.isEffectivelyVisible()).toBe(false);
    });
});

describe('Per-node CSS animation pause on hide (case 2)', () => {
    it('pauses this node\'s own animation on hide and resumes it on show', () => {
        const c = new Component({});
        c.getElement(true);
        c.setAnimation('spin 1s linear infinite');

        c.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(c.getAnimationPlayState()).toBe('paused');

        const pausedWrite = ruleStyleWrites(DOM.sink as RecordingDOMSink).some(w =>
            w.key === 'animationPlayState' && w.value === 'paused');
        expect(pausedWrite).toBe(true);

        c.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(c.getAnimationPlayState()).toBeNull();
    });

    it('pauses a descendant animation when a subtree root is hidden', () => {
        const root = new Component({});
        const mid  = new Component({});
        const leaf = new Component({});

        root.addComponent(mid);
        mid.addComponent(leaf);
        root.getElement(true);
        leaf.setAnimation('spin 1s linear infinite');

        root.setVisible(false);
        Component.flushEffectiveVisibility();

        expect(leaf.getAnimationPlayState()).toBe('paused');
    });
});

describe('Non-animated components pay nothing (case 3)', () => {
    it('never writes animationPlayState for a component with no animation', () => {
        const c = new Component({});
        c.getElement(true);

        c.setVisible(false);
        Component.flushEffectiveVisibility();

        const wrote = ruleStyleWrites(DOM.sink as RecordingDOMSink).some(w => w.key === 'animationPlayState');

        expect(wrote).toBe(false);
        expect(c.getAnimationPlayState()).toBeNull();
    });
});

describe('Edge-triggered walk / no churn (case 4)', () => {
    it('a hide-then-show before flush nets no change and no hook call reaches a contained Canvas', () => {
        const container = new Component({});
        const canvas = new Canvas();

        container.addComponent(canvas);
        container.getElement(true);
        canvas.getElement(true);
        canvas.startAnimation();

        // Establish the baseline cache (container/canvas effectively visible).
        container.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(true);

        // Spying only after the baseline flush isolates the churn under test:
        // a naive (non-coalescing) implementation would cancel + restart the
        // loop via two hook calls (false, then true); the coalesced flush must
        // recompute net effective visibility once and see no change at all.
        const spy = vi.spyOn(hookTarget(canvas), 'onEffectiveVisibilityChange');

        container.setVisible(false);
        container.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(true);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('Nested-hidden is not resumed (case 5)', () => {
    it('keeps a locally-hidden descendant Canvas paused across an ancestor hide/show', () => {
        const outer = new Component({});
        const inner = new Component({});
        const canvas = new Canvas();

        outer.addComponent(inner);
        inner.addComponent(canvas);
        outer.getElement(true);
        // `inner` calls setVisible directly below, so it needs its own element —
        // the schedule call at setVisible's tail only fires past the
        // `if (!element) return this` guard (see the plan's Potential Challenges).
        inner.getElement(true);
        canvas.getElement(true);
        canvas.startAnimation();

        outer.setVisible(true);
        Component.flushEffectiveVisibility();
        expect(canvas.isAnimating()).toBe(true);

        inner.setVisible(false);
        Component.flushEffectiveVisibility();
        expect(canvas.isAnimating()).toBe(false);

        const spy = vi.spyOn(hookTarget(canvas), 'onEffectiveVisibilityChange');

        outer.setVisible(false);
        Component.flushEffectiveVisibility();
        outer.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(canvas.isAnimating()).toBe(false);
        expect(spy).not.toHaveBeenCalledWith(true);
    });
});

describe('Idempotent setVisible (cases 13-15)', () => {
    it('writes the visibility rule at most once for repeated setVisible(false) (case 13)', () => {
        const c = new Component({});
        c.getElement(true);

        // Baseline after render (which already writes an initial "inherit"
        // visibility rule via applyBoxAndVisibilityStyles) — count only writes
        // caused by the two setVisible(false) calls below.
        const visWritesBefore = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        const spy = vi.spyOn(hookTarget(c), 'onEffectiveVisibilityChange');

        c.setVisible(false);
        c.setVisible(false);

        const visWritesAfter = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        expect(visWritesAfter - visWritesBefore).toBe(1);

        Component.flushEffectiveVisibility();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(false);
    });

    it('fires no hook for a same-value setVisible call (case 14)', () => {
        const c = new Component({});
        c.getElement(true);

        c.setVisible(true);
        Component.flushEffectiveVisibility();

        const spy = vi.spyOn(hookTarget(c), 'onEffectiveVisibilityChange');

        c.setVisible(true);
        Component.flushEffectiveVisibility();

        expect(spy).not.toHaveBeenCalled();
    });

    it('nets exactly one hook call for an intra-pass false-then-true churn (case 15)', () => {
        // A never-flushed component (cache still null, mirroring the first-ever
        // Tab.doLayout pass over the initial active panel): both calls are real
        // writes since each normalized target differs from the current one, but
        // the coalesced flush must still fire the hook once for the net state —
        // not once per setVisible call.
        const c = new Component({});
        c.getElement(true);

        const visWritesBefore = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        const spy = vi.spyOn(hookTarget(c), 'onEffectiveVisibilityChange');

        c.setVisible(false);
        c.setVisible(true);

        const visWritesAfter = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        expect(visWritesAfter - visWritesBefore).toBe(2);

        Component.flushEffectiveVisibility();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(true);
    });
});
