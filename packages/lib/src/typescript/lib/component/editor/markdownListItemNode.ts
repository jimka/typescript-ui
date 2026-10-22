// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $createListItemNode, $isListItemNode, $isListNode, ListItemNode, ListNode } from "@lexical/list";
import { $createMarkdownTaskCheckboxNode, $isMarkdownTaskCheckboxNode, $keepOnlyOpeningCheckbox } from "~/component/editor/markdownTaskCheckboxNode.js";
import type { SerializedListItemNode } from "@lexical/list";
import {
    $copyNode, $createParagraphNode, $getEditor, $getNodeByKey, $getSelection, $hasAncestor, $isElementNode, $isRangeSelection, $isRootNode,
    $isRootOrShadowRoot, $removeFromParent, ElementNode, ParagraphNode,
} from "lexical";
import type {
    BaseSelection, DOMConversionMap, DOMConversionOutput, DOMExportOutput, LexicalEditor, LexicalNode, PointType, RangeSelection,
    SerializedParagraphNode,
} from "lexical";

/**
 * An item of a `MarkdownEditor` list: a container of blocks, as Markdown
 * reads a list item. Its children are blocks only. When the item opens with
 * text, its first child is a {@link MarkdownListItemTextNode} holding that
 * text; every later child is an ordinary block — a paragraph, a heading, a
 * quote, a code block, a table, a `:::` fence, a raw block or a nested list.
 * No item node continues another: a nested list is a child of its item.
 *
 * It takes the place of `@lexical/list`'s `ListItemNode` through Lexical's
 * node replacement, so every item that package creates is of this class, and
 * it stays a `ListItemNode`, so every `$isListItemNode` check keeps holding.
 * `ListItemNode` itself holds a line of text and, in a second item node, a
 * nested list; the overrides here are the places where its code assumes
 * that shape.
 */
export class MarkdownListItemNode extends ListItemNode {
    /**
     * The Lexical node type.
     *
     * @returns `"markdown-list-item"`.
     */
    static getType(): string {
        return "markdown-list-item";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: MarkdownListItemNode): MarkdownListItemNode {
        return new MarkdownListItemNode(node.__value, node.__checked, node.__key);
    }

    /**
     * Rebuilds a node from its JSON form.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedListItemNode): MarkdownListItemNode {
        return new MarkdownListItemNode().updateFromJSON(json);
    }

    /**
     * The HTML conversions for a list, in place of `ListNode`'s own: the
     * same list node, but a nested list stays in the `<li>` that holds it,
     * where `ListNode`'s conversion moves it into an item node of its own
     * after that item.
     *
     * @returns The conversions for `ol` and `ul`, ahead of `ListNode`'s; `null` when it has none.
     */
    static importDOM(): DOMConversionMap | null {
        const lists = ListNode.importDOM?.() ?? null;

        if (lists === null) {
            return null;
        }

        const keeping = (tag: "ol" | "ul"): DOMConversionMap[string] => (element) => {
            const own = lists[tag]?.(element) ?? null;

            return own === null ? null : { priority: LIST_CONVERSION_PRIORITY, conversion: (list) => keepingNestedLists(own.conversion(list)) };
        };

        return { ol: keeping("ol"), ul: keeping("ul") };
    }

    /**
     * The item as HTML: its own `<li>`, whatever it opens with.
     * `ListItemNode.exportDOM` moves an item that opens with a nested list
     * into the `<li>` before it, which is how that class writes the nested
     * list of the item before. Here such an item is an item of its own
     * (`- a`, `- - b`), and its nested list is its own.
     *
     * @param editor - The editor.
     * @returns The exported element.
     */
    exportDOM(editor: LexicalEditor): DOMExportOutput {
        return { element: super.exportDOM(editor).element };
    }

    /**
     * Appends nodes as they are. `ListItemNode.append` merges a paragraph's
     * children into the item, which would turn an item's text and its
     * further paragraphs into one line.
     *
     * @param nodes - The nodes to append.
     * @returns This node.
     */
    append(...nodes: LexicalNode[]): this {
        return this.splice(this.getChildrenSize(), 0, nodes);
    }

    /**
     * Tells whether the indent and outdent commands move the item when they
     * find it among the selected nodes. An item that opens with its text is
     * moved through that text, which the commands find too
     * ({@link MarkdownListItemTextNode.setIndent}): answering for itself as
     * well, it would move twice. An item that opens with a block has no text
     * to stand for it.
     *
     * @returns `false` for an item that opens with its text.
     */
    canIndent(): boolean {
        return !$isMarkdownListItemTextNode(this.getFirstChild());
    }

