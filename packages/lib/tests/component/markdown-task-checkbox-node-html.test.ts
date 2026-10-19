// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The HTML side of the task checkbox node (plans/markdown-task-lists.md): an
// HTML check list pasted from another application arrives as task items, a
// copied task item leaves as a checkbox input, and a mounted checkbox is a
// span with the checkbox role. The modelled test DOM has no HTML parser, so
// this file keeps the `@vitest-environment jsdom` pragma and must not call
// installTestDOM.

import { describe, it, expect, afterEach } from 'vitest';
import { $getRoot, $isElementNode, $isParagraphNode, $isTextNode, createEditor } from 'lexical';
import type { LexicalEditor, LexicalNode } from 'lexical';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $isListNode } from '@lexical/list';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { EDITOR_THEME } from '~/component/editor/editorTheme';
import { $isMarkdownListItemNode, $isMarkdownListItemTextNode } from '~/component/editor/markdownListItemNode';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import { $isMarkdownTaskCheckboxNode } from '~/component/editor/markdownTaskCheckboxNode';
import { $serializeMarkdown } from '~/component/editor/markdownSerializer';
import { registerWritableStateRules } from '~/component/editor/markdownWritable';
import { DOM } from '~/core/DOM';

afterEach(() => {
    DOM.reset();
    document.body.replaceChildren();
});

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

    if ($isMarkdownTaskCheckboxNode(node)) {
        return node.isChecked() ? 'checkbox(checked)' : 'checkbox(unchecked)';
    }

    const name = $isMarkdownListItemTextNode(node) ? 'text'
        : $isParagraphNode(node) ? 'paragraph'
            : $isMarkdownListItemNode(node) ? 'item'
                : $isListNode(node) ? `${node.getTag()}[${node.getListType()}]` : node.getType();

    return $isElementNode(node) ? `${name}(${node.getChildren().map(shape).join(', ')})` : name;
}

/**
 * Loads HTML into an editor as a paste of it builds it, in place of the
 * document.
 *
 * @param html - The HTML.
 * @returns The document's shape and its saved Markdown.
 */
function loadHtml(html: string): { shape: string; saved: string } {
    const editor = ruledEditor();
    const dom = new DOMParser().parseFromString(html, 'text/html');

    editor.update(() => {
        $getRoot().clear().append(...$generateNodesFromDOM(editor, dom));
    }, { discrete: true });

    return editor.read(() => ({ shape: $getRoot().getChildren().map(shape).join(', '), saved: $serializeMarkdown() }));
}

describe('an HTML check list is pasted as task items', () => {
    it('reads a GitHub task list', () => {
        const html = '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled> todo</li>'
            + '<li class="task-list-item"><input type="checkbox" checked disabled> done</li></ul>';
        const loaded = loadHtml(html);

        expect(loaded.shape).toBe('ul[bullet](item(text(checkbox(unchecked), todo)), item(text(checkbox(checked), done)))');
        expect(loaded.saved).toBe('- [ ] todo\n- [x] done');
    });

    it('reads items marked aria-checked', () => {
        expect(loadHtml('<ul><li aria-checked="true">a</li><li aria-checked="false">b</li></ul>').saved).toBe('- [x] a\n- [ ] b');
    });

    it('reads an ordered task list with a plain item', () => {
        expect(loadHtml('<ol><li class="task-list-item"><input type="checkbox" checked> one</li><li>plain</li></ol>').saved)
            .toBe('1. [x] one\n2. plain');
    });

    it('reads a Lexical check list as a bulleted list', () => {
        const loaded = loadHtml('<ul __lexicallisttype="check"><li aria-checked="true" role="checkbox">x</li></ul>');

        expect(loaded.saved).toBe('- [x] x');
        expect(loaded.shape.startsWith('ul[bullet]')).toBe(true);
    });

    it('shows no checkbox for an input outside a list', () => {
        const loaded = loadHtml('<p>a <input type="checkbox" checked> b</p>');

        expect(loaded.shape.startsWith('paragraph(')).toBe(true);
        expect(loaded.shape).not.toContain('checkbox');
    });
});

