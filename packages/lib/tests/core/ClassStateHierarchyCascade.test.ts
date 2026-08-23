// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the hierarchy-aware state tier introduced by
// plans/in-progress/state-tier-full-unification.md — Expected Behaviour rows
// 4-9. Cases 1-7 below are the per-level content walk
// (`resolveStateLevels`/`buildResolvedStates`), rewritten against
// `ownStyleStates` — the mechanism these seven cases originally pinned
// (`createStateStyleRule` + a named `extractorMethodName`) was retired by
// this same plan. Cases 8-10 exercise the walk against the real Button/
// TabButton/HeaderCell classes (rows 7-9).
//
// Same module-state caveat as `ClassHierarchyCascade.test.ts` and
// `ClassStateRules.test.ts`: the `.ClassName`/`.ClassName<suffix>` registry
// in `core/ClassStyleRules.ts` and the `_ruleCache` in `core/StyleTarget.ts`
// survive `DOM.reset()` (though not a fresh test *file*), so every synthetic
// probe below declares its own uniquely-named local `Component` subclasses,
// unique across every other test in this file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { resolveStyleStates, type StyleBag, type StyleStateSpec } from '~/core/ClassStyleRules';
import { Button } from '~/component/button/Button';
import { TabButton } from '~/component/button/TabButton';
import { HeaderCell } from '~/component/table/cell/Header';

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
 * `ClassHierarchyCascade.test.ts` — see that file for the full rationale.
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

