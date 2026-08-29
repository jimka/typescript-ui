// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
//
// The sole adapter between the framework-native diagram model and ElkJS. It is
// the only module that names ELK types or imports `elkjs`; everything else in
// the family speaks `DiagramData` / `DiagramLayoutResult`, keeping the layout
// engine swappable. ELK takes JSON and returns JSON — it never touches the DOM,
// so it needs no `DOM.sink` / `DOM.source` seam. `elkjs` is an optional peer
// dependency imported lazily the first time a diagram lays out (mirroring
// `StoreWorkerClient.ensureWorker`) and externalised from the library bundle so
// its GWT blob never lands in the core chunk.

import type { DiagramData, DiagramNodeData } from "~/component/diagram/DiagramModel.js";

/** A point in ELK's layout coordinate space. */
export interface ElkPoint {
    x: number;
    y: number;
}

/**
 * One routed section of an ELK edge: a straight run from `startPoint` to
 * `endPoint`, optionally threaded through `bendPoints`.
 */
export interface ElkEdgeSection {
    startPoint: ElkPoint;
    endPoint:   ElkPoint;
    bendPoints?: ElkPoint[];
}

/** The engine-agnostic layout result consumed by `DiagramView`. */
export interface DiagramLayoutResult {
    /** Each node's absolute position and size in graph space. */
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    /** Each edge's routed sections. */
    edges: Array<{ id: string; sections: ElkEdgeSection[] }>;
    /** Graph bounding-box width. */
    width: number;
    /** Graph bounding-box height. */
    height: number;
}

/** ELK port shape: a fixed anchor on a node an edge can attach to. */
interface ElkPort {
    id: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    layoutOptions?: Record<string, string>;
}

/** ELK graph node shape (input carries sizes/options; output adds x/y). */
interface ElkNode {
    id: string;
    width?:  number;
    height?: number;
    x?:      number;
    y?:      number;
    layoutOptions?: Record<string, string>;
    children?: ElkNode[];
    edges?:    ElkExtendedEdge[];
    ports?:    ElkPort[];
}

/** ELK edge shape with explicit source/target endpoint lists. */
interface ElkExtendedEdge {
    id:       string;
    sources:  string[];
    targets:  string[];
    sections?: ElkEdgeSection[];
    /**
     * The node whose origin the routed `sections` coordinates are relative to,
     * as reported by ELK. For an edge between two nodes nested inside the same
     * container, ELK routes it in that container and reports container-relative
     * coordinates here (see {@link mapElkResult}, which shifts them to absolute).
     */
    container?: string;
}

/** Minimal structural type for the lazily-imported ELK instance. */
interface ElkInstance {
    layout(graph: unknown): Promise<unknown>;
    terminateWorker(): void;
}

/**
 * Fallback node width in pixels, used when a node carries neither an explicit
 * `width` nor a measurable preferred width. Sized to comfortably hold a short
 * label so a graph still lays out sensibly rather than collapsing to zero-area
 * nodes ELK would overlap.
 */
const DEFAULT_NODE_WIDTH = 120;

/**
 * Fallback node height in pixels, mirroring {@link DEFAULT_NODE_WIDTH}. Tracks a
 * single label line plus vertical breathing room.
 */
const DEFAULT_NODE_HEIGHT = 40;

/** Message carried by the rejection a disposed engine's `layout` produces. */
const DISPOSED_MESSAGE = "ElkLayoutEngine has been disposed";

/**
 * Merges layout-option maps left-to-right, so later arguments win. `undefined`
 * maps are skipped. Used to layer graph options over the view-level defaults.
 *
 * @param maps - Option maps in ascending precedence order.
 * @returns The merged option map.
 */
function mergeLayoutOptions(...maps: Array<Record<string, string> | undefined>): Record<string, string> {
    const merged: Record<string, string> = {};

    for (const map of maps) {
        if (map) {
            Object.assign(merged, map);
        }
    }

    return merged;
}

/**
 * Default padding reserved inside every container's ELK box, keyed by side.
 * The default renderer (`DiagramGroupNode`) paints its header label a few
 * pixels from the top-left corner, so without a reserved top inset ELK could
 * place a child flush against — or under — the title. The top inset reserves
 * the header row (its inset + one text/glyph line) plus a ~10px gap so the
 * first child sits clearly below the title, not tight against it. The
 * left/bottom/right values match ELK's own built-in default (12px); a consumer
 * supplying a custom `groupRenderer` with a taller or shorter header overrides
 * this via the container's own `layoutOptions`.
 */
