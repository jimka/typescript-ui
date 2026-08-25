// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

// Coverage for plans/implemented/button-resting-chrome-state-isolation.md —
// Expected Behaviour rows 1-11 (rows 12-15 are cascade outcomes the
// recording sink cannot evaluate; see the plan's `## Verification` section
// for the mandatory browser check). A deviating resting `background-color` /
// `background-image` / `box-shadow` / `background` now lands on a Button's
// own `#id:not(.pressed):not(:hover)` rule instead of the bare `#id` rule, so the shared
// `.ClassName.pressed` rule (widened by this plan to all four properties) is
// unopposed while the button is pressed.
//
// `idSelector` / `declarationsDuring` are copied from
// `Button.pressedHoverClassHoisting.test.ts`, which itself copied them from
// `ClassStyleRules.test.ts`; this file also reuses that file's warm-up
// convention for the process-global `.Button.pressed` rule.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Button } from '~/component/button/Button';
import { MenuBarButton } from '~/component/menubar/MenuBarButton';
import { SpinButton } from '~/component/input/SpinButton';
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

/** Sink writes recorded while `fn()` ran. */
function writesDuring(recorder: RecordingDOMSink, fn: () => void): RecordingDOMSink['writes'] {
    const start = recorder.writes.length;
    fn();

    return recorder.writes.slice(start);
}

/**
 * Flattens the `setRuleStyles` writes for `selector` out of a captured
 * writes array. Rows 4/6/7/8 need to inspect more than one selector from a
 * single setter/render call — a setter's idempotency guard means it can't be
 * called twice with the same value to capture each selector separately.
 */
