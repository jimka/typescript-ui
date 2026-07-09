// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

/**
 * A connection point on a node — a fixed anchor an edge can attach to instead
 * of the node as a whole. Maps to an ELK port; the intended use is a per-column
 * anchor so a foreign-key edge can run column-to-column once nodes render their
 * columns. Ports are inert until an edge references one via
 * {@link DiagramEdgeData.sourcePort} / {@link DiagramEdgeData.targetPort}.
 *
 * @category Components
 */
export interface DiagramPortData {
    /** Stable id, referenced by an edge's `sourcePort` / `targetPort`. */
    id: string;
    /** Optional ELK side hint (`"NORTH" | "SOUTH" | "EAST" | "WEST"`), applied when ports are laid out. */
    side?: string;
    /** Optional explicit port width fed to ELK. */
    width?: number;
    /** Optional explicit port height fed to ELK. */
    height?: number;
    /**
     * Explicit port x relative to the node's top-left, fed to ELK under
     * `elk.portConstraints=FIXED_POS` (set via the node's `layoutOptions`).
     * Lets a consumer pin a port to an exact row/column coordinate (e.g. a
     * table card's column row) instead of letting ELK spread ports along a side.
     */
    x?: number;
    /** Explicit port y relative to the node's top-left; see {@link x}. */
    y?: number;
}

/**
 * A node in the framework-native graph model. Maps to a single ELK node when
 * the graph is laid out.
 *
 * @category Components
 */
export interface DiagramNodeData {
    /** Stable identity used to key node components and match edge endpoints. */
    id: string;
    /** Optional label shown inside the default node renderer. */
    label?: string;
    /** Optional registered glyph name shown alongside the label. */
    glyph?: string;
    /**
     * Explicit width fed to ELK. When absent the node component's preferred
     * width is used instead.
     */
    width?: number;
    /**
     * Explicit height fed to ELK. When absent the node component's preferred
     * height is used instead.
     */
    height?: number;
    /** Per-node ELK layout options passed straight through to the engine. */
    layoutOptions?: Record<string, string>;
    /**
     * Optional connection ports (e.g. per-column anchors). Consumed by ELK when
     * column-to-column edges are enabled; ignored by layout and the default
     * renderer until then.
     */
    ports?: DiagramPortData[];
    /**
     * Opaque consumer metadata (e.g. per-column rows). Ignored by layout and the
     * default renderer — a passthrough seam for the hosting application.
     */
    data?: unknown;
}

/**
 * Edge end-cap kinds. `"arrow"` is the existing default arrowhead; the rest are
 * ER crow's-foot end markers.
 *
 * @category Components
 */
export type DiagramEdgeMarker =
    | "arrow"
    | "one" // "one and only one": two perpendicular bars
    | "zeroOrOne" // circle + one bar
    | "oneOrMany" // bar + crow's foot
    | "zeroOrMany"; // circle + crow's foot

/**
 * Optional per-edge visual style. Absent = today's plain arrow-ended edge.
 *
 * @category Components
 */
export interface DiagramEdgeStyle {
    /** Marker at the source end (`marker-start`). Absent = no start marker. */
    startMarker?: DiagramEdgeMarker;
    /** Marker at the target end (`marker-end`). Absent = no end marker. */
    endMarker?: DiagramEdgeMarker;
    /** Dashed stroke when true (for the sibling dependency-graph plan). */
    dashed?: boolean;
    /** Themed stroke override (e.g. a warning tint). Falls back to the default edge stroke. */
    stroke?: string;
    /** Optional mid-edge label (e.g. the referential action). */
    label?: string;
}

/**
 * An edge in the framework-native graph model. Maps to an ELK edge with a
 * single source and target.
 *
 * @category Components
 */
export interface DiagramEdgeData {
    /** Stable identity for the edge. */
    id: string;
    /** Source node id. */
    source: string;
    /** Target node id. */
    target: string;
    /** Optional edge label (routing/placement of labels is left to ELK). */
    label?: string;
    /**
     * Optional source port id (a {@link DiagramNodeData.ports} entry on the
     * source node) the edge anchors to; falls back to the node as a whole when
     * absent. Enables column-to-column anchoring without a re-key.
     */
    sourcePort?: string;
    /**
     * Optional target port id (a {@link DiagramNodeData.ports} entry on the
     * target node) the edge anchors to; falls back to the node when absent.
     */
    targetPort?: string;
    /**
     * Opaque consumer metadata (e.g. the FK's local/referenced columns and
     * referential actions). Ignored by layout and rendering — a passthrough seam
     * feeding later cardinality / column work.
     */
    data?: unknown;
    /** Optional additive visual style; plain edges omit it. */
    style?: DiagramEdgeStyle;
}

/**
 * A whole graph — its nodes and edges plus optional graph-level ELK layout
 * options such as `{ "elk.algorithm": "layered", "elk.direction": "RIGHT" }`.
 *
 * @category Components
 */
export interface DiagramData {
    /** The graph's nodes. */
    nodes: DiagramNodeData[];
    /** The graph's edges. */
    edges: DiagramEdgeData[];
    /** Graph-level ELK layout options applied to the whole layout pass. */
    layoutOptions?: Record<string, string>;
}
