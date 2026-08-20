// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// WindowBorder-specific coverage for the state-tier dedup introduced by
// plans/implemented/state-tier-rule-dedup-followups.md: `WindowBorder`'s
// `.snap-target` box-shadow now writes through `createStateStyleRule`
// instead of the older, non-deduping `createStyleRule`. Conventions
// (idSelector/declarationsDuring) copied from
// Button.pressedHoverClassHoisting.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { WindowBorder, Direction } from '~/component/container/WindowBorder';
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

describe('WindowBorder snap-target state-class hoisting', () => {
    afterEach(() => DOM.reset());

    it('row 1: a second WindowBorder writes no boxShadow to its own #id.snap-target rule once the class rule is warmed', () => {
        const sink = installTestDOM(CONFIG);

        new WindowBorder(Direction.NORTH).getElement(true);

        const second = new WindowBorder(Direction.NORTH);
        const declarations = declarationsDuring(sink, idSelector(second) + '.snap-target', () => second.getElement(true));

        expect(declarations.boxShadow).toBeUndefined();
        expect(_ruleCacheHas('.WindowBorder.snap-target')).toBe(true);
    });
});
