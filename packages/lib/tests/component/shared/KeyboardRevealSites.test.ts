// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Every place where a list, a tree or a table lets a keyboard move continue
// outward — scroll the scrolling panels around the component so that the
// current row or column is in view of them — has a row here.
//
// The rule the rows pin: a move the user makes with the keyboard scrolls the
// component and then the panels around it; a state setter called from code,
// and a click, scroll the component alone. So each row first puts the
// component in a state with a setter, which must leave the page where it is,
// and then makes one keyboard move, which must bring the current row or
// column into the page's view.
//
// The rows come from one table, `SITES`. Each names the call site in the
// source that it exercises. The last four cases of the file count the call
// sites in the four source files, one file each, and compare the count with
// the table, so a key that is given the outward step later, spelled as the
// others are, fails here until it has a row.
//
// Every fixture puts the component below, and for a table also right of, a
// page that is scrolled to its origin. The component is then wholly out of
// the page's view, so a move that takes the outward step always moves the
// page, and one that does not never does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from '~/core/Panel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Absolute } from '~/layout/Absolute';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { _List } from '~/component/list/List';
import { Body } from '~/component/table/Body';
import { TreeBody } from '~/component/table/TreeBody';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { installTestDOM, makeEvent, setConnected, setScrollExtent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

// File reading lives in a plain-ESM helper: the test program is deliberately
// Node-types-free, so `node:fs` cannot be imported here. See the helper for why.
import { librarySourceText } from '../../helpers/libraryClassScan.mjs';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The mounted page's box, and content past it on both axes, so the page has
// a scroll range either way.
const PAGE_WIDTH  = 300;
const PAGE_HEIGHT = 200;
const PAGE_EXTENT = { width: 900, height: 3000 };

// Where a component is put in the page: below its view, and for a table also
// far enough right that its second and third columns are cut by the page.
const WIDGET_TOP  = 300;
const TABLE_LEFT  = 200;

/** The source files that hold the call sites, relative to the library's source root. */
type SourceFile =
    | 'component/tree/Tree.ts'
    | 'component/list/AbstractSelectableList.ts'
    | 'component/table/Body.ts'
    | 'component/table/TreeBody.ts';

/** What a row does and what it expects. */
interface Site {
    /** The source file the call site is in. */
    file: SourceFile;
    /** The call site, as the source spells it, with the branch it is in. */
    site: string;
    /** The move, as a user would describe it. */
    move: string;
    /** The axis the page is expected to move along. */
    axis: 'x' | 'y';
    /** Sets the state up with setters, makes the move, and returns the page. */
    run: () => Panel | Promise<Panel>;
}

let frames: FrameRequestCallback[];
let built: Component[];

/** Runs every captured animation frame, including those a frame schedules. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        const pending = frames;

        frames = [];

        for (const callback of pending) {
            callback(0);
        }
    }
}

/** The element of the panel that really scrolls. */
function scroller(panel: Panel): Handle {
    return (panel as any).getScrollElement();
}

/**
 * A mounted 300 × 200 page that scrolls both ways and holds `widget` at
 * (`left`, 300).
 *
 * @param widget - The component under test.
 * @param left - The component's left edge in the page's content.
 * @param inside - More components under the page to mark connected.
 * @returns The page.
 */
function pageWith(widget: Component, left: number, ...inside: Component[]): Panel {
    const outer = new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'auto' });

    widget.setX(left);
    widget.setY(WIDGET_TOP);
    outer.addComponent(widget);
    built.push(outer);

    setConnected(outer.getElement(true)!, true);
    setScrollExtent(scroller(outer), PAGE_EXTENT);
    outer.setWidth(PAGE_WIDTH);
    outer.setHeight(PAGE_HEIGHT);
    outer.doLayout();
    drainFrames();

    for (const component of [widget, ...inside]) {
        setConnected(component.getElement(true)!, true);
    }

    return outer;
}

/**
 * Dispatches a real `keydown` on `element`.
 *
 * @param element - The element holding focus.
 * @param key - The key's `KeyboardEvent.key`.
 * @param init - Modifier keys held.
 */
