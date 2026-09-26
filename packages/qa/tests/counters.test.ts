// @vitest-environment jsdom
//
// The counter families, offline. E19 needs a document and a global
// `getComputedStyle`, which the platform counters wrap, so the whole file
// runs under jsdom; the other cases are DOM-free and unaffected.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPlatformCounters, installSeamCounters, perUnit, startCounting, stopCounting, suspendCounting } from '../src/harness/counters.js';
import { restorePatchables, snapshotPatchables } from './patchGuard.js';
import type { PatchSnapshot } from './patchGuard.js';

describe('E2 perUnit', () => {
    it('divides by the units and orders keys largest first', () => {
        const out = perUnit({ x: 1, release: 2100, apply: 2410 }, 10);

        expect(out).toEqual({ apply: 241, release: 210, x: 0.1 });
        expect(Object.keys(out)).toEqual(['apply', 'release', 'x']);
    });
});

/** A stand-in for the production sink: its methods call each other through `this`. */
class FakeSink {
    applied: number = 0;

    /** Counts one apply on the real object. */
    apply(): void {
        this.applied++;
    }

    /** Creates nothing; only its call is counted. */
    createElementNS(): void {}

    /**
     * Returns a builder that commits through the sink's own `apply`, as `ProductionDOMSink.edit` does.
     *
     * @param _handle - Unused.
     * @returns The builder.
     */
    edit(_handle: number): { commit: () => void } {
        return { commit: () => this.apply() };
    }
}

/** A stand-in for the production source. */
class FakeSource {
    /**
     * Calls another of its own methods.
     *
     * @returns A fixed width.
     */
    measureText(): number {
        return this.font();
    }

    /**
     * The width `measureText` returns.
     *
     * @returns A fixed width.
     */
    font(): number {
        return 1;
    }
}

/** A fake `DOM` swap point whose `install` assigns what it is given. */
interface FakeDom {
    sink: FakeSink;
    source: FakeSource;
    install(impls: { sink?: object; source?: object }): void;
}

/**
 * Builds a fake `DOM` swap point.
 *
 * @returns The fake, with its original sink and source.
 */
function fakeDom(): { dom: FakeDom; sink: FakeSink; source: FakeSource } {
    const sink = new FakeSink();
    const source = new FakeSource();

    const dom: FakeDom = {
        sink,
        source,
        install(impls: { sink?: object; source?: object }): void {
            if (impls.sink) {
                dom.sink = impls.sink as FakeSink;
            }

            if (impls.source) {
                dom.source = impls.source as FakeSource;
            }
        },
    };

    return { dom, sink, source };
}

describe('E4 seam counter', () => {
    let dom: FakeDom;
    let sink: FakeSink;

    beforeEach(() => {
        ({ dom, sink } = fakeDom());
        installSeamCounters(dom);
    });

    it('replaces the sink and source', () => {
        const original = fakeDom();

        installSeamCounters(original.dom);

        expect(original.dom.sink).not.toBe(original.sink);
        expect(original.dom.source).not.toBe(original.source);
    });

    it('does not tally calls made while not counting', () => {
        startCounting();
        stopCounting(1);
        dom.sink.apply();
        dom.source.measureText();

        // A second stop reads the tallies again without resetting them.
        expect(stopCounting(1).seam).toEqual({ sink: {}, source: {} });
    });

    it('tallies sink calls by method name', () => {
        startCounting();
        dom.sink.apply();
        dom.sink.apply();
        dom.sink.apply();
        dom.sink.createElementNS();
        dom.sink.createElementNS();

        expect(stopCounting(1).seam?.sink).toEqual({ apply: 3, createElementNS: 2 });
    });

    it('counts an edit once and commits through the real sink', () => {
        const before = sink.applied;

        startCounting();
        dom.sink.edit(1).commit();

        expect(stopCounting(1).seam?.sink).toEqual({ edit: 1 });
        expect(sink.applied).toBe(before + 1);
    });

    it('does not tally a source method called by another', () => {
        startCounting();
        dom.source.measureText();

        expect(stopCounting(1).seam?.source).toEqual({ measureText: 1 });
    });

    it('reports per unit', () => {
        startCounting();

        for (let i = 0; i < 4; i++) {
            dom.sink.apply();
        }

        expect(stopCounting(2).seam?.sink).toEqual({ apply: 2 });
    });

    it('starts each window from empty tallies', () => {
        startCounting();
        dom.sink.apply();
        stopCounting(1);
        startCounting();

        expect(stopCounting(1).seam?.sink).toEqual({});
    });

    it('reports only the seam family when only it is installed', () => {
        startCounting();
        dom.sink.apply();

        const counts = stopCounting(1);

        expect(counts.seam).toBeDefined();
        expect(counts).not.toHaveProperty('writes');
        expect(counts).not.toHaveProperty('forcedStacks');
        expect(counts).not.toHaveProperty('work');
    });
});

