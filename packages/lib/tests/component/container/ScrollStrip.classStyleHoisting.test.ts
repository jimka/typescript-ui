// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the StyleAudit residue sweep in
// plans/split-accordion-panel-scroll-convergence.md: ScrollStrip's lead/trail
// arrow buttons move their shared chrome (backgroundImage/border/shadow/
// borderRadius) off a per-instance loop in `ensureArrows` onto a dedicated
// `ScrollStripArrowButton extends Button` subclass's `ownClassStyleDefaults`,
// following `Scrollbar.ts`'s `ScrollArrowButton` shape — so a second strip's
// arrow buttons dedupe onto the shared `.ScrollStripArrowButton` class rule
// instead of repeating the four declarations on their own `#id` rules.
// `clearInsets()`/`setZIndex(3)` and the per-instance `_arrowBackground`
// write stay per-instance, unaffected by this migration. Same shape and
// helpers as `AccordionHeader.classStyleHoisting.test.ts`, recreated locally
// per that file's own module-cache-per-file caveat.
//
// `ensureArrows` is private, invoked only from `layoutArrows` when the strip
// actually overflows during a real layout pass — reached here via the
// white-box seam every other private-method test in this codebase uses
// (see e.g. `Dialog.test.ts`'s `TestDialog`), since driving a full offline
// overflow layout is not the point of this coverage.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { ScrollStrip } from '~/component/container/ScrollStrip';
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

/** Builds the lazy arrow buttons via the private `ensureArrows` seam. */
function buildArrows(strip: ScrollStrip): void {
    (strip as unknown as { ensureArrows(): void }).ensureArrows();
}

/** The strip's own lead arrow, via its private field. */
function leadArrow(strip: ScrollStrip): Button {
    return (strip as unknown as { _leadArrow: Button })._leadArrow;
}

describe('ScrollStrip arrow-button class-tier chrome dedup', () => {
    it('the priming instance materialises the shared .ScrollStripArrowButton class rule; a second strip\'s arrows write to none of their own #id rules', () => {
        const sink = DOM.sink as RecordingDOMSink;

        let first!: ScrollStrip;
        const primedWrites = writesDuring(sink, () => {
            first = new ScrollStrip();
            first.getElement(true);
            buildArrows(first);
        });

        const restingDeclarations = declarationsFor(primedWrites, '.ScrollStripArrowButton');
        expect(restingDeclarations.backgroundImage).toBe('none');
        expect(restingDeclarations.borderTop).toBe('none');
        expect(restingDeclarations.boxShadow).toBe('none');
        expect(restingDeclarations.borderRadius).toBe('0');

        let second!: ScrollStrip;
        const secondWrites = writesDuring(sink, () => {
            second = new ScrollStrip();
            second.getElement(true);
            buildArrows(second);
        });

        const idDeclarations = declarationsFor(secondWrites, idSelector(leadArrow(second)));
        expect(idDeclarations.backgroundImage).toBeUndefined();
        expect(idDeclarations.borderTop).toBeUndefined();
        expect(idDeclarations.boxShadow).toBeUndefined();
        expect(idDeclarations.borderRadius).toBeUndefined();
    });
});
