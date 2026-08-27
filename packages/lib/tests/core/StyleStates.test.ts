// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Behavioural coverage for the meta-class (declared-state) layer introduced
// by plans/layered-style-bag.md, Stage 3 — Expected Behaviour rows 9-13.
// Stage 1's layer-stack primitive (rows 1-3) is covered by
// `StyleLayers.test.ts`; Stage 2's instance layer (rows 4-8) is covered by
// `InstanceStyleLayer.test.ts`.
//
// Rows 9 and 10 are generic-mechanism claims, so they use a locally-declared
// `Component` subclass (same convention as `InstanceStyleLayer.test.ts` and
// `RestingChromeIsolation.test.ts`) rather than `Button`: `Button`'s own
// `:hover` entry deliberately extracts an empty bag (hover chrome is never
// deduped onto Button's class tier — see the comment above
// `Button.ownStyleStates`), so a `Button`-based probe could never show a materialised
// `.Button:hover:not(.pressed)` *state* rule the way row 9 describes; a probe
// where both declared states carry real declarations demonstrates the
// mechanism row 9 is actually about. Rows 11-13 name `Button`/`ToggleButton`
// explicitly, so they exercise the real classes.
//
// Same module-state caveat as `ClassStyleRules.test.ts`: the `.ClassName`
// rule cache is process-module state (fresh per test *file*, not per test) —
// every locally-declared probe class below needs a name unique across this
// file, and `.Button`/`.ToggleButton`'s own rules are process-module state
// too, so the Button/ToggleButton-based tests below account for whatever an
// earlier test in this file already warmed up rather than assuming a cold
// cache.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, ComponentOptions } from '~/core/Component';
import { Button } from '~/component/button/Button';
import { ToggleButton } from '~/component/button/ToggleButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../dom/TestDOM';
import fontMetrics from '../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import type { StyleBag, StyleStateSpec } from '~/core/ClassStyleRules';

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
 * flattened into one key/value map. Copied from `InstanceStyleLayer.test.ts`.
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

/** True when `w` is an `addClass`/`removeClass` write touching `token` —
 *  `setStyleState` (core/Component.ts) toggles a state's DOM token via
 *  `addClass`/`removeClass`, not `toggleClass`. */
function touchesToken(w: RecordingDOMSink['writes'][number], token: string): boolean {
    if (w.op !== 'apply') {
        return false;
    }

    const patch = w.args[1] as { addClass?: readonly string[]; removeClass?: readonly string[] };
    return !!(patch.addClass?.includes(token) || patch.removeClass?.includes(token));
}