describe('E18 suspendCounting', () => {
    let dom: FakeDom;

    beforeEach(() => {
        ({ dom } = fakeDom());
        installSeamCounters(dom);
    });

    it('leaves the suspended work out of the tallies', async () => {
        startCounting();
        dom.sink.apply();

        await suspendCounting(async () => {
            dom.sink.apply();
            dom.sink.apply();
            dom.sink.apply();
        });

        dom.sink.apply();

        expect(stopCounting(1).seam?.sink).toEqual({ apply: 2 });
    });

    it('resumes counting and rethrows when the work throws', async () => {
        const boom = new Error('boom');

        startCounting();

        await expect(suspendCounting(async () => {
            throw boom;
        })).rejects.toBe(boom);

        dom.sink.apply();

        expect(stopCounting(1).seam?.sink).toEqual({ apply: 1 });
    });

    it('leaves counting off when it was off', async () => {
        startCounting();
        stopCounting(1);

        await suspendCounting(async () => {
            dom.sink.apply();
        });

        dom.sink.apply();

        // A second stop reads the tallies again without resetting them.
        expect(stopCounting(1).seam?.sink).toEqual({});
    });
});

/** The platform counter the date cases read: `installPlatformCounters`' key for `Date.prototype.toLocaleDateString`. */
const DATE_KEY = 'date.toLocaleDateString';

/** How many units E19's per-unit case divides its three calls by. */
const THREE_UNITS = 3;

describe('E19 platform counters', () => {
    /** The note the one install returned; every case reads the same one. */
    let note = '';

    /** `Date.prototype` and `String.prototype` as they were before the install. */
    let prototypes: PatchSnapshot = [];

    /** The engine's own `getComputedStyle`, which lives on the global rather than a prototype. */
    let computedStyle: typeof window.getComputedStyle;

    // Installed once: installing twice would wrap the wrappers and tally
    // every call as two.
    beforeAll(() => {
        prototypes = snapshotPatchables([Date.prototype, String.prototype]);
        computedStyle = window.getComputedStyle;
        note = installPlatformCounters();
    });

    afterAll(() => {
        restorePatchables(prototypes);
        window.getComputedStyle = computedStyle;
    });

    it('does not tally a call made while not counting', () => {
        startCounting();
        stopCounting(1);
        new Date().toLocaleDateString();

        // A second stop reads the tallies again without resetting them.
        expect(stopCounting(1).plat).toEqual({});
    });

    it('tallies the date formatters per unit', () => {
        startCounting();

        for (let i = 0; i < THREE_UNITS; i++) {
            new Date().toLocaleDateString();
        }

        expect(stopCounting(THREE_UNITS).plat?.[DATE_KEY]).toBe(1);
    });

    it('tallies a collation and returns the engine\'s own answer', () => {
        startCounting();

        const order = 'x'.localeCompare('y');

        expect(stopCounting(1).plat).toEqual({ 'string.localeCompare': 1 });
        expect(order).toBeLessThan(0);
    });

    it('tallies a computed-style read and returns a declaration that still reads', () => {
        const element = document.createElement('div');

        document.body.appendChild(element);
        startCounting();

        const declaration = getComputedStyle(element);
        const display = declaration.display;

        expect(stopCounting(1).plat?.['style.getComputedStyle']).toBe(1);
        expect(display).toBe('block');
        element.remove();
    });

    it('names the target the engine does not expose instead of throwing', () => {
        expect(note).toContain(DATE_KEY);
        expect(note).toMatch(/not exposed: CanvasRenderingContext2D$/);
    });

    it('leaves the suspended calls out of the tallies', async () => {
        startCounting();
        new Date().toLocaleDateString();

        await suspendCounting(async () => {
            new Date().toLocaleDateString();
            new Date().toLocaleDateString();
        });

        expect(stopCounting(1).plat?.[DATE_KEY]).toBe(1);
    });
});

describe('stopCounting without installed families', () => {
    it('reports a family that recorded something, as an ablation\'s own counters do', async () => {
        // A fresh module: the tests above installed the seam family.
        vi.resetModules();

        const counters = await import('../src/harness/counters.js');

        counters.startCounting();
        counters.bumpWork('skipped.x');
        counters.bumpWrite('skip@left');

        const counts = counters.stopCounting(2);

        expect(counts.work).toEqual({ 'skipped.x': 0.5 });
        expect(counts.writes).toEqual({ 'skip@left': 0.5 });
        expect(counts.forcedStacks).toEqual({});
        expect(counts).not.toHaveProperty('seam');
        expect(counts).not.toHaveProperty('plat');
    });

    it('reports nothing when nothing is installed or recorded', async () => {
        vi.resetModules();

        const counters = await import('../src/harness/counters.js');

        counters.startCounting();

        expect(counters.stopCounting(1)).toEqual({});
    });
});