const CONTAINER_PADDING_DEFAULT: Record<string, string> = { "elk.padding": "[top=34,left=12,bottom=12,right=12]" };

/**
 * Maps one framework-native node to its ELK counterpart, recursing into
 * `children` for a compound container. A container (non-empty `children`)
 * carries no explicit `width`/`height` — ELK computes its box from its
 * contents — and its children are mapped the same way, so nesting is
 * unbounded. A container's `layoutOptions` resolve as
 * `CONTAINER_PADDING_DEFAULT` < `node.layoutOptions` (the node's own option
 * wins), reserving header clearance by default while staying overridable. A
 * leaf (no children) maps exactly as before.
 *
 * @param node - The framework-native node.
 * @param sizes - Per-leaf resolved sizes (explicit size, else preferred size).
 * @returns The mapped ELK node.
 */
function mapDiagramNode(
    node: DiagramNodeData,
    sizes: Map<string, { width: number; height: number }>,
): ElkNode {
    if (node.children && node.children.length > 0) {
        return {
            id:            node.id,
            layoutOptions: mergeLayoutOptions(CONTAINER_PADDING_DEFAULT, node.layoutOptions),
            children:      node.children.map((child) => mapDiagramNode(child, sizes)),
        };
    }

    const size = sizes.get(node.id);

    return {
        id:            node.id,
        width:         node.width  ?? size?.width  ?? DEFAULT_NODE_WIDTH,
        height:        node.height ?? size?.height ?? DEFAULT_NODE_HEIGHT,
        layoutOptions: node.layoutOptions,
        ports:         node.ports?.map((p) => ({
            id:            p.id,
            x:             p.x,
            y:             p.y,
            width:         p.width,
            height:        p.height,
            layoutOptions: p.side !== undefined ? { "elk.port.side": p.side } : undefined,
        })),
    };
}

/**
 * Root-level ELK options enabling cross-container edge routing. Without it,
 * an edge declared on the root (as every {@link DiagramEdgeData} is) between
 * two nodes nested under different containers may be dropped or mis-routed by
 * ELK's hierarchical layout. Merged in as the lowest-precedence tier, so a
 * view-level default or a graph's own `layoutOptions` can still override it.
 */
const HIERARCHY_HANDLING_DEFAULT: Record<string, string> = { "elk.hierarchyHandling": "INCLUDE_CHILDREN" };

/**
 * Maps the framework-native graph to an ELK graph JSON. Pure and synchronous —
 * no `elkjs` import — so it is unit-testable directly.
 *
 * Graph-level options resolve as `HIERARCHY_HANDLING_DEFAULT` < `defaults` <
 * `data.layoutOptions` (graph wins over view defaults, which win over the
 * hierarchy-handling default) on the root; each node carries its own
 * `layoutOptions`, which ELK resolves over the inherited root options so a
 * per-node option wins over all three.
 *
 * @param data - The framework-native graph.
 * @param sizes - Per-node resolved sizes (explicit size, else preferred size).
 * @param defaults - View-level default ELK options applied to every layout.
 * @returns The ELK graph JSON ready for `elk.layout`.
 */
export function buildElkGraph(
    data: DiagramData,
    sizes: Map<string, { width: number; height: number }>,
    defaults?: Record<string, string>,
): ElkNode {
    const children: ElkNode[] = data.nodes.map((node) => mapDiagramNode(node, sizes));

    const edges: ElkExtendedEdge[] = data.edges.map((edge) => ({
        id:      edge.id,
        sources: [edge.sourcePort ?? edge.source],
        targets: [edge.targetPort ?? edge.target],
    }));

    return {
        id:            "root",
        layoutOptions: mergeLayoutOptions(HIERARCHY_HANDLING_DEFAULT, defaults, data.layoutOptions),
        children,
        edges,
    };
}

/**
 * Recursively flattens an ELK node (and its `children`, if any) into
 * `out`, threading an `(offsetX, offsetY)` accumulator. ELK reports each
 * child's `x`/`y` relative to its own parent, so a node's absolute position is
 * its parent's absolute origin plus its own relative `x`/`y`; a container then
 * recurses with that absolute origin as the new offset for its own children.
 *
 * @param node - The ELK node to flatten (a container or a leaf).
 * @param offsetX - The accumulated absolute x of `node`'s parent (0 at the root).
 * @param offsetY - The accumulated absolute y of `node`'s parent (0 at the root).
 * @param out - The flat output array nodes are appended to, in traversal order.
 */
