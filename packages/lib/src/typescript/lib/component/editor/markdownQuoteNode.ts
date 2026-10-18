// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { QuoteNode } from "@lexical/rich-text";
import { $copyNode } from "lexical";
import type { ElementNode, LexicalNode, ParagraphNode, RangeSelection, SerializedElementNode } from "lexical";

/**
 * A quote of a `MarkdownEditor`: a container of blocks, as Markdown reads a
 * blockquote. Its children are blocks only — paragraphs, headings, code
 * blocks, lists, tables, `:::` fences, raw blocks and other quotes — and it
 * holds at least one.
 *
 * It takes the place of `@lexical/rich-text`'s `QuoteNode` through Lexical's
 * node replacement, so every quote that package creates is of this class, and
 * it stays a `QuoteNode`, so every `$isQuoteNode` check keeps holding.
 * `QuoteNode` holds one line of inline text; the overrides here are the
 * places where its code assumes that shape: it is not a shadow root, it
 * answers a split at a point on it with a quote ({@link insertNewAfter}), and
 * a deletion at its start lifts its first block out ({@link collapseAtStart}).
 * Lexical's `insertNodes` at a point on a quote still leaves an empty half of
 * the quote at its start or end: it asks `canBeEmpty()`, which must stay true
 * so that a quote emptied of its last block keeps an empty paragraph, and
 * does not go.
 *
 * It is not a shadow root: a shadow root stops every join and every range
 * removal at its edge, and a quote's edge is where two paragraphs join, as
 * they join anywhere.
 */
export class MarkdownQuoteNode extends QuoteNode {
    /**
     * The Lexical node type.
     *
     * @returns `"markdown-quote"`.
     */
    static getType(): string {
        return "markdown-quote";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: MarkdownQuoteNode): MarkdownQuoteNode {
        return new MarkdownQuoteNode(node.__key);
    }

    /**
     * Rebuilds a node from its JSON form.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedElementNode): MarkdownQuoteNode {
        return new MarkdownQuoteNode().updateFromJSON(json);
    }

    /**
     * Tells Lexical a quote is not a shadow root, and opts out of Lexical's
     * own block-holding quote (`quoteShadowRootState`) too.
     *
     * @returns `false`.
     */
    override isShadowRoot(): boolean {
        return false;
    }

    /**
     * Lexical's split of a block at a point on it (`RangeSelection.insertParagraph`)
     * asks the block for the node that follows it and moves the children after
     * the point into that node. `QuoteNode` answers with a paragraph after the
     * quote, which would take the quote's blocks and so move them out of it. A
     * quote answers with a quote, so the blocks after the point stay quoted.
     * Lexical asks only for a point strictly inside the quote; at its start or
     * end it splits the document there instead.
     *
     * @param selection - The selection that splits the quote.
     * @param restoreSelection - Whether the selection is restored afterwards.
     * @returns The node the blocks after the point are moved into.
     */
    override insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode {
        const anchor = selection.anchor;
        const isOnQuote = anchor.type === "element" && anchor.key === this.getKey();

        if (!isOnQuote) {
            return super.insertNewAfter(selection, restoreSelection);
        }

        const next = new MarkdownQuoteNode();

        this.insertAfter(next, restoreSelection);

        // `QuoteNode.insertNewAfter` is declared to return a paragraph, which no quote is. Lexical's caller only appends
        // the blocks after the point to the node it gets and selects the node's start, which a quote supports.
        return next as unknown as ParagraphNode;
    }

    /**
     * Takes the quote's first block out of the quote, one level out.
     * Lexical calls this for a deletion at the start of the document; the
     * Backspace key reaches it through the editor's own key rule.
     * `QuoteNode.collapseAtStart` is typed `true`, so this is too.
     *
     * @returns `true`, as the deletion is handled.
     */
    override collapseAtStart(): true {
        const first = this.getFirstChild();

        if (first !== null) {
            $liftOutOfQuote(first, first);
        }

        return true;
    }
}

/**
 * Creates a quote.
 *
 * @returns The quote.
 */
export function $createMarkdownQuoteNode(): MarkdownQuoteNode {
    return new MarkdownQuoteNode();
}

/**
 * Tells whether a node is a `MarkdownQuoteNode`.
 *
 * @param node - The node.
 * @returns `true` for a quote.
 */
export function $isMarkdownQuoteNode(node: LexicalNode | null | undefined): node is MarkdownQuoteNode {
    return node instanceof MarkdownQuoteNode;
}

/**
 * Finds the closest quote among a node's ancestors.
 *
 * @param node - The node.
 * @returns The quote, or `null` when the node stands in none.
 */
export function $nearestQuoteOf(node: LexicalNode): MarkdownQuoteNode | null {
    for (let current = node.getParent(); current !== null; current = current.getParent()) {
        if ($isMarkdownQuoteNode(current)) {
            return current;
        }
    }

    return null;
}

/**
 * Takes the run of a quote's children from `first` to `last` out of the
 * quote, one level out: the run goes where the quote stands, the children
 * before it stay in the quote, the children after it go to a copy of the
 * quote after the run, and a quote left empty goes. Callers settle the
 * selection into blocks of text first; the run's text points move with their
 * nodes.
 *
 * @param first - The first child of the run.
 * @param last - The last child of the run.
 * @returns The run, in order.
 */
export function $liftOutOfQuote(first: LexicalNode, last: LexicalNode): LexicalNode[] {
    const quote = first.getParentOrThrow<ElementNode>();
    const run: LexicalNode[] = [];

    for (let node: LexicalNode | null = first; node !== null; node = node.getNextSibling()) {
        run.push(node);

        if (node.is(last)) {
            break;
        }
    }

    const after = last.getNextSiblings();

    if (after.length > 0) {
        const rest = $copyNode(quote);

        quote.insertAfter(rest);
        rest.splice(0, 0, after);
    }

    quote.getParentOrThrow().splice(quote.getIndexWithinParent() + 1, 0, run);

    if (quote.isEmpty()) {
        quote.remove();
    }

    return run;
}
