// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Regression coverage for the `:::` column-region fence's flexbox layout
// declarations (see plans/implemented/markdown-explicit-column-regions.md);
// the editor-side twin of Markdown.multicolumn.test.ts, which carries the
// full explanation:
//
// 1. The block container is `display: flex` and each column is `flex: 1 1 0`
//    with `min-width: 0`, so every column is an equal fraction of the
//    container's width at any width — the fix for the old CSS `column-count`
//    auto-reflow, whose break point depended on the container's rendered
//    height and so disagreed between the editor's and the viewer's differently
//    sized surfaces.
// 2. A column is a flex item and therefore a formatting-context root, so its
//    first child's own top margin no longer collapses through it. Fixed by
//    zeroing the first child's top margin, scoped to a column's direct child
//    rather than the block's.
//
// This project's offline `TestDOM` models component layout geometry, not
// real flexbox measurement, so this suite only pins the CSS declarations
// `editorTheme.ts` registers, not the resulting on-screen geometry. The
// visual result was verified manually against a live dev server: see the
// commit message for `markdown-explicit-column-regions`.
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

describe('MarkdownEditor column-region fence CSS (flexbox layout declarations)', () => {
    it('lays out the block as a flex container and each column as an equal flex item, zeroing a column\'s first child\'s top margin', () => {
        installTestDOM(CONFIG);
        ensureMarkdownEditorClassRules();

        const rows = ruleStyleWrites(DOM.sink as RecordingDOMSink);

        const blockRows = rows.filter((w) => w.selector === '.ts-ui-mde-block');
        expect(blockRows.some((w) => w.key === 'display' && w.value === 'flex')).toBe(true);

        const columnRows = rows.filter((w) => w.selector === '.ts-ui-mde-column');
        expect(columnRows.some((w) => w.key === 'flex' && w.value === '1 1 0')).toBe(true);
        expect(columnRows.some((w) => w.key === 'minWidth' && w.value === '0')).toBe(true);

        const firstChildRows = rows.filter((w) => w.selector === '.ts-ui-mde-block > .ts-ui-mde-column > :first-child');
        expect(firstChildRows.some((w) => w.key === 'marginTop' && w.value === '0')).toBe(true);
    });
});
