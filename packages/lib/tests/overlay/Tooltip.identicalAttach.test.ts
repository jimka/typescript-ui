// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// An `attach` that would rebuild a component's current attachment unchanged —
// the same text, the same colors and the same mode — keeps it instead. This
// file pins what that means: the listeners are not re-registered, the record
// is the same object, a hover delay the component armed keeps running, and a
// tooltip on screen for it stays up.
//
// Cases 13–18 dispatch REAL events through `Event`'s window-level handler, as
// `FieldDecorator.pointerTooltip.test.ts` does, because the decorator's
// covering tooltip relies on `Event`'s subtree walk.
//
// Every component a case creates is disposed in `afterEach` — `root`'s
// children with `root`, and anything unparented through `strays`. `Event`'s
// installed-listener bookkeeping is module state that outlives `DOM.reset()`,
// so one component left registered makes every later real-event case's
// dispatch silently vanish.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { Event } from '~/core/Event';
import { Tooltip } from '~/overlay/Tooltip';
import { TextField } from '~/component/input/TextField';
import { Button } from '~/component/button/Button';
import { FieldDecorator } from '~/validation/FieldDecorator';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

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
// Any width that gives a decorated field a real hit area; the size
// `FieldDecorator.pointerTooltip.test.ts` mounts its decorators at.
const HOST_WIDTH       = 200;
// Room for a single-line field, from the same precedent. Also the vertical
// step between two hosts, so their boxes never overlap.
const HOST_HEIGHT      = 24;
// Any in-viewport pointer position. No case here reads where the tooltip is
// placed, only which element it is anchored to.
const CURSOR_PX        = 10;
// The listeners one attachment registers: `mouseover`, `mousemove`, `mouseout`
// and `mousedown`, on the component's own element or across its subtree.
const HOVER_LISTENERS  = 4;
// Enough repeats of one identical call that a per-call listener rebuild would
// be unmissable in the seam counts; case 16's reading is zero either way.
const IDENTICAL_CALLS  = 10;

const ERROR = 'Too long';

let root: Component;
let strays: Component[] = [];
let showSpy: MockInstance<typeof Tooltip.show>;

/**
 * A rendered, laid-out component under `root`, big enough to have a real box.
 *
 * @param y - The component's top edge, to keep two hosts apart.
 * @returns The host, already rendered.
 */
function host(y: number): Component {
    const component = new Component({});

    root.addComponent(component);
    component.setY(y);
    component.setWidth(HOST_WIDTH);
    component.setHeight(HOST_HEIGHT);
    component.getElement(true);

    return component;
}

/**
 * Adds `field` to `root`, wraps it in a `FieldDecorator` and lays both out at
 * the fixed host size, so every part of the field has a real box.
 *
 * @param field - The field to decorate.
 * @param y - The decorator's top edge, to keep two decorated fields apart.
 * @returns The decorator now wrapping `field`.
 */
function mountDecorated(field: Component, y = 0): FieldDecorator {
    root.addComponent(field);

    const decorator = new FieldDecorator(field, root);

    decorator.setY(y);
    decorator.setWidth(HOST_WIDTH);
    decorator.setHeight(HOST_HEIGHT);
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
 * The pointer enters `target` from outside every decorated field: a real
 * `mouseover` through `Event`'s window-level handler.
 *
 * @param target - The element the pointer comes to rest on.
 */
function enter(target: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, 'mouseover', {
            clientX: CURSOR_PX, clientY: CURSOR_PX, relatedTarget: DOM.source.getDocumentElement(),
        }),
    );
}

/** The texts passed to `Tooltip.show`, in call order. */
function shownTexts(): string[] {
    return showSpy.mock.calls.map((call) => call[0] as string);
}

/**
 * Invokes the `mouseover` handler `Tooltip.attach` stored for `component`,
 * arming the shared hover-delay timer on that component's behalf.
 *
 * @param component - The attached component whose hover is being simulated.
 */
function hoverOver(component: Component): void {
    (Tooltip as any).attachments.get(component.getId()).mouseoverFn({ clientX: CURSOR_PX, clientY: CURSOR_PX });
}

/**
 * Hovers `component` and runs the hover delay out, leaving the tooltip on
 * screen with `component`'s element recorded as its anchor.
 *
 * @param component - The attached component to show the tooltip for.
 */
