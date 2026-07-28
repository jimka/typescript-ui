// Regression: `commitSession` builds a `DragGhost`, a `DragFeedback` and a
// `ReorderIndicator` fresh for every committed gesture and holds them only on
// the session record — none is registered via `addComponent`, so no
// `destructor()` recursion reaches them. `endSession` then tore them down with
// `detach()` / `hide()`, both of which are just `removeElement()`: the element
// leaves the DOM but the component's per-instance stylesheet rule stays on the
// shared sheet, and the session reference is dropped immediately after. Every
// drag gesture in the framework — tab, split and dock drags all route through
// `DragManager` — therefore leaked, unbounded: one rule for the ghost on any
// gesture, plus the feedback tint's and the reorder indicator's whenever the
// drag passed over a drop target that attached them.
//
// See plans/implemented/scrollbar-leak-and-layout-guards.md (Bug 1); this is
// the same shape as the Panel and Rail cases, found by the audit after the
// plan's own sweep missed it.
import { describe, it, expect, afterEach } from 'vitest';
import { DragManager } from '~/overlay/DragManager';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheKeys } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => DOM.reset());

/** A registered drag source, rendered and sized so it can be dragged. */
function dragSource(): Component {
    const source = new Component();

    source.getElement(true);
    source.setWidth(100);
    source.setHeight(100);

    DragManager.makeDragSource(source, { dragData: { row: 1 } });

    return source;
}

/**
 * Drives one complete gesture: press, move past the 4 px commit threshold
 * (which is what builds the ghost, feedback and indicator), then release.
 *
 * Asserts the gesture actually committed. `Event`'s viewport listener map
 * outlives `DOM.reset()`, so a second registration of the same event type in
 * one file can silently fail to re-attach — which would leave the gesture
 * inert, build no drag chrome, and let a leak assertion pass against nothing.
 * Checking commitment here makes that failure loud instead of vacuous.
 */
function dragOnce(source: Component): void {
    const element = source.getElement()!;

    const press = makeEvent(element, 'mousedown') as unknown as Record<string, unknown>;

    press.clientX = 10;
    press.clientY = 10;
    press.button  = 0;

    DOM.sink.dispatchEvent(element, press as never);

    const move = makeEvent(element, 'mousemove') as unknown as Record<string, unknown>;

    move.clientX = 100;
    move.clientY = 100;

    DOM.sink.dispatchEvent(element, move as never);

    expect(DragManager.isDragging()).toBe(true);

    const release = makeEvent(element, 'mouseup') as unknown as Record<string, unknown>;

    release.clientX = 100;
    release.clientY = 100;

    DOM.sink.dispatchEvent(element, release as never);

    expect(DragManager.isDragging()).toBe(false);
}

/**
 * A registered drop target covering the point the gesture moves to.
 *
 * Both halves of the drag chrome only materialise their rules when
 * `enterNewTarget` attaches them, which needs a target under the pointer: the
 * validity tint attaches unless the target suppresses it, and the reorder
 * indicator attaches only when `onDragOver` returns a numeric insertion hint.
 * This target does neither, so one gesture over it exercises the ghost, the
 * feedback and the indicator together.
 */
function dropTarget(): Component {
    const target = new Component();

    target.getElement(true);
    target.setX(50);
    target.setY(50);
    target.setWidth(400);
    target.setHeight(400);
    target.doLayout();

    DragManager.makeDropTarget(target, {
        accepts:     (): boolean => true,
        onDragOver:  (): number => 5,
    });

    return target;
}

describe('DragManager — drag chrome style-rule disposal', () => {
    it('B1-9: a completed drag gesture leaves no per-instance rule behind', () => {
        installTestDOM(CONFIG);

        const source = dragSource();

        dropTarget();

        // Warm-up gesture: keeps any process-global rule these classes
        // materialise on first use out of the diff below.
        dragOnce(source);

        const before = new Set(_ruleCacheKeys());

        dragOnce(source);

        expect(DragManager.isDragging()).toBe(false);

        const leaked = _ruleCacheKeys().filter((key) => !before.has(key));

        expect(leaked).toEqual([]);
    });

});
