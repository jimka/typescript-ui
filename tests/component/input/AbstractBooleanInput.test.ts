//
// Parity coverage for the shared AbstractBooleanInput base extracted from
// Checkbox / RadioButton / Toggle. The three widgets must expose an identical
// label surface (mount/replace/remove of an inner `_label` Text) and route
// pointer activation through the same enabled/read-only guard. Value semantics
// stay per-widget and are covered by each widget's own suite.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Checkbox } from '~/component/input/Checkbox';
import { RadioButton } from '~/component/input/RadioButton';
import { Toggle } from '~/component/input/Toggle';
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

/** Constructs each widget fresh so a mutation in one case can't leak. */
const WIDGETS: Array<[string, () => any]> = [
    ['Checkbox',    () => new Checkbox()],
    ['RadioButton', () => new RadioButton()],
    ['Toggle',      () => new Toggle()],
];

describe('AbstractBooleanInput label management (parity)', () => {
    for (const [name, make] of WIDGETS) {
        it(`${name} mounts, round-trips, and removes the inner label`, () => {
            const w = make();

            expect(w.getLabel()).toBe(null);
            expect(w._label).toBe(null);

            w.setLabel('A');

            expect(w.getLabel()).toBe('A');
            expect(w._label).not.toBe(null);

            const mounted = w._label;

            w.setLabel('B');

            expect(w.getLabel()).toBe('B');
            // Replacing the text reuses the same Text child.
            expect(w._label).toBe(mounted);

            w.setLabel(null);

            expect(w.getLabel()).toBe(null);
            expect(w._label).toBe(null);
        });
    }
});

describe('AbstractBooleanInput enabled / read-only reflection (parity)', () => {
    for (const [name, make] of WIDGETS) {
        it(`${name} reflects setEnabled(false) into aria-disabled, tabindex=-1, and the graphic cursor`, () => {
            const w = make();

            w.setEnabled(false);

            expect(w.getAria().getDisabled()).toBe(true);
            expect(w.getAria().getTabIndex()).toBe(-1);
            // The interactive surface (box / ring / track) shows the default
            // cursor when disabled, pointer when enabled.
            expect(w.getInteractiveSurface().getCursor()).toBe('default');

            w.setEnabled(true);

            expect(w.getAria().getDisabled()).toBe(false);
            expect(w.getAria().getTabIndex()).toBe(0);
            expect(w.getInteractiveSurface().getCursor()).toBe('pointer');
        });

        it(`${name} reflects setReadOnly(true) into aria-readonly`, () => {
            const w = make();

            w.setReadOnly(true);

            expect(w.getAria().getReadOnly()).toBe(true);

            w.setReadOnly(false);

            expect(w.getAria().getReadOnly()).toBe(false);
        });
    }
});

describe('AbstractBooleanInput pointer activation guard (parity)', () => {
    for (const [name, make] of WIDGETS) {
        it(`${name} activates from a pointer only when enabled and not read-only`, () => {
            // Mounted: RadioButton.activate fires a DOM `change`, which needs a
            // real element.
            const enabled = make();
            enabled.getElement(true);
            const before = enabled.getValue();

            enabled.activateFromPointer();

            expect(enabled.getValue()).toBe(!before);

            const disabled = make();
            disabled.getElement(true);
            disabled.setEnabled(false);
            disabled.activateFromPointer();

            expect(disabled.getValue()).toBe(false);

            const readOnly = make();
            readOnly.getElement(true);
            readOnly.setReadOnly(true);
            readOnly.activateFromPointer();

            expect(readOnly.getValue()).toBe(false);
        });
    }
});
