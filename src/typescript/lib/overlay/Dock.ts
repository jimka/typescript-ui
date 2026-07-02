// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { AbstractWindow } from "~/overlay/AbstractWindow.js";
import { TabWindow } from "~/overlay/TabWindow.js";
import { Fit } from "~/layout/Fit.js";
import { Tab } from "~/layout/Tab.js";
import { Split } from "~/layout/Split.js";
import { DockRegion } from "~/layout/DockRegion.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { serializeLayout, restoreLayout, LayoutState } from "~/layout/LayoutSerialization.js";
import { DragManager, DragEventDetail, tabDragRegistry } from "~/overlay/DragManager.js";
import { DropZoneOverlay } from "~/overlay/DropZoneOverlay.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import { DOM } from "~/core/DOM.js";
import { Animation } from "~/core/Animation.js";
import { FillType } from "~/layout/FillType.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import type { AxisOrientation } from "~/primitive/Axis.js";

/**
 * Declarative description of one dockable content panel.
 *
 * @category Core
 */
export interface DockPanelSpec {
    /**
     * Stable identity. `Dock` builds an identity frame whose `getId()` is this
     * value (set at the frame's construction), and serialization keys on it — so
     * restored layouts round-trip against it. Keep it stable across sessions.
     */
    id:       string;
    /**
     * Visible tab label and tear-off window title. Set as the identity frame's
     * `getName()`; it rides on the frame (not a per-container constraint), so it
     * survives the re-home a restore performs.
     */
    title:    string;
    /** Optional registry glyph name shown leading the tab label. */
    glyph?:   string;
    /** Optional hover-tooltip text shown over the tab button. */
    tooltip?: string;
    /** Whether the tab shows a close button. Defaults to `true`. */
    closeable?: boolean;
    /** The content: a live component, or a lazy factory built on first resolve. It is placed inside the identity frame, never mutated. */
    content:  Component | (() => Component);
}

/**
 * A node in the declarative initial arrangement: a leaf panel, a split of
 * regions, or a tab group.
 *
 * @category Core
 */
export type DockLayoutSpec =
    | DockPanelSpec
    | { split: AxisOrientation; children: DockLayoutSpec[] }
    | { tabs: DockPanelSpec[] };

/**
 * Construction options for a {@link Dock}.
 *
 * @category Core
 */
export interface DockOptions extends ContainerOptions {
    /** Initial arrangement, compiled to the region tree at construction. Omit for an empty dock. */
    layout?: DockLayoutSpec;
    /**
     * Placeholder shown only while the dock holds no live panel (tiled or
     * floated) — a start-page for an empty dock. It is shown as a single
     * non-closeable tab in the empty region and is chrome, not a panel: it is
     * never serialized. See {@link Dock.setEmptyContent}.
     */
    emptyContent?: Component;
}

/**
 * String-literal union of the events a {@link Dock} emits across a panel's
 * lifecycle.
 *
 * The model is *host-centric*: a live panel always occupies one Dock-managed
 * *host* — the *tiled tree* (the main dock) or a *float window* — and the events
 * name the host transitions. `"attach"` fires when a panel **enters** a host (a
 * fresh `addPanel`/restore into the tiled tree, or a tear-off into a fresh
 * float); `"detach"` fires when it **leaves** a host while staying alive. The
 * two pair up across a move: a tear-off is `"detach"`(tiled) then
 * `"attach"`(float), and a re-dock — whether dropped on a region body/edge or
 * merged onto an existing tab bar — is `"detach"`(float) then `"attach"`(tiled).
 * `"moved"` fires when a panel **relocates within** its current host — a
 * different region in the same tiled tree, or repositioned in the same float —
 * without changing host; it never accompanies a host change (that is
 * `"detach"`+`"attach"`) nor a first appearance (that is `"attach"` alone), and
 * a pure reorder within one strip is silent. `"focus"` fires when the dock-wide
 * active panel changes (across tiled tabs and floats; `null` when nothing is
 * focused), and `"close"` when a panel is destroyed. The
 * {@link DockPanelEvent.window} field names *which* host the panel entered,
 * left, occupies, or moved within. See {@link DockPanelEvent} for the payload.
 *
 * A separate `"emptychange"` event is a *dock-wide aggregate*, not a per-panel
 * event: it fires once each time the dock transitions between holding no live
 * panel anywhere and holding at least one, carrying a {@link DockEmptyEvent}.
 *
 * @category Core
 */
export type DockEvent = "attach" | "detach" | "moved" | "focus" | "close" | "emptychange";

/**
 * Payload for a {@link Dock} lifecycle event, identifying the panel by its
 * stable {@link DockPanelSpec.id}, carrying its Dock-owned identity frame, and
 * naming the host the event concerns.
 *
 * @category Core
 */
export interface DockPanelEvent {
    /** The stable id of the panel (its {@link DockPanelSpec.id}). */
    id:      string;
    /** The panel's Dock-owned identity frame. */
    content: Component;
    /**
     * The host the panel entered (`"attach"`), left (`"detach"`), moved within
     * (`"moved"` — same host before and after), or currently occupies
     * (`"focus"`): `null` denotes the tiled tree / main dock, otherwise the float
     * window. Always `null` for `"close"` — a destroy is not a host transition,
     * but the field is always present so the payload stays flat.
     */
    window:  AbstractWindow | null;
}

/**
 * Payload for a {@link Dock} `"emptychange"` event, reporting whether the dock
 * just became empty. Emitted once per real transition, not per panel.
 *
 * @category Core
 */
export interface DockEmptyEvent {
    /** `true` when the dock just became empty (no live panels anywhere), `false` when it became populated. */
    empty: boolean;
}

/**
 * Per-region drag-and-drop wiring tracked by the re-wire sweep.
 */
interface RegionWiring {
    /** The region's edge/centre drop coordinator (torn down on teardown). */
    dockRegion: DockRegion;
    /** Whether `setReorderable(true)` + the prune-on-`"empty"` subscription were applied (Tab regions only). */
    tabWired:   boolean;
}

/**
 * A user-configurable, rearrangeable panel layout — the VS Code / GoldenLayout
 * style dock. It hosts a tree of [`Split`](/api/layout/classes/Split) /
 * [`Tab`](/api/layout/classes/Tab) regions whose panels the user can reorder,
 * tear off into floating [`Window`](/api/overlay/classes/Window)s, drop on region
 * edges to split, and save/restore.
 *
 * `Dock` is **glue**, not new drag mechanics: tab reorder + tear-off come from
 * `Tab`'s reorderable wiring, edge-split-on-drop from
 * [`DockRegion`](/api/layout/classes/DockRegion), every re-parent from
 * [`Component.moveComponent`](/api/core/classes/Component#movecomponent), and
 * persistence from
 * [`serializeLayout`](/api/layout/functions/serializeLayout) /
 * [`restoreLayout`](/api/layout/functions/restoreLayout). `Dock` owns the panel
 * registry (the serialization factory), the declarative initial-layout
 * compiler, and the re-wire sweep that keeps **every** region dockable —
 * including the regions a drop creates mid-gesture.
 *
 * @category Core
 */
class Dock extends Container<DockOptions> {

    // panelId -> spec; the single source the serialization factory resolves from.
    private _panels:         Map<string, DockPanelSpec> = new Map<string, DockPanelSpec>();
    // panelId -> the Dock-owned identity frame built for that spec (cached so a
    // lazy factory runs once and every resolve returns the same instance).
    private _frames:         Map<string, Component> = new Map<string, Component>();
    // panelId -> deferred content factory for a lazy panel (see addLazyPanel),
    // present only until the panel is first activated and its content realized.
    // Its presence is also what tells resolvePanel to build the frame empty.
    private _lazyFactories:  Map<string, () => Component> = new Map<string, () => Component>();
    // region container -> its DnD wiring; the sweep's idempotence + teardown ledger.
    private _wiring:         Map<Component, RegionWiring> = new Map<Component, RegionWiring>();
    // rAF coalescing latch so a burst of moves in one gesture yields one sweep.
    private _sweepScheduled: boolean = false;

