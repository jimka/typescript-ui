// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage for the `::: {columns=…}` fence's two CSS multi-column
// layout defects (see plans/implemented/markdown-rich-formatting-extension.md
// and the matching bug write-up); the editor-side twin of
// Markdown.multicolumn.test.ts, which carries the full explanation:
//
// 1. A multi-column `.ts-ui-mde-block` establishes a new block-formatting
//    context, so its first child's own top margin no longer collapses
//    through it, while the browser discards that same margin at every later
//    forced column break — pushing column 1's content down relative to
//    every other column's. Fixed by zeroing the first child's top margin.
// 2. A `<table>` has no `break-inside` guard, so the browser is free to slice
//    it mid-row across a column boundary. Fixed by setting
//    `break-inside: avoid` on the table.
//
// Both are real-browser CSS fragmentation/paint behaviour — this project's
// offline `TestDOM` models component layout geometry, not CSS multi-column
// text flow, so this suite only pins the CSS declarations `editorTheme.ts`
// registers, not the resulting on-screen geometry. The visual fix was
// verified manually against a live dev server: see the commit message.
//
// A fresh, dedicated test file (rather than adding to
// markdown-editor.test.ts) is deliberate: `ensureMarkdownEditorClassRules()`
// is a guarded singleton that performs its `StyleRule` writes only once per
// module lifetime, and vitest isolates module state per test file by
// default — so this file's first call below is guaranteed to be the one
// that actually records the shared class-rule writes.

import { describe, it, expect } from 'vitest';
import { ensureMarkdownEditorClassRules } from '~/component/editor/editorTheme';
import { DOM } from '~/core/DOM';
import { installTestDOM, ruleStyleWrites, type RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('MarkdownEditor multi-column fence CSS (fragmentation-margin and table-split fixes)', () => {
    it('zeroes the top margin of a multi-column block\'s first child, and marks its table break-inside: avoid', () => {
        installTestDOM(CONFIG);
        ensureMarkdownEditorClassRules();

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink);

        const firstChildRows = rows.filter((w) => w.selector === '.ts-ui-mde-block > :first-child');
        expect(firstChildRows.some((w) => w.key === 'marginTop' && w.value === '0')).toBe(true);

        const tableRows = rows.filter((w) => w.selector === '.ts-ui-mde-table');
        expect(tableRows.some((w) => w.key === 'breakInside' && w.value === 'avoid')).toBe(true);
    });
});