    /**
     * Tells whether a copy that takes one of the item's children takes the
     * item too. It does when the child is the item's text: a selection from
     * the text into a later block of the same item (a paragraph, a nested
     * list) then copies the item holding both, where the text alone would
     * stand outside any item. Otherwise Lexical's own rule holds: the item
     * goes when all it holds is selected.
     *
     * @param child - A child of the item that the copy takes.
     * @param selection - The copied selection.
     * @returns `true` when the copy takes the item.
     */
    extractWithChild(child: LexicalNode, selection: BaseSelection): boolean {
        return $isMarkdownListItemTextNode(child) || super.extractWithChild(child, selection);
    }

    /**
     * Removes the item and nothing else. `ListItemNode.remove` joins the
     * nested lists of the item nodes before and after it, a shape this class
     * does not build.
     *
     * @param preserveEmptyParent - Whether a list left empty stays.
     */
    remove(preserveEmptyParent?: boolean): void {
        $removePlainly(this, preserveEmptyParent);
    }

    /**
     * Moves the item to a depth, one level at a time ({@link $indentItem},
     * {@link $outdentItem}). An item that is in no list yet is left alone:
     * a parse of copied nodes sets the indent of each item before it has a
     * parent, and the item's depth is then given by where it is put.
     *
     * @param indent - The depth to move to: `0` for a top-level item.
     * @returns This node.
     */
    setIndent(indent: number): this {
        const isInList = this.getParent() !== null;
        let current = this.getIndent();

        while (isInList && current !== indent) {
            const moved = current < indent ? $indentItem(this) : $outdentItem(this);

            if (!moved) {
                break;
            }

            current += current < indent ? 1 : -1;
        }

        return this;
    }

    /**
     * Backspace at the start of the item: a nested item moves out one level
     * ({@link $outdentItem}); a top-level item leaves its list
     * ({@link $liftItemOut}).
     *
     * @returns Whether the item moved.
     */
    collapseAtStart(): boolean {
        const outdented = $outdentItem(this);

        if (outdented) {
            return true;
        }

        // A caret in what the item opened with leaves the list with it; one on the item itself is carried along.
        return $liftItemOut(this).length > 0;
    }
}

/**
 * The priority of the list conversions of {@link MarkdownListItemNode.importDOM}:
 * one above `ListNode`'s own `0`, which is all it takes for Lexical to pick them.
 */
const LIST_CONVERSION_PRIORITY = 1;

/**
 * `ListNode`'s HTML conversion with its last step replaced. That step moves
 * each nested list out of its item into an item node of its own; here a
 * nested list stays in the item that holds it. HTML also writes a nested
 * list in two other places that mean the list of the item before: straight
 * in the list, between two items, and alone in an item of its own after
 * another item, which is how `@lexical/list` itself exports one
 * ({@link $nestedListWrittenApart}). Such a list goes to the end of the item
 * before it. Any other child of the list that is no item is wrapped in one.
 *
 * A check list (Lexical's own, `ListNode`'s type `"check"`, whose items carry
 * a checked state) is built as a bulleted list of task items: the editor
 * holds no check list, and each item whose checked state is set gets a
 * checkbox first, which Lexical's conversions of GitHub's, Joplin's and
 * `aria-checked` check lists already leave in that state.
 *
 * @param output - What `ListNode`'s conversion returned.
 * @returns The same output, keeping nested lists in their items.
 */
function keepingNestedLists(output: DOMConversionOutput | null): DOMConversionOutput | null {
    const list = output?.node;

    if (output === null || !(list instanceof ListNode)) {
        return output;
    }

    if (list.getListType() === "check") {
        list.setListType("bullet");
    }

    return {
        ...output,
        after: (children) => {
            const items: LexicalNode[] = [];

            for (const child of children) {
                if ($isListItemNode(child)) {
                    $keepOnlyOpeningCheckbox(child, $isListItemNode);
                }

                if ($isListItemNode(child) && child.__checked !== undefined) {
                    // An item whose checkbox input was read as a node already has its checkbox.
                    if (!$isMarkdownTaskCheckboxNode(child.getFirstDescendant())) {
                        child.splice(0, 0, [$createMarkdownTaskCheckboxNode(child.__checked)]);
                    }

                    child.setChecked(undefined);
                }
            }

            for (const child of children) {
                const before = items[items.length - 1];
                const nested = $isListItemNode(before) ? $nestedListWrittenApart(child, before) : null;

                if (nested !== null && $isListItemNode(before)) {
                    before.append(nested);
                } else {
                    items.push($isListItemNode(child) ? child : list.createListItemNode().append(child));
                }
            }

            return items;
        },
    };
}

