import { describe, it, expect, afterEach, vi } from 'vitest';
import { MenuRow } from '~/component/container/MenuRow';
import { CheckboxMenuRow } from '~/component/container/CheckboxMenuRow';
import { RadioMenuRow } from '~/component/container/RadioMenuRow';
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

    it('A1. activate() notifies a listeners.action handler and reads the NEW state inside it', () => {
        installTestDOM(CONFIG);

        let observed: boolean | undefined;
        const action = vi.fn(() => { observed = row.isChecked(); });
        const row = new CheckboxMenuRow({ text: 'Bold', listeners: { action } });

        row.activate();

        expect(action).toHaveBeenCalledOnce();
        expect(observed).toBe(true);

        row.dispose();
    });

    it('A2. activate() called twice notifies twice, reading true then false', () => {
        installTestDOM(CONFIG);

        const observed: boolean[] = [];
        const action = vi.fn(() => { observed.push(row.isChecked()); });
        const row = new CheckboxMenuRow({ text: 'Bold', listeners: { action } });

        row.activate();
        row.activate();

        expect(action).toHaveBeenCalledTimes(2);
        expect(observed).toEqual([true, false]);

        row.dispose();
    });

    it('A4. activate() on a disabled row never notifies', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const row = new CheckboxMenuRow({ text: 'Bold', enabled: false, listeners: { action } });

        row.activate();

        expect(action).not.toHaveBeenCalled();
        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('A5. setChecked() fires no action listener', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const row = new CheckboxMenuRow({ text: 'Bold', listeners: { action } });

        row.setChecked(true);

        expect(action).not.toHaveBeenCalled();

        row.dispose();
    });

    it('A6. off("action", fn) stops a following activate() from calling fn', () => {
        installTestDOM(CONFIG);

        const fn = vi.fn();
        const row = new CheckboxMenuRow({ text: 'Bold' });

        row.on('action', fn);
        row.off('action', fn);
        row.activate();

        expect(fn).not.toHaveBeenCalled();

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

    it('isEnabled() defaults to true, whether enabled is omitted or explicit', () => {
        installTestDOM(CONFIG);

        const omitted  = new CheckboxMenuRow({ text: 'Bold' });
        const explicit = new CheckboxMenuRow({ text: 'Bold', enabled: true });

        expect(omitted.isEnabled()).toBe(true);
        expect(explicit.isEnabled()).toBe(true);

        omitted.dispose();
        explicit.dispose();
    });

    it('an enabled row makes neither disabled write', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold' });

        expect(row.getOpacity()).toBeNull();
        expect(row.getPointerEvents()).toBeNull();

        row.dispose();
    });

    it('enabled: false reports isEnabled() false, dims the row, and makes it pointer-inert', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold', enabled: false });

        expect(row.isEnabled()).toBe(false);
        expect(row.getOpacity()).toBe(0.5);
        expect(row.getPointerEvents()).toBe('none');

        row.dispose();
    });

    it('activate() on a disabled row leaves isChecked() unchanged', () => {
        installTestDOM(CONFIG);

        const uncheckedDisabled = new CheckboxMenuRow({ text: 'Bold', enabled: false });
        const checkedDisabled   = new CheckboxMenuRow({ text: 'Bold', enabled: false, checked: true });

        uncheckedDisabled.activate();
        checkedDisabled.activate();

        expect(uncheckedDisabled.isChecked()).toBe(false);
        expect(checkedDisabled.isChecked()).toBe(true);

        uncheckedDisabled.dispose();
        checkedDisabled.dispose();
    });

    it('a click at a disabled row leaves isChecked() unchanged', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold', enabled: false });

        click(row);

        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('a disabled row still reports isNavigable() === true', () => {
        installTestDOM(CONFIG);

        const row = new CheckboxMenuRow({ text: 'Bold', enabled: false });

        expect(row.isNavigable()).toBe(true);

        row.dispose();
    });
});

