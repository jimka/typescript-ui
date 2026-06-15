// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Container, ContainerOptions } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { AbstractWindow } from "~/core/AbstractWindow.js";
import { Fit } from "~/layout/Fit.js";
import { Tab } from "~/layout/Tab.js";
import { Split } from "~/layout/Split.js";
import { DockRegion } from "~/layout/DockRegion.js";
import { LayoutConstraints } from "~/layout/LayoutConstraints.js";
import { serializeLayout, restoreLayout, LayoutState } from "~/layout/LayoutSerialization.js";
import { DragManager, DragEventDetail, tabDragRegistry } from "~/core/DragManager.js";
import { DropZoneOverlay } from "~/core/component/DropZoneOverlay.js";
import { callable } from "~/core/Callable.js";

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
    | { split: "horizontal" | "vertical"; children: DockLayoutSpec[] }
    | { tabs: DockPanelSpec[] };

/**
 * Construction options for a {@link Dock}.
 *
 * @category Core
 */
export interface DockOptions extends ContainerOptions {
    /** Initial arrangement, compiled to the region tree at construction. Omit for an empty dock. */
    layout?: DockLayoutSpec;
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
 * tear off into floating [`Window`](/api/core/classes/Window)s, drop on region
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
    // region container -> its DnD wiring; the sweep's idempotence + teardown ledger.
    private _wiring:         Map<Component, RegionWiring> = new Map<Component, RegionWiring>();
    // rAF coalescing latch so a burst of moves in one gesture yields one sweep.
    private _sweepScheduled: boolean = false;

    // Overlay highlighting the dock as a drop target while it is empty (every
    // panel torn off) and a tab is dragged over it.
    private _emptyDropOverlay: DropZoneOverlay = new DropZoneOverlay();

    // Named, bound listener reference for the DockRegion post-drop callback,
    // routing through one removable handler that coalesces via scheduleSweep.
    private requestSweep: () => void = (): void => {
        this.scheduleSweep();
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
            this.activeTabRegion().moveComponent(content, undefined, this.leafConstraints(spec));
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
     * @param state - A layout state from {@link getLayoutState}.
     *
     * @returns This dock, for chaining.
     */
    setLayoutState(state: LayoutState): this {
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
            const content = typeof spec.content === "function" ? spec.content() : spec.content;

            frame = new Container({ id: spec.id, name: spec.title, layoutManager: new Fit() });
            frame.addComponent(content);

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
    private leafConstraints(spec: DockPanelSpec): LayoutConstraints | undefined {
        if (!spec.glyph) {
            return undefined;
        }

        const constraints = new LayoutConstraints();
        constraints.glyph = spec.glyph;

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

        if (this.isTab(root)) {
            return root;
        }

        return this.firstTabRegion(root) ?? this.wrapRootInTab();
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
            const region = new Container({ layoutManager: new Split({ direction: spec.split }) });

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

        requestAnimationFrame(() => {
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

        this.teardownVanished(root, floatRegions);
    }

    /**
     * Open windows whose content subtree holds one of this dock's identity frames
     * — the floats torn off from this dock — excluding the window the dock itself
     * lives in. Re-derived each sweep (never cached) so a closed float drops out
     * naturally, mirroring the derived-live root in {@link getRootRegion}.
     *
     * @returns The owned float windows.
     */
    private ownedFloatWindows(): AbstractWindow[] {
        const frames = [...this._frames.values()];

        return AbstractWindow.getOpenWindows().filter(win =>
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
            (manager as Tab).setReorderable(true);
            // Tear a dock tab off into a plain header Window hosting the bare
            // identity frame (not a TabWindow), so the sweep can adopt it into a
            // mini-dock region tree the user can edge-split and re-dock.
            (manager as Tab).setDetachWindowMode("bare");
            (manager as Tab).on("empty", () => this.pruneRegion(region));

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

        parent.removeComponent(region);
        this.collapseSinglePaneSplit(parent);
        this.scheduleSweep();
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
}

const DockCallable = callable(Dock);
type DockCallable = Dock;
export {
    Dock         as _Dock,
    DockCallable as Dock,
};
