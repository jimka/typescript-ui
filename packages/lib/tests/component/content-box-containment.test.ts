/**
 * A component that places its own children must place them inside its content
 * box — the rectangle `getContentBounds()` returns — whether it does that from a
 * `doLayout` override or from another method, as the row renderers do.
 * Placing them against the border box instead makes the last child overflow by
 * both border sides — the child's containing block is already the padding box,
 * so it starts inside the near border and runs the far one past the edge — and
 * the component's `overflow: hidden` clips it.
 *
 * Two oracles below. `expectChildrenInsideContentBox` catches a component that
 * overflows under its own real border. `expectBorderOnlyShrinks` is the guard
 * that makes the currently-borderless components non-vacuous: it gives them a
 * literal border and pins that a border may only shrink the content box, never
 * move its origin.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import type { Handle } from '~/core/DOM';
import { Component } from '~/core/Component';
import { Container } from '~/core/Container';
import { Insets } from '~/primitive/Insets';
import { installTestDOM } from '../dom/TestDOM';
import type { RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

import { DateField } from '~/component/input/DateField';
import { TimeField } from '~/component/input/TimeField';
import { DateTimeField } from '~/component/input/DateTimeField';
import { AutoCompleteField } from '~/component/input/AutoCompleteField';
import { TextField } from '~/component/input/TextField';
import { _ComboBox } from '~/component/input/ComboBox';
import { Dialog } from '~/overlay/Dialog';
import { Tooltip } from '~/overlay/Tooltip';
import { DragGhost } from '~/overlay/DragGhost';
import { MenuItem } from '~/component/container/MenuItem';
import { MenuSeparator } from '~/component/container/MenuSeparator';
import { Cell } from '~/component/table/cell/Cell';
import type { CellRenderer } from '~/component/table/cell/renderer/CellRenderer';
import { TreeCellRenderer } from '~/component/table/cell/renderer/TreeCell';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { _List } from '~/component/list/List';
import { _TreeRow } from '~/component/tree/TreeRow';
import { Glyph } from '~/component/display/Glyph';
import { LabelTreeNodeRenderer } from '~/component/tree/renderer/Label';
import { IconLabelTreeNodeRenderer } from '~/component/tree/renderer/IconLabel';
import { _LabelListItemRenderer } from '~/component/list/renderer/Label';
import { _GlyphListItemRenderer } from '~/component/list/renderer/Glyph';
import { _StringEditor } from '~/component/table/cell/editor/String';
import { _NumberEditor } from '~/component/table/cell/editor/Number';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { _ProgressBar } from '~/component/display/ProgressBar';
import { _ProgressSpinner } from '~/component/display/ProgressSpinner';
import { _Slider } from '~/component/input/Slider';
import { _FooterRow } from '~/component/table/Footer';
import { _TableHeader } from '~/component/table/Header';
import { Model } from '~/data/Model';
import { MemoryStore } from '~/data/MemoryStore';
import { VirtualScroller } from '~/component/container/VirtualScroller';
import { Scrollbar } from '~/component/container/Scrollbar';
import { ScrollStrip } from '~/component/container/ScrollStrip';
import { Table } from '~/component/table/Table';
import type { ColumnSpec } from '~/component/table/ColumnConfig';

// `--ts-ui-input-border` must resolve: with the empty `themeVars` every other
// suite uses, the input border measures 0 and every picker case would pass
// vacuously.
const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       { '--ts-ui-input-border': '1px solid rgb(200, 200, 200)' },
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/**
 * `{ x, y, width, height }` of a laid-out child, for rectangle comparison.
 * Folds in the translate offset — a scroll-driven thumb or pooled row keeps
 * its static X/Y pinned and carries its position via `setTranslate` instead,
 * so the static box alone would under-report its true visual rect.
 */
function rect(c: Component): { x: number; y: number; width: number; height: number } {
    return {
        x: c.getX() + c.getTranslateX(),
        y: c.getY() + c.getTranslateY(),
        width: c.getWidth(),
        height: c.getHeight(),
    };
}

/**
 * Renders detached and lays out at the given outer size. Components must stay
 * detached: the modelled DOM source reports `0px` border widths for connected
 * elements, and the pre-attach estimate is what resolves a border offline.
 */
function layOut<T extends Component>(component: T, width: number, height: number): T {
    component.getElement(true);
    component.setWidth(width);
    component.setHeight(height);
    component.doLayout();

    return component;
}

/** Every child's rectangle lies inside the parent's content box. */
function expectChildrenInsideContentBox(parent: Component, children: Component[]): void {
    const box = parent.getContentBounds();

    expect(box).not.toBeNull();
    expect(children.length).toBeGreaterThan(0);

    for (const child of children) {
        expect(child.getX()).toBeGreaterThanOrEqual(box!.x);
        expect(child.getY()).toBeGreaterThanOrEqual(box!.y);
        expect(child.getX() + child.getWidth()).toBeLessThanOrEqual(box!.x + box!.width);
        expect(child.getY() + child.getHeight()).toBeLessThanOrEqual(box!.y + box!.height);
    }
}

/**
 * A border may only shrink the content box. Laying out at `(w, h)` with a
 * `border`-px border must produce exactly the child rectangles that laying out
 * at `(w - 2*border, h - 2*border)` with no border produces.
 *
 * Red on unfixed code, because the bordered run sizes children to the full
 * `w x h`. The unbordered half doubles as the zero-border no-op proof: for a
 * component with no insets and no padding it yields today's numbers unchanged.
 *
 * Only valid for a component that accepts the outer size it is given. One that
 * clamps to its own min/max — a single-line field pinned to 24px, say — commits
 * the same height in both arms, so their content boxes differ by the border and
 * the comparison is meaningless. The committed-size assertions below make that
 * fail loudly instead of silently; use `expectChildrenInsideContentBox` for
 * those components.
 */
function expectBorderOnlyShrinks<T extends Component>(
    make:       () => T,
    childrenOf: (c: T) => Component[],
    w:          number,
    h:          number,
    border:     number,
): void {
    const bordered = make();
    bordered.getElement(true);
    bordered.setBorder(`${border}px solid black`);
    layOut(bordered, w, h);

    // A literal border needs no theme variable; assert it landed so a harness
    // change cannot silently disarm the case.
    expect(bordered.getBorderSize().left).toBe(border);
    expect([bordered.getWidth(), bordered.getHeight()]).toEqual([w, h]);

    // Captured before the second instance exists. `make` may hand back a shared
    // singleton (Tooltip does), in which case reading both arms at the end would
    // compare the same objects to themselves and pass vacuously.
    const borderedRects = childrenOf(bordered).map(rect);

    const bare = make();
    bare.getElement(true);
    bare.setBorder('none');
    layOut(bare, w - 2 * border, h - 2 * border);

    expect(bare.getBorderSize().left).toBe(0);
    expect([bare.getWidth(), bare.getHeight()]).toEqual([w - 2 * border, h - 2 * border]);

    expect(borderedRects).toEqual(childrenOf(bare).map(rect));
}

// The accessor itself, pinned against literal numbers rather than against the
// components that consume it — every containment case below compares children
// to `getContentBounds()`, so a wrong accessor would agree with wrong layout
// code and both would pass.
describe('Component.getContentBounds', () => {
    const boxOf = (configure: (c: Component) => void) => {
        const c = new Component();

        c.getElement(true);
        configure(c);
        c.clearInsets();
        c.setWidth(100);
        c.setHeight(50);

        return c.getContentBounds();
    };

    it('is the full box with no border, insets or padding', () => {
        expect(boxOf(() => {})).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    });

    it('shrinks by a border without moving the origin', () => {
        expect(boxOf(c => c.setBorder('2px solid black')))
            .toEqual({ x: 0, y: 0, width: 96, height: 46 });
    });

    it('offsets the origin by padding and shrinks by both', () => {
        expect(boxOf(c => { c.setBorder('2px solid black'); c.setPadding(new Insets(3, 3, 3, 3)); }))
            .toEqual({ x: 3, y: 3, width: 90, height: 40 });
    });

    it('returns null before the element exists', () => {
        expect(new Component().getContentBounds()).toBeNull();
    });
});