function flattenElkNode(
    node: ElkNode,
    offsetX: number,
    offsetY: number,
    out: Array<{ id: string; x: number; y: number; width: number; height: number }>,
): void {
    const x = offsetX + (node.x ?? 0);
    const y = offsetY + (node.y ?? 0);

    out.push({ id: node.id, x, y, width: node.width ?? 0, height: node.height ?? 0 });

    for (const child of node.children ?? []) {
        flattenElkNode(child, x, y, out);
    }
}

/**
 * Collects every ELK edge in the tree — the root's own `edges` plus any nested
 * in a container's `edges` — resolving each edge's container id (the node its
 * routed coordinates are relative to). ELK tags a routed edge with its own
 * `container`; absent that, the edge is relative to the node whose `edges`
 * array holds it (the root for a flat graph).
 *
 * @param node - The ELK node whose `edges` (and descendants') to collect.
 * @param out - The flat output array edges are appended to, each paired with
 *   its resolved container id.
 */
function collectElkEdges(node: ElkNode, out: Array<{ edge: ElkExtendedEdge; container: string }>): void {
    for (const edge of node.edges ?? []) {
        out.push({ edge, container: edge.container ?? node.id });
    }

    for (const child of node.children ?? []) {
        collectElkEdges(child, out);
    }
}

/**
 * Shifts every point of an edge's routed sections by `origin`, translating
 * container-relative ELK coordinates into absolute graph space. Returns the
 * sections unchanged when `origin` is the graph origin, so a flat graph's
 * root-relative edges pass through untouched.
 *
 * @param sections - The edge's routed sections, in their container's frame.
 * @param origin - The absolute origin of the edge's container.
 * @returns The sections with every point translated into absolute coordinates.
 */
function offsetSections(sections: ElkEdgeSection[], origin: ElkPoint): ElkEdgeSection[] {
    if (origin.x === 0 && origin.y === 0) {
        return sections;
    }

    const shift = (point: ElkPoint): ElkPoint => ({ x: point.x + origin.x, y: point.y + origin.y });

    return sections.map((section) => ({
        startPoint: shift(section.startPoint),
        endPoint:   shift(section.endPoint),
        bendPoints: section.bendPoints?.map(shift),
    }));
}

/**
 * Maps an ELK layout result back to the engine-agnostic
 * {@link DiagramLayoutResult}. Pure and synchronous, so it is unit-testable
 * directly. A container's descendants are flattened into the same output list
 * as its siblings, each carrying absolute (not parent-relative) coordinates —
 * see {@link flattenElkNode}. Edge sections get the same treatment: ELK reports
 * an intra-container edge's route relative to that container's origin, so each
 * edge is shifted by its container's absolute position (a flat graph's
 * root-relative edges are shifted by the zero origin, i.e. left unchanged).
 *
 * @param result - The root ELK node returned by `elk.layout`.
 * @returns The mapped layout result.
 */
export function mapElkResult(result: ElkNode): DiagramLayoutResult {
    const nodes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];

    for (const child of result.children ?? []) {
        flattenElkNode(child, 0, 0, nodes);
    }

    // Absolute origin of every node (containers included), so an edge routed in
    // a container's frame can be lifted into absolute graph space. The root maps
    // to the zero origin.
    const origins = new Map<string, ElkPoint>([[result.id, { x: 0, y: 0 }]]);

    for (const node of nodes) {
        origins.set(node.id, { x: node.x, y: node.y });
    }

    const collected: Array<{ edge: ElkExtendedEdge; container: string }> = [];
    collectElkEdges(result, collected);

    const edges = collected.map(({ edge, container }) => ({
        id:       edge.id,
        sections: offsetSections(edge.sections ?? [], origins.get(container) ?? { x: 0, y: 0 }),
    }));

    return {
        nodes,
        edges,
        width:  result.width  ?? 0,
        height: result.height ?? 0,
    };
}

/** Construction options for {@link ElkLayoutEngine}. */
export interface ElkLayoutEngineOptions {
    /** Consumer-provided factory returning a Web Worker for off-thread ELK layout. */
    workerFactory?: () => Worker;
}

