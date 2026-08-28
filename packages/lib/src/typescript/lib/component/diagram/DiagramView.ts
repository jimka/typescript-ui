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
import { VBox } from "~/layout/VBox.js";
import { FloatingPanel } from "~/component/container/FloatingPanel.js";
import { Button } from "~/component/button/Button.js";
import { Glyph } from "~/component/display/Glyph.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { plus } from "~/glyphs/solid/plus.js";
import { minus } from "~/glyphs/solid/minus.js";
import { expand } from "~/glyphs/solid/expand.js";
import { crosshairs } from "~/glyphs/solid/crosshairs.js";
import { Event } from "~/core/Event.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { DiagramData, DiagramEdgeData, DiagramNodeData } from "~/component/diagram/DiagramModel.js";
import { ElkLayoutEngine, DiagramLayoutResult } from "~/component/diagram/ElkLayoutEngine.js";
import { DiagramNode } from "~/component/diagram/DiagramNode.js";
import { DiagramGroupNode } from "~/component/diagram/DiagramGroupNode.js";
import { DiagramEdgeLayer } from "~/component/diagram/DiagramEdgeLayer.js";
import type { DiagramEdgeRoute } from "~/component/diagram/DiagramEdgeLayer.js";
import { computeResidentIds, inflateRect, residencyNeedsRefresh } from "~/component/diagram/DiagramResidency.js";
import type { DiagramRect } from "~/component/diagram/DiagramResidency.js";
import { callable } from "~/core/Callable.js";

Glyph.register(plus, minus, expand, crosshairs);

/** Factory producing a node component from a node's model data. */
export type DiagramNodeRenderer = (data: DiagramNodeData) => Component;

/** String-literal union of the events emitted by {@link DiagramView}. */
export type DiagramViewEvent = "selection" | "activate" | "layout" | "contextmenu" | "edgehover" | "edgeleave";

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

/**
 * Pixel distance the pointer must travel between `pointerdown` and a later
 * `pointermove` before the press-and-release it ends in counts as a drag
 * rather than a click. Matches `DragManager.DRAG_THRESHOLD`, the library's
 * only other click-versus-drag disambiguation.
 */
const CLICK_SLOP = 4;

/**
 * Opacity of a node component outside a non-empty node-emphasis set. Higher
 * than `DiagramEdgeLayer`'s `DIMMED_EDGE_OPACITY` (`0.15`) because perceived
 * presence scales with area, not just alpha: a `TableCardNode`-sized box with
 * a border and text rows still reads at `0.15`, whereas a 1.5px hairline
 * needs the lower number to recede. `0.35` keeps a dimmed card's shape and
 * label legible while clearly receding behind the emphasised ones.
 */
const DIMMED_NODE_OPACITY = 0.35;

// Diameter in pixels of the busy overlay's arc. Matches `TablePanel`'s
// store-loading spinner and `createSpinnerWrap`'s lazy-tab placeholder, so a
// slow diagram update and a slow data load read as the same kind of wait.
const BUSY_SPINNER_DIAMETER = 24;

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
 * How far beyond the visible graph rectangle nodes stay mounted and edges
 * stay drawn, as a fraction of the viewport's own extent on each side — so
 * the residency rect is twice the viewport in each axis. The diagram's
 * counterpart to the row pool's ±2-row scroll buffer: rows have a uniform
 * pitch to count in, diagram nodes and edges do not, so the buffer is
 * expressed in viewports. Half a viewport is what lets the refresh threshold
 * (half of this margin, a quarter viewport of travel) absorb a fast drag
 * without a node or edge appearing at the viewport edge.
 */
