// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Pins `plans/implemented/programmatic-selection-action.md`'s
// `## Expected Behaviour` cases 8-14: the combo box announces `"action"` once
// per user commit and never for a programmatic write. `"action"` is no longer
// an alias of the listener-bag `"change"` — it is a shorthand over the DOM
// `change` the combo box fires from `onRowSelected`, so its listener receives
// a `CustomEvent` rather than the new value.
//
// Kept in its own file rather than folded into ComboBox.test.ts: every
// ComboBox wires a DOM-routed "change" listener on its dropdown's inner list
// at construction (`ComboBoxDropdown`'s `_list.on("action", ...)`), and none
// of ComboBox.test.ts's many undisposed `combo`s ever release it. `Event`'s
// `installedListenerTypes` bookkeeping (see Event.ts) outlives `DOM.reset()`,
// so once that file's first ComboBox registers the type, every later test in
// that same file silently loses real "change" dispatch — the same gotcha
// ComboBoxDropdownClose.test.ts's header documents. That would make every
// "zero actions" assertion below pass for the wrong reason, so this file
// disposes each combo in `afterEach` and case 8 is a positive control that
// must read 1.
import { describe, it, expect, afterEach } from 'vitest';
import { ComboBox } from '~/component/input/ComboBox';
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

const ITEMS = [{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }];

function key(name: string): KeyboardEvent {
    return { key: name, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent;
}

// Every combo this file mounts, disposed before the reset below — see the file
// header for why an undisposed instance would make every later case's
// dispatch, and so every zero it asserts, meaningless.
const combos: ComboBox[] = [];

afterEach(() => {
    while (combos.length > 0) {
        combos.pop()!.dispose();
    }

    DOM.reset();
});

/** The dropdown slice these cases drive — the same cast ComboBoxDropdownClose.test.ts uses. */
type DropdownProbe = { isOpen(): boolean; handleKey(e: KeyboardEvent): boolean };

/**
 * Reaches the combo box's private dropdown, whose `handleKey` is the offline
 * stand-in for a keystroke arriving on the focused combo box.
 *
 * @param combo - The combo box to probe.
 *
 * @returns Its dropdown.
 */
function dropdownOf(combo: ComboBox): DropdownProbe {
    return (combo as unknown as { _dropdown: DropdownProbe })._dropdown;
}

/** A rendered combo box over {@link ITEMS}, registered for disposal. */
function makeCombo(): ComboBox {
    const combo = new ComboBox();
    combos.push(combo);
    combo.setItems(ITEMS);
    combo.getElement(true);

    return combo;
}

describe('ComboBox — "action" announces the user\'s own commit only', () => {
    it('case 8: an arrow-key commit delivers one action, carrying a DOM change event', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let actions = 0;
        let eventType: string | undefined;
        let valueInListener: string | undefined;
        combo.on('action', (e: CustomEvent) => {
            actions         += 1;
            eventType        = e.type;
            valueInListener  = combo.getValue();
        });

        combo.openDropdown();
        dropdownOf(combo).handleKey(key('ArrowDown'));

        expect(actions).toBe(1);
        expect(eventType).toBe('change');
        expect(valueInListener).toBe('y');
    });

    it('case 9: a following Enter on the already-selected row announces again', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let actions = 0;
        combo.on('action', () => { actions += 1; });

        combo.openDropdown();

        const dropdown = dropdownOf(combo);
        dropdown.handleKey(key('ArrowDown'));

        expect(actions).toBe(1);

        combo.openDropdown();
        dropdown.handleKey(key('Enter'));

        expect(combo.getSelectedIndex()).toBe(1);      // still the same row
        expect(actions).toBe(2);                       // an explicit commit always announces
    });

    it('case 10: setSelectedIndex delivers no action, one change carrying the new key, and one binding', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let actions  = 0;
        let bindings = 0;
        const changeValues: string[] = [];
        combo.on('action',  () => { actions += 1; });
        combo.on('change',  v  => { changeValues.push(v); });
        combo.on('binding', () => { bindings += 1; });

        combo.setSelectedIndex(1);

        expect(actions).toBe(0);
        expect(changeValues).toEqual(['y']);
        expect(bindings).toBe(1);
    });

    it('case 11: setSelectedIndex with fireEvent=false delivers no action and no change', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let actions = 0;
        let changes = 0;
        combo.on('action', () => { actions += 1; });
        combo.on('change', () => { changes += 1; });

        combo.setSelectedIndex(1, false);

        expect(combo.getSelectedIndex()).toBe(1);
        expect(actions).toBe(0);
        expect(changes).toBe(0);
    });

    it('case 12: setValue delivers no action, change or binding', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let actions  = 0;
        let changes  = 0;
        let bindings = 0;
        combo.on('action',  () => { actions  += 1; });
        combo.on('change',  () => { changes  += 1; });
        combo.on('binding', () => { bindings += 1; });

        combo.setValue('y');

        expect(combo.getValue()).toBe('y');
        expect(actions).toBe(0);
        expect(changes).toBe(0);
        expect(bindings).toBe(0);
    });

    it('case 13: off removes exactly the listener it names', () => {
        installTestDOM(CONFIG);
        const combo = makeCombo();

        let first  = 0;
        let second = 0;
        const onFirst  = (): void => { first  += 1; };
        const onSecond = (): void => { second += 1; };

        combo.on('action', onFirst);
        combo.on('action', onSecond);
        combo.off('action', onFirst);

        combo.openDropdown();
        dropdownOf(combo).handleKey(key('ArrowDown'));

        expect(first).toBe(0);
        expect(second).toBe(1);
    });

    it('case 14: an unrealised combo box fires one change on setSelectedIndex, without throwing', () => {
        installTestDOM(CONFIG);
        const combo = new ComboBox();
        combos.push(combo);
        combo.setItems(ITEMS);                         // no getElement(true) — deliberately unrealised

        let changes = 0;
        combo.on('change', () => { changes += 1; });

        expect(() => combo.setSelectedIndex(1)).not.toThrow();

        expect(combo.getSelectedIndex()).toBe(1);
        expect(changes).toBe(1);
    });
});
