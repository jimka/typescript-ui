// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// A list, a tree and a table scroll their own rows. When one sits in a
// *scrolling page* — a scrolling `Panel` that holds other components — a
// keyboard move continues outward: after the component has scrolled the row
// into its own viewport, every scrolling panel around it scrolls to show that
// row as well. Cases G1–G5 of plans/implemented/nested-scroll-reveal.md, and
// the cases the implementation and its reviews added.
//
// The outward step is for what the user does with the keyboard: an arrow key,
// `Home` / `End`, `PageUp` / `PageDown`, type-ahead, the keyboard context
// menu. `KeyboardRevealSites.test.ts` has a row for every such key. A state
// setter called from code — `Tree.selectNode`, `Tree.revealByPredicate`,
// `List.setFocusedIndex` — scrolls the component and nothing around it, and
// so does a click. These rules hold for the step:
//
//   - It scrolls along one axis: up or down for a row, sideways for a column.
//   - It runs inside the call, always. A layout pass that is queued around
//     the component is run first, so that what is measured is final.
//   - It does nothing while a pane, region or section around the component
//     is still opening (`RevealSettle.test.ts`), while an opener around the
//     component hides it (a closed `Accordion` section), for a hidden
//     component, or when no panel around it has anything to scroll along the
//     axis.
//   - The row's rectangle is computed from the component's viewport and its
//     scroll offset, not measured from a row element. Nothing is measured,
//     and no DOM is asked anything, when no panel around the component can
//     scroll (G2, G15); a scroll tick or a render pass measures nothing at
//     all (G5).
//
// The modelled DOM composes an element's rectangle from the sizes and
// positions the library wrote, less each ancestor's recorded scroll offset.
// It does not clamp a scroll offset, and it runs no animation frame by
// itself: `requestAnimationFrame` is captured and drained by hand. Overflow
// is an input too: a page has a scroll range only when `setScrollExtent`
// seeded one before a layout pass, and a visible scrollbar then takes a
// 12 px band out of the page's viewport on the other axis.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Panel } from '~/core/Panel';
import type { PanelOptions } from '~/core/Panel';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Container } from '~/core/Container';
import { Absolute } from '~/layout/Absolute';
import { Card } from '~/layout/Card';
import { Tab } from '~/layout/Tab';
import { Accordion } from '~/layout/Accordion';
import { AccordionConstraints } from '~/layout/AccordionConstraints';
import { FocusReveal } from '~/core/FocusReveal';
import { _Tree } from '~/component/tree/Tree';
import { _List } from '~/component/list/List';
import { MarkdownMinimap } from '~/component/display/MarkdownMinimap';
import { Body } from '~/component/table/Body';
import { Table } from '~/component/table/Table';
import { MemoryStore } from '~/data/MemoryStore';
import { Model } from '~/data/Model';
import { Menu } from '~/overlay/Menu';
import { Tooltip } from '~/overlay/Tooltip';
import { installTestDOM, makeEvent, setConnected, setScrollExtent, type RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// The mounted page's box.
const PAGE_WIDTH  = 300;
const PAGE_HEIGHT = 200;

/** A scroll extent to seed on a page, or `null` for a page whose content fits. */
type Extent = { width: number; height: number } | null;

// Content taller than the page: a vertical scroll range, and with it a 12 px
// scrollbar band at the page's right edge.
const TALL: Extent = { width: PAGE_WIDTH, height: 3000 };

// Content past the page on both axes: both ranges and both bands, so the
// page's viewport is 288 × 188.
const WIDE_AND_TALL: Extent = { width: 900, height: 3000 };

// A page whose content fits: nothing to scroll.
const FITS: Extent = null;

// The three-column model and the per-column width cache of `Body.test.ts`'s
// `bodyWith` fixture.
const MODEL = new Model([
    { name: 'a', type: 'string', order: 0 },
    { name: 'b', type: 'string', order: 1 },
    { name: 'c', type: 'string', order: 2 },
], 'a');

const COLUMN_WIDTHS = [100, 100, 100];
const TABLE_WIDTH   = 300;

// Ten one-letter nodes: ten rows of 24 px.
const TREE_LABELS = ['H', 'e', 'l', 'o', 'W', 'r', 'd', 'x', 'X', 'o'];

let frames: FrameRequestCallback[];
let built: Component[];

/** Runs the animation frames captured so far, once: one layout flush. */
function flushFrame(): void {
    const pending = frames;

    frames = [];

    for (const callback of pending) {
        callback(0);
    }
}

/** Runs every captured animation frame, including those a frame schedules. */
function drainFrames(): void {
    for (let guard = 0; guard < 10 && frames.length > 0; guard++) {
        flushFrame();
    }
}

/** The element of the panel that really scrolls. */
function scroller(panel: Panel): Handle {
    return (panel as any).getScrollElement();
}

/** How many writes the sink has recorded so far: the mark `scrollWrites` counts from. */
function writeMark(): number {
    return (DOM.sink as RecordingDOMSink).writes.length;
}

/**
 * How many scroll-offset writes the sink recorded after `from`.
 *
 * @param from - A mark taken with {@link writeMark}.
 * @returns The number of `apply` writes carrying `scrollTop` or `scrollLeft`.
 */
function scrollWrites(from: number): number {
    return (DOM.sink as RecordingDOMSink).writes.slice(from).filter(write => {
        const patch = write.args[1] as { scrollTop?: number; scrollLeft?: number } | undefined;

        return write.op === 'apply' && (patch?.scrollTop !== undefined || patch?.scrollLeft !== undefined);
    }).length;
}

/**
 * Asserts the page's vertical offset, on the scrolling element and in the
 * panel's remembered offset alike.
 *
 * @param panel - The page.
 * @param offset - The expected `scrollTop`.
 */
function expectTop(panel: Panel, offset: number): void {
    expect(DOM.source.getScrollTop(scroller(panel))).toBe(offset);
    expect(panel.getScrollTop()).toBe(offset);
}

/**
 * Asserts the page's horizontal offset, on the scrolling element and in the
 * panel's remembered offset alike.
 *
 * @param panel - The page.
 * @param offset - The expected `scrollLeft`.
 */
function expectLeft(panel: Panel, offset: number): void {
    expect(DOM.source.getScrollLeft(scroller(panel))).toBe(offset);
    expect(panel.getScrollLeft()).toBe(offset);
}

/**
 * A scrolling page, not yet mounted.
 *
 * @param options - `Panel` options on top of an `Absolute` layout, no insets
 *   and vertical scrolling.
 * @returns The page.
 */
function page(options: PanelOptions = {}): Panel {
    return new Panel({ layoutManager: new Absolute(), flush: true, autoScroll: 'y', ...options });
}

/**
 * Mounts `rootPanel` at 300 × 200, lays it out, runs the frames that queues,
 * and marks every component under it connected.
 *
 * @param rootPanel - The page, disposed by the teardown.
 * @param extent - The scroll extent to seed before the layout pass, which is
 *   what gives the page a scroll range; `FITS` for none.
 * @param inside - Every component under it that a case reveals or scrolls.
 */
function mount(rootPanel: Panel, extent: Extent, ...inside: Component[]): void {
    built.push(rootPanel);

    setConnected(rootPanel.getElement(true)!, true);

    if (extent) {
        setScrollExtent(scroller(rootPanel), extent);
    }

    rootPanel.setWidth(PAGE_WIDTH);
    rootPanel.setHeight(PAGE_HEIGHT);
    rootPanel.doLayout();
    drainFrames();

    for (const component of inside) {
        setConnected(component.getElement()!, true);
    }
}

/**
 * Dispatches a real `keydown` on `element`.
 *
 * @param element - The element holding focus.
 * @param key - The key's `KeyboardEvent.key`.
 */
function press(element: Handle, key: string): void {
    DOM.sink.dispatchEvent(element, makeEvent(element, 'keydown', { key }));
}

/**
 * A 200 × 120 tree of ten rows, 300 px down a mounted page.
 *
 * @param extent - The page's scroll extent.
 * @returns The page, the tree, and its nodes in row order.
 */
function treeInPage(extent: Extent = TALL): { outer: Panel; tree: InstanceType<typeof _Tree>; nodes: Array<{ label: string; data: number }> } {
    const outer = page();
    const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });
    const nodes = TREE_LABELS.map((label, data) => ({ label, data }));

    tree.setX(0);
    tree.setY(300);
    outer.addComponent(tree);
    mount(outer, extent, tree);
    tree.setNodes(nodes);
    drainFrames();

    return { outer, tree, nodes };
}