const RESIDENCY_MARGIN = 0.5;

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
    /**
     * URL of a consumer-hosted `elk-worker.js`, requesting off-thread layout.
     * With the `elk.bundled.js` module this view's engine imports, elkjs's
     * own worker-availability check always fails, so `workerUrl` alone never
     * actually constructs a Worker; layout still runs on the main thread, via
     * elkjs's own fallback. Pass {@link DiagramViewOptions.elkWorkerFactory}
     * for real off-thread execution.
     */
    elkWorkerUrl?: string;
    /**
     * Factory returning a Web Worker for off-thread ELK layout. When set,
     * ELK's compute runs in the returned worker. Construct it in your app so
     * your bundler emits the worker, e.g.
     * `() => new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url), { type: "classic" })`.
     * Takes precedence over {@link DiagramViewOptions.elkWorkerUrl} when both
     * are set.
     */
    elkWorkerFactory?: () => Worker;
    /** Minimum zoom factor (default 0.25). */
    minZoom?: number;
    /** Maximum zoom factor (default 4). */
    maxZoom?: number;
    /** Initial zoom factor (default 1). */
    zoom?: number;
    /** Show the built-in zoom / fit / reset control cluster (default true). */
    controls?: boolean;
    /**
     * Id of the node the one-shot initial view centres on, instead of the
     * graph's bounds. An id naming no node in the graph falls back to
     * centring the bounds. The configured `zoom` is honoured, except that a
     * focus node too large to fit the viewport lowers it until the node fits.
     */
    initialFocusNode?: string;
    /** Construction-time listener bag dispatched to {@link DiagramView.on}. */
    listeners?: {
        selection?:   (nodes: DiagramNodeData[]) => void;
        activate?:    (node: DiagramNodeData) => void;
        layout?:      () => void;
        contextmenu?: (node: DiagramNodeData, event: MouseEvent) => void;
        edgehover?:   (edges: DiagramEdgeData[], event: MouseEvent) => void;
        edgeleave?:   () => void;
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

    /** Node components keyed by node id — the graph currently on screen. */
    private _nodeComponents: Map<string, Component> = new Map();

    /** Laid-out box per node id, from the last successful layout — the graph currently on screen. */
    private _nodeRects: Map<string, DiagramRect> = new Map();

    /** Node model data keyed by node id (selection payload source) — the graph currently on screen. */
    private _nodeData: Map<string, DiagramNodeData> = new Map();

    /** Ids of the compound container nodes in the graph currently on screen. */
    private _containerIds: Set<string> = new Set();

    /**
     * The graph built by the latest `setData`, mounted hidden and awaiting a
     * layout. Promoted into the shown set above by `applyLayout`, discarded by
     * `handleLayoutFailure` or by the next `rebuildNodes`. Kept separate from
     * the shown set so a re-layout leaves the previous graph on screen for the
     * whole ELK round-trip instead of blanking the canvas.
     */
    private _incomingComponents:  Map<string, Component> = new Map();
    /** Boxes for the graph awaiting a layout; promoted beside `_incomingComponents`. */
    private _incomingRects:       Map<string, DiagramRect> = new Map();
    private _incomingData:        Map<string, DiagramNodeData> = new Map();
    private _incomingContainerIds: Set<string> = new Set();

    /** Ids of the node components currently added to the content host. */
    private _residentIds: Set<string> = new Set();

    /** Visible graph rectangle the resident set was last computed for; `null` forces a rebuild. */
    private _residencyViewport: DiagramRect | null = null;

    /** Currently selected node data (single-select). */
    private _selection: DiagramNodeData[] = [];

    /**
     * Ids of the emphasised nodes; every other node component is dimmed.
     * Runtime interaction state, off the options bag — the view's own mirror
     * of `DiagramEdgeLayer`'s `_edgeEmphasis`, except there is no equivalent
     * layer for nodes, so it lives here instead. Cleared in
     * `promoteIncomingNodes` beside `_selection`.
     */
    private _nodeEmphasis: Set<string> = new Set();

    /** Monotonic layout token; guards against a stale in-flight layout landing. */
    private _layoutGeneration: number = 0;

    /** Resolver for the promise `whenLaidOut` hands out, or `null` when idle. */
    private _layoutSettled: { promise: Promise<void>; resolve: () => void } | null = null;

    /**
     * The overlay busy indicator, built the first time a layout pass runs on a
     * view that has a size. Runtime state, deliberately off the options bag.
     */
    private _busySpinner: ProgressSpinner | null = null;

    /** Cached graph bounding box from the last successful layout. */
    private _graphWidth:  number = 0;
    private _graphHeight: number = 0;

    /** Custom-event fan-out for `"selection"` / `"layout"` / `"contextmenu"`. */
    private _listeners: ListenerBag<DiagramViewEvent> = this.registerListenerBag(new ListenerBag<DiagramViewEvent>());

    /** Edge ids of the last emitted "edgehover", joined, or null when not hovering. */
    private _hoveredEdgeKey: string | null = null;

    /** Pan drag state. */
    private _panning: boolean = false;
    private _panStartX: number = 0;
    private _panStartY: number = 0;

    /**
     * Pointer position at the last `pointerdown`, and whether the pointer has
     * since travelled past `CLICK_SLOP`. Runtime gesture state, off the
     * options bag: `_handleClick` reads `_pointerMoved` to tell a click from
     * the tail end of a drag — a pan that starts and ends on empty canvas
     * still fires a native `click`, and it must not clear the selection (or
     * the edge emphasis the app keys off it).
     */
    private _pressX: number = 0;
    private _pressY: number = 0;
    private _pointerMoved: boolean = false;

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
     * Id of the node the one-shot initial view centres on, instead of the
     * graph's bounds; also the target of the most recent `focusNode` call.
     * Seeded from `initialFocusNode` in the constructor body (mirroring how
     * `data`/`controls` are cached during `applyOptions` and dispatched once
     * the constructor body can act on them) and re-pointed by `focusNode`.
     */
    private _focusNodeId: string | null = null;

    /**
     * Viewport size at the last layout, so a resize can be measured as a delta
     * and the graph point under the viewport centre held in place. `NaN` until
     * the view is first sized (matching `getWidth`/`getHeight`).
     */
    private _lastViewportWidth:  number = NaN;
    private _lastViewportHeight: number = NaN;

    /** The corner-pinned zoom / fit / reset control cluster. */
    private _controls!: FloatingPanel;
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

        this.addComponent(this._controls, this._controls.getAnchorConstraints());

        this.applyListeners(options?.listeners);

        this.setControlsVisible(this._options.controls ?? this._defaultOptions.controls ?? true);

        if (this._options.zoom !== undefined) {
            this.setZoom(this._options.zoom);
        }

        this._focusNodeId = this._options.initialFocusNode ?? null;

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
        return new ElkLayoutEngine({
            workerFactory: this._options.elkWorkerFactory,
            workerUrl:     this._options.elkWorkerUrl,
        });
    }

    /**
     * Disposes the layout engine — releasing its ELK Web Worker, if it had one
     * — before the inherited destructor detaches the element.
     */
    protected destructor(): void {
        // Invalidate any layout still in flight before the engine goes away. A
        // result landing afterwards would write into a torn-down view, and a
        // failure landing afterwards would strip nodes off it; both guards
        // compare against this token and drop a stale one.
        this._layoutGeneration += 1;

        // Settle rather than leave dangling: a caller awaiting `whenLaidOut()`
        // (e.g. the app holding a lazy tab's spinner) must not hang forever
        // just because the view was disposed on some other path mid-pass.
        this.settleLayout();

        // The spinner is mounted by a raw DOM append rather than as a child
        // component, so the inherited destructor's child pass never reaches it.
        this._busySpinner?.dispose();
        this._busySpinner = null;

        // A resident node component is a content-host child, so the inherited
        // destructor's own child recursion (through `_contentHost`) reaches
        // and disposes it. An unmounted one is detached with no parent to
        // recurse through, so it must be disposed explicitly here — without
        // this, tearing the view down would strand every non-resident node's
        // per-instance stylesheet rule.
        for (const [id, component] of this._nodeComponents) {
            if (!this._residentIds.has(id)) {
                component.dispose();
            }
        }

        this._engine.dispose();

        super.destructor();
    }

    /**
     * Caches consumer-configurable fields pure to `_options`; effects that need
     * the content host (built in the constructor body) are dispatched there.
     *
     * @param options - The options bag carrying the values to apply.
     */
    protected applyOptions(options: DiagramViewOptions): this {
        super.applyOptions(options);

        if (options.data              !== undefined) this._options.data              = options.data;
        if (options.nodeRenderer      !== undefined) this._options.nodeRenderer      = options.nodeRenderer;
        if (options.groupRenderer     !== undefined) this._options.groupRenderer     = options.groupRenderer;
        if (options.layoutOptions     !== undefined) this._options.layoutOptions     = options.layoutOptions;
        if (options.elkWorkerUrl      !== undefined) this._options.elkWorkerUrl      = options.elkWorkerUrl;
        if (options.elkWorkerFactory  !== undefined) this._options.elkWorkerFactory  = options.elkWorkerFactory;
        if (options.minZoom           !== undefined) this._options.minZoom           = options.minZoom;
        if (options.maxZoom           !== undefined) this._options.maxZoom           = options.maxZoom;
        if (options.zoom              !== undefined) this._options.zoom              = options.zoom;
        // Cached only: the control cluster does not exist yet during the
        // `super()` cascade. The constructor dispatches `setControlsVisible`
        // itself once the cluster is built.
        if (options.controls       !== undefined) this._options.controls     = options.controls;
        // Cached only: dispatched into the runtime `_focusNodeId` field from
        // the constructor body, mirroring `data` below.
        if (options.initialFocusNode !== undefined) this._options.initialFocusNode = options.initialFocusNode;

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
     * Builds fresh node components via the node renderer (default:
     * `DiagramNode`) into the *incoming* set, built and measured off the
     * component tree and left `setVisible(false)` — not `display: none`, so
     * the flag still reads false the instant a component mounts, before the
     * promote step's reveal. `applyLayout` positions them, then
     * `promoteIncomingNodes` swaps them in for the shown set, mounts them, and
     * reveals them together, so a diagram never paints an unplaced graph and a
     * re-layout keeps the previous graph on screen for the whole ELK
     * round-trip. A graph superseded by a newer `setData` before its layout
     * lands is therefore never mounted at all. Leads with
     * `discardIncomingNodes()` so a second `setData` arriving before the
     * first's layout lands does not leak the first attempt's components.
     * Recurses into `children`: a container node (non-empty `children`) is
     * built via the group renderer (default: `DiagramGroupNode`) and its
     * children are built the same way, so container + leaf components all
     * land as flat siblings in `_incomingComponents`/`_incomingData`, keyed by
     * id — a container is never a DOM parent of its children (that would
     * perturb the single-content-host model `nodeIdAt` hit-testing relies on).
     *
     * @param data - The graph whose nodes to build.
     */
    private rebuildNodes(data: DiagramData): void {
        this.discardIncomingNodes();

        const renderer = this._options.nodeRenderer ?? ((node: DiagramNodeData): Component =>
            new DiagramNode({ label: node.label, glyph: node.glyph, badge: node.badge }));
        const groupRenderer = this._options.groupRenderer ?? ((node: DiagramNodeData): Component =>
            new DiagramGroupNode({ label: node.label, glyph: node.glyph }));

        const build = (nodes: DiagramNodeData[]): void => {
            for (const node of nodes) {
                const isContainer = (node.children?.length ?? 0) > 0;
                const component = isContainer ? groupRenderer(node) : renderer(node);

                component.setVisible(false);

                this._incomingComponents.set(node.id, component);
                this._incomingData.set(node.id, node);

                if (isContainer) {
                    this._incomingContainerIds.add(node.id);
                    build(node.children!);
                }
            }
        };

        build(data.nodes);
    }

    /** Forgets the un-promoted incoming components; never mounted, so nothing to detach. */
    private discardIncomingNodes(): void {
        this._incomingComponents.clear();
        this._incomingRects.clear();
        this._incomingData.clear();
        this._incomingContainerIds.clear();
    }

    /**
     * Swaps the incoming set in for the shown one: disposes every shown
     * component (they are being discarded, not re-parented, so a bare
     * `removeComponent` would leak their listeners/theme subscriptions/style
     * rules — see `Component.destructor`), detaching first only the ones
     * currently mounted — an unmounted component has no content-host parent
     * to detach from — promotes the incoming maps, clears the selection and
     * the node emphasis, reveals every promoted component together, then
     * rebuilds the residency set from scratch so the new graph mounts
     * whichever of its nodes are near the viewport. This is the first time
     * an incoming component can be added to the content host at all.
     */
    private promoteIncomingNodes(): void {
        for (const [id, component] of this._nodeComponents) {
            if (this._residentIds.has(id)) {
                this._contentHost.removeComponent(component);
            }

            component.dispose();
        }

        this._residentIds = new Set();
        this._residencyViewport = null;

        this._nodeComponents  = this._incomingComponents;
        this._nodeRects       = this._incomingRects;
        this._nodeData        = this._incomingData;
        this._containerIds    = this._incomingContainerIds;

        this._incomingComponents  = new Map();
        this._incomingRects       = new Map();
        this._incomingData        = new Map();
        this._incomingContainerIds = new Set();

        this._selection = [];
        this._nodeEmphasis = new Set();

        for (const component of this._nodeComponents.values()) {
            component.setVisible(true);
        }

        this.updateResidency();
    }

    /**
     * Collects node sizes, bumps the generation token, and runs the async ELK
     * layout. A stale result (older token) is dropped; a failed layout tears the
     * nodes down so the view stays empty.
     *
     * @param data - The graph to lay out.
     */
    private relayout(data: DiagramData): void {
        this.armLayoutSettled();
        this.syncBusyIndicator();

        const sizes = this.collectNodeSizes(data);

        this._layoutGeneration += 1;
        const generation = this._layoutGeneration;

        this._engine
            .layout(data, sizes, this._options.layoutOptions)
            .then((result) => this.applyLayout(result, generation))
            .catch(() => this.handleLayoutFailure(generation));
    }

    /**
     * Arms the awaitable `whenLaidOut` hands out, so one deferred spans
     * however many layout passes run before one of them finishes. A no-op
     * when a pass is already in flight, so two rapid `setData` calls share
     * one promise, resolved by whichever pass settles it.
     */
    private armLayoutSettled(): void {
        if (this._layoutSettled !== null) {
            return;
        }

        let resolve!: () => void;
        const promise = new Promise<void>((r) => { resolve = r; });

        this._layoutSettled = { promise, resolve };
    }

    /** Settles the armed `whenLaidOut` awaitable, if there is one. */
    private settleLayout(): void {
        const settled = this._layoutSettled;

        this._layoutSettled = null;
        settled?.resolve();

        this.syncBusyIndicator();
    }

    /**
     * Matches the overlay busy indicator to whether a layout pass is in flight,
     * and re-sizes a showing overlay to the current viewport. Called when a pass
     * starts, when one settles, and from every layout pass — which is where a
     * view that had no size when its pass started finally gets one.
     *
     * A view with no committed size has nothing to cover: `getWidth()` /
     * `getHeight()` are `NaN` (not 0) until the first `setSize`, and `> 0` rejects
     * both (see `effectiveMinZoom`). That also keeps the indicator off the first
     * pass every diagram runs from its own constructor, before its host has sized
     * it — whatever opened the view owns that first wait.
     */
    private syncBusyIndicator(): void {
        if (this._layoutSettled === null || !(this.getWidth() > 0) || !(this.getHeight() > 0)) {
            this._busySpinner?.hideOverlay();

            return;
        }

        if (this._busySpinner === null) {
            this._busySpinner = new ProgressSpinner(BUSY_SPINNER_DIAMETER);
        }

        // `showOverlay` is a no-op once shown, so the explicit `doLayout` is what
        // re-sizes a showing overlay after a viewport resize: the spinner is
        // mounted by a raw DOM append, so it is not in this view's laid-out set
        // and nothing else ever lays it out.
        this._busySpinner.showOverlay(this);
        this._busySpinner.doLayout();
    }

    /**
     * Resolves once the layout pass currently in flight has finished placing
     * nodes. Resolves immediately when no pass is in flight, and resolves
     * (never rejects) when a pass fails or the view is disposed mid-pass —
     * a rejecting promise would force every caller into a `try`/`catch`
     * whose only sensible branch is "carry on anyway".
     *
     * @returns A promise settling on the next finished layout pass.
     */
    whenLaidOut(): Promise<void> {
        return this._layoutSettled?.promise ?? Promise.resolve();
    }

    /**
     * Resolves each node's size fed to ELK: the explicit `width`/`height` from
     * the model when present, else the node component's preferred size — read
     * before the component is mounted, which is safe because measurement goes
     * through the DOM seam's font metrics rather than the live document (a
     * custom `nodeRenderer` whose preferred size needs a live element in the
     * document is not supported). Recurses into `children` so every container
     * and leaf is represented; a container's entry is harmless-but-unused
     * since `buildElkGraph` computes a container's box from its contents
     * rather than consulting this map.
     *
     * @param data - The graph whose node sizes to collect.
     * @returns A map of node id to resolved size.
     */
    private collectNodeSizes(data: DiagramData): Map<string, { width: number; height: number }> {
        const sizes = new Map<string, { width: number; height: number }>();

        const collect = (nodes: DiagramNodeData[]): void => {
            for (const node of nodes) {
                const component = this._incomingComponents.get(node.id);
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
     * Applies a completed layout: positions each incoming node, promotes the
     * incoming set to shown (revealing it), sizes + scales the content host,
     * redraws the edges, and emits `"layout"`. A stale result (superseded by
     * a newer `setData`) is ignored.
     *
     * @param result - The ELK layout result.
     * @param generation - The generation token captured when the layout started.
     */
    private applyLayout(result: DiagramLayoutResult, generation: number): void {
        if (generation !== this._layoutGeneration) {
            return;
        }

        for (const node of result.nodes) {
            const component = this._incomingComponents.get(node.id);

            if (component) {
                component.setPreferredSize({ width: node.width, height: node.height });
                component.setX(node.x);
                component.setY(node.y);

                this._incomingRects.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height });
            }
        }

        this._graphWidth  = result.width;
        this._graphHeight = result.height;

        this.promoteIncomingNodes();

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

        this.settleLayout();
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
     * Discards the just-built incoming nodes when a layout fails (e.g. `elkjs`
     * absent), so a first, never-shown graph leaves the view empty, and a
     * failed *re*-layout leaves whatever graph was already on screen — rather
     * than showing stacked, unpositioned nodes either way.
     *
     * @param generation - The generation token captured when the layout started.
     */
    private handleLayoutFailure(generation: number): void {
        if (generation !== this._layoutGeneration) {
            return;
        }

        this.discardIncomingNodes();
        this.settleLayout();
    }

    /**
     * Writes the content host's `translate(panX,panY) scale(zoom)` transform
     * from the current pan offset and zoom factor. The host's box is set once
     * per layout (see `applyLayout`) to the unscaled graph bounds and is not
     * touched here — pan and zoom live entirely on the transform. Also the
     * single place the mounted node set and the drawn edge set are
     * reconciled (`updateResidency`) — every pan, zoom, centring, and
     * resize-anchoring path in this view ends here, so a residency check
     * placed anywhere else would be redundant or miss an entry point.
     */
    private applyTransformToHost(): void {
        const zoom = this.getZoom();

        this._contentHost.setTransform(`translate(${this._panX}px, ${this._panY}px) scale(${zoom})`);

        this.updateResidency();
    }

    /**
     * The visible viewport as a box in unscaled graph coordinates, or `null`
     * before the view is sized. Inverts the same `translate(panX,panY)
     * scale(zoom)` transform `applyTransformToHost` writes — the mapping
     * `_handleEdgeMouseMove` already applies to a pointer position.
     *
     * @returns The visible graph rectangle, or `null` when the view has no committed size yet.
     */
    private viewportGraphRect(): DiagramRect | null {
        const vw = this.getWidth();
        const vh = this.getHeight();

        if (!(vw > 0) || !(vh > 0)) {
            return null;
        }

        const zoom = this.getZoom();

        return { x: -this._panX / zoom, y: -this._panY / zoom, width: vw / zoom, height: vh / zoom };
    }

    /**
     * Reconciles the mounted node set and the drawn edge set with the current
     * viewport: recomputes the residency rect only when `residencyNeedsRefresh`
     * says the live viewport has outgrown the one the set was last computed
     * for, then mounts every newly-resident node and unmounts every node that
     * fell out, and hands the same rectangle to the edge layer to reconcile
     * its own drawn set — a no-op while the view has no committed size
     * (`viewportGraphRect` returns `null`), leaving whatever residency set
     * already exists.
     */
    private updateResidency(): void {
        const live = this.viewportGraphRect();

        if (live === null || !residencyNeedsRefresh(this._residencyViewport, live, RESIDENCY_MARGIN)) {
            return;
        }

        this._residencyViewport = live;

        const residency = inflateRect(live, RESIDENCY_MARGIN);
        const next = computeResidentIds(this._nodeComponents.keys(), this._nodeRects, residency);

        for (const id of this._residentIds) {
            if (!next.has(id)) {
                this.unmountNode(id);
            }
        }

        for (const id of next) {
            if (!this._residentIds.has(id)) {
                this.mountNode(id);
            }
        }

        this._residentIds = next;

        this._edgeLayer.setResidency(residency);
    }

    /**
     * Adds `id`'s node component to the content host, first writing its
     * committed width/height from the cached laid-out box — the value the
     * content host's own `Absolute` layout pass would otherwise write only on
     * its next flush (see `LayoutManager.commitBounds`) — so the element
     * never paints one frame at its intrinsic (unset) size. A node with no
     * cached box (a graph that has never been laid out) is mounted unsized;
     * `applyLayout`'s own `setPreferredSize`/`setX`/`setY` writes always
     * precede this for a node that has one.
     *
     * @param id - The node id to mount.
     */
    private mountNode(id: string): void {
        const component = this._nodeComponents.get(id);

        if (!component) {
            return;
        }

        const rect = this._nodeRects.get(id);

        if (rect) {
            component.setWidth(rect.width);
            component.setHeight(rect.height);
        }

        this._contentHost.addComponent(component);
    }

    /**
     * Removes `id`'s node component from the content host. Detach-only, like
     * the underlying `Component.removeComponent` it calls: the component
     * object and its now-detached element are left intact, so re-entering the
     * residency rect later re-appends the same element instead of rebuilding
     * it (see the "Unmounting detaches the element" Architecture Decision in
     * the node-virtualization plan).
     *
     * @param id - The node id to unmount.
     */
    private unmountNode(id: string): void {
        const component = this._nodeComponents.get(id);

        if (!component) {
            return;
        }

        this._contentHost.removeComponent(component);
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
     * Resets to the default zoom, then re-centres: on the focus node when the
     * view has one that is in the shown graph, else on the graph bounds. The
     * focus node is `initialFocusNode`, or the target of the most recent
     * `focusNode` call. Centring a node also lowers the zoom, if needed, until
     * the node's whole box fits. Retried after the next layout pass when the
     * view has no committed size yet.
     *
     * @returns This view, for method chaining.
     */
    resetView(): this {
        this.setZoom(this._defaultOptions.zoom ?? DEFAULT_ZOOM);

        this._needsInitialCentre = true;
        this.tryInitialCentre();

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
     * top-left corner. The configured `zoom` deliberately stands (unlike
     * `resetView`, which also restores the default zoom), so a consumer's
     * explicit `zoom` option still decides the initial scale — except that a
     * focus node too large to fit the viewport lowers it until the node fits.
     *
     * Both inputs arrive asynchronously and in either order: the graph bounds
     * come from an ELK layout, the viewport size from the host's layout pass.
     * So this is *retried* — from `applyLayout`, from every `doLayout`, and
     * from `resetView` — until it actually succeeds, and the pending flag is
     * cleared only on a confirmed centring. Clearing it on an attempt that
     * silently no-opped (the view not yet sized, `centreGraph` returning
     * `false`) is what used to leave the diagram stuck in the corner whenever
     * the layout landed first.
     *
     * Picks between two targets: `_focusNodeId`, when it names a node in the
     * graph just promoted, or the graph's bounds otherwise — the same
     * generalisation `focusNode` reuses at runtime instead of a separate
     * one-shot mechanism.
     */
    private tryInitialCentre(): void {
        if (!this._needsInitialCentre || !(this._graphWidth > 0) || !(this._graphHeight > 0)) {
            return;
        }

        const focus = this._focusNodeId !== null && this._nodeComponents.has(this._focusNodeId)
            ? this._focusNodeId
            : null;

        if (focus !== null ? this.centreNode(focus) : this.centreGraph()) {
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
     * Resolves the zoom that fits `size` whole in the viewport, never raising
     * the current zoom — only lowering it when the size does not already fit.
     * Shared by every node-centring entry point (`centreNode`, and so
     * `revealNode`, `focusNode`, and the focus-node branch of
     * `tryInitialCentre`) so a card larger than the viewport is never
     * centred-and-clipped.
     *
     * @param size - The node box to fit, in unscaled graph coordinates.
     * @returns The clamped zoom to use for the centring.
     */
    private zoomFittingNode(size: { width: number; height: number }): number {
        const current = this.getZoom();
        const vw       = this.getWidth();
        const vh       = this.getHeight();

        // `getWidth()` / `getHeight()` are `NaN` before the first `setSize`, and a
        // zero-sized node box has no fit zoom — `> 0` rejects both, since every
        // NaN comparison is false (see `effectiveMinZoom`).
        if (!(vw > 0) || !(vh > 0) || !(size.width > 0) || !(size.height > 0)) {
            return this.clampZoom(current);
        }

        const fitZoom = Math.min(vw / size.width, vh / size.height);

        return this.clampZoom(Math.min(current, fitZoom));
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
     * Emphasises a subset of the drawn edges: every edge outside the set
     * recedes to a lower opacity while the named ones keep their normal
     * weight. Cleared by `null`, by an empty array, and by the next layout
     * that replaces the drawn edges. Emits nothing. Forwards straight to the
     * edge layer, which owns the emphasis state — this view holds no copy of
     * its own.
     *
     * @param ids - The edge ids to emphasise, or null to clear.
     *
     * @returns This view, for method chaining.
     */
    setEdgeEmphasis(ids: readonly string[] | null): this {
        this._edgeLayer.setEdgeEmphasis(ids);

        return this;
    }

    /**
     * The currently emphasised edge ids.
     *
     * @returns A copy of the emphasised id array; empty when nothing is emphasised.
     */
    getEdgeEmphasis(): string[] {
        return this._edgeLayer.getEdgeEmphasis();
    }

    /**
     * Emphasises a subset of the drawn nodes: every node component outside
     * the set dims to a reduced opacity while the named ones keep full
     * opacity. Cleared by `null`, by an empty array, and by the next layout
     * that rebuilds the node components (`promoteIncomingNodes`). Emits
     * nothing. Dims through `Component.setOpacity` / `clearOpacity` directly
     * on each node's own root, so a custom `nodeRenderer` needs no
     * cooperation — unlike `applySelectedVisual`, which duck-types a
     * `setSelected?.()` because "selected" has no single generic rendering.
     * An unknown id is kept in the set (and reported back by
     * `getNodeEmphasis`) but dims nothing, since no node component answers to
     * it.
     *
     * @param ids - The node ids to emphasise, or null to clear.
     *
     * @returns This view, for method chaining.
     */
    setNodeEmphasis(ids: readonly string[] | null): this {
        this._nodeEmphasis = new Set(ids ?? []);
        this.applyNodeEmphasis();

        return this;
    }

    /**
     * The currently emphasised node ids.
     *
     * @returns A copy of the emphasised id array; empty when nothing is emphasised.
     */
    getNodeEmphasis(): string[] {
        return [...this._nodeEmphasis];
    }

    /** Rewrites every node component's opacity from the current emphasis set. */
    private applyNodeEmphasis(): void {
        for (const [id, component] of this._nodeComponents) {
            if (this._nodeEmphasis.size === 0 || this._nodeEmphasis.has(id)) {
                component.clearOpacity();
            } else {
                component.setOpacity(DIMMED_NODE_OPACITY);
            }
        }
    }

    /**
     * Pans so the given node is centred in the viewport, without changing the
     * selection or emitting any event. Also lowers the zoom, if needed, until
     * the node's whole box fits the viewport — never raises it. No-op for an
     * unknown id, before the first layout has positioned the node, or before
     * the view has a real committed size — `getWidth()`/`getHeight()` are
     * `NaN` (not `0`) until then (see `effectiveMinZoom`). Unlike a
     * non-finite zoom request, which `setZoom` rejects outright, a `NaN` pan
     * has no such gate here, so it is guarded directly: a `NaN` pan is
     * sticky, silently blanking the diagram until another call recomputes
     * it. Pair with {@link selectNode} to both highlight and reveal. Unlike
     * {@link focusNode}, this does not retry — a no-op call must be repeated
     * by the caller once the view is sized.
     *
     * @param id - The node id to centre, or a no-op when not found.
     *
     * @returns This view, for method chaining.
     */
    revealNode(id: string): this {
        this.centreNode(id);

        return this;
    }

    /**
     * Centres a node in the viewport by writing the pan, without changing the
     * selection or emitting any event. Also lowers the zoom, via
     * `zoomFittingNode`, when the node's whole box does not already fit the
     * viewport — never raises it.
     *
     * @param id - The node id to centre.
     *
     * @returns `true` when the pan and zoom were written, `false` when the
     *   node is unknown or the view has no committed size yet.
     */
    private centreNode(id: string): boolean {
        const component = this._nodeComponents.get(id);
        const size      = component?.getPreferredSize();

        if (!component || !size) {
            return false;
        }

        const zoom = this.zoomFittingNode(size);

        // Node centre in unscaled graph coordinates.
        const centreX = component.getX() + size.width  / 2;
        const centreY = component.getY() + size.height / 2;

        // Pan so the node centre maps to the viewport centre: viewport = pan + graph·zoom.
        const panX = this.getWidth()  / 2 - centreX * zoom;
        const panY = this.getHeight() / 2 - centreY * zoom;

        if (!Number.isFinite(panX) || !Number.isFinite(panY)) {
            return false;
        }

        this._panX = panX;
        this._panY = panY;

        // Writes the pan fields first, then lets `setZoom` apply the transform
        // once — the shape `zoomAboutViewportPoint` already uses.
        this.setZoom(zoom);

        return true;
    }

    /**
     * Centres the given node in the viewport, retrying after each layout pass
     * until it succeeds — unlike `revealNode`, which centres only when the
     * graph and the viewport are both already measured. Also lowers the
     * zoom, if needed, until the node's whole box fits the viewport; never
     * raises it.
     *
     * @param id - The node id to centre on.
     *
     * @returns This view, for method chaining.
     */
    focusNode(id: string): this {
        this._focusNodeId = id;
        this._needsInitialCentre = true;

        this.tryInitialCentre();

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
     *   node is right-clicked; `"edgehover"` fires with every model edge
     *   within the pointer's hit tolerance (several where routes overlap) and
     *   the originating event; `"edgeleave"` fires when the pointer leaves
     *   whatever edge(s) it was hovering.
     * @param listener - The callback to invoke.
     *
     * @returns This view, for method chaining.
     */
    on(event: "selection",   listener: (nodes: DiagramNodeData[]) => void): this;
    on(event: "activate",    listener: (node: DiagramNodeData) => void): this;
    on(event: "layout",      listener: () => void): this;
    on(event: "contextmenu", listener: (node: DiagramNodeData, event: MouseEvent) => void): this;
    on(event: "edgehover",   listener: (edges: DiagramEdgeData[], event: MouseEvent) => void): this;
    on(event: "edgeleave",   listener: () => void): this;
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
    protected emit(event: "edgehover", edges: DiagramEdgeData[], mouseEvent: MouseEvent): void;
    protected emit(event: "edgeleave"): void;
    protected emit(event: DiagramViewEvent, ...payload: unknown[]): void {
        this._listeners.fire(event, ...payload);
    }

    /**
     * Lays the viewport out, then retries the pending initial centring. This is
     * where the viewport size becomes known, and an ELK layout that landed
     * before the host sized this view has nothing to centre against until now
     * (see `tryInitialCentre`). Also re-syncs the busy overlay, which is where a
     * view that had no size when its layout pass started finally picks the
     * overlay up. Writes only the content host's transform and the (unmanaged)
     * overlay, never a child's rect, so neither can feed back into the layout it
     * runs inside.
     *
     * @returns This view, for method chaining.
     */
    doLayout(): this {
        super.doLayout();

        this.tryInitialCentre();
        this.anchorCentreAcrossResize();
        this.syncBusyIndicator();

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
        Event.addSubtreeListener(this, "wheel", { passive: false, prevent: true, handler: this._handleWheel });
        Event.addSubtreeListener(this, "pointerdown", this._handlePointerDown);
        // pointermove defaults to a button-agnostic registration (see
        // Event.ts's PRIMARY_BUTTON_TYPES); `_handlePointerMove` gates on
        // the live `buttons` bitmask itself during a real pan drag.
        Event.addSubtreeListener(this, "pointermove", this._handlePointerMove);
        Event.addSubtreeListener(this, "pointerup", this._handlePointerUp);
        // `mousemove`/`mouseout` rather than `mouseenter`/`mouseleave`: per
        // ARCHITECTURE.md, the non-bubbling enter/leave pair never reaches the
        // framework's window-level capture handler.
        Event.addSubtreeListener(this, "mousemove", this._handleEdgeMouseMove);
        Event.addSubtreeListener(this, "mouseout", this._handleEdgeMouseOut);

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
        // A drag is not a click: a pan that starts and ends on empty canvas
        // (or starts on a node and ends on empty canvas) still fires a native
        // "click" on their nearest common ancestor, and it must not clear the
        // selection or the edge emphasis the user was studying.
        if (this._pointerMoved) {
            return;
        }

        if (this.isControlsTarget(event.target)) {
            return;
        }

        // A press on an edge is neither a node click nor a canvas click: it
        // must not clear the selection the user is looking at.
        if (this._edgeLayer.edgeIdAt(event.target) !== null) {
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
     * Reports hover over the diagram's edges: resolves the pointer's graph
     * coordinate (inverting the pan/zoom transform `zoomAboutViewportPoint`
     * applies) and asks the edge layer which routes are within hit tolerance
     * there, emitting `"edgehover"` with the joined model edges whenever the
     * reported set changes. A drag in progress is not a hover (`_panning`), and
     * a move whose target is not an edge hit path — or whose resolved point
     * lands on no route — instead ends any hover in progress.
     *
     * @param event - The mousemove event, dispatched to the whole subtree.
     */
    private _handleEdgeMouseMove(event: MouseEvent): void {
        if (this._panning) {
            return;
        }

        if (this._edgeLayer.edgeIdAt(event.target) === null) {
            this.leaveEdges();

            return;
        }

        const rect = DOM.source.getViewportRect(this);
        const zoom = this.getZoom();
        const gx   = (event.clientX - rect.left - this._panX) / zoom;
        const gy   = (event.clientY - rect.top  - this._panY) / zoom;

        const routes = this._edgeLayer.edgesNear(gx, gy);

        if (routes.length === 0) {
            this.leaveEdges();

            return;
        }

        const key = routes.map(r => r.id).join(" ");

        if (key === this._hoveredEdgeKey) {
            return;
        }

        const modelById = new Map(this._options.data?.edges.map(e => [e.id, e]) ?? []);
        const edges = routes.map(r => modelById.get(r.id)).filter((e): e is DiagramEdgeData => e !== undefined);

        this._hoveredEdgeKey = key;
        this.emit("edgehover", edges, event);
    }

    /**
     * Ends an edge hover when the pointer's `mouseout` leaves an edge hit
     * path. A `mouseout` from anywhere else is not a hover boundary and is
     * ignored — `_handleEdgeMouseMove`'s own "target is not an edge" branch
     * already covers a move that lands on empty canvas or a node.
     *
     * @param event - The mouseout event, dispatched to the whole subtree.
     */
    private _handleEdgeMouseOut(event: MouseEvent): void {
        if (this._edgeLayer.edgeIdAt(event.target) !== null) {
            this.leaveEdges();
        }
    }

    /** Emits `"edgeleave"` and clears the hover key, unless already idle. */
    private leaveEdges(): void {
        if (this._hoveredEdgeKey === null) {
            return;
        }

        this._hoveredEdgeKey = null;
        this.emit("edgeleave");
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
    private _handleContextMenu(event: MouseEvent): Event.ListenerResult {
        const id = this.nodeIdAt(event.target);

        if (id === null) {
            return;
        }

        const data = this._nodeData.get(id);

        if (data !== undefined) {
            this.emit("contextmenu", data, event);

            return { prevent: true };
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
     * @param event - The wheel event. `preventDefault` is applied by the
     * registration's `prevent: true` floor.
     */
    private _handleWheel(event: WheelEvent): void {
        const rect = DOM.source.getViewportRect(this);

        this.zoomAboutViewportPoint(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP,
            event.clientX - rect.left, event.clientY - rect.top);
    }

    /**
     * Begins a pan drag on a primary-button press over the canvas — empty
     * space or an edge alike; only a node or the control cluster refuses —
     * recording the start pointer and pan offset, and switches the cursor to
     * `"grabbing"`. Also arms the click-versus-drag guard `_handleClick`
     * reads, regardless of whether this press ends up panning.
     *
     * @param event - The pointerdown event.
     */
    private _handlePointerDown(event: PointerEvent): void {
        // Recorded above every guard below, so a press that does not pan (a
        // node, the control cluster) still arms the click-versus-drag guard
        // `_handleClick` reads.
        this._pressX = event.clientX;
        this._pressY = event.clientY;
        this._pointerMoved = false;

        // A press on a node (leaf or container) or the control cluster is not
        // a pan: both show `pointer`, and the cursor has to promise what the
        // drag will actually do. Everything else — empty canvas and edges
        // alike — pans, since dragging an edge is this component's way of
        // panning from under the graph's own lines.
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
        // Gated on the primary button, like DragManager.onMouseMove gates on
        // an open session (DragManager.ts:492): this handler fires on every
        // pointer move over the subtree, including ordinary ambient hover
        // with no button held, and `_pressX`/`_pressY` default to `(0, 0)`
        // until the first real `pointerdown` — without this gate, the very
        // first hover of a session would latch `_pointerMoved` permanently.
        if (!this._pointerMoved && (event.buttons & 1) !== 0) {
            const dx = event.clientX - this._pressX;
            const dy = event.clientY - this._pressY;

            // Squared-distance comparison avoids a Math.hypot call, matching
            // DragManager's own threshold test.
            this._pointerMoved = dx * dx + dy * dy >= CLICK_SLOP * CLICK_SLOP;
        }

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

        this._controls = new FloatingPanel({ corner: "bottom-right", margin: CONTROLS_MARGIN, layoutManager: new VBox() });
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