/**
 * The nested list a child of a list built from HTML stands for, when HTML
 * wrote it apart from the item it belongs to: the child itself when it is a
 * list, or the one list an item holds and nothing else, when the item before
 * is written the way `@lexical/list` writes one, its text straight in the
 * `<li>`. That class exports the nested list of an item as an `<li>` of its
 * own after it. This editor's own export writes an item's text in a `<p>`,
 * and there an item holding one list and nothing else is that: an item of
 * its own (`- a`, `- - b`), as in any other HTML.
 *
 * @param child - A child of the list.
 * @param before - The item before it.
 * @returns The nested list, or `null` for any other child.
 */
function $nestedListWrittenApart(child: LexicalNode, before: ListItemNode): ListNode | null {
    if ($isListNode(child)) {
        return child;
    }

    const only = $isListItemNode(child) && child.getChildrenSize() === 1 ? child.getFirstChild() : null;
    const opening = before.getFirstChild();
    const beforeHoldsTextStraight = opening === null || !$isElementNode(opening) || opening.isInline()
        || opening.getType() === INLINE_RUN_WRAPPER_TYPE;

    return $isListNode(only) && beforeHoldsTextStraight ? only : null;
}

/**
 * The type of the node `@lexical/html` wraps a run of inline nodes in while
 * it builds a block from HTML (its `ArtificialNode__DO_NOT_USE`, which it
 * unwraps again at the end): what an `<li>` holding text straight in it
 * holds at the time a list's conversion runs. Lexical itself tells that node
 * by this type, since the class may be renamed.
 */
const INLINE_RUN_WRAPPER_TYPE = "artificial";

/**
 * Tells whether a node is a list item of the editor's own class.
 *
 * @param node - The node.
 * @returns `true` for a {@link MarkdownListItemNode}.
 */
export function $isMarkdownListItemNode(node: LexicalNode | null | undefined): node is MarkdownListItemNode {
    return node instanceof MarkdownListItemNode;
}

/**
 * Whether an item's text is being exported as HTML, where it reports no
 * indent ({@link MarkdownListItemTextNode.exportDOM}). Set for the length of
 * that one synchronous call.
 */
let _isExportingItemTextAsHtml = false;

/**
 * The text a list item opens with: the first child of a
 * {@link MarkdownListItemNode}, holding the item's inline content (and its
 * task item checkbox, first, when it has one).
 *
 * Lexical asks the block the caret is in what an edit does: Enter, Backspace
 * at the block's start, an indent, a block type, a join, a paste. In a list
 * item whose children are blocks, that block is the item's text. This class
 * is a paragraph that answers each of those questions for its item, so an
 * edit of the text is an edit of the item. Each override acts only while the
 * node is the child of an item that is in the document, and is the
 * paragraph's own otherwise: a load, a parse of copied nodes and the rules
 * that build nodes aside all call these methods on trees outside the
 * document.
 */
export class MarkdownListItemTextNode extends ParagraphNode {
    /**
     * The Lexical node type.
     *
     * @returns `"markdown-list-item-text"`.
     */
    static getType(): string {
        return "markdown-list-item-text";
    }

    /**
     * Copies a node, keeping its key, as Lexical's copy-on-write requires.
     *
     * @param node - The node to copy.
     * @returns The copy.
     */
    static clone(node: MarkdownListItemTextNode): MarkdownListItemTextNode {
        return new MarkdownListItemTextNode(node.__key);
    }

    /**
     * Rebuilds a node from its JSON form.
     *
     * @param json - The serialised node.
     * @returns The node.
     */
    static importJSON(json: SerializedParagraphNode): MarkdownListItemTextNode {
        return new MarkdownListItemTextNode().updateFromJSON(json);
    }

    /**
     * Tells Lexical the node stands only in a parent of a certain kind, as a
     * list item does. Lexical then inserts blocks pasted at the node's caret
     * through the node's own `insertAfter`, and wraps a node pasted without
     * its item in one ({@link createParentElementNode}).
     *
     * @returns `true`.
     */
    isParentRequired(): boolean {
        return true;
    }

    /**
     * Creates the parent Lexical wraps the node in when it is inserted
     * without one.
     *
     * @returns A new list item.
     */
    createParentElementNode(): ElementNode {
        return $createListItemNode();
    }

    /**
     * Lets the first of several pasted blocks give its text to this node
     * while it is empty, as a list item does.
     *
     * @returns `true`.
     */
    canMergeWhenEmpty(): boolean {
        return true;
    }

