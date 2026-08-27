// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/railhandle-chromeless-dedup.md
// Expected Behaviour rows 1-6: RailHandle drops `chromeless: true` in favour
// of real, declared resting + pressed + hover + selected chrome, so a second
// instance dedupes onto the shared `.RailHandle`/`.RailHandle.pressed`/
// `.RailHandle.selected:not(.pressed)`/`.RailHandle:hover:not(.pressed):not(.selected)`
// class rules instead of repeating every declaration on its own
// `#id`/`#id.pressed`/`#id:hover:not(.selected)` rule (the last of those
// selectors must vanish entirely — it was the hand-rolled `railHoverRule`
// this plan deletes).
//
// `writesDuring`/`declarationsFor`/`idSelector` are recreated locally,
// mirroring `tests/component/input/PickerButton.classStyleHoisting.test.ts`
// (module-private there too). A chromeful `Button` primes `.Button`'s own
// class rules first, matching the plan's `## Ordered Implementation Steps`
// step 2 instruction, so the priming `RailHandle` below resolves its state
// content against a `.Button` ancestor level that has actually materialised
// — the same situation a real app is in, since `Button` instances exist
// everywhere.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { Button } from '~/component/button/Button';
import { RailHandle } from '~/overlay/RailHandle';
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

describe('RailHandle class-tier chrome dedup', () => {
    it('rows 1-6: shared resting/pressed/selected/hover class rules materialise once; a second instance writes to none of its own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // Prime `.Button`'s own class rules with one chromeful Button first —
        // see this file's header comment.
        new Button('primer').getElement(true);

        // `.RailHandle` (resting), `.RailHandle.pressed`,
        // `.RailHandle.selected:not(.pressed)`, and
        // `.RailHandle:hover:not(.pressed):not(.selected)` are all
        // materialised together, on this first instance's construction and
        // render — capture the whole window, then split by selector.
        let first!: RailHandle;
        const primedWrites = writesDuring(sink, () => {
            first = new RailHandle({ text: 'A' });
            first.getElement(true);
        });

        // Row 4: resting chrome.
        const restingDeclarations = declarationsFor(primedWrites, '.RailHandle');
        expect(restingDeclarations.backgroundColor).toBe('transparent');
        expect(restingDeclarations.backgroundImage).toBe('none');
        expect(restingDeclarations.borderTop).toBe('none');
        expect(restingDeclarations.borderRight).toBe('none');
        expect(restingDeclarations.borderBottom).toBe('none');
        expect(restingDeclarations.borderLeft).toBe('none');
        expect(restingDeclarations.boxShadow).toBe('none');

        // Row 5: `.pressed` reproduces `pinPressedToResting`'s four values.
        const pressedDeclarations = declarationsFor(primedWrites, '.RailHandle.pressed');
        expect(pressedDeclarations.color).toBe('var(--ts-ui-text-color, black)');
        expect(pressedDeclarations.backgroundColor).toBe('transparent');
        expect(pressedDeclarations.backgroundImage).toBe('none');
        expect(pressedDeclarations.boxShadow).toBe('none');

        // Row 6: `.selected` and `:hover` carry real washes, each with all
        // three keys (see plan's `[^selected-needs-three-keys]`).
        const selectedDeclarations = declarationsFor(primedWrites, '.RailHandle.selected:not(.pressed)');
        expect(selectedDeclarations.backgroundColor).toBe('var(--ts-ui-rail-handle-selected-bg)');
        expect(selectedDeclarations.backgroundImage).toBe('none');
        expect(selectedDeclarations.boxShadow).toBe('none');

        const hoverDeclarations = declarationsFor(primedWrites, '.RailHandle:hover:not(.pressed):not(.selected)');
        expect(hoverDeclarations.backgroundColor).toBe('var(--ts-ui-rail-handle-hover-bg)');
        expect(hoverDeclarations.backgroundImage).toBe('none');
        expect(hoverDeclarations.boxShadow).toBe('none');

        expect(_ruleCacheHas('.RailHandle')).toBe(true);
        expect(_ruleCacheHas('.RailHandle.pressed')).toBe(true);
        expect(_ruleCacheHas('.RailHandle.selected:not(.pressed)')).toBe(true);
        expect(_ruleCacheHas('.RailHandle:hover:not(.pressed):not(.selected)')).toBe(true);

        // Rows 1-3: a second instance, constructed (and rendered) after the
        // rules above are primed, writes no real declaration to its own
        // resting, `#id.pressed`, or `#id:hover:...` rule — its id isn't
        // known until construction, so filter the captured window after the
        // fact.
        let second!: RailHandle;
        const secondWrites = writesDuring(sink, () => {
            second = new RailHandle({ text: 'B' });
            second.getElement(true);
        });

        // Row 1: the resting write is isolated onto
        // `#id:not(.pressed):not(.selected):not(:hover)` (see
        // `restingGuardSuffix`/`isRestingChromeIsolated` in Component.ts) —
        // backgroundColor/backgroundImage/boxShadow are also part of
        // RailHandle's own `.pressed`/`.selected`/`:hover` state bags, so a
        // bare `#id` write would tie in specificity against the shared
        // `.RailHandle.pressed` rule.
        const idDeclarations = declarationsFor(secondWrites, idSelector(second) + ':not(.pressed):not(.selected):not(:hover)');
        expect(idDeclarations.backgroundColor).toBeUndefined();
        expect(idDeclarations.backgroundImage).toBeUndefined();
        expect(idDeclarations.boxShadow).toBeUndefined();
        expect(idDeclarations.borderTop).toBeUndefined();
        expect(idDeclarations.borderRight).toBeUndefined();
        expect(idDeclarations.borderBottom).toBeUndefined();
        expect(idDeclarations.borderLeft).toBeUndefined();

        // Row 2.
        const pressedIdDeclarations = declarationsFor(secondWrites, idSelector(second) + '.pressed');
        expect(pressedIdDeclarations.color).toBeUndefined();
        expect(pressedIdDeclarations.backgroundColor).toBeUndefined();
        expect(pressedIdDeclarations.backgroundImage).toBeUndefined();
        expect(pressedIdDeclarations.boxShadow).toBeUndefined();

        // Row 3: the old hand-rolled `#id:hover:not(.selected)` selector
        // never appears for either instance — it disappears from the
        // stylesheet entirely (`RailHandle` deletes `railHoverRule` outright).
        expect(_ruleCacheHas(idSelector(first) + ':hover:not(.selected)')).toBe(false);
        expect(_ruleCacheHas(idSelector(second) + ':hover:not(.selected)')).toBe(false);
        expect(sink.writes.some(w => w.args[0] === idSelector(first) + ':hover:not(.selected)')).toBe(false);
        expect(sink.writes.some(w => w.args[0] === idSelector(second) + ':hover:not(.selected)')).toBe(false);
    });
});
