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
    LINK,
} from "@lexical/markdown";
import type { Transformer } from "@lexical/markdown";

/**
 * The curated Markdown transformer array that defines `MarkdownEditor`'s
 * dialect — the exact subset of Markdown the read-only `Markdown` viewer
 * renders.
 *
 * @remarks
 * This is deliberately **not** Lexical's full `TRANSFORMERS` preset. The preset
 * also carries `STRIKETHROUGH`, `HIGHLIGHT`, `CHECK_LIST`, and table/image
 * transformers — constructs the viewer drops to a plain-text fallback. Curating
 * the list down to these nine is the single source of truth that guarantees the
 * editor can never emit Markdown the viewer would fail to render: the same array
 * is passed to the import converter, the export converter, and the
 * markdown-shortcut typing registration, so what the user types, what the editor
 * stores, and what the viewer reads all agree.
 *
 * The mapping to the viewer's supported tokens is:
 *
 * - `HEADING` → `#`…`######` (heading)
 * - `QUOTE` → `> ` (blockquote)
 * - `CODE` → fenced ` ``` ` block (code)
 * - `UNORDERED_LIST` → `- ` (unordered list)
 * - `ORDERED_LIST` → `1. ` (ordered list)
 * - `BOLD_STAR` → `**b**` (strong)
 * - `ITALIC_STAR` → `*i*` (em)
 * - `INLINE_CODE` → `` `c` `` (codespan)
 * - `LINK` → `[t](url)` (link)
 *
 * Star (not underscore) emphasis variants are chosen so bold/italic export is
 * deterministic and matches the viewer's demo output.
 */
export const TRANSFORMERS: Transformer[] = [
    HEADING,
    QUOTE,
    CODE,
    UNORDERED_LIST,
    ORDERED_LIST,
    BOLD_STAR,
    ITALIC_STAR,
    INLINE_CODE,
    LINK,
];
