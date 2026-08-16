// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the three-tier (framework / class / instance)
// style-rule split introduced by
// plans/implemented/class-scoped-style-rules.md — Expected Behaviour rows
// 1-17 (rows 18-19 are manual-verify, browser-only).
//
// Three constraints these tests follow, per the plan's `## Expected
// Behaviour` header:
//  - The `.ClassName` registry in `core/ClassStyleRules.ts` and the
//    `_ruleCache` in `core/StyleTarget.ts` are module state that survives
//    `DOM.reset()` (though not a fresh test *file*, since Vitest isolates
//    modules per file by default) — so every test declares its own
//    uniquely-*named* local `Component` subclass, unique across every other
//    test in this file, or its class-name-keyed registry entry collides with
//    an earlier test's and silently takes the name-collision opt-out branch
//    (the very thing case 15 tests on purpose).
//  - `RecordingDOMSink.setRuleStyles` DOES carry the rule's selector as
//    `args[0]` (this landed with plans/implemented/stylerule-batched-flush.md,
//    ahead of this plan) — `declarationsDuring` below filters on it, per the
//    plan's own contingency note in `## Potential Challenges`.
//  - The framework rule is created once per *process*, not once per test, so
//    only the very first test in the whole run can observe its
//    `ensureStyleRule` op; every other assertion about the framework rule
//    goes through `_ruleCacheHas(':where(.ts-ui-component)')` instead.
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

const FRAMEWORK_SELECTOR = ':where(.ts-ui-component)';

/** The fifteen keys a class-uniform declaration may be hoisted onto. */
const HOISTED_KEYS = [
    'position', 'visibility', 'display', 'boxSizing', 'whiteSpace',
    'userSelect', 'cursor', 'border', 'margin', 'minWidth', 'minHeight',
    'maxWidth', 'maxHeight', 'overflowX', 'overflowY',
] as const;

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map (last write per key wins, matching
 * cascade-within-a-rule semantics). Only `setRuleStyles` ops whose selector
 * (`args[0]`) matches are counted, so a framework-rule or class-rule write
 * that happens in the same window doesn't leak into a `#id`-rule assertion,
 * and vice versa.
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

