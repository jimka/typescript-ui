// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// A read-only graph/diagram viewer. Takes a framework-native node/edge model,
// runs it through ELK for automatic layout (off-seam pure compute, lazily
// imported), and renders themed node components plus an SVG edge layer with pan,
// zoom, and node selection.
//
// Structure: DiagramView (the scrolling Panel viewport) owns a single content
// host Container (Absolute layout) that carries the zoom transform and holds the
// node components + the edge layer. Pan is native scroll on the viewport; zoom
// is a `scale()` transform on the content host, whose box is sized to
// graphBounds × zoom so the native scroll extent stays correct.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Container } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { Absolute } from "~/layout/Absolute.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { DiagramData, DiagramNodeData } from "~/component/diagram/DiagramModel.js";
import { ElkLayoutEngine, DiagramLayoutResult } from "~/component/diagram/ElkLayoutEngine.js";
import { DiagramNode } from "~/component/diagram/DiagramNode.js";
import { DiagramGroupNode } from "~/component/diagram/DiagramGroupNode.js";
import { DiagramEdgeLayer } from "~/component/diagram/DiagramEdgeLayer.js";
import type { DiagramEdgeRoute } from "~/component/diagram/DiagramEdgeLayer.js";
import { callable } from "~/core/Callable.js";

/** Factory producing a node component from a node's model data. */
export type DiagramNodeRenderer = (data: DiagramNodeData) => Component;

/** String-literal union of the events emitted by {@link DiagramView}. */
export type DiagramViewEvent = "selection" | "activate" | "layout";

/** Default initial zoom factor. */
const DEFAULT_ZOOM = 1;

/** Default minimum zoom factor (a quarter scale). */
const DEFAULT_MIN_ZOOM = 0.25;

/** Default maximum zoom factor (4× scale). */
const DEFAULT_MAX_ZOOM = 4;

/** Multiplicative zoom step per wheel notch. */
const WHEEL_ZOOM_STEP = 1.1;

// Paint order for a compound graph (one with at least one container): the
// container boxes sit behind the edges, which sit behind the leaves, so a
// leaf's click is never intercepted by its own container box. A leaf/container
// component is always freshly built by rebuildNodes, so on a flat graph it
// simply starts at DEFAULT_Z_INDEX and is never touched. The edge layer is the
// one exception — it is a persistent child of the content host (built once in
// the constructor, never torn down/rebuilt — see the constructor comment), so
// a flat pass must explicitly restore DEFAULT_Z_INDEX in case an earlier
// compound pass on the same view left EDGE_LAYER_Z_INDEX behind.
const DEFAULT_Z_INDEX = 0;
const CONTAINER_Z_INDEX = 0;
const EDGE_LAYER_Z_INDEX = 1;
const LEAF_Z_INDEX = 2;

/**
 * Construction-time options for {@link DiagramView}.
 *
 * @category Components
 */
export interface DiagramViewOptions extends PanelOptions {
    /** The initial graph to lay out and render. */
    data?: DiagramData;
    /** Factory for node components; defaults to building a `DiagramNode`. */
    nodeRenderer?: DiagramNodeRenderer;
    /** Factory for compound container components; defaults to `DiagramGroupNode`. */
    groupRenderer?: DiagramNodeRenderer;
    /** Default ELK layout options applied to every layout pass. */
    layoutOptions?: Record<string, string>;
    /** Optional URL of a consumer-hosted `elk-worker.js` for off-thread layout. */
    elkWorkerUrl?: string;
    /** Minimum zoom factor (default 0.25). */
    minZoom?: number;
    /** Maximum zoom factor (default 4). */
    maxZoom?: number;
    /** Initial zoom factor (default 1). */
    zoom?: number;
    /** Construction-time listener bag dispatched to {@link DiagramView.on}. */
    listeners?: {
        selection?: (nodes: DiagramNodeData[]) => void;
        activate?:  (node: DiagramNodeData) => void;
        layout?:    () => void;
    };
}

