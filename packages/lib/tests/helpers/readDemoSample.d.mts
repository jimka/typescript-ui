// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Type declarations for the plain-ESM demo sample reader, so the test importing it stays
// strongly typed without `@types/node` entering the test program.

/**
 * The value of the `SAMPLE` template literal a demo panel's source declares; throws on anything it would misread.
 *
 * @param panelSource - The text of the demo panel's source file.
 */
export function readSampleDeclaration(panelSource: string): string;

/** The text of the MD Editor demo's sample, read from `src/typescript/MarkdownEditorPanel.ts`. */
export function readDemoEditorSample(): string;
