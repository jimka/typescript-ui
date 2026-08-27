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
    it('toggles the invisible state class at most once for repeated setVisible(false) (case 13)', () => {
        const c = new Component({});
        const element = c.getElement(true)!;

        // setVisible(false) now routes through the shared `.invisible`
        // state-tier class instead of a per-instance `visibility` rule (see
        // the state-tier dedup plan), so idempotency shows up as the DOM
        // class token being toggled at most once, not as a rule write count.
        const writesBefore = (DOM.sink as RecordingDOMSink).writes.length;
        const spy = vi.spyOn(hookTarget(c), 'onEffectiveVisibilityChange');

        c.setVisible(false);
        c.setVisible(false);

        const invisibleAdds = (DOM.sink as RecordingDOMSink).writes.slice(writesBefore).filter(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { addClass?: readonly string[] }).addClass?.includes('invisible')
        );
        expect(invisibleAdds).toHaveLength(1);

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

        // Neither leg writes a real `visibility` declaration any more:
        // `setVisible(false)` toggles the `.invisible` state class instead
        // of calling `writeStyle`, and `setVisible(true)`'s `writeStyle({
        // visible: true })` resolves to the class/framework tier's own
        // "inherit" default — a matching value, so `flushStyleBag` only ever
        // queues a removal, which never materialises this never-yet-written
        // `#id` rule (see the plan's Architecture Decisions).
        const visWritesBefore = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        const spy = vi.spyOn(hookTarget(c), 'onEffectiveVisibilityChange');

        c.setVisible(false);
        c.setVisible(true);

        const visWritesAfter = ruleStyleWrites(DOM.sink as RecordingDOMSink).filter(w => w.key === 'visibility').length;
        expect(visWritesAfter - visWritesBefore).toBe(0);

        Component.flushEffectiveVisibility();

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(true);
    });
});

// Component `setVisible`/`isVisible` state-tier dedup — plan
// component-setvisible-state-tier-dedup.md's Expected Behaviour rows 1, 2,
// 5, 6, 8. Row 3, 4, 7 (the CSS-write-dedup assertions, which need the
// `declarationsDuring`/`_ruleCacheHas` helpers) live in
// `tests/core/StyleStates.test.ts` instead, alongside that file's existing
// declared-state coverage.
describe('Component.setVisible routes through the .invisible state tier', () => {
    it('row 1: a never-rendered Component constructed with visible:false reports isVisible() false', () => {
        const c = new Component({ visible: false });

        expect(c.isVisible()).toBe(false);
    });

    it('row 2: the first render catches up the invisible class token, and isVisible() still reports false', () => {
        const c = new Component({ visible: false });
        const element = c.getElement(true)!;

        // `setStyleState`'s own DOM write is gated on `getElement()`, so the
        // construction-time toggle (case row 1, before any element exists)
        // only reaches the classList via `Component.init()`'s render-time
        // catch-up sweep — assert that sweep actually added the token.
        const addClassOps = (DOM.sink as RecordingDOMSink).writes.filter(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { addClass?: readonly string[] }).addClass?.includes('invisible')
        );
        expect(addClassOps.length).toBeGreaterThan(0);
        expect(c.isVisible()).toBe(false);
    });

    it('row 5: setVisible(true) after setVisible(false) removes the invisible class, reports true, and writes no real visibility declaration', () => {
        const c = new Component({});
        const element = c.getElement(true)!;
        c.setVisible(false);

        const writesBefore = (DOM.sink as RecordingDOMSink).writes.length;
        c.setVisible(true);
        const writesAfter = (DOM.sink as RecordingDOMSink).writes.slice(writesBefore);

        const removedInvisible = writesAfter.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('invisible')
        );
        expect(removedInvisible).toBe(true);
        expect(c.isVisible()).toBe(true);

        // `writeStyle({ visible: true })` on this branch resolves to the
        // class/framework tier's own "inherit" default, so per
        // `flushStyleBag`'s own dedup it only ever queues a matching removal
        // (`null`) — never a real `visibility: hidden` declaration.
        const hiddenDecls = ruleStyleWrites(DOM.sink as RecordingDOMSink)
            .filter(w => w.key === 'visibility' && w.value === 'hidden');
        expect(hiddenDecls).toEqual([]);
    });

    it('row 6: setVisible(null) reports isVisible() null with the same no-real-declaration behavior as row 5', () => {
        const c = new Component({});
        c.getElement(true);
        c.setVisible(false);

        c.setVisible(null);

        expect(c.isVisible()).toBeNull();

        const hiddenDecls = ruleStyleWrites(DOM.sink as RecordingDOMSink)
            .filter(w => w.key === 'visibility' && w.value === 'hidden');
        expect(hiddenDecls).toEqual([]);
    });

    it('row 8: isEffectivelyVisible() picks up a component hidden via the new .invisible path with no test-side change needed', () => {
        const c = new Component({});
        c.getElement(true);

        expect(c.isEffectivelyVisible()).toBe(true);

        c.setVisible(false);

        expect(c.isEffectivelyVisible()).toBe(false);
    });
});

