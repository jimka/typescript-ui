// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Shift+F10 and the ContextMenu key on the widgets that hold DOM focus on
// their own element and mark their current row or cell with
// `aria-activedescendant`: `Tree`, `List` / `MultiSelectList`, and the table
// body behind `Table` and `TreeTable`. A browser sends a key-raised
// `contextmenu` to the focused element, so the event targets the widget
// itself; each widget then opens the menu for its current item. Cases follow
// the `## Expected Behaviour` tables of
// plans/implemented/table-tree-keyboard-context-menu.md: T = Tree, L = List,
// B = table body, TB = Table and TreeBody.
//
// Every case dispatches real events through `Event`'s window-level handlers
// (`DOM.sink.dispatchEvent`). `Event` keeps its registrations in module-level
// state that outlives `DOM.reset()`, and attaches a window listener only when
// a type is first registered, so a registration left behind by one test would
// make the next test's dispatches silently vanish. The teardown therefore
// disposes every component a test built and stops the two static watches (see
// the header of `tests/overlay/Menu.keyboardSession.test.ts`).
//
// The modelled DOM computes `getViewportRect(component)` from component
// positions and leaves out the virtual scroller's row offset, so the widget
// cases assert the menu point against that same call ("the menu point of X")
// and never against a hand-computed pixel value. The arithmetic itself is
// pinned by R3 and R4 in `resolveContextMenuTarget.test.ts`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Util } from '~/core/Util';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { _List } from '~/component/list/List';
import { _MultiSelectList } from '~/component/list/MultiSelectList';
import { Body } from '~/component/table/Body';
import { TreeBody } from '~/component/table/TreeBody';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import type { ModelRecord } from '~/data/ModelRecord';
import { LayerManager } from '~/core/LayerManager';
import { installTestDOM, makeEvent, setConnected, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// `MouseEvent.button` of the secondary (right) button, per the UI Events
// specification: what the synthetic event carries, and what a right-click's
// `pointerdown` carries.
const SECONDARY_BUTTON = 2;

// Where a dispatched `contextmenu` says the pointer is. Chromium reports the
// centre of the focused element for a key-raised event; the exact value is
// arbitrary here, and only has to differ from every menu point so a result
// that kept it is told apart from one that moved to the current item.
const EVENT_X = 100;
const EVENT_Y = 60;

/** A viewport point. */
interface Point {
    x: number;
    y: number;
}

/** What one `contextmenu` dispatch did. */
interface Dispatch {
    /** The dispatched event. */
    event: MouseEvent;
    /** How many times its `preventDefault` ran. */
    prevents: number;
}

let built: Component[];

/**
 * Registers `component` for disposal in the teardown.
 *
 * @param component - The component a test built.
 * @returns The same component.
 */
function track<T extends Component>(component: T): T {
    built.push(component);

    return component;
}

/**
 * The user presses a key while `el` has focus: a real `keydown` there.
 *
 * @param el - The focused element.
 * @param key - The key pressed.
 * @param init - Modifier keys held.
 */
function press(el: Handle, key: string, init: { shiftKey?: boolean; ctrlKey?: boolean } = {}): void {
    DOM.sink.dispatchEvent(el, makeEvent(el, 'keydown', { key, ...init }));
}

/** The user presses Shift+F10 while `el` has focus. */
function shiftF10(el: Handle): void {
    press(el, 'F10', { shiftKey: true });
}

/** The user presses the right mouse button on `el`. */
function pointerInput(el: Handle): void {
    DOM.sink.dispatchEvent(el, makeEvent(el, 'pointerdown', { button: SECONDARY_BUTTON }));
}

/**
 * Dispatches a `contextmenu` event at `target` and counts its
 * `preventDefault` calls.
 *
 * @param target - The element the event targets.
 * @returns The dispatched event and the count.
 */
function contextMenu(target: Handle): Dispatch {
    const event    = makeEvent(target, 'contextmenu', { clientX: EVENT_X, clientY: EVENT_Y }) as MouseEvent;
    const dispatch = { event, prevents: 0 };

    (event as unknown as { preventDefault: () => void }).preventDefault = () => { dispatch.prevents += 1; };

    DOM.sink.dispatchEvent(target, event);

    return dispatch;
}

/**
 * The menu point of `item` in `owner`: the item's bottom-left corner, each
 * coordinate clamped to the owner's own box.
 *
 * @param item - The component the menu opens under.
 * @param owner - The widget.
 * @returns The point, in viewport coordinates.
 */
function menuPoint(item: Component, owner: Component): Point {
    const itemRect  = DOM.source.getViewportRect(item);
    const ownerRect = DOM.source.getViewportRect(owner);

    return {
        x: Util.clamp(itemRect.left,   ownerRect.left, ownerRect.right),
        y: Util.clamp(itemRect.bottom, ownerRect.top,  ownerRect.bottom),
    };
}

/** How many synthetic mouse events the seam built. */
function createdMouseEvents(): number {
    return (DOM.sink as RecordingDOMSink).writes.filter(write => write.op === 'createMouseEvent').length;
}

beforeEach(() => {
    installTestDOM(CONFIG);

    built = [];
});

afterEach(() => {
    vi.restoreAllMocks();

    for (const component of built) {
        component.dispose();
    }

    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();

    DOM.reset();
});

describe('Keyboard context menu — Tree', () => {
    const NODE_COUNT  = 60;
    const TREE_WIDTH  = 200;
    // Five rows at the tree's 24 px row height.
    const TREE_HEIGHT = 120;
    // The tree's row height: `Tree`'s own default, restated here so T3's
    // expected scroll position is derived from the contract, not read back.
    const ROW_HEIGHT  = 24;

    /** One `"contextmenu"` emission. */
    interface Emission {
        node:  TreeNode;
        event: MouseEvent;
    }

    let tree: _Tree;
    let treeEl: Handle;
    let nodes: TreeNode[];
    let emissions: Emission[];

    /** The pool row currently showing `node`. */
    function rowShowing(node: TreeNode): any {
        return (tree as any)._rowPool.find((row: any, slot: number) => (tree as any)._boundIndices[slot] >= 0 && row.getNode() === node);
    }

    beforeEach(() => {
        nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({ label: 'Node ' + i }));
        tree  = track(new _Tree());

        treeEl = tree.getElement(true)!;
        setConnected(treeEl, true);

        tree.setWidth(TREE_WIDTH);
        tree.setHeight(TREE_HEIGHT);
        tree.setNodes(nodes);
        (tree as any).renderWindow();

        DOM.sink.focus(treeEl);

        emissions = [];
        tree.on('contextmenu', (node, event) => emissions.push({ node, event }));
    });

    it('T1: Shift+F10 fires "contextmenu" for the current row, with a synthetic event under it', () => {
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');
        shiftF10(treeEl);

        const dispatch = contextMenu(treeEl);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].node).toBe(nodes[2]);

        const point = menuPoint(rowShowing(nodes[2]).getRenderer(), tree);
        const event = emissions[0].event;

        expect(event).not.toBe(dispatch.event);
        expect(createdMouseEvents()).toBe(1);
        expect(event.type).toBe('contextmenu');
        expect(event.clientX).toBe(point.x);
        expect(event.clientY).toBe(point.y);
        expect(event.button).toBe(SECONDARY_BUTTON);
        expect(event.target).toBeNull();
        expect(dispatch.prevents).toBe(1);
    });

    it('T2: the ContextMenu key does the same', () => {
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ContextMenu');

        const dispatch = contextMenu(treeEl);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].node).toBe(nodes[2]);

        const point = menuPoint(rowShowing(nodes[2]).getRenderer(), tree);

        expect(emissions[0].event).not.toBe(dispatch.event);
        expect(emissions[0].event.clientX).toBe(point.x);
        expect(emissions[0].event.clientY).toBe(point.y);
        expect(dispatch.prevents).toBe(1);
    });

    it('T3: a current row scrolled out of view is scrolled back first', () => {
        press(treeEl, 'End');
        (tree as any).setScrollY(0);

        expect((tree as any)._scroller.getScrollY()).toBe(0);

        shiftF10(treeEl);
        contextMenu(treeEl);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].node).toBe(nodes[NODE_COUNT - 1]);
        expect((tree as any)._scroller.getScrollY()).toBe(NODE_COUNT * ROW_HEIGHT - TREE_HEIGHT);
    });

    it('T4: with no current row nothing fires and the event is left alone', () => {
        shiftF10(treeEl);

        const dispatch = contextMenu(treeEl);

        expect(emissions).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('T5: a right-click on the tree\'s empty area opens nothing for the current row', () => {
        press(treeEl, 'ArrowDown');
        pointerInput(treeEl);

        const dispatch = contextMenu(treeEl);

        expect(emissions).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('T6: an event that targets a row is for that row, with the event itself', () => {
        press(treeEl, 'ArrowDown');
        shiftF10(treeEl);

        const dispatch = contextMenu(rowShowing(nodes[4]).getElement());

        expect(emissions).toHaveLength(1);
        expect(emissions[0].node).toBe(nodes[4]);
        expect(emissions[0].event).toBe(dispatch.event);
        expect(createdMouseEvents()).toBe(0);
        expect(dispatch.prevents).toBe(1);
    });

    it('T7: the keyboard menu leaves the selection alone', () => {
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown');

        const before    = tree.getSelectedNodes();
        const selection = vi.fn();

        tree.on('selection', selection);

        shiftF10(treeEl);
        contextMenu(treeEl);

        expect(emissions).toHaveLength(1);
        expect(tree.getSelectedNodes()).toEqual(before);
        expect(selection).not.toHaveBeenCalled();
    });

    it('T8: with a multi-selection the menu is for the focus row, and the selection is kept', () => {
        press(treeEl, 'ArrowDown');
        press(treeEl, 'ArrowDown', { shiftKey: true });
        press(treeEl, 'ArrowDown', { shiftKey: true });
        shiftF10(treeEl);
        contextMenu(treeEl);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].node).toBe(nodes[2]);
        expect(tree.getSelectedNodes()).toHaveLength(3);
    });
});

