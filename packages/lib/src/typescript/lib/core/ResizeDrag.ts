// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Framework-internal drag-frame seam shared by every resize drag that can run
// live or as an outline: a Split gutter, a resizable Accordion gutter and a
// window edge. Only `ResizeMode` is exported from `core/index.ts`; the three
// owners and `Body` import the rest directly, mirroring
// `core/PendingPointerDrags.ts`.

import { Component } from "~/core/Component.js";
import type { ComponentOptions } from "~/core/Component.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { Event } from "~/core/Event.js";
import { LayerManager } from "~/core/LayerManager.js";
import { PerFrameCoalescer } from "~/core/PerFrameCoalescer.js";

/**
 * How a resize drag shows its progress. `"live"` lays the content out on every
 * frame of the drag; `"outline"` moves an outline to where the edge will land
 * and lays the content out once, when the drag is released.
 *
 * @category Core
 */
export type ResizeMode = "live" | "outline";

/** A box in the outline parent's coordinate space. */
export interface OutlineRect {
    /** The box's left edge. */
    x: number;
    /** The box's top edge. */
    y: number;
    /** The box's width. */
    width: number;
    /** The box's height. */
    height: number;
}

/** Where an outline drag draws its outline. */
export interface OutlineMount {
    /** The element the outline is appended to. */
    parent: Handle;
    /** The outline's box when the drag starts. */
    start: OutlineRect;
    /** The z-index the outline paints at. */
    zIndex: number;
}

/** What an owner does with one buffered pointer move. */
export interface ResizeDragHooks<T> {
    /**
     * Live mode: lays the move out now.
     *
     * @param value - The buffered move.
     */
    apply(value: T): void;

    /**
     * Outline mode: where the outline goes for this move, clamped exactly as
     * {@link ResizeDragHooks.apply} would clamp it.
     *
     * @param value - The buffered move.
     * @returns The outline's box, or `null` to leave the outline where it is.
     */
    preview(value: T): OutlineRect | null;

    /**
     * Outline mode, on release: lays the last previewed move out once.
     *
     * @param value - The last buffered move.
     */
    commit(value: T): void;
}

// Border width of the outline, in px: the render-review agenda asks for 1-2 px
// (00-agenda.md, Decision 2), and 1 px is hard to see on the 5,120 px-wide
// screen the QA runs use.
const OUTLINE_BORDER_PX: number = 2;

// Thickness of a gutter's outline, in px: its two borders meet, so it reads as
// one solid bar. Equals Split's 4 px visual gutter (its own GUTTER_SIZE).
const OUTLINE_LINE_PX: number = 2 * OUTLINE_BORDER_PX;

/**
 * `DragFeedback`'s and `ReorderIndicator`'s z-index: just below the lowest
 * {@link LayerManager} band, so an outline drawn in the page paints over page
 * content that forms no stacking context of its own, and under every window.
 */
export const IN_PAGE_OUTLINE_Z_INDEX: number = LayerManager.Band.Window - 1;

/**
 * The outline's class-tier chrome: a hairline box in the bright "it lands
 * here" drag token, the same colour `ReorderIndicator`'s bar uses. Hoisted
 * into one shared `.ResizeOutline` rule so a drag writes no stylesheet rule
 * of its own — in WebKitGTK every rule write restyles the whole document.
 */
const _defaultResizeOutlineOptions: Partial<ComponentOptions> = {
    border: `${OUTLINE_BORDER_PX}px solid var(--ts-ui-drag-reorder-color, #1a73e8)`,
};

/** The app-wide resize mode every owner that sets none of its own follows. */
let _appResizeMode: ResizeMode = "live";

/**
 * The app-wide resize mode, which `Body.setResizeMode` writes.
 *
 * @returns `"live"` until an app changes it.
 */
export function getAppResizeMode(): ResizeMode {
    return _appResizeMode;
}

/**
 * Sets the app-wide resize mode. Takes effect from the next drag.
 *
 * @param mode - The mode every owner with none of its own then follows.
 */
export function setAppResizeMode(mode: ResizeMode): void {
    _appResizeMode = mode;
}

/**
 * A component's own box, as the outline's coordinate space sees it.
 *
 * @param component - The component to read.
 * @returns Its position and size.
 */
