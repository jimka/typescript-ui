// Coverage for Spacer's constant `background-color: transparent` moving off
// every instance's own `#id` rule and onto a shared `.Spacer` class rule — a
// Style Audit dedup finding (`diagnostics/StyleAudit.ts`). Conventions
// (idSelector/declarationsDuring) copied from
// ParentHeader.classStyleDefaults.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { Spacer } from '~/component/container/Spacer';

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
 * flattened into one key/value map. Copied from `ParentHeader.classStyleDefaults.test.ts`.
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

describe('Spacer style hoisting', () => {
    afterEach(() => DOM.reset());

    it('a rendered Spacer carries no backgroundColor on its own #id rule, and .Spacer declares transparent', () => {
        const sink   = installTestDOM(CONFIG);
        const spacer = new Spacer(16);

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(spacer), () => spacer.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.Spacer') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }

        expect(classDeclarations.backgroundColor).toBe('transparent');
        expect(declarations.backgroundColor).toBeUndefined();
        expect(_ruleCacheHas('.Spacer')).toBe(true);
        expect(spacer.getBackgroundColor()).toBe('transparent');

        // The flat route leaves the chain non-participating, so the class
        // list must not widen (Expected Behaviour row 2).
        const added = sink.writes
            .slice(start)
            .filter((w) => w.op === 'apply' && (w.args[1] as any)?.addClass)
            .map((w) => (w.args[1] as any).addClass);
        expect(added).toContainEqual(['ts-ui-component', 'Spacer']);
    });
});
