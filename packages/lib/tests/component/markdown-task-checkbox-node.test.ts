// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The node class a MarkdownEditor task item's checkbox is made of
// (plans/markdown-task-lists.md): `MarkdownTaskCheckboxNode`, an inline
// decorator node that keeps its checked state as a field and the marker it was
// written with as node state.

import { describe, it, expect } from 'vitest';
import { $getRoot, $getState, $isElementNode, $parseSerializedNode, $setState, createEditor } from 'lexical';
import type { LexicalEditor, LexicalNode, SerializedLexicalNode } from 'lexical';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { $importMarkdown } from '~/component/editor/markdownImporter';
import {
    $createMarkdownTaskCheckboxNode, $emptyTaskItemMarkdown, $isMarkdownTaskCheckboxNode, $taskMarkerMarkdown,
} from '~/component/editor/markdownTaskCheckboxNode';
import { taskMarkerState } from '~/component/editor/markdownNodeState';

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
 * Collects the checkbox nodes under a node, in document order.
 *
 * @param node - The node to search.
 * @returns The checkbox nodes.
 */
function checkboxesIn(node: LexicalNode): LexicalNode[] {
    const found: LexicalNode[] = $isMarkdownTaskCheckboxNode(node) ? [node] : [];

    if ($isElementNode(node)) {
        node.getChildren().forEach((child) => found.push(...checkboxesIn(child)));
    }

    return found;
}

describe('a task checkbox node', () => {
    it('survives a JSON round trip with its state', () => {
        const first = bareEditor();

        first.update(() => { $importMarkdown('- [X] a'); }, { discrete: true });

        const second = bareEditor();

        second.setEditorState(second.parseEditorState(JSON.stringify(first.getEditorState().toJSON())));

        const boxes = second.read(() => checkboxesIn($getRoot()).map((box) => ({
            checked: $isMarkdownTaskCheckboxNode(box) && box.isChecked(),
            state:   $getState(box, taskMarkerState),
        })));

        expect(boxes).toEqual([{ checked: true, state: '[X]' }]);
    });

    it('made in the editor has no state', () => {
        bareEditor().update(() => {
            const box = $createMarkdownTaskCheckboxNode(false);

            expect($getState(box, taskMarkerState)).toBe('');
            expect($taskMarkerMarkdown(box)).toBe('[ ] ');
        }, { discrete: true });
    });

    it.each([
        ['a marker with its space', '[ ] ', ''],
        ['a stray letter', '[y]', ''],
        ['a bare letter', 'x', ''],
        ['an upper-case marker', '[X]', '[X]'],
        ['a lower-case marker', '[x]', '[x]'],
        ['an unchecked marker', '[ ]', '[ ]'],
    ])('holds a task marker only: %s', (_name, written, kept) => {
        // The state's `parse` runs when a node is read back from JSON, as undo and a paste read it.
        const json = { type: 'markdown-task-checkbox', version: 1, checked: false, $: { mdTaskMarker: written } } as SerializedLexicalNode;

        bareEditor().update(() => {
            const box = $parseSerializedNode(json);

            expect($getState(box as ReturnType<typeof $createMarkdownTaskCheckboxNode>, taskMarkerState)).toBe(kept);
        }, { discrete: true });
    });

    it('writes the marker that agrees with the box', () => {
        bareEditor().update(() => {
            const box = $createMarkdownTaskCheckboxNode(true, '[X]');

            expect($taskMarkerMarkdown(box)).toBe('[X] ');

            box.setChecked(false);

            expect($taskMarkerMarkdown(box)).toBe('[ ] ');

            box.setChecked(true);

            expect($taskMarkerMarkdown(box)).toBe('[x] ');
        }, { discrete: true });
    });

    it('is inline text of its marker that the keyboard does not select', () => {
        bareEditor().update(() => {
            const checked = $createMarkdownTaskCheckboxNode(true);
            const unchecked = $createMarkdownTaskCheckboxNode(false);

            expect(checked.isInline()).toBe(true);
            expect(checked.isKeyboardSelectable()).toBe(false);
            expect(checked.getTextContent()).toBe('[x] ');
            expect(unchecked.getTextContent()).toBe('[ ] ');
        }, { discrete: true });
    });

    it('reads as text when it is all an item holds', () => {
        bareEditor().update(() => {
            const unchecked = $createMarkdownTaskCheckboxNode(false);
            const checked = $createMarkdownTaskCheckboxNode(true);
            const upper = $createMarkdownTaskCheckboxNode(true, '[X]');

            expect($emptyTaskItemMarkdown(unchecked)).toBe('[ ]');
            expect($emptyTaskItemMarkdown(checked)).toBe('\\[x\\]');
            expect($emptyTaskItemMarkdown(upper)).toBe('\\[X\\]');
        }, { discrete: true });
    });

    it('does not set a state for an empty marker', () => {
        bareEditor().update(() => {
            const box = $createMarkdownTaskCheckboxNode(true);

            $setState(box, taskMarkerState, '');

            expect($getState(box, taskMarkerState)).toBe('');
        }, { discrete: true });
    });
});
