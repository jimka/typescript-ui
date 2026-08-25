// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for the chrome base-tier hoisting introduced by
// plans/implemented/component-chrome-base-tier-hoisting.md — Expected
// Behaviour rows 1-14 (rows 15-18 are manual-verify, browser-only; see the
// plan's `## Verification` section).
//
// Same conventions as `ClassStyleRules.test.ts`, which this file mirrors:
//  - Every locally-declared `Component` subclass needs a name unique across
//    the whole file — the `.ClassName` registry in `core/ClassStyleRules.ts`
//    is module state that survives `DOM.reset()` (though not a fresh test
//    *file*, since Vitest isolates modules per file by default), so a name
//    collision silently takes the name-collision opt-out (no class rule at
//    all — see `ClassStyleRules.test.ts` case 15).
//  - `declarationsDuring`/`idSelector` are copied from `ClassStyleRules.test.ts`.
//
// A recurring test-design note that isn't obvious from the plan's table
// alone: `Component.materialiseWhenNeeded` only inserts a component's `#id`
// rule once something *real* (non-null) is queued for it, or the rule
// already exists (see `core/Component.ts`'s `materialiseWhenNeeded` and
// `StyleTarget.hasQueuedDeclarations`). A reconciled write that resolves to
// a `null` removal is therefore only observable through the recording sink
// when `#id` was already materialised by an earlier, genuinely-deviating
// write — several cases below (rows 8, 10, 11's non-defaulting half, and
// row 12's "already neutral" half) construct or pre-render the instance
// with an explicit deviating value for exactly this reason, mirroring how
// rows 6-7 chain a real `setBackgroundColor("red")` before the
// matches-the-default call whose removal they're actually asserting.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Button } from '~/component/button/Button';
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
 * cascade-within-a-rule semantics). Copied from `ClassStyleRules.test.ts`.
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

const BORDER_LONGHANDS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;