describe('picker fields lay children out inside the content box', () => {
    it('TimeField keeps its input and button within the content box', () => {
        const field = layOut(new TimeField(), 200, 24);

        expect(field.getBorderSize().left).toBe(1);
        expectChildrenInsideContentBox(field, field.getComponents());

        // Literal rectangles, so this does not rest on getContentBounds() being
        // right: padding 3 and border 1 give a (3, 3, 192, 16) content box.
        // Before the fix these were (0, 0, 176, 24) and (176, 0, 24, 24).
        const [input, button] = field.getComponents();

        expect(rect(input)).toEqual({ x: 3, y: 3, width: 168, height: 16 });
        expect(rect(button)).toEqual({ x: 171, y: 3, width: 24, height: 16 });
    });

    it('DateField keeps its input and button within the content box', () => {
        const field = layOut(new DateField(), 160, 24);

        expect(field.getBorderSize().left).toBe(1);
        expectChildrenInsideContentBox(field, field.getComponents());
    });

    it('DateTimeField keeps its input and button within the content box', () => {
        const field = layOut(new DateTimeField(), 200, 24);

        expect(field.getBorderSize().left).toBe(1);
        expectChildrenInsideContentBox(field, field.getComponents());
    });
});

describe('AutoCompleteField', () => {
    it('keeps its inner field within the content box', () => {
        const field = layOut(new AutoCompleteField(), 200, 24);

        expect(field.getBorderSize().left).toBe(1);
        expectChildrenInsideContentBox(field, field.getComponents());
    });

    // The composite adds its own perimeter to the size it mirrors, so it still
    // reports what a bare TextField does rather than the inner field's smaller
    // borderless height.
    it('reports the same preferred height as a bare TextField', () => {
        expect(new AutoCompleteField().getPreferredSize()!.height)
            .toBe(new TextField().getPreferredSize()!.height);
    });

    it('keeps min-height at its preferred height and min-width at 0', () => {
        const field = new AutoCompleteField();

        expect(field.getMinSize()!.height).toBe(field.getPreferredSize()!.height);
        expect(field.getMinSize()!.width).toBe(0);
    });

    // Max is mirrored from the inner field, so a stale inner max leaks straight
    // out here: the composite would report 26 against a sibling TextField's 24
    // and commit 2px taller in a stretching row.
    it('reports the same max height as a bare TextField', () => {
        expect(new AutoCompleteField().getMaxSize()!.height)
            .toBe(new TextField().getMaxSize()!.height);
    });

    // Parity holds on the width axis too. The inner field's width is a flat
    // constant rather than a border-derived one, so adding this component's
    // perimeter to it would make the composite 2px wider than a sibling field
    // and misalign preferred-width form columns.
    it('reports the same preferred width as a bare TextField', () => {
        expect(new AutoCompleteField().getPreferredSize()!.width)
            .toBe(new TextField().getPreferredSize()!.width);
    });
});

describe('TextField one-line box tracks its border', () => {
    it('loses the border height when the border is cleared', () => {
        const field    = new TextField();
        const withBorder = field.getPreferredSize()!.height;

        field.setBorder('none');

        expect(field.getPreferredSize()!.height).toBe(withBorder - 2);
    });

    // A bounded max must move with the line box, or a thicker border pushes min
    // above max and Component.clampHeight then commits the min.
    it('keeps min <= preferred <= max after a thicker border', () => {
        const field = new TextField();

        field.setBorder('3px solid red');

        const min  = field.getMinSize()!.height;
        const pref = field.getPreferredSize()!.height;
        const max  = field.getMaxSize()!.height;

        expect(min).toBeLessThanOrEqual(pref);
        expect(pref).toBeLessThanOrEqual(max);
    });

    // The cell editors unpin max deliberately; an unbounded max stays unbounded.
    it('leaves an unbounded max unbounded', () => {
        const field = new TextField();

        field.setMaxSize({ width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER });
        field.setBorder('none');

        expect(field.getMaxSize()!.height).toBe(Number.MAX_SAFE_INTEGER);
    });

    // NumberSpinner sets a border on its inner field too. Its minimum height
    // was 26 against a preferred of 24 — a min > max envelope violation on a
    // shipped component — because the inner field kept a min derived from the
    // border it had at construction.
    it('leaves NumberSpinner with a consistent size envelope', () => {
        const spinner = new NumberSpinner();
        const min     = spinner.getMinSize()!.height;
        const pref    = spinner.getPreferredSize()!.height;
        const max     = spinner.getMaxSize()!.height;

        expect(min).toBe(new TextField().getPreferredSize()!.height);
        expect(min).toBeLessThanOrEqual(pref);
        expect(pref).toBeLessThanOrEqual(max);
    });
});

describe('ComboBox', () => {
    it('keeps its label and caret within the content box', () => {
        const combo = layOut(new _ComboBox(), 280, 24);

        expect(combo.getBorderSize().left).toBe(1);
        expectChildrenInsideContentBox(combo, combo.getComponents());
    });

    // ComboBox pins its own height, so the shrink-equivalence oracle does not
    // apply, and it has enough internal slack that containment passes either
    // way. Its actual defect is reading `getInsets()` where the contract says
    // `getContentInsets()`: padding must move the children, and did not.
    it('honours its padding when placing the label and caret', () => {
        const combo = new _ComboBox();

        combo.getElement(true);
        combo.setPadding(new Insets(5, 5, 5, 5));
        layOut(combo, 280, 24);

        const box              = combo.getContentBounds()!;
        const [label, caret]   = combo.getComponents();

        // Left-aligned label starts at the content-box origin; right-aligned
        // caret ends at its right edge. Reading `getInsets()` instead ignores
        // the padding and puts both 5px too far left.
        expect(label.getX()).toBe(box.x);
        expect(caret.getX() + caret.getWidth()).toBe(box.x + box.width);
    });

    it('ComboBoxLabel only shrinks its renderer when given a border', () => {
        expectBorderOnlyShrinks(
            () => (new _ComboBox() as any)._label as Component,
            label => [(label as any)._renderer as Component],
            200, 24, 2,
        );
    });
});

describe('Dialog bars', () => {
    const makeDialog = () => new Dialog({
        title:   'T',
        message: 'm',
        buttons: [{ text: 'OK', result: 'confirm' as const }],
    });

    it('DialogTitleBar only shrinks its children when given a border', () => {
        expectBorderOnlyShrinks(
            () => (makeDialog() as any)._titleBar as Component,
            bar => [(bar as any)._titleText, (bar as any)._closeButton].filter(Boolean) as Component[],
            300, 36, 2,
        );
    });

    it('DialogButtonRow only shrinks its buttons when given a border', () => {
        expectBorderOnlyShrinks(
            () => (makeDialog() as any)._buttonRow as Component,
            row => (row as any)._buttons as Component[],
            300, 52, 2,
        );
    });
});

describe('overlays and menus', () => {
    it('Tooltip only shrinks its text when given a border', () => {
        expectBorderOnlyShrinks(
            () => { Tooltip.show('hello', 10, 10); return (Tooltip as any).instance as Component; },
            inst => [(inst as any)._text as Component],
            160, 32, 2,
        );
    });

    it('DragGhost only shrinks its label when given a border', () => {
        expectBorderOnlyShrinks(
            () => new DragGhost('drag me', 100, 30),
            ghost => [(ghost as any)._label as Component],
            100, 30, 2,
        );
    });

    // Containment cannot catch MenuItem: its texts are placed from its
    // own column constants, not from its width, so they sit inside the box
    // whatever the border. Padding is the observable difference — the origin
    // must come from `getContentInsets()`, which includes it.
    it('MenuItem places its texts from the content-box origin', () => {
        const item = new MenuItem({ text: 'File', shortcut: 'Ctrl+F' }, () => {}, () => {});

        item.getElement(true);
        item.setPadding(new Insets(0, 4, 0, 4));
        layOut(item, 200, 24);

        const box   = item.getContentBounds()!;
        const title = (item as any)._titleText as Component;

        expect(box.x).toBe(4);
        // Reading the outer box instead puts the title 4px to the left.
        expect(title.getX()).toBe(box.x + MenuItem.TEXT_INSET);
    });
});