/**
 * A 200 × 110 list of thirty rows, 300 px down a mounted page.
 *
 * @param extent - The page's scroll extent.
 * @returns The page, the list, and the list's own scrolling panel.
 */
function listInPage(extent: Extent = TALL): { outer: Panel; list: InstanceType<typeof _List>; inner: Panel } {
    const outer = page();
    const list  = new _List({ items: Array.from({ length: 30 }, (_, i) => 'Row ' + i), preferredSize: { width: 200, height: 110 } });
    const inner = (list as any)._innerPanel as Panel;

    list.setX(0);
    list.setY(300);
    outer.addComponent(list);
    mount(outer, extent, list, inner);

    return { outer, list, inner };
}

/**
 * A table body 300 × 100 over a 100-record store, placed at (200, 300) in a
 * page that scrolls both ways, mounted and rendered.
 *
 * @returns The page, the body through an `any` cast, and the store's records.
 */
async function tableInPage(): Promise<{ outer: Panel; body: any; recs: ReturnType<MemoryStore['getAll']> }> {
    const store = new MemoryStore(MODEL, Array.from({ length: 100 }, (_, i) => ({ a: String(i) })));

    await store.load();

    const outer = page({ autoScroll: 'auto' });
    const body  = new Body(store, { preferredSize: { width: TABLE_WIDTH, height: 100 } });

    body.setX(200);
    body.setY(300);
    outer.addComponent(body);
    mount(outer, WIDE_AND_TALL, body);
    (body as any).renderWindow(TABLE_WIDTH, COLUMN_WIDTHS);
    drainFrames();

    return { outer, body, recs: store.getAll() };
}

beforeEach(() => {
    installTestDOM(CONFIG);

    frames = [];
    built  = [];

    // A scrolling panel schedules a follow-up layout frame. Capture it, so the
    // teardown can drain it: an undrained registration leaves `Component`'s
    // module-level frame handle set and swallows the next test's own.
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

    // A `List` starts `Menu`'s input watch when it is built.
    Menu._stopInputWatch();
    Tooltip._stopPointerWatch();
    DOM.reset();
});

