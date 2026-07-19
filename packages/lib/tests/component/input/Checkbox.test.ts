//
// Checkbox checked-state coverage. Most cases run on a bare (unmounted)
// checkbox: setSelected guards its synthetic `click` behind `if
// (this.getElement())`, so unmounted it only console.warns and the state flip
// still happens. The one mount-requiring case asserts the `on("action")`
// synthetic-click fan-out and uses the TestDOM ritual copied from
// tests/component/layout/Tab.test.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Checkbox } from '~/component/input/Checkbox';
import { Container } from '~/core/Container';
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

describe('Checkbox value/selected aliasing', () => {
    it('aliases the value option onto selected when selected is absent', () => {
        expect(new Checkbox({ value: true }).isSelected()).toBe(true);
    });

    it('lets an explicit selected win over value', () => {
        expect(new Checkbox({ value: true, selected: false }).isSelected()).toBe(false);
    });

    it('mirrors getValue/setValue onto isSelected/setSelected', () => {
        const cb = new Checkbox();
        expect(cb.getValue()).toBe(false);

        cb.setValue(true);
        expect(cb.isSelected()).toBe(true);
        expect(cb.getValue()).toBe(true);
    });
});

describe('Checkbox setSelected transitions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('flips state and warns (no synthetic click) when unmounted', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb   = new Checkbox();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fires change exactly once across a flip and a redundant set', () => {
        // Silence the unmounted-setSelected console.warn; not asserted here.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cb = new Checkbox();

        let changes = 0;
        cb.on('change', () => {
            changes += 1;
        });

        cb.setSelected(true);
        cb.setSelected(true); // no-op guard: already selected, not indeterminate.

        expect(cb.isSelected()).toBe(true);
        expect(changes).toBe(1);
    });
});

describe('Checkbox indeterminate force-out', () => {
    afterEach(() => vi.restoreAllMocks());

    it('enters the mixed state via setIndeterminate', () => {
        const cb = new Checkbox();
        cb.setIndeterminate(true);

        expect(cb.isIndeterminate()).toBe(true);
    });

    it('clears indeterminate and lands selected on a subsequent setSelected(true)', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();
        cb.setIndeterminate(true);
        cb.setSelected(true);

        expect(cb.isIndeterminate()).toBe(false);
        expect(cb.isSelected()).toBe(true);
    });
});

describe('Checkbox label round-trip', () => {
    it('reads back a label and clears it with null', () => {
        const cb = new Checkbox({ label: 'Accept' });
        expect(cb.getLabel()).toBe('Accept');

        cb.setLabel(null);
        expect(cb.getLabel()).toBe(null);
    });
});

describe('Checkbox notifyChange fan-out (binding)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('fires both change (with value) and binding (no args) on a transition', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const cb = new Checkbox();

        let changeValue: boolean | null = null;
        let bindings = 0;
        cb.on('change', (v: boolean) => {
            changeValue = v;
        });
        cb.on('binding', () => {
            bindings += 1;
        });

        cb.setSelected(true);

        expect(changeValue).toBe(true);
        expect(bindings).toBe(1);
    });
});

describe('Checkbox action fan-out (mounted)', () => {
    afterEach(() => DOM.reset());

    it('dispatches a synthetic click on a programmatic setSelected once mounted', () => {
        // The offline RecordingDOMSink records DOM writes but runs no event
        // loop, so a real `on("action")` callback cannot be invoked here
        // (mirrors tests/unit/core/Event.test.ts, which asserts the recorded
        // dispatchEvent write rather than listener invocation). The `action`
        // listener is wired through `click`, so the contract under test —
        // "a mounted setSelected synthesizes the click" — is the recorded
        // dispatchEvent("click") write that the action path rides on.
        const sink = installTestDOM(CONFIG);

        const host = new Container({});
        const cb   = new Checkbox();
        host.addComponent(cb);
        // Realise the element so setSelected's synthetic Event.fireEvent("click")
        // dispatches to a mounted node instead of console-warning.
        host.getElement(true);
        cb.getElement(true);
        // Drain construction-time pending layouts on the host subtree while the
        // elements are valid, then pause both. The module-level pending-layout
        // set outlives this file, so an undrained component would flush on a
        // later file's real rAF after this DOM was reset — a stray "DOM handle
        // not registered" error. Draining + pausing keeps the queue clean.
        host.flushLayout();
        host.pauseLayout();
        cb.flushLayout();
        cb.pauseLayout();

        cb.setSelected(true);

        expect(cb.isSelected()).toBe(true);
        expect(sink.writes.some((w: any) => w.op === 'dispatchEvent' && w.args[0] === 'click')).toBe(true);
    });
});
