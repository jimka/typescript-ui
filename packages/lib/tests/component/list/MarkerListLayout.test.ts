import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOM } from '~/core/DOM';
import { _BulletedList } from '~/component/list/BulletedList';
import { _NumberedList } from '~/component/list/NumberedList';
import { _ListItem } from '~/component/list/ListItem';
import { BulletedListItemStyle } from '~/component/list/BulletedListItemStyle';
import { NumberedListItemStyle } from '~/component/list/NumberedListItemStyle';
import { _Text } from '~/component/input/Text';
import { _VBox } from '~/layout/VBox';
import { isUnbounded } from '~/primitive/Size';
import { installTestDOM, ruleStyleWrites } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** The list's left padding — the indent every item is placed at. */
const GUTTER = 25;

/** Gap between an item's marker slot and its label. Mirrors ListItem's own constant. */
const MARKER_GAP = 4;

/**
 * Builds a list holding `texts`, materialised and sized so doLayout() resolves
 * an inner size instead of early-returning.
 *
 * The items are added BEFORE the size is set. Unlike the `Container` host in
 * tests/component/layout/VBox.test.ts, a marker list is a plain `Component`, so
 * `clampsToContentSize()` is true and `setWidth` clamps against the size its
 * children imply — sizing an empty list would clamp it to its 25px padding.
 */
function hostList<T extends _BulletedList | _NumberedList>(list: T, width: number, height: number, texts: string[]): T {
    list.getElement(true);

    for (const text of texts) {
        list.addComponent(new _ListItem(text.toLowerCase(), text));
    }

    list.setWidth(width);
    list.setHeight(height);

    return list;
}

/** Each item's marker string, in child order. */
function markers(list: _BulletedList | _NumberedList): string[] {
    return (list.getComponents() as _ListItem[]).map(i => i.getMarker());
}

/** Exposes the protected marker conversion so a case can check position 4000 without 4000 items. */
class ProbeNumberedList extends _NumberedList {
    marker(index: number): string {
        return this.markerText(index);
    }
}

/**
 * Reads the marker a style produces for the one-based item number `n`.
 * `markerText` is zero-based, so item `n` sits at index `n - 1`.
 */
function markerFor(style: NumberedListItemStyle, n: number): string {
    const probe = new ProbeNumberedList({ itemStyle: style });

    return probe.marker(n - 1);
}

describe('AbstractMarkerList — default layout manager', () => {
    afterEach(() => DOM.reset());

    it('defaults to a zero-spacing, stretching VBox', () => {
        installTestDOM(CONFIG);

        for (const list of [new _BulletedList(), new _NumberedList()]) {
            const manager = list.getLayoutManager();

            expect(manager).toBeInstanceOf(_VBox);
            expect((manager as _VBox).getComponentSpacing()).toBe(0);
            expect((manager as _VBox).isStretching()).toBe(true);
        }
    });

    it('gives each list its own manager instance', () => {
        installTestDOM(CONFIG);

        // A layout manager holds per-container state, so a shared one would
        // cross-wire two lists. The defaults bag is rebuilt per construction.
        expect(new _BulletedList().getLayoutManager())
            .not.toBe(new _BulletedList().getLayoutManager());
    });
});

describe('AbstractMarkerList — marker text', () => {
    afterEach(() => DOM.reset());

    it('gives every bulleted item the disc marker by default', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);

        expect(markers(list)).toEqual(['•', '•', '•']);
    });

    it('re-markers every item when the bullet style changes', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);

        list.setStyle(BulletedListItemStyle.CIRCLE);
        expect(markers(list)).toEqual(['◦', '◦', '◦']);

        list.setStyle(BulletedListItemStyle.SQUARE);
        expect(markers(list)).toEqual(['▪', '▪', '▪']);
    });

    it('numbers a numbered list from one, in order', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);

        expect(markers(list)).toEqual(['1.', '2.', '3.']);
    });

    it('applies an itemStyle passed at construction, with no later setStyle', () => {
        installTestDOM(CONFIG);

        const list = hostList(
            new _BulletedList({ itemStyle: BulletedListItemStyle.SQUARE }), 200, 300, ['A', 'B'],
        );

        expect(markers(list)).toEqual(['▪', '▪']);
    });
});

