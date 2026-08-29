// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { FloatingPanel, FloatingPanelOptions } from "~/component/container/FloatingPanel.js";
import { Tree } from "~/component/tree/Tree.js";
import type { TreeNode } from "~/component/tree/TreeNode.js";
import { Text } from "~/component/input/Text.js";
import { LabelTreeNodeRenderer } from "~/component/tree/renderer/Label.js";
import { VBox } from "~/layout/VBox.js";
import { Fit } from "~/layout/Fit.js";
import { Insets } from "~/primitive/Insets.js";
import { UNBOUNDED } from "~/primitive/Size.js";
import type { Size } from "~/primitive/Size.js";
import { ListenerBag } from "~/core/ListenerBag.js";
import { callable } from "~/core/Callable.js";
import type { StyleBag } from "~/core/ClassStyleRules.js";
import type { MarkdownHeading } from "~/component/display/Markdown.js";

/**
 * Structural interface a scroll-owning host exposes so a {@link
 * MarkdownMinimap} can highlight the heading currently on screen without
 * depending on `Markdown`, `Panel`, or any other concrete scroll owner.
 */
export interface HeadingScrollSource {
    on(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
    off(event: "activeheadingchange", listener: (headingId: string | null) => void): unknown;
}

/** String-literal union of the events emitted by {@link MarkdownMinimap}. */
export type MarkdownMinimapEvent = "select";

/**
 * Construction-time options for {@link MarkdownMinimap}.
 *
 * @category Components
 */
export interface MarkdownMinimapOptions extends FloatingPanelOptions {
    /** Deepest heading depth shown; deeper headings are dropped entirely. Default `3`. */
    maxHeadingDepth?: number;

    /** The scroll-owning source whose active-heading changes drive the highlighted row. */
    scrollSource?: HeadingScrollSource;