describe('A keyboard row reveal in a scrolling page', () => {
    it('G1: a tree row scrolled into the tree is scrolled into the page as well', () => {
        const { outer, tree } = treeInPage();
        const priv = tree as any;
        const view = priv._scroller.getViewportRect();

        // The tree's box less the 12 px band of its vertical scrollbar.
        expect([view.left, view.top, view.width, view.height]).toEqual([0, 300, 188, 120]);

        priv.scrollRowIntoView(9, true);

        // Row 9 spans 216–240 of the tree's content: 240 − 120. It is then at
        // the tree's bottom edge, 300 + 120 of the page: 420 − 200.
        expect(priv._scroller.getScrollY()).toBe(120);
        expectTop(outer, 220);

        const mark = writeMark();

        priv.scrollRowIntoView(4, true);

        // Row 4 spans 96–120, above the 120–240 the tree shows: the tree goes
        // to 96. The row is then at the tree's top edge, 300 of the page,
        // which shows 220–420.
        expect(priv._scroller.getScrollY()).toBe(96);
        expect(scrollWrites(mark)).toBe(0);

        // The browser scrolled the page away. Row 4 again: 300 + 24 − 200.
        DOM.sink.apply(scroller(outer), { scrollTop: 0 });
        priv.scrollRowIntoView(4, true);

        expectTop(outer, 124);
    });

    it('G1b: the arrow keys, End and PageUp of a tree move the page with the row', () => {
        const { outer, tree } = treeInPage();
        const element = tree.getElement()!;

        DOM.sink.focus(element);
        press(element, 'ArrowDown');

        // Row 0 is 24 px high and at the tree's top: 300 + 24 − 200.
        expectTop(outer, 124);

        press(element, 'End');

        expectTop(outer, 220);

        // The browser scrolled the page away; a page up from row 9 lands on
        // a row the tree scrolls to its top edge, 300 of the page, and the
        // page shows that row: 300 + 24 − 200.
        DOM.sink.apply(scroller(outer), { scrollTop: 0 });
        press(element, 'PageUp');

        expectTop(outer, 124);
    });

    it('G2: a tree in no scrolling panel measures nothing', () => {
        const tree = new _Tree();

        built.push(tree);
        tree.getElement(true);
        tree.setWidth(200);
        tree.setHeight(120);
        tree.setNodes(TREE_LABELS.map(label => ({ label })));

        const rects = vi.spyOn(DOM.source, 'getElementRect');

        (tree as any).scrollRowIntoView(9, true);

        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expect(rects).not.toHaveBeenCalled();
    });

    it('G2b: with no scrolling panel around the tree, a queued layout pass is left to the frame', () => {
        const parent = new Container({ layoutManager: new Absolute() });
        const tree   = new _Tree({ preferredSize: { width: 200, height: 120 } });

        built.push(parent);
        parent.addComponent(tree);
        setConnected(parent.getElement(true)!, true);
        parent.setWidth(300);
        parent.setHeight(200);
        parent.doLayout();
        drainFrames();
        tree.setNodes(TREE_LABELS.map(label => ({ label })));
        drainFrames();
        parent.scheduleLayout();

        const laidOut = vi.spyOn(parent, 'doLayout');

        (tree as any).scrollRowIntoView(9, true);

        expect(laidOut).not.toHaveBeenCalled();

        drainFrames();

        expect(laidOut).toHaveBeenCalledTimes(1);
    });

    it('G3: a list row reached by a key is scrolled into the page as well', () => {
        const { outer, list, inner } = listInPage();
        const element = list.getElement()!;

        DOM.sink.focus(element);
        press(element, 'ArrowDown');

        // Row 0 is 22 px high and at the list's top: 300 + 22 − 200. The
        // page moves no further than that.
        expect(list.getFocusedIndex()).toBe(0);
        expectTop(outer, 122);

        press(element, 'End');

        // The list's viewport is its 110 px less a 1 px border on each side.
        // Row 29 ends at 660 of the list's content: 660 − 108. It is then at
        // the viewport's bottom edge: 300 + 108 − 200.
        expect(list.getFocusedIndex()).toBe(29);
        expect(inner.getScrollViewportRect()!.height).toBe(108);
        expect(inner.getScrollTop()).toBe(552);
        expectTop(outer, 208);
    });

    it('G3b: type-ahead in a list moves the page with the row it lands on', () => {
        const outer = page();
        const items = Array.from({ length: 29 }, (_, i) => 'Row ' + i).concat('Zulu');
        const list  = new _List({ items, preferredSize: { width: 200, height: 110 } });
        const inner = (list as any)._innerPanel as Panel;

        list.setX(0);
        list.setY(300);
        outer.addComponent(list);
        mount(outer, TALL, list, inner);

        const element = list.getElement()!;

        DOM.sink.focus(element);
        press(element, 'z');

        // As End in G3: "Zulu" is row 29.
        expect(list.getFocusedIndex()).toBe(29);
        expect(inner.getScrollTop()).toBe(552);
        expectTop(outer, 208);
    });

    it('G4: a table row moves the page up or down only, and a column sideways only', async () => {
        const { outer, body, recs } = await tableInPage();

        // The body's box less the 12 px band of each scrollbar, and the same
        // for the page: 288 × 188.
        expect([body._scroller.getViewportWidth(), body._scroller.getViewportHeight()]).toEqual([288, 88]);
        expect(body._rowHeight).toBe(20);

        const pageView = outer.getScrollViewportRect()!;

        expect([pageView.width, pageView.height]).toEqual([288, 188]);

        body.scrollRecordIntoView(recs[50]);

        // Row 50 ends at 51 × 20 of the content: 1020 − 88. It is then at the
        // viewport's bottom edge: 300 + 88 − 188. The body starts 200 px
        // across the page and is cut at its right edge, and the row reveal
        // leaves that alone.
        expect(body._scroller.getScrollY()).toBe(932);
        expectTop(outer, 200);
        expectLeft(outer, 0);

        body.scrollColumnIntoView(2);

        // Column 2 ends at 300 of the content: 300 − 288. It is then at the
        // viewport's right edge: 200 + 288 − 288.
        expect(body._scroller.getScrollX()).toBe(12);
        expectLeft(outer, 200);
        expectTop(outer, 200);
    });

    it('G5: scroll ticks and render passes read no geometry; one row reveal reads two rectangles', async () => {
        const { body, recs } = await tableInPage();
        const rects = vi.spyOn(DOM.source, 'getElementRect');

        for (let tick = 1; tick <= 20; tick++) {
            body.setScrollY(tick * 13);
            body.setScrollX(tick % 12);
        }

        for (let pass = 0; pass < 5; pass++) {
            body.renderWindow(TABLE_WIDTH, COLUMN_WIDTHS);
        }

        drainFrames();

        expect(rects).not.toHaveBeenCalled();

        body.scrollRecordIntoView(recs[50]);

        // The scroller's clip box, for the row's rectangle, and the page's
        // own box, for its viewport.
        expect(rects).toHaveBeenCalledTimes(2);
    });

    it('G6: a hidden tree scrolls its own rows and leaves the page alone', () => {
        const { outer, tree } = treeInPage();

        // What a `Card` does to the page it turns away from. A hidden
        // element measures as an empty rectangle at the window's origin, so
        // a row's rectangle worked out from it would send the page there.
        tree.setDisplayed(false);
        drainFrames();
        outer.setScrollTop(150);

        const mark  = writeMark();
        const rects = vi.spyOn(DOM.source, 'getElementRect');

        (tree as any).scrollRowIntoView(9, true);
        drainFrames();

        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expect(scrollWrites(mark)).toBe(0);
        expect(rects).not.toHaveBeenCalled();
        expectTop(outer, 150);
    });

    it('G10: Shift+F10 in a list cut by the page opens its menu under the row, after the page has moved', () => {
        const { outer, list } = listInPage();
        const menus: Array<{ index: number; y: number }> = [];

        list.on('contextmenu', (index: number, e: MouseEvent) => {
            menus.push({ index, y: e.clientY });
        });
        list.setFocusedIndex(3);

        const element = list.getElement()!;

        // Shift+F10 is a key press, after which the browser dispatches
        // `contextmenu` at the focused element.
        DOM.sink.focus(element);
        press(element, 'F10');
        DOM.sink.dispatchEvent(element, makeEvent(element, 'contextmenu', { clientX: 0, clientY: 0 }));

        // Row 3 ends at 88 of the list's content: 300 + 88 of the page, less
        // the page's 200. The menu's point is the row's bottom edge as it is
        // drawn after that scroll, which is the page's own bottom edge.
        expectTop(outer, 188);
        expect(menus).toEqual([{ index: 3, y: 200 }]);
    });

    it('G15: with nothing to scroll around it, a key reads no rectangle and asks the DOM nothing', () => {
        // Five scrolling panels elsewhere in the application, each with a
        // scroll range of its own.
        for (let i = 0; i < 5; i++) {
            const elsewhere = page();

            elsewhere.addComponent(new Component({ preferredSize: { width: 10, height: 500 } }));
            mount(elsewhere, TALL);
        }

        // The list's own page is a scrolling panel whose content fits.
        const { outer, list } = listInPage(FITS);
        const element = list.getElement()!;

        DOM.sink.focus(element);
        press(element, 'ArrowDown');

        drainFrames();

        const rects     = vi.spyOn(DOM.source, 'getElementRect');
        const connected = vi.spyOn(DOM.source, 'isConnected');
        const contains  = vi.spyOn(DOM.source, 'contains');
        const mark      = writeMark();

        // What an arrow key does once the row is chosen.
        (list as any).scrollIndexIntoView(1, true);

        // One rectangle: the list's own panel, to scroll its own rows. The
        // page is never measured, and no revealer is looked up in the DOM.
        expect(rects).toHaveBeenCalledTimes(1);
        expect(connected).not.toHaveBeenCalled();
        expect(contains).not.toHaveBeenCalled();
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 0);
    });
});

