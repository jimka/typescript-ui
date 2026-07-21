// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";

/**
 * The Lexical node classes registered on every `MarkdownEditor`'s editor.
 *
 * @remarks
 * A Lexical editor can only build or parse a node type whose class it was
 * created with, so this set must cover every construct the curated transformer
 * list produces: headings (`HeadingNode`), blockquotes (`QuoteNode`),
 * ordered/unordered lists (`ListNode` + `ListItemNode`), links (`LinkNode`),
 * fenced code (`CodeNode` + its `CodeHighlightNode` children), and GFM tables
 * (`TableNode` + `TableRowNode` + `TableCellNode`). The remaining dialect
 * constructs — bold, italic, inline code, paragraphs — are plain text formats
 * on the always-present built-in text/paragraph nodes and need no registration.
 */
export const EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    LinkNode,
    CodeNode,
    CodeHighlightNode,
    TableNode,
    TableRowNode,
    TableCellNode,
];