describe('RadioMenuRow', () => {
    // Same undisposed-row leak as CheckboxMenuRow above: every row wires
    // click/mouseover/mouseout in its constructor, and Event's
    // installedListenerTypes bookkeeping outlives DOM.reset(), so every row
    // built below must be disposed.
    afterEach(() => DOM.reset());

    it('R1. reflects the constructed checked state, defaulting to false when omitted', () => {
        installTestDOM(CONFIG);

        const checked   = new RadioMenuRow({ text: 'Lead', checked: true });
        const unchecked = new RadioMenuRow({ text: 'Lead' });

        expect(checked.isChecked()).toBe(true);
        expect(unchecked.isChecked()).toBe(false);

        checked.dispose();
        unchecked.dispose();
    });

    it('R2/R3. activate() selects an unselected row and is a no-op on an already-selected one', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead' });

        row.activate();
        expect(row.isChecked()).toBe(true);

        row.activate();
        expect(row.isChecked()).toBe(true);

        row.dispose();
    });

    it('R4. a click targeting the row element selects it, and a second click leaves it selected', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead' });

        click(row);
        expect(row.isChecked()).toBe(true);

        click(row);
        expect(row.isChecked()).toBe(true);

        row.dispose();
    });

    it('A3. activate() called twice on a RadioMenuRow notifies twice, reading true both times', () => {
        installTestDOM(CONFIG);

        const observed: boolean[] = [];
        const action = vi.fn(() => { observed.push(row.isChecked()); });
        const row = new RadioMenuRow({ text: 'Lead', listeners: { action } });

        row.activate();
        row.activate();

        expect(action).toHaveBeenCalledTimes(2);
        expect(observed).toEqual([true, true]);

        row.dispose();
    });

    it('A4. activate() on a disabled row never notifies', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const row = new RadioMenuRow({ text: 'Lead', enabled: false, listeners: { action } });

        row.activate();

        expect(action).not.toHaveBeenCalled();
        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('A5. setChecked() fires no action listener', () => {
        installTestDOM(CONFIG);

        const action = vi.fn();
        const row = new RadioMenuRow({ text: 'Lead', listeners: { action } });

        row.setChecked(true);

        expect(action).not.toHaveBeenCalled();

        row.dispose();
    });

    it('A6. off("action", fn) stops a following activate() from calling fn', () => {
        installTestDOM(CONFIG);

        const fn = vi.fn();
        const row = new RadioMenuRow({ text: 'Lead' });

        row.on('action', fn);
        row.off('action', fn);
        row.activate();

        expect(fn).not.toHaveBeenCalled();

        row.dispose();
    });

    it('R5. a listeners.action handler fires once per click and reads the post-activation true, including on an already-selected row', () => {
        installTestDOM(CONFIG);

        let observed: boolean | undefined;
        const action = vi.fn(() => { observed = row.isChecked(); });
        const row = new RadioMenuRow({ text: 'Lead', listeners: { action } });

        // Starts unchecked, so this click only reads true if activate() ran
        // before the handler — pinning the ordering openGutterMenu relies on.
        click(row);

        expect(action).toHaveBeenCalledOnce();
        expect(observed).toBe(true);

        // The row is now already selected; the handler still fires and still
        // reads true.
        click(row);

        expect(action).toHaveBeenCalledTimes(2);
        expect(observed).toBe(true);

        row.dispose();
    });

    it('R6. isEnabled() defaults to true, whether enabled is omitted or explicit', () => {
        installTestDOM(CONFIG);

        const omitted  = new RadioMenuRow({ text: 'Lead' });
        const explicit = new RadioMenuRow({ text: 'Lead', enabled: true });

        expect(omitted.isEnabled()).toBe(true);
        expect(explicit.isEnabled()).toBe(true);

        omitted.dispose();
        explicit.dispose();
    });

    it('R7. an enabled row makes neither disabled write', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead' });

        expect(row.getOpacity()).toBeNull();
        expect(row.getPointerEvents()).toBeNull();

        row.dispose();
    });

    it('R8. enabled: false reports isEnabled() false, dims the row, and makes it pointer-inert', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead', enabled: false });

        expect(row.isEnabled()).toBe(false);
        expect(row.getOpacity()).toBe(0.5);
        expect(row.getPointerEvents()).toBe('none');

        row.dispose();
    });

    it('R9. activate() on a disabled row leaves isChecked() unchanged', () => {
        installTestDOM(CONFIG);

        const uncheckedDisabled = new RadioMenuRow({ text: 'Lead', enabled: false });
        const checkedDisabled   = new RadioMenuRow({ text: 'Lead', enabled: false, checked: true });

        uncheckedDisabled.activate();
        checkedDisabled.activate();

        expect(uncheckedDisabled.isChecked()).toBe(false);
        expect(checkedDisabled.isChecked()).toBe(true);

        uncheckedDisabled.dispose();
        checkedDisabled.dispose();
    });

    it('R10. a click at a disabled row leaves isChecked() unchanged', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead', enabled: false });

        click(row);

        expect(row.isChecked()).toBe(false);

        row.dispose();
    });

    it('R11. a disabled row still reports isNavigable() === true', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead', enabled: false });

        expect(row.isNavigable()).toBe(true);

        row.dispose();
    });

    it('R12. getContentWidth() exceeds the bare inset/pad for a labelled row, unaffected by setColumns', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead' });

        const before = row.getContentWidth();
        expect(before).toBeGreaterThan(MenuItem.TEXT_INSET + MenuItem.RIGHT_PAD);

        row.setColumns(0, 40, 100);

        expect(row.getContentWidth()).toBe(before);

        row.dispose();
    });

    it('R13. setColumns positions the radio at the injected iconStart; falls back to MenuItem.TEXT_INSET without it', () => {
        installTestDOM(CONFIG);

        const standalone = new RadioMenuRow({ text: 'Lead' });
        standalone.getElement(true);
        standalone.setWidth(200);
        standalone.setHeight(MenuRow.HEIGHT);
        standalone.doLayout();

        const standaloneBox = standalone.getContentBounds()!;
        expect((standalone as any)._radio.getX()).toBe(standaloneBox.x + MenuItem.TEXT_INSET);

        const aligned = new RadioMenuRow({ text: 'Lead' });
        aligned.getElement(true);
        aligned.setWidth(200);
        aligned.setHeight(MenuRow.HEIGHT);
        aligned.setColumns(0, 40, 100);
        aligned.doLayout();

        const alignedBox = aligned.getContentBounds()!;
        expect((aligned as any)._radio.getX()).toBe(alignedBox.x + 40);

        standalone.dispose();
        aligned.dispose();
    });

    it('R14. setChecked(false) on a selected row deselects it', () => {
        installTestDOM(CONFIG);

        const row = new RadioMenuRow({ text: 'Lead', checked: true });

        row.setChecked(false);

        expect(row.isChecked()).toBe(false);

        row.dispose();
    });
});
