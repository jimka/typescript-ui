// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";
import { MarkdownBlockNode, MarkdownColumnNode } from "~/component/editor/markdownBlockNode.js";
import { MarkdownImageNode } from "~/component/editor/markdownImageNode.js";
import { ReferenceLinkNode } from "~/component/editor/markdownReferenceLinkNode.js";
import { MarkdownRawBlockNode, MarkdownSourceTextNode } from "~/component/editor/markdownSourceNodes.js";

/**
 * The Lexical node classes registered on every `MarkdownEditor`'s editor.
 *
 * @remarks
 * A Lexical editor can only build or parse a node type whose class it was
 * created with, so this set must cover every construct the Markdown importer
 * produces: headings (`HeadingNode`), blockquotes (`QuoteNode`),
 * ordered/unordered lists (`ListNode` + `ListItemNode`), links (`LinkNode`,
 * and `ReferenceLinkNode` for a link written in a reference form),
 * fenced code (`CodeNode` + its `CodeHighlightNode` children), GFM tables
 * (`TableNode` + `TableRowNode` + `TableCellNode`), `:::` alignment /
 * column-region fences (`MarkdownBlockNode` + its `MarkdownColumnNode` column
 * children), sized images (`MarkdownImageNode`), and the Markdown kept as
 * source (`MarkdownSourceTextNode` inline, `MarkdownRawBlockNode` for a
 * block). The remaining dialect
 * constructs — bold, italic, inline code, paragraphs — are plain text formats
 * on the always-present built-in text/paragraph nodes and need no
 * registration.
 */
export const EDITOR_NODES: ReadonlyArray<Klass<LexicalNode>> = [
    HeadingNode,
    QuoteNode,
    ListNode,
    ListItemNode,
    LinkNode,
    ReferenceLinkNode,
    CodeNode,
    CodeHighlightNode,
    TableNode,
    TableRowNode,
    TableCellNode,
    MarkdownBlockNode,
    MarkdownColumnNode,
    MarkdownImageNode,
    MarkdownSourceTextNode,
    MarkdownRawBlockNode,
];