describe('AbstractMarkerList — renumbering', () => {
    afterEach(() => DOM.reset());

    it('closes the gap when an item is removed', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        list.removeComponent(items[1]);

        expect(markers(list)).toEqual(['1.', '2.']);
    });

    it('shifts the rest down when an item is inserted at the front', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);

        list.insertComponent(new _ListItem('z', 'Z'), 0);

        expect(markers(list)).toEqual(['1.', '2.', '3.', '4.']);
        expect((list.getComponents()[0] as _ListItem).getText()).toBe('Z');
    });

    it('renumbers after a move', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);
        const last = list.getComponents()[2] as _ListItem;

        // moveComponent routes through removeComponent + insertComponent, both
        // of which renumber — it needs no hook of its own.
        list.moveComponent(last, 0);

        expect(markers(list)).toEqual(['1.', '2.', '3.']);
        expect((list.getComponents()[0] as _ListItem).getText()).toBe('C');
    });

    it('renumbers in the sorted order', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 200, 300, ['C', 'A', 'B']);

        list.sortComponents((a, b) => (a as _ListItem).getText().localeCompare((b as _ListItem).getText()));

        expect((list.getComponents() as _ListItem[]).map(i => i.getText())).toEqual(['A', 'B', 'C']);
        expect(markers(list)).toEqual(['1.', '2.', '3.']);
    });

    it('survives removing every item', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);

        list.removeAllComponents();

        expect(() => list.doLayout()).not.toThrow();
        expect(list.getPreferredSize()!.height).toBe(0);
    });
});

describe('AbstractMarkerList — the NONE style', () => {
    afterEach(() => DOM.reset());

    it('empties and hides every marker', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);

        list.setStyle(BulletedListItemStyle.NONE);

        expect(markers(list)).toEqual(['', '', '']);
        for (const item of list.getComponents() as _ListItem[]) {
            expect((item.getComponents()[0] as _Text).isDisplayed()).toBe(false);
        }
    });

    it('costs no width once the marker is hidden', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['Alpha']);
        const item = list.getComponents()[0] as _ListItem;

        list.setStyle(BulletedListItemStyle.NONE);

        // HBox iterates getLaidOutComponents, so an undisplayed marker costs
        // neither its own width nor the inter-item gap.
        expect(item.getPreferredSize()!.width).toBe(new _Text('Alpha').getPreferredSize()!.width);
    });

    it('leaves a standalone item unmarked', () => {
        installTestDOM(CONFIG);

        // Nothing has numbered it — only a list writes markers.
        const item = new _ListItem('k', 'v');

        expect(item.getMarker()).toBe('');
        expect((item.getComponents()[0] as _Text).isDisplayed()).toBe(false);
    });
});

