// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for `readFrameworkCounts()` and the parts of `DiagnosticsSampler`
// that are unit-testable offline. Cases are numbered to match
// `plans/implemented/debug-diagnostics-overlay.md`'s `## Expected Behaviour`
// "Sampler — partly unit-testable" list (15-19); row 19 (the live frame loop:
// FPS, frame time, long tasks, heap, DOM node count) needs a real browser and
// is manual-verify only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Diagnostics } from '~/core/Diagnostics';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { readFrameworkCounts, DiagnosticsSampler } from '~/diagnostics/DiagnosticsSampler';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => {
    installTestDOM(CONFIG);
    Diagnostics._reset();
});
afterEach(() => DOM.reset());

describe('readFrameworkCounts', () => {
    it('15. is pure — repeated calls with nothing in between agree, and change nothing', () => {
        const before = Diagnostics.counters();

        const first  = readFrameworkCounts();
        const second = readFrameworkCounts();

        expect(second).toEqual(first);
        expect(Diagnostics.counters()).toEqual(before);
    });

    it('16. components is componentsConstructed minus componentsDestroyed', () => {
        const components: Component[] = [];
        for (let i = 0; i < 10; i++) {
            components.push(new Component({}));
        }
        for (let i = 0; i < 4; i++) {
            components[i].dispose();
        }

        const counts = readFrameworkCounts();

        expect(counts.componentsConstructed).toBe(10);
        expect(counts.componentsDestroyed).toBe(4);
        expect(counts.components).toBe(6);
    });
});

describe('DiagnosticsSampler.start / stop', () => {
    it('17. are idempotent and flip the timing flag', () => {
        const sampler = new DiagnosticsSampler({ onSample: () => {} });

        sampler.start();
        sampler.start();
        expect(sampler.isRunning()).toBe(true);
        expect(Diagnostics.isTimingEnabled()).toBe(true);

        sampler.stop();
        sampler.stop();
        expect(sampler.isRunning()).toBe(false);
        expect(Diagnostics.isTimingEnabled()).toBe(false);
    });

    it('18. emits no sample before a full window elapses (offline rAF drops its callback)', () => {
        const onSample = vi.fn();
        const sampler  = new DiagnosticsSampler({ onSample });

        sampler.start();

        expect(onSample).not.toHaveBeenCalled();

        sampler.stop();
    });
});
