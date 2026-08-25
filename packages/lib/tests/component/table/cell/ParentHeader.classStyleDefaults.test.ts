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

    /** The cell's resting-isolation rule selector — Cell's states guard it. */
    function restingSelector(cell: { getId(): string }): string {
        return idSelector(cell) + ':not(.rangeSelected):not(.readOnly):not(.requiredEmpty)';
    }

    // `ensureClassStyleRule` caches each class's rule per-constructor for the
    // file's lifetime (a module-level cache that outlives `DOM.reset()`), and
    // `cell.getElement(true)` renders the whole cell subtree in one pass — so
    // a single render establishes both .ParentHeaderCell's and
    // .ParentHeaderCellText's rules together. This combined test is the one
    // place in the file that observes both positive halves live; every other
    // test below only re-renders the same classes, which is why they stick to
    // per-instance (#id-rule / getter) assertions instead.
    it("a rendered ParentHeaderCell's renderer text carries no fontWeight/fontSize/textAlign/userSelect declaration on its own #id rule, .ParentHeaderCellText carries all four, and .ParentHeaderCell carries the cell's background/shadow while the cell's own rule carries neither", () => {
        const sink = installTestDOM(CONFIG);
        const cell = new ParentHeaderCell('Group', null);
        const text = cell.getRenderer().getText();

        const start = sink.writes.length;
        cell.getElement(true);
        const writesDuring = sink.writes.slice(start);

        function declarationsFor(selector: string): Record<string, string | null> {
            const out: Record<string, string | null> = {};
            for (const w of writesDuring) {
                if (w.op === 'setRuleStyles' && w.args[0] === selector) {
                    Object.assign(out, w.args[1] as Record<string, string | null>);
                }
            }

            return out;
        }

        const textDeclarations      = declarationsFor(idSelector(text));
        const textClassDeclarations = declarationsFor('.ParentHeaderCellText');
        const cellDeclarations      = declarationsFor(restingSelector(cell));
        const cellClassDeclarations = declarationsFor('.ParentHeaderCell');

        // Positive half: what .ParentHeaderCellText itself declares.
        expect(textClassDeclarations.fontWeight).toBe('bold');
        expect(textClassDeclarations.fontSize).toBe('var(--ts-ui-table-header-font-size, 14px)');
        expect(textClassDeclarations.textAlign).toBe('center');
        expect(textClassDeclarations.userSelect).toBe('none');

        // Negative half: none of the four reach the text's own #id rule.
        expect(textDeclarations.fontWeight).toBeUndefined();
        expect(textDeclarations.fontSize).toBeUndefined();
        expect(textDeclarations.textAlign).toBeUndefined();
        expect(textDeclarations.userSelect).toBeUndefined();
        expect(_ruleCacheHas('.ParentHeaderCellText')).toBe(true);

        // Positive half: what .ParentHeaderCell itself declares.
        expect(cellClassDeclarations.backgroundColor).toBe('transparent');
        expect(cellClassDeclarations.boxShadow).toContain('inset -1px 0 0 0');

        // Negative half: neither reaches the cell's own resting rule.
        expect(cellDeclarations.backgroundColor).toBeUndefined();
        expect(cellDeclarations.boxShadow).toBeUndefined();
        expect(cell.getBackgroundColor()).toBe('transparent');
    });

    it('a ParentHeaderCell with a groupColor still writes that colour, and only that', () => {
        const sink = installTestDOM(CONFIG);
        const cell = new ParentHeaderCell('Group', 'red');

        const declarations = declarationsDuring(sink, restingSelector(cell), () => cell.getElement(true));

        expect(declarations.backgroundColor).toBe('red');
        expect(declarations.boxShadow).toBeNull();
        expect(cell.getBackgroundColor()).toBe('red');
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
