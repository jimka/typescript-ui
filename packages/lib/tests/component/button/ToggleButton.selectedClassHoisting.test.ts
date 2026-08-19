// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// ToggleButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic mechanism) live in tests/core/ClassStateRules.test.ts;
// Button-specific coverage lives in Button.pressedHoverClassHoisting.test.ts;
// TabButton-specific coverage lives in TabButton.stateClassHoisting.test.ts.
//
// IMPORTANT SCOPE NOTE (see this plan's Implementation Notes): unlike
// Button's `.pressed`, ToggleButton's `.selected:not(:hover)` state is
// deliberately NOT deduped at all — `selectedClassBag` is hardcoded to
// `null`. Its three fields (`boxShadow`/`backgroundColor`/`backgroundImage`)
// have the same base-`#id`-rule specificity conflict Button's
// backgroundColor/backgroundImage/boxShadow have (see the sibling Button
// test file), and ToggleButton has no `color`-equivalent field to fall back
// on. This test locks in that every `.selected` setter always writes
// directly to the instance rule, exactly as it did before this plan, so a
// future well-intentioned attempt to "finish" deduping `.selected` doesn't
// silently reintroduce the visual regression this plan's audit caught.
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
    it("a default ToggleButton's .selected:not(:hover) fields always write to its own instance rule — no class rule is ever created", () => {
        new ToggleButton('Warmup').getElement(true);

        const second = new ToggleButton('Second');
        const declarations = declarationsDuring(sink, idSelector(second) + '.selected:not(:hover)', () => second.getElement(true));

        expect(declarations.boxShadow).toBeDefined();
        expect(declarations.backgroundColor).toBeDefined();
        expect(declarations.backgroundImage).toBeDefined();

        expect(_ruleCacheHas('.ToggleButton.selected:not(:hover)')).toBe(false);
    });
});
