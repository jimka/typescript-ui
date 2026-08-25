import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _BulletedList } from '~/component/list/BulletedList';
import { _NumberedList } from '~/component/list/NumberedList';
import { _ListItem } from '~/component/list/ListItem';
import { BulletedListItemStyle } from '~/component/list/BulletedListItemStyle';
import { NumberedListItemStyle } from '~/component/list/NumberedListItemStyle';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import { _ruleCacheHas } from '~/core/StyleTarget';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

// AbstractMarkerList delegates selection to the native <select> seam, which
// the offline modelled source stubs to -1 — so selection getters are not
// meaningfully testable offline. This suite is scoped to the style/marker
// contract and the ListItem key/value contract instead (see plan Non-Goals).

describe('BulletedList — defaults and style', () => {
    it('defaults to the DISC bullet style', () => {
        const list = new _BulletedList();

        expect(list.getStyle()).toBe(BulletedListItemStyle.DISC);
    });

    it('setStyle updates getStyle() to the new enum value', () => {
        const list = new _BulletedList();

        list.setStyle(BulletedListItemStyle.SQUARE);
        expect(list.getStyle()).toBe(BulletedListItemStyle.SQUARE);
    });

    it('the itemStyle option dispatches through applyOptions', () => {
        const list = new _BulletedList({ itemStyle: BulletedListItemStyle.CIRCLE });

        expect(list.getStyle()).toBe(BulletedListItemStyle.CIRCLE);
    });
});

describe('NumberedList — defaults and style', () => {
    it('defaults to the DECIMAL numbering style', () => {
        const list = new _NumberedList();

        expect(list.getStyle()).toBe(NumberedListItemStyle.DECIMAL);
    });

    it('setStyle updates getStyle() to the new enum value', () => {
        const list = new _NumberedList();

        list.setStyle(NumberedListItemStyle.LOWER_ROMAN);
        expect(list.getStyle()).toBe(NumberedListItemStyle.LOWER_ROMAN);
    });

    it('the itemStyle option dispatches through applyOptions', () => {
        const list = new _NumberedList({ itemStyle: NumberedListItemStyle.DECIMAL_LEADING_ZERO });

        expect(list.getStyle()).toBe(NumberedListItemStyle.DECIMAL_LEADING_ZERO);
    });
});

describe('List-style enums keep their CSS keyword values', () => {
    // The enum values are no longer written to `list-style-type` — each list
    // paints its own marker now, and every member renders. The members must
    // still not drift: the keywords are the documented public surface.
    it('BulletedListItemStyle members equal their CSS keywords', () => {
        expect(BulletedListItemStyle.NONE).toBe('none');
        expect(BulletedListItemStyle.DISC).toBe('disc');
        expect(BulletedListItemStyle.CIRCLE).toBe('circle');
        expect(BulletedListItemStyle.SQUARE).toBe('square');
    });

    it('NumberedListItemStyle members equal their CSS keywords', () => {
        expect(NumberedListItemStyle.NONE).toBe('none');
        expect(NumberedListItemStyle.DECIMAL).toBe('decimal');
        expect(NumberedListItemStyle.DECIMAL_LEADING_ZERO).toBe('decimal-leading-zero');
        expect(NumberedListItemStyle.LOWER_ALPHA).toBe('lower-alpha');
        expect(NumberedListItemStyle.LOWER_GREEK).toBe('lower-greek');
        expect(NumberedListItemStyle.LOWER_LATIN).toBe('lower-latin');
        expect(NumberedListItemStyle.LOWER_ROMAN).toBe('lower-roman');
        expect(NumberedListItemStyle.UPPER_ALPHA).toBe('upper-alpha');
        expect(NumberedListItemStyle.UPPER_GREEK).toBe('upper-greek');
        expect(NumberedListItemStyle.UPPER_LATIN).toBe('upper-latin');
        expect(NumberedListItemStyle.UPPER_ROMAN).toBe('upper-roman');
    });
});

describe('ListItem — key / value contract', () => {
    afterEach(() => {
        DOM.reset();
    });

    it('getKey returns the constructor key', () => {
        const item = new _ListItem('k1', 'Label One');

        expect(item.getKey()).toBe('k1');
    });

    it('renders the positional value as the item text', () => {
        // The positional `value` is a per-instance value, not a class default —
        // `new ListItem(key, value)` must render `value` as the <li> text even
        // when no `text` option is supplied. The label `Text` child writes it
        // through the sink; assert the positional value reaches it.
        const sink = installTestDOM(CONFIG);
        const item = new _ListItem('k', 'Positional');

        item.getElement(true);

        const textWrites = sink.writes
            .filter(w => w.op === 'apply')
            .map(w => (w.args[1] as { text?: string }).text)
            .filter((t): t is string => t !== undefined);

        expect(textWrites).toContain('Positional');
    });

    it('the text option overrides the positional value', () => {
        // The positional value seeds the defaults bag's `text`; an explicit
        // `text` option wins, dispatched from the constructor body once the
        // label child exists — assert the recorded text write carries the
        // override, not the positional.
        const sink = installTestDOM(CONFIG);
        const item = new _ListItem('k', 'positional', { text: 'override' });

        item.getElement(true);

        const textWrites = sink.writes
            .filter(w => w.op === 'apply')
            .map(w => (w.args[1] as { text?: string }).text)
            .filter((t): t is string => t !== undefined);

        expect(textWrites).toContain('override');
        expect(textWrites).not.toContain('positional');
    });
});

// The marker is a dedicated file-local subclass (ListItemMarkerText) rather
// than a bare `Text`, so its `text-align: right` default hoists into a
// shared `.ListItemMarkerText` rule instead of repeating on every item's own
// `#id` rule. Mirrors CellTextSelection.test.ts's "a right-aligned
// NumberRenderer's Text writes no per-instance declarations at all".
describe('ListItemMarkerText class-rule hoisting', () => {
    afterEach(() => DOM.reset());

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `Slider.test.ts`.
     */
    function declarationsDuring(
        sink: RecordingDOMSink,
        selector: string,
        fn: () => void,
    ): Record<string, string | null> {
        const start = sink.writes.length;
        fn();

        const out: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
                continue;
            }

            const styles = w.args[1] as Record<string, string | null>;
            for (const key of Object.keys(styles)) {
                out[key] = styles[key];
            }
        }

        return out;
    }

    it('a rendered marker writes no per-instance textAlign declaration, and the shared class rule exists', () => {
        const sink = installTestDOM(CONFIG);

        // Warm the class-tier rule with a first item, mirroring the
        // Scrollbar/Toggle "second, warmed instance" precedent shape.
        new _ListItem('k0', 'v0').getElement(true);

        const item   = new _ListItem('k', 'v') as any;
        const marker = item._marker;

        // Other baseline Text/Component declarations (whiteSpace, overflow,
        // userSelect, min/maxSize, …) are still per-instance — this plan only
        // moved textAlign — so only that key is asserted, not the whole bag.
        const declarations = declarationsDuring(sink, idSelector(marker), () => item.getElement(true));

        expect(declarations.textAlign).toBeUndefined();
        expect(_ruleCacheHas('.ListItemMarkerText')).toBe(true);
    });
});
