// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { WindowBorder, Direction } from "~/component/container/WindowBorder.js";
import { Event } from "~/core/Event.js";
import { Animation } from "~/core/Animation.js";
import { LayerManager, DismissableLayer, LayerDismissMode } from "~/core/LayerManager.js";
import { trapWheel, untrapWheel } from "~/core/WheelTrap.js";
import { createSpinnerWrap } from "~/component/display/SpinnerWrap.js";
import { Container, ContainerOptions } from "~/core/Container.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { Insets } from "~/primitive/Insets.js";
import { Size } from "~/primitive/Size.js";
import { Placement } from "~/primitive/Placement.js";
import type { Rail } from "~/overlay/Rail.js";

// Window body inset in pixels, set explicitly now that the base is Container
// (zero default insets) rather than Panel (which supplied this 4px implicitly).
// `doLayout` folds this inset into the resize-border thickness, so it both pads
// the body content and reserves the grab band the WindowBorder handles sit in;
// 4px preserves the exact resting geometry windows inherited from Panel before
// the reparent.
const WINDOW_BODY_INSET_PX:     number = 4;
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
// Fallback chrome-band height used before the window has laid out, when the
// title chrome's measured height (`chromeHeight()`) still reads 0. 26 px is the
// default chrome height a `Window` header renders at, so a pre-layout geometry
// calculation lands on the same footprint the laid-out window will have.
const CHROME_HEIGHT_FLOOR_PX:   number = 26;
// Clearance a normal-state window is refit inside of after a viewport resize
// (see `fitNormalWindowToViewport`) — deliberately wider than `EDGE_MARGIN_PX`
// since this refit can also shrink the window, so the margin doubles as
// breathing room around the resized box rather than just a grab strip.
const VIEWPORT_RESIZE_MARGIN_PX: number = 50;

/**
 * Lifecycle state for an {@link AbstractWindow}. The three values are mutually
 * exclusive — a window is always exactly one of:
 *
 * - `"normal"`     — free-floating; user can drag and resize it.
 * - `"minimized"`  — docked along the bottom of the viewport at header height.
 * - `"maximized"`  — filling the viewport (or its parent, per `maximizeBounds`).
 *
 * The state field carries no presentation state; the corresponding rect and
 * body-visibility are computed by the window's state-transition switch.
 *
 * @category Core
 */
export type WindowState = "normal" | "minimized" | "maximized";

/**
 * Typed events an {@link AbstractWindow} emits. `"minimize"` fires when the
 * window enters `"minimized"`, `"restore"` when it leaves it, `"close"` when
 * the window is closed, and `"activate"` when the window becomes the active
 * layer (a raise / focus). A [`Rail`](/api/overlay/classes/Rail) subscribes to
 * the first three to mirror a window minimized into it as a launcher handle; a
 * [`Dock`](/api/overlay/classes/Dock) subscribes to `"activate"` to track which
 * floated panel is focused.
 *
 * @category Core
 */
export type WindowEvent = "minimize" | "restore" | "close" | "activate";

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
 *   matches the natural mount point since the window appends itself directly to
 *   `document.documentElement`).
 * - `"parent"`   — fill the window element's `parentElement` rect. Use when
 *   the window has been re-parented into a regular Panel.
 *
 * @category Core
 */
export type WindowMaximizeBounds = "viewport" | "parent";

/**
 * A window's rectangle in viewport pixels.
 *
 * @category Core
 */
export interface WindowRect {
    x:      number;
    y:      number;
    width:  number;
    height: number;
}

/**
 * Construction-time options for {@link AbstractWindow} and its subclasses.
 *
 * @category Core
 */
export interface WindowOptions extends ContainerOptions {
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
    /** Enables the drag-to-resize border strips. Defaults to `true`. */
    resizable?:         boolean;
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
 * `glyph`, `contentFactory`, and `onReady` touch subclass chrome or the
 * `contentFactory` field (both initialised after `super`), so `applyOptions`
 * writes them pure into `_options` and the constructor body dispatches them
 * once the children/fields exist.
 */
const _defaultWindowOptions: Partial<WindowOptions> = {
    x:                 50,
    y:                 50,
    width:             400,
    height:            300,
    insets:            new Insets(WINDOW_BODY_INSET_PX, WINDOW_BODY_INSET_PX, WINDOW_BODY_INSET_PX, WINDOW_BODY_INSET_PX),
    border:            "1px solid var(--ts-ui-border-color, black)",
    borderRadius:      "var(--ts-ui-border-radius, 4px)",
    shadow:            "var(--ts-ui-window-shadow, 3px 3px 2px rgba(0, 0, 0, 0.4))",
    backgroundColor:   "var(--ts-ui-body-bg, rgb(241, 241, 241))",
    closeable:         true,
    minimizable:       true,
    maximizable:       true,
    resizable:         true,
    maximizeBounds:    "viewport",
    windowState:       "normal",
    snapResizeEnabled: true,
    snapThreshold:     12,
    snapModifier:      "ctrl",
    constrainToViewport: true,
};

// z-index for the eight resize handles, lifting them above the window's content
// layers so the edges and corners stay grabbable even when content paints over
// the gutter — a TabWindow bar (`barIgnoreParentInsets`) or a Window header
// (`ignoreParentInsets`) reaches the outer edge, and the layout-manager bar is
// appended *after* the handles in DOM, so without an explicit z-index it would
// win hit-testing. 10 sits comfortably above the tab bar's internal chrome
// (tool group, indicator, scroll-arrow buttons top out at z-index 3).
const RESIZE_BORDER_Z_INDEX: number = 10;

/**
 * Header-agnostic base for floating, resizable, draggable windows.
 *
 * Owns everything that does not name a title-bar header: the eight resize-handle
 * border strips, the move drag flow, the three-state lifecycle (`"normal"` /
 * `"minimized"` / `"maximized"`), the closeable / minimizable / maximizable
 * *state*, active-focus *state*, z-order, show/hide, the min-size seed
 * *mechanism*, and the open-windows registry. Everything that differs per
 * subclass — how the move gesture is wired, how state reflects into UI, how the
 * title reads, how content is added, how tall the chrome is, and which child is
 * chrome — is delegated to `protected`/`abstract` hooks.
 *
 * Two concrete subclasses extend it: {@link Window} (a `Border` layout with a
 * `WindowHeader`) and `TabWindow` (a headerless `Tab` layout).
 *
 * @category Core
 */
export abstract class AbstractWindow extends Container<WindowOptions> implements DismissableLayer {

    // Own contribution to the hierarchy-aware class tier — see
    // plans/implemented/class-hierarchy-cascade.md.
    protected static readonly ownClassStyleDefaults: StyleBag = _defaultWindowOptions;

    private static openWindows: Set<AbstractWindow> = new Set<AbstractWindow>();

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
    // Lowest / highest top-left coordinate the window has reached during the
    // in-progress move drag, per axis. Seeded to the drag origin in
    // startMoveFrom and ratcheted in clampDragDelta so an off-screen edge can
    // only ever travel back toward the viewport, never further out — even
    // mid-drag after reversing direction.
    private _dragReachMinX: number = 0;
    private _dragReachMaxX: number = 0;
    private _dragReachMinY: number = 0;
    private _dragReachMaxY: number = 0;
    private _contentFactory: (() => Component) | null = null;
    private _contentReadyCallback: ((component: Component) => void) | null = null;

    protected _preMinimizeState:  "normal" | "maximized" = "normal";
    private _restoreRect:       WindowRect | null = null;
    private _normalMinSize:     Size | null = null;
    private _bodyHost:          Component | null = null;

    /** Rail this window minimizes into, or null for the built-in bottom strip. */
    private _rail:              Rail | null = null;
    /** Typed-event fan-out for `"minimize"` / `"restore"` / `"close"`. */
    private _windowListeners:   ListenerBag<WindowEvent> = this.registerListenerBag(new ListenerBag<WindowEvent>());
    private _stateAnimHandle:   Animation.CancelHandle | null = null;

    // In-flight animations, cancelled on teardown so their fallback timers
    // cannot fire against this window's released element handle.
    private _showAnimation:         Animation.CancelHandle | null = null;
    private _materializeAnimation:  Animation.CancelHandle | null = null;
    private _closeAnimation:        Animation.CancelHandle | null = null;
    private _railCollapseAnimation: Animation.CancelHandle | null = null;
    private _railExpandAnimation:   Animation.CancelHandle | null = null;
    private _viewportResizeBound: boolean = false;

