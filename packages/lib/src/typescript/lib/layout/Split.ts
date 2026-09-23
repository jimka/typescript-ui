// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { LayoutManager, LayoutManagerOptions, ResolvedPlacement } from "~/layout/LayoutManager.js";
import { SplitGutter } from "~/component/container/SplitGutter.js";
import { CollapseDirection, CollapseTrigger } from "~/component/container/CollapseButton.js";
import { Component } from "~/core/Component.js";
import { Util } from "~/core/Util.js";
import { FillType } from "~/layout/FillType.js";
import { Size, UNBOUNDED } from "~/primitive/Size.js";
import { COLLAPSE_STRIP_SIZE, runCollapse, commitRect, CollapseParticipant, CollapseTransition } from "~/layout/CollapseSupport.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { FocusReveal } from "~/core/FocusReveal.js";
import type { FocusRevealer } from "~/core/FocusReveal.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { LayoutSize, LayoutSizeUnit, toLayoutSizes, fromLayoutSizes, isRestorableSizes, normalizeRatios } from "~/layout/LayoutSizes.js";
import type { AxisOrientation } from "~/primitive/Axis.js";
import { Menu } from "~/overlay/Menu.js";
import { MenuItemConfig } from "~/component/container/MenuItem.js";
import { CheckboxMenuRow } from "~/component/container/CheckboxMenuRow.js";
import { RadioMenuRow } from "~/component/container/RadioMenuRow.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { ResizeDrag, gutterOutline, rectOf, getAppResizeMode, IN_PAGE_OUTLINE_Z_INDEX } from "~/core/ResizeDrag.js";
import type { OutlineRect, ResizeMode } from "~/core/ResizeDrag.js";

// Pixel thickness of a single draggable gutter. The main-axis sizing math
// subtracts the gutters' combined footprint before dividing space among
// panes, so this constant is the single source of truth for both the size
// reservation and the gutter placement in `doLayout`.
const GUTTER_SIZE = 4;

// Extra px a movable gutter's real hit box extends past its GUTTER_SIZE
// visual footprint on each side (so its total hit width is GUTTER_SIZE +
// 2 × GUTTER_HIT_OVERHANG = 10px). Chosen to match CollapseButton's own
// GRIP_ACROSS (10px) — see SplitGutter.ts's `.hover` state.
const GUTTER_HIT_OVERHANG = 3;

// Probe weight for the refill's resize-pin test. Any positive value works: it
// exists only so a pane with *no* weight set resolves through
// `effectiveResizeWeight`'s fallback to a non-zero weight and stays flexible,
// which leaves `=== 0` meaning an explicit pin (`setPaneResizeWeight(pane, 0)`
// or a `weight: 0` constraint). A `0` probe here would pin every unset pane.
const WEIGHT_UNSET_PROBE = 1;

/**
 * String-literal union of the events emitted by {@link Split}.
 *
 * @category Layouts
 */
export type SplitEvent = "paneresize" | "panecollapse";

/**
 * Callback invoked once a completed gutter drag settles a pane's sizes.
 *
 * @param sizes - The panes' sizes after the drag, in child order — the same
 *   array {@link Split.getPaneSizes} would return.
 *
 * @category Layouts
 */
export type PaneResizeCallback = (sizes: LayoutSize[]) => void;

/**
 * Callback invoked when a pane's collapsed state changes.
 *
 * @param index - Zero-based index of the toggled pane.
 * @param collapsed - True if the pane is now collapsed.
 *
 * @category Layouts
 */
export type PaneCollapseCallback = (index: number, collapsed: boolean) => void;

/**
 * Construction-time options for {@link Split}.
 *
 * @category Layouts
 */
export interface SplitOptions extends LayoutManagerOptions {
    orientation?: AxisOrientation;
    /** Indices of panes to start collapsed (applied on first layout). */
    collapsedPanes?: number[];
    /** Pane sizes to restore on first layout; discarded whole when stale. */
    paneSizes?: LayoutSize[];
    /**
     * The gutters' chevron activation gesture: `"dblclick"` (the default,
     * preserving today's behaviour) or `"click"`. Forwarded to every
     * {@link SplitGutter} this manager creates, via its own
     * `collapseTrigger` option. Read once at construction; changing it
     * after gutters exist has no effect on them.
     */
    collapseTrigger?: CollapseTrigger;
    /**
     * How a gutter drag shows its progress. Omit it to follow the app-wide
     * default set through `Body.setResizeMode`.
     */
    resizeMode?: ResizeMode;
    /**
     * Multi-event listener bag dispatched to {@link Split.on} at
     * construction time.
     */
    listeners?: {
        paneresize?:   PaneResizeCallback;
        panecollapse?: PaneCollapseCallback;
    };
}

/**
 * A pane's resolved bounds plus the `clip-path` to write after committing them —
 * the hand-off between {@link Split.doLayout}'s placement loop and its commit
 * pass. `clipPath` is `null` for a pane that carries no clip.
 */
interface SplitPlacement extends ResolvedPlacement {
    clipPath: string | null;
}

/**
 * What {@link Split} records about a collapsed pane the instant before it
 * takes the pane's content out of the render tree: the pane's own size
 * reports, substituted for live queries while the content is out (a childless
 * pane reports different — for a box-managed one, deflated — numbers), and
 * which direct children were displayed, so an expand puts back exactly those
 * and leaves a child something else had already undisplayed (a `Card`'s
 * inactive page) alone.
 */
interface PaneContentSnapshot {
    preferred: Size | null;
    min:       Size | null;
    max:       Size | null;
    displayed: Component[];
}

/** A dragged gutter's two neighbours' main-axis bounds, as {@link Split.onDrag} clamps them. */
interface PairBounds {
    /** The smallest the left/upper pane may become. */
    minLhs: number;
    /** The largest the left/upper pane may become. */
    maxLhs: number;
    /** The smallest the right/lower pane may become. */
    minRhs: number;
    /** The largest the right/lower pane may become. */
    maxRhs: number;
}

/** One buffered gutter move: {@link Split.onDrag}'s three arguments. */
interface SplitDragFrame {
    /** The container that owns the panes. */
    container: Component;
    /** The gutter being dragged. */
    gutter: SplitGutter;
    /** The absolute pointer coordinate in the split axis. */
    position: number;
}

/** An outline drag's state: the bounds read at the press, and the gutter's line. */
interface SplitOutlineDrag {
    /** The two neighbours' bounds, read once when the drag started. */
    bounds: PairBounds;
    /** The outline's box at the press. */
    line: OutlineRect;
}

/**
 * A layout manager that splits the container into two or more resizable panels
 * separated by draggable gutter elements.
 * The split orientation can be `'horizontal'` (panels side by side) or `'vertical'` (panels stacked).
 *
 * @category Layouts
 */
class Split extends LayoutManager implements FocusRevealer {

    private _orientation: AxisOrientation = "horizontal";
    private _collapseTrigger: CollapseTrigger = "dblclick";
    private _sizes: Map<Component, number> = new Map<Component, number>();
    private _gutters: Array<SplitGutter> = [];

    // Per-pane collapsed state, paralleling `_sizes`. A collapsed pane keeps its
    // stored size untouched so a restore returns it to the same ratio; only the
    // displayed geometry in `doLayout` substitutes the strip thickness. The
    // pane's own gutter becomes the visible strip while collapsed.
    private _collapsed: Map<Component, boolean> = new Map<Component, boolean>();

    // Per-pane container-resize weight, paralleling `_sizes`. When the container
    // extent changes, the delta is split across the panes in proportion to these
    // weights (weight 0 pins the pane's px size). A pane absent from the map
    // defaults to its current stored size, which makes an all-unset Split split
    // the delta proportionally to size — identical to a uniform rescale. Absence
    // and an explicit `0` therefore mean different things, so only explicitly-set
    // weights are stored.
    private _weights: Map<Component, number> = new Map<Component, number>();

    // Pane indices to collapse on the first connected layout, taken from the
    // `collapsedPanes` option. Drained once because pane components aren't
    // resolvable from indices until the container has its children.
    private _pendingCollapsed: number[] = [];

    private _listeners: ListenerBag<SplitEvent> = this.registerListenerBag(new ListenerBag<SplitEvent>());

    // The gutter right-click context menu, created lazily on first open (mirrors
    // MenuButton.toggleMenu's `??=`) and disposed + nulled in `detach()`. `Split`
    // has no destructor of its own — `detach()` is its only teardown hook, and it
    // can run on a manager swap followed by a re-attach, so eager re-allocation
    // here would leak a `Menu` on a disposed `Split`.
    private _contextMenu: Menu | null = null;

    // Sizes to restore on the first connected layout, taken from the
    // `paneSizes` option (or a direct `applyPaneSizes` call before the
    // container is attached). Drained once, mirroring `_pendingCollapsed`:
    // panes aren't resolvable from indices until the container has children.
    private _pendingSizes: LayoutSize[] | null = null;

    private _dragOriginPointer: number = 0;
    private _dragOriginLhsSize: number = 0;
    private _dragOriginRhsSize: number = 0;

    // This split's own resize mode; `null` follows the app-wide default.
    private _resizeMode: ResizeMode | null = null;

    // The outline drag in progress, or `null` in live mode and between drags.
    private _outlineDrag: SplitOutlineDrag | null = null;

    // The per-frame drag session every gutter move goes through: it applies at
    // most one buffered move per animation frame, laying it out in live mode
    // and moving the outline in outline mode.
    private readonly _resizeDrag: ResizeDrag<SplitDragFrame> = new ResizeDrag<SplitDragFrame>({
        // `this.onDrag` is looked up at call time, so a test's instance spy
        // still sees every live frame.
        apply:   (frame): void => this.onDrag(frame.container, frame.gutter, frame.position),
        preview: (frame): OutlineRect | null => this.previewDrag(frame),
        commit:  (frame): void => this.onDrag(frame.container, frame.gutter, frame.position),
    });

    // The available (net-of-gutters) main-axis extent the stored `_sizes`
    // were last normalised against. Lets `recalculateSizes` rescale the
    // frozen pane sizes when the container grows or shrinks, so panes keep
    // filling the container across viewport resizes. `0` until the first
    // connected layout, which correctly suppresses the rescale pass.
    private _lastAvailableMain: number = 0;

    // Canceller for the in-flight collapse/restore animation, or null when
    // idle. Calling it stops the rAF loop in place so a rapid re-toggle can
    // re-snapshot the current geometry and retarget without two loops fighting.
    private _collapseAnimation: (() => void) | null = null;

    // Collapse/restore CSS transitions primed by `runCollapse` that have not
    // settled yet. Cancelled on detach so their fallback timers cannot fire
    // against released element handles. Held separately from
    // `_collapseAnimation` because that field is nulled when the geometry
    // animation settles — ~40ms before these fallbacks disarm — and is replaced
    // outright by a re-toggle while these may still be running.
    private readonly _pendingCollapseTransitions: CollapseTransition[] = [];

    // True from a `setPaneCollapsed` call until its geometry animation settles
    // (or `detach` abandons it). Mirrors `Border._collapsing`. Guards the idle
    // reconcile sweep at the end of `doLayout`: `_collapseAnimation` cannot
    // serve that purpose, because `runCollapse` lays the end state out before
    // it hands back the canceller stored there — so that field still reads
    // idle during the very pass that starts a collapse — and, under reduced
    // motion, is left holding a no-op canceller after its own `onIdle` already
    // nulled it.
    private _collapsing: boolean = false;

    // Snapshot of a collapsed pane's own size reports and displayed children,
    // taken the instant before its content is undisplayed. Substituted for a
    // live query in every size-reading method so a now-childless pane's own
    // getPreferredSize()/getMinSize()/getMaxSize() cannot silently change what
    // the split reports or clamps while collapsed. Presence of an entry also
    // doubles as "this pane's content is undisplayed".
    private readonly _undisplayedPaneContent: Map<Component, PaneContentSnapshot> = new Map();

    // Panes whose content was just redisplayed and are awaiting a scroll
    // restore once their post-expand geometry is final. Drained by
    // `reconcileCollapsedContent`.
    private readonly _pendingScrollRestore: Set<Component> = new Set();