describe('Component chrome base-tier hoisting', () => {
    it('row 1: a class defaulting backgroundColor hoists it onto .ClassName; a fresh instance writes nothing to #id', () => {
        class BgColorProbeRow1 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundColor: 'rgb(10, 20, 30)' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new BgColorProbeRow1({});
        const classDeclarations = declarationsDuring(sink, '.BgColorProbeRow1', () => a.getElement(true));
        expect(classDeclarations.backgroundColor).toBe('rgb(10, 20, 30)');

        const b = new BgColorProbeRow1({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.backgroundColor).toBeUndefined();
    });

    it('row 2: a class defaulting backgroundImage hoists it onto .ClassName; a fresh instance writes nothing to #id', () => {
        class BgImageProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundImage: 'linear-gradient(red, blue)' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new BgImageProbeRow2({});
        const classDeclarations = declarationsDuring(sink, '.BgImageProbeRow2', () => a.getElement(true));
        expect(classDeclarations.backgroundImage).toBe('linear-gradient(red, blue)');

        const b = new BgImageProbeRow2({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.backgroundImage).toBeUndefined();
    });

    it('row 2: a class defaulting shadow hoists it onto .ClassName; a fresh instance writes nothing to #id', () => {
        class ShadowProbeRow2 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { shadow: '0 0 4px black' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new ShadowProbeRow2({});
        const classDeclarations = declarationsDuring(sink, '.ShadowProbeRow2', () => a.getElement(true));
        expect(classDeclarations.boxShadow).toBe('0 0 4px black');

        const b = new ShadowProbeRow2({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.boxShadow).toBeUndefined();
    });

    it('row 3: a class defaulting a uniform border hoists all four longhands onto .ClassName; a fresh instance writes nothing to #id', () => {
        class BorderProbeRow3 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { border: '1px solid red' });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new BorderProbeRow3({});
        const classDeclarations = declarationsDuring(sink, '.BorderProbeRow3', () => a.getElement(true));
        for (const key of BORDER_LONGHANDS) {
            expect(classDeclarations[key]).toBe('1px solid red');
        }

        const b = new BorderProbeRow3({});
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        for (const key of BORDER_LONGHANDS) {
            expect(instanceDeclarations[key]).toBeUndefined();
        }
    });

    it('row 4: a class defaulting a per-side border hoists the explicit side and the "none" fallback sides onto .ClassName', () => {
        class BorderTopProbeRow4 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { border: { borderTop: '2px solid red' } });
            }
        }

        const sink = DOM.sink as RecordingDOMSink;
        const a = new BorderTopProbeRow4({});
        const classDeclarations = declarationsDuring(sink, '.BorderTopProbeRow4', () => a.getElement(true));
        expect(classDeclarations.borderTop).toBe('2px solid red');
        expect(classDeclarations.borderRight).toBe('none');
        expect(classDeclarations.borderBottom).toBe('none');
        expect(classDeclarations.borderLeft).toBe('none');
    });

    it('row 5: a class defaulting none of the four writes nothing on .ClassName; an explicit instance override still writes to #id', () => {
        class NoneProbeRow5 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const a = new NoneProbeRow5({});
        const classDeclarations = declarationsDuring(sink, '.NoneProbeRow5', () => a.getElement(true));
        expect(classDeclarations.backgroundColor).toBeUndefined();
        expect(classDeclarations.backgroundImage).toBeUndefined();
        expect(classDeclarations.boxShadow).toBeUndefined();

        const b = new NoneProbeRow5({ backgroundColor: 'red' });
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.backgroundColor).toBe('red');
    });

    it('rows 6-7: setBackgroundColor to a real value writes it to #id; restoring the class default afterwards writes a removal, not silence', () => {
        class BgColorProbeRow67 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundColor: 'rgb(10, 20, 30)' });
            }
        }

        const b = new BgColorProbeRow67({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const row6 = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('red'));
        expect(row6.backgroundColor).toBe('red');

        const row7 = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('rgb(10, 20, 30)'));
        expect(row7.backgroundColor).toBeNull();
    });

    it('row 8: setBorder back to the class default writes four removals once #id already carries a real, deviating border', () => {
        class BorderProbeRow8 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { border: '1px solid red' });
            }
        }

        const b = new BorderProbeRow8({ border: '2px solid blue' });
        b.getElement(true); // materialises #id with a real, deviating border

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBorder('1px solid red'));
        for (const key of BORDER_LONGHANDS) {
            expect(declarations[key]).toBeNull();
        }
    });

    it('row 9: clearBackgroundColor on a class that defaults backgroundColor asserts the CSS initial value "transparent"', () => {
        class BgColorProbeRow9 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundColor: 'rgb(10, 20, 30)' });
            }
        }

        const b = new BgColorProbeRow9({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBackgroundColor());
        expect(declarations.backgroundColor).toBe('transparent');
    });

    it('row 10: clearBackgroundColor on a class that defaults none still writes a plain removal, unchanged from today', () => {
        class NoneProbeRow10 extends Component {}

        const b = new NoneProbeRow10({ backgroundColor: 'blue' });
        b.getElement(true); // materialises #id with a real backgroundColor

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBackgroundColor());
        expect(declarations.backgroundColor).toBeNull();
    });

    it('row 11: clearBackgroundImage on a class that defaults backgroundImage asserts the CSS initial value "none"', () => {
        class BgImageProbeRow11 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { backgroundImage: 'linear-gradient(red, blue)' });
            }
        }

        const b = new BgImageProbeRow11({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        // Every Component now inherits the root-level `.undisplayed`/`.invisible`
        // declared states (see component-setdisplayed-state-tier-dedup.md and
        // plans/implemented/component-setvisible-state-tier-dedup.md), so
        // isRestingChromeIsolated() is true here too — writeGuardedCSSRule's
        // assertion lands on the guarded rule, not the bare #id one.
        const declarations = declarationsDuring(sink, idSelector(b) + ':not(.undisplayed):not(.invisible)', () => b.clearBackgroundImage());
        expect(declarations.backgroundImage).toBe('none');
    });

    it('row 11: clearBackgroundImage on a class that defaults none still writes a plain removal', () => {
        class NoneProbeRow11 extends Component {}

        const b = new NoneProbeRow11({ backgroundImage: 'linear-gradient(a, b)' });
        b.getElement(true); // materialises #id with a real backgroundImage

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBackgroundImage());
        expect(declarations.backgroundImage).toBeNull();
    });

    it('row 12: clearShadow on a class whose default is not already "none" still writes the literal "none" neutral', () => {
        class ShadowProbeRow12 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { shadow: '0 0 4px black' });
            }
        }

        const b = new ShadowProbeRow12({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        // `writeGuardedCSSRule` (which `clearShadow`'s "none" neutral routes
        // through) now isolates onto `#id:not(.undisplayed):not(.invisible)`
        // rather than the bare `#id` rule: `Component`'s own
        // `.undisplayed`/`.invisible` states (the state-tier dedup plans)
        // make `isRestingChromeIsolated()` true for every class,
        // `ShadowProbeRow12` included, even though neither state shares a
        // property with `boxShadow`. `:not(.undisplayed):not(.invisible)`
        // still beats the class-tier rule and still matches a non-hidden
        // instance, so the override still wins the cascade; only the
        // selector moved.
        const declarations = declarationsDuring(sink, idSelector(b) + ':not(.undisplayed):not(.invisible)', () => b.clearShadow());
        expect(declarations.boxShadow).toBe('none');
    });

    it('row 12: clearShadow on a class whose default is already "none" writes a removal instead of restating it', () => {
        class ShadowNoneProbeRow12 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { shadow: 'none' });
            }
        }

        const b = new ShadowNoneProbeRow12({ shadow: '0 0 4px black' });
        b.getElement(true); // materialises #id with a real, deviating shadow

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearShadow());
        expect(declarations.boxShadow).toBeNull();
    });

    it('row 12: clearBorder on a class whose default is not already "none" still writes the literal "none" neutral on all four sides', () => {
        class BorderProbeRow12 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { border: '1px solid red' });
            }
        }

        const b = new BorderProbeRow12({});
        b.getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBorder());
        for (const key of BORDER_LONGHANDS) {
            expect(declarations[key]).toBe('none');
        }
    });

    it('row 12: clearBorder on a class whose default is already "none" writes removals instead of restating it', () => {
        class BorderNoneProbeRow12 extends Component {
            constructor(options?: ComponentOptions) {
                super(options, { border: 'none' });
            }
        }

        const b = new BorderNoneProbeRow12({ border: '1px solid red' });
        b.getElement(true); // materialises #id with a real, deviating border

        const sink = DOM.sink as RecordingDOMSink;
        const declarations = declarationsDuring(sink, idSelector(b), () => b.clearBorder());
        for (const key of BORDER_LONGHANDS) {
            expect(declarations[key]).toBeNull();
        }
    });

    it('row 13: a fresh chromeless Button writes real box-shadow:none/background-image:none neutrals to #id', () => {
        // Warm up `.Button`'s class-tier rule with a normal, chromeful
        // instance first, so its shadow/backgroundImage tokens (which
        // differ from "none") are the values the chromeless instance below
        // is compared against.
        new Button('Warmup').getElement(true);

        const sink = DOM.sink as RecordingDOMSink;
        const b = new Button('X', { chromeless: true });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.boxShadow).toBe('none');
        expect(declarations.backgroundImage).toBe('none');
    });

    it('row 14: setChromeless(false) after setChromeless(true) restores the class-tier chrome via removals, never skipping the write', () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('Toggled');
        btn.getElement(true);
        btn.setChromeless(true); // pins real box-shadow:none/background-image:none on #id

        const sink = DOM.sink as RecordingDOMSink;
        // `btn` is chromeful and therefore isolated (see
        // plans/implemented/button-resting-chrome-state-isolation.md): both
        // the setChromeless(true) neutrals and the setChromeless(false)
        // removals below land on `#id:not(.pressed):not(:hover)` (Button's
        // `ownStyleStates` declares both `.pressed` and `:hover`), not the
        // bare `#id`.
        const declarations = declarationsDuring(sink, idSelector(btn) + ':not(.pressed):not(:hover)', () => btn.setChromeless(false));

        // A removal (explicit null), not `undefined` — `undefined` would mean
        // the write was skipped, leaving the chromeless "none" pin stale.
        expect(declarations.boxShadow).toBeNull();
        expect(declarations.backgroundImage).toBeNull();
    });
});
