// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { TextMatchTransformer } from "@lexical/markdown";
import { formatAttributes, parseAttributes, resolveImageSpec } from "~/component/display/markdownAttributes.js";
import { MarkdownImageNode, $createMarkdownImageNode, $isMarkdownImageNode } from "~/component/editor/markdownImageNode.js";

/**
 * `![alt](src){width=… height=…}` — a sized, validated image. `replace`
 * builds the node through the shared {@link resolveImageSpec} validator and
 * does nothing (declining the match) when `src` fails the scheme allow-list,
 * so an unsafe scheme never reaches the document.
 */
export const IMAGE: TextMatchTransformer = {
    dependencies: [MarkdownImageNode],
    export: (node) => {
        if (!$isMarkdownImageNode(node)) {
            return null;
        }

        const width = node.getImageWidth();
        const height = node.getImageHeight();
        const attributes: Record<string, string> = {};

        if (width !== null) {
            attributes.width = String(width);
        }

        if (height !== null) {
            attributes.height = String(height);
        }

        const attributeText = Object.keys(attributes).length === 0 ? "" : `{${formatAttributes(attributes)}}`;

        return `![${node.getAlt()}](${node.getSrc()})${attributeText}`;
    },
    importRegExp: /!\[([^[\]]*)\]\(([^()\s]+)\)(?:\{([^{}]*)\})?/,
    regExp:       /!\[([^[\]]*)\]\(([^()\s]+)\)(?:\{([^{}]*)\})?$/,
    replace: (textNode, match) => {
        const [, alt, src, attributeText] = match;
        const spec = resolveImageSpec(src!, alt ?? "", parseAttributes(attributeText ?? ""));

        if (spec === null) {
            return;
        }

        textNode.replace($createMarkdownImageNode(spec));
    },
    type: "text-match",
};