function press(element: Handle, key: string, init: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
    DOM.sink.focus(element);
    DOM.sink.dispatchEvent(element, makeEvent(element, 'keydown', { key, ...init }));
}

/**
 * Presses Shift+F10 on `element`: the key, then the `contextmenu` event a
 * browser dispatches at the focused element.
 *
 * @param element - The element holding focus.
 */
function shiftF10(element: Handle): void {
    press(element, 'F10', { shiftKey: true });
    DOM.sink.dispatchEvent(element, makeEvent(element, 'contextmenu', { clientX: 0, clientY: 0 }));
}

// ---------------------------------------------------------------------------
// Tree: a parent with two children, then seven more rows. Ten rows of 24 px
// in a tree 120 px high.
// ---------------------------------------------------------------------------

/** The tree fixture's parts. */
interface TreeRig {
    outer: Panel;
    tree: InstanceType<typeof _Tree>;
    element: Handle;
    parent: TreeNode;
    firstChild: TreeNode;
    last: TreeNode;
    middle: TreeNode;
}

/**
 * A 200 × 120 tree in the page, expanded, with nothing selected.
 *
 * @returns The page, the tree and the nodes the rows start from.
 */
function treeRig(): TreeRig {
    const firstChild: TreeNode = { label: 'a1' };
    const parent: TreeNode     = { label: 'a', children: [firstChild, { label: 'a2' }] };
    const rest: TreeNode[]     = ['b', 'c', 'd', 'e', 'f', 'g', 'h'].map(label => ({ label }));
    const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });
    const outer = pageWith(tree, 0);

    tree.setNodes([parent, ...rest]);
    tree.expandAll();
    drainFrames();

    return { outer, tree, element: tree.getElement()!, parent, firstChild, last: rest[6], middle: rest[2] };
}

/**
 * A tree row: selects `from` with the setter, then presses `key`.
 *
 * @param from - Which node the setter selects first; `null` for none.
 * @param key - The key to press.
 * @param shift - Whether Shift is held.
 * @returns The row's `run`.
 */
function treeKey(from: keyof Pick<TreeRig, 'parent' | 'firstChild' | 'last' | 'middle'> | null, key: string, shift: boolean = false): () => Panel {
    return () => {
        const rig = treeRig();

        if (from !== null) {
            rig.tree.selectNode(rig[from]);
            drainFrames();
        }

        expectUnmoved(rig.outer);

        if (key === 'F10') {
            shiftF10(rig.element);
        } else {
            press(rig.element, key, { shiftKey: shift });
        }

        return rig.outer;
    };
}

// ---------------------------------------------------------------------------
// List: thirty rows of 22 px in a list 110 px high.
// ---------------------------------------------------------------------------

/**
 * A list row: puts the focus mark on `from` with the setter, then makes a
 * move.
 *
 * @param from - The index the setter focuses first.
 * @param move - Presses the key on the list's element.
 * @returns The row's `run`.
 */
function listKey(from: number, move: (element: Handle) => void): () => Panel {
    return () => {
        const items = Array.from({ length: 29 }, (_, i) => 'Row ' + i).concat('Zulu');
        const list  = new _List({ items, preferredSize: { width: 200, height: 110 } });
        const outer = pageWith(list, 0, (list as any)._innerPanel);

        list.setFocusedIndex(from);
        drainFrames();
        expectUnmoved(outer);

        move(list.getElement()!);

        return outer;
    };
}

// ---------------------------------------------------------------------------
// Table body: 100 records, three columns of 100 px, in a body 300 × 100 that
// starts 200 px across the page.
// ---------------------------------------------------------------------------

const TABLE_MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

const COLUMN_WIDTHS = [100, 100, 100];
const TABLE_WIDTH   = 300;

/**
 * A table-body row: selects record 5 and column `column` by setting state,
 * then makes a move.
 *
 * @param column - The focused column to start from.
 * @param move - Makes the move on the body, through an `any` cast.
 * @returns The row's `run`.
 */
