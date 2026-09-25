// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A pointer resting on an invalid, decorated field must show why it is
// invalid. The decorator's field fills its whole box, so the pointer always
// lands on the field (or on one of its parts), never on the decorator that
// carries the error tooltip.
//
// Three things about how this file drives that:
//
// - It dispatches REAL events through `Event`'s window-level handler
//   (`DOM.sink.dispatchEvent`), not the stored listener closures
//   `Tooltip.test.ts` calls: only a real event exercises `Event`'s exact-target
//   phase followed by its subtree walk, which is what the decorator's covering
//   tooltip relies on.
// - It disposes `root` after every test. `Event`'s `installedListenerTypes`
//   bookkeeping is module state that outlives `DOM.reset()`, so a listener type
//   left registered would make the next test's dispatches silently vanish —
//   the gotcha documented in `Link.test.ts`'s file header. Disposing `root`
//   drops every registration below it, which uninstalls those types.
// - The modelled hit test (`DOM.source.elementsFromPoint`) ignores
//   `pointer-events`, so it would report a pointer-transparent glyph where a
//   real pointer hits the element beneath it. Every target is therefore taken
//   at a point where no pointer-transparent element sits on top, and asserted
//   before it is used.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Tooltip } from '~/overlay/Tooltip';
import { TextField } from '~/component/input/TextField';
import { DateField } from '~/component/input/DateField';
import { FieldDecorator } from '~/validation/FieldDecorator';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// Mirrors `Tooltip.attach`'s `setTimeout(..., 500)` hover delay: advancing
// exactly this far runs the show body.
const HOVER_DELAY_MS   = 500;
// Any point inside the hover delay, so a move lands while it is still running.
const PART_WAY_MS      = 200;
// Past the tooltip's 100 ms fade and its fallback timer, so a fade started by
// a test has finished before the next test's fixture is built.
const FADE_SETTLE_MS   = 500;
// Any width that gives each field part — a `DateField`'s input and its 24 px
// picker button — a non-empty box.
const DECORATOR_WIDTH  = 200;
// Room for a single-line field; a field with a lower maximum clamps it.
const DECORATOR_HEIGHT = 24;
// A point just inside an element's edge: inside the element, but outside its
// inner parts (a picker field's 3 px padding, a picker button's centred glyph).
const EDGE_INSET_PX    = 1;
// Any in-viewport pointer position. Only case 14 reads where the tooltip is
// placed, and it moves the pointer somewhere else first.
const CURSOR_PX        = 10;
// The listeners one error attachment registers on the decorator's subtree:
// `mouseover`, `mouseout` and `mousedown`.
const HOVER_LISTENERS  = 3;
// The viewport listeners the shared pointer watch installs: a `mousemove` that
// records the pointer's position, a `mouseout` that forgets it once the pointer
// leaves the window, and a `keydown` that lifts a press's arming suppression.
const WATCH_LISTENERS  = 3;

const ERROR         = 'Too long';
const HINT          = 'What goes here';
// The messages a re-validation replaces `ERROR` with, one after the other, so
// each `showError` is a real replacement rather than the kept-unchanged case.
const CHANGED       = 'Too short';
const CHANGED_AGAIN = 'Wrong format';

let root: Component;
let showSpy: MockInstance<typeof Tooltip.show>;

/**
 * Adds `field` to `root`, wraps it in a `FieldDecorator` and lays both out at
 * the fixed decorator size, so every part of the field has a real box.
 *
 * @param field - The field to decorate.
 * @param y - The decorator's top edge, to keep two decorated fields apart.
 * @returns The decorator now wrapping `field`.
 */
function mountDecorated(field: Component, y = 0): FieldDecorator {
    root.addComponent(field);

    const decorator = new FieldDecorator(field, root);

    decorator.setY(y);
    decorator.setWidth(DECORATOR_WIDTH);
    decorator.setHeight(DECORATOR_HEIGHT);
    decorator.doLayout();
    field.doLayout();

    return decorator;
}

