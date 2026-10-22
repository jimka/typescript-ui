// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The two node classes a MarkdownEditor list is made of
// (plans/markdown-editor-list-item-node.md): `MarkdownListItemNode`, an item
// that holds blocks only, and `MarkdownListItemTextNode`, the text an item
// opens with. Rows S1 to S8 call the three list operations on trees built by
// hand; the rows after them run Lexical's own routines on such trees, which
// reach the hooks of the two classes.

import { describe, it, expect } from 'vitest';
import {
    $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isElementNode, $isParagraphNode, $isRangeSelection, $isTextNode,
    $parseSerializedNode, createEditor,
} from 'lexical';
import type { LexicalEditor, LexicalNode, ParagraphNode, RangeSelection, SerializedLexicalNode, TextNode } from 'lexical';
import { $createHeadingNode, $isHeadingNode } from '@lexical/rich-text';
import type { HeadingNode } from '@lexical/rich-text';
import { $createListItemNode, $createListNode, $isListNode } from '@lexical/list';
import type { ListItemNode, ListNode } from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $dfs } from '@lexical/utils';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import {
    $createMarkdownListItemTextNode, $indentItem, $isMarkdownListItemNode, $isMarkdownListItemTextNode, $liftItemOut, $outdentItem,
    MarkdownListItemNode, MarkdownListItemTextNode,
} from '~/component/editor/markdownListItemNode';
import { registerWritableStateRules } from '~/component/editor/markdownWritable';

/**
 * Builds a bare Lexical editor holding the editor's node classes and none of
 * its rules, whose errors fail the test.
 *
 * @returns The editor.
 */
function bareEditor(): LexicalEditor {
    return createEditor({ nodes: [...EDITOR_NODES], onError: (error) => { throw error; } });
}

/**
 * An item's text holding `text`, or nothing.
 *
 * @param text - The text.
 * @returns The node.
 */
function t(text = ''): MarkdownListItemTextNode {
    const node = $createMarkdownListItemTextNode();

    return text === '' ? node : node.splice(0, 0, [$createTextNode(text)]);
}

/**
 * A paragraph holding `text`.
 *
 * @param text - The text.
 * @returns The node.
 */
function p(text: string): ParagraphNode {
    return $createParagraphNode().splice(0, 0, [$createTextNode(text)]);
}

/**
 * A heading holding `text`.
 *
 * @param text - The text.
 * @returns The node.
 */
function heading(text: string): HeadingNode {
    return $createHeadingNode('h1').splice(0, 0, [$createTextNode(text)]);
}

/**
 * A list item holding `children`, put in with `splice`, as they are.
 *
 * @param children - The item's blocks.
 * @returns The node.
 */
function i(...children: LexicalNode[]): ListItemNode {
    return $createListItemNode().splice(0, 0, children);
}

/**
 * A bullet list of `items`.
 *
 * @param items - The list's items.
 * @returns The node.
 */
function ul(...items: ListItemNode[]): ListNode {
    return $createListNode('bullet').splice(0, 0, items);
}

/**
 * A node as the letters it was built with, a text node as its text.
 *
 * @param node - The node.
 * @returns The shape.
 */
function shape(node: LexicalNode): string {
    if ($isTextNode(node)) {
        return node.getTextContent();
    }

    const name = $isMarkdownListItemTextNode(node) ? 't'
        : $isParagraphNode(node) ? 'p'
            : $isMarkdownListItemNode(node) ? 'i'
                : $isListNode(node) ? 'ul'
                    : $isHeadingNode(node) ? 'heading' : node.getType();

    return $isElementNode(node) ? `${name}(${node.getChildren().map(shape).join(', ')})` : name;
}

/**
 * The document's shape.
 *
 * @param editor - The editor.
 * @returns The top-level blocks' shapes, joined by `, `.
 */
function shapeOf(editor: LexicalEditor): string {
    return editor.read(() => $getRoot().getChildren().map(shape).join(', '));
}

