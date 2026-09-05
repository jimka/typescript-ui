// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { $createTextNode, $isTextNode } from "lexical";
import type { TextFormatTransformer, TextMatchTransformer } from "@lexical/markdown";
import {
    cssTextToAttributes, formatAttributes, parseAttributes, resolveSpanStyle,
    spanStyleToAttributes, spanStyleToCss,
} from "~/component/display/markdownAttributes.js";

/** `++text++` — a native Lexical text-format transformer for the `underline` format. */
export const UNDERLINE: TextFormatTransformer = {
    format: ["underline"],
    tag:    "++",
    type:   "text-format",
};

/**
 * `[text]{key=value …}` — a coloured/sized/font-styled `TextNode`, carried by
 * the node's own `style` string rather than a Lexical text format. Returning
 * `inner` from `replace` lets Lexical apply `**`/`*`/`++` formatting to the
 * span's text afterwards, matching `LINK`'s own shape.
 */
export const STYLED_TEXT: TextMatchTransformer = {
    dependencies: [],
    export: (node, _exportChildren, exportFormat) => {
        if (!$isTextNode(node) || node.getStyle() === "") {
            return null;
        }

        const style = resolveSpanStyle(cssTextToAttributes(node.getStyle()));
        const attributes = spanStyleToAttributes(style);

        return Object.keys(attributes).length === 0
            ? null
            : `[${exportFormat(node, node.getTextContent())}]{${formatAttributes(attributes)}}`;
    },
    importRegExp: /\[([^[\]]+)\]\{([^{}]*)\}/,
    regExp:       /\[([^[\]]+)\]\{([^{}]*)\}$/,
    replace: (textNode, match) => {
        const style = resolveSpanStyle(parseAttributes(match[2]!));
        const inner = $createTextNode(match[1]);

        inner.setStyle(spanStyleToCss(style));
        textNode.replace(inner);

        return inner;
    },
    type: "text-match",
};
