// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/numberspinner-spinbutton-dedup.md: the
// per-instance `setBorder({ borderTop: ... })` calls NumberSpinner used to
// make on its up/down SpinButtons are replaced by two dedicated subclasses
// (SpinButtonUp / SpinButtonDown), each carrying its border as a class-tier
// default. Rows 1-4 of the plan's Expected Behaviour, mirroring the
// `declarationsDuring`/`_ruleCacheHas` shape already established in
// tests/component/input/SpinButton.test.ts and
// tests/component/button/Button.pressedHoverClassHoisting.test.ts.
//
// Same module-state caveat as those files: `.SpinButtonUp`/`.SpinButtonDown`
// are process-module state (fresh per test *file*, not per test), and
// materialise the first time any NumberSpinner in this file renders — a
// single `new NumberSpinner()` constructs and renders both buttons together,
// so the very first test below captures both class rules' full bodies in one
// pass; every later test relies on them already being cached.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NumberSpinner } from '~/component/input/NumberSpinner';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

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
 * Declarations written to each of `selectors` while `fn()` ran, one flattened
 * key/value map per selector. A single-pass variant of the `declarationsDuring`
 * helper established in `ClassStyleRules.test.ts`/`SpinButton.test.ts` — needed
 * here because `.SpinButtonUp` and `.SpinButtonDown` both materialise from the
 * same `fn()` call (one `NumberSpinner` builds both buttons), so capturing them
 * with two separate `declarationsDuring` calls would re-run `fn()` twice.
 */
function declarationsDuringForSelectors(
    recorder: RecordingDOMSink,
    selectors: string[],
    fn: () => void,
): Record<string, Record<string, string | null>> {
    const start = recorder.writes.length;
    fn();

    const out: Record<string, Record<string, string | null>> = {};
    for (const selector of selectors) {
        out[selector] = {};
    }

    for (const w of recorder.writes.slice(start)) {
        if (w.op !== 'setRuleStyles' || !selectors.includes(w.args[0] as string)) {
            continue;
        }

        const selector = w.args[0] as string;
        const styles   = w.args[1] as Record<string, string | null>;
        for (const key of Object.keys(styles)) {
            out[selector][key] = styles[key];
        }
    }

    return out;
}

describe('NumberSpinner spin-button class-style hoisting', () => {
    it('the first NumberSpinner materialises .SpinButton, .SpinButtonUp, and .SpinButtonDown with the full four-longhand border expansion between them', () => {
        // `.SpinButtonUp`/`.SpinButtonDown` only differ from their `.SpinButton`
        // parent on `borderTop` — the hierarchy-aware class tier
        // (`ClassStyleRules.ts`'s `deviationsFrom`) omits `borderRight`/
        // `borderBottom`/`borderLeft` from each subclass's own rule because
        // they're identical to `.SpinButton`'s already-published "none", and
        // relies on ordinary CSS inheritance from that rule instead — so the
        // full four-longhand expansion this plan's Potential Challenges calls
        // out is only visible by reading `.SpinButton`'s rule (right/bottom/
        // left) together with each subclass's own rule (top).
        const declarations = declarationsDuringForSelectors(
            sink,
            ['.SpinButton', '.SpinButtonUp', '.SpinButtonDown'],
            () => { new NumberSpinner().getElement(true); },
        );

        expect(declarations['.SpinButton'].borderTop).toBe('none');
        expect(declarations['.SpinButton'].borderRight).toBe('none');
        expect(declarations['.SpinButton'].borderBottom).toBe('none');
        expect(declarations['.SpinButton'].borderLeft).toBe('none');

        expect(declarations['.SpinButtonUp'].borderTop).toBe('1px solid transparent');
        expect(declarations['.SpinButtonUp'].borderRight).toBeUndefined();
        expect(declarations['.SpinButtonUp'].borderBottom).toBeUndefined();
        expect(declarations['.SpinButtonUp'].borderLeft).toBeUndefined();

        expect(declarations['.SpinButtonDown'].borderTop).toBe('1px solid var(--ts-ui-spinner-divider, rgb(180, 180, 180))');
        expect(declarations['.SpinButtonDown'].borderRight).toBeUndefined();
        expect(declarations['.SpinButtonDown'].borderBottom).toBeUndefined();
        expect(declarations['.SpinButtonDown'].borderLeft).toBeUndefined();

        expect(_ruleCacheHas('.SpinButtonUp')).toBe(true);
        expect(_ruleCacheHas('.SpinButtonDown')).toBe(true);
    });

    it("a second NumberSpinner's up and down buttons write no real border-longhand declarations to their own #id rules", () => {
        new NumberSpinner().getElement(true);

        const second = new NumberSpinner() as any;
        const declarations = declarationsDuringForSelectors(
            sink,
            [idSelector(second._upBtn), idSelector(second._downBtn)],
            () => second.getElement(true),
        );

        // Both buttons dispatch `border` through the construction-time
        // options cascade (it's always-dispatched from `_defaultOptions`, per
        // `Component.applyChromeOptions`), so — unlike a property with no
        // class default at all — the instance's own rule still gets an
        // explicit `null` per longhand at flush time (a no-op removal, not an
        // omitted key): `Component.flushStyleBag()` queues `null` whenever the
        // instance's declared value matches the class-tier resolved value.
        // Either way, no *real* (non-null) declaration reaches the instance's
        // own rule.
        for (const selector of [idSelector(second._upBtn), idSelector(second._downBtn)]) {
            for (const key of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']) {
                expect(declarations[selector][key] ?? null).toBeNull();
            }
        }
    });

    it('neither .SpinButtonUp nor .SpinButtonDown gets its own .pressed/:hover class rule — both resolve through .Button', () => {
        new NumberSpinner().getElement(true);

        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
        expect(_ruleCacheHas('.SpinButtonUp.pressed')).toBe(false);
        expect(_ruleCacheHas('.SpinButtonDown.pressed')).toBe(false);
        expect(_ruleCacheHas('.SpinButtonUp:hover:not(.pressed)')).toBe(false);
        expect(_ruleCacheHas('.SpinButtonDown:hover:not(.pressed)')).toBe(false);
    });
});