export function rectOf(component: Component): OutlineRect {
    return { x: component.getX(), y: component.getY(), width: component.getWidth(), height: component.getHeight() };
}

/**
 * The outline for a gutter: an {@link OUTLINE_LINE_PX}-thick box centred on
 * the gutter's centre line across `axis`, as long as the gutter itself.
 *
 * @param box - The gutter's own box.
 * @param axis - The axis the gutter is dragged along.
 * @returns The outline's box at the drag's start.
 */
export function gutterOutline(box: OutlineRect, axis: "x" | "y"): OutlineRect {
    if (axis === "x") {
        return { x: box.x + box.width / 2 - OUTLINE_LINE_PX / 2, y: box.y, width: OUTLINE_LINE_PX, height: box.height };
    }

    return { x: box.x, y: box.y + box.height / 2 - OUTLINE_LINE_PX / 2, width: box.width, height: OUTLINE_LINE_PX };
}

/**
 * The bordered, unfilled box an outline drag moves in place of the real
 * layout. Module-private, like `ScrollStrip`'s own arrow button: it carries
 * its chrome in a shared class-tier rule and is never constructed from
 * outside this module.
 */
class ResizeOutline extends Component {
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultResizeOutlineOptions;

    /** The box the outline was mounted at; every later move translates from it. */
    private _start: OutlineRect | null = null;

    /** What to run when Escape or a window blur cancels the drag. */
    private _onCancel: (() => void) | null = null;

    /** Viewport `keydown` listener, held so it reads as a named function. */
    private readonly _boundOnKeyDown: (e: KeyboardEvent) => Event.ListenerResult = (e: KeyboardEvent): Event.ListenerResult => this.onKeyDown(e);

    /** Viewport `blur` listener, held for the same reason. */
    private readonly _boundOnWindowBlur: (e: FocusEvent) => void = (e: FocusEvent): void => this.onWindowBlur(e);

    /**
     * Constructs the outline. It is not attached until {@link show} runs.
     *
     * @param options - The component options bag.
     * @param subclassDefaults - Defaults a subclass layers over this class's own.
     */
    constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
        super(options, { ..._defaultResizeOutlineOptions, ...(subclassDefaults ?? {}) });

        this.setPointerEvents("none");
        this.setWillChange("transform");
    }

    /**
     * Sized by its owner every frame and childless, so the content-derived
     * clamp has nothing to say and would only cost two size-hint reads a frame.
     *
     * @returns `false`, always.
     */
    protected clampsToContentSize(): boolean {
        return false;
    }

    /**
     * Places the outline at `mount.start`, appends it, and listens for Escape
     * and a browser-window blur for as long as it is on screen.
     *
     * @param mount - Where the outline is drawn and at what z-index.
     * @param onCancel - Run when Escape or a window blur ends the drag.
     */
    show(mount: OutlineMount, onCancel: () => void): void {
        this._start    = mount.start;
        this._onCancel = onCancel;

        this.setZIndex(mount.zIndex);
        this.setX(mount.start.x);
        this.setY(mount.start.y);
        this.setWidth(mount.start.width);
        this.setHeight(mount.start.height);

        DOM.sink.appendChild(mount.parent, this.getElement(true)!);

        Event.addViewportListener(this, "keydown", this._boundOnKeyDown);
        Event.addViewportListener(this, "blur", this._boundOnWindowBlur);
    }

    /**
     * Moves the outline to `rect`, as one batched inline-style write.
     *
     * @param rect - Where the edge would land for this frame's move.
     */
    place(rect: OutlineRect): void {
        const start = this._start!;

        this.setAutoCommitStyle(false);
        this.setTranslate(rect.x - start.x, rect.y - start.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
        this.setAutoCommitStyle(true);
    }

    /**
     * Cancels the drag on Escape, consuming the key so nothing else acts on it.
     *
     * @param e - The keydown event.
     * @returns A stop-and-prevent disposition for Escape, nothing otherwise.
     */
    private onKeyDown(e: KeyboardEvent): Event.ListenerResult {
        if (e.key !== "Escape") {
            return;
        }

        this._onCancel?.();

        return { stop: true, prevent: true };
    }

    /**
     * Cancels the drag when the browser window itself loses focus.
     *
     * @param e - The blur event.
     *
     * @remarks Viewport listeners run in the capture phase, so an element's own
     * blur arrives here too; only the window's own blur cancels, the filter
     * `LayerManager.onWindowBlur` applies for the same reason.
     */
    private onWindowBlur(e: FocusEvent): void {
        if (!DOM.source.isWindow(e.target === null ? null : DOM.source.intern(e.target))) {
            return;
        }

        this._onCancel?.();
    }
}

