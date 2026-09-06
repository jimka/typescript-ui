// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $getRoot } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { MarkdownDocumentPanel } from '~/component/editor/MarkdownDocumentPanel';
import { MarkdownEditor } from '~/component/editor/MarkdownEditor';
import { ToolBar } from '~/component/menubar/ToolBar';
import { ToolBarSeparator } from '~/component/menubar/ToolBarSeparator';
import { Button } from '~/component/button/Button';
import { ToggleButton } from '~/component/button/ToggleButton';
import { MenuButton } from '~/component/button/MenuButton';
import { Spacer } from '~/component/container/Spacer';
import type { MenuItemConfig } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reaches the private headless Lexical editor for white-box selection setup — copied from markdown-editor.test.ts. */
function lexicalOf(editor: MarkdownEditor): LexicalEditor {
    return (editor as unknown as { _editor: LexicalEditor })._editor;
}

/** Places a collapsed range selection at the start of the document — copied from markdown-editor.test.ts. */
function selectStart(editor: MarkdownEditor): void {
    lexicalOf(editor).update(() => { $getRoot().selectStart(); }, { discrete: true });
}

/** Resolves a MenuButton/submenu's configured items — a fixed array, or a provider invoked for its current output. */
function resolveItems(items: MenuItemConfig[] | (() => MenuItemConfig[]) | null | undefined): MenuItemConfig[] {
    return typeof items === 'function' ? items() : items ?? [];
}

/** Finds a top-level item by its label, throwing if absent so a rename fails the test loudly. */
function findItem(items: MenuItemConfig[], text: string): MenuItemConfig {
    const item = items.find((i) => i.text === text);

    if (!item) {
        throw new Error(`menu item "${text}" not found`);
    }

    return item;
}

/** Recursively collects every leaf (action-bearing, non-separator) item under a menu tree. */
function flattenLeaves(items: MenuItemConfig[]): MenuItemConfig[] {
    const leaves: MenuItemConfig[] = [];

    for (const item of items) {
        if (item.submenu) {
            leaves.push(...flattenLeaves(resolveItems(item.submenu.items)));
        } else if (item.action) {
            leaves.push(item);
        }
    }

    return leaves;
}

/** Finds a toolbar MenuButton by its tooltip/accessible text (e.g. "Insert…"). */
function findMenuButton(panel: MarkdownDocumentPanel, text: string): MenuButton {
    const button = panel.getToolbar().getComponents().find(
        (c): c is MenuButton => c instanceof MenuButton && c.getText() === text,
    );

    if (!button) {
        throw new Error(`MenuButton "${text}" not found`);
    }

    return button;
}

/** Finds a toolbar ToggleButton by its tooltip/accessible text (e.g. "Bold"). */
function findToggleButton(panel: MarkdownDocumentPanel, text: string): ToggleButton {
    const button = panel.getToolbar().getComponents().find(
        (c): c is ToggleButton => c instanceof ToggleButton && c.getText() === text,
    );

    if (!button) {
        throw new Error(`ToggleButton "${text}" not found`);
    }

    return button;
}

// MUST be the first test in this file, and the only place `.click()` runs.
// Event's window-level base listener for "click" (and, for the trailing
// toggle, "change") installs lazily on its first registration and is never
// re-armed by a later installTestDOM() call within this module's lifetime
// (see MenuButton.test.ts's file-level comment for the same landmine) — so
// every other test below drives its assertions through the MenuButton
// menuItems configs directly (plain function calls, no DOM dispatch) instead.
describe('MarkdownDocumentPanel toolbar action wiring (native click dispatch)', () => {
    it('the five format-toggle buttons and the Edit Markdown source toggle fire their wired MarkdownEditor commands', async () => {
        const cases: Array<[string, string]> = [
            ['Bold', '**word**'],
            ['Italic', '*word*'],
            ['Underline', '++word++'],
            ['Strikethrough', '~~word~~'],
            ['Code', '`word`'],
        ];

        for (const [label, marker] of cases) {
            const panel = new MarkdownDocumentPanel();

            panel.setValue('word');

            const button = panel.getToolbar().getComponents().find(
                (c): c is ToggleButton => c instanceof ToggleButton && c.getText() === label,
            );

            expect(button).toBeDefined();

            selectStart(panel.getEditor());

            // Deliberately desynced beforehand: the button's own click-driven
            // self-flip (ToggleButton.onAction, which runs before the wired
            // "action" handler) would guess `false` here, the wrong answer —
            // proving the correct end state comes from the live
            // "selectionstate" emit inside toggleXxx()'s own editor.update()/
            // dispatchCommand() calls, not from the self-flip.
            button!.setSelected(true);

            button!.getElement(true);
            button!.click();

            expect(panel.getValue()).toContain(marker);

            // toggleXxx() dispatches a text-format command, whose update is
            // not `{ discrete: true }` and so settles on the next microtask
            // in this headless harness (see MarkdownEditor's own
            // "selectionstate" tests for the same deferral).
            await Promise.resolve();

            expect(button!.isSelected()).toBe(true);
        }

        const panel = new MarkdownDocumentPanel();
        const toggle = panel.getToolbar().getComponents().find(
            (c): c is ToggleButton => c instanceof ToggleButton && c.getText() === 'Edit Markdown source',
        );

        expect(toggle).toBeDefined();

        const setModeSpy = vi.spyOn(panel.getEditor(), 'setMode');

        toggle!.getElement(true);
        toggle!.click();
        expect(setModeSpy).toHaveBeenLastCalledWith('source');

        toggle!.click();
        expect(setModeSpy).toHaveBeenLastCalledWith('wysiwyg');
    });
});

