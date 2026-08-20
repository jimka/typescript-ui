// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the hierarchy-aware class tier introduced by
// plans/implemented/class-hierarchy-cascade.md — Expected Behaviour rows
// 1-9 (rows 10-12 are manual-verify, browser-only).
//
// Conventions mirrored from `ClassStyleRules.test.ts` (the flat mechanism's
// own coverage, which this plan leaves unmodified and still green):
//  - The `.ClassName` registry in `core/ClassStyleRules.ts` and the
//    `_ruleCache` in `core/StyleTarget.ts` are module state that survives
//    `DOM.reset()` (though not a fresh test *file*, since Vitest isolates
//    modules per file by default) — so every test declares its own
//    uniquely-*named* local `Component` subclass, unique across every other
//    test in this file.
//  - `RecordingDOMSink.setRuleStyles` carries the rule's selector as
//    `args[0]` — `declarationsDuring` filters on it.
//  - Every probe that declares `ownClassStyleDefaults` also forwards the
//    identical object as its constructor's `subclassDefaults` argument
//    (`super(options, ownDefaults)`), matching the codebase-wide convention
//    (`Cell`, `Text`, …) where the static field and the constructor's
//    forwarded defaults are the same value — this is the invariant
//    `ensureClassStyleRule`'s hierarchy path depends on (the caller-supplied
//    `getClassStyleDefaults()` bag must agree with the static walk).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import type { ClassStyleDefaults } from '~/core/ClassStyleRules';
import { getStyleClassChain } from '~/core/ClassStyleRules';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

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
 * (`args[0]`) matches are counted.
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

/** Recorded `ensureStyleRule` ops for the given selector, in call order. */
function ensureStyleRuleOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'ensureStyleRule' && w.args[0] === selector);
}

