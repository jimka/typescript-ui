// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { Component } from "~/core/Component.js";
import { DOM } from "~/core/DOM.js";
import type { Handle } from "~/core/DOM.js";
import type { StyleBag, StyleStateSpec } from "~/core/ClassStyleRules.js";
import { Glyph } from "~/component/display/Glyph.js";
import { ProgressSpinner } from "~/component/display/ProgressSpinner.js";
import { TreeNode } from "~/component/tree/TreeNode.js";
import { TreeNodeRenderer } from "~/component/tree/TreeNodeRenderer.js";
import { LabelTreeNodeRenderer } from "~/component/tree/renderer/Label.js";
import { callable } from "~/core/Callable.js";
import { caret_down } from "~/glyphs/solid/caret_down.js";
import { caret_right } from "~/glyphs/solid/caret_right.js";

Glyph.register(caret_down, caret_right);

/** Width in pixels reserved for the expand/collapse toggle icon. Matches
 *  `TreeCell.ts`'s `TOGGLE_WIDTH`; keep the two in lockstep so a `Tree` and a
 *  `TreeTable` indent identically. */
const TOGGLE_WIDTH = 20;

/** CSS background applied to the selected row. Owned here (not `Tree.ts`,
 *  which constructs `TreeRow` and would create a circular import) since
 *  `ownStyleStates`' extract, below, is this token's only consumer now. */
const SELECTED_BG = "var(--ts-ui-table-row-selected, rgba(30, 100, 200, 0.15))";

/**
 * A single visible row in the {@link Tree} virtual-scroll pool.
 *
 * Each pool slot holds one {@link TreeNode} at a time. The {@link Tree} calls
 * {@link setRowData} to rebind a slot to a different node and
 * {@link layoutChildren} to reposition the toggle and renderer after the row's
 * own dimensions are updated.
 *
 * @remarks
 * The toggle ([`Glyph`](/api/component/display/classes/Glyph)) and content
 * renderer are appended directly to the row's DOM element in `init()` rather
 * than via `addComponent`, so their preferred-size change notifications do not
 * propagate up to the Tree and trigger unnecessary layout passes. Leaf rows
 * have no toggle; non-leaf rows swap in a fresh `caret-down` / `caret-right`
 * glyph on each state change rather than mutating a single character. The row
 * content area (everything to the right of the toggle) is owned by a
 * [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer) supplied
 * via the constructor factory.
 */
class TreeRow extends Component {

