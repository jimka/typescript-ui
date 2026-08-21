//
// Coverage for the text-bearing cell renderers' user-select opt-in, the
// three header-cell classes' opt-out, and a cross-cutting regression check
// that interactive chrome elsewhere in the framework kept its unselectable
// default. `Component.setUserSelect` caches its value, so `getUserSelect()`
// reads back cached state with no DOM required — the offline harness is
// installed anyway since the renderers under test mint DOM.sink elements at
// construction.
//
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DOM } from '~/core/DOM';
import { installTestDOM, RecordingDOMSink } from '../../dom/TestDOM';
import fontMetrics from '../../dom/font-metrics.test-font.json';
import { Component } from '~/core/Component';
import { _ruleCacheHas } from '~/core/StyleTarget';
import { StringRenderer } from '~/component/table/cell/renderer/String';
import { NumberRenderer } from '~/component/table/cell/renderer/Number';
import { DateRenderer } from '~/component/table/cell/renderer/Date';
import { DateTimeRenderer } from '~/component/table/cell/renderer/DateTime';
import { TimeRenderer } from '~/component/table/cell/renderer/Time';
import { ComboRenderer } from '~/component/table/cell/renderer/Combo';
import { LinkCellRenderer } from '~/component/table/cell/renderer/Link';
import { GlyphRenderer } from '~/component/table/cell/renderer/Glyph';
import { HeaderCell } from '~/component/table/cell/Header';
import { ParentHeaderCell } from '~/component/table/cell/ParentHeader';
import { GroupSeparatorCell } from '~/component/table/cell/GroupSeparator';
import { StringCell } from '~/component/table/cell/String';
import { Button } from '~/component/button/Button';
import { MenuItem } from '~/component/container/MenuItem';
import { TabButton } from '~/component/button/TabButton';

const CONFIG = {
    rootMountOffset: { x: 0, y: 0 },
    viewport:        { width: 1280, height: 800 },
    scrollBarWidth:  15,
    fontMetrics,
    themeVars:       {},
};

beforeEach(() => installTestDOM(CONFIG));
afterEach(() => DOM.reset());