/**
 * The text node whose text is exactly `text`.
 *
 * @param text - The text.
 * @returns The text node.
 */
function $textOf(text: string): TextNode {
    const node = $dfs($getRoot()).map((entry) => entry.node).find((candidate) => $isTextNode(candidate) && candidate.getTextContent() === text);

    if (!$isTextNode(node)) {
        throw new Error(`no text node holds ${text}`);
    }

    return node;
}

/**
 * The list item whose text is exactly `text`.
 *
 * @param text - The item's text.
 * @returns The item.
 */
function $itemOf(text: string): MarkdownListItemNode {
    const item = $textOf(text).getParent()?.getParent();

    if (!$isMarkdownListItemNode(item)) {
        throw new Error(`no list item holds the text ${text}`);
    }

    return item;
}

/**
 * Loads a hand-built document into an editor.
 *
 * @param build - Builds the top-level blocks; runs inside the update.
 * @param editor - The editor; a bare one when omitted.
 * @returns The editor.
 */
function editorHolding(build: () => LexicalNode[], editor: LexicalEditor = bareEditor()): LexicalEditor {
    editor.update(() => {
        $getRoot().clear().splice(0, 0, build());
    }, { discrete: true });

    return editor;
}

/**
 * Runs a step inside one update of the editor.
 *
 * @param editor - The editor.
 * @param step - The step; its result is returned.
 * @returns What the step returned.
 */
function update<T>(editor: LexicalEditor, step: () => T): T {
    let result: T | undefined;

    editor.update(() => {
        result = step();
    }, { discrete: true });

    return result as T;
}

/**
 * Loads a hand-built document into an editor that keeps the writable-state
 * rules, so every list item is in its normal form after each update.
 *
 * @param build - Builds the top-level blocks; runs inside the update.
 * @returns The editor.
 */
function ruledEditorHolding(build: () => LexicalNode[]): LexicalEditor {
    const editor = bareEditor();

    registerWritableStateRules(editor);

    return editorHolding(build, editor);
}

/**
 * Puts a collapsed caret in the text node whose text is exactly `text`.
 *
 * @param text - The text node's text.
 * @param offset - The caret's offset in it.
 * @returns The selection.
 */
function $caretAt(text: string, offset: number): RangeSelection {
    return $textOf(text).select(offset, offset);
}

