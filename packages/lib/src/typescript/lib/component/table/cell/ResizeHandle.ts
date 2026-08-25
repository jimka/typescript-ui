// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import type { Handle } from "~/core/DOM.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";

/**
 * String-literal union of the events emitted by {@link ResizeHandle}.
 *
 * @category Components
 */
type ResizeHandleEvent = "dragstart" | "dragmove" | "dragend";

/**
 * Construction-time options for {@link ResizeHandle}.
 *
 * @category Components
 */
interface ResizeHandleOptions extends ComponentOptions {
    /**
     * Multi-event listener bag dispatched to {@link ResizeHandle.on} at
     * construction time. Each entry is appended; calling `on(event, fn)`
     * later registers another listener for the same event.
     */
    listeners?: {
        dragstart?: (event: MouseEvent) => void;
        dragmove?:  (clientX: number)   => void;
        dragend?:   ()                  => void;
    };
}

/**
 * The handle's themeable resize cursor. Exported so the host header can hold the
 * same cursor for the duration of a column drag, when the handle itself is out
 * of hit-testing and can no longer resolve it.
 */
const RESIZE_HANDLE_CURSOR = "var(--ts-ui-table-resize-handle-cursor, ew-resize)";

// 5 px-wide drag target with a 1 px colored stripe at the right edge —
// `80%` of `5 px = 4 px` transparent, the remaining `20%` is `1 px` of the
// resize-handle colour. Pairs with the 1 px dividers on ParentHeaderCell so
// every visible cell separator in the header band reads at the same
// thickness.
const _defaultResizeHandleOptions: Partial<ComponentOptions> = {
    cursor: RESIZE_HANDLE_CURSOR,
    backgroundImage:
        "linear-gradient(to right,transparent 80%," +
        "var(--ts-ui-table-resize-handle-color,rgba(0,0,0,0.2)) 80%)",
};

let _classRule: StyleRule | null = null;

/**
 * Registers the shared `.ResizeHandle` class rule once on first use. The rule
 * holds the absolute-position box geometry (position, top, right, width,
 * height, z-index) so per-instance setters only carry per-instance state.
 *
 * Idempotent and module-local; safe across hot reloads.
 */
function ensureResizeHandleClassRule(): void {
    if (_classRule) {
        return;
    }

    _classRule = new StyleRule({
        scope:  "class",
        name:   "ResizeHandle",
        styles: {
            position: "absolute",
            top:      "0",
            right:    "0",
            width:    "var(--ts-ui-table-resize-handle-width,5px)",
            height:   "100%",
            zIndex:   "1",
        },
    });
}

/**
 * A thin draggable handle anchored to the right edge of a table header cell.
 *
 * Lives as a side-loaded overlay on the `<th>` (its `position:absolute` plus
 * the host cell's [`Card`](/api/layout/classes/Card) layout keep it out of the
 * cell renderer's flow). Owns its own click + mousedown listeners via
 * {@link Event.addListener}. Drag-phase mousemove/mouseup listeners live with
 * the host so that the host can suppress the synthesized post-drag click.
 *
 * The static box geometry (position, top, right, width, height, z-index)
 * lives in a shared `.ResizeHandle` class rule registered on first use. The
 * cursor and the indicator gradient are per-instance values written through
 * typed Component setters in the constructor.
 *
 * @category Components
 */
class ResizeHandle extends Component<ResizeHandleOptions> {

    private _listeners: ListenerBag<ResizeHandleEvent> = this.registerListenerBag(new ListenerBag<ResizeHandleEvent>());