describe('text-bearing cell renderers opt in to user-select: text and cursor: text', () => {
    it('StringRenderer and its Text opt in', () => {
        const r = new StringRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('NumberRenderer and its Text opt in', () => {
        const r = new NumberRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('DateRenderer and its Text opt in', () => {
        const r = new DateRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('DateTimeRenderer and its Text opt in', () => {
        const r = new DateTimeRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('TimeRenderer and its Text opt in', () => {
        const r = new TimeRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getComponents()[0].getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('ComboRenderer and its Text opt in', () => {
        const r = new ComboRenderer([]);

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('LinkCellRenderer and its Text opt in', () => {
        const r = new LinkCellRenderer();

        expect(r.getUserSelect()).toBe('text');
        expect(r.getText().getUserSelect()).toBe('text');
        expect(r.getCursor()).toBe('text');
    });

    it('GlyphRenderer stays unselectable — glyph cells are not text', () => {
        expect(new GlyphRenderer().getUserSelect()).toBe('none');
        expect(new GlyphRenderer().getCursor()).toBe('default');
    });
});

describe('header, parent-header and group-separator cells opt back out', () => {
    it('HeaderCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new HeaderCell('Name', 'name');

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getCursor()).toBe('default');
    });

    it('ParentHeaderCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new ParentHeaderCell('Group', null);

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getCursor()).toBe('default');
    });

    it('GroupSeparatorCell keeps its StringRenderer and Text unselectable', () => {
        const cell = new GroupSeparatorCell('Group', null);

        expect(cell.getRenderer().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getText().getUserSelect()).toBe('none');
        expect(cell.getRenderer().getCursor()).toBe('default');
    });

    it('a body StringCell built from the same renderer is unaffected by the header opt-out', () => {
        expect(new StringCell().getRenderer().getUserSelect()).toBe('text');
        expect(new StringCell().getRenderer().getCursor()).toBe('text');
    });
});

describe('interactive chrome keeps its unselectable default', () => {
    it("a Button's label Text stays unselectable", () => {
        const btn = new Button({ text: 'Save' });

        expect((btn as any)._text.getUserSelect()).toBe('none');
    });

    it("a MenuItem's title Text stays unselectable", () => {
        const item = new MenuItem({ text: 'A' }, () => {}, () => {});

        expect((item as any)._titleText.getUserSelect()).toBe('none');
    });

    it("a TabButton's label stays unselectable", () => {
        const tab = new TabButton('Tab');

        expect((tab as any)._text.getUserSelect()).toBe('none');
    });
});

// The point of routing these values through class defaults rather than
// per-instance setter calls: `user-select` / `cursor` are class-uniform, so
// they belong on the shared `.StringRenderer` / `.SelectableText` rule, not
// re-materialised into every instance's own `#id` rule. The getter assertions
// above would pass either way — these pin the tier the value actually lands on.
describe('selectable text resolves through the class rule, not a per-instance rule', () => {
    /**
     * Declarations written to `selector`'s stylesheet rule while `fn()` ran,
     * flattened into one key/value map. Only `setRuleStyles` ops whose selector
     * (`args[0]`) matches are counted, so a class-rule write in the same window
     * doesn't leak into an `#id`-rule assertion. Mirrors the helper in
     * `tests/core/ClassStyleRules.test.ts`.
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

    /** This component's own `#id` rule selector, matching `Component`'s internal escaping. */
    function idSelector(component: Component): string {
        return '#' + DOM.source.escapeSelector(component.getId());
    }

    it('a second StringRenderer writes no per-instance declarations at all', () => {
        const sink = DOM.sink as RecordingDOMSink;

        // Render one instance first, so the `.StringRenderer` class rule's own
        // creation sits outside the measured window.
        new StringRenderer().getElement(true);

        const r    = new StringRenderer();
        const text = r.getText();

        // The child's first render happens inside the parent's, so one window
        // covers both. The child's declarations double as the positive control
        // that this window and these selectors are live — without it, a
        // mis-built selector would make every absence assertion below pass
        // vacuously.
        let textDeclarations: Record<string, string | null> = {};
        const declarations = declarationsDuring(sink, idSelector(r), () => {
            textDeclarations = declarationsDuring(sink, idSelector(text), () => r.getElement(true));
        });

        expect(Object.keys(textDeclarations).length).toBeGreaterThan(0);

        // The renderer diverges from its class bag in nothing — `cursor` and
        // `user-select` now resolve through `.StringRenderer` — so it
        // materialises no `#id` rule whatsoever.
        expect(declarations.userSelect).toBeUndefined();
        expect(declarations.cursor).toBeUndefined();
        expect(Object.keys(declarations)).toEqual([]);
        expect(_ruleCacheHas('.StringRenderer')).toBe(true);
    });

    it("the renderer's SelectableText child skips its font block along with userSelect and cursor, keeping only textOverflow", () => {
        const sink = DOM.sink as RecordingDOMSink;

        new StringRenderer().getElement(true);

        const r    = new StringRenderer();
        const text = r.getText();

        const declarations = declarationsDuring(sink, idSelector(text), () => r.getElement(true));

        // Positive control, and the reason this is NOT an assertion that the
        // `#id` rule is absent: `setTruncate` is unconditionally dispatched
        // from `Text`'s constructor (needed so `whiteSpace`/`overflow`, which
        // have no render-time fallback, are always set), and that dispatch
        // pre-queues `textOverflow`'s write before the class-rule comparison
        // ever runs — see plans/implemented/text-applystyle-class-hoisting.md's
        // Implementation Notes. Every other font/text declaration, plus
        // `cursor`, now resolves through the shared `.SelectableText` tier
        // instead. `userSelect` also resolves through that shared tier, but
        // since `#id` already materialises for `textOverflow` regardless,
        // plans/implemented/reconciled-write-path-widening.md's render-phase
        // migration means the match now surfaces as an explicit removal in
        // the same batch rather than being skipped in silence — the net
        // rendered CSS (no declaration on #id, `.SelectableText` supplies the
        // value) is unchanged.
        expect(declarations.textOverflow).toBe('ellipsis');
        expect(declarations.fontFamily).toBeUndefined();
        expect(declarations.userSelect).toBeNull();
        expect(declarations.cursor).toBeUndefined();
        expect(_ruleCacheHas('.SelectableText')).toBe(true);
    });
});