describe('MenuItem labels track the border', () => {
    const noop = () => {};

    it('the borderless case is unchanged', () => {
        const item = layOut(new MenuItem({ text: 'File', shortcut: 'Ctrl+F' }, noop, noop), 200, 24);
        const [iconText, titleText, shortcutText] = item.getComponents();

        for (const label of [iconText, titleText, shortcutText]) {
            expect(label.getY()).toBe(0);
            expect(label.getHeight()).toBe(24);
            // The pin itself, not just the assigned height: doLayout writes the
            // content box's height onto every label whatever the pin says, so
            // getHeight() alone would read 24 even with no pin at all and the
            // labels falling back to the 16px theme line box.
            expect((label as any).getLineHeight()).toBe(24);
        }
    });

    it('padding alone re-pins them, with no border involved', () => {
        // The only case that reaches the pin through the constructor tail
        // rather than through the setBorder override — chrome that is not a
        // border still shrinks the content box.
        const item = new MenuItem(
            { text: 'File' }, noop, noop, 'menu-bar',
            { padding: new Insets(3, 0, 3, 0) }
        );

        layOut(item, 200, 24);

        expect(item.getContentBounds()!.height).toBe(18);
        expect((item as any)._titleText.getLineHeight()).toBe(18);
    });

    it('a runtime border shrinks the labels', () => {
        const item = new MenuItem({ text: 'File', shortcut: 'Ctrl+F' }, noop, noop);

        item.setBorder('2px solid black');
        layOut(item, 200, 24);

        expect(item.getBorderSize().left).toBe(2);
        expect(item.getContentBounds()).toEqual({ x: 0, y: 0, width: 196, height: 20 });

        const [iconText, titleText, shortcutText] = item.getComponents();

        for (const label of [iconText, titleText, shortcutText]) {
            expect(label.getHeight()).toBe(20);
        }

        expectChildrenInsideContentBox(item, item.getComponents());
    });

    it('a border from the options bag shrinks them too', () => {
        const item = new MenuItem({ text: 'File' }, noop, noop, 'menu-bar', { border: '2px solid black' });

        layOut(item, 200, 24);

        expect((item as any)._titleText.getLineHeight()).toBe(20);
    });

    it('the chevron is pinned like the rest', () => {
        const item = new MenuItem(
            { text: 'More', submenu: { label: 'More', items: [] } },
            noop, noop
        );

        item.setBorder('2px solid black');
        layOut(item, 200, 24);

        // The chevron's own pin, so dropping its centerInHeight call is caught:
        // getHeight() would read 20 either way, since doLayout assigns the
        // content box's height and the pin only binds when it is larger.
        expect((item as any)._chevronText.getLineHeight()).toBe(20);
    });

    it('clearing the border restores the full-height pin', () => {
        const item = new MenuItem({ text: 'File' }, noop, noop);

        item.setBorder('2px solid black');
        item.clearBorder();
        layOut(item, 200, 24);

        // Assert the pinned line height, not getHeight(): doLayout assigns the
        // label the content box's height either way, and a stale 20px pin is
        // a *minimum*, so it never binds against 24 and getHeight() reads the
        // same whether clearBorder re-derived the pin or not.
        expect((item as any)._titleText.getLineHeight()).toBe(24);
    });

    it('padding counts as chrome', () => {
        const item = new MenuItem(
            { text: 'File' }, noop, noop, 'menu-bar',
            { padding: new Insets(2, 4, 2, 4), border: '2px solid black' }
        );

        layOut(item, 200, 24);

        expect(item.getContentBounds()!.height).toBe(16);
        expect((item as any)._titleText.getLineHeight()).toBe(16);
    });

    it('a border thicker than the row floors the pin at 1', () => {
        // 12px per side leaves nothing of the 24px row. The pin is clamped
        // rather than allowed to reach 0, which centerInHeight would take as
        // "no line box at all".
        const item = new MenuItem(
            { text: 'File' }, noop, noop, 'menu-bar',
            { border: '12px solid black' }
        );

        layOut(item, 200, 24);

        expect(item.getPerimeterSize().top).toBe(12);
        expect((item as any)._titleText.getLineHeight()).toBe(1);
    });

    it('a bordered separator has nothing to pin', () => {
        const item = new MenuSeparator('menu-bar', { border: '2px solid black' });

        expect(item.getComponents()).toEqual([]);
    });
});

describe('TreeCellRenderer', () => {
    it('only shrinks its delegate when given a border', () => {
        expectBorderOnlyShrinks(
            () => new TreeCellRenderer(new StringRenderer()) as unknown as Component,
            tc => [(tc as any)._delegate as Component],
            150, 22, 2,
        );
    });

    /**
     * Lays out a `TreeCellRenderer` at `depth`, bordered and padded 3px on
     * every side, sized to `w x h`, with a toggle showing. Padding — not the
     * border alone — is what moves the content box's origin off zero, which
     * is what the case above cannot tell apart from `depth * indentPx` on its
     * own; see `## Architecture Decisions` in the plan.
     */
    const layOutPadded = (border: number, depth: number, w: number, h: number): TreeCellRenderer<String | null> => {
        const tc = new TreeCellRenderer(new StringRenderer());

        tc.getElement(true);
        tc.setBorder(border === 0 ? 'none' : `${border}px solid black`);
        tc.setPadding(new Insets(3, 3, 3, 3));
        tc.setTreeState(depth, true, false);
        tc.setWidth(w);
        tc.setHeight(h);
        tc.doLayout();

        return tc;
    };

    it('places the toggle and delegate from the content-box origin, border included', () => {
        const tc = layOutPadded(2, 2, 200, 40);

        expect(tc.getContentBounds()).toEqual({ x: 3, y: 3, width: 190, height: 30 });
        expect(rect(tc.getToggle()!)).toEqual({ x: 35, y: 10, width: 16, height: 16 });
        expect(rect(tc.getDelegate())).toEqual({ x: 55, y: 3, width: 138, height: 30 });
    });

    // A border may only shrink the content box, never move its origin: this
    // borderless renderer, sized down by exactly the border this plan's other
    // case carries, must land on identical toggle and delegate rectangles.
    it('produces identical rectangles borderless, sized down by the border', () => {
        const tc = layOutPadded(0, 2, 196, 36);

        expect(tc.getContentBounds()).toEqual({ x: 3, y: 3, width: 190, height: 30 });
        expect(rect(tc.getToggle()!)).toEqual({ x: 35, y: 10, width: 16, height: 16 });
        expect(rect(tc.getDelegate())).toEqual({ x: 55, y: 3, width: 138, height: 30 });
    });

    // Depth 0 contributes no indent, so an origin error in `box.x + …` cannot
    // hide behind the indent term the way it could at depth 2 above.
    it('pins the indent arithmetic at a depth that contributes nothing', () => {
        const tc = layOutPadded(2, 0, 200, 40);

        expect(rect(tc.getToggle()!)).toEqual({ x: 3, y: 10, width: 16, height: 16 });
        expect(rect(tc.getDelegate())).toEqual({ x: 23, y: 3, width: 170, height: 30 });
    });
});

describe('Cell aligns its editor with the content box', () => {
    /**
     * Builds a `Cell` wrapping a `StringRenderer`, optionally behind a
     * `TreeCellRenderer` at `depth`, sizes it to `w x h`, and opens its
     * per-cell editor. `depth === null` keeps the plain renderer, whose
     * `getContentX()` of `0` takes `alignEditorWithContent`'s early-return
     * path.
     */
    const makeCell = (border: number, pad: number, depth: number | null, w: number, h: number) => {
        const cell = new Cell<String | null>('div', new StringRenderer(), new _StringEditor());

        cell.getElement(true);
        cell.setBorder(border === 0 ? 'none' : `${border}px solid black`);
        cell.setPadding(new Insets(pad, pad, pad, pad));

        if (depth !== null) {
            cell.wrapRenderer((delegate: CellRenderer<String | null>) => new TreeCellRenderer(delegate));
            (cell.getRenderer() as TreeCellRenderer<String | null>).setTreeState(depth, true, false);
        }

        cell.setValue('Component.ts');
        cell.setWidth(w);
        cell.setHeight(h);
        cell.doLayout();
        cell.startEdit();

        return cell;
    };

    /** The delegate renderer's rectangle in the cell's own coordinate space. */
    const delegateRect = (cell: Cell<String | null>) => {
        const renderer = cell.getRenderer() as TreeCellRenderer<String | null>;
        const delegate = renderer.getDelegate();

        return {
            x:      renderer.getX() + delegate.getX(),
            y:      renderer.getY() + delegate.getY(),
            width:  delegate.getWidth(),
            height: delegate.getHeight(),
        };
    };

    it('shrinks the editor to the bordered content box width', () => {
        const cell   = makeCell(2, 0, 2, 200, 24);
        const editor = cell.getEditor()!;

        expect(rect(editor)).toEqual({ x: 52, y: 0, width: 144, height: 20 });
        expect(rect(editor)).toEqual(delegateRect(cell));
    });

    it('offsets the editor origin by padding as well as the content indent', () => {
        const cell   = makeCell(2, 3, 2, 200, 30);
        const editor = cell.getEditor()!;

        expect(rect(editor)).toEqual({ x: 55, y: 3, width: 138, height: 20 });
        expect(rect(editor)).toEqual(delegateRect(cell));
    });

    it('is a no-op on a borderless, unpadded cell', () => {
        const cell   = makeCell(0, 0, 2, 196, 20);
        const editor = cell.getEditor()!;

        expect(rect(editor)).toEqual({ x: 52, y: 0, width: 144, height: 20 });
        expect(rect(editor)).toEqual(delegateRect(cell));
    });

    it('leaves a plain renderer\'s fill-the-cell placement untouched', () => {
        const cell   = makeCell(2, 0, null, 200, 24);
        const editor = cell.getEditor()!;

        expect(rect(editor)).toEqual({ x: 0, y: 0, width: 196, height: 20 });
    });
});