    constructor(options?: SplitOptions) {
        // LayoutManager's constructor takes no options; applied via applyOptions below.
        // eslint-disable-next-line local/forward-super-options
        super();

        if (options) {
            this.applyOptions(options);
        }
    }

    /**
     * Applies a {@link SplitOptions} bag, dispatching the split orientation
     * after the inherited LayoutManager defaults.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: SplitOptions): void {
        super.applyOptions(options);

        if (options.orientation !== undefined) {
            this.setOrientation(options.orientation);
        }

        if (options.collapseTrigger !== undefined) {
            this._collapseTrigger = options.collapseTrigger;
        }

        if (options.resizeMode !== undefined) {
            this.setResizeMode(options.resizeMode);
        }

        if (options.collapsedPanes !== undefined) {
            this._pendingCollapsed = [...options.collapsedPanes];
        }

        if (options.paneSizes !== undefined) {
            this._pendingSizes = options.paneSizes.map(size => ({ ...size }));
        }

        if (options.listeners !== undefined) {
            const listeners = options.listeners;

            for (const event of Object.keys(listeners) as Array<keyof typeof listeners>) {
                const listener = listeners[event];

                // A union of two events' callback types no longer narrows to a
                // single `on` overload; the cast mirrors `Component.applyListeners`'
                // own `(this as any).on` — sound for the same reason: `event` and
                // `listener` are still a matched pair from the same options key.
                if (listener !== undefined) {
                    (this as any).on(event, listener);
                }
            }
        }
    }

    /**
     * Registers a listener for one of this split's events.
     *
     * @param event - `"paneresize"` fires once a completed gutter drag
     *   settles a pane's sizes, receiving the panes' sizes in child order;
     *   `"panecollapse"` fires whenever a pane's collapsed state changes,
     *   receiving the zero-based pane index and whether it is now collapsed.
     * @param listener - The callback to invoke when the event fires.
     *
     * @returns This split, for method chaining.
     */
    on(event: "paneresize",   listener: PaneResizeCallback): this;
    on(event: "panecollapse", listener: PaneCollapseCallback): this;
    on(event: SplitEvent,     listener: Function): this {
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
     * @returns This split, for method chaining.
     */
    off(event: SplitEvent, listener: Function): this {
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
    protected emit(event: "paneresize",   sizes: LayoutSize[]): void;
    protected emit(event: "panecollapse", index: number, collapsed: boolean): void;
    protected emit(event: SplitEvent,     ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Returns whether the pane at the given container index is collapsed.
     *
     * @param index - Zero-based pane index.
     * @returns True when the pane is collapsed; false when expanded or the
     *   index is out of range.
     */
    isPaneCollapsed(index: number): boolean {
        const container = this.getContainer();
        if (!container) {
            return false;
        }

        const pane = container.getLaidOutComponents()[index];

        return pane ? (this._collapsed.get(pane) ?? false) : false;
    }

    /**
     * Whether a collapse direction heads toward the split's leading edge
     * (`west`/`north`) rather than its trailing edge (`east`/`south`). A
     * leading-collapsing pane tucks into a strip made from the gutter on its
     * trailing side; a trailing-collapsing one uses the gutter on its leading
     * side (which is how the otherwise-gutterless last pane collapses).
     *
     * @param direction - The collapse heading to classify.
     * @returns True for `west`/`north`.
     */
    private collapsesTowardStart(direction: CollapseDirection): boolean {
        return direction === "west" || direction === "north";
    }

    /**
     * Resolves a pane's configured collapse direction, defaulting to the
     * leading direction for the split's axis (`west` horizontal, `north`
     * vertical) when its constraint leaves it unset.
     *
     * @param pane - The pane whose direction to resolve.
     * @returns The effective collapse heading.
     */
    private paneDirection(pane: Component): CollapseDirection {
        const constraints = this.getLayoutConstraints(pane);

        return constraints?.collapseDirection ?? (this._orientation === "horizontal" ? "west" : "north");
    }

    /**
     * Whether the pane opts into collapsing. Split is opt-**out**: a pane is
     * collapsible unless its constraint sets `collapsible: false`. (Border reads
     * the same {@link LayoutConstraints.collapsible} field opt-**in** —
     * `collapsible ?? false` — so the two managers default `undefined`
     * differently by design.) A non-collapsible pane reports no serving gutter,
     * which suppresses its chevron and every collapse path while leaving the
     * gutter a draggable divider.
     *
     * @param pane - The pane whose collapsibility to resolve.
     * @returns True unless the pane's constraint sets `collapsible: false`.
     */
    private paneCollapsible(pane: Component): boolean {
        return this.getLayoutConstraints(pane)?.collapsible !== false;
    }

    /**
     * Returns the index of the pane that gutter `gutterIndex` collapses, or
     * `-1` when it collapses neither neighbour (a plain divider with no
     * chevron). The trailing pane claims the gutter when it opts to collapse
     * toward the end; otherwise the leading pane uses it to collapse toward the
     * start. The two are mutually exclusive, so no pane is served by two gutters.
     *
     * @param gutterIndex - The gutter between panes `gutterIndex` and `gutterIndex + 1`.
     * @param components - The container's current panes.
     * @returns The served pane index, or `-1`.
     */
    private gutterTargetPane(gutterIndex: number, components: Array<Component>): number {
        const next = components[gutterIndex + 1];
        if (next && this.paneCollapsible(next) && !this.collapsesTowardStart(this.paneDirection(next))) {
            return gutterIndex + 1;
        }

        const lead = components[gutterIndex];
        if (lead && this.paneCollapsible(lead) && this.collapsesTowardStart(this.paneDirection(lead))) {
            return gutterIndex;
        }

        return -1;
    }

    /**
     * Returns the index of the gutter that collapses the pane at `index`, or
     * `-1` when the pane cannot collapse — no gutter on the side its direction
     * needs, or that gutter is claimed by the adjacent pane. A leading-collapsing
     * pane uses its trailing gutter; a trailing-collapsing one uses its leading
     * gutter (the mechanism that lets the last pane collapse).
     *
     * @param index - The pane index.
     * @param components - The container's current panes.
     * @returns The serving gutter index, or `-1`.
     */
    private paneServingGutter(index: number, components: Array<Component>): number {
        const direction = this.paneDirection(components[index]);

        if (this.collapsesTowardStart(direction)) {
            return index < components.length - 1 && this.gutterTargetPane(index, components) === index ? index : -1;
        }

        return index > 0 && this.gutterTargetPane(index - 1, components) === index ? index - 1 : -1;
    }

    /**
     * Collapses or restores the pane at the given container index, animating the
     * change. The pane's own gutter slides to the pane's outer edge and widens
     * into the opaque collapse strip (cross-fading its fill) while the pane keeps
     * its full size and reveals via a clip-path; the freed main-axis space is
     * redistributed to the remaining expanded panes. The whole pass is one
     * coordinated animation: the toggled pane clip-reveals while every pane and
     * gutter whose box changes interpolates its geometry — re-laying out its
     * content each frame — in lockstep (see `CollapseSupport.runCollapse`). A
     * pane whose box does not change, usually the toggled pane itself, is laid
     * out once for the end state and left alone by the animation's frames.
     *
     * The serving gutter depends on the pane's `collapseDirection` constraint: a
     * leading-collapsing pane (the default) uses the gutter on its trailing side,
     * a trailing-collapsing one the gutter on its leading side — which is how the
     * last pane collapses. A pane with no serving gutter cannot collapse.
     *
     * @param index - Zero-based pane index.
     * @param collapsed - True to collapse, false to restore.
     * @returns This layout manager, for method chaining.
     */
    setPaneCollapsed(index: number, collapsed: boolean): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const components = container.getLaidOutComponents();
        const pane       = components[index];
        if (!pane) {
            return this;
        }

        const gutterIndex = this.paneServingGutter(index, components);
        if (gutterIndex < 0) {
            return this;
        }

        const current = this._collapsed.get(pane) ?? false;
        if (current === collapsed) {
            return this;
        }

        // Content must be back in the render tree before `runCollapse` lays the
        // end state out, or the expand reveals an empty box for its whole run.
        if (!collapsed) {
            this.redisplayPaneContent(pane);
        }

        this._collapsed.set(pane, collapsed);
        this._collapsing = true;
        this.emit("panecollapse", index, collapsed);

        // Every box that may move: the panes (content re-laid-out each frame)
        // and the gutters (geometry only); `runCollapse` animates only the ones
        // whose box changes. The toggled pane is among them and also
        // clip-reveals; `runCollapse` coordinates the whole pass. A sibling
        // whose content is out is geometry-only too — its own layout must not
        // run while it stays collapsed (see `commitPanes`).
        const participants: CollapseParticipant[] = [
            ...components.map(component => ({ component, relayout: !this._undisplayedPaneContent.has(component), gutter: false })),
            ...this._gutters.map(gutter => ({ component: gutter, relayout: false, gutter: true })),
        ];

        this._collapseAnimation = runCollapse(container, pane, participants, this._collapseAnimation, this._pendingCollapseTransitions, () => {
            this._collapseAnimation = null;
            this._collapsing = false;

            // The live pane list rather than `components`: a pane removed
            // mid-animation is no longer this manager's to touch.
            this.reconcileCollapsedContent(container.getLaidOutComponents());
        });

        return this;
    }

    /**
     * Snapshots a collapsed pane's own size and its content's native scroll
     * offsets, then removes that content from the render tree. For a pane
     * whose content is already out, only re-asserts the undisplay of the
     * children it took out — this manager owns their displayed state while
     * the pane stays collapsed, so a child something else put back since (a
     * stray layout of the pane's own `Tab`, a consumer's `setDisplayed(true)`)
     * leaves again; the snapshot and the captured scroll are kept. A recorded
     * child that has since left the pane is no longer this manager's to touch.
     *
     * @remarks The capture is guarded on effective visibility, as `Tab` and
     * `Card` guard theirs: an ancestor outside this manager's control can be
     * what actually leaves the pane with no boxes, and a live read against a
     * boxless subtree would clobber every cached offset with zero.
     *
     * @param pane - The collapsed pane whose content to undisplay.
     */
    private undisplayPaneContent(pane: Component): void {
        const snapshot = this._undisplayedPaneContent.get(pane);

        if (snapshot !== undefined) {
            for (const child of snapshot.displayed) {
                if (child.getParentComponent() === pane) {
                    child.setDisplayed(false);
                }
            }

            return;
        }

        // A pane re-collapsed before its expand's restore landed still carries
        // the offsets it was collapsed with in its cache, and its live offsets
        // are the engine's post-`display: none` zeros: a capture here would
        // overwrite the one with the other, and the pending restore is then
        // dropped by `reconcileCollapsedContent`'s drain. The cache stays
        // authoritative until a restore has actually been written.
        if (pane.isEffectivelyVisible() && !this._pendingScrollRestore.has(pane)) {
            pane.captureSubtreeScroll();
        }

        this.snapshotAndUndisplay(pane);
    }

    /**
     * The second half of {@link undisplayPaneContent}: records the pane's own
     * size report and takes its direct children out of the render tree. Split
     * out so {@link transferPaneSize} can order the scroll capture around the
     * outgoing pane's redisplay.
     *
     * @param pane - The pane whose content to record and undisplay.
     */
    private snapshotAndUndisplay(pane: Component): void {
        const displayed = pane.getLaidOutComponents();

        this._undisplayedPaneContent.set(pane, {
            preferred: pane.getPreferredSize(),
            min:       pane.getMinSize(),
            max:       pane.getMaxSize(),
            displayed,
        });

        // The snapshot above answers this manager's own reads; the pane's own
        // `setWidth`/`setHeight` clamp reads the live merged max, which a
        // childless box manager reports as its bare perimeter, so a general
        // `Component` pane would have every box write clamped away while its
        // content is out. Resumed by `redisplayPaneContent`.
        pane.setContentClampSuspended(true);

        for (const child of displayed) {
            child.setDisplayed(false);
        }
    }

    /**
     * Restores a collapsed pane's content to the render tree. Scroll is not
     * reapplied here — it needs the pane's post-expand geometry, which only
     * exists once the pane's layout settles — so the pane is queued instead.
     * Idempotent — a pane whose content is already displayed is left untouched.
     * A recorded child that has since left the pane is no longer this
     * manager's to touch.
     *
     * @param pane - The pane whose content to redisplay.
     */
    private redisplayPaneContent(pane: Component): void {
        const snapshot = this._undisplayedPaneContent.get(pane);

        if (snapshot === undefined) {
            return;
        }

        this._undisplayedPaneContent.delete(pane);

        for (const child of snapshot.displayed) {
            if (child.getParentComponent() === pane) {
                child.setDisplayed(true);
            }
        }

        pane.setContentClampSuspended(false);

        this._pendingScrollRestore.add(pane);
    }

    /**
     * Settles the collapsed-content bookkeeping against what the layout
     * actually clips, once no collapse animation is in flight. A pane
     * `doLayout` clips behind its strip — the collapsed flag *and* a serving
     * gutter, the same test `doLayout` applies — has its content undisplayed
     * if it still shows, including a sibling whose own collapse animation was
     * superseded before it settled (see CollapseAnimationTeardown.test.ts's
     * "still clears the first pane's transition when a different pane is
     * toggled"). A pane that carries a snapshot but is laid out expanded this
     * pass — its serving gutter went away when a trailing sibling left, or
     * `collapsible` was switched off, while it stayed flagged — gets its
     * content back, since nothing clips it and neither toggle would accept it
     * any more. Scroll is then restored for every pane awaiting it whose
     * content is in the render tree (a pane re-collapsed before its expand
     * settled has just been undisplayed again, so it is skipped). Cheap and
     * side-effect-free when there is nothing to reconcile.
     *
     * @param components - The container's current laid-out panes.
     */
    private reconcileCollapsedContent(components: Array<Component>): void {
        for (let idx = 0; idx < components.length; idx += 1) {
            const pane = components[idx];

            if ((this._collapsed.get(pane) ?? false) && this.paneServingGutter(idx, components) >= 0) {
                this.undisplayPaneContent(pane);
            } else if (this._undisplayedPaneContent.has(pane)) {
                // The pane's own box is already final; lay its children out so
                // the restore below writes against real scroll ranges.
                this.redisplayPaneContent(pane);
                pane.doLayout();
            }
        }

        // `onIdle` reaches here outside `doLayout`, before `recalculateSizes`
        // has pruned the bookkeeping, so a pane removed — and possibly
        // disposed — while its expand animated can still be queued; writing
        // its offsets back would go through a released handle. Only a pane
        // that is still the container's is restored, as Border's drain
        // resolves through the live slot.
        if (this._pendingScrollRestore.size === 0) {
            return;
        }

        const owned = new Set(this.getContainer()?.getComponents() ?? []);
        // A pane whose content is back but which something else has
        // undisplayed cannot take its offsets yet (no boxes to write against),
        // so its entry is kept for the layout that follows its re-show rather
        // than dropped.
        const retained: Component[] = [];

        for (const pane of this._pendingScrollRestore) {
            if (!owned.has(pane) || this._undisplayedPaneContent.has(pane)) {
                continue;
            }

            if (pane.isDisplayed()) {
                pane.restoreSubtreeScroll();
            } else {
                retained.push(pane);
            }
        }

        this._pendingScrollRestore.clear();

        for (const pane of retained) {
            this._pendingScrollRestore.add(pane);
        }
    }

    /**
     * A pane's preferred size as the split reports it: the snapshot taken
     * before its content was undisplayed while that holds, else live.
     *
     * @param pane - The pane to size.
     * @returns The pane's preferred size, or `null` when it reports none.
     */
    private panePreferredSize(pane: Component): Size | null {
        const snapshot = this._undisplayedPaneContent.get(pane);

        return snapshot !== undefined ? snapshot.preferred : pane.getPreferredSize();
    }

    /**
     * Mirrors {@link panePreferredSize} for the minimum size.
     *
     * @param pane - The pane to size.
     * @returns The pane's minimum size, or `null` when it reports none.
     */
    private paneMinSize(pane: Component): Size | null {
        const snapshot = this._undisplayedPaneContent.get(pane);

        return snapshot !== undefined ? snapshot.min : pane.getMinSize();
    }

    /**
     * Mirrors {@link panePreferredSize} for the maximum size. Needed as much
     * as the other two: a box-managed pane reports its bare perimeter as its
     * max once childless, which `clampMain` would otherwise write into the
     * pane's stored size on the next layout.
     *
     * @param pane - The pane to size.
     * @returns The pane's maximum size, or `null` when it reports none.
     */
    private paneMaxSize(pane: Component): Size | null {
        const snapshot = this._undisplayedPaneContent.get(pane);

        return snapshot !== undefined ? snapshot.max : pane.getMaxSize();
    }

    /**
     * Returns the split orientation.
     *
     * @returns `'horizontal'` or `'vertical'`.
     */
    getOrientation(): AxisOrientation {
        return this._orientation;
    }

    /**
     * Sets the split orientation.
     * Marks the container's layout pass as owed.
     *
     * @param orientation - `'horizontal'` for side-by-side panels, `'vertical'` for stacked panels.
     */
    setOrientation(orientation: AxisOrientation) : this {
        this._orientation = orientation;
        this.getContainer()?.invalidateLayout();

        return this;
    }

    /**
     * Returns the mode this split's gutter drags use: its own when it has one,
     * otherwise the app-wide default set through `Body.setResizeMode`.
     *
     * @returns `'live'` or `'outline'`.
     */
    getResizeMode(): ResizeMode {
        return this._resizeMode ?? getAppResizeMode();
    }

    /**
     * Sets how this split's gutter drags show their progress. `'outline'`
     * moves a thin line to where the gutter will land and lays the two panes
     * out once, on release; `'live'` lays them out on every frame. Takes
     * effect from the next drag.
     *
     * @param mode - The mode to use, or `null` to follow the app-wide default
     *   set through `Body.setResizeMode` again.
     *
     * @returns This layout manager, for method chaining.
     */
    setResizeMode(mode: ResizeMode | null): this {
        this._resizeMode = mode;

        return this;
    }

    /**
     * Seeds or overrides the stored main-axis size for one pane.
     *
     * Lets a caller that has just inserted a pane (an edge-drop dock, say) give
     * it a specific share instead of the equal division `recalculateSizes`
     * applies to a pane with no stored size. The value is a px main-axis extent
     * — the same unit the gutters store and {@link recalculateSizes} rescales —
     * not a ratio; pass it relative to the other panes' current stored sizes.
     * Marks the container's layout pass as owed.
     *
     * @param pane - The pane whose stored size to seed or override.
     * @param size - The main-axis extent in px to store for the pane.
     * @returns This layout manager, for method chaining.
     */
    setPaneSize(pane: Component, size: number): this {
        this._sizes.set(pane, size);
        this.getContainer()?.invalidateLayout();

        return this;
    }

    /**
     * Returns a pane's stored main-axis size in px, or `undefined` when the pane
     * has no stored size yet (it has never been laid out, or it was added since
     * the last layout). A pane reporting `undefined` is the one
     * {@link recalculateSizes} gives a proportional share on the next layout.
     *
     * @param pane - The pane whose stored size to read.
     * @returns The stored main-axis extent in px, or `undefined` when unset.
     */
    getPaneSize(pane: Component): number | undefined {
        return this._sizes.get(pane);
    }

    /**
     * Sets a pane's container-resize weight — how it shares the size delta when
     * the container's main-axis extent changes (a viewport resize, a host
     * re-layout). `0` pins the pane's px size (it does not move on resize); a
     * positive weight absorbs the delta in proportion to the other panes'
     * weights. A pane with no weight set defaults to its current stored size, so
     * an all-unset `Split` splits the delta proportionally to size — the same
     * proportional rescale as before any weight was set. Gutter-drag (user
     * resize) is unaffected. When the container shrinks below a pinned pane's
     * size the pane cannot keep its full extent — geometry must fill the
     * container — so pure pinning holds only while the container is large enough.
     *
     * This is the runtime override of the pane's `weight` layout constraint: a
     * pane added with `addComponent(pane, { weight: 0 })` is pinned declaratively
     * at construction, and this setter takes precedence over that constraint.
     *
     * @param pane - The pane whose resize weight to set.
     * @param weight - The resize weight; `0` pins, positive absorbs. `undefined`
     *   clears the explicit entry, returning the pane to ratio-based persistence
     *   in {@link getPaneSizes} (resolved through the `weight` constraint or the
     *   pane's stored size, exactly as before any weight was ever set).
     * @returns This layout manager, for method chaining.
     */
    setPaneResizeWeight(pane: Component, weight: number | undefined): this {
        if (weight === undefined) {
            this._weights.delete(pane);
        } else {
            this._weights.set(pane, weight);
        }

        return this;
    }

    /**
     * Returns a pane's explicitly-set resize weight, or `undefined` when unset
     * (the pane defaults to its current size on resize). `undefined` and `0` are
     * distinct: `0` is an explicit pin, `undefined` is "behave as before".
     *
     * @param pane - The pane whose resize weight to read.
     * @returns The explicitly-set resize weight, or `undefined` when unset.
     */
    getPaneResizeWeight(pane: Component): number | undefined {
        return this._weights.get(pane);
    }

    /**
     * Resolves a pane's effective container-resize weight, in precedence order:
     * an imperative {@link setPaneResizeWeight} entry (runtime override), else
     * the pane's `weight` layout constraint (declarative, construction-time),
     * else the fallback (its current stored size, so an unset pane behaves as a
     * proportional rescale). Reads the raw constraint — unset is `undefined`, not
     * the box managers' `?? 0` — so an unset pane falls through to the fallback
     * rather than being pinned.
     *
     * @param pane - The pane whose resize weight to resolve.
     * @param fallback - The weight to use when neither an explicit weight nor a
     *   `weight` constraint is set.
     * @returns The effective resize weight.
     */
    private effectiveResizeWeight(pane: Component, fallback: number): number {
        return this._weights.get(pane) ?? this.getLayoutConstraints(pane)?.weight ?? fallback;
    }

    /**
     * Clamps a candidate main-axis px to the pane's `[min, max]` along the split
     * axis. Min wins if a contradictory `min > max` is set.
     *
     * @param pane - The pane whose bounds constrain the value.
     * @param value - The candidate main-axis extent in px.
     * @param horizontal - True when the split's main axis is width.
     * @returns The clamped main-axis extent.
     */
    private clampMain(pane: Component, value: number, horizontal: boolean): number {
        const min = this.paneMinSize(pane);
        const max = this.paneMaxSize(pane);
        const lo  = min ? (horizontal ? min.width : min.height) : 0;
        const hi  = max ? (horizontal ? max.width : max.height) : Number.POSITIVE_INFINITY;

        return Util.clamp(value, lo, hi);
    }

    /**
     * True when the pane cannot move on the main axis — its `[min, max]` range is
     * a single point (`min == max`), the collapsed-pin state. An unset max reads
     * as `MAX_SAFE_INTEGER`, never equal to a real min, so an unconstrained pane
     * is never reported pinned.
     *
     * @param pane - The pane to test.
     * @param horizontal - True when the split's main axis is width.
     * @returns True when the pane is pinned to a single main-axis extent.
     */
    private isPinnedMain(pane: Component, horizontal: boolean): boolean {
        const min = this.paneMinSize(pane);
        const max = this.paneMaxSize(pane);
        const lo  = min ? (horizontal ? min.width : min.height) : 0;
        const hi  = max ? (horizontal ? max.width : max.height) : Number.POSITIVE_INFINITY;

        return lo === hi;
    }

    /**
     * True when the pane's px size is pinned by an explicit container-resize weight
     * of `0` — the pin the delta-distribution block honours, so the refill must not
     * undo it by rescaling the pane. Distinct from {@link isPinnedMain}: that is a
     * single-point `[min, max]` range (one legal extent, never rescaled), this is a
     * caller preference that yields when the container is too small to hold it.
     *
     * Resolves through the same precedence as the resize block (imperative weight,
     * else `weight` constraint, else fallback), probing with a positive fallback so
     * an unset pane reports flexible and only an explicit `0` reports pinned.
     *
     * @param pane - The pane to test.
     * @returns True when the pane's effective resize weight is an explicit `0`.
     */
    private isResizePinnedMain(pane: Component): boolean {
        return this.effectiveResizeWeight(pane, WEIGHT_UNSET_PROBE) === 0;
    }

    /**
     * Seeds a first-layout pane (one with no stored size) from its preferred main
     * extent, clamped to `[min, max]` — the HBox/VBox model. Reads the preferred
     * *constraint* (explicit or class-default), so a content-only pane with no
     * constraint (e.g. a bare dock `Container`) is left unseeded and picks up the
     * equal-division fallback, keeping docks unchanged. Runs once per pane: a
     * pane that already has a stored size is skipped, so a later `setPreferredSize`
     * never re-seeds it.
     *
     * @param components - The container's current panes.
     * @param horizontal - True when the split's main axis is width.
     */
    private seedFromPreferred(components: Array<Component>, horizontal: boolean): void {
        for (const component of components) {
            if (this._sizes.has(component)) {
                continue;
            }

            const preferred = component.getPreferredSizeConstraint();
            if (!preferred) {
                continue;
            }

            const main = horizontal ? preferred.width : preferred.height;
            this._sizes.set(component, this.clampMain(component, main, horizontal));
        }
    }

    /**
     * Moves a pane's stored size (and collapsed state) onto another component,
     * for when a structural change swaps one child for another in the *same* pane
     * slot — a pane wrapped in a nested `Split`, or a single-pane `Split`'s lone
     * child hoisted into the slot the `Split` vacated. Without it the replacement
     * is treated as a brand-new pane and {@link recalculateSizes} re-equalizes the
     * slot, discarding a user-dragged ratio. No-op when `from` has no stored size.
     *
     * @param from - The pane leaving the slot.
     * @param to - The component taking the slot.
     * @returns This layout manager, for method chaining.
     */
    transferPaneSize(from: Component, to: Component): this {
        const size = this._sizes.get(from);

        if (size === undefined) {
            return this;
        }

        this._sizes.set(to, size);
        this._sizes.delete(from);

        const collapsed = this._collapsed.get(from);

        if (collapsed !== undefined) {
            this._collapsed.set(to, collapsed);
            this._collapsed.delete(from);
        }

        // Move the undisplayed-content state with the collapsed flag, in three
        // ordered steps. Capture `to`'s live scroll offsets while `from`'s
        // content is still out, so the walk skips those boxless nodes instead
        // of reading zeros through them — and a `to` being hoisted out of
        // `from`, itself one of them, captures nothing at all. Then give
        // `from`'s content back: it is what puts such a hoisted `to` in the
        // render tree at all (left undisplayed, `getLaidOutComponents` would
        // drop it out of this split entirely), and what completes the report
        // of a `to` that wraps `from`. Only then snapshot `to` and take its
        // children out. `from` is owed no scroll restore: it is no longer a
        // pane of this split.
        if (this._undisplayedPaneContent.has(from)) {
            if (to.isEffectivelyVisible()) {
                to.captureSubtreeScroll();
            }

            this.redisplayPaneContent(from);
            this._pendingScrollRestore.delete(from);
            this.snapshotAndUndisplay(to);
        }

        const weight = this._weights.get(from);

        if (weight !== undefined) {
            this._weights.set(to, weight);
            this._weights.delete(from);
        }

        return this;
    }

    /**
     * Returns the stored pane sizes normalised to sum 1.0, in container child
     * order. Captures the user's split ratios for serialization; ratios are
     * viewport-independent, so they survive a restore into a differently-sized
     * container (`Split` rescales px against the live extent on the next layout).
     *
     * @returns One ratio per pane in child order, summing to ~1.0; an equal
     *   split when no sizes are stored yet, or `[]` when detached.
     */
    getPaneRatios(): number[] {
        const container = this.getContainer();
        if (!container) {
            return [];
        }

        const components = container.getComponents();
        if (components.length === 0) {
            return [];
        }

        const sizes = components.map(component => this._sizes.get(component) ?? 0);

        return normalizeRatios(sizes, components.length);
    }

    /**
     * The split's preferred size, derived from its panes the box-layout way: the
     * panes' preferred extents sum along the split axis (plus the gutter
     * footprint) and the widest/tallest is taken across it, then the container
     * perimeter is added. Panes that report no preferred size contribute
     * nothing, matching [`HBox`](/api/layout/classes/HBox) / [`VBox`](/api/layout/classes/VBox).
     *
     * This is a content hint for the *host* sizing the split's slot; it is
     * independent of the dragged per-pane sizes, which only distribute the
     * split's actual extent among the panes at layout time.
     *
     * @returns The preferred `{width, height}`, or `null` when detached.
     */
    getPreferredSize(): Size | null {
        return this.computeContentSize(component => this.panePreferredSize(component));
    }

    /**
     * The split's minimum size, computed from its panes' minimums exactly as
     * {@link getPreferredSize} computes the preferred size: summed along the
     * split axis (plus gutters), maxed across it, plus the container perimeter.
     *
     * @returns The minimum `{width, height}`, or `null` when detached.
     */
    getMinSize(): Size | null {
        return this.computeContentSize(component => this.paneMinSize(component));
    }

    /**
     * The split's maximum size: deliberately unbounded on both axes. A
     * user-resizable split absorbs arbitrary slack — its panes are dragged, so
     * there is no meaningful ceiling. This is *not* derived from the panes'
     * `getMaxSize` by summing their extents: that summation lacks the
     * unbounded-saturation the box managers apply, so a pane
     * reporting an unbounded max would sum to a large *finite* number rather
     * than saturating — a subtly wrong report. Returning unbounded directly is
     * both correct and honest for a container whose purpose is to absorb space.
     *
     * @returns `{ width: UNBOUNDED, height: UNBOUNDED }`.
     */
    getMaxSize(): Size | null {
        return { width: UNBOUNDED, height: UNBOUNDED };
    }

    /**
     * Shared core of {@link getPreferredSize} / {@link getMinSize}: sums the
     * panes' sizes (selected by `sizeOf`) along the split axis together with the
     * gutter footprint, takes the largest across it, and adds the container
     * perimeter. Panes reporting no size are skipped, as in the other box
     * managers.
     *
     * @param sizeOf - Selects each pane's preferred or minimum size.
     * @returns The composed `{width, height}`, or `null` when detached.
     */
    private computeContentSize(sizeOf: (component: Component) => Size | null): Size | null {
        const container = this.getContainer();
        if (!container) {
            return null;
        }

        const components = container.getLaidOutComponents();
        const perimeter  = container.getPerimeterSize();
        const horizontal = this._orientation === "horizontal";

        let main  = 0;
        let cross = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            const size = sizeOf(components[idx]);
            if (!size) {
                continue;
            }

            main  += horizontal ? size.width  : size.height;
            cross  = Math.max(cross, horizontal ? size.height : size.width);
        }

        main += this.gutterTotal(components.length);

        return horizontal
            ? { width:  main  + perimeter.left + perimeter.right,
                height: cross + perimeter.top  + perimeter.bottom }
            : { width:  cross + perimeter.left + perimeter.right,
                height: main  + perimeter.top  + perimeter.bottom };
    }

    /**
     * Writes pane ratios captured by {@link getPaneRatios} back onto the live
     * panes, by container child order. The input is treated as relative weights
     * (re-normalised internally), so a caller that dropped a pane on restore can
     * pass a short or non-unit array without skewing the result.
     *
     * @remarks Stored sizes are px, so the ratios are seeded against a positive
     * base extent: the live inner main-axis extent when the container is already
     * sized (no rescale needed next layout), else a unit base that
     * `recalculateSizes` scales up on the first connected layout. `_lastAvailableMain`
     * is reset to that same base so the next layout does not double-rescale the
     * freshly-written sizes.
     *
     * @param ratios - Relative pane weights in child order.
     * @returns This layout manager, for method chaining.
     */
    applyPaneRatios(ratios: number[]): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const components = container.getComponents();
        const count      = components.length;
        if (count === 0) {
            return this;
        }

        const norm = normalizeRatios(ratios, count);

        // Seed the stored px against a positive base. When the container is laid
        // out, use its real net-of-gutters main extent so the next layout needs
        // no rescale; otherwise use 1 and let `recalculateSizes` scale the
        // ratio-invariant sizes up on the first connected layout.
        const innerSize = container.getInnerSize();
        const main      = innerSize ? (this._orientation === "horizontal" ? innerSize.width : innerSize.height) : 0;
        const available = Math.max(0, main - this.gutterTotal(count));
        const base      = available > 0 ? available : 1;

        components.forEach((component, idx) => {
            this._sizes.set(component, norm[idx] * base);
        });

        this._lastAvailableMain = base;

        container.scheduleLayout();

        return this;
    }

