// Coverage for ParentHeaderCell's static fontWeight/fontSize/textAlign/
// userSelect group-label styling moving from imperative constructor setters
// into dedicated ParentHeaderCellText / ParentHeaderCellRenderer subclasses
// — a Style Audit dedup finding (`diagnostics/StyleAudit.ts`), mirroring
// HeaderCellText / HeaderCellRenderer (component/table/cell/Header.ts).
// Conventions (idSelector/declarationsDuring) copied from
// Header.test.ts's "HeaderCellText style hoisting" describe block.
import { describe, it, expect, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { ParentHeaderCell } from '~/component/table/cell/ParentHeader';

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
 * flattened into one key/value map. Copied from `Header.test.ts`.
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

describe('ParentHeaderCellText style hoisting', () => {
    afterEach(() => DOM.reset());

    it("a rendered ParentHeaderCell's renderer text carries no fontWeight/fontSize/textAlign/userSelect declaration on its own #id rule, and .ParentHeaderCellText carries all four", () => {
        const sink = installTestDOM(CONFIG);
        const cell = new ParentHeaderCell('Group', null);
        const text = cell.getRenderer().getText();

        const start        = sink.writes.length;
        const declarations = declarationsDuring(sink, idSelector(text), () => cell.getElement(true));

        // Positive half: what .ParentHeaderCellText itself declares, read
        // from the same render pass (a second declarationsDuring call would
        // find the rule already materialised and emit nothing).
        const classDeclarations: Record<string, string | null> = {};
        for (const w of sink.writes.slice(start)) {
            if (w.op === 'setRuleStyles' && w.args[0] === '.ParentHeaderCellText') {
                Object.assign(classDeclarations, w.args[1]);
            }
        }
        expect(classDeclarations.fontWeight).toBe('bold');
        expect(classDeclarations.fontSize).toBe('var(--ts-ui-table-header-font-size, 14px)');
        expect(classDeclarations.textAlign).toBe('center');
        expect(classDeclarations.userSelect).toBe('none');

        // Negative half: none of the four reach the text's own #id rule.
        expect(declarations.fontWeight).toBeUndefined();
        expect(declarations.fontSize).toBeUndefined();
        expect(declarations.textAlign).toBeUndefined();
        expect(declarations.userSelect).toBeUndefined();
        expect(_ruleCacheHas('.ParentHeaderCellText')).toBe(true);
    });

    it("the renderer text's cursor is unchanged (still 'text', inherited from SelectableText)", () => {
        const cell = new ParentHeaderCell('Group', null);

        expect(cell.getRenderer().getText().getCursor()).toBe('text');
    });

    it('the renderer itself keeps its cursor: default / userSelect: none opt-out via the flat class default', () => {
        const cell = new ParentHeaderCell('Group', null);

        expect(cell.getRenderer().getCursor()).toBe('default');
        expect(cell.getRenderer().getUserSelect()).toBe('none');
    });

    it('regression: setText still correctly sets the visible per-instance label', () => {
        const cell = new ParentHeaderCell('Group A', null);

        expect(cell.getRenderer().getText().getText()).toBe('Group A');
        expect(cell.getText()).toBe('Group A');
    });
});