/**
 * One resize drag's per-frame session. An owner buffers every pointer move
 * here and the session applies at most one per animation frame: in live mode
 * through the owner's `apply` hook, in outline mode by moving an outline to
 * where the edge would land and laying the move out once, on release.
 */
export class ResizeDrag<T> {

    /** The owner's three per-frame hooks. */
    private readonly _hooks: ResizeDragHooks<T>;

    /** The per-frame buffer both modes' frames arrive through. */
    private readonly _coalescer: PerFrameCoalescer<T>;

    /** The outline on screen, or `null` in live mode and between drags. */
    private _outline: ResizeOutline | null = null;

    /** The last move the outline was placed for, committed on release. */
    private _previewed: T | null = null;

    /** Set by a cancelled outline drag, so the release that follows commits nothing. */
    private _cancelled: boolean = false;

    /** The outline's cancel callback, held so it reads as a named function. */
    private readonly _boundCancel: () => void = (): void => this.cancel();

    /**
     * Constructs a session around one owner's hooks.
     *
     * @param hooks - What the owner does with a buffered move in each mode.
     * @param fps - Optional frames-per-second cap, read fresh every frame. It
     *   caps live frames only: an outline frame runs no layout, so capping it
     *   would just make the outline lag the pointer.
     */
    constructor(hooks: ResizeDragHooks<T>, fps?: () => number) {
        this._hooks = hooks;
        this._coalescer = new PerFrameCoalescer<T>(
            (value) => this.onFrame(value),
            fps === undefined ? undefined : () => (this._outline === null ? fps() : undefined),
        );
    }

    /** Starts a live drag, closing any drag still open without committing it. */
    beginLive(): void {
        this.reset();
    }

    /**
     * Starts an outline drag, closing any drag still open without committing it.
     *
     * @param mount - Where the outline is drawn and at what z-index.
     */
    beginOutline(mount: OutlineMount): void {
        this.reset();

        this._outline = new ResizeOutline();
        this._outline.show(mount, this._boundCancel);
    }

    /**
     * Buffers a pointer move, overwriting any move not yet applied. Ignored
     * after a cancel until the next begin.
     *
     * @param value - The move to buffer.
     */
    schedule(value: T): void {
        if (this._cancelled) {
            return;
        }

        this._coalescer.schedule(value);
    }

    /**
     * Ends the drag on release: flushes the freshest buffered move, and in
     * outline mode removes the outline and commits the move it last previewed.
     *
     * @returns `false` after a cancel, `true` otherwise.
     */
    end(): boolean {
        if (this._cancelled) {
            this._cancelled = false;

            return false;
        }

        this._coalescer.forceFlush();

        if (this._outline !== null) {
            const last = this._previewed;

            this.reset();

            if (last !== null) {
                this._hooks.commit(last);
            }
        }

        return true;
    }

    /**
     * Drops the buffered move. In outline mode it also removes the outline and
     * marks the drag cancelled, so the release that follows commits nothing.
     */
    cancel(): void {
        this._coalescer.cancel();

        if (this._outline !== null) {
            this.removeOutline();
            this._previewed = null;
            this._cancelled = true;
        }
    }

    /**
     * One frame's work: the owner's live apply, or the outline's move.
     *
     * @param value - The freshest buffered move.
     */
    private onFrame(value: T): void {
        if (this._outline === null) {
            this._hooks.apply(value);

            return;
        }

        this._previewed = value;

        const rect = this._hooks.preview(value);

        if (rect !== null) {
            this._outline.place(rect);
        }
    }

    /** Returns the session to its between-drags state, committing nothing. */
    private reset(): void {
        this._coalescer.cancel();
        this.removeOutline();
        this._previewed = null;
        this._cancelled = false;
    }

    /** Takes the outline off screen and disposes it, if one is up. */
    private removeOutline(): void {
        this._outline?.dispose();
        this._outline = null;
    }
}
