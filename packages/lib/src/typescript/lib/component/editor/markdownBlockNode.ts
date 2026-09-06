// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { ElementNode } from "lexical";
import type { EditorConfig, LexicalNode, SerializedElementNode, Spread } from "lexical";
import { DOM } from "~/core/DOM.js";
import { resolveBlockStyle, blockStyleToAttributes } from "~/component/display/markdownAttributes.js";

/** The JSON shape a {@link MarkdownBlockNode} (de)serialises to/from. */
export type SerializedMarkdownBlockNode = Spread<
    {
        align:       string | null;
        columnCount: number | null;
        columnGap:   string | null;
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
 * A `::: {align=… columns=… gap=…}` fence: a container carrying block
 * alignment and/or a multi-column layout over the block-level children it
 * wraps. Alignment and multi-column regions share this one node — a fence
 * carrying both attributes is one node with two attributes, not a wrapper
 * inside a wrapper — and the same viewer element (`Markdown.ts`'s `mdblock`
 * arm), since both are visually and structurally the same thing: a region of
 * blocks carrying presentation attributes.
 *
 * `createDOM` mints its element through the DOM seam's `createViewElement`
 * escape rather than `document.createElement`, so this file never names or
 * touches a DOM type — the `local/no-raw-dom` rule's requirement for any
 * Lexical node, since Lexical's own node contract requires a real element
 * where the framework's own components use `DOM.sink.apply` instead.
 */
export class MarkdownBlockNode extends ElementNode {
    __align:       string | null = null;
    __columnCount: number | null = null;
    __columnGap:   string | null = null;

    static getType(): string {
        return "markdown-block";
    }

    static clone(node: MarkdownBlockNode): MarkdownBlockNode {
        const clone = new MarkdownBlockNode(node.__key);

        clone.__align = node.__align;
        clone.__columnCount = node.__columnCount;
        clone.__columnGap = node.__columnGap;

        return clone;
    }

    static importJSON(json: SerializedMarkdownBlockNode): MarkdownBlockNode {
        const node = new MarkdownBlockNode();

        node.__align = json.align;
        node.__columnCount = json.columnCount;
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
     * Returns this block's column count, or `null` when unset (a single column).
     *
     * @returns The block's column count, or `null`.
     */
    getColumnCount(): number | null {
        return this.getLatest().__columnCount;
    }

    /**
     * Sets (or, with `null`, clears) this block's column count.
     *
     * @param count - The new column count, or `null` to clear it.
     * @returns The writable node.
     */
    setColumnCount(count: number | null): this {
        const writable = this.getWritable();

        writable.__columnCount = count;

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
     * True when neither an alignment nor a column count is set — the caller
     * should unwrap this node's children and remove it rather than leave a
     * fence with nothing left to carry.
     *
     * @returns Whether this block carries no attributes.
     */
    isEmptyOfAttributes(): boolean {
        return this.getAlign() === null && this.getColumnCount() === null;
    }

    /**
     * This node's attributes in the shared `{key=value}` record form, for
     * rendering (`createDOM`) and Markdown export (the block transformer).
     *
     * @returns The attribute record.
     */
    toAttributes(): Record<string, string> {
        return blockStyleToAttributes({
            textAlign:   this.getAlign(),
            columnCount: this.getColumnCount(),
            columnGap:   this.getColumnGap(),
        });
    }

    exportJSON(): SerializedMarkdownBlockNode {
        return {
            ...super.exportJSON(),
            type:        "markdown-block",
            version:     1,
            align:       this.getAlign(),
            columnCount: this.getColumnCount(),
            columnGap:   this.getColumnGap(),
        };
    }

    createDOM(config: EditorConfig) {
        const style = resolveBlockStyle(this.toAttributes());
        const element = DOM.sink.createViewElement("div", {
            addClass: config.theme.mdBlock ? [config.theme.mdBlock] : [],
            style:    {
                textAlign:   style.textAlign,
                columnCount: style.columnCount === null ? null : String(style.columnCount),
                columnGap:   style.columnGap,
            },
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