/**
 * A read-only automatic-layout graph viewer with pan, zoom, and node selection.
 *
 * Pass a graph via the `data` option or {@link DiagramView.setData}. Layout runs
 * asynchronously through ELK; a `"layout"` event fires after each successful
 * pass, a `"selection"` event fires when the selected node changes, and an
 * `"activate"` event fires when a node is double-clicked.
 *
 * @example
 * ```typescript
 * const view = new DiagramView({
 *     data: {
 *         nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
 *         edges: [{ id: "e", source: "a", target: "b" }],
 *     },
 * });
 * view.on("selection", (nodes) => console.log(nodes));
 * ```
 *
 * @category Components
 */
class DiagramView extends Panel<DiagramViewOptions> {

    /** The transform-carrying content host holding nodes + the edge layer. */
    private _contentHost!: Container;

    /** The SVG edge layer, a persistent child of the content host. */
    private _edgeLayer!: DiagramEdgeLayer;

    /** The ELK layout adapter. Runtime state, off the options bag. */
    private _engine!: ElkLayoutEngine;

    /** Node components keyed by node id. */
    private _nodeComponents: Map<string, Component> = new Map();

    /** Node model data keyed by node id (selection payload source). */
    private _nodeData: Map<string, DiagramNodeData> = new Map();

    /** Ids of the compound container nodes built by the last `rebuildNodes`. */
    private _containerIds: Set<string> = new Set();

    /** Currently selected node data (single-select). */
    private _selection: DiagramNodeData[] = [];

    /** Monotonic layout token; guards against a stale in-flight layout landing. */
    private _layoutGeneration: number = 0;

    /** Cached graph bounding box from the last successful layout. */
    private _graphWidth:  number = 0;
    private _graphHeight: number = 0;

    /** Custom-event fan-out for `"selection"` / `"layout"`. */
    private _listeners: ListenerBag<DiagramViewEvent> = new ListenerBag<DiagramViewEvent>();

    /** Pan drag state. */
    private _panning: boolean = false;
    private _panStartX: number = 0;
    private _panStartY: number = 0;
    private _panScrollLeft: number = 0;
    private _panScrollTop: number = 0;

    constructor(options?: DiagramViewOptions) {
        super(options, { zoom: DEFAULT_ZOOM, minZoom: DEFAULT_MIN_ZOOM, maxZoom: DEFAULT_MAX_ZOOM });

        this.setAutoScroll("auto");

        this._engine = this.createEngine();

        // Nodes are laid out at unscaled graph coordinates under the host's
        // `scale(zoom)` transform, so the host box (graph bounds × zoom) is
        // smaller than the node coordinates whenever zoom < 1. The base
        // `overflow: hidden` default would then crop the diagram to a
        // `zoom`-fraction of the graph; keep it visible so the whole graph
        // paints and the overflowing scaled nodes drive the native scroll
        // extent (which tracks the visual size — graph bounds × zoom).
        this._contentHost = new Container({ layoutManager: new Absolute(), overflow: "visible" });
        this._contentHost.setTransformOrigin("0 0");
        this.addComponent(this._contentHost);

        this._edgeLayer = new DiagramEdgeLayer();
        this._contentHost.addComponent(this._edgeLayer);

        this.applyListeners(options?.listeners);

        if (this._options.zoom !== undefined) {
            this.setZoom(this._options.zoom);
        }

        if (this._options.data) {
            this.setData(this._options.data);
        }
    }

    /**
     * Builds the layout engine. Isolated as a factory so the swappable-engine
     * seam can be exercised (a test substitutes a stub engine that returns a
     * fixed result without importing ELK).
     *
     * @returns A fresh {@link ElkLayoutEngine}.
     */
    protected createEngine(): ElkLayoutEngine {
        return new ElkLayoutEngine(this._options.elkWorkerUrl);
    }

