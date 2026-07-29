import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { _BulletedList } from '~/component/list/BulletedList';
import { _NumberedList } from '~/component/list/NumberedList';
import { _ListItem } from '~/component/list/ListItem';
import { BulletedListItemStyle } from '~/component/list/BulletedListItemStyle';
import { NumberedListItemStyle } from '~/component/list/NumberedListItemStyle';
import { installTestDOM } from '../../dom/TestDOM';
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