describe('NumberedList — numbering styles', () => {
    afterEach(() => {
        DOM.reset();
        vi.restoreAllMocks();
    });

    // Case 1. The worked rows from the plan's conversion table. Each alias pair
    // shares a column, so running both members against it covers all ten
    // counting styles without sixty separate blocks.
    const S = NumberedListItemStyle;
    const CONVERSIONS: ReadonlyArray<[NumberedListItemStyle[], Record<number, string>]> = [
        [[S.DECIMAL],              { 1: '1.',  9: '9.',  10: '10.', 24: '24.',   26: '26.',   27: '27.'    }],
        [[S.DECIMAL_LEADING_ZERO], { 1: '01.', 9: '09.', 10: '10.', 24: '24.',   26: '26.',   27: '27.'    }],
        [[S.LOWER_ALPHA,
          S.LOWER_LATIN],          { 1: 'a.',  9: 'i.',  10: 'j.',  24: 'x.',    26: 'z.',    27: 'aa.'    }],
        [[S.UPPER_ALPHA,
          S.UPPER_LATIN],          { 1: 'A.',  9: 'I.',  10: 'J.',  24: 'X.',    26: 'Z.',    27: 'AA.'    }],
        [[S.LOWER_GREEK],          { 1: 'α.',  9: 'ι.',  10: 'κ.',  24: 'ω.',    26: 'αβ.',   27: 'αγ.'    }],
        [[S.UPPER_GREEK],          { 1: 'Α.',  9: 'Ι.',  10: 'Κ.',  24: 'Ω.',    26: 'ΑΒ.',   27: 'ΑΓ.'    }],
        [[S.LOWER_ROMAN],          { 1: 'i.',  9: 'ix.', 10: 'x.',  24: 'xxiv.', 26: 'xxvi.', 27: 'xxvii.' }],
        [[S.UPPER_ROMAN],          { 1: 'I.',  9: 'IX.', 10: 'X.',  24: 'XXIV.', 26: 'XXVI.', 27: 'XXVII.' }],
    ];

    it('converts every counting style at the worked positions', () => {
        installTestDOM(CONFIG);

        for (const [styles, expected] of CONVERSIONS) {
            for (const style of styles) {
                for (const [n, marker] of Object.entries(expected)) {
                    expect(`${style} n=${n} -> ${markerFor(style, Number(n))}`)
                        .toBe(`${style} n=${n} -> ${marker}`);
                }
            }
        }
    });

    // Case 2.
    it('pads DECIMAL_LEADING_ZERO to two digits without ever truncating', () => {
        installTestDOM(CONFIG);

        expect(markerFor(S.DECIMAL_LEADING_ZERO, 1)).toBe('01.');
        expect(markerFor(S.DECIMAL_LEADING_ZERO, 9)).toBe('09.');
        expect(markerFor(S.DECIMAL_LEADING_ZERO, 10)).toBe('10.');
        expect(markerFor(S.DECIMAL_LEADING_ZERO, 100)).toBe('100.');
    });

    // Case 3. Bijective base-26: the value after `z` is `aa`, not a wrap to `a`.
    it('continues LOWER_ALPHA past the alphabet without wrapping', () => {
        installTestDOM(CONFIG);

        expect(markerFor(S.LOWER_ALPHA, 26)).toBe('z.');
        expect(markerFor(S.LOWER_ALPHA, 27)).toBe('aa.');
        expect(markerFor(S.LOWER_ALPHA, 52)).toBe('az.');
        expect(markerFor(S.LOWER_ALPHA, 53)).toBe('ba.');
    });

    // Case 4. CSS defines each pair as aliases of one counter style.
    it('renders the alpha and latin aliases identically', () => {
        installTestDOM(CONFIG);

        for (const n of [1, 26, 27]) {
            expect(markerFor(S.LOWER_LATIN, n)).toBe(markerFor(S.LOWER_ALPHA, n));
            expect(markerFor(S.UPPER_LATIN, n)).toBe(markerFor(S.UPPER_ALPHA, n));
        }
    });

    // Case 5.
    it('renders UPPER_ALPHA as LOWER_ALPHA upper-cased', () => {
        installTestDOM(CONFIG);

        for (const n of [1, 26, 27]) {
            expect(markerFor(S.UPPER_ALPHA, n)).toBe(markerFor(S.LOWER_ALPHA, n).toUpperCase());
        }
    });

    // Case 6. The 24-letter alphabet uses σ and has no final sigma ς.
    it('counts LOWER_GREEK over 24 letters, with sigma and no final sigma', () => {
        installTestDOM(CONFIG);

        expect(markerFor(S.LOWER_GREEK, 1)).toBe('α.');
        expect(markerFor(S.LOWER_GREEK, 18)).toBe('σ.');
        expect(markerFor(S.LOWER_GREEK, 24)).toBe('ω.');
        expect(markerFor(S.LOWER_GREEK, 25)).toBe('αα.');

        expect(markerFor(S.UPPER_GREEK, 1)).toBe('Α.');
        for (const n of [1, 18, 24, 25]) {
            expect(markerFor(S.UPPER_GREEK, n)).toBe(markerFor(S.LOWER_GREEK, n).toUpperCase());
        }
    });

    // Case 7. Every subtractive pair in the symbol table.
    it('builds roman numerals including the subtractive pairs', () => {
        installTestDOM(CONFIG);

        const expected: Record<number, string> = {
            1: 'i.', 4: 'iv.', 9: 'ix.', 10: 'x.', 24: 'xxiv.',
            40: 'xl.', 90: 'xc.', 400: 'cd.', 900: 'cm.',
        };

        for (const [n, marker] of Object.entries(expected)) {
            expect(markerFor(S.LOWER_ROMAN, Number(n))).toBe(marker);
            expect(markerFor(S.UPPER_ROMAN, Number(n))).toBe(marker.toUpperCase());
        }
    });

    // Case 8. CSS gives the roman styles range 1-3999 and falls back to decimal.
    it('falls back to decimal above the roman range', () => {
        installTestDOM(CONFIG);

        expect(markerFor(S.LOWER_ROMAN, 3999)).toBe('mmmcmxcix.');
        expect(markerFor(S.UPPER_ROMAN, 3999)).toBe('MMMCMXCIX.');
        expect(markerFor(S.LOWER_ROMAN, 4000)).toBe('4000.');
        expect(markerFor(S.UPPER_ROMAN, 4000)).toBe('4000.');
    });

    // Case 9. Proves the conversions are wired through renumber(), not merely callable.
    it('renumbers a real list through every style change', () => {
        installTestDOM(CONFIG);

        const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
        const list   = hostList(new _NumberedList(), 200, 400, labels);

        list.setStyle(NumberedListItemStyle.LOWER_ROMAN);
        expect(markers(list)).toEqual([
            'i.', 'ii.', 'iii.', 'iv.', 'v.', 'vi.',
            'vii.', 'viii.', 'ix.', 'x.', 'xi.', 'xii.',
        ]);

        list.setStyle(NumberedListItemStyle.UPPER_GREEK);
        expect(markers(list)).toEqual([
            'Α.', 'Β.', 'Γ.', 'Δ.', 'Ε.', 'Ζ.',
            'Η.', 'Θ.', 'Ι.', 'Κ.', 'Λ.', 'Μ.',
        ]);
    });

    // Case 10. Nothing warns any more, under any style.
    it('renders NONE as no marker and never warns for any style', () => {
        installTestDOM(CONFIG);

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const list = hostList(new _NumberedList(), 200, 300, ['A', 'B']);

        for (const style of Object.values(NumberedListItemStyle)) {
            list.setStyle(style);
        }

        list.setStyle(NumberedListItemStyle.NONE);
        expect(markers(list)).toEqual(['', '']);
        expect(list.getStyle()).toBe(NumberedListItemStyle.NONE);

        expect(warn).not.toHaveBeenCalled();
    });
});

