// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for Image's declared `.loading` / `.broken`
// ownStyleStates entries (plans/implemented/image-loading-error-states.md):
// each state's chrome must resolve onto a shared `.Image.<state>` class-tier
// rule instead of a per-instance `#id` rule, `.broken` (declared second) must
// carry the `:not(.loading)` guard against the higher-priority `.loading`
// entry, and an instance-level property sharing a key with either state's
// bag must isolate onto the guarded `#id` rule. Same shape and helpers as
// SplitGutter's own `.opaque` coverage
// (`tests/component/container/SplitGutter.classStyleHoisting.test.ts`),
// recreated locally per that file's own module-cache-per-file caveat.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Image } from '~/component/display/Image';

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

describe('Image .loading/.broken class-tier chrome dedup', () => {
    it('the priming instance materialises both shared class rules; a second instance writes no duplicate declarations to its own #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;

        let first!: Image;
        const primedWrites = writesDuring(sink, () => {
            first = new Image('/x.png');
            first.getElement(true);
        });

        const loadingDeclarations = declarationsFor(primedWrites, '.Image.loading');
        expect(loadingDeclarations.backgroundColor).toBe('var(--ts-ui-image-loading-bg, rgba(0, 0, 0, 0.06))');

        // `.broken` is declared second in Image.ownStyleStates, so its
        // generated rule carries a `:not(.loading)` guard against the
        // higher-priority `.loading` entry (guardedSuffixFor, ClassStyleRules.ts).
        // Both declared states' rules materialise together as soon as the
        // class first renders, regardless of which one is active on this
        // particular instance — `first` never errors, yet `.broken`'s rule
        // is written here too.
        const brokenDeclarations = declarationsFor(primedWrites, '.Image.broken:not(.loading)');
        expect(brokenDeclarations.backgroundColor).toBe('var(--ts-ui-image-broken-bg, rgba(220, 60, 60, 0.08))');

        let second!: Image;
        const secondWrites = writesDuring(sink, () => {
            second = new Image('/y.png');
            second.getElement(true);
        });

        const idLoadingDeclarations = declarationsFor(secondWrites, idSelector(second) + '.loading');
        expect(idLoadingDeclarations.backgroundColor).toBeUndefined();
    });

    it('isolates an instance-level backgroundColor onto the guarded #id rule', () => {
        const sink = DOM.sink as RecordingDOMSink;

        const img = new Image('/x.png');
        img.getElement(true);

        const writes = writesDuring(sink, () => {
            img.setBackgroundColor('rgb(1, 2, 3)');
        });

        const idDeclarations = declarationsFor(writes, idSelector(img) + ':not(.loading):not(.broken)');
        expect(idDeclarations.backgroundColor).toBe('rgb(1, 2, 3)');
    });
});
