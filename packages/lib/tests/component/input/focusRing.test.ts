// The three composite inputs (picker fields, AutoCompleteField, NumberSpinner)
// shared a byte-identical `:focus-within::after` StyleRule; it now lives in one
// helper. The recording sink records ensureStyleRule(selector) when a rule
// materialises, so the observable contract is that the helper registers a rule
// for exactly the selector it was given.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerFocusWithinRing, registerFocusVisibleRing } from '~/component/input/focusRing';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(CONFIG); });
afterEach(() => DOM.reset());

describe('registerFocusWithinRing', () => {
    it('appends the :focus-within::after pseudo to a single base selector', () => {
        registerFocusWithinRing('.SomeField');

        const registered = sink.writes.some(
            w => w.op === 'ensureStyleRule' && w.args[0] === '.SomeField:focus-within::after',
        );

        expect(registered).toBe(true);
    });

    it('appends the pseudo to each of a compound comma-separated base selector, as one rule', () => {
        registerFocusWithinRing('.DateField, .TimeField, .DateTimeField');

        const expected =
            '.DateField:focus-within::after, .TimeField:focus-within::after, .DateTimeField:focus-within::after';
        const registered = sink.writes.filter(
            w => w.op === 'ensureStyleRule' && w.args[0] === expected,
        );

        expect(registered).toHaveLength(1);
    });
});

// registerFocusVisibleRing paints on a `::after` overlay (like
// registerFocusWithinRing above) rather than `outline`, so a leaf control
// flush against a clipping ancestor (a TabButton in its TabBar strip, a
// ComboBox in a LabeledFieldSet) doesn't have its ring silently clipped away.
describe('registerFocusVisibleRing', () => {
    it('appends the :focus-visible::after and [data-ts-ui-focus-visible]::after pseudo to a single base selector', () => {
        registerFocusVisibleRing('.SomeControl');

        const expected =
            '.SomeControl:focus-visible::after, .SomeControl[data-ts-ui-focus-visible]::after';
        const registered = sink.writes.some(
            w => w.op === 'ensureStyleRule' && w.args[0] === expected,
        );

        expect(registered).toBe(true);
    });

    it('appends both pseudos to each of a compound comma-separated base selector, as one rule', () => {
        registerFocusVisibleRing('.Button, .ComboBox');

        const expected = [
            '.Button:focus-visible::after',
            '.Button[data-ts-ui-focus-visible]::after',
            '.ComboBox:focus-visible::after',
            '.ComboBox[data-ts-ui-focus-visible]::after',
        ].join(', ');
        const registered = sink.writes.filter(
            w => w.op === 'ensureStyleRule' && w.args[0] === expected,
        );

        expect(registered).toHaveLength(1);
    });

    it("also suppresses the browser's native default outline on the bare (non-::after) selector", () => {
        registerFocusVisibleRing('.AnotherControl');

        const bareSelector =
            '.AnotherControl:focus-visible, .AnotherControl[data-ts-ui-focus-visible]';
        const declarations: Record<string, string | null> = {};
        for (const w of sink.writes) {
            if (w.op === 'setRuleStyles' && w.args[0] === bareSelector) {
                Object.assign(declarations, w.args[1]);
            }
        }

        expect(declarations.outline).toBe('none');
    });

    it('merges baseStyles onto the bare selector, alongside outline: none', () => {
        registerFocusVisibleRing('.OverrideBase', { baseStyles: { borderColor: 'transparent' } });

        const bareSelector =
            '.OverrideBase:focus-visible, .OverrideBase[data-ts-ui-focus-visible]';
        const declarations: Record<string, string | null> = {};
        for (const w of sink.writes) {
            if (w.op === 'setRuleStyles' && w.args[0] === bareSelector) {
                Object.assign(declarations, w.args[1]);
            }
        }

        expect(declarations.outline).toBe('none');
        expect(declarations.borderColor).toBe('transparent');
    });

    it('merges ringStyles onto the ::after ring, overriding a base ring property when it collides', () => {
        registerFocusVisibleRing('.OverrideRing', { ringStyles: { boxShadow: 'inset 0 0 0 1px white' } });

        const afterSelector =
            '.OverrideRing:focus-visible::after, .OverrideRing[data-ts-ui-focus-visible]::after';
        const declarations: Record<string, string | null> = {};
        for (const w of sink.writes) {
            if (w.op === 'setRuleStyles' && w.args[0] === afterSelector) {
                Object.assign(declarations, w.args[1]);
            }
        }

        expect(declarations.boxShadow).toBe('inset 0 0 0 1px white');
        // The base ring's own border is untouched when only boxShadow is overridden.
        expect(declarations.border).toBe('2px solid var(--ts-ui-indicator-focus, rgb(30, 100, 200))');
    });
});
