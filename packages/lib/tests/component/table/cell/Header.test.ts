// HeaderCell label composition: the required asterisk and the sort arrow are
// two independent suffixes appended to the base title by a shared
// `_renderTitle` so setting one never clobbers the other. Pure text
// composition — the test DOM is installed because HeaderCell's constructor
// builds child components, but no render/measure is needed to read the text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../../dom/TestDOM';
import fontMetrics from '../../../dom/font-metrics.test-font.json';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { HeaderCell } from '~/component/table/cell/Header';
import { DefaultCell } from '~/component/table/cell/Default';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

/** Reads the composed label off the header cell's renderer. */
function label(cell: HeaderCell): string {
    return cell.getRenderer().getText().getText().toString();
}

describe('HeaderCell required asterisk + sort arrow composition', () => {
    it('shows only the base title when neither required nor sorted', () => {
        const cell = new HeaderCell('Name', 'name');

        expect(label(cell)).toBe('Name');
    });

    it('setRequired(true) appends the asterisk suffix', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);

        expect(label(cell)).toBe('Name *');
    });

    it('setSortState appends the sort arrow suffix, independent of required', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setSortState('asc');
        expect(label(cell)).toBe('Name ▲');

        cell.setSortState('desc');
        expect(label(cell)).toBe('Name ▼');
    });

    it('required + sorted shows both markers, asterisk before the arrow', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('asc');

        expect(label(cell)).toBe('Name * ▲');
    });

    it('clearSortState removes the arrow but keeps the asterisk', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('asc');
        cell.clearSortState();

        expect(label(cell)).toBe('Name *');
    });

    it('setRequired(false) removes the asterisk, keeping an active sort arrow', () => {
        const cell = new HeaderCell('Name', 'name');

        cell.setRequired(true);
        cell.setSortState('desc');
        cell.setRequired(false);

        expect(label(cell)).toBe('Name ▼');
    });
});

describe('HeaderCellRenderer static style hoisting', () => {
    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
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

    it("row 6: a rendered HeaderCell's renderer carries no static cursor/userSelect declaration on its own #id rule, and the shared .HeaderCellRenderer class rule exists once rendered", () => {
        const sink = DOM.sink as RecordingDOMSink;

        const cell     = new HeaderCell('Name', 'name');
        const renderer = cell.getRenderer();

        const declarations = declarationsDuring(sink, idSelector(renderer), () => cell.getElement(true));

        expect(declarations.cursor).toBeUndefined();
        expect(declarations.userSelect).toBeUndefined();
        // No `.HeaderCellRenderer` class rule ever gets created: `cursor:
        // "default"` / `userSelect: "none"` are exactly the framework-tier
        // `:where(.ts-ui-component)` values (see ClassStyleRules.ts's
        // FRAMEWORK_DECLARATIONS), so `ensureClassStyleRule`'s own deviation
        // filter drops both keys before any `.HeaderCellRenderer` `StyleRule`
        // is constructed — the same "already matches, no class default
        // needed" case ScrollArrowButton's `cursor` hits (see Scrollbar.ts's
        // `[^cursor-already-matches]`-documented precedent). Dedup still
        // happens in full, just at the framework tier instead of a class
        // tier.
        expect(_ruleCacheHas('.HeaderCellRenderer')).toBe(false);
    });

    it('an ordinary (non-header) DefaultCell renderer is unaffected and still opts in to cursor: text / userSelect: text via .StringRenderer', () => {
        const cell = new DefaultCell();

        expect(cell.getRenderer().getCursor()).toBe('text');
        expect(cell.getRenderer().getUserSelect()).toBe('text');
    });
});

describe('HeaderCellText style hoisting', () => {
    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
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

    it("a rendered HeaderCell's renderer text carries no fontWeight/fontSize/userSelect declaration on its own #id rule", () => {
        const sink = DOM.sink as RecordingDOMSink;
        const cell = new HeaderCell('Name', 'name');
        const text = cell.getRenderer().getText();

        const declarations = declarationsDuring(sink, idSelector(text), () => cell.getElement(true));

        expect(declarations.fontWeight).toBeUndefined();
        expect(declarations.fontSize).toBeUndefined();
        expect(declarations.userSelect).toBeUndefined();
    });

    it("the renderer text's cursor is unchanged (still 'text', inherited from SelectableText)", () => {
        const cell = new HeaderCell('Name', 'name');

        expect(cell.getRenderer().getText().getCursor()).toBe('text');
    });

    it('the shared .HeaderCellText class rule exists once a HeaderCell has rendered', () => {
        const cell = new HeaderCell('Name', 'name');
        cell.getElement(true);

        expect(_ruleCacheHas('.HeaderCellText')).toBe(true);
    });
});

// HeaderCell-specific coverage for the state-tier dedup: the `:active`
// box-shadow is a declared `ownStyleStates` entry
// (plans/implemented/layered-style-bag.md), sharing one class-tier rule
// across every instance via `resolveStyleStates`.
//
// Since plans/layered-style-bag.md's Stage 5, `HeaderCell.ownStyleStates`
// restates `Cell`'s own three background/cursor/shadow states
// (`.rangeSelected`, `.readOnly`, `.requiredEmpty`) ahead of `:active` (see
// that field's own comment) — `.focused` is deliberately not one of them
// (see `Cell.ownStyleStates`' own comment on why it carries an unguarded
// rule instead) — so `:active`'s generated guard now excludes all three,
// not just itself — `ACTIVE_GUARDED_SUFFIX` below is that full chain.
describe('HeaderCell :active state-class hoisting', () => {
    const ACTIVE_GUARDED_SUFFIX = ':active:not(.rangeSelected):not(.readOnly):not(.requiredEmpty)';

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: { getId(): string }): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Copied from `ClassChromeRules.test.ts`.
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

    it('row 2: a second HeaderCell writes no boxShadow to its own #id:active rule once the class rule is warmed', () => {
        const sink = DOM.sink as RecordingDOMSink;

        new HeaderCell('Name', 'name').getElement(true);

        const second = new HeaderCell('Name', 'name');
        const declarations = declarationsDuring(sink, idSelector(second) + ACTIVE_GUARDED_SUFFIX, () => second.getElement(true));

        expect(declarations.boxShadow).toBeUndefined();
        expect(_ruleCacheHas('.HeaderCell' + ACTIVE_GUARDED_SUFFIX)).toBe(true);
    });

    it("setColumnFocused's resting boxShadow write stays isolated from :active, on #id:not(:active) rather than bare #id", () => {
        const sink = DOM.sink as RecordingDOMSink;

        const cell = new HeaderCell('Name', 'name');
        cell.getElement(true);

        const restingDeclarations = declarationsDuring(sink, idSelector(cell) + ':not(.rangeSelected):not(.readOnly):not(.requiredEmpty):not(:active)', () => {
            cell.setColumnFocused(true);
        });
        expect(restingDeclarations.boxShadow).toBe('inset 0 -2px 0 0 var(--ts-ui-focus-ring, rgba(30, 100, 200, 0.6))');

        const bareDeclarations = declarationsDuring(sink, idSelector(cell), () => {
            cell.setColumnFocused(false);
        });
        expect(bareDeclarations.boxShadow).toBeUndefined();
    });
});
