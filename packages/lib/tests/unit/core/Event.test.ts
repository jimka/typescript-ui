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
        expect(() => Event.addListener(comp, type, null as unknown as Function)).not.toThrow();

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

        Event.addListener(comp, type, () => {}, { passive: true });

        expect(() => Event.addListener(comp, type, () => {}, { passive: false }))
            .toThrow(/conflict with earlier registration/);
    });

    it('does not throw when the later registration matches the earlier setting', () => {
        installTestDOM(CONFIG);
        const type = uniqueType();
        const comp = new Component({});

        Event.addListener(comp, type, () => {}, { passive: true });

        expect(() => Event.addListener(comp, type, () => {}, { passive: true })).not.toThrow();
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
