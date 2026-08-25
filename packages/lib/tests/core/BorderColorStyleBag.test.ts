// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the `borderColor` StyleBag key added by
// plans/diagramnode-bordercolor-stylebag-longhand.md — Expected Behaviour
// rows 1-4. Rows 5-8 (the DiagramNode-specific outcomes) live in
// DiagramNode.selectedStateDedup.test.ts; rows 9-11 are cascade outcomes
// that need a browser (see the plan's `## Verification`).
//
// Same conventions as RestingChromeIsolation.test.ts, which this file
// mirrors: every locally-declared `Component` subclass needs a name unique
// across this file, and `declarationsDuring`/`idSelector` are copied from
// it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { StyleBag, StyleStateSpec } from '~/core/ClassStyleRules';

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
 * flattened into one key/value map. Copied from `RestingChromeIsolation.test.ts`.
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

/** Every declaration *key*, in the order the write actually named them —
 *  `declarationsDuring`'s flattened map loses order, so row 2's ordering
 *  assertion reads straight off the recorded write instead. */
function declarationKeyOrderDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): string[] {
    const start = recorder.writes.length;
    fn();

    const keys: string[] = [];
    for (const w of recorder.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || w.args[0] !== selector) {
            continue;
        }

        keys.push(...Object.keys(w.args[1] as Record<string, string | null>));
    }

    return keys;
}

describe('StyleBag borderColor', () => {
    it('row 1: a state extracting only borderColor hoists it onto the class-tier state rule', () => {
        class BorderColorProbeRow1 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.selected', extract: (): StyleBag => ({ borderColor: 'rgb(1, 2, 3)' }) },
            ];
        }

        const declarations = declarationsDuring(sink, '.BorderColorProbeRow1.selected', () => {
            new BorderColorProbeRow1({}).getElement(true);
        });

        expect(declarations.borderColor).toBe('rgb(1, 2, 3)');
    });

    it('row 2: a class-tier border + borderColor emits the four side longhands then borderColor, in that order', () => {
        class BorderColorProbeRow2 extends Component {
            protected static readonly ownClassStyleDefaults: StyleBag = {
                border:      '1px solid red',
                borderColor: 'blue',
            };
        }

        const keys = declarationKeyOrderDuring(sink, '.BorderColorProbeRow2', () => {
            new BorderColorProbeRow2({}).getElement(true);
        });

        expect(keys).toContain('borderTop');
        expect(keys).toContain('borderColor');
        expect(keys.indexOf('borderColor')).toBeGreaterThan(keys.indexOf('borderTop'));
    });

    it('row 3: setBorder() lands on #id:not(.selected), never the bare #id rule, when a declared state carries borderColor', () => {
        class BorderColorProbeRow3 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.selected', extract: (): StyleBag => ({ borderColor: 'rgb(1, 2, 3)' }) },
            ];
        }

        const a = new BorderColorProbeRow3({});
        a.getElement(true);
        const isolated = declarationsDuring(sink, idSelector(a) + ':not(.selected)', () => a.setBorder('2px dashed red'));
        expect(isolated.borderTop).toBe('2px dashed red');

        const b = new BorderColorProbeRow3({});
        b.getElement(true);
        const bare = declarationsDuring(sink, idSelector(b), () => b.setBorder('2px dashed red'));
        expect(bare.borderTop).toBeUndefined();
    });

    it('row 4: an instance setBorder() lands on the bare #id rule when no declared state carries borderColor', () => {
        class BorderColorProbeRow4 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.selected', extract: (): StyleBag => ({ backgroundColor: 'red' }) },
            ];
        }

        const probe = new BorderColorProbeRow4({});
        probe.getElement(true);

        const bare = declarationsDuring(sink, idSelector(probe), () => probe.setBorder('2px dashed red'));
        expect(bare.borderTop).toBe('2px dashed red');
    });
});