describe('A key in a page that is mounted where an application mounts it', () => {
    // The modelled DOM mints a new handle on every `getBody()` and
    // `getDocumentElement()` call, so each case pins one, as an application's
    // document has one.
    for (const where of ['body', 'html'] as const) {
        it(`G15b: with the page appended to <${where}>, a key looks up no revealer in the DOM`, () => {
            const body = DOM.source.getBody();
            const html = DOM.source.getDocumentElement();

            vi.spyOn(DOM.source, 'getBody').mockReturnValue(body);
            vi.spyOn(DOM.source, 'getDocumentElement').mockReturnValue(html);

            for (let i = 0; i < 5; i++) {
                const elsewhere = page();

                elsewhere.addComponent(new Component({ preferredSize: { width: 10, height: 500 } }));
                mount(elsewhere, TALL);
            }

            const outer = page();
            const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });

            tree.setX(0);
            tree.setY(300);
            outer.addComponent(tree);
            DOM.sink.appendChild(where === 'body' ? body : html, outer.getElement(true)!);
            mount(outer, TALL, tree);
            tree.setNodes(TREE_LABELS.map(label => ({ label })));
            drainFrames();

            const connected = vi.spyOn(DOM.source, 'isConnected');
            const contains  = vi.spyOn(DOM.source, 'contains');

            (tree as any).scrollRowIntoView(9, true);

            // The component tree reaches the top of the page, so nothing is
            // looked up through the registry, and the page follows.
            expect(connected).not.toHaveBeenCalled();
            expect(contains).not.toHaveBeenCalled();
            expectTop(outer, 220);
        });
    }
});

