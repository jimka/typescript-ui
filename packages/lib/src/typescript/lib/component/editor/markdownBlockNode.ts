// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ElementNode } from "lexical";
import type { EditorConfig, LexicalNode, SerializedElementNode, Spread } from "lexical";
import { DOM } from "~/core/DOM.js";
import { resolveBlockStyle, blockStyleToAttributes } from "~/component/display/markdownAttributes.js";

/** The JSON shape a {@link MarkdownBlockNode} (de)serialises to/from. */
export type SerializedMarkdownBlockNode = Spread<
    {
        align:     string | null;
        columnGap: string | null;
    },
    SerializedElementNode
>;

/**
 * Identity factory for the seam's element mint. Generic rather than
 * annotated with a concrete DOM type, so no DOM type is named here — see
 * `DOM.sink.createViewElement`.
 */
function keepElement<T>(element: T): T {
    return element;
}

/**
 * One column of a {@link MarkdownBlockNode} region: a self-contained span of
 * block content laid out as one flex item. Copies the four region-node
 * overrides `@lexical/table`'s `TableCellNode` uses to keep a region
 * self-contained: `isShadowRoot` stops `getTopLevelElement()` walking out of
 * a column, `canBeEmpty() === false` keeps a block-type conversion scoped to
 * the paragraph the caret is in rather than the whole region, `canIndent()
 * === false` keeps a column from picking up list/quote indentation, and
 * `collapseAtStart()` keeps backspace at a column's start from merging it
 * into the previous column.
 */
export class MarkdownColumnNode extends ElementNode {
    static getType(): string {
        return "markdown-column";
    }

    static clone(node: MarkdownColumnNode): MarkdownColumnNode {
        return new MarkdownColumnNode(node.__key);
    }

    static importJSON(): MarkdownColumnNode {
        return new MarkdownColumnNode();
    }

    exportJSON(): SerializedElementNode {
        return {
            ...super.exportJSON(),
            type:    "markdown-column",
            version: 1,
        };
    }

    createDOM(config: EditorConfig) {
        const element = DOM.sink.createViewElement("div", {
            addClass: config.theme.mdColumn ? [config.theme.mdColumn] : [],
        }, keepElement);

        if (element === null) {
            throw new Error("MarkdownColumnNode.createDOM requires a mounted view");
        }

        return element;
    }

    updateDOM(): boolean {
        // Always true: the node has no way to touch an existing element
        // under the seam rule, so Lexical must rebuild it on any change.
        return true;
    }

    isShadowRoot(): boolean {
        return true;
    }

    canBeEmpty(): false {
        return false;
    }

    canIndent(): false {
        return false;
    }

    collapseAtStart(): true {
        return true;
    }
}

export function $createMarkdownColumnNode(): MarkdownColumnNode {
    return new MarkdownColumnNode();
}

export function $isMarkdownColumnNode(node: LexicalNode | null | undefined): node is MarkdownColumnNode {
    return node instanceof MarkdownColumnNode;
}

/**
 * A `::: {align=… gap=…}` fence: a container of {@link MarkdownColumnNode}
 * columns, carrying an optional block alignment and/or column-gap override
 * over the region as a whole. The same viewer element renders it
 * (`Markdown.ts`'s `mdblock` arm), since a one-column region with no
 * alignment or gap is visually and structurally the same construct as a
 * multi-column one — just with one column.
 *
 * `createDOM` mints its element through the DOM seam's `createViewElement`
 * escape rather than `document.createElement`, so this file never names or
 * touches a DOM type — the `local/no-raw-dom` rule's requirement for any
 * Lexical node, since Lexical's own node contract requires a real element
 * where the framework's own components use `DOM.sink.apply` instead.
 */
export class MarkdownBlockNode extends ElementNode {
    __align:     string | null = null;
    __columnGap: string | null = null;

    static getType(): string {
        return "markdown-block";
    }

    static clone(node: MarkdownBlockNode): MarkdownBlockNode {
        const clone = new MarkdownBlockNode(node.__key);

        clone.__align = node.__align;
        clone.__columnGap = node.__columnGap;

        return clone;
    }

    static importJSON(json: SerializedMarkdownBlockNode): MarkdownBlockNode {
        const node = new MarkdownBlockNode();

        node.__align = json.align;
        node.__columnGap = json.columnGap;

        return node;
    }

    /**
     * Returns this block's alignment, or `null` when unset.
     *
     * @returns The block's `text-align` value, or `null`.
     */
    getAlign(): string | null {
        return this.getLatest().__align;
    }

    /**
     * Sets (or, with `null`, clears) this block's alignment.
     *
     * @param align - The new alignment, or `null` to clear it.
     * @returns The writable node.
     */
    setAlign(align: string | null): this {
        const writable = this.getWritable();

        writable.__align = align;

        return writable;
    }

    /**
     * Returns this block's column gap override, or `null` when unset (the
     * theme's `--ts-ui-md-column-gap` default applies).
     *
     * @returns The block's column gap, or `null`.
     */
    getColumnGap(): string | null {
        return this.getLatest().__columnGap;
    }

    /**
     * Sets (or, with `null`, clears) this block's column gap override.
     *
     * @param gap - The new column gap, or `null` to clear it.
     * @returns The writable node.
     */
    setColumnGap(gap: string | null): this {
        const writable = this.getWritable();

        writable.__columnGap = gap;

        return writable;
    }

    /**
     * This block's column children, in document order.
     *
     * @returns The block's columns.
     */
    getColumns(): MarkdownColumnNode[] {
        return this.getChildren().filter($isMarkdownColumnNode);
    }

    /**
     * True when this block carries no alignment and holds at most one
     * column — the caller should unwrap this node's children and remove it
     * rather than leave a fence with nothing left to justify it.
     *
     * @returns Whether this block has nothing left to justify the fence.
     */
    canUnwrap(): boolean {
        return this.getAlign() === null && this.getColumns().length <= 1;
    }

    /**
     * This node's attributes in the shared `{key=value}` record form, for
     * rendering (`createDOM`) and Markdown export (the block transformer).
     *
     * @returns The attribute record.
     */
    toAttributes(): Record<string, string> {
        return blockStyleToAttributes({
            textAlign: this.getAlign(),
            columnGap: this.getColumnGap(),
        });
    }

    exportJSON(): SerializedMarkdownBlockNode {
        return {
            ...super.exportJSON(),
            type:      "markdown-block",
            version:   1,
            align:     this.getAlign(),
            columnGap: this.getColumnGap(),
        };
    }

    createDOM(config: EditorConfig) {
        const style = resolveBlockStyle(this.toAttributes());
        const element = DOM.sink.createViewElement("div", {
            addClass: config.theme.mdBlock ? [config.theme.mdBlock] : [],
            style:    { textAlign: style.textAlign, columnGap: style.columnGap },
        }, keepElement);

        if (element === null) {
            throw new Error("MarkdownBlockNode.createDOM requires a mounted view");
        }

        return element;
    }

    updateDOM(): boolean {
        // Always true: the node has no way to touch an existing element
        // under the seam rule, so Lexical must rebuild it on any change.
        return true;
    }
}

export function $createMarkdownBlockNode(): MarkdownBlockNode {
    return new MarkdownBlockNode();
}

export function $isMarkdownBlockNode(node: LexicalNode | null | undefined): node is MarkdownBlockNode {
    return node instanceof MarkdownBlockNode;
}
