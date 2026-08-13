import { describe, it, expect, afterEach, vi } from 'vitest';
import { MenuRow } from '~/component/container/MenuRow';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { MenuItem } from '~/component/container/MenuItem';
import { DOM } from '~/core/DOM';
import { installTestDOM, makeEvent } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** A bare MenuRow subclass with no overrides, for pinning the base defaults. */
class TestRow extends MenuRow {}

/**
 * Dispatches a click whose target is `row`'s own element, through the
 * window-registered exact-target listener — mirrors FocusHistory.test.ts's
 * `focusIn` helper (DOM.sink.dispatchEvent invokes window-registered
 * listeners, so the real Event routing code runs unchanged).
 */
function click(row: MenuRow): void {
    const handle = row.getElement(true)!;
    DOM.sink.dispatchEvent(DOM.source.getWindow(), makeEvent(handle, 'click'));
}

describe('MenuRow base defaults', () => {
    afterEach(() => DOM.reset());

    it('reports the non-separator, enabled, non-navigable defaults', () => {
        installTestDOM(CONFIG);

        const row = new TestRow();

        expect(row.isSeparator()).toBe(false);
        expect(row.isEnabled()).toBe(true);
        expect(row.isNavigable()).toBe(false);
    });

    it('reports zero for every column-geometry contribution', () => {
        installTestDOM(CONFIG);

        const row = new TestRow();

        expect(row.hasCheck()).toBe(false);
        expect(row.hasIcon()).toBe(false);
        expect(row.hasSubmenu()).toBe(false);
        expect(row.titleTextWidth()).toBe(0);
        expect(row.shortcutTextWidth()).toBe(0);
        expect(row.getContentWidth()).toBe(0);
    });

    it('setColumns and activate no-op; the preferred height seeds to MenuRow.HEIGHT', () => {
        installTestDOM(CONFIG);

        const row = new TestRow();

        expect(() => row.setColumns(16, 24, 100)).not.toThrow();
        expect(() => row.activate()).not.toThrow();
        expect(row.getPreferredSize()!.height).toBe(MenuRow.HEIGHT);
    });
});

describe('CheckboxMenuRow', () => {
    // Every row wires `Event.addListener` (click/mouseover/mouseout) in its
    // constructor. The window-level capture handler for a type is installed
    // once ever (`Event`'s `installedListenerTypes` is module state, not
    // reset by `DOM.reset()`), so an undisposed row from an earlier test
    // leaves that type marked installed while pointing at a DOM.sink instance
    // a later test's `DOM.reset()` has already discarded — the next test's
    // dispatch then silently finds no handlers. Disposing every row drives
    // the registration back to zero (`Event.purgeComponent`, via
    // `Component.destructor`), which un-installs the type so the next test's
    // construction re-installs it against the current sink.
    afterEach(() => DOM.reset());

    it('reflects the constructed checked state, defaulting to false when omitted', () => {
        installTestDOM(CONFIG);

        const checked   = new CheckboxMenuRow({ text: 'Bold', checked: true });
        const unchecked = new CheckboxMenuRow({ text: 'Bold' });

        expect(checked.isChecked()).toBe(true);
        expect(unchecked.isChecked()).toBe(false);

        checked.dispose();
        unchecked.dispose();
    });

    it('activate() flips the checked state, and flips it back on a second call', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold' });

        row.activate();
        expect(row.isChecked()).toBe(true);

        row.activate();
        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('a click targeting the row element toggles it exactly once', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold' });

        click(row);
        expect(row.isChecked()).toBe(true);

        click(row);
        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('a listeners.action handler fires once per toggle and reads the NEW value', () => {
        installTestDOM(CONFIG);

        let observed: boolean | undefined;
        const action = vi.fn(() => { observed = row.isChecked(); });
        const row = new CheckboxMenuRow({ text: 'Bold', checked: false, listeners: { action } });

        click(row);

        expect(action).toHaveBeenCalledOnce();
        expect(observed).toBe(true);

        row.dispose();
    });

    it('getContentWidth() exceeds the bare inset/pad for a labelled row, unaffected by setColumns', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold' });

        const before = row.getContentWidth();
        expect(before).toBeGreaterThan(MenuItem.TEXT_INSET + MenuItem.RIGHT_PAD);

        row.setColumns(0, 40, 100);

        expect(row.getContentWidth()).toBe(before);

        row.dispose();
    });

    it('setColumns positions the checkbox at the injected iconStart; falls back to MenuItem.TEXT_INSET without it', () => {
        installTestDOM(CONFIG);

        const standalone = new CheckboxMenuRow({ text: 'Bold' });
        standalone.getElement(true);
        standalone.setWidth(200);
        standalone.setHeight(MenuRow.HEIGHT);
        standalone.doLayout();

        const standaloneBox = standalone.getContentBounds()!;
        expect((standalone as any)._checkbox.getX()).toBe(standaloneBox.x + MenuItem.TEXT_INSET);

        const aligned = new CheckboxMenuRow({ text: 'Bold' });
        aligned.getElement(true);
        aligned.setWidth(200);
        aligned.setHeight(MenuRow.HEIGHT);
        aligned.setColumns(0, 40, 100);
        aligned.doLayout();

        const alignedBox = aligned.getContentBounds()!;
        expect((aligned as any)._checkbox.getX()).toBe(alignedBox.x + 40);

        standalone.dispose();
        aligned.dispose();
    });
});