    // Declares the ephemeral `.selected` tint — see `## Architecture
    // Decisions`. `.focused` (the keyboard-focus ring) is deliberately *not*
    // in this list: it shares no property with `.selected` (`outline` only,
    // vs `.selected`'s `backgroundColor`), so guarding it against
    // `.selected` — `guardedSuffixFor` guards a state against *every*
    // higher-priority entry unconditionally, not only ones sharing a
    // property — would suppress the ring entirely on a selected-and-focused
    // row (the normal state of the current node during keyboard
    // navigation), rather than layering it on top. It carries its own
    // unguarded shared rule instead, below.
    protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
        {
            selector: ".selected",
            extract: (): StyleBag => ({ backgroundColor: SELECTED_BG }),
        },
    ];

    private _toggle:   Glyph | null           = null;
    private _spinner:  ProgressSpinner | null = null;
    private _renderer: TreeNodeRenderer;
    private _node:     TreeNode | null   = null;
    private _depth:    number            = 0;

    constructor(rendererFactory: () => TreeNodeRenderer = () => new LabelTreeNodeRenderer()) {
        super();

        this.getAria().setRole("treeitem");

        this._renderer = rendererFactory();

        // Ensures the shared `.TreeRow.focused` rule for the keyboard-focus
        // ring — `outline` plus its `outline-offset` sibling (which has no
        // `StyleBag` key of its own: a shorthand-less longhand no framework
        // declaration covers). Unguarded — see `ownStyleStates`' own comment
        // for why `.focused` stays out of that list, and therefore needs no
        // `:not(...)` suffix of its own to layer correctly on top of `.selected`.
        this.ensureSharedStateRule(".focused", {
            outline:       "2px solid var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))",
            outlineOffset: "-2px",
        });
    }

    /**
     * Returns the toggle icon glyph, or null when the bound node is a leaf.
     *
     * @returns The toggle [`Glyph`](/api/component/display/classes/Glyph) instance, or null.
     */
    getToggle(): Glyph | null {
        return this._toggle;
    }

    /**
     * Returns the renderer currently bound to this pool row.
     *
     * @returns The active [`TreeNodeRenderer`](/api/component/tree/classes/TreeNodeRenderer).
     */
    getRenderer(): TreeNodeRenderer {
        return this._renderer;
    }

    /**
     * Replaces this row's content renderer, swapping the underlying DOM
     * element in place.
     *
     * @param renderer - The new renderer instance to install.
     * @returns This row, for method chaining.
     *
     * @remarks
     * The new renderer's element is appended to the row immediately. The
     * caller is expected to follow up with `setRowData` (typically via the
     * Tree's next render pass) so the renderer receives an `update()` before
     * being laid out. The replaced renderer is disposed, so a caller holding
     * a reference from {@link getRenderer} must not reuse it afterward.
     */
    setRenderer(renderer: TreeNodeRenderer): this {
        const el = this.getElement();

        this._renderer.dispose();

        if (el) {
            DOM.sink.appendChild(el, renderer.getElement(true)!);
        }

        this._renderer = renderer;

        return this;
    }

    /**
     * Returns the tree node currently bound to this pool row.
     *
     * @returns The bound {@link TreeNode}, or null if the slot is unbound.
     */
    getNode(): TreeNode | null {
        return this._node;
    }

    /**
     * Returns the depth of the currently bound node.
     *
     * @returns The zero-based depth level.
     */
    getDepth(): number {
        return this._depth;
    }

    /**
     * Binds this pool slot to a new node, updating the toggle icon, content
     * renderer, and ARIA positional attributes.
     *
     * @param node - The tree node to display.
     * @param depth - The zero-based nesting depth (controls indentation).
     * @param hasChildren - Whether the node has child nodes (determines toggle visibility).
     * @param expanded - Whether the node is currently expanded.
     * @param siblingCount - Total number of siblings at this level under the same parent.
     * @param posInSet - 1-based position of this node among its siblings.
     * @param selected - Whether the node is currently selected.
     * @param loading - Whether this node's lazy children are currently loading;
     *   when true a spinner replaces the toggle caret.
     */
    setRowData(node: TreeNode, depth: number, hasChildren: boolean, expanded: boolean, siblingCount: number, posInSet: number, selected: boolean, loading: boolean): this {
        this._node = node;
        this._depth = depth;

        if (this._toggle) {
            this._toggle.dispose();
            this._toggle = null;
        }

        if (this._spinner) {
            this._spinner.dispose();
            this._spinner = null;
        }

        if (loading) {
            // No explicit size: the spinner tracks the theme font-size so it
            // reads as the same visual weight as the caret glyph it replaces,
            // and `layoutChildren` fits it into the TOGGLE_WIDTH box.
            const spinner = new ProgressSpinner();
            this._spinner = spinner;

            const el = this.getElement();
            if (el) {
                DOM.sink.appendChild(el, spinner.getElement(true)!);
            }
        } else if (hasChildren) {
            const toggle = new Glyph(expanded ? "caret-down" : "caret-right");
            toggle.setCursor("pointer");
            toggle.clearInsets();
            toggle.getAria().setHidden(true);
            this._toggle = toggle;

            const el = this.getElement();
            if (el) {
                DOM.sink.appendChild(el, toggle.getElement(true)!);
            }
        }

        this._renderer.update({ node, depth, expanded, selected, hasChildren });

        this.getAria().setLevel(depth + 1);
        this.getAria().setExpanded(hasChildren ? expanded : null);
        this.getAria().setSetSize(siblingCount);
        this.getAria().setPosInSet(posInSet);

        return this;
    }

    /**
     * Positions the toggle and renderer sub-components inside the row's content
     * box — the rectangle {@link Component.getContentBounds} returns, which a
     * border or padding on the row shrinks. Placing them against the row's outer
     * box instead makes the renderer overflow on both axes, and the row's
     * `overflow: hidden` clips it.
     *
     * @param rowHeight - The current height of this row in pixels. Used only
     *   while the row has no element yet and the content box is unavailable;
     *   otherwise the children's height comes from the content box, which is
     *   this same height less the row's own border and padding.
     * @param indentPx - Pixels of indentation per depth level.
     */
    layoutChildren(rowHeight: number, indentPx: number): void {
        const box = this.getContentBounds()
                 ?? { x: 0, y: 0, width: this.getWidth() || 0, height: rowHeight };

        const indent = box.x + this._depth * indentPx;

        if (this._toggle) {
            // The caret is a rigid SVG Glyph (min/max pinned to its 16×16
            // preferredSize), so it cannot fill the taller row — centre it
            // geometrically instead of relying on line-height (a no-op for SVG).
            const glyphHeight = this._toggle.getPreferredSize()?.height ?? box.height;
            this._toggle.setAutoCommitStyle(false);
            this._toggle.setX(indent);
            this._toggle.setY(box.y + Math.max(0, (box.height - glyphHeight) / 2));
            this._toggle.setWidth(TOGGLE_WIDTH);
            this._toggle.setHeight(glyphHeight);
            this._toggle.setAutoCommitStyle(true);
        }

        if (this._spinner) {
            this._spinner.setAutoCommitStyle(false);
            this._spinner.setX(indent);
            this._spinner.setY(box.y);
            this._spinner.setWidth(TOGGLE_WIDTH);
            this._spinner.setHeight(box.height);
            this._spinner.setAutoCommitStyle(true);

            // The spinner owns its inner arc, which only positions itself when
            // its own doLayout runs; the row appends it directly rather than via
            // addComponent, so drive that layout here once the box is sized.
            this._spinner.doLayout();
        }

        const labelX    = indent + TOGGLE_WIDTH;
        const labelBoxW = Math.max(0, box.x + box.width - labelX);

        this._renderer.setAutoCommitStyle(false);
        this._renderer.setX(labelX);
        this._renderer.setY(box.y);
        this._renderer.setWidth(labelBoxW);
        this._renderer.setHeight(box.height);
        this._renderer.setAutoCommitStyle(true);

        this._renderer.layoutChildren(labelBoxW, box.height);
    }

    /**
     * Returns the natural pixel width needed to display this row's full content
     * (indent + toggle + renderer content) without horizontal clipping.
     *
     * @param indentPx - Pixels of indentation per depth level.
     */
    getContentWidth(indentPx: number): number {
        const indent = this._depth * indentPx;
        const contentW = this._renderer.getContentWidth();

        return indent + TOGGLE_WIDTH + contentW;
    }

    /**
     * Appends the renderer sub-component element to the row's DOM element.
     * The toggle glyph (if any) is appended on demand by `setRowData`.
     *
     * @param element - Optional element passed by the rendering pipeline; falls back to getElement().
     */
    protected init(element?: Handle): this {
        super.init(element);

        const el = element || this.getElement();
        if (!el) {
            return this;
        }

        DOM.sink.appendChild(el, this._renderer.getElement(true)!);

        return this;
    }

    /**
     * Disposes the renderer, toggle, and spinner, then runs the inherited
     * teardown. All three are raw-appended rather than registered, so the
     * base destructor's recursion over `_components` cannot reach them.
     */
    protected destructor(): void {
        this._renderer.dispose();
        this._toggle?.dispose();
        this._spinner?.dispose();

        super.destructor();
    }
}

const TreeRowCallable = callable(TreeRow);
type TreeRowCallable = TreeRow;
export {
    TreeRow         as _TreeRow,
    TreeRowCallable as TreeRow
};