describe('SelectableListRow reserves its separator', () => {
    // The separator moved from the shared class rule onto setBorder, so
    // getBorderSize() can see the pixel it takes out of the row's content box.
    const firstRow = (): Component => {
        const list = new _List();
        list.setItems([{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }] as any);
        layOut(list, 200, 100);

        return (list as any)._rowPool[0] as Component;
    };

    it('measures a 1px bottom border', () => {
        expect(firstRow().getBorderSize().bottom).toBe(1);
    });

    it('keeps its renderer inside the content box', () => {
        const row      = firstRow();
        const renderer = (row as any)._renderer as Component;

        expectChildrenInsideContentBox(row, [renderer]);
        // Literal: a 22px row less the 1px separator, inside 8px of padding.
        // Containment alone would also pass for a renderer that under-fills.
        expect(rect(renderer)).toEqual({ x: 8, y: 0, width: 182, height: 21 });
    });
});

// TreeRow places its own children from `layoutChildren`, not `doLayout`, so the
// sweep that fixed the eleven `doLayout` overrides passed it by. The Tree gives
// every row the same outer height it committed, so the row must take the
// children's box out of its own content box rather than out of that argument.
describe('TreeRow', () => {
    // Indentation per depth level; `Tree` keeps its own copy module-private.
    const INDENT_PX  = 16;
    // Taller than the tree's own 24px rows: the toggle is a rigid 16x16 glyph,
    // so a 24px row bordered on both edges leaves a content box too short to
    // hold it and the containment oracle would fail on correct code too.
    const ROW_HEIGHT = 40;
    const ROW_WIDTH  = 200;

    /**
     * A depth-0 row laid out the way `Tree` does it: commit the outer size
     * first, then hand `layoutChildren` that same outer height.
     *
     * @param border - Border width in pixels; 0 leaves the row borderless.
     * @param loading - True swaps the caret toggle for the loading spinner.
     * @param depth - Zero-based nesting depth, which drives the indent.
     * @param width - Outer width to commit.
     * @param height - Outer height to commit and pass to `layoutChildren`.
     */
    const makeRow = (
        { border = 2, loading = false, depth = 0, width = ROW_WIDTH, height = ROW_HEIGHT } = {},
    ) => {
        const row = new _TreeRow();

        row.getElement(true);
        row.setBorder(border === 0 ? 'none' : `${border}px solid black`);
        row.setPadding(new Insets(3, 3, 3, 3));
        row.setRowData({ label: 'Alpha', hasChildren: true }, depth, true, false, 1, 1, false, loading);
        row.setWidth(width);
        row.setHeight(height);
        row.layoutChildren(height, INDENT_PX);

        return row;
    };

    /** The row's two positioned children: its caret or spinner, and its renderer. */
    const childrenOf = (row: InstanceType<typeof _TreeRow>): Component[] => [
        (row.getToggle() ?? (row as any)._spinner) as Component,
        (row as any)._renderer as Component,
    ];

    it('keeps its toggle and renderer inside the content box', () => {
        const row = makeRow();

        expect(row.getBorderSize().left).toBe(2);
        expectChildrenInsideContentBox(row, childrenOf(row));
    });

    // The spinner replaces the toggle on a lazily-loading node and is placed by
    // the same code, so it needs its own guard: it is the one child whose
    // height is written straight from the box rather than from a pinned glyph.
    // Depth is the one input that feeds the origin arithmetic
    // (`box.x + depth * indentPx`), so a sign or origin error would hide at the
    // depth 0 every other case uses.
    it('offsets a nested row by its indent from the content-box origin', () => {
        const row = makeRow({ depth: 3 });

        expectChildrenInsideContentBox(row, [row.getToggle()!, (row as any)._renderer as Component]);
        // Content box (3, 3, 190, 30); depth 3 at 16px indents 48 past its x.
        expect(row.getToggle()!.getX()).toBe(3 + 48);
        expect((row as any)._renderer.getX()).toBe(3 + 48 + 20);
    });

    it('keeps a loading row spinner inside the content box', () => {
        const row = makeRow({ loading: true });

        expect(row.getToggle()).toBeNull();
        expectChildrenInsideContentBox(row, childrenOf(row));
    });

    // Every shipped theme leaves tree rows borderless, so that is the path all
    // real traffic takes and the one a regression would hit first. A border may
    // only shrink the content box: laying out at 200x40 with a 2px border must
    // place the children exactly where laying out at 196x36 with none does,
    // because both give the same (3, 3, 190, 30) content box. The borderless
    // arm doubles as the no-op proof that this change moved nothing today.
    for (const loading of [false, true]) {
        it(`places a ${loading ? 'loading' : 'parent'} row's children identically with and without a border`, () => {
            const bordered = makeRow({ border: 2, loading });
            const bare     = makeRow({ border: 0, loading, width: ROW_WIDTH - 4, height: ROW_HEIGHT - 4 });

            expect(bordered.getBorderSize().left).toBe(2);
            expect(bare.getBorderSize().left).toBe(0);
            expect(bordered.getContentBounds()).toEqual(bare.getContentBounds());

            expect(childrenOf(bordered).map(rect)).toEqual(childrenOf(bare).map(rect));
        });
    }

    // Literal rectangles: containment alone would also pass for children that
    // under-fill the row. Border 2 and padding 3 give a (3, 3, 190, 30) content
    // box. Before the fix the toggle sat at x 0 and the renderer was placed at
    // (20, 0) sized 180x40 — the row's full border box.
    //
    // The toggle commits 16 wide, not the 20 it is given: it is a rigid glyph
    // with min and max pinned to its 16x16 preferred size, so `clampWidth`
    // caps it. Only its origin is this code's to get right.
    it('places them against the content box, not the border box', () => {
        const row      = makeRow();
        const renderer = (row as any)._renderer as Component;

        expect(rect(row.getToggle()!)).toEqual({ x: 3, y: 10, width: 16, height: 16 });
        expect(rect(renderer)).toEqual({ x: 23, y: 3, width: 170, height: 30 });
    });
});