describe('a loose GitHub task list item is pasted as a task item', () => {
    it('reads an input inside the item\'s paragraph, checked or not', () => {
        const html = '<ul class="contains-task-list"><li class="task-list-item"><p><input type="checkbox" disabled> todo</p></li>'
            + '<li class="task-list-item"><p><input type="checkbox" checked disabled> done</p></li></ul>';

        expect(loadHtml(html).saved).toBe('- [ ] todo\n- [x] done');
    });

    it('does not double the checkbox of an input straight in the item', () => {
        const html = '<ul><li class="task-list-item"><input type="checkbox" checked> a</li></ul>';

        expect(loadHtml(html).shape).toBe('ul[bullet](item(text(checkbox(checked), a)))');
    });
});

describe('an input that does not open an item\'s text makes no checkbox', () => {
    it('after other text of the item', () => {
        const loaded = loadHtml('<ul><li>Agree <input type="checkbox"> to terms</li></ul>');

        expect(loaded.shape).not.toContain('checkbox');
    });

    it('in a later paragraph of the item', () => {
        const loaded = loadHtml('<ul><li><p>a</p><p><input type="checkbox"> b</p></li></ul>');

        expect(loaded.shape).not.toContain('checkbox');
    });

    it('after whitespace alone, it still opens the item\'s text', () => {
        expect(loadHtml('<ul><li> <input type="checkbox"> a</li></ul>').saved).toBe('- [ ] a');
        expect(loadHtml('<ul><li>\n  <p>\n <input type="checkbox" checked> a</p></li></ul>').saved).toBe('- [x] a');
    });

    it('drops only the input that does not open the text, keeping the one that does', () => {
        // Lexical's import drops the space before an inline input, as it does without this node (a known issue).
        expect(loadHtml('<ul><li><input type="checkbox"> a <input type="checkbox" checked> b</li></ul>').saved).toBe('- [ ] ab');
    });

    it('opening the item\'s first paragraph still makes one', () => {
        expect(loadHtml('<ul><li><p><input type="checkbox" checked> b</p></li></ul>').saved).toBe('- [x] b');
    });
});

describe('the HTML a task item leaves as is read back', () => {
    it.each([
        ['a bulleted list', '- [ ] a\n- [x] b'],
        ['an ordered list with a plain item', '1. [x] one\n2. plain'],
        ['a nested task item', '- [ ] a\n  - [x] b'],
    ])('%s pastes as the same task items', (_name, source) => {
        const editor = ruledEditor();

        editor.update(() => { $importMarkdown(source); }, { discrete: true });

        const html = editor.read(() => $generateHtmlFromNodes(editor, null));

        expect(loadHtml(html).saved).toBe(source);
    });
});

describe('a task item leaves as HTML', () => {
    it('writes a disabled checkbox input for each box', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('- [ ] a\n- [x] b'); }, { discrete: true });

        const html = editor.read(() => $generateHtmlFromNodes(editor, null));

        expect(html).toContain('<input type="checkbox" disabled="">');
        expect(html).toContain('<input type="checkbox" disabled="" checked="">');
    });
});

describe('a mounted task checkbox', () => {
    it('is a span with the checkbox role, its state and the editor classes', () => {
        const editor = ruledEditor();
        const root = document.createElement('div');

        root.contentEditable = 'true';
        document.body.append(root);
        editor.setRootElement(root);
        editor.update(() => { $importMarkdown('- [ ] one\n- [x] two'); }, { discrete: true });

        const boxes = [...root.querySelectorAll('[role="checkbox"]')];

        expect(boxes.map((box) => box.tagName)).toEqual(['SPAN', 'SPAN']);
        expect(boxes.map((box) => box.getAttribute('aria-checked'))).toEqual(['false', 'true']);
        expect(boxes.map((box) => box.className)).toEqual([
            'ts-ui-mde-task-checkbox',
            'ts-ui-mde-task-checkbox ts-ui-mde-task-checkbox-checked',
        ]);
    });
});
