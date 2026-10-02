// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import type { TextFormatTransformer } from "@lexical/markdown";

/** `++text++` — a native Lexical text-format transformer for the `underline` format. */
export const UNDERLINE: TextFormatTransformer = {
    format: ["underline"],
    tag:    "++",
    type:   "text-format",
};
