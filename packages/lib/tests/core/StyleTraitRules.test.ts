// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the cross-class trait tier introduced by
// plans/cross-class-style-groups.md — Expected Behaviour rows 1-11. Rows
// 12-13 are manual-verify, browser-only (see the plan's own `## Verification`).
//
// Row 4 (a real production class's rule shrinking once its border/
// borderRadius move onto the trait) is covered twice: `TextInputClassTier.
// test.ts` pins it for `TextInput`/`TextField`, and the "rows 4 and 6" case
// below pins it for the other three migrated consumers
// (`AbstractPickerField`, `ComboBox`, `FieldSet`), which no other test file
// exercises at the class-tier level.
//
// Same module-state caveat as `ClassStyleRules.test.ts`:
// the `_owners`/`_traitBags`/`_resolvedTraits`/`_traitStyleDefaults` maps in
// `core/ClassStyleRules.ts` are module state that survives `DOM.reset()`
// (though not a fresh test *file*) — so every locally-declared `Component`
// subclass and every locally-declared `StyleTrait` below needs a name
// unique across the whole file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '~/core/Component';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import {
    COMPONENT_CLASS,
    TRAIT_CLASS_PREFIX,
    type StyleBag,
    type StyleStateSpec,
    type StyleTrait,
} from '~/core/ClassStyleRules';
import { DateField } from '~/component/input/DateField';
import { ComboBox } from '~/component/input/ComboBox';
import { FieldSet } from '~/component/container/FieldSet';

const DOM_CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

