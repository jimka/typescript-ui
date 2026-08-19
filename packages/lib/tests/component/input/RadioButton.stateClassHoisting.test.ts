// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// RadioButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/checkbox-radio-delegate-state-style-defaults.md: `RadioButtonRing`
// gains one `createStateStyleRule`-backed rule (`.selected`), isolated from
// its resting chrome via `getRestingExclusionSuffixes()` — the same
// mechanism `Button`'s `.pressed` and `ToggleButton`'s `.selected` already
// use. Conventions (idSelector/declarationsDuring) copied from
// ToggleButton.selectedClassHoisting.test.ts / TabButton.stateClassHoisting.test.ts.
// Checkbox-specific coverage lives in Checkbox.stateClassHoisting.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { RadioButton } from '~/component/input/RadioButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
 */
function declarationsDuring(
    sink: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    const start = sink.writes.length;
    fn();

    const out: Record<string, string | null> = {};
    for (const w of sink.writes.slice(start)) {
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

describe('RadioButton delegate state-class hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 6: a second, default-styled RadioButton selected after a first has warmed the class rule writes no backgroundColor or border to its own #id.selected rule', () => {
        const sink = installTestDOM(CONFIG);

        new RadioButton(undefined, { selected: true }).getElement(true);

        const second = new RadioButton() as any;
        second.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(second._ring) + '.selected', () => {
            second.setSelected(true);
        });

        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(_ruleCacheHas('.RadioButtonRing.selected')).toBe(true);
    });

    it('row 7: border writes nothing at resting or selected — the class-tier rule carries it', () => {
        const sink = installTestDOM(CONFIG);
        const rb   = new RadioButton() as any;
        const ring = rb._ring;

        // Resting: relies entirely on the .RadioButtonRing class rule
        // established at construction — no real border value reaches the
        // instance rule. A `null` (rather than an absent key) is still
        // expected here: _ring's constructor also sets a genuinely
        // per-instance borderRadius, which shares this same underlying #id
        // rule, so border's "clear on match, never skip" queue rides along
        // in the same flush as an inert removal — it declares nothing, so
        // the class rule's border cascades through.
        const restingDeclarations = declarationsDuring(sink, idSelector(ring), () => rb.getElement(true));
        expect(restingDeclarations.borderTop).toBeNull();
        expect(restingDeclarations.borderRight).toBeNull();
        expect(restingDeclarations.borderBottom).toBeNull();
        expect(restingDeclarations.borderLeft).toBeNull();

        // Selected: border is now part of getSelectedClassDeclarations(), so it
        // dedupes onto the shared .RadioButtonRing.selected class rule the same
        // way backgroundColor does — nothing reaches the instance rule.
        const selectedDeclarations = declarationsDuring(sink, idSelector(ring) + '.selected', () => {
            rb.setSelected(true);
        });
        expect(selectedDeclarations.borderTop).toBeUndefined();
        expect(selectedDeclarations.borderRight).toBeUndefined();
        expect(selectedDeclarations.borderBottom).toBeUndefined();
        expect(selectedDeclarations.borderLeft).toBeUndefined();
    });

    it('row 8: a RadioButton constructed already-selected re-asserts .selected on _ring at render, not just at construction', () => {
        const sink = installTestDOM(CONFIG);
        const rb   = new RadioButton(undefined, { selected: true }) as any;

        // Pre-mount: applyState's DOM.sink.apply call is guarded behind
        // `if (element)`, and _ring has no element yet, so no toggleClass write
        // happened during construction.
        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(false);

        rb.getElement(true);

        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(true);
    });
});
