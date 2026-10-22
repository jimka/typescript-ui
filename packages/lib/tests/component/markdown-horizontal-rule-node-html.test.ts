// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The HTML side of the horizontal rule node a MarkdownEditor rule is made of
// (plans/markdown-horizontal-rules.md): a rule pasted from another
// application arrives as an `<hr>`, a copied rule leaves as one, and a rule
// that is selected is drawn with a class of its own. The modelled test DOM has
// no HTML parser, so this file keeps the `@vitest-environment jsdom` pragma
// and must not call installTestDOM.

import { describe, it, expect } from 'vitest';
import {
    $createNodeSelection, $createRangeSelection, $getRoot, $getState, $isElementNode, $isParagraphNode, $isTextNode, $setSelection, createEditor,
} from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $isListNode } from '@lexical/list';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { EDITOR_THEME } from '~/component/editor/editorTheme';
import { $isMarkdownListItemNode, $isMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import { $isMarkdownQuoteNode } from '~/component/editor/markdownQuoteNode';
import { $isMarkdownHorizontalRuleNode } from '~/component/editor/markdownHorizontalRuleNode';
import { horizontalRuleMarkerState } from '~/component/editor/markdownNodeState';
import { registerWritableStateRules } from '~/component/editor/markdownWritable';

/**
 * Builds a Lexical editor holding the editor's node classes, its theme and
 * its writable-state rules, whose errors fail the test.
 *
 * @returns The editor.
 */
function ruledEditor(): LexicalEditor {
    const editor = createEditor({ nodes: [...EDITOR_NODES], theme: EDITOR_THEME, onError: (error) => { throw error; } });

    registerWritableStateRules(editor);

    return editor;
}

/**
 * A node as short names for its type, a text node as its text.
 *
 * @param node - The node.
 * @returns The shape.
 */
function shape(node: LexicalNode): string {
    if ($isTextNode(node)) {
        return node.getTextContent();
    }

    const name = $isMarkdownHorizontalRuleNode(node) ? 'rule'
        : $isMarkdownQuoteNode(node) ? 'markdown-quote'
            : $isMarkdownListItemTextNode(node) ? 't'
                : $isParagraphNode(node) ? 'paragraph'
                    : $isMarkdownListItemNode(node) ? 'item'
                        : $isListNode(node) ? node.getTag() : node.getType();

    return $isElementNode(node) ? `${name}(${node.getChildren().map(shape).join(', ')})` : name;
}

/**
 * Loads HTML into an editor as a paste of it builds it, in place of the
 * document.
 *
 * @param html - The HTML.
 * @returns The document's shape.
 */
function shapeOfHtml(html: string): string {
    const editor = ruledEditor();
    const dom = new DOMParser().parseFromString(html, 'text/html');

    editor.update(() => {
        $getRoot().clear().append(...$generateNodesFromDOM(editor, dom));
    }, { discrete: true });

    return editor.read(() => $getRoot().getChildren().map(shape).join(', '));
}

describe('a horizontal rule pasted as HTML is built as the editor\'s rule', () => {
    it('stands between paragraphs', () => {
        expect(shapeOfHtml('<p>a</p><hr><p>b</p>')).toBe('paragraph(a), rule, paragraph(b)');
    });

    it('stands alone, with no kept line', () => {
        const editor = ruledEditor();
        const dom = new DOMParser().parseFromString('<hr>', 'text/html');

        editor.update(() => {
            $getRoot().clear().append(...$generateNodesFromDOM(editor, dom));
        }, { discrete: true });

        expect(editor.read(() => {
            const rule = $getRoot().getFirstChild();

            return $isMarkdownHorizontalRuleNode(rule) ? $getState(rule, horizontalRuleMarkerState) : null;
        })).toBe('');
        expect(shapeOfHtml('<hr>')).toBe('rule');
    });

    it('stands in a list item', () => {
        expect(shapeOfHtml('<ul><li>a<hr>b</li></ul>')).toBe('ul(item(t(a), rule, paragraph(b)))');
    });

    it('stands in a quote', () => {
        expect(shapeOfHtml('<blockquote><p>a</p><hr></blockquote>')).toBe('markdown-quote(paragraph(a), rule)');
    });

    it('is dropped from a table cell', () => {
        expect(shapeOfHtml('<table><tr><td>a<hr>b</td></tr></table>')).toBe('table(tablerow(tablecell(paragraph(a), paragraph(b))))');
    });
});

describe('a horizontal rule leaves as HTML', () => {
    it('is exported as a plain hr, without the editor class', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('a\n\n***\n\nb'); }, { discrete: true });

        const html = editor.read(() => $generateHtmlFromNodes(editor, null));

        expect(html).toContain('<hr>');
        root.remove();
    });
});

describe('a selected horizontal rule leaves as a plain hr', () => {
    it('writes no class, not even the selected look', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('a\n\n***\n\nb'); }, { discrete: true });
        editor.update(() => {
            const rule = $getRoot().getChildren().find($isMarkdownHorizontalRuleNode)!;
            const selection = $createNodeSelection();

            selection.add(rule.getKey());
            $setSelection(selection);
            rule.markDirty();
        }, { discrete: true });

        expect(root.querySelector('hr')!.className).toContain('ts-ui-mde-horizontal-rule-selected');
        expect(editor.read(() => $generateHtmlFromNodes(editor, null))).toBe('<p><span style="white-space: pre-wrap;">a</span></p><hr><p><span style="white-space: pre-wrap;">b</span></p>');
        root.remove();
    });
});

describe('a selected horizontal rule is drawn selected', () => {
    it('carries the selected class while a node selection holds it, and loses it with the caret elsewhere', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('a\n\n***\n\nb'); }, { discrete: true });

        editor.update(() => {
            const rule = $getRoot().getChildren().find($isMarkdownHorizontalRuleNode)!;
            const selection = $createNodeSelection();

            selection.add(rule.getKey());
            $setSelection(selection);
            rule.markDirty();
        }, { discrete: true });

        expect(root.querySelector('hr')!.className).toBe('ts-ui-mde-horizontal-rule ts-ui-mde-horizontal-rule-selected');

        editor.update(() => {
            const selection = $createRangeSelection();
            const first = $getRoot().getFirstChild()!;

            selection.anchor.set(first.getKey(), 0, 'element');
            selection.focus.set(first.getKey(), 0, 'element');
            $setSelection(selection);
            $getRoot().getChildren().find($isMarkdownHorizontalRuleNode)!.markDirty();
        }, { discrete: true });

        expect(root.querySelector('hr')!.className).toBe('ts-ui-mde-horizontal-rule');
        root.remove();
    });
});