describe('Declared-state (meta-class) layers (Stage 3)', () => {
    it('row 9: two declared states with real declarations each get their own guarded class rule, and resting writes land on the fully-guarded #id rule', () => {
        class TwoStateProbeRow9 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.pressed', extract: (): StyleBag => ({ backgroundColor: 'red' }) },
                { selector: ':hover',   extract: (): StyleBag => ({ backgroundColor: 'blue' }) },
            ];
        }

        const probe = new TwoStateProbeRow9({});
        probe.getElement(true);

        expect(_ruleCacheHas('.TwoStateProbeRow9.pressed')).toBe(true);
        expect(_ruleCacheHas('.TwoStateProbeRow9:hover:not(.pressed)')).toBe(true);

        const declarations = declarationsDuring(
            sink,
            idSelector(probe) + ':not(.pressed):not(:hover)',
            () => probe.setBackgroundColor('green'),
        );
        expect(declarations.backgroundColor).toBe('green');
    });

    it('row 10: setStyleState toggles the DOM class token for a dot-prefixed state, and adds no token for a colon-prefixed one', () => {
        class TwoStateProbeRow10 extends Component {
            protected static readonly ownStyleStates: readonly StyleStateSpec[] = [
                { selector: '.selected', extract: (): StyleBag => ({}) },
                { selector: ':hover',    extract: (): StyleBag => ({}) },
            ];
        }

        const probe = new TwoStateProbeRow10({});
        probe.getElement(true);

        const start1 = sink.writes.length;
        probe.setStyleState('.selected', true);
        expect(sink.writes.slice(start1).some(w => touchesToken(w, 'selected'))).toBe(true);
        expect(probe.isStyleState('.selected')).toBe(true);

        const start2 = sink.writes.length;
        probe.setStyleState('.selected', false);
        expect(sink.writes.slice(start2).some(w => touchesToken(w, 'selected'))).toBe(true);
        expect(probe.isStyleState('.selected')).toBe(false);

        // A `:`-prefixed state carries no DOM class token at all — the
        // browser drives `:hover` itself — so no addClass/removeClass write
        // happens for it, even though `_activeStates` still records it.
        const start3 = sink.writes.length;
        probe.setStyleState(':hover', true);
        const classWrites = sink.writes.slice(start3).filter(w => w.op === 'apply' && (
            (w.args[1] as { addClass?: unknown }).addClass !== undefined ||
            (w.args[1] as { removeClass?: unknown }).removeClass !== undefined
        ));
        expect(classWrites).toHaveLength(0);
        expect(probe.isStyleState(':hover')).toBe(true);
    });

    it("row 11: a pressed Button's getBackgroundColor() resolves the pressed layer over a diverging resting value; getOutline() falls through unaffected", () => {
        const btn = new Button('X');
        btn.getElement(true);

        btn.setBackgroundColor('purple'); // a real, diverging resting value
        btn.setOutline('2px solid teal');

        expect(btn.getBackgroundColor()).toBe('purple');

        btn.setStyleState('.pressed', true);

        // `.pressed` declares backgroundColor (see `Button.ownStyleStates`),
        // so it wins over the diverging resting value while active.
        expect(btn.getBackgroundColor()).not.toBe('purple');
        expect(btn.getBackgroundColor()).toBe(btn.getPressedBackgroundColor());

        // `.pressed` declares no outline, so getOutline() is unaffected by
        // the active state and still resolves the instance/class value.
        expect(btn.getOutline()).toBe('2px solid teal');
    });

    it('row 12: a per-instance resting backgroundColor on a Button is isolated to #id:not(.pressed):not(:hover), never the bare #id rule, leaving the hover-guarded selector free to paint its own background', () => {
        const btn = new Button('Y');
        btn.getElement(true);

        const start = sink.writes.length;
        btn.setBackgroundColor('orange');
        const writes = sink.writes.slice(start).filter(w => w.op === 'setRuleStyles');

        const guarded = writes.find(w => w.args[0] === idSelector(btn) + ':not(.pressed):not(:hover)');
        expect((guarded?.args[1] as Record<string, string | null>)?.backgroundColor).toBe('orange');

        // The bare #id rule never receives this write — it would otherwise
        // outrank the class-tier `:hover:not(.pressed)` rule regardless of
        // guard, since a plain #id selector's specificity beats any class
        // selector combination.
        const bare = writes.find(w => w.args[0] === idSelector(btn));
        expect(bare).toBeUndefined();
    });

    it('row 13: a ToggleButton that is both selected and pressed resolves the .pressed layer, not .selected', () => {
        const toggle = new ToggleButton('Z');
        toggle.getElement(true);

        toggle.setStyleState('.selected', true);
        const selectedBg = toggle.getBackgroundColor();

        toggle.setStyleState('.pressed', true);

        // `.pressed` is declared before `.selected` in `ToggleButton.ownStyleStates`
        // (`[...Button.ownStyleStates, { selector: ".selected", … }]`), so
        // `styleLayers()` resolves it first — the first active entry wins,
        // switching the resolved background away from `.selected`'s value.
        expect(toggle.getBackgroundColor()).toBe(toggle.getPressedBackgroundColor());
        expect(toggle.getBackgroundColor()).not.toBe(selectedBg);
    });
});

// Component `setVisible`/`isVisible` state-tier dedup — plan
// component-setvisible-state-tier-dedup.md's Expected Behaviour rows 3, 4, 7.
// Rows 1, 2, 5, 6, 8 live in `tests/component/EffectiveVisibility.test.ts`
// instead, alongside that file's existing `isVisible`/effective-visibility
// coverage.
describe('Component.setVisible routes through the shared .invisible class-tier rule', () => {
    it('row 3: hiding a rendered, initially-visible Component adds the invisible class and writes no visibility declaration to its own #id rule', () => {
        const c = new Component({});
        const element = c.getElement(true)!;

        const start = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(c), () => c.setVisible(false));
        expect(declarations.visibility).toBeUndefined();

        const gainedInvisibleClass = sink.writes.slice(start).some(w =>
            w.op === 'apply' && w.args[0] === element && touchesToken(w, 'invisible')
        );
        expect(gainedInvisibleClass).toBe(true);
    });

    it('row 4: two separate Component instances hidden at once share one class-tier rule and carry no per-instance visibility declaration', () => {
        const first = new Component({});
        const second = new Component({});
        first.getElement(true);
        second.getElement(true);

        const firstDeclarations  = declarationsDuring(sink, idSelector(first),  () => first.setVisible(false));
        const secondDeclarations = declarationsDuring(sink, idSelector(second), () => second.setVisible(false));

        expect(firstDeclarations.visibility).toBeUndefined();
        expect(secondDeclarations.visibility).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')).toBe(true);
    });

    it('row 7: a Button (which declares its own ownStyleStates without restating .invisible) still reports isVisible() false and stays visually hidden', () => {
        const btn = new Button('x', { visible: false });

        // `_activeStates` is read directly by `isVisible()`, not through
        // `resolveStyleStates(Button)` — which does not carry `.invisible`,
        // since `Button` declares its own whole-list `ownStyleStates` that
        // doesn't restate it (see the plan's Architecture Decisions).
        expect(btn.isVisible()).toBe(false);

        const element = btn.getElement(true)!;
        const addClassOps = sink.writes.filter(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { addClass?: readonly string[] }).addClass?.includes('invisible')
        );
        expect(addClassOps.length).toBeGreaterThan(0);

        // The shared `.ts-ui-component.invisible` rule matches on the
        // universal component token, not `Button`'s own class name, so it
        // still applies visually with no restatement.
        expect(_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')).toBe(true);
    });
});