describe('A state setter called from code scrolls the component and nothing around it', () => {
    it('G7: Tree.selectNode moves no page, whether the row is cut by the page or far out of its view', () => {
        const { outer, tree, nodes } = treeInPage();
        const rects = vi.spyOn(DOM.source, 'getElementRect');
        const mark  = writeMark();

        // The tree spans 300–420 of the page, which shows 0–200: row 9 ends
        // up at the tree's bottom edge, below the page's.
        tree.selectNode(nodes[9]);
        drainFrames();

        expect(tree.getSelectedNode()).toBe(nodes[9]);
        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expect(scrollWrites(mark)).toBe(0);
        expect(rects).not.toHaveBeenCalled();
        expectTop(outer, 0);

        // The page is far past the tree: the tree is wholly out of view.
        outer.setScrollTop(2000);

        const far = writeMark();

        tree.selectNode(nodes[0]);
        drainFrames();

        expect((tree as any)._scroller.getScrollY()).toBe(0);
        expect(scrollWrites(far)).toBe(0);
        expectTop(outer, 2000);
    });

    it('G8: Tree.revealByPredicate moves no page', async () => {
        const { outer, tree, nodes } = treeInPage();
        const mark = writeMark();

        const found = await tree.revealByPredicate(data => data === 9);

        drainFrames();

        expect(found).toBe(nodes[9]);
        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 0);
    });

    it('G9: a minimap following a scrolled document does not move the page it sits in', () => {
        const listeners: Array<(id: string | null) => void> = [];
        const scrollSource = {
            on:  (_event: 'activeheadingchange', listener: (id: string | null) => void) => {
                listeners.push(listener);
            },
            off: () => {},
        };

        const outer   = page();
        const minimap = new MarkdownMinimap({ scrollSource, preferredSize: { width: 200, height: 120 } });

        minimap.setX(0);
        minimap.setY(600);
        outer.addComponent(minimap);
        mount(outer, TALL, minimap, (minimap as any)._tree);
        minimap.setHeadings(Array.from({ length: 20 }, (_, i) => ({ id: 'h' + i, text: 'Heading ' + i, depth: 1 })));
        outer.doLayout();
        drainFrames();

        const tree = (minimap as any)._tree;
        const mark = writeMark();

        // What the document's scroll listener does when another heading
        // reaches the top of its pane. The user is scrolling the document:
        // the page around it must not move under them.
        listeners[0]('h19');
        drainFrames();

        expect(tree.getSelectedNode()?.data).toBe('h19');
        expect(tree._scroller.getScrollY()).toBeGreaterThan(0);
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 0);
    });

    it('G12: List.setFocusedIndex moves no page, whether the row is cut by the page or far out of its view', () => {
        const { outer, list, inner } = listInPage();
        const asked = vi.spyOn(outer, 'revealRect');

        // The list spans 300–410 of the page, which shows 0–200.
        list.setFocusedIndex(29);
        drainFrames();

        expect(inner.getScrollTop()).toBe(552);
        expectTop(outer, 0);

        // The page is far past the list: the list is wholly out of view.
        outer.setScrollTop(2000);
        list.setFocusedIndex(0);
        drainFrames();

        expect(inner.getScrollTop()).toBe(0);
        expectTop(outer, 2000);
        expect(asked).not.toHaveBeenCalled();
    });

    it('G14: a click on a tree row cut by the page moves no page', () => {
        const { outer, tree } = treeInPage();
        const priv = tree as any;

        // The page shows 150–350: the tree's first two rows are in view and
        // the third, 348–372, is cut by the page's bottom edge.
        outer.setScrollTop(150);

        const row  = priv._rowPool.find((candidate: any) => candidate.getNode()?.data === 2);
        const mark = writeMark();

        priv._handleClick(makeEvent(row.getElement(), 'click'));
        drainFrames();

        expect(tree.getSelectedNode()?.data).toBe(2);
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 150);
    });

    it('G13: FocusReveal.reveal of the component is the call that brings it into view of the page', () => {
        const { outer, tree, nodes } = treeInPage();

        tree.selectNode(nodes[9]);

        expectTop(outer, 0);

        FocusReveal.reveal(tree.getElement()!);
        drainFrames();

        // The tree's box, 300–420 of the page, ends on the page's bottom
        // edge, and the tree has the row at its own bottom edge.
        expectTop(outer, 220);
    });
});