    /**
     * Constructs a resize handle. Callbacks default to none; consumers
     * register them via {@link on} or pass them through `options.listeners`.
     *
     * @param options - Optional configuration bag (drag listeners plus common
     *   Component fields).
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; forwarded so a subclass can seed a default without
     *   editing this constant.
     */
    constructor(options?: ResizeHandleOptions, subclassDefaults?: Partial<ComponentOptions>) {
        ensureResizeHandleClassRule();

        super({ tag: "div", ...(options ?? {}) }, { ..._defaultResizeHandleOptions, ...(subclassDefaults ?? {}) });

        this.setZIndex(1);

        // Listener wiring must happen here, NOT inside `applyOptions` —
        // Component's constructor invokes `applyOptions` synchronously
        // from inside super(), at which point the class-field
        // `_listeners` initializer has not yet run (class-field
        // initialisers fire between super() returning and the next
        // statement here). Wiring after super() guarantees `_listeners`
        // is the live `ListenerBag` instance.
        this.applyListeners(options?.listeners);
    }

    /**
     * Wires the framework-routed mousedown + click listeners after the element
     * has rendered. Mousedown fires the registered drag-start listeners; click
     * is intercepted to prevent a sort from firing on the host header cell.
     *
     * @param element - Optional element passed from the framework init chain.
     * @returns This component, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        Event.addListener(this, "mousedown", this._onMouseDown);
        Event.addListener(this, "click",     this._onClick);

        return this;
    }

    /**
     * Registers a listener for one of this handle's drag events.
     *
     * @param event - `"dragstart"` fires on mousedown over the handle, carrying
     *   the originating `MouseEvent` (whose `clientX` seeds the drag origin);
     *   `"dragmove"` fires on each viewport mousemove during a drag with the
     *   absolute pointer `clientX`; `"dragend"` fires when the viewport mouseup
     *   observes the release.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This handle, for method chaining.
     */
    on(event: "dragstart",         listener: (e: MouseEvent) => void): this;
    on(event: "dragmove",          listener: (clientX: number) => void): this;
    on(event: "dragend",           listener: () => void): this;
    on(event: ResizeHandleEvent,   listener: Function): this {
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
     * @returns This handle, for method chaining.
     */
    off(event: ResizeHandleEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order. Internal use only — outer hosts call the public
     * verbs {@link dragMove} / {@link dragEnd} which forward to `emit`.
     *
     * @param event - The event to emit.
     * @param payload - Forwarded to each listener.
     */
    protected emit(event: "dragstart",       e: MouseEvent): void;
    protected emit(event: "dragmove",        clientX: number): void;
    protected emit(event: "dragend"): void;
    protected emit(event: ResizeHandleEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Drives the `"dragmove"` event from the host's viewport-mousemove
     * listener. The host extracts `clientX` and forwards it here; this
     * method fires `"dragmove"` listeners with that absolute coordinate.
     *
     * @param clientX - The absolute pointer `clientX` for this mousemove tick.
     */
    dragMove(clientX: number): void {
        this.emit("dragmove", clientX);
    }

    /**
     * Drives the `"dragend"` event from the host's viewport-mouseup
     * listener.
     */
    dragEnd(): void {
        this.emit("dragend");
    }

    /**
     * Bound mousedown handler — fires the `"dragstart"` event with the
     * originating MouseEvent, then consumes the mousedown. A mousedown on
     * the handle always starts a drag, so this always returns `true`; that
     * also preserves the walk-skip that `Header.onResizeDragStart` (reached
     * through the `"dragstart"` event) relied on the removed
     * `stopPropagation` monkey-patch to produce.
     *
     * @param e - The mousedown event. Only ever a primary-button press — the
     * default `button: "primary"` registration filters the rest.
     * @returns `true`, consuming the press so it does not also reach the header's own sort handler.
     */
    private _onMouseDown = (e: MouseEvent): Event.ListenerResult => {
        this.emit("dragstart", e);

        return true;
    };

    /**
     * Bound click handler — swallows the click so the host header cell does
     * not interpret it as a sort.
     *
     * @returns `true`, consuming the click so a resize gesture never registers as a sort.
     */
    private _onClick = (): Event.ListenerResult => {
        return true;
    };
}

const ResizeHandleCallable = callable(ResizeHandle);
type ResizeHandleCallable = ResizeHandle;
export {
    ResizeHandle         as _ResizeHandle,
    ResizeHandleCallable as ResizeHandle,
    RESIZE_HANDLE_CURSOR
};
