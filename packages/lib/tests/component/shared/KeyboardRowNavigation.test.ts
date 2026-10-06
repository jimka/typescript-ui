// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The row keys of the widgets that hold DOM focus on their own element and
// move a current row: `PageUp` / `PageDown` in a `Tree`, and the paging a
// `TreeTable` inherits from the table body. Cases follow the
// `## Expected Behaviour` tables of plans/implemented/tree-page-keys.md:
// P = paging, S = paging with Shift, E = edges, TT = TreeTable.
//
// Every case but E9 dispatches real `keydown` events through `Event`'s
// window-level handlers (`DOM.sink.dispatchEvent`), so a case can count the
// `preventDefault` calls a press made and show that an ancestor still hears
// the key. `Event` keeps its registrations in module-level state that
// outlives `DOM.reset()`, and attaches a window listener only when a type is
// first registered, so a registration left behind by one test would make the
// next test's dispatches silently vanish. The teardown therefore disposes
// every component a test built and stops the two static watches (see the
// header of `KeyboardContextMenu.test.ts`, whose harness this file copies).
//
// The modelled DOM has no layout engine. A widget's viewport height comes from
// its committed size, and the row height is the widget's own fixed default,
// so every expected scroll position below is arithmetic on those two numbers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Event } from '~/core/Event';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { SpatialNavigation } from '~/core/SpatialNavigation';
import { _Tree } from '~/component/tree/Tree';
import type { TreeNode } from '~/component/tree/TreeNode';
import { TreeBody } from '~/component/table/TreeBody';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { installTestDOM, makeEvent, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Modifier keys held during a press. */
interface Modifiers {
    shiftKey?: boolean;
}

const SHIFT: Modifiers = { shiftKey: true };

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
 * @returns How many times the event's `preventDefault` ran.
 */
function press(el: Handle, key: string, init: Modifiers = {}): number {
    const event  = makeEvent(el, 'keydown', { key, ...init });
    let prevents = 0;

    (event as unknown as { preventDefault: () => void }).preventDefault = () => { prevents += 1; };

    DOM.sink.dispatchEvent(el, event);

    return prevents;
}

/**
 * The whole numbers from `first` to `last`, both included.
 *
 * @param first - The first number.
 * @param last - The last number.
 * @returns The numbers in ascending order.
 */
function range(first: number, last: number): number[] {
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
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

describe('Keyboard row navigation — Tree', () => {
    const NODE_COUNT  = 60;
    const TREE_WIDTH  = 200;
    // The tree's row height: `Tree`'s own default, restated here so every
    // expected scroll position is derived from the contract, not read back.
    const ROW_HEIGHT  = 24;
    // Five rows at that row height, so a page is five rows.
    const TREE_HEIGHT = 120;
    const PAGE        = TREE_HEIGHT / ROW_HEIGHT;
    // A label wider than the tree, as `Tree.test.ts` uses to raise the
    // horizontal scrollbar.
    const WIDE_LABEL  = 'Hello World Hello World Hello World Hello World Hello World';
    // The height the horizontal scrollbar's track takes out of the viewport.
    const SCROLLBAR_TRACK = 12;

    /** A mounted tree and the readers the cases assert through. */
    interface MountedTree {
        tree: _Tree;
        el:   Handle;
        /** The test's own copy of the root nodes, in their original order. */
        all:  TreeNode[];
        /** Index of the current row in `all`; -1 when there is none. */
        current(): number;
        /** Indices in `all` of the selected nodes, ascending. */
        selection(): number[];
        /** Index in `all` of the anchor; `null` when there is none. */
        anchor(): number | null;
        /** The scroller's vertical scroll position. */
        scrollY(): number;
        /** Labels of the selected nodes, in the order `labels` lists them. */
        selectedLabels(labels: string[]): string[];
        /** Label of the anchor; `null` when there is none. */
        anchorLabel(): string | null;
    }

    /**
     * Sixty leaf root nodes.
     *
     * @returns The nodes.
     */
    function sixtyNodes(): TreeNode[] {
        return Array.from({ length: NODE_COUNT }, (_, i) => ({ label: 'Node ' + i }));
    }

    /**
     * Builds a tree, gives it a committed size, renders it and focuses it.
     *
     * @param nodes - The root nodes.
     * @param height - The tree's height.
     * @param expanded - Nodes to expand before the first render.
     * @param parent - A container to add the tree to; the caller tracks it,
     *   since disposing the parent disposes the tree.
     * @returns The tree and its readers.
     */
    function mountTree(nodes: TreeNode[], height: number = TREE_HEIGHT, expanded: TreeNode[] = [], parent?: Container): MountedTree {
        const all  = [...nodes];
        const tree = parent ? new _Tree() : track(new _Tree());

        if (parent) {
            parent.addComponent(tree);
            setConnected(parent.getElement(true)!, true);
        }

        const el = tree.getElement(true)!;

        setConnected(el, true);

        tree.setWidth(TREE_WIDTH);
        tree.setHeight(height);
        tree.setNodes(nodes);

        for (const node of expanded) {
            tree.expandNode(node);
        }

        (tree as any).renderWindow();

        DOM.sink.focus(el);

        return {
            tree,
            el,
            all,
            current: (): number => {
                const focusNode = (tree as any)._focusNode as TreeNode | null;

                return focusNode ? all.indexOf(focusNode) : -1;
            },
            selection: (): number[] => tree.getSelectedNodes().map(node => all.indexOf(node)).sort((a, b) => a - b),
            anchor:    (): number | null => {
                const anchorNode = tree.getSelectedNode();

                return anchorNode ? all.indexOf(anchorNode) : null;
            },
            scrollY:        (): number => (tree as any)._scroller.getScrollY(),
            selectedLabels: (labels: string[]): string[] => {
                const selected = new Set(tree.getSelectedNodes().map(node => node.label));

                return labels.filter(label => selected.has(label));
            },
            anchorLabel: (): string | null => tree.getSelectedNode()?.label ?? null,
        };
    }

    /**
     * Where the view must scroll to show `row` as its last whole row: what a
     * downward move onto a row below the view does.
     *
     * @param row - The landed row.
     * @param viewportHeight - The scroll viewport's height.
     * @returns The scroll position.
     */
    function scrollWithRowAtBottom(row: number, viewportHeight: number = TREE_HEIGHT): number {
        return (row + 1) * ROW_HEIGHT - viewportHeight;
    }

    /**
     * Where the view must scroll to show `row` as its first row: what an
     * upward move onto a row above the view does.
     *
     * @param row - The landed row.
     * @returns The scroll position.
     */
    function scrollWithRowAtTop(row: number): number {
        return row * ROW_HEIGHT;
    }

    /**
     * Counts the `"selection"` events `tree` fires from now on.
     *
     * @param tree - The tree.
     * @returns A reader for the count.
     */
    function countSelectionEvents(tree: _Tree): () => number {
        let events = 0;

        tree.on('selection', () => { events += 1; });

        return () => events;
    }

    /** The id of the pool row showing the tree's current row. */
    function currentRowId(tree: _Tree): string {
        return (tree as any)._focusPoolRow().getId();
    }

    describe('paging', () => {
        it('P1, P2, P5: PageDown and PageUp move the current row by one page, select it and reveal it', () => {
            const t      = mountTree(sixtyNodes());
            const events = countSelectionEvents(t.tree);

            const pressAndExpect = (key: string, row: number, scrollY: number): void => {
                expect(press(t.el, key)).toBe(1);

                expect(t.current()).toBe(row);
                expect(t.selection()).toEqual([row]);
                expect(t.anchor()).toBe(row);
                expect(t.scrollY()).toBe(scrollY);
                expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));
            };

            // P1. No current row: the first press lands on the first row.
            pressAndExpect('PageDown', 0, 0);
            pressAndExpect('PageDown', PAGE, scrollWithRowAtBottom(PAGE));
            pressAndExpect('PageDown', 2 * PAGE, scrollWithRowAtBottom(2 * PAGE));

            expect(events()).toBe(3);

            // P2.
            pressAndExpect('PageUp', PAGE, scrollWithRowAtTop(PAGE));
            pressAndExpect('PageUp', 0, 0);

            expect(events()).toBe(5);

            // Already on the first row: prevented, and nothing changes.
            pressAndExpect('PageUp', 0, 0);

            expect(events()).toBe(5);
        });

        it('P3, P5: PageDown on the last row is prevented and changes nothing; PageUp then moves up one page', () => {
            const t    = mountTree(sixtyNodes());
            const last = NODE_COUNT - 1;

            press(t.el, 'End');

            expect(t.current()).toBe(last);
            expect(t.scrollY()).toBe(scrollWithRowAtBottom(last));

            const events = countSelectionEvents(t.tree);

            expect(press(t.el, 'PageDown')).toBe(1);

            expect(t.current()).toBe(last);
            expect(t.selection()).toEqual([last]);
            expect(t.scrollY()).toBe(scrollWithRowAtBottom(last));
            expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));
            expect(events()).toBe(0);

            expect(press(t.el, 'PageUp')).toBe(1);

            expect(t.current()).toBe(last - PAGE);
            expect(t.selection()).toEqual([last - PAGE]);
            expect(t.scrollY()).toBe(scrollWithRowAtTop(last - PAGE));
            expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));
            expect(events()).toBe(1);
        });

        it('P4, P5: PageUp with no current row lands on the first row', () => {
            const t      = mountTree(sixtyNodes());
            const events = countSelectionEvents(t.tree);

            expect(press(t.el, 'PageUp')).toBe(1);

            expect(t.current()).toBe(0);
            expect(t.selection()).toEqual([0]);
            expect(t.scrollY()).toBe(0);
            expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));
            expect(events()).toBe(1);
        });
    });

    describe('paging with Shift', () => {
        it('S1, S2, S3: Shift+PageDown and Shift+PageUp move the focus end of the range by a page; a plain page key ends it', () => {
            const t      = mountTree(sixtyNodes());
            const anchor = 2;

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(t.current()).toBe(anchor);
            expect(t.selection()).toEqual([anchor]);
            expect(t.scrollY()).toBe(0);

            const pressShiftAndExpect = (key: string, row: number, selection: number[], scrollY: number): void => {
                expect(press(t.el, key, SHIFT)).toBe(1);

                expect(t.current()).toBe(row);
                expect(t.selection()).toEqual(selection);
                expect(t.scrollY()).toBe(scrollY);
                expect(t.anchor()).toBe(anchor);
                expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));
            };

            // S1.
            pressShiftAndExpect('PageDown', anchor + PAGE, range(anchor, anchor + PAGE), scrollWithRowAtBottom(anchor + PAGE));
            pressShiftAndExpect('PageDown', anchor + 2 * PAGE, range(anchor, anchor + 2 * PAGE), scrollWithRowAtBottom(anchor + 2 * PAGE));

            // S2. The range shrinks back to the anchor, then grows upward and
            // clamps at the first row.
            pressShiftAndExpect('PageUp', anchor + PAGE, range(anchor, anchor + PAGE), scrollWithRowAtTop(anchor + PAGE));
            pressShiftAndExpect('PageUp', anchor, [anchor], scrollWithRowAtTop(anchor));
            pressShiftAndExpect('PageUp', 0, range(0, anchor), 0);

            // S3. A plain page key counts from the current row (0) and moves
            // the anchor with it.
            expect(press(t.el, 'PageDown')).toBe(1);

            expect(t.current()).toBe(PAGE);
            expect(t.selection()).toEqual([PAGE]);
            expect(t.scrollY()).toBe(scrollWithRowAtBottom(PAGE));
            expect(t.anchor()).toBe(PAGE);
        });
    });

    describe('edges', () => {
        it('E1: an empty tree leaves PageDown and PageUp alone', () => {
            const t      = mountTree([]);
            const events = countSelectionEvents(t.tree);

            expect(press(t.el, 'PageDown')).toBe(0);
            expect(press(t.el, 'PageUp')).toBe(0);

            expect(t.tree.getSelectedNodes()).toEqual([]);
            expect(events()).toBe(0);
        });

        it('E2: a tree shorter than a page clamps to its first and last row and never scrolls', () => {
            const t = mountTree([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(0);
            expect(t.scrollY()).toBe(0);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(2);
            expect(t.scrollY()).toBe(0);

            press(t.el, 'PageUp');

            expect(t.current()).toBe(0);
            expect(t.scrollY()).toBe(0);
        });

        it('E3: a tree lower than one row pages by one row', () => {
            // Less than one 24 px row.
            const t = mountTree(sixtyNodes(), 10);

            expect((t.tree as any).computePageSize()).toBe(1);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(0);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(1);
        });

        it('E4: a horizontal scrollbar takes its track out of the page', () => {
            const nodes: TreeNode[] = Array.from({ length: NODE_COUNT }, (_, i) => ({ label: i === 0 ? WIDE_LABEL : 'H' }));
            const t                 = mountTree(nodes);
            const viewportHeight    = TREE_HEIGHT - SCROLLBAR_TRACK;
            // Four whole rows fit in 108 px.
            const page              = 4;

            expect((t.tree as any)._scroller.getViewportHeight()).toBe(viewportHeight);
            expect((t.tree as any).computePageSize()).toBe(page);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(0);
            expect(t.scrollY()).toBe(0);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(page);
            expect(t.scrollY()).toBe(scrollWithRowAtBottom(page, viewportHeight));
        });

        it('E5: a key spatial navigation claims is left alone', () => {
            const t      = mountTree(sixtyNodes());
            const events = countSelectionEvents(t.tree);

            vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);

            expect(press(t.el, 'PageDown')).toBe(0);

            expect(t.current()).toBe(-1);
            expect(events()).toBe(0);
        });

        it('E6: the page is counted from the current row, not from the rows in view', () => {
            const t = mountTree(sixtyNodes());

            press(t.el, 'Home');

            // Row 25 at the top of the view: the current row is far above it.
            (t.tree as any).setScrollY(25 * ROW_HEIGHT);

            press(t.el, 'PageDown');

            expect(t.current()).toBe(PAGE);
            expect(t.scrollY()).toBe(scrollWithRowAtTop(PAGE));
        });

        it('E7: a page counts visible rows at any depth', () => {
            const children          = Array.from({ length: 4 }, (_, i) => ({ label: 'a' + i }));
            const nodes: TreeNode[] = [{ label: 'A', children }, { label: 'B' }, { label: 'C' }, { label: 'D' }];
            // Eight visible rows: A, a0–a3, B, C, D. Five per page.
            const t                 = mountTree(nodes, TREE_HEIGHT, [nodes[0]]);
            const labels            = ['A', 'a0', 'a1', 'a2', 'a3', 'B', 'C', 'D'];

            press(t.el, 'ArrowDown');

            expect(t.selectedLabels(labels)).toEqual(['A']);

            press(t.el, 'PageDown');

            expect(t.selectedLabels(labels)).toEqual(['B']);

            press(t.el, 'PageDown');

            expect(t.selectedLabels(labels)).toEqual(['D']);
        });

        it('E8: a handled key is prevented and never stopped — an ancestor still hears it, also at the last row', () => {
            const parent          = track(new Container());
            const t               = mountTree(sixtyNodes(), TREE_HEIGHT, [], parent);
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            expect(press(t.el, 'PageDown')).toBe(1);
            expect(press(t.el, 'End')).toBe(1);
            // On the last row: nothing moves, and the key is still the tree's.
            expect(press(t.el, 'PageDown')).toBe(1);

            expect(heard).toEqual(['PageDown', 'End', 'PageDown']);

            Event.removeSubtreeListener(parent, 'keydown', spy);
        });

        it('E9: a tree that was never rendered pages by one row', () => {
            // No scroller yet, so there is no viewport to count rows in.
            const tree              = track(new _Tree());
            const nodes: TreeNode[] = Array.from({ length: 10 }, (_, i) => ({ label: 'n' + i }));

            tree.setNodes(nodes);

            expect((tree as any).computePageSize()).toBe(1);

            (tree as any)._onKeyDown({ key: 'PageDown', shiftKey: false });

            expect(tree.getSelectedNodes()).toEqual([nodes[0]]);

            (tree as any)._onKeyDown({ key: 'PageDown', shiftKey: false });

            expect(tree.getSelectedNodes()).toEqual([nodes[1]]);
        });

        it('an empty tree leaves the page keys for its ancestors: not prevented, and heard', () => {
            const parent          = track(new Container());
            const t               = mountTree([], TREE_HEIGHT, [], parent);
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            expect(press(t.el, 'PageDown')).toBe(0);
            expect(press(t.el, 'PageUp')).toBe(0);

            expect(heard).toEqual(['PageDown', 'PageUp']);

            Event.removeSubtreeListener(parent, 'keydown', spy);
        });
    });
});