/**
 * The element a pointer at `(x, y)` targets: the topmost element there.
 *
 * @param x - The viewport x coordinate.
 * @param y - The viewport y coordinate.
 * @returns The topmost element at the point.
 */
function hitAt(x: number, y: number): Handle {
    return DOM.source.elementsFromPoint(x, y)[0];
}

/**
 * The viewport point at the centre of `component`'s box: where a pointer that
 * has come to rest on it sits.
 *
 * @param component - The rendered component the pointer rests on.
 * @returns The centre of the component's box, in viewport coordinates.
 */
function centreOf(component: Component): { x: number; y: number } {
    const rect = DOM.source.getElementRect(component.getElement()!);

    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The element a pointer resting at the centre of `component`'s box targets.
 *
 * @param component - The rendered component whose centre is hit.
 * @returns The topmost element at that point.
 */
function hitCentre(component: Component): Handle {
    const centre = centreOf(component);

    return hitAt(centre.x, centre.y);
}

/**
 * The element a pointer just inside `component`'s left edge, halfway down,
 * targets.
 *
 * @param component - The rendered component whose left edge is hit.
 * @returns The topmost element at that point.
 */
function hitInsideLeftEdge(component: Component): Handle {
    const rect = DOM.source.getElementRect(component.getElement()!);

    return hitAt(rect.x + EDGE_INSET_PX, rect.y + rect.height / 2);
}

/**
 * The element a pointer just inside `component`'s top-left corner targets.
 *
 * @param component - The rendered component whose corner is hit.
 * @returns The topmost element at that point.
 */
function hitInsideCorner(component: Component): Handle {
    const rect = DOM.source.getElementRect(component.getElement()!);

    return hitAt(rect.x + EDGE_INSET_PX, rect.y + EDGE_INSET_PX);
}

/**
 * Dispatches a real mouse event of `type` on `target` through `Event`'s
 * window-level handler, with `from` as its `relatedTarget`.
 *
 * @param type - The mouse event type (`mouseover` or `mouseout`).
 * @param target - The element the event targets.
 * @param from - The event's `relatedTarget`: where the pointer came from, or is going to.
 */
function pointer(type: string, target: Handle, from: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, type, { clientX: CURSOR_PX, clientY: CURSOR_PX, relatedTarget: from }),
    );
}

/**
 * The pointer moves to `(x, y)` over `target`: a real `mousemove` there.
 *
 * @param target - The element under the pointer.
 * @param x - The pointer's viewport x coordinate.
 * @param y - The pointer's viewport y coordinate.
 */
function move(target: Handle, x: number, y: number): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, 'mousemove', { clientX: x, clientY: y }),
    );
}

/**
 * The pointer leaves the window from `target`: a `mouseout` naming no element
 * it moved to. The browser spells that `relatedTarget: null`; `makeEvent`
 * spells it by leaving the key out, and the library reads both the same way.
 *
 * @param target - The element the pointer was over as it left.
 */
function leaveWindow(target: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, 'mouseout', { clientX: CURSOR_PX, clientY: CURSOR_PX }),
    );
}

/** An element outside every decorated field: where an entering pointer comes from. */
function outside(): Handle {
    return DOM.source.getDocumentElement();
}

/**
 * The pointer enters `target` from outside every field.
 *
 * @param target - The element the pointer comes to rest on.
 */
function enter(target: Handle): void {
    pointer('mouseover', target, outside());
}

/**
 * The pointer moves from `from` onto `to`: a `mouseout` on `from` and then a
 * `mouseover` on `to`, each naming the other as its `relatedTarget`.
 *
 * @param from - The element the pointer leaves.
 * @param to - The element the pointer moves onto.
 */
function cross(from: Handle, to: Handle): void {
    pointer('mouseout', from, to);
    pointer('mouseover', to, from);
}

/**
 * A key press anywhere: the typing that follows a click into a field, and what
 * lifts a press's arming suppression.
 *
 * @param target - The element the key event targets.
 */
function typeKey(target: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, 'keydown', { key: 'a' }),
    );
}

