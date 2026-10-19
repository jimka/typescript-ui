// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $createLineBreakNode, $createParagraphNode, $createTextNode, $isTextNode, ElementNode, TextNode } from "lexical";
import type {
    EditorConfig, LexicalNode, NodeKey, ParagraphNode, RangeSelection, SerializedElementNode, SerializedTextNode, Spread,
} from "lexical";
import { DOM } from "~/core/DOM.js";

/** The JSON shape a {@link MarkdownSourceTextNode} (de)serialises to/from. */
export type SerializedMarkdownSourceTextNode = Spread<{ source: string }, SerializedTextNode>;

/**
 * Identity factory for the seam's element mint. Generic rather than
 * annotated with a concrete DOM type, so no DOM type is named here — see
 * `DOM.sink.createViewElement`.
 */
function keepElement<T>(element: T): T {
    return element;
}

/**
 * An inline run of Markdown the editor has no rich-text form for — a soft
 * line break, inline HTML, an image the viewer does not render as one — shown as the text the viewer shows for it and saved as
 * the exact Markdown it came from.
 *
 * A `TextNode`, so it carries bold, italic and a span style like the text
 * around it; modelled on Lexical's own `TabNode`: fixed display text,
 * unmergeable, and no typing inside it. `$createMarkdownSourceTextNode` puts
 * it in "token" mode, so Backspace deletes the whole run.
 */
export class MarkdownSourceTextNode extends TextNode {
    __source: string;

    /**
     * Creates a source run.
     *
     * @param display - The text the run shows.
     * @param source - The Markdown the run saves.
     * @param key - The Lexical node key, when cloning.
     */
    constructor(display: string = "", source: string = "", key?: NodeKey) {
        super(display, key);

        this.__source = source;
    }

    /**
     * The Lexical node type.
     *
     * @returns `"markdown-source-text"`.
     */
    static getType(): string {
        return "markdown-source-text";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: MarkdownSourceTextNode): MarkdownSourceTextNode {
        return new MarkdownSourceTextNode(node.__text, node.__source, node.__key);
    }

    /**
     * Rebuilds a node from its JSON form.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedMarkdownSourceTextNode): MarkdownSourceTextNode {
        return new MarkdownSourceTextNode(json.text, json.source).updateFromJSON(json);
    }

    /**
     * Copies the text fields, then the source, from the node this one was
     * cloned from.
     *
     * @param prevNode - The node cloned from.
     */
    afterCloneFrom(prevNode: this): void {
        super.afterCloneFrom(prevNode);

        this.__source = prevNode.__source;
    }

    /**
     * Serialises the node: the text node's own JSON plus its source.
     *
     * @returns The JSON form.
     */
    exportJSON(): SerializedMarkdownSourceTextNode {
        return {
            ...super.exportJSON(),
            type:   "markdown-source-text",
            source: this.getSource(),
        };
    }

    /**
     * Returns the Markdown this run saves.
     *
     * @returns The source text.
     */
    getSource(): string {
        return this.getLatest().__source;
    }

    /**
     * Keeps the display text whatever is written, as `TabNode` does: a DOM
     * mutation (an IME composition landing in the run) must not change what
     * the run shows or saves.
     *
     * @param _text - The text Lexical tried to write; ignored.
     * @returns The writable node.
     */
    setTextContent(_text: string): this {
        return super.setTextContent(this.getLatest().__text);
    }

    /**
     * Never splits: a split inside the run (Enter or a line break with the
     * caret inside it, a selection starting or ending inside it) keeps it
     * whole, so a break lands after it, a selection takes it whole, and its
     * source is never cut in two. `TabNode` needs no such guard, being one
     * character long.
     *
     * Lexical's callers read the part on either side of a split offset by
     * position (`RangeSelection.extract` takes the second part of a split at
     * the selection start), so the run is returned once per part a real split
     * would make — the shape `TextNode.splitText` returns — with every part
     * being the whole run.
     *
     * @param splitOffsets - The offsets Lexical asked to split at.
     * @returns The run itself, once more than the distinct offsets inside it.
     */
    splitText(...splitOffsets: number[]): TextNode[] {
        const self = this.getLatest();
        const size = self.getTextContentSize();
        const inside = new Set(splitOffsets.filter((offset) => offset > 0 && offset < size));

        return Array.from({ length: inside.size + 1 }, () => self);
    }

