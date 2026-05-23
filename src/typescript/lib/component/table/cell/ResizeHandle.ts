// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component, ComponentOptions } from "~/core/Component.js";
import { StyleRule } from "~/core/StyleTarget.js";
import { Event } from "~/core/Event.js";
import { callable } from "~/core/Callable.js";

/**
 * Construction-time options for {@link ResizeHandle}.
 *
 * @category Components
 */
export interface ResizeHandleOptions extends ComponentOptions {
    onDragStart?: (event: MouseEvent) => void;
    onDragMove?:  (delta: number) => void;
    onDragEnd?:   () => void;
}

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

    const rule = new StyleRule({ scope: "class", name: "ResizeHandle" });

    rule.setMany({
        position: "absolute",
        top:      "0",
        right:    "0",
        width:    "var(--ts-ui-table-resize-handle-width,5px)",
        height:   "100%",
        zIndex:   "1",
    });
    rule.ensure();

    _classRule = rule;
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

    declare private _onDragStart: ((event: MouseEvent) => void) | null;
    declare private _onDragMove:  ((delta: number) => void) | null;
    declare private _onDragEnd:   (() => void) | null;

    /**
     * Constructs a resize handle. Callbacks default to `null` and may be
     * registered later via {@link setOnDragStart} / {@link setOnDragMove} /
     * {@link setOnDragEnd}, or passed up-front through `options`.
     *
     * @param options - Optional configuration bag (drag callbacks plus common
     *   Component fields).
     */
    constructor(options?: ResizeHandleOptions) {
        ensureResizeHandleClassRule();

        super({ tag: "div", ...(options ?? {}) });

        this._onDragStart ??= null;
        this._onDragMove  ??= null;
        this._onDragEnd   ??= null;

        this.setCursor("var(--ts-ui-table-resize-handle-cursor, ew-resize)");
        this.setBackgroundImage(
            "linear-gradient(to right,transparent 60%," +
            "var(--ts-ui-table-resize-handle-color,rgba(0,0,0,0.2)) 60%)");
        this.setZIndex(1);
    }

    /**
     * Applies a {@link ResizeHandleOptions} bag. Drag callbacks are written
     * pure to the backing fields here; inherited Component fields cascade
     * through `super.applyOptions`.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: ResizeHandleOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as ResizeHandleOptions;

        if (opts.onDragStart !== undefined) this._onDragStart = opts.onDragStart;
        if (opts.onDragMove  !== undefined) this._onDragMove  = opts.onDragMove;
        if (opts.onDragEnd   !== undefined) this._onDragEnd   = opts.onDragEnd;

        return this;
    }

    /**
     * Wires the framework-routed mousedown + click listeners after the element
     * has rendered. Mousedown fires the registered drag-start callback; click
     * is intercepted to prevent a sort from firing on the host header cell.
     *
     * @param element - Optional element passed from the framework init chain.
     * @returns This component, for method chaining.
     */
    protected init(element?: HTMLElement): this {
        super.init(element);

        Event.addListener(this, "mousedown", (e: MouseEvent) => this._onDragStart?.(e));
        Event.addListener(this, "click",     (e: MouseEvent) => e.stopPropagation());

        return this;
    }

    /**
     * Registers the callback invoked on `mousedown` over the handle.
     *
     * @param fn - Called with the originating MouseEvent.
     * @returns This component, for method chaining.
     */
    setOnDragStart(fn: (event: MouseEvent) => void): this {
        this._onDragStart = fn;

        return this;
    }

    /**
     * Registers the callback invoked with the per-mousemove horizontal pixel
     * delta. The host wires viewport-level mousemove listeners during a drag
     * and forwards `movementX` here.
     *
     * @param fn - Called with the horizontal pixel delta on each drag move.
     * @returns This component, for method chaining.
     */
    setOnDragMove(fn: (delta: number) => void): this {
        this._onDragMove = fn;

        return this;
    }

    /**
     * Registers the callback invoked when the drag ends. The host fires this
     * once the viewport-level `mouseup` listener observes the release.
     *
     * @param fn - Called when the drag ends.
     * @returns This component, for method chaining.
     */
    setOnDragEnd(fn: () => void): this {
        this._onDragEnd = fn;

        return this;
    }

    /**
     * Invokes the registered drag-move callback (no-op when unset). Used by
     * the host's viewport-mousemove listener.
     *
     * @param delta - The horizontal pixel delta for this mousemove tick.
     */
    fireDragMove(delta: number): void {
        this._onDragMove?.(delta);
    }

    /**
     * Invokes the registered drag-end callback (no-op when unset). Used by
     * the host's viewport-mouseup listener.
     */
    fireDragEnd(): void {
        this._onDragEnd?.();
    }
}

const ResizeHandleCallable = callable(ResizeHandle);
type ResizeHandleCallable = ResizeHandle;
export {
    ResizeHandle         as _ResizeHandle,
    ResizeHandleCallable as ResizeHandle
};