function bodyMove(column: number, move: (body: any) => void): () => Promise<Panel> {
    return async () => {
        const store = new MemoryStore(TABLE_MODEL, Array.from({ length: 100 }, (_, i) => ({ a: String(i) })));

        await store.load();

        const body: any = new Body(store, { preferredSize: { width: TABLE_WIDTH, height: 100 } });
        const outer     = pageWith(body, TABLE_LEFT);

        body.renderWindow(TABLE_WIDTH, COLUMN_WIDTHS);
        body.selectRecord(store.getAll()[5]);
        body._focusedColIndex = column;
        body.renderWindow();
        drainFrames();
        expectUnmoved(outer);

        move(body);

        return outer;
    };
}

/**
 * A key the table body handles while it holds focus itself.
 *
 * @param key - The key.
 * @param shift - Whether Shift is held.
 * @returns A move for {@link bodyMove}.
 */
function bodyKey(key: string, shift: boolean = false): (body: any) => void {
    return body => {
        body.onKeyDown(makeEvent(body.getElement(), 'keydown', { key, shiftKey: shift }));
    };
}

/**
 * A move with the edit entry that follows it taken out. A cell that opens its
 * editor shows its column by itself, through the handler `wireRowCells`
 * installs. With the entry gone, the page can only have moved through the
 * call the key handler makes before it.
 *
 * @param move - The move to make.
 * @returns A move for {@link bodyMove}.
 */
function beforeEditEntry(move: (body: any) => void): (body: any) => void {
    return body => {
        body.startEditAtFocusedCell   = () => {};
        body.openEditingAfterNavigate = () => {};

        move(body);
    };
}

// ---------------------------------------------------------------------------
// Tree table body: one parent with a child.
// ---------------------------------------------------------------------------

const TREE_TABLE_MODEL = new Model([
    { name: 'id',     type: 'number', order: 0 },
    { name: 'parent', type: 'number', order: 1 },
    { name: 'name',   type: 'string', order: 2 },
], 'id');

/**
 * The tree-table row: selects the child record by setting state, then
 * presses ArrowLeft, which moves to its parent.
 *
 * @returns The page.
 */
function treeBodyArrowLeft(): Panel {
    const store = new MemoryStore(TREE_TABLE_MODEL, []);

    store.loadData([{ id: 1, parent: null, name: 'parent' }, { id: 2, parent: 1, name: 'child' }]);

    const body: any = new TreeBody(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: 16 });
    const outer     = pageWith(body, 0);

    body.setWidth(TABLE_WIDTH);
    body.setHeight(100);
    body.expandAll();
    body.renderWindow(TABLE_WIDTH, COLUMN_WIDTHS);

    const child = body.getFlatRecords().find((flat: any) => flat.record.get('id') === 2).record;

    body.selectRecord(child);
    body.renderWindow();
    drainFrames();
    expectUnmoved(outer);

    body.onKeyDown(makeEvent(body.getElement(), 'keydown', { key: 'ArrowLeft' }));

    return outer;
}

/**
 * Asserts that the page is still at its origin: what a setter leaves.
 *
 * @param outer - The page.
 */
function expectUnmoved(outer: Panel): void {
    expect([outer.getScrollLeft(), outer.getScrollTop()]).toEqual([0, 0]);
}

const TREE  = 'component/tree/Tree.ts';
const LIST  = 'component/list/AbstractSelectableList.ts';
const BODY  = 'component/table/Body.ts';
const TBODY = 'component/table/TreeBody.ts';

