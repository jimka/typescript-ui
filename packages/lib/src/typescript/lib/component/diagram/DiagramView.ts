// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// A read-only graph/diagram viewer. Takes a framework-native node/edge model,
// runs it through ELK for automatic layout (off-seam pure compute, lazily
// imported), and renders themed node components plus an SVG edge layer with pan,
// zoom, and node selection.
//
// Structure: DiagramView (an Anchor-managed Panel viewport) owns a single
// content host Container (Absolute layout) that carries the pan/zoom transform
// and holds the node components + the edge layer, plus a corner-pinned control
// cluster (zoom in/out, fit, reset). Pan is an unbounded `translate()` on the
// content host's transform, not native scroll — the viewport has no scrollbars
// and simply clips (`overflow: hidden`) whatever pans outside it, giving an
// infinite-canvas feel. Zoom is the transform's `scale()` factor.

import { Panel, PanelOptions } from "~/core/Panel.js";
import { Container } from "~/core/Container.js";
import { Component } from "~/core/Component.js";
import { Absolute } from "~/layout/Absolute.js";
import { Anchor } from "~/layout/Anchor.js";
import { AnchorConstraints } from "~/layout/AnchorConstraints.js";
import { VBox } from "~/layout/VBox.js";
import { Button } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { plus } from "~/glyphs/solid/plus.js";
import { minus } from "~/glyphs/solid/minus.js";
import { expand } from "~/glyphs/solid/expand.js";
import { crosshairs } from "~/glyphs/solid/crosshairs.js";
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

Glyph.register(plus, minus, expand, crosshairs);

/** Factory producing a node component from a node's model data. */
export type DiagramNodeRenderer = (data: DiagramNodeData) => Component;

/** String-literal union of the events emitted by {@link DiagramView}. */
export type DiagramViewEvent = "selection" | "activate" | "layout" | "contextmenu";

/** Default initial zoom factor. */
const DEFAULT_ZOOM = 1;

/** Default minimum zoom factor (a quarter scale). */
const DEFAULT_MIN_ZOOM = 0.25;

/** Default maximum zoom factor (4× scale). */
const DEFAULT_MAX_ZOOM = 4;

/** Multiplicative zoom step per wheel notch. */
const WHEEL_ZOOM_STEP = 1.1;

/** Multiplicative zoom step per control-cluster button press. */
const ZOOM_BUTTON_STEP = 1.5;

