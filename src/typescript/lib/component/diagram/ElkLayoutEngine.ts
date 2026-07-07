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

import type { DiagramData } from "~/component/diagram/DiagramModel.js";

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
}

/** ELK edge shape with explicit source/target endpoint lists. */
interface ElkExtendedEdge {
    id:       string;
    sources:  string[];
    targets:  string[];
    sections?: ElkEdgeSection[];
}

/** Minimal structural type for the lazily-imported ELK instance. */
interface ElkInstance {
    layout(graph: unknown): Promise<unknown>;
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
 * Maps the framework-native graph to an ELK graph JSON. Pure and synchronous —
 * no `elkjs` import — so it is unit-testable directly.
 *
 * Graph-level options resolve as `defaults` < `data.layoutOptions` (graph wins
 * over defaults) on the root; each node carries its own `layoutOptions`, which
 * ELK resolves over the inherited root options so a per-node option wins over
 * both.
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
    const children: ElkNode[] = data.nodes.map((node) => {
        const size = sizes.get(node.id);

        return {
            id:            node.id,
            width:         node.width  ?? size?.width  ?? DEFAULT_NODE_WIDTH,
            height:        node.height ?? size?.height ?? DEFAULT_NODE_HEIGHT,
            layoutOptions: node.layoutOptions,
        };
    });

    const edges: ElkExtendedEdge[] = data.edges.map((edge) => ({
        id:      edge.id,
        sources: [edge.source],
        targets: [edge.target],
    }));

    return {
        id:            "root",
        layoutOptions: mergeLayoutOptions(defaults, data.layoutOptions),
        children,
        edges,
    };
}

/**
 * Maps an ELK layout result back to the engine-agnostic
 * {@link DiagramLayoutResult}. Pure and synchronous, so it is unit-testable
 * directly.
 *
 * @param result - The root ELK node returned by `elk.layout`.
 * @returns The mapped layout result.
 */
export function mapElkResult(result: ElkNode): DiagramLayoutResult {
    const nodes = (result.children ?? []).map((child) => ({
        id:     child.id,
        x:      child.x ?? 0,
        y:      child.y ?? 0,
        width:  child.width  ?? 0,
        height: child.height ?? 0,
    }));

    const edges = (result.edges ?? []).map((edge) => ({
        id:       edge.id,
        sections: edge.sections ?? [],
    }));

    return {
        nodes,
        edges,
        width:  result.width  ?? 0,
        height: result.height ?? 0,
    };
}

/**
 * Lazily-loaded ELK layout adapter. One instance owns one lazily-imported ELK
 * engine; the import fires on the first {@link ElkLayoutEngine.layout} call and
 * the engine is reused afterward.
 *
 * @category Components
 */
export class ElkLayoutEngine {

    private _elk: ElkInstance | null = null;
    private readonly _workerUrl?: string;

    /**
     * @param workerUrl - Optional URL of a consumer-hosted `elk-worker.js`. When
     *   set, ELK runs its layout compute off the main thread; otherwise the
     *   zero-config main-thread bundle is used.
     */
    constructor(workerUrl?: string) {
        this._workerUrl = workerUrl;
    }

    /**
     * Lazily imports ELK (if needed), maps the model to ELK JSON, runs the
     * layout, and maps the result back.
     *
     * @param data - The framework-native graph.
     * @param sizes - Per-node resolved sizes.
     * @param defaults - View-level default ELK options.
     * @returns The mapped layout result.
     * @throws Error - If `elkjs` is not installed / cannot be imported.
     */
    async layout(
        data: DiagramData,
        sizes: Map<string, { width: number; height: number }>,
        defaults?: Record<string, string>,
    ): Promise<DiagramLayoutResult> {
        const elk    = await this.ensureElk();
        const graph  = buildElkGraph(data, sizes, defaults);
        const result = await elk.layout(graph);

        return mapElkResult(result as ElkNode);
    }

    /**
     * Returns the ELK engine, importing and constructing it on first use. The
     * dynamic `import("elkjs/...")` is left external in the library build so the
     * GWT bundle resolves from the consumer's install rather than being inlined.
     *
     * @returns The ELK engine instance.
     */
    private async ensureElk(): Promise<ElkInstance> {
        if (this._elk) {
            return this._elk;
        }

        // `elkjs` is an optional peer dep, typed by the local ambient shim in
        // `elkjs.d.ts` and resolved by the consumer's bundler at runtime.
        const { default: ELK } = await import("elkjs/lib/elk.bundled.js");

        const elk = this._workerUrl ? new ELK({ workerUrl: this._workerUrl }) : new ELK();
        this._elk = elk;

        return elk;
    }
}