    private _snapEnabled:       boolean = false;
    private _snapKeysAttached:  boolean = false;
    private _snapMoveAttached:  boolean = false;
    private _snapTargetBorder:  WindowBorder | null = null;

    private readonly _boundOnDrag: (e: MouseEvent) => Event.ListenerResult = (e: MouseEvent) => this.onDrag(e);
    private readonly _boundOnMouseUp: () => Event.ListenerResult = () => this.onMouseUp();
    private readonly _boundOnResizeEnd: () => Event.ListenerResult = () => this.onResizeEnd();
    private readonly _boundOnSnapKeyDown:   (e: KeyboardEvent) => void = (e) => this.onSnapKeyDown(e);
    private readonly _boundOnSnapKeyUp:     (e: KeyboardEvent) => void = (e) => this.onSnapKeyUp(e);
    private readonly _boundOnSnapMouseMove: (e: MouseEvent)    => void = (e) => this.onSnapMouseMove(e);
    private readonly _boundOnSnapMouseDown: (e: MouseEvent)    => Event.ListenerResult = (e) => this.onSnapMouseDown(e);
    private readonly _boundOnViewportResize: () => void                = () => this.onViewportResize();
    private readonly _boundOnSnapBlur:       () => void                = () => this.clearSnapState();
    private readonly _boundOnBorderResize:   (border: WindowBorder, e: MouseEvent) => void = (border, e) => this.onResize(border, e);
    private readonly _boundOnBringToFront:   () => void                = () => this.bringToFront();
    // Schedules a layout pass on theme change, so every `Text` under this
    // window re-measures lazily against the new theme's metrics — windows
    // are appended to `document.documentElement`, not to `Body`, so they need
    // their own root reflow subscription rather than sharing Body's.
    private readonly _boundOnThemeReflow:    () => void                = () => this.scheduleLayout();

    /**
     * Builds the chrome-agnostic, dereference-free part of a window: the eight
     * resize-border overlays, the hidden-until-shown / layout-containment flags,
     * and the bring-to-front subtree listener. The late state dispatch, the
     * `wireMoveTrigger()` call, and the min-size seed are deferred to
     * `initChrome`, which a subclass calls *after* it has
     * built its chrome — never here, where subclass chrome does not yet exist.
     *
     * @param options - The options bag carrying the window's configuration.
     * @param subclassDefaults - Per-subclass default bag layered over this
     *   class's defaults; subclasses forward their `_defaultXxxOptions`
     *   constant here.
     */
    constructor(options?: WindowOptions, subclassDefaults?: Partial<WindowOptions>) {
        super(options, { ..._defaultWindowOptions, ...(subclassDefaults ?? {}) });

        this.subscribeTheme(this._boundOnThemeReflow);

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

        this._borderComponents.west.on("drag", this._boundOnBorderResize);
        this._borderComponents.northwest.on("drag", this._boundOnBorderResize);
        this._borderComponents.north.on("drag", this._boundOnBorderResize);
        this._borderComponents.northeast.on("drag", this._boundOnBorderResize);
        this._borderComponents.east.on("drag", this._boundOnBorderResize);
        this._borderComponents.southeast.on("drag", this._boundOnBorderResize);
        this._borderComponents.south.on("drag", this._boundOnBorderResize);
        this._borderComponents.southwest.on("drag", this._boundOnBorderResize);

        // Keep the resize handles on top of the window's content (see
        // RESIZE_BORDER_Z_INDEX) so a bar/header that paints over the gutter does
        // not steal their edge/corner hit area.
        for (const border of Object.values(this._borderComponents)) {
            border.setZIndex(RESIZE_BORDER_Z_INDEX);
        }

        this.setVisible(false);
        // Resizable — size containment unsafe; layout containment scopes reflow to the window subtree.
        this.setContain("layout");

        // Focusable as a unit so activation can move keyboard focus to the
        // window (see onActivate / focusSelf). -1 keeps it out of the Tab order
        // — focus is driven programmatically on activation, not by tabbing.
        this.getAria().setTabIndex(-1);

        // Any button brings the window to front — a right-click should raise
        // it before its context menu opens too, not just a left-click.
        Event.addSubtreeListener(this, "mousedown", { button: "any", handler: this._boundOnBringToFront });
    }

    /**
     * Runs the chrome-dependent late setup a subclass cannot do during
     * `super()`: dispatches the state-affecting option flags through the
     * `reflect*` hooks, registers the deferred content factory, installs the
     * move gesture via `wireMoveTrigger`, and seeds the
     * default min size from {@link AbstractWindow.minContentWidthSeed}. The
     * subclass constructor calls this *after* it has built its chrome (so the
     * hooks have something to reflect into), avoiding the class-field
     * super-cascade trap.
     *
     * @param options - The constructor's original options bag, consulted only
     *   to skip the min-size seed when the caller supplied an explicit
     *   `minSize`.
     */
    protected initChrome(options?: WindowOptions): void {
        if (this._options.contentFactory !== undefined) {
            this.setContentFactory(this._options.contentFactory, this._options.onReady);
        }

        // Late-built dispatch for state-affecting flags: these reflect into the
        // subclass chrome (minimizable / maximizable buttons or tools) or
        // trigger a tween (windowState), so they must run after the chrome is
        // built and the geometry fields are initialised.
        // All carry a class default, so dispatch the caller value (stashed in
        // `_options` by `applyOptions`) or the class default — never leave the
        // chrome unbuilt. Minimizable/maximizable reflect rather than re-set:
        // `resizable` can veto the effective value, and routing through
        // setMinimizable/setMaximizable would write that gated value back
        // into `_options`, overwriting the caller's own setting.
        this.setCloseable(this.isCloseable());
        this.reflectMinimizable(this.isMinimizable());
        this.reflectMaximizable(this.isMaximizable());
        this.setResizable(this.isResizable());
        this.setMaximizeBounds(this.getMaximizeBounds());
        this.setWindowState(this.getWindowState());

        this.wireMoveTrigger();

        // Default minSize: enough chrome room for the title content and trailing
        // controls plus a 200 px body floor. Skipped when the caller supplied an
        // explicit `minSize` in the options bag.
        if (options?.minSize === undefined) {
            this.setMinSize({ width: this.minContentWidthSeed(), height: 200 });
        }
    }

    /**
     * Applies a {@link WindowOptions} bag. Inherited Container/Component fields
     * cascade through `super.applyOptions`; `headerText` / `glyph` /
     * `contentFactory` / `onReady` are written pure into `_options` here and
     * dispatched later (from `initChrome`, or — for `glyph` — the subclass
     * constructor) once the chrome and the `contentFactory` field exist. `x`,
     * `y`, `width`, `height` cascade directly through their setters — they write
     * to local fields and skip the DOM until an element exists.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: WindowOptions): this {
        super.applyOptions(options);

        if (options.headerText     !== undefined) this._options.headerText     = options.headerText;
        if (options.glyph          !== undefined) this._options.glyph          = options.glyph;
        if (options.contentFactory !== undefined) this._options.contentFactory = options.contentFactory;
        if (options.onReady        !== undefined) this._options.onReady        = options.onReady;

        // Geometry carries a class default and seeds the window's first render,
        // so always dispatch the caller value or the class default. Resolved
        // inline (not via getX/getWidth) because those getters return the live,
        // post-drag geometry — not the construction-time option default.
        this.setX(options.x ?? this._defaultOptions.x!);
        this.setY(options.y ?? this._defaultOptions.y!);
        this.setWidth(options.width ?? this._defaultOptions.width!);
        this.setHeight(options.height ?? this._defaultOptions.height!);

        // State-affecting flags are written pure into `_options` here (caller
        // value only) and dispatched late from `initChrome`, which folds the
        // class default — the setters need subclass chrome (minimizable /
        // maximizable) or geometry (windowState) which only exist after super.
        if (options.closeable      !== undefined) this._options.closeable      = options.closeable;
        if (options.minimizable    !== undefined) this._options.minimizable    = options.minimizable;
        if (options.maximizable    !== undefined) this._options.maximizable    = options.maximizable;
        if (options.resizable      !== undefined) this._options.resizable      = options.resizable;
        if (options.maximizeBounds !== undefined) this._options.maximizeBounds = options.maximizeBounds;
        if (options.windowState    !== undefined) this._options.windowState    = options.windowState;

        this.setSnapResizeEnabled(options.snapResizeEnabled ?? this.isSnapResizeEnabled());
        this.setSnapThreshold(options.snapThreshold ?? this.getSnapThreshold());
        this.setSnapModifier(options.snapModifier ?? this.getSnapModifier());

        this.setConstrainToViewport(options.constrainToViewport ?? this.isConstrainToViewport());

        return this;
    }

    // ----- subclass hooks (what differs per subclass) -----

    /**
     * Installs the move gesture that lets the user drag the window. The
     * subclass wires the press source (a header's `mousedown`, an empty
     * tab-bar press, …) to {@link AbstractWindow.startMoveFrom}. Called once
     * from `initChrome`.
     */
    protected abstract wireMoveTrigger(): void;

