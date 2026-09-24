// @vitest-environment jsdom
//
// Checkbox, RadioButton and Slider each commit state and then dispatch a DOM
// event at the end of a user activation, after running the control's own
// "change" / "binding" listeners. When one of those listeners disposes the
// control — an ordinary pattern for a form rebuilt on a record change — the
// dispatch that follows has no element to fire on. ToggleButton runs no
// listener of its own between its state write and its dispatch, so its guard
// only reaches the unmounted and subclass-disposed cases the B block covers.
//
// The modelled test DOM cannot reproduce this: RecordingDOMSink.removeElement
// clears a handle's parent but leaves it in the id index, so
// DOM.source.getElementById() still answers after a dispose and getElement()
// still returns a handle — every assertion here would pass against the
// unfixed code. This file keeps the `@vitest-environment jsdom` pragma and
// runs against the real production DOM.sink / DOM.source pair instead (see
// tests/dom/event-subtree-reentrant-dispose.test.ts for the same recipe), and
// must not call installTestDOM, which would install the modelled baseline and
// make the cases vacuous again.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { DOM, ProductionDOMSink, ProductionDOMSource } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Container } from '~/core/Container';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { ToggleButton } from '~/component/button/ToggleButton';
import { Slider } from '~/component/input/Slider';

// Primes the shared SVG glyph sprite (Glyphs.ts) for Checkbox's "check" symbol
// and RadioButton's "circle" symbol before this file's first DOM.reset() runs.
// Glyphs.ts caches the sprite's own Handle at module scope and never
// refreshes it on reset, so a symbol mounted for the first time *after* a
// reset resolves that stale Handle against the fresh registry and can append
// into whatever element now holds that recycled handle number instead of the
// sprite — corrupting the DOM. Rendering both glyphs once, here, before any
// reset, registers them in Glyphs.ts's idempotency map so every later mount
// in this file (across as many resets as it runs) finds its symbol already
// there and never touches the sprite Handle again. See `## Implementation
// Notes` in the plan for the full root-cause trace.
beforeAll(() => {
    (new Checkbox() as any).getElement(true);
    (new RadioButton() as any).getElement(true);
});

afterEach(() => {
    DOM.reset();
});

/** A Container mounted under the real document body, to host one control. */
function mountedHost(): Container {
    const host = new Container({});
    (DOM.sink as ProductionDOMSink).appendChild(
        (DOM.source as ProductionDOMSource).getBody(),
        host.getElement(true)!,
    );

    return host;
}

/**
 * Dispatches `event` on the element with `id` and reports whether jsdom's
 * `reportException` surfaced an uncaught error. An exception thrown inside a
 * native listener does not propagate through `dispatchEvent()`'s own call
 * stack — jsdom dispatches a synchronous 'error' event on `window` instead.
 */
function dispatchAndCatch(id: string, event: globalThis.Event): ErrorEvent | null {
    let caught: ErrorEvent | null = null;
    const onError = (e: ErrorEvent): void => {
        caught = e;
        e.preventDefault();
    };

    window.addEventListener('error', onError);
    try {
        document.getElementById(id)!.dispatchEvent(event);
    } finally {
        window.removeEventListener('error', onError);
    }

    return caught;
}