// The row renderers are the same defect one level down: each places its label —
// and, for the icon variants, its glyph — at (0, 0) against the extent its row
// hands it, which is that renderer's own outer box. Unlike `TreeRow` these are
// public and consumer-subclassable, so a consumer who borders one is a supported
// case rather than a hypothetical.
describe('row renderers place their children inside the content box', () => {
    // A name of its own: registering one of the shared demo glyph names would
    // collide with whatever another suite in the same worker registered.
    const ICON_GLYPH = 'content-box-probe';

    beforeAll(() => Glyph.register({ name: ICON_GLYPH, kind: 'char', char: 'P' }));

    const WIDTH  = 200;
    // Tall enough that a bordered, padded content box still clears the rigid
    // 16px icon; a 24px row would not, and the icon would overflow either way.
    const HEIGHT = 40;

    /**
     * Sizes a renderer and drives its `layoutChildren` the way a row does:
     * commit the outer size, then pass that same extent.
     *
     * @param renderer - The renderer under test.
     * @param bind - Feeds the renderer its render context, building any icon.
     * @param border - Border width in pixels; 0 leaves the renderer borderless.
     * @param width - Outer width to commit and pass.
     * @param height - Outer height to commit and pass.
     */
    const layOutRenderer = <T extends Component>(
        renderer: T,
        bind:     (r: T) => void,
        border:   number,
        width:    number,
        height:   number,
    ): T => {
        renderer.getElement(true);
        renderer.setBorder(border === 0 ? 'none' : `${border}px solid black`);
        renderer.setPadding(new Insets(3, 3, 3, 3));
        bind(renderer);
        renderer.setWidth(width);
        renderer.setHeight(height);
        (renderer as any).layoutChildren(width, height);

        return renderer;
    };

    const treeContext = { node: { label: 'Alpha' }, depth: 0, expanded: false, selected: false, hasChildren: false };
    const listItem    = (glyph?: string) => ({ item: { key: 'a', label: 'Alpha', glyph }, index: 0 });

    /** Each renderer, its binder, and the children it positions. */
    const CASES: Array<[string, () => Component, (r: any) => void, (r: any) => Component[]]> = [
        [
            'LabelTreeNodeRenderer',
            () => new LabelTreeNodeRenderer(),
            r => r.update(treeContext),
            r => [r._label],
        ],
        [
            'IconLabelTreeNodeRenderer',
            () => new IconLabelTreeNodeRenderer(() => ICON_GLYPH),
            r => r.update(treeContext),
            r => [r._icon, r._label].filter(Boolean),
        ],
        [
            'LabelListItemRenderer',
            () => new _LabelListItemRenderer(),
            r => r.update(listItem()),
            r => [r._label],
        ],
        [
            'GlyphListItemRenderer',
            () => new _GlyphListItemRenderer(),
            r => r.update(listItem(ICON_GLYPH)),
            r => [r._icon, r._label].filter(Boolean),
        ],
    ];

    for (const [label, make, bind, childrenOf] of CASES) {
        it(`${label} keeps its children inside the content box`, () => {
            const renderer = layOutRenderer(make(), bind, 2, WIDTH, HEIGHT);

            expect(renderer.getBorderSize().left).toBe(2);
            expect(childrenOf(renderer).length).toBeGreaterThan(0);
            expectChildrenInsideContentBox(renderer, childrenOf(renderer));
        });

        // Both arms are padded, so this pins border-shrink equivalence rather
        // than the shipped (0, 0) configuration.
        it(`${label} places them identically with and without a border`, () => {
            const bordered = layOutRenderer(make(), bind, 2, WIDTH, HEIGHT);
            const bare     = layOutRenderer(make(), bind, 0, WIDTH - 4, HEIGHT - 4);

            expect(bordered.getContentBounds()).toEqual(bare.getContentBounds());
            expect(childrenOf(bordered).map(rect)).toEqual(childrenOf(bare).map(rect));
        });
    }
});

// The cell editors unpin their inner field's max size so it can fill the cell,
// and then set a border on it. Re-deriving the one-line box on `setBorder` must
// not re-pin that max, or the field collapses to one line inside a taller row.
describe('cell editors keep their field fillable after setting a border', () => {
    for (const [label, make] of [
        ['StringEditor', () => new _StringEditor()],
        ['NumberEditor', () => new _NumberEditor()],
    ] as const) {
        it(`${label}'s field still fills a 24px row`, () => {
            const editor = make() as unknown as Component;
            const field  = (editor as any)._textField as Component;

            layOut(editor, 120, 24);

            expect(field.getHeight()).toBe(24);
        });
    }
});

// These three place their children from `getInnerSize()`. That is the right
// extent and the wrong origin: the inner size already has the padding taken
// out of it, and putting a child at 0 then ignores that padding, starting the
// child at the inner edge of the border instead of inside the padding. All
// three carry no padding by default, so this is latent until a consumer sets
// some — which is why the cases below set it rather than a border. The
// expected rectangles come from the content box, not from what the code emits.
describe('progress and slider chrome starts at the content origin', () => {
    const PAD = 4;

    /** Renders detached with uniform padding and lays out at the outer size. */
    const withPadding = <T extends Component>(c: T, w: number, h: number, pad = PAD): T => {
        c.getElement(true);
        c.clearInsets();
        c.setPadding(new Insets(pad, pad, pad, pad));

        return layOut(c, w, h);
    };

    it('ProgressBar puts its track at the content origin', () => {
        const bar = new _ProgressBar() as unknown as Component;

        (bar as any).setValue(50);
        withPadding(bar, 200, 24);

        // 200x24 less 4px of padding all round.
        expect(bar.getContentBounds()).toEqual({ x: 4, y: 4, width: 192, height: 16 });
        expect(rect((bar as any)._track)).toEqual({ x: 4, y: 4, width: 192, height: 16 });
        // The fill is a child of the track, so its own origin stays at zero.
        expect(rect((bar as any)._fill)).toEqual({ x: 0, y: 0, width: 96, height: 16 });
    });

    it('ProgressSpinner centres its arc in the content box', () => {
        const spinner = new _ProgressSpinner() as unknown as Component;

        withPadding(spinner, 48, 48);

        // A 48x48 box less 4px all round leaves 40x40. The arc takes the
        // spinner's own diameter, which with no `--ts-ui-font-size` in the
        // harness is the 14px fallback, centred in that 40: 4 + (40-14)/2 = 17.
        // Literal on purpose — deriving the centre from the arc's own measured
        // width would accept any diameter, including a collapsed one.
        expect(spinner.getContentBounds()).toEqual({ x: 4, y: 4, width: 40, height: 40 });
        expect(rect((spinner as any)._arc)).toEqual({ x: 17, y: 17, width: 14, height: 14 });
    });

    // Padding on the main axis only: a Slider pins its cross-axis maximum to
    // the 16px thumb, so cross-axis padding would leave the thumb no room and
    // the case would be testing the clamp rather than the origin.
    it('a horizontal Slider starts its track and thumb at the content origin', () => {
        const slider = new _Slider() as unknown as Component;

        slider.getElement(true);
        slider.clearInsets();
        slider.setPadding(new Insets(0, PAD, 0, PAD));
        (slider as any).setValue(50);
        layOut(slider, 200, 16);

        expect(slider.getContentBounds()).toEqual({ x: 4, y: 0, width: 192, height: 16 });
        // Track spans the content width, centred on the 4px-thick track band.
        expect(rect((slider as any)._track)).toEqual({ x: 4, y: 6, width: 192, height: 4 });
        // Thumb is 16px, half way along the 192px content width.
        expect(rect((slider as any)._thumb)).toEqual({ x: 4 + 88, y: 0, width: 16, height: 16 });
    });

    it('a vertical Slider starts its track and thumb at the content origin', () => {
        const slider = new _Slider({ orientation: 'vertical' }) as unknown as Component;

        slider.getElement(true);
        slider.clearInsets();
        slider.setPadding(new Insets(PAD, 0, PAD, 0));
        (slider as any).setValue(50);
        layOut(slider, 16, 200);

        expect(slider.getContentBounds()).toEqual({ x: 0, y: 4, width: 16, height: 192 });
        expect(rect((slider as any)._track)).toEqual({ x: 6, y: 4, width: 4, height: 192 });
        expect(rect((slider as any)._thumb)).toEqual({ x: 0, y: 4 + 88, width: 16, height: 16 });
    });
});

// A table's header and footer band forward their own outer width and height to
// the inner row, which is a child and therefore already inside the band's
// border. Neither is observable today — no footer is ever displayed, and the
// table layout manager reassigns the header's row widths straight afterwards —
// so these cases are the only thing holding the arithmetic honest.
describe('table bands size their inner rows to the content box', () => {
    const MODEL = new Model([{ name: 'a', type: 'string', order: 0 }], 'a');

    it('FooterRow only shrinks its row when given a border', () => {
        expectBorderOnlyShrinks(
            () => new _FooterRow() as unknown as Component,
            f => [f.getComponents()[0]],
            300, 24, 2,
        );
    });

    it('TableHeader only shrinks its rows when given a border', () => {
        expectBorderOnlyShrinks(
            () => new _TableHeader(MODEL, new MemoryStore(MODEL, [])) as unknown as Component,
            h => h.getComponents(),
            300, 24, 2,
        );
    });
});

