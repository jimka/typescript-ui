import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProgressBar } from '~/component/display/ProgressBar';
import { Component } from '~/core/Component';
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

// The whole suite installs the harness. The state assertions are pure JS, but
// the setters under test (`setValue`, `setIndeterminate`) call
// `scheduleLayout()`, which queues a *real* requestAnimationFrame against the
// production sink when no harness is installed. That deferred flush fires after
// the test ends and, once a later harness test calls `DOM.reset()`, dereferences
// released handles. The harness's rAF is an inert recorder, so nothing leaks.
beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * Returns the inner fill component (the bar's track child's first child)
 * through the public child tree, so no private field is touched.
 */
function fillOf(bar: ProgressBar): Component {
    const track = (bar as unknown as Component).getComponents()[0];

    return track.getComponents()[0];
}

describe('ProgressBar value clamping', () => {
    it('clamps an over-range constructor value to 100', () => {
        expect(new ProgressBar(150).getValue()).toBe(100);
    });
    it('clamps a negative constructor value to 0', () => {
        expect(new ProgressBar(-5).getValue()).toBe(0);
    });
    it('keeps an in-range constructor value', () => {
        expect(new ProgressBar(42).getValue()).toBe(42);
    });
    it('clamps setValue above 100 to 100', () => {
        const bar = new ProgressBar(0);

        bar.setValue(250);

        expect(bar.getValue()).toBe(100);
    });
    it('clamps setValue below 0 to 0', () => {
        const bar = new ProgressBar(50);

        bar.setValue(-10);

        expect(bar.getValue()).toBe(0);
    });
    it('round-trips an in-range setValue', () => {
        const bar = new ProgressBar(0);

        bar.setValue(73);

        expect(bar.getValue()).toBe(73);
    });
});

describe('ProgressBar indeterminate state', () => {
    it('defaults to determinate', () => {
        expect(new ProgressBar(10).isIndeterminate()).toBe(false);
    });
    it('reflects the constructor indeterminate flag', () => {
        expect(new ProgressBar(10, true).isIndeterminate()).toBe(true);
    });
    it('reports getValue() as 0 while indeterminate regardless of stored value', () => {
        const bar = new ProgressBar(80, true);

        expect(bar.getValue()).toBe(0);
    });
    it('restores the stored value when indeterminate is cleared', () => {
        const bar = new ProgressBar(80, true);

        bar.setIndeterminate(false);

        // Contract: setValue stored 80 in the backing field; getValue masks it
        // only while indeterminate, so clearing the flag surfaces it again.
        expect(bar.getValue()).toBe(80);
    });
    it('toggles via setIndeterminate', () => {
        const bar = new ProgressBar(10);

        bar.setIndeterminate(true);
        expect(bar.isIndeterminate()).toBe(true);

        bar.setIndeterminate(false);
        expect(bar.isIndeterminate()).toBe(false);
    });
    it('does not throw when setIndeterminate flushes layout on an unattached bar', () => {
        const bar = new ProgressBar(10);

        expect(() => bar.setIndeterminate(true)).not.toThrow();
    });
});

describe('ProgressBar options wiring', () => {
    it('applies { value }', () => {
        expect(new ProgressBar(0, false, { value: 30 }).getValue()).toBe(30);
    });
    it('clamps an over-range { value }', () => {
        expect(new ProgressBar(0, false, { value: 500 }).getValue()).toBe(100);
    });
    it('applies { indeterminate: true }', () => {
        expect(new ProgressBar(0, false, { indeterminate: true }).isIndeterminate()).toBe(true);
    });
});

describe('ProgressBar baseline', () => {
    it('returns null before a size is set', () => {
        expect(new ProgressBar(50).getBaseline()).toBe(null);
    });
    it('returns preferredHeight - 2 once a preferred size is set', () => {
        const bar = new ProgressBar(50);

        bar.setPreferredSize(120, 18);

        expect(bar.getBaseline()).toBe(16);
    });
});

describe('ProgressBar fill-width relation', () => {
    /**
     * Sizes the bar to a known inner width, lays it out, and returns the fill
     * child's resulting width. With zero insets the inner width equals the set
     * width, so the contract `round(inner.width * value / 100)` is checkable as
     * a proportional relation.
     */
    function fillWidthAt(value: number, innerWidth: number): number {
        const bar = new ProgressBar(value);

        bar.getElement(true);
        bar.clearInsets();
        bar.setWidth(innerWidth);
        bar.setHeight(12);

        bar.doLayout();

        return fillOf(bar).getWidth();
    }

    it('fills nothing at value 0', () => {
        expect(fillWidthAt(0, 200)).toBe(0);
    });
    it('fills half the inner width at value 50', () => {
        expect(fillWidthAt(50, 200)).toBe(100);
    });
    it('fills the full inner width at value 100', () => {
        expect(fillWidthAt(100, 200)).toBe(200);
    });
});
