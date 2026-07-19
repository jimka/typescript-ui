//
// Coverage for the Dialog severity tone: an explicit `severity` tints the title
// bar and sets a matching leading glyph, overriding the tone otherwise derived
// from the buttons, and the `Dialog.error` convenience builds an error-toned
// OK dialog.
//
import { describe, it, expect, afterEach, vi } from 'vitest';
import { _Dialog as Dialog, DialogButtons } from '~/overlay/Dialog';
import { DOM } from '~/core/DOM';
import { installTestDOM } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

describe('Dialog severity header', () => {
    afterEach(() => DOM.reset());

    it('shows the error glyph for severity "error", overriding the button-derived info glyph', () => {
        installTestDOM(CONFIG);

        // A single confirm button would otherwise derive the "info" header
        // (circle-info); the explicit severity wins.
        const dialog = new Dialog({
            title:    'Connection failed',
            message:  'Host not allowed',
            severity: 'error',
            buttons:  [{ text: 'OK', result: 'confirm', primary: true }],
        });

        expect(dialog.getTitleBar().getGlyph()?.getGlyphName()).toBe('circle-exclamation');
    });

    it('shows the warning glyph for severity "warning"', () => {
        installTestDOM(CONFIG);

        const dialog = new Dialog({ title: 'Careful', message: 'Heads up', severity: 'warning' });

        expect(dialog.getTitleBar().getGlyph()?.getGlyphName()).toBe('triangle-exclamation');
    });

    it('leaves the button-derived header when no severity is set', () => {
        installTestDOM(CONFIG);

        // Single confirm button → info variant → circle-info glyph.
        const dialog = new Dialog({ title: 'FYI', message: 'All good', buttons: [{ text: 'OK', result: 'confirm' }] });

        expect(dialog.getTitleBar().getGlyph()?.getGlyphName()).toBe('circle-info');
    });

    const SHORTHANDS = [
        { severity: 'info',    call: Dialog.info    },
        { severity: 'success', call: Dialog.success },
        { severity: 'warning', call: Dialog.warning },
        { severity: 'error',   call: Dialog.error   },
    ] as const;

    for (const { severity, call } of SHORTHANDS) {
        it(`Dialog.${severity} shows a ${severity}-severity OK dialog and resolves void`, async () => {
            installTestDOM(CONFIG);

            const show = vi.spyOn(Dialog, 'show').mockResolvedValue('confirm');

            await expect(call('A title', 'A message')).resolves.toBeUndefined();

            expect(show).toHaveBeenCalledTimes(1);

            const config = show.mock.calls[0][0];
            expect(config.severity).toBe(severity);
            expect(config.title).toBe('A title');
            expect(config.message).toBe('A message');
            expect(config.buttons).toEqual([{ ...DialogButtons.Ok, primary: true }]);

            show.mockRestore();
        });
    }
});