    /**
     * Tells whether a copy that takes text of this node takes the node, and
     * with it its item ({@link MarkdownListItemNode.extractWithChild}): when
     * all the item holds is selected, which is Lexical's own rule for a list
     * item. A copy of part of an item's text is that text alone.
     *
     * @param child - A child of this node that the copy takes.
     * @param selection - The copied selection, or `null` for a copy of whole nodes.
     * @returns `true` when the copy takes this node.
     */
    extractWithChild(child: LexicalNode, selection: BaseSelection | null): boolean {
        const item = this.getParent();

        // The item's own override answers for its text; the question here is Lexical's, of the whole item.
        return selection !== null && $isMarkdownListItemNode(item) && ListItemNode.prototype.extractWithChild.call(item, child, selection);
    }

    /**
     * The item's depth in its lists, which is what an indent of the item's
     * text means: Lexical's indent and outdent commands read it here before
     * they set it ({@link setIndent}).
     *
     * @returns The item's indent; `0` outside an item that is in the
     *   document, and while the node is exported as HTML ({@link exportDOM}).
     */
    getIndent(): number {
        const item = $attachedItemOf(this);

        return item === null || _isExportingItemTextAsHtml ? 0 : item.getIndent();
    }

    /**
     * The node as HTML: the paragraph it is, with no indent. An element
     * exports the indent it reports as padding, and this one reports its
     * item's depth, which the `<li>` it stands in already shows: written on
     * the `<p>` as well, the text of a nested item would be indented twice
     * wherever the copied HTML is pasted.
     *
     * @param editor - The editor.
     * @returns The exported element.
     */
    exportDOM(editor: LexicalEditor): DOMExportOutput {
        _isExportingItemTextAsHtml = true;

        try {
            return super.exportDOM(editor);
        } finally {
            _isExportingItemTextAsHtml = false;
        }
    }

    /**
     * Moves the item to a depth, as its own `setIndent` does. The text never
     * takes an indent of its own.
     *
     * @param indent - The depth to move the item to.
     * @returns This node.
     */
    setIndent(indent: number): this {
        const item = this.getParent();

        if ($isMarkdownListItemNode(item)) {
            item.setIndent(indent);
        }

        return this;
    }

    /**
     * Splits the item at the caret in its text: the new item, put after this
     * one, opens with a new text and takes every block this item holds after
     * its text; Lexical then moves what followed the caret into that text.
     * This is every split Lexical makes of the text, not the Enter key
     * alone: each newline of pasted plain text and the split before pasted
     * blocks come here too. What the key does on an empty line of a list is
     * therefore decided by a listener of the key's own command, not here.
     *
     * @param selection - The selection the split is made at.
     * @param restoreSelection - Whether Lexical restores the selection around the insert.
     * @returns The block that takes what followed the caret.
     */
    insertNewAfter(selection: RangeSelection, restoreSelection?: boolean): ParagraphNode {
        const item = $attachedItemOf(this);

        return item === null ? super.insertNewAfter(selection, restoreSelection ?? true) : $splitItemAfterText(item, this, restoreSelection);
    }

    /**
     * Backspace at the start of the item's text: the item's own answer, in
     * place of a paragraph's, which removes itself when it is empty and a
     * block follows it. (Lexical asks the item too when this answers
     * `false`, so answering for the item here changes no result; what
     * matters is that the paragraph's own rule does not run.)
     *
     * @returns Whether the item moved.
     */
    collapseAtStart(): boolean {
        const item = $attachedItemOf(this);

        return item === null ? super.collapseAtStart() : item.collapseAtStart();
    }

    /**
     * Puts a node after this one. A block goes after the item instead, the
     * list split there, as `ListItemNode.insertAfter` does: that is where
     * Lexical's paste puts the blocks pasted at an item's text.
     *
     * Another item text is no such block: Lexical splits a block by putting
     * a copy of it after it, and then splits the item and the list around
     * the two halves itself, as for a table inserted at the caret.
     *
     * @param node - The node to insert.
     * @param restoreSelection - Whether Lexical restores the selection around the insert.
     * @returns The inserted node.
     */
    insertAfter(node: LexicalNode, restoreSelection?: boolean): LexicalNode {
        const item = $attachedItemOf(this);
        const isBlock = $isElementNode(node) && !node.isInline() && !$isMarkdownListItemTextNode(node);

        return item !== null && isBlock ? item.insertAfter(node, restoreSelection) : super.insertAfter(node, restoreSelection);
    }