function declarationsIn(writes: RecordingDOMSink['writes'], selector: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const w of writes) {
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
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassStyleRules.test.ts`.
 */
function declarationsDuring(
    recorder: RecordingDOMSink,
    selector: string,
    fn: () => void,
): Record<string, string | null> {
    return declarationsIn(writesDuring(recorder, fn), selector);
}

describe('Button resting-chrome state isolation', () => {
    it('row 1: a default Button renders — no write to #id:not(.pressed):not(:hover), and the rule is never inserted', () => {
        const btn = new Button('Save');
        const declarations = declarationsDuring(sink, idSelector(btn) + ':not(.pressed):not(:hover)', () => btn.getElement(true));

        expect(declarations).toEqual({});
        expect(_ruleCacheHas(idSelector(btn) + ':not(.pressed):not(:hover)')).toBe(false);
    });

    it('row 2: a default Button renders after a first Button has warmed the class rule — no #id.pressed rule is inserted at all, and .Button.pressed is in the rule cache', () => {
        new Button('Warmup').getElement(true);

        const second = new Button('Second');
        second.getElement(true);

        expect(_ruleCacheHas(idSelector(second) + '.pressed')).toBe(false);
        expect(_ruleCacheHas('.Button.pressed')).toBe(true);
    });

    it('row 3: a deviating resting backgroundColor lands on #id:not(.pressed):not(:hover), not the bare #id rule', () => {
        new Button('Warmup').getElement(true);

        const a = new Button('x', { backgroundColor: 'red' });
        const isolated = declarationsDuring(sink, idSelector(a) + ':not(.pressed):not(:hover)', () => a.getElement(true));
        expect(isolated.backgroundColor).toBe('red');

        const b = new Button('y', { backgroundColor: 'red' });
        const bare = declarationsDuring(sink, idSelector(b), () => b.getElement(true));
        expect(bare.backgroundColor).toBeUndefined();
    });

    it('row 4: setBackgroundColor after render on a chromeful Button writes immediately to #id:not(.pressed):not(:hover), not the bare #id rule', () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('x');
        btn.getElement(true);

        const writes = writesDuring(sink, () => btn.setBackgroundColor('red'));

        expect(declarationsIn(writes, idSelector(btn) + ':not(.pressed):not(:hover)').backgroundColor).toBe('red');
        expect(declarationsIn(writes, idSelector(btn)).backgroundColor).toBeUndefined();
    });

    it('row 5: setBackgroundColor back to the class-default token writes a removal on #id:not(.pressed):not(:hover), not a skipped write', () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('x');
        btn.getElement(true);
        btn.setBackgroundColor('red'); // establish a real deviation to isolate first

        // The literal token `Button.ts`'s BUTTON_RESTING_BACKGROUND resolves to.
        const declarations = declarationsDuring(
            sink,
            idSelector(btn) + ':not(.pressed):not(:hover)',
            () => btn.setBackgroundColor('var(--ts-ui-button-bg, transparent)'),
        );

        expect(declarations.backgroundColor).toBeNull();
    });

    it('row 6: setBackground after render on a chromeful Button writes to #id:not(.pressed):not(:hover), not the bare #id rule', () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('x');
        btn.getElement(true);

        const writes = writesDuring(sink, () => btn.setBackground('red'));

        expect(declarationsIn(writes, idSelector(btn) + ':not(.pressed):not(:hover)').background).toBe('red');
        expect(declarationsIn(writes, idSelector(btn)).background).toBeUndefined();
    });

    it('row 7: an instance-level chromeless Button pins all four .pressed keys and keeps its resting backgroundColor on the bare #id rule; #id:not(.pressed):not(:hover) is never inserted', () => {
        new Button('Warmup').getElement(true); // materialises .Button.pressed with all four keys

        const btn = new Button({ chromeless: true });
        const writes = writesDuring(sink, () => btn.getElement(true));

        expect(declarationsIn(writes, idSelector(btn)).backgroundColor).toBeDefined();

        const pressed = declarationsIn(writes, idSelector(btn) + '.pressed');
        expect(pressed.color).toBeDefined();
        expect(pressed.backgroundColor).toBeDefined();
        expect(pressed.backgroundImage).toBeDefined();
        expect(pressed.boxShadow).toBeDefined();

        expect(_ruleCacheHas(idSelector(btn) + ':not(.pressed):not(:hover)')).toBe(false);
    });

    it("row 8: an instance-level chromeless Button with a caller backgroundColor writes it to the bare #id rule — the chromeless branch clears what the earlier setBackgroundColor dispatch queued on #id:not(.pressed):not(:hover)", () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('x', { backgroundColor: 'red', chromeless: true });
        const declarations = declarationsDuring(sink, idSelector(btn), () => btn.getElement(true));

        expect(declarations.backgroundColor).toBe('red');
        expect(_ruleCacheHas(idSelector(btn) + ':not(.pressed):not(:hover)')).toBe(false);
    });

    it('row 9: a chromeless-by-default MenuBarButton is not isolated — a deviating resting backgroundColor lands on the bare #id rule, and no .MenuBarButton.pressed rule is ever inserted', () => {
        const btn = new MenuBarButton('File', () => {}, () => {});
        btn.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(btn), () => btn.setActive(true));
        expect(declarations.backgroundColor).toBeDefined();

        expect(_ruleCacheHas('.MenuBarButton.pressed')).toBe(false);
        expect(_ruleCacheHas(idSelector(btn) + ':not(.pressed):not(:hover)')).toBe(false);
    });

    it("row 10: SpinButton's constructor-time clearPressedShadow() dedupes against the shared .SpinButton.pressed class rule, writing no boxShadow to #id.pressed", () => {
        const spin = new SpinButton('▲');
        const declarations = declarationsDuring(sink, idSelector(spin) + '.pressed', () => spin.getElement(true));

        expect(declarations.boxShadow).toBeUndefined();
    });

    it('row 11: setFlat(true) writes no per-instance pressed declarations for the flat-affected keys — flat chrome lives on a shared .Button.flat.pressed rule instead, and the element carries the flat class; setFlat(false) drops the class but the rule stays cached', () => {
        new Button('Warmup').getElement(true); // materialises .Button.pressed with all four keys

        const btn = new Button('X');
        const handle = btn.getElement(true);

        // The construction-time pressed/hover dispatch already deduped these
        // against `.Button.pressed`'s class bag before flat ran — flat's own
        // mechanism (`ensureSharedStateRule`) never writes to this instance's
        // own `#id.pressed` rule at all, so nothing shows up here.
        const trueWrites = writesDuring(sink, () => btn.setFlat(true));
        const pressed = declarationsIn(trueWrites, idSelector(btn) + '.pressed');
        expect(pressed.color).toBeUndefined();
        expect(pressed.backgroundColor).toBeUndefined();
        expect(pressed.backgroundImage).toBeUndefined();
        expect(pressed.boxShadow).toBeUndefined();

        expect(_ruleCacheHas('.Button.flat.pressed')).toBe(true);

        const flatAdded = trueWrites.some((w) => w.op === 'apply' && w.args[0] === handle
            && (w.args[1] as { addClass?: string[] }).addClass?.includes('flat'));
        expect(flatAdded).toBe(true);

        // Rules are never removed, only the DOM token is.
        const falseWrites = writesDuring(sink, () => btn.setFlat(false));
        expect(_ruleCacheHas('.Button.flat.pressed')).toBe(true);

        const flatRemoved = falseWrites.some((w) => w.op === 'apply' && w.args[0] === handle
            && (w.args[1] as { removeClass?: string[] }).removeClass?.includes('flat'));
        expect(flatRemoved).toBe(true);
    });

    it('a runtime setPressedBackgroundColor call on an already-rendered, previously-default Button reaches the stylesheet, not just the dirty queue', () => {
        // A fully default Button's own `#id.pressed` rule stays unmaterialised
        // past first render (row 2) — every pressed setter it dispatches at
        // construction matches the (now four-key) class bag and is skipped.
        // A later runtime pressed setter is therefore the *first* real write
        // this instance's pressedStyleRule ever sees, and must still reach
        // the stylesheet rather than sit queued on an unmaterialised rule.
        new Button('Warmup').getElement(true);

        const btn = new Button('X');
        btn.getElement(true);

        const declarations = declarationsDuring(sink, idSelector(btn) + '.pressed', () => btn.setPressedBackgroundColor('purple'));

        expect(declarations.backgroundColor).toBe('purple');
    });

    it('row 12: clearBackgroundImage on a rendered, chromeful Button asserts "none" on #id:not(.pressed):not(:hover), never the bare #id rule (plans/button-flat-chrome-dedup.md)', () => {
        new Button('Warmup').getElement(true);

        const btn = new Button('x');
        btn.getElement(true);
        btn.setBackgroundImage('red'); // establish a real deviation to isolate first

        const writes = writesDuring(sink, () => btn.clearBackgroundImage());

        expect(declarationsIn(writes, idSelector(btn) + ':not(.pressed):not(:hover)').backgroundImage).toBe('none');
        expect(declarationsIn(writes, idSelector(btn)).backgroundImage).toBeUndefined();
    });
});