describe('the list operations on hand-built trees (S1 to S8)', () => {
    it('S1: $outdentItem moves a list\'s only item out, the outer item\'s later block with it', () => {
        const editor = editorHolding(() => [ul(i(t('a'), ul(i(t('b'))), p('c')), i(t('d')))]);

        expect(update(editor, () => $outdentItem($itemOf('b')))).toBe(true);
        expect(shapeOf(editor)).toBe('ul(i(t(a)), i(t(b), p(c)), i(t(d)))');
    });

    it('S2: $outdentItem takes the items after it along as its own nested list, then the outer item\'s later block', () => {
        const editor = editorHolding(() => [ul(i(t('a'), ul(i(t('b')), i(t('x'))), p('c')))]);

        expect(update(editor, () => $outdentItem($itemOf('b')))).toBe(true);
        expect(shapeOf(editor)).toBe('ul(i(t(a)), i(t(b), ul(i(t(x))), p(c)))');
    });

    it('S3: $outdentItem leaves a top-level item where it is', () => {
        const editor = editorHolding(() => [ul(i(t('a')))]);

        expect(update(editor, () => $outdentItem($itemOf('a')))).toBe(false);
        expect(shapeOf(editor)).toBe('ul(i(t(a)))');
    });

    it('S4: $indentItem nests an item under the one before it, with its own nested list', () => {
        const editor = editorHolding(() => [ul(i(t('a')), i(t('b'), ul(i(t('c')))))]);

        expect(update(editor, () => $indentItem($itemOf('b')))).toBe(true);
        expect(shapeOf(editor)).toBe('ul(i(t(a), ul(i(t(b), ul(i(t(c)))))))');
    });

    it('S5: $indentItem joins the nested list that ends the item before it', () => {
        const editor = editorHolding(() => [ul(i(t('a'), ul(i(t('n')))), i(t('b')))]);

        expect(update(editor, () => $indentItem($itemOf('b')))).toBe(true);
        expect(shapeOf(editor)).toBe('ul(i(t(a), ul(i(t(n)), i(t(b)))))');
    });

    it('S6: $liftItemOut splits the list around the item\'s text and its blocks up to its first nested list', () => {
        const editor = editorHolding(() => [p('x'), ul(i(t('a')), i(t('b'), p('c'), ul(i(t('n'))), p('e')), i(t('z')))]);
        const lifted = update(editor, () => $liftItemOut($itemOf('b')).map(shape));

        expect(lifted).toEqual(['p(b)', 'p(c)']);
        expect(shapeOf(editor)).toBe('p(x), ul(i(t(a))), p(b), p(c), ul(i(ul(i(t(n))), p(e)), i(t(z)))');
    });

    it('S7: $liftItemOut moves the block an item opens with out as it is', () => {
        const editor = editorHolding(() => [ul(i(heading('Foo')), i(t('z')))]);
        const lifted = update(editor, () => $liftItemOut($getRoot().getFirstChildOrThrow<ListNode>().getFirstChildOrThrow<MarkdownListItemNode>()).map(shape));

        expect(lifted).toEqual(['heading(Foo)']);
        expect(shapeOf(editor)).toBe('heading(Foo), ul(i(t(z)))');
    });

    it('S8: $liftItemOut leaves an item that opens with a nested list where it is', () => {
        const editor = editorHolding(() => [ul(i(ul(i(t('n')))))]);
        const lifted = update(editor, () => $liftItemOut($getRoot().getFirstChildOrThrow<ListNode>().getFirstChildOrThrow<MarkdownListItemNode>()));

        expect(lifted).toEqual([]);
        expect(shapeOf(editor)).toBe('ul(i(ul(i(t(n)))))');
    });
});