    /**
     * Replaces the node. A block type set on an item's text takes the item
     * out of its lists first ({@link $liftItemOut}); the paragraph its text
     * then is takes the type. The replacement takes no indent: Lexical copies
     * this node's to it beforehand, which is the depth the item had in its
     * lists ({@link getIndent}).
     *
     * @param replaceWith - The node to put in this one's place.
     * @param includeChildren - Whether the replacement takes this node's children.
     * @returns The replacement.
     */
    replace<N extends LexicalNode>(replaceWith: N, includeChildren?: boolean): N {
        const item = $attachedItemOf(this);
        const opensItem = item !== null && this.getPreviousSibling() === null;
        const staysText = replaceWith instanceof MarkdownListItemTextNode;

        if (!opensItem || staysText) {
            return super.replace(replaceWith, includeChildren);
        }

        // The item leaves its lists; its text is then a paragraph where the list stood.
        const paragraph = $liftItemOut(item)[0]!;
        const replacement = paragraph.replace(replaceWith, includeChildren);
        const keepsListDepth = $isElementNode(replacement) && !$isListItemNode(replacement) && replacement.getIndent() !== 0;

        if (keepsListDepth) {
            replacement.setIndent(0);
        }

        return replacement;
    }

    /**
     * Removes the node. Lexical ends a join of two blocks by removing the
     * block it joined away, so when an item's text goes this way the item is
     * joined away with it: what it held after its text is moved to follow
     * what stands before the item ({@link $moveRestBeforeItem}). Only when
     * the caret stays in what the item holds after its text does the text go
     * alone: that is an empty text deleted from the block after it.
     *
     * An item joined away that holds nothing afterwards goes with its text,
     * as the item node Lexical joins away does: a paste at an item's text
     * splits the item, joins the new item's text to the last pasted block
     * and removes that text. Any other removal that empties an item leaves
     * the item, which then gets an empty text.
     *
     * @param preserveEmptyParent - Whether an item left empty stays.
     */
    remove(preserveEmptyParent?: boolean): void {
        const item = $attachedItemOf(this);
        const selection = $getSelection();
        const anchor = $isRangeSelection(selection) && selection.isCollapsed() ? selection.anchor.getNode() : null;
        const caretStaysInItem = item !== null && anchor !== null && item.isParentOf(anchor) && !this.is(anchor) && !this.isParentOf(anchor);
        const joinedItem = caretStaysInItem ? null : item;

        if (joinedItem !== null) {
            $moveRestBeforeItem(joinedItem, this);
        }

        super.remove(preserveEmptyParent);

        const leavesItemEmpty = joinedItem !== null && preserveEmptyParent !== true && joinedItem.isAttached() && joinedItem.isEmpty();

        if (leavesItemEmpty) {
            // Lexical's own removal: a list this leaves without an item goes too.
            $removePlainly(joinedItem);
        }
    }
}

/**
 * Creates the text of a list item, holding nothing.
 *
 * @returns The node.
 */
export function $createMarkdownListItemTextNode(): MarkdownListItemTextNode {
    return new MarkdownListItemTextNode();
}

/**
 * Tells whether a node is the text of a list item.
 *
 * @param node - The node.
 * @returns `true` for a {@link MarkdownListItemTextNode}.
 */
export function $isMarkdownListItemTextNode(node: LexicalNode | null | undefined): node is MarkdownListItemTextNode {
    return node instanceof MarkdownListItemTextNode;
}

/**
 * The list item a node is a child of, when that item is in the document.
 *
 * @param node - The node.
 * @returns The item, or `null` when the node's parent is no list item or is detached.
 */
function $attachedItemOf(node: LexicalNode): MarkdownListItemNode | null {
    const item = node.getParent();

    return $isMarkdownListItemNode(item) && item.isAttached() ? item : null;
}

/**
 * Removes a node as `LexicalNode.remove` does, whatever its class overrides.
 *
 * @param node - The node to remove.
 * @param preserveEmptyParent - Whether a parent left empty stays.
 */
export function $removePlainly(node: LexicalNode, preserveEmptyParent?: boolean): void {
    ElementNode.prototype.remove.call(node, preserveEmptyParent);
}

/**
 * Tells whether a selection point stands where Lexical moves it as a node
 * leaves or joins a parent: on the node, inside it, or on that parent. With
 * no point there, Lexical's own removal and insertion leave the selection
 * as it is, and the place of the node among its siblings, which they count
 * by walking those siblings from the first, is not needed.
 *
 * @param node - The node that leaves or joins.
 * @param parent - The parent it leaves or joins.
 * @returns `true` when the selection is a range with a point there.
 */
