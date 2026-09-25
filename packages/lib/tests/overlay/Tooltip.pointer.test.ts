// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// `Tooltip.attach` hosts under a real pointer. `Tooltip.test.ts` calls the
// stored listener closures directly, which never exercises `Event`'s
// exact-target routing; these cases dispatch real events through `Event`'s
// window-level handler (`DOM.sink.dispatchEvent`), as
// `FieldDecorator.pointerTooltip.test.ts` does for the covering attachment.
//
// A plain attachment listens on its host's own element only, so for one host
// nested inside another, moving onto the inner host is a leave of the outer
// one and an enter of the inner one — the opposite of the covering rule, which
// treats every element inside its host as the host.
//
// `root` is disposed after every test: `Event`'s `installedListenerTypes`
// bookkeeping outlives `DOM.reset()`, so a listener type left registered would
// make the next test's dispatches silently vanish.
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { Component } from '~/core/Component';
import { DOM, type Handle } from '~/core/DOM';
import { Tooltip } from '~/overlay/Tooltip';
import { installTestDOM, makeEvent, setConnected } from '../dom/TestDOM';
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
const HOVER_DELAY_MS = 500;
// Past the tooltip's 100 ms fade and its fallback timer, so a fade started by
// a test has finished before the next test's fixture is built.
const FADE_SETTLE_MS = 500;
// Any in-viewport pointer position: no case reads where the tooltip is placed.
const CURSOR_PX      = 10;
// The outer host's box, and the inner host's box inside it: any sizes that
// leave part of the outer host uncovered, so a pointer can rest on either.
const OUTER_SIZE     = { width: 200, height: 100 };
const INNER_BOX      = { x: 50, y: 25, width: 100, height: 50 };
// A point on the outer host's own, uncovered area, and one on the inner host.
const ON_OUTER       = { x: 10, y: 10 };
const ON_INNER       = { x: 100, y: 50 };

const OUTER = 'Outer';
const INNER = 'Inner';
// The texts a changed attach installs over each host's original one, so a
// re-attach is a real replacement rather than the kept-unchanged case.
const OUTER_CHANGED = 'Changed';
const INNER_CHANGED = 'Changed too';
// The text attached to a component that is never rendered.
const STRAY         = 'Nowhere';

let root: Component;
let showSpy: MockInstance<typeof Tooltip.show>;

/**
 * Dispatches a real mouse event of `type` on `target` through `Event`'s
 * window-level handler, with `related` as its `relatedTarget`.
 *
 * @param type - The mouse event type (`mouseover` or `mouseout`).
 * @param target - The element the event targets.
 * @param related - The event's `relatedTarget`: where the pointer came from, or is going to.
 */
