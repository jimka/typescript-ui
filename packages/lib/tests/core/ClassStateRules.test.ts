// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for `ensureClassStateRule` / `Component.ensureSharedStateRule`
// — the shared-rule-only path for a state that never writes per-instance
// (`Cell.focused`, `TreeRow.focused`, `Component.setValueStyleState`). The
// original `createStateStyleRule`/`StateStyleRule` per-instance-dedup
// mechanism this file used to also cover was retired by
// plans/implemented/state-tier-full-unification.md in favour of the
// `writeStateStyle`/`resolveStateStyleValue` instance layer — see
// `tests/core/InstanceStateLayer.test.ts` for that mechanism's own coverage.
//
// Same module-state caveat as `ClassStyleRules.test.ts`: the `.ClassName`
// registry in `core/ClassStyleRules.ts` and the `_ruleCache` in
// `core/StyleTarget.ts` survive `DOM.reset()` (though not a fresh test
// *file*), so every test below declares its own uniquely-named local
// `Component` subclass, unique across every other test in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** Recorded `ensureStyleRule` ops for the given selector. */
function ensureStyleRuleOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

/** Recorded `setRuleStyles` ops for the given selector. */
function setRuleStylesOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
}

describe('Class-scoped shared state rules (ensureSharedStateRule)', () => {
    it('case 1: ensureSharedStateRule creates the shared class rule, materialised with the given declarations', () => {
        class ProbeState1 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.ensureSharedStateRule('.on', { color: 'red' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeState1({});

        expect(_ruleCacheHas('.ProbeState1.on')).toBe(true);
        expect(setRuleStylesOpsFor(sink, '.ProbeState1.on').length).toBe(1);
        expect(setRuleStylesOpsFor(sink, '.ProbeState1.on')[0].args[1]).toEqual({ color: 'red' });
    });

    it('case 2: a second instance\'s identical call is a no-op — the shared rule is ensured only once', () => {
        class ProbeState2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.ensureSharedStateRule('.on', { color: 'red' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeState2({});
        const start = sink.writes.length;
        new ProbeState2({});

        expect(sink.writes.slice(start).filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.ProbeState2.on').length).toBe(0);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeState2.on').length).toBe(1);
    });

    it('case 3: two classes sharing a name — the second opts out, no second rule is created', () => {
        const TwinStateA = class TwinState extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.ensureSharedStateRule('.on', { color: 'red' });
            }
        };

        const TwinStateB = class TwinState extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.ensureSharedStateRule('.on', { color: 'blue' });
            }
        };

        const sink = DOM.sink as RecordingDOMSink;

        new TwinStateA({});
        expect(ensureStyleRuleOpsFor(sink, '.TwinState.on').length).toBe(1);
        expect(setRuleStylesOpsFor(sink, '.TwinState.on')[0].args[1]).toEqual({ color: 'red' });

        const start = sink.writes.length;
        new TwinStateB({});

        // The second (colliding) class's `ensureSharedStateRule` call
        // resolves `ensureClassStateRule` to `null` and writes nothing —
        // the shared rule stays owned by the first class, at its value.
        expect(sink.writes.slice(start).filter((w) => w.op === 'setRuleStyles' && w.args[0] === '.TwinState.on').length).toBe(0);
        expect(ensureStyleRuleOpsFor(sink, '.TwinState.on').length).toBe(1);
    });

    it('case 4: disposing an instance leaves the class-tier state rule intact', () => {
        class ProbeState4 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.ensureSharedStateRule('.on', { color: 'red' });
            }
        }

        const a = new ProbeState4({});
        const b = new ProbeState4({});
        a.getElement(true);
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        (a as unknown as { destructor(): void }).destructor();
        (b as unknown as { destructor(): void }).destructor();

        const deleteOps = sink.writes.filter((w) => w.op === 'deleteStyleRule' && w.args[0] === '.ProbeState4.on');
        expect(deleteOps.length).toBe(0);
        expect(_ruleCacheHas('.ProbeState4.on')).toBe(true);
    });
});