describe('Keyboard row navigation — TreeTable', () => {
    const RECORD_COUNT  = 60;
    const BODY_WIDTH    = 300;
    const BODY_HEIGHT   = 100;
    const COLUMN_WIDTHS = [100, 100, 100];
    // The table body's row height offline: its own default, restated here so
    // the expected scroll positions are derived from the contract.
    const ROW_HEIGHT    = 20;
    // What the body's scroller leaves of its 100 px once the horizontal
    // scrollbar's 12 px track is taken out.
    const VIEWPORT_HEIGHT = 88;
    // Four whole 20 px rows fit in 88 px.
    const PAGE          = 4;
    // Indent width in px per depth level; any value does, the records are
    // all roots.
    const INDENT_PX     = 16;

    /** A mounted tree-table body and the readers the cases assert through. */
    interface MountedBody {
        body: TreeBody;
        el:   Handle;
        /** Index of the selected record among the visible ones; -1 when none. */
        current(): number;
        /** The scroller's vertical scroll position. */
        scrollY(): number;
    }

    /**
     * Builds a tree-table body of sixty root records, renders it and focuses it.
     *
     * @returns The body and its readers.
     */
    function mountBody(): MountedBody {
        const model = new Model([
            { name: 'id',     type: 'number', order: 0 },
            { name: 'parent', type: 'number', order: 1 },
            { name: 'name',   type: 'string', order: 2 },
        ], 'id');
        const store = new MemoryStore(model, []);

        store.loadData(Array.from({ length: RECORD_COUNT }, (_, i) => ({ id: i + 1, parent: null, name: 'r' + i })));

        const body = track(new TreeBody(store, { idField: 'id', parentField: 'parent', treeColumn: 'name', indentPx: INDENT_PX }));
        const el   = body.getElement(true)!;

        setConnected(el, true);
        body.setWidth(BODY_WIDTH);
        body.setHeight(BODY_HEIGHT);
        (body as any).renderWindow(BODY_WIDTH, COLUMN_WIDTHS);
        DOM.sink.focus(el);

        return {
            body,
            el,
            current: (): number => (body as any).getVisibleRecords().indexOf(body.getSelectedRecord()),
            scrollY: (): number => (body as any)._scroller.getScrollY(),
        };
    }

    it('TT1: a page is the whole rows the body\'s viewport shows', () => {
        const b = mountBody();

        expect((b.body as any)._scroller.getViewportHeight()).toBe(VIEWPORT_HEIGHT);
        expect((b.body as any).computePageSize()).toBe(PAGE);
    });

    it('TT2: PageDown and PageUp move the current row by one page and reveal it', () => {
        const b = mountBody();

        press(b.el, 'ArrowDown');

        expect(b.current()).toBe(0);

        press(b.el, 'PageDown');

        expect(b.current()).toBe(PAGE);
        expect(b.scrollY()).toBe((PAGE + 1) * ROW_HEIGHT - VIEWPORT_HEIGHT);

        press(b.el, 'PageDown');

        expect(b.current()).toBe(2 * PAGE);
        expect(b.scrollY()).toBe((2 * PAGE + 1) * ROW_HEIGHT - VIEWPORT_HEIGHT);

        press(b.el, 'PageUp');

        expect(b.current()).toBe(PAGE);
        expect(b.scrollY()).toBe(PAGE * ROW_HEIGHT);
    });

    it('TT3, TT4: PageDown on the last row is prevented and changes nothing; Shift+PageUp selects one row', () => {
        const b    = mountBody();
        const last = RECORD_COUNT - 1;

        expect(press(b.el, 'End')).toBe(1);

        expect(b.current()).toBe(last);

        expect(press(b.el, 'PageDown')).toBe(1);

        expect(b.current()).toBe(last);

        // TT4. Shift does not extend in a table body.
        press(b.el, 'PageUp', SHIFT);

        expect(b.current()).toBe(last - PAGE);
        expect(b.body.getSelectedRecords()).toHaveLength(1);
    });
});