    /**
     * Caches consumer-configurable fields pure to `_options`; effects that need
     * the content host (built in the constructor body) are dispatched there.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramViewOptions): this {
        super.applyOptions(options);

        if (options.data          !== undefined) this._options.data          = options.data;
        if (options.nodeRenderer   !== undefined) this._options.nodeRenderer  = options.nodeRenderer;
        if (options.groupRenderer  !== undefined) this._options.groupRenderer = options.groupRenderer;
        if (options.layoutOptions  !== undefined) this._options.layoutOptions = options.layoutOptions;
        if (options.elkWorkerUrl   !== undefined) this._options.elkWorkerUrl  = options.elkWorkerUrl;
        if (options.minZoom        !== undefined) this._options.minZoom       = options.minZoom;
        if (options.maxZoom        !== undefined) this._options.maxZoom       = options.maxZoom;
        if (options.zoom           !== undefined) this._options.zoom          = options.zoom;

        return this;
    }

    /**
     * Replaces the graph, rebuilds node components, and triggers an async layout.
     *
     * @param data - The new graph.
     *
     * @returns This view, for method chaining.
     */
    setData(data: DiagramData): this {
        this._options.data = data;
        this.rebuildNodes(data);
        this.relayout(data);

        return this;
    }

    /**
     * Returns the current graph, or `null` when none has been set.
     *
     * @returns The graph data, or `null`.
     */
    getData(): DiagramData | null {
        return this._options.data ?? null;
    }

    /**
     * Tears down the old node components + selection and builds fresh ones via
     * the node renderer (default: `DiagramNode`), adding them to the content
     * host. The persistent edge layer is cleared but not removed. Recurses into
     * `children`: a container node (non-empty `children`) is built via the
     * group renderer (default: `DiagramGroupNode`) and its children are built
     * the same way, so container + leaf components all land as flat siblings in
     * `_nodeComponents`/`_nodeData`, keyed by id — a container is never a DOM
     * parent of its children (that would perturb the single-content-host model
     * `nodeIdAt` hit-testing relies on).
     *
     * @param data - The graph whose nodes to build.
     */
    private rebuildNodes(data: DiagramData): void {
        for (const component of this._nodeComponents.values()) {
            this._contentHost.removeComponent(component);
        }

        this._nodeComponents.clear();
        this._nodeData.clear();
        this._containerIds.clear();
        this._selection = [];
        this._edgeLayer.setEdges([]);

        const renderer = this._options.nodeRenderer ?? ((node: DiagramNodeData): Component =>
            new DiagramNode({ label: node.label, glyph: node.glyph }));
        const groupRenderer = this._options.groupRenderer ?? ((node: DiagramNodeData): Component =>
            new DiagramGroupNode({ label: node.label, glyph: node.glyph }));

        const build = (nodes: DiagramNodeData[]): void => {
            for (const node of nodes) {
                const isContainer = (node.children?.length ?? 0) > 0;
                const component = isContainer ? groupRenderer(node) : renderer(node);

                this._nodeComponents.set(node.id, component);
                this._nodeData.set(node.id, node);
                this._contentHost.addComponent(component);

                if (isContainer) {
                    this._containerIds.add(node.id);
                    build(node.children!);
                }
            }
        };

        build(data.nodes);
    }

    /**
     * Collects node sizes, bumps the generation token, and runs the async ELK
     * layout. A stale result (older token) is dropped; a failed layout tears the
     * nodes down so the view stays empty.
     *
     * @param data - The graph to lay out.
     */
    private relayout(data: DiagramData): void {
        const sizes = this.collectNodeSizes(data);

        this._layoutGeneration += 1;
        const generation = this._layoutGeneration;

        this._engine
            .layout(data, sizes, this._options.layoutOptions)
            .then((result) => this.applyLayout(result, generation))
            .catch(() => this.handleLayoutFailure(generation));
    }