    listeners?: {
        select?: (headingId: string) => void;
    };
}

/** Deepest heading depth shown when the caller doesn't specify one. */
const DEFAULT_MAX_HEADING_DEPTH = 3;

/** Header row text above the tree. */
const HEADER_TEXT = "On this page";

/**
 * Height cap: the header plus roughly 20 rows at `Tree`'s fixed 24px row
 * height. `Tree.getPreferredSize` now reports a height derived from the
 * flattened row count with no ceiling of its own (see `Tree.ts`), so an
 * outline longer than this needs to scroll instead of committing an
 * unbounded height that can run past the viewport with nothing to scroll it
 * back into view. Deliberately no `autoScroll` on this outer panel to
 * provide that scrolling: `Tree` is already a virtualized, self-scrolling
 * list (its own row pool plus scrollbar overlays — see `Tree.ts`'s class
 * doc), so marking this panel's own axis as overflowing too would tell
 * `BoxLayout.computeShrink` to skip shrinking `Tree` to fit (it explicitly
 * skips the shrink when the axis is overflowing), leaving `Tree` laid out at
 * its full uncapped content height with both this panel and `Tree` then
 * scrolling the same content independently. Without `autoScroll` here, the
 * VBox shrinks `Tree` down to whatever's left under this cap once it
 * overflows, and `Tree`'s own scrolling takes over from there — one
 * scrollbar, not two.
 */
const DEFAULT_MAX_HEIGHT_PX = 500;

/**
 * Width floor: enough for the header text and a reasonably short heading
 * label without wrapping to nothing. `Anchor` bypasses the cell clamp
 * entirely (see `FloatingPanel`'s own docs), so this is a no-op for a
 * floating `MarkdownMinimap`; it only matters for a docked one placed in a
 * shrinking layout (e.g. an `HBox` row) — without it, that layout manager's
 * own shrink-to-min distribution has nothing to stop this panel collapsing
 * to an unreadable sliver on a narrow viewport.
 */
const DEFAULT_MIN_WIDTH_PX = 160;

/**
 * Default preferred width. Wider than `Tree`'s own generic content-derived
 * default (200px, `Tree.ts`'s `DEFAULT_PREFERRED_WIDTH`) so a heading label
 * — which can run considerably longer than a typical Tree row elsewhere in
 * this codebase — has more room before truncating.
 */
const DEFAULT_WIDTH_PX = 240;

/**
 * Row-label font size in pixels — smaller than `Text`'s own 14px ambient
 * default (the prose this outlines renders at that default), so the outline
 * reads as a secondary navigation aid rather than a second copy of the text
 * at the same visual weight. A plain pixel number, not a relative unit:
 * `Text.setFontSize`'s string overload binds to a named CSS custom property
 * (a theme token) rather than accepting an arbitrary CSS length, so
 * `"0.85em"` would silently fail to apply.
 */
const ROW_FONT_SIZE = 12;

/** Padding around the header row's text — top/bottom give it room beyond its bare line height. */
const HEADER_PADDING = new Insets(8, 12, 4, 12);

// The opaque card surface lives on the outer panel; the inner Tree stays
// transparent (see class doc) so there is exactly one opaque box, not two
// stacked ones. Also carries minSize/maxSize, not just background/shadow/
// borderRadius: once a class declares any ownClassStyleDefaults it starts
// participating in the hierarchy-cascade mechanism (chainParticipates), and
// from that point on ensureClassStyleRule's class-tier authored bag is built
// from ownClassStyleDefaults alone, not the full _defaultOptions — a
// StyleBag key this bag omits falls back to the framework baseline
// (minSize: {0,0}) instead of this class's own default. Mirrors the same
// full-bag-as-ownClassStyleDefaults shape TextArea, AbstractSelectableList,
// AbstractChart, and Table already use for their own minSize.
//
// Typed as a `Pick` of these keys, not `Partial<MarkdownMinimapOptions>`:
// `MarkdownMinimapOptions` also carries `FloatingPanelOptions.margin` as a
// plain `number`, which is not assignable to `StyleBag`'s `string | null`,
// and this same constant has to satisfy both roles below.
const MARKDOWN_MINIMAP_CHROME: Pick<MarkdownMinimapOptions, "backgroundColor" | "shadow" | "borderRadius" | "minSize" | "maxSize"> = {
    backgroundColor: "var(--ts-ui-input-bg, rgb(255, 255, 255))",
    shadow:          "var(--ts-ui-popover-shadow, 2px 4px 12px rgba(0, 0, 0, 0.18))",
    borderRadius:    "var(--ts-ui-border-radius, 4px)",
    // Caps the otherwise-unbounded content-derived height (see
    // DEFAULT_MAX_HEIGHT_PX). Class default (not an imperative setter call)
    // so a caller-supplied maxSize still wins.
    maxSize: { width: UNBOUNDED, height: DEFAULT_MAX_HEIGHT_PX },
    minSize: { width: DEFAULT_MIN_WIDTH_PX, height: 0 },
};

const _defaultMarkdownMinimapOptions: Partial<MarkdownMinimapOptions> = {
    ...MARKDOWN_MINIMAP_CHROME,
    maxHeadingDepth: DEFAULT_MAX_HEADING_DEPTH,
};

/**
 * A floating card showing a document's heading outline as a `Tree`.
 *
 * Builds a real `TreeNode[]` hierarchy from a flat `MarkdownHeading[]` list
 * (see {@link setHeadings}) and, when constructed with a {@link
 * HeadingScrollSource}, highlights whichever heading is currently on screen.
 * Emits a semantic `"select"` event carrying the clicked heading's id rather
 * than navigating itself — the caller decides what "select" means (scroll an
 * owned `Markdown`, call a router), the same division of responsibility
 * `Tree` itself keeps between emitting `"selection"` and acting on it.
 *
 * @category Components
 */
class MarkdownMinimap extends FloatingPanel<MarkdownMinimapOptions> {

    protected static readonly ownClassStyleDefaults: StyleBag = MARKDOWN_MINIMAP_CHROME;