/**
 * A primary-button press on `target`.
 *
 * @param target - The element pressed.
 */
function press(target: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, 'mousedown', { clientX: CURSOR_PX, clientY: CURSOR_PX, button: 0, buttons: 1 }),
    );
}

/** The texts passed to `Tooltip.show`, in call order. */
function shownTexts(): string[] {
    return showSpy.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
    installTestDOM(CONFIG);
    vi.useFakeTimers();

    root = new Component({});
    root.getElement(true);

    showSpy = vi.spyOn(Tooltip, 'show');
});

afterEach(() => {
    Tooltip.hide();
    vi.advanceTimersByTime(FADE_SETTLE_MS);

    root.dispose();

    vi.useRealTimers();
    vi.restoreAllMocks();

    (Tooltip as any).showTimer = null;
    (Tooltip as any).instance = null;
    (Tooltip as any).watching = false;
    (Tooltip as any).activeElement = null;
    (Tooltip as any).pendingId = null;
    (Tooltip as any).dismissing = false;
    (Tooltip as any).attachments.clear();

    // The pointer watch is installed with the first attachment and never
    // removed during a session, so its viewport registration would outlive the
    // DOM it was made against and silently swallow the next test's moves.
    Tooltip._stopPointerWatch();

    DOM.reset();
});

