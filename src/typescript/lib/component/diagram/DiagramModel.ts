// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

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