    private readonly _tree: Tree;
    private readonly _listeners: ListenerBag<MarkdownMinimapEvent> = this.registerListenerBag(new ListenerBag<MarkdownMinimapEvent>());
    private readonly _scrollSource: HeadingScrollSource | null;

    /** Shown heading id -> its `TreeNode`. */
    private _nodesById: Map<string, TreeNode> = new Map();

    /** Every heading id, shown or not, -> the nearest ancestor id that IS shown (or `null`). */
    private _nearestShown: Map<string, string | null> = new Map();

    private readonly handleSelection: (nodes: TreeNode[]) => void = (nodes) => this.onTreeSelection(nodes);
    private readonly handleActiveHeadingChange: (headingId: string | null) => void = (id) => this.applyActiveHeading(id);

    constructor(options?: MarkdownMinimapOptions, subclassDefaults?: Partial<MarkdownMinimapOptions>) {
        super(options, { ..._defaultMarkdownMinimapOptions, ...(subclassDefaults ?? {}) });

        // stretching: true fills the header and the tree to the panel's own
        // width — the same reason DocsSidebar's own Tree-hosting layouts pass it.
        this.setLayoutManager(new VBox({ spacing: 4, stretching: true }));

        const headerText = new Text(HEADER_TEXT);
        headerText.setFontSize(12);
        headerText.setFontWeight("700");
        // Dims the ambient (theme-aware) text colour rather than hardcoding a
        // grey, so this reads correctly in both light and dark themes.
        headerText.setOpacity(0.6);

        // `padding` on a bare `Text` is invisible to its own getPreferredSize
        // (which reports only measured font metrics — see Text.ts), so the
        // padding has to live on a wrapping row instead, or VBox allocates
        // the header only its bare line height and the real CSS padding then
        // clips into that too-small box.
        const headerRow = new Component({ layoutManager: new Fit(), padding: HEADER_PADDING });
        headerRow.addComponent(headerText);
        this.addComponent(headerRow);

        // "clip": a heading label is read, not scrolled sideways to see in
        // full — an outline is a navigation aid, not a place to read a long
        // title one horizontal-scroll-drag at a time.
        this._tree = new Tree({ backgroundColor: "transparent", rowOverflow: "clip" });
        this._tree.setRendererFactory(() => {
            const renderer = new LabelTreeNodeRenderer();
            renderer.getLabel().setFontSize(ROW_FONT_SIZE);

            return renderer;
        });
        this._tree.on("selection", this.handleSelection);
        this.addComponent(this._tree);

        this._scrollSource = options?.scrollSource ?? null;
        this._scrollSource?.on("activeheadingchange", this.handleActiveHeadingChange);

        this.applyListeners(options?.listeners);
    }

    /**
     * Reports `DEFAULT_WIDTH_PX` as the preferred width when the
     * caller has set no explicit `preferredSize` and the computed width
     * (driven by `Tree`'s own generic, content-agnostic default) is
     * narrower — height keeps its normal (content-derived, capped) VBox
     * computation.
     *
     * @returns The preferred `{width, height}`.
     */
    getPreferredSize(): Size | null {
        if (this.getPreferredSizeConstraint() !== null) {
            return super.getPreferredSize();
        }

        const computed = super.getPreferredSize();

        if (!computed) {
            return computed;
        }

        return { width: Math.max(computed.width, DEFAULT_WIDTH_PX), height: computed.height };
    }

    /**
     * Dispatches {@link MarkdownMinimapOptions.maxHeadingDepth}; every other
     * option is inherited from {@link FloatingPanel}.
     *
     * @param options - The options bag carrying the values to apply.
     * @returns This panel, for method chaining.
     */
    protected applyOptions(options: MarkdownMinimapOptions): this {
        super.applyOptions(options);

        if (options.maxHeadingDepth !== undefined) {
            this._options.maxHeadingDepth = options.maxHeadingDepth;
        }

        return this;
    }