describe('FieldDecorator — the error tooltip under a pointer', () => {
    it('1. resting on a decorated text field shows its error', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
        expect((Tooltip as any).activeElement).toBe(decorator.getElement());
    });

    it('2. resting on a decorated date field\'s input shows its error', () => {
        const field     = new DateField();
        const decorator = mountDecorated(field);
        const [input]   = field.getComponents();

        decorator.showError(ERROR);

        const target = hitCentre(input);

        expect(target).toBe(input.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('3. moving from a date field\'s input onto its picker button keeps the error up', () => {
        const field                 = new DateField();
        const decorator             = mountDecorated(field);
        const [input, pickerButton] = field.getComponents();

        decorator.showError(ERROR);

        const inputTarget  = hitCentre(input);
        const buttonTarget = hitInsideLeftEdge(pickerButton);

        expect(inputTarget).toBe(input.getElement());
        expect(buttonTarget).toBe(pickerButton.getElement());

        enter(inputTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        cross(inputTarget, buttonTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(decorator.getElement());
    });

    it('4. leaving the field dismisses its error', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        pointer('mouseout', target, outside());

        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).activeElement).toBe(null);
    });

    it('5. the error takes precedence over a tooltip attached to the field itself', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        Tooltip.attach(field, HINT);
        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('6. once the error is cleared, the field\'s own tooltip shows again', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        Tooltip.attach(field, HINT);
        decorator.showError(ERROR);
        decorator.clearError();

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([HINT]);
    });

    it('7. crossing a date field\'s own edge keeps the error up over the field\'s own tooltip', () => {
        const field     = new DateField();
        const decorator = mountDecorated(field);
        const [input]   = field.getComponents();

        Tooltip.attach(field, HINT);
        decorator.showError(ERROR);

        const inputTarget = hitCentre(input);
        const edgeTarget  = hitInsideCorner(field);

        expect(inputTarget).toBe(input.getElement());
        expect(edgeTarget).toBe(field.getElement());

        enter(inputTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        cross(inputTarget, edgeTarget);
        cross(edgeTarget, inputTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(decorator.getElement());
    });

    /**
     * Two decorated text fields, the second one decorator-height clear of the
     * first, both in error — C21's `A` and `B`, reached by a pointer.
     *
     * @returns The first field and both decorators.
     */
    function twoDecorated(): { field: Component; first: FieldDecorator; second: FieldDecorator } {
        const field  = new TextField();
        const first  = mountDecorated(field);
        const second = mountDecorated(new TextField(), 2 * DECORATOR_HEIGHT);

        first.showError(ERROR);
        second.showError('Other');

        return { field, first, second };
    }

    it('8. another decorator re-attaching and clearing its error leaves this one\'s on screen', () => {
        const { field, first, second } = twoDecorated();

        const target = hitCentre(first);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        second.showError('Other, again');
        second.clearError();

        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(first.getElement());
    });

    it('9. another decorator re-attaching its error leaves this one\'s hover delay running', () => {
        const { field, first, second } = twoDecorated();

        const target = hitCentre(first);

        expect(target).toBe(field.getElement());

        enter(target);

        second.showError('Other, again');

        expect((Tooltip as any).pendingId).toBe(first.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('10. clearing the error dismisses it while it is on screen', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        decorator.clearError();

        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).activeElement).toBe(null);
    });

    it('11. a cleared error never shows', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);
        decorator.clearError();

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });

    it('12. a press dismisses the error, which stays hidden while the pointer stays on the field', () => {
        const field                 = new DateField();
        const decorator             = mountDecorated(field);
        const [input, pickerButton] = field.getComponents();

        decorator.showError(ERROR);

        const inputTarget  = hitCentre(input);
        const buttonTarget = hitInsideLeftEdge(pickerButton);

        expect(inputTarget).toBe(input.getElement());
        expect(buttonTarget).toBe(pickerButton.getElement());

        enter(inputTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        press(inputTarget);

        expect((Tooltip as any).dismissing).toBe(true);

        cross(inputTarget, buttonTarget);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('13. leaving the field while the error\'s hover delay runs means it never shows', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        pointer('mouseout', target, outside());
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
        expect((Tooltip as any).pendingId).toBe(null);
    });

    it('14. the error shows where the pointer comes to rest on the field, not where it entered', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);
        const rect   = DOM.source.getElementRect(decorator.getElement()!);
        const restX  = rect.x + rect.width / 2;
        const restY  = rect.y + rect.height / 2;

        expect(target).toBe(field.getElement());
        expect([restX, restY]).not.toEqual([CURSOR_PX, CURSOR_PX]);

        enter(target);
        move(target, restX, restY);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(showSpy).toHaveBeenCalledTimes(1);
        expect(showSpy).toHaveBeenCalledWith(ERROR, restX, restY);
    });

    it('15. replacing or clearing the error leaves no hover listener of the old one behind', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);
        const before    = Event.listenerCounts().subtree;

        decorator.showError(ERROR);

        expect(Event.listenerCounts().subtree).toBe(before + HOVER_LISTENERS);

        decorator.showError('Other');

        expect(Event.listenerCounts().subtree).toBe(before + HOVER_LISTENERS);

        decorator.clearError();

        expect(Event.listenerCounts().subtree).toBe(before);
    });

    it('16. moving from a date field\'s input onto its picker button during the hover delay still shows the error', () => {
        const field                 = new DateField();
        const decorator             = mountDecorated(field);
        const [input, pickerButton] = field.getComponents();

        decorator.showError(ERROR);

        const inputTarget  = hitCentre(input);
        const buttonTarget = hitInsideLeftEdge(pickerButton);

        expect(inputTarget).toBe(input.getElement());
        expect(buttonTarget).toBe(pickerButton.getElement());

        enter(inputTarget);
        vi.advanceTimersByTime(PART_WAY_MS);

        cross(inputTarget, buttonTarget);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    /**
     * A decorated text field in error, its error on screen, and the pointer
     * come to rest at the field's centre without leaving it — the state a
     * re-validation that changes the message is reached from.
     *
     * @returns The decorator, the element under the pointer and the rest point.
     */
    function restingOnShownError(): { decorator: FieldDecorator; target: Handle; rest: { x: number; y: number } } {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);
        const rest   = centreOf(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        move(target, rest.x, rest.y);

        return { decorator, target, rest };
    }

    it('17. a changed error under a resting pointer shows without a re-hover', () => {
        const { decorator, rest } = restingOnShownError();

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED]);
        expect(showSpy).toHaveBeenLastCalledWith(CHANGED, rest.x, rest.y);
    });

    it('18. a first error under a resting pointer shows without a re-hover', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        // The pointer watch starts with the session's first attachment, so no
        // position is known before one exists. `root` has no box, so the
        // modelled hit test never reports it under the pointer.
        Tooltip.attach(root, HINT);

        const rest = centreOf(decorator);

        expect(hitAt(rest.x, rest.y)).toBe(field.getElement());

        move(field.getElement()!, rest.x, rest.y);

        decorator.showError(ERROR);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('19. an error attached while the pointer is elsewhere stays silent', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        Tooltip.attach(root, HINT);

        const rest = centreOf(decorator);
        // One decorator height below its centre, so the point is clear of the
        // decorator's box.
        const awayY = rest.y + DECORATOR_HEIGHT;

        expect(hitAt(rest.x, awayY)).not.toBe(field.getElement());

        move(outside(), rest.x, awayY);

        decorator.showError(ERROR);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });

    it('20. a second decorator\'s changed error does not disturb the first\'s running delay', () => {
        const { field, first, second } = twoDecorated();

        const target = hitCentre(first);
        const rest   = centreOf(first);

        expect(target).toBe(field.getElement());

        enter(target);
        move(target, rest.x, rest.y);

        second.showError('Other, changed');

        expect((Tooltip as any).pendingId).toBe(first.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('21. a second changed message arms again, with no pointer movement in between', () => {
        const { decorator, rest } = restingOnShownError();

        decorator.showError(CHANGED);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        decorator.showError(CHANGED_AGAIN);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED, CHANGED_AGAIN]);
        expect(showSpy).toHaveBeenLastCalledWith(CHANGED_AGAIN, rest.x, rest.y);
    });

    it('22. the pointer watch is installed once and outlives the attachment', () => {
        const decorator = mountDecorated(new TextField());
        const before    = Event.listenerCounts().viewport;

        decorator.showError(ERROR);

        expect(Event.listenerCounts().viewport).toBe(before + WATCH_LISTENERS);

        decorator.clearError();

        expect(Event.listenerCounts().viewport).toBe(before + WATCH_LISTENERS);

        decorator.showError(ERROR);

        expect(Event.listenerCounts().viewport).toBe(before + WATCH_LISTENERS);
    });

    it('23. a changed error never takes over a hover delay the field itself armed', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        // The field carries a tooltip of its own, and the pointer entering it
        // armed that one's delay — the decorator is not in error yet, so
        // nothing claims the hover from it.
        Tooltip.attach(field, HINT);

        const target = hitCentre(decorator);
        const rest   = centreOf(decorator);

        expect(target).toBe(field.getElement());

        enter(target);

        expect((Tooltip as any).pendingId).toBe(field.getId());

        move(target, rest.x, rest.y);

        // The pointer rests inside the decorator, so the error would arm if it
        // were free to — but the delay running is somebody else's.
        decorator.showError(ERROR);

        expect((Tooltip as any).pendingId).toBe(field.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([HINT]);
    });

    it('24. a press keeps a changed error from arming until something is typed', () => {
        const { decorator, target } = restingOnShownError();

        press(target);

        expect((Tooltip as any).dismissing).toBe(true);

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('26. typing after the press lets the changed error arm', () => {
        const { decorator, target, rest } = restingOnShownError();

        // Click into the field, type, and the message describing what was typed
        // appears without the pointer moving — the sequence this plan exists for.
        press(target);
        typeKey(target);

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED]);
        expect(showSpy).toHaveBeenLastCalledWith(CHANGED, rest.x, rest.y);
    });

    it('27. a press nobody types after suppresses only the component it pressed', () => {
        const field  = new TextField();
        const first  = mountDecorated(field);
        const second = mountDecorated(new TextField(), 2 * DECORATOR_HEIGHT);

        first.showError(ERROR);
        second.showError('Other');

        const firstTarget  = hitCentre(first);
        const secondTarget = hitCentre(second);
        const secondRest   = centreOf(second);

        expect(firstTarget).toBe(field.getElement());

        enter(firstTarget);
        press(firstTarget);

        expect((Tooltip as any).pendingId).toBe(null);

        // The pointer settles on the second field without entering it, so only
        // the attach below can arm — and the press it follows was somebody
        // else's.
        move(secondTarget, secondRest.x, secondRest.y);

        second.showError('Other, changed');

        expect((Tooltip as any).pendingId).toBe(second.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual(['Other, changed']);
    });

    it('29. a press stops suppressing once the pointer has left the component', () => {
        const { decorator, target } = restingOnShownError();

        press(target);

        // The pointer leaves the field and comes back. Coming back raises a
        // `mouseover` that shows the error again by itself, so whatever the press
        // was for is over and a changed message must not be held back.
        pointer('mouseout', target, outside());
        enter(target);

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED]);
    });

    it('33. a leave of an inner part does not lift the decorator\'s own suppression', () => {
        const field                 = new DateField();
        const decorator             = mountDecorated(field);
        const [input, pickerButton] = field.getComponents();

        // The input carries a description of its own, so it has a `mouseout` of
        // its own — the crossing below is a leave for the input while the pointer
        // never leaves the decorator.
        Tooltip.attach(input, HINT);
        decorator.showError(ERROR);

        const inputTarget  = hitCentre(input);
        const buttonTarget = hitInsideLeftEdge(pickerButton);

        expect(inputTarget).toBe(input.getElement());
        expect(buttonTarget).toBe(pickerButton.getElement());

        move(inputTarget, CURSOR_PX, CURSOR_PX);
        press(inputTarget);

        cross(inputTarget, buttonTarget);

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });

    it('30. a never-rendered decorator never reaches the containment read', () => {
        const field  = new TextField();
        const holder = new Component({});

        holder.addComponent(field);

        const decorator = new FieldDecorator(field, holder);

        // Nothing here is rendered, so the decorator has no element — while the
        // pointer's position is known, which is what leaves its own element the
        // only thing that can stop the read. Reaching the containment read with
        // no element resolves a null handle, which throws in production;
        // `Binding` reaches `showError` before a decorator's first render.
        Tooltip.attach(root, HINT);
        move(root.getElement()!, CURSOR_PX, CURSOR_PX);

        const contains = vi.spyOn(DOM.source, 'contains');

        decorator.showError(ERROR);

        expect(decorator.getElement() ?? null).toBe(null);
        expect(contains).not.toHaveBeenCalled();
        expect((Tooltip as any).pendingId).toBe(null);

        decorator.dispose();
        holder.dispose();
    });

    it('31. a hover with no move behind it still leaves the pointer recorded', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        // No `mousemove` anywhere in this case, so the hover itself is the only
        // thing that can have recorded where the pointer is.
        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED]);
    });

    it('32. a crossing that names where the pointer went keeps it recorded', () => {
        const { decorator, target } = restingOnShownError();

        // An ordinary boundary crossing inside the document, not the pointer
        // leaving the window — only the latter forgets where the pointer is.
        pointer('mouseout', target, outside());

        decorator.showError(CHANGED);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR, CHANGED]);
    });

    it('28. a recorded target whose element is gone means the pointer is over nothing', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        Tooltip.attach(root, HINT);

        const rest   = centreOf(decorator);
        const target = field.getElement()!;

        move(target, rest.x, rest.y);

        // The production registry throws on a handle whose element has been
        // released, and the modelled one cannot reproduce that state — so what
        // this pins is that the attach asks the seam before it uses the target.
        const live = vi.spyOn(DOM.source, 'isRegistered').mockReturnValue(false);

        decorator.showError(ERROR);

        expect(live).toHaveBeenCalledWith(target);
        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });

    it('25. an error attached after the pointer left the window stays silent', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        Tooltip.attach(root, HINT);

        const rest   = centreOf(decorator);
        const target = field.getElement()!;

        expect(hitAt(rest.x, rest.y)).toBe(target);

        move(target, rest.x, rest.y);
        leaveWindow(target);

        decorator.showError(ERROR);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });
});
