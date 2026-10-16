// Offline coverage for plans/in-progress/dialog-close-button-label.md's
// `## Expected Behaviour` cases S1-S5 (the built-in strings table) and B1-B3
// (the `strings` option of `Body`).
import { describe, it, expect, afterEach } from 'vitest';
import { Body } from '~/core/Body';
import { DOM } from '~/core/DOM';
import { getAppBuiltInStrings, getBuiltInString, setAppBuiltInStrings } from '~/core/BuiltInStrings';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

afterEach(() => {
    // Module state in core/BuiltInStrings.ts, which DOM.reset() does not touch.
    setAppBuiltInStrings({});
    DOM.reset();
});

describe('BuiltInStrings — the table', () => {
    it('S1. reads the library default when nothing is set', () => {
        expect(getBuiltInString('dialogClose')).toBe('Close');
        expect(getAppBuiltInStrings()).toEqual({ dialogClose: 'Close' });
    });

    it('S2. reads an override', () => {
        setAppBuiltInStrings({ dialogClose: 'Stäng' });

        expect(getBuiltInString('dialogClose')).toBe('Stäng');
        expect(getAppBuiltInStrings()).toEqual({ dialogClose: 'Stäng' });
    });

    it('S3. an empty set replaces the earlier overrides', () => {
        setAppBuiltInStrings({ dialogClose: 'Stäng' });
        setAppBuiltInStrings({});

        expect(getBuiltInString('dialogClose')).toBe('Close');
        expect(getAppBuiltInStrings()).toEqual({ dialogClose: 'Close' });
    });

    it('S4. an empty override counts as not set', () => {
        setAppBuiltInStrings({ dialogClose: '' });

        expect(getBuiltInString('dialogClose')).toBe('Close');
    });

    it('S5. copies the overrides it is given', () => {
        const mine = { dialogClose: 'A' };

        setAppBuiltInStrings(mine);
        mine.dialogClose = 'B';

        expect(getBuiltInString('dialogClose')).toBe('A');
    });
});

describe('BuiltInStrings — Body', () => {
    it('B1. setStrings sets the table and returns the body', () => {
        installTestDOM(CONFIG);

        const body   = Body.getInstance();
        const result = body.setStrings({ dialogClose: 'Stäng' });

        expect(result).toBe(body);
        expect(body.getStrings()).toEqual({ dialogClose: 'Stäng' });
        expect(getBuiltInString('dialogClose')).toBe('Stäng');
    });

    it('B2. Body.init applies the strings option', async () => {
        installTestDOM(CONFIG);

        await Body.init({ strings: { dialogClose: 'Fermer' } });

        expect(Body.getInstance().getStrings().dialogClose).toBe('Fermer');
    });

    it('B3. an init without the option leaves the table alone', async () => {
        installTestDOM(CONFIG);

        Body.getInstance().setStrings({ dialogClose: 'Stäng' });

        await Body.init({});

        expect(Body.getInstance().getStrings().dialogClose).toBe('Stäng');
    });
});