const SITES: Site[] = [
    // Tree._onKeyDown: a plain key replaces the selection.
    { file: TREE, site: 'ArrowDown: _selectAtIndex(next, true)',          move: 'ArrowDown',                          axis: 'y', run: treeKey('parent', 'ArrowDown') },
    { file: TREE, site: 'ArrowUp: _selectAtIndex(prev, true)',            move: 'ArrowUp',                            axis: 'y', run: treeKey('last', 'ArrowUp') },
    { file: TREE, site: 'Home: _selectAtIndex(0, true)',                  move: 'Home',                               axis: 'y', run: treeKey('last', 'Home') },
    { file: TREE, site: 'End: _selectAtIndex(last, true)',                move: 'End',                                axis: 'y', run: treeKey('parent', 'End') },
    { file: TREE, site: 'PageDown: _selectAtIndex(next, true)',           move: 'PageDown',                           axis: 'y', run: treeKey('parent', 'PageDown') },
    { file: TREE, site: 'PageUp: _selectAtIndex(prev, true)',             move: 'PageUp',                             axis: 'y', run: treeKey('last', 'PageUp') },
    // Tree._onKeyDown: Shift extends the selection from the anchor.
    { file: TREE, site: 'ArrowDown: _extendSelectionTo(next, true)',      move: 'Shift+ArrowDown',                    axis: 'y', run: treeKey('parent', 'ArrowDown', true) },
    { file: TREE, site: 'ArrowUp: _extendSelectionTo(prev, true)',        move: 'Shift+ArrowUp',                      axis: 'y', run: treeKey('last', 'ArrowUp', true) },
    { file: TREE, site: 'Home: _extendSelectionTo(0, true)',              move: 'Shift+Home',                         axis: 'y', run: treeKey('last', 'Home', true) },
    { file: TREE, site: 'End: _extendSelectionTo(last, true)',            move: 'Shift+End',                          axis: 'y', run: treeKey('parent', 'End', true) },
    { file: TREE, site: 'PageDown: _extendSelectionTo(next, true)',       move: 'Shift+PageDown',                     axis: 'y', run: treeKey('parent', 'PageDown', true) },
    { file: TREE, site: 'PageUp: _extendSelectionTo(prev, true)',         move: 'Shift+PageUp',                       axis: 'y', run: treeKey('last', 'PageUp', true) },
    // Tree._onKeyDown: the two keys that walk the hierarchy.
    { file: TREE, site: 'ArrowRight, no current row: _selectAtIndex(0, true)',          move: 'ArrowRight with nothing selected',     axis: 'y', run: treeKey(null, 'ArrowRight') },
    { file: TREE, site: 'ArrowRight, expanded: _selectAtIndex(focusIdx + 1, true)',     move: 'ArrowRight into the first child',      axis: 'y', run: treeKey('parent', 'ArrowRight') },
    { file: TREE, site: 'ArrowLeft, child: _selectAtIndex(i, true)',                    move: 'ArrowLeft to the parent',              axis: 'y', run: treeKey('firstChild', 'ArrowLeft') },
    { file: TREE, site: 'ArrowLeft, expanded: _scrollIntoView(newIdx, true)',           move: 'ArrowLeft that collapses the node',    axis: 'y', run: treeKey('parent', 'ArrowLeft') },
    // Tree._typeAheadTo: a letter moves the current row like a plain arrow key.
    { file: TREE, site: '_typeAheadTo: _selectAtIndex(index, true)',        move: 'type-ahead',                         axis: 'y', run: treeKey('parent', 'h') },
    // Tree._revealFocusRow: the keyboard context menu.
    { file: TREE, site: '_revealFocusRow: _scrollIntoView(index, true)',  move: 'Shift+F10',                          axis: 'y', run: treeKey('middle', 'F10') },

    // AbstractSelectableList.moveFocus: every navigation key ends here.
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'ArrowDown',                          axis: 'y', run: listKey(3, element => press(element, 'ArrowDown')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'ArrowUp',                            axis: 'y', run: listKey(3, element => press(element, 'ArrowUp')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'Home',                               axis: 'y', run: listKey(3, element => press(element, 'Home')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'End',                                axis: 'y', run: listKey(3, element => press(element, 'End')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'PageDown',                           axis: 'y', run: listKey(3, element => press(element, 'PageDown')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'PageUp',                             axis: 'y', run: listKey(20, element => press(element, 'PageUp')) },
    { file: LIST, site: 'moveFocus: scrollIndexIntoView(idx, true)',      move: 'Ctrl+ArrowDown',                     axis: 'y', run: listKey(3, element => press(element, 'ArrowDown', { ctrlKey: true })) },
    // AbstractSelectableList.handleTypeAhead.
    { file: LIST, site: 'handleTypeAhead: focusIndex(idx, true)',         move: 'type-ahead',                         axis: 'y', run: listKey(3, element => press(element, 'z')) },
    // AbstractSelectableList.revealFocusedRow: the keyboard context menu.
    { file: LIST, site: 'revealFocusedRow: scrollIndexIntoView(idx, true)', move: 'Shift+F10',                        axis: 'y', run: listKey(3, element => shiftF10(element)) },

    // Body.onKeyDown: the row keys.
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'ArrowDown',            axis: 'y', run: bodyMove(0, bodyKey('ArrowDown')) },
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'ArrowUp',              axis: 'y', run: bodyMove(0, bodyKey('ArrowUp')) },
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'Home',                 axis: 'y', run: bodyMove(0, bodyKey('Home')) },
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'End',                  axis: 'y', run: bodyMove(0, bodyKey('End')) },
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'PageDown',             axis: 'y', run: bodyMove(0, bodyKey('PageDown')) },
    { file: BODY, site: 'onKeyDown, row keys: scrollRecordIntoView(newAnchor)',         move: 'PageUp',               axis: 'y', run: bodyMove(0, bodyKey('PageUp')) },
    // Body.onKeyDown: the column keys, and the two keys that enter an edit.
    { file: BODY, site: 'onKeyDown, ArrowLeft / ArrowRight: scrollColumnIntoView',      move: 'ArrowRight',           axis: 'x', run: bodyMove(1, bodyKey('ArrowRight')) },
    { file: BODY, site: 'onKeyDown, ArrowLeft / ArrowRight: scrollColumnIntoView',      move: 'ArrowLeft',            axis: 'x', run: bodyMove(2, bodyKey('ArrowLeft')) },
    { file: BODY, site: 'onKeyDown, Enter / Space: scrollColumnIntoView',               move: 'Enter',                axis: 'x', run: bodyMove(2, beforeEditEntry(bodyKey('Enter'))) },
    { file: BODY, site: 'onKeyDown, Enter / Space: scrollColumnIntoView',               move: 'Space',                axis: 'x', run: bodyMove(2, beforeEditEntry(bodyKey(' '))) },
    // Body.navigateFromEditingCell: the keys an editing cell hands back.
    { file: BODY, site: 'navigateFromEditingCell, rows: scrollRecordIntoView(newAnchor)',   move: 'Enter in an editing cell',          axis: 'y', run: bodyMove(0, body => body.navigateFromEditingCell('down')) },
    { file: BODY, site: 'navigateFromEditingCell, rows: scrollRecordIntoView(newAnchor)',   move: 'Shift+Enter in an editing cell',    axis: 'y', run: bodyMove(0, body => body.navigateFromEditingCell('up')) },
    { file: BODY, site: 'navigateFromEditingCell, rows: scrollRecordIntoView(newAnchor)',   move: 'PageDown in an editing cell',       axis: 'y', run: bodyMove(0, body => body.navigateFromEditingCell('pagedown')) },
    { file: BODY, site: 'navigateFromEditingCell, columns: scrollColumnIntoView',          move: 'Tab',                               axis: 'x', run: bodyMove(1, beforeEditEntry(bodyKey('Tab'))) },
    { file: BODY, site: 'navigateFromEditingCell, columns: scrollColumnIntoView',          move: 'Shift+Tab',                         axis: 'x', run: bodyMove(2, beforeEditEntry(bodyKey('Tab', true))) },
    // Body.revealFocusedCell: the keyboard context menu shows the row and the column.
    { file: BODY, site: 'revealFocusedCell: scrollRowIntoView(index, true)',            move: 'Shift+F10 (the row)',    axis: 'y', run: bodyMove(2, body => shiftF10(body.getElement())) },
    { file: BODY, site: 'revealFocusedCell: scrollColumnIntoView',                      move: 'Shift+F10 (the column)', axis: 'x', run: bodyMove(2, body => shiftF10(body.getElement())) },
    // Body.wireRowCells: a cell that opens its editor shows its column first.
    { file: BODY, site: 'wireRowCells, scroll-into-view handler: scrollColumnIntoView', move: 'a cell opening its editor', axis: 'x', run: bodyMove(2, body => body.resolveFocusedCell()._scrollIntoView()) },

    // Body.scrollRecordIntoView: the one place every row reveal of a table
    // goes through.
    { file: BODY, site: 'scrollRecordIntoView: scrollRowIntoView(indexOf(record), true)', move: 'ArrowDown, through scrollRecordIntoView', axis: 'y', run: bodyMove(0, bodyKey('ArrowDown')) },

    // TreeBody.moveFocusTo.
    { file: TBODY, site: 'moveFocusTo: scrollRecordIntoView(record)',     move: 'ArrowLeft to the parent row',        axis: 'y', run: treeBodyArrowLeft },
];

