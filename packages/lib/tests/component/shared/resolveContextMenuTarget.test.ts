// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The shared rule that decides what a `contextmenu` event is for: the element
// under the pointer for a mouse, the widget's current item for Shift+F10 or
// the ContextMenu key. Cases R1–R7 follow the `## Expected Behaviour` table of
// plans/implemented/table-tree-keyboard-context-menu.md.
//
// "Last input" is `Menu`'s input watch, so every case dispatches real events
// through `Event`'s window-level handlers. The teardown disposes the
// components and the menu (see the header of
// `tests/overlay/Menu.keyboardSession.test.ts`).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveContextMenuTarget, watchContextMenuInput } from '~/component/shared/resolveContextMenuTarget';
import { Menu } from '~/overlay/Menu';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { installTestDOM, makeEvent, setConnected, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The geometry of the plan's R table: a 200 × 100 owner at the viewport
// origin, and an item at (30, 40) sized 50 × 24, whose bottom edge is at 64.
const OWNER_WIDTH  = 200;
const OWNER_HEIGHT = 100;
const ITEM_X       = 30;
const ITEM_Y       = 40;
const ITEM_WIDTH   = 50;
const ITEM_HEIGHT  = 24;
const ITEM_BOTTOM  = ITEM_Y + ITEM_HEIGHT;

// Where the dispatched event says the pointer is: any point that is not the
// item's menu point, so a result that kept it is told apart from one that
// moved to the item.
const EVENT_X = 111;
const EVENT_Y = 77;

// `MouseEvent.button` of the secondary (right) button, per the UI Events
// specification: what the synthetic event carries.
const SECONDARY_BUTTON = 2;

let owner: Component;
let item: Component;
let inner: Component;
let ownerEl: Handle;
let innerEl: Handle;
let menu: Menu | null;

/** A `contextmenu` event targeting `target`, at the fixed pointer position. */
function contextMenuAt(target: Handle): MouseEvent {
    return makeEvent(target, 'contextmenu', { clientX: EVENT_X, clientY: EVENT_Y }) as MouseEvent;
}

/** The user presses Shift+F10 while the owner has focus. */
function keyInput(): void {
    DOM.sink.dispatchEvent(ownerEl, makeEvent(ownerEl, 'keydown', { key: 'F10', shiftKey: true }));
}

/** The user presses a pointer button on the owner. */
function pointerInput(): void {
    DOM.sink.dispatchEvent(ownerEl, makeEvent(ownerEl, 'pointerdown', { button: SECONDARY_BUTTON }));
}

/** How many synthetic mouse events the seam built. */
function createdMouseEvents(): number {
    return (DOM.sink as RecordingDOMSink).writes.filter(write => write.op === 'createMouseEvent').length;
}

beforeEach(() => {
    installTestDOM(CONFIG);

    owner = new Component();
    item  = new Component();
    inner = new Component();

    owner.addComponent(item);
    owner.addComponent(inner);

    ownerEl = owner.getElement(true)!;
    innerEl = inner.getElement(true)!;
    item.getElement(true);
    setConnected(ownerEl, true);

    owner.setWidth(OWNER_WIDTH);
    owner.setHeight(OWNER_HEIGHT);
    item.setX(ITEM_X);
    item.setY(ITEM_Y);
    item.setWidth(ITEM_WIDTH);
    item.setHeight(ITEM_HEIGHT);

    DOM.sink.focus(ownerEl);

    menu = null;
});

afterEach(() => {
    vi.restoreAllMocks();

    menu?.dispose();
    owner.dispose();

    DOM.reset();
});

describe('resolveContextMenuTarget', () => {
    // R1–R6 run with a Menu built, the usual state of an application; R7
    // covers a widget that exists before any Menu does.
    beforeEach(() => {
        menu = new Menu();
    });

    it('R1: a pointer press on an inner element keeps the event as it is', () => {
        const reveal = vi.fn(() => item);
        const event  = contextMenuAt(innerEl);

        pointerInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(at).toEqual({ target: innerEl, x: EVENT_X, y: EVENT_Y, event });
        expect(at.event).toBe(event);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('R2: a key press with an inner element as target keeps the event as it is', () => {
        const reveal = vi.fn(() => item);
        const event  = contextMenuAt(innerEl);

        keyInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(at.target).toBe(innerEl);
        expect(at.x).toBe(EVENT_X);
        expect(at.y).toBe(EVENT_Y);
        expect(at.event).toBe(event);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('R3: a key press on the owner resolves to the current item and a point under it', () => {
        const reveal = vi.fn(() => item);
        const event  = contextMenuAt(ownerEl);

        keyInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(reveal).toHaveBeenCalledTimes(1);
        expect(at.target).toBe(item.getElement());
        expect(at.x).toBe(ITEM_X);
        expect(at.y).toBe(ITEM_BOTTOM);

        // A synthetic event, not the dispatched one, positioned at the point.
        expect(at.event).not.toBe(event);
        expect(createdMouseEvents()).toBe(1);
        expect(at.event.type).toBe('contextmenu');
        expect(at.event.clientX).toBe(ITEM_X);
        expect(at.event.clientY).toBe(ITEM_BOTTOM);
        expect(at.event.button).toBe(SECONDARY_BUTTON);
        expect(at.event.target).toBeNull();
        expect(at.event.shiftKey).toBe(false);
    });

    it('R4: the point is clamped to the owner when the item lies outside it', () => {
        const reveal = vi.fn(() => item);

        // Left of the owner's box and below it.
        item.setX(-80);
        item.setY(200);
        keyInput();

        const at = resolveContextMenuTarget(owner, contextMenuAt(ownerEl), reveal);

        expect(at.x).toBe(0);
        expect(at.y).toBe(OWNER_HEIGHT);
        expect(at.event.clientX).toBe(0);
        expect(at.event.clientY).toBe(OWNER_HEIGHT);
    });

    it('R5: a key press on the owner with no current item keeps the event as it is', () => {
        const reveal = vi.fn(() => null);
        const event  = contextMenuAt(ownerEl);

        keyInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(reveal).toHaveBeenCalledTimes(1);
        expect(at).toEqual({ target: ownerEl, x: EVENT_X, y: EVENT_Y, event });
        expect(at.event).toBe(event);
        expect(createdMouseEvents()).toBe(0);
    });

    it('R6: a pointer press on the owner itself keeps the event and reveals nothing', () => {
        const reveal = vi.fn(() => item);
        const event  = contextMenuAt(ownerEl);

        keyInput();
        pointerInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(at).toEqual({ target: ownerEl, x: EVENT_X, y: EVENT_Y, event });
        expect(at.event).toBe(event);
        expect(reveal).not.toHaveBeenCalled();
    });
});

describe('watchContextMenuInput', () => {
    it('R7: records a key press with no Menu built', () => {
        const reveal = vi.fn(() => item);

        watchContextMenuInput();
        keyInput();

        const at = resolveContextMenuTarget(owner, contextMenuAt(ownerEl), reveal);

        expect(at.target).toBe(item.getElement());
        expect(at.x).toBe(ITEM_X);
        expect(at.y).toBe(ITEM_BOTTOM);
        expect(at.event.clientX).toBe(ITEM_X);
        expect(at.event.clientY).toBe(ITEM_BOTTOM);
        expect(at.event.button).toBe(SECONDARY_BUTTON);
    });

    it('R7b: without the watch a key press is not on record, so the event is kept', () => {
        const reveal = vi.fn(() => item);
        const event  = contextMenuAt(ownerEl);

        keyInput();

        const at = resolveContextMenuTarget(owner, event, reveal);

        expect(at.event).toBe(event);
        expect(reveal).not.toHaveBeenCalled();
    });
});