describe('MarkdownDocumentPanel construction / value delegation', () => {
    it('getValue() returns the constructor value option', () => {
        expect(new MarkdownDocumentPanel({ value: 'hello' }).getValue()).toBe('hello');
    });

    it('setValue() changes getValue()', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('x');

        expect(panel.getValue()).toBe('x');
    });

    it('getEditor() / getToolbar() return the docked MarkdownEditor / ToolBar instances', () => {
        const panel = new MarkdownDocumentPanel();

        expect(panel.getEditor()).toBeInstanceOf(MarkdownEditor);
        expect(panel.getToolbar()).toBeInstanceOf(ToolBar);
        expect(panel.getComponents()).toContain(panel.getEditor());
        expect(panel.getComponents()).toContain(panel.getToolbar());
    });
});

describe('MarkdownDocumentPanel "change" event', () => {
    it('re-emits the owned MarkdownEditor\'s "change" event through its own on()/off()', () => {
        const panel = new MarkdownDocumentPanel();
        const listener = vi.fn();

        panel.on('change', listener);
        panel.getEditor().setValue('y');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0].value).toBe(panel.getValue());
    });

    it('off() stops delivery', () => {
        const panel = new MarkdownDocumentPanel();
        const listener = vi.fn();

        panel.on('change', listener);
        panel.off('change', listener);
        panel.getEditor().setValue('z');

        expect(listener).not.toHaveBeenCalled();
    });
});

describe('MarkdownDocumentPanel dirty relay', () => {
    it('isDirty() follows the owned editor via the framework parent/child relay, and markClean() delegates', () => {
        // setValue (not a format toggle) is used to flip the editor dirty,
        // matching markdown-editor.test.ts's own dirty-relay tests: a toggle
        // command's dispatchCommand path settles on a later flush in this
        // headless harness, while setValue's `{ discrete: true }` update
        // commits synchronously.
        const panel = new MarkdownDocumentPanel();

        expect(panel.isDirty()).toBe(false);

        panel.setValue('word');

        expect(panel.isDirty()).toBe(true);

        panel.markClean();

        expect(panel.isDirty()).toBe(false);
    });
});

describe('MarkdownDocumentPanel toolbar structure', () => {
    it('has 14 children in the documented group order', () => {
        const panel = new MarkdownDocumentPanel();
        const children = panel.getToolbar().getComponents();

        expect(children).toHaveLength(14);

        const formatLabels = ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Code'];

        for (let i = 0; i < formatLabels.length; i++) {
            expect(children[i]).toBeInstanceOf(ToggleButton);
            expect((children[i] as Button).getText()).toBe(formatLabels[i]);
        }

        expect(children[5]).toBeInstanceOf(ToolBarSeparator);

        expect((children[6] as MenuButton).getText()).toBe('Insert…');
        expect((children[7] as MenuButton).getText()).toBe('Table…');
        expect(children[6]).toBeInstanceOf(MenuButton);
        expect(children[7]).toBeInstanceOf(MenuButton);

        expect(children[8]).toBeInstanceOf(ToolBarSeparator);

        expect(children[9]).toBeInstanceOf(MenuButton);
        expect((children[9] as MenuButton).getText()).toBe('Text style…');
        expect(children[10]).toBeInstanceOf(MenuButton);
        expect((children[10] as MenuButton).getText()).toBe('Alignment…');
        expect(children[11]).toBeInstanceOf(MenuButton);
        expect((children[11] as MenuButton).getText()).toBe('Columns…');

        expect(children[12]).toBeInstanceOf(Spacer);
        expect((children[12] as Spacer).isFlex()).toBe(true);

        expect(children[13]).toBeInstanceOf(ToggleButton);
        expect((children[13] as ToggleButton).getText()).toBe('Edit Markdown source');
    });
});