describe('ListItem — geometry', () => {
    afterEach(() => DOM.reset());

    it('is as wide as its marker, the gap, and its label', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['Alpha']);
        const item = list.getComponents()[0] as _ListItem;

        // Derive both references from bare Text components rather than from the
        // item's own arithmetic.
        const markerWidth = new _Text('•').getPreferredSize()!.width;
        const labelWidth  = new _Text('Alpha').getPreferredSize()!.width;

        expect(item.getPreferredSize()!.width).toBe(markerWidth + MARKER_GAP + labelWidth);
    });

    it('is one line tall, not the 100px VBox fallback', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['Alpha']);
        const item = list.getComponents()[0] as _ListItem;

        // VBox.preferredChildHeight falls back to _defaultComponentHeight (100)
        // when a child reports neither a preferred nor a minimum height.
        expect(item.getPreferredSize()!.height).toBe(new _Text('Alpha').getPreferredSize()!.height);
        expect(item.getPreferredSize()!.height).toBeLessThan(100);
    });

    it('places the marker before the label inside the item', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['Alpha']);
        const item = list.getComponents()[0] as _ListItem;

        list.doLayout();

        const [marker, label] = item.getComponents() as _Text[];
        const markerWidth = new _Text('•').getPreferredSize()!.width;

        expect(marker.getX()).toBe(0);
        expect(label.getX()).toBe(markerWidth + MARKER_GAP);
        expect(label.getX() + label.getWidth()).toBeLessThanOrEqual(item.getWidth());
    });

    it('gives the label every pixel the marker leaves', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 300, 300, ['Alpha']);
        const item = list.getComponents()[0] as _ListItem;

        list.doLayout();

        const [, label] = item.getComponents() as _Text[];

        // The label carries `weight: 1`, so it absorbs the width the marker and
        // the gap leave rather than shrinking to its own text. Without it the
        // label would be its glyph width, which changes where text-align lands
        // and where truncation ellipsises.
        expect(label.getX() + label.getWidth()).toBe(item.getWidth());
        expect(label.getWidth()).toBeGreaterThan(new _Text('Alpha').getPreferredSize()!.width);
    });

    it('numbers a hidden item too, so the rest keep their positions', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _NumberedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        items[0].setDisplayed(false);

        // Nothing notifies a list when a child's displayed flag flips, so
        // numbering counts every child and stays stable across hide/show.
        expect(markers(list)).toEqual(['1.', '2.', '3.']);
        expect(items[1].getMarker()).toBe('2.');
    });
});

