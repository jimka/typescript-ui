// The Event namespace routes DOM listeners through the sink/source. We assert
// the BOOKKEEPING contract (base-listener install/uninstall accounting, no-op
// guards, the passive-conflict throw, fireEvent's element requirement) — NOT
// real event delivery, since the modelled source exposes no live tree.
//
// Event keeps module-level state with no reset hook, so every test uses a
// UNIQUE event type to stay isolated from sibling tests.
import { describe, it, expect, afterEach } from 'vitest';
import { Event } from '~/core/Event';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Counts recording-sink writes of `op` whose first recorded arg is `type`. */
function countWrites(sink: RecordingDOMSink, op: string, type: string): number {
    return sink.writes.filter((w) => w.op === op && w.args[0] === type).length;
}

let typeCounter = 0;

/** A fresh event type per use so module-level Event state never leaks between tests. */
function uniqueType(): string {
    typeCounter += 1;

    return `evt-${typeCounter}`;
}

describe('Event.addListener / removeListener base-listener accounting', () => {
    afterEach(() => DOM.reset());

    it('installs exactly one window base listener on first registration of a type', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addListener(comp, type, () => {});
        Event.addListener(new Component({}), type, () => {});

        // Two registrations of the same type => still ONE base addListener.
        expect(countWrites(sink, 'addListener', type)).toBe(1);
    });

    it('uninstalls the base listener only on the LAST removal for a type', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const a = new Component({});
        const b = new Component({});
        const fa = (): void => {};
        const fb = (): void => {};

        Event.addListener(a, type, fa);
        Event.addListener(b, type, fb);

        Event.removeListener(a, type, fa);

        // A non-last removal does NOT uninstall.
        expect(countWrites(sink, 'removeListener', type)).toBe(0);

        Event.removeListener(b, type, fb);

        // The last removal uninstalls the base listener.
        expect(countWrites(sink, 'removeListener', type)).toBe(1);
    });

    it('is a no-op when component or listener is falsy (no writes, no throw)', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        expect(() => Event.addListener(null as unknown as Component, type, () => {})).not.toThrow();
        expect(() => Event.addListener(comp, type, null as unknown as Event.Listener)).not.toThrow();

        expect(countWrites(sink, 'addListener', type)).toBe(0);
    });

    it('accumulates multiple listeners per (component, type) without re-installing the base', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addListener(comp, type, () => {});
        Event.addListener(comp, type, () => {});

        expect(countWrites(sink, 'addListener', type)).toBe(1);
    });
});

describe('Event passive-conflict contract', () => {
    afterEach(() => DOM.reset());

    it('throws when a later registration conflicts with the earlier passive setting', () => {
        installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addListener(comp, type, { passive: true, handler: () => {} });

        expect(() => Event.addListener(comp, type, { passive: false, handler: () => {} }))
            .toThrow(/conflict with earlier registration/);
    });

    it('does not throw when the later registration matches the earlier setting', () => {
        installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addListener(comp, type, { passive: true, handler: () => {} });

        expect(() => Event.addListener(comp, type, { passive: true, handler: () => {} })).not.toThrow();
    });

    it('leaves no stale map entry behind when a cross-map conflict throws, so purging the sole real registration still uninstalls the base listener', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const subtreeComp = new Component({});
        const exactComp = new Component({});

        // First registration (subtree) succeeds and locks `type` passive: true.
        Event.addSubtreeListener(subtreeComp, type, { passive: true, handler: () => {} });

        // Second registration (exact-target, a DIFFERENT internal map) conflicts
        // and throws. Before the fix, `registerEntry` inserted an empty typeMap
        // into `listenerMap` before this throw, leaving it permanently stale —
        // `purgeComponent`'s plain `listenerMap.has(type)` check would then never
        // see the type as free, and the base listener would never be uninstalled.
        expect(() => Event.addListener(exactComp, type, { passive: false, handler: () => {} }))
            .toThrow(/conflict with earlier registration/);

        Event.purgeComponent(subtreeComp.getId());

        expect(countWrites(sink, 'removeListener', type)).toBe(1);
    });
});

describe('Event.fireEvent element requirement', () => {
    afterEach(() => DOM.reset());

    it('throws when the component has no DOM element', () => {
        installTestDOM(CONFIG);
        const comp = new Component({});

        expect(() => Event.fireEvent(comp, 'click')).toThrow(/is not in the DOM/);
    });

    it('records a dispatchEvent write when the component has an element', () => {
        const sink = installTestDOM(CONFIG);
        const comp = new Component({});

        comp.getElement(true);
        Event.fireEvent(comp, 'click');

        expect(sink.writes.some((w) => w.op === 'dispatchEvent' && w.args[0] === 'click')).toBe(true);
    });
});

describe('Event.addSubtreeListener / addViewportListener accounting', () => {
    afterEach(() => DOM.reset());

    // The modelled source's getParentElement returns null, so the subtree walk
    // cannot be exercised offline — we assert only install/uninstall accounting.
    it('addSubtreeListener installs one base listener per type', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addSubtreeListener(comp, type, () => {});
        Event.addSubtreeListener(new Component({}), type, () => {});

        expect(countWrites(sink, 'addListener', type)).toBe(1);
    });

    it('addViewportListener installs one base listener per type', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addViewportListener(comp, type, () => {});
        Event.addViewportListener(new Component({}), type, () => {});

        expect(countWrites(sink, 'addListener', type)).toBe(1);
    });
});