// How the source spells a call that takes the outward step. One pattern for
// all four files:
//
//   - a call of one of the reveal methods with a literal `true` as its last
//     argument, whatever the other arguments are (one level of nested
//     parentheses is followed, as in `indexOf(record)`);
//   - a call of the table body's `scrollRecordIntoView` or
//     `scrollColumnIntoView`, which have no flag and always take the step;
//   - a direct call of the broker.
//
// The count sees these spellings and no others. A call that passes the flag
// in a variable, or one in a fifth file, is not counted: the methods that
// forward their own `around` argument are of that kind, and are not call
// sites.
const ARGUMENTS    = String.raw`(?:[^()]|\([^()]*\))*`;
const SITE_PATTERN = new RegExp(
    String.raw`\b(?:_selectAtIndex|_extendSelectionTo|_scrollIntoView|scrollRowIntoView|scrollIndexIntoView|focusIndex|revealSpan)\(${ARGUMENTS},\s*true\)`
    + String.raw`|this\.(?:scrollRecordIntoView|scrollColumnIntoView)\(`
    + String.raw`|FocusReveal\.revealRectAround\(`,
    'g',
);

const SOURCE_FILES: SourceFile[] = [TREE, LIST, BODY, TBODY];

beforeEach(() => {
    installTestDOM(CONFIG);

    frames = [];
    built  = [];

    // A scrolling panel schedules a follow-up layout frame. Capture it, so a
    // case can run it by hand and the teardown can drain what is left.
    vi.spyOn(DOM.sink, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
        frames.push(callback);

        return frames.length;
    });
});

