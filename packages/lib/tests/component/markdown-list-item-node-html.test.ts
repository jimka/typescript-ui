// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The HTML side of the two node classes a MarkdownEditor list is made of
// (plans/markdown-editor-list-item-node.md): a list pasted from another
// application arrives as HTML and is built through the classes' DOM
// conversions, and a copied list leaves as HTML through their exports. The
// modelled test DOM has no HTML parser, so this file keeps the
// `@vitest-environment jsdom` pragma and must not call installTestDOM.

import { describe, it, expect } from 'vitest';
import { $getRoot, $isElementNode, $isParagraphNode, $isTextNode, createEditor } from 'lexical';
import type { ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $isListNode } from '@lexical/list';
import { $dfs } from '@lexical/utils';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { $isMarkdownListItemNode, $isMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $listReadsLoose } from '~/component/editor/markdownSerializer';
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

    const name = $isMarkdownListItemTextNode(node) ? 't'
        : $isParagraphNode(node) ? 'p'
            : $isMarkdownListItemNode(node) ? 'i'
                : $isListNode(node) ? node.getTag() : node.getType();

    return $isElementNode(node) ? `${name}(${node.getChildren().map(shape).join(', ')})` : name;
}

/**
 * Loads HTML into an editor as a paste of it builds it, in place of the
 * document.
 *
 * @param html - The HTML.
 * @returns The editor.
 */
function editorHoldingHtml(html: string): LexicalEditor {
    const editor = ruledEditor();

    editor.update(() => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');

        $getRoot().clear().append(...$generateNodesFromDOM(editor, parsed));
    }, { discrete: true });

    return editor;
}

describe('a list built from HTML keeps what each item holds in that item', () => {
    it.each<[string, string, string]>([
        ['a nested list stays in the item that holds it', '<ul><li>one<ul><li>sub</li></ul></li><li>two</li></ul>', 'ul(i(t(one), ul(i(t(sub)))), i(t(two)))'],
        ['an item\'s paragraphs stay paragraphs of the item', '<ul><li><p>para1</p><p>para2</p></li><li>k</li></ul>', 'ul(i(t(para1), p(para2)), i(t(k)))'],
        ['an ordered list nested in a bullet list', '<ul><li>one<ol><li>sub</li></ol></li></ul>', 'ul(i(t(one), ol(i(t(sub)))))'],
        ['a nested list that is all an item holds', '<ul><li><ul><li>sub</li></ul></li></ul>', 'ul(i(ul(i(t(sub)))))'],
        // HTML also writes a nested list apart from its item; both ways mean the list of the item before.
        ['a nested list written straight in the list, between two items', '<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>',
            'ul(i(t(a), ul(i(t(b)))), i(t(c)))'],
        ['a nested list alone in an item after another item, as `@lexical/list` exports one',
            '<ul><li>a</li><li><ul><li>b</li></ul></li><li>c</li></ul>', 'ul(i(t(a), ul(i(t(b)))), i(t(c)))'],
        ['links in the items', '<ul><li><a href="/a">Section</a><ul><li><a href="/b">Sub</a></li></ul></li><li><a href="/c">Other</a></li></ul>',
            'ul(i(t(link(Section)), ul(i(t(link(Sub))))), i(t(link(Other))))'],
    ])('%s', (_name, html, expected) => {
        const editor = editorHoldingHtml(html);

        expect(editor.read(() => $getRoot().getChildren().map(shape).join(', '))).toBe(expected);
    });

    it.each<[string, string]>([
        ['an item holding two links', '<ul><li><a href="/a">a</a> and <a href="/b">b</a></li><li>c</li></ul>'],
        ['a link before a nested list', '<ul><li><a href="/a">Section</a><ul><li><a href="/b">Sub</a></li></ul></li><li><a href="/c">Other</a></li></ul>'],
    ])('a list built with %s is tight: a link is no block of its item', (_name, html) => {
        const editor = editorHoldingHtml(html);
        const loose = editor.read(() => $dfs($getRoot()).map(({ node }) => node).filter($isListNode).map($listReadsLoose));

        expect(loose.length).toBeGreaterThan(0);
        expect(loose.every((isLoose) => !isLoose)).toBe(true);
    });
});

describe('a list is exported as the ordinary HTML of a list', () => {
    it('the text of a nested item carries no indent of its own, and an empty item keeps a line', () => {
        const editor = editorHoldingHtml('<ul><li>one<ul><li>sub<ul><li>deep</li></ul></li></ul></li><li></li></ul>');
        const html = editor.read(() => $generateHtmlFromNodes(editor, null));

        expect(html).not.toContain('padding');
        expect(html).not.toContain('data-lexical-indent');
        expect(html.replace(/ (?:class|style|value|dir)="[^"]*"/g, '').replace(/<\/?span>/g, ''))
            .toBe('<ul><li><p>one</p><ul><li><p>sub</p><ul><li><p>deep</p></li></ul></li></ul></li><li><p><br></p></li></ul>');
    });

    it.each<[string, string, string, string]>([
        ['an item that opens with a nested list is exported as its own <li>, and read back as its own item',
            '<ul><li><p>a</p></li><li><ul><li><p>b</p></li></ul><p>c</p></li></ul>', 'ul(i(t(a)), i(ul(i(t(b))), p(c)))',
            '<ul><li><p>a</p></li><li><ul><li><p>b</p></li></ul><p>c</p></li></ul>'],
        ['an item that holds a nested list and nothing else, after another item, likewise',
            '<ul><li><p>a</p></li><li><ul><li><p>b</p></li></ul></li></ul>', 'ul(i(t(a)), i(ul(i(t(b)))))',
            '<ul><li><p>a</p></li><li><ul><li><p>b</p></li></ul></li></ul>'],
    ])('%s', (_name, html, expectedShape, expectedHtml) => {
        const editor = editorHoldingHtml(html);
        const exported = editor.read(() => $generateHtmlFromNodes(editor, null));
        const plain = exported.replace(/ (?:class|style|value|dir)="[^"]*"/g, '').replace(/<\/?span>/g, '');

        expect(editor.read(() => $getRoot().getChildren().map(shape).join(', '))).toBe(expectedShape);
        expect(plain).toBe(expectedHtml);
        // What this editor copies as HTML, another instance of it reads as the same list.
        expect(editorHoldingHtml(exported).read(() => $getRoot().getChildren().map(shape).join(', '))).toBe(expectedShape);
    });

    it('the indent and outdent commands still read the item\'s depth off its text', () => {
        const editor = editorHoldingHtml('<ul><li>one<ul><li>sub</li></ul></li></ul>');
        const depths = editor.read(() => {
            const outer = $getRoot().getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow<ElementNode>();
            const nested = outer.getLastChildOrThrow<ElementNode>();
            const texts = [outer.getFirstChildOrThrow(), nested.getFirstChildOrThrow<ElementNode>().getFirstChildOrThrow()];

            return texts.map((text) => ($isElementNode(text) ? text.getIndent() : -1));
        });

        expect(depths).toEqual([0, 1]);
    });
});
