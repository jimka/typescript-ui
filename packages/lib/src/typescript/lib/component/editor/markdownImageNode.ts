// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { DecoratorNode } from "lexical";
import type { DOMConversionMap, EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from "lexical";
import { resolveImageSpec } from "~/component/display/markdownAttributes.js";
import { DOM } from "~/core/DOM.js";
import type { MarkdownImageSpec } from "~/component/display/markdownAttributes.js";

/** The JSON shape a {@link MarkdownImageNode} (de)serialises to/from. */
export type SerializedMarkdownImageNode = Spread<
    {
        src:    string;
        alt:    string;
        width:  number | null;
        height: number | null;
        title?: string | null;
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
 * Every CommonMark image form — `![alt](src "title")`, `![alt](<src>)`,
 * `![alt][label]`, `![label][]`, `![label]` — with the dialect's
 * `{width=… height=…}` group after it: a validated image with its title,
 * rendered as an inline atomic node (no further editable content) alongside
 * surrounding text.
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
    __title:  string | null;

    /**
     * Creates an image node.
     *
     * @param spec - The image's validated source, alt text and size.
     * @param title - The image's title; `null` or `""` for none.
     * @param key - The node key, set by Lexical when it clones the node.
     */
    constructor(spec: MarkdownImageSpec, title: string | null = null, key?: NodeKey) {
        super(key);

        this.__src = spec.src;
        this.__alt = spec.alt;
        this.__width = spec.width;
        this.__height = spec.height;
        this.__title = title === "" ? null : title;
    }

    /**
     * An `<img>` pasted from another application becomes an image, with its
     * `src`, `alt`, `title`, `width` and `height` attributes; an `<img>` with
     * no `src` (a lazy-loaded one that carries only `data-src`) or a source the
     * scheme allow-list refuses makes no node.
     *
     * @returns The conversion map.
     */
    static importDOM(): DOMConversionMap | null {
        return {
            img: (node) => ({
                conversion: () => {
                    const handle = DOM.source.intern(node);
                    const attributes: Record<string, string> = {};

                    for (const key of ["width", "height"]) {
                        const value = DOM.source.getAttribute(handle, key);

                        if (value !== null) {
                            attributes[key] = value;
                        }
                    }

                    const src = DOM.source.getAttribute(handle, "src") ?? "";
                    const spec = src === "" ? null : resolveImageSpec(src, DOM.source.getAttribute(handle, "alt") ?? "", attributes);

                    return { node: spec === null ? null : $createMarkdownImageNode(spec, DOM.source.getAttribute(handle, "title")) };
                },
                priority: 0,
            }),
        };
    }

    static getType(): string {
        return "markdown-image";
    }

    static clone(node: MarkdownImageNode): MarkdownImageNode {
        return new MarkdownImageNode(
            { src: node.__src, alt: node.__alt, width: node.__width, height: node.__height },
            node.__title,
            node.__key,
        );
    }

    /**
     * Reads a serialized image, as a Lexical JSON paste delivers one. The
     * source goes through the scheme allow-list, as every other way into the
     * editor does: a refused source is neutralised to an empty one, which the
     * viewer draws as an image with no address, never as an unsafe one.
     *
     * @param json - The serialized image.
     * @returns The image.
     */
    static importJSON(json: SerializedMarkdownImageNode): MarkdownImageNode {
        const accepted = resolveImageSpec(json.src, json.alt, {}) !== null;

        // `updateFromJSON` restores the node's state (its authored attributes), as Lexical's own nodes do.
        return new MarkdownImageNode({
            src: accepted ? json.src : "", alt: json.alt, width: json.width, height: json.height,
        }, json.title ?? null).updateFromJSON(json);
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

    /**
     * Returns the image's title, shown as its tooltip.
     *
     * @returns The image's title; `null` when it has none.
     */
    getTitle(): string | null {
        return this.getLatest().__title;
    }

    /**
     * Sets the image's title.
     *
     * @param title - The title; `null` or `""` for none.
     * @returns This node.
     */
    setTitle(title: string | null): this {
        const self = this.getWritable();

        self.__title = title === "" ? null : title;

        return self;
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
            title:  this.getTitle(),
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

        const title = this.getTitle();

        if (title !== null) {
            setAttr.title = title;
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

/**
 * Creates an image node.
 *
 * @param spec - The image's validated source, alt text and size.
 * @param title - The image's title; `null` or `""` for none.
 * @returns The node.
 */
export function $createMarkdownImageNode(spec: MarkdownImageSpec, title: string | null = null): MarkdownImageNode {
    return new MarkdownImageNode(spec, title);
}

export function $isMarkdownImageNode(node: LexicalNode | null | undefined): node is MarkdownImageNode {
    return node instanceof MarkdownImageNode;
}