/** The accumulated inline style a raw handle has been written, last write wins. */
function styleOf(sink: RecordingDOMSink, handle: Handle): Record<string, string | null> {
    const style: Record<string, string | null> = {};

    for (const write of sink.writes) {
        if (write.op === 'apply' && write.args[0] === handle) {
            Object.assign(style, (write.args[1] as { style?: Record<string, string | null> }).style ?? {});
        }
    }

    return style;
}

// TRACK_WIDTH read off a real Scrollbar rather than hard-coded, per the plan's
// Expected Behaviour section. Constructing it before any installTestDOM() call
// is safe: construction is DOM-write-buffered only (no DOM read), matching
// VirtualScroller.test.ts's module-level use of the same pattern.
const TRACK_WIDTH = new Scrollbar('vertical').getTrackWidth();

// VirtualScroller is not a Component: it owns raw `clipBox` / `rowsContainer`
// handles it creates directly, so its scrollbars and clip box are placed in
// the owner's content box rather than through getContentBounds() on itself.
describe('VirtualScroller places its bars and clip box in the owner content box', () => {
    /** A sized, detached owner Container wired to a fresh VirtualScroller. */
    function makeScroller(width: number, height: number, configure?: (owner: Container) => void): { owner: Container; scroller: VirtualScroller } {
        const owner = new Container();

        owner.getElement(true);
        configure?.(owner);
        owner.setWidth(width);
        owner.setHeight(height);

        const scroller = new VirtualScroller(owner, owner.getElement(true)!, () => {});

        return { owner, scroller };
    }

    it('keeps both bars and the clip box inside a bordered owner\'s content box', () => {
        const sink = installTestDOM(CONFIG);
        const { owner, scroller } = makeScroller(200, 400, o => o.setBorder('2px solid black'));

        expect(owner.getBorderSize().left).toBe(2);
        expect(owner.getContentBounds()).toEqual({ x: 0, y: 0, width: 196, height: 396 });

        scroller.layoutScrollbars(100, 1000);

        const [vBar, hBar] = [(scroller as any)._scrollbarV as Scrollbar, (scroller as any)._scrollbarH as Scrollbar];
        const clipBox = scroller.ownedHandles()[0];

        expect(rect(vBar)).toEqual({ x: 184, y: 0, width: TRACK_WIDTH, height: 396 });
        expect(rect(hBar)).toEqual({ x: 0, y: 384, width: 184, height: TRACK_WIDTH });
        expect(styleOf(sink, clipBox)).toMatchObject({ left: '0px', top: '0px', width: '184px', height: '396px' });
    });

    it('the borderless arm is unchanged', () => {
        const sink = installTestDOM(CONFIG);
        const { scroller } = makeScroller(196, 396, o => o.setBorder('none'));

        scroller.layoutScrollbars(100, 1000);

        const [vBar, hBar] = [(scroller as any)._scrollbarV as Scrollbar, (scroller as any)._scrollbarH as Scrollbar];
        const clipBox = scroller.ownedHandles()[0];

        expect(rect(vBar)).toEqual({ x: 184, y: 0, width: TRACK_WIDTH, height: 396 });
        expect(rect(hBar)).toEqual({ x: 0, y: 384, width: 184, height: TRACK_WIDTH });
        expect(styleOf(sink, clipBox)).toMatchObject({ left: '0px', top: '0px', width: '184px', height: '396px' });
    });

    it('a padded owner offsets the whole rectangle', () => {
        const sink = installTestDOM(CONFIG);
        const { owner, scroller } = makeScroller(200, 400, o => o.setPadding(new Insets(5, 5, 5, 5)));

        expect(owner.getContentBounds()).toEqual({ x: 5, y: 5, width: 190, height: 390 });

        scroller.layoutScrollbars(100, 1000);

        const [vBar, hBar] = [(scroller as any)._scrollbarV as Scrollbar, (scroller as any)._scrollbarH as Scrollbar];
        const clipBox = scroller.ownedHandles()[0];

        expect(rect(vBar)).toEqual({ x: 183, y: 5, width: TRACK_WIDTH, height: 390 });
        expect(rect(hBar)).toEqual({ x: 5, y: 383, width: 178, height: TRACK_WIDTH });
        expect(styleOf(sink, clipBox)).toMatchObject({ left: '5px', top: '5px', width: '178px', height: '390px' });
    });
});

// ScrollStrip.layoutContent places the inner clip and (via layoutArrows) the
// two paging arrows against its own outer box today; both must stay inside
// the content box the owner-driven band resolves.
describe('ScrollStrip.layoutContent keeps the clip and both arrows inside the content box', () => {
    it('a bordered horizontal strip', () => {
        const strip = new ScrollStrip();

        strip.getElement(true);
        strip.setBorder('2px solid black');
        strip.setWidth(300);
        strip.setHeight(30);

        expect(strip.getBorderSize().left).toBe(2);
        expect(strip.getContentBounds()).toEqual({ x: 0, y: 0, width: 296, height: 26 });

        strip.layoutContent(24, 0);

        const clip = (strip as any)._clip as Component;
        const lead = (strip as any)._leadArrow as Component;
        const trail = (strip as any)._trailArrow as Component;

        expect(rect(clip)).toEqual({ x: 24, y: 0, width: 248, height: 26 });
        expect(rect(lead)).toEqual({ x: 0, y: 0, width: 24, height: 26 });
        expect(rect(trail)).toEqual({ x: 272, y: 0, width: 24, height: 26 });
    });

    it('the borderless arm is unchanged', () => {
        const strip = new ScrollStrip();

        strip.getElement(true);
        strip.setBorder('none');
        strip.setWidth(296);
        strip.setHeight(26);

        strip.layoutContent(24, 0);

        const clip = (strip as any)._clip as Component;
        const lead = (strip as any)._leadArrow as Component;
        const trail = (strip as any)._trailArrow as Component;

        expect(rect(clip)).toEqual({ x: 24, y: 0, width: 248, height: 26 });
        expect(rect(lead)).toEqual({ x: 0, y: 0, width: 24, height: 26 });
        expect(rect(trail)).toEqual({ x: 272, y: 0, width: 24, height: 26 });
    });

    it('a bordered vertical strip', () => {
        const strip = new ScrollStrip({ orientation: 'vertical' });

        strip.getElement(true);
        strip.setBorder('2px solid black');
        strip.setWidth(30);
        strip.setHeight(300);

        strip.layoutContent(24, 0);

        const clip = (strip as any)._clip as Component;
        const lead = (strip as any)._leadArrow as Component;
        const trail = (strip as any)._trailArrow as Component;

        expect(rect(clip)).toEqual({ x: 0, y: 24, width: 26, height: 248 });
        expect(rect(lead)).toEqual({ x: 0, y: 0, width: 26, height: 24 });
        expect(rect(trail)).toEqual({ x: 0, y: 272, width: 26, height: 24 });
    });

    // A border never moves the content-box origin (the above cases all resolve
    // to x/y 0), so padding is the only lever that proves the box's ORIGIN —
    // not just its shrunk extent — reaches the writes in layoutContent and
    // layoutArrows. Both orientations need their own padded arm: the two
    // branches share no origin write, so a padded horizontal case leaves every
    // vertical one unpinned.
    it('a padded strip offsets the clip and both arrows, with no border involved', () => {
        const strip = new ScrollStrip();

        strip.getElement(true);
        strip.setPadding(new Insets(4, 4, 4, 4));
        strip.setWidth(300);
        strip.setHeight(30);

        expect(strip.getContentBounds()).toEqual({ x: 4, y: 4, width: 292, height: 22 });

        strip.layoutContent(24, 0);

        const clip = (strip as any)._clip as Component;
        const lead = (strip as any)._leadArrow as Component;
        const trail = (strip as any)._trailArrow as Component;

        expect(rect(clip)).toEqual({ x: 28, y: 4, width: 244, height: 22 });
        expect(rect(lead)).toEqual({ x: 4, y: 4, width: 24, height: 22 });
        expect(rect(trail)).toEqual({ x: 272, y: 4, width: 24, height: 22 });
    });

    // The vertical arm of the same writes. TabBar switches its strip to
    // vertical, so this branch is live code, and it shares no origin write
    // with the horizontal one above.
    it('a padded vertical strip offsets the clip and both arrows', () => {
        const strip = new ScrollStrip({ orientation: 'vertical' });

        strip.getElement(true);
        strip.setPadding(new Insets(4, 4, 4, 4));
        strip.setWidth(30);
        strip.setHeight(300);

        expect(strip.getContentBounds()).toEqual({ x: 4, y: 4, width: 22, height: 292 });

        strip.layoutContent(24, 0);

        const clip = (strip as any)._clip as Component;
        const lead = (strip as any)._leadArrow as Component;
        const trail = (strip as any)._trailArrow as Component;

        expect(rect(clip)).toEqual({ x: 4, y: 28, width: 22, height: 244 });
        expect(rect(lead)).toEqual({ x: 4, y: 4, width: 22, height: 24 });
        expect(rect(trail)).toEqual({ x: 4, y: 272, width: 22, height: 24 });
    });
});