    /**
     * Resolves each pane's persisted unit: `"px"` for a resize-pinned pane
     * (explicit `weight: 0`, per {@link isResizePinnedMain}), `"ratio"`
     * otherwise. The unit follows the weight, resolved by the same predicate
     * the container-resize refill uses — so a pane the layout holds at its
     * px is the pane persisted as px.
     *
     * @param components - The container's current panes, in child order.
     * @returns One unit per pane, in the same order.
     */
    private paneSizeUnits(components: Component[]): LayoutSizeUnit[] {
        return components.map(pane => (this.isResizePinnedMain(pane) ? "px" : "ratio"));
    }

    /**
     * Returns the panes' sizes in child order, one entry per pane, for
     * cross-session persistence: a resize-pinned pane (explicit `weight: 0`)
     * reports `px`, every other pane reports its `ratio` of the space the
     * px panes leave. This is the persistence surface — {@link getPaneRatios}
     * is the weight-agnostic arrangement surface `LayoutSerialization` uses;
     * do not use this one for same-session topology switching, or that one
     * for cross-session persistence.
     *
     * @returns One {@link LayoutSize} per pane in child order; the pending
     *   `paneSizes` when one is still undrained; `[]` when detached or the
     *   container has no panes.
     */
    getPaneSizes(): LayoutSize[] {
        const container = this.getContainer();

        if (!container) {
            return [];
        }

        const components = container.getComponents();

        if (components.length === 0) {
            return [];
        }

        const units = this.paneSizeUnits(components);

        // An undrained restore has not reached `_sizes` yet; reporting the live
        // state here would let a save overwrite the very state being restored.
        if (this._pendingSizes !== null && isRestorableSizes(this._pendingSizes, units)) {
            return this._pendingSizes.map(size => ({ ...size }));
        }

        return toLayoutSizes(units, components.map(pane => this._sizes.get(pane) ?? 0));
    }