function $holdsPointAt(node: LexicalNode, parent: LexicalNode): boolean {
    const selection = $getSelection();
    const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];

    return points.some((point) => {
        const at = point.getNode();

        return at.is(node) || at.is(parent) || $hasAncestor(at, node);
    });
}

/**
 * Removes a node as {@link $removePlainly} does, without the walk over its
 * earlier siblings that Lexical's removal makes to keep a selection point on
 * its parent in place: with no point on the node, in it or on its parent
 * ({@link $holdsPointAt}) the removal only unlinks the node, which
 * `$removeFromParent` does. Removing the items of a long list one by one
 * otherwise walks the list once for each of them.
 *
 * @param node - The node to remove.
 * @param preserveEmptyParent - Whether a parent left empty stays.
 */
export function $removeUnwalked(node: LexicalNode, preserveEmptyParent?: boolean): void {
    const parent = node.getParent();
    const selection = $getSelection();
    const isRange = $isRangeSelection(selection);
    const movesPoint = parent === null || !isRange || $holdsPointAt(node, parent);

    if (movesPoint) {
        $removePlainly(node, preserveEmptyParent);

        return;
    }

    $removeFromParent(node);

    // What Lexical's removal does after it unlinks a node.
    const leavesParentEmpty = preserveEmptyParent !== true && !$isRootOrShadowRoot(parent) && !parent.canBeEmpty() && parent.isEmpty();

    if (leavesParentEmpty) {
        $removePlainly(parent);
    }

    const leavesRootEmpty = $isRootNode(parent) && parent.isEmpty();

    if (leavesRootEmpty) {
        parent.selectEnd();
    }
}

/**
 * Puts nodes after a node, in order, as `ElementNode.splice` on its parent
 * does, without counting the node's place among its siblings: each goes in
 * by `LexicalNode.insertAfter`, whatever a class overrides, and the
 * selection is left as it is.
 *
 * @param node - The node to put them after.
 * @param inserted - The nodes, in the order they are to stand in.
 */
export function $insertAfterUnwalked(node: LexicalNode, inserted: readonly LexicalNode[]): void {
    let last = node;

    for (const each of inserted) {
        ElementNode.prototype.insertAfter.call(last, each, false);
        last = each;
    }
}

/**
 * Moves the selection's element points on one node to the same offsets on
 * another, which is to hold the first one's children.
 *
 * @param from - The node the points are on.
 * @param to - The node that takes them.
 */
export function $movePointsBetween(from: ElementNode, to: ElementNode): void {
    for (const point of $elementPointsOn(from)) {
        point.set(to.getKey(), point.offset, "element");
    }
}

/**
 * Moves what an item holds after its text to follow what stands before the
 * item, for a join that takes the text away. After another item, all of it
 * goes to the end of that item: the item before it in its list, or the last
 * item of a list that stands right before its list (a pasted list stands
 * there until the lists are joined, and so does a list of another kind).
 * After anything else, the blocks up to its first nested list go before the
 * list, and the nested list and what follows it stay in the item.
 *
 * @param item - The item whose text is joined away.
 * @param text - The item's text.
 */
function $moveRestBeforeItem(item: MarkdownListItemNode, text: LexicalNode): void {
    const list = item.getParentOrThrow();
    const listBefore = list.getPreviousSibling();
    const previous = item.getPreviousSibling() ?? ($isListNode(listBefore) ? listBefore.getLastChild() : null);
    const rest = text.getNextSiblings();

    if ($isMarkdownListItemNode(previous)) {
        previous.splice(previous.getChildrenSize(), 0, rest);

        return;
    }

    const firstList = rest.findIndex($isListNode);
    const blocks = firstList === -1 ? rest : rest.slice(0, firstList);

    if (blocks.length > 0) {
        list.getParentOrThrow().splice(list.getIndexWithinParent(), 0, blocks);
    }
}

/**
 * Splits an item after its text: a new item, put after it, opens with a new
 * text and takes every block the item holds after its text.
 *
 * @param item - The item.
 * @param text - The item's text.
 * @param restoreSelection - Whether Lexical restores the selection around the insert.
 * @returns The new item's text.
 */
export function $splitItemAfterText(item: MarkdownListItemNode, text: MarkdownListItemTextNode, restoreSelection?: boolean): MarkdownListItemTextNode {
    const next = $createListItemNode();
    const nextText = $createMarkdownListItemTextNode();

    item.insertAfter(next, restoreSelection);
    next.splice(0, 0, [nextText, ...text.getNextSiblings()]);

    return nextText;
}

/**
 * Splits an item before one of the blocks it holds after its first: a new
 * item, put after it, takes that block and every block after it, so the
 * block opens an item of its own.
 *
 * @param item - The item.
 * @param block - A child of the item that is not its first.
 * @returns The new item.
 */