    /**
     * Pushes the closeable state into the subclass UI (a header close button,
     * a control tool, …). Called by the non-virtual {@link AbstractWindow.setCloseable}
     * after the `_options.closeable` write.
     *
     * @param value - True when the window can be closed by the user.
     */
    protected abstract reflectCloseable(value: boolean): void;

    /**
     * Pushes the minimizable state into the subclass UI. Called by the
     * non-virtual {@link AbstractWindow.setMinimizable} after the
     * `_options.minimizable` write.
     *
     * @param value - True when the minimize affordance is shown.
     */
    protected abstract reflectMinimizable(value: boolean): void;

    /**
     * Pushes the maximizable state into the subclass UI. Called by the
     * non-virtual {@link AbstractWindow.setMaximizable} after the
     * `_options.maximizable` write.
     *
     * @param value - True when the maximize affordance is shown.
     */
    protected abstract reflectMaximizable(value: boolean): void;

    /**
     * Reflects a window-state transition into the subclass UI — typically the
     * maximize/restore glyph swap. Called from {@link AbstractWindow.setWindowState}
     * as the state changes.
     *
     * @param state - The state being entered.
     */
    protected abstract reflectMaximizeState(state: WindowState): void;

    /**
     * Paints the active/inactive appearance (e.g. a header gradient). Called
     * from {@link AbstractWindow.onActivate}; the active *state* itself is
     * generic and lives on the base.
     *
     * @param active - True when this window is the active layer.
     */
    protected abstract paintActive(active: boolean): void;

    /**
     * Reads the window's title for serialization and any future title reader.
     * Read-only by design — there is no title *writer* on the base (a derived
     * title, e.g. a tab label, cannot be set).
     *
     * @returns The current title text.
     */
    abstract getTitle(): string;

    /**
     * Returns the min-content-width value seeded into the default min size by
     * `initChrome` (a header's required width, a tab bar's
     * min width, …).
     *
     * @returns The seed width in pixels.
     */
    protected abstract minContentWidthSeed(): number;

    /**
     * Returns the height of the window's title chrome, consulted by the generic
     * viewport-clamp / dock-rect / minimized-stack geometry. Defaulted to `0`;
     * the {@link CHROME_HEIGHT_FLOOR_PX} "before the chrome laid out" floor is
     * applied at each call site, not here. Subclasses override to return their
     * real chrome height.
     *
     * @returns The chrome height in pixels.
     */
    protected chromeHeight(): number {
        return 0;
    }

    /**
     * Returns the window's intrinsic chrome minimum — the smallest outer size
     * that still shows the title chrome (header / control tools / tab strip)
     * without crushing it. Consulted by {@link setWidth} / {@link setHeight} as
     * the resize floor instead of {@link Component.getMinSize}, which folds in
     * the body content's layout-manager minimum. A window is a `Container`
     * ({@link Container.clampsToContentSize} is `false`), so oversized body
     * content overflows rather than inflating the window past this chrome floor.
     *
     * Built from the two chrome seeds the subclasses already expose —
     * {@link minContentWidthSeed} and {@link chromeHeight} — converted from a
     * content-min to an outer-window min by adding the perimeter the body inset
     * folds into the resize-border band (mirroring {@link doLayout}'s
     * outer→inner arithmetic, which adds a single inset side per axis).
     *
     * @returns The chrome-only minimum outer size in pixels.
     */
    protected chromeMinSize(): Size {
        const border = this.getBorderSize();
        const insets = this.getInsets();

        const horizontalChrome = (Number(border.left) || 0) + (Number(border.right)  || 0) + insets.getLeft();
        const verticalChrome   = (Number(border.top)  || 0) + (Number(border.bottom) || 0) + insets.getTop();

        return {
            width:  this.minContentWidthSeed() + horizontalChrome,
            height: (this.chromeHeight() || CHROME_HEIGHT_FLOOR_PX) + verticalChrome,
        };
    }

    /**
     * Adds a content component to the window. The subclass decides how (a
     * `Border` CENTER region, a `Tab` entry, …).
     *
     * @param content - The content component to add.
     */
    protected abstract addContent(content: Component): void;

    /**
     * Reports whether `child` is the window's chrome rather than its content.
     * Used by the generic body-host discovery to skip the chrome. Defaulted to
     * `false` (every child is content); subclasses with a chrome child override.
     *
     * @param _child - The child component to classify.
     * @returns True when `child` is chrome.
     */
    isChromeComponent(_child: Component): boolean {
        return false;
    }

    /**
     * Sets the window width, clamping to the `chromeMinSize` floor so border
     * drags can't shrink the window below the chrome's required width (icon,
     * title budget, control tools). Oversized body content overflows per the
     * `Container` policy rather than holding the window open.
     *
     * @param width - Requested width in pixels.
     *
     * @returns This component, for method chaining.
     *
     * @remarks Clamps to the chrome minimum, NOT `getMinSize` — the latter
     * folds in the layout manager's (body content's) min, which would let a
     * tall/wide child hold the window open and contradicts
     * `Container.clampsToContentSize` being `false`. An explicit consumer
     * `minSize` is still enforced separately by `Component.setWidth`'s private
     * `clampWidth`, so a caller-set floor remains honoured. The clamp is
     * skipped until the window is rendered: `chromeMinSize` consults subclass
     * chrome (the header / strip) that does not exist yet while `applyOptions`
     * cascades `width` during `super()` — the same pre-render window in which
     * the setter already defers its DOM write.
     */
    setWidth(width: number): this {
        if (this.getElement()) {
            const min = this.chromeMinSize();

            if (width < min.width) {
                width = min.width;
            }
        }

        return super.setWidth(width);
    }

    /**
     * Sets the window height, clamping to the `chromeMinSize` floor for the
     * same reason described on {@link setWidth}.
     *
     * @param height - Requested height in pixels.
     *
     * @returns This component, for method chaining.
     */
    setHeight(height: number): this {
        if (this.getElement()) {
            const min = this.chromeMinSize();

            if (height < min.height) {
                height = min.height;
            }
        }

        return super.setHeight(height);
    }