    // Panel-lifecycle event bag. A field initialiser is safe here: no
    // cascade-dispatched setter touches it, and Dock exposes no construction-time
    // `listeners` option (no DockEvent is a build-time gesture — addPanel /
    // compileLayout run after super()), so it is never dispatched from
    // applyOptions. Consumers wire post-construction via on(...).
    private _listeners:      ListenerBag<DockEvent> = new ListenerBag<DockEvent>();
    // The dock-wide focused panel id, or null when nothing is focused. The single
    // source of truth gating every "focus" emit so a re-activation is silent.
    private _focusedPanelId: string | null = null;
    // panelId -> last-observed host (null = tiled tree, else the float window);
    // the source of the attach/detach diff. A host change across a sweep emits
    // detach(old host) then attach(new host); a first appearance emits attach only.
    private _panelHost:      Map<string, AbstractWindow | null> = new Map<string, AbstractWindow | null>();
    // panelId -> the Tab region last observed hosting it; lets a close recompute
    // the surviving sibling's focus after the region re-selects.
    private _frameRegion:    Map<string, Component> = new Map<string, Component>();
    // The Tab region the user most recently focused (or that last received a
    // programmatic add). `addPanel` docks new panels here when it is still a live
    // region, so a new tab opens beside whatever tab-bar the user last worked in
    // rather than always the first/primary region. Null until the first add.
    private _lastActiveRegion: Component | null = null;
    // Float windows whose lifecycle events are already subscribed; the tracked-set
    // guard that stops a re-sweep stacking duplicate listeners.
    private _floatSubscribed: Set<AbstractWindow> = new Set<AbstractWindow>();

    // Overlay highlighting the dock as a drop target while it is empty (every
    // panel torn off) and a tab is dragged over it.
    private _emptyDropOverlay: DropZoneOverlay = new DropZoneOverlay();

    // Empty-state latch: whether the dock currently holds no live panel. Gates
    // the "emptychange" emit so it fires only on a real transition. Seeded true
    // because a dock is born empty: the first reconcile on a still-empty dock then
    // finds no transition (silent), while a dock born with a layout — or the first
    // addPanel — correctly flips it to false and emits emptychange(false). A plain
    // initializer is safe — no cascade-dispatched setter writes it.
    private _empty: boolean = true;
    // Whether reconcileEmptyState has run at least once. Gates only the
    // "emptychange" emit: the first run adopts the born emptiness without an emit
    // (being born empty or populated is not a transition). The placeholder itself
    // is re-asserted every sweep from the main-region emptiness, independent of
    // this latch.
    private _emptyReconciled: boolean = false;

    // Named, bound listener reference for the DockRegion post-drop callback,
    // routing through one removable handler that coalesces via scheduleSweep.
    private requestSweep: () => void = (): void => {
        this.scheduleSweep();
    };

    // Named, bound "docked" handler for every wired Tab: a foreign tab was merged
    // into a region's strip. The merge bypasses DockRegion, so it lands a sweep
    // here — the host-diff reconcile then emits the attach. The content arg is
    // unused (the reconcile re-derives every frame's host) but matches the
    // listener signature.
    private onPanelDocked: (content: Component) => void = (_content: Component): void => {
        this.requestSweep();
    };

    /**
     * Constructs a Dock, compiling `options.layout` into the region tree (or an
     * empty `Tab` region when omitted) and running the initial re-wire sweep.
     *
     * @param options - Construction options; `layout` seeds the arrangement.
     * @param subclassDefaults - Optional defaults a subclass injects before the caller's options.
     */
    constructor(options?: DockOptions, subclassDefaults?: Partial<DockOptions>) {
        super(options, { layoutManager: new Fit(), ...subclassDefaults });

        const root = options?.layout ? this.compileLayout(options.layout) : this.newTabRegion();

        this.addComponent(root);
        this.scheduleSweep();
        this.wireEmptyDropTarget();
    }

    /**
     * Applies inherited options first, then routes the `emptyContent` placeholder
     * through its setter. The setter only caches (no DOM work) because it is
     * dispatched from within `super()`; the placeholder attaches from the first
     * post-construction reconcile.
     *
     * @param options - The construction options.
     *
     * @returns This dock.
     */
    protected applyOptions(options: DockOptions): this {
        super.applyOptions(options);

        if (options.emptyContent !== undefined) {
            this.setEmptyContent(options.emptyContent);
        }

        return this;
    }

    /**
     * Sets (or clears, with `null`) the placeholder shown while the dock holds no
     * live panel — a start-page for an empty dock. The placeholder is shown as a
     * single non-closeable tab in the empty root region, and is chrome: it is
     * never serialized (excluded from a saved arrangement) and never enters the
     * panel registry. When no placeholder is set, the empty region hides its tab
     * strip entirely; either way the dock still reports emptiness and fires
     * `"emptychange"`.
     *
     * When the dock is already empty, the shown placeholder is swapped immediately;
     * otherwise the value is only cached and shown on the next empty transition.
     *
     * @param component - The placeholder component, or `null` to clear it.
     *
     * @returns This dock, for chaining.
     */
    setEmptyContent(component: Component | null): this {
        // Hot-swap only once the state machine is live (first reconcile has run):
        // during the super()/applyOptions cascade _emptyReconciled is still false,
        // keeping the setter cache-only so no DOM work happens at construction. The
        // placeholder is shown while the main region is empty (all tabs closed or
        // torn off), so gate the swap on that, not on dock-wide emptiness.
        const showing = this._emptyReconciled && this.mainRegionEmpty();

        if (showing) {
            this.hideEmptyState();              // remove the outgoing placeholder tab
        }

        this._options.emptyContent = component ?? undefined;

        if (showing) {
            this.showEmptyState();              // show the incoming placeholder tab
        }

        return this;
    }

    /**
     * The placeholder shown while the dock is empty, or `null` when none is set.
     *
     * @returns The placeholder component, or `null`.
     */
    getEmptyContent(): Component | null {
        return this._options.emptyContent ?? null;
    }

    /**
     * Whether the dock holds no live panel anywhere — tiled or floated. A dock
     * whose only panels are torn off into floats is *not* empty (the floats are
     * still live panels of this dock), so this reports `false` for it, and
     * `"emptychange"` fires off this aggregate. The empty-state placeholder is a
     * separate, *visual* concern that tracks the main region alone, so it can show
     * over an all-floated dock while this still reports `false`.
     *
     * @returns `true` when no live panel exists.
     */
    isEmpty(): boolean {
        return this._frames.size === 0;
    }

    /**
     * Registers the dock itself as a drop target that is active only while the
     * dock is empty — every panel torn off, so no region remains to carry a
     * `DockRegion`. Dropping a tab onto the bare dock then builds a fresh root
     * region to hold it, making an emptied dock its own re-dock surface rather
     * than leaving a placeholder region behind. While non-empty the predicate
     * declines, so the regions' own `DockRegion`s (nested deeper, hit first by
     * the hit-test) keep handling drops.
     */
    private wireEmptyDropTarget(): void {
        DragManager.makeDropTarget(this, {
            accepts: (detail: DragEventDetail): boolean =>
                detail.dragData["tabDrag"] === true && this.getComponents().length === 0,
            // The full-region blue overlay is the only feedback here; suppress the
            // manager's whole-target tint so it does not stack with it.
            suppressValidityTint: true,
            onDragOver: (): null => {
                this._emptyDropOverlay.attachTo(this);
                this._emptyDropOverlay.highlightFull();

                return null;
            },
            onDragLeave: (): void => {
                this._emptyDropOverlay.detach();
            },
            onDrop: (detail: DragEventDetail): void => {
                this._emptyDropOverlay.detach();

                const panel = tabDragRegistry.get(detail.dragData["componentId"] as string);

                if (!panel) {
                    return;
                }

                const region = this.newTabRegion();

                this.addComponent(region);
                region.moveComponent(panel);
                this.scheduleSweep();
            },
        });
    }