    /**
     * Restores sizes captured by {@link getPaneSizes} onto the live panes, by
     * container child order. Discarded whole unless every entry's unit
     * matches the live pane's weight (see the discard rule on
     * {@link LayoutSize}) — a stale array leaves the panes exactly as though
     * no restore were requested.
     *
     * @param sizes - The persisted array to restore.
     * @returns This layout manager, for method chaining.
     */
    applyPaneSizes(sizes: LayoutSize[]): this {
        const container = this.getContainer();

        if (!container) {
            return this;
        }

        const components = container.getComponents();
        const units      = this.paneSizeUnits(components);

        if (!isRestorableSizes(sizes, units)) {
            return this;
        }

        const innerSize = container.getInnerSize();
        const main      = innerSize ? (this._orientation === "horizontal" ? innerSize.width : innerSize.height) : 0;
        const available = Math.max(0, main - this.gutterTotal(components.length));
        const stored    = fromLayoutSizes(sizes, available);

        components.forEach((pane, idx) => this.setPaneSize(pane, stored[idx]));

        // Match `applyPaneRatios`: rebase so the next `recalculateSizes` treats the
        // freshly-written sizes as the baseline instead of double-rescaling them.
        this._lastAvailableMain = available > 0 ? available : 1;

        container.scheduleLayout();

        return this;
    }

