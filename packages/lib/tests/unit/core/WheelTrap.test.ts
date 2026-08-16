// WheelTrap installs a non-passive subtree `wheel` listener on an overlay that
// preventDefault()s any wheel the event reaches it UNCONSUMED — trapping wheels
// no inner scroller claimed so they cannot fall through to content behind the
// overlay. Real wheel delivery / native scroll are NOT exercisable offline (the
// recording sink delivers no events), so we assert only the two automatable
// facts: (1) the registration/removal/idempotency bookkeeping against the Event
// subtree surface, and (2) the pure gate logic — the captured handler calls
// preventDefault exactly when the event is unconsumed. The behavioural cases
// (page-behind does not scroll, inner scroll still works, teardown, Tooltip
// unaffected) are documented manual-verify steps in the plan.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Event } from '~/core/Event';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { consumeWheel } from '~/core/SmoothScroller';
import { trapWheel, untrapWheel } from '~/core/WheelTrap';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('WheelTrap registration / teardown / idempotency', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    it('registers exactly one non-passive wheel subtree listener for the component', () => {
        installTestDOM(CONFIG);
        const add = vi.spyOn(Event, 'addSubtreeListener');
        const comp = new Component({});

        trapWheel(comp);

        const wheelCalls = add.mock.calls.filter((c) => c[0] === comp && c[1] === 'wheel');

        expect(wheelCalls.length).toBe(1);
        expect(wheelCalls[0][2].passive).toBe(false);
    });

    it('is idempotent — a second trapWheel does not register a second listener', () => {
        installTestDOM(CONFIG);
        const add = vi.spyOn(Event, 'addSubtreeListener');
        const comp = new Component({});

        trapWheel(comp);
        trapWheel(comp);

        const wheelCalls = add.mock.calls.filter((c) => c[0] === comp && c[1] === 'wheel');

        expect(wheelCalls.length).toBe(1);
    });

    it('untrapWheel removes the exact listener that trapWheel registered', () => {
        installTestDOM(CONFIG);
        const add = vi.spyOn(Event, 'addSubtreeListener');
        const remove = vi.spyOn(Event, 'removeSubtreeListener');
        const comp = new Component({});

        trapWheel(comp);

        const registered = add.mock.calls.find((c) => c[0] === comp && c[1] === 'wheel')![2].handler;

        untrapWheel(comp);

        const removeCalls = remove.mock.calls.filter((c) => c[0] === comp && c[1] === 'wheel');

        expect(removeCalls.length).toBe(1);
        expect(removeCalls[0][2]).toBe(registered);
    });

    it('untrapWheel is a no-op when no trap was installed', () => {
        installTestDOM(CONFIG);
        const remove = vi.spyOn(Event, 'removeSubtreeListener');
        const comp = new Component({});

        expect(() => untrapWheel(comp)).not.toThrow();
        expect(remove).not.toHaveBeenCalled();
    });

    it('allows re-trapping after an untrap (handler map cleared on untrap)', () => {
        installTestDOM(CONFIG);
        const add = vi.spyOn(Event, 'addSubtreeListener');
        const comp = new Component({});

        trapWheel(comp);
        untrapWheel(comp);
        trapWheel(comp);

        const wheelCalls = add.mock.calls.filter((c) => c[0] === comp && c[1] === 'wheel');

        expect(wheelCalls.length).toBe(2);
    });
});

describe('WheelTrap gate logic (handler preventDefaults only when unconsumed)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        DOM.reset();
    });

    /**
     * Captures the handler trapWheel registered, so we can drive the gate
     * directly. The handler claims the wheel by RETURNING `{ prevent: true }`
     * rather than calling `e.preventDefault()` itself — the real dispatcher
     * applies that disposition, which this direct call bypasses.
     */
    function captureHandler(comp: Component): (e: WheelEvent) => Event.ListenerResult {
        const add = vi.spyOn(Event, 'addSubtreeListener');

        trapWheel(comp);

        return add.mock.calls.find((c) => c[0] === comp && c[1] === 'wheel')![2].handler as (e: WheelEvent) => Event.ListenerResult;
    }

    /** True when the handler's returned disposition asks the dispatcher to preventDefault. */
    function prevented(result: Event.ListenerResult): boolean {
        return typeof result === 'object' && !!result?.prevent;
    }

    it('preventDefaults a fresh (unconsumed) wheel — the trap swallows the leftover', () => {
        installTestDOM(CONFIG);
        const comp = new Component({});
        const handler = captureHandler(comp);

        const e = {} as unknown as WheelEvent;

        expect(prevented(handler(e))).toBe(true);
    });

    it('does NOT preventDefault when an inner scroller already consumed the wheel', () => {
        installTestDOM(CONFIG);
        const comp = new Component({});
        const handler = captureHandler(comp);

        const e = {} as unknown as WheelEvent;

        // Simulate an inner SmoothScroller having claimed it first.
        consumeWheel(e);

        expect(prevented(handler(e))).toBe(false);
    });

    it('claims the wheel once — a second handler pass on the same event does not re-preventDefault', () => {
        installTestDOM(CONFIG);
        const comp = new Component({});
        const handler = captureHandler(comp);

        const e = {} as unknown as WheelEvent;

        expect(prevented(handler(e))).toBe(true);
        expect(prevented(handler(e))).toBe(false);
    });
});
