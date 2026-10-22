// @vitest-environment jsdom
//
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The selected look of a horizontal rule in a MarkdownEditor whose Lexical editor has a real root element
// (plans/markdown-horizontal-rules.md): selecting a rule redraws it with the selected class, and moving the
// selection off it redraws it without. The redraw is made by the editor's own registration, so these rows fail
// when that registration stops marking the rule dirty, which the rows that mark it by hand cannot tell. A click on
// the rule selects it. This file keeps the `@vitest-environment jsdom` pragma, gives the editor a real root
// element and must not call installTestDOM.

import { describe, it, expect, afterEach } from 'vitest';
import {
    $createNodeSelection, $createRangeSelection, $getRoot, $getSelection, $isNodeSelection, $setSelection, CLICK_COMMAND,
} from 'lexical';
import type { LexicalEditor } from 'lexical';
import { $dfs } from '@lexical/utils';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { $isMarkdownHorizontalRuleNode } from '~/component/editor/markdownHorizontalRuleNode';
import { DOM } from '~/core/DOM';

afterEach(() => {
    DOM.reset();
    document.body.replaceChildren();
});

/**
 * Reaches the private Lexical editor.
 *
 * @param editor - The Markdown editor.
 * @returns Its Lexical editor.
 */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/**
 * Loads a document into an editor whose Lexical editor has a real root element under the document body.
 *
 * @param source - The Markdown.
 * @returns The editor and its root element.
 */
function mounted(source: string): { editor: MarkdownEditor; root: HTMLElement } {
    const editor = new MarkdownEditor();
    const root = document.createElement('div');

    editor.setValue(source);
    root.contentEditable = 'true';
    document.body.append(root);
    lexicalOf(editor).setRootElement(root);

    return { editor, root };
}

/**
 * Selects the first rule as a node selection, as a click does.
 *
 * @param editor - The editor.
 */
function selectRule(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => {
        const rule = $dfs($getRoot()).map(({ node }) => node).find($isMarkdownHorizontalRuleNode)!;
        const selection = $createNodeSelection();

        selection.add(rule.getKey());
        $setSelection(selection);
    }, { discrete: true });
}

describe('the selected look of a rule is drawn by the editor\'s own registration', () => {
    it('adds the selected class when the rule is selected and takes it off when the selection leaves it', () => {
        const { editor, root } = mounted('a\n\n***\n\nb');

        expect(root.querySelector('hr')!.className).toBe('ts-ui-mde-horizontal-rule');

        selectRule(editor);

        expect(root.querySelector('hr')!.className).toBe('ts-ui-mde-horizontal-rule ts-ui-mde-horizontal-rule-selected');

        lexicalOf(editor).update(() => {
            const selection = $createRangeSelection();
            const first = $getRoot().getAllTextNodes()[0]!;

            selection.anchor.set(first.getKey(), 0, 'text');
            selection.focus.set(first.getKey(), 0, 'text');
            $setSelection(selection);
        }, { discrete: true });

        expect(root.querySelector('hr')!.className).toBe('ts-ui-mde-horizontal-rule');
    });

    it('a click on the rule\'s element selects it and draws it selected', () => {
        const { editor, root } = mounted('a\n\n***\n\nb');
        const element = root.querySelector('hr')!;

        lexicalOf(editor).dispatchCommand(CLICK_COMMAND, { target: element } as unknown as MouseEvent);

        const isRuleSelected = lexicalOf(editor).read(() => {
            const selection = $getSelection();

            return $isNodeSelection(selection) && selection.getNodes().length === 1 && $isMarkdownHorizontalRuleNode(selection.getNodes()[0]);
        });

        expect(isRuleSelected).toBe(true);
        expect(root.querySelector('hr')!.className).toContain('ts-ui-mde-horizontal-rule-selected');
    });

    it('a click elsewhere in the document does not select the rule', () => {
        const { editor, root } = mounted('a\n\n***\n\nb');

        lexicalOf(editor).dispatchCommand(CLICK_COMMAND, { target: root.querySelector('p')! } as unknown as MouseEvent);

        expect(lexicalOf(editor).read(() => $isNodeSelection($getSelection()))).toBe(false);
    });
});