// Scrollbar.setMetrics places the thumb and (when enabled) both arrows
// against the bar's own outer box today; all three must stay inside its
// content box, projected onto the scroll axis.
describe('Scrollbar.setMetrics keeps the thumb and both arrows inside the content box', () => {
    /** The committed thumb child — Scrollbar adds it first. */
    const thumb = (bar: Scrollbar): Component => bar.getComponents()[0];
    const arrowStart = (bar: Scrollbar): Component => (bar as any)._arrowStart as Component;
    const arrowEnd = (bar: Scrollbar): Component => (bar as any)._arrowEnd as Component;

    it('a bordered vertical bar', () => {
        const bar = new Scrollbar('vertical');

        bar.getElement(true);
        bar.setBorder('2px solid black');
        bar.setHeight(200);

        expect(bar.getBorderSize().left).toBe(2);
        expect(bar.getContentBounds()).toEqual({ x: 0, y: 0, width: TRACK_WIDTH - 4, height: 196 });

        bar.setMetrics(200, 1000, 0);

        expect(rect(thumb(bar))).toEqual({ x: 2, y: 12, width: 4, height: 34 });
        // Width 8, not TRACK_WIDTH: an arrow is built as a rigid 12px square,
        // so the cross axis has to be re-derived or it overruns the 8-wide
        // content box by the two 2px border sides. The main axis stays 12 —
        // that is the gutter getTrackLength reserves at each end.
        expect(rect(arrowStart(bar))).toEqual({ x: 0, y: 0, width: 8, height: TRACK_WIDTH });
        expect(rect(arrowEnd(bar))).toEqual({ x: 0, y: 184, width: 8, height: TRACK_WIDTH });
    });

    // A border never moves the content-box origin (the case above resolves to
    // origin 0 on both axes), so padding is the only lever that proves the
    // box's ORIGIN — not just its shrunk extent — reaches the thumb and both
    // arrows through axisBox().
    it('a padded bar offsets the thumb and both arrows, with no border involved', () => {
        const bar = new Scrollbar('vertical');

        bar.getElement(true);
        bar.setPadding(new Insets(2, 2, 2, 2));
        bar.setHeight(200);

        expect(bar.getContentBounds()).toEqual({ x: 2, y: 2, width: TRACK_WIDTH - 4, height: 196 });

        bar.setMetrics(200, 1000, 0);

        expect(rect(thumb(bar))).toEqual({ x: 4, y: 14, width: 4, height: 34 });
        expect(rect(arrowStart(bar))).toEqual({ x: 2, y: 2, width: 8, height: TRACK_WIDTH });
        expect(rect(arrowEnd(bar))).toEqual({ x: 2, y: 186, width: 8, height: TRACK_WIDTH });
    });

    it('main-axis parity with a shorter borderless bar', () => {
        const bordered = new Scrollbar('vertical');

        bordered.getElement(true);
        bordered.setBorder('2px solid black');
        bordered.setHeight(200);
        bordered.setMetrics(200, 1000, 0);

        const bare = new Scrollbar('vertical');

        bare.getElement(true);
        bare.setBorder('none');
        bare.setHeight(196);
        bare.setMetrics(200, 1000, 0);

        expect(thumb(bare).getTranslateY()).toBe(thumb(bordered).getTranslateY());
        expect(thumb(bare).getHeight()).toBe(thumb(bordered).getHeight());
        expect(arrowEnd(bare).getY()).toBe(arrowEnd(bordered).getY());

        // The cross axis differs by design: the borderless bar keeps today's
        // shipped 8px-wide thumb at x 2, since it has no border to shrink it.
        expect(rect(thumb(bare))).toEqual({ x: 2, y: 12, width: 8, height: 34 });
    });

    it('arrows disabled', () => {
        const bar = new Scrollbar('vertical', { arrowsEnabled: false });

        bar.getElement(true);
        bar.setBorder('2px solid black');
        bar.setHeight(200);

        bar.setMetrics(200, 1000, 0);

        expect(thumb(bar).getY()).toBe(0);
        expect(thumb(bar).getTranslateY()).toBe(0);
        expect(thumb(bar).getHeight()).toBe(39);
    });

    // The horizontal branch is the one VirtualScroller and Panel's overlay
    // actually instantiate, and it is a separate arm of every write in
    // setMetrics — the vertical cases above pin none of it.
    it('a bordered horizontal bar', () => {
        const bar = new Scrollbar('horizontal');

        bar.getElement(true);
        bar.setBorder('2px solid black');
        bar.setWidth(200);

        expect(bar.getContentBounds()).toEqual({ x: 0, y: 0, width: 196, height: TRACK_WIDTH - 4 });

        bar.setMetrics(200, 1000, 0);

        expect(rect(thumb(bar))).toEqual({ x: 12, y: 2, width: 34, height: 4 });
        expect(rect(arrowStart(bar))).toEqual({ x: 0, y: 0, width: TRACK_WIDTH, height: 8 });
        expect(rect(arrowEnd(bar))).toEqual({ x: 184, y: 0, width: TRACK_WIDTH, height: 8 });
    });

    it('a padded horizontal bar offsets the thumb and both arrows', () => {
        const bar = new Scrollbar('horizontal');

        bar.getElement(true);
        bar.setPadding(new Insets(2, 2, 2, 2));
        bar.setWidth(200);

        expect(bar.getContentBounds()).toEqual({ x: 2, y: 2, width: 196, height: TRACK_WIDTH - 4 });

        bar.setMetrics(200, 1000, 0);

        expect(rect(thumb(bar))).toEqual({ x: 14, y: 4, width: 34, height: 4 });
        expect(rect(arrowStart(bar))).toEqual({ x: 2, y: 2, width: TRACK_WIDTH, height: 8 });
        expect(rect(arrowEnd(bar))).toEqual({ x: 186, y: 2, width: TRACK_WIDTH, height: 8 });
    });
});

