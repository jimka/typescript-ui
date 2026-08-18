// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Button-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic class/instance mechanism) live in tests/core/ClassStateRules.test.ts;
// ToggleButton/TabButton-specific coverage lives in the sibling test files
// this plan also adds.
//
// IMPORTANT SCOPE NOTE (see this plan's Implementation Notes): only
// `pressedForegroundColor` is actually deduped onto `.Button.pressed`.
// `backgroundColor`, `backgroundImage`, and `boxShadow` — the fields the
// plan's own measurement named as the dominant byte-savings contributors —
// are deliberately EXCLUDED from `getPressedClassDeclarations()` /
// `getHoverClassDeclarations()`, because Button's own *resting* chrome
// writes these same three properties unconditionally onto the instance's
// base `#id` rule (specificity (1,0,0)), which beats any class-only
// selector such as `.Button.pressed` (specificity (0,2,0)) regardless of
// class count — deduping them would silently break the pressed/hover
// visual treatment for every default-styled Button. `getHoverClassDeclarations()`
// is therefore always empty (no field on `.hover` is safe), and no
// `.Button:hover:not(.pressed)` class rule is ever created.
//
// Same module-state caveat as `ClassStyleRules.test.ts`: `.Button.pressed`
// and `.SpinButton.pressed` are process-module state (fresh per test
// *file*, not per test), materialising the first time any Button/SpinButton
// in this file renders — every test below either warms up explicitly or
// relies on being the first Button use in the file.
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
    it("a default Button's pressed color is deduped onto .Button.pressed; backgroundColor/backgroundImage/boxShadow are not", () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        const pressedDeclarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));

        // Deduped: matches the class-tier default, so the instance writes nothing.
        expect(pressedDeclarations.color).toBeUndefined();

        // Not deduped: these three always land on the instance rule, exactly
        // as they did before this plan — the base `#id` rule's own
        // unconditional resting declarations for the same three properties
        // would otherwise outrank `.Button.pressed` on specificity.
        expect(pressedDeclarations.backgroundColor).toBeDefined();
        expect(pressedDeclarations.backgroundImage).toBeDefined();
        expect(pressedDeclarations.boxShadow).toBeDefined();

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
    });

    it("a default Button's hover state is never deduped — no .Button:hover:not(.pressed) class rule is created", () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        const hoverDeclarations = declarationsDuring(sink, idSelector(second) + ':hover:not(.pressed)', () => second.getElement(true));

        expect(hoverDeclarations.backgroundColor).toBeDefined();
        expect(hoverDeclarations.backgroundImage).toBeDefined();
        expect(hoverDeclarations.boxShadow).toBeDefined();

        expect(_ruleCacheHas('.Button:hover:not(.pressed)')).toBe(false);
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

    it("SpinButton's constructor-time clearPressedShadow writes directly to its own instance rule (boxShadow is not deduped, so there is no class default to clash with)", () => {
        const spin = new SpinButton('▲');

        const classDeclarations = declarationsDuring(sink, '.SpinButton.pressed', () => spin.getElement(true));
        // Only `color` is ever in a Button-family pressed class bag; boxShadow
        // is absent from `.SpinButton.pressed` entirely.
        expect(classDeclarations.boxShadow).toBeUndefined();

        const second = new SpinButton('▼');
        const instanceDeclarations = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));
        expect(instanceDeclarations.boxShadow).toBeNull();
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
        // `writeClassStateDeclaration`'s skip-on-match check only compares
        // the requested value against the shared class bag — it has no way
        // to know the instance's own `#id.pressed` rule already carries a
        // *different*, previously-pinned value. `_restoreChrome()` (the
        // setChromeless(false)/setFlat(false) round-trip) is specifically
        // "undo a prior pin", so it must force a real write even when the
        // restored value happens to match the class bag exactly — otherwise
        // the stale pin from before would survive, silently outranking
        // `.Button.pressed`'s correct token via `#id.pressed`'s specificity.
        new Button('Warmup').getElement(true);

        const btn = new Button('X', { chromeless: true });
        btn.getElement(true);
        // Construction pinned a real, non-token value (color: resting fg —
        // the scenario the case above covers), establishing the stale state
        // this call then must overwrite.

        const restoreDeclarations = declarationsDuring(sink, idSelector(btn) + '.pressed', () => btn.setChromeless(false));
        expect(restoreDeclarations.color).toBe('var(--ts-ui-button-pressed-fg, rgb(150, 150, 150))');
    });
});