/** Every write recorded while `fn()` ran. */
function writesDuring(sink: RecordingDOMSink, fn: () => void): RecordingDOMSink['writes'] {
    const start = sink.writes.length;
    fn();

    return sink.writes.slice(start);
}

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
    const out: Record<string, string | null> = {};
    for (const w of writesDuring(sink, fn)) {
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

/**
 * Same as {@link declarationsDuring}, but for several selectors captured
 * from one `fn()` run — needed when more than one selector's one-time
 * content write can land during the same call (e.g. three unrelated
 * classes' own class rules plus the shared trait rule they all reference).
 */
function declarationsDuringMulti(
    sink: RecordingDOMSink,
    selectors: readonly string[],
    fn: () => void,
): Record<string, Record<string, string | null>> {
    const out: Record<string, Record<string, string | null>> = {};
    for (const selector of selectors) {
        out[selector] = {};
    }

    for (const w of writesDuring(sink, fn)) {
        if (w.op !== 'setRuleStyles' || !selectors.includes(w.args[0] as string)) {
            continue;
        }

        const styles = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[w.args[0] as string][key] = styles[key];
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

/** The non-null (real) entries of a declarations map. */
function realDeclarations(declarations: Record<string, string | null>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(declarations)) {
        if (value !== null) {
            out[key] = value;
        }
    }

    return out;
}

/** Every DOM class token any `addClass` write in `writes` carries — `init()`'s
 *  one-shot call and a later, separate instance-trait toggle in `applyStyle`
 *  are two distinct `apply` ops, so this collects across all of them rather
 *  than assuming a single write. */
function addedClassesOf(writes: RecordingDOMSink['writes']): readonly string[] {
    const out: string[] = [];
    for (const w of writes) {
        if (w.op !== 'apply') continue;
        const addClass = (w.args[1] as { addClass?: string[] }).addClass;
        if (Array.isArray(addClass)) out.push(...addClass);
    }

    return out;
}

/** Every DOM class token any `removeClass` write in `writes` carries. */
function removedClassesOf(writes: RecordingDOMSink['writes']): readonly string[] {
    const out: string[] = [];
    for (const w of writes) {
        if (w.op !== 'apply') continue;
        const removeClass = (w.args[1] as { removeClass?: string[] }).removeClass;
        if (Array.isArray(removeClass)) out.push(...removeClass);
    }

    return out;
}

describe('Cross-class style traits', () => {
    it('row 1: rendering the first class-level opt-in inserts exactly one shared rule; a second unrelated class using the same trait writes nothing further', () => {
        const trait: StyleTrait = { name: 'row1-trait', declarations: { border: '1px solid red', borderRadius: '3px' } };

        class ProbeTraitRow1A extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }
        class ProbeTraitRow1B extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = `.${COMPONENT_CLASS}.${TRAIT_CLASS_PREFIX}row1-trait`;

        new ProbeTraitRow1A({}).getElement(true);
        expect(ensureStyleRuleOpsFor(sink, selector).length).toBe(1);

        const writes = writesDuring(sink, () => new ProbeTraitRow1B({}).getElement(true));
        expect(writes.some((w) => w.op === 'setRuleStyles' && w.args[0] === selector)).toBe(false);
        expect(ensureStyleRuleOpsFor(sink, selector).length).toBe(1);
    });

    it('row 2: the trait rule body is exactly its deviations — the border longhands and border-radius, nothing else', () => {
        const trait: StyleTrait = { name: 'row2-trait', declarations: { border: '1px solid red', borderRadius: '3px' } };

        class ProbeTraitRow2 extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = `.${COMPONENT_CLASS}.${TRAIT_CLASS_PREFIX}row2-trait`;
        const real     = realDeclarations(declarationsDuring(sink, selector, () => new ProbeTraitRow2({}).getElement(true)));

        expect(Object.keys(real).sort()).toEqual(['borderBottom', 'borderLeft', 'borderRadius', 'borderRight', 'borderTop']);
        expect(real.borderTop).toBe('1px solid red');
        expect(real.borderRadius).toBe('3px');
    });

    it('row 3: a rendered instance carries the trait token after its class chain and any group/state token', () => {
        const trait: StyleTrait = { name: 'row3-trait', declarations: { cursor: 'pointer' } };

        class ProbeTraitRow3 extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        const sink  = DOM.sink as RecordingDOMSink;
        const probe = new ProbeTraitRow3({});
        const added = addedClassesOf(writesDuring(sink, () => probe.getElement(true)));

        expect(added).toEqual([COMPONENT_CLASS, 'ProbeTraitRow3', `${TRAIT_CLASS_PREFIX}row3-trait`]);
    });

    it('row 5: an authored instance value that differs from an inherited class-level trait still writes a real declaration to #id', () => {
        const trait: StyleTrait = { name: 'row5-trait', declarations: { border: '1px solid red' } };

        class ProbeTraitRow5Base extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }
        class ProbeTraitRow5Sub extends ProbeTraitRow5Base {}

        const sink = DOM.sink as RecordingDOMSink;
        const sub  = new ProbeTraitRow5Sub({ border: 'none' });
        const declarations = declarationsDuring(sink, idSelector(sub), () => sub.getElement(true));

        expect(declarations.borderTop).toBe('none');
        expect(sub.getBorder()).toEqual({ border: 'none' });
    });

    it('row 6: a getter resolves a class-level trait value both before and after first render', () => {
        const trait: StyleTrait = { name: 'row6-trait', declarations: { borderRadius: '7px' } };

        class ProbeTraitRow6 extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        const probe = new ProbeTraitRow6({});
        expect(probe.getBorderRadius()).toBe('7px');

        probe.getElement(true);
        expect(probe.getBorderRadius()).toBe('7px');
    });

    it('row 7: applyChromeOptions dispatches a class-level trait border, so an unconnected instance still measures a border width', () => {
        const trait: StyleTrait = { name: 'row7-trait', declarations: { border: '1px solid red' } };

        class ProbeTraitRow7 extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        // Never rendered/connected — `getBorderSize()`'s pre-attach estimate
        // path parses the border spec string directly, so a non-zero result
        // here proves `setBorder` was actually dispatched (not merely painted
        // via CSS), matching the plan's own concern about a border that
        // "paints correctly but measures as zero".
        const probe = new ProbeTraitRow7({});
        expect(probe.getBorderSize()).toEqual({ top: 1, right: 1, bottom: 1, left: 1 });
    });

    it('row 9: instance-level opt-in shares one rule across two unrelated classes, and neither writes a per-instance declaration', () => {
        const trait: StyleTrait = { name: 'row9-trait', declarations: { cursor: 'pointer' } };

        class ProbeTraitRow9A extends Component {}
        class ProbeTraitRow9B extends Component {}

        const sink     = DOM.sink as RecordingDOMSink;
        const selector = `.${COMPONENT_CLASS}.${TRAIT_CLASS_PREFIX}row9-trait`;

        const a          = new ProbeTraitRow9A({ styleTrait: trait });
        const writesForA = writesDuring(sink, () => a.getElement(true));

        const classDeclarations = writesForA
            .filter((w) => w.op === 'setRuleStyles' && w.args[0] === selector)
            .reduce<Record<string, string | null>>((acc, w) => Object.assign(acc, w.args[1]), {});
        expect(realDeclarations(classDeclarations)).toEqual({ cursor: 'pointer' });

        const idDeclarations = writesForA
            .filter((w) => w.op === 'setRuleStyles' && w.args[0] === idSelector(a))
            .reduce<Record<string, string | null>>((acc, w) => Object.assign(acc, w.args[1]), {});
        expect(realDeclarations(idDeclarations).cursor).toBeUndefined();

        expect(addedClassesOf(writesForA)).toContain(`${TRAIT_CLASS_PREFIX}row9-trait`);

        const b          = new ProbeTraitRow9B({ styleTrait: trait });
        const writesForB = writesDuring(sink, () => b.getElement(true));
        expect(writesForB.some((w) => w.op === 'setRuleStyles' && w.args[0] === selector)).toBe(false);
        expect(addedClassesOf(writesForB)).toContain(`${TRAIT_CLASS_PREFIX}row9-trait`);

        expect(a.getCursor()).toBe('pointer');
        expect(b.getCursor()).toBe('pointer');
    });

    it('row 10: clearing an instance-level trait and re-rendering removes the token; the getter falls back', () => {
        const trait: StyleTrait = { name: 'row10-trait', declarations: { cursor: 'pointer' } };
        const token = `${TRAIT_CLASS_PREFIX}row10-trait`;

        class ProbeTraitRow10 extends Component {}

        const sink    = DOM.sink as RecordingDOMSink;
        const probe   = new ProbeTraitRow10({ styleTrait: trait });
        const element = probe.getElement(true)!;
        expect(probe.getCursor()).toBe('pointer');

        const writes = writesDuring(sink, () => {
            probe.setStyleTrait(null);
            probe.applyStyle(element);
        });

        expect(removedClassesOf(writes)).toContain(token);
        expect(probe.getCursor()).toBe('default');
    });

    it('row 11: a name collision between two distinct StyleTrait objects self-corrects; a top-priority-state collision throws', () => {
        const traitA = { name: 'row11-collide', declarations: { cursor: 'pointer' } };
        const traitB = { name: 'row11-collide', declarations: { cursor: 'grab' } };

        class ProbeTraitRow11A extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [traitA];
        }
        class ProbeTraitRow11B extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [traitB];
        }

        const sink  = DOM.sink as RecordingDOMSink;
        const token = `${TRAIT_CLASS_PREFIX}row11-collide`;

        new ProbeTraitRow11A({}).getElement(true);

        const b     = new ProbeTraitRow11B({});
        const added = addedClassesOf(writesDuring(sink, () => b.getElement(true)));
        expect(added).not.toContain(token);

        const stateTrait: StyleTrait = { name: 'row11-state-trait', declarations: { backgroundColor: 'red' } };

        class ProbeTraitRow11State extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [stateTrait];
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.pressed', extract: (): StyleBag => ({ backgroundColor: 'blue' }) },
            ];
        }

        expect(() => new ProbeTraitRow11State({}).getElement(true))
            .toThrow(/ProbeTraitRow11State.*row11-state-trait.*backgroundColor/);
    });

    it('two unrelated classes sharing one trait resolve the same declared value with no CSS involved (pre-render)', () => {
        const trait: StyleTrait = { name: 'shared-precheck-trait', declarations: { borderRadius: '9px' } };

        class ProbeTraitSharedA extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }
        class ProbeTraitSharedB extends Component {
            protected static readonly ownStyleTraits: readonly StyleTrait[] = [trait];
        }

        expect(new ProbeTraitSharedA({}).getBorderRadius()).toBe('9px');
        expect(new ProbeTraitSharedB({}).getBorderRadius()).toBe('9px');
    });

    it('rows 4 and 6: AbstractPickerField, ComboBox, and FieldSet all shed border/borderRadius onto the shared input-chrome trait rule', () => {
        const sink          = DOM.sink as RecordingDOMSink;
        const traitSelector = `.${COMPONENT_CLASS}.${TRAIT_CLASS_PREFIX}input-chrome`;

        // Row 6: getters resolve through the class-level trait before first render.
        expect(new DateField().getBorder()).toEqual({ border: 'var(--ts-ui-input-border)' });
        expect(new DateField().getBorderRadius()).toBe('var(--ts-ui-border-radius, 4px)');
        expect(new ComboBox().getBorder()).toEqual({ border: 'var(--ts-ui-input-border)' });
        expect(new ComboBox().getBorderRadius()).toBe('var(--ts-ui-border-radius, 4px)');
        expect(new FieldSet().getBorder()).toEqual({ border: 'var(--ts-ui-input-border)' });
        expect(new FieldSet().getBorderRadius()).toBe('var(--ts-ui-border-radius, 4px)');

        // Row 4: each class's own class-tier rule (first construction+render
        // of that class in this file) no longer carries border/borderRadius;
        // the shared trait rule (its own first-ever write in this file) does.
        const byS = declarationsDuringMulti(
            sink,
            ['.AbstractPickerField', '.ComboBox', '.FieldSet', traitSelector],
            () => {
                new DateField().getElement(true);
                new ComboBox().getElement(true);
                new FieldSet().getElement(true);
            },
        );

        for (const selector of ['.AbstractPickerField', '.ComboBox', '.FieldSet']) {
            expect(byS[selector].borderTop, selector).toBeUndefined();
            expect(byS[selector].borderRadius, selector).toBeUndefined();
        }

        expect(realDeclarations(byS[traitSelector]).borderTop).toBe('var(--ts-ui-input-border)');
        expect(realDeclarations(byS[traitSelector]).borderRadius).toBe('var(--ts-ui-border-radius, 4px)');

        // Row 6, continued: getters still resolve through the trait after render.
        expect(new DateField().getBorder()).toEqual({ border: 'var(--ts-ui-input-border)' });
        expect(new ComboBox().getBorderRadius()).toBe('var(--ts-ui-border-radius, 4px)');
    });

    it('row 8: AbstractPickerField restores its default border via the trait constant once the invalid state clears', () => {
        const field = new DateField() as any;

        field.setInvalid(true);
        expect(field.getBorder()).toEqual({ border: '1px solid var(--ts-ui-validation-error-border)' });

        field.setInvalid(false);
        expect(field.getBorder()).toEqual({ border: 'var(--ts-ui-input-border)' });
    });
});
