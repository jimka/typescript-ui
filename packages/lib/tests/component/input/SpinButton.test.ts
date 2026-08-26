//
// SpinButton tick-listener coverage. emit is protected and the
// non-DOM `tick` event routes through the framework ListenerBag (no event
// loop), so it can be exercised on a bare (unmounted) button via an `any` cast
// confined to this file. Hold-repeat setTimeout cadence is a Non-Goal.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpinButton } from '~/component/input/SpinButton';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ClassStyleRules.test.ts`.
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

describe('SpinButton tick listeners', () => {
    it('fires a registered tick listener on emit and stops after off', () => {
        const btn = new SpinButton('▲');

        let ticks = 0;
        const listener = (): void => {
            ticks += 1;
        };

        btn.on('tick', listener);
        // emit is protected; cast to drive the same fan-out the hold-repeat
        // schedule uses.
        (btn as any).emit('tick');
        expect(ticks).toBe(1);

        btn.off('tick', listener);
        (btn as any).emit('tick');
        expect(ticks).toBe(1);
    });
});

describe('SpinButton glyph-by-symbol sizing', () => {
    it('computes a stable half-height preferred size for both arrow symbols', () => {
        const up   = new SpinButton('▲');
        const down = new SpinButton('▼');

        const upSize   = up.getPreferredSize();
        const downSize = down.getPreferredSize();

        expect(upSize).not.toBe(null);
        expect(downSize).not.toBe(null);

        // updateSize fixes the width at 18 and derives a positive half-height
        // from the line box; both symbols share the same computed size.
        expect(upSize!.width).toBe(18);
        expect(upSize!.height).toBeGreaterThan(0);
        expect(downSize!.width).toBe(upSize!.width);
        expect(downSize!.height).toBe(upSize!.height);
    });
});

// Expected Behaviour row 11 of plans/implemented/button-family-hierarchy-cascade.md:
// a rendered SpinButton carries its full ancestor class chain, and
// `.SpinButton`'s own class rule carries only its deviating `border`, not
// repeating `Button`'s `backgroundColor`/`cursor`/`foregroundColor`/`shadow`.
describe('SpinButton class-hierarchy cascade', () => {
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

    // Runs first in this describe block: the `.SpinButton`/`.Button` class
    // rules are process-module state that survives `DOM.reset()` (though not
    // a fresh test *file*) — the capture window below only sees the
    // `setRuleStyles` write if this is the first SpinButton construction in
    // the file to trigger it. See `ClassStyleRules.test.ts`'s own module-state
    // caveat.
    it("its own .SpinButton class rule carries the deviating border, not Button's backgroundColor/cursor/foregroundColor/shadow", () => {
        const declarations = declarationsDuring(sink, '.SpinButton', () => {
            new SpinButton('▲').getElement(true);
        });

        expect(_ruleCacheHas('.Button')).toBe(true);
        expect(_ruleCacheHas('.SpinButton')).toBe(true);

        // SpinButton's own deviation (flush chrome — no border).
        expect(declarations.borderTop).toBe('none');
        // Not repeated — these stay on .Button's own rule, unchanged.
        expect(declarations.backgroundColor).toBeUndefined();
        expect(declarations.cursor).toBeUndefined();
        expect(declarations.color).toBeUndefined();
        expect(declarations.boxShadow).toBeUndefined();
    });

    it('a rendered element carries ts-ui-component, Button, and SpinButton', () => {
        const start  = sink.writes.length;
        const spin   = new SpinButton('▲');
        const handle = spin.getElement(true);

        // SpinButton builds child components of its own (a Text label, an
        // HBox row, ...), each also widening onto its own ts-ui-component
        // class — scope to this instance's own handle so a child's addClass
        // op isn't mistaken for the SpinButton's own.
        const addClassOps = sink.writes.slice(start).filter((w) => {
            if (w.op !== 'apply' || w.args[0] !== handle) {
                return false;
            }
            const patch = w.args[1] as { addClass?: string[] };
            return Array.isArray(patch.addClass) && patch.addClass.includes('ts-ui-component');
        });

        expect(addClassOps.length).toBe(1);
        expect((addClassOps[0].args[1] as { addClass: string[] }).addClass).toEqual([
            'ts-ui-component', 'Button', 'SpinButton',
        ]);
    });
});

// Plan glyph-icon-trait-dedup.md: SpinButton opts its chevron glyph into
// GLYPH_XS_INK_TRAIT right after pinGlyphSize(8), so every SpinButton's
// chevron shares one .ts-ui-trait-glyph-xs-ink rule (also shared with
// TabButton's close-button chevron) instead of each repeating the same
// size on its own #id rule.
describe('SpinButton chevron glyph style hoisting', () => {
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

    it("a second SpinButton's chevron glyph writes no size declaration to its own #id rule, and the shared trait rule exists", () => {
        // Seed the group with a first render before the capture window opens.
        new SpinButton('▲').getElement(true);

        const second = new SpinButton('▼');
        const glyph  = second.getGlyph()!;

        const declarations = declarationsDuring(sink, idSelector(glyph), () => second.getElement(true));

        expect(declarations.minWidth).toBeUndefined();
        expect(declarations.minHeight).toBeUndefined();
        expect(declarations.maxWidth).toBeUndefined();
        expect(declarations.maxHeight).toBeUndefined();
        expect(_ruleCacheHas('.ts-ui-component.ts-ui-trait-glyph-xs-ink')).toBe(true);
    });
});