describe('Keyboard context menu — List and MultiSelectList', () => {
    const FRUITS      = ['Apple', 'Banana', 'Cherry', 'Date'];
    const LIST_WIDTH  = 200;
    const LIST_HEIGHT = 200;

    /** One `"contextmenu"` emission. */
    interface Emission {
        index: number;
        event: MouseEvent;
    }

    let emissions: Emission[];

    /**
     * Mounts `list` at the fixture size, focuses it, and records its
     * `"contextmenu"` emissions.
     *
     * @param list - The list under test.
     * @returns The list's element.
     */
    function mount(list: _List | _MultiSelectList): Handle {
        track(list);

        const el = list.getElement(true)!;

        setConnected(el, true);
        list.setWidth(LIST_WIDTH);
        list.setHeight(LIST_HEIGHT);
        list.doLayout();

        DOM.sink.focus(el);

        list.on('contextmenu', (index, event) => emissions.push({ index, event }));

        return el;
    }

    /** The pool row at `index`. */
    function rowAt(list: _List | _MultiSelectList, index: number): Component {
        return (list as any)._rowPool[index];
    }

    beforeEach(() => {
        emissions = [];
    });

    it('L1: Shift+F10 fires "contextmenu" for the focused row, with a synthetic event under it', () => {
        const list = new _List({ items: FRUITS });
        const el   = mount(list);

        press(el, 'ArrowDown');
        press(el, 'ArrowDown');

        expect(list.getFocusedIndex()).toBe(1);

        shiftF10(el);

        const dispatch = contextMenu(el);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].index).toBe(1);

        const point = menuPoint(rowAt(list, 1), list);
        const event = emissions[0].event;

        expect(event).not.toBe(dispatch.event);
        expect(createdMouseEvents()).toBe(1);
        expect(event.type).toBe('contextmenu');
        expect(event.clientX).toBe(point.x);
        expect(event.clientY).toBe(point.y);
        expect(event.button).toBe(SECONDARY_BUTTON);
        expect(event.target).toBeNull();
        expect(dispatch.prevents).toBe(1);
    });

    it('L2: with no focused row nothing fires and the event is left alone', () => {
        const list = new _List({ items: FRUITS });
        const el   = mount(list);

        expect(list.getFocusedIndex()).toBe(-1);

        shiftF10(el);

        const dispatch = contextMenu(el);

        expect(emissions).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('L3: a right-click on the list\'s empty area opens nothing for the focused row', () => {
        const list = new _List({ items: FRUITS });
        const el   = mount(list);

        press(el, 'ArrowDown');
        pointerInput(el);

        const dispatch = contextMenu(el);

        expect(emissions).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('L4: in a MultiSelectList the menu is for the focused row, and the selection is kept', () => {
        const list = new _MultiSelectList({ items: FRUITS });
        const el   = mount(list);

        press(el, 'ArrowDown');
        press(el, 'ArrowDown', { shiftKey: true });
        press(el, 'ArrowDown', { ctrlKey: true });

        const before = list.getValue();

        expect(before).toEqual(['Apple', 'Banana']);

        shiftF10(el);
        contextMenu(el);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].index).toBe(2);
        expect(list.getValue()).toEqual(before);
    });

    it('L5: an event that targets a row is for that row, with the event itself', () => {
        const list = new _List({ items: FRUITS });
        const el   = mount(list);

        shiftF10(el);

        const dispatch = contextMenu(rowAt(list, 3).getElement()!);

        expect(emissions).toHaveLength(1);
        expect(emissions[0].index).toBe(3);
        expect(emissions[0].event).toBe(dispatch.event);
        expect(createdMouseEvents()).toBe(0);
    });

    it('L6: a disabled list fires nothing', () => {
        const list = new _List({ items: FRUITS });
        const el   = mount(list);

        press(el, 'ArrowDown');
        list.setEnabled(false);
        shiftF10(el);

        const dispatch = contextMenu(el);

        expect(emissions).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });
});