    /**
     * Never merges with a neighbouring text node, so the run keeps its source.
     *
     * @returns `true`.
     */
    isUnmergeable(): boolean {
        return true;
    }

    /**
     * Typing at the run's start goes into the text before it.
     *
     * @returns `false`.
     */
    canInsertTextBefore(): boolean {
        return false;
    }

    /**
     * Typing at the run's end goes into the text after it.
     *
     * @returns `false`.
     */
    canInsertTextAfter(): boolean {
        return false;
    }
}

/**
 * Creates a {@link MarkdownSourceTextNode} in "token" mode.
 *
 * @param display - The text the run shows.
 * @param source - The Markdown the run saves.
 * @returns The new node.
 */
export function $createMarkdownSourceTextNode(display: string, source: string): MarkdownSourceTextNode {
    return new MarkdownSourceTextNode(display, source).setMode("token");
}

/**
 * Whether a node is a {@link MarkdownSourceTextNode}.
 *
 * @param node - The node to test.
 * @returns Whether it is one.
 */
export function $isMarkdownSourceTextNode(node: LexicalNode | null | undefined): node is MarkdownSourceTextNode {
    return node instanceof MarkdownSourceTextNode;
}

/**
 * A block of raw Markdown the editor has no rich-text form for — an HTML
 * block, a link reference definition, a blockquote or list
 * whose content its node cannot hold — held as plain text lines and saved
 * as that text, without a blank first or last line and without indentation
 * before it that means nothing to Markdown.
 *
 * An `ElementNode` rather than a `ParagraphNode`, so the serializer writes
 * its text unescaped. `createDOM` mints a `<p>` through the DOM seam's
 * `createViewElement`, as `MarkdownColumnNode` mints its `<div>`. Backspace
 * follows `ParagraphNode`. The editor's Enter handler adds a line inside the
 * block, as in a `CodeNode`, starts a paragraph after it at its end and
 * before it at its start; its paste handlers insert pasted content as lines
 * of text; a paragraph inserted mid-block otherwise splits it into two raw
 * blocks. The editor's typing shortcuts, and its commands that format, link
 * or insert, do not apply inside it.
 */
export class MarkdownRawBlockNode extends ElementNode {
    /**
     * The Lexical node type.
     *
     * @returns `"markdown-raw-block"`.
     */
    static getType(): string {
        return "markdown-raw-block";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: MarkdownRawBlockNode): MarkdownRawBlockNode {
        return new MarkdownRawBlockNode(node.__key);
    }

    /**
     * Rebuilds a node from its JSON form; it carries no fields of its own.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedElementNode): MarkdownRawBlockNode {
        return new MarkdownRawBlockNode().updateFromJSON(json);
    }

    /**
     * Serialises the node as an element with its own type.
     *
     * @returns The JSON form.
     */
    exportJSON(): SerializedElementNode {
        return {
            ...super.exportJSON(),
            type:    "markdown-raw-block",
            version: 1,
        };
    }

    /**
     * Mints the block's `<p>` through the DOM seam, with the theme's raw-block
     * class.
     *
     * @param config - The editor config carrying the theme.
     * @returns The element.
     * @throws Error - When no view is mounted, as `MarkdownColumnNode.createDOM`.
     */
    createDOM(config: EditorConfig) {
        const element = DOM.sink.createViewElement("p", {
            addClass: config.theme.mdRawBlock ? [config.theme.mdRawBlock] : [],
        }, keepElement);

        if (element === null) {
            throw new Error("MarkdownRawBlockNode.createDOM requires a mounted view");
        }

        return element;
    }