describe('A keyboard row reveal with a layout pass queued around the component', () => {
    /**
     * A 300 × 200 `Card` host. Page A is a scrolling panel with a 2000 px
     * filler and `widget` 750 px down. Page B is a plain component.
     *
     * @param widget - The list or tree to put on page A.
     * @returns The layout manager and page A.
     */
    function cardRig(widget: Component): { card: Card; a: Panel } {
        const card = new Card();
        const host = new Container({ layoutManager: card });
        const a    = page({ id: 'reveal-page-a' });
        const b    = new Component({ id: 'reveal-page-b' });

        widget.setX(0);
        widget.setY(750);
        a.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        a.addComponent(widget);
        host.clearInsets();
        host.addComponent(a);
        host.addComponent(b);
        card.setVisibleComponentId('reveal-page-a');
        built.push(host);

        setConnected(host.getElement(true)!, true);
        host.setWidth(PAGE_WIDTH);
        host.setHeight(PAGE_HEIGHT);
        host.doLayout();
        drainFrames();

        for (const component of [a, b, widget]) {
            setConnected(component.getElement(true)!, true);
        }

        // Page A's content is taller than the page.
        setScrollExtent(scroller(a), { width: PAGE_WIDTH, height: 2000 });
        a.scheduleLayout();
        drainFrames();

        expect(a.hasScrollRange('y')).toBe(true);

        return { card, a };
    }

    /**
     * Leaves page A at 700, turns to page B and back, as a browser sees it.
     * The layout pass that gives page A its offset back is still queued.
     *
     * @param card - The layout manager.
     * @param a - Page A.
     */
    function leaveAndReturn(card: Card, a: Panel): void {
        a.setScrollTop(700);
        card.setVisibleComponentId('reveal-page-b');
        drainFrames();

        // A browser reads 0 for the offsets of an element under `display: none`.
        DOM.sink.apply(scroller(a), { scrollTop: 0 });

        expect(a.getScrollTop()).toBe(700);

        card.setVisibleComponentId('reveal-page-a');
    }

    it('G16: a key in a tree on a Card page that was just shown again finds the page back at its offset', () => {
        const tree = new _Tree({ preferredSize: { width: 200, height: 120 } });
        const { card, a } = cardRig(tree);

        tree.setNodes(TREE_LABELS.map(label => ({ label })));
        drainFrames();
        leaveAndReturn(card, a);

        const element = tree.getElement()!;

        // Row 0 spans 750–774 of the page's content. The layout pass that
        // gives the page its offset back is run before anything is measured:
        // at 700 the page shows 700–900, the row is in view, and nothing
        // else moves.
        DOM.sink.focus(element);
        press(element, 'ArrowDown');

        expectTop(a, 700);

        drainFrames();

        expectTop(a, 700);
    });

    it('G16b: the same for a key in a list', () => {
        const list = new _List({ items: Array.from({ length: 30 }, (_, i) => 'Row ' + i), preferredSize: { width: 200, height: 110 } });
        const { card, a } = cardRig(list);

        setConnected((list as any)._innerPanel.getElement(true)!, true);
        drainFrames();
        leaveAndReturn(card, a);

        const element = list.getElement()!;

        DOM.sink.focus(element);
        press(element, 'ArrowDown');

        expectTop(a, 700);

        drainFrames();

        expectTop(a, 700);
    });

    it('G11: a row reveal made before the page has laid the tree out runs that layout, then shows the row, in the call', () => {
        const outer = page();
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });
        const nodes = TREE_LABELS.map(label => ({ label }));

        outer.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        mount(outer, TALL);
        outer.setScrollTop(900);

        // Added, filled and revealed in one task: the tree has an element
        // and no size yet.
        tree.setX(0);
        tree.setY(1500);
        outer.addComponent(tree);
        setConnected(tree.getElement(true)!, true);
        tree.setNodes(nodes);

        const treeLaidOut = vi.spyOn(tree, 'doLayout');

        (tree as any).scrollRowIntoView(9, true);

        // Laid out, the tree spans 1500–1620 and has row 9 at its bottom
        // edge: 1620 − 200.
        // The page's pass laid the tree out. Its own queued pass is not
        // run on top of that.
        expect(treeLaidOut).toHaveBeenCalledTimes(1);
        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expectTop(outer, 1420);

        const mark = writeMark();

        drainFrames();

        // The frame finds neither pass left: nothing is laid out a second
        // time, and nothing scrolls.
        expect(treeLaidOut).toHaveBeenCalledTimes(1);
        expect(scrollWrites(mark)).toBe(0);
    });

    it('G17: the same for a tree that already had a size when it was added to the page', () => {
        const outer = page();
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });
        const nodes = TREE_LABELS.map(label => ({ label }));

        outer.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        mount(outer, TALL);
        outer.setScrollTop(900);

        // Built, sized and filled on its own, then placed in the page and
        // revealed in one task. The page has not laid it out yet.
        built.push(tree);
        setConnected(tree.getElement(true)!, true);
        tree.setWidth(200);
        tree.setHeight(120);
        tree.setNodes(nodes);
        drainFrames();
        tree.setX(0);
        tree.setY(1500);
        outer.addComponent(tree);

        (tree as any).scrollRowIntoView(9, true);

        expectTop(outer, 1420);
    });

    it('G21: a page that was queued and has been laid out directly since is not laid out again', () => {
        const { outer, tree } = treeInPage();

        outer.scheduleLayout();
        outer.doLayout();

        const laidOut = vi.spyOn(outer, 'doLayout');

        (tree as any).scrollRowIntoView(9, true);

        expect(laidOut).not.toHaveBeenCalled();
        expectTop(outer, 220);
    });

    it('G20: a settled page is not laid out for a key, and a queued one is laid out once', () => {
        const { outer, tree } = treeInPage();
        const priv    = tree as any;
        const laidOut = vi.spyOn(outer, 'doLayout');

        priv.scrollRowIntoView(9, true);

        expect(laidOut).not.toHaveBeenCalled();
        expectTop(outer, 220);

        outer.scheduleLayout();
        priv.scrollRowIntoView(0, true);

        // Row 0, at the tree's top edge, 300 of the page, which shows 220–420.
        expect(laidOut).toHaveBeenCalledTimes(1);
        expectTop(outer, 220);

        // The frame that was queued finds nothing left to lay out.
        drainFrames();

        expect(laidOut).toHaveBeenCalledTimes(1);
    });

    it('G28: content that grew past the page since its last layout is seen, because the queued layout runs first', () => {
        const { outer, tree } = treeInPage(FITS);
        const element = tree.getElement()!;

        expect(outer.hasScrollRange('y')).toBe(false);

        // The content now overflows, and the page's layout pass is queued.
        setScrollExtent(scroller(outer), TALL!);
        outer.scheduleLayout();

        const laidOut = vi.spyOn(outer, 'doLayout');

        DOM.sink.focus(element);
        press(element, 'End');

        expect(outer.hasScrollRange('y')).toBe(true);
        expectTop(outer, 220);

        // The page's scrollbar appeared in that pass, for which a panel
        // queues itself once more. That pass runs in the call as well, so
        // nothing is left for the frame.
        expect(laidOut).toHaveBeenCalledTimes(2);

        drainFrames();

        expect(laidOut).toHaveBeenCalledTimes(2);
    });

    it('G38: no queued pass is run from inside a layout pass', () => {
        const { outer, tree } = treeInPage();
        const side       = page();
        const treeLayout = tree.doLayout.bind(tree);
        let inside       = false;

        mount(side, TALL);
        side.scheduleLayout();

        const sideLaidOut = vi.spyOn(side, 'doLayout');

        vi.spyOn(tree, 'doLayout').mockImplementation(() => {
            if (!inside) {
                inside = true;
                Component.flushLayoutQueuedAround(side);
            }

            return treeLayout();
        });

        // The page's pass gives the tree its new size, and so lays it out.
        tree.setPreferredSize({ width: 200, height: 140 });
        outer.doLayout();

        expect(inside).toBe(true);
        expect(sideLaidOut).not.toHaveBeenCalled();

        Component.flushLayoutQueuedAround(side);

        expect(sideLaidOut).toHaveBeenCalledTimes(1);
    });

    it('G30: a queued layout pass that throws is reported as the frame would report it, and the key still lands', () => {
        const { outer, tree } = treeInPage();
        const element  = tree.getElement()!;
        const reported = vi.spyOn(console, 'error').mockImplementation(() => {});

        outer.scheduleLayout();
        vi.spyOn(outer, 'doLayout').mockImplementationOnce(() => {
            throw new Error('a layout manager that fails');
        });

        DOM.sink.focus(element);

        // The pass was the frame's to run. Run early, it must not surface in
        // the key handler, which has a row to move to.
        expect(() => press(element, 'End')).not.toThrow();

        expect(reported).toHaveBeenCalledTimes(1);
        expect(reported.mock.calls[0][0]).toContain('Layout flush: doLayout for #');
        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expectTop(outer, 220);
    });

    it('G32: of two queued passes around the row, the outer one runs first', () => {
        const { outer, tree } = treeInPage();
        const order: string[] = [];
        const pageLayout = outer.doLayout.bind(outer);
        const treeLayout = tree.doLayout.bind(tree);

        vi.spyOn(outer, 'doLayout').mockImplementation(() => {
            order.push('page');

            return pageLayout();
        });
        vi.spyOn(tree, 'doLayout').mockImplementation(() => {
            order.push('tree');

            return treeLayout();
        });

        tree.scheduleLayout();
        outer.scheduleLayout();
        (tree as any).scrollRowIntoView(9, true);

        expect(order[0]).toBe('page');
        expect(order.filter(name => name === 'tree')).toHaveLength(1);
        expectTop(outer, 220);
    });

    it('G43: a queued tree that the pass of its page lays out is not laid out again, in the call or at the frame', () => {
        const { outer, tree } = treeInPage();

        // Both are queued, and the page's pass gives the tree a new size, so
        // it reaches the tree by recursion.
        tree.scheduleLayout();
        tree.setPreferredSize({ width: 200, height: 140 });
        outer.scheduleLayout();

        const treeLaidOut = vi.spyOn(tree, 'doLayout');

        (tree as any).scrollRowIntoView(9, true);

        expect(treeLaidOut).toHaveBeenCalledTimes(1);

        drainFrames();

        expect(treeLaidOut).toHaveBeenCalledTimes(1);
    });

    it('G33: a queued parent that has no element yet is not laid out', () => {
        const parent = page();
        const tree   = new _Tree({ preferredSize: { width: 200, height: 120 } });

        built.push(parent, tree);

        // The tree was rendered on its own; the page it has been put in is
        // queued and has not rendered.
        setConnected(tree.getElement(true)!, true);
        tree.setWidth(200);
        tree.setHeight(120);
        tree.setNodes(TREE_LABELS.map(label => ({ label })));
        drainFrames();
        parent.addComponent(tree);
        parent.scheduleLayout();

        const laidOut = vi.spyOn(parent, 'doLayout');

        expect(parent.getElement()).toBeFalsy();
        expect(() => (tree as any).scrollRowIntoView(9, true)).not.toThrow();
        expect(laidOut).not.toHaveBeenCalled();
        expect((tree as any)._scroller.getScrollY()).toBe(120);

        // Its pass is still the frame's to run, once it has rendered.
        setConnected(parent.getElement(true)!, true);
        drainFrames();

        expect(laidOut).toHaveBeenCalledTimes(1);
    });

    it('G34: after the queued layout the table scrolls the column into its final viewport as well', async () => {
        const { outer, body } = await tableInPage();

        // The body is about to become narrower than its three columns.
        body.setPreferredSize({ width: 150, height: 100 });
        outer.scheduleLayout();

        expect(body._scroller.getScrollX()).toBe(0);

        body.scrollColumnIntoView(2);

        // Column 2 spans 200–300 of the content. The viewport is the body's
        // 150 px less the 12 px band of its scrollbar: 300 − 138.
        expect(body._scroller.getViewportWidth()).toBe(138);
        expect(body._scroller.getScrollX()).toBe(162);
    });

    it('G41: a page that queues itself on every pass is laid out twice in the call, and no more', () => {
        const { outer, tree } = treeInPage();
        const pageLayout = outer.doLayout.bind(outer);
        let passes = 0;

        // One follow-up pass is what a panel asks for when its scrollbar
        // appears. A component that asks again every time is left to the
        // frame.
        vi.spyOn(outer, 'doLayout').mockImplementation(() => {
            passes += 1;
            pageLayout();
            outer.scheduleLayout();

            return outer;
        });

        outer.scheduleLayout();
        (tree as any).scrollRowIntoView(9, true);

        expect(passes).toBe(2);
        expectTop(outer, 220);

        vi.mocked(outer.doLayout).mockRestore();
    });

    it('G39: a row that is gone once the queued layout has run hands nothing outward', () => {
        const { outer, tree } = treeInPage();
        const priv   = tree as any;
        const within = vi.spyOn(priv, 'scrollRowWithin');

        // The row is there when the key is handled, and not any more when
        // the view is asked again after the layout pass.
        within.mockReturnValueOnce([216, 240]).mockReturnValueOnce(null);

        outer.scheduleLayout();
        priv.scrollRowIntoView(9, true);

        expect(within).toHaveBeenCalledTimes(2);
        expectTop(outer, 0);
    });

    it('G22: a table row and its column revealed while a layout is queued both land, in the call', async () => {
        const { outer, body, recs } = await tableInPage();

        outer.scheduleLayout();
        body.scrollRecordIntoView(recs[50]);
        body.scrollColumnIntoView(2);

        // As G4, where nothing is queued.
        expectTop(outer, 200);
        expectLeft(outer, 200);
    });

    it('G23: Enter in an editing cell of a table that sizes its columns moves the page before the next editor opens', async () => {
        const store = new MemoryStore(MODEL, Array.from({ length: 100 }, (_, i) => ({ a: String(i), b: 'b' + i, c: 'c' + i })));

        await store.load();

        const outer = page();
        const table = new Table(store, { columns: [{ field: 'a', editable: true }, { field: 'b', editable: true }, { field: 'c' }], autoSizeColumns: true } as never);

        table.setPreferredSize({ width: 280, height: 140 });
        table.setX(0);
        table.setY(300);
        outer.addComponent(table);
        mount(outer, TALL, table, (table as any)._body);
        outer.doLayout();
        drainFrames();

        const body    = (table as any)._body;
        const visible = body.getVisibleRecords();

        body.selectRecord(visible[4]);
        body.scrollRecordIntoView(visible[4]);
        body.renderWindow();
        drainFrames();

        const before = outer.getScrollTop();
        const cell   = body.resolveFocusedCell();

        // Where the page is each time a cell opens its editor.
        const pageAtEditorOpen: number[] = [];
        const openEditing = body.openEditingAfterNavigate.bind(body);

        body.openEditingAfterNavigate = () => {
            pageAtEditorOpen.push(outer.getScrollTop());
            openEditing();
        };

        // Enter commits the changed value, which queues a layout of the
        // table to size its columns again, then moves down a row and opens
        // that row's editor.
        cell.startEdit();
        cell._activeEditor.setValue('changed');
        cell.onKeyDown({ detail: { keyCode: 13, shiftKey: false } });

        const after = outer.getScrollTop();
        const view  = outer.getScrollViewportRect()!;
        const now   = DOM.source.getElementRect(body.resolveFocusedCell().getElement());

        // The body scrolled by a row and the page followed, inside the key
        // press: the current cell is in the page's viewport again.
        expect(after).toBeGreaterThan(before);
        expect(now.bottom).toBeLessThanOrEqual(view.bottom);
        expect(now.top).toBeGreaterThanOrEqual(view.top);

        // The page was already there when the next editor opened, so a
        // picker that editor opens is anchored where the cell stays.
        expect(pageAtEditorOpen).toEqual([after]);

        drainFrames();

        expect(outer.getScrollTop()).toBe(after);
    });

    it('G24: rows replaced right after a key leave nothing behind that scrolls to the old row', () => {
        const { outer, tree } = treeInPage();
        const element = tree.getElement()!;

        DOM.sink.focus(element);
        outer.scheduleLayout();
        press(element, 'End');

        // The key's row was scrolled to inside the key press.
        expectTop(outer, 220);

        // The application reloads the tree: three rows.
        tree.setNodes([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);

        const mark = writeMark();

        drainFrames();

        expect((tree as any)._scroller.getScrollY()).toBe(0);
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 220);
    });

    it('G25: a listener that writes the selection back does not stop the page following the key', () => {
        const { outer, tree, nodes } = treeInPage();
        const element = tree.getElement()!;
        let echoing = false;

        tree.on('selection', (selected: unknown[]) => {
            if (echoing || selected.length === 0) {
                return;
            }

            echoing = true;
            tree.selectNode(selected[0] as (typeof nodes)[number]);
            echoing = false;
        });

        DOM.sink.focus(element);
        outer.scheduleLayout();
        press(element, 'End');

        expect(tree.getSelectedNode()).toBe(nodes[9]);
        expectTop(outer, 220);
    });

    it('G19: Shift+F10 right after content changed places the menu under the row, with the page already scrolled', () => {
        const { outer, list } = listInPage();
        const menus: Array<{ index: number; y: number }> = [];

        list.on('contextmenu', (index: number, e: MouseEvent) => {
            menus.push({ index, y: e.clientY });
        });
        list.setFocusedIndex(3);
        drainFrames();
        outer.scheduleLayout();

        const element = list.getElement()!;

        DOM.sink.focus(element);
        press(element, 'F10');
        DOM.sink.dispatchEvent(element, makeEvent(element, 'contextmenu', { clientX: 0, clientY: 0 }));

        // As G10: the queued layout is run first, the page scrolls, and the
        // menu's point is the row's bottom edge as it is then drawn.
        expectTop(outer, 188);
        expect(menus).toEqual([{ index: 3, y: 200 }]);
    });

    it('G29: a key handled from inside a layout pass scrolls the component and leaves the page for the next key', () => {
        const { outer, tree } = treeInPage();
        const priv = tree as any;
        let inside = false;

        // A component that reveals a row while it is being laid out.
        const doLayout = tree.doLayout.bind(tree);

        vi.spyOn(tree, 'doLayout').mockImplementation(() => {
            if (!inside) {
                inside = true;
                priv.scrollRowIntoView(9, true);
            }

            return doLayout();
        });

        outer.scheduleLayout();
        outer.doLayout();

        // Nothing is flushed or measured from inside a pass.
        expect(inside).toBe(true);
        expectTop(outer, 0);

        priv.scrollRowIntoView(9, true);

        expectTop(outer, 220);
    });
});