describe('AbstractMarkerList — shared marker column', () => {
    afterEach(() => DOM.reset());

    /** The twelve labels that make markers `1.` through `12.` — two marker widths. */
    const TWELVE = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

    /** An item's marker and label children, in that order. */
    function slots(item: _ListItem): [_Text, _Text] {
        return item.getComponents() as [_Text, _Text];
    }

    /** The width a bare Text of `text` measures to. */
    function textWidth(text: string): number {
        return new _Text(text).getPreferredSize()!.width;
    }

    // Case 11.
    it('gives every item one marker width and one label x', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 300, 400, TWELVE);
        list.doLayout();

        const items      = list.getComponents() as _ListItem[];
        const markerWidths = items.map(i => slots(i)[0].getWidth());
        const labelXs      = items.map(i => slots(i)[1].getX());

        // Before the shared column, `1.` measured 8 and `10.` measured 12, so
        // the label x jumped from 12 to 16 at item 10.
        expect(new Set(markerWidths).size).toBe(1);
        expect(new Set(labelXs).size).toBe(1);
        expect(labelXs[0]).toBe(markerWidths[0] + MARKER_GAP);
    });

    // Case 12.
    it('sizes the column to the widest marker', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 300, 400, TWELVE);
        list.doLayout();

        const widest = textWidth('12.');

        expect(list.getMarkerColumnWidth()).toBe(widest);
        for (const item of list.getComponents() as _ListItem[]) {
            expect(slots(item)[0].getWidth()).toBe(widest);
        }
    });

    // Case 13. The case that catches a ratcheting column.
    it('shrinks the column when the widest marker goes away', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 300, 400, TWELVE);
        list.doLayout();

        const wide = list.getMarkerColumnWidth();
        expect(wide).toBe(textWidth('12.'));

        const items = list.getComponents() as _ListItem[];
        for (const item of items.slice(5)) {
            list.removeComponent(item);
        }

        list.doLayout();

        expect(list.getMarkerColumnWidth()).toBe(textWidth('5.'));
        expect(list.getMarkerColumnWidth()).toBeLessThan(wide);
    });

    // Case 14. The column must not feed back into the measurement it is derived from.
    it('measures a marker independently of the column pushed onto it', () => {
        installTestDOM(CONFIG);

        const item = new _ListItem('a', 'Alpha');
        item.getElement(true);
        item.setMarker('1.');

        const natural = textWidth('1.');
        expect(item.getMarkerWidth()).toBe(natural);

        item.setMarkerColumnWidth(200);

        expect(item.getMarkerWidth()).toBe(natural);
    });

    // Case 15. Read off an item whose own marker is narrower than the column,
    // so the assertion fails if only the marker's own width were counted.
    it('reports an item width built from the column, not the item its own marker', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _NumberedList(), 300, 400, TWELVE);
        list.doLayout();

        const first = (list.getComponents() as _ListItem[])[0];
        expect(first.getMarker()).toBe('1.');
        expect(textWidth('1.')).toBeLessThan(textWidth('12.'));

        expect(first.getPreferredSize()!.width)
            .toBe(textWidth('12.') + MARKER_GAP + textWidth('A'));
    });

    // Case 16.
    it('right-aligns the marker inside its slot', () => {
        installTestDOM(CONFIG);

        const numbered = hostList(new _NumberedList(), 300, 400, ['A', 'B']);
        const bulleted = hostList(new _BulletedList(), 300, 400, ['A', 'B']);

        for (const list of [numbered, bulleted]) {
            for (const item of list.getComponents() as _ListItem[]) {
                expect(slots(item)[0].getTextAlign()).toBe('right');
            }
        }

        expect(slots(new _ListItem('a', 'Alpha'))[0].getTextAlign()).toBe('right');
    });

    // Case 17. Every bullet is the same glyph, so the column is that glyph's width.
    it('leaves a bulleted list at its single bullet width', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 300, 400, ['Alpha', 'Beta', 'Gamma']);
        list.doLayout();

        const bullet = textWidth('•');

        expect(list.getMarkerColumnWidth()).toBe(bullet);
        for (const item of list.getComponents() as _ListItem[]) {
            expect(slots(item)[1].getX()).toBe(bullet + MARKER_GAP);
        }
    });

    // Case 18.
    it('collapses the column to zero under the NONE style', () => {
        installTestDOM(CONFIG);

        const numbered = hostList(new _NumberedList({ itemStyle: NumberedListItemStyle.NONE }), 300, 400, ['A', 'B']);
        const bulleted = hostList(new _BulletedList({ itemStyle: BulletedListItemStyle.NONE }), 300, 400, ['A', 'B']);

        for (const list of [numbered, bulleted]) {
            list.doLayout();

            expect(list.getMarkerColumnWidth()).toBe(0);
            for (const item of list.getComponents() as _ListItem[]) {
                expect(slots(item)[0].isDisplayed()).toBe(false);
            }
        }
    });

    // Case 19.
    it('survives a layout with no items', () => {
        installTestDOM(CONFIG);

        const list = new _NumberedList();
        list.getElement(true);

        expect(() => list.doLayout()).not.toThrow();
        expect(list.getMarkerColumnWidth()).toBe(0);
    });
});