describe('MarkdownDocumentPanel live toolbar state', () => {
    it('all five format buttons and the Table button report their neutral state immediately after construction', () => {
        const panel = new MarkdownDocumentPanel();

        for (const label of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Code']) {
            expect(findToggleButton(panel, label).isSelected()).toBe(false);
        }

        expect(findMenuButton(panel, 'Table…').isEnabled()).toBe(false);
    });

    it('the Bold button presses when the caret sits inside a bold run, and no other format button does', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('**bold**');
        selectStart(panel.getEditor());   // collapsed at the very start of the bold run

        expect(findToggleButton(panel, 'Bold').isSelected()).toBe(true);

        for (const label of ['Italic', 'Underline', 'Strikethrough', 'Code']) {
            expect(findToggleButton(panel, label).isSelected()).toBe(false);
        }
    });

    it('the Table button enables while the caret is inside a table, and disables again when it moves out', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('| a |\n| --- |\n| 1 |\n\nplain text');
        selectStart(panel.getEditor());   // first header cell

        expect(findMenuButton(panel, 'Table…').isEnabled()).toBe(true);

        lexicalOf(panel.getEditor()).update(() => { $getRoot().selectEnd(); }, { discrete: true });

        expect(findMenuButton(panel, 'Table…').isEnabled()).toBe(false);
    });

    it('the Alignment dropdown checks the current block alignment, and only that entry', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('::: {align=center}\ntext\n:::');
        selectStart(panel.getEditor());

        const items = resolveItems(findMenuButton(panel, 'Alignment…').getMenuItems());

        expect(findItem(items, 'Center').checked).toBe(true);

        for (const label of ['Left', 'Right', 'Justify', 'Default']) {
            expect(findItem(items, label).checked).toBeFalsy();
        }
    });

    it('the Columns dropdown checks "None" with the caret outside any ::: block', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('plain text');
        selectStart(panel.getEditor());

        const items = resolveItems(findMenuButton(panel, 'Columns…').getMenuItems());

        expect(findItem(items, 'None').checked).toBe(true);

        for (const label of ['2 columns', '3 columns', '4 columns']) {
            expect(findItem(items, label).checked).toBeFalsy();
        }
    });

    it('the Table dropdown\'s Align column submenu checks nothing with the caret outside a table', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('plain text');
        selectStart(panel.getEditor());

        const items = resolveItems(findMenuButton(panel, 'Table…').getMenuItems());
        const alignSub = resolveItems(findItem(items, 'Align column').submenu!.items);

        for (const item of alignSub) {
            expect(item.checked).toBeFalsy();
        }
    });

    it('the Table dropdown\'s Align column submenu checks the caret\'s own column alignment', () => {
        const panel = new MarkdownDocumentPanel();

        panel.setValue('| a |\n| :---: |\n| 1 |');
        selectStart(panel.getEditor());   // the :---: column

        const items = resolveItems(findMenuButton(panel, 'Table…').getMenuItems());
        const alignSub = resolveItems(findItem(items, 'Align column').submenu!.items);

        expect(findItem(alignSub, 'Center').checked).toBe(true);

        for (const label of ['Left', 'Right', 'None']) {
            expect(findItem(alignSub, label).checked).toBeFalsy();
        }
    });
});

describe('MarkdownDocumentPanel Insert dropdown', () => {
    it('"Table" inserts a header row, delimiter row, and one body row', () => {
        const panel = new MarkdownDocumentPanel();
        const items = resolveItems(findMenuButton(panel, 'Insert…').getMenuItems());

        findItem(items, 'Table').action!();

        const lines = panel.getValue().trim().split('\n');

        expect(lines).toHaveLength(3);
        expect(lines[1]).toContain('---');
    });

    it('"Bulleted list" calls toggleUnorderedList; "Numbered list" calls toggleOrderedList', () => {
        const bulletPanel = new MarkdownDocumentPanel();

        bulletPanel.setValue('word');
        selectStart(bulletPanel.getEditor());
        findItem(resolveItems(findMenuButton(bulletPanel, 'Insert…').getMenuItems()), 'Bulleted list').action!();

        expect(bulletPanel.getValue()).toContain('- word');

        const numberPanel = new MarkdownDocumentPanel();

        numberPanel.setValue('word');
        selectStart(numberPanel.getEditor());
        findItem(resolveItems(findMenuButton(numberPanel, 'Insert…').getMenuItems()), 'Numbered list').action!();

        expect(numberPanel.getValue()).toContain('1. word');
    });
});

