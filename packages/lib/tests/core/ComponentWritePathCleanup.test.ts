// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the `borderRadius` and `visibility` write-path fixes
// introduced by
// plans/in-progress/component-borderradius-visibility-write-path-cleanup.md —
// Expected Behaviour rows 1-6. Row 7 (manual-verify) is not covered here —
// see the plan's `## Verification` section.
//
// Same conventions as `ClassChromeRules.test.ts` / `ClassReconciledRules.test.ts`,
// which this file mirrors:
//  - Every locally-declared `Component` subclass needs a name unique across
//    the whole file — the `.ClassName` registry in `core/ClassStyleRules.ts`
//    is module state that survives `DOM.reset()` (though not a fresh test
//    *file*, since Vitest isolates modules per file by default).
//  - `declarationsDuring`/`idSelector` are copied from `ClassChromeRules.test.ts`.
//  - `Component.materialiseWhenNeeded` only inserts a component's `#id` rule
//    once something *real* (non-null) is queued for it, or the rule already
//    exists. A reconciled write that resolves to a `null` removal is
//    therefore only observable through the recording sink when `#id` was
//    already materialised by an earlier, genuinely-deviating write — rows 3
//    and 6 below force materialisation with an unrelated `backgroundColor`
//    for exactly this reason.
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

describe('Component borderRadius write-path reconciliation', () => {
    it('row 1: setBorderRadius to a real value writes it to #id; restoring the class default afterwards writes a removal, not silence', () => {
        class BorderRadiusProbeRow1 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { borderRadius: '4px' });
            }
        }

        const b = new BorderRadiusProbeRow1({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row1a = declarationsDuring(sink, idSelector(b), () => b.setBorderRadius('8px'));
        expect(row1a.borderRadius).toBe('8px');

        const row1b = declarationsDuring(sink, idSelector(b), () => b.setBorderRadius('4px'));
        expect(row1b.borderRadius).toBeNull();
    });

    it('row 2: setBorderRadius on a class with no borderRadius default writes the real value, unchanged from today', () => {
        class NoDefaultBorderRadiusProbeRow2 extends Component {}

        const b = new NoDefaultBorderRadiusProbeRow2({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBorderRadius('6px'));
        expect(declarations.borderRadius).toBe('6px');
    });

    it('row 3: a construction option equal to the class default is queued for real by applyOptions, then corrected to a removal by the first render', () => {
        class BorderRadiusProbeRow3 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { borderRadius: '4px' });
            }
        }

        // backgroundColor has no class default here, so it forces #id to
        // materialise on the very first render — needed to observe what the
        // borderRadius key resolved to, per this file's header note.
        const b = new BorderRadiusProbeRow3({ borderRadius: '4px', backgroundColor: 'red' });

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('red'); // sanity: #id did materialise
        expect(declarations.borderRadius).toBeNull();
    });

    it('row 4: clearBorderRadius after render writes a plain removal to #id', () => {
        // No class default here, so the initial real value self-materialises
        // #id on render — nothing extra needed to force it.
        const b = new Component({ borderRadius: '4px' });
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBorderRadius());
        expect(declarations.borderRadius).toBeNull();
    });
});

describe('Component visibility write-path reconciliation', () => {
    it('row 5: setVisible on an already-rendered plain component writes hidden for real, then a removal on restore', () => {
        const b = new Component({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row5a = declarationsDuring(sink, idSelector(b), () => b.setVisible(false));
        expect(row5a.visibility).toBe('hidden');

        const row5b = declarationsDuring(sink, idSelector(b), () => b.setVisible(true));
        expect(row5b.visibility).toBeNull();
    });

    it('row 6: a construction option equal to the class default is queued for real by applyOptions, then corrected to a removal by the first render', () => {
        class VisibleFalseProbeRow6 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { visible: false });
            }
        }

        // backgroundColor has no class default here, so it forces #id to
        // materialise on the very first render — needed to observe what the
        // visibility key resolved to, per this file's header note.
        const b = new VisibleFalseProbeRow6({ visible: false, backgroundColor: 'red' });

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('red'); // sanity: #id did materialise
        expect(declarations.visibility).toBeNull();
    });
});