    /**
     * Appends the window element to the document root, triggers layout, and makes it visible.
     *
     * @remarks When a content factory has been registered via
     * {@link AbstractWindow.setContentFactory}, the window opens with a centred
     * `ProgressSpinner` in its content area and the factory is invoked behind
     * a two-rAF yield via [`Animation.materialize`](/api/core/namespaces/Animation/functions/materialize).
     * The entrance scale-in and the spinner pause run concurrently, so by the
     * time the window finishes scaling in the spinner is already on screen.
     */
    show(): this {
        const el = this.getElement(true)!;

        // Join the central layer tree before bringToFront so the manager has
        // a node to re-stamp. A dropdown opened inside the window then
        // registers as the window's child and stacks above it.
        LayerManager.register(this);

        // Trap wheels no inner scroller claimed so they cannot fall through to
        // scrollable content behind the floating window.
        trapWheel(this);

        this.doLayout();
        this.bringToFront();

        AbstractWindow.openWindows.add(this);
        this.attachViewportResizeListener();

        LayerManager.mount(el);

        this.setVisible(true);

        this._showAnimation?.cancel();
        this._showAnimation = Animation.play(el, {
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

            const spinner = createSpinnerWrap();

            this._materializeAnimation?.cancel();
            this._materializeAnimation = Animation.materialize({
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
     * such work before `onReady` would emit `loadingchange: true` before
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
    getLayerElement(): Handle | null {
        return this.getElement() ?? null;
    }

    /**
     * Returns the dismiss mode the document-level handlers consult. A window
     * is never dismissed by an outside interaction, so it stays `"manual"`.
     * Activation (the title-bar highlight) is orthogonal to dismissal — the
     * manager drives it through {@link AbstractWindow.onActivate} for any mode.
     *
     * @returns The layer dismiss mode.
     */
    getDismissMode(): LayerDismissMode {
        return "manual";
    }

    /**
     * Reflects the active state onto the window chrome. The manager calls this
     * with `true` when a pointer / focus interaction lands inside the window
     * (or a layer opened inside it) and `false` when another layer takes over
     * or an empty-viewport click deactivates everything. The active *state* is
     * generic; the paint is delegated to `paintActive`.
     *
     * @param active - True when this window is the active layer.
     */
    onActivate(active: boolean): void {
        this.paintActive(active);

        if (active) {
            this.focusSelf();
            this.emit("activate");
        }
    }

    /**
     * Moves keyboard focus to the window when it is activated, unless focus is
     * already inside it (so a click that lands on a child input keeps that
     * input focused rather than yanking focus up to the window root). Uses
     * `preventScroll` because the window is an absolutely-positioned overlay —
     * a native focus scroll would jolt any `overflow: hidden` ancestor.
     */
    private focusSelf(): void {
        const element = this.getElement();
        if (!element || DOM.source.contains(element, DOM.source.getActiveElement())) {
            return;
        }

        this.focus(true);
    }

    /**
     * Advisory close request from the manager. A window owns its own close
     * affordance, so this routes to the same teardown.
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
        // Notify subscribers (e.g. a Rail) before teardown, so a rail handle
        // representing this window is removed as the window closes.
        this.emit("close");

        if (this._animationFrameId !== null) {
            DOM.sink.cancelAnimationFrame(this._animationFrameId);
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
        untrapWheel(this);

        AbstractWindow.openWindows.delete(this);

        // Re-layout the dock so any sibling minimized windows close any gap
        // this one's removal left behind.
        AbstractWindow.relayoutMinimizedStack();

        const el = this.getElement();
        const finalize = (): void => {
            this.setVisible(false);
            this.destructor();
        };

        if (!el) {
            finalize();
            return;
        }

        this._closeAnimation?.cancel();
        this._closeAnimation = Animation.play(el, {
            to:         { opacity: "0", transform: "scale(0.97)" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["opacity", "transform"],
            onComplete: finalize,
        });
    }

    /**
     * Tears the eight resize-border strips down before the inherited destructor
     * runs. They are appended straight to the window element by `renderContent`
     * rather than registered as child components, so the base destructor's
     * recursion over the child list never reaches them — leaving each strip's
     * per-instance stylesheet rules on the shared sheet for the life of the
     * page, and the sheet growing with every open/close cycle.
     */
    protected destructor(): void {
        // Before `super.destructor()` releases this window's element handle,
        // which every one of these animations' fallback timers would write to.
        this._stateAnimHandle?.cancel();
        this._stateAnimHandle = null;
        this._showAnimation?.cancel();
        this._showAnimation = null;
        this._materializeAnimation?.cancel();
        this._materializeAnimation = null;
        this._closeAnimation?.cancel();
        this._closeAnimation = null;
        this._railCollapseAnimation?.cancel();
        this._railCollapseAnimation = null;
        this._railExpandAnimation?.cancel();
        this._railExpandAnimation = null;

        for (const border of Object.values(this._borderComponents)) {
            border.dispose();
        }

        super.destructor();
    }

    /**
     * Returns the current lifecycle state (`"normal"`, `"minimized"`, or
     * `"maximized"`).
     *
     * @returns The current {@link WindowState}.
     */
    getWindowState(): WindowState {
        return this._options.windowState ?? this._defaultOptions.windowState!;
    }

    /**
     * Returns a snapshot array of every currently-open window. Used by layout
     * serialization to capture the floating-window plane, which is mounted on
     * `document.documentElement` rather than inside any container tree.
     *
     * @returns The open windows, in insertion order.
     */
    static getOpenWindows(): AbstractWindow[] {
        return Array.from(AbstractWindow.openWindows);
    }

    /**
     * Returns the window's current rectangle in viewport pixels. The public form
     * of the internal current-rect read, for layout serialization.
     *
     * @returns The `{ x, y, width, height }` the window currently occupies.
     */
    getRect(): WindowRect {
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
    applyRect(rect: WindowRect): this {
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
    getRestoreRect(): WindowRect | null {
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
     * (see `startMoveFrom` and `onResize` early-returns).
     */
    setWindowState(state: WindowState): this {
        const from = this.getWindowState();
        if (from === state) {
            return this;
        }

        // If a drag is in flight, commit it first so `_restoreRect` captures
        // the post-drag position instead of the stale start position.
        if (this._animationFrameId !== null) {
            DOM.sink.cancelAnimationFrame(this._animationFrameId);
            this._animationFrameId = null;
        }

        this._options.windowState = state;

        // A rail-minimized window is hidden outright (the rail handle is its
        // minimized representation), so re-show it and play the reverse genie —
        // scaling/fading back up out of the rail — before the state branch runs.
        if (from === "minimized" && this._rail !== null) {
            this.setDisplayed(true);
            this.animateRailExpand();
        }

        if (state === "normal") {
            // Restore body visibility BEFORE the tween starts so the
            // animation plays against the body content, not against an
            // empty rect.
            this.setBodyHostDisplayed(true);
            this.reflectMaximizeState("normal");

            const target = this._restoreRect ?? this.currentRect();
            this._restoreRect = null;

            // Idempotent: already bound for a window restoring from a docked
            // minimize, but a rail-minimized window never attached it (hidden
            // while docked, so nothing to clamp) — re-attach here so the
            // restored window resumes tracking viewport resizes.
            this.attachViewportResizeListener();
            this.animateRect(target, () => {
                this.restoreNormalMinSize();
                AbstractWindow.relayoutMinimizedStack();
            });
        } else if (state === "minimized") {
            if (from === "normal") {
                this._restoreRect = this.currentRect();
            }
            this._preMinimizeState = from === "maximized" ? "maximized" : "normal";
            this.reflectMaximizeState("minimized");
            this.detachViewportResizeListener();

            if (this._rail !== null) {
                // Rail-docked: skip the built-in bottom strip. Genie the window
                // — scaling and fading it into the rail's handle corner — then
                // hide it outright and let the rail show its handle (via the
                // deferred "minimize" event). The geometry is left untouched, so
                // the reverse genie on restore replays from the same rect.
                this.animateRailCollapse(() => {
                    this.setDisplayed(false);
                    this.emit("minimize");
                });
            } else {
                // The window's normal-resize min size (e.g. the 200px body floor
                // `initChrome` seeds) is enforced independently of `chromeMinSize`
                // (see `setWidth`/`setHeight`), so it would otherwise stop the dock
                // animation from ever reaching the strip's compact height. Relax it
                // for as long as the window stays docked; `restoreNormalMinSize`
                // reinstates it once a later growth tween actually reaches it — not
                // up front, which would clamp the still-shrunk box back up to the
                // floor via CSS for a visible flicker before the growth catches up.
                // Guarded so an interrupted restore (grow tween cancelled before its
                // own restore ran) doesn't clobber the real floor with the
                // still-relaxed 0x0 it left behind.
                if (this._normalMinSize === null) {
                    this._normalMinSize = this.getMinSizeConstraint();
                }
                this.setMinSize({ width: 0, height: 0 });

                const target = this.computeDockRect();
                this.animateRect(target, () => {
                    this.setBodyHostDisplayed(false);
                    this.attachViewportResizeListener();
                    AbstractWindow.relayoutMinimizedStack();
                });

                this.emit("minimize");
            }
        } else {
            // maximized
            if (from === "normal") {
                this._restoreRect = this.currentRect();
            }
            this.setBodyHostDisplayed(true);
            this.reflectMaximizeState("maximized");

            const target = this.computeMaximizeRect();
            this.animateRect(target, () => {
                this.restoreNormalMinSize();
                this.attachViewportResizeListener();
                AbstractWindow.relayoutMinimizedStack();
            });
        }

        // Notify subscribers (e.g. a Rail) when the window leaves the minimized
        // state. The "minimize" counterpart is emitted from the branch above —
        // deferred to the rail fly-in's completion on the rail path.
        if (from === "minimized" && state !== "minimized") {
            this.emit("restore");
        }

        return this;
    }

    /**
     * Reinstates the normal-resize min size relaxed while docked (see
     * {@link AbstractWindow.setWindowState}'s `"minimized"` branch), once a
     * growth tween away from `"minimized"` has actually reached its target —
     * so the floor is only ever applied when the window's live size is
     * already at or above it. No-ops when nothing is relaxed, which covers
     * both a rail-docked window (geometry, and so this floor, is never
     * touched) and a growth tween that already restored it.
     */
    private restoreNormalMinSize(): void {
        if (this._normalMinSize === null) {
            return;
        }

        this.setMinSize(this._normalMinSize);
        this._normalMinSize = null;
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
    toggleMinimize(): void {
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
     * Minimizes the window. Sugar over `setWindowState("minimized")`.
     *
     * @returns This window, for method chaining.
     */
    minimize(): this {
        return this.setWindowState("minimized");
    }

    /**
     * Restores the window from a minimized state to whatever it was before
     * (`"normal"` or `"maximized"`) and brings it to the front so it becomes
     * the active, focused window. No-op when the window is not minimized.
     *
     * @remarks Restoring is typically driven from a rail handle — a click
     * outside the window, which never activates it on its own. The window also
     * usually stays the layer manager's active layer while minimized (nothing
     * else took over), so `bringToFront` is an activation no-op and `onActivate`
     * never re-fires. Both the raise and the keyboard focus are therefore made
     * explicit here.
     *
     * @returns This window, for method chaining.
     */
    restore(): this {
        if (!this.isMinimized()) {
            return this;
        }

        this.setWindowState(this._preMinimizeState);
        this.bringToFront();
        this.focus(true);

        return this;
    }

    /**
     * Attaches a {@link Rail} this window minimizes into, replacing the built-in
     * bottom-of-viewport dock strip: while minimized the window is hidden and
     * represented by a handle on the rail that restores it on click. Pass `null`
     * to detach and fall back to the built-in strip. The rail subscribes to the
     * window's minimize / restore / close events.
     *
     * @param rail - The rail to minimize into, or `null` to detach.
     *
     * @returns This window, for method chaining.
     */
    setRail(rail: Rail | null): this {
        if (this._rail === rail) {
            return this;
        }

        if (this._rail !== null) {
            this._rail.unregisterWindow(this);
        }

        this._rail = rail;

        if (rail !== null) {
            rail.registerWindow(this);
        }

        return this;
    }

    /**
     * Returns the rail this window minimizes into, or `null` when it uses the
     * built-in bottom dock strip.
     *
     * @returns The attached rail, or `null`.
     */
    getRail(): Rail | null {
        return this._rail;
    }

    /**
     * Returns the window's leading glyph, or `undefined` when none was set. Read
     * by a {@link Rail} to label the handle for a window minimized into it.
     *
     * @returns The glyph name, or `undefined`.
     */
    getGlyph(): string | undefined {
        return this._options.glyph;
    }

    /**
     * Registers a listener for one of the window's lifecycle events.
     *
     * @param event - `"minimize"` / `"restore"` / `"close"` / `"activate"`.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This window, for method chaining.
     */
    on(event: WindowEvent, listener: () => void): this {
        this._windowListeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener. The exact callback reference
     * must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This window, for method chaining.
     */
    off(event: WindowEvent, listener: () => void): this {
        this._windowListeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     */
    protected emit(event: WindowEvent): void {
        this._windowListeners.fire(event);
    }

    /**
     * Toggles between `"normal"` and `"maximized"`. No-ops when the window is
     * not maximizable.
     */
    toggleMaximize(): void {
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
     * Enables or disables the close affordance. When disabled the window can no
     * longer be torn down by the user — only programmatically via
     * {@link requestClose} — so its content cannot be destroyed by a stray
     * click. Minimize / maximize are unaffected. Stores the state and reflects
     * it into the subclass UI via `reflectCloseable`.
     *
     * @param value - True to enable the close affordance.
     *
     * @returns This window, for method chaining.
     */
    setCloseable(value: boolean): this {
        this._options.closeable = value;
        this.reflectCloseable(value);

        return this;
    }

    /**
     * Returns whether the close affordance is enabled.
     *
     * @returns True when the close affordance is enabled.
     */
    isCloseable(): boolean {
        return this._options.closeable ?? this._defaultOptions.closeable!;
    }

    /**
     * Toggles whether the minimize affordance is shown. Stores the caller's
     * own value and reflects the *effective* value via `reflectMinimizable`:
     * when the window is not resizable the affordance stays hidden regardless
     * of `value`, but `value` is remembered and takes effect again once
     * `resizable` is re-enabled.
     *
     * @param value - True to show the minimize affordance.
     *
     * @returns This window, for method chaining.
     */
    setMinimizable(value: boolean): this {
        this._options.minimizable = value;
        this.reflectMinimizable(this.isMinimizable());

        return this;
    }

    /**
     * Returns whether the minimize affordance is shown. `false` whenever the
     * window is not resizable, regardless of the `minimizable` option.
     *
     * @returns True when the minimize affordance is shown.
     */
    isMinimizable(): boolean {
        return this.isResizable() && (this._options.minimizable ?? this._defaultOptions.minimizable!);
    }

    /**
     * Toggles whether the maximize affordance is shown. Stores the caller's
     * own value and reflects the *effective* value via `reflectMaximizable`:
     * when the window is not resizable the affordance stays hidden regardless
     * of `value`, but `value` is remembered and takes effect again once
     * `resizable` is re-enabled.
     *
     * @param value - True to show the maximize affordance.
     *
     * @returns This window, for method chaining.
     */
    setMaximizable(value: boolean): this {
        this._options.maximizable = value;
        this.reflectMaximizable(this.isMaximizable());

        return this;
    }

    /**
     * Returns whether the maximize affordance is shown. `false` whenever the
     * window is not resizable, regardless of the `maximizable` option.
     *
     * @returns True when the maximize affordance is shown.
     */
    isMaximizable(): boolean {
        return this.isResizable() && (this._options.maximizable ?? this._defaultOptions.maximizable!);
    }

    /**
     * Toggles the drag-to-resize border strips. Disabling hides all eight
     * strips (no cursor, no hit test) and disarms any in-progress snap-resize
     * session; moving is unaffected, but disabling also hides the minimize
     * and maximize affordances and blocks `toggleMinimize` / `toggleMaximize`
     * — `resizable` is the master switch for both, see `isMinimizable` /
     * `isMaximizable`.
     *
     * @param value - True to show and arm the resize border strips, false to
     *   hide and disarm them.
     *
     * @returns This window, for method chaining.
     */
    setResizable(value: boolean): this {
        this._options.resizable = value;

        // Hidden strips take no cursor and no hit test, so a non-resizable
        // edge shows the ordinary pointer instead of a resize cursor that
        // silently does nothing. `null` (inherit), not `true`, on the restore
        // branch — an explicit `visible: true` would override the window's
        // own hidden state while it is still being constructed (`setVisible`
        // is called with `false` before `show()` reveals it).
        for (const border of Object.values(this._borderComponents)) {
            border.setVisible(value ? null : false);
        }

        // Disarm a snap session that armed while the window was still resizable.
        if (!value) {
            this.clearSnapState();
        }

        // `resizable` supersedes minimizable/maximizable, so both affordances
        // re-reflect against their effective value. Straight to the reflect
        // hooks: setMinimizable/setMaximizable would write the gated value
        // into `_options` and destroy the caller's own setting.
        this.reflectMinimizable(this.isMinimizable());
        this.reflectMaximizable(this.isMaximizable());

        return this;
    }

    /**
     * Returns whether the drag-to-resize border strips are enabled.
     *
     * @returns True when the resize border strips are shown and active.
     */
    isResizable(): boolean {
        return this._options.resizable ?? this._defaultOptions.resizable!;
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
        return this._options.maximizeBounds ?? this._defaultOptions.maximizeBounds!;
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
        return this._options.snapResizeEnabled ?? this._defaultOptions.snapResizeEnabled!;
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
        return this._options.constrainToViewport ?? this._defaultOptions.constrainToViewport!;
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
        return this._options.snapThreshold ?? this._defaultOptions.snapThreshold!;
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
        return this._options.snapModifier ?? this._defaultOptions.snapModifier!;
    }

    /**
     * Handles a window-move press by delegating to {@link AbstractWindow.startMoveFrom}.
     * Wired by each subclass's `wireMoveTrigger` to the
     * appropriate press source.
     *
     * @param e - The mousedown event whose pointer coordinate anchors the drag.
     */
    onMouseDown(e: MouseEvent): void {
        this.startMoveFrom(e);
    }

    /**
     * Begins a window move from a press anywhere a subclass routes here.
     * Snapshots the start position and pointer origin, pre-promotes a
     * compositor layer, and registers the viewport move/up listeners. No-ops
     * for a Shift-modified press (reserved for re-dock gestures) or when the
     * window is not in the `"normal"` state.
     *
     * @param e - The mousedown event whose pointer coordinate anchors the drag.
     *
     * @remarks The event argument is required — `e.clientX`/`e.clientY` seed the
     * absolute-pointer drag origin read by `onDrag`.
     */
    startMoveFrom(e: MouseEvent): void {
        // Primary button only — a right- or middle-click mousedown on the
        // header must not start a window move, mirroring DragManager's own
        // button gate on every other drag source.
        if (!Event.isPrimaryButton(e)) {
            return;
        }

        // Shift+drag is a re-dock gesture (handled by a subclass drag source),
        // not a window move — don't start the move. (Ctrl is left free for the
        // snap-resize affordance.)
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

        // Seed the per-axis reach ratchet at the start position so the first
        // frame's allowed range spans the origin (no snap on grab) and tightens
        // from there.
        this._dragReachMinX = this._dragStartLeft;
        this._dragReachMaxX = this._dragStartLeft;
        this._dragReachMinY = this._dragStartTop;
        this._dragReachMaxY = this._dragStartTop;

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
    onResize(border: WindowBorder, e: MouseEvent): void {
        if (!this.isResizable()) {
            return;
        }

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
            this._animationFrameId = DOM.sink.requestAnimationFrame((ts) => this.flushResize(ts));
        }
    }

    /**
     * Clears the resize-session origin capture when a border drag ends, so the
     * next drag re-captures a fresh origin. Detaches the viewport listeners it
     * was registered with.
     *
     * @returns `true`, consuming the release that ends the border resize.
     */
    private onResizeEnd(): Event.ListenerResult {
        this._resizeSessionActive = false;

        Event.removeViewportListener(this, 'mouseup',     this._boundOnResizeEnd);
        Event.removeViewportListener(this, 'touchend',    this._boundOnResizeEnd);
        Event.removeViewportListener(this, 'touchcancel', this._boundOnResizeEnd);

        return true;
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
     *
     * @returns This window, for method chaining.
     */
    setResizeFps(fps: number): this {
        this._resizeFps = fps;

        return this;
    }

    /**
     * Commits a throttled resize frame: derives the new geometry from the
     * captured origin and pointer offset, clamps it to the viewport edge, and
     * lays out. Re-schedules itself when called inside the per-frame interval.
     *
     * @param timestamp - The rAF timestamp for this frame.
     */
    private flushResize(timestamp: number): void {
        if (timestamp - this._lastFlushTime < 1000 / this._resizeFps) {
            this._animationFrameId = DOM.sink.requestAnimationFrame((ts) => this.flushResize(ts));
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
        const vp             = DOM.source.getViewportSize();
        const eastWidthCap   = vp.width  - this._resizeOriginX;
        const westWidthCap   = originRight;
        const southHeightCap = vp.height - this._resizeOriginY;
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
     * The min/max top-left position that keeps the window inside the viewport,
     * honouring {@link isConstrainToViewport} (whole window in view) or the
     * header-reachable fallback (at least an `EDGE_MARGIN_PX` strip and the full
     * chrome band visible). Shared by drag clamping and {@link clampPositionToViewport}.
     *
     * @returns The position bounds in viewport pixels.
     */
    private viewportPositionBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
        const w  = this.getWidth();
        const vp = DOM.source.getViewportSize();
        const vw = vp.width;
        const vh = vp.height;

        if (this.isConstrainToViewport()) {
            // Whole window inside the viewport: every border stops at the edge.
            return { minX: 0, maxX: vw - w, minY: 0, maxY: vh - this.getHeight() };
        }

        // Header-reachable fallback: keep at least an EDGE_MARGIN_PX strip visible
        // horizontally and the whole chrome band visible vertically. The
        // CHROME_HEIGHT_FLOOR_PX floor covers the pre-layout window before the
        // chrome has measured a real height.
        const headerH = this.chromeHeight() || CHROME_HEIGHT_FLOOR_PX;

        return { minX: EDGE_MARGIN_PX - w, maxX: vw - EDGE_MARGIN_PX, minY: 0, maxY: vh - headerH };
    }

    /**
     * Clamps the pending drag delta so the window's top-left stays within
     * {@link viewportPositionBounds}. Mutates `_dragDX`/`_dragDY` in place so
     * both the live translate and the `onMouseUp` commit read the clamped
     * values from one chokepoint.
     */
    private clampDragDelta(): void {
        const { minX, maxX, minY, maxY } = this.viewportPositionBounds();

        // A window can start beyond a bound — larger than the viewport, or
        // opened with an edge off-screen. A plain [min, max] clamp would snap it
        // back to the bound on grab, jerking it from under the cursor. Instead
        // ratchet the allowed range from the reach extremes: the far end follows
        // the window as it travels toward the viewport (`max(maxBound, reachMin)`
        // floored at the real bound) so an off-screen edge can move in but never
        // back out — disallowing southward/eastward travel for as long as that
        // edge stays outside, even after reversing mid-drag. Symmetric on the
        // near end. For a window that started in-bounds the reach extremes sit
        // within [min, max], so this collapses to the plain clamp.
        const hiX = Math.max(maxX, this._dragReachMinX);
        const loX = Math.min(minX, this._dragReachMaxX);
        const hiY = Math.max(maxY, this._dragReachMinY);
        const loY = Math.min(minY, this._dragReachMaxY);

        const targetX = this._dragStartLeft + this._dragDX;
        const targetY = this._dragStartTop  + this._dragDY;

        const clampedX = Util.clamp(targetX, loX, hiX);
        const clampedY = Util.clamp(targetY, loY, hiY);

        // Record the new reach so the next frame's range can only tighten.
        this._dragReachMinX = Math.min(this._dragReachMinX, clampedX);
        this._dragReachMaxX = Math.max(this._dragReachMaxX, clampedX);
        this._dragReachMinY = Math.min(this._dragReachMinY, clampedY);
        this._dragReachMaxY = Math.max(this._dragReachMaxY, clampedY);

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

        // High-first clamp (not Util.clamp): when the window is larger than the
        // viewport, maxX < minX, and this must pin the leading edge on-screen
        // (yield minX) rather than the low-first form's trailing edge (maxX).
        this.setX(Math.max(Math.min(this.getX(), maxX), minX));
        this.setY(Math.max(Math.min(this.getY(), maxY), minY));

        return this;
    }

    /**
     * Moves the window to follow the pointer while dragging.
     *
     * @param e - The mouse event carrying the absolute pointer coordinate.
     * @returns `{ stop: true, prevent: true }`, consuming the move and suppressing the browser's default text selection while dragging.
     */
    onDrag(e: MouseEvent): Event.ListenerResult {
        // Derive the delta from the absolute pointer offset (not accumulated movementX)
        // so clampDragDelta's writeback can't drift: when the window is pinned at an edge
        // the over-travel is absorbed and the window re-attaches to the cursor on reverse.
        this._dragDX = e.clientX - this._dragOriginClientX;
        this._dragDY = e.clientY - this._dragOriginClientY;

        this.clampDragDelta();

        // Compositor-only translate during drag; the cached left/top stay at the start
        // position so the field-DOM invariant holds (left === style.left throughout).
        this.setTranslate(this._dragDX, this._dragDY);

        return { stop: true, prevent: true };
    }

    /**
     * Detaches the document-level drag listeners when the mouse button is released.
     *
     * @returns `true`, consuming the release that ends the window drag.
     */
    onMouseUp(): Event.ListenerResult {
        // Commit the in-progress translate back to left/top so subsequent layout passes
        // operate from the new position. setTranslate(0, 0) frees the compositor layer.
        this.setX(this._dragStartLeft + this._dragDX);
        this.setY(this._dragStartTop  + this._dragDY);
        this.setTranslate(0, 0);
        this.setWillChange(null);

        Event.removeViewportListener(this, 'mouseup', this._boundOnMouseUp);
        Event.removeViewportListener(this, 'mousemove', this._boundOnDrag);

        return true;
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
    render(): Handle {
        let element = super.render();

        DOM.sink.appendChild(element, this._borderComponents.west.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.northwest.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.north.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.northeast.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.east.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.southeast.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.south.getElement(true)!);
        DOM.sink.appendChild(element, this._borderComponents.southwest.getElement(true)!);

        return element;
    }

    // ----- state-transition helpers -----

    /**
     * Returns the window's current rect from its live geometry fields.
     *
     * @returns The current `{ x, y, width, height }`.
     */
    private currentRect(): WindowRect {
        return {
            x:      this.getX(),
            y:      this.getY(),
            width:  this.getWidth(),
            height: this.getHeight(),
        };
    }

    /**
     * Returns the first non-chrome child component, if any. Used to hide the
     * body while minimized so the docked strip shows only the title bar.
     *
     * @returns The body host component, or `null`.
     */
    protected findBodyHost(): Component | null {
        const children = this.getComponents();
        for (const child of children) {
            if (!this.isChromeComponent(child)) {
                return child;
            }
        }
        return null;
    }

    /**
     * Shows or hides the window's body host, finding it lazily on first use.
     *
     * @param displayed - True to show the body, false to hide it.
     */
    private setBodyHostDisplayed(displayed: boolean): void {
        if (!this._bodyHost) {
            this._bodyHost = this.findBodyHost();
        }
        if (this._bodyHost) {
            this._bodyHost.setDisplayed(displayed);
        }
    }

    /**
     * Computes the rect the window fills when maximized — the parent rect for
     * `"parent"` bounds, otherwise the full viewport.
     *
     * @returns The maximize target rect.
     */
    private computeMaximizeRect(): WindowRect {
        if (this.getMaximizeBounds() === "parent") {
            const el = this.getElement();
            const parent = el ? DOM.source.getParentElement(el) : null;
            if (parent && parent !== DOM.source.getDocumentElement()) {
                const r = DOM.source.getElementRect(parent);
                return { x: 0, y: 0, width: r.width, height: r.height };
            }
        }

        const vp = DOM.source.getViewportSize();

        return {
            x:      0,
            y:      0,
            width:  vp.width,
            height: vp.height,
        };
    }

    /**
     * Computes the docked rect for a minimized window — a chrome-height slab
     * along the bottom of the viewport, in the window's dock slot.
     *
     * @returns The minimized dock rect.
     */
    private computeDockRect(): WindowRect {
        const dockWidth = this.getMinDockWidth();
        const slotIndex = this.computeDockSlotIndex();
        const headerHeight = this.chromeHeight() || CHROME_HEIGHT_FLOOR_PX;
        const x = slotIndex * (dockWidth + SNAP_DOCK_GAP_PX);
        const y = DOM.source.getViewportSize().height - headerHeight;

        return { x, y, width: dockWidth, height: headerHeight };
    }

    /**
     * Builds the genie `transform` that collapses the window into its own rail
     * handle: it translates the window onto the rail edge (cross-axis) centred
     * along the handle's length (main-axis, from `Rail.handleMainAxisOffset` and
     * `Rail.handleMainAxisExtent`) and scales it down to roughly the rail
     * thickness, so the window appears to shrink into its own spot in the handle
     * stack. Paired with `transform-origin: 0 0` and an opacity fade by the
     * collapse/expand animations. Assumes a rail is attached.
     *
     * @returns A `translate(...) scale(...)` CSS transform value.
     */
    private railGenieTransform(): string {
        const rail       = this._rail as Rail;
        const thickness  = rail.getThickness();
        const cur        = this.currentRect();
        // Shrink to roughly the rail's thickness — clamped so an already-narrow
        // window still visibly collapses rather than scaling up.
        const scale      = Math.min(0.5, thickness / Math.max(cur.width, 1));

        // Centre the shrunken window along its handle's length rather than
        // pinning its leading corner to the slot: aim the window's own centre at
        // the handle's centre (offset + half the handle) by pulling the corner
        // back half the scaled window. When no handle can be measured or
        // predicted (the first minimise into an empty rail) the length is 0 and
        // the window stays at the slot's leading edge. The cross axis is left
        // alone — the scaled window already fits the thickness.
        const edge         = rail.getEdge();
        const vertical     = edge === Placement.EAST || edge === Placement.WEST;
        const mainOffset   = rail.handleMainAxisOffset(this);
        const handleExtent = rail.handleMainAxisExtent(this);
        const scaledMain   = (vertical ? cur.height : cur.width) * scale;
        const mainTarget   = handleExtent > 0
            ? mainOffset + (handleExtent - scaledMain) / 2
            : mainOffset;

        // Each edge sets its main axis to the centred target and its cross axis to
        // the rail edge; the two initialise to 0 so the axis an edge leaves
        // untouched keeps the correct cross value (0 is the top/left edge for
        // WEST/NORTH).
        let targetX = 0;
        let targetY = 0;

        switch (edge) {
            case Placement.EAST:
                targetX = DOM.source.getViewportSize().width - thickness;
                targetY = mainTarget;

                break;

            case Placement.WEST:
                targetY = mainTarget;

                break;

            case Placement.SOUTH:
                targetX = mainTarget;
                targetY = DOM.source.getViewportSize().height - thickness;

                break;

            case Placement.NORTH:
                targetX = mainTarget;

                break;

            default:
                targetY = mainTarget;

                break;
        }

        const tx = targetX - cur.x;
        const ty = targetY - cur.y;

        return `translate(${tx}px, ${ty}px) scale(${scale})`;
    }

    /**
     * Plays the minimize genie: scales and fades the window into its rail's
     * handle corner over `WINDOW_ANIM_DURATION_MS`, then runs `onDone` (which
     * hides the window and lets the rail show its handle). Honours
     * `prefers-reduced-motion` via {@link Animation.play}.
     *
     * @param onDone - Callback fired once the collapse completes.
     */
    private animateRailCollapse(onDone: () => void): void {
        const element = this.getElement();

        if (!element) {
            onDone();

            return;
        }

        this._railCollapseAnimation?.cancel();
        this._railCollapseAnimation = Animation.play(element, {
            from:       { transformOrigin: "0 0", transform: "translate(0, 0) scale(1)", opacity: "1" },
            to:         { transform: this.railGenieTransform(), opacity: "0" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["transform", "opacity"],
            onComplete: onDone,
        });
    }

    /**
     * Plays the reverse genie on restore: scales and fades the window back up
     * out of its rail's handle corner to its resting rect. The geometry never
     * moved while minimized, so this replays from the same collapsed transform.
     */
    private animateRailExpand(): void {
        const element = this.getElement();

        if (!element) {
            return;
        }

        this._railExpandAnimation?.cancel();
        this._railExpandAnimation = Animation.play(element, {
            from:       { transformOrigin: "0 0", transform: this.railGenieTransform(), opacity: "0" },
            to:         { transform: "translate(0, 0) scale(1)", opacity: "1" },
            durationMs: WINDOW_ANIM_DURATION_MS,
            properties: ["transform", "opacity"],
        });
    }

    /**
     * Returns the per-slot width of the minimized dock, read from the
     * `--ts-ui-window-min-dock-width` CSS variable with a built-in fallback.
     *
     * @returns The dock slot width in pixels.
     */
    private getMinDockWidth(): number {
        const cssVar = DOM.source.getThemeVar("--ts-ui-window-min-dock-width");
        if (cssVar) {
            const parsed = parseFloat(cssVar);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }

        return DEFAULT_MIN_DOCK_WIDTH_PX;
    }

    /**
     * Returns this window's slot index in the minimized dock — the count of
     * minimized windows ahead of it in the open-windows order.
     *
     * @returns The zero-based dock slot index.
     */
    private computeDockSlotIndex(): number {
        let index = 0;
        for (const win of AbstractWindow.openWindows) {
            if (win === this) {
                return index;
            }
            if (win.getWindowState() === "minimized") {
                index++;
            }
        }
        return index;
    }

    /**
     * Re-positions every minimized window into a gap-free row along the bottom
     * of the viewport. Run after any change to the open/minimized set.
     */
    private static relayoutMinimizedStack(): void {
        let index = 0;
        for (const win of AbstractWindow.openWindows) {
            if (win.getWindowState() !== "minimized") {
                continue;
            }
            const dockWidth   = win.getMinDockWidth();
            const headerHeight = win.chromeHeight() || CHROME_HEIGHT_FLOOR_PX;
            const x = index * (dockWidth + SNAP_DOCK_GAP_PX);
            const y = DOM.source.getViewportSize().height - headerHeight;

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
     *
     * @param target - The rect to tween to.
     * @param onDone - Optional callback fired once the tween completes.
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

    // ----- viewport-resize handling -----

    /**
     * Attaches the viewport-resize listener that keeps a maximized window
     * filling the viewport, re-anchors a docked-minimized window's stack to
     * the bottom-left corner, or refits a normal window back on-screen.
     * Bound for the life of the window from {@link show}; idempotent.
     */
    private attachViewportResizeListener(): void {
        if (this._viewportResizeBound) {
            return;
        }

        Event.addViewportListener(this, "resize", this._boundOnViewportResize);
        this._viewportResizeBound = true;
    }

    /**
     * Detaches the viewport-resize listener. Idempotent.
     */
    private detachViewportResizeListener(): void {
        if (!this._viewportResizeBound) {
            return;
        }

        Event.removeViewportListener(this, "resize", this._boundOnViewportResize);
        this._viewportResizeBound = false;
    }

    /**
     * Re-fills the viewport when the browser window resizes while this window
     * is maximized, re-anchors the whole minimized stack to the viewport's
     * new bottom-left corner when this window is docked-minimized, or refits
     * the window inside the viewport (see {@link fitNormalWindowToViewport})
     * when it is in the normal state — so shrinking the viewport can never
     * strand a window's header out of reach.
     */
    private onViewportResize(): void {
        const state = this.getWindowState();

        if (state === "minimized") {
            AbstractWindow.relayoutMinimizedStack();

            return;
        }

        if (state === "normal") {
            this.fitNormalWindowToViewport();

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

        AbstractWindow.relayoutMinimizedStack();
    }

    /**
     * Refits a normal-state window inside the viewport shrunk by
     * {@link VIEWPORT_RESIZE_MARGIN_PX} on every side, after a viewport resize.
     * Shrinks the window down to that margin — never below its own min-size —
     * when it no longer fits, then repositions it so every edge keeps the
     * margin's clearance. When the window's min-size itself exceeds the
     * margin-shrunk viewport, it is pinned {@link VIEWPORT_RESIZE_MARGIN_PX}
     * from the top-left corner and left to spill past the bottom/right edge
     * rather than forced below its floor.
     */
    private fitNormalWindowToViewport(): void {
        const vp          = DOM.source.getViewportSize();
        const availWidth  = Math.max(0, vp.width  - 2 * VIEWPORT_RESIZE_MARGIN_PX);
        const availHeight = Math.max(0, vp.height - 2 * VIEWPORT_RESIZE_MARGIN_PX);

        this.setAutoCommitStyle(false);

        // Only ever shrinks — a window already inside the margin keeps its
        // size. setWidth/setHeight clamp back up to the window's real
        // min-size on their own, so a margin narrower/shorter than that floor
        // still leaves the window at its min-size rather than forcing it down.
        this.setWidth(Math.min(this.getWidth(), availWidth));
        this.setHeight(Math.min(this.getHeight(), availHeight));

        const width  = this.getWidth();
        const height = this.getHeight();
        const maxX   = vp.width  - VIEWPORT_RESIZE_MARGIN_PX - width;
        const maxY   = vp.height - VIEWPORT_RESIZE_MARGIN_PX - height;

        // High-first clamp (not Util.clamp): when the min-size exceeds the
        // margin-shrunk viewport, maxX/maxY fall below the margin, and this
        // must pin the window to the margin (spilling past the far edge)
        // rather than the low-first form's off-screen trailing edge.
        this.setX(Math.max(Math.min(this.getX(), maxX), VIEWPORT_RESIZE_MARGIN_PX));
        this.setY(Math.max(Math.min(this.getY(), maxY), VIEWPORT_RESIZE_MARGIN_PX));

        this.doLayout();
        this.setAutoCommitStyle(true);
    }

    // ----- snap-resize listeners -----

    /**
     * Attaches the keyboard listeners that arm the snap-resize affordance.
     * Idempotent.
     */
    private attachSnapKeyboardListeners(): void {
        if (this._snapKeysAttached) {
            return;
        }

        Event.addViewportListener(this, "keydown", this._boundOnSnapKeyDown);
        Event.addViewportListener(this, "keyup",   this._boundOnSnapKeyUp);
        Event.addViewportListener(this, "blur",    this._boundOnSnapBlur);
        this._snapKeysAttached = true;
    }

    /**
     * Detaches the snap-resize keyboard listeners. Idempotent.
     */
    private detachSnapKeyboardListeners(): void {
        if (!this._snapKeysAttached) {
            return;
        }

        Event.removeViewportListener(this, "keydown", this._boundOnSnapKeyDown);
        Event.removeViewportListener(this, "keyup",   this._boundOnSnapKeyUp);
        Event.removeViewportListener(this, "blur",    this._boundOnSnapBlur);
        this._snapKeysAttached = false;
    }

    /**
     * Attaches the mouse listeners that track the snap-target border while the
     * modifier is held. Idempotent.
     */
    private attachSnapMouseListeners(): void {
        if (this._snapMoveAttached) {
            return;
        }

        Event.addViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
        Event.addViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
        this._snapMoveAttached = true;
    }

    /**
     * Detaches the snap-resize mouse listeners. Idempotent.
     */
    private detachSnapMouseListeners(): void {
        if (!this._snapMoveAttached) {
            return;
        }

        Event.removeViewportListener(this, "mousemove", this._boundOnSnapMouseMove);
        Event.removeViewportListener(this, "mousedown", this._boundOnSnapMouseDown);
        this._snapMoveAttached = false;
    }

    /**
     * Clears any highlighted snap-target border.
     */
    private clearSnapTargetBorder(): void {
        if (this._snapTargetBorder) {
            this._snapTargetBorder.setSnapTarget(false);
            this._snapTargetBorder = null;
        }
    }

    /**
     * Tears down the whole snap-resize session — disarms it, detaches the mouse
     * listeners, and clears the target border.
     */
    private clearSnapState(): void {
        this._snapEnabled = false;
        this.detachSnapMouseListeners();
        this.clearSnapTargetBorder();
    }

    /**
     * Arms snap detection when the watched modifier goes down while the window
     * is resizable, normal, and snap-resize is enabled.
     *
     * @param e - The keydown event.
     */
    private onSnapKeyDown(e: KeyboardEvent): void {
        if (!this.isResizable()) {
            return;
        }

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

    /**
     * Disarms snap detection when the watched modifier is released.
     *
     * @param e - The keyup event.
     */
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

    /**
     * Returns whether the configured snap modifier is active in `e`.
     *
     * @param e - The keyboard event to inspect.
     * @returns True when the watched modifier is held.
     */
    private modifierMatches(e: KeyboardEvent): boolean {
        switch (this.getSnapModifier()) {
            case "ctrl":  return e.ctrlKey;
            case "meta":  return e.metaKey;
            case "alt":   return e.altKey;
            case "shift": return e.shiftKey;
        }
    }

    /**
     * Returns whether the watched snap modifier is still held in `e`.
     *
     * @param e - The keyboard event to inspect.
     * @returns True when the watched modifier remains active.
     */
    private modifierStillHeld(e: KeyboardEvent): boolean {
        return this.modifierMatches(e);
    }

    /**
     * Tracks the nearest border under the cursor while snap is armed, updating
     * the highlighted snap-target border.
     *
     * @param e - The mousemove event.
     */
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

    /**
     * Picks the closest border strip to a cursor point within the snap
     * threshold, preferring corners over edges on ties.
     *
     * @param cx - Cursor x in viewport pixels.
     * @param cy - Cursor y in viewport pixels.
     * @returns The nearest border within threshold, or `null`.
     */
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
            const rect = DOM.source.getElementRect(el);
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

    /**
     * Forwards a press near (but outside) the highlighted snap-target border
     * into that border's own drag flow.
     *
     * @param e - The mousedown event.
     * @returns `true` when the press starts a snap drag; nothing when it does not, so the event keeps propagating.
     */
    private onSnapMouseDown(e: MouseEvent): Event.ListenerResult {
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
        if (targetEl && DOM.source.isNode(e.target) && DOM.source.contains(targetEl, DOM.source.intern(e.target))) {
            this._snapTargetBorder = null;
            return;
        }

        // Forward into the border's own drag flow. The snap-target highlight
        // is cleared in the matching onDragStop hook the border owns.
        target.onDragStart(e);
        this._snapTargetBorder = null;

        return true;
    }
}
