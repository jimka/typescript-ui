// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for root cause 2 (flat pressed/hover) and root cause 4 (ToggleButton
// flat-selected) in plans/implemented/button-meta-class-dedup.md. Flat's
// pressed/hover colors never vary per instance, so — unlike `.pressed`/`:hover`,
// which dedupe onto a *per-concrete-class* shared rule via `ownStyleStates` —
// flat chrome is published once via `ensureSharedStateRule` onto a second,
// always-chained `.flat` DOM class token, keyed per (ctor, suffix) the same
// way `Cell`/`TreeRow`'s `.focused` rule is. `.flat`'s extra chained class
// gives `.Button.flat.pressed` strictly higher specificity than `.Button.pressed`
// (`(0,3,0)` vs `(0,2,0)`), so it always wins regardless of which rule was
// inserted first — see the plan's `[^specificity-not-order]` note.
//
// Same module-state caveat as the sibling hoisting test files in this
// directory: the shared class rules are process-module state, fresh per test
// *file*, not per test — every test below either warms up explicitly or
// relies on being the first Button/ToggleButton use of its kind in the file.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { ToggleButton } from '~/component/button/ToggleButton';
import { TabButton } from '~/component/button/TabButton';
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
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from the sibling hoisting test files.
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

describe('Button flat state-class hoisting', () => {
    // Resting-tier coverage added by plans/button-flat-chrome-dedup.md — the
    // resting twin of row 6-8/10/12 below. Flat's resting chrome (border,
    // shadow, background) is now published once via `ensureSharedStateRule`
    // onto a shared `.ClassName.flat` rule, mirroring the pressed/hover
    // mechanism this file already covers. Placed first in the describe block
    // (ahead of every other test that constructs a flat Button) so it is the
    // first-ever flat Button in the module and observes .Button.flat's
    // one-time materialisation — see the file's own module-state caveat above.
    it('row 4: a default flat Button writes border/backgroundColor/backgroundImage/boxShadow onto .Button.flat (no borderRadius), and no per-instance resting declaration of its own', () => {
        new Button('Warmup').getElement(true); // materialises .Button.pressed/:hover, unrelated to .flat

        // The shared `.flat` class rule is a module-level `StyleRule`, published
        // (and materialised — its constructor `ensure()`s by default) the moment
        // `_applyFlatChrome` first runs, i.e. at construction — not deferred to
        // this instance's own render like the per-instance dedup writes below.
        let first!: Button;
        const classDeclarations = declarationsDuring(sink, '.Button.flat', () => { first = new Button('FlatFirst', { flat: true }); });
        first.getElement(true);

        expect(classDeclarations.borderTop).toBe('1px solid transparent');
        expect(classDeclarations.borderRight).toBe('1px solid transparent');
        expect(classDeclarations.borderBottom).toBe('1px solid transparent');
        expect(classDeclarations.borderLeft).toBe('1px solid transparent');
        expect(classDeclarations.backgroundColor).toBe('transparent');
        expect(classDeclarations.backgroundImage).toBe('none');
        expect(classDeclarations.boxShadow).toBe('none');
        expect(classDeclarations.borderRadius).toBeUndefined();

        expect(_ruleCacheHas('.Button.flat')).toBe(true);

        // No per-instance write of its own — the resting rule dedupes exactly
        // like the pressed/hover rule does.
        const instanceDeclarations = declarationsDuring(sink, idSelector(first) + ':not(.pressed):not(:hover)', () => { /* already rendered above */ });
        expect(instanceDeclarations).toEqual({});
    });

    it('row 5: a second flat Button writes nothing further to .Button.flat', () => {
        new Button('Warmup').getElement(true);
        new Button('FlatFirst', { flat: true }).getElement(true); // materialises .Button.flat

        const flatClassWrites = declarationsDuring(sink, '.Button.flat', () => {
            new Button('FlatSecond', { flat: true }).getElement(true);
        });
        expect(flatClassWrites).toEqual({});
    });

    it('row 6: getBorder()/getBorderRadius()/getShadow()/getBackgroundImage()/getBackgroundColor() on a flat Button report the non-flat class default', () => {
        const flat = new Button('Flat', { flat: true });

        expect(flat.getBorder()).toEqual({ border: '2px ridge var(--ts-ui-button-border, rgb(200, 200, 200))' });
        expect(flat.getBorderRadius()).toBe('var(--ts-ui-border-radius, 4px)');
        expect(flat.getShadow()).toBe('var(--ts-ui-button-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2))');
        expect(flat.getBackgroundImage()).toBe('var(--ts-ui-button-bg, linear-gradient(rgb(241, 241, 241), rgb(200, 200, 200)))');
        expect(flat.getBackgroundColor()).toBe('var(--ts-ui-button-bg, transparent)');
    });

    it('row 7: setBorder/setBackgroundColor explicitly on an already-flat Button still write a real per-instance deviation', () => {
        new Button('Warmup').getElement(true);

        const flat = new Button('Flat', { flat: true });
        flat.getElement(true);

        // `border` is not part of Button's own `ownStyleStates` extracts (see
        // the plan's "Accepted consequence" note), so it is not a
        // resting-isolation key — the write lands on the bare #id rule, same
        // as every other Button, flat or not.
        const borderDecl = declarationsDuring(sink, idSelector(flat), () => flat.setBorder('3px dashed green'));
        expect(borderDecl.borderTop).toBe('3px dashed green');

        // `backgroundColor` IS a resting-isolation key (both `.pressed` and
        // `:hover` declare it), so it is guarded.
        const bgDecl = declarationsDuring(sink, idSelector(flat) + ':not(.pressed):not(:hover)', () => flat.setBackgroundColor('blue'));
        expect(bgDecl.backgroundColor).toBe('blue');
    });

    it('row 8: a flat ToggleButton and a flat TabButton each get their own separate .ToggleButton.flat / .TabButton.flat rule', () => {
        new ToggleButton('Warmup').getElement(true);
        new TabButton('Warmup').getElement(true);

        new ToggleButton('FlatToggle', { flat: true }).getElement(true);
        new TabButton('FlatTab', { flat: true }).getElement(true);

        expect(_ruleCacheHas('.ToggleButton.flat')).toBe(true);
        expect(_ruleCacheHas('.TabButton.flat')).toBe(true);
    });

    it('row 6: two flat Buttons write no backgroundColor/backgroundImage/border/boxShadow declarations of their own to #id.pressed or #id:hover:not(.pressed) — flat chrome lives entirely on the shared .Button.flat.pressed / .Button.flat:hover:not(.pressed) rules', () => {
        new Button('Warmup').getElement(true); // materialises .Button.pressed / .Button:hover:not(.pressed)

        const first = new Button('FlatFirst', { flat: true });
        const firstPressed = declarationsDuring(sink, idSelector(first) + '.pressed', () => first.getElement(true));
        const firstHover   = declarationsDuring(sink, idSelector(first) + ':hover:not(.pressed)', () => { /* already rendered above */ });

        expect(firstPressed.backgroundColor).toBeUndefined();
        expect(firstPressed.backgroundImage).toBeUndefined();
        expect(firstPressed.boxShadow).toBeUndefined();
        expect(firstPressed.borderTop).toBeUndefined();
        expect(firstHover.backgroundColor).toBeUndefined();

        expect(_ruleCacheHas('.Button.flat.pressed')).toBe(true);
        expect(_ruleCacheHas('.Button.flat:hover:not(.pressed)')).toBe(true);

        // A second flat Button shares the same class rule — no further write
        // to it, mirroring the `.pressed`/`:hover` dedup pattern.
        const flatClassWrites = declarationsDuring(sink, '.Button.flat.pressed', () => {
            new Button('FlatSecond', { flat: true }).getElement(true);
        });
        expect(flatClassWrites).toEqual({});

        const second = new Button('FlatThird', { flat: true });
        const secondPressed = declarationsDuring(sink, idSelector(second) + '.pressed', () => second.getElement(true));
        expect(secondPressed.backgroundColor).toBeUndefined();
        expect(secondPressed.backgroundImage).toBeUndefined();
        expect(secondPressed.boxShadow).toBeUndefined();
        expect(secondPressed.borderTop).toBeUndefined();
    });

    it('row 7: a non-flat Button constructed after a flat one is unaffected — its own .pressed/:hover state still dedupes normally, and its rendered element carries no flat class', () => {
        new Button('Warmup').getElement(true);
        new Button('Flat', { flat: true }).getElement(true);

        const plain = new Button('Plain');
        const handle = plain.getElement(true);

        const pressed = declarationsDuring(sink, idSelector(plain) + '.pressed', () => { /* already rendered above */ });
        expect(pressed).toEqual({});

        const flatAdded = sink.writes.some((w) => w.op === 'apply' && w.args[0] === handle
            && (w.args[1] as { addClass?: string[] }).addClass?.includes('flat'));
        expect(flatAdded).toBe(false);
    });

    it("row 8: getPressedBackgroundColor()/getPressedShadow()/getHoverBackgroundColor() on a flat Button report the non-flat class default, and getPressedBorder()/getHoverBorder() report null — the flat token is no longer readable back from these getters", () => {
        const flat = new Button('Flat', { flat: true });

        expect(flat.getPressedBackgroundColor()).toBe('var(--ts-ui-button-pressed-bg, rgb(200, 200, 200))');
        expect(flat.getPressedShadow()).toBe('var(--ts-ui-button-pressed-shadow, 1px 2px 5px 0 rgba(0, 0, 0, 0.2) inset)');
        expect(flat.getHoverBackgroundColor()).toBe('var(--ts-ui-button-hover-bg, rgb(252, 252, 252))');
        expect(flat.getPressedBorder()).toBeNull();
        expect(flat.getHoverBorder()).toBeNull();
    });

    it('row 10: new Button({ flat: true }) still carries the flat class after first render — the render() catch-up replays the construction-time toggle', () => {
        const flat = new Button('Flat', { flat: true });

        const start  = sink.writes.length;
        const handle = flat.getElement(true);

        const flatAdded = sink.writes.slice(start).some((w) => w.op === 'apply' && w.args[0] === handle
            && (w.args[1] as { toggleClass?: Record<string, boolean> }).toggleClass?.flat === true);
        expect(flatAdded).toBe(true);
    });

    it('row 12: a flat, selected ToggleButton writes no backgroundColor/boxShadow of its own to #id.selected:not(.pressed):not(:hover) — the flat-selected chrome lives on the shared .ToggleButton.flat.selected:not(.pressed):not(:hover) rule', () => {
        new ToggleButton('Warmup', { selected: true }).getElement(true); // materialises .ToggleButton.selected:not(.pressed):not(:hover)

        const toggle = new ToggleButton('FlatSelected', { flat: true, selected: true });
        const selected = declarationsDuring(sink, idSelector(toggle) + '.selected:not(.pressed):not(:hover)', () => toggle.getElement(true));

        expect(selected.backgroundColor).toBeUndefined();
        expect(selected.boxShadow).toBeUndefined();

        expect(_ruleCacheHas('.ToggleButton.flat.selected:not(.pressed):not(:hover)')).toBe(true);
    });

    it('row 12: a flat, selected TabButton shares its own separate .TabButton.flat.selected rule, not .ToggleButton.flat.selected', () => {
        new TabButton('Warmup', { selected: true }).getElement(true);

        const tab = new TabButton('FlatSelected', { flat: true, selected: true });
        tab.getElement(true);

        expect(_ruleCacheHas('.TabButton.flat.selected:not(.pressed):not(:hover)')).toBe(true);
    });
});