    /**
     * Whether Lexical must rebuild the element after a change.
     *
     * @returns `false`.
     */
    updateDOM(): boolean {
        // False: the element carries nothing derived from node state, so
        // there is never anything to rebuild.
        return false;
    }

    /**
     * Splits the block where Lexical inserts a paragraph: at the block's end,
     * a plain paragraph after it (`ParagraphNode.insertNewAfter` reduced to
     * its core); anywhere else, a new raw block, which Lexical fills with the
     * rest of this one, so a block inserted there lands between the two halves
     * and both stay raw Markdown. Enter typed inside the block and a paste
     * into it do not get here: the editor turns them into text first.
     *
     * @param selection - The selection the paragraph is inserted at.
     * @param restoreSelection - Whether to move the selection into the new block.
     * @returns The new paragraph or raw block.
     */
    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode | MarkdownRawBlockNode {
        const atEnd = this.isSelectionAtEnd(selection);
        const block = atEnd ? $createParagraphNode() : new MarkdownRawBlockNode();

        this.insertAfter(block, restoreSelection);

        return block;
    }

    /**
     * Whether a selection's anchor sits at the very start of this block.
     *
     * @param selection - The selection.
     * @returns `true` at the start of the first line (or in an empty block).
     */
    isSelectionAtStart(selection: RangeSelection): boolean {
        const anchor = selection.anchor;
        const node = anchor.getNode();

        if (anchor.type === "element") {
            return node.is(this) && anchor.offset === 0;
        }

        const first = this.getFirstDescendant();

        return first !== null && node.is(first) && anchor.offset === 0;
    }

    /**
     * Whether a selection's anchor sits at the very end of this block.
     *
     * @param selection - The selection.
     * @returns `true` at the end of the last line (or in an empty block).
     */
    isSelectionAtEnd(selection: RangeSelection): boolean {
        const anchor = selection.anchor;
        const node = anchor.getNode();

        if (anchor.type === "element") {
            return node.is(this) && anchor.offset === this.getChildrenSize();
        }

        const last = this.getLastDescendant();

        return last !== null && node.is(last) && anchor.offset === node.getTextContentSize();
    }

    /**
     * Backspace at the start of an empty block removes it — a copy of
     * `ParagraphNode.collapseAtStart`.
     *
     * @returns Whether the block was removed.
     */
    collapseAtStart(): boolean {
        const children = this.getChildren();
        const first = children[0];

        if (children.length === 0 || ($isTextNode(first) && first.getTextContent().trim() === "")) {
            const nextSibling = this.getNextSibling();

            if (nextSibling !== null) {
                this.selectNext();
                this.remove();

                return true;
            }

            const previousSibling = this.getPreviousSibling();

            if (previousSibling !== null) {
                this.selectPrevious();
                this.remove();

                return true;
            }
        }

        return false;
    }
}

/**
 * Creates a {@link MarkdownRawBlockNode} holding `source`: one text node per
 * non-empty line, with a line break between every two lines.
 *
 * @param source - The block's Markdown.
 * @returns The new node.
 */
export function $createMarkdownRawBlockNode(source: string): MarkdownRawBlockNode {
    const block = new MarkdownRawBlockNode();

    source.split("\n").forEach((line, index) => {
        if (index > 0) {
            block.append($createLineBreakNode());
        }

        if (line !== "") {
            block.append($createTextNode(line));
        }
    });

    return block;
}

/**
 * Whether a node is a {@link MarkdownRawBlockNode}.
 *
 * @param node - The node to test.
 * @returns Whether it is one.
 */
export function $isMarkdownRawBlockNode(node: LexicalNode | null | undefined): node is MarkdownRawBlockNode {
    return node instanceof MarkdownRawBlockNode;
}