    /**
     * Registers a panel and adds it as a tab in the active region, then schedules
     * a re-wire sweep so a newly-created region is made dockable.
     *
     * @param spec - The panel to register and dock.
     *
     * @returns This dock, for chaining.
     */
    addPanel(spec: DockPanelSpec): this {
        this._panels.set(spec.id, spec);

        const content = this.resolvePanel(spec.id);

        if (content) {
            const region = this.activeTabRegion();

            this._lastActiveRegion = region;
            region.moveComponent(content, undefined, this.leafConstraints(spec));

            // Activate the freshly added panel so opening it shows it. The tab
            // cell is created lazily on the region's next doLayout, so this may
            // defer (Tab.setActiveContent) until that pass.
            (region.getLayoutManager() as Tab).setActiveContent(content);

            // The panel just entered the tiled tree. The ledger is left without an
            // entry for this id so the next sweep's host diff sees a first
            // appearance and emits attach(tiled) — the same reconcile path a
            // dragged-in dock flows through, so a programmatic add and a drop
            // produce the event from identical code.
            this._frameRegion.set(spec.id, region);

            this.scheduleSweep();
        }

        return this;
    }

    /**
     * Adds a panel whose content is built lazily — on first activation — instead
     * of up front. The tab appears immediately (the identity frame is created
     * empty, so re-open dedup via {@link focusPanel} and layout serialization keep
     * working); on first activation a centred spinner shows while the spec's
     * `content` factory runs, then the built content fades in. This is the
     * panel-level analogue of {@link Tab.addLazyTab}: use it for panels whose
     * content is expensive to build or fetches data, so opening one never blocks
     * the tab from appearing.
     *
     * @param spec - The panel to register and dock; `content` is treated as the
     *   lazy factory (a live component is wrapped in one).
     *
     * @returns This dock, for chaining.
     */
    addLazyPanel(spec: DockPanelSpec): this {
        this._panels.set(spec.id, spec);
        this._lazyFactories.set(
            spec.id,
            typeof spec.content === "function" ? spec.content : () => spec.content as Component
        );

        const frame = this.resolvePanel(spec.id);

        if (frame) {
            const region = this.activeTabRegion();

            this._lastActiveRegion = region;
            region.moveComponent(frame, undefined, this.leafConstraints(spec));

            // Activate it so the tab shows; activation drives realizeLazyContent
            // (via the region's "activated" -> onPanelFocused) to materialize the
            // deferred content behind a spinner.
            (region.getLayoutManager() as Tab).setActiveContent(frame);
            this._frameRegion.set(spec.id, region);

            this.scheduleSweep();
        }

        return this;
    }

    /**
     * Returns the root region container (a `Container` carrying a `Split`/`Tab`
     * manager). Derived live as the sole `Fit` child rather than cached, because
     * an edge drop onto the root swaps that child for a fresh `Split` wrapper.
     *
     * @returns The root region.
     */
    getRootRegion(): Component {
        return this.getComponents()[0];
    }

    /**
     * Captures the current arrangement (delegates to
     * [`serializeLayout`](/api/layout/functions/serializeLayout)).
     *
     * @returns The captured layout state.
     */
    getLayoutState(): LayoutState {
        return serializeLayout(this.getRootRegion());
    }

    /**
     * Restores a captured arrangement, sourcing leaves from the panel registry
     * (delegates to [`restoreLayout`](/api/layout/functions/restoreLayout)), then
     * schedules a sweep to wire the fresh regions restore created.
     *
     * The region ledger is cleared first: `restoreLayout` tears the region tree
     * down and rebuilds it, so every surviving panel lands in a fresh region
     * object. Without clearing, the post-restore sweep would read each panel's
     * stale (now-destroyed) region and spuriously fire `"moved"` for every panel.
     * A restore is not a user-visible relocation, so it stays silent for
     * `"moved"`; the sweep re-seeds the ledger from the rebuilt tree.
     *
     * @param state - A layout state from {@link getLayoutState}.
     *
     * @returns This dock, for chaining.
     */
    setLayoutState(state: LayoutState): this {
        this._frameRegion.clear();
        restoreLayout(this.getRootRegion(), state, (id: string) => this.resolvePanel(id));
        this.scheduleSweep();

        return this;
    }

    /**
     * The serialization factory: resolves a panel id to its Dock-owned identity
     * frame, building it once (running a lazy content factory at most once) and
     * caching it so every resolve returns the same instance.
     *
     * The frame is a `Container` constructed with the stable `id` (the serialization
     * key, read back via `getId()`) and the `title` (the visible tab label, via
     * `getName()`) set **at construction** — the caller's content is placed
     * inside it and never mutated. The id must be set at construction, not via a
     * later `setId`, so the frame's `#id`-scoped CSS rule (which carries
     * `position: absolute`) binds to the element; a post-construction `setId`
     * would leave that rule on the old id and the frame would collapse to
     * `position: static`.
     *
     * @param id - The panel id to resolve.
     *
     * @returns The identity frame, or `null` when the id is unknown.
     */
    private resolvePanel(id: string): Component | null {
        const spec = this._panels.get(id);

        if (!spec) {
            return null;
        }

        let frame = this._frames.get(id);

        if (!frame) {
            frame = new Container({ id: spec.id, name: spec.title, layoutManager: new Fit() });

            // A lazy panel (see addLazyPanel) builds its frame empty — its content
            // is deferred to first activation (realizeLazyContent). A normal panel
            // builds its content now. Either way the frame exists, so the tab shows
            // and the id dedups / serializes like any other.
            if (!this._lazyFactories.has(id)) {
                const content = typeof spec.content === "function" ? spec.content() : spec.content;

                frame.addComponent(content);
            }

            this._frames.set(id, frame);
        }

        return frame;
    }

    /**
     * Builds the glyph-only layout constraints for a leaf, or `undefined` when
     * the spec has no glyph. The glyph is the one presentation hint `Tab` reads
     * from the constraint; identity and label ride on the component itself.
     *
     * @param spec - The panel spec.
     *
     * @returns The constraints, or `undefined`.
     */
    private leafConstraints(spec: DockPanelSpec): LayoutConstraints {
        const constraints = new LayoutConstraints();

        // Dock tabs are closeable by default; a spec may opt out.
        constraints.closeable = spec.closeable ?? true;

        if (spec.glyph) {
            constraints.glyph = spec.glyph;
        }

        if (spec.tooltip) {
            constraints.tooltip = spec.tooltip;
        }

        return constraints;
    }

    /**
     * Resolves the region `addPanel` docks into: the root if it is a `Tab`, else
     * the first `Tab` region found depth-first, else the root wrapped in a fresh
     * `Tab` (only reachable for an externally-crafted tab-less tree — `Dock`'s
     * own compiler and `DockRegion` always keep leaves in `Tab` stacks).
     *
     * @returns A `Tab` region to add a tab to.
     */
    private activeTabRegion(): Component {
        const root = this.getRootRegion();

        // Prefer the region the user last focused, when it is still a live Tab in
        // the current tree, so a new panel opens beside the last-used tab-bar.
        const last = this._lastActiveRegion;
        if (last && this.isTab(last) && this.containsRegion(root, last)) {
            return last;
        }

        if (this.isTab(root)) {
            return root;
        }

        return this.firstTabRegion(root) ?? this.wrapRootInTab();
    }