export function $splitItemBefore(item: MarkdownListItemNode, block: LexicalNode): MarkdownListItemNode {
    const next = new MarkdownListItemNode();
    const list = item.getParent();
    const movesPoint = list === null || $holdsPointAt(next, list);

    if (movesPoint) {
        item.insertAfter(next);
    } else {
        $insertAfterUnwalked(item, [next]);
    }

    next.splice(0, 0, [block, ...block.getNextSiblings()]);

    return next;
}

/**
 * Moves a nested item one level out, to follow the item that held its list.
 * What followed it inside that outer item moves into it, so the document
 * reads in the same order: the later items of its list as a nested list of
 * its own, then the blocks the outer item held after that list.
 *
 * @param item - The item.
 * @returns `false` for a top-level item, which is left as it is.
 */
export function $outdentItem(item: MarkdownListItemNode): boolean {
    const list = item.getParentOrThrow<ListNode>();
    const outer = list.getParent();

    if (!$isMarkdownListItemNode(outer)) {
        return false;
    }

    const rest = item.getNextSiblings();
    const tail = list.getNextSiblings();

    if (rest.length > 0) {
        const restList = $copyNode(list);

        item.splice(item.getChildrenSize(), 0, [restList]);
        restList.splice(0, 0, rest);
    }

    item.splice(item.getChildrenSize(), 0, tail);
    outer.insertAfter(item);

    const listIsLeftEmpty = list.isEmpty();

    if (listIsLeftEmpty) {
        list.remove();
    }

    // An outer item that held nothing but this list (`- - a`, or what a text taken out of its list left) goes with it.
    const outerIsLeftEmpty = outer.isEmpty();

    if (outerIsLeftEmpty) {
        $removePlainly(outer);
    }

    return true;
}

/**
 * Nests an item under the item before it, with everything it holds: as the
 * last item of the nested list that ends that item, when it is of the same
 * kind, else of a new one. A list's first item has no item to go under and
 * is wrapped in an empty one, as Lexical's own indent does (`- - a`).
 *
 * @param item - The item.
 * @returns `true`: an item can always be nested.
 */
export function $indentItem(item: MarkdownListItemNode): boolean {
    const list = item.getParentOrThrow<ListNode>();
    const previous = item.getPreviousSibling();

    if (!$isMarkdownListItemNode(previous)) {
        const wrapper = $createListItemNode();
        const nested = $copyNode(list);

        item.insertBefore(wrapper);
        wrapper.splice(0, 0, [nested]);
        nested.splice(0, 0, [item]);

        return true;
    }

    const last = previous.getLastChild();
    const joins = $isListNode(last) && last.getListType() === list.getListType();
    const nested = joins ? last : $copyNode(list);

    if (!joins) {
        previous.splice(previous.getChildrenSize(), 0, [nested]);
    }

    nested.splice(nested.getChildrenSize(), 0, [item]);

    return true;
}

/**
 * Takes an item out of every list it is in. Its text becomes a paragraph
 * where the outermost list stood, the list split around it; the blocks up to
 * its first nested list follow that paragraph; the nested list and what
 * follows it stay in the list, in an item. An item that opens with a block
 * gives that block and the ones after it the same way, with no paragraph.
 *
 * @param item - The item.
 * @returns The blocks moved out, the paragraph first when the item had a
 *   text; none when nothing left the list (the item opens with a nested list).
 */
export function $liftItemOut(item: MarkdownListItemNode): LexicalNode[] {
    // One level per call, until the item is a top-level one.
    let movedOut = $outdentItem(item);

    while (movedOut) {
        movedOut = $outdentItem(item);
    }

    const list = item.getParentOrThrow<ListNode>();
    const children = item.getChildren();
    const first = children[0];
    const text = $isMarkdownListItemTextNode(first) ? first : null;
    const rest = text === null ? children : children.slice(1);
    const firstList = rest.findIndex($isListNode);
    const blocks = firstList === -1 ? rest : rest.slice(0, firstList);
    const paragraph = text === null ? null : $createParagraphNode();
    const moved: LexicalNode[] = paragraph === null ? blocks : [paragraph, ...blocks];

    if (moved.length === 0) {
        return moved;
    }

    const pointsOnItem = $elementPointsOn(item).map((point): [PointType, LexicalNode | null] => [point, children[point.offset] ?? null]);

    if (paragraph !== null && text !== null) {
        paragraph.splice(0, 0, text.getChildren());
        $movePointsBetween(text, paragraph);
    }

    const last = moved[moved.length - 1]!;
    // The list is the rest list an earlier lift of this update made, and the item is its first: it needs no new one.
    // A point on the list itself is one Lexical moves when the list goes, so that case is left as it was.
    const opensRestList = item.getPreviousSibling() === null && $isMadeInThisUpdate(list) && $elementPointsOn(list).length === 0;

    if (opensRestList) {
        $putBefore(list, moved);
    } else {
        $insertAfterUnwalked(list, moved);
    }

    if (text !== null) {
        $removePlainly(text, true);
    }

    if (opensRestList) {
        $dropEmptied(list, item);
    } else {
        $splitListAfter(list, item, item.getNextSiblings(), last);
    }

    for (const [point, standsBefore] of pointsOnItem) {
        // A caret that stood between the item's blocks stays before the same block, wherever that block went.
        $putPointBefore(point, standsBefore !== null && standsBefore.is(text) ? paragraph : standsBefore, last);
    }

    return moved;
}