describe('Keyboard context menu — table body', () => {
    const RECORD_COUNT = 40;
    const BODY_WIDTH   = 300;
    const BODY_HEIGHT  = 100;
    // Three equal columns filling the body, injected as the column-width
    // cache the live-geometry render tier would fill in a browser.
    const COLUMN_WIDTHS = [100, 100, 100];

    const MODEL = new Model([
        { name: 'a', type: 'string', order: 0 },
        { name: 'b', type: 'string', order: 1 },
        { name: 'c', type: 'string', order: 2 },
    ], 'a');

    let body: Body;
    let bodyEl: Handle;
    let records: ModelRecord[];
    let points: Point[];

    /** The cell the body's keyboard focus is on. */
    function focusedCell(): Component {
        return (body as any).resolveFocusedCell();
    }

    /** Every clipboard write so far, oldest first. */
    function clipboardWrites(): string[] {
        return (DOM.sink as RecordingDOMSink).writes
            .filter(write => write.op === 'writeClipboardText')
            .map(write => write.args[0] as string);
    }

    beforeEach(async () => {
        const store = new MemoryStore(MODEL, Array.from({ length: RECORD_COUNT }, (_, r) => ({
            a: `a${r}`, b: `b${r}`, c: `c${r}`,
        })));

        await store.load();

        records = store.getAll();
        body    = track(new Body(store));

        bodyEl = body.getElement(true)!;
        setConnected(bodyEl, true);

        body.setWidth(BODY_WIDTH);
        body.setHeight(BODY_HEIGHT);
        (body as any).renderWindow(BODY_WIDTH, COLUMN_WIDTHS);

        DOM.sink.focus(bodyEl);

        points = [];
        body.on('cellcontextmenu', (x, y) => points.push({ x, y }));
    });

    it('B1: Shift+F10 fires "cellcontextmenu" for the focused cell, at the point under it', () => {
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowRight');
        shiftF10(bodyEl);

        const dispatch = contextMenu(bodyEl);

        expect(points).toEqual([menuPoint(focusedCell(), body)]);
        expect((body as any)._contextMenuCell).toEqual({ record: records[1], col: 1 });
        expect((body as any)._rangeAnchor).toBeNull();
        expect((body as any)._rangeFocus).toBeNull();
        expect(dispatch.prevents).toBe(1);
    });

    it('B2: with no focused cell nothing fires and the event is left alone', () => {
        shiftF10(bodyEl);

        const dispatch = contextMenu(bodyEl);

        expect(points).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('B3: a right-click on the body\'s empty area opens nothing for the focused cell', () => {
        press(bodyEl, 'ArrowDown');
        pointerInput(bodyEl);

        const dispatch = contextMenu(bodyEl);

        expect(points).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('B4: a focused row scrolled out of view is scrolled back first', () => {
        press(bodyEl, 'End');
        body.setScrollY(0);

        expect((body as any)._scroller.getScrollY()).toBe(0);

        shiftF10(bodyEl);
        contextMenu(bodyEl);

        expect(points).toHaveLength(1);
        expect((body as any)._contextMenuCell.record).toBe(records[RECORD_COUNT - 1]);
        expect((body as any)._scroller.getScrollY()).toBeGreaterThan(0);
    });

    it('B5: the focused column is scrolled into view too', () => {
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowRight');

        const scrollColumn = vi.spyOn(body as any, 'scrollColumnIntoView');

        shiftF10(bodyEl);
        contextMenu(bodyEl);

        expect(scrollColumn).toHaveBeenCalledWith(1);
    });

    it('B5b: a focused row an expand is still fading in is settled first, as for a keyboard row move', () => {
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowDown');

        const settle = vi.spyOn(body as any, 'settleRowMotionIfEntering');

        shiftF10(bodyEl);
        contextMenu(bodyEl);

        // The focused row is the second record: index 1 of the visible records.
        expect(settle).toHaveBeenCalledWith(1);
    });

    it('B6: a focused row that is no longer shown opens nothing', () => {
        press(bodyEl, 'ArrowDown');

        const anchor = records[0];

        body.setRowVisible(record => record !== anchor);
        shiftF10(bodyEl);

        const dispatch = contextMenu(bodyEl);

        expect(points).toHaveLength(0);
        expect(dispatch.prevents).toBe(0);
    });

    it('B7: the menu acts on the cell range when the focused cell is inside it, else on that cell', () => {
        (body as any)._rangeAnchor = { record: records[0], col: 0 };
        (body as any)._rangeFocus  = { record: records[2], col: 1 };

        // Focused cell: second record, column 1 — inside the range.
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowRight');
        shiftF10(bodyEl);
        contextMenu(bodyEl);
        body.copyContextMenuSelection();

        expect(clipboardWrites()).toEqual(['a0\tb0\na1\tb1\na2\tb2']);

        // Column 2 lies outside the range.
        press(bodyEl, 'ArrowRight');
        shiftF10(bodyEl);
        contextMenu(bodyEl);
        body.copyContextMenuSelection();

        expect(clipboardWrites()).toEqual(['a0\tb0\na1\tb1\na2\tb2', 'c1']);
    });
});

describe('Keyboard context menu — Table and TreeBody', () => {
    // The tree-table body's box and its three equal columns: any size that
    // shows all three records, as in the table-body cases above.
    const BODY_WIDTH    = 300;
    const BODY_HEIGHT   = 100;
    const COLUMN_WIDTHS = [100, 100, 100];
    // The indent per tree depth of `tests/component/table/TreeBody.test.ts`'s
    // fixture; every record here is a root, so no cell is indented by it.
    const INDENT_PX     = 16;

    it('TB1: Shift+F10 on a Table opens Cut / Copy / Paste for the focused cell and the menu takes the keyboard', async () => {
        const model = new Model([
            { name: 'a', type: 'string', order: 0 },
            { name: 'b', type: 'string', order: 1 },
        ], 'a');
        const store = new MemoryStore(model, [
            { a: 'a0', b: 'b0' },
            { a: 'a1', b: 'b1' },
            { a: 'a2', b: 'b2' },
        ]);

        await store.load();

        const table = track(new Table(store));

        table.getElement(true);

        const body   = (table as any)._body as Body;
        const bodyEl = body.getElement()!;
        const menu   = (table as any)._columnContextMenu as Menu;

        setConnected(table.getElement()!, true);
        setConnected(bodyEl, true);
        DOM.sink.focus(bodyEl);

        const show = vi.spyOn(Menu.prototype, 'show');

        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowDown');
        press(bodyEl, 'ArrowRight');
        shiftF10(bodyEl);
        contextMenu(bodyEl);

        expect(show).toHaveBeenCalledTimes(1);

        const rows = show.mock.calls[0][2] as { text?: string }[];

        expect(rows.map(row => row.text)).toEqual(['Cut', 'Copy', 'Paste']);
        expect(LayerManager.getTopLayer()).toBe(menu);
        expect(DOM.source.getActiveElement()).toBe(menu.getElement());

        // `Copy` is the second row.
        menu.focusItem(1);
        menu.activateFocused();

        const writes = (DOM.sink as RecordingDOMSink).writes.filter(write => write.op === 'writeClipboardText');

        expect(writes.map(write => write.args[0])).toEqual(['b1']);
        expect(DOM.source.getActiveElement()).toBe(bodyEl);
    });

    it('TB2: Shift+F10 on a TreeTable body fires "cellcontextmenu" for the focused cell', () => {
        const model = new Model([
            { name: 'id',     type: 'number', order: 0 },
            { name: 'parent', type: 'number', order: 1 },
            { name: 'name',   type: 'string', order: 2 },
        ], 'id');
        const store = new MemoryStore(model, []);

        store.loadData([
            { id: 1, parent: null, name: 'a' },
            { id: 2, parent: null, name: 'b' },
            { id: 3, parent: null, name: 'c' },
        ]);

        const treeBody = track(new TreeBody(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: INDENT_PX }));
        const el       = treeBody.getElement(true)!;

        setConnected(el, true);
        treeBody.setWidth(BODY_WIDTH);
        treeBody.setHeight(BODY_HEIGHT);
        (treeBody as any).renderWindow(BODY_WIDTH, COLUMN_WIDTHS);
        DOM.sink.focus(el);

        const points: Point[] = [];

        treeBody.on('cellcontextmenu', (x, y) => points.push({ x, y }));

        press(el, 'ArrowDown');
        shiftF10(el);

        const dispatch = contextMenu(el);

        expect(points).toHaveLength(1);
        expect(dispatch.prevents).toBe(1);
    });
});
