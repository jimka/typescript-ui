// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import type { MultilineElementTransformer, Transformer } from "@lexical/markdown";
import { parseAttributes, formatAttributes, resolveBlockStyle } from "~/component/display/markdownAttributes.js";
import { MarkdownBlockNode, $createMarkdownBlockNode, $isMarkdownBlockNode } from "~/component/editor/markdownBlockNode.js";

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
 * consumes a whole alignment/multi-column region in one pass — the same
 * `handleImportAfterStartMatch` hook and lazy-transformer-list trick the
 * curated `TABLE` transformer (`markdownTableTransformer.ts`) uses.
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
        dependencies: [MarkdownBlockNode],
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
            const block = $createMarkdownBlockNode();

            $convertFromMarkdownString(inner, getTransformers(), block);

            // AFTER the conversion: it clears the node's children, and
            // applying attributes first risks the clear taking them with it
            // — the same ordering the table transformer's cell-format
            // assignment follows.
            const style = resolveBlockStyle(parseAttributes(extractFenceAttributeText(openingRemainder)));

            block.setAlign(style.textAlign);
            block.setColumnCount(style.columnCount);
            block.setColumnGap(style.columnGap);

            rootNode.append(block);

            return [true, closingLineIndex];
        },

        // Never reached: handleImportAfterStartMatch either imports the block
        // or declines it, so the default multiline import path never runs.
        replace: () => false,

        export: (node) => {
            if (!$isMarkdownBlockNode(node)) {
                return null;
            }

            const attributes = node.toAttributes();
            const opening = Object.keys(attributes).length === 0
                ? ":::"
                : `::: {${formatAttributes(attributes)}}`;

            return `${opening}\n${$convertToMarkdownString(getTransformers(), node)}\n:::`;
        },
    };
}
