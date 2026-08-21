// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Checkbox-specific coverage for the state-tier dedup introduced by
// plans/implemented/checkbox-radio-delegate-state-style-defaults.md: `CheckboxBox` gains
// two `createStateStyleRule`-backed rules (`.selected`, `.indeterminate`),
// isolated from its resting chrome via `getRestingExclusionSuffixes()` — the
// same mechanism `Button`'s `.pressed` and `ToggleButton`'s `.selected`
// already use. Conventions (idSelector/declarationsDuring) copied from
// ToggleButton.selectedClassHoisting.test.ts / TabButton.stateClassHoisting.test.ts.
// RadioButton-specific coverage lives in RadioButton.stateClassHoisting.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { Checkbox } from '~/component/input/Checkbox';
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

describe('Checkbox delegate state-class hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 1: a second, default-styled Checkbox selected after a first has warmed the class rule writes no backgroundColor or border to its own #id.selected rule', () => {
        const sink = installTestDOM(CONFIG);

        new Checkbox({ selected: true }).getElement(true);

        const second = new Checkbox() as any;
        second.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(second._box) + '.selected', () => {
            second.setSelected(true);
        });

        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(_ruleCacheHas('.CheckboxBox.selected')).toBe(true);
    });

    it('row 2: same dedup for setIndeterminate(true), including border', () => {
        const sink = installTestDOM(CONFIG);

        new Checkbox({ indeterminate: true }).getElement(true);

        const second = new Checkbox() as any;
        second.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(second._box) + '.indeterminate', () => {
            second.setIndeterminate(true);
        });

        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.borderTop).toBeUndefined();
        expect(declarations.borderRight).toBeUndefined();
        expect(declarations.borderBottom).toBeUndefined();
        expect(declarations.borderLeft).toBeUndefined();
        expect(_ruleCacheHas('.CheckboxBox.indeterminate')).toBe(true);
    });

    it('row 3: border writes nothing at resting, checked, or indeterminate — the class-tier rule carries it', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const box  = cb._box;

        // Resting relies entirely on the .CheckboxBox class rule; borderRadius
        // is a class default too now, so nothing on a default-styled `_box`
        // deviates from `.CheckboxBox` at all — `#id` never materialises, and
        // border comes back as an absent key, not a `null` removal.
        const restingDeclarations = declarationsDuring(sink, idSelector(box), () => cb.getElement(true));
        expect(restingDeclarations.borderTop).toBeUndefined();
        expect(restingDeclarations.borderRight).toBeUndefined();
        expect(restingDeclarations.borderBottom).toBeUndefined();
        expect(restingDeclarations.borderLeft).toBeUndefined();

        // Checked/indeterminate: border is now part of getSelectedClassDeclarations()/
        // getIndeterminateClassDeclarations(), so it dedupes onto the shared
        // .CheckboxBox.selected/.indeterminate class rule the same way backgroundColor
        // does — nothing reaches the instance rule.
        const selectedDeclarations = declarationsDuring(sink, idSelector(box) + '.selected', () => {
            cb.setSelected(true);
        });
        expect(selectedDeclarations.borderTop).toBeUndefined();
        expect(selectedDeclarations.borderRight).toBeUndefined();
        expect(selectedDeclarations.borderBottom).toBeUndefined();
        expect(selectedDeclarations.borderLeft).toBeUndefined();

        const indeterminateDeclarations = declarationsDuring(sink, idSelector(box) + '.indeterminate', () => {
            cb.setIndeterminate(true);
        });
        expect(indeterminateDeclarations.borderTop).toBeUndefined();
        expect(indeterminateDeclarations.borderRight).toBeUndefined();
        expect(indeterminateDeclarations.borderBottom).toBeUndefined();
        expect(indeterminateDeclarations.borderLeft).toBeUndefined();
    });

    it('row 4: a checked-then-unchecked cycle writes nothing to the base rule after construction', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox() as any;
        const box  = cb._box;

        cb.getElement(true);

        const baseBorderSelector     = idSelector(box);
        const baseBackgroundSelector = idSelector(box) + ':not(.selected):not(.indeterminate)';

        const start = sink.writes.length;
        cb.setSelected(true);
        cb.setSelected(false);

        const baseWrites = sink.writes.slice(start).filter((w: any) =>
            w.op === 'setRuleStyles' && (w.args[0] === baseBorderSelector || w.args[0] === baseBackgroundSelector)
        );

        expect(baseWrites).toEqual([]);
    });

    it('row 5: a Checkbox constructed already-selected re-asserts .selected on _box at render, not just at construction', () => {
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox({ selected: true }) as any;

        // Pre-mount: applyState's DOM.sink.apply call is guarded behind
        // `if (element)`, and _box has no element yet, so no toggleClass write
        // happened during construction.
        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(false);

        cb.getElement(true);

        expect(sink.writes.some((w: any) => w.op === 'apply' && JSON.stringify(w.args).includes('"selected":true'))).toBe(true);
    });

    it('setIndeterminate(true) on an already-selected Checkbox never carries .selected onto _box alongside .indeterminate', () => {
        // Checkbox.setIndeterminate deliberately leaves `selected` untouched
        // (see its doc comment), so this sequence reaches applyState(true,
        // true) — the resting-isolation selector's premise that .selected and
        // .indeterminate are mutually exclusive CSS classes must still hold.
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox({ selected: true }) as any;
        cb.getElement(true);

        const start = sink.writes.length;
        cb.setIndeterminate(true);

        const toggleWrite = sink.writes.slice(start).find((w: any) => w.op === 'apply' && (w.args[1] as { toggleClass?: unknown }).toggleClass);
        expect(toggleWrite).toBeDefined();
        expect((toggleWrite!.args[1] as { toggleClass: Record<string, boolean> }).toggleClass).toEqual({
            selected:      false,
            indeterminate: true,
        });
    });

    it('a Checkbox constructed selected AND indeterminate never carries .selected onto _box at render either', () => {
        // Same mutual-exclusivity gap as the row above, but through the
        // render() re-assert path (row 5's mechanism) rather than a runtime
        // setIndeterminate call — `render()` applies its own selected/indeterminate
        // priority independently of applyState's, and needs its own coverage.
        const sink = installTestDOM(CONFIG);
        const cb   = new Checkbox({ selected: true, indeterminate: true }) as any;

        cb.getElement(true);

        const toggleWrite = sink.writes.find((w: any) => w.op === 'apply' && (w.args[1] as { toggleClass?: unknown }).toggleClass);
        expect(toggleWrite).toBeDefined();
        expect((toggleWrite!.args[1] as { toggleClass: Record<string, boolean> }).toggleClass).toEqual({
            selected:      false,
            indeterminate: true,
        });
    });
});