    /**
     * Resolves each node's size fed to ELK: the explicit `width`/`height` from
     * the model when present, else the node component's preferred size.
     * Recurses into `children` so every container and leaf is represented; a
     * container's entry is harmless-but-unused since `buildElkGraph` computes a
     * container's box from its contents rather than consulting this map.
     *
     * @param data - The graph whose node sizes to collect.
     * @returns A map of node id to resolved size.
     */
    private collectNodeSizes(data: DiagramData): Map<string, { width: number; height: number }> {
        const sizes = new Map<string, { width: number; height: number }>();

        const collect = (nodes: DiagramNodeData[]): void => {
            for (const node of nodes) {
                const component = this._nodeComponents.get(node.id);
                const preferred = component?.getPreferredSize();

                sizes.set(node.id, {
                    width:  node.width  ?? preferred?.width  ?? 0,
                    height: node.height ?? preferred?.height ?? 0,
                });

                if (node.children && node.children.length > 0) {
                    collect(node.children);
                }
            }
        };

        collect(data.nodes);

        return sizes;
    }

    /**
     * Applies a completed layout: positions each node, sizes + scales the
     * content host, redraws the edges, and emits `"layout"`. A stale result
     * (superseded by a newer `setData`) is ignored.
     *
     * @param result - The ELK layout result.
     * @param generation - The generation token captured when the layout started.
     */
    private applyLayout(result: DiagramLayoutResult, generation: number): void {
        if (generation !== this._layoutGeneration) {
            return;
        }

        for (const node of result.nodes) {
            const component = this._nodeComponents.get(node.id);

            if (component) {
                component.setPreferredSize({ width: node.width, height: node.height });
                component.setX(node.x);
                component.setY(node.y);
            }
        }

        this._graphWidth  = result.width;
        this._graphHeight = result.height;

        this._edgeLayer.setX(0);
        this._edgeLayer.setY(0);
        this._edgeLayer.setPreferredSize({ width: result.width, height: result.height });
        this._edgeLayer.setEdges(this.joinEdgeStyles(result.edges));

        this.applyContainerZIndex();

        this.applyZoomToHost();

        this.scheduleLayout();

        this.emit("layout");
    }

    /**
     * Applies the compound paint order — containers behind the edge layer,
     * leaves in front of it — when `rebuildNodes` built at least one
     * container. A flat graph's own (freshly-built) node components are never
     * touched here — they start at `DEFAULT_Z_INDEX` — but the persistent edge
     * layer is explicitly restored to `DEFAULT_Z_INDEX`, since an earlier
     * compound `setData` on this same view could have left it elevated (see
     * the module-level z-index constants).
     */
    private applyContainerZIndex(): void {
        if (this._containerIds.size === 0) {
            this._edgeLayer.setZIndex(DEFAULT_Z_INDEX);

            return;
        }

        this._edgeLayer.setZIndex(EDGE_LAYER_Z_INDEX);

        for (const [id, component] of this._nodeComponents) {
            component.setZIndex(this._containerIds.has(id) ? CONTAINER_Z_INDEX : LEAF_Z_INDEX);
        }
    }

    /**
     * Re-attaches each model edge's `style` to its layout-routed counterpart.
     * ELK's result carries only `{ id, sections }` — `style` never survives the
     * round trip — so this joins by edge id back to `this._options.data.edges`,
     * the model the layout was computed from.
     *
     * @param edges - The ELK-routed edges (id + sections only).
     * @returns The same routes, each carrying its model edge's `style` if any.
     */
    private joinEdgeStyles(edges: DiagramEdgeRoute[]): DiagramEdgeRoute[] {
        const modelById = new Map(this._options.data?.edges.map(e => [e.id, e]) ?? []);

        return edges.map(edge => ({ ...edge, style: modelById.get(edge.id)?.style }));
    }

    /**
     * Removes the just-built nodes when a layout fails (e.g. `elkjs` absent), so
     * the view stays empty rather than showing stacked, unpositioned nodes.
     *
     * @param generation - The generation token captured when the layout started.
     */
    private handleLayoutFailure(generation: number): void {
        if (generation !== this._layoutGeneration) {
            return;
        }

        for (const component of this._nodeComponents.values()) {
            this._contentHost.removeComponent(component);
        }

        this._nodeComponents.clear();
        this._nodeData.clear();
    }