    /**
     * Depth-first membership test: whether `target` is `region` or nested under
     * it. Used to confirm `_lastActiveRegion` still lives in the dock's tree
     * before docking into it (a collapsed split or a layout restore can retire a
     * region object).
     *
     * @param region - The subtree root to search.
     * @param target - The region to find.
     *
     * @returns `true` when `target` is within `region`.
     */
    private containsRegion(region: Component, target: Component): boolean {
        if (region === target) {
            return true;
        }

        for (const child of region.getComponents()) {
            if (this.isRegionContainer(child) && this.containsRegion(child, target)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Depth-first search for the first `Tab` region at or under `region`.
     *
     * @param region - The region to search from.
     *
     * @returns The first `Tab` region, or `null` when none exists.
     */
    private firstTabRegion(region: Component): Component | null {
        if (this.isTab(region)) {
            return region;
        }

        for (const child of region.getComponents()) {
            if (this.isRegionContainer(child)) {
                const found = this.firstTabRegion(child);

                if (found) {
                    return found;
                }
            }
        }

        return null;
    }

    /**
     * Installs a fresh `Tab` region as the dock's single `Fit` child and
     * re-homes the existing root into it, returning the new region. The safety
     * net for a tab-less tree (see {@link activeTabRegion}).
     *
     * @returns The fresh `Tab` region now holding the old root.
     */
    private wrapRootInTab(): Component {
        const region  = this.newTabRegion();
        const oldRoot = this.getRootRegion();

        this.addComponent(region);
        region.moveComponent(oldRoot);

        return region;
    }

    /**
     * Builds an empty region: a `Container` carrying a fresh `Tab` manager.
     *
     * @returns The new `Tab` region.
     */
    private newTabRegion(): Component {
        return new Container({ layoutManager: new Tab({ reorderable: true, compact: true }) });
    }

    /**
     * Compiles a declarative layout spec into a region `Component`, registering
     * every leaf in the panel registry along the way. The only structural build
     * code unique to `Dock`; runtime restructuring belongs to `DockRegion`.
     *
     * @param spec - The layout spec to compile.
     *
     * @returns The compiled region.
     */
    private compileLayout(spec: DockLayoutSpec): Component {
        if ("split" in spec) {
            const region = new Container({ layoutManager: new Split({ orientation: spec.split }) });

            for (const child of spec.children) {
                region.addComponent(this.compileRegion(child));
            }

            return region;
        }

        if ("tabs" in spec) {
            return this.compileTabs(spec.tabs);
        }

        return this.compileTabs([spec]);
    }

    /**
     * Compiles a child of a split: a leaf becomes its own single-tab stack so a
     * split pane is always a draggable region, never a bare leaf.
     *
     * @param spec - The child spec.
     *
     * @returns The compiled region.
     */
    private compileRegion(spec: DockLayoutSpec): Component {
        if ("split" in spec || "tabs" in spec) {
            return this.compileLayout(spec);
        }

        return this.compileTabs([spec]);
    }

    /**
     * Builds a `Tab` region holding the given leaves, registering and stamping
     * each one.
     *
     * @param specs - The leaf panels to stack.
     *
     * @returns The `Tab` region.
     */
    private compileTabs(specs: DockPanelSpec[]): Component {
        const region = this.newTabRegion();

        for (const spec of specs) {
            this._panels.set(spec.id, spec);

            const content = this.resolvePanel(spec.id);

            if (content) {
                region.addComponent(content, this.leafConstraints(spec));

                // A compiled panel starts tiled; seed the host ledger with null
                // so the first sweep's host diff is silent (no transition to
                // attach from). Construction therefore emits nothing.
                this._panelHost.set(spec.id, null);
                this._frameRegion.set(spec.id, region);
            }
        }

        return region;
    }

    /**
     * Schedules one coalesced re-wire sweep on the next animation frame. Repeated
     * calls within a frame collapse to a single sweep.
     */
    private scheduleSweep(): void {
        if (this._sweepScheduled) {
            return;
        }

        this._sweepScheduled = true;

        DOM.sink.requestAnimationFrame(() => {
            this._sweepScheduled = false;
            this.runSweep();
        });
    }

    /**
     * Runs the idempotent sweep: adopt every owned float window into a wired
     * region tree, wire the in-dock root and each float region, then tear down
     * the coordinators of regions that have vanished from the combined live tree.
     */
    private runSweep(): void {
        const root = this.getRootRegion();

        if (!root) {
            return;
        }

        const floatRegions = this.ownedFloatWindows()
            .map(win => this.adoptFloat(win))
            .filter((region): region is Component => region !== null);

        this.wireRegion(root);

        for (const region of floatRegions) {
            this.wireRegion(region);
        }

        this.subscribeFloatWindows();
        this.reconcileHosts(root);
        this.teardownVanished(root, floatRegions);
        this.reconcileEmptyState();
    }

    /**
     * Reconciles the two independent empty concerns each sweep:
     *
     * - **Placeholder / bar** track the *main region's* emptiness — whether the
     *   root region holds no tiled panel. This is true both when every tab was
     *   closed and when they were all torn off into floats, so the start page
     *   shows in either case. Re-asserted idempotently every sweep (not just on a
     *   transition) so it re-shows after a `setLayoutState` restore clears the
     *   root region wholesale.
     * - **`"emptychange"`** tracks the *dock-wide* emptiness — {@link isEmpty},
     *   `true` only when no panel exists anywhere (tiled or floated). Latched on
     *   `_empty` and emitted exactly once per real transition; a no-op sweep is
     *   silent. Called at the end of every sweep and reached from every close via
     *   {@link scheduleSweep}, so the emit is once per settled transition.
     */
    private reconcileEmptyState(): void {
        if (this.mainRegionEmpty()) {
            this.showEmptyState();
        } else {
            this.hideEmptyState();
        }

        const empty = this.isEmpty();

        // First reconcile: sync the born state without an emit (being born empty
        // or populated is not a transition). A born-with-layout dock differs from
        // the true=seed latch and falls through to emit emptychange(false) once.
        if (!this._emptyReconciled) {
            this._emptyReconciled = true;

            if (empty === this._empty) {
                return;
            }
        }

        if (empty === this._empty) {
            return;
        }

        this._empty = empty;
        this.emit("emptychange", { empty });
    }

    /**
     * Whether the main (tiled) region holds no panel — every tab closed, or all
     * torn off into floats. The placeholder is excluded so it never counts as
     * content. This drives the placeholder, distinct from {@link isEmpty} (which
     * counts floated panels as live).
     *
     * @returns `true` when the root region shows no tiled panel.
     */
    private mainRegionEmpty(): boolean {
        const region = this.getRootRegion();

        if (!region) {
            return false;
        }

        const placeholder = this.getEmptyContent();

        return region.getComponents().every(child => child === placeholder);
    }

    /**
     * Shows the empty-state chrome in the empty root region. With a placeholder
     * set, it is docked as a single non-closeable, `transient` (never-serialized)
     * tab; without one, the region's tab strip is hidden so an emptied dock is a
     * clean surface rather than a dangling empty strip. Idempotent — safe to call
     * on every sweep — and a no-op when the root region is not a `Tab`.
     */
    private showEmptyState(): void {
        const region      = this.getRootRegion();
        const placeholder = this.getEmptyContent();

        if (!region) {
            return;
        }

        if (placeholder) {
            this.rootTab()?.setBarVisible(true);

            if (placeholder.getParentComponent() !== region) {
                region.moveComponent(placeholder, undefined, this.placeholderConstraints());
            }
        } else {
            this.rootTab()?.setBarVisible(false);
        }
    }

    /**
     * Removes the empty-state chrome: detaches the placeholder tab when present
     * and restores the root region's tab strip. Idempotent — safe to call on
     * every sweep and when nothing is shown.
     */
    private hideEmptyState(): void {
        const placeholder = this.getEmptyContent();
        const parent      = placeholder?.getParentComponent();
        const manager     = parent?.getLayoutManager();

        // Remove the placeholder from wherever it currently sits. A `Tab` host must
        // go through `closeTab` (not `removeComponent`): `Tab.doLayout` reconciles
        // only *added* children, so a bare `removeComponent` would orphan the strip
        // cell and leave a stale placeholder tab. `closeTab`'s `"tabclose"` is
        // ignored by the dock (the placeholder is not a registered frame) and its
        // drain-`"empty"` is absorbed by the root-region prune guard. `closeTab`
        // returns false when no cell exists yet (added but not laid out); then a
        // plain `removeComponent` suffices — there is no cell to orphan.
        if (placeholder) {
            const closed = manager instanceof Tab && manager.closeTab(placeholder);

            if (!closed) {
                parent?.removeComponent(placeholder);
            }
        }

        this.rootTab()?.setBarVisible(true);
    }

    /**
     * The root region's `Tab` manager, or `null` when the root region is absent or
     * carries a different manager (e.g. an externally-crafted `Split` root). An
     * empty dock's root is always a `Tab` — the prune path keeps a single empty
     * `Tab` region — so the placeholder always finds one.
     *
     * @returns The root `Tab` manager, or `null`.
     */
    private rootTab(): Tab | null {
        const manager = this.getRootRegion()?.getLayoutManager();

        return manager instanceof Tab ? manager : null;
    }

    /**
     * The layout constraints the placeholder tab is docked under: non-closeable
     * (the start page cannot be closed) and `transient` (shown as a tab but never
     * captured by serialization). The tab's label is the placeholder component's
     * own name.
     *
     * @returns The placeholder tab constraints.
     */
    private placeholderConstraints(): LayoutConstraints {
        const constraints = new LayoutConstraints();

        constraints.closeable = false;
        constraints.transient = true;

        return constraints;
    }

    /**
     * Idempotently subscribes the lifecycle events of every float window that
     * currently hosts one of this dock's frames — both the adopted bare
     * `Window` mini-docks and the self-contained `TabWindow` tear-offs the sweep
     * does not adopt. A `TabWindow`'s internal `Tab` is never wired by
     * `wireRegion`, so its `"activated"` / `"tabclose"` / `"detached"` /
     * `"docked"` are subscribed here explicitly; both float kinds get the
     * window's `"activate"` / `"close"`. The tracked set stops a re-sweep
     * stacking duplicate listeners.
     */
    private subscribeFloatWindows(): void {
        for (const win of this.floatWindowsHoldingFrames()) {
            if (this._floatSubscribed.has(win)) {
                continue;
            }

            const onFloatActivate: () => void = (): void => { this.onFloatActivated(win); };
            const onFloatClose:    () => void = (): void => { this.onFloatClosed(win); };

            win.on("activate", onFloatActivate);
            win.on("close",    onFloatClose);

            if (win instanceof TabWindow) {
                const tab = win.getLayoutManager() as Tab;

                tab.on("activated", this.onPanelFocused);
                tab.on("tabclose",  this.onPanelClosed);
                tab.on("detached",  this.onPanelDetached);
                tab.on("docked",    this.onPanelDocked);
            }

            this._floatSubscribed.add(win);
        }

        this.pruneClosedFloatSubscriptions();
    }

    /**
     * Drops closed windows from the float-subscription tracking set so a future
     * window object never collides with a stale entry. The listeners themselves
     * die with the closed window, so only the set bookkeeping is needed.
     */
    private pruneClosedFloatSubscriptions(): void {
        const open = new Set<AbstractWindow>(AbstractWindow.getOpenWindows());

        for (const win of this._floatSubscribed) {
            if (!open.has(win)) {
                this._floatSubscribed.delete(win);
            }
        }
    }

    /**
     * Open float windows hosting one of this dock's frames, including the
     * self-contained `TabWindow` tear-offs (which `ownedFloatWindows` excludes
     * because the sweep does not adopt them), and excluding the window the dock
     * itself lives in. The subscription targets for the panel lifecycle.
     *
     * @returns The float windows holding this dock's frames.
     */
    private floatWindowsHoldingFrames(): AbstractWindow[] {
        const frames = [...this._frames.values()];

        return AbstractWindow.getOpenWindows().filter(win =>
            !this.windowContains(win, this) &&
            frames.some(frame => this.windowContains(win, frame)));
    }

    /**
     * Recomputes each registered frame's host (`null` when it sits under the
     * in-dock tiled tree, else the float window holding it) and region, and diffs
     * both against their ledgers, emitting the lifecycle events the change
     * implies: a first appearance (no host ledger entry — a fresh `addPanel` or a
     * restore) emits `"attach"` alone; a change from one host to another (a
     * tear-off, a re-dock by either drop path, a float-to-float move) emits
     * `"detach"`(old host) then `"attach"`(new host); a same-host change of
     * region (a relocation to a different region within one host) emits
     * `"moved"`; an unchanged host and region is silent. This is the single
     * source of every `"attach"`/`"detach"`/`"moved"`, so the events are
     * identical regardless of which DnD path landed the sweep.
     *
     * Only frames still registered and still cached are visited, so a panel whose
     * frame a close handler already evicted produces no phantom `"detach"`.
     *
     * @param root - The current root region.
     */
    private reconcileHosts(root: Component): void {
        for (const [id, frame] of this._frames) {
            if (!this._panels.has(id)) {
                continue;
            }

            const host       = this.hostForFrame(frame, root);
            const had        = this._panelHost.has(id);
            const prev       = this._panelHost.get(id) ?? null;
            const region     = this.regionForFrame(frame);
            const prevRegion = this._frameRegion.get(id) ?? null;

            if (!had) {
                this.emit("attach", { id, content: frame, window: host });
            } else if (host !== prev) {
                this.emit("detach", { id, content: frame, window: prev });
                this.emit("attach", { id, content: frame, window: host });
            } else if (region && prevRegion && region !== prevRegion) {
                // Same host, different region: the panel relocated within its
                // host. The `region && prevRegion` guard keeps a frame transiently
                // out of any region (mid-teardown) silent rather than spurious.
                this.emit("moved", { id, content: frame, window: host });
            }

            this._panelHost.set(id, host);

            if (region) {
                this._frameRegion.set(id, region);
            }
        }
    }

    /**
     * The host a frame currently occupies: `null` when it sits under the tiled
     * tree (the main dock), otherwise the float window holding it. Reuses the
     * existing tiled test and float lookup so the reconcile and the
     * focus-payload construction derive the host the same way.
     *
     * @param frame - The identity frame to locate.
     * @param root - The current root region.
     *
     * @returns The host window, or `null` for the tiled tree.
     */
    private hostForFrame(frame: Component, root: Component): AbstractWindow | null {
        return this.isUnder(root, frame) ? null : this.floatForFrame(frame);
    }

    /**
     * Open windows whose content subtree holds one of this dock's identity frames
     * — the floats torn off from this dock — excluding the window the dock itself
     * lives in. Re-derived each sweep (never cached) so a closed float drops out
     * naturally, mirroring the derived-live root in {@link getRootRegion}.
     *
     * A {@link TabWindow} is excluded: a default tear-off opens one as a
     * self-contained floating tabbed window, re-dockable via its own tab DnD and
     * self-closing when emptied. It is never adopted into the dock's region tree,
     * so the sweep must leave it alone — only the Shift-torn bare {@link Window}
     * floats become adoptable mini-docks.
     *
     * @returns The owned float windows.
     */
    private ownedFloatWindows(): AbstractWindow[] {
        const frames = [...this._frames.values()];

        return AbstractWindow.getOpenWindows().filter(win =>
            !(win instanceof TabWindow) &&
            !this.windowContains(win, this) &&
            frames.some(frame => this.windowContains(win, frame)));
    }

    /**
     * Whether `node` lies within `win`'s subtree — walks `node`'s ancestor chain
     * looking for `win`. Used both to detect a float hosting a frame and to
     * exclude the dock's own host window (which contains the dock, hence every
     * still-docked frame).
     *
     * @param win - The candidate ancestor window.
     * @param node - The component whose ancestor chain to walk.
     *
     * @returns `true` when `win` is an ancestor of `node`.
     */
    private windowContains(win: AbstractWindow, node: Component): boolean {
        for (let current: Component | null = node; current; current = current.getParentComponent()) {
            if (current === win) {
                return true;
            }
        }

        return false;
    }

    /**
     * A window's first non-chrome child — its content panel — or `null` when the
     * window has none yet.
     *
     * @param win - The window to inspect.
     *
     * @returns The content component, or `null`.
     */
    private windowContent(win: AbstractWindow): Component | null {
        return win.getComponents().find(child => !win.isChromeComponent(child)) ?? null;
    }

    /**
     * Ensures a float window's content is a wired-able region tree and returns
     * that region. A freshly torn-off float holds its bare identity frame as the
     * window's content; this wraps it in a single fresh `Tab` region so it is a
     * proper region leaf with a draggable handle, turning the window into a
     * mini-dock. Idempotent: once the content is a region container (already
     * adopted, or restored as a tree) it is returned unchanged, so re-sweeps
     * after edge-splits inside the float do not re-wrap.
     *
     * @param win - The float window to adopt.
     *
     * @returns The float's content region, or `null` when the window has no content.
     */
    private adoptFloat(win: AbstractWindow): Component | null {
        const content = this.windowContent(win);

        if (!content) {
            return null;
        }

        if (this.isRegionContainer(content)) {
            return content;
        }

        const region = this.newTabRegion();

        // A fresh region carries no constraint, so the window's Border fills it as
        // an unplaced→CENTER child — the same way the bare frame filled before.
        win.moveComponent(region);
        region.moveComponent(content);

        return region;
    }

    /**
     * Idempotently wires a region and recurses into its child regions: makes a
     * `Tab` region reorderable and prunes it when its last tab leaves, and gives
     * every region a `DockRegion` so it accepts edge/centre drops and notifies
     * the dock after a drop mutates the tree.
     *
     * @param region - The region to wire.
     */
    private wireRegion(region: Component): void {
        let wiring = this._wiring.get(region);

        if (!wiring) {
            wiring = { dockRegion: new DockRegion(region, this.requestSweep), tabWired: false };

            this._wiring.set(region, wiring);
        }

        const manager = region.getLayoutManager();

        if (this.isTab(region) && !wiring.tabWired) {
            const tab: Tab = manager as Tab;

            tab.setReorderable(true);
            // Per-region prune; the named const carries the region the shared
            // handler set otherwise could not (ARCHITECTURE: a listener is a named
            // reference, never an inline arrow).
            const onEmpty: () => void = (): void => { this.pruneRegion(region); };

            tab.on("empty", onEmpty);
            // The lifecycle handlers are shared bound methods: their payloads (the
            // closed/activated content, the torn-off window) carry the identity
            // they need, so no per-region capture is required.
            tab.on("tabclose",  this.onPanelClosed);
            tab.on("activated", this.onPanelFocused);
            tab.on("detached",  this.onPanelDetached);
            tab.on("docked",    this.onPanelDocked);

            wiring.tabWired = true;
        }

        for (const child of region.getComponents()) {
            if (this.isRegionContainer(child)) {
                this.wireRegion(child);
            }
        }
    }

    /**
     * Removes a `Tab` region once its last tab has left, then collapses a `Split`
     * that the removal leaves with a single pane, and schedules a sweep to tear
     * down the removed region's coordinator. Wired to every `Tab` region's
     * `"empty"` event so regions the dock itself built (the `compileLayout` /
     * `restoreLayout` tree) are pruned, not just the stacks `DockRegion` mints.
     * No-op when the region was already detached (a `DockRegion`-created stack
     * pruned itself first) or still holds a tab.
     *
     * @param region - The region whose `Tab` fired `"empty"`.
     */
    private pruneRegion(region: Component): void {
        const parent = region.getParentComponent();

        if (!parent || region.getComponents().length > 0) {
            return;
        }

        // Keep an emptied root region (its parent is the dock) as the dock's
        // add/drop target — removing it would leave the dock with no region and
        // crash the next addPanel.
        if (parent === this) {
            return;
        }

        parent.removeComponent(region);
        this.collapseSinglePaneSplit(parent);
        this.closeFloatIfEmpty(parent);
        this.scheduleSweep();
    }

    /**
     * Closes a float window whose mini-dock just emptied. When a region was the
     * direct content of a float window and pruning it leaves the window with no
     * content, the float has nothing left to host — close it, matching the
     * auto-close a strip-mode tear-off window performs when its last tab leaves.
     * A no-op when `container` is an in-dock region (its parent is the dock or a
     * `Split`, never a window) or the window still holds content.
     *
     * @param container - The container the pruned region was removed from.
     */
    private closeFloatIfEmpty(container: Component): void {
        if (!AbstractWindow.getOpenWindows().includes(container as AbstractWindow)) {
            return;
        }

        if (!this.windowContent(container as AbstractWindow)) {
            (container as AbstractWindow).requestClose();
        }
    }

    /**
     * Collapses a `Split` left with a single child: the lone child is hoisted
     * into the grandparent at the `Split`'s slot (via `moveComponent`) and the
     * emptied `Split` removed. A no-op unless `container` is a single-child
     * `Split` with a grandparent (a root single-pane `Split` renders its child
     * full-bleed). The swap keeps the grandparent's child count unchanged, so the
     * collapse does not cascade.
     *
     * @param container - The container that just lost a child.
     */
    private collapseSinglePaneSplit(container: Component): void {
        if (this.regionKind(container) !== "Split") {
            return;
        }

        const children = container.getComponents();

        if (children.length !== 1) {
            return;
        }

        const grandparent = container.getParentComponent();

        if (!grandparent) {
            return;
        }

        const index = grandparent.getComponents().indexOf(container);

        // Carry the collapsing Split's stored size onto the hoisted child so the
        // slot keeps the user's dragged ratio (when the grandparent is a Split).
        if (this.regionKind(grandparent) === "Split") {
            (grandparent.getLayoutManager() as Split).transferPaneSize(container, children[0]);
        }

        grandparent.moveComponent(children[0], index);
        grandparent.removeComponent(container);
    }

    /**
     * Destroys the wiring of every tracked region no longer reachable from the
     * combined live tree (the in-dock root plus every owned float's region tree),
     * releasing the drop targets a removed region's coordinator held. Seeding the
     * reachable set from the float regions too is what keeps a float's drop
     * targets alive across sweeps driven by unrelated in-dock moves.
     *
     * @param root - The current root region.
     * @param floatRegions - The adopted content region of each owned float window.
     */
    private teardownVanished(root: Component, floatRegions: Component[]): void {
        const reachable = new Set<Component>();

        this.collectRegions(root, reachable);

        for (const region of floatRegions) {
            this.collectRegions(region, reachable);
        }

        for (const [region, wiring] of this._wiring) {
            if (!reachable.has(region)) {
                wiring.dockRegion.destroy();
                this._wiring.delete(region);
            }
        }
    }

    /**
     * Collects every region container at or under `region` into `into`.
     *
     * @param region - The region to collect from.
     * @param into - The set to populate.
     */
    private collectRegions(region: Component, into: Set<Component>): void {
        into.add(region);

        for (const child of region.getComponents()) {
            if (this.isRegionContainer(child)) {
                this.collectRegions(child, into);
            }
        }
    }

    /**
     * Whether a component is a region container — a `Container` carrying a `Split`
     * or `Tab` manager. Discriminates on the stripped runtime class name (no
     * `instanceof`, avoiding an import cycle), matching how serialization keys
     * its node kinds.
     *
     * @param component - The component to test.
     *
     * @returns `true` for a `Split`/`Tab` region.
     */
    private isRegionContainer(component: Component): boolean {
        const kind = this.regionKind(component);

        return kind === "Split" || kind === "Tab";
    }

    /**
     * Whether a component is a `Tab` region.
     *
     * @param component - The component to test.
     *
     * @returns `true` for a `Tab` region.
     */
    private isTab(component: Component): boolean {
        return this.regionKind(component) === "Tab";
    }

    /**
     * The stripped runtime class name of a component's layout manager, or the
     * empty string when it has none (a leaf content component).
     *
     * @param component - The component to inspect.
     *
     * @returns The manager's class name without its `_` export-alias prefix.
     */
    private regionKind(component: Component): string {
        const manager = component.getLayoutManager() as (Tab | Split | undefined);

        return manager ? manager.getClassName().replace(/^_/, "") : "";
    }

    // ----- panel lifecycle -----

    /**
     * `"tabclose"` handler for every wired `Tab` (tiled or float): a registered
     * panel was genuinely closed. Emits `"close"`, evicts the cached frame so a
     * re-`addPanel` rebuilds it via the lazy factory (keeping the `_panels`
     * registration), and — when the closed panel was the dock-wide focused one —
     * recomputes focus once the source `Tab` has re-selected a survivor.
     *
     * @param content - The closed tab's content (a Dock identity frame).
     */
    private onPanelClosed = (content: Component): void => {
        const id = content.getId();

        if (this._frames.get(id) !== content) {
            return;
        }

        const region = this._frameRegion.get(id) ?? null;

        this._frames.delete(id);
        this._panelHost.delete(id);
        this._frameRegion.delete(id);

        this.emit("close", { id, content, window: null });

        // Route the close through the one reconcile site so "emptychange" fires
        // even when no structural prune scheduled a sweep. The latch-diff makes a
        // second reconcile in the same settled state a no-op, so this cannot
        // double-fire alongside pruneRegion's own scheduleSweep.
        this.scheduleSweep();

        if (this._focusedPanelId === id) {
            this.scheduleFocusRecompute(region);
        }
    };

    /**
     * `"activated"` handler for every wired `Tab`: the active tab changed via a
     * click or `setActiveTabIndex`. Emits `"focus"` for the now-active panel,
     * gated on a genuine focused-panel change.
     *
     * @param content - The now-active tab's content (a Dock identity frame).
     */
    private onPanelFocused = (content: Component): void => {
        const id = content.getId();

        if (this._frames.get(id) !== content) {
            return;
        }

        // Remember the focused panel's region so the next add docks beside the
        // tab-bar the user just worked in (see activeTabRegion).
        const region = this._frameRegion.get(id);
        if (region) {
            this._lastActiveRegion = region;
        }

        this.realizeLazyContent(id, content);
        this.setFocus(id);
    };

    /**
     * Materializes a lazy panel's deferred content the first time its tab is
     * activated: a spinner shows during a two-frame yield, then the spec's
     * factory runs and its output fades in over the spinner (via
     * {@link Animation.materialize}). The factory is dropped from the lazy
     * registry before it runs, so this is a no-op for a normal panel or one
     * already realized — the content never rebuilds.
     *
     * @param id - The activated panel's id.
     * @param frame - The panel's identity frame; the materialize host.
     */
    private realizeLazyContent(id: string, frame: Component): void {
        const factory = this._lazyFactories.get(id);

        if (!factory) {
            return;
        }

        this._lazyFactories.delete(id);

        Animation.materialize({ host: frame, factory, spinnerComponent: this.createSpinnerWrap() });
    }

    /**
     * Builds the centred spinner shown while a lazy panel materializes — a fixed
     * 24px {@link ProgressSpinner} (matching `Tab`/`TablePanel`) in a non-filling
     * `Fit` so it sits in the frame's centre.
     *
     * @returns A component owning a single centred ProgressSpinner.
     */
    private createSpinnerWrap(): Component {
        const wrap = new Component();

        wrap.setLayoutManager(new Fit({ fill: FillType.NONE }));
        wrap.addComponent(new ProgressSpinner(24));

        return wrap;
    }

    /**
     * `"detached"` handler for every wired `Tab`: a tab was torn off into a new
     * float window. Schedules a sweep so the new float is wired (and any
     * Shift-torn bare `Window` adopted); the sweep's host-diff reconcile observes
     * the torn-off frame's tiled -> float transition and emits the
     * `"detach"`(tiled) + `"attach"`(float) pair itself, so this handler emits
     * nothing directly — the reconcile is the single source of those events.
     *
     * @param _window - The float window the tab was torn off into (unused; the
     *   reconcile re-derives every frame's host).
     */
    private onPanelDetached = (_window: AbstractWindow): void => {
        this.scheduleSweep();
    };

    /**
     * Window `"activate"` handler for an owned float: the float became the active
     * layer. Emits `"focus"` for the float's active panel, gated on a genuine
     * focused-panel change.
     *
     * @param window - The float window that was activated.
     */
    private onFloatActivated(window: AbstractWindow): void {
        const frame = this.activeFrameInFloat(window);

        if (frame) {
            this.setFocus(frame.getId());
        }
    }

    /**
     * Window `"close"` handler for an owned float: the float's chrome ✕ closed
     * it. Emits one `"close"` per registered frame the float held (a bare-`Window`
     * mini-dock can hold several) — read before the window tears down — and
     * recomputes focus when a closed frame was the focused panel.
     *
     * @param window - The float window being closed.
     */
    private onFloatClosed(window: AbstractWindow): void {
        let focusLost = false;

        for (const frame of this.framesInWindow(window)) {
            const id = frame.getId();

            this._frames.delete(id);
            this._panelHost.delete(id);
            this._frameRegion.delete(id);

            this.emit("close", { id, content: frame, window: null });

            if (this._focusedPanelId === id) {
                focusLost = true;
            }
        }

        // Route the close through the reconcile so a last-float close flips the
        // empty latch and fires "emptychange" (a float close schedules no
        // structural sweep of its own).
        this.scheduleSweep();

        if (focusLost) {
            this.scheduleFocusRecompute(null);
        }
    }

    /**
     * Sets the dock-wide focused panel and emits `"focus"` only on a genuine
     * change, so re-activating the already-focused panel is silent. A `null` id
     * clears focus and emits `focus(null)`.
     *
     * @param id - The newly-focused panel id, or `null` when none is focused.
     */
    private setFocus(id: string | null): void {
        if (id === this._focusedPanelId) {
            return;
        }

        this._focusedPanelId = id;

        if (id === null) {
            this.emit("focus", null);

            return;
        }

        const frame = this._frames.get(id);

        if (frame) {
            const host = this.hostForFrame(frame, this.getRootRegion());

            this.emit("focus", { id, content: frame, window: host });
        }
    }

    /**
     * Schedules a deferred focus recompute after a close. The source `Tab`
     * re-selects a survivor (visually, with no event) *after* its `"tabclose"`
     * fires, so the new active tab is only readable on the next frame.
     *
     * @param region - The region the closed frame was hosted in, or `null`.
     */
    private scheduleFocusRecompute(region: Component | null): void {
        DOM.sink.requestAnimationFrame(() => this.recomputeFocusAfterClose(region));
    }

    /**
     * Recomputes the dock-wide focus after the focused panel was closed: when
     * panels remain in `region`, focus the survivor the region re-selected; when
     * no panel remains anywhere, emit `focus(null)`.
     *
     * @param region - The region the closed frame was hosted in, or `null`.
     */
    private recomputeFocusAfterClose(region: Component | null): void {
        if (this._frames.size === 0) {
            this.setFocus(null);

            return;
        }

        if (!region || !this.isTab(region) || region.getComponents().length === 0) {
            this.setFocus(null);

            return;
        }

        const frame = (region.getLayoutManager() as Tab).getActiveContent();

        this.setFocus(frame ? frame.getId() : null);
    }

    /**
     * Activates the tab hosting `id` and raises its host float when it lives in
     * one, so a buried floated panel surfaces. A successful activation drives the
     * host `Tab`'s active-tab change and the float raise, each of which emits a
     * `"focus"`.
     *
     * @param id - The panel id to focus.
     *
     * @returns `true` when the panel was found and activated, `false` for an
     *   unknown id or one in no `Tab` region (registered but never docked).
     */
    focusPanel(id: string): boolean {
        const frame = this._frames.get(id);

        if (!frame) {
            return false;
        }

        const region = this.regionForFrame(frame);

        if (!region) {
            return false;
        }

        const index = (region.getLayoutManager() as Tab).indexOfContent(frame);

        if (index < 0) {
            return false;
        }

        this.floatForFrame(frame)?.bringToFront();
        (region.getLayoutManager() as Tab).setActiveTabIndex(index);

        return true;
    }

    /**
     * Closes the panel `id` through the same user-close path a tab ✕ takes, so it
     * emits exactly one `"close"` through the shared `"tabclose"` subscription.
     *
     * @param id - The panel id to close.
     *
     * @returns `true` when the panel was found and closed, `false` for an unknown
     *   id or one in no `Tab` region.
     */
    removePanel(id: string): boolean {
        const frame = this._frames.get(id);

        if (!frame) {
            return false;
        }

        const region = this.regionForFrame(frame);

        if (!region) {
            return false;
        }

        return (region.getLayoutManager() as Tab).closeTab(frame);
    }

    /**
     * The `Tab` region currently hosting `frame` — searched across the in-dock
     * tiled tree and every float window's region tree — or `null` when no `Tab`
     * region holds it (registered but never docked, or mid-teardown).
     *
     * @param frame - The identity frame to locate.
     *
     * @returns The host `Tab` region, or `null`.
     */
    private regionForFrame(frame: Component): Component | null {
        for (const region of this.allTabRegions()) {
            if ((region.getLayoutManager() as Tab).indexOfContent(frame) >= 0) {
                return region;
            }
        }

        return null;
    }

    /**
     * The float window currently hosting `frame`, or `null` when it lives in the
     * in-dock tiled tree (or nowhere). Used to raise a buried float on focus.
     *
     * @param frame - The identity frame to locate.
     *
     * @returns The host float window, or `null`.
     */
    private floatForFrame(frame: Component): AbstractWindow | null {
        return this.floatWindowsHoldingFrames().find(win => this.windowContains(win, frame)) ?? null;
    }

    /**
     * Every `Tab` region across the combined live tree: the in-dock root plus
     * each float window (an adopted bare-`Window` mini-dock's region tree, and a
     * `TabWindow` whose own layout manager is the `Tab`).
     *
     * @returns The live `Tab` regions.
     */
    private allTabRegions(): Component[] {
        const regions: Component[] = [];
        const root = this.getRootRegion();

        if (root) {
            this.collectTabRegions(root, regions);
        }

        for (const win of this.floatWindowsHoldingFrames()) {
            if (win instanceof TabWindow) {
                regions.push(win as unknown as Component);

                continue;
            }

            const content = this.windowContent(win);

            if (content) {
                this.collectTabRegions(content, regions);
            }
        }

        return regions;
    }

    /**
     * Collects every `Tab` region at or under `region` into `into`.
     *
     * @param region - The region to collect from.
     * @param into - The array to populate.
     */
    private collectTabRegions(region: Component, into: Component[]): void {
        if (this.isTab(region)) {
            into.push(region);
        }

        for (const child of region.getComponents()) {
            if (this.isRegionContainer(child)) {
                this.collectTabRegions(child, into);
            }
        }
    }

    /**
     * The registered frames of this dock that lie within `window`'s subtree — the
     * panels a float holds. Read at float-close time to fan out one `"close"` per
     * frame.
     *
     * @param window - The float window to inspect.
     *
     * @returns The registered frames inside the window.
     */
    private framesInWindow(window: AbstractWindow): Component[] {
        return [...this._frames.values()].filter(frame => this.windowContains(window, frame));
    }

    /**
     * The active panel frame inside a float window: a `TabWindow`'s own active
     * tab, or the active tab of the first `Tab` region inside a bare-`Window`
     * mini-dock. `null` when none resolves to a registered frame.
     *
     * @param window - The float window to inspect.
     *
     * @returns The active registered frame, or `null`.
     */
    private activeFrameInFloat(window: AbstractWindow): Component | null {
        let tab: Tab | null = null;

        if (window instanceof TabWindow) {
            tab = window.getLayoutManager() as Tab;
        } else {
            const content = this.windowContent(window);
            const regions: Component[] = [];

            if (content) {
                this.collectTabRegions(content, regions);
            }

            tab = regions.length > 0 ? (regions[0].getLayoutManager() as Tab) : null;
        }

        const frame = tab ? tab.getActiveContent() : null;

        return frame && this._frames.get(frame.getId()) === frame ? frame : null;
    }

    /**
     * Whether `node` lies at or under `ancestor`'s component subtree.
     *
     * @param ancestor - The candidate ancestor component.
     * @param node - The component whose ancestor chain to walk.
     *
     * @returns `true` when `ancestor` is `node` or one of its ancestors.
     */
    private isUnder(ancestor: Component, node: Component): boolean {
        for (let current: Component | null = node; current; current = current.getParentComponent()) {
            if (current === ancestor) {
                return true;
            }
        }

        return false;
    }

    /**
     * Registers a listener for a panel-lifecycle event. The `"attach"`,
     * `"detach"`, `"moved"`, and `"close"` events always carry a
     * {@link DockPanelEvent}; `"focus"` carries a `DockPanelEvent` or `null` when
     * nothing is focused. The payload's `window` field names the host: `null` for
     * the tiled tree, otherwise the float window the panel entered (`"attach"`),
     * left (`"detach"`), or moved within (`"moved"`, same host before and after);
     * it is always `null` for `"close"`.
     *
     * @param event - `"attach"` / `"detach"` / `"moved"` / `"close"`.
     * @param listener - Invoked with the affected panel.
     *
     * @returns This dock, for method chaining.
     */
    on(event: "attach" | "detach" | "moved" | "close", listener: (event: DockPanelEvent) => void): this;
    /**
     * Registers a listener for the `"focus"` event, which fires when the
     * dock-wide active panel changes, carrying the now-focused panel or `null`
     * when nothing is focused (e.g. the last panel closed).
     *
     * @param event - The `"focus"` event.
     * @param listener - Invoked with the now-focused panel, or `null`.
     *
     * @returns This dock, for method chaining.
     */
    on(event: "focus", listener: (event: DockPanelEvent | null) => void): this;
    /**
     * Registers a listener for the `"emptychange"` event, which fires once each
     * time the dock transitions between empty (no live panel anywhere) and
     * populated, carrying `{ empty }`.
     *
     * @param event - The `"emptychange"` event.
     * @param listener - Invoked with the new emptiness state.
     *
     * @returns This dock, for method chaining.
     */
    on(event: "emptychange", listener: (event: DockEmptyEvent) => void): this;
    on(event: DockEvent, listener: Function): this {
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
     * @returns This dock, for method chaining.
     */
    off(event: "attach" | "detach" | "moved" | "close", listener: (event: DockPanelEvent) => void): this;
    /**
     * Removes a previously registered `"focus"` listener.
     *
     * @param event - The `"focus"` event.
     * @param listener - The callback to remove.
     *
     * @returns This dock, for method chaining.
     */
    off(event: "focus", listener: (event: DockPanelEvent | null) => void): this;
    /**
     * Removes a previously registered `"emptychange"` listener.
     *
     * @param event - The `"emptychange"` event.
     * @param listener - The callback to remove.
     *
     * @returns This dock, for method chaining.
     */
    off(event: "emptychange", listener: (event: DockEmptyEvent) => void): this;
    off(event: DockEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event` with `payload`, in
     * registration order.
     *
     * @param event - The event to emit.
     * @param payload - The lifecycle payload (`null` only for `"focus"`).
     */
    protected emit(event: "attach" | "detach" | "moved" | "close", payload: DockPanelEvent): void;
    protected emit(event: "focus", payload: DockPanelEvent | null): void;
    protected emit(event: "emptychange", payload: DockEmptyEvent): void;
    protected emit(event: DockEvent, payload: DockPanelEvent | DockEmptyEvent | null): void {
        this._listeners.fire(event, payload);
    }
}

const DockCallable = callable(Dock);
type DockCallable = Dock;
export {
    Dock         as _Dock,
    DockCallable as Dock,
};