/**
 * Tells whether a node was made by the update that is running: the
 * committed state does not hold it.
 *
 * @param node - The node.
 * @returns `true` when no committed state holds the node yet.
 */
function $isMadeInThisUpdate(node: LexicalNode): boolean {
    const key = node.getKey();

    return $getEditor().getEditorState().read(() => $getNodeByKey(key) === null);
}

/**
 * Puts nodes right before a node, in order, without counting its place
 * among its siblings.
 *
 * @param node - The node to put them before.
 * @param inserted - The nodes, in the order they are to stand in.
 */
function $putBefore(node: LexicalNode, inserted: readonly LexicalNode[]): void {
    const previous = node.getPreviousSibling();

    if (previous === null) {
        node.getParentOrThrow().splice(0, 0, [...inserted]);
    } else {
        $insertAfterUnwalked(previous, inserted);
    }
}

/**
 * Ends the lift of a list's first item whose text and first blocks were put
 * before the list: the item goes when it holds nothing any more, and so
 * does the list. What is left is the list {@link $splitListAfter} would
 * have made for the item and the items after it, with nothing moved.
 *
 * @param list - The list.
 * @param item - Its first item, whose text and blocks were taken out.
 */
function $dropEmptied(list: ListNode, item: MarkdownListItemNode): void {
    const keepsItem = item.getChildrenSize() > 0;

    if (!keepsItem) {
        $removeUnwalked(item, true);
    }

    const listIsLeftEmpty = list.isEmpty();

    if (listIsLeftEmpty) {
        $removeUnwalked(list);
    }
}

/**
 * Puts an element point right before a block, in the block's parent; or,
 * for a point that stood at the end of what was moved, right after the last
 * moved block.
 *
 * @param point - The point.
 * @param next - The block the point stands before, or `null` for the end.
 * @param last - The last moved block.
 */
function $putPointBefore(point: PointType, next: LexicalNode | null, last: LexicalNode): void {
    const holder = (next ?? last).getParentOrThrow();
    const offset = next === null ? last.getIndexWithinParent() + 1 : next.getIndexWithinParent();

    point.set(holder.getKey(), offset, "element");
}

/**
 * The selection's element points that stand on a node.
 *
 * @param node - The node.
 * @returns The anchor and the focus, each when it is an element point on the node.
 */
function $elementPointsOn(node: ElementNode): PointType[] {
    const selection = $getSelection();
    const points = $isRangeSelection(selection) ? [selection.anchor, selection.focus] : [];
    const key = node.getKey();

    return points.filter((point) => point.type === "element" && point.key === key);
}

/**
 * Ends a list at an item whose text and first blocks were taken out to
 * follow the list: the item, when it still holds something, and the items
 * that stood after it go to a list of their own after those blocks. The
 * item goes when it holds nothing any more, and so does the list.
 *
 * @param list - The list.
 * @param item - The item whose text and blocks were taken out.
 * @param after - The items that stood after it.
 * @param last - The last of the blocks taken out.
 */
function $splitListAfter(list: ListNode, item: MarkdownListItemNode, after: LexicalNode[], last: LexicalNode): void {
    const keepsItem = item.getChildrenSize() > 0;
    const following = keepsItem ? [item, ...after] : after;

    if (following.length > 0) {
        const restList = $copyNode(list);

        $insertAfterUnwalked(last, [restList]);
        restList.splice(0, 0, following);
    }

    if (!keepsItem) {
        $removeUnwalked(item, true);
    }

    const listIsLeftEmpty = list.isEmpty();

    if (listIsLeftEmpty) {
        $removeUnwalked(list);
    }
}
