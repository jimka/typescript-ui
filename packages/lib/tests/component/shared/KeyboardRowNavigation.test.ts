// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The row keys of the widgets that hold DOM focus on their own element and
// move a current row: `PageUp` / `PageDown` in a `Tree`, the `Shift` range a
// tree key extends, and the paging a `TreeTable` inherits from the table
// body. Cases follow the `## Expected Behaviour` tables of
// plans/implemented/tree-page-keys.md: P = paging, S = paging with Shift,
// E = edges, A = a Shift move with no anchor, TT = TreeTable.
//
// Every key press but E9's is a real `keydown` event dispatched through
// `Event`'s window-level handlers (`DOM.sink.dispatchEvent`), so a case can
// count the `preventDefault` calls a press made and show that an ancestor
// still hears the key. E9's tree is never rendered, and the Shift-click
// cases hand a click event to the tree's click handler, as `Tree.test.ts`
// does. `Event` keeps its registrations in module-level state that
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
import type { TreeOptions } from '~/component/tree/Tree';
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

/** Modifier keys held during a press or a click. */
interface Modifiers {
    shiftKey?: boolean;
    ctrlKey?:  boolean;
}

const SHIFT: Modifiers      = { shiftKey: true };
const SHIFT_CTRL: Modifiers = { shiftKey: true, ctrlKey: true };

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
    // Rows in the long fixture: twelve pages, so a page move has room in both
    // directions and the first and last rows are far apart.
    const NODE_COUNT  = 60;
    // Wide enough for every short label, so only `WIDE_LABEL` raises the
    // horizontal scrollbar.
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
        /**
         * The user clicks the row showing `node`: a click event handed to
         * the tree's click handler, as `Tree.test.ts` does.
         */
        click(node: TreeNode, init?: Modifiers): void;
    }

    /**
     * Sixty leaf root nodes.
     *
     * @returns The nodes.
     */
    function sixtyNodes(): TreeNode[] {
        return Array.from({ length: NODE_COUNT }, (_, i) => ({ label: 'Node ' + i }));
    }

    /** How {@link mountTree} builds its tree; every member is optional. */
    interface TreeSetup {
        /** The tree's height. Five rows by default. */
        height?:   number;
        /** Nodes to expand before the first render. */
        expanded?: TreeNode[];
        /**
         * A container to add the tree to. The caller tracks it, since
         * disposing the parent disposes the tree.
         */
        parent?:   Container;
        /** Options for the tree's constructor. */
        options?:  TreeOptions;
    }

    /**
     * Builds a tree, gives it a committed size, renders it and focuses it.
     *
     * @param nodes - The root nodes.
     * @param setup - How to build the tree.
     * @returns The tree and its readers.
     */
    function mountTree(nodes: TreeNode[], setup: TreeSetup = {}): MountedTree {
        const { height = TREE_HEIGHT, expanded = [], parent, options } = setup;
        const all  = [...nodes];
        const tree = parent ? new _Tree(options) : track(new _Tree(options));

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
            click:       (node: TreeNode, init: Modifiers = {}): void => {
                const row = (tree as any)._rowPool.find((poolRow: any) => poolRow.getNode() === node);

                (tree as any)._handleClick(makeEvent(row.getElement(), 'click', init));
            },
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
            const t = mountTree(sixtyNodes(), { height: 10 });

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
            const t                 = mountTree(nodes, { expanded: [nodes[0]] });
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
            const t               = mountTree(sixtyNodes(), { parent });
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            try {
                expect(press(t.el, 'PageDown')).toBe(1);
                expect(press(t.el, 'End')).toBe(1);
                // On the last row: nothing moves, and the key is still the tree's.
                expect(press(t.el, 'PageDown')).toBe(1);

                expect(heard).toEqual(['PageDown', 'End', 'PageDown']);
            } finally {
                Event.removeSubtreeListener(parent, 'keydown', spy);
            }
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
            const t               = mountTree([], { parent });
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            try {
                expect(press(t.el, 'PageDown')).toBe(0);
                expect(press(t.el, 'PageUp')).toBe(0);

                expect(heard).toEqual(['PageDown', 'PageUp']);
            } finally {
                Event.removeSubtreeListener(parent, 'keydown', spy);
            }
        });
    });

    describe('a Shift move with no anchor', () => {
        it('A1: Shift+ArrowDown on a fresh tree starts a range at its first move', () => {
            const t      = mountTree(sixtyNodes());
            const events = countSelectionEvents(t.tree);

            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([0]);
            expect(t.anchor()).toBe(0);

            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([0, 1]);
            expect(t.anchor()).toBe(0);

            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([0, 1, 2]);
            expect(t.anchor()).toBe(0);

            expect(events()).toBe(3);
        });

        it('A2: Shift+PageDown on a fresh tree starts a range at its first move', () => {
            const t = mountTree(sixtyNodes());

            press(t.el, 'PageDown', SHIFT);

            expect(t.selection()).toEqual([0]);
            expect(t.anchor()).toBe(0);

            press(t.el, 'PageDown', SHIFT);

            expect(t.selection()).toEqual(range(0, PAGE));
            expect(t.anchor()).toBe(0);
        });

        it('A3: Shift+End on a fresh tree is a plain End', () => {
            const t    = mountTree(sixtyNodes());
            const last = NODE_COUNT - 1;

            press(t.el, 'End', SHIFT);

            expect(t.selection()).toEqual([last]);
            expect(t.anchor()).toBe(last);
        });

        // The rule lives in the one method every Shift key shares, so each
        // of the six is pinned: the first Shift press on a fresh tree is a
        // plain move whose row becomes the anchor, and the second extends
        // from it.
        const last = NODE_COUNT - 1;

        it.each([
            // first key, where it lands, second key, the range the two leave
            { first: 'ArrowDown', landsOn: 0,    second: 'ArrowDown', extended: range(0, 1) },
            { first: 'ArrowUp',   landsOn: 0,    second: 'ArrowDown', extended: range(0, 1) },
            { first: 'Home',      landsOn: 0,    second: 'End',       extended: range(0, last) },
            { first: 'End',       landsOn: last, second: 'ArrowUp',   extended: range(last - 1, last) },
            { first: 'End',       landsOn: last, second: 'Home',      extended: range(0, last) },
            { first: 'PageDown',  landsOn: 0,    second: 'PageDown',  extended: range(0, PAGE) },
            { first: 'PageUp',    landsOn: 0,    second: 'PageDown',  extended: range(0, PAGE) },
            { first: 'End',       landsOn: last, second: 'PageUp',    extended: range(last - PAGE, last) },
        ])('Shift+$first then Shift+$second on a fresh tree: the first is a plain move, the second extends from it', ({ first, landsOn, second, extended }) => {
            const t      = mountTree(sixtyNodes());
            const events = countSelectionEvents(t.tree);

            expect(t.anchor()).toBeNull();

            expect(press(t.el, first, SHIFT)).toBe(1);

            expect(t.current()).toBe(landsOn);
            expect(t.selection()).toEqual([landsOn]);
            expect(t.anchor()).toBe(landsOn);

            expect(press(t.el, second, SHIFT)).toBe(1);

            expect(t.selection()).toEqual(extended);
            expect(t.anchor()).toBe(landsOn);
            expect(t.tree.getAria().getActiveDescendant()).toBe(currentRowId(t.tree));

            expect(events()).toBe(2);
        });

        it('A4: after the anchor\'s node is removed, the next Shift move is a plain move', () => {
            const t = mountTree(Array.from({ length: 10 }, (_, i) => ({ label: 'n' + i })));

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown', SHIFT);
            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([0, 1, 2]);
            expect(t.anchor()).toBe(0);

            t.tree.removeNode(t.all[0]);

            expect(t.tree.getSelectedNode()).toBeNull();
            expect(t.selection()).toEqual([1, 2]);

            // The current row is still `all[2]`, so the move lands on `all[3]`.
            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([3]);
            expect(t.anchor()).toBe(3);

            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selection()).toEqual([3, 4]);
            expect(t.anchor()).toBe(3);
        });

        it('A5: with the anchor hidden under a collapsed node, the next Shift move is a plain move', () => {
            const nodes: TreeNode[] = [{ label: 'A', children: [{ label: 'a0' }, { label: 'a1' }] }, { label: 'B' }, { label: 'C' }];
            const t                 = mountTree(nodes, { expanded: [nodes[0]] });
            const labels            = ['A', 'a0', 'a1', 'B', 'C'];

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(t.selectedLabels(labels)).toEqual(['a0']);
            expect(t.anchorLabel()).toBe('a0');

            // Collapse `A` from its caret: the anchor and the current row stay
            // on the hidden `a0`.
            (t.tree as any)._onToggle(nodes[0]);

            // No current row among the visible ones, so the move lands on the
            // first row.
            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['A']);
            expect(t.anchorLabel()).toBe('A');

            press(t.el, 'ArrowDown', SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['A', 'B']);
            expect(t.anchorLabel()).toBe('A');
        });

        it('a Shift-click with the anchor hidden under a collapsed node is a plain click: the clicked row becomes the anchor', () => {
            const nodes: TreeNode[] = [{ label: 'A', children: [{ label: 'a0' }, { label: 'a1' }] }, { label: 'B' }, { label: 'C' }];
            const t                 = mountTree(nodes, { expanded: [nodes[0]] });
            const labels            = ['A', 'a0', 'a1', 'B', 'C'];

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(t.anchorLabel()).toBe('a0');

            (t.tree as any)._onToggle(nodes[0]);

            t.click(nodes[2], SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['C']);
            expect(t.anchorLabel()).toBe('C');

            // The next Shift-click extends from it.
            t.click(nodes[0], SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['A', 'B', 'C']);
            expect(t.anchorLabel()).toBe('C');
        });

        it('a Shift+Ctrl-click with the anchor hidden under a collapsed node is a Ctrl-click: it toggles the row in the selection and makes it the anchor', () => {
            const nodes: TreeNode[] = [{ label: 'A', children: [{ label: 'a0' }, { label: 'a1' }] }, { label: 'B' }, { label: 'C' }];
            const t                 = mountTree(nodes, { expanded: [nodes[0]] });
            const labels            = ['A', 'a0', 'a1', 'B', 'C'];
            const events            = countSelectionEvents(t.tree);

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(t.selectedLabels(labels)).toEqual(['a0']);

            (t.tree as any)._onToggle(nodes[0]);

            // With no anchor to extend from, `Shift` is not there: the click
            // adds `C` to the selection and leaves the rest of it alone. That
            // rest is `a0`, still selected under the collapsed `A`; what a
            // collapse should leave selected is an open question the plan
            // lists under Non-Goals, and not what this case is about.
            t.click(nodes[2], SHIFT_CTRL);

            expect(t.selectedLabels(labels)).toEqual(['a0', 'C']);
            expect(t.anchorLabel()).toBe('C');

            // `C` is now a visible anchor, so `Shift` counts again and the
            // click replaces the selection with the range from it.
            t.click(nodes[1], SHIFT_CTRL);

            expect(t.selectedLabels(labels)).toEqual(['B', 'C']);
            expect(t.anchorLabel()).toBe('C');

            // Two presses, two clicks.
            expect(events()).toBe(4);
        });

        it('with expandTrigger "click", a Shift-click with the anchor hidden under a collapsed node toggles the row, as a plain click does', () => {
            const nodes: TreeNode[] = [
                { label: 'A', children: [{ label: 'a0' }, { label: 'a1' }] },
                { label: 'B', children: [{ label: 'b0' }] },
                { label: 'C' },
            ];

            const t      = mountTree(nodes, { expanded: [nodes[0]], options: { expandTrigger: 'click' } });
            const labels = ['A', 'a0', 'a1', 'B', 'b0', 'C'];

            const isExpanded = (node: TreeNode): boolean => t.tree.getExpandedNodes().includes(node);

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(t.anchorLabel()).toBe('a0');

            // Collapse `A` from its caret: the anchor stays on the hidden `a0`.
            (t.tree as any)._onToggle(nodes[0]);

            expect(isExpanded(nodes[1])).toBe(false);

            t.click(nodes[1], SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['B']);
            expect(t.anchorLabel()).toBe('B');
            expect(isExpanded(nodes[1])).toBe(true);

            // `B` is now a visible anchor, so the next Shift-click extends
            // from it and toggles nothing.
            t.click(nodes[0], SHIFT);

            expect(t.selectedLabels(labels)).toEqual(['A', 'B']);
            expect(t.anchorLabel()).toBe('B');
            expect(isExpanded(nodes[0])).toBe(false);
            expect(isExpanded(nodes[1])).toBe(true);
        });
    });
});

describe('Keyboard row navigation — TreeTable', () => {
    // Rows in the fixture: fifteen pages, so a page move has room in both
    // directions.
    const RECORD_COUNT  = 60;
    // The body's size and column widths are those of case TB2 in
    // `KeyboardContextMenu.test.ts`, whose fixture this one extends.
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
