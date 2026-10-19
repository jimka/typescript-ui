// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The HTML side of the editor's image node: an `<img>` pasted from another
// application arrives as an image with its alt text, title and size, and a
// copied image leaves with its title. The modelled test DOM has no HTML
// parser, so this file keeps the `@vitest-environment jsdom` pragma and must
// not call installTestDOM.

import { describe, it, expect } from 'vitest';
import { $getRoot, $getState, $isElementNode, $isTextNode, createEditor } from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { EDITOR_THEME } from '~/component/editor/editorTheme';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import { $isMarkdownImageNode } from '~/component/editor/markdownImageNode';
import { $serializeMarkdown } from '~/component/editor/markdownSerializer';
import { imageWrittenState } from '~/component/editor/markdownNodeState';
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
 * Loads HTML into an editor as a paste of it builds it, in place of the document.
 *
 * @param html - The HTML.
 * @returns The editor.
 */
function pasted(html: string): LexicalEditor {
    const editor = ruledEditor();
    const dom = new DOMParser().parseFromString(html, 'text/html');

    editor.update(() => {
        $getRoot().clear().append(...$generateNodesFromDOM(editor, dom));
    }, { discrete: true });

    return editor;
}

/**
 * Every node of the document, in document order. Must run inside a read.
 *
 * @param node - The node to start from.
 * @returns The node and its descendants.
 */
function $allNodes(node: LexicalNode): LexicalNode[] {
    return [node, ...($isElementNode(node) ? node.getChildren().flatMap($allNodes) : [])];
}

describe('an image pasted as HTML is built as the editor\'s image', () => {
    it('keeps its source, alt text, title and size, and is written in the standard form', () => {
        const editor = pasted('<p>a<img src="/i.png" alt="d" title="t" width="10">b</p>');

        editor.read(() => {
            const nodes = $allNodes($getRoot());
            const image = nodes.find($isMarkdownImageNode)!;

            expect(nodes.filter($isTextNode).map((text) => text.getTextContent())).toEqual(['a', 'b']);
            expect(image.getSrc()).toBe('/i.png');
            expect(image.getAlt()).toBe('d');
            expect(image.getTitle()).toBe('t');
            expect(image.getImageWidth()).toBe(10);
            expect($getState(image, imageWrittenState)).toBe('');
            expect($serializeMarkdown()).toBe('a![d](/i.png "t"){width=10}b');
        });
    });

    it('keeps a title holding a blank line, written as character references', () => {
        const editor = pasted('<p>a<img src="/i.png" alt="d" title="t\n\nu">b</p>');

        expect(editor.read(() => $serializeMarkdown())).toBe('a![d](/i.png "t&#10;&#10;u")b');
        expect(editor.read(() => $allNodes($getRoot()).filter($isMarkdownImageNode).map((image) => image.getTitle()))).toEqual(['t\n\nu']);
    });

    it('builds no image for an img with no src, such as a lazy-loaded one that carries only data-src', () => {
        const editor = pasted('<p>a<img data-src="/i.png" alt="late">b</p>');

        expect(editor.read(() => $allNodes($getRoot()).some($isMarkdownImageNode))).toBe(false);
        expect(editor.read(() => $serializeMarkdown())).toBe('ab');
    });

    it('builds no image for a source the scheme allow-list refuses', () => {
        const editor = pasted('<p><img src="javascript:alert(1)" alt="x"></p>');

        expect(editor.read(() => $allNodes($getRoot()).some($isMarkdownImageNode))).toBe(false);
    });
});

describe('an image leaves as HTML with its title', () => {
    it('is exported with a title attribute', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('![a](/i.png "t")'); }, { discrete: true });

        const html = editor.read(() => $generateHtmlFromNodes(editor, null));

        expect(html).toContain('title="t"');
        root.remove();
    });
});
