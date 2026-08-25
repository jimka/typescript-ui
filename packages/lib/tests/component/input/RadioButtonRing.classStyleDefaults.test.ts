// Coverage for RadioButtonRing's static `border-radius: 50%` moving from an
// imperative constructor setter (RadioButton's own `this._ring.setBorderRadius("50%")`)
// into the existing `_defaultRadioButtonRingOptions` flat class-default bag —
// a Style Audit dedup finding (`diagnostics/StyleAudit.ts`). Conventions
// (idSelector/declarationsDuring) copied from ToolBar.classStyleDefaults.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { RadioButton } from '~/component/input/RadioButton';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

/** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
function idSelector(component: { getId(): string }): string {
    return '#' + DOM.source.escapeSelector(component.getId());
}

/**
 * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
 * flattened into one key/value map. Copied from `ToolBar.classStyleDefaults.test.ts`.
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

describe('RadioButtonRing static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered RadioButtonRing carries no static border-radius declaration on its own #id rule, and .RadioButtonRing carries it', () => {
        const sink = installTestDOM(CONFIG);
        const rb   = new RadioButton() as any;
        const ring = rb._ring;

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(ring), () => rb.getElement(true));

        // Positive half: what .RadioButtonRing itself declares, read from
        // the same render pass (a second declarationsDuring call would find
        // the rule already materialised and emit nothing).
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.RadioButtonRing') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.borderRadius).toBe('50%');

        // Negative half: no real "50%" reaches the ring's own #id rule.
        // `borderRadius` is not one of `.selected`'s declared keys, so it is
        // not routed to the isolated `:not(.selected)` rule and instead
        // rides on the plain #id rule alongside `cursor` — both dedupe to a
        // matching class default, and nothing else forces the batch to
        // materialise, so the key is absent rather than an explicit `null`
        // (see FooterRow.classStyleDefaults.test.ts for the same shape).
        expect(declarations.borderRadius).toBeUndefined();
        expect(_ruleCacheHas('.RadioButtonRing')).toBe(true);
        expect(ring.getBorderRadius()).toBe('50%');
    });
});