    /**
     * Collapses or restores the pane at the given index **without animating** —
     * the geometry change lands on the next layout pass. Unlike
     * {@link setPaneCollapsed} (which runs a coordinated rAF animation), this is
     * for bulk restore, where N concurrent collapse animations would fight over
     * geometry. Sets the collapsed flag directly; `doLayout` substitutes the
     * strip thickness for a collapsed pane that has a serving gutter.
     *
     * @param index - Zero-based pane index.
     * @param collapsed - True to collapse, false to expand.
     * @returns This layout manager, for method chaining.
     */
    setPaneCollapsedImmediate(index: number, collapsed: boolean): this {
        const container = this.getContainer();
        if (!container) {
            return this;
        }

        const components = container.getLaidOutComponents();
        const pane = components[index];
        if (!pane) {
            return this;
        }

        // A pane with no serving gutter cannot collapse (geometry, or
        // `collapsible: false`). Restoring (collapsed === false) is always
        // allowed so a pane can be reopened even if its flag later changed.
        // This is the one collapse path that bypasses `gutterTargetPane`, so it
        // needs the guard explicitly; the chevron, the gutter "collapse" event,
        // and `setPaneCollapsed` all funnel through `gutterTargetPane` already.
        if (collapsed && this.paneServingGutter(index, components) < 0) {
            return this;
        }

        // No animation to settle, so the content leaves or rejoins the render
        // tree right here; an expand's scroll restore rides on the layout
        // scheduled below.
        if (collapsed) {
            this.undisplayPaneContent(pane);
        } else {
            this.redisplayPaneContent(pane);
        }

        this._collapsed.set(pane, collapsed);
        this.emit("panecollapse", index, collapsed);

        container.scheduleLayout();

        return this;
    }

    /**
     * Captures the drag origin when a gutter's drag begins: the absolute
     * pointer coordinate and the current sizes of the two adjacent panels.
     * Subsequent `drag` events derive the new sizes from these origins so
     * over-travel past a panel's minimum is absorbed without decoupling the
     * gutter from the cursor on reversal.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter whose drag is starting.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`)
     *   in the split axis at the moment the drag began.
     *
     * @remarks Also starts the drag in this split's resize mode: an outline
     * drag draws the gutter's line here, reading the pair's bounds once, and
     * nothing is laid out again until the release.
     */
    onDragStart(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getLaidOutComponents()[gutterIdx];
        let rhs = container.getLaidOutComponents()[gutterIdx + 1];

        this._dragOriginPointer = position;

        const horizontal = this._orientation === "horizontal";

        if (horizontal) {
            this._dragOriginLhsSize = lhs.getWidth();
            this._dragOriginRhsSize = rhs.getWidth();
        } else {
            this._dragOriginLhsSize = lhs.getHeight();
            this._dragOriginRhsSize = rhs.getHeight();
        }

        if (this.getResizeMode() === "outline") {
            const line = gutterOutline(rectOf(gutter), horizontal ? "x" : "y");

            this._outlineDrag = { bounds: this.pairBounds(lhs, rhs, horizontal), line };
            this._resizeDrag.beginOutline({ parent: DOM.source.getParentNode(gutter.getElement()!)!, start: line, zIndex: IN_PAGE_OUTLINE_Z_INDEX });
        } else {
            this._outlineDrag = null;
            this._resizeDrag.beginLive();
        }
    }

    /**
     * Adjusts the sizes of the two panels adjacent to a gutter when it is dragged.
     *
     * @param container - The container component that owns the panels.
     * @param gutter - The gutter being dragged.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`) in
     *   the split axis for this move.
     *
     * @remarks The new panel sizes are computed from the drag origin captured in
     * {@link onDragStart} as `origin + (position − originPointer)`, then clamped
     * against each panel's minimum size while conserving the pair's combined
     * size. Clamping the absolute result (rather than accumulating per-move
     * deltas) means dragging past a panel's minimum is idempotent: the panel
     * stays at its floor until the pointer returns past the boundary
     * coordinate. The stored sizes for both affected panels are updated so the
     * next `doLayout` call preserves the user-defined split ratio.
     *
     * This clamp is deliberately not core/DragChain.ts's N-way chainRoom /
     * distributeDragChain mechanism, which Accordion's gutter drag and Table's
     * column-resize drag share: a Split boundary always has exactly two
     * neighbors, so there is no chain to fan out across, and recomputing the
     * clamped size from the fixed drag origin on every move already keeps the
     * pointer glued to the gutter on reversal — a property that mechanism's
     * incremental per-move model has to rebuild by hand with a tracked
     * last-pointer field.
     */
    onDrag(container: Component, gutter: SplitGutter, position: number) {
        let gutterIdx = this._gutters.indexOf(gutter);
        let lhs = container.getLaidOutComponents()[gutterIdx];
        let rhs = container.getLaidOutComponents()[gutterIdx + 1];

        const horizontal = this._orientation === "horizontal";
        const total      = this._dragOriginLhsSize + this._dragOriginRhsSize;
        const newLhs     = this.resolveLhsSize(this.pairBounds(lhs, rhs, horizontal), position);
        const newRhs     = total - newLhs;
        const dragAmount = newLhs - (horizontal ? lhs.getWidth() : lhs.getHeight());

        if (horizontal) {
            lhs.setWidth(newLhs);
            gutter.setX(gutter.getX() + dragAmount);
            rhs.setX(rhs.getX() + dragAmount);
            rhs.setWidth(newRhs);
        } else {
            lhs.setHeight(newLhs);
            gutter.setY(gutter.getY() + dragAmount);
            rhs.setY(rhs.getY() + dragAmount);
            rhs.setHeight(newRhs);
        }

        this._sizes.set(lhs, newLhs);
        this._sizes.set(rhs, newRhs);

        // A collapsed neighbour whose content is out gets its box only, as in
        // `commitPanes`: its own layout must not run while it stays collapsed.
        if (!this._undisplayedPaneContent.has(lhs)) {
            lhs.doLayout();
        }

        if (!this._undisplayedPaneContent.has(rhs)) {
            rhs.doLayout();
        }
    }

    /**
     * The two panes' main-axis bounds for one drag, read through the collapse
     * snapshots: the divider beside a collapsed pane is still draggable, and
     * that pane's live bounds read deflated with its content out.
     *
     * @param lhs - The pane on the gutter's leading side.
     * @param rhs - The pane on its trailing side.
     * @param horizontal - Whether the split's main axis is the x axis.
     *
     * @returns Both panes' minimum and maximum main-axis extents.
     */
    private pairBounds(lhs: Component, rhs: Component, horizontal: boolean): PairBounds {
        const lhsMin = this.paneMinSize(lhs);
        const rhsMin = this.paneMinSize(rhs);
        const lhsMax = this.paneMaxSize(lhs);
        const rhsMax = this.paneMaxSize(rhs);

        return {
            minLhs: lhsMin ? (horizontal ? lhsMin.width : lhsMin.height) : 0,
            minRhs: rhsMin ? (horizontal ? rhsMin.width : rhsMin.height) : 0,
            maxLhs: lhsMax ? (horizontal ? lhsMax.width : lhsMax.height) : Number.POSITIVE_INFINITY,
            maxRhs: rhsMax ? (horizontal ? rhsMax.width : rhsMax.height) : Number.POSITIVE_INFINITY,
        };
    }

    /**
     * The leading pane's new main-axis size for one pointer position: the drag
     * origin plus the pointer's travel, clamped to the pane's own
     * `[min, max]` AND to the room its partner's `[min, max]` leaves, keeping
     * the pair's combined size constant. `min = max` on either pane pins the
     * gutter. The pure half of one drag frame, so the outline preview and the
     * live apply can never disagree about where the gutter lands.
     *
     * @param bounds - The pair's bounds, from {@link pairBounds}.
     * @param position - The absolute pointer coordinate in the split axis.
     *
     * @returns The clamped main-axis size for the leading pane.
     */
    private resolveLhsSize(bounds: PairBounds, position: number): number {
        const total  = this._dragOriginLhsSize + this._dragOriginRhsSize;
        const offset = position - this._dragOriginPointer;
        const loLhs  = Math.max(bounds.minLhs, total - bounds.maxRhs);
        const hiLhs  = Math.min(bounds.maxLhs, total - bounds.minRhs);

        return Math.max(loLhs, Math.min(hiLhs, this._dragOriginLhsSize + offset));
    }

    /**
     * Where the outline goes for one buffered move: the gutter's own line,
     * shifted by the size the leading pane would take on minus the size it
     * had when the drag began.
     *
     * @param frame - The buffered move.
     *
     * @returns The outline's box, or `null` when no outline drag is live.
     */
    private previewDrag(frame: SplitDragFrame): OutlineRect | null {
        const outline = this._outlineDrag;

        if (outline === null) {
            return null;
        }

        const travel = this.resolveLhsSize(outline.bounds, frame.position) - this._dragOriginLhsSize;

        return this._orientation === "horizontal"
            ? { ...outline.line, x: outline.line.x + travel }
            : { ...outline.line, y: outline.line.y + travel };
    }

    /**
     * Buffers a gutter's `drag` event in the shared per-frame drag session,
     * which applies at most one per animation frame — laying it out in live
     * mode, moving the outline in outline mode. A native `mousemove` fires far
     * more often than the screen repaints, and `onDrag` is not cheap: it
     * triggers a real `doLayout()` of both adjacent panes on every call — for
     * two plain panels that is negligible, but a pane hosting something like a
     * mounted `CodeEditor` reacts to its own width change with an internal
     * remeasure, so an unthrottled drag can end up running that whole chain
     * once per raw pointer-move rather than once per rendered frame, visibly
     * stuttering the gutter under a fast real drag. Only the most recent
     * event before a frame lands is kept — an intermediate position between
     * two `mousemove` events was never going to be visible anyway.
     *
     * @param container - The gutter's owning container, forwarded to `onDrag`.
     * @param gutter - The gutter being dragged, forwarded to `onDrag`.
     * @param position - The absolute pointer coordinate (`clientX`/`clientY`)
     *   in the split axis for this move.
     */
    private scheduleDrag(container: Component, gutter: SplitGutter, position: number): void {
        this._resizeDrag.schedule({ container, gutter, position });
    }

    /**
     * Ends a gutter drag: the session flushes the freshest buffered move — so
     * the committed sizes always reflect the pointer's actual last position
     * rather than whichever buffered position a frame boundary happened to
     * catch, and so this resolves at all offline, where the
     * `requestAnimationFrame` it scheduled never fires (see DOMSink) — and in
     * outline mode lays that move out once. Then fires `paneresize` with the
     * post-drag sizes, the commit-grained signal a consumer persists, as
     * opposed to the per-frame `drag` a gutter itself emits. A cancelled
     * outline drag commits nothing and fires nothing.
     */
    private onDragEnd(): void {
        const committed = this._resizeDrag.end();

        this._outlineDrag = null;

        if (committed) {
            this.emit("paneresize", this.getPaneSizes());
        }
    }

    /**
     * Builds and shows a gutter's right-click context menu: lock the gutter
     * against dragging, pin either neighbouring pane's size against container
     * resizes, and choose which neighbour the gutter collapses. Rows are
     * assembled fresh from live state on every open, so `checked`/`enabled`
     * always reflect the current gutter and pane state. A no-op when the split
     * has no container, or when the gutter index has no pane on one side (a
     * non-displayed pane can shift `getLaidOutComponents()` against the
     * gutter's creation-time index — the same exposure the sibling `collapse`
     * handler already carries).
     *
     * @param gutter - The gutter that was right-clicked.
     * @param gutterIndex - The gutter's index between panes `gutterIndex` and `gutterIndex + 1`.
     * @param x - Horizontal viewport coordinate of the click.
     * @param y - Vertical viewport coordinate of the click.
     */
    private openGutterMenu(gutter: SplitGutter, gutterIndex: number, x: number, y: number): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const components = container.getLaidOutComponents();
        const lead = components[gutterIndex];
        const next = components[gutterIndex + 1];

        if (!lead || !next) {
            return;
        }

        const horizontal = this._orientation === "horizontal";
        const leadWord    = horizontal ? "left"  : "top";
        const nextWord    = horizontal ? "right" : "bottom";
        const extentWord  = horizontal ? "width" : "height";

        const target = this.gutterTargetPane(gutterIndex, components);

        let collapseLeadRow: RadioMenuRow | null = null;
        let collapseNextRow: RadioMenuRow | null = null;

        // The two collapse rows are one choice, and a RadioMenuRow click only ever
        // selects, so right after a click BOTH rows read as selected until this
        // runs: it recomputes the live target and writes both rows from it, which
        // clears the sibling — and puts the clicked row back if the retarget did
        // not take (a container or pane lookup that bailed). The optional calls
        // cover a test that builds one factory without the other; `Menu` always
        // calls every factory before the panel is interactive.
        const syncCollapseRows = (): void => {
            const live = this.gutterTargetPane(gutterIndex, components);

            collapseLeadRow?.setChecked(live === gutterIndex);
            collapseNextRow?.setChecked(live === gutterIndex + 1);
        };

