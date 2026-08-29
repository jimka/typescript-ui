// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Event } from "~/core/Event.js";
import { beginViewportDrag, endViewportDrag } from "~/core/PointerDrag.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link WindowBorder}.
 *
 * @category Components
 */
export type WindowBorderEvent = "drag";

/**
 * The eight edge / corner positions used by {@link WindowBorder} to identify
 * which border strip the user is dragging.
 *
 * @category Components
 */
export enum Direction {
    NORTH,
    SOUTH,
    WEST,
    EAST,
    NORTHWEST,
    SOUTHEAST,
    SOUTHWEST,
    NORTHEAST
}

/**
 * Construction-time options for {@link WindowBorder}.
 *
 * @category Components
 */
export interface WindowBorderOptions extends ComponentOptions {
    /**
     * Multi-event listener bag dispatched to {@link WindowBorder.on} at
     * construction time.
     */
    listeners?: {
        drag?: (border: WindowBorder, e: MouseEvent) => void;
    };
}

/**
 * CSS class added to the DOM element of the currently snap-targeted strip.
 * Kept package-private (`@internal`) — the owning [`Window`](/api/overlay/classes/Window)
 * toggles it through {@link WindowBorder.setSnapTarget}.
 *
 * @internal
 */
const SNAP_TARGET_CLASS = "snap-target";

/**
 * Class-level defaults forwarded to `super` so the cascade hits Component's
 * applyOptions with `{ tag: "div" }` already merged into `_defaultOptions`.
 */
const _defaultWindowBorderOptions: Partial<WindowBorderOptions> = {
    tag: "div",
};

/** `.snap-target`'s box-shadow declaration, read by `ownStyleStates`' entry below. */
const WINDOW_BORDER_SNAP_TARGET_DECLARATIONS: Readonly<Record<string, string>> = Object.freeze({
    boxShadow: "var(--ts-ui-window-snap-glow, 0 0 0 2px rgba(30, 100, 200, 0.7))",
});

/**
 * A resizable window border strip component.
 *
 * Each instance represents one edge or corner of a resizable window. It listens for
 * mouse/touch drag events and notifies registered listeners with the mouse event so
 * the parent window can compute and apply the new size.
 *
 * @category Components
 */
class WindowBorder extends Component<WindowBorderOptions> {

