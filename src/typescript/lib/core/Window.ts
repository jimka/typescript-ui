// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Border } from "~/layout/Border.js";
import { Component } from "~/core/Component.js";
import { WindowHeader } from "~/component/container/WindowHeader.js";
import { WindowBorder, Direction } from "~/component/container/WindowBorder.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { Fit } from "~/layout/Fit.js";
import { FillType } from "~/layout/FillType.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { Placement } from "~/primitive/Placement.js";
import { Panel, PanelOptions } from "~/core/Panel.js";
import { callable } from "~/core/Callable.js";
import { DragManager, DragData, DragEventDetail, TabDragData, tabDragRegistry } from "~/core/DragManager.js";

const WINDOW_ANIM_DURATION_MS: number = 150;
const SNAP_DOCK_GAP_PX:         number = 4;
const DEFAULT_MIN_DOCK_WIDTH_PX: number = 200;
// Must-stay-visible slab of a window edge, used only when constrainToViewport is
// disabled: in that fallback the drag keeps at least this many pixels of the
// window inside the viewport so its header bar can never be dropped fully
// off-screen and become ungrabbable. The default, full-window containment never
// consults this. 24 px is wide enough to grab with a cursor yet narrow enough
// not to feel restrictive.
const EDGE_MARGIN_PX:            number = 24;

/**
 * Lifecycle state for {@link Window}. The three values are mutually
 * exclusive — a window is always exactly one of:
 *
 * - `"normal"`     — free-floating; user can drag and resize it.
 * - `"minimized"`  — docked along the bottom of the viewport at header height.
 * - `"maximized"`  — filling the viewport (or its parent, per `maximizeBounds`).
 *
 * The state field carries no presentation state; the corresponding rect and
 * body-visibility are computed by `Window`'s state-transition switch.
 *
 * @category Core
 */
export type WindowState = "normal" | "minimized" | "maximized";

/**
 * Snap-resize modifier key. Matches the matching property names exposed by
 * `KeyboardEvent`.
 *
 * @category Core
 */
export type WindowSnapModifier = "ctrl" | "meta" | "alt" | "shift";

/**
 * Where to fill when entering the `"maximized"` state.
 *
 * - `"viewport"` — fill `window.innerWidth` / `window.innerHeight` (default;
 *   matches the natural mount point since `Window` appends itself directly to
 *   `document.documentElement`).
 * - `"parent"`   — fill the window element's `parentElement` rect. Use when
 *   the window has been re-parented into a regular Panel.
 *
 * @category Core
 */
export type WindowMaximizeBounds = "viewport" | "parent";

interface WindowRect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/**
 * Construction-time options for {@link Window}.
 *
 * @category Core
 */
export interface WindowOptions extends PanelOptions {
    headerText?:        string;
    glyph?:             string;
    x?:                 number;
    y?:                 number;
    width?:             number;
    height?:            number;
    contentFactory?:    () => Component;
    onReady?:           (component: Component) => void;
    closeable?:         boolean;
    minimizable?:       boolean;
    maximizable?:       boolean;
    maximizeBounds?:    WindowMaximizeBounds;
    windowState?:       WindowState;
    snapResizeEnabled?: boolean;
    snapThreshold?:     number;
    snapModifier?:      WindowSnapModifier;
    constrainToViewport?: boolean;
}

/**
 * User-overridable visual defaults forwarded to `super` via the options bag.
 * The cascade in `Component`'s constructor dispatches each setter once with
 * the final value, so any field the caller supplied wins. `headerText`,
 * `glyph`, `contentFactory`, and `onReady` touch `this.header` or the
 * `contentFactory` field (both initialised after `super`), so `applyOptions`
 * writes them pure into `_options` and the constructor body dispatches them
 * once the children/fields exist.
 */
const _defaultWindowOptions: Partial<WindowOptions> = {
    x:                 50,
    y:                 50,
    width:             400,
    height:            300,
    border:            "1px solid var(--ts-ui-border-color, black)",
    borderRadius:      "var(--ts-ui-border-radius, 4px)",
    shadow:            "var(--ts-ui-window-shadow, 3px 3px 2px rgba(0, 0, 0, 0.4))",
    backgroundColor:   "var(--ts-ui-body-bg, rgb(241, 241, 241))",
    closeable:         true,
    minimizable:       true,
    maximizable:       true,
    maximizeBounds:    "viewport",
    windowState:       "normal",
    snapResizeEnabled: true,
    snapThreshold:     12,
    snapModifier:      "ctrl",
    constrainToViewport: true,
};

/**
 * A floating, resizable, and draggable window component.
 *
 * Renders a titled panel with eight border-handle strips that the user can
 * drag to resize the window from any edge or corner. Supports a three-state
 * lifecycle (`"normal"` / `"minimized"` / `"maximized"`) accessed through
 * {@link Window.setWindowState}, plus an opt-in Ctrl-snap resize affordance
 * that highlights the nearest border within a 12-pixel threshold so the
 * 4-pixel-wide grab strips are easier to land on.
 *
 * @category Core
 */
class Window extends Panel<WindowOptions> implements DismissableLayer {

    private static openWindows: Set<Window> = new Set<Window>();

    private _header: WindowHeader;
    private _borderComponents: {
        west: WindowBorder,
        northwest: WindowBorder,
        north: WindowBorder,
        northeast: WindowBorder,
        east: WindowBorder,
        southeast: WindowBorder,
        south: WindowBorder,
        southwest: WindowBorder,
    };

    private _animationFrameId: number | null = null;
    private _pendingClientX: number = 0;
    private _pendingClientY: number = 0;
    private _pendingBorder: WindowBorder | null = null;
    private _resizeSessionActive: boolean = false;
    private _resizeOriginClientX: number = 0;
    private _resizeOriginClientY: number = 0;
    private _resizeOriginX: number = 0;
    private _resizeOriginY: number = 0;
    private _resizeOriginW: number = 0;
    private _resizeOriginH: number = 0;
    private _resizeFps: number = 60;
    private _lastFlushTime: number = 0;
    private _dragStartLeft: number = 0;
    private _dragStartTop: number = 0;
    private _dragOriginClientX: number = 0;
    private _dragOriginClientY: number = 0;
    private _dragDX: number = 0;
    private _dragDY: number = 0;
    private _contentFactory: (() => Component) | null = null;
    private _contentReadyCallback: ((component: Component) => void) | null = null;

    private _preMinimizeState:  "normal" | "maximized" = "normal";
    private _restoreRect:       WindowRect | null = null;
    private _bodyHost:          Component | null = null;
    private _stateAnimHandle:   Animation.TweenHandle | null = null;
    private _viewportResizeBound: boolean = false;

    private _snapEnabled:       boolean = false;
    private _snapKeysAttached:  boolean = false;
    private _snapMoveAttached:  boolean = false;
    private _snapTargetBorder:  WindowBorder | null = null;

    private readonly _boundOnDrag: (e: MouseEvent) => void = (e: MouseEvent) => this.onDrag(e);
    private readonly _boundOnMouseUp: () => void = () => this.onMouseUp();
    private readonly _boundOnResizeEnd: () => void = () => this.onResizeEnd();
    private readonly _boundOnSnapKeyDown:   (e: KeyboardEvent) => void = (e) => this.onSnapKeyDown(e);
    private readonly _boundOnSnapKeyUp:     (e: KeyboardEvent) => void = (e) => this.onSnapKeyUp(e);
    private readonly _boundOnSnapMouseMove: (e: MouseEvent)    => void = (e) => this.onSnapMouseMove(e);
    private readonly _boundOnSnapMouseDown: (e: MouseEvent)    => void = (e) => this.onSnapMouseDown(e);
    private readonly _boundOnViewportResize: () => void                = () => this.onViewportResize();
    private readonly _boundOnSnapBlur:       () => void                = () => this.clearSnapState();

