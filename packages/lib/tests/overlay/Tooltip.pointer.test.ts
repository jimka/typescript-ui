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
