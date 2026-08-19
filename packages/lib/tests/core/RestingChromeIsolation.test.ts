// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/state-chrome-isolation-generalization.md —
// Expected Behaviour rows 1-7: the generic `Component`-level mechanism
// (`getRestingExclusionSuffixes()` / `isChromeIsolationEnabled()` /
// `isRestingChromeIsolated()`), proven against a plain `Component` subclass
// rather than `Button`, so the mechanism is shown to work independent of any
// Button-specific plumbing. Rows 8-9 (the `ToggleButton`/`TabButton`
// migration outcomes) live in their own test files
// (`ToggleButton.selectedClassHoisting.test.ts` /
// `TabButton.stateClassHoisting.test.ts`); rows 10-12 are cascade outcomes
// the recording sink can't evaluate — see the plan's `## Verification`
// section for the mandatory browser check.
//
// Same conventions as `ClassChromeRules.test.ts`, which this file mirrors:
//  - Every locally-declared `Component` subclass needs a name unique across
//    the whole file — the `.ClassName` registry in `core/ClassStyleRules.ts`
//    is module state that survives `DOM.reset()`, so a name collision
//    silently takes the name-collision opt-out (no class rule at all).
//  - `declarationsDuring`/`idSelector` are copied from `ClassChromeRules.test.ts`.
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

let sink: RecordingDOMSink;

beforeEach(() => { sink = installTestDOM(DOM_CONFIG); });
afterEach(() => DOM.reset());

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
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

describe('Component resting-chrome isolation (generalized mechanism)', () => {
    it('row 1: a subclass that never overrides getRestingExclusionSuffixes() writes straight to the bare #id rule', () => {
        class RestingProbeRow1 extends Component {}

        const a = new RestingProbeRow1({ backgroundColor: 'red' });
        const declarations = declarationsDuring(sink, idSelector(a), () => a.getElement(true));

        expect(declarations.backgroundColor).toBe('red');
    });

    it('row 2: a probe isolating .on writes a deviating backgroundColor to #id:not(.on), never the bare #id rule', () => {
        class RestingProbeRow2 extends Component {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on'];
            }
        }

        const a = new RestingProbeRow2({});
        a.getElement(true);
        const isolated = declarationsDuring(sink, idSelector(a) + ':not(.on)', () => a.setBackgroundColor('red'));
        expect(isolated.backgroundColor).toBe('red');

        const b = new RestingProbeRow2({});
        b.getElement(true);
        const bare = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('red'));
        expect(bare.backgroundColor).toBeUndefined();
    });

    it('row 3: the same shape of probe — a write matching the class-tier default becomes a removal on #id:not(.on), not a skipped write', () => {
        class RestingProbeRow3 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundColor: 'blue' });
            }
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on'];
            }
        }

        const probe = new RestingProbeRow3({});
        probe.getElement(true);
        probe.setBackgroundColor('red'); // establish a real deviation to isolate first

        const declarations = declarationsDuring(sink, idSelector(probe) + ':not(.on)', () => probe.setBackgroundColor('blue'));
        expect(declarations.backgroundColor).toBeNull();
    });

    it('row 4: a probe isolating .on and .off computes selector #id:not(.on):not(.off), regardless of either class-tier default', () => {
        class RestingProbeRow4 extends Component {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on', '.off'];
            }
        }

        const probe = new RestingProbeRow4({});
        probe.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(probe) + ':not(.on):not(.off)', () => probe.setBackgroundColor('red'));
        expect(declarations.backgroundColor).toBe('red');
    });

    it('row 5: a border write (a key outside RESTING_ISOLATION_KEYS) always lands on the bare #id rule, isolation registered or not', () => {
        class RestingProbeRow5 extends Component {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on'];
            }
        }

        const probe = new RestingProbeRow5({});
        probe.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(probe), () => probe.setBorder('1px solid red'));
        expect(declarations.borderTop).toBe('1px solid red');
    });

    it('row 6: setChromeIsolationEnabled(false) suppresses isolation for this instance even though the suffix list is non-empty', () => {
        class RestingProbeRow6 extends Component {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on'];
            }
            disableChromeIsolation(): void {
                this.setChromeIsolationEnabled(false);
            }
        }

        const probe = new RestingProbeRow6({});
        probe.getElement(true);
        probe.disableChromeIsolation();

        const declarations = declarationsDuring(sink, idSelector(probe), () => probe.setBackgroundColor('red'));
        expect(declarations.backgroundColor).toBe('red');
    });

    it('row 7: a probe subclass chains onto its parent\'s exclusion list — selector becomes #id:not(.on):not(.extra)', () => {
        class RestingProbeRow7Base extends Component {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return ['.on'];
            }
        }
        class RestingProbeRow7 extends RestingProbeRow7Base {
            protected override getRestingExclusionSuffixes(): readonly string[] {
                return [...super.getRestingExclusionSuffixes(), '.extra'];
            }
        }

        const probe = new RestingProbeRow7({});
        probe.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(probe) + ':not(.on):not(.extra)', () => probe.setBackgroundColor('red'));
        expect(declarations.backgroundColor).toBe('red');
    });
});
