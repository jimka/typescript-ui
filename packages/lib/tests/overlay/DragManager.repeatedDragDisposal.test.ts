// Regression: the unbounded half of the drag-chrome leak — see
// DragManager.styleRuleDisposal.test.ts for the mechanism. `commitSession`
// builds fresh drag chrome per gesture and `endSession` only detached it, so
// the shared stylesheet grew by one rule for every drag the user performed and
// never shrank.
//
// This case lives in its own file deliberately. `Event`'s viewportListenerMap
// outlives `DOM.reset()`, so a second same-event-type registration inside one
// file does not re-attach: the gesture goes inert, no drag chrome is built, and
// a rule-count assertion then passes against nothing. `dragOnce` asserts
// commitment so that failure can never be silent, but the isolation is what
// lets this case run at all.
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

/** Drives one complete gesture, asserting it actually committed. */
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

describe('DragManager — repeated drag gestures', () => {
    it('B1-10: six gestures cost no more stylesheet rules than one', () => {
        installTestDOM(CONFIG);

        const source = new Component();

        source.getElement(true);
        source.setWidth(100);
        source.setHeight(100);

        DragManager.makeDragSource(source, { dragData: { row: 1 } });

        dropTarget();

        dragOnce(source);

        const afterFirst = _ruleCacheKeys().length;

        for (let i = 0; i < 5; i++) {
            dragOnce(source);
        }

        // The leak was exactly one rule per gesture, so this read 3 then 8
        // before the fix. Equality is the contract: drag chrome is per-gesture
        // and must cost nothing that outlives the gesture.
        expect(_ruleCacheKeys().length).toBe(afterFirst);
    });
});