    /**
     * Writes the content host's `scale()` transform and its scaled box from the
     * cached graph bounds and current zoom.
     */
    private applyZoomToHost(): void {
        const zoom = this.getZoom();

        this._contentHost.setTransform(`scale(${zoom})`);

        // The host's box feeds the viewport's native scroll extent, and the
        // `scale(zoom)` transform above already scales the box's contribution:
        // Chrome enlarges a scaled-up element's scroll-overflow footprint but
        // ignores a scaled-down one (it keeps the untransformed box). So the box
        // multiplier is clamped at 1 — on zoom-in the transform supplies the
        // growth (a `× zoom` box would overshoot to graph bounds × zoom² and add
        // phantom scrollbars), while on zoom-out the box must shrink with `zoom`
        // itself since the transform's shrink is ignored. Either way the host's
        // effective extent matches the nodes' own scaled extent (bounds × zoom).
        const boxScale = Math.min(zoom, 1);
        this._contentHost.setPreferredSize({ width: this._graphWidth * boxScale, height: this._graphHeight * boxScale });
    }

    /**
     * Returns the current zoom factor.
     *
     * @returns The zoom factor.
     */
    getZoom(): number {
        return this._options.zoom ?? this._defaultOptions.zoom ?? DEFAULT_ZOOM;
    }

    /**
     * Sets the zoom factor, clamped to `[minZoom, maxZoom]`, and re-scales the
     * content host.
     *
     * @param zoom - The desired zoom factor.
     *
     * @returns This view, for method chaining.
     */
    setZoom(zoom: number): this {
        this._options.zoom = this.clampZoom(zoom);
        this.applyZoomToHost();

        return this;
    }

    /**
     * Fits the whole graph into the viewport by choosing the largest zoom at
     * which the graph bounds fit both axes. Requires a completed layout.
     *
     * @returns This view, for method chaining.
     */
    zoomToFit(): this {
        if (this._graphWidth <= 0 || this._graphHeight <= 0) {
            return this;
        }

        const zoomX = this.getWidth()  / this._graphWidth;
        const zoomY = this.getHeight() / this._graphHeight;

        this.setZoom(Math.min(zoomX, zoomY));

        return this;
    }

    /**
     * Clamps a zoom request to the configured `[minZoom, maxZoom]` range.
     *
     * @param zoom - The requested zoom factor.
     * @returns The clamped zoom factor.
     */
    private clampZoom(zoom: number): number {
        const min = this._options.minZoom ?? this._defaultOptions.minZoom ?? DEFAULT_MIN_ZOOM;
        const max = this._options.maxZoom ?? this._defaultOptions.maxZoom ?? DEFAULT_MAX_ZOOM;

        return Math.max(min, Math.min(max, zoom));
    }

    /**
     * Returns the current selection (single-select).
     *
     * @returns A copy of the selected node data array.
     */
    getSelection(): DiagramNodeData[] {
        return [...this._selection];
    }

    /**
     * Selects a node programmatically without emitting `"selection"` (mirroring
     * the Tree precedent). Passing `null` clears the selection.
     *
     * @param id - The node id to select, or `null` to clear.
     *
     * @returns This view, for method chaining.
     */
    selectNode(id: string | null): this {
        this.setSelection(id);

        return this;
    }

    /**
     * Scrolls the viewport so the given node is centred, without changing the
     * selection or emitting any event. No-op for an unknown id or before the
     * first layout has positioned the node. Pair with {@link selectNode} to both
     * highlight and reveal.
     *
     * @param id - The node id to centre, or a no-op when not found.
     *
     * @returns This view, for method chaining.
     */
    revealNode(id: string): this {
        const component = this._nodeComponents.get(id);

        if (!component) {
            return this;
        }

        const zoom = this.getZoom();

        // Node centre in scaled (on-screen) coordinates; the inverse of
        // _handleWheel's graphX = (pointer + scroll) / zoom. Nodes carry unscaled
        // graph coords via getX/getY under the content host's scale(zoom).
        const centreX = (component.getX() + component.getWidth()  / 2) * zoom;
        const centreY = (component.getY() + component.getHeight() / 2) * zoom;

        // Scroll so the node centre lands at the viewport centre; the DOM clamps
        // the scroll offsets to their valid range on write-back.
        this.setScrollLeft(Math.max(0, centreX - this.getWidth()  / 2));
        this.setScrollTop (Math.max(0, centreY - this.getHeight() / 2));

        return this;
    }