describe('MarkdownDocumentPanel Table dropdown', () => {
    it('every leaf reaches its documented MarkdownEditor command with the documented arguments', () => {
        const panel = new MarkdownDocumentPanel();
        const editor = panel.getEditor();
        const items = resolveItems(findMenuButton(panel, 'Table…').getMenuItems());

        const insertSub = resolveItems(findItem(items, 'Insert').submenu!.items);
        const deleteSub = resolveItems(findItem(items, 'Delete').submenu!.items);
        const alignSub  = resolveItems(findItem(items, 'Align column').submenu!.items);

        const cases: Array<[MenuItemConfig, keyof MarkdownEditor, unknown[]]> = [
            [findItem(insertSub, 'Row above'), 'insertTableRow', [false]],
            [findItem(insertSub, 'Row below'), 'insertTableRow', [true]],
            [findItem(insertSub, 'Column left'), 'insertTableColumn', [false]],
            [findItem(insertSub, 'Column right'), 'insertTableColumn', [true]],
            [findItem(deleteSub, 'Row'), 'deleteTableRow', []],
            [findItem(deleteSub, 'Column'), 'deleteTableColumn', []],
            [findItem(deleteSub, 'Table'), 'deleteTable', []],
            [findItem(items, 'Merge cells'), 'mergeTableCells', []],
            [findItem(items, 'Unmerge cell'), 'unmergeTableCell', []],
            [findItem(alignSub, 'Left'), 'setTableColumnAlignment', ['left']],
            [findItem(alignSub, 'Center'), 'setTableColumnAlignment', ['center']],
            [findItem(alignSub, 'Right'), 'setTableColumnAlignment', ['right']],
            [findItem(alignSub, 'None'), 'setTableColumnAlignment', ['none']],
        ];

        for (const [item, method, args] of cases) {
            const spy = vi.spyOn(editor, method as any).mockImplementation(() => editor);

            item.action!();

            expect(spy).toHaveBeenCalledWith(...args);

            spy.mockRestore();
        }
    });

    it('every leaf is a no-op without throwing when the caret is outside a table', () => {
        const panel = new MarkdownDocumentPanel();
        const items = resolveItems(findMenuButton(panel, 'Table…').getMenuItems());
        const leaves = flattenLeaves(items);
        const before = panel.getValue();

        expect(() => {
            for (const leaf of leaves) {
                leaf.action!();
            }
        }).not.toThrow();

        expect(panel.getValue()).toBe(before);
    });
});

describe('MarkdownDocumentPanel Text style / Alignment / Columns dropdowns', () => {
    it('every leaf reaches its documented MarkdownEditor call with the exact literal argument', () => {
        const panel = new MarkdownDocumentPanel();
        const editor = panel.getEditor();

        const textStyleItems = resolveItems(findMenuButton(panel, 'Text style…').getMenuItems());
        const colourItems = resolveItems(findItem(textStyleItems, 'Colour').submenu!.items);
        const fontItems   = resolveItems(findItem(textStyleItems, 'Font').submenu!.items);
        const sizeItems   = resolveItems(findItem(textStyleItems, 'Size').submenu!.items);

        const alignmentItems = resolveItems(findMenuButton(panel, 'Alignment…').getMenuItems());
        const columnsItems   = resolveItems(findMenuButton(panel, 'Columns…').getMenuItems());

        const cases: Array<[MenuItemConfig, keyof MarkdownEditor, unknown[]]> = [
            [findItem(colourItems, 'Red'), 'setTextColor', ['#cc0000']],
            [findItem(colourItems, 'Green'), 'setTextColor', ['#008000']],
            [findItem(colourItems, 'Blue'), 'setTextColor', ['#2563eb']],
            [findItem(colourItems, 'Default'), 'setTextColor', [null]],
            [findItem(fontItems, 'Serif'), 'setFontFamily', ['Georgia, serif']],
            [findItem(fontItems, 'Monospace'), 'setFontFamily', ['monospace']],
            [findItem(fontItems, 'Default'), 'setFontFamily', [null]],
            [findItem(sizeItems, 'Small'), 'setFontSize', ['0.8em']],
            [findItem(sizeItems, 'Large'), 'setFontSize', ['1.2em']],
            [findItem(sizeItems, 'Default'), 'setFontSize', [null]],
            [findItem(alignmentItems, 'Left'), 'setBlockAlignment', ['left']],
            [findItem(alignmentItems, 'Center'), 'setBlockAlignment', ['center']],
            [findItem(alignmentItems, 'Right'), 'setBlockAlignment', ['right']],
            [findItem(alignmentItems, 'Justify'), 'setBlockAlignment', ['justify']],
            [findItem(alignmentItems, 'Default'), 'setBlockAlignment', [null]],
            [findItem(columnsItems, '2 columns'), 'setColumnCount', [2]],
            [findItem(columnsItems, '3 columns'), 'setColumnCount', [3]],
            [findItem(columnsItems, '4 columns'), 'setColumnCount', [4]],
            [findItem(columnsItems, 'None'), 'setColumnCount', [null]],
        ];

        for (const [item, method, args] of cases) {
            const spy = vi.spyOn(editor, method as any).mockImplementation(() => editor);

            item.action!();

            expect(spy).toHaveBeenCalledWith(...args);

            spy.mockRestore();
        }
    });
});