// Component `setDisplayed`/`isDisplayed` state-tier dedup — plan
// component-setdisplayed-state-tier-dedup.md's Expected Behaviour rows 1, 2,
// 6, 7, 8. Rows 3, 4, 5 (which need no `declarationsDuring`/`_ruleCacheHas`
// helpers) live in `tests/component/EffectiveVisibility.test.ts` instead,
// alongside that file's existing `isDisplayed`/effective-visibility coverage.
describe('Component.setDisplayed routes through the shared .undisplayed class-tier rule', () => {
    it('row 1: hiding a rendered, initially-displayed Component adds the undisplayed class and writes no display declaration to its own #id rule', () => {
        const c = new Component({});
        const element = c.getElement(true)!;

        const start = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(c), () => c.setDisplayed(false));
        expect(declarations.display).toBeUndefined();

        const gainedUndisplayedClass = sink.writes.slice(start).some(w =>
            w.op === 'apply' && w.args[0] === element && touchesToken(w, 'undisplayed')
        );
        expect(gainedUndisplayedClass).toBe(true);
    });

    it('row 2: two separate Component instances hidden at once share one class-tier rule and carry no per-instance display declaration', () => {
        const first = new Component({});
        const second = new Component({});
        first.getElement(true);
        second.getElement(true);

        const firstDeclarations  = declarationsDuring(sink, idSelector(first),  () => first.setDisplayed(false));
        const secondDeclarations = declarationsDuring(sink, idSelector(second), () => second.setDisplayed(false));

        expect(firstDeclarations.display).toBeUndefined();
        expect(secondDeclarations.display).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.undisplayed')).toBe(true);
    });

    it('a plain Component that never calls setDisplayed queues no display declaration on its own #id rule across a first render', () => {
        const c = new Component({});

        const declarations = declarationsDuring(sink, idSelector(c), () => c.getElement(true));
        expect(declarations.display).toBeUndefined();
    });

    it('row 6: a Button (which declares its own ownStyleStates without restating .undisplayed) still reports isDisplayed() false and stays hidden at the CSS level', () => {
        const btn = new Button('x', { displayed: false });

        // `_activeStates` is read directly by `isDisplayed()`, not through
        // `resolveStyleStates(Button)` — which does not carry `.undisplayed`,
        // since `Button` declares its own whole-list `ownStyleStates` that
        // doesn't restate it (see the plan's Architecture Decisions).
        expect(btn.isDisplayed()).toBe(false);

        const element = btn.getElement(true)!;
        const addClassOps = sink.writes.filter(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { addClass?: readonly string[] }).addClass?.includes('undisplayed')
        );
        expect(addClassOps.length).toBeGreaterThan(0);

        // The shared `.ts-ui-component.undisplayed` rule matches on the
        // universal component token, not `Button`'s own class name, so it
        // still applies visually with no restatement.
        expect(_ruleCacheHas('.ts-ui-component.undisplayed')).toBe(true);
    });

    it('row 7: a component that is both undisplayed and invisible resolves display: none, not visibility: hidden, pinning the declaration order', () => {
        const c = new Component({});
        const element = c.getElement(true)!;

        c.setDisplayed(false);
        c.setVisible(false);

        expect(c.isDisplayed()).toBe(false);
        expect(c.isVisible()).toBe(false);

        const undisplayedOn = sink.writes.some(w =>
            w.op === 'apply' && w.args[0] === element && touchesToken(w, 'undisplayed')
        );
        const invisibleOn = sink.writes.some(w =>
            w.op === 'apply' && w.args[0] === element && touchesToken(w, 'invisible')
        );
        expect(undisplayedOn).toBe(true);
        expect(invisibleOn).toBe(true);

        // `.undisplayed` is declared first, so `guardedSuffixFor` makes the
        // shared invisible rule guard against it — pinning the declaration
        // order from the plan's Architecture Decisions.
        expect(_ruleCacheHas('.ts-ui-component.undisplayed')).toBe(true);
        expect(_ruleCacheHas('.ts-ui-component.invisible:not(.undisplayed)')).toBe(true);
    });

    it('row 8: showing an undisplayed-and-invisible component again removes the undisplayed token and lets the invisible rule start matching once more', () => {
        const c = new Component({});
        const element = c.getElement(true)!;

        c.setDisplayed(false);
        c.setVisible(false);

        c.setDisplayed(true);

        expect(c.isDisplayed()).toBe(true);
        expect(c.isVisible()).toBe(false);

        const removedUndisplayed = sink.writes.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('undisplayed')
        );
        expect(removedUndisplayed).toBe(true);

        // `invisible` is never removed across the whole sequence — it was
        // added once by `setVisible(false)` and `setDisplayed(true)` has no
        // reason to touch it, so the `invisible` rule starts matching again
        // with no extra write.
        const removedInvisible = sink.writes.some(w =>
            w.op === 'apply' && w.args[0] === element
            && (w.args[1] as { removeClass?: readonly string[] }).removeClass?.includes('invisible')
        );
        expect(removedInvisible).toBe(false);
    });
});
