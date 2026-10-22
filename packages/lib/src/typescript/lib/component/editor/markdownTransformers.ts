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
import { $isParagraphNode, $isTextNode } from "lexical";
import { $isTableCellNode } from "@lexical/table";
import { $findMatchingParent } from "@lexical/utils";
import { $createMarkdownHorizontalRuleNode } from "~/component/editor/markdownHorizontalRuleNode.js";
import { $isMarkdownListItemNode, $isMarkdownListItemTextNode } from "~/component/editor/markdownListItemNode.js";
import { $createMarkdownTaskCheckboxNode, $openingCheckbox } from "~/component/editor/markdownTaskCheckboxNode.js";
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
 * `---`, `***` or `___` (three or more of one), then a space or Enter, alone
 * in a paragraph that holds nothing else: a horizontal rule. The rule is put
 * before the paragraph and keeps the line as typed; the paragraph stays to hold
 * the caret. Applied nowhere else: not in a heading, an
 * item's text or a table cell, where Lexical would otherwise run it, since an
 * element shortcut runs on any block whose parent is a root or a shadow root.
 *
 * The spaced forms (`- - -`, `* * *`) are not shortcuts: `- ` and `* ` start
 * a list first.
 */
export const HORIZONTAL_RULE_SHORTCUT: ElementTransformer = {
    dependencies: [],
    // The editor saves through its own serializer; like every entry here, this one is only typed.
    export:       () => null,
    regExp:       /^(?:-{3,}|\*{3,}|_{3,})\s?$/,
    replace:      (block, children, match): false | undefined => {
        const isPlainParagraph = $isParagraphNode(block) && !$isMarkdownListItemTextNode(block);
        const inTableCell = $findMatchingParent(block, $isTableCellNode) !== null;

        // The marker must be all the paragraph holds: bold, a link, an image or a break after it is other content.
        const holdsOtherContent = children.length > 0;

        if (!isPlainParagraph || inTableCell || holdsOtherContent) {
            return false;
        }

        block.insertBefore($createMarkdownHorizontalRuleNode(match[0]!.trim()));
        block.clear();
        block.selectStart();

        return undefined;
    },
    triggerOnEnter: true,
    type:           "element",
};

/**
 * `[ ] `, `[x] ` or `[X] ` typed at the start of a list item's text that has
 * no checkbox yet: a task item. The checkbox is put first, keeping the letter
 * as typed, and the caret stands at the start of what follows it (right after
 * the checkbox when nothing follows).
 *
 * It is not a member of {@link SHORTCUT_TRANSFORMERS}: Lexical's own shortcut
 * path runs an element shortcut only on a block whose parent is a root, and
 * never in an item's text. The editor's held-block shortcuts try it alone in
 * such a text, on typing only, never on Enter (`triggerOnEnter` is `false`).
 */
export const TASK_ITEM_SHORTCUT: ElementTransformer = {
    dependencies: [],
    // The editor saves through its own serializer; like every entry here, this one is only typed.
    export:       () => null,
    regExp:       /^\[([ xX])\]\s/,
    replace:      (block, children, match): false | undefined => {
        const isItemText = $isMarkdownListItemTextNode(block) && $isMarkdownListItemNode(block.getParent());

        if (!isItemText || $openingCheckbox(block) !== null) {
            return false;
        }

        const box = $createMarkdownTaskCheckboxNode(match[1] !== " ", `[${match[1]}]`);
        const first = children[0];

        block.splice(0, 0, [box]);

        if ($isTextNode(first)) {
            first.select(0, 0);
        } else {
            box.selectNext();
        }

        return undefined;
    },
    triggerOnEnter: false,
    type:           "element",
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
 * - `HORIZONTAL_RULE_SHORTCUT` → `---` (horizontal rule)
 */
export const SHORTCUT_TRANSFORMERS: Transformer[] = [
    HEADING,
    QUOTE,
    CODE,
    HORIZONTAL_RULE_SHORTCUT,
    UNORDERED_LIST,
    ORDERED_LIST_SHORTCUT,
    BOLD_STAR,
    ITALIC_STAR,
    INLINE_CODE,
    STRIKETHROUGH,
    LINK,
    UNDERLINE,
];