afterEach(() => {
    drainFrames();

    vi.restoreAllMocks();

    // A scrolling panel stays in the reveal registry until it is disposed, and
    // the next test's fresh handle table reuses its element's number.
    for (const component of built) {
        component.dispose();
    }

    DOM.reset();
});

describe('A keyboard move scrolls the page around the component', () => {
    for (const row of SITES) {
        it(`${row.file.split('/').pop()} — ${row.move} [${row.site}]`, async () => {
            const outer = await row.run();

            // The component was wholly outside the page's view along this
            // axis, so the page has to have moved towards it, inside the call.
            const moved = row.axis === 'y' ? outer.getScrollTop() : outer.getScrollLeft();

            expect(moved).toBeGreaterThan(0);
            expect(row.axis === 'y' ? DOM.source.getScrollTop(scroller(outer)) : DOM.source.getScrollLeft(scroller(outer))).toBe(moved);
        });
    }
});

describe('The table of keyboard call sites is complete', () => {
    for (const file of SOURCE_FILES) {
        it(`${file} has a row for each of its call sites`, () => {
            const source = librarySourceText(file);
            const found  = source.match(SITE_PATTERN) ?? [];
            const rows   = new Set(SITES.filter(row => row.file === file).map(row => row.site));

            // A call site added to the source needs a row in `SITES`, with a
            // `site` of its own; one removed takes its rows with it.
            expect(rows.size).toBe(found.length);
        });
    }
});
