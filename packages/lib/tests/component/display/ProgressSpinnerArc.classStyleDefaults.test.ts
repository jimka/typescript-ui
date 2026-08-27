// Coverage for ProgressSpinner's inner arc's constant ring geometry (border,
// borderRadius) moving off every instance's own `#id` rule and onto a shared
// `.ProgressSpinnerArc` class rule — a Style Audit dedup finding
// (`diagnostics/StyleAudit.ts`). Conventions (idSelector/declarationsDuring)
// copied from ParentHeader.classStyleDefaults.test.ts; the `_arc` reach-in
// pattern copied from ProgressSpinner.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { Component } from '~/core/Component';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { ProgressSpinner } from '~/component/display/ProgressSpinner';

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

describe('ProgressSpinnerArc style hoisting', () => {
    afterEach(() => DOM.reset());

    it("a rendered spinner's arc carries only its animation on its own #id rule; .ProgressSpinnerArc carries the ring", () => {
        const sink    = installTestDOM(CONFIG);
        const spinner = new ProgressSpinner(24);
        const arc     = (spinner as unknown as { _arc: Component })._arc;

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(arc), () => spinner.getElement(true));

        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.ProgressSpinnerArc') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }

        expect(classDeclarations.borderRadius).toBe('50%');
        expect(classDeclarations.borderTop).toBe('3px solid transparent');
        expect(classDeclarations.borderRight).toBe('3px solid var(--ts-ui-progress-spinner-color, rgb(30, 100, 200))');

        expect(declarations.borderRadius).toBeNull();
        expect(declarations.borderTop).toBeNull();
        expect(declarations.borderRight).toBeNull();
        expect(declarations.borderBottom).toBeNull();
        expect(declarations.borderLeft).toBeNull();
        expect(declarations.animation).toBe('ts-ui-progress-spinner-rotate 0.8s linear infinite');
        expect(_ruleCacheHas('.ProgressSpinnerArc')).toBe(true);
    });
});
