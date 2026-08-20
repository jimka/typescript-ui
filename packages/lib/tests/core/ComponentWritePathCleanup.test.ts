// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the `visibility` write-path fix introduced by
// plans/in-progress/component-borderradius-visibility-write-path-cleanup.md —
// Expected Behaviour rows 3-4. Rows 1-2 (`borderRadius`) and row 5
// (manual-verify) are not covered here — see the plan's `## Implementation
// Notes` for why the `borderRadius` half was not implemented.
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
//    already materialised by an earlier, genuinely-deviating write — row 4
//    below forces materialisation with an unrelated `backgroundColor` for
//    exactly this reason.
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

describe('Component visibility write-path reconciliation', () => {
    it('row 3: setVisible on an already-rendered plain component writes hidden for real, then a removal on restore', () => {
        const b = new Component({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row3a = declarationsDuring(sink, idSelector(b), () => b.setVisible(false));
        expect(row3a.visibility).toBe('hidden');

        const row3b = declarationsDuring(sink, idSelector(b), () => b.setVisible(true));
        expect(row3b.visibility).toBeNull();
    });

    it('row 4: a construction option equal to the class default is queued for real by applyOptions, then corrected to a removal by the first render', () => {
        class VisibleFalseProbeRow4 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { visible: false });
            }
        }

        // backgroundColor has no class default here, so it forces #id to
        // materialise on the very first render — needed to observe what the
        // visibility key resolved to, per this file's header note.
        const b = new VisibleFalseProbeRow4({ visible: false, backgroundColor: 'red' });

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('red'); // sanity: #id did materialise
        expect(declarations.visibility).toBeNull();
    });
});
