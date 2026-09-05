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
import type { Transformer } from "@lexical/markdown";
import { createTableTransformer } from "~/component/editor/markdownTableTransformer.js";

// Lazy: called at import/export time rather than passed by value, so this
// module can build TABLE from the very array it is about to join, with no
// import cycle back into this file.
const TABLE = createTableTransformer(() => TRANSFORMERS);

/**
 * The curated Markdown transformer array that defines `MarkdownEditor`'s
 * dialect — the exact subset of Markdown the read-only `Markdown` viewer
 * renders.
 *
 * @remarks
 * This is deliberately **not** Lexical's full `TRANSFORMERS` preset. The preset
 * also carries `HIGHLIGHT`, `CHECK_LIST`, and an image transformer — constructs
 * the viewer drops to a plain-text fallback. Curating the list down to these
 * eleven is the single source of truth that guarantees the editor can never
 * emit Markdown the viewer would fail to render: the same array is passed to
 * the import converter, the export converter, and the markdown-shortcut typing
 * registration, so what the user types, what the editor stores, and what the
 * viewer reads all agree.
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
 * - `STRIKETHROUGH` → `~~s~~` (del)
 * - `LINK` → `[t](url)` (link)
 * - `TABLE` → `| a | b |` (table)
 *
 * Star (not underscore) emphasis variants are chosen so bold/italic export is
 * deterministic and matches the viewer's demo output.
 */
export const TRANSFORMERS: Transformer[] = [
    TABLE,
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
];
