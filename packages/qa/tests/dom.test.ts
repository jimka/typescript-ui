// @vitest-environment jsdom
//
// fireMouse builds real `MouseEvent`s, which node does not have; the rest of
// the harness tests run in plain node.
import { describe, it, expect } from 'vitest';
import { fireMouse } from '../src/harness/dom.js';

/** What a listener records of one event. */
interface Seen {
    event: Event;
    buttons: number;
    relatedTarget: EventTarget | null;
}

/**
 * Listens for `type` on `el`, runs `fire`, and returns what the listener saw.
 *
 * @param el - The target to listen on.
 * @param type - The event type.
 * @param fire - Dispatches the event.
 * @returns The one event the listener saw.
 */
function capture(el: EventTarget, type: string, fire: () => void): Seen {
    const seen: Seen[] = [];

    el.addEventListener(type, (event) => {
        const mouse = event as MouseEvent;

        seen.push({ event, buttons: mouse.buttons, relatedTarget: mouse.relatedTarget });
    });

    fire();

    expect(seen).toHaveLength(1);

    return seen[0];
}

describe('E11 fireMouse', () => {
    const X = 12;
    const Y = 34;

    /**
     * Checks the fields every `fireMouse` event shares.
     *
     * @param seen - What the listener recorded.
     * @param type - The expected event type.
     */
    function expectCommonFields(seen: Seen, type: string): void {
        const event = seen.event as MouseEvent;

        expect(event).toBeInstanceOf(MouseEvent);
        expect(event.type).toBe(type);
        expect(event.bubbles).toBe(true);
        expect(event.cancelable).toBe(true);
        expect(event.button).toBe(0);
        expect(event.clientX).toBe(X);
        expect(event.clientY).toBe(Y);
    }

    it('mousedown defaults to buttons 1 and no relatedTarget', () => {
        const div = document.createElement('div');
        const seen = capture(div, 'mousedown', () => fireMouse('mousedown', div, X, Y));

        expectCommonFields(seen, 'mousedown');
        expect(seen.buttons).toBe(1);
        expect(seen.relatedTarget).toBeNull();
    });

    it('mousemove on the document defaults to buttons 1', () => {
        const seen = capture(document, 'mousemove', () => fireMouse('mousemove', document, X, Y));

        expectCommonFields(seen, 'mousemove');
        expect(seen.buttons).toBe(1);
        expect(seen.relatedTarget).toBeNull();
    });

    it('mouseup defaults to buttons 0', () => {
        const div = document.createElement('div');
        const seen = capture(div, 'mouseup', () => fireMouse('mouseup', div, X, Y));

        expectCommonFields(seen, 'mouseup');
        expect(seen.buttons).toBe(0);
        expect(seen.relatedTarget).toBeNull();
    });

    it('takes buttons 0 for a hover move', () => {
        const div = document.createElement('div');
        const seen = capture(div, 'mousemove', () => fireMouse('mousemove', div, X, Y, { buttons: 0 }));

        expectCommonFields(seen, 'mousemove');
        expect(seen.buttons).toBe(0);
        expect(seen.relatedTarget).toBeNull();
    });

    it('carries relatedTarget on mouseout', () => {
        const a = document.createElement('div');
        const b = document.createElement('div');
        const seen = capture(a, 'mouseout', () => fireMouse('mouseout', a, X, Y, { buttons: 0, relatedTarget: b }));

        expectCommonFields(seen, 'mouseout');
        expect(seen.buttons).toBe(0);
        expect(seen.relatedTarget).toBe(b);
    });
});
