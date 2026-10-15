// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// The keys that act on a row of a collection widget: type-ahead in a `List`
// (L), and in a `Tree` type-ahead (T), `Enter` (N) and `*` (X). Cases follow
// the `## Expected Behaviour` tables of
// plans/in-progress/collection-widget-keyboard-gaps.md.
//
// Every key press is a real `keydown` event dispatched through `Event`'s
// window-level handlers (`DOM.sink.dispatchEvent`), so a case can count the
// `preventDefault` calls a press made and show that an ancestor still hears
// the key. `Event` keeps its registrations in module-level state that
// outlives `DOM.reset()`, and attaches a window listener only when a type is
// first registered, so a registration left behind by one test would make the
// next test's dispatches silently vanish. The teardown therefore disposes
// every component a test built and stops the two static watches (see the
// header of `KeyboardRowNavigation.test.ts`, whose harness this file copies).
//
// The modelled DOM has no layout engine: a widget's viewport height comes
// from its committed size and the row height is the widget's own default.
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
import { _List } from '~/component/list/List';
import type { SelectableListItem } from '~/component/list/AbstractSelectableList';
import { installTestDOM, makeEvent, setConnected } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** Keys held during a press, and whether it is an auto-repeat. */
interface Modifiers {
    shiftKey?: boolean;
    ctrlKey?:  boolean;
    altKey?:   boolean;
    metaKey?:  boolean;
    repeat?:   boolean;
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
 * Sets the clock the type-ahead helper reads.
 *
 * @param ms - The value `Date.now()` returns from now on.
 */
function clock(ms: number): void {
    vi.spyOn(Date, 'now').mockReturnValue(ms);
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

describe('Keyboard row actions — List type-ahead', () => {
    const LIST_SIZE = 200;
    const LIST4     = ['Apple', 'Banana', 'Blueberry', 'Cherry'];

    /**
     * Builds a list, gives it a committed size and focuses it.
     *
     * @param items - The list's items.
     * @param options - Extra list options.
     * @returns The list and its element.
     */
    function mountList(items: Array<string | SelectableListItem>, options: object = {}): { list: _List, el: Handle } {
        const list = track(new _List({ items, ...options }));
        const el   = list.getElement(true)!;

        setConnected(el, true);
        list.setWidth(LIST_SIZE);
        list.setHeight(LIST_SIZE);
        DOM.sink.focus(el);

        return { list, el };
    }

    it('L6: a letter moves the focus mark, is prevented and leaves the selection', () => {
        const { list, el } = mountList(LIST4);

        clock(1000);

        expect(press(el, 'b')).toBe(1);
        expect(list.getFocusedIndex()).toBe(1);
        expect(list.getSelectedIndex()).toBe(-1);
    });

    it('L7: Escape clears the buffer and is not prevented', () => {
        const { list, el } = mountList(['Apple', 'Banana', 'Blueberry', 'Lemon']);

        clock(1000);
        press(el, 'b');

        expect(list.getFocusedIndex()).toBe(1);

        expect(press(el, 'Escape')).toBe(0);

        clock(1100);
        press(el, 'l');

        expect(list.getFocusedIndex()).toBe(3);
    });

    it('L8: a read-only list and an empty list ignore the key', () => {
        const readOnly = mountList(LIST4, { readOnly: true });

        clock(1000);

        expect(press(readOnly.el, 'b')).toBe(0);
        expect(readOnly.list.getFocusedIndex()).toBe(-1);

        const empty = mountList([]);

        expect(press(empty.el, 'b')).toBe(0);
        expect(empty.list.getFocusedIndex()).toBe(-1);
    });

    it('L9: the host-forwarded path consumes a letter and refuses a chord', () => {
        const { list } = mountList(LIST4);

        clock(1000);

        expect(list.handleKey({ key: 'b', preventDefault() {} } as unknown as KeyboardEvent)).toBe(true);
        expect(list.handleKey({ key: 'b', ctrlKey: true, preventDefault() {} } as unknown as KeyboardEvent)).toBe(false);
    });
});

describe('Keyboard row actions — Tree', () => {
    // The tree's width and height, and its row height (`Tree`'s own default,
    // restated so every expected scroll position is derived from the
    // contract): five rows fit.
    const TREE_WIDTH  = 200;
    const TREE_HEIGHT = 120;
    const ROW_HEIGHT  = 24;

    /** A mounted tree and its element. */
    interface MountedTree {
        tree: _Tree;
        el:   Handle;
    }

    /** How {@link mountTree} builds its tree; every member is optional. */
    interface TreeSetup {
        /** The tree's height. Five rows by default. */
        height?:   number;
        /** Nodes to expand before the first render. */
        expanded?: TreeNode[];
        /** A container to add the tree to; the caller tracks it. */
        parent?:   Container;
        /** Options for the tree's constructor. */
        options?:  TreeOptions;
    }

    /**
     * Builds a tree, gives it a committed size, renders it and focuses it.
     *
     * @param nodes - The root nodes.
     * @param setup - How to build the tree.
     * @returns The tree and its element.
     */
    function mountTree(nodes: TreeNode[], setup: TreeSetup = {}): MountedTree {
        const { height = TREE_HEIGHT, expanded = [], parent, options } = setup;
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

        return { tree, el };
    }

    /**
     * Leaf root nodes with the given labels.
     *
     * @param labels - The labels, in order.
     * @returns The nodes.
     */
    function leaves(labels: string[]): TreeNode[] {
        return labels.map(label => ({ label }));
    }

    /**
     * The label of the tree's current row.
     *
     * @param tree - The tree.
     * @returns The label, or `null` when the tree has no current row.
     */
    function current(tree: _Tree): string | null {
        return ((tree as any)._focusNode as TreeNode | null)?.label ?? null;
    }

    /**
     * The labels of the visible rows, in order.
     *
     * @param tree - The tree.
     * @returns The labels.
     */
    function rows(tree: _Tree): string[] {
        return (tree as any)._flatRows.map((row: { node: TreeNode }) => row.node.label);
    }

    /**
     * The labels of the selected nodes.
     *
     * @param tree - The tree.
     * @returns The labels.
     */
    function selected(tree: _Tree): string[] {
        return tree.getSelectedNodes().map(node => node.label);
    }

    /**
     * The scroller's vertical scroll position.
     *
     * @param tree - The tree.
     * @returns The position in px.
     */
    function scrollY(tree: _Tree): number {
        return (tree as any)._scroller.getScrollY();
    }

    /**
     * Counts a tree event.
     *
     * @param tree - The tree.
     * @param event - The event to count.
     * @returns A function reading the count.
     */
    function counter(tree: _Tree, event: 'selection' | 'expand' | 'collapse'): () => number {
        let count = 0;

        // `on` is overloaded per event; one cast serves the union.
        (tree as unknown as { on(name: string, listener: () => void): unknown }).on(event, () => { count += 1; });

        return () => count;
    }

    // Seventeen leaf roots; `Aardvark` is last, so a wrap is observable.
    const FRUIT = [
        'Apple', 'Apricot', 'Banana', 'Blueberry', 'Cherry', 'Date', 'Elderberry', 'Fig',
        'Grape', 'Honeydew', 'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Aardvark',
    ];

    describe('type-ahead', () => {
        it('T1: a letter selects the next matching row, is prevented and fires "selection"', () => {
            const t         = mountTree(leaves(FRUIT));
            const selection = counter(t.tree, 'selection');

            clock(1000);

            expect(press(t.el, 'b')).toBe(1);
            expect(current(t.tree)).toBe('Banana');
            expect(selected(t.tree)).toEqual(['Banana']);
            expect(scrollY(t.tree)).toBe(0);
            expect(selection()).toBe(1);
            expect(t.tree.getAria().getActiveDescendant()).toBe((t.tree as any)._focusPoolRow().getId());
        });

        it('T2: the same letter again steps through the matches', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'b');
            clock(1100);
            press(t.el, 'b');

            expect(current(t.tree)).toBe('Blueberry');

            clock(1200);
            press(t.el, 'b');

            expect(current(t.tree)).toBe('Banana');
        });

        it('T3: two different letters match as a prefix', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'b');

            expect(current(t.tree)).toBe('Banana');

            clock(1100);
            press(t.el, 'l');

            expect(current(t.tree)).toBe('Blueberry');
        });

        it('T4: a match below the view scrolls to show it', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'm');

            expect(current(t.tree)).toBe('Mango');
            expect(scrollY(t.tree)).toBe(13 * ROW_HEIGHT - TREE_HEIGHT);
        });

        it('T5: a pause longer than the window starts a new search', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'b');
            clock(1700);
            press(t.el, 'c');

            expect(current(t.tree)).toBe('Banana');

            clock(2401);
            press(t.el, 'c');

            expect(current(t.tree)).toBe('Cherry');
        });

        it('T6: a letter with no match is prevented and moves nothing', () => {
            const t         = mountTree(leaves(FRUIT));
            const selection = counter(t.tree, 'selection');

            clock(1000);

            expect(press(t.el, 'z')).toBe(1);

            clock(1100);

            expect(press(t.el, 'a')).toBe(1);
            expect(current(t.tree)).toBeNull();
            expect(selection()).toBe(0);
        });

        it('T7: a repeated letter wraps past the last row', () => {
            const t = mountTree(leaves(FRUIT));
            const landed: string[] = [];
            const scrolls: number[] = [];

            for (const ms of [3000, 3100, 3200, 3300]) {
                clock(ms);
                press(t.el, 'a');
                landed.push(current(t.tree)!);
                scrolls.push(scrollY(t.tree));
            }

            expect(landed).toEqual(['Apple', 'Apricot', 'Aardvark', 'Apple']);
            expect(scrolls).toEqual([0, 0, 17 * ROW_HEIGHT - TREE_HEIGHT, 0]);
        });

        it('T8: Shift types a capital', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);

            expect(press(t.el, 'B', { shiftKey: true })).toBe(1);
            expect(current(t.tree)).toBe('Banana');
        });

        it('T9: Space is not type-ahead', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'B', { shiftKey: true });

            expect(press(t.el, ' ')).toBe(0);
            expect(current(t.tree)).toBe('Banana');
        });

        it('T10: a chord with Ctrl, Alt or Meta is not type-ahead', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'B', { shiftKey: true });

            expect(press(t.el, 'c', { ctrlKey: true })).toBe(0);
            expect(press(t.el, 'c', { altKey: true })).toBe(0);
            expect(press(t.el, 'c', { metaKey: true })).toBe(0);
            expect(current(t.tree)).toBe('Banana');
        });

        it('T11: Escape clears the buffer and is not prevented', () => {
            const t = mountTree(leaves(FRUIT));

            clock(1000);
            press(t.el, 'b');

            expect(current(t.tree)).toBe('Banana');

            expect(press(t.el, 'Escape')).toBe(0);

            clock(1100);
            press(t.el, 'l');

            expect(current(t.tree)).toBe('Lemon');
        });

        it('T12: only visible rows are searched', () => {
            const alpha = { label: 'Alpha', children: leaves(['Zed']) };
            const t     = mountTree([alpha, { label: 'Lazy' }, { label: 'Beta' }]);

            clock(1000);
            press(t.el, 'z');

            expect(current(t.tree)).toBeNull();

            t.tree.expandNode(alpha);
            (t.tree as any).renderWindow();
            clock(3000);
            press(t.el, 'z');

            expect(current(t.tree)).toBe('Zed');
        });

        it('T13: a lazy node that has not loaded is not loaded by type-ahead', () => {
            const loadChildren = vi.fn(async () => leaves(['Xenon']));
            const t            = mountTree([{ label: 'Alpha' }, { label: 'Lazy', hasChildren: true, loadChildren }]);

            clock(1000);
            press(t.el, 'x');

            expect(current(t.tree)).toBeNull();
            expect(loadChildren).not.toHaveBeenCalled();
        });

        it('T14: a key typed into a control inside a row never reaches the tree', () => {
            const t     = mountTree(leaves(FRUIT));
            const rowEl = (t.tree as any)._rowPool[0].getElement();

            clock(1000);

            expect(press(rowEl, 'b')).toBe(0);
            expect(current(t.tree)).toBeNull();
        });

        it('T15: a letter replaces a multi-selection with the one row', () => {
            const t = mountTree(leaves(FRUIT));

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown', { shiftKey: true });
            press(t.el, 'ArrowDown', { shiftKey: true });

            expect(selected(t.tree)).toEqual(expect.arrayContaining(['Apple', 'Apricot', 'Banana']));

            clock(1000);
            press(t.el, 'c');

            expect(selected(t.tree)).toEqual(['Cherry']);
            expect(t.tree.getSelectedNode()?.label).toBe('Cherry');
        });

        it('T16: the key is prevented, not stopped: an ancestor still hears it', () => {
            const parent          = track(new Container());
            const t               = mountTree(leaves(FRUIT), { parent });
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            try {
                clock(1000);

                expect(press(t.el, 'b')).toBe(1);
                expect(heard).toEqual(['b']);
            } finally {
                Event.removeSubtreeListener(parent, 'keydown', spy);
            }
        });

        it('T17: an empty tree handles none of the keys', () => {
            const t = mountTree([]);

            clock(1000);

            expect(press(t.el, 'b')).toBe(0);
            expect(press(t.el, 'Enter')).toBe(0);
            expect(press(t.el, '*')).toBe(0);
        });

        it('T18: a key SpatialNavigation claims is left alone', () => {
            const t = mountTree(leaves(FRUIT));

            vi.spyOn(SpatialNavigation, 'claimsKey').mockReturnValue(true);
            clock(1000);

            expect(press(t.el, 'd')).toBe(0);
            expect(current(t.tree)).toBeNull();
        });

        it('T19: a one-row tree lands on its row', () => {
            const t         = mountTree(leaves(['Apple']));
            const selection = counter(t.tree, 'selection');

            press(t.el, 'ArrowDown');
            clock(1000);

            expect(press(t.el, 'a')).toBe(1);
            expect(current(t.tree)).toBe('Apple');
            expect(selection()).toBe(1);
        });

        it('T20: with the current row hidden the search starts at the first row', () => {
            const a = { label: 'A', children: leaves(['a0']) };
            const t = mountTree([a, { label: 'B' }], { expanded: [a] });

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');

            expect(current(t.tree)).toBe('a0');

            (t.tree as any)._onToggle(a);

            expect(rows(t.tree)).toEqual(['A', 'B']);

            clock(1000);
            press(t.el, 'b');

            expect(current(t.tree)).toBe('B');
        });
    });

    describe('Enter', () => {
        /** Roots `A` (children `a0`, `a1`) and `B`. */
        function family(): TreeNode[] {
            return [{ label: 'A', children: leaves(['a0', 'a1']) }, { label: 'B' }];
        }

        /**
         * Records the nodes a tree's `"dblclick"` event carried.
         *
         * @param tree - The tree.
         * @returns The recorded labels, filled as the event fires.
         */
        function activations(tree: _Tree): string[] {
            const labels: string[] = [];

            tree.on('dblclick', (node: TreeNode) => { labels.push(node.label); });

            return labels;
        }

        it('N1: Enter activates the current row and expands it', () => {
            const t           = mountTree(family());
            const selection   = counter(t.tree, 'selection');
            const expand      = counter(t.tree, 'expand');
            const activated   = activations(t.tree);

            press(t.el, 'ArrowDown');

            expect(press(t.el, 'Enter')).toBe(1);
            expect(activated).toEqual(['A']);
            expect(rows(t.tree)).toEqual(['A', 'a0', 'a1', 'B']);
            expect(expand()).toBe(1);
            expect(selection()).toBe(1);
        });

        it('N2: Enter again activates again and collapses', () => {
            const t         = mountTree(family());
            const collapse  = counter(t.tree, 'collapse');
            const activated = activations(t.tree);

            press(t.el, 'ArrowDown');
            press(t.el, 'Enter');
            press(t.el, 'Enter');

            expect(activated).toEqual(['A', 'A']);
            expect(collapse()).toBe(1);
            expect(rows(t.tree)).toEqual(['A', 'B']);
        });

        it('N3: with no current row Enter is prevented and does nothing', () => {
            const t         = mountTree(family());
            const activated = activations(t.tree);

            expect(press(t.el, 'Enter')).toBe(1);
            expect(activated).toEqual([]);
        });

        it('N5: Enter with a modifier is left alone', () => {
            const t         = mountTree(family());
            const activated = activations(t.tree);

            press(t.el, 'ArrowDown');

            expect(press(t.el, 'Enter', { ctrlKey: true })).toBe(0);
            expect(press(t.el, 'Enter', { altKey: true })).toBe(0);
            expect(press(t.el, 'Enter', { metaKey: true })).toBe(0);
            expect(press(t.el, 'Enter', { shiftKey: true })).toBe(0);
            expect(activated).toEqual([]);
        });

        it('N6: an auto-repeat is prevented and does nothing', () => {
            const t         = mountTree(family());
            const activated = activations(t.tree);

            press(t.el, 'ArrowDown');

            expect(press(t.el, 'Enter', { repeat: true })).toBe(1);
            expect(activated).toEqual([]);
            expect(rows(t.tree)).toEqual(['A', 'B']);
        });

        it('N7: a leaf is activated and neither expands nor collapses', () => {
            for (const nodes of [family(), [{ label: 'B' }]]) {
                const t         = mountTree(nodes);
                const expand    = counter(t.tree, 'expand');
                const collapse  = counter(t.tree, 'collapse');
                const activated = activations(t.tree);

                press(t.el, 'ArrowDown');

                if (nodes.length === 2) {
                    press(t.el, 'ArrowDown');
                }

                press(t.el, 'Enter');

                expect(activated).toEqual(['B']);
                expect(expand()).toBe(0);
                expect(collapse()).toBe(0);
            }
        });

        it('N8: Enter toggles with the click trigger too', () => {
            const t = mountTree(family(), { options: { expandTrigger: 'click' } });

            press(t.el, 'ArrowDown');
            press(t.el, 'Enter');

            expect(rows(t.tree)).toEqual(['A', 'a0', 'a1', 'B']);
        });

        it('N9: Enter scrolls the current row into view first', () => {
            const t         = mountTree(leaves(Array.from({ length: 60 }, (_, i) => 'Node ' + i)));
            const activated = activations(t.tree);

            press(t.el, 'ArrowDown');
            (t.tree as any).setScrollY(600);
            press(t.el, 'Enter');

            expect(scrollY(t.tree)).toBe(0);
            expect(activated).toEqual(['Node 0']);
        });

        it('N10: with the current row hidden Enter is prevented and does nothing', () => {
            const a         = { label: 'A', children: leaves(['a0']) };
            const t         = mountTree([a, { label: 'B' }], { expanded: [a] });
            const activated = activations(t.tree);

            press(t.el, 'ArrowDown');
            press(t.el, 'ArrowDown');
            (t.tree as any)._onToggle(a);

            expect(press(t.el, 'Enter')).toBe(1);
            expect(activated).toEqual([]);
        });

        it('N11: Enter on an unloaded lazy node loads it once and opens it', async () => {
            const loadChildren = vi.fn(async () => leaves(['kid']));
            const t            = mountTree([{ label: 'L', hasChildren: true, loadChildren }]);
            const activated    = activations(t.tree);

            press(t.el, 'ArrowDown');
            press(t.el, 'Enter');

            for (let i = 0; i < 3; i++) {
                await Promise.resolve();
            }

            expect(activated).toEqual(['L']);
            expect(loadChildren).toHaveBeenCalledTimes(1);
            expect(rows(t.tree)).toEqual(['L', 'kid']);
        });

        it('N12: Enter activates an unselected current row and leaves the selection', () => {
            const t         = mountTree(leaves(['P', 'Q']));
            const activated = activations(t.tree);
            const q         = (t.tree as any)._flatRows[1].node as TreeNode;
            const rowQ      = (t.tree as any)._rowPool.find((row: any) => row.getNode() === q);

            for (let i = 0; i < 2; i++) {
                (t.tree as any)._handleClick(makeEvent(rowQ.getElement(), 'click', { ctrlKey: true }));
            }

            expect(current(t.tree)).toBe('Q');
            expect(selected(t.tree)).toEqual([]);

            press(t.el, 'Enter');

            expect(activated).toEqual(['Q']);
            expect(selected(t.tree)).toEqual([]);
        });

        it('N13: Enter is prevented, not stopped: an ancestor still hears it', () => {
            const parent          = track(new Container());
            const t               = mountTree(family(), { parent });
            const heard: string[] = [];
            const spy             = (e: KeyboardEvent): void => { heard.push(e.key); };

            Event.addSubtreeListener(parent, 'keydown', spy);

            try {
                press(t.el, 'ArrowDown');

                expect(press(t.el, 'Enter')).toBe(1);
                expect(heard[heard.length - 1]).toBe('Enter');
            } finally {
                Event.removeSubtreeListener(parent, 'keydown', spy);
            }
        });
    });
});
