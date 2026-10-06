// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Util } from "~/core/Util.js";
import { Menu } from "~/overlay/Menu.js";

// `MouseEvent.button` of the secondary (right) button, per the UI Events
// specification. The synthetic event reads as the right-click it stands in
// for; the value is a spec constant, so it cannot be derived.
const SECONDARY_BUTTON = 2;

/**
 * What a `contextmenu` event is for, as {@link resolveContextMenuTarget}
 * resolved it.
 *
 * @internal Shared by `Tree`, `Body` and `AbstractSelectableList`; not barrel-exported.
 */
export interface ContextMenuTarget {
    /** The element the menu is for: the event's own target, or the current item's element. */
    target: Handle | null;
    /** The viewport x coordinate to open the menu at. */
    x: number;
    /** The viewport y coordinate to open the menu at. */
    y: number;
    /** The event to hand to listeners: the browser's own, or a synthetic one at `x` / `y`. */
    event: MouseEvent;
}

/**
 * Starts the watch that records whether the user's last input was a key
 * press, unless it is already running. A widget calls this as it is
 * constructed: the watch only knows about presses made after it started, and
 * a consumer may build its `Menu` later than the widget, or inside the very
 * listener the key press leads to.
 *
 * @internal Shared by `Tree`, `Body` and `AbstractSelectableList`; not barrel-exported.
 */
export function watchContextMenuInput(): void {
    Menu._startInputWatch();
}

/**
 * Resolves the element and the viewport point a `contextmenu` event is for.
 *
 * A widget that holds DOM focus on its own element and marks its current row
 * or cell with `aria-activedescendant` receives a key-raised `contextmenu`
 * (Shift+F10, the ContextMenu key) on that element, which is inside no item.
 * This function tells that case apart and answers with the current item:
 *
 * - The event targets something else, or the user's last input was a pointer
 *   press: the event's own target, coordinates and event, unchanged. A
 *   right-click on the widget's empty area is this case.
 * - The event targets `owner`'s own element and the last input was a key
 *   press: `revealCurrentItem` is called, and the result names that item's
 *   element, the point under its bottom-left corner clamped to `owner`'s box,
 *   and a synthetic `contextmenu` event at that point. With no current item
 *   the event is returned unchanged, as in the first case.
 *
 * The caller then runs its usual "element → item" lookup on the returned
 * `target`. "The last input was a key press" is the test `Menu.show()` uses
 * to decide whether the menu takes the keyboard, so a menu positioned at the
 * current item is always the menu that takes focus.
 *
 * @param owner - The widget whose `contextmenu` listener received the event.
 * @param event - The `contextmenu` event.
 * @param revealCurrentItem - Scrolls the widget's current item into view and
 *   returns the component to anchor the menu under, or `null` when the widget
 *   has no current item. Called only for a key-raised event: a right-click
 *   must never scroll the widget.
 * @returns The element, the point and the event to use.
 *
 * @internal Shared by `Tree`, `Body` and `AbstractSelectableList`; not barrel-exported.
 */
export function resolveContextMenuTarget(
    owner: Component,
    event: MouseEvent,
    revealCurrentItem: () => Component | null,
): ContextMenuTarget {
    const target  = event.target === null ? null : DOM.source.intern(event.target);
    const own     = { target, x: event.clientX, y: event.clientY, event };
    const ownerEl = owner.getElement();

    // A key-raised contextmenu goes to the focused element, which for these
    // widgets is their own element. `&&` keeps the Menu read off every
    // event that targets an item.
    const fromKeyboard = ownerEl !== undefined && target === ownerEl && Menu.lastInputWasKeyPress();

    if (!fromKeyboard) {
        return own;
    }

    const item   = revealCurrentItem();
    const itemEl = item?.getElement() ?? null;

    if (item === null || itemEl === null) {
        return own;
    }

    const point = pointUnder(item, owner);

    return {
        target: itemEl,
        x:      point.x,
        y:      point.y,
        event:  DOM.sink.createMouseEvent("contextmenu", { clientX: point.x, clientY: point.y, button: SECONDARY_BUTTON }),
    };
}

/**
 * The viewport point a keyboard-opened menu is anchored at: `item`'s
 * bottom-left corner, so the item stays visible while the menu is open. Each
 * coordinate is clamped to `owner`'s box, for an item that is wider than the
 * widget or scrolled partly out of it.
 *
 * @param item - The component the menu opens under.
 * @param owner - The widget whose box bounds the point.
 * @returns The point, in viewport coordinates.
 */
function pointUnder(item: Component, owner: Component): { x: number, y: number } {
    const itemRect  = DOM.source.getViewportRect(item);
    const ownerRect = DOM.source.getViewportRect(owner);

    return {
        x: Util.clamp(itemRect.left,   ownerRect.left, ownerRect.right),
        y: Util.clamp(itemRect.bottom, ownerRect.top,  ownerRect.bottom),
    };
}
