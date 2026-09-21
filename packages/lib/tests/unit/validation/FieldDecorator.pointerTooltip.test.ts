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
// Any in-viewport pointer position: no test reads where the tooltip is placed.
const CURSOR_PX        = 10;

const ERROR = 'Too long';
const HINT  = 'What goes here';

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
 * The element a pointer resting at the centre of `component`'s box targets.
 *
 * @param component - The rendered component whose centre is hit.
 * @returns The topmost element at that point.
 */
function hitCentre(component: Component): Handle {
    const rect = DOM.source.getElementRect(component.getElement()!);

    return hitAt(rect.x + rect.width / 2, rect.y + rect.height / 2);
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
});
