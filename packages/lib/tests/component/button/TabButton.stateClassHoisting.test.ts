// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// TabButton-specific coverage for the state-tier dedup introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md. Rows 1-6 (the
// generic mechanism) live in tests/core/ClassStateRules.test.ts;
// Button-specific coverage lives in Button.pressedHoverClassHoisting.test.ts;
// ToggleButton-specific coverage lives in
// ToggleButton.selectedClassHoisting.test.ts. Naming mirrors the existing
// TabButton.styleRuleDisposal.test.ts convention.
//
// SCOPE NOTE (see plans/implemented/button-resting-chrome-state-isolation.md
// and, for the `.selected` half, plans/implemented/state-chrome-isolation-generalization.md):
// TabButton still doesn't override `getHoverClassDeclarations()` — hover
// stays un-deduped, every field always writing to the instance, and no
// `.TabButton:hover:not(.pressed)` class rule is ever created. `.selected`
// is different now: TabButton overrides `getSelectedClassDeclarations()`
// with its own tab-specific tokens, so `backgroundColor` / `backgroundImage`
// / `boxShadow` / the four border longhands (mirroring the border the
// constructor's `applyTabStyling` separately writes via `setSelectedBorder`)
// all dedupe onto the shared `.TabButton.selected:not(.pressed):not(:hover)` class rule the
// same way `.pressed` already does.
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
    // Since plans/implemented/button-family-hierarchy-cascade.md, TabButton
    // contributes nothing of its own to the pressed tier (it never overrides
    // `getPressedClassDeclarations()`), so the state-tier hierarchy walk
    // resolves its `.pressed` state to `.Button.pressed` — no separate
    // `.TabButton.pressed` rule is created at all.
    it('shares .Button.pressed instead of creating its own — TabButton contributes nothing new to the pressed tier', () => {
        new TabButton('Warmup').getElement(true);

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
        expect(_ruleCacheHas('.TabButton.pressed')).toBe(false);

        const classDeclarations = declarationsDuring(sink, '.Button.pressed', () => {
            new TabButton('Second').getElement(true);
        });
        // Cached from the warm-up instance — no further write for a second instance.
        expect(classDeclarations).toEqual({});
    });

    it('never dedupes .hover — every field always writes to the instance, and no class rule is created', () => {
        const tab = new TabButton('First');
        const hoverDeclarations = declarationsDuring(sink, idSelector(tab) + ':hover:not(.pressed)', () => tab.getElement(true));

        expect(hoverDeclarations.backgroundColor).toBeDefined();
        expect(hoverDeclarations.backgroundImage).toBeDefined();
        expect(hoverDeclarations.boxShadow).toBeDefined();
        expect(hoverDeclarations.borderTop).toBeDefined();
        expect(hoverDeclarations.borderRight).toBeDefined();
        expect(hoverDeclarations.borderBottom).toBeDefined();
        expect(hoverDeclarations.borderLeft).toBeDefined();

        expect(_ruleCacheHas('.TabButton:hover:not(.pressed)')).toBe(false);
    });

    it('row 9: a second, default-styled TabButton dedupes .selected backgroundColor/backgroundImage/boxShadow AND its border longhands onto the class rule', () => {
        new TabButton('Warmup').getElement(true);

        const second = new TabButton('Second');
        const selectedDeclarations = declarationsDuring(sink, idSelector(second) + '.selected:not(.pressed):not(:hover)', () => second.getElement(true));

        expect(selectedDeclarations.backgroundColor).toBeUndefined();
        expect(selectedDeclarations.backgroundImage).toBeUndefined();
        expect(selectedDeclarations.boxShadow).toBeUndefined();
        expect(selectedDeclarations.borderTop).toBeUndefined();
        expect(selectedDeclarations.borderRight).toBeUndefined();
        expect(selectedDeclarations.borderBottom).toBeUndefined();
        expect(selectedDeclarations.borderLeft).toBeUndefined();

        expect(_ruleCacheHas('.TabButton.selected:not(.pressed):not(:hover)')).toBe(true);
    });

    it('row 10: a rendered element carries ts-ui-component, Button, ToggleButton, and TabButton', () => {
        const start  = sink.writes.length;
        const tab    = new TabButton('Widened');
        const handle = tab.getElement(true);

        // TabButton builds child components of its own (a Text label, an
        // HBox row, ...), each also widening onto its own ts-ui-component
        // class — scope to this instance's own handle so a child's addClass
        // op isn't mistaken for the TabButton's own.
        const addClassOps = sink.writes.slice(start).filter((w) => {
            if (w.op !== 'apply' || w.args[0] !== handle) {
                return false;
            }
            const patch = w.args[1] as { addClass?: string[] };
            return Array.isArray(patch.addClass) && patch.addClass.includes('ts-ui-component');
        });

        expect(addClassOps.length).toBe(1);
        expect((addClassOps[0].args[1] as { addClass: string[] }).addClass).toEqual([
            'ts-ui-component', 'Button', 'ToggleButton', 'TabButton',
        ]);
    });
});