    // Shift-drag re-dock: a header press with Shift held starts a tab-dock drag
    // instead of a window move. Shift (not Ctrl) so it never collides with the
    // Ctrl snap-resize affordance. `_headerDragShift` captures the modifier at
    // press (the drag-source callbacks get no key state); `_headerDragComponentId`
    // stashes the registered content id so onDragEnd can clean the registry after
    // the dock already moved the content out; `_tearOffStripBody` keeps the source
    // inert for a `"strip"`-mode tear-off window (its body is a strip, not a panel).
    private _headerDragShift: boolean = false;
    private _headerDragComponentId: string = "";
    private _tearOffStripBody: boolean = false;
    private readonly _boundCaptureHeaderShift: (e: MouseEvent) => void = (e: MouseEvent) => this.captureHeaderShift(e);

    constructor(headerText: string, options?: WindowOptions) {
        super(options, _defaultWindowOptions);

        this.setLayoutManager(new Border());

        this._borderComponents = {
            west: new WindowBorder(Direction.WEST),
            northwest: new WindowBorder(Direction.NORTHWEST),
            north: new WindowBorder(Direction.NORTH),
            northeast: new WindowBorder(Direction.NORTHEAST),
            east: new WindowBorder(Direction.EAST),
            southeast: new WindowBorder(Direction.SOUTHEAST),
            south: new WindowBorder(Direction.SOUTH),
            southwest: new WindowBorder(Direction.SOUTHWEST),
        };

        this._borderComponents.west.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.northwest.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.north.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.northeast.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.east.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.southeast.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.south.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));
        this._borderComponents.southwest.on("drag", (border: WindowBorder, e: MouseEvent) => this.onResize(border, e));

        // Build the header with the effective text up front (consumer's
        // `options.headerText` from the cascade-written `_options`, falling
        // back to the positional argument, falling back to "Window"). The
        // late-built dispatch below skips `setHeaderText` because the header
        // already carries the right text — re-setting it would write the
        // same value twice.
        const effectiveHeaderText = this._options.headerText ?? headerText ?? "Window";
        this._header = new WindowHeader(effectiveHeaderText);
        this.addComponent(this._header, {
            placement: Placement.NORTH,
            ignoreParentInsets: true
        });
        this._header.addExitButtonListener(() => this.onExitAction());
        this._header.addMinimizeButtonListener(() => this.toggleMinimize());
        this._header.addMaximizeButtonListener(() => this.toggleMaximize());
        this._header.addHeaderDoubleClickListener((e: MouseEvent) => this.onHeaderDoubleClick(e));

        this.setVisible(false);
        // Resizable — size containment unsafe; layout containment scopes reflow to the window subtree.
        this.setContain("layout");

        Event.addListener(this._header, "mousedown", (e: MouseEvent) => this.onMouseDown(e));
        Event.addSubtreeListener(this, "mousedown", () => this.bringToFront());

        // Shift-drag the header to re-dock the window's body content onto a Tab
        // strip. The capture listener records the modifier (registered before the
        // drag source so it runs first); the drag source vetoes a plain (no-Shift)
        // press so the normal window move runs, and a strip-mode window's source
        // is inert because its body is a strip wrapper, not a dockable panel.
        Event.addListener(this._header, "mousedown", this._boundCaptureHeaderShift);
        DragManager.makeDragSource(this._header, {
            dragData: (): DragData => this.buildHeaderDragData(),
            onDragStart: (): boolean | void => this.onHeaderDragStart(),
            onDragEnd: (_detail: DragEventDetail, dropped: boolean): void => this.onHeaderDragEnd(dropped),
        });

        // Late-built state: glyph / contentFactory fields were written pure
        // to `_options` by the super-time cascade. Dispatch them now that
        // `this.header` and the `contentFactory` field exist.
        if (this._options.glyph !== undefined) {
            this._header.setGlyph(this._options.glyph);
        }
        if (this._options.contentFactory !== undefined) {
            this.setContentFactory(this._options.contentFactory, this._options.onReady);
        }

        // Late-built dispatch for state-affecting flags: these mutate the
        // header's button visibility (minimizable / maximizable) or trigger
        // a tween (windowState), so they must run after `this._header` is
        // wired and the geometry fields are initialised.
        if (this._options.closeable      !== undefined) this.setCloseable(this._options.closeable);
        if (this._options.minimizable    !== undefined) this.setMinimizable(this._options.minimizable);
        if (this._options.maximizable    !== undefined) this.setMaximizable(this._options.maximizable);
        if (this._options.maximizeBounds !== undefined) this.setMaximizeBounds(this._options.maximizeBounds);
        if (this._options.windowState    !== undefined) this.setWindowState(this._options.windowState);

        // Default minSize: enough header room for the title glyph, a 100px
        // text budget, and the three trailing buttons. Skipped when the
        // caller supplied an explicit `minSize` in the options bag.
        if (options?.minSize === undefined) {
            this.setMinSize(this._header.getMinContentWidth(), 200);
        }
    }

    /**
     * Applies a {@link WindowOptions} bag. Inherited Panel/Component fields
     * cascade through `super.applyOptions`; `headerText` / `glyph` /
     * `contentFactory` / `onReady` are written pure into `_options` here and
     * dispatched from the constructor body once `this.header` and the
     * `contentFactory` field exist. `x`, `y`, `width`, `height` cascade
     * directly through their setters — they write to local fields and skip
     * the DOM until an element exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowOptions): this {
        super.applyOptions(options);

        const opts = { ...this._defaultOptions, ...options } as WindowOptions;

        if (opts.headerText     !== undefined) this._options.headerText     = opts.headerText;
        if (opts.glyph          !== undefined) this._options.glyph          = opts.glyph;
        if (opts.contentFactory !== undefined) this._options.contentFactory = opts.contentFactory;
        if (opts.onReady        !== undefined) this._options.onReady        = opts.onReady;

        if (opts.x      !== undefined) this.setX(opts.x);
        if (opts.y      !== undefined) this.setY(opts.y);
        if (opts.width  !== undefined) this.setWidth(opts.width);
        if (opts.height !== undefined) this.setHeight(opts.height);

        // State-affecting flags are written pure into `_options` here and
        // dispatched late from the constructor body — the corresponding
        // setters need `this._header` (minimizable / maximizable) or geometry
        // (windowState) which only exist after super.
        if (opts.closeable         !== undefined) this._options.closeable         = opts.closeable;
        if (opts.minimizable       !== undefined) this._options.minimizable       = opts.minimizable;
        if (opts.maximizable       !== undefined) this._options.maximizable       = opts.maximizable;
        if (opts.maximizeBounds    !== undefined) this._options.maximizeBounds    = opts.maximizeBounds;
        if (opts.windowState       !== undefined) this._options.windowState       = opts.windowState;

        if (opts.snapResizeEnabled !== undefined) this.setSnapResizeEnabled(opts.snapResizeEnabled);
        if (opts.snapThreshold     !== undefined) this.setSnapThreshold(opts.snapThreshold);
        if (opts.snapModifier      !== undefined) this.setSnapModifier(opts.snapModifier);

        if (opts.constrainToViewport !== undefined) this.setConstrainToViewport(opts.constrainToViewport);

        return this;
    }

    /**
     * Returns the window's title-bar component.
     *
     * @returns The internal {@link WindowHeader} instance, exposing the close
     *          button, title text, and optional title-icon slot.
     */
    getHeader(): WindowHeader {
        return this._header;
    }

    /**
     * Sets the window width, clamping to the dynamic {@link getMinSize}
     * floor so border drags can't shrink the window below the header's
     * required width or the body content's min width.
     *
     * @param width - Requested width in pixels.
     *
     * @returns This component, for method chaining.
     *
     * @remarks `Component.setWidth` already clamps against `_options.minSize`
     * via its private `clampWidth`, but that path ignores the layout
     * manager's contribution — which is where the body content's minSize
     * lives. Consulting `getMinSize` first folds both sides in.
     */
    setWidth(width: number): this {
        const min = this.getMinSize();
        if (min && width < min.width) {
            width = min.width;
        }

        return super.setWidth(width);
    }

    /**
     * Sets the window height, clamping to the dynamic {@link getMinSize}
     * floor for the same reason described on {@link setWidth}.
     *
     * @param height - Requested height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        const min = this.getMinSize();
        if (min && height < min.height) {
            height = min.height;
        }

        return super.setHeight(height);
    }

    /**
     * Appends the window element to the document root, triggers layout, and makes it visible.
     *
     * @remarks When a content factory has been registered via
     * {@link Window.setContentFactory}, the window opens with a centred
     * `ProgressSpinner` in its content area and the factory is invoked behind
     * a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize).
     * The entrance scale-in and the spinner pause run concurrently, so by the
     * time the window finishes scaling in the spinner is already on screen.
     */
    show(): this {
        const el = this.getElement(true);

        // Join the central layer tree before bringToFront so the manager has
        // a node to re-stamp. A dropdown opened inside the window then
        // registers as the window's child and stacks above it.
        LayerManager.register(this);

        this.doLayout();
        this.bringToFront();

        Window.openWindows.add(this);

        document.documentElement.appendChild(el);

        this.setVisible(true);

        Animation.play(el, {
            from:       { opacity: "0", transform: "scale(0.97)" },
            to:         { opacity: "1", transform: "scale(1)"    },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
        });

        if (this._contentFactory) {
            const factory  = this._contentFactory;
            const onReady  = this._contentReadyCallback;
            this._contentFactory       = null;
            this._contentReadyCallback = null;

            // The 24 px diameter matches `TablePanel`'s store-loading
            // spinner so a slow window-content build and a slow data load
            // look identical from the user's perspective.
            const spinner = new Component();
            spinner.setLayoutManager(new Fit({ fill: FillType.NONE }));
            spinner.addComponent(new ProgressSpinner(24));

            Animation.materialize({
                host:             this,
                factory:          factory,
                spinnerComponent: spinner,
                onReady:          (component: Component) => {
                    this._bodyHost = component;
                    if (onReady) {
                        onReady(component);
                    }
                }
            });
        } else {
            this._bodyHost = this.findBodyHost();
        }

        if (this.isSnapResizeEnabled()) {
            this.attachSnapKeyboardListeners();
        }

        return this;
    }

    /**
     * Registers a factory that produces the window's content on first paint
     * instead of at construction time, and optionally a callback to run once
     * the produced component is attached, laid out, and faded in.
     *
     * @param factory - Zero-argument function returning the content component.
     * @param onReady - Optional callback fired after the content fade-in
     * completes (or immediately, under `prefers-reduced-motion: reduce`).
     * Receives the component the factory returned, fully attached and sized.
     *
     * @returns This window, for method chaining.
     *
     * @remarks Use when the content tree is expensive to build. `show()`
     * opens the window immediately with a spinner in the content area and
     * invokes the factory after a two-rAF yield via
     * [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize),
     * so the open-animation reaches the screen before the main-thread build
     * cost is incurred. Calling `show()` without a factory keeps the eager
     * `addComponent` lifecycle unchanged.
     *
     * Use the `onReady` callback for work that must happen after the content
     * is on screen and sized — for example kicking off an async data load
     * whose loading spinner is rendered by the content tree itself. Running
     * such work before `onReady` would emit `loadingchanged: true` before
     * the panel had subscribed (or before the target had a size).
     *
     * @example
     * ```typescript
     * const win = new Window("Heavy");
     * win.setSize({ width: 800, height: 600 });
     * win.setContentFactory(
     *     () => new TablePanel(store),
     *     () => void store.load()
     * );
     * win.show();
     * ```
     */
    setContentFactory(
        factory: () => Component,
        onReady?: (component: Component) => void
    ): this {
        this._contentFactory       = factory;
        this._contentReadyCallback = onReady ?? null;

        return this;
    }

    /**
     * Raises this window above all other windows by assigning it the highest z-index,
     * and marks it as the active window, updating the title bar appearance on both
     * the previously active window and this one.
     */
    bringToFront(): void {
        // Route the raise through the manager: it re-allocates the z-stamp
        // (mirrored back via onZIndexChanged) and marks this window active,
        // which deactivates the previously-active window's title bar through
        // onActivate. No local activeWindow / setActive bookkeeping is needed.
        LayerManager.bringToFront(this);
    }

    // ----- DismissableLayer -----

    /**
     * Returns the window's root element for the central layer tree.
     *
     * @returns The window's element, or null when not yet rendered.
     */
    getLayerElement(): HTMLElement | null {
        return this.getElement();
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. A window
     * is never dismissed by an outside interaction, so it stays `"manual"`.
     * Activation (the title-bar highlight) is orthogonal to dismissal — the
     * manager drives it through {@link Window.onActivate} for any mode.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "manual";
    }

    /**
     * Reflects the active state onto the title bar. The manager calls this
     * with `true` when a pointer / focus interaction lands inside the window
     * (or a layer opened inside it) and `false` when another layer takes over
     * or an empty-viewport click deactivates everything. Replaces the bespoke
     * window-wide outside-click viewport listener this class used to own.
     *
     * @param active - True when this window is the active layer.
     */
    onActivate(active: boolean): void {
        this._header.setActive(active);
    }

    /**
     * Advisory close request from the manager. A window owns its own close
     * affordance (the title-bar exit button), so this routes to the same
     * teardown.
     */
    requestClose(): void {
        this.onExitAction();
    }

    /**
     * Returns the window's z-index band so unrelated windows stack beneath
     * popovers, dropdowns, and dialogs.
     *
     * @returns The window band base.
     */
    getBand(): number {
        return LayerManager.Band.Window;
    }

    /**
     * Windows are independent top-level peers, not layers opened from one
     * another, so each registers as a tree root. This keeps raising one window
     * from dragging another up with it: {@link LayerManager.bringToFront}
     * re-stamps a node together with its descendants, which is correct for a
     * dropdown nested inside a window but wrong for two sibling windows.
     *
     * @returns Always `true`.
     */
    isLayerRoot(): boolean {
        return true;
    }

    /**
     * Mirrors a manager-allocated z-index onto the element when the window
     * (or a layer opened inside it) is raised via
     * {@link LayerManager.bringToFront}.
     *
     * @param zIndex - The fresh z-index assigned by the manager.
     */
    onZIndexChanged(zIndex: number): void {
        this.setZIndex(zIndex);
    }

    /**
     * Hides the window and destroys its DOM element when the close button is clicked.
     */
    onExitAction(): void {
        if (this._animationFrameId !== null) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }

        this._stateAnimHandle?.cancel();
        this._stateAnimHandle = null;

        // Drop any pending factory / onReady closure so its captured
        // references are free for GC if the window is closed before show()
        // ran the factory.
        this._contentFactory       = null;
        this._contentReadyCallback = null;

        this.detachSnapKeyboardListeners();
        this.detachSnapMouseListeners();
        this.detachViewportResizeListener();
        this.clearSnapTargetBorder();

        LayerManager.unregister(this);

        Window.openWindows.delete(this);

        // Re-layout the dock so any sibling minimized windows close any gap
        // this one's removal left behind.
        Window.relayoutMinimizedStack();

        const el = this.getElement();
        const finalize = (): void => {
            this.setVisible(false);
            this.destructor();
        };

        if (!el) {
            finalize();
            return;
        }

        Animation.play(el, {
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });
    }

    /**
     * Updates the text shown in the window's title bar.
     *
     * @param text - The new header label text.
     */
    setHeaderText(text: string) : this {
        if (!this._header) {
            throw new Error("Window does not have a header.");
        }

        this._header.getText().setText(text);

        return this;
    }

    /**
     * Returns the current lifecycle state (`"normal"`, `"minimized"`, or
     * `"maximized"`).
     *
     * @returns The current {@link WindowState}.
     */
    getWindowState(): WindowState {
        return this._options.windowState ?? "normal";
    }

    /**
     * Returns a snapshot array of every currently-open window. Used by layout
     * serialization to capture the floating-window plane, which is mounted on
     * `document.documentElement` rather than inside any container tree.
     *
     * @returns The open windows, in insertion order.
     */
    static getOpenWindows(): Window[] {
        return Array.from(Window.openWindows);
    }

    /**
     * Returns the window's current rectangle in viewport pixels. The public form
     * of the internal current-rect read, for layout serialization.
     *
     * @returns The `{ x, y, width, height }` the window currently occupies.
     */
    getRect(): { x: number; y: number; width: number; height: number } {
        return this.currentRect();
    }

    /**
     * Applies a rectangle captured by {@link getRect}, in viewport pixels.
     * `setWidth`/`setHeight` clamp against the window's minimum size and the
     * position is constrained to the viewport on the next layout, so a saved
     * rect from a larger or differently-shaped screen is pulled back into view.
     *
     * @param rect - The `{ x, y, width, height }` to apply.
     * @returns This window, for method chaining.
     */
    applyRect(rect: { x: number; y: number; width: number; height: number }): this {
        this.setX(rect.x);
        this.setY(rect.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);

        return this;
    }

    /**
     * Returns the cached normal-state rectangle a minimized or maximized window
     * un-collapses to, or `null` when the window is in its normal state.
     * Captured by serialization so a window serialized while minimized or
     * maximized round-trips back to the right normal geometry — on restore the
     * normal rect is applied first and `setWindowState` re-caches it.
     *
     * @returns The restore rect, or `null`.
     */
    getRestoreRect(): { x: number; y: number; width: number; height: number } | null {
        return this._restoreRect;
    }

    /**
     * Sets the lifecycle state. Tweens geometry between the current rect and
     * the rect implied by the target state over `WINDOW_ANIM_DURATION_MS`.
     * Under `prefers-reduced-motion: reduce` the tween collapses to a single
     * synchronous commit.
     *
     * @param state - One of `"normal"`, `"minimized"`, or `"maximized"`.
     *
     * @returns This window, for method chaining.
     *
     * @remarks Round-trips through `_restoreRect`: leaving `"normal"` caches
     * the current rect; returning to `"normal"` reads it back and clears the
     * cache. While minimized or maximized, drag and resize are suppressed
     * (see `onMouseDown` and `onResize` early-returns).
     */
    setWindowState(state: WindowState): this {
        const from = this.getWindowState();
        if (from === state) {
            return this;
        }

        // If a drag is in flight, commit it first so `_restoreRect` captures
        // the post-drag position instead of the stale start position.
        if (this._animationFrameId !== null) {
            cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }

        this._options.windowState = state;

        if (state === "normal") {
            // Restore body visibility BEFORE the tween starts so the
            // animation plays against the body content, not against an
            // empty rect.
            this.setBodyHostDisplayed(true);
            this._header.setMaximizeButtonGlyph("window-maximize");

            const target = this._restoreRect ?? this.currentRect();
            this._restoreRect = null;

            this.detachViewportResizeListener();
            this.animateRect(target, () => Window.relayoutMinimizedStack());
        } else if (state === "minimized") {
            if (from === "normal") {
                this._restoreRect = this.currentRect();
            }
            this._preMinimizeState = from === "maximized" ? "maximized" : "normal";
            this._header.setMaximizeButtonGlyph("window-maximize");
            this.detachViewportResizeListener();

            const target = this.computeDockRect();
            this.animateRect(target, () => {
                this.setBodyHostDisplayed(false);
                Window.relayoutMinimizedStack();
            });
        } else {
            // maximized
            if (from === "normal") {
                this._restoreRect = this.currentRect();
            }
            this.setBodyHostDisplayed(true);
            this._header.setMaximizeButtonGlyph("window-restore");

            const target = this.computeMaximizeRect();
            this.animateRect(target, () => {
                this.attachViewportResizeListener();
                Window.relayoutMinimizedStack();
            });
        }

        return this;
    }

    /**
     * Returns whether the window is currently in the `"maximized"` state.
     *
     * @returns True when the current state is `"maximized"`.
     */
    isMaximized(): boolean {
        return this.getWindowState() === "maximized";
    }

    /**
     * Returns whether the window is currently in the `"minimized"` state.
     *
     * @returns True when the current state is `"minimized"`.
     */
    isMinimized(): boolean {
        return this.getWindowState() === "minimized";
    }

    /**
     * Toggles between `"normal"` and `"minimized"`. No-ops when the window is
     * not minimizable, or when transitioning from `"maximized"` (use
     * `setWindowState("minimized")` directly for that path).
     */
    private toggleMinimize(): void {
        if (!this.isMinimizable()) {
            return;
        }

        if (this.getWindowState() === "minimized") {
            this.setWindowState("normal");
        } else {
            this.setWindowState("minimized");
        }
    }

    /**
     * Toggles between `"normal"` and `"maximized"`. No-ops when the window is
     * not maximizable.
     */
    private toggleMaximize(): void {
        if (!this.isMaximizable()) {
            return;
        }

        if (this.getWindowState() === "maximized") {
            this.setWindowState("normal");
        } else {
            this.setWindowState("maximized");
        }
    }

    /**
     * Handles `dblclick` on the header bar. When minimized, restores to the
     * pre-minimize state (`"normal"` or `"maximized"`); otherwise toggles
     * maximize. Clicks on the trailing buttons are ignored — they own their
     * own handlers.
     */
    private onHeaderDoubleClick(e: MouseEvent): void {
        const target = e.target as Node | null;
        if (target && this.targetIsInTrailingButton(target)) {
            return;
        }

        if (this.getWindowState() === "minimized") {
            this.setWindowState(this._preMinimizeState);
            return;
        }

        if (!this.isMaximizable()) {
            return;
        }
        this.toggleMaximize();
    }

    private targetIsInTrailingButton(target: Node): boolean {
        const buttons: Array<HTMLElement | undefined> = [
            this._header.getMinimizeButtonElement(),
            this._header.getMaximizeButtonElement(),
            this._header.getExitButtonElement(),
        ];
        for (const btn of buttons) {
            if (btn && btn.contains(target)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Enables or disables the title-bar close (exit) button. When disabled the
     * button greys out and the window can no longer be torn down by the user —
     * only programmatically via {@link requestClose} — so its content cannot be
     * destroyed by a stray click. Minimize / maximize are unaffected.
     *
     * @param value - True to enable the close button.
     *
     * @returns This window, for method chaining.
     */
    setCloseable(value: boolean): this {
        this._options.closeable = value;
        this._header.setCloseable(value);

        return this;
    }

    /**
     * Returns whether the close button is enabled.
     *
     * @returns True when the close button is enabled.
     */
    isCloseable(): boolean {
        return this._options.closeable ?? true;
    }

    /**
     * Toggles whether the minimize button is visible in the title bar.
     *
     * @param value - True to show the minimize button.
     *
     * @returns This window, for method chaining.
     */
    setMinimizable(value: boolean): this {
        this._options.minimizable = value;
        this._header.setMinimizable(value);

        return this;
    }

    /**
     * Returns whether the minimize button is visible.
     *
     * @returns True when the minimize button is shown.
     */
    isMinimizable(): boolean {
        return this._options.minimizable ?? true;
    }

    /**
     * Toggles whether the maximize button is visible in the title bar.
     *
     * @param value - True to show the maximize button.
     *
     * @returns This window, for method chaining.
     */
    setMaximizable(value: boolean): this {
        this._options.maximizable = value;
        this._header.setMaximizable(value);

        return this;
    }

    /**
     * Returns whether the maximize button is visible.
     *
     * @returns True when the maximize button is shown.
     */
    isMaximizable(): boolean {
        return this._options.maximizable ?? true;
    }

    /**
     * Sets the rect the window fills when entering the `"maximized"` state.
     *
     * @param value - `"viewport"` to fill the browser viewport,
     *                `"parent"` to fill the window element's parent rect.
     *
     * @returns This window, for method chaining.
     */
    setMaximizeBounds(value: WindowMaximizeBounds): this {
        this._options.maximizeBounds = value;

        return this;
    }

    /**
     * Returns the current maximize-bounds policy.
     *
     * @returns Either `"viewport"` or `"parent"`.
     */
    getMaximizeBounds(): WindowMaximizeBounds {
        return this._options.maximizeBounds ?? "viewport";
    }

    /**
     * Enables or disables the Ctrl-snap resize affordance. When disabled, the
     * keyboard listeners are detached and the snap-target border (if any) is
     * cleared.
     *
     * @param value - True to enable snap-to-edge detection.
     *
     * @returns This window, for method chaining.
     */
    setSnapResizeEnabled(value: boolean): this {
        if (this._options.snapResizeEnabled === value) {
            return this;
        }

        this._options.snapResizeEnabled = value;

        if (!value) {
            this.clearSnapState();
            this.detachSnapKeyboardListeners();
        } else if (this.getElement()) {
            this.attachSnapKeyboardListeners();
        }

        return this;
    }

    /**
     * Returns whether the snap-resize affordance is enabled.
     *
     * @returns True when snap-resize is enabled.
     */
    isSnapResizeEnabled(): boolean {
        return this._options.snapResizeEnabled ?? true;
    }

    /**
     * Controls how far a window may be dragged. When enabled (the default) the
     * whole window is kept inside the viewport — every border stops at the
     * viewport edge. When disabled the window may travel off-screen but its
     * header stays grabbable, so it can never be dropped fully out of reach.
     *
     * @param value - True to keep the entire window inside the viewport.
     *
     * @returns This window, for method chaining.
     */
    setConstrainToViewport(value: boolean): this {
        this._options.constrainToViewport = value;

        return this;
    }

    /**
     * Returns whether the whole window is constrained to the viewport while dragging.
     *
     * @returns True when the entire window is kept inside the viewport.
     */
    isConstrainToViewport(): boolean {
        return this._options.constrainToViewport ?? true;
    }

    /**
     * Sets the cursor-to-edge distance (in pixels) under which a border strip
     * is treated as the snap target while the modifier key is held.
     *
     * @param px - Threshold distance in pixels.
     *
     * @returns This window, for method chaining.
     */
    setSnapThreshold(px: number): this {
        this._options.snapThreshold = px;

        return this;
    }

    /**
     * Returns the current snap-detection threshold in pixels.
     *
     * @returns The threshold in pixels.
     */
    getSnapThreshold(): number {
        return this._options.snapThreshold ?? 12;
    }

    /**
     * Sets the modifier key that activates snap-resize detection.
     *
     * @param key - `"ctrl"`, `"meta"`, `"alt"`, or `"shift"`.
     *
     * @returns This window, for method chaining.
     */
    setSnapModifier(key: WindowSnapModifier): this {
        this._options.snapModifier = key;

        return this;
    }

    /**
     * Returns the modifier key currently activating snap-resize detection.
     *
     * @returns One of `"ctrl"`, `"meta"`, `"alt"`, `"shift"`.
     */
    getSnapModifier(): WindowSnapModifier {
        return this._options.snapModifier ?? "ctrl";
    }

    /**
     * Attaches document-level move and mouseup listeners to begin dragging the window.
     *
     * @param e - The mousedown event whose pointer coordinate anchors the drag.
     *
     * @remarks Wired to the header's `mousedown`; the event argument is required —
     * `e.clientX`/`e.clientY` seed the absolute-pointer drag origin read by `onDrag`.
     */
    onMouseDown(e: MouseEvent) {
        // Shift+drag on the header is a re-dock gesture (handled by the header
        // drag source), not a window move — don't start the move. (Ctrl is left
        // free for the snap-resize affordance.)
        if (e.shiftKey) {
            return;
        }

        if (this.getWindowState() !== "normal") {
            return;
        }

        // Snapshot the start position and pointer origin so onDrag derives the move from
        // (current pointer - origin) absolutely rather than accumulating per-move deltas,
        // and onMouseUp can commit (start + delta) back to left/top.
        this._dragStartLeft = this.getX();
        this._dragStartTop  = this.getY();
        this._dragOriginClientX = e.clientX;
        this._dragOriginClientY = e.clientY;
        this._dragDX = 0;
        this._dragDY = 0;

        // Pre-promote to a compositor layer so the first mousemove translate doesn't
        // pay a layer-creation cost mid-drag. Released in onMouseUp.
        this.setWillChange("transform");

        // Viewport listeners are required (rather than direct document listeners) because
        // Event.baseViewportListener stops mouseup propagation at window capture phase
        // whenever any viewport listener for the type exists (e.g. SpinButton registers
        // one at construction), which would prevent document-level handlers from firing.
        Event.addViewportListener(this, 'mouseup', this._boundOnMouseUp);
        Event.addViewportListener(this, 'mousemove', this._boundOnDrag);
    }

    /**
     * Records whether Shift was held at the header press, so the header drag
     * source — whose callbacks receive no key state — can tell a re-dock gesture
     * from a plain window move.
     *
     * @param e - The header `mousedown` event.
     */
    private captureHeaderShift(e: MouseEvent): void {
        this._headerDragShift = e.shiftKey;
    }

    /**
     * Builds the tab-dock payload for a Shift-drag of the header. `sourceTabId` is
     * the window's own id — never a strip's, so a drop target treats it as a
     * foreign dock rather than a same-strip reorder.
     *
     * @returns The {@link TabDragData} payload for the window's body content.
     */
    private buildHeaderDragData(): DragData {
        const content = this.findBodyHost();

        const data: TabDragData = {
            tabDrag:     true,
            sourceTabId: this.getId(),
            componentId: content ? content.getId() : "",
            label:       String(this._header.getText().getText()),
        };

        return { ...data };
    }

    /**
     * Vetoes the header drag unless Shift was held, the window has body content,
     * and the body is a real panel (not a `"strip"`-mode tear-off wrapper). When
     * it proceeds, it registers the live content so the destination strip can
     * resolve it from the id-only drag data.
     *
     * @returns `false` to veto (plain move / nothing to dock); otherwise `void`.
     */
    private onHeaderDragStart(): boolean | void {
        const shift = this._headerDragShift;
        this._headerDragShift = false;

        const content = this.findBodyHost();

        if (!shift || !content || this.isTearOffStripBody()) {
            return false;
        }

        this._headerDragComponentId = content.getId();
        tabDragRegistry.set(content.getId(), content);
    }

    /**
     * Cleans up the registry entry once the gesture ends and, when the drop
     * docked the content elsewhere (so the window has emptied), closes the window.
     *
     * @param dropped - `true` when the release landed on a registered drop
     *   target (whether it accepted or refused the drop); `false` on a release
     *   over empty space. The window only closes when the content actually left.
     */
    private onHeaderDragEnd(dropped: boolean): void {
        tabDragRegistry.delete(this._headerDragComponentId);
        this._headerDragComponentId = "";

        if (dropped && this.findBodyHost() === null) {
            this.requestClose();
        }
    }

    /**
     * Marks whether this window's body is a managed tear-off strip — set by
     * `Tab`'s `"strip"`-mode detach. A strip-body window's header drag source
     * stays inert (its body is the strip wrapper, not a dockable panel).
     *
     * @param value - `true` when the body is a tear-off strip.
     */
    setTearOffStripBody(value: boolean): void {
        this._tearOffStripBody = value;
    }

    /**
     * Returns whether this window's body is a managed tear-off strip.
     *
     * @returns `true` when the body is a tear-off strip.
     */
    isTearOffStripBody(): boolean {
        return this._tearOffStripBody;
    }

    /**
     * Adjusts the window's position and size based on the dragged border direction.
     *
     * @param border - The border handle that triggered the resize.
     * @param e - The mouse event carrying the absolute pointer coordinate.
     *
     * @remarks On the first move of a drag session the window's origin geometry
     * (pointer `clientX`/`clientY`, position, and size) is captured so that
     * `flushResize` can derive the new size from `origin + offset` rather
     * than accumulating per-move deltas. `WindowBorder` exposes no mousedown
     * hook to the window, so the capture is lazy and a viewport `mouseup`
     * listener clears the session flag when the drag ends.
     */
    onResize(border: WindowBorder, e: MouseEvent) {
        if (this.getWindowState() !== "normal") {
            return;
        }

        e.preventDefault();

        if (!this._resizeSessionActive) {
            this._resizeSessionActive = true;
            this._resizeOriginClientX = e.clientX;
            this._resizeOriginClientY = e.clientY;
            this._resizeOriginX       = this.getX();
            this._resizeOriginY       = this.getY();
            this._resizeOriginW       = this.getWidth();
            this._resizeOriginH       = this.getHeight();

            Event.addViewportListener(this, 'mouseup',     this._boundOnResizeEnd);
            Event.addViewportListener(this, 'touchend',    this._boundOnResizeEnd);
            Event.addViewportListener(this, 'touchcancel', this._boundOnResizeEnd);
        }

        this._pendingClientX = e.clientX;
        this._pendingClientY = e.clientY;
        this._pendingBorder = border;

        if (this._animationFrameId === null) {
            this._animationFrameId = requestAnimationFrame((ts) => this.flushResize(ts));
        }
    }

    /**
     * Clears the resize-session origin capture when a border drag ends, so the
     * next drag re-captures a fresh origin. Detaches the viewport listeners it
     * was registered with.
     */
    private onResizeEnd(): void {
        this._resizeSessionActive = false;

        Event.removeViewportListener(this, 'mouseup',     this._boundOnResizeEnd);
        Event.removeViewportListener(this, 'touchend',    this._boundOnResizeEnd);
        Event.removeViewportListener(this, 'touchcancel', this._boundOnResizeEnd);
    }

    /**
     * Returns the maximum number of layout passes per second during a resize drag.
     *
     * @returns The current frames-per-second cap.
     */
    getResizeFps(): number {
        return this._resizeFps;
    }

    /**
     * Sets the maximum number of layout passes per second during a resize drag.
     *
     * @param fps - Frames per second cap (e.g. 30 or 20). Defaults to 60.
     */
    setResizeFps(fps: number) : this {
        this._resizeFps = fps;

        return this;
    }

    private flushResize(timestamp: number) {
        if (timestamp - this._lastFlushTime < 1000 / this._resizeFps) {
            this._animationFrameId = requestAnimationFrame((ts) => this.flushResize(ts));
            return;
        }

        this._lastFlushTime = timestamp;
        this._animationFrameId = null;

        const border = this._pendingBorder;

        this._pendingBorder = null;

        if (!border) {
            return;
        }

        // Offset of the pointer from where the drag began. The new size is
        // `origin ± offset` clamped by setWidth/setHeight; WEST/NORTH edges
        // additionally re-derive position from the *clamped* size so the
        // opposite (fixed) edge stays put and over-travel past the minimum is
        // absorbed instead of decoupling the dragged edge from the cursor.
        const offsetX = this._pendingClientX - this._resizeOriginClientX;
        const offsetY = this._pendingClientY - this._resizeOriginClientY;

        const originRight  = this._resizeOriginX + this._resizeOriginW;
        const originBottom = this._resizeOriginY + this._resizeOriginH;

        // Viewport size caps so a dragged edge can't leave the screen. Each is the
        // largest size that keeps the moving edge inside the viewport given the fixed
        // opposite edge: east/south grow toward the far viewport edge, west/north grow
        // toward 0. Applied as an extra Math.min before setWidth/setHeight clamp to
        // their own min/max, so the WEST/NORTH position re-derivation below stays
        // consistent with the clamped size.
        const eastWidthCap   = window.innerWidth  - this._resizeOriginX;
        const westWidthCap   = originRight;
        const southHeightCap = window.innerHeight - this._resizeOriginY;
        const northHeightCap = originBottom;

        this.setAutoCommitStyle(false);
        switch (border.getDirection()) {
            case Direction.NORTHWEST:
                this.setWidth(Math.min(this._resizeOriginW - offsetX, westWidthCap));
                this.setHeight(Math.min(this._resizeOriginH - offsetY, northHeightCap));
                this.setX(originRight - this.getWidth());
                this.setY(originBottom - this.getHeight());

                break;
            case Direction.NORTH:
                this.setHeight(Math.min(this._resizeOriginH - offsetY, northHeightCap));
                this.setY(originBottom - this.getHeight());

                break;
            case Direction.NORTHEAST:
                this.setWidth(Math.min(this._resizeOriginW + offsetX, eastWidthCap));
                this.setHeight(Math.min(this._resizeOriginH - offsetY, northHeightCap));
                this.setY(originBottom - this.getHeight());

                break;
            case Direction.EAST:
                this.setWidth(Math.min(this._resizeOriginW + offsetX, eastWidthCap));

                break;
            case Direction.SOUTHEAST:
                this.setWidth(Math.min(this._resizeOriginW + offsetX, eastWidthCap));
                this.setHeight(Math.min(this._resizeOriginH + offsetY, southHeightCap));

                break;
            case Direction.SOUTH:
                this.setHeight(Math.min(this._resizeOriginH + offsetY, southHeightCap));

                break;
            case Direction.SOUTHWEST:
                this.setWidth(Math.min(this._resizeOriginW - offsetX, westWidthCap));
                this.setHeight(Math.min(this._resizeOriginH + offsetY, southHeightCap));
                this.setX(originRight - this.getWidth());

                break;
            case Direction.WEST:
                this.setWidth(Math.min(this._resizeOriginW - offsetX, westWidthCap));
                this.setX(originRight - this.getWidth());

                break;
        }

        this.doLayout();
        this.setAutoCommitStyle(true);
    }

    /**
     * Constrains the drag delta so the window stays within the viewport. The
     * bounds depend on {@link Window.isConstrainToViewport}: when enabled (the
     * default) every border stops at the viewport edge; when disabled the window
     * may travel off-screen until only an {@link EDGE_MARGIN_PX} strip remains
     * visible horizontally and the header band stays on-screen vertically, so it
     * can never be dropped fully out of reach. Mutates `_dragDX`/`_dragDY` in
     * place so both the live translate and the `onMouseUp` commit read the
     * clamped values from one chokepoint.
     */
    /**
     * The min/max top-left position that keeps the window inside the viewport,
     * honouring {@link isConstrainToViewport} (whole window in view) or the
     * header-reachable fallback (at least an `EDGE_MARGIN_PX` strip and the full
     * header band visible). Shared by drag clamping and {@link clampPositionToViewport}.
     *
     * @returns The position bounds in viewport pixels.
     */
    private viewportPositionBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        const w  = this.getWidth();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        if (this.isConstrainToViewport()) {
            // Whole window inside the viewport: every border stops at the edge.
            return { minX: 0, maxX: vw - w, minY: 0, maxY: vh - this.getHeight() };
        }

        // Header-reachable fallback: keep at least an EDGE_MARGIN_PX strip visible
        // horizontally and the whole header band visible vertically. The 26 px
        // floor mirrors the default header height before the header has laid out.
        const headerH = this._header.getHeight() || 26;

        return { minX: EDGE_MARGIN_PX - w, maxX: vw - EDGE_MARGIN_PX, minY: 0, maxY: vh - headerH };
    }

    private clampDragDelta(): void {
        const { minX, maxX, minY, maxY } = this.viewportPositionBounds();

        const targetX = this._dragStartLeft + this._dragDX;
        const targetY = this._dragStartTop  + this._dragDY;

        // Outer Math.max floors at the min so the top-left corner (and the header)
        // stays visible when the window is larger than the viewport (max < min);
        // the inner Math.min caps the far edge.
        const clampedX = Math.max(Math.min(targetX, maxX), minX);
        const clampedY = Math.max(Math.min(targetY, maxY), minY);

        this._dragDX = clampedX - this._dragStartLeft;
        this._dragDY = clampedY - this._dragStartTop;
    }

    /**
     * Clamps the window's current position so the window sits inside the
     * viewport, by the same rule the move-drag uses. Call after positioning a
     * window programmatically — e.g. opening one at a tear-off release point that
     * may lie past the viewport edge — so it can never land off-screen. Set the
     * window's size first, since the bounds depend on it.
     *
     * @returns This window, for method chaining.
     */
    clampPositionToViewport(): this {
        const { minX, maxX, minY, maxY } = this.viewportPositionBounds();

        this.setX(Math.max(Math.min(this.getX(), maxX), minX));
        this.setY(Math.max(Math.min(this.getY(), maxY), minY));

        return this;
    }

    /**
     * Moves the window to follow the pointer while dragging.
     *
     * @param e - The mouse event carrying the absolute pointer coordinate.
     */
    onDrag(e: MouseEvent) {
        e.preventDefault();

        // Derive the delta from the absolute pointer offset (not accumulated movementX)
        // so clampDragDelta's writeback can't drift: when the window is pinned at an edge
        // the over-travel is absorbed and the window re-attaches to the cursor on reverse.
        this._dragDX = e.clientX - this._dragOriginClientX;
        this._dragDY = e.clientY - this._dragOriginClientY;

        this.clampDragDelta();

        // Compositor-only translate during drag; the cached left/top stay at the start
        // position so the field-DOM invariant holds (left === style.left throughout).
        this.setTranslate(this._dragDX, this._dragDY);
    }

    /**
     * Detaches the document-level drag listeners when the mouse button is released.
     */
    onMouseUp() {
        // Commit the in-progress translate back to left/top so subsequent layout passes
        // operate from the new position. setTranslate(0, 0) frees the compositor layer.
        this.setX(this._dragStartLeft + this._dragDX);
        this.setY(this._dragStartTop  + this._dragDY);
        this.setTranslate(0, 0);
        this.setWillChange(null);

        Event.removeViewportListener(this, 'mouseup', this._boundOnMouseUp);
        Event.removeViewportListener(this, 'mousemove', this._boundOnDrag);
    }

    /**
     * Runs the border layout and positions all eight resize-handle strips around the window.
     *
     * @returns This component, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        let borderSize = this.getBorderSize();
        let insets = this.getInsets();
        let horisontallBorderWidth = (Number(borderSize.left) || 0) + (Number(borderSize.right) || 0) + insets.getLeft();
        let verticalBorderWidth = (Number(borderSize.top) || 0) + (Number(borderSize.bottom) || 0) + insets.getTop();
        let size = this.getSize();
        if (!size) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        let innerSize = this.getInnerSize();
        if (!innerSize) {
            throw new Error("Component doesn't seem to be rendered.");
        }

        this._borderComponents.west.setAutoCommitStyle(false);
        this._borderComponents.northwest.setAutoCommitStyle(false);
        this._borderComponents.north.setAutoCommitStyle(false);
        this._borderComponents.northeast.setAutoCommitStyle(false);
        this._borderComponents.east.setAutoCommitStyle(false);
        this._borderComponents.southeast.setAutoCommitStyle(false);
        this._borderComponents.south.setAutoCommitStyle(false);
        this._borderComponents.southwest.setAutoCommitStyle(false);

        this._borderComponents.west.setX(0);
        this._borderComponents.west.setY(insets.getTop());
        this._borderComponents.west.setWidth(insets.getLeft());
        this._borderComponents.west.setHeight(innerSize.height);

        this._borderComponents.northwest.setX(0);
        this._borderComponents.northwest.setY(0);
        this._borderComponents.northwest.setWidth(insets.getLeft());
        this._borderComponents.northwest.setHeight(insets.getTop());

        this._borderComponents.north.setX(insets.getLeft());
        this._borderComponents.north.setY(0);
        this._borderComponents.north.setWidth(innerSize.width);
        this._borderComponents.north.setHeight(insets.getTop());

        this._borderComponents.northeast.setX(size.width - horisontallBorderWidth);
        this._borderComponents.northeast.setY(0);
        this._borderComponents.northeast.setWidth(insets.getRight());
        this._borderComponents.northeast.setHeight(insets.getTop());

        this._borderComponents.east.setX(size.width - horisontallBorderWidth);
        this._borderComponents.east.setY(insets.getTop());
        this._borderComponents.east.setWidth(insets.getRight());
        this._borderComponents.east.setHeight(innerSize.height);

        this._borderComponents.southeast.setX(size.width - horisontallBorderWidth);
        this._borderComponents.southeast.setY(size.height - verticalBorderWidth);
        this._borderComponents.southeast.setWidth(insets.getRight());
        this._borderComponents.southeast.setHeight(insets.getBottom());

        this._borderComponents.south.setX(insets.getLeft());
        this._borderComponents.south.setY(size.height - verticalBorderWidth);
        this._borderComponents.south.setWidth(innerSize.width);
        this._borderComponents.south.setHeight(insets.getRight());

        this._borderComponents.southwest.setX(0);
        this._borderComponents.southwest.setY(size.height - verticalBorderWidth);
        this._borderComponents.southwest.setWidth(insets.getLeft());
        this._borderComponents.southwest.setHeight(insets.getBottom());

        this._borderComponents.west.setAutoCommitStyle(true);
        this._borderComponents.northwest.setAutoCommitStyle(true);
        this._borderComponents.north.setAutoCommitStyle(true);
        this._borderComponents.northeast.setAutoCommitStyle(true);
        this._borderComponents.east.setAutoCommitStyle(true);
        this._borderComponents.southeast.setAutoCommitStyle(true);
        this._borderComponents.south.setAutoCommitStyle(true);
        this._borderComponents.southwest.setAutoCommitStyle(true);

        return this;
    }

    /**
     * Creates the window element and appends all eight resize-handle border elements.
     *
     * @returns The root HTMLElement for this window.
     */
    render() {
        let element = super.render();

        element.appendChild(this._borderComponents.west.getElement(true));
        element.appendChild(this._borderComponents.northwest.getElement(true));
        element.appendChild(this._borderComponents.north.getElement(true));
        element.appendChild(this._borderComponents.northeast.getElement(true));
        element.appendChild(this._borderComponents.east.getElement(true));
        element.appendChild(this._borderComponents.southeast.getElement(true));
        element.appendChild(this._borderComponents.south.getElement(true));
        element.appendChild(this._borderComponents.southwest.getElement(true));

        return element;
    }

    // ----- state-transition helpers -----

    private currentRect(): WindowRect {
        return {
            x:      this.getX(),
            y:      this.getY(),
            width:  this.getWidth(),
            height: this.getHeight(),
        };
    }

    private findBodyHost(): Component | null {
        // The first non-header child component, if any. Used to hide the body
        // while minimized so the docked strip shows only the title bar.
        const children = this.getComponents();
        for (const child of children) {
            if (child !== this._header) {
                return child;
            }
        }
        return null;
    }

    private setBodyHostDisplayed(displayed: boolean): void {
        if (!this._bodyHost) {
            this._bodyHost = this.findBodyHost();
        }
        if (this._bodyHost) {
            this._bodyHost.setDisplayed(displayed);
        }
    }

    private computeMaximizeRect(): WindowRect {
        if (this.getMaximizeBounds() === "parent") {
            const el = this.getElement();
            const parent = el ? el.parentElement : null;
            if (parent && parent !== document.documentElement) {
                const r = parent.getBoundingClientRect();
                return { x: 0, y: 0, width: r.width, height: r.height };
            }
        }

        return {
            x:      0,
            y:      0,
            width:  window.innerWidth,
            height: window.innerHeight,
        };
    }

    private computeDockRect(): WindowRect {
        const dockWidth = this.getMinDockWidth();
        const slotIndex = this.computeDockSlotIndex();
        const headerHeight = this._header.getHeight() || 26;
        const x = slotIndex * (dockWidth + SNAP_DOCK_GAP_PX);
        const y = window.innerHeight - headerHeight;

        return { x, y, width: dockWidth, height: headerHeight };
    }

    private getMinDockWidth(): number {
        const cssVar = getComputedStyle(document.documentElement)
            .getPropertyValue("--ts-ui-window-min-dock-width").trim();
        if (cssVar) {
            const parsed = parseFloat(cssVar);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return DEFAULT_MIN_DOCK_WIDTH_PX;
    }

    private computeDockSlotIndex(): number {
        let index = 0;
        for (const win of Window.openWindows) {
            if (win === this) {
                return index;
            }
            if (win.getWindowState() === "minimized") {
                index++;
            }
        }
        return index;
    }

    private static relayoutMinimizedStack(): void {
        let index = 0;
        for (const win of Window.openWindows) {
            if (win.getWindowState() !== "minimized") {
                continue;
            }
            const dockWidth   = win.getMinDockWidth();
            const headerHeight = win._header.getHeight() || 26;
            const x = index * (dockWidth + SNAP_DOCK_GAP_PX);
            const y = window.innerHeight - headerHeight;

            win.setAutoCommitStyle(false);
            win.setX(x);
            win.setY(y);
            win.setWidth(dockWidth);
            win.setHeight(headerHeight);
            win.doLayout();
            win.setAutoCommitStyle(true);

            index++;
        }
    }

    /**
     * Tweens the window's `x`, `y`, `width`, `height` from the current rect to
     * `target` over `WINDOW_ANIM_DURATION_MS`. Honours `prefers-reduced-motion`
     * by skipping straight to the final rect in one frame.
     */
    private animateRect(target: WindowRect, onDone?: () => void): void {
        this._stateAnimHandle?.cancel();
        this._stateAnimHandle = null;

        const commit = (rect: WindowRect): void => {
            this.setAutoCommitStyle(false);
            this.setX(rect.x);
            this.setY(rect.y);
            this.setWidth(rect.width);
            this.setHeight(rect.height);
            this.doLayout();
            this.setAutoCommitStyle(true);
        };

        this._stateAnimHandle = Animation.tween<WindowRect>({
            from:       this.currentRect(),
            to:         target,
            durationMs: WINDOW_ANIM_DURATION_MS,
            onStep:     commit,
            onComplete: (): void => {
                this._stateAnimHandle = null;
                onDone?.();
            },
        });
    }

    // ----- viewport-resize handling while maximized -----

    private attachViewportResizeListener(): void {
        if (this._viewportResizeBound) {
            return;
        }

        Event.addViewportListener(this, "resize", this._boundOnViewportResize);
        this._viewportResizeBound = true;
    }

    private detachViewportResizeListener(): void {
        if (!this._viewportResizeBound) {
            return;
        }

        Event.removeViewportListener(this, "resize", this._boundOnViewportResize);
        this._viewportResizeBound = false;
    }

    private onViewportResize(): void {
        if (this.getWindowState() !== "maximized") {
            return;
        }

        const rect = this.computeMaximizeRect();
        this.setAutoCommitStyle(false);
        this.setX(rect.x);
        this.setY(rect.y);
        this.setWidth(rect.width);
        this.setHeight(rect.height);
        this.doLayout();
        this.setAutoCommitStyle(true);

        Window.relayoutMinimizedStack();
    }

    // ----- snap-resize listeners -----

    private attachSnapKeyboardListeners(): void {
        if (this._snapKeysAttached) {
            return;
        }

        Event.addViewportListener(this, "keydown", this._boundOnSnapKeyDown);
        Event.addViewportListener(this, "keyup",   this._boundOnSnapKeyUp);
        Event.addViewportListener(this, "blur",    this._boundOnSnapBlur);
        this._snapKeysAttached = true;
    }

    private detachSnapKeyboardListeners(): void {
        if (!this._snapKeysAttached) {
            return;
        }

        Event.removeViewportListener(this, "keydown", this._boundOnSnapKeyDown);
        Event.removeViewportListener(this, "keyup",   this._boundOnSnapKeyUp);
        Event.removeViewportListener(this, "blur",    this._boundOnSnapBlur);
        this._snapKeysAttached = false;
    }

    private attachSnapMouseListeners(): void {
        if (this._snapMoveAttached) {
            return;
        }

        Event.addViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
        Event.addViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
        this._snapMoveAttached = true;
    }

    private detachSnapMouseListeners(): void {
        if (!this._snapMoveAttached) {
            return;
        }

        Event.removeViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
        Event.removeViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
        this._snapMoveAttached = false;
    }

    private clearSnapTargetBorder(): void {
        if (this._snapTargetBorder) {
            this._snapTargetBorder.setSnapTarget(false);
            this._snapTargetBorder = null;
        }
    }

    private clearSnapState(): void {
        this._snapEnabled = false;
        this.detachSnapMouseListeners();
        this.clearSnapTargetBorder();
    }

    private onSnapKeyDown(e: KeyboardEvent): void {
        if (!this.isSnapResizeEnabled()) {
            return;
        }
        if (this.getWindowState() !== "normal") {
            return;
        }
        if (!this.modifierMatches(e)) {
            return;
        }
        if (this._snapEnabled) {
            return;
        }

        this._snapEnabled = true;
        this.attachSnapMouseListeners();
    }

    private onSnapKeyUp(e: KeyboardEvent): void {
        if (!this._snapEnabled) {
            return;
        }
        // Some browsers fire keyup with a different key field when modifiers
        // chord; only release when the watched modifier is no longer active.
        if (this.modifierStillHeld(e)) {
            return;
        }

        this.clearSnapState();
    }

    private modifierMatches(e: KeyboardEvent): boolean {
        switch (this.getSnapModifier()) {
            case "ctrl":  return e.ctrlKey;
            case "meta":  return e.metaKey;
            case "alt":   return e.altKey;
            case "shift": return e.shiftKey;
        }
    }

    private modifierStillHeld(e: KeyboardEvent): boolean {
        return this.modifierMatches(e);
    }

    private onSnapMouseMove(e: MouseEvent): void {
        if (!this._snapEnabled) {
            return;
        }

        const winner = this.pickSnapBorder(e.clientX, e.clientY);
        if (winner === this._snapTargetBorder) {
            return;
        }

        if (this._snapTargetBorder) {
            this._snapTargetBorder.setSnapTarget(false);
        }
        this._snapTargetBorder = winner;
        if (winner) {
            winner.setSnapTarget(true);
        }
    }

    private pickSnapBorder(cx: number, cy: number): WindowBorder | null {
        const candidates: WindowBorder[] = [
            // Corners first so ties go to corners over edges.
            this._borderComponents.northwest,
            this._borderComponents.northeast,
            this._borderComponents.southeast,
            this._borderComponents.southwest,
            this._borderComponents.north,
            this._borderComponents.east,
            this._borderComponents.south,
            this._borderComponents.west,
        ];

        let best: WindowBorder | null = null;
        let bestDist = this.getSnapThreshold();

        for (const border of candidates) {
            const el = border.getElement();
            if (!el) {
                continue;
            }
            const rect = el.getBoundingClientRect();
            const dx = Math.max(rect.left - cx, 0, cx - rect.right);
            const dy = Math.max(rect.top  - cy, 0, cy - rect.bottom);
            const dist = Math.hypot(dx, dy);

            if (dist <= bestDist) {
                best     = border;
                bestDist = dist;
            }
        }

        return best;
    }

    private onSnapMouseDown(e: MouseEvent): void {
        const target = this._snapTargetBorder;
        if (!target) {
            return;
        }

        // If the mousedown landed directly on the highlighted border, the
        // strip's own `mousedown` listener (registered in WindowBorder's
        // constructor) will already fire onDragStart — forwarding here would
        // double-register the viewport listeners. The snap forwarding is only
        // useful when the cursor sits *outside* the 4 px strip.
        const targetEl = target.getElement();
        if (targetEl && e.target instanceof Node && targetEl.contains(e.target)) {
            this._snapTargetBorder = null;
            return;
        }

        // Forward into the border's own drag flow. The snap-target highlight
        // is cleared in the matching onDragStop hook the border owns.
        target.onDragStart();
        this._snapTargetBorder = null;
    }
}

const WindowCallable = callable(Window);
type WindowCallable = Window;
export {
    Window         as _Window,
    WindowCallable as Window
};
