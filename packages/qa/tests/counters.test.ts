import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installSeamCounters, perUnit, startCounting, stopCounting } from '../src/harness/counters.js';

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
    });

    it('reports nothing when nothing is installed or recorded', async () => {
        vi.resetModules();

        const counters = await import('../src/harness/counters.js');

        counters.startCounting();

        expect(counters.stopCounting(1)).toEqual({});
    });
});
