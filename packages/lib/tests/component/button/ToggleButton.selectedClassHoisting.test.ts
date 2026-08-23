// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// ToggleButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic mechanism) live in tests/core/ClassStateRules.test.ts;
// Button-specific coverage lives in Button.pressedHoverClassHoisting.test.ts;
// TabButton-specific coverage lives in TabButton.stateClassHoisting.test.ts.
//
// UPDATED by plans/implemented/state-chrome-isolation-generalization.md
// (Expected Behaviour row 8): `.selected:not(.pressed):not(:hover)` now dedupes across
// instances of the same class, the same way `Button`'s `.pressed` already
// does. `ToggleButton` gained its own `getRestingExclusionSuffixes()`
// override (adding `.selected` to the isolation list `Button` already
// contributes for `.pressed`), which closes the specificity gap that
// previously forced `selectedClassBag` to stay hardcoded `null` — see that
// plan's Architecture Decisions for the full explanation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ToggleButton } from '~/component/button/ToggleButton';
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

describe('ToggleButton selected state-class hoisting', () => {
    it('row 8: a second, default-styled ToggleButton renders after a first has warmed the class rule — no write to its own #id.selected:not(.pressed):not(:hover) rule, and .ToggleButton.selected:not(.pressed):not(:hover) is in the rule cache', () => {
        new ToggleButton('Warmup').getElement(true);

        const second = new ToggleButton('Second');
        const declarations = declarationsDuring(sink, idSelector(second) + '.selected:not(.pressed):not(:hover)', () => second.getElement(true));

        expect(declarations).toEqual({});
        expect(_ruleCacheHas('.ToggleButton.selected:not(.pressed):not(:hover)')).toBe(true);
    });
});