        const configs: MenuItemConfig[] = [
            {
                row: () => {
                    const row = new CheckboxMenuRow({ text: "Lock gutter", checked: !gutter.isMovable() });

                    row.on("action", () => {
                        gutter.setMovable(!gutter.isMovable());
                        container.scheduleLayout();
                    });

                    return row;
                },
            },
            { separator: true },
            {
                row: () => {
                    const row = new CheckboxMenuRow({
                        text:    `Fix ${leadWord} pane ${extentWord}`,
                        checked: this.getPaneResizeWeight(lead) === 0,
                    });

                    row.on("action", () => { this.togglePaneResizePin(lead); });

                    return row;
                },
            },
            {
                row: () => {
                    const row = new CheckboxMenuRow({
                        text:    `Fix ${nextWord} pane ${extentWord}`,
                        checked: this.getPaneResizeWeight(next) === 0,
                    });

                    row.on("action", () => { this.togglePaneResizePin(next); });

                    return row;
                },
            },
            { separator: true },
            {
                row: () => {
                    const row = new RadioMenuRow({
                        text:    `Collapse ${leadWord} pane`,
                        checked: target === gutterIndex,
                        enabled: !gutter.isOpaque() && this.paneCollapsible(lead),
                    });

                    row.on("action", () => {
                        this.retargetGutterCollapse(gutterIndex, gutterIndex);
                        syncCollapseRows();
                    });

                    collapseLeadRow = row;

                    return row;
                },
            },
            {
                row: () => {
                    const row = new RadioMenuRow({
                        text:    `Collapse ${nextWord} pane`,
                        checked: target === gutterIndex + 1,
                        enabled: !gutter.isOpaque() && this.paneCollapsible(next),
                    });

                    row.on("action", () => {
                        this.retargetGutterCollapse(gutterIndex, gutterIndex + 1);
                        syncCollapseRows();
                    });

                    collapseNextRow = row;

                    return row;
                },
            },
        ];

