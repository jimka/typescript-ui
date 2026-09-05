// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DecoratorNode } from "lexical";
import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { DOM } from "~/core/DOM.js";
import type { MarkdownImageSpec } from "~/component/display/markdownAttributes.js";

/** The JSON shape a {@link MarkdownImageNode} (de)serialises to/from. */
export type SerializedMarkdownImageNode = Spread<
    {
        src:    string;
        alt:    string;
        width:  number | null;
        height: number | null;
    },
    SerializedLexicalNode
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
 * `![alt](src){width=… height=…}` — a sized, validated image, rendered as an
 * inline atomic node (no further editable content) alongside surrounding
 * text.
 *
 * A `DecoratorNode`, not an `ElementNode`, since an image has no children a
 * selection can enter — the same shape Lexical's own image examples use.
 * `decorate()` returns `null`: this app has no separate decorator-rendering
 * layer, so `createDOM`'s returned `<img>` (minted through the DOM seam's
 * `createViewElement`, the same escape `MarkdownBlockNode` uses) is the
 * node's entire visual representation.
 */
export class MarkdownImageNode extends DecoratorNode<null> {
    __src:    string;
    __alt:    string;
    __width:  number | null;
    __height: number | null;

    constructor(spec: MarkdownImageSpec, key?: NodeKey) {
        super(key);

        this.__src = spec.src;
        this.__alt = spec.alt;
        this.__width = spec.width;
        this.__height = spec.height;
    }

    static getType(): string {
        return "markdown-image";
    }

    static clone(node: MarkdownImageNode): MarkdownImageNode {
        return new MarkdownImageNode(
            { src: node.__src, alt: node.__alt, width: node.__width, height: node.__height },
            node.__key,
        );
    }

    static importJSON(json: SerializedMarkdownImageNode): MarkdownImageNode {
        return new MarkdownImageNode({
            src: json.src, alt: json.alt, width: json.width, height: json.height,
        });
    }

    /**
     * Returns the image's source URL.
     *
     * @returns The image's `src`.
     */
    getSrc(): string {
        return this.getLatest().__src;
    }

    /**
     * Returns the image's alt text.
     *
     * @returns The image's `alt` text.
     */
    getAlt(): string {
        return this.getLatest().__alt;
    }

    /**
     * Returns the image's explicit width in pixels, or `null` when unset.
     *
     * @returns The image's width, or `null`.
     */
    getImageWidth(): number | null {
        return this.getLatest().__width;
    }

    /**
     * Returns the image's explicit height in pixels, or `null` when unset.
     *
     * @returns The image's height, or `null`.
     */
    getImageHeight(): number | null {
        return this.getLatest().__height;
    }

    isInline(): boolean {
        return true;
    }

    decorate(): null {
        return null;
    }

    exportJSON(): SerializedMarkdownImageNode {
        return {
            ...super.exportJSON(),
            type:   "markdown-image",
            version: 1,
            src:    this.getSrc(),
            alt:    this.getAlt(),
            width:  this.getImageWidth(),
            height: this.getImageHeight(),
        };
    }

    createDOM(config: EditorConfig) {
        const setAttr: Record<string, string> = { src: this.getSrc(), alt: this.getAlt() };
        const width = this.getImageWidth();
        const height = this.getImageHeight();

        if (width !== null) {
            setAttr.width = String(width);
        }

        if (height !== null) {
            setAttr.height = String(height);
        }

        const element = DOM.sink.createViewElement("img", {
            addClass: config.theme.mdImage ? [config.theme.mdImage] : [],
            setAttr,
        }, keepElement);

        if (element === null) {
            throw new Error("MarkdownImageNode.createDOM requires a mounted view");
        }

        return element;
    }

    updateDOM(): boolean {
        // Always true: the node has no way to touch an existing element
        // under the seam rule, so Lexical must rebuild it on any change.
        return true;
    }
}

export function $createMarkdownImageNode(spec: MarkdownImageSpec): MarkdownImageNode {
    return new MarkdownImageNode(spec);
}

export function $isMarkdownImageNode(node: LexicalNode | null | undefined): node is MarkdownImageNode {
    return node instanceof MarkdownImageNode;
}
