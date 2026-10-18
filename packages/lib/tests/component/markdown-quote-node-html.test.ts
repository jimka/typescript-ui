// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The HTML side of the quote node a MarkdownEditor quote is made of
// (plans/markdown-editor-quote-node.md): a quote pasted from another
// application arrives as HTML and is built through the DOM conversions of
// Lexical's quote, which the editor's class replaces, and a copied quote
// leaves as HTML through the export. The modelled test DOM has no HTML
// parser, so this file keeps the `@vitest-environment jsdom` pragma and must
// not call installTestDOM.

import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode, $isParagraphNode, $isTextNode, createEditor } from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $isListNode } from '@lexical/list';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { $isMarkdownListItemNode, $isMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import { $isMarkdownQuoteNode } from '~/component/editor/markdownQuoteNode';
import { registerWritableStateRules } from '~/component/editor/markdownWritable';

/**
 * Builds a Lexical editor holding the editor's node classes and its
 * writable-state rules, whose errors fail the test.
 *
 * @returns The editor.
 */
function ruledEditor(): LexicalEditor {
    const editor = createEditor({ nodes: [...EDITOR_NODES], onError: (error) => { throw error; } });

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

    const name = $isMarkdownQuoteNode(node) ? 'markdown-quote'
        : $isMarkdownListItemTextNode(node) ? 't'
            : $isParagraphNode(node) ? 'paragraph'
                : $isMarkdownListItemNode(node) ? 'markdown-list-item'
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

describe('a quote pasted as HTML is built as the editor\'s quote', () => {
    it('holds its paragraphs', () => {
        expect(shapeOfHtml('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('markdown-quote(paragraph(a), paragraph(b))');
    });

    it('wraps inline text in a paragraph', () => {
        expect(shapeOfHtml('<blockquote>plain <b>bold</b></blockquote>')).toBe('markdown-quote(paragraph(plain , bold))');
    });

    it('holds a list and a nested quote', () => {
        expect(shapeOfHtml('<blockquote><ul><li>x</li></ul><blockquote><p>n</p></blockquote></blockquote>'))
            .toBe('markdown-quote(ul(markdown-list-item(t(x))), markdown-quote(paragraph(n)))');
    });
});

describe('a copied quote leaves as HTML', () => {
    it('writes a blockquote around a paragraph, a list and a blockquote', () => {
        const editor = ruledEditor();

        editor.update(() => {
            $importMarkdown('> a\n>\n> - x\n>\n> > n');
        }, { discrete: true });

        const html = editor.read(() => $generateHtmlFromNodes(editor, null));
        const exported = new DOMParser().parseFromString(html, 'text/html').body.querySelector('blockquote');

        expect(exported).not.toBeNull();
        expect(Array.from(exported!.children).map((child) => child.tagName)).toEqual(['P', 'UL', 'BLOCKQUOTE']);
    });
});
