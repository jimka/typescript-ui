// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/spinbutton-pressed-boxshadow-state-tier-dedup.md:
// `SpinButton` now declares its own `ownStyleStates`, restating `Button`'s
// `:hover` entry unchanged and overriding `.pressed`'s `shadow` to `"none"`.
// That publishes a shared `.SpinButton.pressed { box-shadow: none }` class
// rule, so every default-constructed spin button's constructor-time
// `clearPressedShadow()` write dedupes against it instead of repeating
// `box-shadow: none` on its own per-instance `#id.pressed` rule.
//
// A separate file is required, not an addition to an existing one:
// `.SpinButton.pressed`'s content is written once per test *file* (module
// state surviving `DOM.reset()` between tests), so row 1's capture window
// must wrap the very first `SpinButton` construction in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpinButton } from '~/component/input/SpinButton';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `Button.pressedHoverClassHoisting.test.ts`.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = recorder.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of recorder.writes.slice(start)) {
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

describe('SpinButton pressed box-shadow class hoisting', () => {
    it('row 1: the first SpinButton in a fresh test file inserts .SpinButton.pressed carrying exactly box-shadow: none', () => {
        // `.SpinButton.pressed` materialises eagerly, during construction
        // (when the first setPressedShadow call resolves `pressedClassBag`
        // via `applyChromeOptions`) — not at `getElement(true)` — so the
        // capture window must wrap `new SpinButton(...)` itself, the same
        // timing `Button.pressedHoverClassHoisting.test.ts` documents for
        // `.Button.pressed`.
        let first!: SpinButton;
        const classDeclarations = declarationsDuring(sink, '.SpinButton.pressed', () => { first = new SpinButton('▲'); });

        expect(classDeclarations.boxShadow).toBe('none');
        expect(classDeclarations.color).toBeUndefined();
        expect(classDeclarations.backgroundColor).toBeUndefined();
        expect(classDeclarations.backgroundImage).toBeUndefined();

        first.getElement(true);
    });

    it("row 2: a second SpinButton's own #id.pressed rule carries no boxShadow declaration", () => {
        new SpinButton('▲').getElement(true);

        const second = new SpinButton('▼');
        const instanceDeclarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));

        expect(instanceDeclarations.boxShadow).toBeUndefined();
    });

    it('row 3: both .Button.pressed and .SpinButton.pressed are cached after any SpinButton renders', () => {
        new SpinButton('▲').getElement(true);

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
        expect(_ruleCacheHas('.SpinButton.pressed')).toBe(true);
    });

    it("row 4: a caller-supplied resting shadow still reaches the pressed state per-instance", () => {
        new SpinButton('▲').getElement(true);

        const withShadow = new SpinButton('▼', { shadow: '0 0 2px red' });
        const declarations = declarationsDuring(sink, idSelector(withShadow) + '.pressed', () => withShadow.getElement(true));

        expect(declarations.boxShadow).toBe('0 0 2px red');
    });

    it('row 5: neither SpinButtonUp nor SpinButtonDown ever gets its own .pressed class rule — both resolve to .SpinButton.pressed', () => {
        new NumberSpinner().getElement(true);

        expect(_ruleCacheHas('.SpinButton.pressed')).toBe(true);
        expect(_ruleCacheHas('.SpinButtonUp.pressed')).toBe(false);
        expect(_ruleCacheHas('.SpinButtonDown.pressed')).toBe(false);
    });

    it("row 6: new SpinButton('▲').getPressedShadow() is unchanged at 'none'", () => {
        const spin = new SpinButton('▲');

        expect(spin.getPressedShadow()).toBe('none');
    });
});