    /**
     * Updates the selection state and toggles each node's selected visual.
     *
     * @param id - The node id to select, or `null` to clear.
     */
    private setSelection(id: string | null): void {
        for (const component of this._nodeComponents.values()) {
            this.applySelectedVisual(component, false);
        }

        const data = id === null ? undefined : this._nodeData.get(id);

        if (data) {
            this._selection = [data];
            this.applySelectedVisual(this._nodeComponents.get(id!)!, true);
        } else {
            this._selection = [];
        }
    }

    /**
     * Toggles a node component's selected visual when it supports one (the
     * default `DiagramNode` does; a custom renderer may not).
     *
     * @param component - The node component.
     * @param selected - The selected state to apply.
     */
    private applySelectedVisual(component: Component, selected: boolean): void {
        const node = component as unknown as { setSelected?: (value: boolean) => void };

        node.setSelected?.(selected);
    }

    /**
     * Registers a listener for a diagram event.
     *
     * @param event - `"selection"` fires when the selected node changes;
     *   `"activate"` fires when a node is double-clicked; `"layout"` fires
     *   after each successful ELK layout pass.
     * @param listener - The callback to invoke.
     *
     * @returns This view, for method chaining.
     */
    on(event: "selection", listener: (nodes: DiagramNodeData[]) => void): this;
    on(event: "activate",  listener: (node: DiagramNodeData) => void): this;
    on(event: "layout",    listener: () => void): this;
    on(event: DiagramViewEvent, listener: Function): this {
        this._listeners.add(event, listener);

        return this;
    }

    /**
     * Removes a previously registered listener; the exact reference must match.
     *
     * @param event - The event the listener was registered for.
     * @param listener - The callback to remove.
     *
     * @returns This view, for method chaining.
     */
    off(event: DiagramViewEvent, listener: Function): this {
        this._listeners.remove(event, listener);

        return this;
    }

