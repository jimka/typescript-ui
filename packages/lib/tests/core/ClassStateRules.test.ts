// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the state-tier (class `.pressed`/`:hover`/`.selected`
// dedup) sibling of the base-tier three-tier split, introduced by
// plans/implemented/hoist-button-tabbar-state-chrome-rules.md — Expected
// Behaviour rows 1-6. Rows 7-13 (Button/ToggleButton/TabButton-specific) live
// in the sibling test files this plan also adds.
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
import { ensureClassStateRule, writeClassStateDeclaration } from '~/core/ClassStyleRules';
import type { StateStyleRule } from '~/core/ClassStyleRules';

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
 * flattened into one key/value map (last write per key wins). Copied from
 * `ClassStyleRules.test.ts` — see that file for the full rationale.
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
function idSelector(component: Component): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/** Recorded `ensureStyleRule` ops for the given selector. */
function ensureStyleRuleOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

describe('Class-scoped state rules', () => {
    it('case 1 & 2: a default-styled instance carries no state declaration of its own, the class rule carries it', () => {
        class ProbeState1 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                const bag = ensureClassStateRule(this.constructor, '.on', { color: 'red' });
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', 'red');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        const firstDeclarations = declarationsDuring(sink, '.ProbeState1.on', () => {
            new ProbeState1({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeState1.on')).toBe(true);
        expect(firstDeclarations.color).toBe('red');

        const second = new ProbeState1({});
        const secondDeclarations = declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true));

        expect(secondDeclarations.color).toBeUndefined();
    });

    it('case 3: a deviating instance still writes its own rule', () => {
        class ProbeState3 extends Component {
            constructor(options: ComponentOptions | undefined, deviate: boolean) {
                super(options);

                const bag = ensureClassStateRule(ProbeState3, '.on', { color: 'red' });
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', deviate ? 'blue' : 'red');
            }
        }

        new ProbeState3({}, false).getElement(true);

        const sink      = DOM.sink as RecordingDOMSink;
        const deviating  = new ProbeState3({}, true);
        const declarations = declarationsDuring(sink, idSelector(deviating) + '.on', () => deviating.getElement(true));

        expect(declarations.color).toBe('blue');
    });

    it('case 4: a key absent from the class bag always writes', () => {
        class ProbeState4 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                const bag = ensureClassStateRule(ProbeState4, '.on', {});
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', 'red');
            }
        }

        new ProbeState4({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b    = new ProbeState4({});
        const declarations = declarationsDuring(sink, idSelector(b) + '.on', () => b.getElement(true));

        expect(declarations.color).toBe('red');
        expect(_ruleCacheHas('.ProbeState4.on')).toBe(false);
    });

    it('case 5: two classes sharing a name — the second opts out', () => {
        const TwinStateA = class TwinState extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                const bag = ensureClassStateRule(this.constructor, '.on', { color: 'red' });
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', 'red');
            }
        };

        const TwinStateB = class TwinState extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                const bag = ensureClassStateRule(this.constructor, '.on', { color: 'red' });
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', 'red');
            }
        };

        const sink  = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;

        new TwinStateA({}).getElement(true);
        expect(sink.writes.slice(start).filter((w) => w.op === 'ensureStyleRule' && w.args[0] === '.TwinState.on').length).toBe(1);

        const secondA = new TwinStateA({});
        const secondADeclarations = declarationsDuring(sink, idSelector(secondA) + '.on', () => secondA.getElement(true));
        expect(secondADeclarations.color).toBeUndefined();

        new TwinStateB({}).getElement(true);
        const secondB = new TwinStateB({});
        const secondBDeclarations = declarationsDuring(sink, idSelector(secondB) + '.on', () => secondB.getElement(true));
        expect(secondBDeclarations.color).toBe('red');

        expect(ensureStyleRuleOpsFor(sink, '.TwinState.on').length).toBe(1);
    });

    it('case 6: disposing an instance leaves the class-tier state rule intact', () => {
        class ProbeState6 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                const bag = ensureClassStateRule(ProbeState6, '.on', { color: 'red' });
                writeClassStateDeclaration(this.createStyleRule('.on'), bag, 'color', 'red');
            }
        }

        const a = new ProbeState6({});
        const b = new ProbeState6({});
        a.getElement(true);
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        (a as unknown as { destructor(): void }).destructor();
        (b as unknown as { destructor(): void }).destructor();

        const deleteOps = sink.writes.filter((w) => w.op === 'deleteStyleRule' && w.args[0] === '.ProbeState6.on');
        expect(deleteOps.length).toBe(0);
        expect(_ruleCacheHas('.ProbeState6.on')).toBe(true);

        const c = new ProbeState6({});
        const declarations = declarationsDuring(sink, idSelector(c) + '.on', () => c.getElement(true));
        expect(declarations.color).toBeUndefined();
    });

    it('case 7: createStateStyleRule wires resolveDefaults into the class bag automatically', () => {
        class ProbeState7 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.createStateStyleRule('.on', () => ({ color: 'red' })).set('color', 'red');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        const firstDeclarations = declarationsDuring(sink, '.ProbeState7.on', () => {
            new ProbeState7({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeState7.on')).toBe(true);
        expect(firstDeclarations.color).toBe('red');

        const second = new ProbeState7({});
        const secondDeclarations = declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true));

        expect(secondDeclarations.color).toBeUndefined();
    });

    it('case 8: a deviating .set() call still writes the instance rule', () => {
        class ProbeState8 extends Component {
            constructor(options: ComponentOptions | undefined, deviate: boolean) {
                super(options);

                this.createStateStyleRule('.on', () => ({ color: 'red' })).set('color', deviate ? 'blue' : 'red');
            }
        }

        new ProbeState8({}, false).getElement(true);

        const sink          = DOM.sink as RecordingDOMSink;
        const deviating     = new ProbeState8({}, true);
        const declarations  = declarationsDuring(sink, idSelector(deviating) + '.on', () => deviating.getElement(true));

        expect(declarations.color).toBe('blue');
    });

    it('case 9: .setMany() writes only the keys that deviate', () => {
        class ProbeState9 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.createStateStyleRule('.on', () => ({ color: 'red' })).setMany({ color: 'red', backgroundColor: 'blue' });
            }
        }

        const sink  = DOM.sink as RecordingDOMSink;
        const probe = new ProbeState9({});
        const declarations = declarationsDuring(sink, idSelector(probe) + '.on', () => probe.getElement(true));

        expect(declarations.backgroundColor).toBe('blue');
        expect(declarations.color).toBeUndefined();
    });

    it('case 10: createStateStyleRule shares the same underlying rule createStyleRule would return, not a second one', () => {
        class ProbeState10 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.createStyleRule('.on');
                this.createStateStyleRule('.on', () => ({})).set('color', 'red');
            }
        }

        const sink  = DOM.sink as RecordingDOMSink;
        const probe = new ProbeState10({});
        probe.getElement(true);

        expect(ensureStyleRuleOpsFor(sink, idSelector(probe) + '.on').length).toBe(1);
    });

    it('case 11: two suffixes on one class produce two independent class rules', () => {
        class ProbeState11 extends Component {
            constructor(options?: ComponentOptions) {
                super(options);

                this.createStateStyleRule('.on',  () => ({ color: 'red'  })).set('color', 'red');
                this.createStateStyleRule('.off', () => ({ color: 'blue' })).set('color', 'blue');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeState11({}).getElement(true);

        expect(_ruleCacheHas('.ProbeState11.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeState11.off')).toBe(true);

        const second = new ProbeState11({});
        const start  = sink.writes.length;
        second.getElement(true);

        const writes   = sink.writes.slice(start);
        const onWrite  = writes.find((w) => w.op === 'setRuleStyles' && w.args[0] === idSelector(second) + '.on');
        const offWrite = writes.find((w) => w.op === 'setRuleStyles' && w.args[0] === idSelector(second) + '.off');

        expect(onWrite).toBeUndefined();
        expect(offWrite).toBeUndefined();
    });

    it('case 12: a .set() call matching the class default leaves the rule unmaterialised; a later deviating call on the same wrapper materialises it immediately', () => {
        class ProbeState12 extends Component {
            readonly rule: StateStyleRule;

            constructor(options?: ComponentOptions) {
                super(options);

                this.rule = this.createStateStyleRule('.on', () => ({ color: 'red' }));
                this.rule.set('color', 'red');
            }
        }

        const sink  = DOM.sink as RecordingDOMSink;
        const probe = new ProbeState12({});

        const firstDeclarations = declarationsDuring(sink, idSelector(probe) + '.on', () => probe.getElement(true));
        expect(firstDeclarations.color).toBeUndefined();

        const laterDeclarations = declarationsDuring(sink, idSelector(probe) + '.on', () => probe.rule.set('color', 'blue'));
        expect(laterDeclarations.color).toBe('blue');
    });
});
