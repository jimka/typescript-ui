// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import {
    HEADING,
    QUOTE,
    CODE,
    UNORDERED_LIST,
    ORDERED_LIST,
    BOLD_STAR,
    ITALIC_STAR,
    INLINE_CODE,
    STRIKETHROUGH,
    LINK,
} from "@lexical/markdown";
import type { ElementTransformer, Transformer } from "@lexical/markdown";
import { UNDERLINE } from "~/component/editor/markdownStyleTransformers.js";

/**
 * Lexical's `ORDERED_LIST` shortcut, its number limited to the one to nine
 * digits a CommonMark ordered list marker allows: `1234567890. ` starts no
 * list in the viewer, so typing it (or Enter after it) starts none here.
 */
export const ORDERED_LIST_SHORTCUT: ElementTransformer = {
    ...ORDERED_LIST,
    regExp: /^(\s*)(\d{1,9})\.\s/,
};

/**
 * The typing shortcuts `registerMarkdownShortcuts` applies. Import and export
 * go through `markdownImporter.ts` and `markdownSerializer.ts`.
 *
 * @remarks
 * Deliberately **not** Lexical's full `TRANSFORMERS` preset, which also
 * carries `HIGHLIGHT` and `CHECK_LIST` — constructs the viewer drops to a
 * plain-text fallback. The mapping to the viewer's tokens is:
 *
 * - `HEADING` → `#`…`######` (heading)
 * - `QUOTE` → `> ` (blockquote)
 * - `CODE` → fenced ` ``` ` block (code)
 * - `UNORDERED_LIST` → `- ` (unordered list)
 * - `ORDERED_LIST_SHORTCUT` → `1. ` (ordered list, at most nine digits)
 * - `BOLD_STAR` → `**b**` (strong)
 * - `ITALIC_STAR` → `*i*` (em)
 * - `INLINE_CODE` → `` `c` `` (codespan)
 * - `STRIKETHROUGH` → `~~s~~` (del)
 * - `LINK` → `[t](url)` (link)
 * - `UNDERLINE` → `++u++` (underline)
 */
export const SHORTCUT_TRANSFORMERS: Transformer[] = [
    HEADING,
    QUOTE,
    CODE,
    UNORDERED_LIST,
    ORDERED_LIST_SHORTCUT,
    BOLD_STAR,
    ITALIC_STAR,
    INLINE_CODE,
    STRIKETHROUGH,
    LINK,
    UNDERLINE,
];