describe('activation on a mounted control whose own "change" listener disposes it', () => {
    it('A1 — Checkbox click: commits state, no uncaught error, "action" is skipped', () => {
        const host = mountedHost();
        const cb   = new Checkbox() as any;
        host.addComponent(cb);
        cb.getElement(true);
        cb._box.getElement(true);          // the element the gesture targets

        cb._box.pauseLayout();
        cb._check.pauseLayout();
        cb._dash.pauseLayout();
        cb.pauseLayout();
        host.pauseLayout();
        host.flushLayout();
        cb.flushLayout();

        let changes = 0;
        cb.on('change', () => {
            changes += 1;
            cb.dispose();
        });

        let actions = 0;
        cb.on('action', () => {
            actions += 1;
        });

        // A later listener on the clicked element: skipped today because the
        // throw ends the dispatch; after the fix it runs.
        const laterClick = vi.fn();
        Event.addListener(cb._box, 'click', laterClick);

        // A subtree listener on an ancestor: stays silent before and after
        // the fix, once the clicked element's handle has been released — the
        // existing guard at Event.ts's dispatchToSubtreeListeners, covered by
        // event-subtree-reentrant-dispose.test.ts's EV1.
        const subtreeClick = vi.fn();
        Event.addSubtreeListener(host, 'click', subtreeClick);

        const caught = dispatchAndCatch(
            cb._box.getId(),
            new MouseEvent('click', { bubbles: true, button: 0 }),
        );

        expect(caught).toBeNull();
        expect(cb.isSelected()).toBe(true);
        expect(changes).toBe(1);
        expect(actions).toBe(0);
        expect(laterClick).toHaveBeenCalledTimes(1);
        expect(subtreeClick).not.toHaveBeenCalled();
    });

    it('A1 continued — surviving listeners of the same "change" notification are unaffected', () => {
        // Pins the ListenerBag contract concepts/component-lifecycle.md
        // states ("once the component is destroyed, `_listeners` is
        // cleared"), so this fix does not quietly alter it: the disposing
        // listener and any listener registered in the same bucket ahead of
        // the destroy run; a later `emit()` call reads an already-cleared bag.
        const host = mountedHost();
        const cb   = new Checkbox() as any;
        host.addComponent(cb);
        cb.getElement(true);
        cb._box.getElement(true);

        cb._box.pauseLayout();
        cb._check.pauseLayout();
        cb._dash.pauseLayout();
        cb.pauseLayout();
        host.pauseLayout();
        host.flushLayout();
        cb.flushLayout();

        const order: string[] = [];
        cb.on('change', () => {
            order.push('change#1');
            cb.dispose();
        });
        cb.on('change', () => {
            order.push('change#2');
        });
        cb.on('binding', () => {
            order.push('binding#1');
        });

        const caught = dispatchAndCatch(
            cb._box.getId(),
            new MouseEvent('click', { bubbles: true, button: 0 }),
        );

        expect(caught).toBeNull();
        expect(order).toEqual(['change#1', 'change#2']);
    });

    it('A2 — RadioButton click: commits state, no uncaught error, "action" is skipped', () => {
        const host = mountedHost();
        const rb   = new RadioButton() as any;
        host.addComponent(rb);
        rb.getElement(true);
        rb._ring.getElement(true);         // the element the gesture targets

        rb._ring.pauseLayout();
        rb._dot.pauseLayout();
        rb.pauseLayout();
        host.pauseLayout();
        host.flushLayout();
        rb.flushLayout();

        let changes = 0;
        rb.on('change', () => {
            changes += 1;
            rb.dispose();
        });

        let actions = 0;
        rb.on('action', () => {
            actions += 1;
        });

        const caught = dispatchAndCatch(
            rb._ring.getId(),
            new MouseEvent('click', { bubbles: true, button: 0 }),
        );

        expect(caught).toBeNull();
        expect(rb.isSelected()).toBe(true);
        expect(changes).toBe(1);
        expect(actions).toBe(0);
    });

    it('A3 — Slider ArrowRight: commits value, no uncaught error, "action" is skipped', () => {
        const host   = mountedHost();
        const slider = new Slider({ min: 0, max: 100, step: 1, value: 10 }) as any;
        host.addComponent(slider);
        slider.getElement(true);           // the slider has no inner graphic to realize

        slider.pauseLayout();
        host.pauseLayout();
        host.flushLayout();
        slider.flushLayout();

        let changes = 0;
        slider.on('change', () => {
            changes += 1;
            slider.dispose();
        });

        let actions = 0;
        slider.on('action', () => {
            actions += 1;
        });

        const caught = dispatchAndCatch(
            slider.getId(),
            new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }),
        );

        expect(caught).toBeNull();
        expect(slider.getValue()).toBe(11);
        expect(changes).toBe(1);
        expect(actions).toBe(0);
    });
});

describe('activation on a control with no element', () => {
    it('B1 — Checkbox.activate(): commits state, no throw', () => {
        const cb = new Checkbox() as any;

        expect(() => cb.activate()).not.toThrow();
        expect(cb.isSelected()).toBe(true);
    });

    it('B2 — RadioButton.activate(): commits state, no throw', () => {
        const rb = new RadioButton() as any;

        expect(() => rb.activate()).not.toThrow();
        expect(rb.isSelected()).toBe(true);
    });

    it('B3 — Slider.setValueFromUser(): commits value, no throw', () => {
        const slider = new Slider({ min: 0, max: 100, step: 1, value: 10 }) as any;

        expect(() => slider.setValueFromUser(20)).not.toThrow();
        expect(slider.getValue()).toBe(20);
    });

    it('B4 — ToggleButton.onAction(): commits state, no throw', () => {
        const tb = new ToggleButton('Bold') as any;

        expect(() => tb.onAction()).not.toThrow();
        expect(tb.isSelected()).toBe(true);
    });
});