describe('Class-hierarchy CSS cascade', () => {
    it('case 1: a middle class\'s rule is shared by subclasses that register nothing of their own', () => {
        const row1BaseDefaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow1Base extends Component {
            protected static readonly ownClassStyleDefaults = row1BaseDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row1BaseDefaults);
            }
        }
        class ProbeRow1Mid extends ProbeRow1Base {}
        class ProbeRow1Leaf extends ProbeRow1Mid {}

        const sink = DOM.sink as RecordingDOMSink;
        const leaf = new ProbeRow1Leaf({});
        const baseDeclarations = declarationsDuring(sink, '.ProbeRow1Base', () => leaf.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow1Base').length).toBe(1);
        expect(baseDeclarations.cursor).toBe('pointer');
        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow1Mid').length).toBe(0);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow1Leaf').length).toBe(0);
    });

    it('case 2: a rendered leaf element carries every ancestor\'s own class name, unconditionally', () => {
        const row2BaseDefaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow2Base extends Component {
            protected static readonly ownClassStyleDefaults = row2BaseDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row2BaseDefaults);
            }
        }
        class ProbeRow2Mid extends ProbeRow2Base {}
        class ProbeRow2Leaf extends ProbeRow2Mid {}

        const sink = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;
        new ProbeRow2Leaf({}).getElement(true);

        const addClassOps = sink.writes.slice(start).filter((w) => {
            if (w.op !== 'apply') {
                return false;
            }
            const patch = w.args[1] as { addClass?: string[] };
            return Array.isArray(patch.addClass) && patch.addClass.includes('ts-ui-component');
        });

        expect(addClassOps.length).toBe(1);
        expect((addClassOps[0].args[1] as { addClass: string[] }).addClass).toEqual([
            'ts-ui-component', 'ProbeRow2Base', 'ProbeRow2Mid', 'ProbeRow2Leaf',
        ]);
    });

    it('case 3: a subclass rule carries only its own deviation, not an unchanged ancestor field', () => {
        const row3BaseDefaults: Partial<ComponentOptions> = { cursor: 'pointer', userSelect: 'text' };
        const row3MidDefaults:  Partial<ComponentOptions> = { cursor: 'text' };

        class ProbeRow3Base extends Component {
            protected static readonly ownClassStyleDefaults = row3BaseDefaults;
            constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
                super(options, { ...row3BaseDefaults, ...(subclassDefaults ?? {}) });
            }
        }
        class ProbeRow3Mid extends ProbeRow3Base {
            protected static readonly ownClassStyleDefaults = row3MidDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row3MidDefaults);
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const mid = new ProbeRow3Mid({});
        const midDeclarations = declarationsDuring(sink, '.ProbeRow3Mid', () => mid.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow3Base').length).toBe(1);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow3Mid').length).toBe(1);
        expect(midDeclarations.cursor).toBe('text');
        expect(midDeclarations.userSelect).toBeUndefined();
    });

    it('case 4: an ancestor\'s rule is inserted before its descendant\'s, even when the ancestor is never directly constructed', () => {
        const row4BaseDefaults: Partial<ComponentOptions> = { cursor: 'pointer', userSelect: 'text' };
        const row4MidDefaults:  Partial<ComponentOptions> = { cursor: 'text' };

        class ProbeRow4Base extends Component {
            protected static readonly ownClassStyleDefaults = row4BaseDefaults;
            constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
                super(options, { ...row4BaseDefaults, ...(subclassDefaults ?? {}) });
            }
        }
        class ProbeRow4Mid extends ProbeRow4Base {
            protected static readonly ownClassStyleDefaults = row4MidDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row4MidDefaults);
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        // Only a ProbeRow4Mid instance is ever constructed — ProbeRow4Base
        // itself is never directly instantiated in this test.
        new ProbeRow4Mid({}).getElement(true);

        const ensureOps = sink.writes.filter((w) => w.op === 'ensureStyleRule');
        const baseIndex = ensureOps.findIndex((w) => w.args[0] === '.ProbeRow4Base');
        const midIndex  = ensureOps.findIndex((w) => w.args[0] === '.ProbeRow4Mid');

        expect(baseIndex).toBeGreaterThanOrEqual(0);
        expect(midIndex).toBeGreaterThanOrEqual(0);
        expect(baseIndex).toBeLessThan(midIndex);
    });

    it('case 5: a class with no ownClassStyleDefaults anywhere in its chain behaves exactly like the pre-hierarchy flat mechanism', () => {
        class ProbeRow5 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { minSize: { width: 100, height: 0 }, overflow: 'auto' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ProbeRow5({});
        const classDeclarations = declarationsDuring(sink, '.ProbeRow5', () => a.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow5').length).toBe(1);
        expect(classDeclarations.minWidth).toBe('100px');
        expect(classDeclarations.overflowX).toBe('auto');
        expect(classDeclarations.overflowY).toBe('auto');
    });

    it('case 6: an instance value matching the framework baseline still beats a participating ancestor\'s class default', () => {
        // Exercised via a construction-time option rather than a post-render
        // `setCursor()` call: `Component.setCursor` writes an inline style
        // (always wins on specificity, bypassing the class-tier comparison
        // entirely) — the render-time `#id` *rule* write this case actually
        // targets is driven by `applyBoxAndVisibilityStyles` reading the
        // cached option via `getCursor()`, which construction-time options
        // populate identically to a pre-render `setCursor()` call (see
        // `ClassStyleRules.test.ts`'s case 21, the same pattern for the flat
        // mechanism).
        const row6BaseDefaults: Partial<ComponentOptions> = { cursor: 'text' };

        class ProbeRow6Base extends Component {
            protected static readonly ownClassStyleDefaults = row6BaseDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row6BaseDefaults);
            }
        }
        class ProbeRow6Leaf extends ProbeRow6Base {}

        new ProbeRow6Leaf({}).getElement(true);
        new ProbeRow6Leaf({}).getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const c = new ProbeRow6Leaf({ cursor: 'default' });
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        // 'default' is the framework baseline, but ProbeRow6Base's own class
        // default is 'text' — ProbeRow6Leaf inherits that via pass-through,
        // so an instance write of 'default' must still be restated on #id to
        // win, unaffected by which tier (framework vs. ancestor) declares
        // the value it's being compared against.
        expect(declarations.cursor).toBe('default');
    });

    it('case 7: a name collision opts a hierarchy participant out of both tiers, exactly like the flat mechanism', () => {
        const row7ADefaults: Partial<ComponentOptions> = { cursor: 'pointer' };
        const row7BDefaults: Partial<ComponentOptions> = { cursor: 'text' };

        const TwinRow7A = class TwinRow7 extends Component {
            protected static readonly ownClassStyleDefaults = row7ADefaults;
            constructor(options?: ComponentOptions) {
                super(options, row7ADefaults);
            }
        };
        const TwinRow7B = class TwinRow7 extends Component {
            protected static readonly ownClassStyleDefaults = row7BDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row7BDefaults);
            }
        };

        const sink = DOM.sink as RecordingDOMSink;

        new TwinRow7A({}).getElement(true);

        const b = new TwinRow7B({});
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        // Only the first class to claim "TwinRow7" ever gets a rule.
        expect(ensureStyleRuleOpsFor(sink, '.TwinRow7').length).toBe(1);

        // The second (colliding) class's instances write every hoistable
        // declaration to their own #id, exactly like today's flat
        // name-collision behaviour — including keys whose value happens to
        // equal the framework baseline.
        for (const key of HOISTED_KEYS) {
            expect(declarations[key]).not.toBeUndefined();
        }
        expect(declarations.cursor).toBe('text');
        expect(declarations.position).toBe('absolute');
        expect(declarations.margin).toBe('0px 0px 0px 0px');
    });

    it('case 8: a three-level chain where the middle class registers nothing diffs the leaf against the grandparent', () => {
        const row8ADefaults: Partial<ComponentOptions> = { cursor: 'pointer' };
        const row8CDefaults: Partial<ComponentOptions> = { cursor: 'text' };

        class ProbeRow8A extends Component {
            protected static readonly ownClassStyleDefaults = row8ADefaults;
            constructor(options?: ComponentOptions, subclassDefaults?: Partial<ComponentOptions>) {
                super(options, { ...row8ADefaults, ...(subclassDefaults ?? {}) });
            }
        }
        class ProbeRow8B extends ProbeRow8A {}
        class ProbeRow8C extends ProbeRow8B {
            protected static readonly ownClassStyleDefaults = row8CDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row8CDefaults);
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const c = new ProbeRow8C({});
        const cDeclarations = declarationsDuring(sink, '.ProbeRow8C', () => c.getElement(true));

        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow8A').length).toBe(1);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow8B').length).toBe(0);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeRow8C').length).toBe(1);
        expect(cDeclarations.cursor).toBe('text');
    });

    it('case 9: getStyleClassChain caches the walked array by reference', () => {
        class ProbeRow9 extends Component {}

        const first  = getStyleClassChain(ProbeRow9);
        const second = getStyleClassChain(ProbeRow9);

        expect(second).toBe(first);
        expect(first).toEqual(['ProbeRow9']);
    });

    // Audit-found gap: a chain with no ownClassStyleDefaults anywhere (e.g.
    // Button/ToggleButton/TabButton, none of which opt in) must not widen —
    // each still has its own independent flat `.ClassName` rule (including
    // an independently-created state-tier rule for Button's family
    // specifically), so widening two same-specificity rules onto one
    // element would make the winner depend on stylesheet insertion order.
    // See the plan's Implementation Notes.
    it('case 10: a chain with no ownClassStyleDefaults anywhere in it does not widen at all, even through several non-participating levels', () => {
        class ProbeRow10Base extends Component {}
        class ProbeRow10Mid extends ProbeRow10Base {}
        class ProbeRow10Leaf extends ProbeRow10Mid {}

        expect(getStyleClassChain(ProbeRow10Leaf)).toEqual(['ProbeRow10Leaf']);
        expect(getStyleClassChain(ProbeRow10Mid)).toEqual(['ProbeRow10Mid']);
        expect(getStyleClassChain(ProbeRow10Base)).toEqual(['ProbeRow10Base']);
    });

    it('case 11: a participating chain still widens through a non-participating middle level (unaffected by case 10\'s gate)', () => {
        const row11BaseDefaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow11Base extends Component {
            protected static readonly ownClassStyleDefaults = row11BaseDefaults;
            constructor(options?: ComponentOptions) {
                super(options, row11BaseDefaults);
            }
        }
        // No own field — mirrors DefaultCell between Cell and HeaderCell.
        class ProbeRow11Mid extends ProbeRow11Base {}
        class ProbeRow11Leaf extends ProbeRow11Mid {}

        expect(getStyleClassChain(ProbeRow11Leaf)).toEqual([
            'ProbeRow11Base', 'ProbeRow11Mid', 'ProbeRow11Leaf',
        ]);
    });
});
