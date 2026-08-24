// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/button-chromeless-followup-dedup.md
// Expected Behaviour rows 1-3: PickerButton drops `chromeless: true` in favour
// of real, declared resting + pressed + hover chrome, so a second instance
// dedupes onto the shared `.PickerButton`/`.PickerButton.pressed`/
// `.PickerButton:hover:not(.pressed)` class rules instead of repeating every
// declaration on its own `#id`/`#id.pressed`/`#id:hover` rule. (Row 3 was
// originally "hover falls through to Button's shared rule unchanged" — round
// 3 of the audit found that claim false, since the resting write's move off
// the bare `#id` rule means `.Button:hover:not(.pressed)` now outranks it;
// the fix pins `:hover` flat instead, so this file's row-3 coverage now
// asserts the pin. See plans/implemented/button-chromeless-followup-dedup.md's
// Implementation Notes.)
//
// `writesDuring`/`declarationsFor`/`idSelector` are recreated locally,
// mirroring `tests/core/ClassHierarchyCascade.test.ts` (module-private
// there). Unlike that file's per-test locally-declared probe classes,
// `PickerButton` is a single shared class, so its `.PickerButton`/
// `.PickerButton.pressed`/`.PickerButton:hover:not(.pressed)` rules are only
// ever materialised once across this whole test *file* (the
// `core/ClassStyleRules.ts` registry is module state that survives
// `DOM.reset()` between tests, only resetting between test files) — the
// first test below captures all three from that one priming instance's
// construction *and* render (the state-tier `.pressed`/`:hover` rules can be
// materialised as early as construction, before any render-only write), and
// the second instance in that same test exercises a *second* instance's own
// rule for all three selectors, since a later, separate test could no longer
// observe a first-priming write once the class rules are already cached.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { PickerButton } from '~/component/input/PickerButton';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

type RecordedWrite = RecordingDOMSink['writes'][number];

/** Every sink op recorded while `fn()` ran. */
function writesDuring(sink: RecordingDOMSink, fn: () => void): RecordedWrite[] {
    const start = sink.writes.length;
    fn();

    return sink.writes.slice(start);
}

/**
 * Declarations written to `selector`'s stylesheet rule across `writes`,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted.
 */
function declarationsFor(writes: readonly RecordedWrite[], selector: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('PickerButton class-tier chrome dedup', () => {
    it('rows 1-3: the priming instance materialises the shared resting + pressed + hover class rules; a second instance writes to none of its own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // `.PickerButton` (resting), `.PickerButton.pressed`, and
        // `.PickerButton:hover:not(.pressed)` are all materialised together,
        // on this first instance's construction and render — capture the
        // whole window, then split by selector.
        const primedWrites = writesDuring(sink, () => {
            new PickerButton().getElement(true);
        });

        const restingDeclarations = declarationsFor(primedWrites, '.PickerButton');
        expect(restingDeclarations.backgroundColor).toBe('transparent');
        expect(restingDeclarations.backgroundImage).toBe('none');
        expect(restingDeclarations.borderTop).toBe('none');
        expect(restingDeclarations.borderRight).toBe('none');
        expect(restingDeclarations.borderBottom).toBe('none');
        expect(restingDeclarations.borderLeft).toBe('none');
        expect(restingDeclarations.boxShadow).toBe('none');

        const pressedDeclarations = declarationsFor(primedWrites, '.PickerButton.pressed');
        expect(pressedDeclarations.color).toBe('var(--ts-ui-text-color, black)');
        expect(pressedDeclarations.backgroundColor).toBe('transparent');
        expect(pressedDeclarations.backgroundImage).toBe('none');
        expect(pressedDeclarations.boxShadow).toBe('none');

        // Row 3: `:hover` is pinned flat to the same transparent/none values
        // as resting — a chromeless PickerButton's bare `#id` resting write
        // used to outrank `.Button:hover:not(.pressed)` for free, but once
        // the resting write moved onto the lower-specificity `.PickerButton`
        // class rule, that suppression no longer happens automatically;
        // PickerButton pins its own `:hover` entry instead, the same shape
        // `WindowControlButton`/`TabCloseButton`/`MenuBarButton` already use.
        const hoverDeclarations = declarationsFor(primedWrites, '.PickerButton:hover:not(.pressed)');
        expect(hoverDeclarations.backgroundColor).toBe('transparent');
        expect(hoverDeclarations.backgroundImage).toBe('none');
        expect(hoverDeclarations.boxShadow).toBe('none');
        expect(_ruleCacheHas('.PickerButton:hover:not(.pressed)')).toBe(true);

        // A second instance, constructed (and rendered) after the rules
        // above are primed, writes no real declaration to its own resting,
        // #id.pressed, or #id:hover rules — its id isn't known until
        // construction, so filter the captured window after the fact.
        let second!: PickerButton;
        const secondWrites = writesDuring(sink, () => {
            second = new PickerButton();
            second.getElement(true);
        });

        // The resting write is isolated onto `#id:not(.pressed):not(:hover)`
        // (see `restingGuardSuffix`/`isRestingChromeIsolated` in Component.ts):
        // backgroundColor/backgroundImage/boxShadow are also part of
        // PickerButton's own `.pressed`/`:hover` state bags, so a bare `#id`
        // write would tie in specificity against the shared
        // `.PickerButton.pressed` rule — matching
        // WindowControlButton.classStyleHoisting.test.ts's identical check.
        const idDeclarations = declarationsFor(secondWrites, idSelector(second) + ':not(.pressed):not(:hover)');
        expect(idDeclarations.backgroundColor).toBeUndefined();
        expect(idDeclarations.backgroundImage).toBeUndefined();
        expect(idDeclarations.boxShadow).toBeUndefined();

        const pressedIdDeclarations = declarationsFor(secondWrites, idSelector(second) + '.pressed');
        expect(pressedIdDeclarations.color).toBeUndefined();
        expect(pressedIdDeclarations.backgroundColor).toBeUndefined();
        expect(pressedIdDeclarations.backgroundImage).toBeUndefined();
        expect(pressedIdDeclarations.boxShadow).toBeUndefined();

        const hoverIdDeclarations = declarationsFor(secondWrites, idSelector(second) + ':hover:not(.pressed)');
        expect(hoverIdDeclarations.backgroundColor).toBeUndefined();
        expect(hoverIdDeclarations.backgroundImage).toBeUndefined();
        expect(hoverIdDeclarations.boxShadow).toBeUndefined();
    });
});
