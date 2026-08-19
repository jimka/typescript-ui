// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// TabButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic mechanism) live in tests/core/ClassStateRules.test.ts;
// Button-specific coverage lives in Button.pressedHoverClassHoisting.test.ts;
// ToggleButton-specific coverage lives in
// ToggleButton.selectedClassHoisting.test.ts. Naming mirrors the existing
// TabButton.styleRuleDisposal.test.ts convention.
//
// IMPORTANT SCOPE NOTE (see plans/implemented/button-resting-chrome-state-isolation.md):
// TabButton no longer overrides `getHoverClassDeclarations()` /
// `getSelectedClassDeclarations()` at all — both overrides were removed.
// TabButton's own resting chrome (`_defaultTabButtonOptions`) writes
// `backgroundColor`, `backgroundImage`, and all four `border-*` longhands;
// the border longhands are not isolated and stay on the instance's base
// `#id` rule, but a deviating `backgroundColor` / `backgroundImage` now
// routes onto the instance's own `#id:not(.pressed)` rule at specificity
// (1,1,0). Hover and selected still can't be deduped onto a class-tier
// rule: a class-only state selector (`.TabButton:hover:not(.pressed)`,
// `.TabButton.selected:not(:hover)`) sits at (0,3,0), which loses to a
// deviating instance's isolated resting rule at (1,1,0) regardless of class
// count. TabButton therefore inherits Button's (empty) hover resolver and
// ToggleButton's (always-`null`) selected bag unchanged — its `.pressed`
// class rule now carries all four widened pressed-chrome keys, exactly like
// a plain Button, and no `.TabButton:hover:not(.pressed)` /
// `.TabButton.selected:not(:hover)` class rule is ever created.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TabButton } from '~/component/button/TabButton';
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

describe('TabButton state-class hoisting', () => {
    it('gets its own independent .pressed class rule (all four widened pressed-chrome keys), distinct from .Button.pressed', () => {
        new TabButton('Warmup').getElement(true);

        expect(_ruleCacheHas('.TabButton.pressed')).toBe(true);

        const classDeclarations = declarationsDuring(sink, '.TabButton.pressed', () => {
            new TabButton('Second').getElement(true);
        });
        // Cached from the warm-up instance — no further write for a second instance.
        expect(classDeclarations).toEqual({});
    });

    it('never dedupes .hover or .selected — every field always writes to the instance, and no class rule is created for either', () => {
        const tab = new TabButton('First');
        const hoverDeclarations = declarationsDuring(sink, idSelector(tab) + ':hover:not(.pressed)', () => tab.getElement(true));

        expect(hoverDeclarations.backgroundColor).toBeDefined();
        expect(hoverDeclarations.backgroundImage).toBeDefined();
        expect(hoverDeclarations.boxShadow).toBeDefined();
        expect(hoverDeclarations.borderTop).toBeDefined();
        expect(hoverDeclarations.borderRight).toBeDefined();
        expect(hoverDeclarations.borderBottom).toBeDefined();
        expect(hoverDeclarations.borderLeft).toBeDefined();

        const second = new TabButton('Second');
        const selectedDeclarations = declarationsDuring(sink, idSelector(second) + '.selected:not(:hover)', () => second.getElement(true));

        expect(selectedDeclarations.backgroundColor).toBeDefined();
        expect(selectedDeclarations.backgroundImage).toBeDefined();
        expect(selectedDeclarations.boxShadow).toBeDefined();
        expect(selectedDeclarations.borderTop).toBeDefined();
        expect(selectedDeclarations.borderRight).toBeDefined();
        expect(selectedDeclarations.borderBottom).toBeDefined();
        expect(selectedDeclarations.borderLeft).toBeDefined();

        expect(_ruleCacheHas('.TabButton:hover:not(.pressed)')).toBe(false);
        expect(_ruleCacheHas('.TabButton.selected:not(:hover)')).toBe(false);
    });
});