// _onTrackClick compares a pointer coordinate against axisBox()'s
// content-box-relative numbers, and its two input branches arrive in
// different spaces: offsetX/offsetY is padding-box-relative, while
// getViewportRect is the border box. Both must land on the same track
// coordinate or a bordered bar pages the wrong way near the ends.
describe('Scrollbar track click measures the content box', () => {
    /** Fires the private track-click handler and returns the scroll it emitted, or null. */
    function trackClick(bar: Scrollbar, event: Record<string, unknown>): number | null {
        let emitted: number | null = null;

        bar.on('scroll', (position: number) => { emitted = position; });
        (bar as any)._onTrackClick({ preventDefault: () => {}, ...event });

        return emitted;
    }

    /** A bordered vertical bar sized and positioned so the viewport rect resolves. */
    function borderedBar(): Scrollbar {
        const bar = new Scrollbar('vertical');

        bar.getElement(true);
        bar.setBorder('2px solid black');
        bar.setX(0);
        bar.setY(0);
        bar.setHeight(200);
        bar.setMetrics(200, 1000, 0);

        return bar;
    }

    /** The horizontal twin — the orientation VirtualScroller and Panel's overlay build. */
    function borderedHorizontalBar(): Scrollbar {
        const bar = new Scrollbar('horizontal');

        bar.getElement(true);
        bar.setBorder('2px solid black');
        bar.setX(0);
        bar.setY(0);
        bar.setWidth(200);
        bar.setMetrics(200, 1000, 0);

        return bar;
    }

    it('mouse and touch agree on the same point', () => {
        // Probed at the start arrow's boundary, where the 2px difference
        // decides the outcome rather than being absorbed: the track begins at
        // content y 12, so a touch at viewport y 13 is y 11 in the content box
        // and belongs to the arrow. Without the border subtraction it reads as
        // 13 and pages instead. A mouse offsetY is already padding-box-relative,
        // so 11 is the same point and must give the same answer.
        expect(trackClick(borderedBar(), { touches: [{ clientY: 13 }], changedTouches: [] })).toBeNull();
        expect(trackClick(borderedBar(), { offsetY: 11 })).toBeNull();

        // Two pixels further in, both branches agree the click is on the track.
        expect(trackClick(borderedBar(), { touches: [{ clientY: 15 }], changedTouches: [] })).toBe(0);
        expect(trackClick(borderedBar(), { offsetY: 13 })).toBe(0);
    });

    it('pages backwards above the thumb and forwards below it', () => {
        expect(trackClick(borderedBar(), { offsetY: 150 })).toBe(200);
        // At scroll 0 the thumb sits at the top, so a click above its centre
        // clamps to 0 rather than going negative.
        expect(trackClick(borderedBar(), { offsetY: 14 })).toBe(0);
    });

    it('ignores clicks inside either arrow region', () => {
        // The end arrow starts at content-box y 184, not outer y 188: reading
        // the outer box would let a click at 185 through as a track page.
        expect(trackClick(borderedBar(), { offsetY: 185 })).toBeNull();
        expect(trackClick(borderedBar(), { offsetY: 5 })).toBeNull();
    });

    // The horizontal arm subtracts border.left rather than border.top, and is
    // a separate line: the vertical cases above pin none of it.
    it('mouse and touch agree on the same point, horizontally', () => {
        expect(trackClick(borderedHorizontalBar(), { touches: [{ clientX: 13 }], changedTouches: [] })).toBeNull();
        expect(trackClick(borderedHorizontalBar(), { offsetX: 11 })).toBeNull();

        expect(trackClick(borderedHorizontalBar(), { touches: [{ clientX: 15 }], changedTouches: [] })).toBe(0);
        expect(trackClick(borderedHorizontalBar(), { offsetX: 13 })).toBe(0);
    });
});

// The table's layout manager is the one place in this suite that reaches past
// its own container into a CHILD's subtree — TableHeader's and FooterRow's
// rows and cells — which is exactly what `local/require-content-bounds`
// cannot see (it is scoped to a component placing ITS OWN children; see the
// rule's own exemption comment). `layout/Table.doLayout` split the header
// band's full outer height between the parent row and the column row and
// gave every header cell that height, so the rows' containing block — the
// header's own content box, one pixel shorter than the band because of its
// shipped bottom border — was overrun by exactly the border width, and the
// header's `overflow: hidden` took the pixel off every header cell. The fix
// grows the band by the header's own perimeter instead, then places both rows
// from `header.getContentBounds()`.
describe('a table header band contains its rows and cells', () => {
    const TABLE_MODEL = new Model([
        { name: 'a', type: 'string', order: 0 },
        { name: 'b', type: 'string', order: 1 },
    ]);

    /** A two-string-column table over an empty, unloaded store — no record data is needed to exercise the header/footer band geometry. */
    function makeTable(spec?: ColumnSpec): InstanceType<typeof Table> {
        return new Table(new MemoryStore(TABLE_MODEL, []), spec);
    }

    it('grows the band by its own border and keeps the column row and cells inside it', () => {
        const table  = layOut(makeTable(), 400, 300);
        const header = table.getHeader();

        // Harness pin: a harness change must fail loudly here rather than
        // shifting every literal below.
        expect(table.getInnerSize()).toEqual({ width: 398, height: 298 });
        expect(table.getBorderSize().top).toBe(1);

        expect(header.getHeight()).toBe(21);
        expect(header.getContentBounds()!.height).toBe(20);
        expect(header.getParentRow().getHeight()).toBe(0);

        const columnRow = header.getComponents()[1];
        expect(columnRow.getY()).toBe(0);
        expect(columnRow.getHeight()).toBe(20);
        expect(header.getColumns()[0].getHeight()).toBe(20);

        const body = table.getBody();
        expect(body.getY()).toBe(21);
        expect(body.getHeight()).toBe(277);
    });

    it('splits the grown band between the parent row and the column row when grouped', () => {
        const spec: ColumnSpec = { columns: [
            { field: 'a', group: 'G' },
            { field: 'b', group: 'G' },
        ] };
        const table  = layOut(makeTable(spec), 400, 300);
        const header = table.getHeader();

        expect(header.hasParentRow()).toBe(true);
        expect(header.getHeight()).toBe(41);
        expect(header.getContentBounds()!.height).toBe(40);

        const parentRow = header.getParentRow();
        expect(parentRow.getY()).toBe(0);
        expect(parentRow.getHeight()).toBe(20);

        const columnRow = header.getComponents()[1];
        expect(columnRow.getY()).toBe(20);
        expect(columnRow.getHeight()).toBe(20);

        const body = table.getBody();
        expect(body.getY()).toBe(41);
        expect(body.getHeight()).toBe(257);
    });

    // The no-op proof: a border may only shrink the content box, never expand
    // the band. Every number here is identical before and after the fix.
    it('is a no-op on a borderless header', () => {
        const table = makeTable();

        table.getHeader().clearBorder();

        const header = layOut(table, 400, 300).getHeader();

        expect(header.getBorderSize().bottom).toBe(0);
        expect(header.getHeight()).toBe(20);
        expect(header.getContentBounds()!.height).toBe(20);

        const columnRow = header.getComponents()[1];
        expect(columnRow.getY()).toBe(0);
        expect(columnRow.getHeight()).toBe(20);

        expect(table.getBody().getY()).toBe(20);
    });

    // A border never moves the content-box origin — the cases above all
    // resolve to (0, 0) whether or not the fix reads `headerBox.x`/`.y` at
    // all. Padding is the only lever that tells a real content-box read
    // apart from a hardcoded 0: the header carries no left/right/top border
    // by default, so padding alone drives this without a border in the mix.
    it('offsets the rows from a padded header\'s content-box origin, with no border involved', () => {
        const table  = makeTable();
        const header = table.getHeader();

        header.clearBorder();
        header.setPadding(new Insets(4, 4, 4, 4));

        layOut(table, 400, 300);

        expect(header.getContentBounds()).toEqual({ x: 4, y: 4, width: 390, height: 20 });

        const parentRow = header.getParentRow();
        expect(parentRow.getX()).toBe(4);
        expect(parentRow.getY()).toBe(4);

        const columnRow = header.getComponents()[1];
        expect(columnRow.getX()).toBe(4);
        expect(columnRow.getY()).toBe(4);
    });

    // The case that fails loudest: a 6px border leaves only 8px of content box
    // under the unfixed arithmetic, clipping 12 of a 16px text line. The fix
    // must grow the band to 32, not shrink the cells.
    it('grows the band to fit a thick border without shrinking the cells or the row width floor', () => {
        const table = makeTable();

        table.getHeader().setBorder('6px solid black');

        const header = layOut(table, 400, 300).getHeader();

        expect(header.getBorderSize().top).toBe(6);
        expect(header.getHeight()).toBe(32);
        expect(header.getContentBounds()).toMatchObject({ height: 20, width: 386 });

        const columnRow = header.getComponents()[1];
        expect(columnRow.getY()).toBe(0);
        expect(columnRow.getHeight()).toBe(20);
        // The row width floor is the header's CONTENT width, not the
        // container's outer width — 386, not 398 — because a row wider than
        // that would run past the header's own border into the clip.
        expect(columnRow.getWidth()).toBe(386);
        expect(header.getColumns()[0].getHeight()).toBe(20);

        expect(table.getBody().getY()).toBe(32);
    });

    // Reachable only by writing the private flag directly: `Table` exposes no
    // footer-visibility setter. The footer's inner row is built with no
    // model, so `getColumns()` is empty and only the band itself is testable.
    it('sizes the footer band from its own content box', () => {
        const table = makeTable();

        (table as unknown as { _footerVisible: boolean })._footerVisible = true;

        const footer = layOut(table, 400, 300).getFooter();

        expect(footer.getBorderSize().top).toBe(1);
        expect(footer.getHeight()).toBe(21);
        expect(footer.getContentBounds()!.height).toBe(20);
        expect(footer.getY()).toBe(277);
    });
});