    /**
     * Fires every listener registered for `event`, in registration order.
     *
     * @param event - The event to emit.
     * @param nodes - The selected node data (for `"selection"`), or the
     *   activated node data (for `"activate"`).
     */
    protected emit(event: "selection", nodes: DiagramNodeData[]): void;
    protected emit(event: "activate", node: DiagramNodeData): void;
    protected emit(event: "layout"): void;
    protected emit(event: DiagramViewEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Wires the DOM-routed pan / zoom / selection listeners once the element
     * exists.
     *
     * @param element - Optional element from the render pipeline.
     *
     * @returns This view, for method chaining.
     */
    protected init(element?: Handle): this {
        super.init(element);

        // All six use the SUBTREE variant: the content (nodes, the SVG edge
        // layer, and the Panel's own overlay-scroll element) are descendants of
        // this view's root, so a real wheel/pointer event's target is never the
        // root itself. An exact-target `addListener` would therefore never fire
        // for pan/zoom — only `addSubtreeListener` sees the descendant events
        // (mirrors click/dblclick, which is why selection worked but pan did not).
        Event.addSubtreeListener(this, "click", this._handleClick);
        Event.addSubtreeListener(this, "dblclick", this._handleDoubleClick);
        Event.addSubtreeListener(this, "wheel", this._handleWheel);
        Event.addSubtreeListener(this, "pointerdown", this._handlePointerDown);
        Event.addSubtreeListener(this, "pointermove", this._handlePointerMove);
        Event.addSubtreeListener(this, "pointerup", this._handlePointerUp);

        return this;
    }

    /**
     * Resolves the node under a click and updates the selection, emitting
     * `"selection"` when it changes. A click on empty space clears the
     * selection.
     *
     * @param event - The click event whose target is inside the view's subtree.
     */
    private _handleClick(event: MouseEvent): void {
        const id = this.nodeIdAt(event.target);

        if (id !== null) {
            if (id === (this._selection[0]?.id ?? null)) {
                return;
            }

            this.setSelection(id);
            this.emit("selection", this.getSelection());
        } else if (this._selection.length > 0) {
            this.setSelection(null);
            this.emit("selection", this.getSelection());
        }
    }

    /**
     * Resolves the node under a double-click and emits `"activate"` with its
     * data. A double-click is preceded by the single click that already
     * selected the node, so this only signals activation. A double-click on
     * empty space resolves to no node and emits nothing.
     *
     * @param event - The dblclick event whose target is inside the view's
     *   subtree.
     */
    private _handleDoubleClick(event: MouseEvent): void {
        const id = this.nodeIdAt(event.target);

        if (id === null) {
            return;
        }

        const data = this._nodeData.get(id);

        if (data !== undefined) {
            this.emit("activate", data);
        }
    }

    /**
     * Resolves the node id whose component owns the given event target.
     *
     * @param target - The raw DOM event target.
     * @returns The owning node id, or `null` when the target is not on a node.
     */
    private nodeIdAt(target: EventTarget | null): string | null {
        if (target === null) {
            return null;
        }

        const handle = DOM.source.intern(target);

        for (const [id, component] of this._nodeComponents) {
            const element = component.getElement();

            if (element && (element === handle || DOM.source.contains(element, handle))) {
                return id;
            }
        }

        return null;
    }

    /**
     * Wheel-zoom about the pointer: scales toward/away and adjusts the scroll
     * offsets so the graph point under the cursor stays put.
     *
     * @param event - The wheel event.
     */
    private _handleWheel(event: WheelEvent): void {
        event.preventDefault();

        const oldZoom = this.getZoom();
        const newZoom = this.clampZoom(oldZoom * (event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP));

        if (newZoom === oldZoom) {
            return;
        }

        const rect    = DOM.source.getViewportRect(this);
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;

        const graphX = (pointerX + this.getScrollLeft()) / oldZoom;
        const graphY = (pointerY + this.getScrollTop())  / oldZoom;

        this.setZoom(newZoom);

        this.setScrollLeft(graphX * newZoom - pointerX);
        this.setScrollTop(graphY * newZoom - pointerY);
    }

    /**
     * Begins a pan drag on a primary-button press, recording the start pointer
     * and scroll offsets.
     *
     * @param event - The pointerdown event.
     */
    private _handlePointerDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }

        this._panning        = true;
        this._panStartX      = event.clientX;
        this._panStartY      = event.clientY;
        this._panScrollLeft  = this.getScrollLeft();
        this._panScrollTop   = this.getScrollTop();
    }

    /**
     * Pans the viewport during a drag by writing the scroll offsets from the
     * pointer delta.
     *
     * @param event - The pointermove event.
     */
    private _handlePointerMove(event: PointerEvent): void {
        if (!this._panning) {
            return;
        }

        // The primary button is no longer held — the pointer was released
        // outside this view's subtree, so its `pointerup` never reached us. End
        // the pan here rather than keep dragging on a button-up move.
        if ((event.buttons & 1) === 0) {
            this._panning = false;

            return;
        }

        this.setScrollLeft(this._panScrollLeft - (event.clientX - this._panStartX));
        this.setScrollTop(this._panScrollTop - (event.clientY - this._panStartY));
    }

    /**
     * Ends a pan drag.
     */
    private _handlePointerUp(): void {
        this._panning = false;
    }
}

const DiagramViewCallable = callable(DiagramView);
type DiagramViewCallable = DiagramView;
export {
    DiagramView         as _DiagramView,
    DiagramViewCallable as DiagramView,
};
