// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Button-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic class/instance mechanism) live in tests/core/ClassStateRules.test.ts;
// ToggleButton/TabButton-specific coverage lives in the sibling test files
// this plan also adds.
//
// IMPORTANT SCOPE NOTE: `plans/implemented/button-resting-chrome-state-isolation.md`
// widened `.pressed`'s `ownStyleStates` extract to all four pressed-chrome
// keys — `color`, `backgroundColor`, `backgroundImage`, and `boxShadow` are
// now all deduped onto `.Button.pressed`. A deviating *resting*
// `background-color` / `background-image` / `box-shadow` no longer competes
// with that class rule: it now routes onto the instance's own
// `#id:not(.pressed)` rule instead of the bare `#id` rule, so the two
// selectors never match the same element at once. See
// `Button.restingChromeIsolation.test.ts` for that plan's own coverage.
// `:hover`'s `ownStyleStates` extract now mirrors `.pressed`'s shape (see
// plans/implemented/button-meta-class-dedup.md), so a default Button's
// hover backgroundColor/backgroundImage/boxShadow dedupe onto
// `.Button:hover:not(.pressed)` the same way `.pressed` already does.
// `hoverForegroundColor` has no class default, so it stays caller-gated and
// always writes for real.
//
// Same module-state caveat as `ClassStyleRules.test.ts`: `.Button.pressed`
// is process-module state (fresh per test *file*, not per test),
// materialising the first time any Button/SpinButton in this file renders —
// every test below either warms up explicitly or relies on being the first
// Button use in the file.
//
// Since plans/implemented/spinbutton-pressed-boxshadow-state-tier-dedup.md,
// `SpinButton` declares its own `ownStyleStates`, restating `Button`'s
// `:hover` entry unchanged and overriding `.pressed`'s `shadow` to `"none"`
// — so `.SpinButton.pressed` IS created, carrying only that one deviating
// declaration; `.pressed`'s other three keys still resolve from
// `.Button.pressed`. See `SpinButton.pressedShadowClassHoisting.test.ts` for
// that plan's own coverage.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { SpinButton } from '~/component/input/SpinButton';
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
 * flattened into one key/value map. Copied from `ClassStyleRules.test.ts`.
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

