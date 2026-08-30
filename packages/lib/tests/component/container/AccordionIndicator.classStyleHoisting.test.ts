// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the StyleAudit residue sweep in
// plans/split-accordion-panel-scroll-convergence.md: AccordionIndicator's
// resting `foregroundColor`/`font.fontSize`/`font.textAlign` move off the
// hand-rolled module `StyleRule` (which now carries only `pointerEvents`/
// `transition`, the two declarations `StyleBag` has no field for) onto a
// declared `ownClassStyleDefaults`, so they materialise via the shared
// `.AccordionIndicator` class-tier machinery instead. The existing
// `.expanded` `ownStyleStates` coverage (`AccordionIndicator.test.ts`) is
// unaffected and unchanged. Same shape and helpers as
// `AccordionHeader.classStyleHoisting.test.ts`, recreated locally per that
// file's own module-cache-per-file caveat.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { AccordionIndicator } from '~/component/container/AccordionIndicator';

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

describe('AccordionIndicator resting class-tier chrome dedup', () => {
    it('the priming instance materialises the shared resting rule; a second instance writes no color/fontSize/textAlign to its own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;

        let first!: AccordionIndicator;
        const primedWrites = writesDuring(sink, () => {
            first = new AccordionIndicator();
            first.getElement(true);
        });

        const restingDeclarations = declarationsFor(primedWrites, '.AccordionIndicator');
        expect(restingDeclarations.color).toBe('var(--ts-ui-accordion-indicator-color, rgb(100,100,100))');
        expect(restingDeclarations.fontSize).toBe('10px');
        expect(restingDeclarations.textAlign).toBe('center');
        // The hand-rolled module rule's own two declarations, unaffected by
        // this migration.
        expect(restingDeclarations.pointerEvents).toBe('none');
        expect(restingDeclarations.transition).toBe('transform 200ms ease');

        let second!: AccordionIndicator;
        const secondWrites = writesDuring(sink, () => {
            second = new AccordionIndicator();
            second.getElement(true);
        });

        const idDeclarations = declarationsFor(secondWrites, idSelector(second));
        expect(idDeclarations.color).toBeUndefined();
        expect(idDeclarations.fontSize).toBeUndefined();
        expect(idDeclarations.textAlign).toBeUndefined();
    });
});