describe('removeListener / removeViewportListener no-op on an unregistered listener', () => {
    afterEach(() => DOM.reset());

    // Regression test: indexOf returns -1 for a listener that was never added,
    // and splice(-1, 1) removes the LAST element instead of nothing — silently
    // dropping an unrelated, still-registered listener.
    it('removeListener does not drop the real listener when passed a stray one', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});
        const real = (): void => {};
        const stray = (): void => {};

        Event.addListener(comp, type, real);
        Event.removeListener(comp, type, stray);

        // A no-op removal must not uninstall the base listener the real one still needs.
        expect(countWrites(sink, 'removeListener', type)).toBe(0);

        Event.removeListener(comp, type, real);
        expect(countWrites(sink, 'removeListener', type)).toBe(1);
    });

    it('removeViewportListener does not drop the real listener when passed a stray one', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});
        const real = (): void => {};
        const stray = (): void => {};

        Event.addViewportListener(comp, type, real);
        Event.removeViewportListener(comp, type, stray);

        expect(countWrites(sink, 'removeListener', type)).toBe(0);

        Event.removeViewportListener(comp, type, real);
        expect(countWrites(sink, 'removeListener', type)).toBe(1);
    });
});

describe('Event.purgeComponent', () => {
    afterEach(() => DOM.reset());

    it('E1 — clears all three maps for one id', () => {
        installTestDOM(CONFIG);
        const comp = new Component({});
        const exactType = uniqueType();
        const subtreeType = uniqueType();
        const viewportType = uniqueType();

        Event.addListener(comp, exactType, () => {});
        Event.addSubtreeListener(comp, subtreeType, () => {});
        Event.addViewportListener(comp, viewportType, () => {});

        expect(Event._registeredComponentIds()).toContain(comp.getId());

        Event.purgeComponent(comp.getId());

        expect(Event._registeredComponentIds()).not.toContain(comp.getId());
    });

    it('E2 — uninstalls a base listener whose last registration it removed', () => {
        const sink = installTestDOM(CONFIG);
        const exactType = uniqueType();
        const viewportType = uniqueType();
        const exactComp = new Component({});
        const viewportComp = new Component({});

        Event.addListener(exactComp, exactType, () => {});
        Event.addViewportListener(viewportComp, viewportType, () => {});

        Event.purgeComponent(exactComp.getId());
        expect(countWrites(sink, 'removeListener', exactType)).toBe(1);

        Event.purgeComponent(viewportComp.getId());
        expect(countWrites(sink, 'removeListener', viewportType)).toBe(1);
    });

    it('E3 — a sibling\'s registrations for the same type survive', () => {
        const sink = installTestDOM(CONFIG);
        const type = uniqueType();
        const a = new Component({});
        const b = new Component({});

        Event.addListener(a, type, () => {});
        Event.addListener(b, type, () => {});

        Event.purgeComponent(a.getId());

        expect(Event._registeredComponentIds()).toContain(b.getId());
        expect(countWrites(sink, 'removeListener', type)).toBe(0);
    });

    it('E4 — purging an id with no registrations is a no-op', () => {
        const sink = installTestDOM(CONFIG);
        const comp = new Component({});

        expect(() => Event.purgeComponent(comp.getId())).not.toThrow();
        expect(sink.writes.length).toBe(0);
    });

    it('E5 — dispose() drives the purge; removeComponent does not', () => {
        installTestDOM(CONFIG);
        const type = uniqueType();
        const child = new Component({});
        const container = new Component({});
        const otherContainer = new Component({});

        Event.addSubtreeListener(child, type, () => {});
        container.addComponent(child);

        container.removeComponent(child);
        expect(Event._registeredComponentIds()).toContain(child.getId());

        otherContainer.addComponent(child);
        expect(Event._registeredComponentIds()).toContain(child.getId());

        child.dispose();
        expect(Event._registeredComponentIds()).not.toContain(child.getId());
    });
});

// Diagnostics overlay support (plans/implemented/debug-diagnostics-overlay.md,
// Expected Behaviour rows 10-11). `listenerCounts()` sums module-level state
// that outlives every test, so both cases diff against a before/after snapshot
// rather than asserting an absolute count.
describe('Event.listenerCounts', () => {
    afterEach(() => DOM.reset());

    it('10. rises on registration and falls back on removal', () => {
        installTestDOM(CONFIG);
        const exactType   = uniqueType();
        const subtreeType = uniqueType();
        const exactFn      = (): void => {};
        const subtreeFn    = (): void => {};
        const comp = new Component({});

        const before = Event.listenerCounts();

        Event.addListener(comp, exactType, exactFn);
        Event.addSubtreeListener(comp, subtreeType, subtreeFn);

        const during = Event.listenerCounts();
        expect(during.exact - before.exact).toBe(1);
        expect(during.subtree - before.subtree).toBe(1);
        expect(during.total - before.total).toBe(2);

        Event.removeListener(comp, exactType, exactFn);
        Event.removeSubtreeListener(comp, subtreeType, subtreeFn);

        const after = Event.listenerCounts();
        expect(after).toEqual(before);
    });

    it('11. disposing a component clears its DOM listener registrations', () => {
        installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        const before = Event.listenerCounts();

        Event.addListener(comp, type, () => {});
        expect(Event.listenerCounts().total).toBe(before.total + 1);

        comp.dispose();

        expect(Event.listenerCounts()).toEqual(before);
    });
});