describe('AbstractMarkerList — item placement', () => {
    afterEach(() => DOM.reset());

    it('stacks items at strictly increasing y with no gap and no overlap', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        list.doLayout();

        expect(items[0].getY()).toBe(0);
        expect(items[1].getY()).toBe(items[0].getY() + items[0].getHeight());
        expect(items[2].getY()).toBe(items[1].getY() + items[1].getHeight());
    });

    it('places items in the content column, past the list indent', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        list.doLayout();

        expect(list.getContentInsets().getLeft()).toBe(GUTTER);
        for (const item of items) {
            expect(item.getX()).toBe(GUTTER);
        }
    });

    it('stretches every item to the content width', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        list.doLayout();

        for (const item of items) {
            expect(item.getWidth()).toBe(200 - GUTTER);
        }
    });
});

describe('AbstractMarkerList — content-derived preferred size', () => {
    afterEach(() => DOM.reset());

    it('reports the summed item height and widest item width, not a fixed 200x200', () => {
        installTestDOM(CONFIG);

        const list  = hostList(new _BulletedList(), 200, 300, ['A', 'B', 'C']);
        const items = list.getComponents() as _ListItem[];

        const itemHeight = items[0].getPreferredSize()!.height;
        // Each item's own width already covers its marker, the gap and its label.
        const widest     = Math.max(...items.map(i => i.getPreferredSize()!.width));

        const preferred = list.getPreferredSize()!;

        expect(preferred.height).toBe(3 * itemHeight);
        expect(preferred.width).toBe(widest + GUTTER);
        // The old class default pinned every list at 200x200 regardless of content.
        expect(preferred.height).not.toBe(200);
    });

    it('handles a single-item list', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['A']);
        const item = list.getComponents()[0] as _ListItem;

        list.doLayout();

        expect(item.getX()).toBe(GUTTER);
        expect(item.getY()).toBe(0);
        expect(list.getPreferredSize()!.height).toBe(item.getPreferredSize()!.height);
    });

    it('handles an empty list', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, []);

        expect(() => list.doLayout()).not.toThrow();
        expect(list.getPreferredSize()!.height).toBe(0);
        // A childless VBox reports the unbounded-width sentinel; assert via the
        // helper rather than a literal.
        expect(isUnbounded(list.getPreferredSize()!.width)).toBe(true);
    });
});

