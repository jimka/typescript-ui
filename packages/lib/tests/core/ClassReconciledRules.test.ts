// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the reconciled write-path widening introduced by
// plans/implemented/reconciled-write-path-widening.md — Expected Behaviour
// rows 1-6 (rows 7-8 are manual-verify, browser-only; see the plan's
// `## Verification` section).
//
// Same conventions as `ClassChromeRules.test.ts`, which this file mirrors:
//  - Every locally-declared `Component` subclass needs a name unique across
//    the whole file — the `.ClassName` registry in `core/ClassStyleRules.ts`
//    is module state that survives `DOM.reset()` (though not a fresh test
//    *file*, since Vitest isolates modules per file by default), so a name
//    collision silently takes the name-collision opt-out (no class rule at
//    all — see `ClassStyleRules.test.ts` case 15).
//  - `declarationsDuring`/`idSelector` are copied from `ClassChromeRules.test.ts`.
//  - `Component.materialiseWhenNeeded` only inserts a component's `#id` rule
//    once something *real* (non-null) is queued for it, or the rule already
//    exists. A reconciled write that resolves to a `null` removal is
//    therefore only observable through the recording sink when `#id` was
//    already materialised by an earlier, genuinely-deviating write — several
//    cases below force materialisation for exactly this reason.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Copied from `ClassChromeRules.test.ts`.
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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('Component reconciled write-path widening', () => {
    it('row 1: setForegroundColor to a real value writes it to #id; restoring the class default afterwards writes a removal, not silence', () => {
        class ForegroundColorProbeRow1 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { foregroundColor: 'rgb(10, 20, 30)' });
            }
        }

        const b = new ForegroundColorProbeRow1({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row1a = declarationsDuring(sink, idSelector(b), () => b.setForegroundColor('red'));
        expect(row1a.color).toBe('red');

        const row1b = declarationsDuring(sink, idSelector(b), () => b.setForegroundColor('rgb(10, 20, 30)'));
        expect(row1b.color).toBeNull();
    });

    it('row 2: setOutline to a real value writes it to #id; restoring the class default afterwards writes a removal', () => {
        class OutlineProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { outline: '1px solid black' });
            }
        }

        const b = new OutlineProbeRow2({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row2a = declarationsDuring(sink, idSelector(b), () => b.setOutline('2px dashed red'));
        expect(row2a.outline).toBe('2px dashed red');

        const row2b = declarationsDuring(sink, idSelector(b), () => b.setOutline('1px solid black'));
        expect(row2b.outline).toBeNull();
    });

    it('row 2: setUserSelect to a real value writes it to #id; restoring the class default afterwards writes a removal', () => {
        class UserSelectProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { userSelect: 'text' });
            }
        }

        const b = new UserSelectProbeRow2({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row2a = declarationsDuring(sink, idSelector(b), () => b.setUserSelect('none'));
        expect(row2a.userSelect).toBe('none');

        const row2b = declarationsDuring(sink, idSelector(b), () => b.setUserSelect('text'));
        expect(row2b.userSelect).toBeNull();
    });

    it('row 2: setOverflowX to a real value writes it to #id; restoring the class default afterwards writes a removal', () => {
        class OverflowXProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'auto' });
            }
        }

        const b = new OverflowXProbeRow2({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row2a = declarationsDuring(sink, idSelector(b), () => b.setOverflowX('scroll'));
        expect(row2a.overflowX).toBe('scroll');

        const row2b = declarationsDuring(sink, idSelector(b), () => b.setOverflowX('auto'));
        expect(row2b.overflowX).toBeNull();
    });

    it('row 2: setOverflowY to a real value writes it to #id; restoring the class default afterwards writes a removal', () => {
        class OverflowYProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'auto' });
            }
        }

        const b = new OverflowYProbeRow2({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row2a = declarationsDuring(sink, idSelector(b), () => b.setOverflowY('scroll'));
        expect(row2a.overflowY).toBe('scroll');

        const row2b = declarationsDuring(sink, idSelector(b), () => b.setOverflowY('auto'));
        expect(row2b.overflowY).toBeNull();
    });

    it('row 3: setMinSize resolves each key of the batch independently — matching removed, deviating written for real', () => {
        class MinSizeProbeRow3 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 0, height: 10 } });
            }
        }

        const b = new MinSizeProbeRow3({ minSize: { width: 5, height: 5 } });
        b.getElement(true); // materialises #id with a real, deviating minSize

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setMinSize({ width: 0, height: 20 }));
        expect(declarations.minWidth).toBeNull();
        expect(declarations.minHeight).toBe('20px');
    });

    it('row 4: setMaxSize to UNBOUNDED on a class with no maxSize default resolves both keys to the framework "none" baseline and removes them', () => {
        class MaxSizeProbeRow4 extends Component {}

        const b = new MaxSizeProbeRow4({ maxSize: { width: 100, height: 100 } });
        b.getElement(true); // materialises #id with a real, deviating maxSize

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setMaxSize({ width: Number.MAX_VALUE, height: Number.MAX_VALUE }));
        expect(declarations.maxWidth).toBeNull();
        expect(declarations.maxHeight).toBeNull();
    });

    it('row 5: a construction option equal to the class default is queued for real by applyOptions, then corrected to a removal by the first render', () => {
        class MinSizeProbeRow5 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 0, height: 10 } });
            }
        }

        // backgroundColor has no class default here, so it forces #id to
        // materialise on the very first render — needed to observe what the
        // minSize keys resolved to, per this file's header note.
        const b = new MinSizeProbeRow5({ minSize: { width: 0, height: 10 }, backgroundColor: 'red' });

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('red'); // sanity: #id did materialise
        expect(declarations.minWidth).toBeNull();
        expect(declarations.minHeight).toBeNull();
    });

    it('row 6: a setter call whose value does not match the class or framework tier writes the real value, unchanged from today', () => {
        class NoDefaultProbeRow6 extends Component {}

        const b = new NoDefaultProbeRow6({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setForegroundColor('lime'));
        expect(declarations.color).toBe('lime');
    });
});