        this._contextMenu ??= new Menu();
        this._contextMenu.show(x, y, configs);
    }

    /**
     * Toggles a pane's resize pin: pins it at its current size (`weight: 0`)
     * when unpinned, or clears the pin (restoring proportional resizing) when
     * already pinned. Mirrors the exact inverse the menu row checks —
     * {@link getPaneResizeWeight}`(pane) === 0` — so the checkbox can never get
     * stuck checked.
     *
     * @param pane - The pane whose resize pin to toggle.
     */
    private togglePaneResizePin(pane: Component): void {
        this.setPaneResizeWeight(pane, this.getPaneResizeWeight(pane) === 0 ? undefined : 0);
    }

    /**
     * Repoints a gutter's collapse target between its two neighbours by writing
     * their `collapseDirection` constraint, then schedules a layout so the
     * chevron re-syncs through `doLayout`'s existing `setCollapseDirection`
     * calls (the single place that writes it). Targeting the leading pane also
     * pushes the trailing neighbour's direction back to the leading heading —
     * `gutterTargetPane` tests the trailing neighbour first, so it would
     * otherwise keep claiming the gutter.
     *
     * @param gutterIndex - The gutter between panes `gutterIndex` and `gutterIndex + 1`.
     * @param targetIndex - The pane index the gutter should collapse: `gutterIndex` or `gutterIndex + 1`.
     */
    private retargetGutterCollapse(gutterIndex: number, targetIndex: number): void {
        const container = this.getContainer();
        if (!container) {
            return;
        }

        const components = container.getLaidOutComponents();
        const lead = components[gutterIndex];
        const next = components[gutterIndex + 1];

        if (!lead || !next) {
            return;
        }

        const leadingHeading  = this._orientation === "horizontal" ? "west" : "north";
        const trailingHeading = this._orientation === "horizontal" ? "east" : "south";

        if (targetIndex === gutterIndex) {
            this.setPaneCollapseDirection(lead, leadingHeading);
            this.setPaneCollapseDirection(next, leadingHeading);
        } else {
            this.setPaneCollapseDirection(next, trailingHeading);
        }

        container.scheduleLayout();
    }

    /**
     * Writes a pane's `collapseDirection` constraint in place, preserving every
     * other field the caller set (`collapsible`, `weight`, …) on that pane's
     * `LayoutConstraints`. A pane with no constraints yet gets a fresh,
     * otherwise-inert one.
     *
     * @param pane - The pane whose collapse heading to set.
     * @param direction - The collapse heading to write.
     */
    private setPaneCollapseDirection(pane: Component, direction: CollapseDirection): void {
        const constraints = this.getLayoutConstraints(pane) ?? new LayoutConstraints();

        constraints.collapseDirection = direction;

        this.setLayoutConstraints(pane, constraints);
    }

    /**
     * Associates this layout manager with a container component, then
     * registers with {@link FocusReveal} so a hidden target inside a collapsed
     * pane can be revealed before it is focused.
     *
     * @param container - The container component to attach to.
     */
    attach(container: Component): this {
        super.attach(container);

        FocusReveal.register(this);

        return this;
    }

    /** @inheritDoc */
    getRevealElement(): Handle | null {
        return this.getContainer()?.getElement() ?? null;
    }

    /**
     * {@link FocusRevealer.revealDescendant}: expands whichever pane is on the
     * DOM path to `target`, if it is currently collapsed.
     *
     * @param target - The element to reveal.
     */
    revealDescendant(target: Handle): void {
        const container = this.getContainer();

        if (!container) {
            return;
        }

        const panes = container.getLaidOutComponents();

        for (let i = 0; i < panes.length; i++) {
            const el = panes[i].getElement();

            if (el && DOM.source.contains(el, target)) {
                if (this.isPaneCollapsed(i)) {
                    this.setPaneCollapsed(i, false);
                }

                return;
            }
        }
    }

    /**
     * Detaches from the container and removes all gutter elements from the DOM.
     */
    detach() : this {
        FocusReveal.unregister(this);

        // Abandon any in-flight collapse first: its primed transitions carry
        // fallback timers that would otherwise outlive the element handles
        // teardown releases.
        this._collapseAnimation?.();
        this._collapseAnimation = null;

        // That canceller's `onIdle` is the only place `_collapsing` is cleared,
        // and cancelling suppressed it; left set, the idle reconcile sweep
        // would never run again (see Border.detach).
        this._collapsing = false;

        // Same idea for a drag still in progress (see scheduleDrag): a
        // buffered frame would fire after this detach against panes
        // `gutter.dispose()` below tears down, and an outline would outlive
        // the container.
        this._resizeDrag.cancel();
        this._outlineDrag = null;

        // Two shapes of detach. A manager swap leaves the panes mounted, so
        // their primed transitions must be settled — cleared — or each keeps a
        // live transition and a permanent compositor layer. A dispose reaches
        // here from `Component.destructor`, which already destroyed the
        // children (so `getComponents()` is empty), and touching one would
        // write through a released element handle: cancel silently instead.
        const survives = (this.getContainer()?.getComponents().length ?? 0) > 0;

        for (const transition of this._pendingCollapseTransitions) {
            if (survives) {
                transition.settle();
            } else {
                transition.cancel();
            }
        }
        this._pendingCollapseTransitions.length = 0;

        // A collapsed pane's undisplayed content and suspended clamp are this
        // manager's doing, and no other manager knows to undo them: a swap
        // would leave the content out forever, and a pane parked before the
        // old tree is disposed (the LayoutSerialization restore shape) would
        // be re-collapsed by its fresh manager with nothing left to record.
        // Every recorded child that is still alive and still this manager's
        // to put back is put back: one the pane still owns, or one parked
        // with no owner — a leaf `LayoutSerialization.parkLeaves` lifted out
        // of a Tab-managed pane before the tear-down, which a fresh manager
        // re-collapsing its stack must find displayed to record. A child
        // re-homed under another owner is that owner's now (it may be an
        // inactive page there) and is left alone. Liveness is `isDestroyed()`,
        // not the parent link — `Component.destructor` clears a container's
        // child list but not the children's parent links, and
        // `disposeAllComponents` clears the links but destroys the children —
        // so a link alone says nothing. The clamp reset is a plain field
        // write, safe on a destroyed pane.
        for (const [pane, snapshot] of this._undisplayedPaneContent) {
            pane.setContentClampSuspended(false);

            for (const child of snapshot.displayed) {
                const parent = child.getParentComponent();

                if (!child.isDestroyed() && (parent === null || parent === pane)) {
                    child.setDisplayed(true);
                }
            }
        }

        this._undisplayedPaneContent.clear();
        this._pendingScrollRestore.clear();

        super.detach();

        for (const gutter of this._gutters) {
            let gutterElement = gutter.getElement()!;
            DOM.sink.removeChild(DOM.source.getParentNode(gutterElement)!, gutterElement);
            gutter.dispose();
        }

        this._gutters = [];

        this._contextMenu?.dispose();
        this._contextMenu = null;

        return this;
    }

    /**
     * Returns the combined pixel footprint of all gutters for a given pane
     * count: one gutter sits between each adjacent pane pair.
     *
     * @param componentCount - The number of panes in the container.
     *
     * @returns The total gutter thickness along the split axis.
     */
    private gutterTotal(componentCount: number): number {
        return Math.max(0, componentCount - 1) * GUTTER_SIZE;
    }

    /**
     * Computes the children's combined minSize along this manager's geometry:
     * along the split axis the per-pane `_sizes` are the user's floor (their
     * sum is the total); the cross-axis follows the max child minSize. Used
     * by `doLayout` to inflate the working size when the host has opted into
     * `setOverflowing`.
     *
     * @returns The total min-size; `{ width: 0, height: 0 }` when the
     *   container is absent.
     */
    protected computeTotalMinSize(): Size {
        const container = this.getContainer();
        if (!container) {
            return { width: 0, height: 0 };
        }

        const components = container.getLaidOutComponents();
        if (components.length === 0) {
            return { width: 0, height: 0 };
        }

        const gutterCount = components.length - 1;

        let splitTotal = 0;
        let crossMax = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const stored    = this._sizes.get(component);
            const collapsed = this._collapsed.get(component) ?? false;
            const hasGutter = idx < gutterCount;

            if (collapsed && hasGutter) {
                // The gutter→strip covers this pane's whole slot: a single
                // strip thickness, no separate divider.
                splitTotal += COLLAPSE_STRIP_SIZE;
            } else {
                if (!collapsed) {
                    if (stored != null) {
                        splitTotal += stored;
                    } else {
                        const min = component.getMinSize();
                        if (min) {
                            splitTotal += this._orientation === "horizontal" ? min.width : min.height;
                        }
                    }
                }

                if (hasGutter) {
                    splitTotal += GUTTER_SIZE;
                }
            }

            const min = this.paneMinSize(component);
            if (min) {
                crossMax = Math.max(crossMax, this._orientation === "horizontal" ? min.height : min.width);
            }
        }

        return this._orientation === "horizontal"
            ? { width: splitTotal, height: crossMax }
            : { width: crossMax,   height: splitTotal };
    }

    /**
     * Creates missing gutters, computes panel sizes, and positions all panels and gutters.
     *
     * @remarks New [`SplitGutter`](/api/component/container/classes/SplitGutter) instances are appended to the container's DOM element on first layout.
     * Existing gutters are reused on subsequent layouts.
     */
    doLayout() {
        let me = this;
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        // The un-inflated inner main extent the displayed panes share — captured
        // before the overflow inflation below so `computeMainAxisSizes` fills the
        // true viewport (matching the pre-displayed Σ-stored basis).
        const innerMain = this._orientation === "horizontal" ? containerSize.width : containerSize.height;

        // Universal scroll: see HBox.doLayout for the rationale. When the
        // host has marked the corresponding axis as overflowing, grow the
        // working size past the host's inner rect so trailing panes land
        // past `innerSize` and the host's CSS `overflow: auto` produces a
        // scrollbar.
        containerSize = this.inflateForOverflow(containerSize);

        let element = container.getElement()!;
        // The visible layout is driven by the displayed panes: a non-displayed
        // pane (and its gutter) drops out entirely, neighbours reflowing to fill.
        // `recalculateSizes`/`_sizes` bookkeeping below still spans the full child
        // list, so a hidden pane keeps its stored size for a later restore.
        let components = container.getLaidOutComponents();
        let containerInsets = container.getContentInsets();

        let componentCount = components.length;
        let gutterCount = componentCount - 1;

        for (let i = this._gutters.length; i < gutterCount; i += 1) {
            // Transparent divider track (like Border): only the chevron grip
            // shows in the expanded state; the gutter paints itself only once
            // collapsed into its button-styled strip.
            let gutter = new SplitGutter(this._orientation, { expandedBackground: "transparent", collapseTrigger: this._collapseTrigger });
            let gutterIndex = i;

            gutter.on("dragstart", function (position: number) {
                me.onDragStart(<Component>container, gutter, position);
            });
            gutter.on("drag", function (position: number) {
                me.scheduleDrag(<Component>container, gutter, position);
            });
            gutter.on("dragend", () => this.onDragEnd());
            gutter.on("collapse", function () {
                // The chevron toggles whichever neighbour this gutter serves —
                // its leading pane by default, or a trailing pane that opted to
                // collapse toward the end.
                const target = me.gutterTargetPane(gutterIndex, (<Component>container).getLaidOutComponents());
                if (target >= 0) {
                    me.setPaneCollapsed(target, !me.isPaneCollapsed(target));
                }
            });
            gutter.on("contextmenu", function (x: number, y: number) {
                me.openGutterMenu(gutter, gutterIndex, x, y);
            });

            this._gutters.push(gutter);

            DOM.sink.appendChild(element, gutter.getElement(true)!);
        }

        let x = containerInsets.getLeft();
        let y = containerInsets.getTop();

        this.recalculateSizes();
        this.applyPendingSizes();
        this.applyPendingCollapsed(components);

        const horizontal = this._orientation === "horizontal";
        const crossSize  = horizontal ? containerSize.height : containerSize.width;
        const mainSizes  = this.computeMainAxisSizes(components, innerMain);

        // Gutters placed this pass (as a strip or a divider); the rest are
        // hidden afterward — e.g. the trailing gutter of a pane collapsed
        // toward the end, whose strip is the leading gutter instead.
        const placed = new Set<number>();
        const placements: SplitPlacement[] = [];

        for (let idx = 0; idx < components.length; idx += 1) {
            const component  = components[idx];
            const servingIdx = this.paneServingGutter(idx, components);
            const collapsed  = (this._collapsed.get(component) ?? false) && servingIdx >= 0;

            if (collapsed) {
                // The serving gutter becomes the opaque strip in this pane's
                // slot; the pane hides behind it. The strip lands in the same
                // slot whichever side the pane collapses toward — only the
                // chevron heading and which gutter animates differ.
                const gutter = this._gutters[servingIdx];

                gutter.setCollapseDirection(this.paneDirection(component));
                gutter.setCollapsible(true);
                placements.push(this.placeGutterAsStrip(gutter, component, x, y, crossSize, horizontal, this.paneDirection(component)));
                placed.add(servingIdx);

                if (horizontal) {
                    x += COLLAPSE_STRIP_SIZE;
                } else {
                    y += COLLAPSE_STRIP_SIZE;
                }

                continue;
            }

            const mainSize = mainSizes.get(component) as number;

            component.setVisible(true);

            // A collapsible pane keeps `inset(0)` as the expanded keyframe so a
            // restore animates its clip back open; a pane that can't collapse
            // carries no clip-path at all.
            placements.push({
                component,
                ...this.resolveBounds(component, x, y, horizontal ? mainSize : crossSize, horizontal ? crossSize : mainSize, FillType.BOTH),
                clipPath: servingIdx >= 0 ? "inset(0 0 0 0)" : null
            });

            if (horizontal) {
                x += mainSize;
            } else {
                y += mainSize;
            }

            if (idx < gutterCount) {
                const gutter = this._gutters[idx];
                const target = this.gutterTargetPane(idx, components);

                // When this gutter is the strip for a collapsed trailing pane,
                // the strip is placed in that pane's own slot — skip the divider
                // here and let the gutter hide between the strip and this pane.
                const targetIsCollapsedStrip = target >= 0
                    && (this._collapsed.get(components[target]) ?? false)
                    && this.paneServingGutter(target, components) === idx;

                if (!targetIsCollapsedStrip && !placed.has(idx)) {
                    // Expanded divider: a thin draggable gutter whose chevron (if
                    // any) collapses the neighbour it serves.
                    gutter.setOpaque(false);
                    gutter.setVisible(true);
                    gutter.setCollapsible(target >= 0);
                    if (target >= 0) {
                        gutter.setCollapseDirection(this.paneDirection(components[target]));
                    }
                    const overhang = gutter.isMovable() ? GUTTER_HIT_OVERHANG : 0;

                    if (horizontal) {
                        gutter.setX(x - overhang);
                        gutter.setY(y);
                        gutter.setWidth(GUTTER_SIZE + 2 * overhang);
                        gutter.setHeight(crossSize);

                        x += GUTTER_SIZE;
                    } else {
                        gutter.setX(x);
                        gutter.setY(y - overhang);
                        gutter.setWidth(crossSize);
                        gutter.setHeight(GUTTER_SIZE + 2 * overhang);

                        y += GUTTER_SIZE;
                    }

                    placed.add(idx);
                }
            }
        }

        this.commitPanes(placements);

        for (let i = 0; i < this._gutters.length; i += 1) {
            if (!placed.has(i)) {
                this._gutters[i].setVisible(false);
            }
        }

        // Idle catch-all for the paths no animation settles — an immediate
        // toggle's scroll restore, a construction-time collapse — and for a
        // pane whose own animation was superseded before its settle could
        // sweep. Never mid-animation, when children must stay displayed for
        // the reveal.
        if (!this._collapsing) {
            this.reconcileCollapsedContent(components);
        }
    }

    /**
     * Places a pane's gutter as the opaque collapse strip occupying the pane's
     * slot, and hides the pane behind it. The gutter is the only visible
     * affordance for a collapsed pane; it animates into this geometry from its
     * expanded divider position.
     *
     * @param gutter - The pane's gutter, repurposed as the strip.
     * @param pane - The collapsed pane, clipped away behind the strip.
     * @param x - The slot's left position.
     * @param y - The slot's top position.
     * @param crossSize - The container's cross-axis extent.
     * @param horizontal - Whether the split runs horizontally.
     * @param direction - The pane's collapse heading, fixing the clip edge.
     * @returns The pane's resolved placement, for the caller to commit.
     */
    private placeGutterAsStrip(gutter: SplitGutter, pane: Component, x: number, y: number, crossSize: number, horizontal: boolean, direction: CollapseDirection): SplitPlacement {
        gutter.setOpaque(true);
        gutter.setVisible(true);
        gutter.setX(x);
        gutter.setY(y);

        if (horizontal) {
            gutter.setWidth(COLLAPSE_STRIP_SIZE);
            gutter.setHeight(crossSize);
        } else {
            gutter.setWidth(crossSize);
            gutter.setHeight(COLLAPSE_STRIP_SIZE);
        }

        // The pane stays visible at its full stored size and clips toward its
        // outer (collapse-direction) edge, retreating into the strip rather than
        // vanishing. It can't shrink past its min-size, so the clip — not a width
        // change — is what hides it. It is anchored at the strip on the side it
        // collapses toward so the retreating edge tucks into the strip.
        const fullMain    = this._sizes.get(pane) ?? COLLAPSE_STRIP_SIZE;
        const towardStart = this.collapsesTowardStart(direction);

        pane.setVisible(true);

        let placement: SplitPlacement;

        if (horizontal) {
            const paneX = towardStart ? x : x + COLLAPSE_STRIP_SIZE - fullMain;
            placement = { component: pane, ...this.resolveBounds(pane, paneX, y, fullMain, crossSize, FillType.BOTH), clipPath: this.paneClipInset(direction) };
        } else {
            const paneY = towardStart ? y : y + COLLAPSE_STRIP_SIZE - fullMain;
            placement = { component: pane, ...this.resolveBounds(pane, x, paneY, crossSize, fullMain, FillType.BOTH), clipPath: this.paneClipInset(direction) };
        }

        return placement;
    }

    /**
     * Commits a collapsed-branch pane's resolved bounds, then its `clip-path` —
     * the hand-off from {@link Split.placeGutterAsStrip}'s resolve step. A pane
     * whose content is out gets its box and nothing more: running its own
     * layout would let a manager that writes its children's displayed state
     * (a `Tab` re-selecting its page) put content back in the render tree
     * behind the strip, undoing exactly what the collapse took out.
     *
     * @param placements - The resolved pane placements to commit, in placement order.
     */
    private commitPanes(placements: SplitPlacement[]): void {
        for (const placement of placements) {
            if (this._undisplayedPaneContent.has(placement.component)) {
                commitRect(placement.component, placement, false);
            } else {
                this.commitBounds(placement.component, placement.x, placement.y, placement.width, placement.height);
            }

            placement.component.setClipPath(placement.clipPath);
        }
    }

    /**
     * Returns the `clip-path` inset that clips a pane toward its outer edge for
     * the given collapse heading, used to animate a collapse into (or expand out
     * of) the strip.
     *
     * @param direction - The collapse heading.
     * @returns A CSS `clip-path` inset string.
     */
    private paneClipInset(direction: CollapseDirection): string {
        switch (direction) {
            case "east":  return "inset(0 0 0 100%)";
            case "north": return "inset(0 0 100% 0)";
            case "south": return "inset(100% 0 0 0)";
            default:      return "inset(0 100% 0 0)";
        }
    }

    /**
     * Drains the `paneSizes` option (or a pre-layout {@link applyPaneSizes}
     * call) into `_sizes` on the first layout, where {@link applyPaneSizes}
     * can resolve the live panes and the container's main-axis budget. Runs
     * once: `applyPaneSizes` re-validates against the live units and
     * discards a stale array whole, so the drain needs no check of its own.
     */
    private applyPendingSizes(): void {
        const pending = this._pendingSizes;

        if (pending === null) {
            return;
        }

        this._pendingSizes = null;

        this.applyPaneSizes(pending);
    }

    /**
     * Drains the `collapsedPanes` option into `_collapsed` on the first layout
     * where the panes are resolvable. Runs once: pane components can't be looked
     * up from indices until the container has its children.
     *
     * @param components - The container's current child panes.
     */
    private applyPendingCollapsed(components: Array<Component>): void {
        if (this._pendingCollapsed.length === 0) {
            return;
        }

        for (const index of this._pendingCollapsed) {
            const pane = components[index];

            // Only a pane with a serving gutter can collapse.
            if (pane && this.paneServingGutter(index, components) >= 0) {
                this._collapsed.set(pane, true);
                this.undisplayPaneContent(pane);
            }
        }

        this._pendingCollapsed = [];
    }

    /**
     * Computes each expanded pane's main-axis extent. A collapsed pane reports
     * `0` — it is hidden and its gutter, rendered as the opaque strip, occupies
     * the `COLLAPSE_STRIP_SIZE` slot in its place. The space the collapsed panes
     * (and the gutter→strip thickness change) free flows back to the expanded
     * panes in proportion to their stored sizes, so the layout always fills the
     * container and the expanded panes keep their relative ratio.
     *
     * @param components - The container's laid-out (displayed) child panes;
     *   non-displayed panes are absent and so neither sized nor gutter-spaced.
     * @param mainInner - The container's inner main-axis extent in px.
     * @returns A map from pane to its displayed main-axis size (`0` when collapsed).
     */
    private computeMainAxisSizes(components: Array<Component>, mainInner: number): Map<Component, number> {
        const gutterCount = components.length - 1;

        let expandedStored = 0;
        let strips         = 0;   // collapsed panes (each turns a gutter into a strip)
        let hiddenDividers = 0;   // gutters hidden by a toward-end collapse

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];

            const collapsed = (this._collapsed.get(component) ?? false) && this.paneServingGutter(idx, components) >= 0;

            if (collapsed) {
                strips += 1;

                // A pane collapsing toward the end uses its *leading* gutter as
                // the strip, leaving its trailing gutter (when it has one)
                // hidden — that 4px divider is reclaimed by the expanded panes.
                if (!this.collapsesTowardStart(this.paneDirection(component)) && idx < gutterCount) {
                    hiddenDividers += 1;
                }
            } else {
                expandedStored += this._sizes.get(component) ?? 0;
            }
        }

        // The expanded panes share the inner main extent net of the GUTTER_SIZE
        // dividers between displayed panes. Derived from `mainInner` rather than
        // Σ stored, because a hidden pane keeps its stored size (frozen for a
        // later restore) yet is absent from `components` — so its slot and gutter
        // are genuinely reclaimed here, and the expanded panes inflate to fill
        // via `factor` without `_sizes` being rewritten (preserving the ratio a
        // re-shown pane returns to). Each collapsed pane's gutter becomes a
        // `COLLAPSE_STRIP_SIZE` strip in place of its `GUTTER_SIZE` divider, the
        // pane yields its whole slot, and any toward-end-hidden divider is
        // reclaimed — so panes + strips + visible dividers still sum to the inner
        // extent.
        const available     = Math.max(0, mainInner - this.gutterTotal(components.length));
        const expandedTotal = Math.max(0, available - strips * (COLLAPSE_STRIP_SIZE - GUTTER_SIZE) + hiddenDividers * GUTTER_SIZE);
        const factor        = expandedStored > 0 ? expandedTotal / expandedStored : 0;

        const sizes = new Map<Component, number>();

        for (let idx = 0; idx < components.length; idx += 1) {
            const component = components[idx];
            const collapsed = (this._collapsed.get(component) ?? false) && this.paneServingGutter(idx, components) >= 0;

            sizes.set(component, collapsed ? 0 : (this._sizes.get(component) ?? 0) * factor);
        }

        return sizes;
    }

    /**
     * Assigns initial sizes to any components that do not yet have a stored size.
     *
     * @remarks When some panels already have stored sizes and a new panel is added,
     * its size is taken proportionally from the existing panels so the total remains constant.
     * When no panels have stored sizes the available container dimension is divided equally.
     */
    recalculateSizes() {
        let container = this.getContainer();
        if (!container) {
            return;
        }

        let containerSize = container.getInnerSize();
        if (!containerSize) {
            return;
        }

        let components = container.getComponents();

        // Drop stored sizes (and collapsed flags, content snapshots, queued
        // scroll restores) for panes that have left the container.
        // `moveComponent`/`removeComponent` give Split no removal hook, so
        // without this the entries would linger forever — skewing the
        // `_sizes.size` check and the refill total below, and leaking memory.
        for (let pane of [...this._sizes.keys()]) {
            if (components.indexOf(pane) < 0) {
                // A pane that left while its content was out is no longer
                // this manager's to clamp on behalf of.
                if (this._undisplayedPaneContent.has(pane)) {
                    pane.setContentClampSuspended(false);
                }

                this._sizes.delete(pane);
                this._collapsed.delete(pane);
                this._undisplayedPaneContent.delete(pane);
                this._pendingScrollRestore.delete(pane);
            }
        }

        // Prune `_weights` in a dedicated pass over its own keys. It cannot ride
        // the `_sizes` loop above: `setPaneResizeWeight` registers a weight
        // independently of `_sizes`, so a pane carrying a weight but no stored
        // size is never visited there and its entry would leak on removal.
        // (`_collapsed` is safe in that loop only because it is never set for a
        // sizeless pane.)
        for (let pane of [...this._weights.keys()]) {
            if (components.indexOf(pane) < 0) {
                this._weights.delete(pane);
            }
        }

        // `getInnerSize` already removed the perimeter (insets + border +
        // padding); the only thing the panes don't get is the gutters, so the
        // space to divide is the inner main axis minus the gutter footprint.
        // `doLayout` places panes from `getContentInsets` and advances by this
        // same gutter total, so a pane sum of `available` lands flush with the
        // inner edge — no `gutterCount × GUTTER_SIZE` overflow.
        let main = this._orientation === "horizontal" ? containerSize.width : containerSize.height;
        let available = Math.max(0, main - this.gutterTotal(components.length));

        const horizontal = this._orientation === "horizontal";

        // Seed first-layout panes from their preferred constraint (HBox model),
        // then re-clamp every stored size to its current [min, max] so a live
        // min/max change (which does not change `available`, so the resize block
        // below is skipped) still snaps the pane into range.
        this.seedFromPreferred(components, horizontal);

        for (const component of components) {
            const stored = this._sizes.get(component);
            if (stored !== undefined) {
                this._sizes.set(component, this.clampMain(component, stored, horizontal));
            }
        }

        // Distribute the extent change across the panes by resize weight so they
        // keep filling the container. Each pane's effective weight is its
        // explicit `setPaneResizeWeight` entry, else its `weight` layout
        // constraint, else its current stored size — so an all-unset Split splits
        // the delta proportionally to size, which is algebraically identical to
        // the old uniform-factor rescale (`old·(Σ+Δ)/Σ`) and preserves any split
        // the user dragged. A weight-0 pane keeps its px size (the delta bypasses
        // it). Skipped on the first connected layout (`_lastAvailableMain` is
        // still 0) and when nothing changed. `weightSum === 0` (every pane
        // pinned) leaves the sizes untouched and lets the `Σ == available` refill
        // below fill uniformly — the only sane outcome when the delta has nowhere
        // to go.
        if (this._lastAvailableMain > 0 && available > 0 && available !== this._lastAvailableMain && this._sizes.size > 0) {
            let delta = available - this._lastAvailableMain;

            let weightSum = 0;
            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                weightSum += this.effectiveResizeWeight(component, this._sizes.get(component) ?? 0);
            }

            if (weightSum > 0) {
                for (let idx = 0; idx < components.length; idx += 1) {
                    let component = components[idx];
                    let stored = this._sizes.get(component);

                    if (stored != undefined) {
                        let weight = this.effectiveResizeWeight(component, stored);
                        this._sizes.set(component, Math.max(0, stored + delta * (weight / weightSum)));
                    }
                }
            }
        }

        // First-layout slack: after seeding, hand the leftover `available − Σseed`
        // to the positively-weighted panes as `seed + (w/Σw)·slack` (base kept,
        // slack shared by weight — HBox-inspired). Runs only on the first connected
        // layout (`_lastAvailableMain === 0`); the resize block above owns every
        // later layout, so the two never co-fire. The `0` fallback means only
        // panes with an actual positive weight absorb slack here (an unset-weight
        // pane is not treated as weight-bearing at seed time — unlike the resize
        // block, which falls back to stored size for proportional rescale). A
        // weighted pane with no seed (a null-preferred absorber like a dock) is
        // given a size here, so it no longer steals from a seeded sibling in the
        // fallback below. When no pane has a positive weight this is skipped and
        // the pin-aware refill reconciles the sum.
        if (this._lastAvailableMain === 0 && available > 0 && this._sizes.size > 0) {
            let weightSum = 0;
            for (let idx = 0; idx < components.length; idx += 1) {
                let weight = this.effectiveResizeWeight(components[idx], 0);
                if (weight > 0) {
                    weightSum += weight;
                }
            }

            if (weightSum > 0) {
                let seedTotal = 0;
                for (let idx = 0; idx < components.length; idx += 1) {
                    seedTotal += this._sizes.get(components[idx]) ?? 0;
                }

                let slack = available - seedTotal;

                for (let idx = 0; idx < components.length; idx += 1) {
                    let component = components[idx];
                    let weight = this.effectiveResizeWeight(component, 0);

                    if (weight > 0) {
                        let seed = this._sizes.get(component) ?? 0;
                        this._sizes.set(component, this.clampMain(component, seed + slack * (weight / weightSum), horizontal));
                    }
                }
            }
        }

        let componentsWithSize = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];

            if (this._sizes.has(component)) {
                componentsWithSize += 1;
            }
        }

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let componentSize = this._sizes.get(component);

            if (componentSize == undefined) {
                if (this._sizes.size != 0) {
                    componentSize = 0;

                    for (let jdx = 0; jdx < components.length; jdx += 1) {
                        let c = components[jdx];
                        let cSize = this._sizes.get(c);

                        if(cSize == undefined) {
                            continue;
                        }

                        let sizeFraction = cSize * (1 / (componentsWithSize + 1));
                        componentSize += sizeFraction;
                        cSize -= sizeFraction;

                        this._sizes.set(c, cSize);
                    }
                } else {
                    componentSize = available;
                }

                this._sizes.set(component, componentSize);
                componentsWithSize += 1;
            }
        }

        // After the steps above every live pane has a stored size, but their
        // sum can fall short of `available` when a pane was *removed* since the
        // last layout (its slot freed but no survivor reclaimed it — e.g. a tab
        // torn off, or a pane moved out while being wrapped in a nested Split), or
        // when a live min/max change re-clamped a pane (the resize block is skipped
        // then, because `available` is unchanged). `computeMainAxisSizes`/`doLayout`
        // place panes at their raw stored sizes, so a short sum strands a trailing
        // gap. Normalise back to the `Σ == available` invariant — but hold the
        // pinned panes and rescale only what can absorb. Panes fall in three
        // tiers: single-point (min == max) pins never move; weight-0 pins hold
        // their px while the container has room for them, and yield
        // proportionally when it does not; everything else flexes. With no
        // pinned pane of either kind this is the original uniform refill,
        // byte-for-byte.
        let pinnedTotal       = 0;
        let weightPinnedTotal = 0;
        let flexibleTotal     = 0;

        for (let idx = 0; idx < components.length; idx += 1) {
            let component = components[idx];
            let stored = this._sizes.get(component) ?? 0;

            // A pane that is both single-point and weight-0 counts as single-point:
            // the stronger pin wins, so the cascade below never yields its one extent.
            if (this.isPinnedMain(component, horizontal)) {
                pinnedTotal += stored;
            } else if (this.isResizePinnedMain(component)) {
                weightPinnedTotal += stored;
            } else {
                flexibleTotal += stored;
            }
        }

        if (available > 0) {
            // Room left after the single-point pins, which never yield.
            let budget = Math.max(0, available - pinnedTotal);

            // Per-tier refill scale; `1` holds the tier at its stored size.
            let pinnedScale       = 1;
            let weightPinnedScale = 1;
            let flexibleScale     = 1;

            if (flexibleTotal > 0 && budget >= weightPinnedTotal) {
                // The budget covers the weight-0 pins: hold every pin and let the
                // flexible panes take the remainder. With no weight-0 pane this is the
                // original `max(0, available − Σpinned) / flexibleTotal`, byte-for-byte.
                flexibleScale = (budget - weightPinnedTotal) / flexibleTotal;
            } else if (weightPinnedTotal > 0) {
                // Either nothing flexible is left, or the weight-0 pins alone overrun
                // the budget. The flexible panes squeeze to 0 and the weight-0 pins
                // yield proportionally — a weight-0 pin holds only while the container
                // is large enough (`setPaneResizeWeight`). When there are no
                // single-point pins and nothing flexible, this is the uniform rescale
                // the all-weights-0 config has always produced.
                flexibleScale     = 0;
                weightPinnedScale = budget / weightPinnedTotal;
            } else if (pinnedTotal > 0) {
                // Every pane is single-point pinned: uniform fill — the only sane
                // outcome when nothing can flex.
                pinnedScale = available / pinnedTotal;
            }

            for (let idx = 0; idx < components.length; idx += 1) {
                let component = components[idx];
                let stored = this._sizes.get(component);

                if (stored == undefined) {
                    continue;
                }

                let scale = this.isPinnedMain(component, horizontal)
                    ? pinnedScale
                    : (this.isResizePinnedMain(component) ? weightPinnedScale : flexibleScale);

                if (scale !== 1) {
                    this._sizes.set(component, stored * scale);
                }
            }
        }

        // Only remember a positive extent. If the container collapsed below the
        // gutter footprint (`available == 0`) the stored sizes were left frozen,
        // so keeping the last positive baseline lets the next growth rescale
        // them back to fill instead of stranding the pre-collapse sizes.
        if (available > 0) {
            this._lastAvailableMain = available;
        }
    }
}

const SplitCallable = callable(Split);
type SplitCallable = Split;
export {
    Split         as _Split,
    SplitCallable as Split
};
