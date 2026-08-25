// Coverage for Legend's static `position: static` and `marginLeft` moving
// from imperative constructor/applyStyle writes into a registered
// `ownClassStyleDefaults` class default — a Style Audit dedup finding
// (`diagnostics/StyleAudit.ts`). Legend is the first class to author
// `position` through `ownClassStyleDefaults`, which required widening
// `ClassStyleRules.ts`'s `resolveDeclarations` (previously a hardcoded
// `Position.ABSOLUTE` literal that never consulted the bag) — see that
// function's own comment. `marginLeft` later joined the same bag, adding a
// truthy-gated conditional to `resolveDeclarations` instead. Conventions
// (idSelector/declarationsDuring) copied from ToolBar.classStyleDefaults.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { FieldSet } from '~/component/container/FieldSet';

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

describe('Legend static style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered Legend (via FieldSet) carries no static position declaration on its own #id rule, and .Legend carries it', () => {
        const sink      = installTestDOM(CONFIG);
        const fieldSet  = new FieldSet('Title') as any;
        const legend    = fieldSet._legend;

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(legend), () => fieldSet.getElement(true));

        // Positive half: what .Legend itself declares, read from the same
        // render pass (a second declarationsDuring call would find the rule
        // already materialised and emit nothing).
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.Legend') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.position).toBe('static');
        expect(classDeclarations.marginLeft).toBe('10px');

        // Negative half: no real "static" or "marginLeft" reaches the
        // legend's own #id rule. Both keys read back as absent (not
        // present-with-`null`): once `marginLeft` leaves the `#id` rule, that
        // rule holds nothing but `null` removals and is never materialised.
        expect(declarations.position).toBeUndefined();
        expect(declarations.marginLeft).toBeUndefined();
        expect(_ruleCacheHas('.Legend')).toBe(true);
        expect(legend.getPosition()).toBe('static');
    });
});