function showFor(component: Component): void {
    hoverOver(component);
    vi.advanceTimersByTime(HOVER_DELAY_MS);
}

/**
 * The attachment record `Tooltip` currently holds for `component`.
 *
 * @param component - The attached component.
 * @returns The record, or `undefined` when nothing is attached.
 */
function record(component: Component): unknown {
    return (Tooltip as any).attachments.get(component.getId());
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

    for (const stray of strays) {
        stray.dispose();
    }

    strays = [];

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

describe('Tooltip — an identical attach keeps the attachment', () => {
    it('1. re-attaching A leaves A\'s own tooltip on screen', () => {
        const a = host(0);
        const b = host(2 * HOST_HEIGHT);

        Tooltip.attach(a, 'A');
        Tooltip.attach(b, 'B');
        showFor(a);

        Tooltip.attach(a, 'A');

        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(a.getElement());
        expect((Tooltip as any).watching).toBe(true);
    });

    it('2. re-attaching A leaves the hover delay A armed running', () => {
        const a = host(0);
        const b = host(2 * HOST_HEIGHT);

        Tooltip.attach(a, 'A');
        Tooltip.attach(b, 'B');
        hoverOver(a);

        Tooltip.attach(a, 'A');

        expect((Tooltip as any).showTimer).not.toBe(null);
        expect((Tooltip as any).pendingId).toBe(a.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual(['A']);
        expect((Tooltip as any).activeElement).toBe(a.getElement());
    });

    it('3. re-attaching B leaves A\'s tooltip on screen', () => {
        const a = host(0);
        const b = host(2 * HOST_HEIGHT);

        Tooltip.attach(a, 'A');
        Tooltip.attach(b, 'B');
        showFor(a);

        Tooltip.attach(b, 'B');

        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(a.getElement());
    });

    it('4. re-attaching B leaves the hover delay A armed running', () => {
        const a = host(0);
        const b = host(2 * HOST_HEIGHT);

        Tooltip.attach(a, 'A');
        Tooltip.attach(b, 'B');
        hoverOver(a);

        Tooltip.attach(b, 'B');

        expect((Tooltip as any).pendingId).toBe(a.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual(['A']);
    });

    it('5. equal colors passed as a fresh object keep the attachment', () => {
        const a = host(0);

        Tooltip.attach(a, 'A', { background: 'red', border: 'black' });

        const before = record(a);

        showFor(a);

        // A different object with the same values, and the keys in the other
        // order: neither identity nor key order counts.
        Tooltip.attach(a, 'A', { border: 'black', background: 'red' });

        expect(record(a)).toBe(before);
        expect((Tooltip as any).dismissing).toBe(false);
    });

    it('6. a changed color replaces the attachment and dismisses A\'s tooltip', () => {
        const a = host(0);

        Tooltip.attach(a, 'A', { background: 'red' });

        const before = record(a);

        showFor(a);

        Tooltip.attach(a, 'A', { background: 'blue' });

        expect(record(a)).not.toBe(before);
        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).activeElement).toBe(null);
    });

    it('7. an empty colors object matches no colors at all', () => {
        const a = host(0);

        Tooltip.attach(a, 'A');

        const before = record(a);

        Tooltip.attach(a, 'A', {});

        expect(record(a)).toBe(before);
    });

    it('8. the same text in the covering mode replaces the attachment', () => {
        const a = host(0);

        Tooltip.attach(a, 'A');

        const before = record(a);

        Tooltip.attachCovering(a, 'A');

        expect(record(a)).not.toBe(before);
        expect((record(a) as { covering: boolean }).covering).toBe(true);
    });

    it('9. an identical attach registers and removes no listeners, in either mode', () => {
        const a = host(0);
        const b = host(2 * HOST_HEIGHT);

        Tooltip.attach(a, 'A');
        Tooltip.attachCovering(b, 'B');

        const add           = vi.spyOn(Event, 'addListener');
        const remove        = vi.spyOn(Event, 'removeListener');
        const addSubtree    = vi.spyOn(Event, 'addSubtreeListener');
        const removeSubtree = vi.spyOn(Event, 'removeSubtreeListener');

        Tooltip.attach(a, 'A');
        Tooltip.attachCovering(b, 'B');

        expect(add).toHaveBeenCalledTimes(0);
        expect(remove).toHaveBeenCalledTimes(0);
        expect(addSubtree).toHaveBeenCalledTimes(0);
        expect(removeSubtree).toHaveBeenCalledTimes(0);
    });

    it('10. the same text after a detach attaches afresh', () => {
        const a = host(0);

        Tooltip.attach(a, 'A');

        const before = record(a);

        Tooltip.detach(a);

        const add = vi.spyOn(Event, 'addListener');

        Tooltip.attach(a, 'A');

        expect(record(a)).not.toBe(before);
        expect(add).toHaveBeenCalledTimes(HOVER_LISTENERS);
    });

    it('11. an identical attach on a never-rendered component builds no tooltip', () => {
        const c = new Component({});

        strays.push(c);

        Tooltip.attach(c, 'U');

        const before = record(c);

        Tooltip.attach(c, 'U');

        expect(record(c)).toBe(before);
        expect((Tooltip as any).instance).toBe(null);
    });

    it('12. repeated identical attaches register one teardown hook, which still detaches', () => {
        const a = host(0);

        Tooltip.attach(a, 'A');
        Tooltip.attach(a, 'A');
        Tooltip.attach(a, 'A');

        // Baseline is 2, not 1: every Component registers one onDestroy
        // cleanup of its own for `_dirtyListeners` (via `registerListenerBag`,
        // see core/Component.ts), on top of the one Tooltip.attach adds.
        expect((a as any)._destroyCleanups.length).toBe(2);

        a.dispose();

        expect((Tooltip as any).attachments.has(a.getId())).toBe(false);
    });
});

describe('FieldDecorator — an unchanged error under a pointer', () => {
    it('13. the same error leaves the decorator\'s tooltip on screen', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        decorator.showError(ERROR);

        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(decorator.getElement());
        expect(shownTexts()).toEqual([ERROR]);
    });

    it('14. the same error leaves the decorator\'s hover delay running', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS / 2);

        decorator.showError(ERROR);

        expect((Tooltip as any).pendingId).toBe(decorator.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS / 2);

        expect(shownTexts()).toEqual([ERROR]);
    });

    it('15. a changed error dismisses the decorator\'s tooltip', () => {
        const field     = new TextField();
        const decorator = mountDecorated(field);

        decorator.showError(ERROR);

        const target = hitCentre(decorator);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        decorator.showError('Too short');

        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).activeElement).toBe(null);
    });

    it('16. repeating one error touches no window listener', () => {
        const decorator = mountDecorated(new TextField());

        decorator.showError(ERROR);

        const add    = vi.spyOn(DOM.sink, 'addListener');
        const remove = vi.spyOn(DOM.sink, 'removeListener');

        for (let i = 0; i < IDENTICAL_CALLS; i++) {
            decorator.showError(ERROR);
        }

        expect(add).toHaveBeenCalledTimes(0);
        expect(remove).toHaveBeenCalledTimes(0);
    });

    it('17. a second decorator\'s unchanged error leaves the first\'s tooltip on screen', () => {
        const field  = new TextField();
        const first  = mountDecorated(field);
        const second = mountDecorated(new TextField(), 2 * HOST_HEIGHT);

        first.showError(ERROR);
        second.showError('Other');

        const target = hitCentre(first);

        expect(target).toBe(field.getElement());

        enter(target);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        second.showError('Other');

        expect((Tooltip as any).dismissing).toBe(false);
        expect((Tooltip as any).activeElement).toBe(first.getElement());
    });

    it('18. a second decorator\'s unchanged error leaves the first\'s hover delay running', () => {
        const field  = new TextField();
        const first  = mountDecorated(field);
        const second = mountDecorated(new TextField(), 2 * HOST_HEIGHT);

        first.showError(ERROR);
        second.showError('Other');

        const target = hitCentre(first);

        expect(target).toBe(field.getElement());

        enter(target);

        second.showError('Other');

        expect((Tooltip as any).pendingId).toBe(first.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([ERROR]);
    });
});

describe('Button — an unchanged description', () => {
    it('19. setting the description it already has keeps the attachment', () => {
        const button = new Button({ text: 'Save' });

        root.addComponent(button);
        button.getElement(true);

        button.setDescription('Writes the file');

        const before = record(button);

        button.setDescription('Writes the file');

        expect(record(button)).toBe(before);
    });
});
