// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the StyleAudit residue sweep in
// plans/split-accordion-panel-scroll-convergence.md: SplitGutter's `.opaque`
// collapse-strip chrome (backgroundColor/backgroundImage/border) moves from
// three per-instance setter calls in `setOpaque` onto a declared
// `ownStyleStates` entry, so a second gutter set opaque dedupes onto the
// shared `.SplitGutter.opaque` class rule instead of repeating the three
// declarations on its own `#id.opaque` rule — the same shape and helpers as
// WindowBorder's `.snap-target` precedent
// (`tests/component/container/AccordionHeader.classStyleHoisting.test.ts`'s
// idiom, recreated locally per that file's own module-cache-per-file caveat).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { SplitGutter } from '~/component/container/SplitGutter';

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

describe('SplitGutter .opaque class-tier chrome dedup', () => {
    it('the priming instance materialises the shared .opaque class rule; a second opaque gutter writes to none of its own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        let first!: SplitGutter;
        const primedWrites = writesDuring(sink, () => {
            first = new SplitGutter('horizontal');
            first.getElement(true);
            first.setOpaque(true);
        });

        const opaqueDeclarations = declarationsFor(primedWrites, '.SplitGutter.opaque');
        expect(opaqueDeclarations.backgroundColor).toBe('var(--ts-ui-button-bg, #e8e8e8)');
        expect(opaqueDeclarations.backgroundImage).toBe('var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))');
        expect(opaqueDeclarations.borderTop).toBe('1px solid var(--ts-ui-button-border, #c8c8c8)');

        let second!: SplitGutter;
        const secondWrites = writesDuring(sink, () => {
            second = new SplitGutter('horizontal');
            second.getElement(true);
            second.setOpaque(true);
        });

        // The resting write is isolated onto `#id:not(.opaque)` (see
        // `restingGuardSuffix`/`isRestingChromeIsolated` in Component.ts) since
        // `_expandedBackground`'s per-instance backgroundColor write shares a
        // key with `.opaque`'s own bag.
        const idOpaqueDeclarations = declarationsFor(secondWrites, idSelector(second) + '.opaque');
        expect(idOpaqueDeclarations.backgroundColor).toBeUndefined();
        expect(idOpaqueDeclarations.backgroundImage).toBeUndefined();
        expect(idOpaqueDeclarations.borderTop).toBeUndefined();
    });

    it('caches the border spec for getBorderSize(), even though the border is painted only by the shared .opaque class rule', () => {
        // Regression test: `setOpaque` used to call `setBorder`/`clearBorder`,
        // which both wrote the per-instance CSS and cached `_border` for
        // `getBorderSize()`'s layout math. Hoisting the border onto the
        // shared `.opaque` `ownStyleStates` rule dropped both calls entirely,
        // leaving `getBorderSize()` reporting a zero-width border in the
        // opaque state while the CSS still paints a real 1px one.
        const gutter = new SplitGutter('horizontal');
        gutter.getElement(true);

        gutter.setOpaque(true);
        expect(gutter.getBorderSize()).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });

        gutter.setOpaque(false);
        expect(gutter.getBorderSize()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    });
});
