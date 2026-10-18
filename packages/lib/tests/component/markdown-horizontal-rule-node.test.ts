// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The node class a MarkdownEditor horizontal rule is made of
// (plans/markdown-horizontal-rules.md): `MarkdownHorizontalRuleNode`, a block
// decorator node that holds no text and keeps the line it was written with
// as node state.

import { describe, it, expect } from 'vitest';
import { $getRoot, $getState, $parseSerializedNode, createEditor } from 'lexical';
import type { SerializedLexicalNode } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import {
    $createMarkdownHorizontalRuleNode, $horizontalRuleMarkdown, $isMarkdownHorizontalRuleNode,
} from '~/component/editor/markdownHorizontalRuleNode';
import { horizontalRuleMarkerState } from '~/component/editor/markdownNodeState';

/**
 * Builds a bare Lexical editor holding the editor's node classes and none of
 * its rules, whose errors fail the test.
 *
 * @returns The editor.
 */
function bareEditor(): LexicalEditor {
    return createEditor({ nodes: [...EDITOR_NODES], onError: (error) => { throw error; } });
}

describe('a horizontal rule node', () => {
    it('survives a JSON round trip with its line', () => {
        const first = bareEditor();

        first.update(() => { $importMarkdown('***'); }, { discrete: true });

        const second = bareEditor();

        second.setEditorState(second.parseEditorState(JSON.stringify(first.getEditorState().toJSON())));

        const rules = second.read(() => $getRoot().getChildren().map((node) => ({
            type:  node.getType(),
            state: $isMarkdownHorizontalRuleNode(node) ? $getState(node, horizontalRuleMarkerState) : null,
        })));

        expect(rules).toEqual([{ type: 'markdown-horizontal-rule', state: '***' }]);
    });

    it('made in the editor has no state and is written as three dashes', () => {
        bareEditor().update(() => {
            const rule = $createMarkdownHorizontalRuleNode();

            expect($getState(rule, horizontalRuleMarkerState)).toBe('');
            expect($horizontalRuleMarkdown(rule)).toBe('---');
        }, { discrete: true });
    });

    it.each([
        ['an indented line', '  ---', ''],
        ['a stray character', '-- -x', ''],
        ['two characters', '--', ''],
        ['spaced stars', '* * *', '* * *'],
        ['tabbed dashes', '-\t-\t-', '-\t-\t-'],
    ])('reads a thematic break line only when it is loaded: %s', (_name, written, kept) => {
        // The state's `parse` runs when a node is read back from JSON, as a stored document and an undo read it.
        const json = { type: 'markdown-horizontal-rule', version: 1, $: { mdHorizontalRule: written } } as SerializedLexicalNode;

        bareEditor().update(() => {
            const rule = $parseSerializedNode(json);

            expect($getState(rule as ReturnType<typeof $createMarkdownHorizontalRuleNode>, horizontalRuleMarkerState)).toBe(kept);
        }, { discrete: true });
    });

    it('is a block that shows a line end', () => {
        bareEditor().update(() => {
            const rule = $createMarkdownHorizontalRuleNode();

            expect(rule.isInline()).toBe(false);
            expect(rule.getTextContent()).toBe('\n');
        }, { discrete: true });
    });
});