describe('AbstractMarkerList — CSS and semantics', () => {
    afterEach(() => DOM.reset());

    it('suppresses the browser marker with listStyleType none via the shared .MarkerList class rule', () => {
        const sink = installTestDOM(CONFIG);
        const list = new _BulletedList();

        list.getElement(true);

        // Every marker list shares one .MarkerList class rule instead of
        // repeating listStyleType on each instance's own #id rule — see
        // AbstractMarkerList.classStyleDefaults.test.ts for the dedicated
        // coverage of the shared rule's actual declared value (this file's
        // earlier tests already construct BulletedList/NumberedList
        // instances, so by the time this test runs the module-level
        // singleton rule may already be registered and produce no further
        // write here).
        expect(_ruleCacheHas('.MarkerList')).toBe(true);

        const idWrites = ruleStyleWrites(sink)
            .filter(r => r.key === 'listStyleType' && r.selector.startsWith('#'));
        expect(idWrites).toEqual([]);
    });

    it('never writes an enum token as a list-style value', () => {
        const sink = installTestDOM(CONFIG);
        const list = new _BulletedList();

        list.setStyle(BulletedListItemStyle.SQUARE);
        list.getElement(true);

        // The style now drives the marker string, not a CSS property.
        const values = ruleStyleWrites(sink)
            .filter(r => r.key === 'listStyleType' || r.key === 'list-style-type')
            .map(r => r.value);

        expect(values).not.toContain('square');
    });

    it('carries list and listitem roles, with the marker hidden from readers', () => {
        installTestDOM(CONFIG);

        const list = hostList(new _BulletedList(), 200, 300, ['A']);
        const item = list.getComponents()[0] as _ListItem;

        expect(list.getAria().getRole()).toBe('list');
        expect(item.getAria().getRole()).toBe('listitem');
        // The marker text duplicates what a reader announces from position.
        expect((item.getComponents()[0] as _Text).getAria().getHidden()).toBe(true);
    });
});

describe('ListItem — key / text contract', () => {
    afterEach(() => DOM.reset());

    it('keeps the key, text and tag contract', () => {
        installTestDOM(CONFIG);

        const item = new _ListItem('k', 'v');

        expect(item.getKey()).toBe('k');
        expect(item.getText()).toBe('v');
        expect(item.getTag()).toBe('li');
    });

    it('lets an explicit text option win over the positional value', () => {
        installTestDOM(CONFIG);

        const item = new _ListItem('k', 'positional', { text: 'override' });

        expect(item.getText()).toBe('override');
    });
});
