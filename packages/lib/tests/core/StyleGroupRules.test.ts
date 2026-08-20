// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the `styleGroup` mechanism introduced by
// plans/implemented/shared-instance-style-groups.md — Expected Behaviour
// rows 1-7 (rows 8-9 are manual-verify, browser-only; see the plan's
// `## Verification` section).
//
// Same module-state caveat as `ClassStyleRules.test.ts`/`ClassStateRules.test.ts`:
// the `.ClassName--<group>` registry lives in `core/ClassStyleRules.ts`'s
// `_owners`/`_groupBags` maps, module state that survives `DOM.reset()`
// (though not a fresh test *file*) — so every locally-declared `Component`
// subclass below needs a name unique across the whole file.
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

beforeEach(() => installTestDOM(DOM_CONFIG));
afterEach(() => DOM.reset());

const BORDER_LONGHANDS = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const;

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

describe('Shared instance style groups', () => {
    it('row 1: two instances built with the same styleGroup share one class rule; the second writes nothing to #id', () => {
        class ProbeGroup1 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        const a = new ProbeGroup1({ backgroundColor: 'red', styleGroup: 'warning' });
        const classDeclarations = declarationsDuring(sink, '.ProbeGroup1--warning', () => a.getElement(true));
        expect(classDeclarations.backgroundColor).toBe('red');

        const b = new ProbeGroup1({ backgroundColor: 'red', styleGroup: 'warning' });
        const instanceDeclarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(instanceDeclarations.backgroundColor).toBeUndefined();
    });

    it('row 2: a third, genuinely deviating instance in the same group writes its own value to #id, leaving the group rule untouched', () => {
        class ProbeGroup2 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeGroup2({ backgroundColor: 'red', styleGroup: 'warning' }).getElement(true);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeGroup2--warning').length).toBe(1);

        const start = sink.writes.length;
        const c = new ProbeGroup2({ backgroundColor: 'blue', styleGroup: 'warning' });
        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));

        expect(declarations.backgroundColor).toBe('blue');
        // The group rule is created once, by the first member — a later
        // deviating member never re-inserts or rewrites it.
        expect(sink.writes.slice(start).some((w) => w.op === 'ensureStyleRule' && w.args[0] === '.ProbeGroup2--warning')).toBe(false);
    });

    it('row 3: a field only the second member sets was never part of the group bag, so it always writes to that member\'s own #id', () => {
        class ProbeGroup3 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        // Seeds the group: backgroundColor 'red', no border (Component's own default).
        new ProbeGroup3({ backgroundColor: 'red', styleGroup: 'g3' }).getElement(true);

        const b = new ProbeGroup3({ backgroundColor: 'red', styleGroup: 'g3', border: '1px solid black' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        // backgroundColor matches the group bag — written as an explicit
        // removal (not skipped) because border's genuine deviation, queued
        // in the same `applyStyle` pass, forces #id to materialise anyway —
        // the same batching semantic ClassChromeRules.test.ts's row 8 and
        // ClassStyleRules.test.ts's case 8 already document for the
        // framework/class tiers.
        expect(declarations.backgroundColor).toBeNull();
        // border was never in the group bag (the first member had none), so
        // it is written to #id regardless of whether another member agrees.
        for (const key of BORDER_LONGHANDS) {
            expect(declarations[key]).toBe('1px solid black');
        }
    });

    it('row 4: two different concrete classes using the identical styleGroup token get two independent rules', () => {
        class ProbeGroup4A extends Component {}
        class ProbeGroup4B extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        const a = new ProbeGroup4A({ backgroundColor: 'red', styleGroup: 'shared' });
        const aDeclarations = declarationsDuring(sink, '.ProbeGroup4A--shared', () => a.getElement(true));
        expect(aDeclarations.backgroundColor).toBe('red');

        const b = new ProbeGroup4B({ backgroundColor: 'blue', styleGroup: 'shared' });
        const bDeclarations = declarationsDuring(sink, '.ProbeGroup4B--shared', () => b.getElement(true));
        expect(bDeclarations.backgroundColor).toBe('blue');
    });

    it('row 5: an instance with no styleGroup set behaves exactly as before — no group class, no group-tier skip', () => {
        class ProbeGroup5 extends Component {}

        new ProbeGroup5({}).getElement(true);

        const sink  = DOM.sink as RecordingDOMSink;
        const start = sink.writes.length;
        const b     = new ProbeGroup5({ backgroundColor: 'red' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        const writes        = sink.writes.slice(start);
        const addClassOp    = writes.find((w) => w.op === 'apply' && Array.isArray((w.args[1] as { addClass?: string[] }).addClass));
        const addClassPatch = addClassOp?.args[1] as { addClass: string[] } | undefined;
        expect(addClassPatch?.addClass.some((c) => c.includes('--'))).toBe(false);

        // No group bag exists, so the framework/class tiers behave exactly
        // as before this plan: an explicit, class-undefaulted value writes
        // straight to #id.
        expect(declarations.backgroundColor).toBe('red');
    });

    it('row 6: a group selector colliding with an unrelated class name applies the same collision opt-out as the other tiers', () => {
        class ProbeGroup6Colliding extends Component {}
        Object.defineProperty(ProbeGroup6Colliding, 'name', { value: 'ProbeGroup6--taken' });

        class ProbeGroup6 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        // First claimant: an unrelated class whose own name literally equals
        // the selector name the group below would also try to claim.
        new ProbeGroup6Colliding({ backgroundColor: 'green' }).getElement(true);

        const b = new ProbeGroup6({ backgroundColor: 'red', styleGroup: 'taken' });
        const declarations = declarationsDuring(sink, idSelector(b), () => b.getElement(true));

        expect(declarations.backgroundColor).toBe('red');
    });

    it('row 7: a runtime setter matching the group value writes a removal, not a skip', () => {
        class ProbeGroup7 extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeGroup7({ backgroundColor: 'red', styleGroup: 'g7' }).getElement(true); // seeds the group

        const b = new ProbeGroup7({ backgroundColor: 'blue', styleGroup: 'g7' });
        b.getElement(true); // deviates, writes 'blue' to its own #id

        const declarations = declarationsDuring(sink, idSelector(b), () => b.setBackgroundColor('red'));
        expect(declarations.backgroundColor).toBeNull();
    });

    it('a styleGroup token containing whitespace still produces a single, valid DOM class token', () => {
        // A real browser's classList.add() throws on any token containing
        // ASCII whitespace, and CSS-escaping alone does not fix this — CSS.escape
        // backslash-prefixes a space rather than removing it, so an escaped
        // token can still contain a raw space character. This offline harness
        // never calls a real classList (RecordingDOMSink.addClass just
        // records the patch), so it cannot reproduce the crash directly, but
        // it can lock in the contract: the recorded class name must never
        // contain whitespace.
        class ProbeGroupWhitespace extends Component {}

        const sink = DOM.sink as RecordingDOMSink;
        const b = new ProbeGroupWhitespace({ backgroundColor: 'red', styleGroup: 'has space' });

        const start = sink.writes.length;
        b.getElement(true);

        const addClassOp = sink.writes.slice(start).find((w) =>
            w.op === 'apply' && Array.isArray((w.args[1] as { addClass?: string[] }).addClass));
        const addedClasses = (addClassOp?.args[1] as { addClass: string[] }).addClass;

        expect(addedClasses).toContain('ProbeGroupWhitespace--has-space');
        expect(addedClasses.some((c) => /\s/.test(c))).toBe(false);

        // The class-tier selector construction must agree on the same
        // whitespace-normalised suffix, or the shared rule would target a
        // selector the element's actual class never matches — observable via
        // a second instance skipping its own #id write for the matching value.
        const c = new ProbeGroupWhitespace({ backgroundColor: 'red', styleGroup: 'has space' });
        const cInstanceDeclarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));
        expect(cInstanceDeclarations.backgroundColor).toBeUndefined();
    });

    it('two raw styleGroup tokens that normalise to the same suffix are cached as one group, not two competing writes', () => {
        // The DOM class / CSS selector `ensureStyleGroupRule` produces are
        // both derived from the *normalised* suffix (whitespace collapsed to
        // "-"), so the cache must be keyed on that normalised form too — a
        // second, differently-spelled token ("brand-warning") that resolves
        // to the same selector as the first ("brand warning") must be
        // treated as the same group (compared against the first instance's
        // cached value), never silently re-materialise the shared rule with
        // its own value.
        class ProbeGroupNormalize extends Component {}

        const sink = DOM.sink as RecordingDOMSink;

        new ProbeGroupNormalize({ backgroundColor: 'red', styleGroup: 'brand warning' }).getElement(true);
        expect(ensureStyleRuleOpsFor(sink, '.ProbeGroupNormalize--brand-warning').length).toBe(1);

        const b     = new ProbeGroupNormalize({ backgroundColor: 'blue', styleGroup: 'brand-warning' });
        const start = sink.writes.length;
        b.getElement(true);
        const writes = sink.writes.slice(start);

        const sharedRuleWrite = writes.find((w) => w.op === 'setRuleStyles' && w.args[0] === '.ProbeGroupNormalize--brand-warning');
        const idWrite         = writes.find((w) => w.op === 'setRuleStyles' && w.args[0] === idSelector(b));

        // No write to the shared selector — it still carries the first
        // instance's red, not the second instance's blue.
        expect(sharedRuleWrite).toBeUndefined();
        expect(ensureStyleRuleOpsFor(sink, '.ProbeGroupNormalize--brand-warning').length).toBe(1);

        // The second instance's own value genuinely deviates from the
        // group's cached (red) bag, so it writes to its own #id instead.
        expect((idWrite?.args[1] as Record<string, string | null>)?.backgroundColor).toBe('blue');
    });
});
