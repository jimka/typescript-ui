// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for plans/implemented/button-chromeless-followup-dedup.md
// Expected Behaviour row 4: AccordionHeader's inline title button drops
// `chromeless: true` in favour of a real, declared-chrome `Button` subclass
// (`AccordionHeaderTitleButton`), so a second header's title button dedupes
// onto the shared `.AccordionHeaderTitleButton`/`.AccordionHeaderTitleButton.pressed`/
// `.AccordionHeaderTitleButton:hover:not(.pressed)` class rules instead of
// repeating every declaration on its own `#id`/`#id.pressed`/`#id:hover`
// rule — the same shape and helpers as PickerButton's coverage
// (`tests/component/input/PickerButton.classStyleHoisting.test.ts`),
// including the module-cache-per-file caveat documented there. The hover
// coverage was added by round 3 of the audit, which found the plan's
// original "hover needs no override" claim false — see
// plans/implemented/button-chromeless-followup-dedup.md's Implementation
// Notes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { AccordionHeader } from '~/component/container/AccordionHeader';
import type { Button } from '~/component/button/Button';

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

describe('AccordionHeader title button class-tier chrome dedup', () => {
    it('row 4: the priming instance materialises the shared resting + pressed + hover class rules; a second title button writes to none of its own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // `.AccordionHeaderTitleButton` (resting),
        // `.AccordionHeaderTitleButton.pressed`, and
        // `.AccordionHeaderTitleButton:hover:not(.pressed)` are all
        // materialised together, on this first header's title button's
        // construction and render (the state-tier `.pressed`/`:hover` rules
        // can be materialised as early as construction) — capture the whole
        // window, then split by selector.
        const primedWrites = writesDuring(sink, () => {
            const title = new AccordionHeader('Section').getTitleButton();
            title.getElement(true);
        });

        const restingDeclarations = declarationsFor(primedWrites, '.AccordionHeaderTitleButton');
        expect(restingDeclarations.backgroundColor).toBe('transparent');
        expect(restingDeclarations.backgroundImage).toBe('none');
        expect(restingDeclarations.borderTop).toBe('none');
        expect(restingDeclarations.borderRight).toBe('none');
        expect(restingDeclarations.borderBottom).toBe('none');
        expect(restingDeclarations.borderLeft).toBe('none');
        expect(restingDeclarations.boxShadow).toBe('none');

        const pressedDeclarations = declarationsFor(primedWrites, '.AccordionHeaderTitleButton.pressed');
        expect(pressedDeclarations.color).toBe('var(--ts-ui-text-color, black)');
        expect(pressedDeclarations.backgroundColor).toBe('transparent');
        expect(pressedDeclarations.backgroundImage).toBe('none');
        expect(pressedDeclarations.boxShadow).toBe('none');

        // `:hover` is pinned flat to the same transparent/none values as
        // resting — same mechanism and fix as PickerButton's own hover pin
        // (see PickerButton.classStyleHoisting.test.ts's row-3 coverage and
        // plans/implemented/button-chromeless-followup-dedup.md's
        // Implementation Notes): a chromeless title button's bare `#id`
        // resting write used to outrank `.Button:hover:not(.pressed)` for
        // free, so hover never visibly changed; once the resting write moved
        // onto the lower-specificity `.AccordionHeaderTitleButton` class
        // rule, that suppression stopped happening automatically.
        const hoverDeclarations = declarationsFor(primedWrites, '.AccordionHeaderTitleButton:hover:not(.pressed)');
        expect(hoverDeclarations.backgroundColor).toBe('transparent');
        expect(hoverDeclarations.backgroundImage).toBe('none');
        expect(hoverDeclarations.boxShadow).toBe('none');

        // A second header's title button, reached via getTitleButton() after
        // the rules above are primed, writes no real declaration to its own
        // resting, #id.pressed, or #id:hover rules — its id isn't known
        // until construction, so filter the captured window after the fact.
        let second!: Button;
        const secondWrites = writesDuring(sink, () => {
            second = new AccordionHeader('Other section').getTitleButton();
            second.getElement(true);
        });

        // The resting write is isolated onto `#id:not(.pressed):not(:hover)`
        // (see `restingGuardSuffix`/`isRestingChromeIsolated` in Component.ts):
        // backgroundColor/backgroundImage/boxShadow are also part of
        // AccordionHeaderTitleButton's own `.pressed`/`:hover` state bags, so
        // a bare `#id` write would tie in specificity against the shared
        // `.AccordionHeaderTitleButton.pressed` rule — matching
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
