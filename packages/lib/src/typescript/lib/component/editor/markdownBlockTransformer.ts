// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import type { MultilineElementTransformer, Transformer } from "@lexical/markdown";
import {
    parseAttributes, formatAttributes, resolveBlockStyle, splitColumnSections, joinColumnSections,
} from "~/component/display/markdownAttributes.js";
import {
    MarkdownBlockNode, MarkdownColumnNode, $createMarkdownBlockNode, $createMarkdownColumnNode, $isMarkdownBlockNode,
} from "~/component/editor/markdownBlockNode.js";

/** Any line that could plausibly open or close a `:::` fence — the coarse pre-filter `handleImportAfterStartMatch` refines. */
const FENCE_LINE_REG_EXP = /^\s*:::/;

/**
 * Extracts the `{key=value …}` attribute text from a fence's opening
 * remainder (the text after `:::`), or `""` when the remainder carries no
 * `{…}` group.
 *
 * @param remainder - The opening line's text after `:::`, trimmed.
 * @returns The attribute text inside the first `{…}` group, or `""`.
 */
function extractFenceAttributeText(remainder: string): string {
    const match = /\{([^{}]*)\}/.exec(remainder);

    return match === null ? "" : match[1]!;
}

/**
 * Builds the `:::` fence transformer: a `MultilineElementTransformer` that
 * consumes a whole alignment/column-region fence in one pass, importing and
 * exporting each `|||`-separated section as its own {@link MarkdownColumnNode}
 * column — the same `handleImportAfterStartMatch` hook, per-region
 * `$convertFromMarkdownString`-then-append order, and lazy-transformer-list
 * trick the curated `TABLE` transformer (`markdownTableTransformer.ts`) uses
 * for its rows and cells.
 *
 * @param getTransformers - Returns the curated transformer array, including
 *   this one. Called at import/export time, not at construction time, so the
 *   array may reference the transformer this call returns (avoiding a module
 *   import cycle with the file that builds that array) — the same trick
 *   `createTableTransformer` uses.
 * @returns The block transformer, ready to include in a transformer array.
 */
export function createBlockTransformer(getTransformers: () => Transformer[]): MultilineElementTransformer {
    return {
        dependencies: [MarkdownBlockNode, MarkdownColumnNode],
        regExpStart:  FENCE_LINE_REG_EXP,
        type:         "multiline-element",

        handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
            const openingRemainder = lines[startLineIndex]!.trim().slice(3).trim();

            // A bare ":::" with nothing to open is a stray closer, not an
            // opener — decline so the default paragraph handling takes it.
            if (openingRemainder === "") {
                return null;
            }

            let depth = 1;
            let closingLineIndex = -1;

            for (let lineIndex = startLineIndex + 1; lineIndex < lines.length; lineIndex += 1) {
                const trimmed = lines[lineIndex]!.trim();

                if (trimmed === ":::") {
                    depth -= 1;

                    if (depth === 0) {
                        closingLineIndex = lineIndex;

                        break;
                    }
                } else if (trimmed.startsWith(":::") && trimmed.slice(3).trim() !== "") {
                    depth += 1;
                }
            }

            // No matching close anywhere in the document: decline entirely,
            // matching the viewer's own fallback for an unclosed fence
            // (ordinary paragraphs, no container).
            if (closingLineIndex === -1) {
                return null;
            }

            const inner = lines.slice(startLineIndex + 1, closingLineIndex).join("\n");
            const style = resolveBlockStyle(parseAttributes(extractFenceAttributeText(openingRemainder)));
            const block = $createMarkdownBlockNode();

            block.setAlign(style.textAlign);
            block.setColumnGap(style.columnGap);

            for (const section of splitColumnSections(inner)) {
                const column = $createMarkdownColumnNode();

                // Converts into a detached column, then appends it — the
                // same order the table transformer uses for a cell, since
                // the conversion clears the node it converts into.
                $convertFromMarkdownString(section, getTransformers(), column);
                block.append(column);
            }

            // A block with one column and no attributes at all (not even a
            // gap) has nothing left to justify a fence — this is what an
            // old-syntax fence with only unrecognised attributes degrades to.
            // Appending it anyway would round-trip through `export` as a
            // bare ":::" opener, which neither fence scan can re-open (a
            // non-empty remainder is required), corrupting the document on
            // the next save. Unwrapping here instead — appending the sole
            // column's children directly — keeps the degrade graceful.
            // Mirrors export's own bare-opener condition exactly, rather
            // than the broader canUnwrap() (which also fires when a
            // one-column block carries only a gap, and unwrapping *that*
            // would silently drop a real attribute export can serialise
            // fine as `::: {gap=...}`).
            if (block.getColumns().length <= 1 && Object.keys(block.toAttributes()).length === 0) {
                for (const column of block.getColumns()) {
                    for (const child of column.getChildren()) {
                        rootNode.append(child);
                    }
                }
            } else {
                rootNode.append(block);
            }

            return [true, closingLineIndex];
        },

        // Never reached: handleImportAfterStartMatch either imports the block
        // or declines it, so the default multiline import path never runs.
        replace: () => false,

        export: (node) => {
            if (!$isMarkdownBlockNode(node)) {
                return null;
            }

            const columns = node.getColumns();

            // A block with no column children is malformed; declining lets
            // the default child export preserve its content instead of
            // dropping it.
            if (columns.length === 0) {
                return null;
            }

            const attributes = node.toAttributes();
            const opening = ":::"
                + (columns.length > 1 ? " columns" : "")
                + (Object.keys(attributes).length === 0 ? "" : ` {${formatAttributes(attributes)}}`);
            const body = joinColumnSections(
                columns.map((column) => $convertToMarkdownString(getTransformers(), column)));

            return `${opening}\n${body}\n:::`;
        },
    };
}