describe('The two protected reveal methods keep their one-argument form', () => {
    it('G35: scrollRowIntoView(index) scrolls the view and nothing around it', () => {
        const { outer, tree } = treeInPage();

        (tree as any).scrollRowIntoView(9);

        expect((tree as any)._scroller.getScrollY()).toBe(120);
        expectTop(outer, 0);
    });

    it('G36: scrollIndexIntoView(idx) scrolls the list and nothing around it', () => {
        const { outer, list, inner } = listInPage();

        (list as any).scrollIndexIntoView(29);

        // Row 29 ends at 660 of the list's content, and its panel shows
        // 108 px: 660 − 108.
        expect(inner.getScrollTop()).toBe(552);
        expectTop(outer, 0);
    });
});

describe('A keyboard row reveal does nothing for a row that cannot be shown', () => {
    it('G40: a tree that the queued layout pass hides leaves the page alone', () => {
        const outer = page();
        const tab   = new Tab();
        const host  = new Container({ layoutManager: tab, preferredSize: { width: 280, height: 300 } });
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });

        host.clearInsets();
        host.addComponent(tree);
        tab.createTab(tree);
        host.setX(0);
        host.setY(400);
        outer.addComponent(host);
        mount(outer, { width: PAGE_WIDTH, height: 3000 }, host, tree);
        tree.setNodes(TREE_LABELS.map(label => ({ label })));
        drainFrames();

        const element = tree.getElement()!;

        // Control: a key in this tree does move the page.
        DOM.sink.focus(element);
        press(element, 'End');

        expect(outer.getScrollTop()).toBeGreaterThan(0);

        outer.setScrollTop(1500);
        drainFrames();

        // Code adds a tab and asks for it. Its cell does not exist yet, so
        // the `Tab` puts the switch off to its next layout pass.
        const second = new Component({ preferredSize: { width: 50, height: 50 } });

        host.addComponent(second);
        tab.setActiveContent(second);

        expect(tab.getVisibleComponent()).toBe(tree);

        // A key reaches the tree before the frame. The pass it runs first
        // switches tabs, and the tree is then not on show.
        const mark = writeMark();

        press(element, 'Home');

        expect(tree.isEffectivelyVisible()).toBe(false);
        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 1500);

        tab.detach();
    });

    it('G18: a tree in a closed Accordion section leaves the page alone', () => {
        const outer = page();
        const acc   = new Accordion();
        const host  = new Container({ layoutManager: acc });
        const first = new Component({ preferredSize: { width: 100, height: 150 } });
        const tree  = new _Tree({ preferredSize: { width: 200, height: 120 } });

        host.clearInsets();
        host.addComponent(first, new AccordionConstraints('A', true));
        host.addComponent(tree, new AccordionConstraints('B', false));
        host.setX(0);
        host.setY(600);
        outer.addComponent(new Component({ preferredSize: { width: 10, height: 2000 } }));
        outer.addComponent(host);
        mount(outer, TALL, host, first, tree);
        tree.setNodes(TREE_LABELS.map(label => ({ label })));
        drainFrames();

        expect(acc.isSectionOpen(1)).toBe(false);

        const mark = writeMark();

        (tree as any).scrollRowIntoView(9, true);
        drainFrames();

        expect(scrollWrites(mark)).toBe(0);
        expectTop(outer, 0);

        acc.detach();
    });
});