describe('Class-scoped style rules', () => {
    it('case 1: a default-valued declaration lands on no per-component rule', () => {
        class ProbeCase1 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        new ProbeCase1({}).getElement(true);
        const b = new ProbeCase1({});

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        for (const key of HOISTED_KEYS) {
            expect(declarations[key]).toBeUndefined();
        }
    });

    it('case 2: a universal declaration lands on the framework rule and on neither other tier', () => {
        class ProbeCase2 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ProbeCase2({});
        const declarations = declarationsDuring(sink, idSelector(a), () => a.getElement(true));
        new ProbeCase2({}).getElement(true);

        expect(_ruleCacheHas(FRAMEWORK_SELECTOR)).toBe(true);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeCase2').length).toBe(0);
        expect(declarations.position).toBeUndefined();
        expect(declarations.margin).toBeUndefined();
    });

    it('case 3: a class differing in nothing produces no class rule', () => {
        class ProbeCase3 extends Component {}

        new ProbeCase3({}).getElement(true);
        new ProbeCase3({}).getElement(true);

        expect(_ruleCacheHas('.ProbeCase3')).toBe(false);
    });

    it('case 4: a class that overrides a universal value gets it on its class rule', () => {
        class WideProbeCase4 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new WideProbeCase4({});
        const classDeclarations = declarationsDuring(sink, '.WideProbeCase4', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.WideProbeCase4').length).toBe(1);
        expect(classDeclarations.minWidth).toBe('100px');
        expect(classDeclarations.overflowX).toBe('auto');
        expect(classDeclarations.overflowY).toBe('auto');
        expect(classDeclarations.minHeight).toBeUndefined();
        expect(classDeclarations.position).toBeUndefined();
        expect(classDeclarations.margin).toBeUndefined();

        const b = new WideProbeCase4({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        for (const key of HOISTED_KEYS) {
            expect(instanceDeclarations[key]).toBeUndefined();
        }
    });

    it('case 5: an instance override beats both lower tiers', () => {
        class WideProbeCase5 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto' });
            }
        }

        new WideProbeCase5({}).getElement(true);
        new WideProbeCase5({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const c = new WideProbeCase5({ overflow: 'hidden' });
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(declarations.overflowX).toBe('hidden');
        expect(declarations.overflowY).toBe('hidden');
    });

    it('case 6: an explicitly-set value lands on #uuid', () => {
        class ProbeCase6 extends Component {}

        new ProbeCase6({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase6({ overflow: 'auto' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.overflowX).toBe('auto');
        expect(declarations.overflowY).toBe('auto');
        expect(declarations.position).toBeUndefined();
        expect(declarations.margin).toBeUndefined();
    });

    it('case 7: the framework class is present on a rendered element', () => {
        class ProbeCase7 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;
        new ProbeCase7({}).getElement(true);

        const addClassOps = sink.writes.slice(start).filter((w) => {
            if (w.op !== 'apply') {
                return false;
            }
            const patch = w.args[1] as { addClass?: string[] };
            return Array.isArray(patch.addClass)
                && patch.addClass.includes('ts-ui-component')
                && patch.addClass.includes('ProbeCase7');
        });

        expect(addClassOps.length).toBe(1);
    });

    it('case 8: a runtime setter after render writes #uuid', () => {
        class ProbeCase8 extends Component {}

        new ProbeCase8({}).getElement(true);
        const b = new ProbeCase8({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setMinSize({ width: 180, height: 0 }));

        expect(declarations.minWidth).toBe('180px');
        expect(declarations.minHeight).toBe('0px');
    });

    it('case 9: a runtime setter that restores a framework value still writes #uuid', () => {
        class ProbeCase9 extends Component {}

        const b = new ProbeCase9({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setOverflowY('hidden'));

        expect(declarations.overflowY).toBe('hidden');
    });

    it('case 10: instances of one class share one set of rules', () => {
        class ProbeCase10 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        new ProbeCase10({}).getElement(true);
        const b = new ProbeCase10({});
        const c = new ProbeCase10({});

        const bDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        const cDeclarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.ProbeCase10').length).toBe(0);
        expect(bDeclarations.position).toBeUndefined();
        expect(cDeclarations.position).toBeUndefined();
    });

    it('case 11: a class with no min-size default undoes the framework value', () => {
        class BareProbeCase11 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: undefined } as Partial<ComponentOptions>);
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new BareProbeCase11({});
        const classDeclarations = declarationsDuring(sink, '.BareProbeCase11', () => a.getElement(true));

        expect(classDeclarations.minWidth).toBe('auto');
        expect(classDeclarations.minHeight).toBe('auto');

        const b = new BareProbeCase11({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.minWidth).toBeUndefined();
        expect(instanceDeclarations.minHeight).toBeUndefined();
    });

    it('case 12: a subclass gets its own rule and inherits the rest', () => {
        class WideProbeCase12 extends Component {
            constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto', ...(subclassDefaults ?? {}) });
            }
        }

        class SubProbeCase12 extends WideProbeCase12 {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'clip' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;

        const wide1 = new WideProbeCase12({});
        wide1.getElement(true);

        const sub1 = new SubProbeCase12({});
        const subDeclarations = declarationsDuring(sink, '.SubProbeCase12', () => sub1.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.WideProbeCase12').length).toBe(1);
        expect(ensureStyleRuleOpsFor(sink, '.SubProbeCase12').length).toBe(1);
        expect(subDeclarations.overflowX).toBe('clip');
        expect(subDeclarations.overflowY).toBe('clip');
        expect(subDeclarations.minWidth).toBe('100px');

        const wide2 = new WideProbeCase12({});
        const wideDeclarations = declarationsDuring(sink, idSelector(wide2), () => wide2.getElement(true));
        expect(wideDeclarations.overflowX).toBeUndefined();
    });

    it('case 13: destroying an instance leaves the shared rules intact', () => {
        class WideProbeCase13 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto' });
            }
        }

        const a = new WideProbeCase13({});
        const b = new WideProbeCase13({});
        a.getElement(true);
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        (a as unknown as { destructor(): void }).destructor();
        (b as unknown as { destructor(): void }).destructor();

        const deleteOps = sink.writes.filter((w) =>
            w.op === 'deleteStyleRule' && (w.args[0] === '.WideProbeCase13' || w.args[0] === FRAMEWORK_SELECTOR));

        expect(deleteOps.length).toBe(0);
        expect(_ruleCacheHas('.WideProbeCase13')).toBe(true);
        expect(_ruleCacheHas(FRAMEWORK_SELECTOR)).toBe(true);
    });

    it('case 14: a new instance after that still renders styled', () => {
        class WideProbeCase14 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto' });
            }
        }

        const a = new WideProbeCase14({});
        const b = new WideProbeCase14({});
        a.getElement(true);
        b.getElement(true);
        (a as unknown as { destructor(): void }).destructor();
        (b as unknown as { destructor(): void }).destructor();

        const sink  = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;
        const c = new WideProbeCase14({});
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(sink.writes.slice(start).some((w) => w.op === 'ensureStyleRule' && w.args[0] === '.WideProbeCase14')).toBe(false);
        expect(declarations.position).toBeUndefined();
        expect(declarations.overflowX).toBeUndefined();
    });

    it('case 15: two classes with the same name — the second opts out of both tiers', () => {
        const TwinCase15A = class TwinCase15 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { overflow: 'auto' });
            }
        };

        const TwinCase15B = class TwinCase15 extends Component {};

        const sink = DOM.sink as RecordingDOMSink;

        new TwinCase15A({}).getElement(true);
        const secondA = new TwinCase15A({});
        const secondADeclarations = declarationsDuring(sink, idSelector(secondA), () => secondA.getElement(true));

        new TwinCase15B({}).getElement(true);
        const secondB = new TwinCase15B({});
        const secondBDeclarations = declarationsDuring(sink, idSelector(secondB), () => secondB.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.TwinCase15').length).toBe(1);
        expect(secondADeclarations.overflowX).toBeUndefined();

        for (const key of HOISTED_KEYS) {
            expect(secondBDeclarations[key]).not.toBeUndefined();
        }
        expect(secondBDeclarations.position).toBe('absolute');
        expect(secondBDeclarations.margin).toBe('0px 0px 0px 0px');
    });

    it('case 16: conditional declarations are never hoisted', () => {
        class ProbeCase16 extends Component {}

        new ProbeCase16({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase16({ backgroundColor: '#fff' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('#fff');
        // `border` is hoisted now: every class's "no border" resolution is the
        // same literal null, so the class bag already carries it and the
        // instance write is skipped entirely rather than written as null.
        expect(declarations.border).toBeUndefined();
        expect(HOISTED_KEYS).not.toContain('backgroundColor');
    });

    it('case 17: no rule for a component that never renders', () => {
        class ProbeCase17 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        new ProbeCase17({});

        expect(ensureStyleRuleOpsFor(sink, '.ProbeCase17').length).toBe(0);
    });

    it('case 18: a default-valued cursor lands on no per-component rule', () => {
        class ProbeCase18 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        new ProbeCase18({}).getElement(true);
        const b = new ProbeCase18({});

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.cursor).toBeUndefined();
    });

    it('case 19: a class that overrides cursor gets it on its class rule', () => {
        class PointerProbeCase19 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { cursor: 'pointer' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new PointerProbeCase19({});
        const classDeclarations = declarationsDuring(sink, '.PointerProbeCase19', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.PointerProbeCase19').length).toBe(1);
        expect(classDeclarations.cursor).toBe('pointer');

        const b = new PointerProbeCase19({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.cursor).toBeUndefined();
    });

    it('case 20: an explicitly-set cursor lands on #uuid', () => {
        class ProbeCase20 extends Component {}

        new ProbeCase20({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase20({ cursor: 'pointer' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.cursor).toBe('pointer');
    });

    it('case 21: an instance cursor matching the framework value still beats a class override', () => {
        class PointerProbeCase21 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { cursor: 'pointer' });
            }
        }

        new PointerProbeCase21({}).getElement(true);
        new PointerProbeCase21({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const c = new PointerProbeCase21({ cursor: 'default' });
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(declarations.cursor).toBe('default');
    });

    it('case 22: a pre-render setCursor call is honoured by the render-time rule write', () => {
        class ProbeCase22 extends Component {}

        const b = new ProbeCase22({});
        b.setCursor('pointer');

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.cursor).toBe('pointer');
    });

    it('case 23: a default-valued userSelect lands on no per-component rule', () => {
        class ProbeCase23 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        new ProbeCase23({}).getElement(true);
        const b = new ProbeCase23({});

        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.userSelect).toBeUndefined();
    });

    it('case 24: a class that overrides userSelect gets it on its class rule', () => {
        class SelectableProbeCase24 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { userSelect: 'text' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new SelectableProbeCase24({});
        const classDeclarations = declarationsDuring(sink, '.SelectableProbeCase24', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.SelectableProbeCase24').length).toBe(1);
        expect(classDeclarations.userSelect).toBe('text');

        const b = new SelectableProbeCase24({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.userSelect).toBeUndefined();
    });

    it('case 25: an explicitly-set userSelect lands on #uuid', () => {
        class ProbeCase25 extends Component {}

        new ProbeCase25({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase25({ userSelect: 'text' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.userSelect).toBe('text');
    });

    it('case 26: an instance userSelect matching the framework value still beats a class override', () => {
        class SelectableProbeCase26 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { userSelect: 'text' });
            }
        }

        new SelectableProbeCase26({}).getElement(true);
        new SelectableProbeCase26({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const c = new SelectableProbeCase26({ userSelect: 'none' });
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        // 'none' is the framework value, but it deviates from this class's own
        // bag, so it must still be restated on the instance rule to win.
        expect(declarations.userSelect).toBe('none');
    });

    it('case 27: a class with no outline default writes no outline declaration at all', () => {
        class ProbeCase27 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ProbeCase27({});
        const classDeclarations = declarationsDuring(sink, '.ProbeCase27', () => a.getElement(true));

        const b = new ProbeCase27({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        // Unlike cursor/userSelect, outline has no non-empty framework default,
        // so the key stays absent from every tier rather than resolving to one.
        expect(classDeclarations.outline).toBeUndefined();
        expect(instanceDeclarations.outline).toBeUndefined();
    });

    it('case 28: a class that defaults outline gets it on its class rule', () => {
        class OutlinedProbeCase28 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { outline: 'none' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new OutlinedProbeCase28({});
        const classDeclarations = declarationsDuring(sink, '.OutlinedProbeCase28', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.OutlinedProbeCase28').length).toBe(1);
        expect(classDeclarations.outline).toBe('none');

        const b = new OutlinedProbeCase28({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.outline).toBeUndefined();
    });

    it('case 29: an explicitly-set outline lands on #uuid', () => {
        class ProbeCase29 extends Component {}

        new ProbeCase29({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase29({});
        b.setOutline('2px solid blue');
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.outline).toBe('2px solid blue');
    });

    it('case 30: a class with no foregroundColor default writes no color declaration at all', () => {
        class ProbeCase30 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ProbeCase30({});
        const classDeclarations = declarationsDuring(sink, '.ProbeCase30', () => a.getElement(true));

        const b = new ProbeCase30({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(classDeclarations.color).toBeUndefined();
        expect(instanceDeclarations.color).toBeUndefined();
    });

    it('case 31: a class that defaults foregroundColor gets color on its class rule', () => {
        class TintedProbeCase31 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { foregroundColor: 'rgb(1, 2, 3)' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new TintedProbeCase31({});
        const classDeclarations = declarationsDuring(sink, '.TintedProbeCase31', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.TintedProbeCase31').length).toBe(1);
        expect(classDeclarations.color).toBe('rgb(1, 2, 3)');

        const b = new TintedProbeCase31({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.color).toBeUndefined();
    });

    it('case 32: an explicitly-set foregroundColor lands on #uuid', () => {
        class ProbeCase32 extends Component {}

        new ProbeCase32({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeCase32({ foregroundColor: 'rgb(4, 5, 6)' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.color).toBe('rgb(4, 5, 6)');
    });

    it('case 33: a class contributing a `font` bag via getClassStyleDefaults gets it hoisted onto its class rule', () => {
        // A bare `Component` subclass, not `Text` — proves the generic
        // `font`-field mechanism in `resolveDeclarations`/`classDeviations`
        // in isolation, since `Component`'s own `applyStyle` phases never
        // consult `font` themselves (only `Text.applyStyle` does).
        class FontProbeCase33 extends Component {
            protected getClassStyleDefaults() {
                return {
                    ...super.getClassStyleDefaults(),
                    font: { fontWeight: 'bold', fontStyle: null },
                };
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new FontProbeCase33({});
        const classDeclarations = declarationsDuring(sink, '.FontProbeCase33', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.FontProbeCase33').length).toBe(1);
        expect(classDeclarations.fontWeight).toBe('bold');
        // A `null`-valued font field is conditional, exactly like
        // outline/color — it must never introduce a key at all.
        expect(classDeclarations.fontStyle).toBeUndefined();
    });
});
