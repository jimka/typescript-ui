import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { canonicalSave } from './markdown-roundtrip/harness';
import { editorSurfaceModel, viewerModel } from './markdown-roundtrip/viewModel';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

// `marked` masks every `[label]` stretch that a link reference definition names before it pairs emphasis, and reads
// that stretch from the first `[` on, backslashes aside. A bare `]` after an escaped `[` can therefore hide emphasis
// between them, so a lean writing keeps the `\]` there. The definition may come later than the save of the block.
describe('a lean writing keeps the escape of a "]" that a definition could pair with a "["', () => {
    const rows: Array<[string, string]> = [
        ['a paragraph', '\\[x **b** \\[a\\]'],
        ['a list item', '- \\[x **b** \\[a\\]'],
        ['a quote', '> \\[x **b** \\[a\\]'],
        ['a heading', '# \\[x **b** \\[a\\]'],
        ['a table cell', '| h |\n| --- |\n| \\[x **b** \\[a\\] |'],
        ['strikethrough', '\\[x ~~b~~ \\[a\\]'],
        ['a line break between the brackets', '\\[x **b** \\[a\\\nc\\]'],
        ['a label of another case', '\\[x **b** \\[A\\]'],
        ['a "[" in a code span', '`[` **b** \\[a\\]'],
        ['a "[" in inline HTML', '<a title="["> **b** \\[a\\]'],
        ['a kept-source task item', '- [ ] `[` **b** \\[a\\]'],
        ['a styled span', '\\[a\\]{x} **b** \\[a\\]'],
    ];

    for (const [name, block] of rows) {
        it(`${name}: the save shows the same with a definition after it`, () => {
            const source = `${block}\n\n[a]: /a`;
            const editor = new MarkdownEditor();

            editor.setValue(source);

            const saved = canonicalSave(editor);
            const reloaded = new MarkdownEditor();

            reloaded.setValue(saved);

            expect(editorSurfaceModel(reloaded)).toEqual(editorSurfaceModel(editor));
            expect(viewerModel(saved).blocks).toEqual(editorSurfaceModel(editor));
            expect(saved).toContain('\\]');
        });

        it(`${name}: a definition added to the save later changes nothing it shows`, () => {
            const editor = new MarkdownEditor();

            editor.setValue(block);

            const saved = canonicalSave(editor);
            const shown = editorSurfaceModel(editor);
            const withDefinition = viewerModel(`${saved}\n\n[a]: /a`).blocks;

            expect(withDefinition.slice(0, shown.length)).toEqual(shown);
        });
    }
});
