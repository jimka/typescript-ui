// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The node class a MarkdownEditor quote is made of
// (plans/markdown-editor-quote-node.md): `MarkdownQuoteNode`, a quote that
// holds blocks only. The rows call `$liftOutOfQuote` and `collapseAtStart` on
// trees built by hand, and check what Lexical builds when it makes a quote
// itself.

import { describe, it, expect } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode, $isTextNode, $parseSerializedNode, createEditor } from 'lexical';
import type { LexicalEditor, LexicalNode, ParagraphNode, TextNode } from 'lexical';
import { $createQuoteNode } from '@lexical/rich-text';
import { $dfs } from '@lexical/utils';
import { EDITOR_NODES } from '~/component/editor/editorNodes';
import { $createMarkdownQuoteNode, $isMarkdownQuoteNode, $liftOutOfQuote, $nearestQuoteOf, MarkdownQuoteNode } from '~/component/editor/markdownQuoteNode';

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
 * A paragraph holding `text`.
 *
 * @param text - The text.
 * @returns The node.
 */
function p(text: string): ParagraphNode {
    return $createParagraphNode().splice(0, 0, [$createTextNode(text)]);
}

/**
 * A quote holding `children`, put in with `splice`, as they are.
 *
 * @param children - The quote's blocks.
 * @returns The node.
 */
function q(...children: LexicalNode[]): MarkdownQuoteNode {
    return $createMarkdownQuoteNode().splice(0, 0, children);
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

    const name = $isMarkdownQuoteNode(node) ? 'q' : node.getType() === 'paragraph' ? 'p' : node.getType();

    return $isElementNode(node) ? `${name}(${node.getChildren().map(shape).join(', ')})` : name;
}

/**
 * Builds a document, runs a step on it and reads the document's shape.
 *
 * @param build - Builds the top-level blocks; runs inside the update.
 * @param step - Runs in a second update; its result is returned with the shape.
 * @returns The shape after the step, and what the step returned.
 */
function run<T>(build: () => LexicalNode[], step: () => T): { shape: string; result: T } {
    const editor = bareEditor();
    let result: T | undefined;

    editor.update(() => {
        $getRoot().clear().splice(0, 0, build());
    }, { discrete: true });
    editor.update(() => {
        result = step();
    }, { discrete: true });

    return { shape: editor.read(() => $getRoot().getChildren().map(shape).join(', ')), result: result as T };
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
 * The top-level or nested child of a quote whose text is exactly `text`.
 *
 * @param text - The block's text.
 * @returns The block.
 */
function $blockOf(text: string): LexicalNode {
    return $textOf(text).getParentOrThrow();
}

describe('$liftOutOfQuote takes a run of a quote out, one level', () => {
    it('lifts the middle child, splitting the quote around it', () => {
        const out = run(() => [q(p('a'), p('b'), p('c'))], () => $liftOutOfQuote($blockOf('b'), $blockOf('b')).map(shape));

        expect(out.shape).toBe('q(p(a)), p(b), q(p(c))');
        expect(out.result).toEqual(['p(b)']);
    });

    it('lifts the first child', () => {
        expect(run(() => [q(p('a'), p('b'))], () => $liftOutOfQuote($blockOf('a'), $blockOf('a'))).shape).toBe('p(a), q(p(b))');
    });

    it('lifts every child and removes the quote', () => {
        expect(run(() => [q(p('a'), p('b'))], () => $liftOutOfQuote($blockOf('a'), $blockOf('b'))).shape).toBe('p(a), p(b)');
    });

    it('lifts a run out of a nested quote into the outer quote', () => {
        expect(run(() => [q(p('x'), q(p('a'), p('b')))], () => $liftOutOfQuote($blockOf('a'), $blockOf('b'))).shape).toBe('q(p(x), p(a), p(b))');
    });
});

describe('MarkdownQuoteNode', () => {
    it('collapses at the start by lifting its first child out', () => {
        const out = run(() => [q(p('a'), p('b'))], () => $getRoot().getFirstChildOrThrow<MarkdownQuoteNode>().collapseAtStart());

        expect(out.shape).toBe('p(a), q(p(b))');
        expect(out.result).toBe(true);
    });

    it('finds the nearest quote of a node', () => {
        const out = run(() => [q(q(p('a')))], () => {
            const nearest = $nearestQuoteOf($textOf('a'));

            return nearest !== null && nearest.getParentOrThrow().is($getRoot()) === false;
        });

        expect(out.result).toBe(true);
    });

    it('is not a shadow root, and is the class Lexical builds for a quote', () => {
        const out = run(() => [$createQuoteNode().splice(0, 0, [p('a')])], () => {
            const quote = $getRoot().getFirstChildOrThrow();

            return quote instanceof MarkdownQuoteNode && $isElementNode(quote) && !quote.isShadowRoot();
        });

        expect(out.result).toBe(true);
    });

    it('keeps its type through JSON', () => {
        const out = run(() => [q(p('a'))], () => {
            const json = $getRoot().getFirstChildOrThrow().exportJSON();

            return [json.type, $isMarkdownQuoteNode($parseSerializedNode(json))];
        });

        expect(out.result).toEqual(['markdown-quote', true]);
    });
});