describe('Button pressed/hover state-class hoisting', () => {
    it("a default Button's pressed color, backgroundColor, backgroundImage, and boxShadow are all deduped onto .Button.pressed", () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        const pressedDeclarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));

        // Deduped: each matches the class-tier default, so the instance writes nothing.
        expect(pressedDeclarations.color).toBeUndefined();
        expect(pressedDeclarations.backgroundColor).toBeUndefined();
        expect(pressedDeclarations.backgroundImage).toBeUndefined();
        expect(pressedDeclarations.boxShadow).toBeUndefined();

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
    });

    it("a default Button's hover backgroundColor, backgroundImage, and boxShadow are all deduped onto .Button:hover:not(.pressed)", () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        const hoverDeclarations = declarationsDuring(sink, idSelector(second) + ':hover:not(.pressed)', () => second.getElement(true));

        // Deduped: each matches the class-tier default, so the instance writes nothing.
        expect(hoverDeclarations.backgroundColor).toBeUndefined();
        expect(hoverDeclarations.backgroundImage).toBeUndefined();
        expect(hoverDeclarations.boxShadow).toBeUndefined();

        expect(_ruleCacheHas('.Button:hover:not(.pressed)')).toBe(true);
    });

    it('a caller-gated field with no class default always writes', () => {
        const btn = new Button('HoverFg');
        btn.setHoverForegroundColor('red');

        const declarations = declarationsDuring(sink, idSelector(btn) + ':hover:not(.pressed)', () => btn.getElement(true));

        expect(declarations.color).toBe('red');
    });

    it('setPressedForegroundColor on one instance still writes #id.pressed, leaving the class rule untouched', () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        second.setPressedForegroundColor('red');

        const declarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));
        expect(declarations.color).toBe('red');

        const classDeclarations = declarationsDuring(sink, '.Button.pressed', () => {
            new Button('Third').getElement(true);
        });
        expect(classDeclarations).toEqual({});
    });

    it("SpinButton's .pressed state resolves color/backgroundColor/backgroundImage to .Button.pressed and shadow to its own .SpinButton.pressed class rule", () => {
        new SpinButton('▲').getElement(true);

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
        expect(_ruleCacheHas('.SpinButton.pressed')).toBe(true);
    });

    it("SpinButton's constructor-time clearPressedShadow dedupes against the shared .SpinButton.pressed class rule instead of writing its own instance rule", () => {
        const spin = new SpinButton('▲');

        // `.Button.pressed` (the rule SpinButton's `.pressed` state resolves
        // color/backgroundColor/backgroundImage to — see the case above)
        // materialises eagerly, during construction (when the first
        // setPressedX call resolves `pressedClassBag`) — well before this
        // capture window starts, so nothing shows up here regardless of what
        // the bag holds.
        const classDeclarations = declarationsDuring(sink, '.Button.pressed', () => spin.getElement(true));
        expect(classDeclarations).toEqual({});

        // `.SpinButton.pressed` carries `boxShadow: 'none'` — materialised by
        // the first `SpinButton` above, same construction-time timing as
        // `.Button.pressed`. `clearPressedShadow` on this second instance
        // resolves to the same `"none"` value, so it dedupes to a no-op
        // removal rather than a real per-instance declaration.
        const second = new SpinButton('▼');
        const instanceDeclarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));
        expect(instanceDeclarations.boxShadow).toBeUndefined();
    });

    it('a chromeless Button pins its own pressed color instead of leaking the shared .Button.pressed class rule', () => {
        // `chromeless` skips the pressed/hover setter dispatch entirely (see
        // `applyChromeOptions`), so without an explicit counter-write a
        // chromeless instance would never touch its own `#id.pressed` rule —
        // leaving `.Button.pressed`'s shared `color` (materialised by any
        // *other*, chromeful Button in the process) to leak through via the
        // CSS class selector, since nothing at higher specificity opts it out.
        new Button('Chromeful').getElement(true);

        const chromeless = new Button('Chromeless', { chromeless: true });
        const declarations = declarationsDuring(sink, idSelector(chromeless) + '.pressed', () => chromeless.getElement(true));

        // Pinned to the resting foreground — a real, differing value from the
        // class bag's pressed-fg token, so it reliably outranks the shared rule.
        expect(declarations.color).toBeDefined();
        expect(declarations.color).not.toBe('var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))');
    });

    it('a Button toggled chromeless at runtime (setChromeless(true)) also pins its pressed color, not just a construction-time { chromeless: true }', () => {
        // `_clearChrome()` (setChromeless(true)'s DOM-reconciliation path) is
        // a *second*, separate code path into the same leak as the case
        // above: it used to call `clearPressedForegroundColor()`, a `null`
        // write that can never win the cascade against `.Button.pressed`'s
        // shared non-null token, for exactly the same reason.
        new Button('Warmup').getElement(true);

        const btn = new Button('Toggled');
        btn.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(btn) + '.pressed', () => btn.setChromeless(true));

        expect(declarations.color).toBeDefined();
        expect(declarations.color).not.toBeNull();
        expect(declarations.color).not.toBe('var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))');
    });

    it('setChromeless(false) overwrites a stale pinned pressed color left by an earlier setChromeless(true)/construction-time pin', () => {
        // `flushStateStyleBag` queues an explicit `null` when a write matches
        // the class-tier bag, rather than skipping it (see
        // plans/implemented/state-tier-full-unification.md's `[^restore-chrome]`
        // note) — so `_restoreChrome()` (the setChromeless(false)/setFlat(false)
        // round-trip) no longer needs to force a literal re-write of the class
        // token: the ordinary `setPressedForegroundColor` call queues a `null`
        // that removes the stale pin from before and hands the property back
        // to `.Button.pressed`'s own rule.
        new Button('Warmup').getElement(true);

        const btn = new Button('X', { chromeless: true });
        btn.getElement(true);
        // Construction pinned a real, non-token value (color: resting fg —
        // the scenario the case above covers), establishing the stale state
        // this call then must overwrite.

        const restoreDeclarations = declarationsDuring(sink, idSelector(btn) + '.pressed', () => btn.setChromeless(false));
        expect(restoreDeclarations.color).toBeNull();
    });
});