/** Recorded `setRuleStyles` ops for the given selector, in call order. */
function setRuleStylesOpsFor(sink: RecordingDOMSink, selector: string): Array<{ op: string; args: unknown[] }> {
    return sink.writes.filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector);
}

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: Component): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('Class-hierarchy state-tier cascade', () => {
    it('case 1: only the level that declares ownStyleStates gets a class rule; a non-overriding subclass is served by it', () => {
        const row1Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow1Base extends Component {
            protected static readonly ownClassStyleDefaults = row1Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row1Defaults);
            }
        }
        class ProbeRow1Mid extends ProbeRow1Base {}
        class ProbeRow1Leaf extends ProbeRow1Mid {}

        const sink = DOM.sink as RecordingDOMSink;
        const leaf = new ProbeRow1Leaf({});
        const declarations = declarationsDuring(sink, idSelector(leaf) + '.on', () => leaf.getElement(true));

        expect(_ruleCacheHas('.ProbeRow1Base.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeRow1Leaf.on')).toBe(false);
        // Nothing in this probe ever writes to the instance's own rule — the
        // whole class-tier bag is supplied by `.ProbeRow1Base.on`.
        expect(declarations.color).toBeUndefined();
    });

    it('case 2: a mid-level override creates its own class rule carrying only the deviating key', () => {
        const row2Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow2Base extends Component {
            protected static readonly ownClassStyleDefaults = row2Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'blue' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row2Defaults);
            }
        }
        class ProbeRow2Mid extends ProbeRow2Base {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'green' }) },
            ];
        }

        const sink = DOM.sink as RecordingDOMSink;
        const midDeclarations = declarationsDuring(sink, '.ProbeRow2Mid.on', () => {
            new ProbeRow2Mid({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeRow2Base.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeRow2Mid.on')).toBe(true);
        expect(midDeclarations.backgroundColor).toBe('green');
        expect(midDeclarations.color).toBeUndefined();
    });

    it('case 3: a leaf declaration matching its parent\'s resolved bag creates no new rule; the leaf is served by the parent\'s', () => {
        const row3Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow3Base extends Component {
            protected static readonly ownClassStyleDefaults = row3Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'blue' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row3Defaults);
            }
        }
        class ProbeRow3Mid extends ProbeRow3Base {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'green' }) },
            ];
        }
        class ProbeRow3Leaf extends ProbeRow3Mid {
            // Restates Mid's own list unchanged — no new deviation.
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'green' }) },
            ];
        }

        const sink = DOM.sink as RecordingDOMSink;
        const leaf = new ProbeRow3Leaf({});
        const leafDeclarations = declarationsDuring(sink, idSelector(leaf) + '.on', () => leaf.getElement(true));

        expect(_ruleCacheHas('.ProbeRow3Mid.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeRow3Leaf.on')).toBe(false);
        expect(leafDeclarations.backgroundColor).toBeUndefined();
    });

    it('case 4: a non-declaring mid level contributes nothing — a leaf declaration diffs against the grandparent, not the mid', () => {
        const row4Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow4Base extends Component {
            protected static readonly ownClassStyleDefaults = row4Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'blue' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row4Defaults);
            }
        }
        // No own `ownStyleStates` — inherits Base's list and content wholesale.
        class ProbeRow4Mid extends ProbeRow4Base {}
        class ProbeRow4Leaf extends ProbeRow4Mid {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'purple' }) },
            ];
        }

        const sink = DOM.sink as RecordingDOMSink;
        const leafDeclarations = declarationsDuring(sink, '.ProbeRow4Leaf.on', () => {
            new ProbeRow4Leaf({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeRow4Mid.on')).toBe(false);
        expect(_ruleCacheHas('.ProbeRow4Leaf.on')).toBe(true);
        expect(leafDeclarations.backgroundColor).toBe('purple');
        // Diffed against Base's resolved bag (also color:'red'), so the
        // unchanged `color` key is not repeated on the leaf's own rule.
        expect(leafDeclarations.color).toBeUndefined();
    });

    it('case 5: base-before-mid insertion order holds even when only the leaf is ever directly constructed', () => {
        const row5Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow5Base extends Component {
            protected static readonly ownClassStyleDefaults = row5Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'blue' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row5Defaults);
            }
        }
        class ProbeRow5Mid extends ProbeRow5Base {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red', backgroundColor: 'green' }) },
            ];
        }
        class ProbeRow5Leaf extends ProbeRow5Mid {}

        const sink = DOM.sink as RecordingDOMSink;
        // Base is never directly constructed; only Leaf is.
        new ProbeRow5Leaf({}).getElement(true);

        const ensureOps = sink.writes.filter((w) => w.op === 'ensureStyleRule');
        const baseIndex = ensureOps.findIndex((w) => w.args[0] === '.ProbeRow5Base.on');
        const midIndex  = ensureOps.findIndex((w) => w.args[0] === '.ProbeRow5Mid.on');

        expect(baseIndex).toBeGreaterThanOrEqual(0);
        expect(midIndex).toBeGreaterThanOrEqual(0);
        expect(baseIndex).toBeLessThan(midIndex);
    });

    it('case 6: a raw instance-level createStyleRule() write is unaffected by the class-tier walk', () => {
        const row6Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow6Base extends Component {
            protected static readonly ownClassStyleDefaults = row6Defaults;
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red' }) },
            ];

            constructor(options?: ComponentOptions) {
                super(options, row6Defaults);
                // Deviates from the resolved class-tier value ('red') on
                // purpose, via the low-level primitive `ownStyleStates`'
                // own class-tier rule never touches.
                this.createStyleRule('.on').set('color', 'blue');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const probe = new ProbeRow6Base({});
        const declarations = declarationsDuring(sink, idSelector(probe) + '.on', () => probe.getElement(true));

        expect(declarations.color).toBe('blue');
    });

    it('case 7: a class with no ownClassStyleDefaults can still declare ownStyleStates and dedupes its class rule normally', () => {
        class ProbeRow7 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.on', extract: (): StyleBag => ({ foregroundColor: 'red' }) },
            ];
        }

        const sink = DOM.sink as RecordingDOMSink;
        const firstDeclarations = declarationsDuring(sink, '.ProbeRow7.on', () => {
            new ProbeRow7({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeRow7.on')).toBe(true);
        expect(firstDeclarations.color).toBe('red');

        // A second instance's plain render writes nothing new to its own
        // instance rule — nothing in this probe ever calls the low-level
        // per-instance write primitive.
        const second = new ProbeRow7({});
        const secondDeclarations = declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true));
        expect(secondDeclarations.color).toBeUndefined();
    });

    it('row 7: a selected TabButton reports its own white fill from getBackgroundColor(), not ToggleButton\'s grey', () => {
        const tab = new TabButton('Tab', { selected: true });
        tab.getElement(true);

        expect(tab.getBackgroundColor()).toBe('var(--ts-ui-tab-button-selected-bg, rgb(255, 255, 255))');
    });

    it('row 8: constructing and rendering one Button produces exactly one setRuleStyles op for .Button.pressed', () => {
        const sink = DOM.sink as RecordingDOMSink;
        const ops = setRuleStylesOpsFor(sink, '.Button.pressed').length;

        new Button('Once').getElement(true);

        expect(setRuleStylesOpsFor(sink, '.Button.pressed').length).toBe(ops + 1);
    });

    it('row 9: a rendered HeaderCell shares .Cell\'s rangeSelected/readOnly/requiredEmpty rules and carries only :active of its own', () => {
        // Literal, not read via `resolveStyleStates(HeaderCell)` first — that
        // call resolves (and creates) the class-tier rules as a side effect,
        // which would warm the cache before the render below and leave
        // nothing for `declarationsDuring` to capture.
        const activeSelector = '.HeaderCell:active:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)';

        const sink = DOM.sink as RecordingDOMSink;
        // The class-tier rules are shared (`.ClassName<suffix>`, not
        // `#id<suffix>`) and materialise the moment they're first resolved —
        // no element required. `HeaderCell`'s own constructor eagerly warms
        // its lazy `activeStyleRule` getter (`this.activeStyleRule.set(...)`),
        // which is what walks `resolveStyleStates` and creates the rule, so
        // the write happens at construction, before any render.
        let header: HeaderCell;
        const activeDeclarations = declarationsDuring(sink, activeSelector, () => {
            header = new HeaderCell('Name', 'name');
        });
        header!.getElement(true);

        expect(_ruleCacheHas('.HeaderCell.rangeSelected')).toBe(false);
        expect(_ruleCacheHas('.HeaderCell.readOnly:not(.rangeSelected)')).toBe(false);
        expect(_ruleCacheHas('.HeaderCell.requiredEmpty:not(.rangeSelected):not(.readOnly)')).toBe(false);
        expect(_ruleCacheHas('.Cell.rangeSelected')).toBe(true);
        expect(_ruleCacheHas('.Cell.readOnly:not(.rangeSelected)')).toBe(true);
        expect(_ruleCacheHas('.Cell.requiredEmpty:not(.rangeSelected):not(.readOnly)')).toBe(true);
        expect(_ruleCacheHas(activeSelector)).toBe(true);
        expect(activeDeclarations.boxShadow).toBeDefined();

        // Cross-check the literal suffix against the resolver's own output.
        const activeSuffix = resolveStyleStates(HeaderCell).find((s) => s.selector === ':active')!.guardedSuffix;
        expect('.HeaderCell' + activeSuffix).toBe(activeSelector);
    });
});