/**
 * Lazily-loaded ELK layout adapter. One instance owns one ELK engine, built on
 * the first {@link ElkLayoutEngine.layout} call and reused afterward. With no
 * `workerFactory` set, ELK runs on the main thread. Setting `workerFactory`
 * runs layout in the Worker it returns, and falls back transparently to the
 * main thread — within the same failing `layout` call, which rebuilds the
 * engine and retries once — the first time its engine fails to construct or a
 * layout rejects; that fallback is permanent for the instance's lifetime, so
 * later layouts run on the main thread even if the worker would have
 * recovered.
 *
 * In `workerFactory` mode the engine owns a real Web Worker for as long as it
 * lives. Its owner is expected to call {@link ElkLayoutEngine.dispose} when
 * discarding it, or that worker thread outlives the engine.
 *
 * @category Components
 */
export class ElkLayoutEngine {

    private _elk: ElkInstance | null = null;
    private readonly _workerFactory?: () => Worker;
    /**
     * True while `_elk` is worker-backed. Set before constructing a
     * worker-backed engine and never cleared on a successful layout, so the
     * *next* layout failure — whichever one it is — still triggers the
     * one-time main-thread rebuild in {@link layout}; after that rebuild it is
     * `false` for good and a further failure propagates.
     */
    private _workerBacked = false;
    /** True once `dispose` has run. A disposed engine never builds another ELK. */
    private _disposed = false;
    /**
     * True while the ELK instance this engine holds — or is in the middle of
     * building — drives a real Web Worker, which is the consumer-factory mode
     * and only that mode. Cleared when the main-thread fallback replaces the
     * instance. Deliberately NOT cleared by `dispose`: a construction still in
     * flight sets this just before it builds, and the adopt-time check needs
     * it afterward to terminate an instance `dispose` could not yet see.
     */
    private _ownsWorker = false;
    /**
     * The in-flight construction, shared by every `layout` that arrives while
     * ELK is still being imported and built. Without it each of those builds
     * its own ELK — and its own Worker — because `_elk` is still `null` for
     * all of them, and `dispose` can only terminate the one instance the
     * engine ends up keeping. Cleared whenever what it memoised stops being
     * this engine's instance: a failed construction (so a later `layout`
     * retries the import instead of replaying the failure), the main-thread
     * fallback replacing the instance, and `dispose`. Keeping those in step
     * is what stops the memo retaining an ELK — and its `Worker` — the engine
     * has already abandoned, so any future code that assigns or nulls `_elk`
     * must clear this too.
     */
    private _building: Promise<ElkInstance> | null = null;

    /**
     * @param options - Optional worker configuration. With no `workerFactory`,
     *   ELK runs on the main thread via the zero-config bundle.
     */
    constructor(options?: ElkLayoutEngineOptions) {
        this._workerFactory = options?.workerFactory;
    }

    /**
     * Lazily imports ELK (if needed), maps the model to ELK JSON, runs the
     * layout, and maps the result back. The first time a worker-backed engine
     * fails to construct or a layout rejects, rebuilds on the main thread and
     * retries once, so a worker problem never surfaces as a diagram error;
     * that switch to the main thread is permanent for this instance's
     * lifetime, even if a later failure is unrelated to the worker itself.
     *
     * @param data - The framework-native graph.
     * @param sizes - Per-node resolved sizes.
     * @param defaults - View-level default ELK options.
     * @returns The mapped layout result.
     * @throws Error - If `elkjs` is not installed / cannot be imported, if a
     *   main-thread layout fails (no worker fallback remains at that point),
     *   or if the engine was already disposed when the call started or is
     *   disposed while it is building or rebuilding its ELK. Disposal landing
     *   during the layout compute itself does not reject — that call can still
     *   resolve, which is why `DiagramView` drops late results by generation
     *   rather than relying on this.
     */
    async layout(
        data: DiagramData,
        sizes: Map<string, { width: number; height: number }>,
        defaults?: Record<string, string>,
    ): Promise<DiagramLayoutResult> {
        if (this._disposed) {
            throw new Error(DISPOSED_MESSAGE);
        }

        const graph = buildElkGraph(data, sizes, defaults);

        try {
            const elk = await this.ensureElk();

            return mapElkResult(await elk.layout(graph) as ElkNode);
        } catch (error) {
            // Disposed mid-flight: the engine is gone for good, so there is
            // nothing to fall back onto. Main-thread failure: elkjs itself is
            // absent/broken. Either way, propagate.
            if (this._disposed || !this._workerBacked) {
                throw error;
            }

            // Worker construction failed (factory threw, `Worker` undefined,
            // CSP block) or its first compute failed. Terminate the worker
            // being abandoned before the reference is dropped, then rebuild on
            // the main thread and retry once so the diagram still renders.
            this.terminateOwnedWorker(this._elk);
            this._workerBacked = false;
            this._ownsWorker   = false;

            const rebuilt = await this.createMainThreadElk();

            // `dispose` can land while that rebuild is awaited. Adopting the
            // instance then would leave a disposed engine holding a live ELK
            // and laying out through it, so drop it. Unlike `ensureElk`'s
            // equivalent check this does NOT terminate what it drops: the
            // rebuild is main-thread, and terminating a non-factory instance
            // throws a `TypeError` (see `terminateOwnedWorker`).
            if (this._disposed) {
                throw new Error(DISPOSED_MESSAGE);
            }

            this._elk = rebuilt;
            // The memo still resolves to the worker-backed instance just
            // abandoned; drop it so it does not outlive what it built.
            this._building = null;

            return mapElkResult(await rebuilt.layout(graph) as ElkNode);
        }
    }