// Structural breathing room between the control cluster and the viewport
// corner it is pinned to — not a cosmetic choice, but the inset the Anchor
// constraint needs so the cluster does not paint flush against the edge.
const CONTROLS_MARGIN = 12;

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
    /** Show the built-in zoom / fit / reset control cluster (default true). */
    controls?: boolean;
    /** Construction-time listener bag dispatched to {@link DiagramView.on}. */
    listeners?: {
        selection?:   (nodes: DiagramNodeData[]) => void;
        activate?:    (node: DiagramNodeData) => void;
        layout?:      () => void;
        contextmenu?: (node: DiagramNodeData, event: MouseEvent) => void;
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

    /** Custom-event fan-out for `"selection"` / `"layout"` / `"contextmenu"`. */
    private _listeners: ListenerBag<DiagramViewEvent> = new ListenerBag<DiagramViewEvent>();

    /** Pan drag state. */
    private _panning: boolean = false;
    private _panStartX: number = 0;
    private _panStartY: number = 0;

    /** Pan offset (viewport pixels) captured when a drag begins. */
    private _panOriginX: number = 0;
    private _panOriginY: number = 0;

    /** Current, unbounded pan offset (viewport pixels) driving the content host's transform. */
    private _panX: number = 0;
    private _panY: number = 0;

    /**
     * Whether the graph still owes its one-time initial centring. Cleared by
     * the first layout that manages to centre, so a later `setData` re-layout
     * never yanks a pan the user has since dragged to.
     */
    private _needsInitialCentre: boolean = true;

    /**
     * Viewport size at the last layout, so a resize can be measured as a delta
     * and the graph point under the viewport centre held in place. `NaN` until
     * the view is first sized (matching `getWidth`/`getHeight`).
     */
    private _lastViewportWidth:  number = NaN;
    private _lastViewportHeight: number = NaN;

    /** The corner-pinned zoom / fit / reset control cluster. */
    private _controls!: Component;
    private _zoomInBtn!: Button;
    private _zoomOutBtn!: Button;
    private _fitBtn!: Button;
    private _resetBtn!: Button;

    private readonly _onZoomIn:  () => void = () => this.zoomIn();
    private readonly _onZoomOut: () => void = () => this.zoomOut();
    private readonly _onFit:     () => void = () => this.zoomToFit();
    private readonly _onReset:   () => void = () => this.resetView();

    constructor(options?: DiagramViewOptions) {
        super(options, { zoom: DEFAULT_ZOOM, minZoom: DEFAULT_MIN_ZOOM, maxZoom: DEFAULT_MAX_ZOOM, controls: true });

        this.setLayoutManager(new Anchor());
        this.setCursor("grab");

        this._engine = this.createEngine();

        // Nodes are laid out at unscaled graph coordinates under the host's
        // `translate(panX,panY) scale(zoom)` transform, and the host's own box
        // is likewise sized to the unscaled graph bounds (see applyLayout), so
        // node coordinates never exceed the box regardless of zoom — unlike the
        // old scaled-box model this stays visible for consistency with that
        // history rather than out of present necessity.
        // `cursor: "inherit"` rather than the Component default: the host is an
        // invisible box spanning the whole graph bounds, so the default
        // `cursor: default` every Component stamps would paint an arrow across
        // the entire canvas and mask the viewport's own grab/grabbing. Inheriting
        // lets the single write on the view root govern the whole canvas.
        this._contentHost = new Container({ layoutManager: new Absolute(), overflow: "visible", cursor: "inherit" });
        this._contentHost.setTransformOrigin("0 0");
        this.addComponent(this._contentHost);

        this._edgeLayer = new DiagramEdgeLayer();
        this._contentHost.addComponent(this._edgeLayer);

        this.buildControls();
        this.wireControlListeners();

        const controlsConstraints = new AnchorConstraints();
        controlsConstraints.right = CONTROLS_MARGIN;
        controlsConstraints.bottom = CONTROLS_MARGIN;
        this.addComponent(this._controls, controlsConstraints);

        this.applyListeners(options?.listeners);

        this.setControlsVisible(this._options.controls ?? this._defaultOptions.controls ?? true);

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
        // Cached only: the control cluster does not exist yet during the
        // `super()` cascade. The constructor dispatches `setControlsVisible`
        // itself once the cluster is built.
        if (options.controls       !== undefined) this._options.controls     = options.controls;

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

        // The host is no longer resized per zoom (see applyTransformToHost) — its
        // box always matches the unscaled graph bounds the nodes are laid out at.
        this._contentHost.setPreferredSize({ width: result.width, height: result.height });
        this.applyTransformToHost();

        // Before `emit`, so a consumer's own `"layout"` listener (the sanctioned
        // auto-fit hook, `view.on("layout", () => view.zoomToFit())`) still runs
        // afterwards and wins. Only succeeds if the view is already sized; the
        // `doLayout` override retries otherwise.
        this.tryInitialCentre();

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
     * Writes the content host's `translate(panX,panY) scale(zoom)` transform
     * from the current pan offset and zoom factor. The host's box is set once
     * per layout (see `applyLayout`) to the unscaled graph bounds and is not
     * touched here — pan and zoom live entirely on the transform.
     */
    private applyTransformToHost(): void {
        const zoom = this.getZoom();

        this._contentHost.setTransform(`translate(${this._panX}px, ${this._panY}px) scale(${zoom})`);
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
     * Sets the zoom factor, clamped to `[minZoom, maxZoom]` (the lower bound
     * adaptively lowered so a huge graph can still reach its fit zoom — see
     * `effectiveMinZoom`), and re-applies the content host's transform. A
     * non-finite request (e.g. `zoomToFit`'s `graphWidth / 0` on an unsized
     * view) is rejected outright rather than clamped, since `Math.max`/`min`
     * propagate `NaN` instead of resolving it — this is the one guard every
     * zoom-changing entry point (`zoomToFit`, `resetView`, `zoomIn`/`zoomOut`)
     * relies on rather than each re-checking its own inputs.
     *
     * @param zoom - The desired zoom factor.
     *
     * @returns This view, for method chaining.
     */
    setZoom(zoom: number): this {
        if (!Number.isFinite(zoom)) {
            return this;
        }

        this._options.zoom = this.clampZoom(zoom);
        this.applyTransformToHost();

        return this;
    }

    /**
     * Fits the whole graph into the viewport by choosing the largest zoom at
     * which the graph bounds fit both axes, then centres the graph. Requires a
     * completed layout.
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
        this.centreGraph();

        return this;
    }

    /**
     * Resets to the default zoom and re-centres the graph.
     *
     * @returns This view, for method chaining.
     */
    resetView(): this {
        this.setZoom(this._defaultOptions.zoom ?? DEFAULT_ZOOM);
        this.centreGraph();

        return this;
    }

    /**
     * Steps the zoom up by the configured multiplicative factor, keeping the
     * graph point currently at the viewport centre fixed.
     *
     * @returns This view, for method chaining.
     */
    zoomIn(): this {
        this.zoomAboutViewportPoint(ZOOM_BUTTON_STEP, this.getWidth() / 2, this.getHeight() / 2);

        return this;
    }

    /**
     * Steps the zoom down by the configured multiplicative factor, keeping the
     * graph point currently at the viewport centre fixed.
     *
     * @returns This view, for method chaining.
     */
    zoomOut(): this {
        this.zoomAboutViewportPoint(1 / ZOOM_BUTTON_STEP, this.getWidth() / 2, this.getHeight() / 2);

        return this;
    }

    /**
     * Attempts the one-time initial centring, so the first render shows the
     * graph where `resetView` would put it rather than at the viewport's
     * top-left corner. The configured `zoom` is deliberately left alone (unlike
     * `resetView`, which also restores the default zoom), so a consumer's
     * explicit `zoom` option still decides the initial scale.
     *
     * Both inputs arrive asynchronously and in either order: the graph bounds
     * come from an ELK layout, the viewport size from the host's layout pass.
     * So this is *retried* — from `applyLayout` and from every `doLayout` —
     * until it actually succeeds, and the pending flag is cleared only on a
     * confirmed centring. Clearing it on an attempt that silently no-opped
     * (the view not yet sized, `centreGraph` returning `false`) is what used to
     * leave the diagram stuck in the corner whenever the layout landed first.
     */
    private tryInitialCentre(): void {
        if (!this._needsInitialCentre || !(this._graphWidth > 0) || !(this._graphHeight > 0)) {
            return;
        }

        if (this.centreGraph()) {
            this._needsInitialCentre = false;
        }
    }

    /**
     * Centres the graph bounds in the viewport at the current zoom, without
     * changing the zoom factor. Shared by `zoomToFit`, `resetView`, and the
     * initial centring. Declines before the view is sized —
     * `getWidth()`/`getHeight()` are `NaN` (not 0) until then (see
     * `effectiveMinZoom`), and writing a `NaN` pan would blank the diagram
     * until another call recomputes it.
     *
     * @returns `true` when the pan was written, `false` when the view has no
     *   committed size yet and the caller should try again later.
     */
    private centreGraph(): boolean {
        const vw = this.getWidth();
        const vh = this.getHeight();

        if (!(vw > 0) || !(vh > 0)) {
            return false;
        }

        const zoom = this.getZoom();

        this._panX = (vw - this._graphWidth  * zoom) / 2;
        this._panY = (vh - this._graphHeight * zoom) / 2;

        this.applyTransformToHost();

        return true;
    }

    /**
     * Scales by `factor` about a fixed viewport point: the graph point under
     * `(vx, vy)` maps to the same viewport point before and after the zoom.
     * Shared by the zoom in/out control buttons and (about the pointer instead
     * of the viewport centre) by wheel-zoom. A no-op when `vx`/`vy` is not
     * finite — `zoomIn`/`zoomOut` pass the viewport centre, which is `NaN`
     * before the view is sized (see `centreGraph`).
     *
     * @param factor - The multiplicative zoom change (`> 1` zooms in).
     * @param vx - The viewport-relative x coordinate to keep fixed.
     * @param vy - The viewport-relative y coordinate to keep fixed.
     */
    private zoomAboutViewportPoint(factor: number, vx: number, vy: number): void {
        if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
            return;
        }

        const oldZoom = this.getZoom();
        const newZoom = this.clampZoom(oldZoom * factor);

        if (newZoom === oldZoom) {
            return;
        }

        const graphX = (vx - this._panX) / oldZoom;
        const graphY = (vy - this._panY) / oldZoom;

        this._panX = vx - graphX * newZoom;
        this._panY = vy - graphY * newZoom;

        this.setZoom(newZoom);
    }

    /**
     * Resolves the effective minimum zoom: the configured `minZoom`, floored
     * further down to the zoom that fits the whole graph in the current
     * viewport when the graph is too large for that configured floor to reach.
     * A small graph is unaffected (its fit zoom already exceeds the configured
     * minimum); an unsized or unlaid-out view falls back to the configured
     * minimum untouched.
     *
     * @returns The effective minimum zoom factor.
     */
    private effectiveMinZoom(): number {
        const configuredMin = this._options.minZoom ?? this._defaultOptions.minZoom ?? DEFAULT_MIN_ZOOM;
        const vw = this.getWidth();
        const vh = this.getHeight();

        // `getWidth()` / `getHeight()` are `NaN` (not 0) before the first
        // `setSize` — `> 0` (rather than `<= 0`) also rejects NaN, since every
        // NaN comparison is false.
        if (!(this._graphWidth > 0) || !(this._graphHeight > 0) || !(vw > 0) || !(vh > 0)) {
            return configuredMin;
        }

        const fitZoom = Math.min(vw / this._graphWidth, vh / this._graphHeight);

        return Math.min(configuredMin, fitZoom);
    }

    /**
     * Clamps a zoom request to `[effectiveMinZoom(), maxZoom]`.
     *
     * @param zoom - The requested zoom factor.
     * @returns The clamped zoom factor.
     */
    private clampZoom(zoom: number): number {
        const min = this.effectiveMinZoom();
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
     * Pans so the given node is centred in the viewport, without changing the
     * selection, zoom, or emitting any event. No-op for an unknown id, before
     * the first layout has positioned the node, or before the view/node has a
     * real committed size — `getWidth()`/`getHeight()` are `NaN` (not `0`)
     * until then (see `effectiveMinZoom`). Unlike a non-finite zoom request,
     * which `setZoom` rejects outright, a `NaN` pan has no such gate here, so
     * it is guarded directly: a `NaN` pan is sticky, silently blanking the
     * diagram until another call recomputes it. Pair with {@link selectNode}
     * to both highlight and reveal.
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

        // Node centre in unscaled graph coordinates.
        const centreX = component.getX() + component.getWidth()  / 2;
        const centreY = component.getY() + component.getHeight() / 2;

        // Pan so the node centre maps to the viewport centre: viewport = pan + graph·zoom.
        const panX = this.getWidth()  / 2 - centreX * zoom;
        const panY = this.getHeight() / 2 - centreY * zoom;

        if (!Number.isFinite(panX) || !Number.isFinite(panY)) {
            return this;
        }

        this._panX = panX;
        this._panY = panY;

        this.applyTransformToHost();

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
     *   after each successful ELK layout pass; `"contextmenu"` fires when a
     *   node is right-clicked.
     * @param listener - The callback to invoke.
     *
     * @returns This view, for method chaining.
     */
    on(event: "selection",   listener: (nodes: DiagramNodeData[]) => void): this;
    on(event: "activate",    listener: (node: DiagramNodeData) => void): this;
    on(event: "layout",      listener: () => void): this;
    on(event: "contextmenu", listener: (node: DiagramNodeData, event: MouseEvent) => void): this;
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
     *   activated / right-clicked node data (for `"activate"` / `"contextmenu"`).
     */
    protected emit(event: "selection", nodes: DiagramNodeData[]): void;
    protected emit(event: "activate", node: DiagramNodeData): void;
    protected emit(event: "layout"): void;
    protected emit(event: "contextmenu", node: DiagramNodeData, mouseEvent: MouseEvent): void;
    protected emit(event: DiagramViewEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Lays the viewport out, then retries the pending initial centring. This is
     * where the viewport size becomes known, and an ELK layout that landed
     * before the host sized this view has nothing to centre against until now
     * (see `tryInitialCentre`). Writes only the content host's transform, never
     * a child's rect, so it cannot feed back into the layout it runs inside.
     *
     * @returns This view, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.tryInitialCentre();
        this.anchorCentreAcrossResize();

        return this;
    }

    /**
     * Holds the graph point under the viewport centre still across a viewport
     * resize, so whatever the user was looking at stays in the middle instead
     * of drifting toward a corner as the window grows or shrinks.
     *
     * With `viewport = pan + graph·zoom`, keeping the centre's graph point
     * fixed means `pan += (newExtent − oldExtent) / 2` on each axis — the zoom
     * cancels out, so this is correct at any zoom and never changes it. The
     * first sizing has no previous centre to preserve, so it only records the
     * extent (the initial centring owns that pass).
     */
    private anchorCentreAcrossResize(): void {
        const vw = this.getWidth();
        const vh = this.getHeight();

        if (!(vw > 0) || !(vh > 0)) {
            return;
        }

        const previousWidth  = this._lastViewportWidth;
        const previousHeight = this._lastViewportHeight;

        this._lastViewportWidth  = vw;
        this._lastViewportHeight = vh;

        if (!(previousWidth > 0) || !(previousHeight > 0)) {
            return;
        }

        if (previousWidth === vw && previousHeight === vh) {
            return;
        }

        this._panX += (vw - previousWidth)  / 2;
        this._panY += (vh - previousHeight) / 2;

        this.applyTransformToHost();
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

        // All seven use the SUBTREE variant: the content (nodes, the SVG edge
        // layer, and the Panel's own overlay-scroll element) are descendants of
        // this view's root, so a real wheel/pointer event's target is never the
        // root itself. An exact-target `addListener` would therefore never fire
        // for pan/zoom — only `addSubtreeListener` sees the descendant events
        // (mirrors click/dblclick, which is why selection worked but pan did not).
        Event.addSubtreeListener(this, "click", this._handleClick);
        Event.addSubtreeListener(this, "dblclick", this._handleDoubleClick);
        Event.addSubtreeListener(this, "contextmenu", this._handleContextMenu);
        // Non-passive: `_handleWheel` calls `preventDefault()` to suppress the
        // page's native scroll/zoom, which a passive listener silently ignores
        // (mirrors `Component.attachWheelScrolling` / `WheelTrap`).
        Event.addSubtreeListener(this, "wheel", this._handleWheel, { passive: false });
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
        if (this.isControlsTarget(event.target)) {
            return;
        }

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
     * Resolves the node under a right-click and emits `"contextmenu"` with its
     * data, mirroring `Tree`'s contextmenu handling: a node hit suppresses the
     * browser's native menu via `preventDefault` and emits; a right-click on
     * empty canvas is left to the browser.
     *
     * @param event - The contextmenu event whose target is inside the view's
     *   subtree.
     */
    private _handleContextMenu(event: MouseEvent): void {
        const id = this.nodeIdAt(event.target);

        if (id === null) {
            return;
        }

        const data = this._nodeData.get(id);

        if (data !== undefined) {
            event.preventDefault();
            this.emit("contextmenu", data, event);
        }
    }

    /**
     * Whether the given raw DOM event target lands inside the control cluster
     * — used to keep the cluster's own clicks/drags from also being
     * interpreted as a canvas click (clearing selection) or the start of a pan.
     *
     * @param target - The raw DOM event target.
     * @returns `true` when the target is the cluster or one of its descendants.
     */
    private isControlsTarget(target: EventTarget | null): boolean {
        if (target === null || this._controls === undefined) {
            return false;
        }

        const el = this._controls.getElement();
        const handle = DOM.source.intern(target);

        return el !== undefined && (el === handle || DOM.source.contains(el, handle));
    }

    /**
     * Wheel-zoom about the pointer: scales toward/away, keeping the graph
     * point under the cursor fixed in the viewport.
     *
     * @param event - The wheel event.
     */
    private _handleWheel(event: WheelEvent): void {
        event.preventDefault();

        const rect = DOM.source.getViewportRect(this);

        this.zoomAboutViewportPoint(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP,
            event.clientX - rect.left, event.clientY - rect.top);
    }

    /**
     * Begins a pan drag on a primary-button press over the canvas (the control
     * cluster is excluded), recording the start pointer and pan offset, and
     * switches the cursor to `"grabbing"`.
     *
     * @param event - The pointerdown event.
     */
    private _handlePointerDown(event: PointerEvent): void {
        // A press on a node (leaf or container) or on the control cluster is not
        // a pan: both show `pointer`, and the cursor has to promise what the
        // drag will actually do. Panning is the empty canvas's gesture, which is
        // exactly where `grab` shows.
        if (event.button !== 0 || this.isControlsTarget(event.target) || this.nodeIdAt(event.target) !== null) {
            return;
        }

        this._panning    = true;
        this._panStartX  = event.clientX;
        this._panStartY  = event.clientY;
        this._panOriginX = this._panX;
        this._panOriginY = this._panY;

        this.setCursor("grabbing");
    }

    /**
     * Pans the content host during a drag by writing the pan offset from the
     * pointer delta — unbounded, so the graph can be dragged into empty space
     * in any direction.
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
            this.setCursor("grab");

            return;
        }

        this._panX = this._panOriginX + (event.clientX - this._panStartX);
        this._panY = this._panOriginY + (event.clientY - this._panStartY);

        this.applyTransformToHost();
    }

    /**
     * Ends a pan drag and restores the `"grab"` cursor.
     */
    private _handlePointerUp(): void {
        this._panning = false;
        this.setCursor("grab");
    }

    /** Builds the corner-pinned zoom / fit / reset control cluster. */
    private buildControls(): void {
        this._zoomInBtn  = this.makeControlButton("plus",       "Zoom in");
        this._zoomOutBtn = this.makeControlButton("minus",      "Zoom out");
        this._fitBtn     = this.makeControlButton("expand",     "Fit to view");
        this._resetBtn   = this.makeControlButton("crosshairs", "Reset view");

        this._controls = new Component();
        this._controls.setLayoutManager(new VBox());
        this._controls.addComponent(this._zoomInBtn);
        this._controls.addComponent(this._zoomOutBtn);
        this._controls.addComponent(this._fitBtn);
        this._controls.addComponent(this._resetBtn);
    }

    /**
     * Builds a glyph-only control button with an accessible label, mirroring
     * `VideoPlayer`'s control-bar buttons.
     *
     * @param glyph - The glyph name to show.
     * @param label - The accessible name (drives `aria-label` and the tooltip).
     * @returns The configured button.
     */
    private makeControlButton(glyph: string, label: string): Button {
        return new Button({ glyph, text: label, showText: false });
    }

    /** Wires the control cluster's buttons to their viewport-motion methods. */
    private wireControlListeners(): void {
        this._zoomInBtn.on("action", this._onZoomIn);
        this._zoomOutBtn.on("action", this._onZoomOut);
        this._fitBtn.on("action", this._onFit);
        this._resetBtn.on("action", this._onReset);
    }

    /**
     * Whether the built-in zoom / fit / reset control cluster is visible.
     *
     * @returns `true` when the control cluster shows.
     */
    isControlsVisible(): boolean {
        return this._options.controls ?? this._defaultOptions.controls ?? true;
    }

    /**
     * Shows or hides the built-in control cluster.
     *
     * @param value - Whether the control cluster is visible.
     *
     * @returns This view, for method chaining.
     */
    setControlsVisible(value: boolean): this {
        this._options.controls = value;
        this._controls.setVisible(value);

        return this;
    }
}

const DiagramViewCallable = callable(DiagramView);
type DiagramViewCallable = DiagramView;
export {
    DiagramView         as _DiagramView,
    DiagramViewCallable as DiagramView,
};
