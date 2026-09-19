// The three composite inputs (picker fields, AutoCompleteField, NumberSpinner)
// shared a byte-identical `:focus-within::after` StyleRule; it now lives in one
// helper. The recording sink records ensureStyleRule(selector) when a rule
// materialises, so the observable contract is that the helper registers a rule
// for exactly the selector it was given.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * Starts a fresh module graph and installs the modelled DOM before anything
 * else evaluates, so the fresh `~/core/StyleTarget` copy backing this fresh
 * `focusRing` copy has made no stylesheet write yet. Both fresh modules are
 * imported from the same registry state, so they share one `StyleTarget`
 * instance and its deferral queue.
 */
async function freshFocusRing(): Promise<{
    registerFocusWithinRing:  typeof registerFocusWithinRing;
    registerFocusVisibleRing: typeof registerFocusVisibleRing;
    freshStyleRule:            typeof import('~/core/StyleTarget').StyleRule;
    freshSink:                 RecordingDOMSink;
}> {
    vi.resetModules();

    const { installTestDOM: freshInstallTestDOM } = await import('../../dom/TestDOM');
    const freshSink = freshInstallTestDOM(CONFIG);
    const focusRing = await import('~/component/input/focusRing');
    const { StyleRule: freshStyleRule } = await import('~/core/StyleTarget');

    return {
        registerFocusWithinRing:  focusRing.registerFocusWithinRing,
        registerFocusVisibleRing: focusRing.registerFocusVisibleRing,
        freshStyleRule,
        freshSink,
    };
}

// Regression: these helpers used to construct their `StyleRule`s the instant
// they ran, which — called from a module's top level, as every caller does —
// crashes an import with no DOM present. They now queue through
// `deferStyleSheetWrite`, so calling either helper from a module's top level
// touches no DOM. Each case starts a fresh module graph (see
// `freshFocusRing`), since the deferral state is a load-time flag this file's
// own top-level import already flipped.
describe('focus-ring deferral', () => {
    it('F1. the ring rules queue instead of writing immediately, and land ahead of the first real write', async () => {
        const { registerFocusVisibleRing: freshVisible, registerFocusWithinRing: freshWithin, freshStyleRule, freshSink } =
            await freshFocusRing();

        freshVisible('.Deferred');
        freshWithin('.DeferredWithin');

        expect(freshSink.writes.some((w) => w.op === 'ensureStyleRule')).toBe(false);

        new freshStyleRule({ scope: 'selector', name: '.Trigger', styles: { color: 'green' } });

        const order = freshSink.writes
            .filter((w) => w.op === 'ensureStyleRule')
            .map((w) => w.args[0] as string);

        expect(order).toEqual([
            '.Deferred:focus-visible, .Deferred[data-ts-ui-focus-visible]',
            '.Deferred:focus-visible::after, .Deferred[data-ts-ui-focus-visible]::after',
            '.DeferredWithin:focus-within::after',
            '.Trigger',
        ]);
    });

    // Deferral must not reorder the ring relative to the render-time rules it
    // ties in specificity with (plans/implemented/no-dom-access-at-import.md,
    // Architecture Decisions, "The focus ring renders exactly as before") —
    // both `.Button:focus-visible` rules load ahead of `.Button.pressed`,
    // `.ts-ui-component.undisplayed` and the framework/class tiers today, and
    // must stay ahead of them. Only the relative order is asserted, not the
    // exhaustive write list, so this stays robust to an unrelated rule Button
    // starts writing later.
    it('F2. a fresh Button render still puts its focus ring ahead of its other rules', async () => {
        vi.resetModules();
        const { installTestDOM: freshInstallTestDOM } = await import('../../dom/TestDOM');
        const freshSink = freshInstallTestDOM(CONFIG);
        const { Button } = await import('~/component/button/Button');

        const button = new Button({ text: 'x' });

        try {
            button.getElement(true);

            const order = freshSink.writes
                .filter((w) => w.op === 'ensureStyleRule' || w.op === 'ensureKeyframes')
                .map((w) => w.args[0] as string);

            const ringIndices = [
                '.Button:focus-visible, .Button[data-ts-ui-focus-visible]',
                '.Button:focus-visible::after, .Button[data-ts-ui-focus-visible]::after',
            ].map((selector) => order.indexOf(selector));

            expect(ringIndices.every((idx) => idx >= 0)).toBe(true);
            const lastRingIndex = Math.max(...ringIndices);

            for (const laterSelector of ['.Button.pressed', '.ts-ui-component.undisplayed', ':where(.ts-ui-component)', '.Button']) {
                expect(order.indexOf(laterSelector)).toBeGreaterThan(lastRingIndex);
            }
        } finally {
            button.dispose();
        }
    });
});