    /**
     * Terminates this engine's ELK Web Worker, if it owns one, and drops the
     * ELK instance. A later {@link ElkLayoutEngine.layout} rejects rather than
     * rebuilding, so a disposed engine never resurrects a worker. Idempotent,
     * and a no-op on an engine that never laid out or never ran off-thread.
     *
     * A layout request outstanding in a real worker at this moment never
     * settles — elkjs does not reject pending requests on termination — so a
     * caller awaiting one must not depend on it resolving or rejecting.
     */
    dispose(): void {
        this._disposed = true;

        this.terminateOwnedWorker(this._elk);

        this._elk = null;
        // Dropped too, or the engine keeps the terminated instance reachable
        // through the memoised construction for as long as the engine lives.
        this._building = null;
    }

    /**
     * Returns the ELK engine, importing and constructing it on first use. The
     * dynamic `import("elkjs/...")` is left external in the library build so the
     * GWT bundle resolves from the consumer's install rather than being inlined.
     *
     * @returns The ELK engine instance.
     * @throws Error - If the engine was disposed while ELK was still being
     *   imported and constructed.
     */
    private async ensureElk(): Promise<ElkInstance> {
        if (this._elk) {
            return this._elk;
        }

        // Memoised so overlapping layouts share one construction rather than
        // each building an ELK of its own — see `_building`. The adopt-or-
        // terminate decision therefore runs exactly once however many callers
        // are waiting, and they all settle on its outcome.
        this._building ??= this.createElk()
            .then((elk) => {
                if (this._disposed) {
                    // `dispose` ran while ELK was still being imported and
                    // constructed, so it saw no instance to terminate.
                    // Terminate this one rather than adopting it, or the
                    // worker outlives the disposed engine.
                    this.terminateOwnedWorker(elk);

                    throw new Error(DISPOSED_MESSAGE);
                }

                this._elk = elk;

                return elk;
            })
            .catch((error: unknown) => {
                this._building = null;

                throw error;
            });

        return this._building;
    }

    /**
     * Terminates `elk`'s Web Worker, but only when this engine built it from a
     * consumer factory. In every other mode elkjs drives an in-process stand-in
     * worker with no `terminate` method, and asking elkjs to terminate that
     * throws a `TypeError` — so the guard is load-bearing, not defensive.
     *
     * @param elk - The instance to terminate, or `null` if none was built.
     */
    private terminateOwnedWorker(elk: ElkInstance | null): void {
        if (elk && this._ownsWorker) {
            elk.terminateWorker();
        }
    }

    /**
     * Builds the ELK engine per the configured mode: a consumer worker
     * factory, a consumer-hosted worker URL, or the main-thread default —
     * checked in that precedence order. `_workerBacked` is set *before*
     * constructing a worker-backed engine, so a synchronous construction
     * throw is still caught by {@link layout}'s retry.
     *
     * @returns The constructed ELK engine.
     */
    private async createElk(): Promise<ElkInstance> {
        if (!this._workerFactory) {
            return this.createMainThreadElk();
        }

        // `elkjs` is an optional peer dep, typed by the local ambient shim in
        // `elkjs.d.ts` and resolved by the consumer's bundler at runtime.
        const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

        this._workerBacked = true;
        this._ownsWorker   = true;

        return new ELK({ workerFactory: this._workerFactory });
    }

    /**
     * Builds a plain main-thread ELK engine, used both as the default mode
     * and as the fallback after a worker-backed engine fails.
     *
     * @returns The constructed main-thread ELK engine.
     */
    private async createMainThreadElk(): Promise<ElkInstance> {
        const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

        return new ELK();
    }
}