    /**
     * The deepest heading depth shown; a heading at or past `maxHeadingDepth +
     * 1` has no row.
     *
     * @returns The cached {@link MarkdownMinimapOptions.maxHeadingDepth}, or the class default when never set.
     */
    getMaxHeadingDepth(): number {
        return this._options.maxHeadingDepth ?? this._defaultOptions.maxHeadingDepth ?? DEFAULT_MAX_HEADING_DEPTH;
    }

    /**
     * Replaces the shown outline, rebuilding the tree from `headings`. A
     * heading past {@link getMaxHeadingDepth} is dropped entirely — it nests
     * under no other row, and no row of its own survives either — while still
     * anchoring any of its own descendants (that are within depth) to its
     * nearest shown ancestor.
     *
     * @param headings - The document's headings, in document order.
     * @returns This panel, for method chaining.
     */
    setHeadings(headings: MarkdownHeading[]): this {
        const maxDepth = this.getMaxHeadingDepth();
        const roots: TreeNode[] = [];
        const stack: Array<{ depth: number; node: TreeNode }> = [];
        const nodesById = new Map<string, TreeNode>();
        const nearestShown = new Map<string, string | null>();

        for (const heading of headings) {
            while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
                stack.pop();
            }

            const ancestor = stack.length > 0 ? stack[stack.length - 1].node : null;
            const shown = heading.depth <= maxDepth;

            if (shown) {
                const node: TreeNode = { label: heading.text, data: heading.id, children: [] };

                if (ancestor) {
                    ancestor.children!.push(node);
                } else {
                    roots.push(node);
                }

                nodesById.set(heading.id, node);
                nearestShown.set(heading.id, heading.id);
                stack.push({ depth: heading.depth, node });
            } else {
                nearestShown.set(heading.id, ancestor ? (nearestShown.get(ancestor.data as string) ?? null) : null);
            }
        }

        this._nodesById   = nodesById;
        this._nearestShown = nearestShown;

        this._tree.setNodes(roots);
        this._tree.expandAll();

        return this;
    }

    on(event: "select", listener: (headingId: string) => void): this {
        this._listeners.add(event, listener);

        return this;
    }

    off(event: "select", listener: (headingId: string) => void): this {
        this._listeners.remove(event, listener);

        return this;
    }

    protected emit(event: "select", headingId: string): void {
        this._listeners.fire(event, headingId);
    }

    /**
     * Maps a `Tree` `"selection"` event onto this minimap's own `"select"`
     * event, carrying just the clicked heading's id.
     *
     * @param nodes - The tree's newly selected nodes; only the first is used.
     */
    private onTreeSelection(nodes: TreeNode[]): void {
        const node = nodes[0];

        if (!node || node.data === undefined) {
            return;
        }

        this.emit("select", node.data as string);
    }

    /**
     * Highlights the row for `id`'s nearest shown ancestor (or `id` itself
     * when it is shown). A `null` id — no heading is above the scroll pane's
     * top yet — is a no-op, leaving the previously selected row standing.
     *
     * @param id - The scroll source's newly active heading id, or `null`.
     */
    private applyActiveHeading(id: string | null): void {
        if (id === null) {
            return;
        }

        const resolvedId = this._nearestShown.get(id) ?? null;

        if (resolvedId === null) {
            return;
        }

        const node = this._nodesById.get(resolvedId);

        if (node) {
            this._tree.selectNode(node);
        }
    }

    /**
     * Unwires the `scrollSource` listener before the inherited destructor
     * disposes the tree — a `scrollSource` outliving this minimap must not
     * keep firing into torn-down state.
     */
    protected destructor(): void {
        this._scrollSource?.off("activeheadingchange", this.handleActiveHeadingChange);

        super.destructor();
    }
}

const MarkdownMinimapCallable = callable(MarkdownMinimap);
type MarkdownMinimapCallable = MarkdownMinimap;
export {
    MarkdownMinimap         as _MarkdownMinimap,
    MarkdownMinimapCallable as MarkdownMinimap,
};