describe('Lexical\'s own routines on a list item of the editor\'s classes (S9 to S16)', () => {
    it('S9: Enter in an item\'s text splits the item, the blocks after the text going to the new item', () => {
        const editor = ruledEditorHolding(() => [ul(i(t('wx'), p('p2')), i(t('z')))]);

        update(editor, () => $caretAt('wx', 1).insertParagraph());

        expect(shapeOf(editor)).toBe('ul(i(t(w)), i(t(x), p(p2)), i(t(z)))');
    });

    it('S10: a join that takes an item\'s text away moves what the item held after it into the item before', () => {
        const editor = ruledEditorHolding(() => [ul(i(t('a')), i(t('b'), p('c')))]);

        update(editor, () => $caretAt('b', 0).deleteCharacter(true));

        expect(shapeOf(editor)).toBe('ul(i(t(ab), p(c)))');
    });

    it('S11: an empty text deleted from the nested list after it goes alone, the list staying in its item', () => {
        const editor = ruledEditorHolding(() => [ul(i(t(), ul(i(t('n')))))]);

        update(editor, () => $caretAt('n', 0).deleteCharacter(true));

        expect(shapeOf(editor)).toBe('ul(i(ul(i(t(n)))))');
    });

    it('S12: a block type set on a nested item\'s text takes the item out of its lists, its later blocks after it', () => {
        const editor = ruledEditorHolding(() => [ul(i(t('a'), ul(i(t('b'))), p('c')), i(t('d')))]);

        update(editor, () => $setBlocksType($caretAt('b', 1), () => $createHeadingNode('h2')));

        expect(shapeOf(editor)).toBe('ul(i(t(a))), heading(b), p(c), ul(i(t(d)))');
        // The heading was given the item's depth as its indent, which the text reports; out of the lists it has none.
        expect(editor.read(() => $getRoot().getChildAtIndex<HeadingNode>(1)!.getIndent())).toBe(0);
    });

    it('S13: a list parsed from its own JSON keeps each item\'s paragraph a block, in the editor\'s classes', () => {
        const editor = editorHolding(() => [ul(i(t('a'), p('p')))]);

        const parsed = update(editor, () => {
            const exportTree = (node: LexicalNode): SerializedLexicalNode => ($isElementNode(node)
                ? { ...node.exportJSON(), children: node.getChildren().map(exportTree) } as SerializedLexicalNode
                : node.exportJSON());
            const list = $parseSerializedNode(exportTree($getRoot().getFirstChildOrThrow())) as ListNode;
            const item = list.getFirstChildOrThrow<ListItemNode>();

            return { shape: shape(list), classes: [item instanceof MarkdownListItemNode, item.getFirstChild() instanceof MarkdownListItemTextNode] };
        });

        expect(parsed).toEqual({ shape: 'ul(i(t(a), p(p)))', classes: [true, true] });
    });

    it('S14: a list item Lexical creates is of the editor\'s class', () => {
        const editor = bareEditor();

        expect(update(editor, () => $createListItemNode() instanceof MarkdownListItemNode)).toBe(true);
    });

    it('S15: an item\'s text reads the item\'s depth as its indent, and an indent set on it moves the item', () => {
        const editor = editorHolding(() => [ul(i(t('a')), i(t('b')))]);
        const $textElementOf = (text: string): MarkdownListItemTextNode => $itemOf(text).getFirstChildOrThrow<MarkdownListItemTextNode>();

        expect(editor.read(() => $textElementOf('b').getIndent())).toBe(0);

        update(editor, () => $textElementOf('b').setIndent(1));

        expect(shapeOf(editor)).toBe('ul(i(t(a), ul(i(t(b)))))');
        expect(editor.read(() => $textElementOf('b').getIndent())).toBe(1);
    });

    it('S16: the hooks leave a tree outside the document alone', () => {
        const editor = bareEditor();

        const detached = update(editor, () => {
            const text = t('a');
            const item = i(text, p('p'));

            text.setIndent(1);
            item.setIndent(1);
            text.remove();

            return { shape: shape(item), selection: $isRangeSelection($getSelection()) };
        });

        expect(detached).toEqual({ shape: 'i(p(p))', selection: false });
    });

    it('S17: an item\'s text that stands anywhere but first in an item is a paragraph', () => {
        const editor = ruledEditorHolding(() => [p('x'), t('loose'), ul(i(p('a'), t('b')))]);

        expect(shapeOf(editor)).toBe('p(x), p(loose), ul(i(t(a), p(b)))');
    });

    it('S18: an item left with no child gets an empty text, and inline nodes put straight into an item go into its text', () => {
        const editor = ruledEditorHolding(() => [ul($createListItemNode(), $createListItemNode().splice(0, 0, [$createTextNode('a'), p('b'), $createTextNode('c')]))]);

        expect(shapeOf(editor)).toBe('ul(i(t()), i(t(a), p(b), p(c)))');
    });

    /**
     * The selection's anchor as the letter of its node (or its text), its offset and its kind.
     *
     * @param editor - The editor.
     * @returns The anchor, or `none` without a range selection.
     */
    const anchorOf = (editor: LexicalEditor): string => editor.read(() => {
        const selection = $getSelection();

        if (!$isRangeSelection(selection)) {
            return 'none';
        }

        const node = selection.anchor.getNode();

        return `${$isTextNode(node) ? node.getTextContent() : shape(node).replace(/\(.*$/, '')}@${selection.anchor.offset}:${selection.anchor.type}`;
    });

    it.each<[string, number, string]>([
        ['before its first inline node', 0, 't@0:element'],
        ['between its inline nodes', 1, 't@1:element'],
        ['at its end', 2, 't@2:element'],
    ])('S19: a caret on an item that holds inline nodes, %s, goes into the item\'s text at the same place', (_name, offset, anchor) => {
        const editor = ruledEditorHolding(() => {
            const item = $createListItemNode().splice(0, 0, [$createTextNode('a'), $createTextNode('b').toggleFormat('bold')]);

            item.select(offset, offset);

            return [ul(item)];
        });

        expect(shapeOf(editor)).toBe('ul(i(t(a, b)))');
        expect(anchorOf(editor)).toBe(anchor);
    });

    it('S20: an item whose only block is removed stays, with an empty text that holds the caret', () => {
        const editor = ruledEditorHolding(() => [ul(i(heading('h')), i(t('z')))]);

        update(editor, () => {
            const block = $textOf('h').getParentOrThrow();

            block.selectStart();
            block.remove();
        });

        expect(shapeOf(editor)).toBe('ul(i(t()), i(t(z)))');
        expect(anchorOf(editor)).toBe('t@0:element');
    });

    it('S21: $outdentItem takes the outer item along when it held nothing but the nested list', () => {
        const editor = editorHolding(() => [ul(i(ul(i(t('n')))), i(t('z')))]);
        const moved = update(editor, () => $outdentItem($itemOf('n')));

        expect(moved).toBe(true);
        expect(shapeOf(editor)).toBe('ul(i(t(n)), i(t(z)))');
    });

    it('S22: a block put after an item\'s text goes after the item, and another item text stays in the item', () => {
        const editor = editorHolding(() => [ul(i(t('a')), i(t('z')))]);

        update(editor, () => {
            const text = $itemOf('a').getFirstChildOrThrow();

            text.insertAfter(p('x'));
            text.insertAfter(t('b'));
        });

        expect(shapeOf(editor)).toBe('ul(i(t(a), t(b))), p(x), ul(i(t(z)))');
    });

    it('S25: Backspace at the start of an item\'s text is the item\'s answer, not a paragraph\'s', () => {
        // Lexical asks the caret's block first, in a deletion at the start of the document that no key event led
        // to (an input method's). A paragraph that is empty over another block answers by removing itself.
        const editor = editorHolding(() => [ul(i(t(), heading('h')), i(t('z')))]);
        const moved = update(editor, () => {
            const text = $getRoot().getFirstChildOrThrow<ListNode>().getFirstChildOrThrow<ListItemNode>().getFirstChildOrThrow<MarkdownListItemTextNode>();

            return text.collapseAtStart();
        });

        expect(moved).toBe(true);
        expect(shapeOf(editor)).toBe('p(), heading(h), ul(i(t(z)))');
    });

    it('S24: an item of Lexical\'s own class, parsed from its serialised form, becomes an item of the editor\'s', () => {
        const editor = ruledEditorHolding(() => [p('x')]);
        const text = { detail: 0, format: 0, mode: 'normal', style: '', text: 'a', type: 'text', version: 1 };
        const item = { children: [text], direction: null, format: '', indent: 0, type: 'listitem', value: 1, version: 1 };
        const list = { children: [item], direction: null, format: '', indent: 0, listType: 'bullet', start: 1, tag: 'ul', type: 'list', version: 1 };

        update(editor, () => {
            $getRoot().splice(1, 0, [$parseSerializedNode(list as unknown as SerializedLexicalNode)]);
        });

        expect(shapeOf(editor)).toBe('p(x), ul(i(t(a)))');
    });

    it('S23: an item\'s text that is joined away takes its item with it, and one removed for itself leaves the item', () => {
        const editor = editorHolding(() => [ul(i(t('a')), i(t('b')), i(t('c'), p('p')))]);

        update(editor, () => {
            $itemOf('b').getFirstChildOrThrow().remove();
            $itemOf('c').getFirstChildOrThrow().remove(true);
        });

        // `b`'s item goes with its text. `c`'s paragraph moves to the item before; its emptied item stays, as asked.
        expect(shapeOf(editor)).toBe('ul(i(t(a), p(p)), i())');
    });
});
