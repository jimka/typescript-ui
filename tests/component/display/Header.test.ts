// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Header } from '~/component/display/Header';
import { Insets } from '~/primitive/Insets';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('Header text wiring', () => {
    it('exposes the inner Text via getText with the constructor label', () => {
        const header = new Header('Title');

        expect(header.getText().getText()).toBe('Title');
    });
    it('routes a { text } option to the inner Text', () => {
        const header = new Header('positional', { text: 'option' });

        expect(header.getText().getText()).toBe('option');
    });
    it('defaults the inner text font-weight to bold when no override is given', () => {
        const header = new Header('Title');

        expect(header.getText().getFontWeight()).toBe('bold');
    });
    it('routes a { fontWeight } option to the inner Text', () => {
        const header = new Header('Title', { fontWeight: 'normal' });

        expect(header.getText().getFontWeight()).toBe('normal');
    });
});

describe('Header preferred-size derivation', () => {
    it('defaults insets to (4, 4, 4, 4)', () => {
        const insets = new Header('Title').getInsets();

        expect(insets.getTop()).toBe(4);
        expect(insets.getBottom()).toBe(4);
        expect(insets.getLeft()).toBe(4);
        expect(insets.getRight()).toBe(4);
    });
    it('derives height = textHeight + top + bottom inset (relation, not pixel)', () => {
        const small = new Header('Title');
        const tall  = new Header('Title', { insets: new Insets(20, 4, 20, 4) });

        const smallH = small.getPreferredSize()!.height;
        const tallH  = tall.getPreferredSize()!.height;

        // The taller insets add (20-4) top + (20-4) bottom = 32px over the
        // default-inset header, holding the measured text height constant.
        expect(tallH - smallH).toBe(32);
    });
});