function pointer(type: string, target: Handle, related: Handle): void {
    DOM.sink.dispatchEvent(
        DOM.source.getWindow(),
        makeEvent(target, type, { clientX: CURSOR_PX, clientY: CURSOR_PX, relatedTarget: related }),
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

/**
 * The pointer enters `target` from outside every host.
 *
 * @param target - The element the pointer comes to rest on.
 */
function enter(target: Handle): void {
    pointer('mouseover', target, DOM.source.getDocumentElement());
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
 * The element a pointer at `point` targets: the topmost element there.
 *
 * @param point - The viewport point.
 * @returns The topmost element at the point.
 */
function hitAt(point: { x: number; y: number }): Handle {
    return DOM.source.elementsFromPoint(point.x, point.y)[0];
}

/** The texts passed to `Tooltip.show`, in call order. */
function shownTexts(): string[] {
    return showSpy.mock.calls.map((call) => call[0] as string);
}

/**
 * An `attach`ed host with a second `attach`ed host inside it, both rendered
 * and laid out under `root`, and the elements a pointer resting on each hits —
 * asserted to be the hosts' own elements before any case dispatches to them.
 *
 * @returns Both hosts and the elements a pointer on each hits.
 */
function nestedHosts(): { outer: Component; inner: Component; outerEl: Handle; innerEl: Handle } {
    const outer = new Component({});
    const inner = new Component({});

    root.addComponent(outer);
    outer.addComponent(inner);

    outer.setWidth(OUTER_SIZE.width);
    outer.setHeight(OUTER_SIZE.height);
    inner.setX(INNER_BOX.x);
    inner.setY(INNER_BOX.y);
    inner.setWidth(INNER_BOX.width);
    inner.setHeight(INNER_BOX.height);
    outer.doLayout();
    inner.doLayout();

    Tooltip.attach(outer, OUTER);
    Tooltip.attach(inner, INNER);

    const outerEl = hitAt(ON_OUTER);
    const innerEl = hitAt(ON_INNER);

    expect(outerEl).toBe(outer.getElement());
    expect(innerEl).toBe(inner.getElement());

    return { outer, inner, outerEl, innerEl };
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

describe('Tooltip.attach — nested hosts under a real pointer', () => {
    it('1. moving onto an inner host dismisses the outer tooltip and shows the inner one', () => {
        const { outer, inner, outerEl, innerEl } = nestedHosts();

        enter(outerEl);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect((Tooltip as any).activeElement).toBe(outer.getElement());

        cross(outerEl, innerEl);

        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).pendingId).toBe(inner.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([OUTER, INNER]);
        expect((Tooltip as any).activeElement).toBe(inner.getElement());
    });

    it('2. moving back out onto the outer host shows the outer tooltip again', () => {
        const { outer, outerEl, innerEl } = nestedHosts();

        enter(outerEl);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        cross(outerEl, innerEl);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        cross(innerEl, outerEl);

        expect((Tooltip as any).pendingId).toBe(outer.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([OUTER, INNER, OUTER]);
        expect((Tooltip as any).activeElement).toBe(outer.getElement());
    });
});

describe('Tooltip.attach — arming under a pointer that is already resting', () => {
    it('3. a changed attach arms over the host\'s own element', () => {
        const { outer, outerEl } = nestedHosts();

        move(outerEl, ON_OUTER.x, ON_OUTER.y);

        Tooltip.attach(outer, OUTER_CHANGED);

        expect((Tooltip as any).pendingId).toBe(outer.getId());

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([OUTER_CHANGED]);
        expect((Tooltip as any).activeElement).toBe(outer.getElement());
    });

    it('4. a changed attach does not arm when a child covers the point', () => {
        const { outer, inner, innerEl } = nestedHosts();

        move(innerEl, ON_INNER.x, ON_INNER.y);

        Tooltip.attach(outer, OUTER_CHANGED);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);

        // The same position, and the host the pointer is actually over: a plain
        // attachment arms for the innermost host, never for an ancestor.
        Tooltip.attach(inner, INNER_CHANGED);

        expect((Tooltip as any).pendingId).toBe(inner.getId());
    });

    it('5. a never-rendered component never arms', () => {
        const { outerEl } = nestedHosts();
        const stray       = new Component({});

        move(outerEl, ON_OUTER.x, ON_OUTER.y);

        Tooltip.attach(stray, STRAY);

        expect((Tooltip as any).pendingId).toBe(null);
        // Nothing for the pointer to rest on, so no delay is armed and the
        // singleton is never built — a delay that ran out would materialise it.
        expect((Tooltip as any).instance).toBe(null);

        stray.dispose();
    });

    it('6. a changed attach decides without reading layout', () => {
        const { outer, inner, innerEl } = nestedHosts();

        move(innerEl, ON_INNER.x, ON_INNER.y);

        const hitTest = vi.spyOn(DOM.source, 'elementsFromPoint');
        const rect    = vi.spyOn(DOM.source, 'getElementRect');

        // A list writing every row's tooltip in one reconciliation pass is one
        // changed attach per row, and a split re-derives its collapse hint from
        // inside a layout pass: neither may force a layout to decide.
        Tooltip.attach(outer, OUTER_CHANGED);
        Tooltip.attach(inner, INNER_CHANGED);

        expect((Tooltip as any).pendingId).toBe(inner.getId());
        expect(hitTest).toHaveBeenCalledTimes(0);
        expect(rect).toHaveBeenCalledTimes(0);
    });

    it('7. a press keeps a changed attach on the host it pressed from arming', () => {
        const { outer, outerEl } = nestedHosts();

        move(outerEl, ON_OUTER.x, ON_OUTER.y);
        press(outerEl);

        // A `SplitGutter` re-derives its collapse hint from inside the layout
        // pass the click triggers, so the changed attach lands with the pointer
        // still recorded over the chevron it just pressed.
        Tooltip.attach(outer, OUTER_CHANGED);

        expect((Tooltip as any).pendingId).toBe(null);

        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect(shownTexts()).toEqual([]);
    });

    it('8. a tooltip whose anchor element is gone is dismissed on the next move', () => {
        const { outer, outerEl } = nestedHosts();

        // Seeded connected, so the anchor watch's own connectivity test passes
        // and the liveness of the remembered handle is what decides.
        setConnected(outerEl, true);

        enter(outerEl);
        vi.advanceTimersByTime(HOVER_DELAY_MS);

        expect((Tooltip as any).activeElement).toBe(outer.getElement());
        expect((Tooltip as any).dismissing).toBe(false);

        // The anchor's element has been released — a disposed component, or one
        // that re-rendered. The modelled source cannot reach that state, so the
        // seam is asked to report it.
        vi.spyOn(DOM.source, 'isRegistered').mockReturnValue(false);

        move(outerEl, ON_OUTER.x, ON_OUTER.y);

        expect((Tooltip as any).dismissing).toBe(true);
        expect((Tooltip as any).activeElement).toBe(null);
    });
});
