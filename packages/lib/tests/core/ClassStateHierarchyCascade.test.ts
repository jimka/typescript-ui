// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the state-tier (`.pressed`/`.selected`/…) sibling
// of the hierarchy-aware class tier, introduced by
// plans/implemented/button-family-hierarchy-cascade.md — Expected Behaviour
// rows 1-7. Rows 8-11 (Button/ToggleButton/TabButton/SpinButton-specific)
// are covered by those classes' own existing test files, unmodified. Rows
// 12-14 are manual-verify, browser-only.
//
// Same module-state caveat as `ClassHierarchyCascade.test.ts` and
// `ClassStateRules.test.ts`: the `.ClassName`/`.ClassName<suffix>` registry
// in `core/ClassStyleRules.ts` and the `_ruleCache` in `core/StyleTarget.ts`
// survive `DOM.reset()` (though not a fresh test *file*), so every test
// below declares its own uniquely-named local `Component` subclasses, unique
// across every other test in this file.
//
// Every probe class's write (in its constructor, via `.set()`/`.setMany()`)
// mirrors `Button.pressedStyleRule`'s real shape: an instance method
// (`getOnDeclarations`) virtually dispatches to `(this.constructor as
// typeof ProbeBase).extractOn(...)`, so the write always reflects whichever
// concrete subclass is actually being constructed — the same reason
// `Button.getPressedClassDeclarations()` delegates to
// `(this.constructor as typeof Button).extractPressedClassDeclarations(...)`
// rather than hardcoding a fixed bag. A probe that instead hardcoded a
// single literal write shared by every subclass could never dedupe
// correctly once a subclass's resolved class-tier bag diverges from its
// parent's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import type { StyleBag } from '~/core/ClassStyleRules';

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

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: Component): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

describe('Class-hierarchy state-tier cascade', () => {
    it('case 1: only the level that declares the extractor gets a class rule; a non-overriding subclass is served by it', () => {
        const row1Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow1Base extends Component {
            protected static readonly ownClassStyleDefaults = row1Defaults;

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow1Base).extractOn(row1Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row1Defaults);
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').setMany(this.getOnDeclarations());
            }
        }
        class ProbeRow1Mid extends ProbeRow1Base {}
        class ProbeRow1Leaf extends ProbeRow1Mid {}

        const sink = DOM.sink as RecordingDOMSink;
        const leaf = new ProbeRow1Leaf({});
        const declarations = declarationsDuring(sink, idSelector(leaf) + '.on', () => leaf.getElement(true));

        expect(_ruleCacheHas('.ProbeRow1Base.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeRow1Leaf.on')).toBe(false);
        expect(declarations.color).toBeUndefined();
    });

    it('case 2: a mid-level override creates its own class rule carrying only the deviating key', () => {
        const row2Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow2Base extends Component {
            protected static readonly ownClassStyleDefaults = row2Defaults;

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'blue' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow2Base).extractOn(row2Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row2Defaults);
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').setMany(this.getOnDeclarations());
            }
        }
        class ProbeRow2Mid extends ProbeRow2Base {
            protected static override extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'green' };
            }
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

    it('case 3: a leaf override matching its parent\'s bag creates no new rule; the leaf is served by the parent\'s', () => {
        const row3Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow3Base extends Component {
            protected static readonly ownClassStyleDefaults = row3Defaults;

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'blue' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow3Base).extractOn(row3Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row3Defaults);
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').setMany(this.getOnDeclarations());
            }
        }
        class ProbeRow3Mid extends ProbeRow3Base {
            protected static override extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'green' };
            }
        }
        class ProbeRow3Leaf extends ProbeRow3Mid {
            // Same bag as Mid's — no new deviation.
            protected static override extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'green' };
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const leaf = new ProbeRow3Leaf({});
        const leafDeclarations = declarationsDuring(sink, idSelector(leaf) + '.on', () => leaf.getElement(true));

        expect(_ruleCacheHas('.ProbeRow3Mid.on')).toBe(true);
        expect(_ruleCacheHas('.ProbeRow3Leaf.on')).toBe(false);
        expect(leafDeclarations.backgroundColor).toBeUndefined();
    });

    it('case 4: a non-declaring mid level contributes nothing — a leaf override diffs against the grandparent, not the mid', () => {
        const row4Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow4Base extends Component {
            protected static readonly ownClassStyleDefaults = row4Defaults;

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'blue' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow4Base).extractOn(row4Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row4Defaults);
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').setMany(this.getOnDeclarations());
            }
        }
        // No own `extractOn` — inherits Base's, so `hasOwnProperty` is false.
        class ProbeRow4Mid extends ProbeRow4Base {}
        class ProbeRow4Leaf extends ProbeRow4Mid {
            protected static override extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'purple' };
            }
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

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'blue' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow5Base).extractOn(row5Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row5Defaults);
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').setMany(this.getOnDeclarations());
            }
        }
        class ProbeRow5Mid extends ProbeRow5Base {
            protected static override extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red', backgroundColor: 'green' };
            }
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

    it('case 6: an instance-level set() call unaffected by hierarchy still writes its own #id rule', () => {
        const row6Defaults: Partial<ComponentOptions> = { cursor: 'pointer' };

        class ProbeRow6Base extends Component {
            protected static readonly ownClassStyleDefaults = row6Defaults;

            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red' };
            }

            protected getOnDeclarations(): Record<string, string | null> {
                return (this.constructor as typeof ProbeRow6Base).extractOn(row6Defaults);
            }

            constructor(options?: ComponentOptions) {
                super(options, row6Defaults);
                // Deviates from the resolved class-tier value ('red') on purpose.
                this.createStateStyleRule('.on', () => this.getOnDeclarations(), 'extractOn').set('color', 'blue');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const probe = new ProbeRow6Base({});
        const declarations = declarationsDuring(sink, idSelector(probe) + '.on', () => probe.getElement(true));

        expect(declarations.color).toBe('blue');
    });

    it('case 7: a class with no ownClassStyleDefaults anywhere in its chain falls back to today\'s flat behaviour, even when an extractor name is passed', () => {
        class ProbeRow7 extends Component {
            protected static extractOn(_defaults: StyleBag): Record<string, string | null> {
                return { color: 'red' };
            }

            constructor(options?: ComponentOptions) {
                super(options);
                this.createStateStyleRule('.on', () => ({ color: 'red' }), 'extractOn').set('color', 'red');
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const firstDeclarations = declarationsDuring(sink, '.ProbeRow7.on', () => {
            new ProbeRow7({}).getElement(true);
        });

        expect(_ruleCacheHas('.ProbeRow7.on')).toBe(true);
        expect(firstDeclarations.color).toBe('red');

        const second = new ProbeRow7({});
        const secondDeclarations = declarationsDuring(sink, idSelector(second) + '.on', () => second.getElement(true));
        expect(secondDeclarations.color).toBeUndefined();
    });
});