    // Declares `.snap-target` so `styleLayers()`/`restingGuardSuffix` know
    // about it — see `Button`'s `ownStyleStates` for the full mechanism.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: "." + SNAP_TARGET_CLASS,
            extract:  (): StyleBag => ({ shadow: WINDOW_BORDER_SNAP_TARGET_DECLARATIONS.boxShadow }),
        },
    ];

    private _direction: Direction = Direction.NORTH;
    private _listeners: ListenerBag<WindowBorderEvent> = this.registerListenerBag(new ListenerBag<WindowBorderEvent>());
    private _dragStartListener: Event.Listener;
    private _dragStopListener: Event.Listener;
    private _fireDragListener: Event.Listener;
    private _snapTarget: boolean = false;

    /**
     * @param direction - Which window edge (or corner) this border drives.
     * @param options - Optional construction options.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(
        direction:         Direction,
        options?:          WindowBorderOptions,
        subclassDefaults?: Partial<WindowBorderOptions>,
    ) {
        super(options, { ..._defaultWindowBorderOptions, ...(subclassDefaults ?? {}) });

        if (direction) {
            this._direction = direction;
        }

        // Set here, not in `render()`: a construction-time `writeStyle` (which
        // `setCursor` funnels through) only caches into the instance style
        // layer and defers its CSS write to the render pass's own
        // `applyStyle` sweep. Calling it *after* `super.render()` instead —
        // as this used to — writes through `getElement()`, which is not yet
        // resolvable at that point (the element has no live-DOM id match and
        // isn't cached as `_element` until `render()` returns to its caller),
        // so the write silently deferred and, with no second `applyStyle()`
        // pass ever running for a border strip, was dropped for good.
        const cursor = this.dragCursor();
        if (cursor) {
            this.setCursor(cursor);
        }

        this._dragStartListener = this.onDragStart.bind(this);
        this._dragStopListener = this.onDragStop.bind(this);
        this._fireDragListener = this._dispatchDrag.bind(this);

        Event.addListener(this, 'mousedown', this._dragStartListener);

        this.applyListeners(options?.listeners);
    }

    /**
     * Returns the resize direction of this border strip.
     *
     * @returns The Direction enum value for this border.
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Sets the resize direction, defaulting to NORTH if not provided.
     *
     * @param direction - The Direction enum value. Defaults to NORTH if falsy.
     */
    setDirection(direction: Direction) : this {
        if (!direction) {
            direction = Direction.NORTH;
        }

        this._direction = direction;

        return this;
    }

    /**
     * Registers a listener for one of this border's events.
     *
     * @param event - `"drag"` fires on each mousemove/touchmove during a
     *   drag, receiving this border and the originating event.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This border, for method chaining.
     */
    on(event: "drag",             listener: (border: WindowBorder, e: MouseEvent) => void): this;
    on(event: WindowBorderEvent,  listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This border, for method chaining.
     */
    off(event: WindowBorderEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "drag",            border: WindowBorder, e: MouseEvent): void;
    protected emit(event: WindowBorderEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Internal mousemove dispatch — fires the `drag` event with this border
     * and the originating mouse event.
     *
     * @param e - The MouseEvent observed by the viewport-mousemove listener.
     * @returns `true`, consuming the move so nothing else tracks the pointer mid-resize.
     */
    private _dispatchDrag(e: MouseEvent): Event.ListenerResult {
        this.emit("drag", this, e);

        return true;
    }

    /**
     * Returns whether this border strip is currently flagged as the snap target.
     *
     * @returns True when the snap-target CSS class is applied.
     */
    isSnapTarget(): boolean {
        return this._snapTarget;
    }

    /**
     * Toggles the snap-target CSS class on this strip's DOM element. Called by
     * the owning [`Window`](/api/overlay/classes/Window) while the snap modifier
     * is held and the cursor is within the configured threshold.
     *
     * @param value - True to highlight this strip as the snap target.
     *
     * @returns This component, for method chaining.
     */
    setSnapTarget(value: boolean): this {
        if (this._snapTarget === value) {
            return this;
        }

        this._snapTarget = value;

        // Unconditional, not gated on `this.getElement()`: `setStyleState`
        // updates `_activeStates` regardless of whether an element exists
        // yet (only its own DOM write is internally element-gated) — see
        // `ToggleButton.setSelected`'s own comment for the full reasoning.
        this.setStyleState("." + SNAP_TARGET_CLASS, value);

        return this;
    }

    /**
     * Attaches viewport mouse/touch move and stop listeners and disables body pointer events.
     *
     * @param e - The originating mousedown event. Optional so a caller can
     * trigger a drag with no real event; when supplied — both the strip's
     * own `mousedown` wiring and `AbstractWindow`'s snap-resize forwarding
     * (`onSnapMouseDown`, reached through an unfiltered viewport listener)
     * always do — a non-primary button is rejected.
     */
    onDragStart(e?: MouseEvent) {
        if (e && !Event.isPrimaryButton(e)) {
            return;
        }

        // A direction with no resize cursor of its own still suppresses body
        // pointer events; it just has nothing to hold, so it keeps the default.
        beginViewportDrag(this, this._fireDragListener, this._dragStopListener, this.dragCursor() ?? "default");
    }

    /**
     * Removes viewport listeners and restores body pointer events when drag ends.
     *
     * @returns `true`, consuming the release that ends the border resize.
     */
    onDragStop(): Event.ListenerResult {
        endViewportDrag(this, this._fireDragListener, this._dragStopListener);

        // Drop the snap-target highlight (if any) once the drag commits, so a
        // subsequent Ctrl-release on the same hover doesn't leave the strip glowing.
        this.setSnapTarget(false);

        return true;
    }

    /**
     * The resize cursor for the edge or corner this strip sits on, shared by the
     * hover state and the drag itself so the two can never disagree.
     *
     * @returns The CSS cursor naming the resize axis, or `undefined` for a
     *   direction that does not resize.
     */
    private dragCursor(): string | undefined {
        switch (this._direction) {
            case Direction.NORTH:
            case Direction.SOUTH:
                return "ns-resize";
            case Direction.WEST:
            case Direction.EAST:
                return "ew-resize";
            case Direction.NORTHWEST:
            case Direction.SOUTHEAST:
                return "nwse-resize";
            case Direction.SOUTHWEST:
            case Direction.NORTHEAST:
                return "nesw-resize";
        }

        return undefined;
    }

    /**
     * Renders the border element. The resize cursor is set at construction
     * time (see the constructor) rather than here.
     *
     * @returns The created element.
     */
    render() {
        let element = super.render();

        if (this._snapTarget) {
            DOM.sink.apply(element, { addClass: [SNAP_TARGET_CLASS] });
        }

        return element;
    }

}

const WindowBorderCallable = callable(WindowBorder);
type WindowBorderCallable = WindowBorder;
export {
    WindowBorder         as _WindowBorder,
    WindowBorderCallable as WindowBorder
};