// Component `setDisplayed`/`isDisplayed` state-tier dedup — plan
// component-setdisplayed-state-tier-dedup.md's Expected Behaviour rows 3, 4,
// 5. Rows 1, 2, 6, 7, 8 (the CSS-write-dedup assertions, which need the
// `declarationsDuring`/`_ruleCacheHas` helpers) live in
// `tests/core/StyleStates.test.ts` instead, alongside that file's existing
// declared-state coverage.
describe('Component.setDisplayed routes through the .undisplayed state tier', () => {
    it('row 3: a never-rendered Component constructed with displayed:false reports isDisplayed() false', () => {
        const c = new Component({ displayed: false });

        expect(c.isDisplayed()).toBe(false);
    });

    it('row 4: the first render catches up the undisplayed class token, and isDisplayed() still reports false', () => {
        const c = new Component({ displayed: false });
        const element = c.getElement(true)!;

        // `setStyleState`'s own DOM write is gated on `getElement()`, so the
        // construction-time toggle (case row 3, before any element exists)
        // only reaches the classList via `Component.init()`'s render-time
        // catch-up sweep — assert that sweep actually added the token.
        const addClassOps = (DOM.sink as RecordingDOMSink).writes.filter(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { addClass?: readonly string[] }).addClass?.includes('undisplayed')
        );
        expect(addClassOps.length).toBeGreaterThan(0);
        expect(c.isDisplayed()).toBe(false);
    });

    it('row 5: setDisplayed(true) after setDisplayed(false) removes the undisplayed class, reports true, and writes no real display declaration', () => {
        const c = new Component({});
        const element = c.getElement(true)!;
        c.setDisplayed(false);

        const writesBefore = (DOM.sink as RecordingDOMSink).writes.length;
        c.setDisplayed(true);
        const writesAfter = (DOM.sink as RecordingDOMSink).writes.slice(writesBefore);

        const removedUndisplayed = writesAfter.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('undisplayed')
        );
        expect(removedUndisplayed).toBe(true);
        expect(c.isDisplayed()).toBe(true);

        // `writeStyle({ displayed: true })` on this branch resolves to the
        // class/framework tier's own default, so per `flushStyleBag`'s own
        // dedup it only ever queues a matching removal (`null`) — never a
        // real `display: none` declaration.
        const noneDecls = ruleStyleWrites(DOM.sink as RecordingDOMSink)
            .filter(w => w.key === 'display' && w.value === 'none');
        expect(noneDecls).toEqual([]);
    });

    it('isEffectivelyVisible() picks up a component hidden via the new .undisplayed path with no test-side change needed', () => {
        const c = new Component({});
        c.getElement(true);

        expect(c.isEffectivelyVisible()).toBe(true);

        c.setDisplayed(false);

        expect(c.isEffectivelyVisible()).toBe(false);
    });
});
